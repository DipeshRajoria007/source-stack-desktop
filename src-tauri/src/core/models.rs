use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    pub google_client_id: String,
    pub google_client_secret: String,
    pub tesseract_path: String,
    pub max_concurrent_requests: usize,
    pub spreadsheet_batch_size: usize,
    pub max_retries: usize,
    pub retry_delay_seconds: f64,
    pub job_retention_hours: i64,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            google_client_id: String::new(),
            google_client_secret: String::new(),
            tesseract_path: "tesseract".to_string(),
            max_concurrent_requests: 10,
            spreadsheet_batch_size: 100,
            max_retries: 3,
            retry_delay_seconds: 1.0,
            job_retention_hours: 24,
        }
    }
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
