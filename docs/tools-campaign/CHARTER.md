<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the binding campaign contract for making all sixteen public
backbencher-brain MCP tools correct, fast, honestly documented and owner-authored. It is the
single source of truth every tool owner-teammate reads before touching code, docs or evidence.

WHO IT IS FOR — the Lead (Muhammad Ishaq Khan) and the sixteen per-tool owners.

EDIT TOGETHER WHEN THIS CHANGES — the per-tool task board entries, the header template in
§8, the acceptance checklist in §5, and any shared plumbing the campaign extracts.
-->

# TOOLS CAMPAIGN — CHARTER

## 1 · Mission and scope

Make every public MCP tool permanently excellent: truthful, bounded, fast enough to serve an
agent, documented to match behaviour, gated by tests that can actually fail, and written and
commented as the work of the repository author. Nothing is "good enough because it passes" — a
green run over a gate that cannot go red is a defect, not evidence.

In scope: the sixteen canonical tools in `docs/data/public-tools.json`:

| # | Tool | Mutability | Campaigned engine area | Twin surface |
|---|---|---|---|---|
| 1 | `bb_search` | read | `src/intelligence/search/` | — |
| 2 | `bb_ask` | read | `src/intelligence/search/` (semantic) | — |
| 3 | `bb_analyze` | read | `src/intelligence/analysis/` | — |
| 4 | `bb_health` | read | `src/intelligence/health/`, `src/brain/freshness.ts` | LSP `bb/staleness` |
| 5 | `bb_patterns` | read | `src/intelligence/patterns/` | — |
| 6 | `bb_security` | read | `src/intelligence/security/`, `src/security/` | — |
| 7 | `bb_visualize` | read | `src/intelligence/visualization/` | LSP `bb/graph` panel |
| 8 | `bb_migrate` | read | `src/intelligence/migration/` | — |
| 9 | `bb_doc` | read | `src/intelligence/documentation/` | LSP hover (shared renderers) |
| 10 | `bb_edit` | write | `src/intelligence/edit/`, `src/ast/brain-surgical-patcher.ts` | agent work path |
| 11 | `bb_index` | write (derived) | `src/ast/parallel-indexer.ts`, `src/ast/auto-refresh.ts` | — |
| 12 | `bb_graph` | read | `src/intelligence/graph/`, `src/lsp/evidence_tier.ts` | LSP `bb/graph` |
| 13 | `bb_impact` | read | `src/lsp/impact.ts`, `src/intelligence/analysis/impact.ts` | LSP `bb/impact` |
| 14 | `bb_cross_language` | read | `src/lsp/cross_language_hover.ts` | LSP cross-language hover |
| 15 | `bb_annotate` | write (row) | `src/brain/annotation-store.ts` | LSP hover + graph badge |
| 16 | `bb_annotations` | read | `src/brain/annotation-store.ts` | LSP hover + graph badge |

Not in scope: the 40+ language analyzers, the agent host tools, LSP-only methods with no tool
counterpart, the `ide/` forks, the website shell. Twins are inspected and verified as part of the
tool's acceptance, but a twin change must be proposed to the Lead before it is made, because a
twin is shared code with the editor contract.

## 2 · Ownership

- One tool, one permanent owner-teammate, for the whole campaign. A tool never gets a second
  owner. The same teammate is revisited for follow-ups on its tool.
- The Lead owns everything shared: `src/mcp/tool-registry.ts` and `src/mcp/tool-handlers.ts`
  (assemblers), `src/mcp/server.ts`, `src/mcp/tool-validation.ts`, shared helpers, the docs
  generator, `docs/data/public-tools.json` and website data regeneration, README, the bench and
  the regex policy gate.
- Owners write only inside their scope. Cross-scope needs are requested from the Lead in a
  message; they are never applied by the requesting owner.

## 3 · Ground rules (non-negotiable)

1. **No destructive git, ever.** No `checkout`, `restore`, `reset`, `clean`, `rm`, no branch
   switches, no push. Other work and the fleet's evidence regeneration live in this checkout.
   To undo your own change, re-edit the file. To restore a file, ask the Lead first.
2. **Commits are required — and they are never blob commits.** After each green
   checkpoint, commit your own scope: `git add <your paths>` (never `git add -A`), a plain
   owner-authored message with no agent/co-author trailers, and no binary artifacts.
   Per-lane indexes and copies (`validation/tools/**/bbdata/`, `t2-copy/`, `*.db*`), isolated
   gate HOMEs/caches, fixture backup/artifact copies and rendered previews are gitignored
   working state: never force-add them. Retry on `.git/index.lock`; the Lead commits shared
   and central files. A checkpoint that cannot be committed because the tree does not compile
   is reported, not hidden.
3. **One writer per file.** Check your scope. If a file is outside your scope, message the Lead
   instead of editing it.
4. **Never touch `.backbencher-agent/` or `ide/`.** They are separate repos/artifacts; read-only.
5. **Never run write-mutating tools or the indexer against the shared workspace index**
   (`.bb-data/projects/`). Write tools (`bb_edit`, `bb_index`, `bb_annotate`) run only against
   fixture projects you create under `validation/tools/<tool>/work/`, with
   `BB_DATA_DIR=validation/tools/<tool>/bbdata`.
6. **Set `BB_NO_AUTO_REFRESH=1` for every measurement read.** A measurement must not mutate the
   index or take the index lock.
7. **The Lead's fallback:** if you cannot prove a claim by a command whose exit code you read,
   the claim is `unknown`, not "probably fine".

## 4 · Definition of done for a tool (all eight, per tool)

1. **Contract truth** — descriptor in `src/mcp/tools/<tool>/descriptor.ts` (name, description,
   schema, defaults, examples, mutability, requiresIndex, modes) matches what the handler does,
   including every refusal and every declared default.
2. **Correctness matrix** — every mode × meaningful option combination runs against index
   fixtures; each answer carries the required evidence fields, declared bounds
   (`totalCountIfKnown`, `truncated`), declared absence, and freshness where applicable. Wrong
   input gets a named, actionable error and `isError: true` through the real MCP stdio door.
3. **MCP protocol** — a real `node bin/bb mcp --dir <fixture>` session calls the tool end to end;
   one success case and one refusal case captured. No stdout pollution, no crash, no unhandled
   rejection.
4. **Gates that can fail** — every existing per-tool verifier is run from the working tree, and
   each one is shown red on a planted mutant before being shown green. Environment-blocked legs
   (foreign corpora, missing indexes) are recorded as `blocked` with the exact reason, never
   silently green.
5. **Speed** — measured on the three tiers in §6, recorded in
   `validation/tools/<tool>/LATENCY.json`, and no default-argument call on the reference large
   index may exceed its budget or the 30 s client timeout. `bb_health` must answer its default
   report in under 2 s on the 3.4 GB reference index.
6. **Docs truth** — generated page (`docs/tools/<tool>.md`), curated page (`docs/BB_*.md`) and
   the registry description describe the measured behaviour, and the verification commands in
   the docs actually run. No doc promises a mode, default or bound the code does not honour.
7. **Authorship** — every important file the tool owns starts with the header in §8 and contains
   no process-attribution comment from the banned list in §9.
8. **Regex discipline** — see §7. A new regex is a defect unless allowlisted with its edge-case
   tests.

## 5 · Evidence contract

Every gate result is a machine-readable JSON file carrying at least: `schemaVersion`, `tool`,
`status` (`verified` | `partial` | `blocked`), `currentCommit`, `verifierCommand`, `passed`,
`failed`, `negativeCases`, `generatedAt`, and `blockedLegs` with reasons. A `verified` status
requires at least one negative case that was observed to fail before the fix. Evidence lives at
`validation/tools/<tool>/`. Claims in the final report cite the file and the command that
produced it.

## 6 · Performance contract

Three tiers, always measured warm, five runs, p50 and p95 recorded with the exact command and
environment in `LATENCY.json`:

| Tier | Subject | How |
|---|---|---|
| T0 tiny | `test/fixtures/polyglot` (ts-js, java-scala) | index once per tool under `validation/tools/<tool>/bbdata` with `BB_DATA_DIR` |
| T1 synthetic | `.perf-fixtures/bb-scale/n100` (fall back to `n50` if the build is absent) | own `BB_DATA_DIR` |
| T2 reference large | this workspace's existing index (11,440 files, ~3.4 GB) | `BB_DATA_DIR=.bb-data`, `BB_NO_AUTO_REFRESH=1`, read-only tools only |

Budgets for default arguments (p95, T2): `bb_health` < 2 s; all other read tools < 5 s. Any tool
that legitimately needs longer must bound and declare it in its description and docs, and must
still return inside 30 s or stream/paginate. T0 default calls < 250 ms; T1 < 1 s. A regression
against the campaign baseline is a finding.

## 7 · Regex contract

Regex over source text is the default failure mode this codebase's analyzer layer already bans
(`script/m14/no-regex-gate.sh`): it matches comments and strings, misses nested syntax, and
breaks silently on the next grammar version. For tool code:

1. **Default: none.** Use explicit string operations, `includes`/`startsWith`/`split`, or the
   tree-sitter AST. A regex used where a plain comparison suffices is a review-blocking defect.
2. **Allowed only when genuinely unavoidable**, and only with all of: (a) a comment at the site
   explaining why no non-regex formulation is correct; (b) an entry in
   `validation/tools/regex-allowlist.json` (file, marker, reason, test file); (c) an edge-case
   test suite covering: empty input, no-match and match-at-boundary, Unicode (multi-byte and
   astral), multiline, anchors/quantifiers/lookarounds actually used, escaping of user input,
   very long input proving no catastrophic backtracking (time-boxed assertion), and invalid
   user-supplied patterns producing a named error instead of a crash.
3. **User-supplied patterns are data, not parsing.** `bb_search` mode/option regex constructs a
   `RegExp` from the caller's pattern — that is the feature and stays; it must validate, bound
   and test the pattern (invalid/oversized/pathological) rather than trust it.
4. The Lead installs a policy gate, `script/tools/verify-regex-policy.ts`, that counts regex
   literals and `RegExp` constructions in tool sources, fails on any use not in the allowlist,
   and fails when an allowlisted use has no test file. It must be able to go red.

## 8 · Header template (every important file a tool owns)

Code (`.ts`), exactly this shape:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — <the component and its one job, in one sentence>.
// WHICH TOOL IT SERVES — bb_<name> (mutability <read|write>, requiresIndex <bool>,
//   modes: <mode, mode>).
// WHY IT IS SHAPED THIS WAY — <the constraints that force the design: evidence
//   semantics, bounds, declared absence, freshness, compatibility>.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_<name>.md, docs/BB_<NAME>.md,
//   validation/tools/bb_<name>/**, gates: <exact commands>.
// EDIT TOGETHER WHEN THIS FILE CHANGES — <descriptor file, curation file, generated
//   pages, twin surface, gate scripts>.
// CONTRACTS IT MUST NOT BREAK — <read/write boundary, declared bounds, declared
//   absence, freshness flags, regex policy>.
// ─────────────────────────────────────────────────────────────────────────────
```

Markdown (docs the campaign owns):

```md
<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — <one sentence>.
WHO IT IS FOR — <the caller/operator who needs it>.
EDIT TOGETHER WHEN THIS CHANGES — <code files and gates that must move with it>.
-->
```

The header states what is true today and is edited when the file changes. A file whose header
lies is worse than a file with no header.

## 9 · Comment and authorship contract

The code is the repository author's work and reads that way. **Remove and never add** comments
that narrate an authoring, review or approval process. Banned in campaign files:

- `the owner said/asked/decided/approved/instructed/admitted`, `owner-approved`, `the Lead`,
  `the lead's item`, `this lane`, `the lane`, `teammate`, `the agent door` as authoring
  narrative;
- `issue #NNN`, `task-NN`, milestone IDs used as narrative (`M13.`, `M28.T1`, `M48.P1`, …),
  `MEASURED 2026-…`, `defect fixed <date>`, `shipped`, `standing rule`, `the fleet`;
- any reference to a person other than the author as the decider, and any "Generated with"/
  co-author style marker.

Keep: technical `owner` meanings (`owner cascade`, `owner-family`, `owner index`, a record's
owner) — those name a data relationship, not a person. Keep measured facts as plain facts
("on an 11,440-file index the sampled report takes 1.8 s"), never as process history. Write in
the author's voice: direct, technical, no third-party narration.

## 10 · Docs contract

Three layers, one truth:

1. **Registry descriptor** — `src/mcp/tools/<tool>/descriptor.ts`: the executable contract
   (schema, defaults, modes, mutability). Every documented default must be executed by the code.
2. **Curated reference** — `script/tool-docs/curation/<tool>.ts` feeds the generated page
   (`docs/tools/<tool>.md`, `docs/data/public-tools.json`, website tool data). Edit the curation
   file, never the generated page. The Lead adds `--only <tool>` / `--check-only <tool>` modes to
   the generator; until that message arrives, do not regenerate shared artifacts.
3. **Curated guide** — `docs/BB_*.md` pages are hand-written: rewrite them to match measured
   behaviour, add the §8 markdown header, remove milestone framing from titles, and make every
   command in them runnable.

## 11 · Reporting

Each owner reports to the Lead with: tool, state, gate table (command → exit code), latency
before/after table with tiers, docs changed, defect list with severity and fix, evidence file
paths, and every item still `unknown`/`blocked` with its reason. Short, numbered, no adjectives
that a command did not earn.

## 12 · Coordination

1. Read this charter, then `team_task_get` your task and `claim` it before starting.
2. Phase A (audit) is read-only for `src/`; write only `validation/tools/<tool>/**`. The Lead
   messages you "split landed" with your module paths; only then may you edit code/docs.
3. Every write stays inside your scope; cross-scope needs go to the Lead.
4. Report at the end of Phase A and at the end of Phase B. Use `send_message` to the Lead.
5. Blocked on the environment? Say so with the exact failing command and its output. A declared
   blocked leg is acceptable; a fabricated green is not.

## Appendix A · Baseline facts at campaign start (2026-11-01)

- Engine: `backbencher-brain` 0.3.0, HEAD `c43282e92`; 16 public tools, 13 read / 3 write.
- **T2 is the reference index AS MEASURED, not a fixed number.** At campaign start the workspace
  index held 11,440 files / 1,283,638 symbols / 4,418,260 relationships (~3.4 GB, sampled freshness
  51 fresh / 1 stale / 12 missing). By the first owner measurements the live index had been
  reindexed to **6,452 files / 310,423 symbols / 820,040 relationships**, and the fleet process
  continues to touch it. Rule: every measurement records the index's file/symbol/relationship
  counts plus its mtime, and no report may quote another sample's population as if it were its
  own. The Lead publishes the final campaign T2 baseline at integration. Its JSON/Markdown
  populations come from validation and scratch trees — use it as a *load*, not as a product metric.
- `bb_health` exceeded a 30 s client timeout on the campaign-start index while `bb_analyze stats`
  answered — the first measured defect of the campaign.
- Docs drift: three live docs still say "ten tools" (README line 239, `docs/ARCHITECTURE.md`,
  `docs/TOOL-REGISTRY.md`) while the registry has sixteen.
- The M13 corpus mapping points at a foreign machine path (`/Users/sano/...`); corpus legs that
  depend on it are environment-blocked here and must be reported as `blocked`, not green.
- The checkout is shared with a fleet process that regenerates `validation/**` evidence; treat
  unrelated modified files as not yours.
