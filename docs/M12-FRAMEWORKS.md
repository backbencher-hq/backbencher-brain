# M12.46 — Framework & Library Intelligence Across All Languages

**Issue:** #185
**Milestone:** M12.46 — Framework and library intelligence across all languages
**Status:** ✅ Complete, verified, committed

## Summary

M12.46 verified and repaired framework detection across every language family
against a hand-audited fixture corpus AND the pinned real-repository corpus. The
audit found **five real framework-intelligence defects** — all fixed at the
framework layer (`src/ast/framework-intelligence.ts`) plus two analyzer-level
fixes — and now measures **precision 1.000 / recall 1.000** on the framework
differential with **zero fabrication**.

## Defects found and fixed

1. **Primary framework never promoted from merged detections (systemic).**
   Analyzers compute `metadata.framework` from their *own* detection list, which
   is frequently empty or a language default (`unknown`, `JavaScript`, `SQL`),
   while `FrameworkIntelligence.enhanceWithFrameworkIntelligence` merged a richer
   detection list *after* the fact without promoting the primary. Result: a
   Django file reported `framework="unknown"` while `detectedFrameworks=["django"]`.
   - Fix: promotion rules in `enhanceWithFrameworkIntelligence` — a real
     (non language/default) framework in the merged list becomes the primary;
     missing/unknown primaries fall back to the first real detection; deliberate
     analyzer choices (HTML5, Vue, Svelte, Standard C Library, Java `spring`,
     PHP `Laravel`...) are never overwritten.
   - Fixed primary output: C# `aspnet-core`/`entity-framework`, Ruby
     `Ruby on Rails`, Python `django`, Elixir `phoenix`, Rust `actix-web`,
     C++ `boost`, Erlang `otp`, Express `express`, dbt `dbt`.

2. **`detectFrameworks` switch mis-routed whole languages to foreign
   detectors** — SQL→Scala, CSS→Dart, HTML/ObjC/HCL→Groovy, JSON→Kotlin,
   GraphQL→Go, Clojure→C/C++. This could fabricate detections (a CSS file
   mentioning "gradle" would be flagged Grails). All non-detector languages now
   route to `default` (analyzer-owned detection only).

3. **Rust detector never fired.** It matched `actix-web` (hyphen) but Rust
   imports are `actix_web` (underscore); `rayon`/`axum`/`tokio`/`serde` were
   missing entirely. Fixed with underscore+hyphen matching, attribute checks
   (`#[actix_web::main]`, `#[tokio::main]`), and new crates (rayon, axum, poem,
   async-std, serde, clap, diesel, sqlx).

4. **No SQL detector.** dbt (Jinja `{{ config(...) }}`, `{{ ref(...) }}`,
   `{{ source(...) }}`) was never detected. Added `detectSqlFrameworks` (dbt +
   dialect hints).

5. **Detection noise.** Case/underscore duplicates polluted the detected list
   (`Servant`/`servant`, `spring_mvc`/`spring-mvc`, `gorilla_mux`/`gorilla`).
   Added alias canonicalization + case-insensitive dedup. Pure language names
   (`JavaScript`, `SQL`, `Bash`) and tooling defaults (`stl`, `cmake`, `POSIX`)
   are filtered out of `detectedFrameworks` so the list is actionable.

6. **TS/JS `@Component` ambiguity.** The Vue detector flagged Angular's
   `@Component` decorator as Vue options-API. Now gated on a `vue` import.

7. **Erlang primary was the module name** (`framework="app"`). Now defaults to
   `"Erlang"` and promotes to `otp` when an OTP behaviour is detected.

## Evidence

### Differential harness (`script/m12/verify-m12-frameworks.ts`, committed)

- 30 fixtures across 7 families (JVM / .NET / Web / Systems / Functional /
  Dynamic / Data-Shell), each with idiomatic framework constructs:
  Spring MVC+JPA, ASP.NET Core+EF, Angular (negative-vue guard), React,
  Express, actix-web+rayon, boost, Phoenix, Servant, Ring+Compojure,
  OTP gen_server, Django, Rails, Laravel, dbt, Terraform; plus plain negative
  fixtures per family.
- Hand-audited ground truth: `validation/m12/ground-truth/framework.json`
  (65 facts: 41 resolved, 24 unknown).
- **Result: precision 1.000, recall 1.000, FP 0, FN 0, fabrication 0** →
  `validation/m12/results/framework-differential.json`.

### Real-corpus validation (`script/m12/verify-m12-framework-corpus.ts`, committed)

- 78 sampled files across 15 pinned real repositories (vue-core, svelte,
  grails-core, elixir, terraform, dplyr, fsharp, scala3, swift-nio, cargo,
  phpunit, powershell, rake, graphql-js, go-tools).
- **Result: 57 expected-framework matches, 21 honest language-defaults
  (no framework used), 0 mismatches, 0 fabricated detections** →
  `validation/m12/results/framework-corpus.json`.

### Regression safety

- **19 affected analyzer differentials** (typescript, javascript, c, erlang,
  elixir, python, ruby, sql, rust, cpp, go, swift, clojure, haskell, scala,
  groovy, php, r, perl): all still **P/R 1.000**.
- **M12.44 pipeline probe:** PASS (storage path, incremental, cross-language).
- **M12.45 tools probe:** PASS (all 41-language read tools).
- `npm run typecheck`, `npm run build`, and the full `npm run verify` chain:
  **all PASS** (exit 0, zero FAIL lines).

## Scope

- `src/ast/framework-intelligence.ts` — promotion, switch routing, SQL dbt
  detector, Rust detector, Swift NIO/Vapor/XCTest, canonicalization.
- `src/ast/framework-detectors.ts` — Vue `@Component` ambiguity fix.
- `src/ast/real-erlang-analyzer.ts` — module-name-as-framework fix.
- `validation/m12/framework-fixtures/**` — 30 fixtures, 7 families.
- `validation/m12/ground-truth/framework.json` — 65 hand-audited facts.
- `script/m12/verify-m12-frameworks.ts` — framework differential harness.
- `script/m12/verify-m12-framework-corpus.ts` — real-corpus validation.
- `validation/m12/results/framework-differential.json` + `framework-corpus.json`
  — measured evidence.
