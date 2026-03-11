// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match source_stack_desktop_tauri_lib::try_run_internal_command() {
        Ok(true) => return,
        Ok(false) => {}
        Err(err) => {
            eprintln!("internal command failed: {err}");
            std::process::exit(1);
        }
    }

    source_stack_desktop_tauri_lib::run()
}
