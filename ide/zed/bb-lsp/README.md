# bb_lsp for Zed (M27.Z1)

A minimal Zed extension: `extension.toml` + two language configs + a launcher
script. All intelligence lives in bb_lsp; the launcher resolves paths and exits
loudly rather than falling back to something else.

## Resolution order (declared — what `bin/bb-lsp-server` actually does)

1. **Server**: `dist/lsp/server.js` beside the extension, else
   `../../../dist/lsp/server.js` (a checkout's own compiled dist). If neither
   exists, a loud error on stderr and exit 1 — never a silent fallback.
2. **Node**: `node` on the PATH Zed sees, else the first executable of
   `$HOME/.local/node/bin/node`, `$HOME/.nvm/current/bin/node`,
   `$HOME/.volta/bin/node`, `$HOME/.bun/bin/node`, `/usr/local/bin/node`,
   `/opt/homebrew/bin/node`, `/usr/bin/node`. If none, a loud error and exit 1.
3. **Launch**: `exec "$NODE" "$SERVER" "$@"`.

Two facts about this order, both learned the hard way:

- **The node list is not decoration.** Zed, like every GUI application, does not
  inherit a shell's PATH. On this machine node may live at
  `~/.local/node/bin/node` and is *not* on the default PATH, so a bare
  `command = "node"` fails. The same defect made the VS Code extension report
  "bb: server down" until it was fixed there.
- **Zed's own runtime is deliberately not used as the node substitute.** That
  fallback was measured on the VS Code side and fails on `better_sqlite3.node`
  with "compiled against a different Node.js version".

## What this document used to claim, and why it was wrong

An earlier revision of this file described the extension as "a thin wasm shim
that owns binary resolution only" (decision D-2), and listed a resolution order
of `lsp.<server-id>.binary.path` override → `dist/lsp/server.js` → `bb-lsp` on
PATH → declared error. **None of that is what ships.** There is no wasm shim:
`extension.toml` carries `command = "./bin/bb-lsp-server"` and nothing else, and
the launcher resolves a real `node` rather than a wasm build. The `Cargo.toml`,
`Cargo.lock` and `src/bb-lsp.rs` still in this directory are leftovers from that
abandoned approach and are referenced by nothing in the build.

This mattered beyond tidiness. `script/m56/generate-editors.ts` reads this file's
"Resolution order" section and publishes it to the website as Zed's `launch`
instructions — so the wrong description was being shown to readers as fact. The
`verify-zed.ts` gate was green (29/29, 4/4 mutants) throughout, because it checked
that the README *contained the words* for the old order rather than that the order
matched the shipped launcher.

## Install (dev)

Zed's dev-extension install is a GUI flow: **Extensions** in the bottom-left
corner → **Install Dev Extension** → pick
`ide/zed/bb-lsp` in this checkout. Automation cannot drive the picker, so this
cannot be verified from a script; it is a manual step, and it is recorded as one
rather than described as a command that does not exist on this machine.

## Settings

Only needed if the launcher cannot find the server:

```json
{
  "lsp": {
    "bb-lsp": {
      "binary": {
        "path": "/absolute/path/to/backbencher-brain/ide/zed/bb-lsp/bin/bb-lsp-server"
      }
    }
  }
}
```

## What works in Zed (honest surface)

Tiered hover (including the symbol's own doc comment), definition, references,
document/workspace symbols, call hierarchy, and the private `bb/staleness`
request.

**Not in Zed (v3 scope)**: the graph webview — a VS Code panel (M26, D-6).
The capability matrix records this delta per editor.

## Verification status

`npx tsx script/m27/verify-zed.ts` proves: manifest schema, the launcher's real
resolution order (server path, node candidates, both declared-error paths) run
against **the shipped script**, packaging sanity, and the method surface against
the **real server's advertised capabilities** (wire read). An editor-session leg
is attempted and honestly classified on this machine — it cannot pass here,
because installing the dev extension needs the two GUI clicks above. Evidence:
`validation/m27/results/Z1.json`.