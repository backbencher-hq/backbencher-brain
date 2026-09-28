# bb_lsp in Helix (M27.H1 adapter)

Pure configuration — a `languages.toml` fragment. Helix attaches bb_lsp as a
stdio language server for the fixture languages; the server does the rest
(tiered hover, definition, references, symbols, call hierarchy, staleness via
the private `bb/staleness`).

## Launch order (declared — same order as the VS Code extension resolves)

Helix cannot run arbitrary resolution logic, so the fragment uses a **single
declared command** and the resolution order is documented here:

1. `bb-lsp-serve` on PATH if you install a wrapper script (owner override):
   `#!/bin/sh\nexec node /path/to/backbencher-brain/dist/lsp/server.js --dir "$HELIX_RUNTIME_WORKSPACE"`
2. the command below with an absolute path to your backbencher-brain
   checkout's compiled dist (edit `BB_ROOT` — Helix expands `$HOME` but not
   arbitrary repo paths),
3. the bun source fallback (`bun run <BB_ROOT>/src/lsp/server.ts`), labeled
   source mode.

Everything else is refused: bb_lsp never guesses, and Helix gets no silent
fallback chain.

## Config fragment (`ide/helix/languages.toml`)

```toml
# bb_lsp — Backbencher Brain language server (M27.H1)
# Edit BB_ROOT to your backbencher-brain checkout (compiled dist required).
[[language]]
name = "typescript"
language-servers = [ { name = "bb-lsp" } ]

[[language]]
name = "javascript"
language-servers = [ { name = "bb-lsp" } ]

[[language]]
name = "java"
language-servers = [ { name = "bb-lsp" } ]

[[language]]
name = "scala"
language-servers = [ { name = "bb-lsp" } ]

[language-server.bb-lsp]
command = "node"
args = [ "/opt/backbencher-brain/dist/lsp/server.js" ]
# BB_ROOT convention: replace /opt/backbencher-brain with your checkout.
```

## What works in Helix (honest surface)

- **hover** — tiered evidence, usage count, staleness marker (markdown)
- **definition / references** (`gd` / `gr`)
- **document symbols / workspace symbols**
- **call hierarchy** (incoming/outgoing, where the Helix version surfaces it)

Not in Helix (v3 scope): the graph webview — a VS Code panel (M26, D-6).
The capability matrix records this delta per editor.

## Verification status

`npx tsx script/m27/verify-helix.ts` proves the fragment: TOML validity, the
language-server block's command/args drift-gated against the declared launch
order, per-language wiring present, and the declared method set checked
against the **real server's advertised capabilities** (spawned via the M24
harness client). A driven `hx` session is **blocked-with-reason** on this
machine (D-7: hx not provisioned; Helix has no headless assertion path) —
the claim level is I2, stated, not aspirational. Evidence:
`validation/m27/results/H1.json`.
