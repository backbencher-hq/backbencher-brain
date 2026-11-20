<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the test-quality reference for bb_analyze mode test_quality: the
language-aware dimensions, how each is measured, the anchors it reports, and the states it
refuses to fabricate.
WHO IT IS FOR — callers reading test-quality evidence and its declared unknowns.
EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/testing/quality.ts,
src/mcp/tools/bb_analyze/{descriptor,handler}.ts, docs/tools/bb_analyze.md,
docs/bb-bettercap-fix/go-testintel.md, script/verify-test-quality.ts,
validation/tools/bb_analyze/regex-edge-cases.ts.
-->

# Test quality reference

> **Not a tool.** There is no `bb_test_quality` (or `bb_test_intel`) tool. This surface belongs
> to `bb_analyze` through its `test_quality` mode (and the other test modes: `test_mapping`,
> `test_gaps`, `test_impact`). The only public tools are the sixteen in
> `docs/data/public-tools.json`.

Engine: `src/intelligence/testing/quality.ts`, reached through the public tool as
**`bb_analyze mode=test_quality`**. The recommendations engine
(`src/intelligence/testing/suggestions.ts`) is NOT exposed as a public tool —
there is no `bb_test_suggestions` tool; historical per-mode tool names
(`bb_test_quality`, `bb_test_suggestions`) were retired into `bb_analyze` and are
not registered.

## The vocabulary is the language's

Each file is measured with its **own language's vocabulary**, selected from
`brain_file.language` via `TEST_VOCABULARIES` (Go, Python, JavaScript/TypeScript, Rust; any
other language gets the declared `generic-superset` fallback and the payload says so). A
token is evidence because it is that language's assertion / error-path / parameterization
idiom — not because it looks like JavaScript. `measureTestContent` is exported and pure, so
the gate exercises exactly the measurement the engine uses.

## Framework/metric independence

Each dimension is **independently measured** from its own evidence — never a
multiplier of one synthetic score. Per-file `overall` is a confidence-weighted mean of
only the measured dimensions; `null` where nothing is measurable. `aggregate.mean` is the
mean of the per-file overalls that are present, plus `aggregate.perDimension` means.

| Dimension | Evidence (per language) | Metric (evidenceStrength) | Penalty |
| --- | --- | --- | --- |
| `assertions` | Go: `t.Fatalf` / `t.Errorf` / `t.Fatal` / `t.Error`, testify `require.*` / `assert.*`, `cmp.Diff`. Python: `assert` statement, `self.assert*`, module-level `assert*`. JS/TS: `expect(`, `assert(`, `should.`, matchers `toBe`/`toEqual`/`toStrictEqual`/`toThrow`/`toMatch`/`toContain`. Rust: `assert!`/`assert_eq!`/`assert_ne!`/`debug_assert!`. | `clamp01(count/6)` | `1 − count/6` |
| `error_handling` | Go: `if err != nil`, `if err == nil`, `recover()`. Python: `pytest.raises(`, `assert_raises(`, `self.assertRaises(`, `except`. JS/TS: `try {`, `catch (`, `toThrow`, `rejects`, `resolves`. Rust: `#[should_panic]`, `panic!`. | `clamp01(count/3)` | `1 − count/3` |
| `parameterization` | Go: `t.Run` subtests, `range tests` tables. Python: `@pytest.mark.parametrize`, `subTest(`. JS/TS: `it.each`, `test.each`, `describe.each`. Rust: **no in-language construct — dimension declared unsupported, never fabricated as 0**. | `clamp01(count/3)` | 0 |
| `docs` | comment lines (`//`, `/*`, `#`) + long descriptive test names in the language's own form (`func Test…` Go, `def test_…` Python, 24+ char `it('…')` JS). | `clamp01(count/6)` | `1 − count/6` |
| `fixtures` | **real fixture setup** from content (`t.TempDir`/`TempFile`/`CreateTemp`/`MkdirAll`/`Setenv`/`httptest`, `tmp_path`/`tmpdir`/`NamedTemporaryFile`, `beforeEach`/`beforeAll`/`msw.`, …) plus local fixture imports. Stdlib and test-framework imports are infrastructure — an import of `testing` is **not** a fixture. | `clamp01(count/3)` | null |
| `mocking` | mock-library import (graph `brain_import`, e.g. `jest`, `sinon`, `msw`, `github.com/stretchr/testify/mock`, `go.uber.org/mock`) OR spy/mock call sites in content. | `0.5·import + min(sites,4)/8` | 0 |

`clamp01(x)` clamps to 0..1. The penalty is **effective**: a dimension contributes
`clamp01(evidenceStrength · (1 − 0.5 · penalty))`, so a zero-evidence dimension contributes 0
and a partially-measured one is genuinely reduced by half its penalty share. (The pre-fix
formula clamped `strength − 0.5·penalty` at 0, which made the penalty inert: a file with 0
and 1–2 assertions scored identically; this is why the multiplicative form is the contract.)

## Anchors name observed evidence

Every measured dimension reports `observedAnchor` as `${label} × ${count}` for the label(s)
that **actually matched** — e.g. `t.Fatalf × 49, t.Fatal × 7`, `t.Run × 6`, `require × 2`,
`pytest.mark.parametrize × 1`, `t.TempDir × 3`, `// × 6`. Graph-backed evidence may anchor on
a declared import (`mock-library import: vitest`, `import: ./fixtures`). An anchor is never a
hard-coded construct label: a Go file can never report a JavaScript `it.each` anchor when the
only token it contains is a printf verb.

## Language-vocabulary disclosure (never silent)

- Each file's `strengths[]` includes `vocabulary: <id>` (for example `vocabulary: go`).
- `provenance.unknowns` carries one `language-vocabulary: <id> (<n> file(s))` entry per
  vocabulary used, and a `language-vocabulary-fallback: <language> has no registered
  vocabulary — measured with the generic superset (…); its assertion idioms may be
  under-counted` entry for every fallback language, so an under-scored language is visible.
- A language with no parameterization construct lists `parameterization` under
  `unsupported[]` instead of reporting a fabricated 0.

## Unknown states (never fabricated)

- A test file whose content cannot be read (beyond `maxFiles`, missing, or bounded
  `maxBytes`) leaves **content-backed** dimensions (`assertions`, `error_handling`,
  `parameterization`, `docs`) `supported:false` and lists them under `unsupported[]`.
  Graph-only dimensions (fixtures and mocking by import) still report. `overall` is `null`
  when nothing measurable.
- A dimension is absent only when there is genuinely no evidence; absence of an optional
  signal is not fabricated as 0 when content is unread.

## Measured behaviour (bettercap specimen)

On the seven `session/` test files (114 real `t.Fatalf`/`t.Errorf`/`t.Fatal`/`t.Error`
assertion sites, stdlib-only imports):

- **Before this model:** `aggregate.mean` **0.322222**, `assertions: 0` and
  `no_assertion_evidence` on 7/7 files, `error_handling: 0`, "parameterization" fired on the
  printf verb `%s` while anchoring as `it.each/test.each template`, `fixtures` anchored on the
  `testing` import.
- **After:** `aggregate.mean` **0.488095**; per-dimension `assertions` **0.8571** (anchors
  `t.Fatalf × 49, t.Fatal × 7` …), `error_handling` **0.3333**, `parameterization`
  **0.6667** (`t.Run × 6, range tests × 6`), `docs` 0.8810, `fixtures` and `mocking`
  **0** (honest: the corpus imports only stdlib/test-framework code), vocabulary disclosed
  as `language-vocabulary: go (7 file(s))`.
- **Dual projection (pinned by the gate):** with only assertions/error/parameterization
  replaced by the language-aware measurement and the other dimensions held at their recorded
  pre-fix values, the engine reproduces the triage projection **0.5028 ± 0.05** (measured
  0.5114). With **every** dimension measured by the new model — including the mandated
  real-fixture basis (stdlib-only → fixtures 0) and the effective penalty — the honest
  full-model value is **0.4614** on the session-shaped gate corpus. Both numbers are reported
  because the ~0.50 projection did not model the fixture-basis or penalty changes.

## Suggestions (evidence-first)

For declared changed symbols (`added`/`modified`/`deleted`):

1. **Modified/added with evidence** → `extend_existing_test`: existing tests from the static
   mapping/impact graph — confidence 0.85 direct, 0.6 transitive.
2. **No relationship evidence** → `create_test` via naming convention, but only as an
   explicit `naming_fallback=true`, low-confidence (0.3) suggestion.
3. **Deleted** (caller-decided; works even before reindex) →
   `review_deleted_symbol_coverage` for residual referencing tests.

Priority = f(complexity, blastRadius from graph-engine caller closure, kind);
effort = f(complexity, existing-test presence). Blast radius = unique reachable callers.
**No test code is generated or written** — recommendations are text with evidence, priority,
target basis, and effort methodology.

## Limitations

Static AST measurement only: it cannot prove runtime execution, assertion correctness,
branch/line coverage, or mock fidelity. Content-backed metrics use the language's enumerated
vocabulary; an idiom outside it (a bespoke assertion helper, a framework-specific matcher) is
not counted and is surfaced as a `no_assertion_evidence` issue rather than fabricated. A
language without a registered vocabulary uses the declared `generic-superset` fallback, whose
coverage is then narrower by construction and disclosed in `provenance.unknowns`.
`fixtures` measures declared fixture setup and local fixture modules, not data-file contents.

## Verification

`npx tsx script/verify-test-quality.ts` (inline checks, exit non-zero on failure) covers
language-aware measurement (Go plain `t.Fatalf`/`t.Errorf`/`t.Fatal`/`t.Error` +
table-driven `t.Run`, testify `require.*`/`assert.*`, `if err != nil`; JS `it.each` +
`expect`/`toThrow`; Python `assert` + `pytest.raises` + `pytest.mark.parametrize`), the
`%s`-printf false-positive pin (a `%s`-only Go file reports parameterization 0 with a null
anchor), the real-fixture-vs-stdlib-import pin, the anchors-name-observed-evidence invariant,
penalty effectiveness, and the dual projection pins above — plus the pre-existing
independent-measurement, unknown-state and suggestions checks. The low-level token table
(`CONTENT_CLASSIFIERS`) remains exported and is tested edge-case by edge-case in
`validation/tools/bb_analyze/regex-edge-cases.ts`; the shipped mode's bounds and `filePath`
rule are gated by `script/m13/verify-analyze-modes.ts` and `script/verify-analyze.ts`.
