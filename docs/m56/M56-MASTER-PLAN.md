# M56 — Website Completion: Surfaces, Sources, IA — Master Plan

> **STATUS: FILED — GitHub milestone 56.**
> GitHub issue numbers (enforced exactly by the governance gate):
> G1=#779, E1=#780, T1=#781, L1=#782, D1=#783, S1=#784, I1=#785, D2=#786, X1=#787.
> Ledger: `validation/m56/results/manifest.json`.

Milestone: M56 · Status: open
Authority: this document · Governing contract: `docs/M14-HONESTY-CONTRACT.md`

## Purpose

M41 made the site *true*. M45 added verified demo media. This milestone makes the
site **complete and single-sourced**, because two kinds of defect survived both:

1. **Missing surfaces.** The site has no LSP surface at all — two passing mentions
   of an editor while `src/lsp/` implements hover-with-evidence, definition,
   references, symbols, call hierarchy, impact, graph and cross-language hover,
   with four editor integrations and a declared claim matrix. A reviewer who only
   sees the site cannot know half the product exists.
2. **Hand-copied facts.** The tool reference re-types data that
   `script/verify-tool-docs.ts --write` already generates from
   `src/mcp/tool-registry.ts`; the FAQ exists twice (8 answers on the site, 13
   deeper ones in `website/faq.md`); the docs page is thin while the deep
   reference material already sits in that same markdown; the troubleshooting
   content is a separate page that docs only links out to.

Rule going forward, enforced by CI:

> **Every published fact has exactly one authoring source, and the site is
> generated from it — never re-typed beside it. A surface that exists in the
> product but not on the site is a defect, and so is a surface on the site with no
> verifier behind it.**

## Owner decisions recorded before work started (2026-09-12)

- **/demos is retired.** The two films were withdrawn by the owner after review
  (pacing and craft, not truth). The machine-verified session *stills* are reused
  as proof on the new `/editors` page. M45.T1's scope changes accordingly and the
  change is recorded, not deleted (see I1).
- **FAQ has one source:** `website/faq.md`. The site renders it; the hand-written
  array is removed.
- **Support is one page:** FAQ first, then contact. `/faq` and `/contact` redirect.
- **Troubleshooting lives in docs** and `/troubleshooting` redirects to it.
- **Editor publishing is pending** (Open VSX needs the owner's credentials), so
  the editors page must say so and may never claim marketplace availability.
- **One deploy closes both milestones:** M41's closure rides this push rather than
  shipping a site with rejected demos and no editor surface, then re-shipping.

## Issues

### G1 — Governance, Ledger & Evidence Integrity (#779)
Deliverables: this plan; the ledger; `script/m56/verify-governance.ts`; the ledger
sync built on `script/m41/sync-ledger.ts --milestone m56`.
Carries forward three invariants learned the hard way:
- **Ledger ↔ artifact agreement.** Every verified entry must match the evidence
  file it names (commit + pass/fail/negative counts); G1's own entry is excluded
  from that comparison because the validating run rewrites its artifact, and every
  entry's commit must exist in this history.
- **A gate must be able to fail.** Each check has a planted negative; a gate that
  cannot fail is treated as absent.
- **Banned vocabulary.** The governance verifier carries a list of overclaiming
  words; none of them may appear in milestone artifacts or on the site.
Verifier: `verify-governance.ts`. Acceptance: green with negatives wired.

### E1 — Editors & IDEs Surface (#780)
Deliverables: `/editors` — what `bb_lsp` gives you (hover with evidence tier and
staleness, definition, references, document and workspace symbols, call hierarchy,
impact and graph views), per-editor setup (VS Code, Zed, Helix, JetBrains via
lsp4ij), the per-language feature claim matrix, and the declared exclusions (no
completion, no diagnostics, no rename). Publishing status stated honestly: built
VSIX and editor-native configuration today, marketplace publishing pending.
Proof images are real stills from the verified M45 captures.
Verifier: `verify-editors-page.ts` — claim matrix equals `ide/vscode/README.md`,
no marketplace-availability claim, stills present with size floors, exclusions and
publishing status rendered. Mutation-tested.

Implementation notes (as built):
- The page is generated into `website/src/data/editors.generated.ts` by
  `script/m56/generate-editors.ts` (`--write` / verify). Sources: the extension
  README and status model, `docs/m24/TOOL-DOC.md`, the M29 precision ledger, the
  M25 editor/OS/packaging evidence, the four integration configs, the extension
  manifest, and the verified M45 capture corpus.
- Two claim ladders are published side by side because two artifacts define
  them (the extension README's protocol/runtime/in-editor/cross-editor ladder
  and the status model's protocol/index/harness/editor/precision ladder). The
  gate parses all three claim sources independently and requires agreement with
  what the page renders; any documented drift between a doc row and its evidence
  is declared on the page (today: the Cursor pinned version) rather than
  resolved quietly.
- Proof images are four stills copied byte-for-byte from
  `validation/m45/results/demo-session/probes/`, sha-pinned in the generated
  data, captioned from the recorded observed beats, and re-hashed by the gate at
  every run.
- Publishing is stated as blocked with its reason, target registry and publish
  command from the M25 packaging record; the gate forbids any
  marketplace-availability phrase while that record says blocked.
- `/editors` joined the sitemap (M41.S1 requires exact route parity) and the
  main navigation; M56.I1 still owns the final nav set and the footer.
- Enforced by `npx tsx script/m56/verify-editors-page.ts` in the local `verify`
  chain and in CI's `verify-site` job.

### T1 — Tool Reference Single-Sourced (#781)
Deliverables: the tool-docs generator also emits
`website/src/data/tools.generated.ts`; `brain-tool-notes.ts` is deleted and the
tools page, docs table and homepage section render generated data; docs show full
descriptions (no first-sentence truncation); the homepage accounts for all 16 tools.
Verifier: `verify-tools-truth.ts` — generated file byte-identical to a fresh
generation, every rendered field traced to the registry or `docs/tools/*.md`, no
hand-written copy left, mutants caught.

Implementation notes (as built):
- `script/verify-tool-docs.ts` gained the site artifact, so ONE generator pass
  writes `docs/data/public-tools.json`, `docs/tools/*.md` and
  `website/src/data/tools.generated.ts` — 18 artifacts — and already fails on a
  stale copy, which is what makes byte-identity mechanical.
- `website/src/data/brain-tools.ts` keeps presentation only: display group,
  icon and the group blurbs. No fact-shaped keys may appear there.
- Fields the site renders: `summary`, full registry `description`, `mutability`,
  `requiresIndex`, `category`, `modes`, `plannedModes`, registry `defaults`,
  registry `examples`, parameters, `returns`, `errors`, `limitations`,
  `performance`, `safety`, `evidence`, `relations`, `staleness` (all curated
  text is the same text rendered into the shipped reference page).
- Enforced by `npx tsx script/m56/verify-tools-truth.ts` in the local `verify`
  chain and in CI's `verify-site` job (the job that installs website deps); the
  path filter now also watches `script/m56/`, `docs/tools/`,
  `script/verify-tool-docs.ts` and `script/m48/`.

### L1 — Languages Substance (#782)
Deliverables: per-family cards on the homepage carrying extensions, depth tier and
what the analyzer records (data that already exists and is registry-checked);
`/languages` retitled *Languages & analyzers* with the deep console retained.
Verifier: `verify-languages-surface.ts` — union of family ids equals the registry
exactly, every family renders tier and extracts, mutants caught.

Implementation notes (as built):
- `/languages` carries the surface name *Languages & analyzers* in its eyebrow and
  in its document title; the homepage register cells now name the depth tier beside
  the dot (`call graph` / `structural` / `generic pass`), in the tier's own accent,
  so a cell states what the family buys without a legend lookup.
- The console keeps its per-family record — extensions, registry names, recorded
  symbols, the plate label and what the tier means — plus the "What happens when
  you index" pipeline block. The four store tables that block names are checked
  against `src/brain/schema-ddl.ts`, and its `/docs#how-the-index-works` anchor is
  checked to resolve on the docs page.
- Depth claims are audited mechanically: every family above the generic pass must
  be backed by a real `src/ast/real-*-analyzer.ts` module, and the module↔family
  mapping must be a bijection (41 modules ⇄ 41 analyzed families). The inventory's
  one name mismatch (`make` → `real-makefile-analyzer.ts`) is declared in an alias
  table, so a new mismatch fails the gate instead of being absorbed. The generic
  tier is fully derived: no analyzer module exists for any of its languages.
- Partitions are gated: the homepage rails split and the four ecosystem bands must
  each cover every family exactly once. A family missing from the bands would still
  render its panel but be unreachable from the console index — a silent loss.
- Tier examples are gated too: every family named in a `TIER_PLATE` row must have
  that row's tier, so a re-tiered family cannot leave a stale example behind.
- Recorded limitation (in the evidence): the full-vs-structural split is itself an
  audited claim. No declarative language→call-graph table exists in `src/`, so the
  gate proves the analyzed/generic boundary and the analyzer bijection, not each
  analyzer's relationship depth.
- Enforced by `npx tsx script/m56/verify-languages-surface.ts` in the local
  `verify` chain and in CI's `verify-site` job.

### D1 — Docs Completion (#783)
Deliverables: docs sections for indexing internals (built-in skips, `.gitignore`,
`.bbignore`, size tiers, timing), keeping the index fresh (auto-refresh budgets and
opt-out, `--changed`, `--file`, `--post`, the recompute table), and data, upgrades
and uninstall (index location, migrations, `bb projects`, disk management), plus
the CLI flag table — all of it re-homed from `website/faq.md`, not re-invented.
Verifier: `verify-docs-completeness.ts` — each required section and claim present;
every quoted command or flag exists in `bb --help`; phantom flags rejected.

### S1 — Support Consolidation (#784)
Deliverables: `website/faq.md` is the single FAQ source and the page is generated
from it; `/support` renders the FAQ then a still-have-questions block
(`support@backbencher.cc`, `info@backbencher.cc`, bug reports, feedback, general
and press); `/faq` and `/contact` redirect; `FAQPage` structured data moves here
and is derived from the same source.
Verifier: `verify-support-page.ts` — every FAQ.md question and answer rendered,
JSON-LD matches the rendered text, redirects exist, emails are the real ones, and a
planted drifted answer fails.

### I1 — IA, Redirects and Sitemap (#785)
Deliverables: nav and footer become Install · Docs · Tools · Languages · Editors ·
Support; `/demos` retired with its M45.T1 scope change recorded; troubleshooting
content inlined into docs with `/troubleshooting` redirecting; sitemap equals the
discovered route list exactly; the redirect map declared.
Verifier: `verify-ia.ts` — route parity, nav set, redirect map, and no rendered
link pointing at a removed route.

### D2 — Design Pass (#786)
Deliverables: editors and support pages built from the shared plate/eyebrow/section
components; language cards and the homepage tools section restyled to carry data
without density; accessibility pass (contrast, focus, reduced motion).
Verifier: `verify-design.ts` — component reuse, palette tokens, contrast floors,
banned styles absent, responsive checks.
Acceptance: verifier green plus owner visual approval before closure.

### X1 — Closure, Deploy and M41 Fold-In (#787)
Deliverables: one-commit evidence batch for M56; M41's site gates (T2, T3, S1, S2,
D1) re-pinned at the pushed commit so M41.X1 closes on the same push; both closure
gates green; CI green; Vercel wait-for-checks proven; M41 (#640–#647) and M56
issues and milestones closed with evidence comments.
Acceptance: every closure check green at one commit; negative probes fire; owner
confirms dashboards and the live site.

## Gates & future verifications (permanent)

Every M56 verifier joins the verify chain and CI, and each one states where it
is enforced:

- G1 `verify-governance.ts` — `verify:fast` (CI `verify` job, all node matrix legs).
- T1 `verify-tools-truth.ts` — local `verify` chain and CI `verify-site` job.
- E1 `verify-editors-page.ts` — local `verify` chain and CI `verify-site` job.
- L1 `verify-languages-surface.ts` — local `verify` chain and CI `verify-site` job.

The site gates may not weaken:
M41's T2/T3/S1/S2/D1 continue to run, and any content change re-runs them — a new
page or a rewritten section that regresses truth fails CI before deploy.

## Evidence batch procedure (mechanical, not remembered)

1. run every M56 verifier at ONE HEAD, with no commit in between;
2. `npx tsx script/m41/sync-ledger.ts --milestone m56` — derives the ledger's
   nested evidence from the artifacts;
3. `npx tsx script/m56/verify-governance.ts` — green;
4. commit evidence + ledger, then stop re-running gates.

Re-running a single verifier after step 4 moves that artifact past the ledger and
G1 turns red until the batch is re-pinned. That is intended.

## Non-goals (explicit)

- No product code changes: `src/`, the MCP tool surface and the LSP server are
  untouched. This milestone is the website plus its gates.
- No new claim about unpublished artifacts: marketplace availability, npm packages
  and open-source status stay exactly as truthful today.
- No fake numbers, no placeholder counts, no "coming soon" surfaces that are not
  built and verified.

## Honesty notes

- Issues close as verified, known-gap or blocked — never silently skipped, never
  worded as verified when they are not.
- A fact that cannot be derived from an artifact is omitted rather than estimated.
- The editors page presents the same claim levels the extension UI shows and the
  precision ledger records; it may not round them up.
- Design work may not change a claim: T2/T3/S1 re-run unchanged after any redesign.
