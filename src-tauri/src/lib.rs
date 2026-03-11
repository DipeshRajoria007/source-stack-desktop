pub mod core;

use tauri::Manager;

use core::commands::{
    cancel_job, get_drive_folder_path, get_job_results, get_job_status, get_settings,
    google_auth_begin_manual, google_auth_complete_manual, google_auth_sign_in,
    google_auth_sign_out, google_auth_status, kill_job, list_drive_files, list_drive_folders,
    list_jobs, parse_single, save_settings, start_batch_job, AppState,
};
use core::service::CoreService;

pub fn try_run_internal_command() -> anyhow::Result<bool> {
    core::pdf::maybe_run_pdf_extract_helper_from_args()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let core = tauri::async_runtime::block_on(CoreService::new())
                .map_err(|err| format!("failed to initialize core service: {err}"))?;

            app.manage(AppState { core });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            parse_single,
            start_batch_job,
            get_job_status,
            get_job_results,
            list_jobs,
            cancel_job,
            kill_job,
            google_auth_sign_in,
            google_auth_begin_manual,
            google_auth_complete_manual,
            google_auth_sign_out,
            google_auth_status,
            list_drive_folders,
            list_drive_files,
            get_drive_folder_path,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
