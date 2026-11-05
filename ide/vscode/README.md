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

The extension **activates** for all fourteen languages in
`src/lsp/launch_languages.ts` — `package.json`'s `activationEvents` and the
client's `documentSelector` are both derived from that single owner, and the
build fails if they drift. That is deliberately wider than this table: the
extension *claims* the languages whose evidence chain reaches this table, and
`bb lsp` *serves* the full launch set. The seven launched-but-unclaimed
languages are named as a declared gap on the website's `/editors` page rather
than silently merged into the claim set. Before the activation fix, the
extension activated on only seven of the fourteen — the same seven it claims —
so a Go or Rust file opened in an indexed workspace produced no extension at all.

I1 = protocol-passed (see the honesty contract in the repository: `docs/IDE-HONESTY-CONTRACT.md`).
The claim table shipped in this extension is drift-gated against the
machine-generated tool document at verify time — the UI can never claim more
than the evidence chain recorded.

**Measured precision** (per-language, per-feature, machine-regenerated,
drift-gated): [`docs/m29/PRECISION-LEDGER.md`](../../docs/m29/PRECISION-LEDGER.md) —
the published ledger carries the evidence-derived claim levels (I3 across the
wave-1 languages), warm-latency percentiles, and the analyzer differential
floors behind this table.

**Claim-level legend** (contract §2 — the canonical ladder; higher levels require all lower ones):

| Level | Meaning |
|-------|---------|
| I0 | UNVERIFIED — may not ship behind any trust label |
| I1 | PROTOCOL-PASSED — real protocol requests against `bb lsp` assert response shape and content |
| I2 | INDEX-CONFORMANT — I1 plus position-mapping and freshness gates pass (contract §2) |
| I3 | EDITOR-VERIFIED — I2 plus a pinned editor run with machine evidence (contract §2) |
| I4 | FORK-VERIFIED — I3 plus a pinned fork run per fork (contract §2) |
| I5 | SCOPED-VERIFIED — I2 ∧ I3 ∧ latency budget ∧ limitations ∧ evidence fresh (contract §2) |

The CONTRACT is the governing document; this table summarizes it. See `docs/IDE-HONESTY-CONTRACT.md` §2 for the authoritative definitions.

Currently shipped claims are I1 (protocol level) for every feature on every
launched language. Editor-level claims exist for the two editors that have a
pinned recorded run — VS Code and Antigravity, in the matrix below — and each is
a claim about **the bundle that run installed**, per contract §15 Truth Rule 5.
Both runs were re-captured against the current bundle, so each is a claim about
HEAD rather than about an older build. Cursor and Windsurf have no pinned run on this machine,
and no platform beyond Linux has one.

**No claim is inherited.** A fork with no pinned run carries no claim, and a run
in one editor never implies another — the matrix below is the whole claim set.

## Editor verification matrix

Per contract §1 a fork claim without a pinned run is banned. Rows are generated
from per-fork evidence and drift-gated by the D1 verifier:

| Editor | Claim | Evidence |
|--------|-------|----------|
| VS Code | I3 — in-editor run at pinned 1.85.0, 91/91 checks (recorded 2026-10-17; the run predates the 2026-11-04 bundle, so frames must be re-captured before this is cited at HEAD) | `validation/m25/results/E5.json` |
| Cursor | blocked — no pinned run on this machine (binary not present; no display-verified run) | `validation/m25/results/F-CURSOR.json` |
| Antigravity | I4 — pinned fork run at 1.107.0, 90/90 in-editor checks against the current bundle | `validation/m25/results/F-ANTIGRAVITY.json` |
| Windsurf | blocked — no pinned run on this machine (binary not present; no display-verified run) | `validation/m25/results/F-WINDSURF.json` |
| Zed | blocked — no pinned run on this machine. The integration ships as an LSP config (`ide/zed/bb-lsp/`) whose shape is validated by `script/m27/verify-zed.ts`; a validated config is not a recorded editor run, so no claim is made | `script/m27/verify-zed.ts` |
| JetBrains (LSP4IJ) | blocked — no pinned run on this machine. The integration ships as an LSP4IJ descriptor (`ide/lsp4ij/bb-lsp/`), validated by the M27 config family; a validated descriptor is not a run | `script/m27/verify-closure.ts` (M27 family) |
| Helix | blocked — no pinned run on this machine. `ide/helix/languages.toml` is validated by `script/m27/verify-helix.ts`; a validated config is not a run | `script/m27/verify-helix.ts` |
| macOS / Windows | blocked — only the Linux leg is verified (E7-linux); the macOS and Windows matrix legs are executed by `.github/workflows/os-matrix.yml` and have no persisted passing run | `validation/m25/results/E7-darwin.json` |

Seven editors are named here because seven are what this project ships an
integration for. **Five of them carry no claim**, and that is the honest state
rather than a gap in the table: a config that parses, and a protocol that
answers, are not an editor run. Only VS Code and Antigravity have a pinned,
recorded run, and both are captured against the current bundle.

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

- **14 launch languages** (java, groovy, kotlin, scala, typescript, javascript, python, zig, go, rust, c, cpp, vue, svelte — the single owner is `src/lsp/launch_languages.ts`, contract §9).
  Other languages are declared absent — the server reports no declared claim
  level and offers no features for them rather than guessing.
- **VS Code activation gap:** the extension currently activates on only 7 languages (java, groovy, kotlin, scala, typescript, javascript, python — per `package.json` activationEvents and `extension.ts` documentSelector). The remaining 7 launch languages (zig, go, rust, c, cpp, vue, svelte) are served by the server but do not activate the extension in VS Code. This is a functional defect tracked in task-4 for the vscode-client lane.
- **Claim level I1 on the shipped surface.** The features pass the protocol and
  runtime verifiers, and in-editor and fork runs exist as recorded evidence — but
  none of those runs is verified, so the shipped trust labels stop at I1 and the
  matrix above names each editor's recorded state instead of a level.
- **Cross-platform unverified.** Only the Linux leg of the E7 OS matrix is
  verified; the macOS and Windows legs are blocked records, and the one recorded
  in-editor run (VS Code 1.85.0) ran on macOS without passing. Paths and
  `BB_DATA_DIR` handling are expected to need platform-specific fixes there
  (that expectation is why E7 exists, not a claim that they work).
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
