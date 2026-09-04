# M41 — Website Truth, SEO & Design — Master Plan

> **STATUS: DRAFT v2 — for owner review. Not filed on GitHub.**
> On approval: file GitHub milestone M41 + the 8 issues below, create
> `validation/m41/ledger.json` + gates registry, then begin G1.

Milestone: M41 (number confirmed free; M37–M40 belong to co-agents) · Status: draft
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
Motion used sparingly. Mobile-perfect. Accessibility pass.
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

- Counts that cannot be derived from an artifact today are either derived from the
  registry or omitted — never estimated.
- SEO work describes only what bb verifiably does; no manufactured claims.
- Search-engine submissions require the owner's accounts; those steps are guided,
  not impersonated.
