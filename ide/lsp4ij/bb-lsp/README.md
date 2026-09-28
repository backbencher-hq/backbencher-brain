# bb_lsp for JetBrains IDEs via LSP4IJ (M27.J1)

A user-defined language server template for
[LSP4IJ](https://github.com/redhat-developer/lsp4ij) — **configuration only,
no Kotlin plugin** (decision D-1).

## Install

1. Install the LSP4IJ plugin from the JetBrains Marketplace.
2. `Settings → Languages & Frameworks → Language Servers`
3. `Template` combo-box → **Import from custom template…** → select this
   directory (`ide/lsp4ij/bb-lsp/`).
4. Edit `BB_ROOT` in the command to the absolute path of your
   backbencher-brain checkout (compiled `dist/lsp/server.js` required).
5. Open a workspace and open a `.ts`/`.js`/`.java`/`.scala` file — bb_lsp
   starts on demand.

## What the template declares

- **Command**: `node <BB_ROOT>/dist/lsp/server.js --dir $WORKSPACE_DIR$`
  (declared launch order, dist form; `$WORKSPACE_DIR$` is LSP4IJ's built-in
  macro for the open project root).
- **Mappings**: TypeScript, JavaScript, Java, Scala — each with its LSP
  `languageId`.

## What works in JetBrains IDEs (honest surface)

Everything bb_lsp advertises and LSP4IJ surfaces: tiered hover, definition,
references, document/workspace symbols, call hierarchy, and the private
`bb/staleness` marker (LSP4IJ shows custom requests in the LSP console).

**Not in JetBrains (v3 scope)**: the graph webview — a VS Code panel
(M26, D-6). The capability matrix records this delta per editor.

## Verification status

`npx tsx script/m27/verify-lsp4ij.ts` proves the template: schema, launch
order, mappings, byte-stability, and the method surface against the **real
server's advertised capabilities** (wire read). The **runIde editor-session
leg is blocked** on this machine (D-7: IntelliJ not downloaded; the attempt
is recorded, never silent) — the claim level is **I2**, stated, not
aspirational. Evidence: `validation/m27/results/J1.json`.
