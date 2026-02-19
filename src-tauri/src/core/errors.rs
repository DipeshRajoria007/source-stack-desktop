use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Google API request failed with status {status}: {body}")]
    GoogleApi { status: u16, body: String },
    #[error("Google OAuth is not configured. Set client id first.")]
    MissingGoogleClientId,
    #[error("Job not found: {0}")]
    JobNotFound(String),
    #[error("Job {0} is not completed")]
    JobNotCompleted(String),
    #[error("Invalid request: {0}")]
    InvalidRequest(String),
}

impl CoreError {
    pub fn is_retryable(&self) -> bool {
        match self {
            CoreError::GoogleApi { status, .. } => *status == 429 || *status >= 500,
            _ => false,
        }
    }
}
