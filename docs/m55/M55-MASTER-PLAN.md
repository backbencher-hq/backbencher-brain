# M55: The Hub That Tells the Truth (IDE Program v8)

Status: `closed` on GitHub (milestone 55 closed) — **with a live ledger caveat**:
at commit `a0ed9eade` (this file's last truth pass) `validation/m55/results/T2.json`
and `T3.json` on disk read `known-gap` and `X1.json` reads `known-gap`, so the
lane is closed as a milestone while three of its records are red. The governance
gate now PROJECTS each ledger entry's status from its record (the ledger was
hand-maintained until this lane's fix), so the ledger and the records cannot
disagree again. Read this line as a pointer to the records, never as a green
tick.
GitHub milestone: `55` (free slot confirmed against the live board, 2026-09-12; the co-agent
lanes M45 / M49 / M50 / M37 / M14 are untouched)
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md) (§15 Truth Rules,
M55 amendment — landed by G1)
Prerequisite: M44 + M53 completion bars met — re-audited by G1 on every run.

Name note: "The Hub That Tells the Truth" — no banned vocabulary. The ambition is narrow and
unglamorous: every surface the developer already has must stop disagreeing with the others,
and must stop saying things in a machine's voice.

## Why now (evidence, not opinion)

The owner tested the shipped extension on 2026-09-12 and reported: broken call hierarchy, a
graph that is "very bad looking", `bb_lsp: this editor has no native references view`, a
`constructor` graph error, and — his words — "the VS Code is already full from the terminal,
copilot from the right, files from the left, and a very small window in the middle".

Step zero (this milestone's filing evidence, `validation/m55/frames/filing-2026-09-12/`)
established **which of those are real**, and it split the report in two.

### 1. The screenshots were a six-day-old build

`~/.vscode/extensions/backbencher.bb-lsp-vscode-0.1.0/dist/extension.js` was stamped
**2026-09-06 19:52** — one day *before* the M44 hub work landed (`97475f3b` U2, `a5704c44` U3,
`477b2f28` U4, all 2026-09-07). Rebuilt from HEAD and installed fresh (bundle 2026-09-12
16:20), the reported visuals are **already correct**:

| Reported | Fresh build (frame) |
|---|---|
| hub = unstyled wall of text | styled, grouped rows with chips + legend (`s03-open-in-graph.png`) |
| "Call tree" = flat list | `CALLERS (3)` / `CALLEES (0)` tree (`s04-call-tree.png`) |
| `no native references view` | string absent from the shipped bundle (U6 removed it) |
| `Symbol 'constructor' not found` | the panel opens (`s10-ctor-graph.png`) |

Lesson (Truth Rule 5): a claim about the editor is only a claim about **the installed
bundle**. Every M55 closure requires a fresh-install frame, and V1 makes that mechanical.

### 2. Re-shooting exposed six defects that are real at HEAD

All six are reproduced in `wire-truth.json` (the stdio probe against the real server and the
owner's real index) and in the frames.

1. **Call hierarchy is structurally wrong** (`T2`). On `get` (`src/store.ts:10`):
   `incomingCalls` returns `[main, get]` (the root as *its own caller*), `outgoingCalls`
   returns `[get]` (the root as *its own callee*), expanding the first caller returns
   `-32603: Cannot read properties of undefined (reading 'data')`, and every `fromRanges`
   entry points at a **declaration** (`main` → `app.ts:6`) instead of the call site
   (`app.ts:12`). This is the "call hierarchy shows greetAll but lands on greet" report.
2. **The hover's "usages" list is not usages** (`T3`). `greetAll` has **zero callers** and
   renders *"3 usages"* listing `Greeter` (its class declaration) and `greet` (its **callee**).
   `greet` says "6 usages" while its own `connected:` line lists 3 callers, `bb/graph` reports
   3 callers and `textDocument/references` returns 7 — four surfaces, four numbers.
3. **Signatures leak raw JSON** (`T4`): `greetAll([{"name":"names","type":"string[]",
   "isOptional":false}]) → string[]` on the wire and in the card.
4. **Member targets are silently relabeled** (`T1`): `bb/graph` for `constructor` on
   `store.ts` succeeds but roots on the **class** `Store`, and the panel is titled
   `Backbencher Hub — Store` with no note that a substitution happened.
5. **Every action splits a new editor column** (`P1`): `ViewColumn.Beside` hardcoded in
   `hub-panel.ts:163`, `impact-panel.ts:93`, `graph-panel.ts:119`, no `preserveFocus`. Two
   hover actions produced four editor columns on a 1920 px display (`s10` tab strip). This —
   not the theme or the CSS — is what "the middle window is tiny" actually is.
6. **Evidence tiers disagree per symbol** (`T5`): `Greeter.greet` reports
   `evidence: indexed, structural` (provenance `indexed`) while `Greeter.greetAll` reports
   `structural` only (provenance `structural`) — two methods, same class, two tier stories.

One cross-lane finding is **not** ours to fix and is handed off by `X1`: the index stores a
cross-language edge `greet → json` ("name-resolution", confidence 0.85, `is_cross_language=1`)
in a pure-TypeScript project — an M37/M14 enrichment false positive that our hover surfaces
honestly as `inferred`.

## Truth Rules (contract extension, gated from G1)

1. **One surface, one answer.** A fact rendered on two surfaces either agrees, or carries the
   declared reason it differs. (Counts of the same thing never differ.)
2. **Identity is stated.** When a target is resolved through a substitute — a member through
   its owning declaration — the substitution is labeled wherever the target is named. Silent
   relabeling is a defect.
3. **Positions are where the thing is.** A range handed to the editor points at the call site
   it names, never at a declaration.
4. **Human text is human.** No machine shapes (JSON blobs, serialized parameter lists) in
   anything a developer reads.
5. **The editor is the gate.** A visual claim closes on a fresh-install frame at the evidence
   HEAD, read through the pinned protocol — never on a DOM assertion alone.
6. **Space is the user's.** A panel never silently splits the editor and never takes focus
   without a reason it can state.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | [#773](https://github.com/backbencher-hq/backbencher-brain/issues/773) Governance + v7-bar check | M55 ledger; closure gate (`script/m55/verify-governance.ts`); §15 Truth Rules in the contract doc, machine-gated; the screenshot protocol pinned; M44 + M53 bars re-audited on every run |
| T1 | [#770](https://github.com/backbencher-hq/backbencher-brain/issues/770) One identity resolver | member targets resolve through the owning declaration **and say so** on every surface; the wire carries the substitution; absent symbols stay loud declared errors |
| T2 | [#771](https://github.com/backbencher-hq/backbencher-brain/issues/771) Call hierarchy truth | call-site ranges; no self-loops in incoming/outgoing; expand never errors; declared depth/cycle policy |
| T3 | [#772](https://github.com/backbencher-hq/backbencher-brain/issues/772) One usage count, one list | "usages" means stored usage sites; hover / graph / references agree or state their declared filter |
| T4 | [#774](https://github.com/backbencher-hq/backbencher-brain/issues/774) Human signatures | one signature renderer; no raw JSON on any surface; unresolved types render a declared unknown |
| T5 | [#775](https://github.com/backbencher-hq/backbencher-brain/issues/775) One tier classifier | one evidence-tier rule for members, fields, classes and externals; hover/row/legend/stored rows agree |
| P1 | [#776](https://github.com/backbencher-hq/backbencher-brain/issues/776) Panel placement + focus | default = preview tab in the current editor group (owner decision, 2026-09-12); panels reused, never duplicated; `preserveFocus`; `bb.panelPlacement` setting remembered |
| V1 | [#777](https://github.com/backbencher-hq/backbencher-brain/issues/777) The live-surface gate | the filing rig promoted to `script/m55/` — fresh-install screenshot protocol + wire probe + reads-back assertions, wired into the verify chains and provably fail-able |
| X1 | [#778](https://github.com/backbencher-hq/backbencher-brain/issues/778) Closure + verdict + hand-off | M24→M55 closure audit at one HEAD; the owner's v8 verdict pack (every claim with its frame); the cross-language false-positive hand-off note to the analyzer lane |

## Milestone completion bar

1. All nine issues `verified` in `validation/m55/results/manifest.json`, each with evidence at
   the **same** HEAD (G1's ladder enforces the pin).
2. The M44 and M53 completion bars re-audited green at that HEAD.
3. `npm run verify` and the CI `verify:fast` chain green with V1 and G1 wired in.
4. Zero lane violations: no M37/M14/M45/M49/M50 file touched by M55 evidence runs.
5. The owner's verdict (§8.5 of the honesty contract): the spot-check pack is tried by hand
   and the verdict is recorded — the gate never declares the milestone "achieved".

## The filing evidence (what this plan is built on)

`validation/m55/frames/filing-2026-09-12/` — captured and read during the step-zero run:

| Artifact | sha256 (16) | Bytes | What it proves |
|---|---|---|---|
| `s02-hover-greet.png` | `3995a637d60296ca` | 172920 | the rich hover renders in a fresh install (and the JSON signature + callee-usages defects are visible in it) |
| `s03-open-in-graph.png` | `9851d9d5b8b56f38` | 271753 | the hub list renders styled, grouped rows + legend; the panel took a new column |
| `s04-call-tree.png` | `e5077ae815297012` | 242765 | the call tree renders `CALLERS (3)` / `CALLEES (0)` |
| `s09-ctor-hover.png` | `24f4acbd9d5e9d1b` | 234617 | the constructor hover resolves (no crash, no `not found`) |
| `s10-ctor-graph.png` | `851c7c9eb33e9be6` | 336138 | the constructor graph opens on the **class** `Store` — the silent relabel — after a second hover action, with four editor columns |
| `wire-truth.json` | `155fa1b12405df28` | 34245 | the raw stdio responses behind every number in "Why now" |

The demo workspace is an **external declared fixture** (the owner's `~/bb-demo-hub`), used
as-is by owner decision (2026-09-12) — see [SCREENSHOT-PROTOCOL.md](SCREENSHOT-PROTOCOL.md).
