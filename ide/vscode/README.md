# Backbencher Brain (bb_lsp) — VS Code extension

Honest code navigation from the Backbencher index: hover with evidence tier and
staleness, definition, references, document symbols, workspace symbols, and call
hierarchy for Java, Groovy, Kotlin, Scala, and TypeScript.

**A complement to your editor's own language servers — graph, navigation, and
evidence only.** No completion, no diagnostics, no rename (declared scope,
contract §7.1).

## Features and claim levels

Every feature carries its declared claim level — the UI shows the same table
(`Backbencher: Show status`):

| Language  | Hover | Definition | References | Symbols | Call hierarchy |
|-----------|-------|------------|------------|---------|----------------|
| java      | I1    | I1         | I1         | I1      | I1             |
| groovy    | I1    | I1         | I1         | I1      | I1             |
| kotlin    | I1    | I1         | I1         | I1      | I1             |
| scala     | I1    | I1         | I1         | I1      | I1             |
| typescript| I1    | I1         | I1         | I1      | I1             |
| javascript| I1    | I1         | I1         | I1      | I1             |
| python    | I1    | I1         | I1         | I1      | I1             |

I1 = protocol-passed (see the honesty contract in the repository: `docs/IDE-HONESTY-CONTRACT.md`).
The claim table shipped in this extension is drift-gated against the
machine-generated tool document at verify time — the UI can never claim more
than the evidence chain recorded.

**Measured precision** (per-language, per-feature, machine-regenerated,
drift-gated): [`docs/m29/PRECISION-LEDGER.md`](../../docs/m29/PRECISION-LEDGER.md) —
the published ledger carries the evidence-derived claim levels (I3 across the
wave-1 languages), warm-latency percentiles, and the analyzer differential
floors behind this table.

**Claim-level legend** (contract §2 — higher levels require all lower ones):

| Level | Meaning |
|-------|---------|
| I0 | UNVERIFIED — may not ship behind any trust label |
| I1 | PROTOCOL-PASSED — real protocol requests against `bb lsp` assert response shape and content |
| I2 | RUNTIME-PASSED — I1 plus a real `bb lsp` server process over stdio with real files on disk |
| I3 | IN-EDITOR VERIFIED — I2 plus the feature exercised inside a pinned editor version with machine evidence |
| I4 | CROSS-EDITOR VERIFIED — I3 plus a pinned run in a non-VS Code editor (fork) |

Currently shipped claims are I1 (protocol level) everywhere; in-editor I3 runs
exist for VS Code 1.85.0 and fork I4 runs for Cursor 3.18.9 and Antigravity
1.107.0 on Linux — see the evidence files under `validation/` in the
repository. Any editor or platform without a pinned run is declared unverified
here, not claimed.

## Editor verification matrix

Per contract §1 a fork claim without a pinned run is banned. Rows are generated
from per-fork evidence and drift-gated by the D1 verifier:

| Editor | Claim | Evidence |
|--------|-------|----------|
| VS Code | I3 — in-editor verified (pinned 1.85.0, Linux) | `validation/m25/results/E5.json` |
| Cursor | I4 — cross-editor verified (pinned 3.18.9, Linux) | `validation/m25/results/F-CURSOR.json` |
| Antigravity | I4 — cross-editor verified (pinned 1.107.0, Linux) | `validation/m25/results/F-ANTIGRAVITY.json` |
| Windsurf | blocked — no pinned run on this machine | `validation/m25/results/F-WINDSURF.json` |
| macOS / Windows | not verified — no OS-matrix run recorded yet | M25.E7 pending |

## Complement stance (contract §7)

This extension coexists with first-party language servers (gopls,
rust-analyzer, tsserver, jdtls, …) and never competes with them:

- **No completion, no diagnostics, no rename.** Graph, navigation, cross-language
  provenance, and evidence tiers only.
- Where a first-party language server exists for a language, hover content from
  the bb index is additive and labeled as coming from the bb index; where none
  exists, we declare that we are the primary provider for that language.
- Activation must not degrade first-party language-server startup — the declared
  activation budget is a measured gate (§7.3), and a miss is surfaced, never hidden.
- An observed conflict with a first-party server is a filed defect with a
  reproduction — never a setting to hide behind.

## Limitations (declared, contract §1)

- **Five launch languages only** (Java, Groovy, Kotlin, Scala, TypeScript).
  Other languages are declared absent — the server reports no declared claim
  level and offers no features for them rather than guessing.
- **Claim level I1 on the shipped surface.** The features pass protocol and
  runtime verifiers and in-editor/fork runs exist as recorded evidence, but the
  shipped trust labels reflect the drift-gated chain, not aspiration.
- **Cross-platform unverified.** Every recorded run to date is Linux. macOS and
  Windows claims wait on the E7 OS matrix; paths and `BB_DATA_DIR` handling are
  expected to need platform-specific fixes there (that expectation is why E7
  exists, not a claim that they work).
- **Freshness has a declared policy, not magic.** Edits are debounced (300 ms)
  before reindex; between an edit and the reindex landing, the UI shows the
  staleness badge rather than silently serving the old graph.
- **Latency budgets are machine-scoped.** The warm p95 budgets were measured on
  the development machine; other hardware may differ, and the status surface
  reports what was measured.


## Version compatibility matrix (extension ↔ server)

| extension | min bb_lsp server | notes |
|-----------|-------------------|-------|
| 0.1.x     | 0.3.0             | declared in `bbLsp.minServerVersion`; a server that won't state its version is never trusted (fail closed) |

Rules:
- The server version comes from the single source (`BACKBENCHER_BRAIN_VERSION`).
- A mismatch disables features **with a visible message and a restart action** — never silent absence.
- The minimum is raised only in a major/minor that needs a newer server capability.

## Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `bbLsp.serverPath` | empty | explicit server entry override (validated, never guessed) |
| `bbLsp.sourceMode` | auto | compiled dist preferred; source via bun is a declared fallback |
| `bbLsp.minServerVersion` | 0.3.0 | minimum server version accepted |
| `bbLsp.activationBudgetMs` | 150 | declared activation budget (contract §7.3); a miss is a failed gate |
| `bbLsp.autoIndexMode` | ask | consent before building an index; `never` is a declared no-op |

## Indexing

On workspace open the extension detects an existing index
(`<BB_DATA_DIR or ~/.bb>/projects/<sha1-of-path>/brain.db`). If none exists it
asks **with the scale estimate in view** and never indexes without explicit
consent. Progress is cancellable; a cancelled index resumes on reopen without
re-asking. The editor is never blocked during activation or indexing.

## Commands

- `Backbencher: Restart bb_lsp server`
- `Backbencher: Show status (evidence levels, staleness)`
- `Backbencher: Index this workspace now`

### Hover actions (M42.H4)

Every rich hover carries an **actions** row — one click to each deep surface:

- `bb.openGraph` — **Open in graph**: the connections webview for the hovered
  symbol (callers/callees, evidence-badged edges).
- `bb.openImpact` — **Impact analysis**: the bounded reverse-dependency set
  (declared truncation: it shows the real count or an honest
  "unknown", never a silent cut).
- `bb.showCallHierarchy` — **Call hierarchy**: the editor's native call
  hierarchy view, opened on the symbol.

The action targets are resolved by the server (the symbol under the hover,
index-stored); an un-indexed workspace or unknown symbol surfaces a declared
error with remediation — never a silent no-op.

## Install and verify

```bash
# From a built checkout (the published artifact is identical, contract AB3):
code --install-extension bb-lsp-vscode-0.1.0.vsix

# Then, in a fresh profile (never over your daily driver the first time):
code --user-data-dir /tmp/bb-try --extensions-dir /tmp/bb-try-ext .
# Open the command palette -> "Backbencher: Show status" and confirm the
# evidence-tier table renders; hover an indexed symbol to see the tier badge.
```

The install-verification steps above are executed by a scripted follow-along
(`script/m25/verify-install-docs.ts`) on a clean profile at verify time — the
documents cannot drift from what was actually run.
