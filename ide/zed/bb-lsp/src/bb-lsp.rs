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
//
// API target: zed_extension_api 0.6 (the version this manifest declares, and
// the version the crate resolves; 0.7.0's WIT is the since_v0.6.0 set, so it
// offers nothing this shim needs). Three call sites in the previous revision
// were written against an API surface that has never shipped in any published
// version (0.0.1 … 0.7.0 all checked):
//
//   * `LanguageServerInstallationStatus::Resolved` — no such variant has ever
//     existed. Since v0.0.4 the variant set is exactly
//     `none | downloading | checking-for-update | failed(string)`.
//     Resolution in this API generation IS the return of `Ok(Command)` from
//     `language_server_command`; there is no `Resolved` status to publish.
//   * `zed_extension_api::Zed` — no such type exists; the API is a module
//     re-exported as `zed`, and `set_language_server_installation_status` is a
//     free function taking a `&LanguageServerId`.
//   * `LanguageServerId(..)` construction — the tuple field is private in
//     every published version. The only `LanguageServerId` a shim ever holds
//     is the one Zed passes to `language_server_command`.
//
// So the shim publishes a status only where the API has something to say: on
// the declared-error path, where `Failed(reason)` gives Zed's status surface
// the reason instead of silence.

use zed_extension_api as zed;
use zed::{
    settings::LspSettings, Command, LanguageServerId, LanguageServerInstallationStatus,
    Result as ZedResult, Worktree,
};

const SERVER_ID: &str = "bb-lsp";

struct BbLspExtension;

impl zed::Extension for BbLspExtension {
    fn new() -> Self {
        BbLspExtension
    }

    fn language_server_command(
        &mut self,
        server: &LanguageServerId,
        worktree: &Worktree,
    ) -> ZedResult<Command> {
        // 1. Owner override via Zed's own lsp settings.
        if let Ok(settings) = LspSettings::for_worktree(SERVER_ID, worktree) {
            if let Some(binary) = settings.binary {
                if let Some(path) = binary.path {
                    return Ok(Command {
                        command: path,
                        args: binary.arguments.unwrap_or_default(),
                        // CommandSettings::env is a HashMap; Command::env is the
                        // WIT `env-vars` list. Sorted so the spawned server sees
                        // a deterministic environment regardless of hash order.
                        env: binary
                            .env
                            .map(|vars| {
                                let mut pairs: Vec<(String, String)> = vars.into_iter().collect();
                                pairs.sort();
                                pairs
                            })
                            .unwrap_or_default(),
                    });
                }
            }
        }

        // 2. A backbencher-brain checkout's compiled dist, launched with node.
        //    Existence is probed through Zed's own host filesystem view of the
        //    worktree (`read_text_file` returns Err for a missing file) rather
        //    than `std::fs::metadata`: a wasm guest only sees directories Zed
        //    explicitly preopened, and no preopen contract for the worktree is
        //    declared by the API — a std::fs probe could therefore fail
        //    silently and drop this resolution step to the PATH branch.
        let dist_rel = "dist/lsp/server.js";
        if worktree.read_text_file(dist_rel).is_ok() {
            return Ok(Command {
                command: "node".to_string(),
                args: vec![
                    format!("{}/{}", worktree.root_path(), dist_rel),
                    "--dir".to_string(),
                    worktree.root_path(),
                ],
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

        // 4. Loud declared error — never a silent fallback. Also published as
        //    the API's `Failed` installation status so Zed's own status surface
        //    carries the reason.
        let reason = format!(
            "bb_lsp: no server found. Looked for lsp.bb-lsp.binary.path, {}/dist/lsp/server.js, and bb-lsp on PATH. Install backbencher-brain or set the binary path in Zed settings.",
            worktree.root_path()
        );
        zed::set_language_server_installation_status(
            server,
            &LanguageServerInstallationStatus::Failed(reason.clone()),
        );
        Err(reason)
    }
}

zed::register_extension!(BbLspExtension);
