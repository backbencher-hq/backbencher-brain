# bb_lsp for Zed (M27.Z1)

A minimal Zed extension: `extension.toml` + two language configs + a **thin
wasm shim that owns binary resolution only** (decision D-2). All intelligence
lives in bb_lsp.

## Resolution order (declared — mirrors the VS Code extension's order)

1. `lsp.<server-id>.binary.path` user setting (owner override; Zed's own
   override mechanism, read via `LspSettings`).
2. `BB_LSP_ROOT/dist/lsp/server.js` or `<worktree>/dist/lsp/server.js` —
   a backbencher-brain checkout's compiled dist, launched with `node`.
3. `bb-lsp` on PATH.
4. Loud declared error — never a silent fallback to something else.

## Install (dev)

```sh
zed --install-extension /path/to/backbencher-brain/ide/zed/bb-lsp
# or: cp -r ide/zed/bb-lsp ~/.local/share/zed/extensions/installed/bb-lsp
```

Set the binary in Zed settings if the server is not discoverable:

```json
{
  "lsp": {
    "bb-lsp": {
      "binary": { "path": "/opt/backbencher-brain/dist/lsp/server.js", "arguments": ["--dir", "$ZED_WORKTREE_ROOT"] }
    }
  }
}
```

## What works in Zed (honest surface)

Tiered hover, definition, references, document/workspace symbols, call
hierarchy, and the private `bb/staleness` request.

**Not in Zed (v3 scope)**: the graph webview — a VS Code panel (M26, D-6).
The capability matrix records this delta per editor.

## Verification status

`npx tsx script/m27/verify-zed.ts` proves: manifest schema, shim resolution
logic unit-proven (override / dist / PATH / declared-error paths), extension
packaging sanity, and the method surface against the **real server's
advertised capabilities** (wire read). An editor-session leg is attempted and
honestly classified on this machine. Evidence:
`validation/m27/results/Z1.json`.
