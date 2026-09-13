# M41 — Website Truth, SEO & Design — Master Plan

> **STATUS: FILED — GitHub milestone 41.**
> GitHub issue numbers (enforced exactly by the governance gate):
> G1=#640, T1=#641, T2=#642, T3=#643, S1=#644, S2=#645, D1=#646, X1=#647.
> Ledger: `validation/m41/results/manifest.json`.

Milestone: M41 · Status: open
Authority: this document · Governing contract: `docs/M14-HONESTY-CONTRACT.md`

## Purpose

backbencher.cc is stale and self-contradictory, and the *new* site code in `website/`
carries the same lies: "15 tools" (real public MCP surface: 11), "v1.0.19" (real:
0.3.0), phantom routes in `robots.txt` (`/s/`, `/share/` — opencode-era), tool
entries in `brain-tools.ts` that are not in the executable registry. Rule going
forward, enforced by CI:

> **No claim on the site that is not generated from — or verified against — the same
> artifacts our closure gates pin. No deploy unless every gate is green.**

The site lives inside this monorepo (`website/`) precisely so claims can be compared
side-by-side with reality. That placement is the whole point.

## Non-goals (explicit)

- No npm publish, no OSS repo, no license swap (parked: `docs/drafts/RELEASE-DISTRIBUTION-DRAFT.md`).
- No product code changes (`src/`) — website work only.
- No fake numbers ever: no download counts, no stars, no "open-source" claims until true.
  Forward-compatibility is structural: when npm publish lands, install text updates
  from the generated data layer, not by hand-editing pages.

## Issue list (8 issues, strict order; S2 may start once T2 is deployed)

### G1 — Governance, Ledger & Deploy-Gate Contract
Deliverables:
- `validation/m41/ledger.json` (M30-style nested evidence schema) + gates registry.
- Deploy-gate contract written down: which gates block Vercel, how the wait-for-checks
  toggle is proven.
Verifier: `script/m41/verify-governance.ts` — ledger schema, evidence policy,
negative cases (closure rules proven to fail on mutated ledgers), secret hygiene.
Acceptance: verifier green + mutants caught + wired into `npm run verify`.

### T1 — Truth Pipeline & Side-by-Side Inventory
Deliverables:
- `script/m41/generate-site-truth.ts`: reads authoritative artifacts
  (`docs/data/public-tools.json` + executable registry, `src/brain/schema-ddl.ts`,
  language registry, `package.json`, CLI command surface) → emits
  `website/src/data/truth.generated.ts`.
- **Side-by-side inventory**: every claim the site currently renders ↔ artifact
  value ↔ source path. The damage table. Becomes T2's worklist.
Verifier: `verify-truth-pipeline.ts` — generator output matches artifacts byte-wise;
negative cases: removing/altering a source artifact must fail the generator (never
silently emit stale data). Mutation-tested.
Acceptance: green + mutants + wired into chain.

### T2 — Truth Content Rewrite (existing pages)
Deliverables: `/`, `/tools`, `/docs` rewritten so every number/name/version renders
from `truth.generated.ts`. Hand-written prose allowed; hand-typed claims are not.
Phantom `robots.txt` routes removed.
Verifier: `verify-site-truth.ts` — builds the site, inspects rendered output for
every tracked claim, compares against artifacts. Mutation-tested (planted stale
claims must be caught).
Acceptance: green + mutants + wired into chain.

### T3 — New Pages (the missing stage-1 sections)
Deliverables: pages that exist nowhere today — **install, FAQ, troubleshooting,
contact** (owner's stage-1 list) — each generated-truth-checked and SEO-complete
from birth. Install page structured so npm instructions drop in later without edits.
Verifier: same `verify-site-truth.ts` extended to the new routes; route list
cross-checked against sitemap.
Acceptance: green + mutants + wired into chain.

### S1 — Technical SEO
Deliverables: `sitemap.ts` generated from real routes; canonical URLs; unique
titles/descriptions; Open Graph/Twitter cards (existing `public/social-share.png`);
JSON-LD `SoftwareApplication`; keywords woven into real content only (ast coding,
tree-sitter, wasm grammars, backbencher, ishaq2321, best mcp for coding,
best cli for coding, local code index, semantic codebase search).
Verifier: `verify-seo.ts` — sitemap validity + route match, uniqueness checks,
structured-data parse; mutation-tested (missing meta / duplicate titles caught).
Acceptance: green + mutants + wired into chain.

### S2 — Search-Engine Onboarding (owner + agent; checklist-driven)
This is the guided, hands-on issue: agent produces exact steps and files, owner
performs dashboard/DNS actions.
- Google Search Console: domain verification (DNS TXT or HTML file), sitemap submit.
- Bing Webmaster: import from GSC, sitemap submit.
- Brave Search: site submission.
- Post-verification: verifier asserts verification artifacts present in deployed site.
Acceptance: each engine shows verified/indexing status; evidence = screenshots +
verifier green; issue closed only when the owner confirms dashboards.

### D1 — Premium Design (owner's stage 3)
Deliverables: hero/tools/docs/new-pages redesigned to a premium terminal-native
aesthetic: dark, precise, monospace accents, **real bb output verbatim** (actual
`bb --help`, actual doctor transcript) instead of generic template art. Framer
Motion used sparingly. Fully responsive on mobile. Accessibility pass.
**Truth invariance constraint**: design may not change any claim — T2/T3/S1
verifiers re-run unchanged after D1; a redesign that regresses truth fails CI
before deploy.
Acceptance: all truth/SEO gates green post-redesign; screenshots as evidence;
build green.

### X1 — Closure & Deploy Gate
Deliverables:
- One-commit evidence batch at stable HEAD (M33/M34/M36 lesson).
- Full side-by-side audit re-run at the pushed commit; every gate green; CI green
  on GitHub.
- Deploy gate live: Vercel wait-for-checks enabled (owner dashboard toggle with
  agent steps); verifier asserts CI wiring.
- Close all issues + milestone with evidence comments.
Acceptance: every closure-gate check green at current HEAD; negative probes fire.

## X1 owner steps (the part no agent can do)

The closure gate proves everything observable from the repository; these steps
need dashboards and credentials no agent holds:

1. **Enable Vercel wait-for-checks** — project → Settings → Git → "Wait for
   Checks" — the one toggle that makes a red build undeployable.
2. **Push** the branch to `origin/main`.
3. Confirm **CI** is green on the pushed commit (Actions tab, or
   `gh run list --workflow ci.yml --limit 1`).
4. **After the deploy**, re-run `npx tsx script/m41/verify-seo-onboarding.ts`:
   it re-pins S2 onto the deployed commit and closes the recorded route lag.
5. Resubmit `sitemap.xml` in Google Search Console, Bing Webmaster Tools and
   Brave so the refreshed route set is crawled.
6. Close the M41 issues (#640–#647) and the milestone with the evidence comments.

## Gates & future verifications (permanent)

All M41 verifiers join `npm run verify` → enforced by CI on every push, forever.
Future design or content changes re-run truth/SEO gates — staleness becomes
structurally impossible, not just cleaned once. The ledger tracks all 8 issues with
the nested evidence schema; `verified` requires currentCommit, sourceFingerprint,
verifierCommand, evidenceFile, positiveAndNegativeChecks, mutantsAllCaught.

## Deploy-gate mechanics (ratified: CI + Vercel wait-for-checks)

Site gates ride the existing CI (green-required since M36). Vercel git integration
set to wait for the CI check before deploy — one owner toggle, proven in X1. No
separate deploy pipeline is created; the existing one becomes trustworthy.

## Honesty notes

- Issues close as verified, known-gap, or blocked — a known-gap or blocked state is
  never silently skipped and never worded as verified.
- Counts that cannot be derived from an artifact today are either derived from the
  registry or omitted — never estimated.
- SEO work describes only what bb verifiably does; no manufactured claims.
- Search-engine submissions require the owner's accounts; those steps are guided,
  not impersonated.

## Addendum — 2026-09-12: S1 structured data and route parity

Owner request: make the site eligible for search rich results, and fix the legal
pages being unfindable. Both are technical-SEO deliverables, so S1 was extended in
place rather than opened as a new issue; nothing here changes a claim the site
makes.

S1 now also enforces:

- **Route parity against the filesystem.** `website/src/app` is the authority:
every directory that owns a `page.tsx` (plus the root page) must appear in the
sitemap, and the sitemap must contain nothing else. The earlier check compared two
hand-written lists on both sides, which is exactly why `/privacy` and `/terms`
could sit outside the sitemap without failing anything. They are in it now.
- **Head coverage for every real route**, replacing a fixed eight-route list. Turned
on for the first time, it caught `/demos` shipping without a canonical URL — fixed
in the same change.
- **`FAQPage` structured data on `/faq`**, built from `src/data/faqs.tsx`: the same
array the page renders, with each answer's plain text extracted from its React
nodes. The gate proves source → JSON-LD → rendered page agree, so no answer can be
published to a search engine that the page does not show. The payload escapes `<`
so a quoted `bb tool <name>` cannot corrupt the script element.
- **Negatives that can fail**: the homepage must not satisfy the FAQPage detector; a
drifted answer and a drifted question must each be rejected; a sitemap missing a
real page must be rejected; the normalizer must strip React's text separators and
decode entities.

Evidence limitations were updated accordingly: structured data claims only the two
types the site actually carries, and route discovery follows the directory layout.

### Evidence-batch invariant (same change)

G1 now rejects a ledger entry that disagrees with the evidence file it names —
commit, passes, failures, negative cases — plus a separate check that every entry's
commit exists in this history. G1's own entry is excluded from the artifact
comparison (the validating run replaces G1.json, so that comparison could never
settle) but not from the reachability check.

The check was added because the M41
ledger was found citing pre-re-pin commits and a stale passed-count for T2 and T3
while the files on disk said otherwise: drift that makes a "one-commit batch" a
claim instead of a fact. T3's artifact was also left behind by a mass re-pin and
is re-pinned in this batch.

The batch procedure is therefore mechanical rather than remembered:

1. run every M41 verifier at ONE HEAD, with no commit in between;
2. `npx tsx script/m41/sync-ledger.ts` — copies each artifact's facts into the ledger;
3. `npx tsx script/m41/verify-governance.ts` — green;
4. commit evidence + ledger, then STOP re-running gates.

Re-running a single verifier after step 4 moves that artifact past the ledger and
G1 turns red until the batch is re-pinned. That is intended: staleness becomes
visible instead of invisible.
