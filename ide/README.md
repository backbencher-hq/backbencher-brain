# `ide/` — editor integrations over the local index

The editors below are **evidence-aware navigation surfaces** for the same local index: hover with evidence
tier and staleness, go-to-definition, references, document/workspace symbols and call hierarchy. They are
complements to a project's own language servers — no completion, no diagnostics, no rename. The promised and
explicitly-declined behaviour is the contract in
[`docs/IDE-HONESTY-CONTRACT.md`](../docs/IDE-HONESTY-CONTRACT.md).

The language server itself is the product code in `src/lsp/`; it is built to `dist/lsp/server.js` by
`npm run build`. An installation is therefore: build (or unpack a release), point the editor at the server, and
open an indexed project.

| Path | Editor | What it is |
| --- | --- | --- |
| `ide/vscode/` | VS Code, Cursor, Antigravity and other VS Code-family editors | The `bb_lsp-vscode` extension (one VSIX serves the family), attached to each GitHub release as `bb-lsp-vscode-<version>.vsix`. Claim levels per language/feature are in its README; build with `node ./esbuild-extension.mjs` after `npm run build` at the repo root, package with `npx @vscode/vsce package`. |
| `ide/zed/bb-lsp/` | Zed | Extension manifest, two language configs and the launcher script. The README states the declared server/Node resolution order; the launcher errors loudly rather than silently falling back. |
| `ide/lsp4ij/bb-lsp/` | JetBrains IDEs via the LSP4IJ plugin | Configuration-only template (no Kotlin plugin): import it in the LSP4IJ settings and set `BB_ROOT` to the checkout. Language mappings: TypeScript, JavaScript, Java, Scala. |
| `ide/helix/languages.toml` | Helix | A language-server stanza per supported language. The command path is a placeholder by design and must be edited; `script/m56/verify-published-paths.ts` gates that no published editor config carries a machine-specific absolute path. |

Per-editor **verification status** is recorded with evidence under `docs/m25/INSTALL.md` (the Linux runs and the
`validation/m25/results/` artifacts); an editor without a pinned run there is declared unverified, not claimed.
Editor integration work is tracked in `docs/IDE-PROGRAM-STATUS.md`, `docs/IDE-PROGRAM-DECISIONS.md` and
`docs/IDE-OWNER-TEST-PLAN.md`.

The published editor guidance used by the website is generated from these configurations
(`script/m56/generate-editors.ts`) and checked by `script/m56/verify-published-paths.ts`.
