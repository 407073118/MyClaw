#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime_supervisor;

fn main() {
    let runtime = runtime_supervisor::start_runtime_sidecar()
        .expect("failed to start local runtime sidecar");

    let run_result = tauri::Builder::default().run(tauri::generate_context!());
    runtime_supervisor::stop_runtime_sidecar(runtime);
    run_result.expect("error while running tauri application");
}
