use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use tauri::State;

use super::models::{
    AuthStatus, BatchParseRequest, CommandOk, GoogleSignInResult, JobStatus, ManualAuthChallenge,
    ManualAuthCompleteRequest, ParsedCandidate, RuntimeSettingsUpdate, RuntimeSettingsView,
    StartJobResponse,
};
use super::service::CoreService;

pub struct AppState {
    pub core: Arc<CoreService>,
}

#[tauri::command]
pub async fn parse_single(
    state: State<'_, AppState>,
    file_name: String,
    file_bytes_base64: String,
) -> Result<ParsedCandidate, String> {
    let bytes = STANDARD
        .decode(file_bytes_base64.as_bytes())
        .map_err(|err| format!("invalid base64 input: {err}"))?;

    state
        .core
        .parse_single(file_name, bytes)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn start_batch_job(
    state: State<'_, AppState>,
    request: BatchParseRequest,
) -> Result<StartJobResponse, String> {
    let job_id = state
        .core
        .start_batch_job(request)
        .await
        .map_err(|err| err.to_string())?;

    Ok(StartJobResponse { job_id })
}

#[tauri::command]
pub async fn get_job_status(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<JobStatus, String> {
    state
        .core
        .get_job_status(&job_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_job_results(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<Vec<ParsedCandidate>, String> {
    state
        .core
        .get_job_results(&job_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_jobs(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state.core.list_jobs().await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<CommandOk, String> {
    let ok = state
        .core
        .cancel_job(&job_id)
        .await
        .map_err(|err| err.to_string())?;

    Ok(CommandOk { ok })
}

#[tauri::command]
pub async fn google_auth_sign_in(state: State<'_, AppState>) -> Result<GoogleSignInResult, String> {
    state
        .core
        .google_auth_sign_in()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn google_auth_begin_manual(
    state: State<'_, AppState>,
) -> Result<ManualAuthChallenge, String> {
    state
        .core
        .google_auth_begin_manual()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn google_auth_complete_manual(
    state: State<'_, AppState>,
    request: ManualAuthCompleteRequest,
) -> Result<AuthStatus, String> {
    state
        .core
        .google_auth_complete_manual(request)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn google_auth_sign_out(state: State<'_, AppState>) -> Result<CommandOk, String> {
    state
        .core
        .google_auth_sign_out()
        .map_err(|err| err.to_string())?;

    Ok(CommandOk { ok: true })
}

#[tauri::command]
pub fn google_auth_status(state: State<'_, AppState>) -> Result<AuthStatus, String> {
    state
        .core
        .google_auth_status()
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<RuntimeSettingsView, String> {
    Ok(state.core.get_settings().await)
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: RuntimeSettingsUpdate,
) -> Result<RuntimeSettingsView, String> {
    state
        .core
        .save_settings(settings)
        .await
        .map_err(|err| err.to_string())
}
