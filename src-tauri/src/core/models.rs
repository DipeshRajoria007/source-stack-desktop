use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCandidate {
    pub drive_file_id: Option<String>,
    pub source_file: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub linked_in: Option<String>,
    pub git_hub: Option<String>,
    pub confidence: f64,
    #[serde(default)]
    pub errors: Vec<String>,
}

impl ParsedCandidate {
    pub fn empty(
        source_file: Option<String>,
        drive_file_id: Option<String>,
        errors: Vec<String>,
    ) -> Self {
        Self {
            drive_file_id,
            source_file,
            name: None,
            email: None,
            phone: None,
            linked_in: None,
            git_hub: None,
            confidence: 0.0,
            errors,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchParseRequest {
    pub folder_id: String,
    pub spreadsheet_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileRef {
    pub id: String,
    pub name: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobProcessingState {
    Pending,
    Processing,
    Completed,
    Failed,
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    pub job_id: String,
    pub status: JobProcessingState,
    pub progress: i32,
    pub total_files: i32,
    pub processed_files: i32,
    pub spreadsheet_id: Option<String>,
    pub results_count: Option<i32>,
    pub error: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct RuntimeSettings {
    pub google_client_id: String,
    pub google_client_secret: Option<String>,
    pub tesseract_path: String,
    pub max_concurrent_requests: usize,
    pub spreadsheet_batch_size: usize,
    pub max_retries: usize,
    pub retry_delay_seconds: f64,
    pub job_retention_hours: i64,
}

impl RuntimeSettings {
    pub fn to_persisted(&self) -> PersistedSettings {
        PersistedSettings {
            google_client_id: self.google_client_id.clone(),
            tesseract_path: self.tesseract_path.clone(),
            max_concurrent_requests: self.max_concurrent_requests,
            spreadsheet_batch_size: self.spreadsheet_batch_size,
            max_retries: self.max_retries,
            retry_delay_seconds: self.retry_delay_seconds,
            job_retention_hours: self.job_retention_hours,
        }
    }

    pub fn from_parts(persisted: PersistedSettings, google_client_secret: Option<String>) -> Self {
        Self {
            google_client_id: persisted.google_client_id,
            google_client_secret: google_client_secret.filter(|v| !v.trim().is_empty()),
            tesseract_path: persisted.tesseract_path,
            max_concurrent_requests: persisted.max_concurrent_requests,
            spreadsheet_batch_size: persisted.spreadsheet_batch_size,
            max_retries: persisted.max_retries,
            retry_delay_seconds: persisted.retry_delay_seconds,
            job_retention_hours: persisted.job_retention_hours,
        }
    }

    pub fn to_view(&self, legacy_secret_scrubbed: bool) -> RuntimeSettingsView {
        RuntimeSettingsView {
            google_client_id: self.google_client_id.clone(),
            google_client_secret_configured: self
                .google_client_secret
                .as_deref()
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false),
            legacy_secret_scrubbed,
            tesseract_path: self.tesseract_path.clone(),
            max_concurrent_requests: self.max_concurrent_requests,
            spreadsheet_batch_size: self.spreadsheet_batch_size,
            max_retries: self.max_retries,
            retry_delay_seconds: self.retry_delay_seconds,
            job_retention_hours: self.job_retention_hours,
        }
    }
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self::from_parts(PersistedSettings::default(), None)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSettings {
    #[serde(default = "default_google_client_id")]
    pub google_client_id: String,
    #[serde(default = "default_tesseract_path")]
    pub tesseract_path: String,
    #[serde(default = "default_max_concurrent_requests")]
    pub max_concurrent_requests: usize,
    #[serde(default = "default_spreadsheet_batch_size")]
    pub spreadsheet_batch_size: usize,
    #[serde(default = "default_max_retries")]
    pub max_retries: usize,
    #[serde(default = "default_retry_delay_seconds")]
    pub retry_delay_seconds: f64,
    #[serde(default = "default_job_retention_hours")]
    pub job_retention_hours: i64,
}

impl PersistedSettings {
    pub fn sanitized(mut self) -> Self {
        if self.google_client_id.trim().is_empty() {
            self.google_client_id = default_google_client_id();
        }
        self.max_concurrent_requests = self.max_concurrent_requests.max(1);
        self.spreadsheet_batch_size = self.spreadsheet_batch_size.max(1);
        self.max_retries = self.max_retries.max(1);
        self.retry_delay_seconds = self.retry_delay_seconds.max(0.1);
        self.job_retention_hours = self.job_retention_hours.max(1);
        if self.tesseract_path.trim().is_empty() {
            self.tesseract_path = default_tesseract_path();
        }
        self
    }
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            google_client_id: default_google_client_id(),
            tesseract_path: default_tesseract_path(),
            max_concurrent_requests: default_max_concurrent_requests(),
            spreadsheet_batch_size: default_spreadsheet_batch_size(),
            max_retries: default_max_retries(),
            retry_delay_seconds: default_retry_delay_seconds(),
            job_retention_hours: default_job_retention_hours(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettingsView {
    pub google_client_id: String,
    pub google_client_secret_configured: bool,
    pub legacy_secret_scrubbed: bool,
    pub tesseract_path: String,
    pub max_concurrent_requests: usize,
    pub spreadsheet_batch_size: usize,
    pub max_retries: usize,
    pub retry_delay_seconds: f64,
    pub job_retention_hours: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettingsUpdate {
    #[serde(default)]
    pub google_client_id: Option<String>,
    #[serde(default)]
    pub google_client_secret: Option<String>,
    pub tesseract_path: String,
    pub max_concurrent_requests: usize,
    pub spreadsheet_batch_size: usize,
    pub max_retries: usize,
    pub retry_delay_seconds: f64,
    pub job_retention_hours: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeExtractionResult {
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub linked_in: Option<String>,
    pub git_hub: Option<String>,
    pub confidence: f64,
    pub ocr_used: bool,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOk {
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartJobResponse {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum GoogleSignInResult {
    #[serde(rename = "signed_in")]
    SignedIn { status: AuthStatus },
    #[serde(rename = "manual_required")]
    ManualRequired { reason: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualAuthChallenge {
    pub session_id: String,
    pub authorize_url: String,
    pub redirect_uri: String,
    pub expires_at: DateTime<Utc>,
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualAuthCompleteRequest {
    pub session_id: String,
    pub callback_url_or_code: String,
}

fn default_tesseract_path() -> String {
    "tesseract".to_string()
}

fn default_google_client_id() -> String {
    resolve_env_value("SOURCESTACK_GOOGLE_CLIENT_ID")
        .or_else(|| resolve_env_value("GOOGLE_CLIENT_ID"))
        .unwrap_or_default()
}

pub fn default_google_client_secret() -> Option<String> {
    resolve_env_value("SOURCESTACK_GOOGLE_CLIENT_SECRET")
        .or_else(|| resolve_env_value("GOOGLE_CLIENT_SECRET"))
}

pub(crate) fn resolve_env_value(key: &str) -> Option<String> {
    let build_time = match key {
        "SOURCESTACK_GOOGLE_CLIENT_ID" => option_env!("SOURCESTACK_GOOGLE_CLIENT_ID"),
        "GOOGLE_CLIENT_ID" => option_env!("GOOGLE_CLIENT_ID"),
        "SOURCESTACK_GOOGLE_CLIENT_SECRET" => option_env!("SOURCESTACK_GOOGLE_CLIENT_SECRET"),
        "GOOGLE_CLIENT_SECRET" => option_env!("GOOGLE_CLIENT_SECRET"),
        _ => None,
    };

    if let Some(value) = build_time {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| resolve_env_from_files(key))
}

fn resolve_env_from_files(key: &str) -> Option<String> {
    for file in candidate_env_files() {
        if let Some(value) = read_env_value_from_file(&file, key) {
            return Some(value);
        }
    }
    None
}

fn candidate_env_files() -> Vec<PathBuf> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut roots = Vec::new();
    roots.push(cwd.clone());
    roots.extend(cwd.ancestors().map(Path::to_path_buf));

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        for candidate in [
            root.join(".env.local"),
            root.join(".env"),
            root.join("source-stack-web/.env.local"),
            root.join("source-stack-web/.env"),
            root.join("source-stack-api/.env.local"),
            root.join("source-stack-api/.env"),
        ] {
            if seen.insert(candidate.clone()) {
                out.push(candidate);
            }
        }
    }

    out
}

fn read_env_value_from_file(path: &Path, key: &str) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        let (k, v) = line.split_once('=')?;
        if k.trim() != key {
            continue;
        }

        let value = v.trim().trim_matches('"').trim_matches('\'').to_string();
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

fn default_max_concurrent_requests() -> usize {
    10
}

fn default_spreadsheet_batch_size() -> usize {
    100
}

fn default_max_retries() -> usize {
    3
}

fn default_retry_delay_seconds() -> f64 {
    1.0
}

fn default_job_retention_hours() -> i64 {
    24
}
