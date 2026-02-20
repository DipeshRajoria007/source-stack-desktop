use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthErrorCode {
    MissingClientId,
    SignInRequired,
    ReauthRequired,
    ProviderError,
    LoopbackUnavailable,
    LoopbackTimeout,
    InvalidCallback,
    StateMismatch,
    ChallengeExpired,
    SessionNotFound,
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Google API request failed with status {status}: {body}")]
    GoogleApi { status: u16, body: String },
    #[error("Google OAuth is not configured in this app build. Contact Dipesh from engineering team.")]
    MissingGoogleClientId,
    #[error("{message}")]
    Auth {
        code: AuthErrorCode,
        message: String,
    },
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

    pub fn auth(code: AuthErrorCode, message: impl Into<String>) -> Self {
        Self::Auth {
            code,
            message: message.into(),
        }
    }
}
