# M46: Syntax Truth, Armed — grammar-gap health fix made permanent

## The milestone invariant (verbatim, enforced by G1)

> **A file must carry `has_syntax_errors = 1` if and only if it is genuinely
> unparseable — grammar gaps on legal code (tree-sitter limitations) and
> lint-style warnings must never flag a healthy file, and genuinely broken
> files must always stay flagged.**

Every acceptance criterion in this milestone traces to that sentence. H1 proves
the discriminator on synthetic minimals of every known gap class; H2 proves it
on real repositories with the full default pipeline; X1 refuses milestone close
unless every gate passes live at one stamp.

## Findings recap (evidence from code + a real full index, 2026-09-06)

Post-M45 deep review ("Health 92% deep-dive") re-ran the real indexer on this
repository and SQL-audited every file flagged `has_syntax_errors = 1`. Of 27
flagged files, 5 were **false positives on legal code**:

1. **Tree-sitter grammar gaps (4 legal-construct classes).** The bundled
   tree-sitter-typescript grammar (0.23.2 — the latest release; no upgrade
   path exists) cannot parse:
   - `import("./m").T` type annotations (`src/lsp/server.ts:421`),
   - `<!--` inside regex literals (`script/m41/verify-site-truth.ts:39`),
   - `unique` used as a value identifier, which the grammar reserves for the
     `unique symbol` type (`src/brain/semantic/local-embed.ts:56`),
   - a bare `&` inside double-quoted TSX attribute strings — Tailwind
     arbitrary variants like `className="[&_code]:…"` (`website/src/app/faq/page.tsx:118`).
   All four files pass `tsc`. Every class reproduced in minimal form.
2. **Lint warnings sharing `severity: "warning"` with real parse errors.**
   A React hook anti-pattern warning flagged `relationship-kinds.svelte` as
   "syntax-broken" — a lint verdict is not a parse verdict.

**Fix shipped (`2da3cf4e`):**
- `src/ast/engine.ts` — grammar-gap discriminator: when a TS-family parse has
  errors, re-parse a copy with the four legal constructs neutralized (probe
  used ONLY for the error report; symbols/ranges always come from the ORIGINAL
  parse). Clean probe → grammar gap on valid code → parse errors are not
  reported as syntax errors. Genuinely broken files still error on the probe
  and stay flagged.
- `src/ast/parallel-indexer.ts` — the store now sets `has_syntax_errors = 1`
  only for warnings whose message is a genuine parse/syntax warning
  (`SYNTAX_WARNING_RE`), never for arbitrary analyzer lint warnings.

**Verified end-to-end (fresh full index of this repo):** flagged 27 → 22. All
five false positives cleared; every by-design m12/m14 poison fixture and the
four documented non-code grammar-gap files (2 analyzer `.md`, `create-issues.sh`,
a dbt `.sql`) remain flagged — real signal, kept. Zero symbols lost
(13/42/12/6 intact per file). The remaining health note is embedding coverage
(env: local-only vectors), not syntax.

## Why a milestone and not just the commit

The fix is committed; the *regression armature* is the deliverable. Three prior
data-truth fixes each survived earlier "verified" eras because nothing forced
the failing path (m22 V5 ran in-process; health checks were never pinned). The
same class of fix needs the same treatment:

- **H1** forces the real indexer (worker-pool mode asserted) over a fixture
  containing all four legal-construct minimals + one genuinely broken file, and
  asserts: gap files NOT flagged, broken file flagged, symbols intact. The gate
  independently re-parses each fixture with its own neutralizer copy, proving
  each minimal genuinely carries pre-neutralization errors (the fixture is
  non-vacuous: delete the discriminator and H1 fails).
- **H2** full-indexes real repositories (this repo + TS/JS/Ruby copies from
  `fixtures/repositories`) and re-checks every flagged real-code file: a file
  flagged outside negative-fixture dirs must survive an independent probe
  re-parse (genuinely broken) — grammar-gap-only flags fail the gate. Real
  values recorded: repos, files, flagged sets, wall times.
- **X1** refuses close unless every gate passes live, read-only, at one stamp.

## Codes

| Code | Scope | Gate |
|---|---|---|
| G1 | Governance: ledger, registry, chain, auto-pass audit | verify-governance.ts |
| H1 | Syntax-truth fixture gate (4 gap classes + genuine breakage, worker-pool) | verify-h1-syntax-truth.ts |
| H2 | Real-repo syntax-truth corpus (this repo + fixtures copies) | verify-h2-real-repo-syntax.ts |
| X1 | Closure gate (single-stamp consensus, live read-only re-runs) | verify-closure.ts |

Every content gate joins `npm run verify` in the same change that lands it
(G1 check). No auto-pass predicates in any M46 verifier (G1 audit).
