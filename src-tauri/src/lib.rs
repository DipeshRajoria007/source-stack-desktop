pub mod core;

use tauri::Manager;

use core::commands::{
    cancel_job, get_job_results, get_job_status, get_settings, google_auth_begin_manual,
    google_auth_complete_manual, google_auth_sign_in, google_auth_sign_out, google_auth_status,
    list_jobs, parse_single, save_settings, start_batch_job, AppState,
};
use core::service::CoreService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            google_auth_sign_in,
            google_auth_begin_manual,
            google_auth_complete_manual,
            google_auth_sign_out,
            google_auth_status,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
