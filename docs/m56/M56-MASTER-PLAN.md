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

Implementation notes (as built):
- `/docs` gained three sections — *What gets indexed* (the three exclusion layers,
  the size tiers, indexing time), *Keeping the index fresh* (the read-path budget,
  the incremental commands, and the per-phase recompute table) and *Data, upgrades
  & uninstall* (storage shape, migrations, `--import`, disk management) — and the
  CLI reference now renders a per-command flag table.
- Everything numeric or enumerable on those sections is generated. New generator
  `script/m56/generate-docs-data.ts` writes `website/src/data/docs.generated.ts`
  from (a) the real CLI help, read from source through `script/m56/cli-probe.ts`,
  and (b) the source constants: `DIR_WALK_SKIP_DIRS`, `FULL_AST_LIMIT`,
  `STRUCTURAL_LIMIT`, `DIR_WALK_SIZE_LIMIT`, `structuralExtensions`,
  `AUTO_REFRESH_DEFAULTS`, `AUTO_REFRESH_ENV_ALLOWLIST`, the `recordPhase()` list,
  the `derivedPass` union and `bb-data-dir`. The hand-typed CLI cards and the FAQ
  prose they duplicated are gone.
- The help text is parsed with two independent instruments: the generator
  cross-checks its parse against the `.command()`/`.option()` declarations in
  `src/cli/index.ts` (statement-scoped, so `setup show` is not mistaken for a
  top-level command) and against `TRUTH.cliCommands`; the verifier then runs the
  CLI again and parses the help with its own reader.
- The documented storage shape is proven at runtime with a temp `BB_DATA_DIR`
  instead of being read out of a comment.
- Stale documentation found and corrected: the old *Upgrade caveat* advised users
  to fix `bb upgrade`'s release channel and to set `VERSION` on it — `bb upgrade`
  does not exist in this CLI. Upgrading is now stated correctly (rerun the
  installer, which replaces the binary in place; `VERSION` pins a release), and the
  gate's phantom-command check keeps a nonexistent command from reappearing.
- Product defect recorded, not published: `bb index --help` still ships the example
  `bb index import --db <path>`, which uses a flag the command does not declare.
  The CLI's example lines are therefore kept in the generated data but not rendered
  on the site; the reference points at `bb --help` for examples, and the gate's
  phantom-flag scan covers every flag the docs do publish.
- Enforced by `npx tsx script/m56/verify-docs-completeness.ts` in the local
  `verify` chain and in CI's `verify-site` job.

### S1 — Support Consolidation (#784)
Deliverables: `website/faq.md` is the single FAQ source and the support page is
generated from it; `/support` renders the FAQ then a still-have-questions block
(`support@backbencher.cc`, `info@backbencher.cc` — the four real channels);
`/faq` and `/contact` redirect (bookmarks stay valid, sitemap lists canonical
URLs only); `FAQPage` structured data is derived from the same generated array
the page renders. The old TSX FAQ array (8 thin answers) was folded INTO
faq.md (19 questions across 5 sections) and deleted; its CLI quick-reference
table was NOT copied (D1's generated CLI reference owns that now — single
sourcing in the other direction).
Verifier: `verify-support-page.ts` — independent faq.md parse (not the
generator's code) vs the generated data; every question and answer rendered
verbatim on /support; JSON-LD equals the rendered text; truth numbers
(15 tables / 16 tools / 49+46 languages) cross-checked into faq.md at
generation time; redirects exist; no rendered link targets a retired path;
sitemap excludes redirect sources. Mutants: drifted answer, dropped question,
wrong inbox, redirect-source in sitemap, stale generated file (generator
`--check` refuses), FAQPage detector rejecting a non-FAQ page, and the
multiline-anchor mechanism (a non-`m` heading scan must find 0 questions).

Implementation notes (as built):
- `script/m56/generate-support-data.ts` parses `## Section` / `### Question`
  structure from faq.md, normalizes answers to plain text (markdown stripped,
  links kept as `label (href)`), and refuses to generate when a count in
  faq.md disagrees with `truth.generated.ts` — drift fails at generation,
  before any page can publish it.
- The M41 SEO gate's FAQ chain rebinds to `/support` and now parses faq.md
  INDEPENDENTLY of the generator, so the two instruments can never share a bug.
- The route contract learned the redirect rule: `REDIRECT_ROUTES` are known,
  excluded from head-completeness and the sitemap, and verified to redirect;
  any other new route still fails discovery.
- The redirect stubs broke M41.T3's page-content checks by design — they were
  rebound to the support surface, and the nav set check now expects the
  consolidated links (redirect paths excluded).

### I1 — IA, Redirects and Sitemap (#785)
Deliverables: nav and footer become Install · Docs · Tools · Languages · Editors ·
Support; `/demos` retired with its M45.T1 scope change recorded; troubleshooting
content inlined into docs with `/troubleshooting` redirecting; sitemap equals the
discovered route list exactly; the redirect map declared.
Verifier: `verify-ia.ts` — route parity, nav set, redirect map, and no rendered
link pointing at a removed route.

Implementation notes (as built):
- **One redirect declaration.** `website/src/lib/redirects.ts` exports `REDIRECTS`
  (four retired paths → canonical destinations) and `RETIRED_ROUTES`. The four
  stubs, the sitemap and the gates all read that one file; no module hand-types a
  destination. `verify-ia.ts` parses the declaration and requires it to equal its
  contract, and M41.S1 pins the same map, so a live page cannot quietly become a
  stub (or a retired path become a live page) without failing a gate.
- **Retired set:** `/faq` → `/support`, `/contact` → `/support`,
  `/troubleshooting` → `/docs#troubleshooting`, `/demos` → `/editors`. Each URL
  stays valid for bookmarks and search results; the sitemap lists canonical URLs
  only, while still carrying every retired path in its route-parity contract
  (parity is against the disk, and the directories exist).
- **The nav is six surfaces** — Install · Docs · Tools · Languages · Editors ·
  Support — and the footer mirrors them. The shared `SiteFooter` now renders on
  `/docs`, `/tools`, `/languages` and `/editors`, which previously ended at
  bespoke footers; a live surface without the shared footer fails the gate.
- **`/demos` retirement is recorded, not deleted.** M45.T1's scope changed: the
  films were withdrawn by owner review, their 16 MB of derived cuts were removed
  from `website/public/demos` (the verified takes stay in
  `validation/m45/results/demo-session/`, and `script/m45/post-production.ts` can
  re-derive cuts if that decision ever reverses), and the surviving
  machine-verified stills serve on `/editors`. The gate was rewritten to assert
  the retirement (no film markup, no media in the bundle, no retired link, the
  declaration intact) and re-pinned at 19/19 checks + 6 mutants; its previous
  live-page scope is described here rather than erased.
- **Troubleshooting moved into `/docs`** with all six symptom-based fixes and
  their remediation commands; the retired page is a stub shorter than 700 bytes
  with no fix content, and the docs page is where the content is scanned.
- M41.S1, M41.T2/T3, M56.S1 and M45.T1 were updated in the same change: the SEO
  gate now derives the retired set from the declaration and verifies each stub,
  the site-truth gate binds the troubleshooting content checks to `docs.html` and
  requires the exact six-item nav, and the support gate scans every retired path
  for stray links.
- Recorded limitation (in the evidence): rendered-link scanning covers the
  surfaces that can link a retired path (support, nav, footer, docs, install); a
  retired link inside a long-form legal page would not be seen.

### D2 — Design Pass (#786)
Deliverables: editors and support pages built from the shared plate/eyebrow/section
components; language cards and the homepage tools section restyled to carry data
without density; accessibility pass (contrast, focus, reduced motion).
Verifier: `verify-design.ts` — component reuse, palette tokens, contrast floors,
banned styles absent, responsive checks.
Acceptance: verifier green plus owner visual approval before closure.

Implementation notes (as built):
- **Contrast is computed, not asserted.** The gate parses the surface and ink
  tokens out of `globals.css` and runs the WCAG relative-luminance formula over
  every one of them AND over every literal `text-[#hex]` / Tailwind accent class
  used in site source, against the LIGHTEST surface text can sit on
  (`--surface-2`, the plate hover state — not the kinder page canvas). The floor
  is 4.5:1 for all text; large-text exceptions are deliberately not used. Audit
  findings that were fixed rather than documented away: `--faint` was 3.40:1,
  `--muted-foreground` 4.17:1, the most-used muted ink `#8A7E6C` 4.46:1 on hover
  surfaces, `/docs` carried 40 cool-grey `zinc` classes (its tables had drifted
  to a different palette), and four alpha-faded ember text classes (`/70`,`/80`,
  `/90`) resolved to 2.9–4.4:1. Alpha-faded text classes are now refused outright
  by the gate.
- **Keyboard focus.** A global `:focus-visible` ring (2px ember-bright, 2px
  offset) plus a `.console-index label:has(> input:focus-visible)` rule, because
  the tools and languages consoles hide their radios (`.peer.sr-only`) and paint
  the row from them — a ring on the input would have been invisible. Both
  console indexes now carry `.console-index`, and the built stylesheet is checked
  for both rules.
- **Reduced motion.** Every `animation:` in `globals.css` must be inside a
  `prefers-reduced-motion: no-preference` block or have its rule's class listed
  in the `reduce` block. The check resolves through the rule's selector because
  the declaration names a keyframe (`marquee-x`) while the reduce block disables
  the class (`.marquee-track`).
- **One component kit.** `ui/section.tsx`, `ui/plate.tsx`, `ui/callout.tsx` and
  `ui/inline.tsx` hold the shared shell, surface, tone-aware note and inline
  vocabulary. `/editors` and `/support` import them and declare no local twins;
  `/docs` moved its note onto the shared `Callout`, whose tones now mean
  something (`default` context, `warn` limitation, `safe` guarantee).
- **Dead modules removed.** The gate requires every component module to be
  referenced; it found five unreferenced ones (`FeatureCard`, `StatsGrid`,
  `Grid`, `ui/badge`, `ui/button` — the last two from the shadcn scaffold) and
  they were deleted. `FeatureCard`/`StatsGrid` were the only users of
  `framer-motion`.
- **Homepage data without density.** The tool cards dropped the radial glow (it
  lifted card backgrounds unevenly) and the truncated JSON example strip, and
  now state two registry facts that matter before an agent calls a tool —
  `read-only` vs `writes to disk`, and `needs index` — with every type step
  ≥12px. The language register cells and rail tiles moved up one type step and
  the rail icons to full opacity; every L1-pinned fact (extensions, tier label,
  recorded symbols, `>name</h5>` anchors) is unchanged.
- **Responsive invariants.** Every `<table>` must sit inside an
  `overflow-x-auto` wrapper, and every page that renders a multi-column grid
  must declare a breakpoint — the pattern the docs/tools/editors tables already
  followed, now enforced.
- **Rendered proof.** No built page may contain a cool-grey class, and the built
  stylesheet must carry both focus rules, so the claims are checked end to end.
- Recorded limitation (in the evidence): contrast is computed on declared colours,
  not rendered pixels, so a parent opacity or blend mode could still reduce
  effective contrast (no such utility is used; alpha text is refused).
  Photographic media (the verified session stills) is exempt. Visual taste is
  not machine-checkable — owner approval remains the closure gate.

### X1 — Closure, Deploy and M41 Fold-In (#787)
Deliverables: one-commit evidence batch for M56; M41's site gates (T2, T3, S1, S2,
D1) re-pinned at the pushed commit so M41.X1 closes on the same push; both closure
gates green; CI green; Vercel wait-for-checks proven; M41 (#640–#647) and M56
issues and milestones closed with evidence comments.
Acceptance: every closure check green at one commit; negative probes fire; owner
confirms dashboards and the live site.

## X1 owner steps (the part no agent can do)

The closure gate proves everything observable from the repository. The steps below
need dashboards and credentials no agent holds, so they are listed as pending
owner actions rather than claimed as done:

1. **Push** the branch to `origin/main` — agents never push.
2. Confirm **CI** is green on the pushed commit
   (`gh run list --workflow ci.yml --limit 1`, or the Actions tab).
3. Confirm **Vercel** waits for the CI check before deploying, and that the
   deploy that follows is the pushed commit.
4. After the deploy, re-run `npx tsx script/m41/verify-seo-onboarding.ts`
   against the deployment: it moves M41.S2 onto the batch commit and closes the
   route lag it records (`deployLag=open` → `closed`).
5. Resubmit the sitemap in **Google Search Console**, Bing Webmaster Tools and
   Brave — one fetch each; the sitemap URL is unchanged.
6. Close the M41 (#640–#647) and M56 (#779–#787) issues and milestones with the
   evidence comments.
7. **Owner visual approval** of `/editors`, `/support`, the homepage tools
   section and the language cells — M56.D2's closure condition.

## Gates & future verifications (permanent)

Every M56 verifier joins the verify chain and CI, and each one states where it
is enforced:

- G1 `verify-governance.ts` — `verify:fast` (CI `verify` job, all node matrix legs).
- T1 `verify-tools-truth.ts` — local `verify` chain and CI `verify-site` job.
- E1 `verify-editors-page.ts` — local `verify` chain and CI `verify-site` job.
- L1 `verify-languages-surface.ts` — local `verify` chain and CI `verify-site` job.
- D1 `verify-docs-completeness.ts` — local `verify` chain and CI `verify-site` job.

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
