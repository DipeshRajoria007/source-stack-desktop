use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Context;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::distr::Alphanumeric;
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

use super::errors::{AuthErrorCode, CoreError};
use super::models::{
    AuthStatus, GoogleSignInResult, ManualAuthChallenge, ManualAuthCompleteRequest, RuntimeSettings,
};

const TOKEN_KEYRING_SERVICE: &str = "com.sourcestack.desktop.google";
const TOKEN_KEYRING_USERNAME: &str = "default";

const DEFAULT_AUTH_AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_AUTH_TOKEN: &str = "https://oauth2.googleapis.com/token";
const DEFAULT_USERINFO: &str = "https://www.googleapis.com/oauth2/v2/userinfo";

const MANUAL_SESSION_TTL_SECONDS: i64 = 10 * 60;
const LOOPBACK_WAIT_SECONDS: u64 = 90;

const SCOPES: &[&str] = &[
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GoogleTokenEnvelope {
    access_token: String,
    refresh_token: Option<String>,
    expires_at_utc: DateTime<Utc>,
    email: Option<String>,
}

impl GoogleTokenEnvelope {
    fn is_expiring_within(&self, duration: Duration) -> bool {
        let now = Utc::now();
        let threshold = now
            + chrono::Duration::from_std(duration).unwrap_or_else(|_| chrono::Duration::minutes(5));
        self.expires_at_utc <= threshold
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct UserInfoResponse {
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct OAuthErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Clone)]
struct AuthEndpoints {
    authorize: String,
    token: String,
    userinfo: String,
}

impl Default for AuthEndpoints {
    fn default() -> Self {
        Self {
            authorize: DEFAULT_AUTH_AUTHORIZE.to_string(),
            token: DEFAULT_AUTH_TOKEN.to_string(),
            userinfo: DEFAULT_USERINFO.to_string(),
        }
    }
}

#[derive(Debug, Clone)]
struct ManualAuthSession {
    session_id: String,
    state: String,
    code_verifier: String,
    redirect_uri: String,
    authorize_url: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug)]
struct OAuthCallback {
    code: String,
    state: String,
}

pub struct GoogleAuthService {
    client: Client,
    endpoints: AuthEndpoints,
    manual_sessions: Mutex<HashMap<String, ManualAuthSession>>,
}

impl GoogleAuthService {
    pub fn new(client: Client) -> Self {
        Self {
            client,
            endpoints: AuthEndpoints::default(),
            manual_sessions: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    fn with_endpoints(client: Client, endpoints: AuthEndpoints) -> Self {
        Self {
            client,
            endpoints,
            manual_sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn sign_in(&self, settings: &RuntimeSettings) -> anyhow::Result<GoogleSignInResult> {
        self.validate_settings(settings)?;

        match self.authorize_interactive(settings).await {
            Ok(token) => {
                self.save_token(&token)?;
                Ok(GoogleSignInResult::SignedIn {
                    status: AuthStatus {
                        signed_in: true,
                        email: token.email,
                        expires_at: Some(token.expires_at_utc),
                    },
                })
            }
            Err(err) => {
                if let Some(reason) = manual_fallback_reason_from_error(&err) {
                    return Ok(GoogleSignInResult::ManualRequired {
                        reason: reason.to_string(),
                        message: "Automatic callback was not completed. Use manual sign-in flow."
                            .to_string(),
                    });
                }
                Err(err)
            }
        }
    }

    pub async fn begin_manual_sign_in(
        &self,
        settings: &RuntimeSettings,
    ) -> anyhow::Result<ManualAuthChallenge> {
        self.validate_settings(settings)?;
        self.cleanup_expired_manual_sessions().await;

        let session = self.create_manual_session(settings)?;
        let challenge = ManualAuthChallenge {
            session_id: session.session_id.clone(),
            authorize_url: session.authorize_url.clone(),
            redirect_uri: session.redirect_uri.clone(),
            expires_at: session.expires_at,
            instructions: "Open authorizeUrl, sign in to Google, then paste the final callback URL (or code) into this app."
                .to_string(),
        };

        let mut sessions = self.manual_sessions.lock().await;
        sessions.insert(session.session_id.clone(), session);
        Ok(challenge)
    }

    pub async fn complete_manual_sign_in(
        &self,
        settings: &RuntimeSettings,
        request: ManualAuthCompleteRequest,
    ) -> anyhow::Result<AuthStatus> {
        self.validate_settings(settings)?;

        let session = {
            let sessions = self.manual_sessions.lock().await;
            sessions.get(&request.session_id).cloned().ok_or_else(|| {
                CoreError::auth(
                    AuthErrorCode::SessionNotFound,
                    "Manual sign-in session not found. Start manual sign-in again.",
                )
            })?
        };

        if session.expires_at <= Utc::now() {
            let mut sessions = self.manual_sessions.lock().await;
            sessions.remove(&request.session_id);
            return Err(CoreError::auth(
                AuthErrorCode::ChallengeExpired,
                "Manual sign-in session expired. Start manual sign-in again.",
            )
            .into());
        }

        let code = parse_callback_url_or_code(&request.callback_url_or_code, &session.state)?;

        let token = self
            .exchange_authorization_code(
                settings,
                &code,
                &session.code_verifier,
                &session.redirect_uri,
                None,
            )
            .await?;
        self.save_token(&token)?;

        let mut sessions = self.manual_sessions.lock().await;
        sessions.remove(&request.session_id);

        Ok(AuthStatus {
            signed_in: true,
            email: token.email,
            expires_at: Some(token.expires_at_utc),
        })
    }

    pub fn sign_out(&self) -> anyhow::Result<()> {
        self.clear_token()?;
        let mut sessions = self.manual_sessions.blocking_lock();
        sessions.clear();
        Ok(())
    }

    pub fn status(&self) -> anyhow::Result<AuthStatus> {
        if let Some(token) = self.load_token()? {
            return Ok(AuthStatus {
                signed_in: true,
                email: token.email,
                expires_at: Some(token.expires_at_utc),
            });
        }

        Ok(AuthStatus {
            signed_in: false,
            email: None,
            expires_at: None,
        })
    }

    pub async fn get_access_token_non_interactive(
        &self,
        settings: &RuntimeSettings,
    ) -> anyhow::Result<String> {
        self.validate_settings(settings)?;

        let cached = self.load_token()?.ok_or_else(|| {
            CoreError::auth(AuthErrorCode::SignInRequired, "Google sign-in required.")
        })?;

        if !cached.is_expiring_within(Duration::from_secs(5 * 60)) {
            return Ok(cached.access_token);
        }

        let refresh_token = cached.refresh_token.clone().ok_or_else(|| {
            CoreError::auth(
                AuthErrorCode::ReauthRequired,
                "Google session expired. Sign in again.",
            )
        })?;

        match self.refresh_token(settings, &refresh_token).await {
            Ok(refreshed) => {
                self.save_token(&refreshed)?;
                Ok(refreshed.access_token)
            }
            Err(err) => {
                if is_reauth_error(&err) {
                    self.clear_token()?;
                    return Err(CoreError::auth(
                        AuthErrorCode::ReauthRequired,
                        "Google session expired or revoked. Sign in again.",
                    )
                    .into());
                }
                Err(err)
            }
        }
    }

    fn validate_settings(&self, settings: &RuntimeSettings) -> anyhow::Result<()> {
        if settings.google_client_id.trim().is_empty() {
            return Err(CoreError::MissingGoogleClientId.into());
        }

        Ok(())
    }

    fn load_token(&self) -> anyhow::Result<Option<GoogleTokenEnvelope>> {
        let entry = keyring::Entry::new(TOKEN_KEYRING_SERVICE, TOKEN_KEYRING_USERNAME)?;
        let raw = match entry.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(err) => return Err(err.into()),
        };

        let token = serde_json::from_str::<GoogleTokenEnvelope>(&raw)?;
        Ok(Some(token))
    }

    fn save_token(&self, token: &GoogleTokenEnvelope) -> anyhow::Result<()> {
        let entry = keyring::Entry::new(TOKEN_KEYRING_SERVICE, TOKEN_KEYRING_USERNAME)?;
        let json = serde_json::to_string(token)?;
        entry.set_password(&json)?;
        Ok(())
    }

    fn clear_token(&self) -> anyhow::Result<()> {
        let entry = keyring::Entry::new(TOKEN_KEYRING_SERVICE, TOKEN_KEYRING_USERNAME)?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    async fn refresh_token(
        &self,
        settings: &RuntimeSettings,
        refresh_token: &str,
    ) -> anyhow::Result<GoogleTokenEnvelope> {
        let mut form = vec![
            ("client_id", settings.google_client_id.clone()),
            ("refresh_token", refresh_token.to_string()),
            ("grant_type", "refresh_token".to_string()),
        ];
        if let Some(secret) = settings.google_client_secret.as_deref() {
            if !secret.trim().is_empty() {
                form.push(("client_secret", secret.to_string()));
            }
        }

        let response = self
            .client
            .post(&self.endpoints.token)
            .form(&form)
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            if is_reauth_response(status.as_u16(), &body) {
                return Err(CoreError::auth(
                    AuthErrorCode::ReauthRequired,
                    "Google session is no longer valid.",
                )
                .into());
            }
            return Err(CoreError::auth(
                AuthErrorCode::ProviderError,
                format!(
                    "Google token refresh failed with status {}.",
                    status.as_u16()
                ),
            )
            .into());
        }

        let payload = serde_json::from_str::<TokenResponse>(&body)?;
        let expires_at = Utc::now() + chrono::Duration::seconds(payload.expires_in);
        let email = self.fetch_user_email(&payload.access_token).await.ok();

        Ok(GoogleTokenEnvelope {
            access_token: payload.access_token,
            refresh_token: payload
                .refresh_token
                .or_else(|| Some(refresh_token.to_string())),
            expires_at_utc: expires_at,
            email,
        })
    }

    async fn authorize_interactive(
        &self,
        settings: &RuntimeSettings,
    ) -> anyhow::Result<GoogleTokenEnvelope> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| {
            CoreError::auth(
                AuthErrorCode::LoopbackUnavailable,
                "Local OAuth callback listener is unavailable.",
            )
        })?;
        let port = listener.local_addr()?.port();

        let session = self.create_session_with_redirect(settings, port)?;
        open_auth_url(&session.authorize_url).map_err(|_| {
            CoreError::auth(
                AuthErrorCode::LoopbackUnavailable,
                "Failed to open browser for Google sign-in.",
            )
        })?;

        let callback = tokio::task::spawn_blocking(move || {
            wait_for_oauth_callback(listener, port, Duration::from_secs(LOOPBACK_WAIT_SECONDS))
        })
        .await??;

        if callback.state != session.state {
            return Err(CoreError::auth(
                AuthErrorCode::StateMismatch,
                "Google callback state mismatch.",
            )
            .into());
        }

        self.exchange_authorization_code(
            settings,
            &callback.code,
            &session.code_verifier,
            &session.redirect_uri,
            None,
        )
        .await
    }

    fn create_manual_session(
        &self,
        settings: &RuntimeSettings,
    ) -> anyhow::Result<ManualAuthSession> {
        let mut rng = rand::rng();
        let fallback_port: u16 = rng.random_range(49152..65000);
        self.create_session_with_redirect(settings, fallback_port)
    }

    fn create_session_with_redirect(
        &self,
        settings: &RuntimeSettings,
        port: u16,
    ) -> anyhow::Result<ManualAuthSession> {
        let state = Uuid::new_v4().to_string();
        let code_verifier = generate_code_verifier();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
        let redirect_uri = format!("http://127.0.0.1:{port}/callback/");
        let authorize_url = build_authorize_url(
            &self.endpoints.authorize,
            settings,
            &state,
            &challenge,
            &redirect_uri,
        )?
        .to_string();

        Ok(ManualAuthSession {
            session_id: Uuid::new_v4().to_string(),
            state,
            code_verifier,
            redirect_uri,
            authorize_url,
            expires_at: Utc::now() + chrono::Duration::seconds(MANUAL_SESSION_TTL_SECONDS),
        })
    }

    async fn exchange_authorization_code(
        &self,
        settings: &RuntimeSettings,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
        fallback_refresh_token: Option<String>,
    ) -> anyhow::Result<GoogleTokenEnvelope> {
        let mut form = vec![
            ("client_id", settings.google_client_id.clone()),
            ("code", code.to_string()),
            ("code_verifier", code_verifier.to_string()),
            ("grant_type", "authorization_code".to_string()),
            ("redirect_uri", redirect_uri.to_string()),
        ];
        if let Some(secret) = settings.google_client_secret.as_deref() {
            if !secret.trim().is_empty() {
                form.push(("client_secret", secret.to_string()));
            }
        }

        let response = self
            .client
            .post(&self.endpoints.token)
            .form(&form)
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            if is_reauth_response(status.as_u16(), &body) {
                return Err(CoreError::auth(
                    AuthErrorCode::ReauthRequired,
                    "Google authorization failed. Start sign-in again.",
                )
                .into());
            }
            return Err(CoreError::auth(
                AuthErrorCode::ProviderError,
                format!(
                    "Google authorization exchange failed with status {}.",
                    status.as_u16()
                ),
            )
            .into());
        }

        let payload = serde_json::from_str::<TokenResponse>(&body)?;
        let expires_at = Utc::now() + chrono::Duration::seconds(payload.expires_in);
        let email = self.fetch_user_email(&payload.access_token).await.ok();

        Ok(GoogleTokenEnvelope {
            access_token: payload.access_token,
            refresh_token: payload.refresh_token.or(fallback_refresh_token),
            expires_at_utc: expires_at,
            email,
        })
    }

    async fn fetch_user_email(&self, access_token: &str) -> anyhow::Result<String> {
        let response = self
            .client
            .get(&self.endpoints.userinfo)
            .bearer_auth(access_token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!("userinfo endpoint failed"));
        }

        let payload = response.json::<UserInfoResponse>().await?;
        payload
            .email
            .ok_or_else(|| anyhow::anyhow!("userinfo did not return email"))
    }

    async fn cleanup_expired_manual_sessions(&self) {
        let now = Utc::now();
        let mut sessions = self.manual_sessions.lock().await;
        sessions.retain(|_, session| session.expires_at > now);
    }
}

fn build_authorize_url(
    authorize_endpoint: &str,
    settings: &RuntimeSettings,
    state: &str,
    challenge: &str,
    redirect_uri: &str,
) -> anyhow::Result<Url> {
    let scope = SCOPES.join(" ");
    let url = Url::parse_with_params(
        authorize_endpoint,
        &[
            ("client_id", settings.google_client_id.as_str()),
            ("redirect_uri", redirect_uri),
            ("response_type", "code"),
            ("scope", scope.as_str()),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("state", state),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
        ],
    )?;

    Ok(url)
}

fn generate_code_verifier() -> String {
    let mut rng = rand::rng();
    (&mut rng)
        .sample_iter(&Alphanumeric)
        .take(96)
        .map(char::from)
        .collect::<String>()
}

fn open_auth_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    let chrome_apps: [&str; 2] = ["chrome", "chrome.exe"];
    #[cfg(target_os = "macos")]
    let chrome_apps: [&str; 2] = ["Google Chrome", "google chrome"];
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let chrome_apps: [&str; 2] = ["google-chrome", "chrome"];

    for app in chrome_apps {
        if open::with_detached(url, app).is_ok() {
            return Ok(());
        }
    }

    open::that_detached(url)
}

fn wait_for_oauth_callback(
    listener: TcpListener,
    port: u16,
    timeout: Duration,
) -> anyhow::Result<OAuthCallback> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + timeout;

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0u8; 16_384];
                let read = stream
                    .read(&mut buffer)
                    .context("failed to read OAuth callback request")?;
                let request = String::from_utf8_lossy(&buffer[..read]);

                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");

                let callback_url = format!("http://127.0.0.1:{port}{path}");
                let callback = parse_callback_url_or_code(&callback_url, "")?;
                let state = parse_state_from_callback_url(&callback_url).unwrap_or_default();

                let html = "<html><body><h3>SourceStack authentication completed.</h3><p>You can close this window.</p></body></html>";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                return Ok(OAuthCallback {
                    code: callback,
                    state,
                });
            }
            Err(err) if err.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(CoreError::auth(
                        AuthErrorCode::LoopbackTimeout,
                        "Timed out waiting for Google callback.",
                    )
                    .into());
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                return Err(CoreError::auth(
                    AuthErrorCode::LoopbackUnavailable,
                    "OAuth callback listener failed.",
                )
                .into());
            }
        }
    }
}

fn parse_state_from_callback_url(input: &str) -> Option<String> {
    let parsed = Url::parse(input).ok()?;
    for (k, v) in parsed.query_pairs() {
        if k == "state" {
            return Some(v.to_string());
        }
    }
    None
}

fn parse_callback_url_or_code(input: &str, expected_state: &str) -> anyhow::Result<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(CoreError::auth(
            AuthErrorCode::InvalidCallback,
            "Callback URL or authorization code is required.",
        )
        .into());
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let parsed = Url::parse(trimmed).map_err(|_| {
            CoreError::auth(AuthErrorCode::InvalidCallback, "Invalid callback URL.")
        })?;

        let mut code = String::new();
        let mut state = String::new();
        let mut oauth_error = String::new();
        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => code = v.to_string(),
                "state" => state = v.to_string(),
                "error" => oauth_error = v.to_string(),
                _ => {}
            }
        }

        if !oauth_error.is_empty() {
            return Err(CoreError::auth(
                AuthErrorCode::InvalidCallback,
                "Google sign-in was not completed.",
            )
            .into());
        }

        if !expected_state.is_empty() && !state.is_empty() && state != expected_state {
            return Err(
                CoreError::auth(AuthErrorCode::StateMismatch, "Callback state mismatch.").into(),
            );
        }

        if code.trim().is_empty() {
            return Err(CoreError::auth(
                AuthErrorCode::InvalidCallback,
                "Authorization code not found in callback.",
            )
            .into());
        }

        return Ok(code);
    }

    Ok(trimmed.to_string())
}

fn is_reauth_response(status: u16, body: &str) -> bool {
    if status != 400 && status != 401 {
        return false;
    }

    if let Ok(parsed) = serde_json::from_str::<OAuthErrorResponse>(body) {
        let error = parsed.error.unwrap_or_default().to_ascii_lowercase();
        let description = parsed
            .error_description
            .unwrap_or_default()
            .to_ascii_lowercase();
        if error.contains("invalid_grant")
            || error.contains("invalid_token")
            || description.contains("invalid_grant")
            || description.contains("token")
        {
            return true;
        }
    }

    let lowered = body.to_ascii_lowercase();
    lowered.contains("invalid_grant") || lowered.contains("invalid_token")
}

fn is_reauth_error(error: &anyhow::Error) -> bool {
    if let Some(core_error) = error.downcast_ref::<CoreError>() {
        return matches!(
            core_error,
            CoreError::Auth {
                code: AuthErrorCode::ReauthRequired,
                ..
            }
        );
    }
    false
}

fn manual_fallback_reason_from_error(error: &anyhow::Error) -> Option<&'static str> {
    let core = error.downcast_ref::<CoreError>()?;
    match core {
        CoreError::Auth { code, .. } => match code {
            AuthErrorCode::LoopbackUnavailable => Some("loopback_unavailable"),
            AuthErrorCode::LoopbackTimeout => Some("loopback_timeout"),
            AuthErrorCode::InvalidCallback => Some("invalid_callback"),
            AuthErrorCode::StateMismatch => Some("state_mismatch"),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    use super::*;

    fn test_settings() -> RuntimeSettings {
        RuntimeSettings {
            google_client_id: "test-client".to_string(),
            google_client_secret: Some("test-secret".to_string()),
            tesseract_path: "tesseract".to_string(),
            max_concurrent_requests: 10,
            spreadsheet_batch_size: 100,
            max_retries: 3,
            retry_delay_seconds: 1.0,
            job_retention_hours: 24,
        }
    }

    #[test]
    fn parse_callback_url_extracts_code() {
        let code = parse_callback_url_or_code(
            "http://127.0.0.1:1234/callback/?code=abc123&state=xyz",
            "xyz",
        )
        .unwrap();
        assert_eq!(code, "abc123");
    }

    #[test]
    fn parse_callback_raw_code_is_supported() {
        let code = parse_callback_url_or_code("raw-code-123", "ignored").unwrap();
        assert_eq!(code, "raw-code-123");
    }

    #[test]
    fn parse_callback_state_mismatch_is_rejected() {
        let err = parse_callback_url_or_code(
            "http://127.0.0.1:1234/callback/?code=abc123&state=bad",
            "good",
        )
        .unwrap_err();
        assert!(err.to_string().contains("state mismatch"));
    }

    #[tokio::test]
    async fn begin_manual_creates_session_with_ttl() {
        let service = GoogleAuthService::new(Client::new());
        let challenge = service
            .begin_manual_sign_in(&test_settings())
            .await
            .unwrap();
        assert!(!challenge.session_id.trim().is_empty());
        assert!(challenge.authorize_url.contains("accounts.google.com"));
        assert!(challenge.expires_at > Utc::now());
    }

    #[tokio::test]
    async fn complete_manual_rejects_expired_session() {
        let service = GoogleAuthService::new(Client::new());
        let mut session = service.create_manual_session(&test_settings()).unwrap();
        session.expires_at = Utc::now() - chrono::Duration::seconds(1);
        let session_id = session.session_id.clone();
        let mut sessions = service.manual_sessions.lock().await;
        sessions.insert(session_id.clone(), session);
        drop(sessions);

        let err = service
            .complete_manual_sign_in(
                &test_settings(),
                ManualAuthCompleteRequest {
                    session_id,
                    callback_url_or_code: "abc".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("expired"));
    }

    #[tokio::test]
    async fn refresh_invalid_grant_maps_to_reauth() {
        let server = Arc::new(MockAuthServer::start(vec![
            MockResponse::token_invalid_grant(),
        ]));
        let endpoints = AuthEndpoints {
            authorize: server.url("/authorize"),
            token: server.url("/token"),
            userinfo: server.url("/userinfo"),
        };
        let service = GoogleAuthService::with_endpoints(Client::new(), endpoints);

        let err = service
            .refresh_token(&test_settings(), "refresh")
            .await
            .unwrap_err();

        let core = err.downcast_ref::<CoreError>().unwrap();
        assert!(matches!(
            core,
            CoreError::Auth {
                code: AuthErrorCode::ReauthRequired,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn exchange_code_success_with_mock_http() {
        let server = Arc::new(MockAuthServer::start(vec![
            MockResponse::token_success(),
            MockResponse::userinfo_success(),
        ]));
        let endpoints = AuthEndpoints {
            authorize: server.url("/authorize"),
            token: server.url("/token"),
            userinfo: server.url("/userinfo"),
        };
        let service = GoogleAuthService::with_endpoints(Client::new(), endpoints);

        let token = service
            .exchange_authorization_code(
                &test_settings(),
                "code123",
                "verifier123",
                "http://127.0.0.1:5000/callback/",
                None,
            )
            .await
            .unwrap();

        assert_eq!(token.access_token, "access-token");
        assert_eq!(token.email.as_deref(), Some("dev@example.com"));
    }

    struct MockResponse {
        path: &'static str,
        status: u16,
        body: &'static str,
        content_type: &'static str,
    }

    impl MockResponse {
        fn token_invalid_grant() -> Self {
            Self {
                path: "/token",
                status: 400,
                body: r#"{"error":"invalid_grant"}"#,
                content_type: "application/json",
            }
        }

        fn token_success() -> Self {
            Self {
                path: "/token",
                status: 200,
                body: r#"{"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600}"#,
                content_type: "application/json",
            }
        }

        fn userinfo_success() -> Self {
            Self {
                path: "/userinfo",
                status: 200,
                body: r#"{"email":"dev@example.com"}"#,
                content_type: "application/json",
            }
        }
    }

    struct MockAuthServer {
        base_url: String,
        _thread_handle: thread::JoinHandle<()>,
    }

    impl MockAuthServer {
        fn start(responses: Vec<MockResponse>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            let base_url = format!("http://{}", addr);

            let handle = thread::spawn(move || {
                for response in responses {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut buffer = [0u8; 16_384];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    let path = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/");

                    assert!(
                        path.starts_with(response.path),
                        "expected path {}, got {}",
                        response.path,
                        path
                    );

                    let response_text = format!(
                        "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        response.status,
                        response.content_type,
                        response.body.len(),
                        response.body
                    );

                    let _ = stream.write_all(response_text.as_bytes());
                }
            });

            Self {
                base_url,
                _thread_handle: handle,
            }
        }

        fn url(&self, path: &str) -> String {
            format!("{}{}", self.base_url, path)
        }
    }
}
