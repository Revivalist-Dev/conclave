//! Single WebSocket connection to the brAInstorm orchestrator (ws://127.0.0.1:4000/ws),
//! owned by the Tauri process. Pure transport: no protocol knowledge lives here.
//! All windows receive server traffic via the `orchestrator-message` event and send
//! payloads via the `ws_send` command. The supervisor reconnects automatically with
//! capped exponential backoff; `ws_reconnect` forces an immediate reconnect.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Notify};
use tokio::task::AbortHandle;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const ORCHESTRATOR_WS_URL: &str = "ws://127.0.0.1:4000/ws";
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(15);
/// Payloads sent while offline are queued (oldest dropped first) and flushed on reconnect.
const MAX_QUEUED: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WsStatus {
    Connected,
    Connecting,
    Disconnected,
}

pub struct OrchestratorWsState {
    status: Mutex<WsStatus>,
    sender: Mutex<Option<mpsc::UnboundedSender<Message>>>,
    queue: Mutex<Vec<String>>,
    /// Abort handle of the live connection's reader task; aborting it forces a reconnect.
    abort_handle: Mutex<Option<AbortHandle>>,
    reconnect: Notify,
}

impl OrchestratorWsState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(WsStatus::Disconnected),
            sender: Mutex::new(None),
            queue: Mutex::new(Vec::new()),
            abort_handle: Mutex::new(None),
            reconnect: Notify::new(),
        }
    }
}

fn set_status(app: &AppHandle, status: WsStatus) {
    let state = app.state::<OrchestratorWsState>();
    {
        let mut guard = state.status.lock().unwrap();
        if *guard == status {
            return;
        }
        *guard = status;
    }
    let _ = app.emit("orchestrator-status", status);
}

pub fn spawn_supervisor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = INITIAL_BACKOFF;
        loop {
            set_status(&app, WsStatus::Connecting);
            let started = Instant::now();
            if let Err(err) = run_connection(&app).await {
                println!("[OrchestratorWs] Connection ended: {}", err);
            }
            // A connection that lasted a while means the endpoint works; retry fast.
            if started.elapsed() > Duration::from_secs(30) {
                backoff = INITIAL_BACKOFF;
            }
            set_status(&app, WsStatus::Disconnected);

            let state = app.state::<OrchestratorWsState>();
            let reconnect = state.reconnect.notified();
            tokio::select! {
                _ = tokio::time::sleep(backoff) => {}
                _ = reconnect => {
                    // Manual reconnect request: skip the remaining backoff.
                    backoff = INITIAL_BACKOFF;
                }
            }
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
    });
}

async fn run_connection(app: &AppHandle) -> Result<(), String> {
    let (ws, _) = connect_async(ORCHESTRATOR_WS_URL)
        .await
        .map_err(|e| format!("connect to {} failed: {}", ORCHESTRATOR_WS_URL, e))?;
    println!("[OrchestratorWs] Connected to {}", ORCHESTRATOR_WS_URL);
    set_status(app, WsStatus::Connected);

    let (mut write, mut read) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    {
        // Flush anything queued while offline, oldest first. No handshakes here:
        // the JS side greets the server once the connected status reaches it.
        let state = app.state::<OrchestratorWsState>();
        let queued: Vec<String> = std::mem::take(&mut *state.queue.lock().unwrap());
        for text in queued {
            let _ = tx.send(Message::Text(text.into()));
        }
        *state.sender.lock().unwrap() = Some(tx.clone());
    }

    // Writer: drains the outbound channel. On a failed send it re-queues the text
    // payloads it never got to flush so they survive the reconnect. Fire-and-forget:
    // it terminates itself (send error -> re-queue, channel closed -> clean exit).
    let _writer = {
        let app = app.clone();
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if write.send(msg).await.is_err() {
                    break;
                }
            }
            let state = app.state::<OrchestratorWsState>();
            let mut leftovers: Vec<String> = Vec::new();
            while let Ok(msg) = rx.try_recv() {
                if let Message::Text(text) = msg {
                    leftovers.push(text.as_str().to_string());
                }
            }
            if !leftovers.is_empty() {
                let mut queue = state.queue.lock().unwrap();
                let mut combined = leftovers;
                combined.extend(queue.drain(..));
                combined.truncate(MAX_QUEUED);
                *queue = combined;
            }
        })
    };

    // Reader: emits every server message to all windows.
    let reader = {
        let app = app.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut result = Ok(());
            while let Some(item) = read.next().await {
                match item {
                    Ok(Message::Text(text)) => {
                        let payload = serde_json::from_str::<Value>(text.as_str())
                            .unwrap_or_else(|_| Value::String(text.as_str().to_string()));
                        let _ = app.emit("orchestrator-message", payload);
                    }
                    // tokio-tungstenite does not auto-reply to pings on a split sink.
                    Ok(Message::Ping(data)) => {
                        let _ = tx.send(Message::Pong(data));
                    }
                    Ok(Message::Close(_)) => {
                        result = Err("server closed the connection".to_string());
                        break;
                    }
                    Ok(_) => {}
                    Err(e) => {
                        result = Err(format!("read error: {}", e));
                        break;
                    }
                }
            }
            result
        })
    };

    // Save the abort handle so ws_reconnect can terminate the live reader at any time.
    let abort = reader.abort_handle();
    *app.state::<OrchestratorWsState>().abort_handle.lock().unwrap() = Some(abort);

    let result = match reader.await {
        Ok(inner) => inner,
        Err(_) => Err("reader task aborted (forced reconnect)".to_string()),
    };

    // Stop accepting sends on the dead channel; the writer terminates on its own
    // (send error -> re-queue leftovers, empty channel -> clean exit).
    *app.state::<OrchestratorWsState>().sender.lock().unwrap() = None;
    *app.state::<OrchestratorWsState>().abort_handle.lock().unwrap() = None;
    result
}

#[tauri::command]
pub fn ws_status(state: State<'_, OrchestratorWsState>) -> WsStatus {
    *state.status.lock().unwrap()
}

/// Send a payload to the orchestrator. Returns Ok(false) when the socket is
/// currently down; the payload is then queued and flushed on the next connect.
#[tauri::command]
pub fn ws_send(state: State<'_, OrchestratorWsState>, payload: Value) -> Result<bool, String> {
    let text = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let sender = state.sender.lock().unwrap().clone();
    if let Some(tx) = sender {
        tx.send(Message::Text(text.into()))
            .map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        let mut queue = state.queue.lock().unwrap();
        if queue.len() >= MAX_QUEUED {
            queue.remove(0);
        }
        queue.push(text);
        Ok(false)
    }
}

#[tauri::command]
pub fn ws_reconnect(state: State<'_, OrchestratorWsState>) {
    // Skip the backoff on the supervisor's next cycle...
    state.reconnect.notify_one();
    // ...and if a connection is currently live, force-drop it so the supervisor
    // reconnects immediately instead of waiting for the next failure.
    if let Some(abort) = state.abort_handle.lock().unwrap().take() {
        abort.abort();
    }
}
