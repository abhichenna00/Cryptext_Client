use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => Ok(Some(update.version.clone())),
        Ok(None) => Ok(None),
        Err(e) => {
            eprintln!("Update check failed: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    if let Ok(Some(update)) = updater.check().await {
        update
            .download_and_install(|progress, total| {
                use tauri::Emitter;
                let _ = app.emit("update-progress", serde_json::json!({
                    "downloaded": progress,
                    "total": total
                }));
            }, || {})
            .await
            .map_err(|e| format!("Update failed: {}", e))?;

        app.restart();
    }

    Ok(())
}