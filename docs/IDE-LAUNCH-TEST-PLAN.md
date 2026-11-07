# IDE lane — launch test plan

What to run before calling the IDE lane launchable. It has two halves:

- **§0–§3, the machine chain** — commands that must print green, in the order
  that fails fastest. Every count was observed on this machine; the ones marked
  *(expected)* are the last observed value and should be re-read from the run
  rather than assumed.
- **§4, the human pass** — the checks a gate cannot make, because they are about
  what a person sees. Everything in §0–§3 proves the machinery; only §4 proves
  the experience.

Three rules while testing:

- **Run latency gates alone.** `verify-hover-coverage` and `verify-cross-platform`
  miss their budgets when other gates run concurrently. A miss under load is a
  property of the machine, not of the product, and both gates print the load
  average beside every number so the two can be told apart.
- **Seal, then commit, then re-seal.** Evidence is pinned to the commit it was
  measured at and stays valid while no *relevant* file changes. A commit that
  changes a gate input (a source file, a plan doc, the generated precision
  ledger) makes that gate's record stale by its own rule — correct behaviour, not
  a bug. The order that converges is: run the gate, commit its record with the
  artifact it reads, re-run the consumers of that artifact.
- **A killed leg is not a red gate.** The closure gate runs the whole ladder with
  a per-leg timer. If a leg reports `(killed at the Ns leg timer)` the gate did
  not fail — it did not finish. Raise that leg's `timeoutMs` in
  `script/m29/verify-closure.ts` rather than "fixing" the product.

## 0. Prerequisites

```
npm run build                                   # dist/lsp/server.js is what the in-editor legs launch
ls .tools/nvim-linux-x86_64/bin/nvim            # the wave's in-editor legs need this binary
node --version                                  # the wave harness pins a modern Node; 22.x is what it ran on
```

The giant-repo leg needs a persistent index in `$TMPDIR/m29-giant-data`, and this
environment gives each shell a fresh `/tmp`. Build it in the **same shell** as
the measurement:

```
npx tsx script/m29/generate-giant-corpus.ts                     # 59,000 files, deterministic
npx tsx script/m29/giant-repo-budget.ts --index-only --reuse    # ~12 min
npx tsx script/m29/giant-repo-budget.ts --reuse                 # measurement
npx tsx script/m29/verify-giant-repo.ts                         # 28/28 incl. the live probe
```

If `--index-only` is skipped, `verify-giant-repo` reports
`R6: live probe skipped (no persistent index — run --index-only first)`. That is
a declared skip that fails the gate: an unmeasured server leg is not a passing
server leg. The M55 governance gate builds this index itself before it spawns the
ladder, for exactly this reason.

## 1. Product gates — the lane's own behaviour

```
npx tsx script/m55/verify-identity.ts            # T1  38/38
npx tsx script/m55/verify-call-hierarchy.ts      # T2  64/64,  9/9 mutants
npx tsx script/m55/verify-relations.ts           # T3  92/92,  7/7 mutants
npx tsx script/m55/verify-signatures.ts          # T4  67/67,  4/4 mutants
npx tsx script/m55/verify-tiers.ts               # T5  70/70,  7/7 mutants
npx tsx script/m55/verify-type-inference.ts      # T6 116/116,  8/8 mutants
npx tsx script/m55/verify-panel-placement.ts     # P1  25/25
npx tsx script/m55/verify-evidence-tree-clean.ts # clean tree (no scratch under validation/)
npx tsx script/m55/verify-status-panel.ts        # 42/42, 11/11 mutants
npx tsx script/m55/verify-action-args.ts         # 47/47,  7/7 mutants
```

Run these two **alone**:

```
npx tsx script/m55/verify-hover-coverage.ts      # 40/40  (latency)
npx tsx script/m25/verify-cross-platform.ts      # E7(linux) 56/56, 4/4 (latency)
```

The hover gate is the one that proves the contract's latency budget: warm hover
p95 under 50 ms on all three busy shapes. If it fails, read the load average it
prints before reading it as a regression.

## 2. Editor evidence — what was actually run in an editor

```
npx tsx script/m24/verify-server.ts              # L1 142/142
npx tsx script/m24/verify-hover.ts               # L2  58/58
npx tsx script/m24/verify-navigation.ts          # L3 122/122
npx tsx script/m24/verify-symbols.ts             # L4  50/50
npx tsx script/m24/verify-call-hierarchy.ts      # L5  97/97
npx tsx script/m25/run-vscode-e2e.mts            # E5  91/91 IN-EDITOR, pinned VS Code 1.85.0
npx tsx script/m25/verify-install-docs.ts        # D1-install 21/21, clean profile
npx tsx script/m25/verify-packaging.ts           # E4  56/56, real VSIX built
npx tsx script/m25/run-fork-e2e.mts              # E6  per fork; antigravity 90/90 in-fork
```

`E5` launches a real VS Code, installs the extension and drives it. It needs a
writable `XDG_RUNTIME_DIR`; the runner pins one under its output directory. If it
reports `0/0 in-editor checks passed`, look for `listen EROFS` in its output
before concluding anything about the product.

`E6` runs the same suite inside a VS Code fork. It must launch the fork's **ELF
binary**, not the `code` shell wrapper (the wrapper honours
`ELECTRON_RUN_AS_NODE` and never starts an extension host), and it must be forced
onto X11 (`--ozone-platform=x11`, `WAYLAND_DISPLAY` unset) on a Wayland desktop.
Both failure modes present as "the fork launches but starts no extension host".

## 3. Governance — the chain, in order

Each gate re-audits the previous milestone's completion bar, so they must run in
this order; a later one cannot go green while an earlier one is red.

```
npx tsx script/m24/verify-governance.ts          # M24 VERIFIED 29/29
npx tsx script/m25/verify-governance.ts          # M25 (E6 blocked per fork, reason recorded)
npx tsx script/m25/verify-closure.ts             # M25 X1
npx tsx script/m26/verify-governance.ts          # M26
npx tsx script/m26/verify-closure.ts             # M26 X1
npx tsx script/m27/verify-governance.ts          # M27
npx tsx script/m27/verify-closure.ts             # M27 X1
npx tsx script/m28/verify-governance.ts          # M28
npx tsx script/m28/verify-closure.ts             # M28 X1
npx tsx script/m29/verify-governance.ts          # M29 G1
npx tsx script/m29/verify-closure.ts             # M29 X1 — the program closure over M24–M29
npx tsx script/m42/verify-rich-hover.ts          # 71/71, 7/7 mutants
```

The M29 legs individually:

```
npx tsx script/m29/verify-wave-protocol.ts            # R1  36/36
npx tsx script/m29/verify-wave-execution.ts           # R2 261/261, 14 languages, 5/5 mutants
npx tsx script/m29/verify-giant-repo.ts               # R3  28/28 (needs §0's index)
npx tsx script/m29/verify-precision-ledger.ts         # R4  19/19; --write regenerates the published ledger
npx tsx script/m29/verify-precision-improvements.ts   # R5  20/20
npx tsx script/m29/verify-wave-harness.ts             # V1  14/14 (a harness of harnesses; ~10 min)
npx tsx script/m29/verify-m29-docs.ts                 # D1  13/13
```

`R4` and `D1` assert byte-identical regeneration of `docs/m29/PRECISION-LEDGER.md`
and `.json`. The ledger inlines measurements from `R3.json` and the wave records,
so re-running those leaves it one generation behind; `--write` is the remedy, and
`script/m29/verify-closure.ts` performs it between ladder passes for that reason.

**The integration receipt.** The lane chain above is also available as one run:

```
npx tsx script/m53/verify-r1-ladder.ts           # R1: 41 gates (m24 → m44) in one pass
npx tsx script/m53/verify-closure.ts             # X1: the M50–M53 completion bar
```

Read the receipt from the records — `validation/m53/results/R1.json` and
`X1.json` — not from this page. A lane ledger is *projected from its sealed
records* by its own governance gate (`script/m61/ledger_gate_wiring.ts`), so a
ledger entry can no longer read `verified` over a red record; the remaining
honest states are `blocked` and `known-gap`, each with the reason recorded next
to it.

## 4. The human pass

These need a person at a screen. They are the reason the gate work matters.

### 4.1 Install the build under test

A claim about the editor is a claim about **the installed bundle** (Truth Rule 5,
`docs/m55/SCREENSHOT-PROTOCOL.md`). Install the build at the current HEAD rather
than testing whatever is already in the profile:

```
cd $HOME/mcp/backbencher-brain
npm run build                                     # dist/lsp/server.js (the server under test)
cd ide/vscode
node ./esbuild-extension.mjs                      # extension bundle + staged server
node ./collect-server-deps.mjs                    # the bundled server's runtime deps
npx --yes @vscode/vsce package --allow-missing-repository --no-git-tag-version
code --install-extension bb-lsp-vscode-0.1.0.vsix --force
```

Then in VS Code: **Developer: Reload Window**. Sanity check before any test: the
status-bar item must read `bb`. Any other badge (`bb: version`, `bb: no index`,
`bb: server down`) is itself a finding to report, not a reason to skip the run.

`ide/vscode/bb-lsp-vscode-0.1.0.vsix` is what `script/m25/verify-packaging.ts`
builds; the timestamp of the installed `extension.js` is the build identity to
quote beside a failing frame.

**The fixture.** The recorded frames in
`validation/m55/frames/owner-test-2026-09-21/` (11 stills + `manifest.json` +
`session.json`) were captured against `$HOME/bb-demo-hub`. That
checkout is **not on this machine**: `ls -d ~/bb-demo-hub` fails, and the M53
closure records that absence with a reason instead of scoring a regression. So
this plan does not ask you to use it. Two fixtures are on disk and runnable:

- `script/m29/wave-fixtures/<language>/main.<ext>` — one source file per launch
  language, the same packs the M29 wave gates assert against. Use them for §4.2.1
  and for a per-language hover/activation sweep.
- any project you have indexed (`bb index <dir>`), or this repository, for the
  click-through in §4.3. The blocks state *properties* ("the card names its
  evidence tiers"), not the recorded strings, because the strings that were
  recorded belong to a fixture that no longer exists on this machine.

### 4.2 Three checks a gate cannot make

**1. Fourteen-language activation.** Index the fixture packs (`bb index
script/m29/wave-fixtures`), open that directory as the workspace, and open the
source file of each launch language in turn:

| language | file to open |
|---|---|
| java | `script/m29/wave-fixtures/java/main.java` |
| groovy | `script/m29/wave-fixtures/groovy/main.groovy` |
| kotlin | `script/m29/wave-fixtures/kotlin/main.kt` |
| scala | `script/m29/wave-fixtures/scala/main.scala` |
| typescript | `script/m29/wave-fixtures/typescript/main.ts` |
| javascript | `script/m29/wave-fixtures/javascript/main.js` |
| python | `script/m29/wave-fixtures/python/main.py` |
| zig | `script/m29/wave-fixtures/zig/main.zig` |
| go | `script/m29/wave-fixtures/go/main.go` |
| rust | `script/m29/wave-fixtures/rust/main.rs` |
| c | `script/m29/wave-fixtures/c/main.c` |
| cpp | `script/m29/wave-fixtures/cpp/main.cpp` |
| vue | `script/m29/wave-fixtures/vue/main.vue` |
| svelte | `script/m29/wave-fixtures/svelte/main.svelte` |

Each must wake the extension (`package.json` declares one `onLanguage:<language>`
activation event per row above, and `script/m29/verify-wave-protocol.ts`
drift-gates that list against `src/lsp/launch_languages.ts` and the wave approval
records). What the install proves and the build cannot: the editor's own language
id, not the extension's idea of it, is what fires activation. **Fails if** any of
the fourteen opens without the extension activating, or a hover on the file's
first declaration says "symbol not in the index" after the workspace reports as
indexed.

**2. Status-bar click on every path.** Click the `bb` badge in three situations:
a workspace **with** an index, a workspace **without** one, and a file opened
**outside any workspace folder**. The command is *Show status (evidence levels,
staleness)* (`bbLsp.showStatusPanel`). **Fails if** a click opens nothing on any
of the three — the filed defect was exactly a badge that did nothing on one path
and worked on the others.

**3. The `/editors` claim table against `docs/IDE-HONESTY-CONTRACT.md` §2.**
The page is `website/src/app/editors/page.tsx`; its data is generated from the
records by `script/m56/generate-editors.ts` into
`website/src/data/editors.generated.ts` and drift-gated by
`script/m56/verify-editors-page.ts` (which re-runs the generator and requires
`EDS: PASS`). Read the rendered table, and for each row:

- its claim level is one the ladder permits (`I0`–`I5`, §2), and a level is never
  claimed without the run that earns it;
- a fork (`I4`) is claimed **separately** per fork, with its own pinned version —
  a claim for one fork never implies another;
- every editor that is not claimed is **declared** unclaimed, not omitted;
- the version and the date beside a row match the record it cites.

**Fails if** a row claims a level its record does not support, or an editor
disappears from the table instead of being declared unclaimed.

### 4.3 The click-through, block by block

Each block says **do → see → fails if**. Capture the frame at the moment
described and name it exactly as given, so the name can be matched against this
document later. The `owner-test-2026-09-21` frames are the recorded baseline for
A1–A4, B1, C/D, E1, G and H — where your frame and one of those differs, the
difference is the finding.

**A — Hover.**

| # | Do | See | Fails if |
|---|---|---|---|
| A1 | hover a declaration | signature, symbol kind and usage count, the `evidence:` tiers, the `connected:` links, the actions row, and a `source:` line naming where the fact came from | the card shows no `evidence:`; a position appears that the index cannot know; a claimed row is clipped out of view |
| A2 | hover the same symbol at a call site | the **same** identity and the same card — one symbol, not two | the call-site hover resolves a different symbol, or shows a member/owner that is not the symbol under the cursor |
| A3 | hover a constructor | its signature, its own usage count, and the actions row | `Impact analysis` is missing, or the card claims usages that do not exist |
| A4 | hover a symbol with no usages | `0 usages` **and no list** — absence declared, nothing invented | a list of callees or an owning class appears in place of the usages |
| A5 | hover a symbol with stored cross-language rows | the section names the target language and the bridge mechanism, and is *absent* when no such rows are stored | a cross-language claim appears with no stored row behind it |

**B — The hub** (*Open in graph*, from the palette or the hover action).

| # | Do | See | Fails if |
|---|---|---|---|
| B1 | open the hub | rows grouped by file, group headers carrying per-group counts, and the summary line (`N callers · M callees`) | a header count differs from the rows rendered below it |
| B2 | read the legend | **one** legend: the five evidence tiers, the enrichment chip and the staleness marker, each with its meaning | two legends, or a badge in the rows whose tier is not in the legend |
| B3 | move the mouse over a row, then over its chevron | a hover/clickable affordance; navigable rows carry a chevron, non-navigable rows carry a dot and stay out of the tab order | a row looks identical whether or not it can be clicked |
| B4 | click a row | the editor reveals that symbol's line, from the row's machine-readable address rather than its display text | nothing happens, or the wrong file/line opens |
| B5 | switch the grouping, if offered | the same rows regrouped, the same counts, the same legend | a row disappears or a count changes silently |
| B6 | every row | each position is a declaration line that exists in that file; no row reads `:0`, `line 0` or `:1` as a stand-in | any row or edge displays a position the index does not contain |

**C — The tree** (*Call tree* in the graph panel).

| # | Do | See | Fails if |
|---|---|---|---|
| C1 | open the tree | a nested call tree; every node shows the symbol, its file:line and per-node counts | nodes are flat, or carry no counts |
| C2 | expand a node | children are that symbol's real usages, each keeping the parent you expanded | a child appears under a parent that does not own it |
| C3 | click a nested row | the editor reveals the clicked row's symbol | the reveal lands on the root instead of the clicked node |

**D — Call hierarchy** (*Show Call Hierarchy*).

| # | Do | See | Fails if |
|---|---|---|---|
| D1 | show the hierarchy of a symbol with callers and callees | incoming callers and outgoing callees, with ranges the editor can resolve | a caller is listed whose range does not resolve in the file it names |
| D2 | click a caller row, then press Enter | the caller's file opens with the caller revealed | the click selects a row and nothing opens, or a different symbol is revealed than the row you clicked |
| D3 | expand a caller and look at its child | the child's range is the invocation token at the call site | the child is labelled an exact call site while the store has none |

**E — Impact.**

| # | Do | See | Fails if |
|---|---|---|---|
| E1 | *Impact analysis* on a symbol with callers | the reverse-dependency set, each entry's file, and the declared budget/truncation state | an empty view for a symbol that has callers |
| E2 | *Impact analysis* on an instantiation | impact rendered through the **owning declaration**, with a visible note naming the resolution | the declared `not a traversable root` error appears, or the substitution is silent (no note) |

**F — Show all usages** (the hover's `+N more — show all usages` link).

| # | Do | See | Fails if |
|---|---|---|---|
| F1 | open it on a symbol with usages | either the editor's native references view **or** our usages list, with the rows revealed | a bare message and nothing else |
| F2 | do the same on a symbol used in another file | the list is grouped/labelled and every entry navigates | entries that do not navigate, or a truncated list with no declared truncation |

**G — Staleness.**

| # | Do | See | Fails if |
|---|---|---|---|
| G1 | edit an indexed file, then hover immediately | the card or status names the **stale** state while the reindex is pending | the card keeps claiming `fresh` after the edit |
| G2 | wait a second or two, hover again | the state returns to `fresh` | it never returns to fresh without a manual action |

**H — Status surface** (*Show status*).

| # | Do | See | Fails if |
|---|---|---|---|
| H1 | open the panel | every fact carries its claim level and its staleness marker; the server path, version and freshness state are named | a fact is stated with no claim level; a number is published that the panel cannot source |

**I — Address truth (M62).** The editor-visible half of M62 is *absence*: nothing
shows a position the index does not have.

| # | Do | See | Fails if |
|---|---|---|---|
| I1 | scan every surface from A–E for `:0`, `line 0` or `:1` used as a substitute | none; every position shown is a real line in a real file | any surface shows a position it cannot know |
| I2 | read the hub's rows for the machine-readable address kind | with a legacy store the kinds are `declaration` — never `call-site` | a row declares `call-site` while the store has no line |
| I3 | run `npx tsx script/m62/verify-consumers.ts` | every consumer renders through the address owner; the record names the kinds per consumer | a consumer bypasses the owner |
| I4 | index a project in a language whose analyzer stores real call-site lines, and repeat I2 | the same rows read `call-site` with no note — exact positions, no code change | the upgrade needs a consumer change (what M62's "no consumer rewrite" decision says must not happen) |

**J — The agent door (same truth, second reader).**

| # | Do | See | Fails if |
|---|---|---|---|
| J1 | from an agent session, call the `bb_graph` MCP tool for the same symbol as A1/B1 | every edge carries its call-site with a kind, and a note for every non-exact kind — the same values the human surfaces show | the two doors disagree on a position |
| J2 | do the same with `bb_impact` and `bb_cross_language` | the tool and the human surface agree on the same fixture | a disagreement between the doors (the defect M28's union gate exists to catch) |

**K — Onboarding a language or a project.** Run this for each language you
intend to add to the served set; it is the same five-check shape the M29 wave
protocol runs, driven by hand.

| # | Do | See | Fails if |
|---|---|---|---|
| K1 | `bb index` a project in the language | the index completes; *Show status* reports the workspace as indexed | the index is silent about a language it cannot analyze |
| K2 | hover a class, a method, a field and a call site | the card resolves for each kind and states its evidence tier | "symbol not in the index" for a symbol the file clearly declares |
| K3 | *Open in graph* on the same symbols | rows render, each declaring its address kind, counts matching | fabricated rows, or `:0` positions |
| K4 | *Show Call Hierarchy* and *Impact analysis* | both resolve through the owning declaration when the target is a member | the declared error path where a member should resolve through its owner |
| K5 | record the language, the project and the outcome | — | a language claimed as served with no recorded run |

### 4.4 Capturing a frame as evidence

- **Full window, not a crop.** The region of interest is read relative to the
  editor window; a crop loses the geometry that makes it checkable.
- **One frame per check**, named exactly as in the tables. If you take two, name
  the second `A1-…-2`.
- If a row you are claiming is **clipped** by the hover's max height, scroll the
  card inside its own bounds and capture that. A claim about a row that is not in
  the frame is not a claim (screenshot protocol §5).
- State, next to the frames, the **build** you tested: the `extension.js`
  timestamp from §4.1 and whether you reloaded the window after installing.
- Optional and valuable: the developer console filtered for `bb`
  (*Help → Toggle Developer Tools*). An error logged there is evidence even as a
  single line.

What happens with the frames: each one is checked against the machine record for
the same fixture (the hover text, the hub payload, the address kinds). A frame
and the record disagreeing is itself a finding, and the record wins.

### 4.5 Recording the verdict

For each block write **pass** / **fail** / **not tested**; for a fail, the frame
name, the build timestamp and what you expected. Where §8 is the reason, mark it
*known gap* rather than fail. The verdict belongs in this document when the pass
is done:

```
Verdict (<date>, build <extension.js timestamp>):
  A pass · B pass · C fail (C2: child under the wrong parent — C2-tree-expand.png) · D … · K1 not tested
  overall: <achieved / not achieved>
```

The achieved/not-achieved call is the owner's, never the gate's (contract §8.5).

## 5. Known open items

- **M25 `E6` per-fork block.** Cursor and Windsurf are not installed on this
  machine, so their records are `blocked` with the searched paths recorded. The
  bar accepts a blocked fork *with* a reason, and the ledger therefore shows
  `open` rather than claiming them. Antigravity is verified in-fork (90/90); its
  earlier "starts no extension host" reading was a runner defect (shell wrapper +
  Wayland), not the fork. **No owner waiver is needed and none was written** — a
  gate that grants its own waiver has no teeth.
- **`E7` darwin / windows** — CI-pending by design; `.github/workflows/os-matrix.yml`
  runs them on push to `main`. The Linux leg is the only one with a run behind it.
- **Windows and macOS legs are unverified in this environment.**
- **M55's lane protocol declares a pinned editor the frame rig does not launch.**
  The rig records this honestly (`pinHonored: false`, ambient `/usr/bin/code`) —
  see `docs/m55/SCREENSHOT-PROTOCOL.md` §2. Worth deciding which one is right.
- **`M29 X1` and `M55 G1`** record their own state in
  `validation/m29/results/X1.json` and `validation/m55/results/G1.json`. Read the
  record, not this page, for whether the pass is `verified` or a `known-gap` with
  a named precondition; the record names the precondition and the command that
  clears it.

## 6. How to read a failure

The single most useful habit from building this: **a precise failure message is
evidence of where to look, never of the cause.** Legs were red in this lane with
specific, plausible and wrong labels — a packaging leg that "needed a token"
(died on a read-only npm cache), an in-editor leg that "needed an external
fixture" (could not create a socket), an activation check that "found a missing
language" (matched literal source text against a derived list), an install leg
that "failed to tear down a profile" (the same socket), a milestone that
"invalidated its own evidence" (its ledger was listed as relevant to itself), a
fork that "does not start an extension host" (the launcher wrapper), a projection
that "read a record's status" while silently dropping its negative-case count (a
documented record shape the reader never implemented), and a closure leg that
"failed" (it was killed by a timer nobody had measured against).

Instrument before theorising. Printing the actual value ended nine rounds of
wrong hypotheses on one defect in a single run.

## 7. Reproducing a green chain from a cold tree

```
npm run build
npx tsx script/m29/generate-giant-corpus.ts
# same shell, because /tmp is per-shell in this environment:
npx tsx script/m29/giant-repo-budget.ts --index-only --reuse
npx tsx script/m29/giant-repo-budget.ts --reuse
npx tsx script/m24/verify-governance.ts      # then m25, m26, m27, m28 governance
npx tsx script/m29/verify-closure.ts         # runs the M24–M29 ladder itself, regenerates the
                                             # ledger, then re-runs the ledger consumers
```

If a consumer is red immediately after `verify-closure`, the cause is ordering:
the closure regenerates the ledger in pass 1b and re-runs R4/V1/D1 in pass 1c, so
a consumer run *before* the closure sees the previous generation. Run the closure,
commit the ledger and the records, then re-run `verify-precision-ledger`,
`verify-precision-improvements` and `verify-m29-docs`.

## 8. What this plan does not claim

- **References and call hierarchy navigate to the referencing symbol's own
  indexed location** (byte-accurate) and make **no** call-site claim; the exact
  stored call-site address is served by the graph, hub and MCP surfaces. Declared
  in M62.A2's `declaredNotChanged`.
- **The hover's usages list keeps its own declared vocabulary** (the referencing
  symbol's location), stated in its own header.
- **Per-language real call-site lines belong to the analyzers' lane (M59)**, not
  this one. M62 guarantees that whichever state the store is in is *interpreted*
  honestly; `script/m62/verify-arrival.ts` is the acceptance for M59's arrival.
- **`bb/graph` usages rows carry their address kind as a machine attribute**
  (`data-callsite-kinds`), not as visible text. The visible half of the claim is
  the absence of fabricated positions; the explicit half is readable through
  `script/m62/verify-consumers.ts`. If visible labelling is wanted, that is a new
  issue, not a defect in this milestone.
- **A CLOSED milestone is not a green tick by itself.** Read
  `validation/mXX/results/<CODE>.json`. The ledgers are projected from those
  records by their own governance gates, and `npm run verify:gate-wiring` reports
  any gate on disk that nothing runs.
