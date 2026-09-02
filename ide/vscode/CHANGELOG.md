# Changelog — bb-lsp-vscode

All notable changes to the Backbencher Brain VS Code extension.
Versions are pinned to the server compatibility matrix in README.md.

## 0.1.0 — v1 (The Extension), issues #499–#501

- Thin LSP client over `bb_lsp` (compiled dist preferred; source via bun is a
  declared, labeled fallback). Declared activation budget: 150 ms (§7.3) —
  measured and surfaced, a miss is a failed gate.
- Server resolution order declared: explicit path → workspace dist → bundled
  dist → bun source (labeled fallback). A server that won't state its version
  is never trusted (fail closed).
- Auto-index on open with explicit consent, scale estimate before the ask,
  cancellable progress, and resume without re-asking (#500).
- Status surface: staleness badge (stale is visible, unknown is never fresh),
  per-language evidence levels drift-gated to the generated tool doc, failure
  states with remediation actions (#501).
- Complement stance enforced: no completion, no diagnostics, no rename.
