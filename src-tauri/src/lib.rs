use rytm_builder::app::{
    catalog_dest, catalog_dump, compose_ui, import_library, list_library, reset_dest_base,
    save_export_as, set_baked_template, set_dest_base, ComposeResult, DestTemplate, ImportFile,
    ImportResult, LibraryState, UiComposeRequest,
};
use rytm_builder::catalog::Catalog;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;

#[tauri::command(rename_all = "camelCase")]
fn list_library_cmd() -> Result<LibraryState, String> {
    list_library()
}

#[tauri::command(rename_all = "camelCase")]
fn catalog_dest_cmd() -> Result<DestTemplate, String> {
    catalog_dest()
}

#[tauri::command(rename_all = "camelCase")]
fn catalog_dump_cmd(name: String) -> Result<Catalog, String> {
    catalog_dump(&name)
}

#[tauri::command(rename_all = "camelCase")]
fn import_library_cmd(files: Vec<ImportFile>) -> Result<ImportResult, String> {
    import_library(files)
}

#[tauri::command(rename_all = "camelCase")]
fn set_dest_base_cmd(file: ImportFile) -> Result<DestTemplate, String> {
    set_dest_base(file)
}

#[tauri::command(rename_all = "camelCase")]
fn reset_dest_base_cmd() -> Result<DestTemplate, String> {
    reset_dest_base()
}

#[tauri::command(rename_all = "camelCase")]
fn compose_export_cmd(request: UiComposeRequest) -> Result<ComposeResult, String> {
    compose_ui(request)
}

#[tauri::command(rename_all = "camelCase")]
fn save_export_as_cmd(source_name: String, dest: String) -> Result<String, String> {
    save_export_as(&source_name, &dest)
}

fn resolve_baked_template(app: &tauri::App) -> PathBuf {
    if let Ok(p) = app
        .path()
        .resolve("Untitled-4.syx", BaseDirectory::Resource)
    {
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web/templates/Untitled-4.syx")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            set_baked_template(resolve_baked_template(app));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_library_cmd,
            catalog_dest_cmd,
            catalog_dump_cmd,
            import_library_cmd,
            set_dest_base_cmd,
            reset_dest_base_cmd,
            compose_export_cmd,
            save_export_as_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error running rytm-builder");
}
