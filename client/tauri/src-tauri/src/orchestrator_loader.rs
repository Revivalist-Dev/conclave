//! Side-loads the brAInstorm orchestrator so it boots with the app.
//! Production (bundled app): expects the bun-compiled sidecar next to the
//! executable; its database/attachments go to the OS app-data dir.
//! Dev (`tauri dev`): spawns `bun src/index.ts` from the orchestrator sources,
//! same as running it by hand.
//! If something already listens on the port (e.g. started manually), it is
//! reused and left alone; only a process WE spawned is killed on app exit.

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const ORCHESTRATOR_PORT: u16 = 4000;

/// Handle to the orchestrator child process, if WE spawned it.
pub struct OrchestratorProcess(pub Mutex<Option<Child>>);

fn port_is_open(port: u16) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{}", port)
        .parse()
        .expect("static socket address");
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// The bundled sidecar next to our executable. build.rs exports the
/// triple-qualified name Tauri's externalBin staging uses.
fn sidecar_path() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let mut candidates = vec![dir.join(env!("ORCHESTRATOR_SIDECAR"))];
    if cfg!(windows) {
        candidates.push(dir.join(format!("{}.exe", env!("ORCHESTRATOR_SIDECAR"))));
    }
    candidates
        .into_iter()
        .find(|p| p.exists())
        .and_then(|p| p.canonicalize().ok())
}

/// Dev fallback: locate the orchestrator sources to run with bun.
fn find_orchestrator_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = std::env::var("BRAINSTORM_ORCHESTRATOR_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(cwd) = std::env::current_dir() {
        // cargo/tauri dev runs from src-tauri; also cover repo-root CWDs.
        candidates.push(cwd.join("../../../orchestrator"));
        candidates.push(cwd.join("../../orchestrator"));
        candidates.push(cwd.join("orchestrator"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("../../../orchestrator"));
        }
    }

    candidates
        .into_iter()
        .find(|dir| dir.join("package.json").exists() && dir.join("src/index.ts").exists())
        .and_then(|dir| dir.canonicalize().ok())
}

fn spawn_child(mut cmd: Command, label: &str, app: &AppHandle, use_app_data_dir: bool) {
    if use_app_data_dir {
        if let Ok(data_dir) = app.path().app_data_dir() {
            match std::fs::create_dir_all(&data_dir) {
                Ok(()) => {
                    cmd.env("BRAINSTORM_DATA_DIR", &data_dir);
                }
                Err(e) => eprintln!(
                    "[OrchestratorLoader] Could not create data dir {}: {}",
                    data_dir.display(),
                    e
                ),
            }
        }
    }
    match cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit()).spawn() {
        Ok(child) => {
            println!("[OrchestratorLoader] Spawned {} (pid {})", label, child.id());
            let state = app.state::<OrchestratorProcess>();
            *state.0.lock().unwrap() = Some(child);
        }
        Err(e) => {
            eprintln!(
                "[OrchestratorLoader] Failed to spawn {}: {} (the app continues and \
                 retries the connection)",
                label, e
            );
        }
    }
}

/// Spawn the orchestrator unless one is already listening on the port.
pub fn spawn_orchestrator(app: &AppHandle) {
    if port_is_open(ORCHESTRATOR_PORT) {
        println!(
            "[OrchestratorLoader] Already running on 127.0.0.1:{}, reusing it",
            ORCHESTRATOR_PORT
        );
        return;
    }

    // tauri-build sets the `dev` cfg for `tauri dev` runs; bundled/release
    // builds are production and always use the sidecar.
    if cfg!(dev) {
        let Some(dir) = find_orchestrator_dir() else {
            eprintln!(
                "[OrchestratorLoader] Dev mode: orchestrator sources not found \
                 (set BRAINSTORM_ORCHESTRATOR_DIR); continuing without it"
            );
            return;
        };
        let mut cmd = Command::new("bun");
        cmd.arg("src/index.ts").current_dir(&dir);
        spawn_child(cmd, &format!("bun from {}", dir.display()), app, false);
    } else {
        let Some(path) = sidecar_path() else {
            eprintln!(
                "[OrchestratorLoader] Sidecar {} not found next to the executable",
                env!("ORCHESTRATOR_SIDECAR")
            );
            return;
        };
        let cmd = Command::new(&path);
        spawn_child(cmd, &format!("sidecar {}", path.display()), app, true);
    }
}

/// Terminate the orchestrator on app exit — but only if we spawned it.
pub fn kill_orchestrator(app: &AppHandle) {
    let state = app.state::<OrchestratorProcess>();
    let child = state.0.lock().unwrap().take();
    if let Some(mut child) = child {
        println!("[OrchestratorLoader] Stopping orchestrator (pid {}) on exit", child.id());
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(child.id() as i32, libc::SIGTERM);
            }
            // Give the orchestrator up to 500ms to shut down gracefully
            for _ in 0..10 {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}
