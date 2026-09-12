use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowBounds {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppWindowState {
    pub mode: String, // "normal" | "minimalist"
    pub normal: WindowBounds,
    pub minimalist: WindowBounds,
}

impl Default for AppWindowState {
    fn default() -> Self {
        Self {
            mode: "normal".to_string(),
            normal: WindowBounds {
                width: 1240.0,
                height: 820.0,
                x: Some(100.0),
                y: Some(100.0),
            },
            minimalist: WindowBounds {
                width: 260.0,
                height: 80.0,
                x: Some(24.0),
                y: Some(120.0),
            },
        }
    }
}

fn get_config_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    if let Ok(home) = app.path().home_dir() {
        return home.join(".brainstorm.json");
    }
    PathBuf::from(".brainstorm.json")
}

#[tauri::command]
fn get_window_state(app: tauri::AppHandle) -> Result<AppWindowState, String> {
    let path = get_config_path(&app);
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<AppWindowState>(&content) {
                return Ok(state);
            }
        }
    }
    Ok(AppWindowState::default())
}

#[tauri::command]
fn save_window_state(app: tauri::AppHandle, state: AppWindowState) -> Result<(), String> {
    let path = get_config_path(&app);
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn enter_overlay_mode(app: tauri::AppHandle) -> Result<AppWindowState, String> {
    let mut state = get_window_state(app.clone()).unwrap_or_default();

    // 1. Capture current main window position & size, then hide it
    if let Some(main_win) = app.get_webview_window("main") {
        let scale = main_win.scale_factor().unwrap_or(1.0);
        if let (Ok(phys_pos), Ok(phys_size)) = (main_win.outer_position(), main_win.outer_size()) {
            let logical_w = phys_size.width as f64 / scale;
            let logical_h = phys_size.height as f64 / scale;
            if logical_w > 500.0 {
                state.normal = WindowBounds {
                    width: logical_w,
                    height: logical_h,
                    x: Some(phys_pos.x as f64 / scale),
                    y: Some(phys_pos.y as f64 / scale),
                };
            }
        }
        let _ = main_win.hide();
    }

    state.mode = "minimalist".to_string();

    // 2. Show overlay window at last saved or default minimalist position
    if let Some(overlay_win) = app.get_webview_window("overlay") {
        let target = &state.minimalist;
        let safe_w = if target.width >= 200.0 { target.width } else { 260.0 };
        let safe_h = if target.height >= 56.0 { target.height } else { 76.0 };
        let _ = overlay_win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(safe_w, safe_h)));
        if let (Some(x), Some(y)) = (target.x, target.y) {
            let _ = overlay_win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        }
        let _ = overlay_win.set_always_on_top(true);
        let _ = overlay_win.show();
        let _ = overlay_win.set_focus();
    }

    // 3. Save state
    save_window_state(app, state.clone())?;
    Ok(state)
}

#[tauri::command]
fn exit_overlay_mode(app: tauri::AppHandle) -> Result<AppWindowState, String> {
    let mut state = get_window_state(app.clone()).unwrap_or_default();

    // 1. Capture current overlay position & size before hiding it
    if let Some(overlay_win) = app.get_webview_window("overlay") {
        let scale = overlay_win.scale_factor().unwrap_or(1.0);
        if let (Ok(phys_pos), Ok(phys_size)) = (overlay_win.outer_position(), overlay_win.outer_size()) {
            state.minimalist = WindowBounds {
                width: phys_size.width as f64 / scale,
                height: phys_size.height as f64 / scale,
                x: Some(phys_pos.x as f64 / scale),
                y: Some(phys_pos.y as f64 / scale),
            };
        }
        let _ = overlay_win.hide();
    }

    state.mode = "normal".to_string();

    // 2. Restore main window position & size, then show it
    if let Some(main_win) = app.get_webview_window("main") {
        let target = &state.normal;
        let _ = main_win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(target.width, target.height)));
        if let (Some(x), Some(y)) = (target.x, target.y) {
            let _ = main_win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        }
        let _ = main_win.set_always_on_top(false);
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }

    // 3. Save state
    save_window_state(app, state.clone())?;
    Ok(state)
}

#[tauri::command]
fn sync_overlay_bounds(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    let mut state = get_window_state(app.clone()).unwrap_or_default();
    let scale = window.scale_factor().unwrap_or(1.0);
    if let (Ok(phys_pos), Ok(phys_size)) = (window.outer_position(), window.outer_size()) {
        if phys_size.width > 0 && phys_size.height > 0 {
            let bounds = WindowBounds {
                width: phys_size.width as f64 / scale,
                height: phys_size.height as f64 / scale,
                x: Some(phys_pos.x as f64 / scale),
                y: Some(phys_pos.y as f64 / scale),
            };
            if window.label() == "overlay" {
                let safe_w = if bounds.width >= 200.0 { bounds.width } else { 260.0 };
                let safe_h = if bounds.height >= 56.0 { bounds.height } else { 76.0 };
                state.minimalist = WindowBounds {
                    width: safe_w,
                    height: safe_h,
                    x: bounds.x,
                    y: bounds.y,
                };
            } else {
                state.normal = bounds;
            }
            save_window_state(app, state)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn set_window_always_on_top(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_always_on_top(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_overlay_size(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(overlay_win) = app.get_webview_window("overlay") {
        overlay_win
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = {
                let path = get_config_path(&app.handle());
                if path.exists() {
                    std::fs::read_to_string(&path)
                        .ok()
                        .and_then(|c| serde_json::from_str::<AppWindowState>(&c).ok())
                        .unwrap_or_default()
                } else {
                    AppWindowState::default()
                }
            };

            let main_win = app.get_webview_window("main");
            let overlay_win = app.get_webview_window("overlay");

            if state.mode == "minimalist" {
                // Overlay mode active: hide main window, show overlay window
                if let Some(main) = main_win {
                    let _ = main.hide();
                }
                if let Some(overlay) = overlay_win {
                    let target = &state.minimalist;
                    let safe_w = if target.width >= 200.0 { target.width } else { 260.0 };
                    let safe_h = if target.height >= 56.0 { target.height } else { 76.0 };
                    let _ = overlay.set_size(tauri::Size::Logical(tauri::LogicalSize::new(safe_w, safe_h)));
                    if let (Some(x), Some(y)) = (target.x, target.y) {
                        let _ = overlay.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                    }
                    let _ = overlay.set_always_on_top(true);
                    let _ = overlay.show();
                    let _ = overlay.set_focus();
                }
            } else {
                // Normal mode active: hide overlay window, show main window
                if let Some(overlay) = overlay_win {
                    let _ = overlay.hide();
                }
                if let Some(main) = main_win {
                    let target = &state.normal;
                    let _ = main.set_size(tauri::Size::Logical(tauri::LogicalSize::new(target.width, target.height)));
                    if let (Some(x), Some(y)) = (target.x, target.y) {
                        let _ = main.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                    }
                    let _ = main.set_always_on_top(false);
                    let _ = main.show();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_window_state,
            save_window_state,
            enter_overlay_mode,
            exit_overlay_mode,
            sync_overlay_bounds,
            set_window_always_on_top,
            set_overlay_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
