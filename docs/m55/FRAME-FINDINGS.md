# M55 frame findings — what the screenshots actually showed

Every entry below was read off a real frame, not inferred from code. The frames
come from the V1 rig (`script/m55/screenshot-protocol.ts`): it builds the VSIX,
installs it into an isolated profile, launches VS Code on the declared fixture
(`~/bb-demo-hub`, real index) on a virtual display, drives each declared flow,
and writes the frames under `validation/m55/frames/<run>/` with a manifest.

The frame paths named here are drift-gated: `script/m55/verify-live-surface.ts`
fails if one of them does not exist.

| Run | What it is |
|---|---|
| `filing-2026-09-12` | the hand-run rig's frames, from when the milestone was filed |
| `live-6` | first rig-driven run: **pre-fix** — this is where F1 was found |
| `live-7` | after the palette fix for `bb.openGraph` / `bb.openImpact` |
| `live-8` | first status-surface attempt (taught F9: the frame was a *different* command's) |
| `live-9` | `>`-prefixed palette drive (taught F9's second half: it ran "Toggle Panel Visibility") |
| `live-10` | first real status surface (taught F11: "I1 — I1 — protocol-passed") |
| `live-11` | F2 and F11 both fixed, read back by eye |
| `live-12` | the T1 closure frames added: the constructor card and the constructor graph |
| `live-13` | first attempt at the T2 activation leg — **removed from the tree**: the frame did not show what its label claimed (F13) |
| `live-14` | T1 and T3 closure frames captured, read back by eye, and gated by R2 |
| `live-15` | first mouse-click attempt — clicked the tree's root row (frozen coordinate; the lesson behind F13's "found, not frozen") |
| `live-16` | row-finding click driver lands on the caller row (selected, no navigation yet) |
| `live-17` | click + `Return` navigates the editor to `app.ts` with `main` selected — the T2 click frame |
| `live-18` | attempt at the call-site child hop — refused (no state change), flow removed |
| `live-19` | **current**: the full run (12 flows declared, 11 frames) whose click frame is the T2 evidence |

Runs `live-1`..`live-5` were rig development (blocked legs, byte-identical
frames) and were moved out of the tree to
`/tmp/bb-shots/superseded-rig-runs` rather than deleted.

---

## F1 — the hover actions dead-ended on the palette · FIXED

**Frames:** `validation/m55/frames/live-6/4-open-in-graph.png`,
`validation/m55/frames/live-6/5-impact.png`

Both show the workbench and, bottom-right, one error toast — not a panel:

```
bb_lsp: malformed bb.openGraph link (no symbol target).
bb_lsp: malformed bb.openImpact link (no symbol target).
```

Cause: a palette / context-menu invocation passes **no arguments**, so all three
symbol-scoped actions refused on the editor's own discovery surface. The
declared rule (issue #652) forbids the client from guessing identity, so the fix
asks the **server** for the identity at the cursor (the same `textDocument/hover`
the editor's hover uses) and converges both entry points in one argument source
(`ide/vscode/src/hover-action-args.ts`, pure).

**Verdict:** fixed and gated — `script/m55/verify-action-args.ts` 47/47 with
7/7 mutants (`validation/m55/results/V1-action-args.json`). Post-fix frames:
`live-7/4-open-in-graph.png`, `live-7/5-impact.png`.

## F2 — the status facts were collapsed into one line · FIXED

**Frames:** `validation/m55/frames/live-7/7-status.png` (the defect),
`validation/m55/frames/live-11/7-status.png` (the surface now)

`validation/m55/frames/live-7/7-status.png` shows the entire visible result of
the status flow as a single toast line:

```
launch: compiled dist (bundled) — $HOME/backbenc…
```

**Correction (honest record):** the first reading of this frame attributed it to
`bbLsp.showStatusPanel`. It was not — it was
`bbLsp.showServerStatus`, whose four facts (`launch:`, `server version:`,
`version ok:`, `activation:`) went into one notification and collapsed to its
first line. The *class* of defect is the same, and it was present in **both**
commands, so both are fixed:

- the facts `showStatusPanel` owns (server state, index phase, staleness,
  activation budget, per-language levels, this file's level) now render on a real
  panel — `ide/vscode/src/status-markup.ts` is the pure markup owner, the panel
  reuses the ONE webview shell, the ONE placement helper and the ONE reuse key;
- the facts `showServerStatus` owns are the surface's **server provenance**
  section, and that command now opens the same surface — one surface, one place
  to look, not two surfaces telling overlapping stories.

**Verdict:** fixed and gated — `script/m55/verify-status-panel.ts` 42/42 with
11/11 mutants (`validation/m55/results/V1-status-panel.json`), and the model's
own gate (`script/m25/verify-status-surface.ts`) retargeted and re-verified
32/32.

## F3 — the impact surface renders no header at all · OPEN

**Frames:** `validation/m55/frames/live-7/5-impact.png`,
`validation/m55/frames/live-11/5-impact.png`

The panel body starts directly with dependency rows
(`main (src/app.ts)`, `greetAll (src/greeter.ts)`, `describe (src/report.ts)`)
and ends with the legend. Reading `renderImpact` in `script/m26/graph-core.ts`
confirms this is not clipping: **the renderer emits no header element**. The
surface therefore does not state what it is showing — no root identity, no
count, and no bound (the depth/budget the set was computed under). The
truncation marker appears only when the set actually truncated, so a
non-truncated set never states the bound it was complete within.

Consequence: a reader cannot tell from the panel whether the list is complete.

**Verdict:** open — belongs with the surface redesign (U2): a header law (root
identity + declared counts + the bound) plus click affordances.

## F4 — hub rows do not look clickable · OPEN

**Frame:** `validation/m55/frames/live-11/4-open-in-graph.png`

The Hub renders file groups and symbol rows with relationship chips
(`calls ×1`, `⚙ enriched (consumer)`). It reads as a report: nothing says a row
is a target — no link styling, no hover state, no cursor change, no chevron.
The owner's own words when filing this milestone: "they just see text without
knowing that these are clickable".

**Verdict:** open — U2's first deliverable.

## F5 — the legend competes with the data · OPEN

**Frames:** `validation/m55/frames/live-11/4-open-in-graph.png`,
`validation/m55/frames/live-11/5-impact.png`

Both surfaces ship the full edge-tier legend, the enrichment key and the
staleness key **inside the scrolling body, below the data**. In the impact panel
(three rows of data) the legend is the majority of the surface, and with a long
list the staleness key is pushed out of view.

**Verdict:** open — U2 (declared, collapsible key; the staleness key belongs
next to the staleness marker, not in a glossary).

## F6 — the hover card can hide its own actions · OPEN (narrow)

**Frame:** `validation/m55/frames/live-6/3-hover-call-site.png`

The card is right about identity and vocabulary (see F8), but it scrolls and the
**actions row is its last line** — at the call site the captured card clips just
above it. The one row that is the point of the card should not be below the fold.

**Verdict:** open — U2 (actions first, or pinned).

## F7 — "3 callers · 2 callees" vs the listed rows · FIXED (asserted, not softened)

**Frame:** `validation/m55/frames/live-11/4-open-in-graph.png`

The header states `3 callers · 2 callees`; the by-file list shows five rows
(`map`, `main`, `greet`, `greetAll`, `describe`). `hub-panel.ts` says the header
counts are the **group** counts (§13.4, `callerGroups`/`calleeGroups`) and the
list is a different grouping of the same rows — which may be exactly right. That
is a claim for a machine assertion over a real index, not for a comment.

**It was exactly right, and it is now machine-checked.** R8 of
`script/m55/verify-live-surface.ts` renders the REAL `bb/graph` usages response
through the ONE renderer core and asserts three independent derivations agree:
the header number the eye reads, the number of rows rendered under it, and the
**server's own counts block** — in both directions. On the live fixture:

| Symbol | Header | Rows listed | Group vs row multiplicity |
|---|---|---|---|
| `Greeter` | `3 callers · 2 callees` | 3 + 2 = **5** | 3 groups / **4** caller rows |
| `greet` | `3 callers · 0 callees` | 3 + 0 = **3** | 3 groups / 3 rows |

The five rows the frame listed are accounted for by the two header numbers
exactly (3 caller groups + 2 callee groups). The multiplicity is a *separate*
declaration and is asserted too, so a header can never be read as a row count: the
live `Greeter` has 3 groups against 4 rows, which is why
`M12: a header that reads the ROW count as the group count` cannot pass
vacuously, and R8 fails loudly if the fixture ever becomes trivially consistent.
`M13` (a dropped group) and `M14` (a lying multiplicity) are planted against the
same rule.

**Verdict:** fixed — `script/m55/verify-live-surface.ts` R8 (V1: 77/77, 14/14
mutants); the live numbers above are read from `validation/m55/results/V1-probe.json`
at the evidence HEAD.

## F9 — what the palette actually matches (the rig was driving the wrong command) · FIXED

**Probe frames:** the palette's match list after typing each spelling (kept in
`/tmp/bb-shots/palette-probe/`; the finding is reproducible from the procedure
below).

Two runs captured a frame for a command the flow did not name:

- typing the **title** `Backbencher: Show status` selected
  `Backbencher: Show server status` first — so `live-8/7-status.png` shows
  *that* command's output while the flow claimed the other (F2's correction);
- typing **`>` + the id** (`>bbLsp.showStatusPanel`) was worse: the fuzzy
  matcher ranked **`View: Toggle Panel Visibility`** first, so `live-9/7-status.png`
  shows a toggled panel and an opened terminal.

The bare id (`bbLsp.showStatusPanel`, no `>`) ranks our own command first,
because the default palette mode fuzzy-matches the id too.

**Verdict:** fixed — the rig drives every command flow by bare id, and the
flow's own frame is the proof that the right command answered. (A title is not
an identifier; a `>` is not a safety net.)

## F10 — every palette title repeated its category · FIXED

**Probe frame:** the palette listing, showing
`Backbencher: Backbencher: Show status (evidence levels, staleness)`.

All 8 contributed commands carry `"category": "Backbencher"` **and** a title
that began with `Backbencher: `, so the palette read
`Backbencher: Backbencher: …` — while `docs/m25/INSTALL.md` tells the user to run
`Backbencher: Show status`. The docs were right and the manifest was wrong.

**Verdict:** fixed — the 8 titles no longer repeat the category, so the palette
reads exactly what the docs say. Gated by S5b in
`script/m55/verify-status-panel.ts` (mutant M9).

## F11 — the status surface stated each level twice · FIXED

**Frame:** `validation/m55/frames/live-10/7-status.png` (the defect),
`validation/m55/frames/live-11/7-status.png` (fixed)

The first real status surface rendered the per-language table as
`java  I1 — I1 — protocol-passed`: the level is a machine fact on the row
(`data-level`) and it is also the first thing `description` says
(`describeLevel()` renders `${level} — ${meaning}`). A fact stated twice reads
as a broken surface.

**Verdict:** fixed — the row renders the description once, keeping the level as
the row's machine attribute. Gated by S1 in
`script/m55/verify-status-panel.ts` (mutant M10).

---

## F8 — what the frames confirm as working · VERIFIED

- **Hover identity is right at call sites** — `live-6/3-hover-call-site.png`
  shows the card for `greet` while the cursor sits on `g.greet(name)` in
  `report.ts`, with `3 usages (usage sites only; declaration and callees
  excluded)`, the tier story, three usage rows and the actions row. (T1/T3/T4/T5)
- **The Hub renders real data** — `live-11/4-open-in-graph.png`: file groups,
  per-row relationship chips, the file-level exports note, the shared legend.
  (T3/T5/P1)
- **The native call hierarchy is a good surface** —
  `live-7/6-call-hierarchy.png`: `Callers of 'greet'` with
  `main function · calls · 1 call site`, `greetAll method · calls · 1 call site`,
  `describe function · calls · 1 call site`, and inline source previews. (T2)
- **Panels land as a tab in the current group and do not steal the cursor** —
  `live-11/7-status.png` shows the Status tab open with the Hub and Impact tabs
  kept and `greeter.ts` back on screen. (P1)
- **The constructor case, framed at this HEAD (T1's closure requirement)** —
  `validation/m55/frames/live-14/8-ctor-hover-declaration.png`: the card reads
  `public constructor(prefix: string)` /
  `constructor — constructor, 0 usages (usage sites only; declaration and
  callees excluded)` / `evidence: structural` / the three actions / `source: bb
  index (…/src/greeter.ts:7)`. And
  `validation/m55/frames/live-14/9-ctor-open-in-graph.png`: the panel
  tab is titled `Backbencher Hub — constructor → Greeter (owning declaration)`,
  the body carries the declared note `"constructor" has no graph of its own —
  showing the usages of its owning declaration Greeter`, then the rows grouped by
  file. The owner's filing frame (`s10-ctor-graph.png`) captured this same case
  as a **silent** relabel; at this HEAD it is labeled, on screen, in a fresh
  install. (Also visible: the header's `3 callers · 2 callees` and the five rows
  — the F7 case, now machine-asserted by R8.)
- **The zero-usage case, framed at this HEAD (T3's closure requirement)** —
  `validation/m55/frames/live-14/10-hover-zero-usages.png`: the card for `greetAll` reads
  `greetAll — method, 0 usages (usage sites only; declaration and callees
  excluded)` with **no usages list**, and its callee appears only in the
  separately-labelled `connected:` line (`calls greet · role consumer · layer
  core→core · 4 referring rows`). A zero-usage symbol never renders its callees
  or its owning class as usages.
- **The status surface states what it claims** — `live-11/7-status.png`:
  `FACTS (EACH LINE STATES WHAT IT IS AND WHERE IT CAME FROM)` →
  `server: running (0.3.0)`, `index: ready`, `active file: fresh (reindexed)`,
  `activation: 117ms (declared budget 150ms)`, `this file (typescript): I1 —
  protocol-passed`; then `SERVER PROVENANCE (WHICH BINARY IS ANSWERING, AND WHAT
  STARTING IT COST)` with the launch path, version, version verdict and cost;
  then `PER-LANGUAGE EVIDENCE LEVELS (DECLARED, DRIFT-GATED) — 7 LANGUAGE(S)`.
  (Truth Rule 1)

## F13 — the call-hierarchy click leg · OPEN (narrow: ONE hop left)

T2's closure requirement reads: *"in-editor leg: the native Call hierarchy view
opened from a hover shows the expected callers and clicking one lands on the CALL
SITE with the correct symbol highlighted (frame + machine assertion)"*. Four
attempts, recorded in full because the negative results are what the next attempt
needs:

| Attempt | Driver | Result |
|---|---|---|
| `live-13` (removed) | `Down` + `Return` on the keyboard | the keys never reached the tree: no call-hierarchy view in the frame, cursor still on `greeter.ts:15` |
| **`live-20` (KEPT)** | a real **mouse click** on the caller row FOUND in a scratch frame, then `Return` | **navigated**: the editor opens `app.ts` with `main` **selected** (`Ln 6, Col 21 — 4 selected`), i.e. the caller the row named, with the correct symbol highlighted |
| `live-17` / `live-19` (dropped) | the same click followed by `Right`, `Down`, `Return` | **flaky, and one of the two results was a lie the gate then accepted** (see F14): `live-17` navigated, `live-19` did NOT — there the click had not taken the row selection, so the keys went to the EDITOR (a newline in `greeter.ts`, dirty dot, cursor on line 15). The two extra keys bought nothing and could damage the file, so the gesture is now the click plus the single activation key |
| `live-18` / `live-19` (removed) | click the caller, `Right` to expand, `Down` onto its call-site child, `Return` | the rig's own "did the workbench change?" check refused the frame twice — re-issuing the call-hierarchy command in a following flow produced no state change, so there was no frame to read |

**The click coordinate is FOUND, not frozen.** The first mouse attempt
(`live-15`) froze a y-coordinate measured from an earlier run and clicked the
tree's **root** row: the tab strip's height shifts the tree by ~30 px between
runs. The rig now captures a scratch frame, reads the region's text rows with a
`rows` subcommand of `script/m55/pixel-read.py`, and clicks the row it found
(and refuses — with a reason — when the row is not there).

**The rig now refuses to record a frame that did not navigate**, and the gate
refuses to pass one: the shared rule in `script/m55/navigation.ts` (a navigation
changes the editor's TOP lines; a cursor move is confined to a band) is applied
by the rig BEFORE the frame is written and by V1's R2 afterwards, so the two can
never disagree about what a frame proves.

**What is proven at this HEAD:**

- the native Call hierarchy renders the expected callers for `greet`
  (`validation/m55/frames/live-20/6-call-hierarchy.png`: `main function · calls · 1
  call site`, `greetAll …`, `describe …`), and
- clicking one navigates the editor to that caller with the correct symbol
  selected (`validation/m55/frames/live-20/11-call-hierarchy-click.png`), gated by
  V1's R2 (the editor's top lines must change — the run's own measured box is
  `y=0, height=288`, inside the declared `≤40 / ≥120 px` rule, and the rig's
  pre-click scratch frame is the baseline the diff is taken against);
- the CALL SITES themselves are machine-asserted in
  `script/m55/verify-call-hierarchy.ts`: every `fromRange` the server returns
  resolves to the **invocation token** in the source bytes, and the view's inline
  preview renders the same call site (`// greet call site 1` at `app.ts:12` in the
  frames above).

**What is NOT proven:** the second hop — expanding a caller onto its call-site
child and activating that — is not framed. The requirement names the call site,
and the frame shows the caller's declaration; the difference is declared here
rather than smoothed over.

**Verdict:** open (narrow) — one hop. The driver needs the tree's child rows
driven in the SAME flow that opens the view (the rig's change check refuses a
frame when a repeated command changes nothing), or a window manager so the view
keeps focus between flows.

## F14 — the gate accepted a frame that never navigated · FIXED (asserted, not softened)

Found by reading `live-17/11-call-hierarchy-click.png` and
`live-19/11-call-hierarchy-click.png` **side by side** after the ledger claimed
the click leg was gated:

| Frame | What it shows | V1's R2 said |
|---|---|---|
| `validation/m55/frames/live-17/11-call-hierarchy-click.png` | `app.ts` open, `main` selected — the navigation | pass (correct) |
| `validation/m55/frames/live-19/11-call-hierarchy-click.png` | `greeter.ts` still open, dirty dot, cursor on line 15 — **no navigation** | **pass (wrong)** |

R2's assertion was "the editor region changed", and a cursor move changes the
editor region too, so the leg passed both. Worse, the run read was the NEWEST
run by timestamp (`live-19`), so the gate was verifying the lying frame while the
good one went unread.

**Fix, two halves, one rule:**

- `script/m55/navigation.ts` owns the decision — a navigation changes the
  editor's TOP lines (measured: `y=0, height=288`), a cursor move is a band
  (measured: `y=196, height=95`); the region (`[0.19, 0.08, 0.63, 0.27]` of the
  window) and the thresholds are declared there, not inlined at the call sites;
- the rig applies it to the pre-click scratch frame versus the post-click screen
  and records the flow as **blocked with that reason** instead of writing a frame
  it cannot stand behind; V1's R2 applies it to the recorded frame and fails.

Gated by mutants **M16** (the exact `live-19` numbers — a cursor band) and
**M17** (no change / unreadable frame), plus a positive control that the measured
navigation box still passes, so an over-strict threshold cannot silently redden
every run. The flow's label was corrected in the same pass: it said "lands on the
CALL SITE", and the frame shows the caller's **declaration** — the label now says
what the frame shows (see the F13 verdict for the call-site nuance).

## F12 — the blocked path (a missing fixture) · VERIFIED

**Record:** `validation/m55/results/V1-blocked-path.json`

V1's closure requires the external-fixture blocked path proven: run with the
fixture absent and the session must come back **blocked with a reason, never
green**. R7 runs the real rig against a workspace that does not exist
(`--fixture validation/m55/.blocked-path-fixture-absent`) and asserts the four
things a blocked record must say: status `blocked`, the missing fixture named as
the reason, zero captured flows, and no frames directory written. `M11` plants
the defect (a blocked session reported as captured).

This matters because the fixture is external by owner decision and is not
vendored: on a machine without it, the honest outcome is a declared blocked leg,
and this is the machine proof that the rig does that rather than producing a
plausible-looking green run.

**Verdict:** verified — `script/m55/verify-live-surface.ts` R7 (V1: 77/77,
14/14 mutants).
