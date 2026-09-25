# IDE Honesty Contract — Vocabulary, Claim Levels, and Lie Catchers

Status: **RATIFIED — this document governs all Backbencher IDE program work
(milestones M24–M29, amended for M42+ by §12). Every IDE issue, evidence file,
commit message, and summary MUST comply with it. No exception without a
written amendment in this file.**

Sibling of `docs/M14-HONESTY-CONTRACT.md` (analyzer layer). Where M14 governs
what the index claims, this contract governs what the **user-facing IDE
surface** claims. It is stricter, because a hover is read by humans who cannot
see the evidence file behind it.

## 0. Why this exists

An IDE integration makes promises at keystroke time: "this symbol has 14
callers", "this function is called from the Kotlin service", "this edge is
inferred". Each of those is a claim. If the index is stale, if a position is
off by one, if an edge is a heuristic guess rendered as fact — the user is
being lied to in the most intimate place software has: their editor.

The M13/M14 lesson applies with more force here: the same agent writes the
feature, the test, the evidence, and then reports the verdict. This contract
makes honesty a property of the pipeline. Only a harness that can fail may
emit a verdict, and every user-visible claim must trace to machine-emitted
evidence.

Scope: `src/lsp/`, `ide/` (extension hosts, webviews), LSP protocol surface,
`script/m24/` … `script/m29/`, `script/m42/`, `validation/m24/` …
`validation/m29/`, `validation/m42/`, and all IDE program docs.

## 1. Vocabulary rules for IDE claims

The M14 banned list applies (perfect/perfection, complete/completed,
production-ready, bulletproof, rock-solid, battle-tested, extensively tested,
thoroughly reviewed, should work, expected to pass, unscoped "green", unscoped
"100%"). Additional IDE-specific rules:

| Banned pattern | Why | Required instead |
| --- | --- | --- |
| "works in Cursor/Windsurf/…" (without a pinned run) | A fork claim is a measured fact, not a hope | "verified in <editor> <version>, evidence <path>" |
| "IDE-grade", "IntelliJ-like" | Comparative marketing, not measurement | Name the feature and its claim level |
| "real-time" | Unmeasured timing promise | State the measured budget and staleness policy |
| "seamless" | Hides the failure modes | Declare the failure modes |
| "all languages" (for an IDE feature) | Hides the per-language denominator | "verified for <list>; declared for <list>" |

Note: the v5 milestone is named **Precision Waves**, not "Perfection Waves" —
renamed at planning time because "perfection" is banned vocabulary. The
ambition is unchanged; the word was the problem.

## 2. Claim levels for the IDE surface

Every user-visible IDE capability carries exactly one machine-checked level.
Higher levels require all lower ones.

### I0 — UNVERIFIED
Default. May be developed; may not ship behind any trust label.

### I1 — PROTOCOL-PASSED
The capability passes an LSP-level verifier: a reference client harness issues
real protocol requests against `bb lsp` and asserts response shape and
content on fixtures. Precondition: harness exists under `script/mXX/`, has at
least one positive and one negative case, and can fail.

### I2 — INDEX-CONFORMANT
I1, and the backing analyzer is #419-CONFORMANT (or its evidence level is
declared next to the result), and the position-mapping gate and freshness
gate pass for the language. Precondition: `script/mXX/verify-positions.ts`
and freshness gate green at current commit.

### I3 — EDITOR-VERIFIED
I2, and the capability is exercised end-to-end in a named editor at a pinned
version (VS Code first), with the run recorded in evidence: editor version,
OS, workspace fixture, assertions, timestamp.

### I4 — FORK-VERIFIED
I3 for a named fork: Cursor, Windsurf, Antigravity, or any other VS Code
fork, each **separately** claimed with its own pinned version and run. A
claim for one fork never implies another. Unavailable fork = `blocked`, with
the reason recorded — never silently omitted, never assumed.

### I5 — SCOPED-VERIFIED ← highest attainable
I2 ∧ I3 (primary editor) ∧ latency budget met ∧ limitations declared
non-empty-or-justified ∧ evidence fresh at current commit. Stated always with
scope: "I5-verified for hover in java/groovy/kotlin/scala/typescript, editors:
VS Code <version>, budget p95 < 50 ms warm, limitations: <list>".

There is no level above I5. Fork claims (I4) are orthogonal badges a
capability may also carry; they never upgrade I5.

Every evidence record for an I3+ claim also records the operating system
(kernel/distro or macOS/Windows version). A claim is scoped to the OS it was
measured on; cross-OS claims require per-OS runs (see §11).

## 3. Latency budgets are gates

User-facing latency is a correctness property. Budgets (measured, not
aspirational, on named hardware, evidence JSON per run):

| Operation | Warm budget (p95) | Cold budget (p95) |
| --- | --- | --- |
| hover | 50 ms | 250 ms |
| definition / references | 50 ms | 250 ms |
| document symbols | 50 ms | 250 ms |
| workspace symbols | 150 ms | 500 ms |
| call hierarchy prepare/expand | 100 ms | 400 ms |
| graph webview first render | 300 ms | 1000 ms |

A budget miss is a failed gate, not a footnote. Every measured number records
machine (kernel, CPU, RAM), repo, file/symbol counts, and commit. Ranges or
medians when runs vary — never a single optimistic sample (M19 rule).

Definitions: **warm** = server process already running, index open, page cache
warm (at least one prior request served). **cold** = fresh server process,
first request after startup. Every budget evidence file states which regime
was measured.

## 4. Freshness honesty

1. The server reads a persisted index; the user edits files. Every response
   must either reflect current disk state or carry a machine-readable stale
   marker that the UI renders visibly (badge, dimming, or text — never
   silence).
2. File-watch → incremental reindex is the primary mechanism; its guarantees
   (debounce window, max catch-up latency, event-loss recovery) are declared
   and gated.
3. A stale result shown without a stale marker is a defect of the same
   severity as a wrong result. The UI mutation suite must prove the marker
   renders.
4. Deliberately deferred work (e.g. indexing paused on battery) is reported
   in the status surface, with the reason.

## 5. Position honesty

LSP positions are 0-based lines and UTF-16 code units. The index stores
1-based lines and byte ranges (the CC1 bug class). A dedicated position
mapping component owns all conversion. Rules:

1. No feature code converts positions inline; all conversion goes through the
   mapping component.
2. The mapping component carries its own mutation suite (off-by-one,
   multi-byte, astral-plane, CRLF, tab-width cases) that must fail on planted
   defects.
3. Any language whose analyzer emits ambiguous ranges is excluded from
   position-gated features until pinned, and the exclusion is declared.

## 6. UI mutation gates

Planted defects must fail verifiers. Minimum mutant set per capability:
wrong edge (fabricated caller), dropped edge (missing caller), wrong
position (±1 line, ±1 column), wrong count (usage count off), missing stale
marker, wrong confidence label (inferred shown as structural), budget
violation hidden. If a mutant survives, the suite fails — not the mutant.

## 7. Complement stance (coexistence rules)

The IDE layer complements language servers (gopls, rust-analyzer, tsserver,
jdtls, …) and never competes with them:

1. No completion, no diagnostics, no rename — graph, navigation,
   cross-language, and evidence only.
2. Where a first-party language server exists for a language, our hover
   content is additive and labeled as coming from the bb index; where none
   exists, we declare that we are the primary provider for that language.
3. Client activation must not degrade first-party language-server startup
   (activation budget gate).
4. Any conflict observed with a first-party server is a filed defect with a
   reproduction, not a setting to hide behind.

## 8. Evidence rules (inherited from M14, restated)

1. Evidence JSON in `validation/mXX/results/` is written only by verifier
   scripts. Agents edit code and fixtures, never results.
2. Evidence must regenerate byte-identical (modulo timestamps declared as
   such) from the current commit.
3. Silence is guilt: no skip/todo/pending in harnesses. Skipped = failed.
   Missing editor/fork = `blocked` with reason, recorded.
4. Every claim field carries: currentCommit, sourceFingerprint,
   verifierCommand, evidenceFile, generatedAt, passed/failed counts,
   negativeCases, limitations.
5. Owner spot-checks (M14 §5.6 ritual) are the closure authority for every
   issue. Agents never self-close.
6. Separation of duties: where feasible, the author of a fix is not the
   author of the only check covering it; cross-review is logged in evidence
   `reviewers` fields.
7. Red-team duty per wave: adversarial review of our own gates (the
   tautological check, the fixture that cannot fail, the oracle sharing a bug
   with the implementation). Findings are filed as issues.

## 9. The extension rule (language growth)

The five launch languages (java, groovy, kotlin, scala, typescript — chosen
because they are #419-CONFORMANT) are the opening set, never the ceiling. A
new language joins the IDE surface when, and only when:

1. its analyzer reaches #419 CONFORMANT (or its lower evidence level is
   declared in every IDE result for that language),
2. position and freshness gates pass for it,
3. its IDE fixtures and mutants exist,
4. its latency budget is measured.

Adding language N+1 must be a routine gated wave (M29 protocol), never a
redesign. If any gate forces a redesign, that is a filed defect against the
architecture, not a waiver.

## 10. Cross-platform honesty

Budgets and claim levels are OS-scoped. Rules:

1. An evidence record without an OS field is invalid for I3+ claims.
2. Platform scope is declared per claim: "verified on <OS list>"; other OSes
   are declared-absent, never assumed.
3. Cross-OS verification (macOS, Windows, Linux) is a required part of the
   M25 extension gate — this repository's own failure history (home-dir
   nondeterminism, path-separator bugs) is the standing justification.

## 12. Hover Interaction Rules (M42 amendment, ratified 2026-09-05)

M42 makes the hover interactive. Interaction multiplies the ways a surface
can lie, so these rules are contract, gated from M42.G1 onward. Scope:
`src/lsp/`, `ide/vscode/src/`, `script/m42/`, `validation/m42/`.

1. **Nothing unclickable.** A hover, hub, or graph element that names a
   symbol, file, or usage without a working navigation target to it is a
   defect, not a limitation. Every navigation target must equal an
   index-stored location (differential-checked); a guessed link is a lie.
2. **Stale is visible everywhere.** Every interactive surface (highlights,
   hover body sections, hub, postMessage reveals) carries the staleness
   marker with its claim level. A stale render labeled stale is honest; a
   stale render that looks fresh is a violation.
3. **Enrichment is labeled as enrichment.** Role, pattern, layerFlow,
   criticality, frequency are inference-layer annotations from
   `brain_relationship.metadata` (M40 lane's enrichment pass). They render
   with their inference origin and never at parser-fact tier. Absence
   (un-enriched rows) is declared, never fabricated, never upgraded.
4. **The complement stance holds.** No completion, no diagnostics, no rename
   (§7 unchanged). Interaction adds understanding, not another linter.
5. **The hub is generated, not hand-drawn.** Hub list/tree rendering extends
   the ONE renderer core (§6 UI mutation gates apply to it); per-IDE forks
   of the hub renderer are banned.
6. **Every editor leg tests the wake-up path.** The M25 lesson (an extension
   that never activated passed every activated-path test): an M42 editor leg
   that does not begin from a freshly-activated extension is invalid
   evidence.
7. **Declared interaction budgets** (gated like §3): document highlight p95
   ≤ 25 ms; enrichment read adds ≤ 5 ms to hover p95 (hover stays ≤ 50 ms);
   hub open (query + render) p95 ≤ 300 ms on wave-1 fixture scale.

## 11. Standing rules

0. Section numbering note: §12 was ratified after §11; the numbering is
   append-only history, not reading order.
1. Every bug class found anywhere becomes a permanent gate before its fix
   counts as landed (F7 rule, inherited).
2. PENDING cells are work items; silent gaps are violations.
3. Closure requires no PENDING cell in the dependency path.
4. Owner spot-checks remain the final closure authority.
5. No commit in this program carries AI co-author trailers.
6. Workspace scope: v0 declares **single-root workspaces only** as a declared
   limitation, stated in every v0 claim. Multi-root support is a filed
   decision for a later wave, never an assumption.
7. Unsupported languages: for any file outside the launch-language set, the
   server responds with declared-absent semantics (no capabilities for that
   language), and the absence is verifiable by a negative test. Silent
   empty results that look like "no references found" are a violation.

## 13. Understanding Rules (M44 amendment, ratified 2026-09-06)

M44 makes the surfaces the hover opens *understandable* (IDE v7). A
developer landing on a usages/hub/graph/impact surface must understand in
one second what it shows, why rows differ, what is clickable, and what each
badge means. These rules are contract, gated from M44.G1 onward. Scope:
`src/lsp/`, `script/m26/graph-core.ts`, `ide/vscode/src/` (hub/impact/graph
panels), `script/m44/`, `validation/m44/`, and every surface rendering
usages, hub, graph, or impact.

1. **One row per symbol.** Caller/callee relationship rows are grouped per
   symbol before rendering. A symbol that appears multiple times only
   because it owns several stored relationship rows is a rendering defect,
   not data richness.
2. **Multiplicity is declared.** When a symbol relates through several
   relationship types or occurrences, the group states the count and names
   the types. Nothing is merged into silence, and no stored row is dropped
   from the index or from differential counts.
3. **Interactive is visibly interactive.** Every clickable element renders
   a click affordance (hover state, link underline, chevron, focus
   outline). Text that looks clickable but is not, and a link that does
   nothing, are both defects (M42 rule 1 unchanged).
4. **Counts equal what is rendered.** Header totals ("9 callers") count the
   groups the surface actually renders. A number the eye cannot verify
   against the list is a violation.
5. **Noise is labeled, not hidden.** File-level (`imports`/`exports`) and
   external rows live in declared, labeled sections — never dropped, never
   rendered as ordinary symbol rows.
6. **Dead ends are defects.** A surface that names a symbol, file, or usage
   without a working navigation to it is a defect. "Show all usages" never
   ends in a message-only fallback when the editor's native references
   surface is unavailable.
7. **ONE renderer core for the new surfaces.** All M44 list, tree, and
   badge rendering extends `script/m26/graph-core.ts` (the M26 W1 rule);
   per-IDE forks stay structurally impossible, and the W6 shell's CSP is
   unchanged.
8. **Trees nest honestly, once per symbol.** A call tree places each symbol
   group under the parent its own stored rows declare (the shallowest row's
   parent; a fold to the root level only when the engine's cascade made the
   parent root-equivalent — declared, never guessed), and renders the symbol
   exactly once per side — a second render would double-count usages
   (rule 2). Deeper levels start collapsed behind a declared expander, and
   expansion is a client toggle, never a re-render. A fabricated nesting
   level, a duplicated symbol, or an undeclared control is a defect.
9. **Header counts are the rendered truth; one legend explains every badge.
   ** Surface headers count what the eye can verify — the groups/rows
   actually rendered (§ rule 4) — never a server-side counter: any server
   count rides as a declared attribute so drift is visible, not hidden
   (M44.U4). Every hub list, tree, graph, and impact render ships the SAME
   legend — evidence tiers, enrichment annotations, and staleness statuses
   (fresh/stale/missing/unknown, mirroring the server's marker union) —
   through the ONE core function; the legend doc is GENERATED from that
   core and drift-gated byte-identical. A legend missing a section, a
   header disagreeing with the rendered rows, or a stale render without
   its marker (or a fresh one with a phantom marker) is a defect.
10. **Impact resolves through the owning declaration.** A member-name
   target the engine's traversable-type whitelist excludes (a constructor,
   a plain member) roots its impact through the OWNING declaration when
   the member is indexed — the surface states the resolution
   (`resolvedThrough: "owning-declaration"`, member and owner named) and
   never silently relabels the root. Genuinely absent symbols keep the
   declared not-indexed error; an empty set is never invented (M44.U5).
   On every read surface an out-of-range editor position is declared
   absence — a wire error where the contract requires honest emptiness is
   a defect (the PositionError guard in the navigation owner).

## 14. Demo-Media Rules (M45 amendment, ratified 2026-09-07)

M45 publishes product demo films on the website. A video is a claim, and
claims this program makes are machine-checked — pixels are no exception.
These rules are contract, gated from M45.G1 onward. Scope: `docs/m45/`,
`script/m45/`, `validation/m45/`, `website/public/demos/`, the website
hero embed and `/demos` route, and every frame that ships as product media.

1. **A video is a claim.** Every committed clip carries a sidecar manifest:
   bb version, editor name + exact version, extension VSIX hash, demo-corpus
   commit, index hash, capture date, capture-tool versions. No clip ships
   without its manifest; a manifest pointing at artifacts the capture cannot
   reproduce is a violation.
2. **Every frame is real.** No AI-generated footage, no composited or
   doctored product pixels, no mock UI. The capture must be reproducible by
   script from the pinned artifacts; a frame a fresh run cannot reproduce is
   a defect.
3. **Version honesty.** What a video shows is the version in its manifest —
   never a newer or aspirational surface. A film of a UI still changing in
   an open milestone is captured only after that milestone closes; a
   pre-change UI is never substituted for the closed one.
4. **Verifier-first.** A frame-truth verifier re-runs the capture at the
   pinned commit, frame-diffs sampled frames, and carries planted mutations
   that must fail (wrong version burned into a caption, an edited frame,
   wrong corpus, missing manifest).
5. **Website integration is truth-invariant.** The hero embed and `/demos`
   page may not change any M41 claim; the M41 truth/SEO verifiers re-run
   unchanged after a media change.
6. **Reduced-motion and accessibility are not optional.** Autoplay is muted
   with a poster frame; `prefers-reduced-motion` receives the poster; clips
   carry captions or transcript summaries for the core beats.
7. **The director's layer never touches product pixels.** Camera moves,
   cuts, captions, and grade act over real captures only — a zoom into real
   pixels is honest, a generated UI is not (rule 2).

## 15. Truth Rules (M55 amendment, ratified 2026-09-12)

M55 ("The Hub That Tells the Truth", IDE v8) closes the gap between what the
IDE *renders* and what the index *knows*. The owner's 2026-09-12 report was
made against a six-day-old installed bundle; re-shooting it on a fresh install
cleared part of the report and exposed six live defects, four of which were
presentation lies rather than missing features. These rules are contract,
gated from M55.G1 onward. Scope: `src/lsp/`, `ide/vscode/`, `script/m55/`,
`validation/m55/`, `docs/m55/`, and every surface an editor user reads.

1. **One surface, one answer.** A fact rendered on two surfaces either
   agrees, or carries the declared reason it differs. Counts of the same
   thing never differ: if hover says three callers, the graph says three,
   `textDocument/references` says three, and any surface that filters
   differently states its filter.
2. **Identity is stated.** When a target is resolved through a substitute — a
   member through its owning declaration, an alias through its declaration —
   the substitution is labeled wherever the target is named (panel title,
   hover identity line, wire payload, tool result). Silent relabeling is a
   defect: a graph that opens on `Store` after the user asked for its
   `constructor` must say so.
3. **Positions are where the thing is.** A range handed to the editor points
   at the call site it names, never at a declaration, never at a body, never
   at a fabricated line. A stored position that cannot be resolved from the
   source is a declared approximation, and an unresolvable relation is
   omitted and declared — never emitted with a plausible-looking range.
4. **Human text is human.** No machine shapes (JSON blobs, serialized
   parameter lists, escaped payloads) in anything a developer reads. A
   signature reads `greetAll(names: string[]) -> string[]`; unresolved types
   render a declared unknown marker, never a guessed type.
5. **The editor is the gate.** A visual claim closes on a fresh-install frame
   at the evidence HEAD, captured and read through the pinned protocol
   (`docs/m55/SCREENSHOT-PROTOCOL.md`) — never on a DOM assertion alone, and
   never against a bundle that is not the HEAD build. An unread frame is not
   evidence.
6. **Space is the user's.** A panel never silently splits the editor and
   never takes focus without a reason it can state; the same panel is reused
   rather than duplicated.
