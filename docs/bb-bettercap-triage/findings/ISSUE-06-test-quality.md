# ISSUE-06 — `test_quality`: Go test files score `assertions: 0` (114 real assertion sites), and "parameterization" fires on printf `%s`, labelled `it.each/test.each`

- **Lane:** `go-testintel` · **Task:** task-5 · **Product:** `backbencher-brain` HEAD `be4c0ef25` · **bb:** 0.1.6
- **Date:** 2026-11-18 · **Specimen:** `/home/ishaq2321/bettercap` (projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`), `session/` scope
- **Read-only campaign:** no source edits, no reindex, no writes. Repro of record: `evidence/go-testintel/06-quality-session-fp.json` (15,272 B, exit 0).

## Verdict

**REAL** for the measured claims, with one mechanism correction. Reproduced exactly:

- all **7/7** `session/*_test.go` files: `assertions.evidenceStrength = 0`, `observedAnchor: null`, `issues:[no_assertion_evidence]`, dimension `confidence 0.85` — against **114 real assertion sites** counted in those same files (`t.Fatalf`/`t.Errorf`/`t.Fatal`/`t.Error`);
- aggregate `mean = 0.32222222222222224` — the report's `0.322` exactly; it is the **mean of the 7 per-file `overall` values**, each a confidence-weighted mean of measured dimensions (recomputed and verified, see §"What 0.322 is");
- `parameterization.observedAnchor` literally `"it.each/test.each template"` on Go files that contain **no `it.each`/`test.each` token at all**.

Mechanism correction (report wording is imprecise, verdict unchanged): what actually fires for "parameterization" on these Go files is the **bare `%s` alternative inside the same JS-shaped regex**, not `it.each`/`test.each` — per-file match counts equal the files' printf-verb counts exactly. The report's parenthetical ("JavaScript heuristics applied to Go table tests") is right; the named token is not. Two further facts the report omits: `error_handling` is **also 0** for all seven files (`no_error_path_evidence`, Go's `if err != nil` unseen), and the *penalty* term is inert because of a `clamp01` floor (§UNLOCKED).

**Severity: medium** (high if the aggregate is used as a quality gate or ranking input). It is a measured false negative on the standard-library assertion idiom of a supported language, published with `confidence: 0.85` and an aggregate number.

**Confidence:** high — numbers reproduce bit-for-bit; regexes quoted from source; single-file recomputation of `overall` matches to 4 d.p.; cross-language probe runs the shipped classifier table directly.

## Why it matters to a user

"Are these Go tests weak?" — the tool answers "zero assertions, aggregate 0.32" for tests that contain 114 `t.Fatalf`/`t.Errorf` assertions and 14 `if err != nil` failure checks. A user or agent triaging test debt is told to rewrite tests that are fine, and a repo-wide quality trend is meaningless for Go (and, per the probe, for Python). Because the wrong answer names a JS construct (`it.each`) in `observedAnchor`, it also reads as a bug report about the *user's* tests rather than about bb.

## Reproduce (exact, bounded)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
# A. the reported page (7 files; test_quality accepts filePath + limit; NOT target)
node bin/bb tool bb_analyze --dir /home/ishaq2321/bettercap \
  --args '{"mode":"test_quality","filePath":"session","limit":50}' \
  > docs/bb-bettercap-triage/evidence/go-testintel/06-quality-session-fp.json
jq '{aggregate, summary}' docs/bb-bettercap-triage/evidence/go-testintel/06-quality-session-fp.json

# B. per-file dimensions of record
jq -r '.files[] | "\(.relativePath)\toverall=\(.overall)\tissues=\([.issues[].category]|join(","))\tassert=\([.dimensions[]|select(.id=="assertions")][0].evidenceStrength)\tparam=\([.dimensions[]|select(.id=="parameterization")][0].evidenceStrength)\tparamAnchor=\([.dimensions[]|select(.id=="parameterization")][0].observedAnchor)"' \
  docs/bb-bettercap-triage/evidence/go-testintel/06-quality-session-fp.json

# C. Go ground truth — real assertion sites in the same seven files
cd /home/ishaq2321/bettercap/session
for f in *_test.go; do echo -n "$f: "; echo "asserts=$(( $(grep -o 't\.Fatalf(' $f|wc -l) + $(grep -o 't\.Errorf(' $f|wc -l) + $(grep -o 't\.Fatal(' $f|wc -l) + $(grep -o 't\.Error(' $f|wc -l) )) if_err_nil=$(grep -c 'if err != nil' $f) t_Run=$(grep -o 't\.Run(' $f|wc -l) printf_%s=$(grep -o '%s' $f|wc -l) it_each=$(grep -c 'it\.each' $f)"; done
# -> 114 assertion sites total; 0 it.each; %s counts equal the parameterization counts below

# D. cross-language probe of the SHIPPED classifier table (no indexing; imports src/…/quality.ts via local tsx)
node_modules/.bin/tsx .tools/triage-tmp/go-testintel/probe-classifiers.mts \
  > docs/bb-bettercap-triage/evidence/go-testintel/06-classifier-crosslang.json

# E. second real Go repo (existing index; no new index created)
node bin/bb tool bb_analyze --dir /home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql \
  --args '{"mode":"test_quality","limit":50}' | jq '{aggregate, summary}' \
  > docs/bb-bettercap-triage/evidence/go-testintel/06-quality-gqlgen-graphql.json
```

## Bounded observed output

`aggregate` of A (the number the report quotes):

```
{ "mean": 0.32222222222222224,
  "perDimension": { "assertions": 0, "mocking": 0, "error_handling": 0,
                    "parameterization": 0.6190476190476193, "docs": 0.7142857142857143,
                    "fixtures": 0.6071428571428571 } }
summary: filesWithContent 7, filesUnknown 0, unsupportedDimensionCount 0, returned 7, totalFiles 7, truncated false
```

Per file (A) vs ground truth (C):

| file | reported `overall` | `assertions` | `no_assertion_evidence` | `missing_error_path` | real assertion sites | `if err != nil` | `t.Run` | `%s` | observed `parameterization` |
|---|---|---|---|---|---|---|---|---|---|
| command_handler_test.go | 0.1556 | 0 | yes | yes | 5 | 0 | 0 | 2 | 0.667 |
| environment_test.go | 0.3444 | 0 | yes | yes | 56 | 13 | 0 | 11 | 1.0 |
| events_test.go | 0.4 | 0 | yes | yes | 8 | 0 | 6 | 2 | 0.667 |
| module_handler_test.go | 0.2889 | 0 | yes | yes | 7 | 0 | 4 | 0 | 0 |
| module_param_test.go | 0.4556 | 0 | yes | yes | 24 | 1 | 4 | 9 | 1.0 |
| session_setup_test.go | 0.2 | 0 | yes | yes | 1 | 0 | 1 | 0 | 0 |
| session_test.go | 0.4111 | 0 | yes | yes | 13 | 0 | 6 | 16 | 1.0 |
| **total** | mean 0.3222 | **0** | 7/7 | 7/7 | **114** | 14 | 22 | 40 | **0 `it.each` anywhere** |

The `parameterization` column is a replay of the printf-verb count: every file's strength is `min(1, %s_count/3)` exactly (2→0.667, 11→1, 2→0.667, 0→0, 9→1, 0→0, 16→1). The label attached to it is, verbatim from A, `observedAnchor: "it.each/test.each template"` — for files whose only matched token is `%s`.

Cross-language probe of the shipped `CONTENT_CLASSIFIERS` (D), `min(1,count/6)` / `min(1,count/3)` as the engine computes it:

| snippet | `assertions` strength | `parameterization` strength | verdict |
|---|---|---|---|
| Go plain `t.Fatalf`/`t.Errorf` | **0** | 0 | standard Go style invisible |
| Go table-driven `t.Run` + `t.Errorf("%s: …")` | **0** | **0.333** | assertions invisible; `%s` false-positive |
| Go testify `assert.Equal` + `require.NoError` | 0.333 (2 of 4) | 0 | only `assert.*` half seen; `require.*` invisible |
| JS vitest `it.each` + `expect().toBe()` + `toThrow` | **1.0** | 0.667 | fully recognised |
| Python `pytest.mark.parametrize` + `assert x == y` | **0** | **0** | Python also under-scored |
| TS `node:test` + `assert.strictEqual` | 0.167 | 0 | partially recognised |

Second real Go repo (E, gqlgen `graphql`, 71 test files): `aggregate.mean = 0.5297`, `assertions` per-dimension `0.543`, **18/71 files still `assertions: 0`**. Corpus style counts: `assert.` 956, `require.` 622, `t.Fatalf` 9, `t.Errorf` 14 — the 0.543 credit is an **accident of testify's `assert.` spelling** matching the JS-shaped regex; the 622 `require.*` sites and every `t.Fatalf`/`t.Errorf` are invisible, and 18 files (those using stdlib or `require`-only style) score 0. So the defect is not "Go always scores 0" but "the score tracks JS spelling, so it under-scores Go by however much of the corpus happens to use `assert.`".

## What 0.322 is (recomputation, verified)

`aggregate.mean` = arithmetic mean of the per-file `overall` for files where it is non-null (`src/intelligence/testing/quality.ts:336,346`).

`overall` per file (`:301-313`) = `Σ conf·clamp01(evidenceStrength − 0.5·penalty) / Σ conf` over *measured* dimensions. Recomputed for `session/session_test.go` from its six dimension rows: `(0.85·0 + 0.7·1 + 0.8·0 + 0.8·0.5 + 0.6·0 + 0.75·1) / (0.85+0.7+0.8+0.8+0.6+0.75) = 1.85/4.5 = 0.4111…` = reported `0.41111111111111115`. Exact. The seven `overall`s are `0.1556, 0.3444, 0.4, 0.2889, 0.4556, 0.2, 0.4111` → mean `0.322222`. The report's number is correctly quoted and is the scoped-session aggregate (project-wide, bettercap would be a different number — not needed to reproduce the claim).

Counterfactual with a language-aware vocabulary, holding every other dimension constant (`evidence/go-testintel/06-projection-language-aware.json`):

- observed aggregate **0.3222**
- fix `assertions` only (Go `t.Fatalf/t.Errorf/t.Fatal/t.Error` + `require.*`/`assert.*`) → **0.4774**
- fix `assertions` + `error_handling` (`if err != nil`) + `parameterization` (`t.Run` table loops, `%s` removed) → **0.5028**

Delta +0.18 for measurement that exists today. Even the 0.50 is deflated by the inert penalty term (see UNLOCKED), so this is a lower bound on the modelling gap.

## Expected vs observed

| Source | Claim | Reality |
|---|---|---|
| `docs/BB_TEST_QUALITY.md:34` | `assertions` evidence = `assert*(` / `expect(` / `should.` | A superset of *three JS idioms*; Go's `t.Fatalf`/`t.Errorf`/`t.Fatal`/`t.Error` and testify `require.*` are outside it. The doc does say "framework-agnostic token evidence" (`:72-74`), which is an honest *scope* statement — but the payload still publishes `confidence 0.85` plus an aggregate without a language-coverage caveat. |
| `docs/BB_TEST_QUALITY.md:36` | `parameterization` evidence = `it.each` / `test.each` / template cases | Regex also contains `%s` and `$x`; on Go files `%s` is a printf verb, so the dimension fires on non-parameterized tests and the anchor string names a token that was never matched. |
| `docs/BB_TEST_QUALITY.md:41-49` | "A dimension is absent only when there is genuinely no evidence"; unknown states never fabricate | It does not fabricate: it reports strength 0, `supported: true`, confidence 0.85 — a confident zero, which is worse for the reader than an unknown. |
| report | "all seven Go test files score assertions: 0, issue no_assertion_evidence" | Reproduced 7/7. |
| report | "'parameterization' is detected via it.each/test.each" | **Mechanism corrected**: fires via the `%s` alternative; `observedAnchor` label is the JS string regardless. |
| report | "Aggregate 0.322" | Reproduced exactly: mean of the 7 per-file overalls. |
| report (omitted) | — | `error_handling` is also 0 for all 7 files (7/7 `no_error_path_evidence`) — same class, not mentioned. |

## Root cause (file:line + quoted code)

### The classifier table is one language-agnostic (in practice, JS-shaped) regex set — `src/intelligence/testing/quality.ts:108-130`

```ts
export const CONTENT_CLASSIFIERS = {
  assertCall: /\bassert(?:\.[A-Za-z]+)?\s*\(/g,
  expectCall: /\bexpect\s*\(/g,
  shouldMember: /\bshould\./g,
  chainedMatcher: /\.(?:toBe|toEqual|toStrictEqual|toThrow|toBeTruthy|toBeFalsy|toMatch|toContain|rejects|resolves)\s*\(/g,
  rejectsResolves: /\b(rejects|resolves)\b/g,
  tryBlock: /\btry\s*\{/g,
  throwMatcher: /\btoThrow|throws\b/g,
  catchClause: /\bcatch\s*\(/g,
  parameterized: /\b(?:it|test)\.each\b|\b(?:describe|it|test)\s*\(\s*`|%s|\$[a-zA-Z]/g,
  commentLine: /(^|\n)\s*(\/\/|\/\*|#)/g,
  longTestName: /\b(?:it|test|describe)\s*\(\s*['"`][^'"`]{24,}['"`]/g,
  spyMockCall: /\b(jest|sinon)\.(fn|spyOn|mock)\b|vi\.(fn|spyOn|mock)|\.mockImplementation|nock\(/g,
}
```

- `assertCall` matches `assert(`, `assert.equal(` and — by accident — testify's `assert.Equal(`; it does **not** match `require.Equal`, `t.Fatalf`, `t.Errorf`, `t.Fatal`, `t.Error`, `panic(`.
- `parameterized` includes `%s` and `$x` as "template cases": in Go `%s` is a printf verb and `$` appears in shell/env strings; in the seven files the `%s` count equals the dimension's raw match count exactly. There is no check that a `%s` appears in a *test-name template* context.
- `longTestName` only recognises `it|test|describe('…')`, so Go's `func TestXxx(t *testing.T)` and Python's `def test_xxx(` never count toward `docs`.

### The assertions dimension consumes exactly that table — `quality.ts:235-244`

```ts
      const asserts = count(P.assertCall) + count(P.expectCall) + count(P.shouldMember) + count(P.chainedMatcher)
      dims.assertions = dim({
        supported: true,
        evidenceStrength: clamp01(asserts / 6),
        penaltyPotential: asserts === 0 ? 1 : clamp01(1 - asserts / 6),
        observedAnchor: asserts > 0 ? "assert/expect usage" : null,
        confidence: 0.85,
      })
      if (asserts === 0) issues.push({ category: "no_assertion_evidence", description: "no assert/expect statements observed" })
```

`supported: true` + `confidence: 0.85` for a measurement that cannot see the language's standard assertion API. The issue text ("no assert/expect statements observed") is technically true and readably false.

### The parameterization dimension hard-codes the JS label — `quality.ts:258-266`

```ts
      const param = count(P.parameterized)
      dims.parameterization = dim({
        supported: true,
        evidenceStrength: clamp01(param / 3),
        penaltyPotential: 0, // absence is not penalized heavily
        observedAnchor: param > 0 ? "it.each/test.each template" : null,
        confidence: 0.75,
      })
```

`observedAnchor` is a **constant string**, not a description of the token that matched: a Go file matched by the `%s` alternative still reports `"it.each/test.each template"`.

### No language gate anywhere in the engine — `quality.ts:158-161` selects `language`, never branches on it

```ts
  const files = raw.prepare(
    "SELECT id, relative_path AS rel, path, language, COALESCE(line_count,0) AS lines " +
      "FROM brain_file WHERE project_id = ? AND COALESCE(is_test_file,0) = 1" + scopeSql + codeClause.sql + " ORDER BY relative_path",
  ).all(…) as Array<{ id: string; rel: string; path: string; language: string | null; lines: number }>
```

`language` is selected into the row type and then never read by any dimension — the engine has the language and the vocabulary is nevertheless universal. `CONTENT_CLASSIFIERS` is exported as one frozen table for every language; no `MOCK_LIB_PREFIXES`-equivalent per-language vocabulary exists (`:134`).

### Why `overall` moves so little, and why the aggregate is a poor summary — `quality.ts:301-313`

```ts
    const measured = Object.values(dims).filter((d) => d.supported && d.evidenceStrength !== null)
    if (measured.length > 0) {
      let sum = 0; let w = 0
      for (const d of measured) {
        const conf = d.confidence ?? 0.5
        const penalty = d.penaltyPotential ?? 0
        sum += conf * clamp01((d.evidenceStrength ?? 0) - 0.5 * penalty)
        w += conf
      }
      overall = w > 0 ? sum / w : null
    }
```

`clamp01(…)` floors the composite at 0, so a dimension with 0 evidence and penalty 1 contributes `clamp01(−0.5) = 0` — the penalty can never pull a file below its *other* dimensions' credit, and any file with 1–2 assertions (`clamp01` band) is indistinguishable from zero. That is an adjacent defect recorded in `findings/UNLOCKED.md`; it is not required to reproduce the report's number (the numbers above are the engine's, exactly).

## Generality

| language | project / fixture | same class? | evidence |
|---|---|---|---|
| Go | bettercap `session/` (7 files) | **YES** — 7/7 `assertions: 0` vs 114 real sites; aggregate 0.3222 reproduced | `06-quality-session-fp.json` |
| Go | gqlgen `graphql` (71 files, second index) | **YES, corpus-dependent** — aggregate 0.5297, 18/71 files `assertions: 0`; the 0.543 per-dim credit comes only from testify `assert.` spelling, while 622 `require.*` + all `t.Fatalf/t.Errorf` are invisible | `06-quality-gqlgen-graphql.json` |
| Go | shipped-classifier probe: `t.Fatalf` / `t.Run` table | **YES** — assertions 0 / 0; parameterization 0 / 0.333 (`%s` false positive) | `06-classifier-crosslang.json` |
| JS | shipped-classifier probe: vitest `it.each`+`expect`+`toThrow` | no defect — assertions 1.0, parameterization 0.667 | same |
| TS | shipped-classifier probe: `node:test` + `assert.strictEqual` | partial — assertions 0.167 (recognised, under-weighted) | same |
| Python | shipped-classifier probe: `pytest.mark.parametrize` + `assert x == y` | **YES — same class** — assertions 0, parameterization 0; pytest's `assert` statement has no parenthesis and `parametrize` is not in the regex at all | same |
| Rust / Java / Ruby (no index probed; vocabulary absent by inspection) | source | **expected same class** — none of the tokens exist in the table | `quality.ts:108-130` |

**Conclusion:** the model is **JS-shaped globally**, not Go-specific. Every language whose assertion/parameterization vocabulary differs from Jasmine/Jest/Vitest under-scores; Go is the demonstrated case (report), Python is demonstrated by the probe without any index, and gqlgen shows the score is partly a proxy for "how much testify-`assert.` spelling the corpus contains". A Go project using `t.Fatalf` and a Python project using `pytest` are both invisible; a JS project is measured as intended.

## Fix sketch (implementation-ready)

1. **Per-language vocabulary table** in `src/intelligence/testing/quality.ts`, keyed by the `language` value already selected at `:159` (normalise: `go`, `python`, `javascript`/`typescript`, `rust`, `java`, `ruby`, `php`, `csharp`, `cpp`, …):
   - Go: assertions `/\bt\.(?:Fatalf|Errorf|Fatal|Error)\(/`, `/\b(?:require|assert)\.[A-Z]\w*\(/`, `/if\s+[\w.\[\]]+\s*!=\s*nil\s*\{/` for error paths, `/t\.Run\(/` **inside** a `range`/slice-literal loop for parameterization, `panic\(` as an assertion-adjacent failure; `longTestName` `/\bfunc\s+(?:Test|Benchmark|Example)\w{12,}\(/`.
   - Python: `/^\s*assert\s+/m`, `/self\.assert\w+\(/`, pytest `/@pytest\.mark\.parametrize/`, `/\bwith\s+pytest\.raises\(/`, `/assert_raises\(/`.
   - JS/TS: current set (keep).
   - Rust: `/assert!|assert_eq!|assert_ne!|debug_assert/`, `/#\[should_panic\]/`, `/#\[test\]/`.
   - Fall back to the current superset for unknown languages and record `vocabulary: "generic-superset"` in the dimension so the reader knows coverage.
2. **Return the matched token, not a constant, as `observedAnchor`** — change `count(re)` to a small `matchAny(pairs)` that returns `{count, label}`; `observedAnchor` becomes e.g. `"t.Fatalf × 49"`, `"assert.Equal × 12"`, `"t.Run table × 6"`. A label can then never name a construct that was not observed.
3. **Split `parameterized`**: remove `%s` and `$[a-zA-Z]` from the generic regex (they are string-template syntax, not test parameterization). Under Go, count `for …, tt := range tests` loops containing `t.Run(`; under JS keep `.each`/template-literal names; under Python `parametrize`. If a language has no known parameterization construct, the dimension should be **unsupported** (declared unknown), not 0.
4. **Report language coverage with the aggregate** so a Go repo cannot silently inherit a JS-scaled mean: `aggregate.perDimension` is fine, but add `summary.byLanguage: {go: n, …}` and a `vocabulary` per file/dimension; the docs should state that the aggregate is a *within-language* statistic, not comparable across languages.
5. **Fix the inert penalty** (`clamp01(strength − 0.5·penalty)` → `clamp01(strength) − 0.5·penalty` clamped to [0,1] at the end, or `clamp01(strength)·(1−0.5·penalty)`), so "no evidence" actually reduces the score instead of contributing exactly 0 — otherwise a file with 0 assertions and one with 1 assertion score identically. (Adjacent defect; UNLOCKED.)

## Gate proposal (pins each fix)

1. `validation/tools/bb_analyze/regex-edge-cases.ts` (existing edge-case gate): add a **per-language table** — each entry a canonical snippet + expected `{assertions>0, error_handling>0, parameterization>0}` and expected `observedAnchor` label. Red today for Go/Python, green for JS.
2. `script/verify-test-quality.ts` (existing inline gate): add (a) a Go fixture file with 6 `t.Fatalf` + 1 `if err != nil` + a `t.Run` table → assert `assertions.evidenceStrength === 1`, `error_handling > 0`, `parameterization > 0`, and `issues` does **not** contain `no_assertion_evidence`; (b) a Python fixture with `pytest` idioms; (c) a `%s`-only Go file → assert `parameterization === 0` and `observedAnchor === null` (the false-positive pin); (d) an anchor-truth invariant: for every emitted dimension, `observedAnchor` must be `null` or a token that actually matches in the file.
3. `script/m13/verify-analyze-modes.ts` (existing bounds gate): assert `test_quality` on the Go fixture publishes `summary.byLanguage` and that `aggregate.mean` is computed only over files whose vocabulary is non-generic (or declares the fallback), so a future JS-only regression cannot silently drive a Go repo's number.
4. Regression pin for this report: the exact bettercap `session/` fixture is unavailable (read-only specimen); use the 7-file-shaped fixture above and record the expected aggregate in the gate (0.50 band), asserting the old 0.322 band fails.

## Blast radius

- 7/7 bettercap session test files mis-scored `assertions: 0` (114 real sites); all 7 also mis-scored `error_handling: 0` (14 `if err != nil` + panic sites); 4/7 get a false `parameterization` credit from `%s`.
- Second Go repo: 18/71 gqlgen test files `assertions: 0`; 622 `require.*` sites invisible.
- Every Go/Python project indexed by bb receives a JS-calibrated quality number; any downstream ranking/gate that consumes `aggregate.mean` inherits the bias. The 0.322 → 0.503 projection bounds the correction for this one directory.

## Evidence

- `evidence/go-testintel/06-quality-session-fp.json` — full scoped report (aggregate 0.322222…, per-file dimensions, issues).
- `evidence/go-testintel/06-projection-language-aware.json` — recomputation + language-aware counterfactual (0.3222 / 0.4774 assertions-only / 0.5028 all three).
- `evidence/go-testintel/06-classifier-crosslang.json` — shipped `CONTENT_CLASSIFIERS` run over Go/JS/TS/Python snippets (no indexing).
- `evidence/go-testintel/06-quality-gqlgen-graphql.json` — second Go repo, 71 files.
- `.tools/triage-tmp/go-testintel/probe-classifiers.mts` — the probe script (workspace scratch, gitignored).
- All commands read-only; `sqlite3 -readonly` where used; no `bb_index`; no source writes.

## Adjacent leads recorded

`findings/UNLOCKED.md` → lane `go-testintel`: (i) `clamp01` makes `penaltyPotential` inert so "no evidence" never lowers a file's score; (ii) `observedAnchor` is a hard-coded string in several dimensions (same class for `mocking`/`fixtures`) so it can name evidence that was not observed.
