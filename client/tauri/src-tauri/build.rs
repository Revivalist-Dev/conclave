fn main() {
    // Name Tauri's externalBin sidecar for the current target so the loader can
    // find it next to the executable at runtime (dev and bundled both).
    let triple = std::env::var("TARGET").unwrap_or_else(|_| "unknown".into());
    println!("cargo:rustc-env=ORCHESTRATOR_SIDECAR=orchestrator-{}", triple);
    println!("cargo:rerun-if-changed=binaries");
    tauri_build::build()
}
