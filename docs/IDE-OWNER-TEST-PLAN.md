# The IDE lane — owner test plan (M24 → M62)

This is the **owner's** pack: what to click, hover and open, what the editor must
show, what counts as a failure, and which frame to capture for each check. The
achieved/not-achieved verdict is the owner's, never the gate's (IDE Honesty
Contract §8.5) — this document exists so that verdict can be made on evidence
instead of on memory.

Machine evidence for every claim below already exists and is listed in §6. What
this pack adds is the **human** leg: your eyes, on the build at this HEAD.

---

## 0. The rule that makes a test valid (do this first)

A claim about the editor is a claim about **the installed bundle** (Truth Rule 5,
`docs/m55/SCREENSHOT-PROTOCOL.md`). Check what is installed right now:

```bash
ls -l --time-style=+%F_%H:%M ~/.vscode/extensions/backbencher.bb-lsp-vscode-0.1.0/dist/extension.js
```

On the audit machine that file is from **2026-09-12**, which predates M55, M61
and M62 entirely. Testing with it would test a build that no longer exists in
the repository, and every finding would be a finding about a six-week-old
bundle. Install the build at the current HEAD:

```bash
cd $HOME/backbencher-brain
npm run build                                     # dist/lsp/server.js (the server under test)
cd ide/vscode
node ./esbuild-extension.mjs                      # extension bundle + staged server
node ./collect-server-deps.mjs                    # the bundled server's runtime deps
npx --yes @vscode/vsce package --allow-missing-repository --no-git-tag-version
code --install-extension bb-lsp-vscode-0.1.0.vsix --force
```

Then in VS Code: **Developer: Reload Window**. Sanity check before any test:
the status bar badge must read `bb` (any other badge — `bb: version`,
`bb: no index`, `bb: server down` — is itself a finding to report);
`Backbencher: Show status` must open and report the server as running with a
version.

> If `code --install-extension` writes into your real profile, that is
> intentional here — it is how you test what you ship. The isolated frame rig in
> §6 does the same thing inside `validation/m55/profile` without touching it.

---

## 1. The fixture, and what the HEAD server returns for it today

Fixture (owner decision 2026-09-12, protocol §3): **`$HOME/bb-demo-hub`,
used as-is**, indexed by the owner's real `BB_DATA_DIR` (`~/.bb`). Its index was
written by an **older indexer** — every stored call-site line is the literal `0`.
That is not a problem for this run: it is exactly the state M62 exists to
interpret honestly, so it exercises the fix rather than avoiding it.

Baseline recorded at this HEAD by `script/m55/lsp-wire.ts`-driven probe
(`$HOME/m62-wire-probe.json`, reproduced by the command in §6):

| Surface | What the server returns now |
|---|---|
| hover `greet` (declaration, `src/greeter.ts:11`) | `public method greet(name: string) → string`, `**greet** — method, 3 usages`, `evidence: structural, usage_contextual`, `connected:` main / greetAll / describe, a source line, `stale: false` |
| hover `greet` (call site, `src/app.ts:12`) | the *same* identity and the same card (no second identity for the call site) |
| hover `constructor` (`src/greeter.ts:7`) | `public constructor(prefix: string)`, `constructor — constructor, 0 usages`, actions `Open in graph` · `Impact analysis` |
| hover `greetAll` | 0 usages — a declared absence, never the callees or the owning class |
| `bb/graph` usages `greet` | 3 caller groups (main, greetAll, describe) / 3 rows |
| `bb/graph` usages `constructor`, `render` | 6 rows each |
| every row's address | `kind: "declaration"` with note `this is the calling symbol's declaration, not the call site`; **zero rows with `line: 0`** — because the store only holds the legacy `0`, the exact call site is *unknown*, and the address says so |

That last line is the M62 claim in one sentence: **the store does not know the
call-site position, and no surface pretends it does.** Everything visible is a
labelled substitute or the symbol's own location.

Server capabilities advertised at this HEAD: `hoverProvider`,
`definitionProvider`, `referencesProvider`, `documentHighlightProvider`,
`documentSymbolProvider`, `workspaceSymbolProvider`, `callHierarchyProvider`,
`graphProvider` (the private `bb/graph` + `bb/staleness` requests ride on this).

---

## 2. The test blocks

Each block: **do → see → FAILS IF → frame to capture**. Capture the frame at the
moment described; name it exactly as given so the names can be matched against
this document later.

### Quick path (≈15 minutes)

Blocks **A1, A2, A4, B1, B2, D1, I1, I2**. They carry the highest claim density:
the hover card, the hub, the call hierarchy, and the address truth.

### A — Hover

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| A1 | Hover `greet` at its declaration (`src/greeter.ts:11`) | signature block, `**greet** — method, 3 usages`, `evidence:`, `connected:` links, `usages` list, `actions:` row, a `source:` line naming `bb index` and the file:line | the card shows no `evidence:`; a position appears that the index cannot know; the card is clipped so a claimed row is not visible | `A1-hover-declaration.png` |
| A2 | Hover `greet` at the call site in `src/app.ts:12` (`g.greet(name)`) | the **same** identity and the same card as A1 — one symbol, not two | the call-site hover resolves a *different* symbol, or shows a member/owner that is not `greet` | `A2-hover-call-site.png` |
| A3 | Hover `constructor` at `src/greeter.ts:7` | `public constructor(prefix: string)`, `0 usages`, actions `Open in graph` · `Impact analysis` | `Impact analysis` is missing, or the card claims usages that do not exist | `A3-hover-constructor.png` |
| A4 | Hover `greetAll` at `src/greeter.ts:15` | `0 usages` **and no list** — absence declared, nothing invented | a list of callees or the owning class appears in place of the usages | `A4-hover-zero-usages.png` |
| A5 | Hover any symbol in `src/render.ts` / `src/store.ts` that has **cross-language** stored rows (the card's `cross-language` section) | the section states the target language and the bridge mechanism, and is *absent* when no such rows are stored | a cross-language claim appears with no stored row behind it | `A5-hover-cross-language.png` |

### B — The hub (`Backbencher: Open in graph`, or the hover's `Open in graph` action)

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| B1 | `Greeter: Open in graph` → the hub list, grouped **by file** | group headers with per-group counts; the header counts equal the number of rows rendered below them; the summary line reads `N callers · M callees` | a header count differs from the rows the eye can count (§13.4) | `B1-hub-list-by-file.png` |
| B2 | read the legend | **one** legend: the five evidence tiers **+** the enrichment chip **+** the staleness marker, each with its meaning | two legends, or a badge in the rows whose tier is not in the legend | `B2-hub-legend.png` |
| B3 | move the mouse over a row, then over a chevron | the row shows a hover/clickable affordance; navigable rows carry a chevron `›`, non-navigable rows carry `·` and stay out of the tab order | a row looks identical whether or not it can be clicked (this was a filed complaint) | `B3-hub-affordance.png` |
| B4 | click a row | the editor reveals that symbol's line (`data-file` / `data-line`, not the display text) | nothing happens, or the wrong file/line opens | `B4-hub-click-reveal.png` |
| B5 | switch the grouping (by caller) if the view offers it | the same rows regrouped, the same counts, the same legend | a row disappears or a count changes silently | `B5-hub-list-by-caller.png` |
| B6 | every row of the list | each row's position is a **declaration** line that exists in that file; no row reads `:0`, `line 0`, or `:1` as a stand-in | any row or edge displays a position the index does not contain | `B6-hub-rows-no-bogus-line.png` |

### C — The tree (`Call tree` in the graph panel)

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| C1 | open the tree view | a nested call tree; each node shows the symbol, its file:line, and **per-node counts** | nodes are flat (no nesting) or carry no counts | `C1-tree.png` |
| C2 | expand a node | children are the symbol's real usages; the parent of each child is the node you expanded (each row keeps its own parent) | a child appears under a parent that does not own it | `C2-tree-expand.png` |
| C3 | click a nested row | the editor reveals that row's symbol | the reveal lands on the root instead of the clicked node | `C3-tree-click.png` |

### D — Call hierarchy (`Backbencher: Show Call Hierarchy`)

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| D1 | `Show Call Hierarchy` on `greet` | incoming callers (main, greetAll, describe) and outgoing callees, with the declaring ranges the editor can resolve | a caller is listed whose range does not resolve in the file it names | `D1-call-hierarchy.png` |
| D2 | click a caller row, then press Enter | the editor opens the caller's file with the caller revealed | the click selects a row but nothing opens (the live-19 failure mode), or a *different* symbol is revealed than the row you clicked | `D2-call-hierarchy-click.png` |
| D3 | expand one caller, look at its child | the child's range is the invocation token at the call site (the wire asserts this: every `fromRange` resolves to the invocation) — note the editor's own *landing* is the caller's declaration, see §5 | the child is labelled as an exact call site while the store has none | `D3-call-hierarchy-expand.png` |

### E — Impact (`Impact analysis`)

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| E1 | hover `greet` → `Impact analysis` | the reverse-dependency set (main, greetAll, …) with each entry's file and the declared budget/truncation state | an empty view for a symbol that has callers | `E1-impact-greet.png` |
| E2 | hover **`new Greeter(...)`** (`src/app.ts:7`) → `Impact analysis` | the impact renders, rooted through the **owning declaration**, with a visible note naming the resolution; the old `symbol "constructor" is not in the index` error must not appear | the declared error appears, or the substitution is silent (no note) | `E2-impact-constructor.png` |

### F — "Show all usages" (from the hover's `+N more — show all usages` link)

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| F1 | hover `render`, click `show all usages` | either the editor's native references peek **or** our usages list — and if the editor has no native references view, the fallback list opens with the rows revealed | a bare message and nothing else (dead end; this was a filed complaint) | `F1-show-all-usages.png` |
| F2 | do the same on a symbol with usages in another file | the list is grouped/labelled and each entry navigates | entries that do not navigate, or a truncated list with no declared truncation | `F2-usages-multifile.png` |

### G — Staleness (`bb/staleness`)

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| G1 | edit `src/greeter.ts` (add a blank line), then immediately hover | the card/status names the **stale** state while the reindex is pending | the card keeps claiming `fresh` after the edit | `G1-stale-marker.png` |
| G2 | wait ~1–2 s, hover again | the state returns to `fresh` | it never returns to fresh without a manual action | `G2-fresh-again.png` |

### H — Status surface (`Backbencher: Show status`)

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| H1 | `Backbencher: Show status` | every fact carries its claim level and its staleness marker; the server path, version and the freshness state are named | a fact is stated with no claim level; a number is published that the panel cannot source | `H1-status.png` |

### I — M62 address truth (the milestone closed at this HEAD)

The editor-visible half of M62 is *absence*: nothing shows a position the index
does not have. The machine half is explicit and readable.

| # | Do | See | FAILS IF | Frame |
|---|---|---|---|---|
| I1 | look at every surface from A–E and search the screenshots for `:0`, `line 0`, `:1` as a substitute | none. Every position shown is a real line in a real file | any surface shows a position it cannot know | `I1-no-fake-position.png` |
| I2 | in the hub, the row that represents a caller carries the machine-readable address kind (`data-callsite-kinds` = `declaration` for this legacy index). Readable two ways: `npx tsx script/m62/verify-consumers.ts` names the kinds per consumer, and the probe of I3 prints them per row | with the legacy store, the kinds are `declaration` — never `call-site` | a row declares `call-site` while the store has no line (that is the exact lie M62 removed) | `I2-callsite-kinds.png` (optional) |
| I3 | run the probe (§6) | `zeroLineRows: 0`, every row `kind: "declaration"` with the note `this is the calling symbol's declaration, not the call site` | any row with `addrLine: 0`, or a `call-site` kind without a positive line | paste the probe output |
| I4 | index a **Scala** project (the one analyzer that stores real call-site lines today) and repeat I2/I3 on it | the same rows now read `kind: "call-site"` with no note — exact positions, **no code change and no re-verification of M62** | the upgrade needs a consumer change (that is what M62's "no consumer rewrite" decision claims must not happen) | `I4-scala-exact-callsites.png` |

### J — The agent door (same truth, second reader)

| # | Do | See | FAILS IF | Frame / output |
|---|---|---|---|---|
| J1 | from an agent session on this repo, call the `bb_graph` MCP tool for `greet` | every edge carries `callSite` with a `kind`, and a `note` for every non-exact kind — the **same** values as I3 | the agent-facing payload shows a bare `file:line` for an address the human surfaces label (the two doors disagreeing is the defect M28's union gate exists to catch) | paste the tool output |
| J2 | same for `bb_impact` / `bb_cross_language` on the same symbol | the human surfaces and the tool agree on the same fixture | — | paste the tool output |

### K — Onboarding a language or a project (wave legs)

Run this for each language you intend to add to the served set. It is the same
five-check shape the M29 wave protocol runs; here you drive it by hand.

| # | Do | See | FAILS IF |
|---|---|---|---|
| K1 | `bb index` a project in the language (or use an existing index) | the index completes; `Backbencher: Show status` reports the workspace as indexed | the index is silent about a language it cannot analyze |
| K2 | hover a class, a method, a field, a call site | the card resolves for each kind; the evidence tier is stated | "symbol not in the index" for a symbol the file clearly declares |
| K3 | `Open in graph` on the same symbols | rows render; each row declares its address kind; counts match | fabricated rows, or `:0` positions |
| K4 | `Show Call Hierarchy` and `Impact analysis` | both resolve through the owning declaration when the target is a member | the declared error path (`not a traversable root`) where a member should resolve through its owner |
| K5 | record the language, project, and the outcome | — | a language claimed as served with no run recorded anywhere |

---

## 3. How to capture frames (so a frame becomes evidence)

- **Full window**, not a crop: the region of interest is read relative to the
  editor window, and a cropped frame loses the geometry that makes it
  checkable.
- **One frame per check**, named exactly as in the tables (`A1-…`, `B4-…`).
  If you take two, name the second `A1-…-2`.
- If a row you are claiming is **clipped** by the hover's max height, scroll the
  card inside its own bounds and capture that — a claim about a row that is not
  in the frame is not a claim (§5 of the screenshot protocol).
- State, next to the frames, the **build** you tested: the `extension.js`
  timestamp from §0 and whether you reloaded the window after installing.
- Optional but valuable: the VS Code developer console filtered for `bb`
  (`Help → Toggle Developer Tools`) — an error logged there is evidence, even a
  single line.

What I do with the frames: each one is checked against the machine record for
the same fixture (the hover text, the hub payload, the address kinds — §6). A
frame and the wire disagreeing is itself a finding, and the wire wins.

---

## 4. What is *not* claimed (so a gap is not mistaken for a regression)

- **References and call hierarchy navigate to the referencing symbol's own
  indexed location** (byte-accurate) and make **no** call-site claim; the exact
  stored call-site address is served by the graph / hub / MCP surfaces. Declared
  in M62.A2's `declaredNotChanged`.
- **The hover's usages list keeps its own declared vocabulary** (the referencing
  symbol's location), stated in its own header.
- **Per-language real call-site lines are M59's lane** (analyzers), not this
  lane's. Today only the Scala analyzer stores real lines; M62 guarantees that
  whichever state the store is in is *interpreted* honestly, and
  `script/m62/verify-arrival.ts` is the acceptance for M59's arrival.
- **`bb/graph` usages rows carry their address kind as a machine attribute**
  (`data-callsite-kinds`), not as visible text. The visible half of the claim is
  the absence of fabricated positions; the explicit half is readable through the
  probe (§6). If visible labelling is wanted, that is a new issue, not a defect
  in this milestone.
- **M55's lane protocol declares a pinned editor the rig does not launch.** The
  frame rig records this honestly (`pinHonored: false`, every run to date,
  ambient `/usr/bin/code`), but `docs/m55/SCREENSHOT-PROTOCOL.md` §2 says the
  pinned 1.85.0 build. The rig, not the doc, matches your machine — worth
  deciding which one is right.
- **Windows and macOS legs are unverified in this environment**; the Linux leg
  is the only one with a run behind it.
- **A "CLOSED" milestone on this page is not a green tick.** M24, M25, M26, M29,
  M44 and M55 are all closed on GitHub while carrying at least one red evidence
  record. Read `validation/mXX/results/<CODE>.json`. The gate that enforces this
  distinction is `npm run verify:gate-wiring` (§6a).
- **M27 and M28 are honest-red, not broken.** Their `N1`/`A2` legs need nvim,
  which the last audit host did not have; the records say `blocked` with the
  reason, which is the correct answer (§8.3).

---

## 5. My baseline run at this HEAD (for comparison)

An isolated, protocol-following capture was taken at the closing commit of M62
(`c738d603`, clean tree) with the **same** installed bundle you are about to
install:

- frames: `validation/m55/frames/owner-test-2026-09-21/` — **11/11 captured**
  (`1-base` … `11-call-hierarchy-click`), plus `session.json` with the bundle
  hash, the fixture content hash, and the panel geometry of every frame;
- editor: ambient `/usr/bin/code` 1.138.0 (`pinHonored: false` — see §4);
- fixture: `$HOME/bb-demo-hub`, `contentHash 68ec1d0c…`, index
  `693ac0d2…` — the same legacy `0` store as §1;
- the wire probe record: `$HOME/m62-wire-probe.json`.

Where your frame and mine differ, the difference is the finding — capture the
same flows (`1-base`, `2-hover-declaration`, `4-open-in-graph`, `5-impact`,
`6-call-hierarchy`, `7-status`, `9-ctor-open-in-graph`, `10-hover-zero-usages`)
and they can be read side by side.

## 6. Reproducing the machine record

```bash
cd $HOME/backbencher-brain
npm run build                                     # dist/lsp/server.js at HEAD
npx tsx $HOME/m62-wire-probe.mts        # hover + bb/graph + bb/impact + references
npx tsx script/m55/screenshot-protocol.ts --run owner-test-$(date +%F) \
  --out validation/m55/frames/owner-test-$(date +%F)/session.json
```

The M62 milestone's own gates, each re-runnable and each able to fail:

```bash
npx tsx script/m62/verify-governance.ts   # G1: the ledger + the bar re-audit
npx tsx script/m62/verify-address.ts      # A1: the address owner
npx tsx script/m62/verify-consumers.ts    # A2: every consumer renders through the owner
npx tsx script/m62/verify-arrival.ts      # A3: the M59 arrival hook + the generated doc
npx tsx script/m62/verify-closure.ts      # X1: M62 + the whole IDE lane at one HEAD
```

## 6a. Gate reachability — check before you trust any "CLOSED" in this program

A gate nothing runs is not a gate, and this program had a long stretch where that
was true of whole lanes. One command tells you the current state:

```bash
npm run verify:gate-wiring      # script/m61/verify-orphan-gates.ts
```

It prints the census (verifiers on disk, how many are wired, how many are
declared-unwired), reads every lane ledger and reports any that claims `verified`
over a record that reads `known-gap`/`blocked`, and asserts that the wiring
`src/lsp/call_hierarchy.ts` and `src/lsp/identity.ts` name as their protecting
gates is real. Evidence lands in `validation/m61/results/V5.json`; the declared
orphan list with a reason each is
[`script/m61/orphan-baseline.json`](../script/m61/orphan-baseline.json).

**When you read a milestone's status in this repo**, read the record, not the
ledger entry: `cat validation/mXX/results/<CODE>.json | grep '"status"'`. Since
this program's gate-wiring pass the M27, M28 and M55 ledgers are *projected*
from their records by their own governance gates, so their entries now tell the
truth automatically. The M20, M24, M25, M26, M29, M42, M44, M45 and M61 ledgers
are still hand-maintained and still carry `verified` over red records — treat
those ledgers as unverified until their lanes project them, and let
`verify:gate-wiring` tell you which ones.

### The audit host this plan was last checked against (2026-10-05)

macOS 14.8.4, Darwin x86_64, 12 cores / 16 GB, Node v22.14.0, **bun absent**,
**no VS Code, Cursor, Antigravity or Windsurf installed**, no nvim/zed/helix on
PATH. On that host: every in-editor leg (A1–J2, K1–K5) is `blocked` — there is
nothing to click — and `script/m24/verify-harness.ts`'s `bun` leg is `blocked`.
The M55 frame rig's `pinHonored: false` note in §4 applies: the rig records the
ambient editor it actually found, which on the owner's Linux box was
`/usr/bin/code` 1.138.0 rather than the pinned 1.85.0 build.

## 7. Recording your verdict

For each block, write one of **pass** / **fail** / **not tested**, and for a
fail: the frame name, the build timestamp, and what you expected. Where a check
in §4 is the reason, mark it *known gap* rather than fail. The verdict line
belongs in this document when you are done:

```
Verdict (owner, <date>, build <extension.js timestamp>):
  A pass · B pass · C fail (C2: tree child under wrong parent, C2-tree-expand.png) · D … · K1 not tested
  overall: <achieved / not achieved>
```
