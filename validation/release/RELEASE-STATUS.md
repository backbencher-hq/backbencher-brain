<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the release status of the sixteen public MCP tools: what was audited,
what was fixed, which gate proves each claim, and the measured numbers on the tiny, synthetic
and 3.6 GB tiers.
WHO IT IS FOR — the operator preparing the release and any maintainer who needs to re-run the
evidence before shipping.
EDIT TOGETHER WHEN THIS CHANGES — docs/tools-campaign/CHARTER.md, validation/tools/<tool>/**
evidence, validation/release/{T2-BASELINE,RELEASE-BATTERY}.json, docs/tools/*.md.
-->

# Public MCP tools — release status

Sixteen canonical tools, one permanent owner each, audited and repaired against
`docs/tools-campaign/CHARTER.md`. Every claim below is backed by a committed artifact and a
command that reproduces it.

## 1 · Tools and final commits

| # | tool | mutability | owner | final lane commit |
| --- | --- | --- | --- | --- |
| 1 | `bb_edit` | write | tool-edit | lane commit on main (audit `5b8a2b1`) |
| 2 | `bb_search` | read | tool-search | `f29434262` |
| 3 | `bb_ask` | read | tool-ask | `731d965a3` |
| 4 | `bb_analyze` | read | tool-analyze | lane commit on main |
| 5 | `bb_health` | read | tool-health | `755157b7f` |
| 6 | `bb_patterns` | read | tool-patterns | `7b4ca16af` |
| 7 | `bb_security` | read | tool-security | `5d1dd58e1` |
| 8 | `bb_visualize` | read | tool-visualize | `7b72cb8ed` |
| 9 | `bb_migrate` | read | tool-migrate | `72bf152b6` |
| 10 | `bb_doc` | read | tool-doc | lane commit on main |
| 11 | `bb_index` | write | tool-index | `b4f3e96c3` |
| 12 | `bb_graph` | read | tool-graph | lane commit on main |
| 13 | `bb_impact` | read | tool-impact | `2e8ac821c` |
| 14 | `bb_cross_language` | read | tool-cross-language | lane commit on main |
| 15 | `bb_annotate` | write | tool-annotate | `e7a43f472` |
| 16 | `bb_annotations` | read | tool-annotations | `f9cf61b54` |

## 2 · What the campaign proved (all re-run at the final head)

- **Falsifiability**: every lane ships a gate that is red on a planted mutant and green on the
  fixed tree; the campaign's own self-test re-runs 69 gates with mutations and **passes 69/69**
  (`npx tsx script/m31/verify-gate-selftest.ts`). Lane-level mutant batteries: edit 6/6,
  search planted control (exit 1 → green), ask 13/13, analyze, health 12/12+, patterns 6/6,
  security 9/9, visualize 5/5, migrate 6/6, index 3+ mutants, graph, impact 13/13,
  cross-language, annotate 7/7, annotations 5/5.
- **Real MCP stdio door**: `validation/release/RELEASE-BATTERY.json` — the compiled server
  (`node bin/bb mcp`) registers **16/16** tools and answers every one on a real multi-language
  workspace (graphql-js / rake / rebar3; 622 files, 13,386 symbols); all four refusal
  assertions return error envelopes; the read phase leaves DB bytes and mtime untouched; write
  tools exercised without collateral damage (annotation stored through the door, index no-op on
  the settled tree, edit dry-run planned only). Each lane also exercised its own corpus through
  the real door (`validation/tools/<tool>/REAL-CORPUS.json`).
- **Latency on the 3.6 GB reference index** (`validation/release/T2-BASELINE.json`,
  13 read tools, one warm-up + 3 measured runs, per-tool byte deltas): **all within budget,
  no tool writes the index** — health **657/663 ms** (2 s target), search 263, ask
  1,700/1,750, analyze 3,021, patterns 3,764/4,031, security 427/443, visualize 381,
  migrate 997, doc 260, graph 3,201/3,396, impact 2,238/2,274, cross-language 5,
  annotations 0. Write tools declare their own tiers (`bb_index`, `bb_annotate`, `bb_edit`).
- **Reads are byte-read-only**: per-tool before/after stat + edge hashes show no read tool
  writes the index; on the release workspace the read phase leaves DB bytes and mtime
  unchanged (`readPhaseUntouched: true`).
- **Docs are generated from the registry and verified**: `npx tsx script/verify-tool-docs.ts`
  regenerates and verifies all 18 artifacts for 16 tools; `script/m48/verify-d1-doc-truth.ts`
  passes **139 checks + 4 negatives** (mode lists, parameter tables, output fields, mutability,
  custom staleness sections, category vocabulary, overview agreement).
- **Author headers**: **83/83** campaign files checked carry the `Muhammad Ishaq Khan` header
  (handlers, descriptors, shared plumbing, curation, `docs/tools/*.md`, `docs/BB_*.md`).
- **Comment contract**: the §9 process-narration scan over those 81 files reports **0 hits**
  (owner/lead/lane/teammate/fleet narration, milestone IDs, issue numbers, MEASURED-date,
  defect-fixed, standing-rule, agent footers).
- **Regex discipline**: `script/tools/verify-regex-policy.ts` PASS — 14 allowlisted, 62 frozen
  legacy rows, **0 new**; lanes that replaced regexes ship edge-case suites with the pattern
  removed (migrate 22 → 0, visualize 3 → 0, impact/migrate AST scans).
- **Milestones**: m28 closure **X1 VERIFIED 31/31**; m48 P4 parameter matrix PASS
  (**512 passed / 0 failed / 2 negatives**, 251 `verifiedBy` pointers resolving to real-run
  evidence); `tsc --noEmit` clean.

## 3 · Reproduce

```bash
npx tsup                                     # build the compiled door
npx tsx script/m31/verify-gate-selftest.ts   # 69-gate mutation self-test
npx tsx script/m28/verify-closure.ts         # m28 closure, 31/31
npx tsx script/verify-tool-docs.ts           # docs parity (18 artifacts)
npx tsx script/m48/verify-d1-doc-truth.ts    # doc truth, 139/0/4
npx tsx script/m48/verify-p4-param-matrix.ts # parameter matrix, 512/0/2
npx tsx script/tools/verify-regex-policy.ts  # regex policy
BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/release/run-t2-baseline.ts
BB_DATA_DIR=$PWD/validation/release/data BB_NO_AUTO_REFRESH=1 node --import tsx validation/release/run-release-battery.ts
```

## 4 · Declared limitations (honest, not papered over)

- **Cold page cache** on the 3.6 GB index can dominate a first call for tools that scan; the
  5 s claims are warm-process claims and are labelled as such in the lane evidence.
- **Write tools are not measured on T2** by charter: `bb_index`/`bb_annotate`/`bb_edit` declare
  their tiers and prove byte-read-only reads elsewhere.
- **Compiled-door legs** are current as of the final `dist` build in this tree; rebuild before
  re-running them.
- **Cross-milestone reds that are not tools'**: m40 A9's documentation-coverage checks
  (Lead-owned plan page), m17 compiled-corpus legs, whole-repo zig indexing interruption — each
  declared at the owning layer, none counted as green here.
- **Concurrent campaigns** share this checkout: files under other milestone directories may be
  dirty while their owners work; this document's claims are about the sixteen tools and their
  evidence paths listed above.

## 5 · Launch verification (final pass, 2026-11-04)

The one command that proves the surface before shipping:

```bash
npm run verify:tools        # build + typechecks + docs chain + 155 deterministic tool gates
```

`script/verify-tools.ts` runs each gate in its canonical runtime with an isolated `BB_DATA_DIR`
and writable `HOME`, collects every failure instead of aborting, and writes
`validation/release/VERIFY-TOOLS.json`. Gates it cannot run on a clean checkout are **declared
with the condition they need** (printed on every run), never silently skipped; the list lives in
the script and matches `GATE-CLASSIFICATION.md` §2–§3.

Proved in this pass:

- **`npm run verify:tools` gate set PASS — 155/155 gates at commit `8cfff9b9c`**, with the
  build, `tsc --noEmit` and script-typecheck phases green in the recorded run and
  `docs:verify` verified as a separate PASS at the same tree; the machine record is
  `validation/release/VERIFY-TOOLS.json`. Twenty-seven further gates are declared in the
  script with the exact condition each needs (network, external corpora, crash-fixtures,
  live-editor rig, milestone-governance stamps, analyzer-portfolio policy) and are printed
  on every run — never silently skipped. The full single-command four-phase run is the
  release-cut acceptance run: two attempts were killed by host memory pressure while other
  campaigns were active, so the record is the gates-only run plus the separately verified
  docs chain, and the script now supports `--skip-phases` so a constrained host can run
  segments without mistaking a segment for the launch verdict.
- **Docs talk about exactly one tool surface** (`script/verify-doc-tool-surface.ts`, now part of
  `docs:verify`): 54 current-facing docs scanned, 99 checks, 7 negatives, 0 violations. It proves
  the generated catalog equals the registry (names, modes, parameters, required fields), that
  no current page names a non-tool `bb_*` (the retired 0.2.x names appear only under a
  retired/dead marker), and that every "N tools" claim equals the registry count. Test
  intelligence is documented as `bb_analyze` modes (`test_mapping`/`test_gaps`/`test_impact`/
  `test_quality`), not as tools; `bb_test_quality`/`bb_test_suggestions` are dead names with no
  callable tool, and `bb_test_intel` never existed (it names a guide topic).
- **Docs chain green: `npm run docs:verify` PASS at the settled head** — tool docs (16 tools,
  18 artifacts), integration docs, M31 governance 32/32 + 2 negatives, gate self-test **69/69**,
  tool-mode corpus **76/76** (42 valid + 30 negative), corpus check, tool-docs-deep **223/223**,
  BB-docs truth **65/65**, tools overview, M31 closure **19/19**, wave-2 governance 22/22.
- **Language × tool matrix green** (`script/verify-language-tool-matrix.ts`, part of the launch
  gate): every language the engine registers — **53**, derived from `SUPPORTED_LANGUAGES`,
  never hand-listed — gets one real fixture, is indexed for real, and is then exercised through
  the public tools (search, graph, impact, doc, annotations, edit dry-run, migrate,
  cross-language) plus the project-wide surfaces. **548 checks incl. 5 negatives pass in
  ≈15 s.** The record also makes the capability boundaries visible instead of hiding them:
  `bb_edit` dry-run plans for 15 languages and refuses **typed** for 38; `bb_migrate` returns
  its `plans`/`unsupported` arrays for all 53; the TypeScript↔Haskell niche pair is probed
  explicitly (a plan with the declared dictionary gap, never an invented mapping). Contract
  and extension steps: [`docs/LANGUAGE-TOOL-MATRIX.md`](../../docs/LANGUAGE-TOOL-MATRIX.md).
- **Script typecheck is at zero errors** (`npm run typecheck:scripts`; was 6 in
  `script/m14/*`), and the ratchet gate passes at zero.
- **MCP stdout is protocol-only**: `script/m28/verify-mcp-stdout.ts` PASS 7/7 — zero non-JSON
  stdout lines across a real `bb_index` call, engine logs observed on stderr, negative case
  proves the classifier can fail. The engine's indexer/resolver logs are routed to stderr for
  the MCP server process.
- **Docs consolidation**: every generated tool page now links its deep guide(s); four missing
  deep guides were written (`BB_IMPACT`, `BB_CROSS_LANGUAGE`, `BB_ANNOTATE`, `BB_ANNOTATIONS`)
  and `bb_graph`/`bb_index` point at `GRAPH_ENGINE.md`/`indexing/`; the stale root plans
  (`M13-TOOL-TRUST.md`, `MCP_TOOL_MIGRATION.md`) moved to `archive/docs-pre-consolidation/`;
  `docs/README.md` documents the deep-guide map, the historical-records rule and the
  `.superseded-*` retention policy. The guide set is claim-gated (M31.D2).
- **Agent (`.backbencher-agent`) consumes the same engine and inherits the fixes**: it spawns
  `bin/bb mcp` and reads live `tools/list`; gate A PASS — live surface byte-for-byte the
  published sixteen tools; live integration 3/3 PASS (contract-equal tool list, real index
  health, search→graph anchor with evidence refs, mutation call + healthy read with zero stdout
  noise); tools-package unit tests 106 (103 pass, 0 fail); workspace typecheck 0. Its full
  A–M suite is product/provider-bound in this environment (see §6) and its artifacts are being
  refreshed by the agent campaign.
- **Milestone evidence re-stamped at the settled head**: M16 closure C1 **17/17**, M28 closure
  **X1 VERIFIED 31/31**, M48 closure **74/74** (reproduced at the committed head), M31 closure
  **19/19** with all content-gate stamps equal and the ledger synced.
- **T2 latency baseline re-run at the settled head** (`validation/release/T2-BASELINE.json`,
  3.6 GB reference index, 13 read tools, warm process): health **564/564 ms** (2 s budget),
  search 221/224, ask 940/993, analyze 2,546/2,579, patterns 2,771/2,786, security 218/235,
  visualize 228/228, migrate 868/869, doc 198/199, graph 3,270/3,279, impact 2,216/2,218,
  cross-language 2/2, annotations 0 — every tool inside its budget.
- **Release battery re-run at the settled head** (`validation/release/RELEASE-BATTERY.json`):
  the compiled `node bin/bb mcp` door registers **16/16** tools, every tool answers on the
  real multi-language workspace (690 files), all four refusal assertions return error
  envelopes, and the read phase leaves the index **byte- and mtime-untouched**
  (`readPhaseUntouched: true`).
- **Sweep**: 156 tool-verification scripts run in their canonical runtimes; every first-pass red
  is classified in [`GATE-CLASSIFICATION.md`](./GATE-CLASSIFICATION.md) as fixed, repaired
  against the current truthful surface, or declared with its required condition. No open
  product defect remains in the sixteen-tool surface.

## 6 · Remaining non-tool reds (declared, not counted green)

These are outside the public MCP tool surface. They are listed so nothing is silently green:

- **Milestone-governance evidence stamps** (`m26`, `m40`, `m43` governance/closure): each was
  re-attempted in this pass and its content gates pass except environment-bound ones. The
  remaining blockers are pinned in `GATE-CLASSIFICATION.md` §3 — M43's A4 corpus
  lock-fixture, M26's external corpus plus its M25 milestone dependency, and M40's A8
  crash-fixture / A9 declared residual plus a self-test that needs a quiet host. None is in
  the launch gate and none is a tool defect.
- **M20 governance is re-stamped but cannot close in this environment**: all seventeen M20
  gates were re-run at the settled head, their result files refreshed, and the milestone
  ledger synced from them with the new `script/m20/sync-ledger.ts` (15/17 issues now verified
  and closable). C2 (corpus registry) still reports one failed check because its declared
  immutable-snapshot source, the pinned checkout `/home/ishaq2321/intellij-community` at
  `cfda6881ef1c…`, is absent from this machine — the snapshot directory and sidecar exist, but
  the gate's re-verification needs the source repository. That single failed check cascades
  into C1/C3 known-gap; the exact pinned condition is recorded here and in
  `GATE-CLASSIFICATION.md` §2. Restoring the pinned checkout is the only remaining action,
  and it is outside this checkout.
- **Environment/network-bound gates**: GitHub registration/counts (M15 matrix closure, M57
  governance/closure), external corpora (M20 corpus registry, M26 external arm, M43 corpus,
  M48 C1 corpus, M57 corpus identity), crash-injection fixtures (M40 A2/A8), declared M40 A9
  residual, and the live editor/Xvfb rig (M55) — `GATE-CLASSIFICATION.md` §2.
- **Analyzer-portfolio policy gates**: `m57` predicate unity (single test-shape definition),
  `m65` refresh-resolution fleet coverage (50 analyzers vs FLEET-48 fixtures) and the VB
  declaration-spec absence (`script/m14/incoming-gate.ts` now records it as an explicit
  analyzer-portfolio gap rather than a latent compile error) — owning campaigns, not this one.
- **Agent A–M suite**: its product gates need a running product server bound to an engine
  schema plus a model provider; in this environment the server reports
  `engine-schema-missing` and the provider answers 404, so those gates are product/provider
  findings, not tool-surface findings. The surface and integration legs it *can* run are green
  (§5).
