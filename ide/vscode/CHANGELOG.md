# Changelog — bb-lsp-vscode

All notable changes to the Backbencher Brain VS Code extension.
Versions are pinned to the server compatibility matrix in README.md.

## Unreleased

- Fixed: activationEvents and the documentSelector covered only 7 of the 14
  launch languages, so Go/Rust/C/C++/Vue/Svelte/Zig files never activated the
  extension. Both lists are now derived from the single owner
  (src/lsp/launch_languages.ts) through a declared VS Code language-id table,
  and the build fails if package.json drifts from the launch set.
- Fixed: the status-bar badge's command was only set inside refreshStatus(),
  so the "no workspace" / "no server" / "version" badges were dead (click did
  nothing). The command is now set at creation time on every activate() path,
  and all commands register before any early return.
- Verified: panel placement (M55.P1) — panels open in the active group by
  default, preserveFocus is honored, and panels are reused (never duplicated)
  through PanelRegistry; no column growth on repeated hover actions by
  construction.

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
