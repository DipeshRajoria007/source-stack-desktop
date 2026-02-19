use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use anyhow::Context;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::distr::Alphanumeric;
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use super::errors::CoreError;
use super::models::{AuthStatus, RuntimeSettings};

const KEYRING_SERVICE: &str = "com.sourcestack.desktop.google";
const KEYRING_USERNAME: &str = "default";
const AUTH_AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const AUTH_TOKEN: &str = "https://oauth2.googleapis.com/token";
const USERINFO: &str = "https://www.googleapis.com/oauth2/v2/userinfo";

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

pub struct GoogleAuthService {
    client: Client,
}

impl GoogleAuthService {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn sign_in(&self, settings: &RuntimeSettings) -> anyhow::Result<AuthStatus> {
        self.validate_settings(settings)?;
        let token = self.authorize_interactive(settings, None).await?;
        self.save_token(&token)?;
        Ok(AuthStatus {
            signed_in: true,
            email: token.email,
            expires_at: Some(token.expires_at_utc),
        })
    }

    pub fn sign_out(&self) -> anyhow::Result<()> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)?;
        match entry.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.into()),
        }
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

    pub async fn get_access_token(&self, settings: &RuntimeSettings) -> anyhow::Result<String> {
        self.validate_settings(settings)?;

        if let Some(cached) = self.load_token()? {
            if !cached.is_expiring_within(Duration::from_secs(5 * 60)) {
                return Ok(cached.access_token);
            }

            if let Some(refresh_token) = cached.refresh_token.clone() {
                if let Ok(refreshed) = self.refresh_token(settings, &refresh_token).await {
                    self.save_token(&refreshed)?;
                    return Ok(refreshed.access_token);
                }
            }
        }

        let interactive = self.authorize_interactive(settings, None).await?;
        self.save_token(&interactive)?;
        Ok(interactive.access_token)
    }

    fn validate_settings(&self, settings: &RuntimeSettings) -> anyhow::Result<()> {
        if settings.google_client_id.trim().is_empty() {
            return Err(CoreError::MissingGoogleClientId.into());
        }

        Ok(())
    }

    fn load_token(&self) -> anyhow::Result<Option<GoogleTokenEnvelope>> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)?;
        let raw = match entry.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(err) => return Err(err.into()),
        };

        let token = serde_json::from_str::<GoogleTokenEnvelope>(&raw)?;
        Ok(Some(token))
    }

    fn save_token(&self, token: &GoogleTokenEnvelope) -> anyhow::Result<()> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)?;
        let json = serde_json::to_string(token)?;
        entry.set_password(&json)?;
        Ok(())
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

        if !settings.google_client_secret.trim().is_empty() {
            form.push(("client_secret", settings.google_client_secret.clone()));
        }

        let response = self.client.post(AUTH_TOKEN).form(&form).send().await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(CoreError::GoogleApi {
                status: status.as_u16(),
                body,
            }
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
        fallback_refresh_token: Option<String>,
    ) -> anyhow::Result<GoogleTokenEnvelope> {
        let state = Uuid::new_v4().to_string();
        let verifier = generate_code_verifier();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}/callback/");

        let auth_url = build_authorize_url(settings, &state, &challenge, &redirect_uri)?;
        open::that_detached(auth_url.as_str()).context("failed to open browser for Google auth")?;

        let callback =
            tokio::task::spawn_blocking(move || wait_for_oauth_callback(listener, port)).await??;

        if callback.state != state {
            return Err(anyhow::anyhow!("OAuth state mismatch"));
        }

        if callback.code.trim().is_empty() {
            return Err(anyhow::anyhow!("Authorization code not found in callback"));
        }

        let mut form = vec![
            ("client_id", settings.google_client_id.clone()),
            ("code", callback.code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code".to_string()),
            ("redirect_uri", redirect_uri),
        ];

        if !settings.google_client_secret.trim().is_empty() {
            form.push(("client_secret", settings.google_client_secret.clone()));
        }

        let response = self.client.post(AUTH_TOKEN).form(&form).send().await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(CoreError::GoogleApi {
                status: status.as_u16(),
                body,
            }
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
            .get(USERINFO)
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
}

fn build_authorize_url(
    settings: &RuntimeSettings,
    state: &str,
    challenge: &str,
    redirect_uri: &str,
) -> anyhow::Result<Url> {
    let scope = SCOPES.join(" ");
    let url = Url::parse_with_params(
        AUTH_AUTHORIZE,
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

struct OAuthCallback {
    code: String,
    state: String,
}

fn wait_for_oauth_callback(listener: TcpListener, port: u16) -> anyhow::Result<OAuthCallback> {
    let (mut stream, _) = listener
        .accept()
        .context("timed out waiting for OAuth callback")?;

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

    let parsed = Url::parse(&format!("http://127.0.0.1:{port}{path}"))?;
    let mut code = String::new();
    let mut state = String::new();

    for (k, v) in parsed.query_pairs() {
        if k == "code" {
            code = v.to_string();
        }
        if k == "state" {
            state = v.to_string();
        }
    }

    let html = "<html><body><h3>SourceStack authentication completed.</h3><p>You can close this window.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );

    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();

    Ok(OAuthCallback { code, state })
}
