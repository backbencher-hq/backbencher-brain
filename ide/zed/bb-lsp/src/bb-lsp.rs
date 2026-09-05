// bb_lsp Zed extension shim — M27.Z1 (decision D-2: binary resolution ONLY).
//
// All intelligence lives in bb_lsp. This shim resolves the server binary and
// nothing else. Declared resolution order (mirrors the VS Code extension's
// order; unit-mirrored and drift-gated by script/m27/verify-zed.ts):
//
//   1. lsp.bb-lsp.binary.path user setting (owner override)
//   2. <worktree root>/dist/lsp/server.js (backbencher-brain checkout dist),
//      launched with node
//   3. "bb-lsp" on PATH
//   4. loud declared error — never a silent fallback

use serde_json::Value;
use zed_extension_api::{
    settings::LspSettings, Command, LanguageServerId, LanguageServerInstallationStatus,
    Result as ZedResult, Worktree, Zed,
};

const SERVER_ID: &str = "bb-lsp";

struct BbLspExtension;

impl zed_extension_api::Extension for BbLspExtension {
    fn new() -> Self {
        BbLspExtension
    }

    fn language_server_command(
        &mut self,
        _server: &LanguageServerId,
        worktree: &Worktree,
    ) -> ZedResult<Command> {
        set_status(LanguageServerInstallationStatus::Resolved);

        // 1. Owner override via Zed's own lsp settings.
        if let Ok(settings) = LspSettings::for_worktree(SERVER_ID, worktree) {
            if let Some(binary) = settings.binary {
                if let Some(path) = binary.path {
                    return Ok(Command {
                        command: path,
                        args: binary.arguments.unwrap_or_default(),
                        env: binary.env.unwrap_or_default(),
                    });
                }
            }
        }

        // 2. A backbencher-brain checkout's compiled dist, launched with node.
        let dist = format!("{}/dist/lsp/server.js", worktree.root_path());
        if fs_exists(&dist) {
            return Ok(Command {
                command: "node".to_string(),
                args: vec![dist, "--dir".to_string(), worktree.root_path()],
                env: Default::default(),
            });
        }

        // 3. bb-lsp on PATH.
        if let Some(path) = worktree.which(SERVER_ID) {
            return Ok(Command {
                command: path,
                args: vec!["--dir".to_string(), worktree.root_path()],
                env: Default::default(),
            });
        }

        // 4. Loud declared error — never a silent fallback.
        Err(format!(
            "bb_lsp: no server found. Looked for lsp.bb-lsp.binary.path, {}/dist/lsp/server.js, and bb-lsp on PATH. Install backbencher-brain or set the binary path in Zed settings.",
            worktree.root_path()
        ))
    }
}

fn set_status(status: LanguageServerInstallationStatus) {
    let _ = Zed::set_language_server_installation_status(&LanguageServerId(SERVER_ID.to_string()), status);
}

/// Minimal fs probe (wasm targets std's metadata via wasi).
fn fs_exists(path: &str) -> bool {
    std::fs::metadata(path).is_ok()
}

zed::register_extension!(BbLspExtension);
