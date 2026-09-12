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

### T1 — Tool Reference Single-Sourced (#781)
Deliverables: the tool-docs generator also emits
`website/src/data/tools.generated.ts`; `brain-tool-notes.ts` is deleted and the
tools page, docs table and homepage section render generated data; docs show full
descriptions (no first-sentence truncation); the homepage accounts for all 16 tools.
Verifier: `verify-tools-truth.ts` — generated file byte-identical to a fresh
generation, every rendered field traced to the registry or `docs/tools/*.md`, no
hand-written copy left, mutants caught.

### L1 — Languages Substance (#782)
Deliverables: per-family cards on the homepage carrying extensions, depth tier and
what the analyzer records (data that already exists and is registry-checked);
`/languages` retitled *Languages & analyzers* with the deep console retained.
Verifier: `verify-languages-surface.ts` — union of family ids equals the registry
exactly, every family renders tier and extracts, mutants caught.

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

Every M56 verifier joins the verify chain and CI. The site gates may not weaken:
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
