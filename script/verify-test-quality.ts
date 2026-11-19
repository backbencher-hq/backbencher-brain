// verify-test-quality.ts — evidence-based test quality + suggestions (M9.11).
// Independent measurement, explicit unknown states, evidence-first suggestions.
//
// P1-3 (bettercap ISSUE-06): the content classifiers were ONE JS-shaped regex
// table, so seven Go test files with 114 real assertion sites scored
// `assertions: 0` at confidence 0.85, `error_handling: 0`, and "parameterization"
// fired on the printf verb `%s` while anchoring as `it.each/test.each`. This gate
// pins the language-aware vocabularies, the real anchor labels, the removal of
// the `%s` proxy, the real-fixture basis, the now-effective penalty, and the
// triage projection (0.322 → ~0.50 with language-aware bases).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { testQuality } from "../src/intelligence/testing/quality"
import { testSuggestions } from "../src/intelligence/testing/suggestions"
import * as qualityEngine from "../src/intelligence/testing/quality"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const engine: any = qualityEngine

// ── P1-3 gate B: language-aware quality model (pure; no index required) ─────
//
// The corpus rows are the measured bettercap `session/` facts (triage evidence
// 06-quality-session-fp.json + grep ground truth): assertion sites, `if err != nil`
// checks, `t.Run` subtest runners, comment lines, long test names, and the
// stdlib-only import surface. Counts are MEASUREMENT INPUTS (real corpus facts),
// not expected outputs; the engine measures the generated corpus itself.
type CorpusRow = {
  path: string
  assertions: number
  ifErrNil: number
  tRun: number
  comments: number
  longNames: number
  imports: string[]
}
const SESSION_CORPUS: CorpusRow[] = [
  { path: "session/command_handler_test.go", assertions: 5, ifErrNil: 0, tRun: 0, comments: 0, longNames: 1, imports: ["testing"] },
  { path: "session/environment_test.go", assertions: 56, ifErrNil: 13, tRun: 0, comments: 0, longNames: 12, imports: ["encoding/json", "io/ioutil", "os", "reflect", "testing"] },
  { path: "session/events_test.go", assertions: 8, ifErrNil: 0, tRun: 6, comments: 6, longNames: 5, imports: ["sync", "testing", "time"] },
  { path: "session/module_handler_test.go", assertions: 7, ifErrNil: 0, tRun: 4, comments: 6, longNames: 4, imports: ["reflect", "regexp", "testing"] },
  { path: "session/module_param_test.go", assertions: 24, ifErrNil: 1, tRun: 4, comments: 10, longNames: 11, imports: ["regexp", "strings", "testing"] },
  { path: "session/session_setup_test.go", assertions: 1, ifErrNil: 0, tRun: 1, comments: 6, longNames: 1, imports: [] },
  { path: "session/session_test.go", assertions: 13, ifErrNil: 0, tRun: 6, comments: 6, longNames: 1, imports: ["fmt", "testing"] },
]

// The triage-recorded per-file dimension rows (frozen evidence, cited). Used ONLY
// for the specified counterfactual "language-aware bases only": docs/fixtures/
// mocking are held exactly as measured pre-fix so the projection is comparable.
const TRIAGE_DIMS: Array<{ p: string; d: Array<{ id: string; s: number; pen: number | null; c: number }> }> = [
  { p: "session/command_handler_test.go", d: [{ id: "assertions", s: 0, pen: 1, c: 0.85 }, { id: "docs", s: 0, pen: 1, c: 0.7 }, { id: "error_handling", s: 0, pen: 1, c: 0.8 }, { id: "fixtures", s: 0.25, pen: null, c: 0.8 }, { id: "mocking", s: 0, pen: 0, c: 0.6 }, { id: "parameterization", s: 0.6666666666666666, pen: 0, c: 0.75 }] },
  { p: "session/environment_test.go", d: [{ id: "assertions", s: 0, pen: 1, c: 0.85 }, { id: "docs", s: 0, pen: 1, c: 0.7 }, { id: "error_handling", s: 0, pen: 1, c: 0.8 }, { id: "fixtures", s: 1, pen: null, c: 0.8 }, { id: "mocking", s: 0, pen: 0, c: 0.6 }, { id: "parameterization", s: 1, pen: 0, c: 0.75 }] },
  { p: "session/events_test.go", d: [{ id: "assertions", s: 0, pen: 1, c: 0.85 }, { id: "docs", s: 1, pen: 0, c: 0.7 }, { id: "error_handling", s: 0, pen: 1, c: 0.8 }, { id: "fixtures", s: 0.75, pen: null, c: 0.8 }, { id: "mocking", s: 0, pen: 0, c: 0.6 }, { id: "parameterization", s: 0.6666666666666666, pen: 0, c: 0.75 }] },
  { p: "session/module_handler_test.go", d: [{ id: "assertions", s: 0, pen: 1, c: 0.85 }, { id: "docs", s: 1, pen: 0, c: 0.7 }, { id: "error_handling", s: 0, pen: 1, c: 0.8 }, { id: "fixtures", s: 0.75, pen: null, c: 0.8 }, { id: "mocking", s: 0, pen: 0, c: 0.6 }, { id: "parameterization", s: 0, pen: 0, c: 0.75 }] },
  { p: "session/module_param_test.go", d: [{ id: "assertions", s: 0, pen: 1, c: 0.85 }, { id: "docs", s: 1, pen: 0, c: 0.7 }, { id: "error_handling", s: 0, pen: 1, c: 0.8 }, { id: "fixtures", s: 0.75, pen: null, c: 0.8 }, { id: "mocking", s: 0, pen: 0, c: 0.6 }, { id: "parameterization", s: 1, pen: 0, c: 0.75 }] },
  { p: "session/session_setup_test.go", d: [{ id: "assertions", s: 0, pen: 1, c: 0.85 }, { id: "docs", s: 1, pen: 0, c: 0.7 }, { id: "error_handling", s: 0, pen: 1, c: 0.8 }, { id: "fixtures", s: 0.25, pen: null, c: 0.8 }, { id: "mocking", s: 0, pen: 0, c: 0.6 }, { id: "parameterization", s: 0, pen: 0, c: 0.75 }] },
  { p: "session/session_test.go", d: [{ id: "assertions", s: 0, pen: 1, c: 0.85 }, { id: "docs", s: 1, pen: 0, c: 0.7 }, { id: "error_handling", s: 0, pen: 1, c: 0.8 }, { id: "fixtures", s: 0.5, pen: null, c: 0.8 }, { id: "mocking", s: 0, pen: 0, c: 0.6 }, { id: "parameterization", s: 1, pen: 0, c: 0.75 }] },
]
const PRE_FIX_AGGREGATE = 0.32222222222222224 // triage 06-quality-session-fp.json (reproduced there)
const TRIAGE_PROJECTION = 0.502778 // triage projection: language-aware assertions/error/param only

function corpusGoContent(row: CorpusRow): string {
  const lines: string[] = ["package session", ""]
  if (row.imports.length > 0) {
    lines.push("import (")
    for (const imp of row.imports) lines.push(`\t"${imp}"`)
    lines.push(")", "")
  }
  for (let i = 0; i < row.comments; i++) lines.push(`// fixture comment line ${i} documenting behavior`)
  // Long descriptive test names (Go vocabulary).
  for (let i = 0; i < row.longNames; i++) {
    lines.push(`func TestDescriptiveBehaviorName${i}(t *testing.T) {`)
    lines.push("\t_ = t")
    lines.push("}")
  }
  lines.push("func TestSessionFixture(t *testing.T) {")
  for (let i = 0; i < row.assertions; i++) {
    const kind = ["t.Fatalf", "t.Errorf", "t.Fatal", "t.Error"][i % 4]
    lines.push(kind.endsWith("f") ? `\t${kind}("mismatch %d", got${i})` : `\t${kind}("mismatch")`)
  }
  for (let i = 0; i < row.ifErrNil; i++) lines.push(`\tif err := do${i}(); err != nil { t.Fatal(err) }`)
  for (let i = 0; i < row.tRun; i++) lines.push(`\tt.Run("case ${i}", func(t *testing.T) { _ = t })`)
  lines.push("}")
  return lines.join("\n") + "\n"
}

function measure(language: string, relativePath: string, content: string, imports: string[] = []): any {
  if (typeof engine.measureTestContent !== "function") return null
  return engine.measureTestContent({ relativePath, language, content, imports })
}
function dimOf(m: any, id: string): any {
  const d = (m?.dimensions ?? []).find((x: any) => x.id === id)
  return d ?? { evidenceStrength: null, observedAnchor: null, penaltyPotential: null, confidence: null }
}
function strengthOf(m: any, id: string): number {
  return dimOf(m, id).evidenceStrength ?? 0
}
function anchorOf(m: any, id: string): string | null {
  return dimOf(m, id).observedAnchor ?? null
}

const GO_TABLE = `package svc

import "testing"

func TestTable(t *testing.T) {
	tests := []struct{ name string; in int; want int }{
		{"a", 1, 2}, {"b", 2, 4}, {"c", 3, 6},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.in * 2; got != tt.want {
				t.Fatalf("got %d want %d", got, tt.want)
			}
		})
	}
}

func TestCases(t *testing.T) {
	t.Run("one", func(t *testing.T) { if 1 != 1 { t.Error("bad") } })
	t.Run("two", func(t *testing.T) { if 2 != 2 { t.Errorf("bad %d", 2) } })
	t.Run("three", func(t *testing.T) { if 3 != 3 { t.Fatal("bad") } })
}
`
const GO_TESTIFY = `package svc

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdd(t *testing.T) {
	require.NoError(t, nil)
	require.Equal(t, 2, 1+1)
	assert.Equal(t, 3, 1+2)
	assert.NoError(t, nil)
}
`
const GO_ERR = `package svc

import "testing"

func TestErr(t *testing.T) {
	_, err := do()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := do2(); err != nil {
		t.Fatal(err)
	}
	if err == nil {
		t.Error("expected error")
	}
}
`
const GO_PRINTF_ONLY = `package svc

import "testing"

func TestFormat(t *testing.T) {
	got := fmt.Sprintf("%s-%s", "a", "b")
	if got != "a-b" {
		t.Errorf("got %s", got)
	}
}
`
const GO_FIXTURES = `package svc

import (
	"io/ioutil"
	"os"
	"testing"
)

func TestWithFixtures(t *testing.T) {
	dir := t.TempDir()
	f, err := ioutil.TempFile(dir, "x-*")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	os.Remove(f.Name())
	if err := os.MkdirAll(dir+"/sub", 0755); err != nil {
		t.Fatal(err)
	}
}
`
const GO_STDLIB_ONLY = `package svc

import (
	"fmt"
	"testing"
)

func TestStdlib(t *testing.T) {
	if fmt.Sprintf("%d", 1) != "1" {
		t.Fatalf("bad")
	}
}
`
const JS_EACH = `import { it, expect } from 'vitest'

it.each([[1, 1, 2], [2, 2, 4]])('adds %i + %i', (a, b, expected) => {
  expect(add(a, b)).toBe(expected)
})

it('throws on bad input', () => {
  expect(() => f()).toThrow()
})
`
const PY_PYTEST = `import pytest


@pytest.mark.parametrize("a,b,expected", [(1, 1, 2), (2, 2, 4)])
def test_add(a, b, expected):
    assert add(a, b) == expected


def test_raises():
    with pytest.raises(ValueError):
        f()
`

function triageFile(p: string) {
  const row = TRIAGE_DIMS.find((t) => t.p === p)!
  return { relativePath: p, dimensions: row.d.map((d) => ({ id: d.id, supported: true, relevance: null, evidenceStrength: d.s, penaltyPotential: d.pen, observedAnchor: null, confidence: d.c })) }
}

function languageGate(): void {
  console.log("\n[P1-3] language-aware quality model")
  check("quality engine exports measureTestContent (language-aware basis)", typeof engine.measureTestContent === "function")
  check("quality engine exports per-language vocabularies (go/python/javascript)", !!engine.TEST_VOCABULARIES && typeof engine.TEST_VOCABULARIES === "object")
  check("quality engine exports aggregateQuality (pure aggregate)", typeof engine.aggregateQuality === "function")
  check("quality engine exports overallScore (pure per-file overall)", typeof engine.overallScore === "function")
  if (typeof engine.measureTestContent !== "function" || typeof engine.aggregateQuality !== "function") {
    console.log("  current-defect snapshot (pre-fix classifiers, from triage): Go t.Fatalf assertions=0;")
    console.log("  Go t.Run table parameterization=0; %s printf verb parameterization>0 labelled it.each;")
    console.log("  session aggregate=0.3222 over 7 files with assertions=0.")
    return
  }

  // Go: plain t.Fatalf/t.Errorf/t.Fatal/t.Error
  const goPlain = measure("go", "x/session_test.go", GO_TABLE, ["testing"])
  check("GO: table-driven t.Run + t.Fatal/t.Error vocabulary is counted (assertions > 0)", strengthOf(goPlain, "assertions") > 0.5, `assertions=${strengthOf(goPlain, "assertions")}`)
  check("GO: parameterization anchor names the observed subtest token (t.Run)", /t\.Run/.test(String(anchorOf(goPlain, "parameterization"))), `anchor=${anchorOf(goPlain, "parameterization")}`)
  check("GO: table-test parameterization evidence > 0", strengthOf(goPlain, "parameterization") > 0)

  // Go: testify require.*/assert.*
  const goTestify = measure("go", "x/svc_test.go", GO_TESTIFY, ["testing", "github.com/stretchr/testify/assert", "github.com/stretchr/testify/require"])
  check("GO: testify require.*/assert.* counted as assertions", strengthOf(goTestify, "assertions") > 0.5, `assertions=${strengthOf(goTestify, "assertions")}, anchor=${anchorOf(goTestify, "assertions")}`)
  check("GO: testify anchor names the observed helper (require/assert)", /require|assert/.test(String(anchorOf(goTestify, "assertions"))), `anchor=${anchorOf(goTestify, "assertions")}`)

  // Go: if err != nil error-path vocabulary
  const goErr = measure("go", "x/err_test.go", GO_ERR, ["testing"])
  check("GO: `if err != nil` is error-path evidence", strengthOf(goErr, "error_handling") > 0, `err=${strengthOf(goErr, "error_handling")}`)
  check("GO: error-path anchor names the observed check", /err\s*!=\s*nil/.test(String(anchorOf(goErr, "error_handling"))), `anchor=${anchorOf(goErr, "error_handling")}`)

  // Go: the removed %s printf-verb proxy must NOT be parameterization evidence
  const goPrintf = measure("go", "x/fmt_test.go", GO_PRINTF_ONLY, ["testing"])
  check("GO: printf `%s` alone is NOT parameterization evidence", strengthOf(goPrintf, "parameterization") === 0, `param=${strengthOf(goPrintf, "parameterization")}`)
  check("GO: printf `%s` alone gets a null parameterization anchor", anchorOf(goPrintf, "parameterization") === null, `anchor=${anchorOf(goPrintf, "parameterization")}`)
  check("GO: printf-verb file still gets its real assertion evidence", strengthOf(goPrintf, "assertions") > 0)

  // Fixtures: real fixture setup, not a stdlib import.
  const goFixtures = measure("go", "x/fixture_test.go", GO_FIXTURES, ["io/ioutil", "os", "testing"])
  check("GO: fixtures anchored on real fixture setup (t.TempDir/TempFile/MkdirAll)", strengthOf(goFixtures, "fixtures") > 0 && /t\.TempDir|TempFile|MkdirAll/.test(String(anchorOf(goFixtures, "fixtures"))), `fixtures=${strengthOf(goFixtures, "fixtures")} anchor=${anchorOf(goFixtures, "fixtures")}`)
  const goStdlibOnly = measure("go", "x/stdlib_test.go", GO_STDLIB_ONLY, ["fmt", "testing"])
  check("GO: a stdlib import is NOT fixture evidence (anchor null)", strengthOf(goStdlibOnly, "fixtures") === 0 && anchorOf(goStdlibOnly, "fixtures") === null, `fixtures=${strengthOf(goStdlibOnly, "fixtures")} anchor=${anchorOf(goStdlibOnly, "fixtures")}`)

  // JS vocabulary must keep working (positive control for the JS-shaped baseline).
  const jsEach = measure("javascript", "x/add.test.js", JS_EACH, ["vitest"])
  check("JS: expect().toBe()/toThrow assertions counted", strengthOf(jsEach, "assertions") > 0.5, `assertions=${strengthOf(jsEach, "assertions")}`)
  check("JS: it.each parameterization detected with the it.each anchor", /it\.each/.test(String(anchorOf(jsEach, "parameterization"))), `anchor=${anchorOf(jsEach, "parameterization")}`)

  // Python vocabulary.
  const py = measure("python", "x/test_add.py", PY_PYTEST, ["pytest"])
  check("PY: `assert` statement is assertion evidence", strengthOf(py, "assertions") > 0, `assertions=${strengthOf(py, "assertions")}`)
  check("PY: pytest.raises is error-path evidence", strengthOf(py, "error_handling") > 0, `err=${strengthOf(py, "error_handling")}`)
  check("PY: pytest.mark.parametrize parameterization detected", strengthOf(py, "parameterization") > 0 && /parametrize/.test(String(anchorOf(py, "parameterization"))), `param=${strengthOf(py, "parameterization")} anchor=${anchorOf(py, "parameterization")}`)

  // Language + vocabulary surfaced in the payload.
  check("language surfaced in the measurement (go)", goPlain?.language === "go", `language=${goPlain?.language}`)
  check("vocabulary surfaced in the measurement", typeof goPlain?.vocabulary === "string" && goPlain.vocabulary.length > 0, `vocabulary=${goPlain?.vocabulary}`)

  // Anchors must name tokens that were actually observed — in the source content,
  // or (for graph-backed fixture/mock evidence) in the file's import list. A
  // hard-coded construct label can never pass this.
  const cases: Array<[string, string, string[]]> = [["go-table", GO_TABLE, ["testing"]], ["go-testify", GO_TESTIFY, ["testing", "github.com/stretchr/testify/assert"]], ["js", JS_EACH, ["vitest"]], ["py", PY_PYTEST, ["pytest"]], ["go-fixtures", GO_FIXTURES, ["io/ioutil", "os", "testing"]]]
  let badAnchors: string[] = []
  for (const [label, content, imports] of cases) {
    const lang = label.startsWith("go") ? "go" : label === "py" ? "python" : "javascript"
    const m = measure(lang, `x/${label}`, content, imports)
    for (const dim of m?.dimensions ?? []) {
      if (!dim.observedAnchor) continue
      const token = String(dim.observedAnchor).split(" × ")[0]
      const importAnchored = /^(?:mock-library )?import: (.+)$/.exec(token)
      const observed = importAnchored ? imports.includes(importAnchored[1]) : content.includes(token)
      if (!observed) badAnchors.push(`${label}.${dim.id}="${dim.observedAnchor}"`)
    }
  }
  check("anchors name observed tokens only (content token or declared import)", badAnchors.length === 0, badAnchors.join(", "))

  // Penalty is effective: a file with zero assertions must score below the same
  // file with assertions (the triage UNLOCKED: clamp01 made the penalty inert).
  if (typeof engine.aggregateQuality === "function") {
    const zero = measure("go", "x/zero_test.go", "package p\n\nimport \"testing\"\n\nfunc TestNothing(t *testing.T) { t.Log(\"nothing\") }\n", ["testing"])
    const zeroAgg = engine.aggregateQuality([{ relativePath: "x/zero_test.go", dimensions: zero.dimensions }]).mean
    const plainAgg = engine.aggregateQuality([{ relativePath: "x/plain_test.go", dimensions: goPrintf.dimensions }]).mean
    check("penalty is effective: zero-assertion file scores below an assertion-bearing file", typeof zeroAgg === "number" && typeof plainAgg === "number" && zeroAgg < plainAgg, `zero=${zeroAgg} plain=${plainAgg}`)
  }

  // Projection consistency (PLAN §6): the triage-measured pre-fix aggregate must
  // reproduce from the recorded dims, and the language-aware counterfactual
  // (three dimensions replaced by ENGINE measurements, other three held at the
  // recorded pre-fix values) must land on the triage projection 0.502778.
  const preFixFiles = TRIAGE_DIMS.map((t) => triageFile(t.p))
  const preFix = engine.aggregateQuality(preFixFiles).mean
  check("projection input reproduces the triage pre-fix aggregate 0.3222", typeof preFix === "number" && Math.abs(preFix - PRE_FIX_AGGREGATE) < 1e-4, `got=${preFix}`)

  const corpusMeasured = SESSION_CORPUS.map((row) => measure("go", row.path, corpusGoContent(row), row.imports))
  const awareFiles = TRIAGE_DIMS.map((t, i) => {
    const file = triageFile(t.p)
    const m = corpusMeasured[i]
    const byId = new Map(file.dimensions.map((d: any) => [d.id, d]))
    for (const id of ["assertions", "error_handling", "parameterization"]) {
      const measured = dimOf(m, id)
      byId.set(id, { id, supported: true, relevance: null, evidenceStrength: measured.evidenceStrength, penaltyPotential: measured.penaltyPotential, observedAnchor: measured.observedAnchor, confidence: measured.confidence })
    }
    return { relativePath: file.relativePath, dimensions: Array.from(byId.values()) }
  })
  const projection = engine.aggregateQuality(awareFiles).mean
  check("projection reproduced by the new bases (language-aware dims only, triage projection 0.5028 ± 0.05)", typeof projection === "number" && Math.abs(projection - TRIAGE_PROJECTION) <= 0.05, `got=${projection}`)
  check("projection improves on the triage pre-fix aggregate by >= 0.12", typeof projection === "number" && projection - PRE_FIX_AGGREGATE >= 0.12, `got=${projection} pre=${PRE_FIX_AGGREGATE}`)

  // Honest full-model reproduction on the session-shaped corpus (every dimension
  // measured by the NEW engine: real-fixture basis, effective penalty). This is
  // the number the user actually sees after the fix; it must exceed the pre-fix
  // 0.3222 by a material margin and stay in the modeled band.
  const honestFiles = SESSION_CORPUS.map((row, i) => ({ relativePath: row.path, dimensions: corpusMeasured[i].dimensions }))
  const honest = engine.aggregateQuality(honestFiles).mean
  check("honest full-model session reproduction >= pre-fix + 0.08", typeof honest === "number" && honest - PRE_FIX_AGGREGATE >= 0.08, `honest=${honest} pre=${PRE_FIX_AGGREGATE}`)
  check("honest full-model session reproduction in the modeled band [0.39, 0.47]", typeof honest === "number" && honest >= 0.39 && honest <= 0.47, `honest=${honest}`)
  console.log(`  info: pre-fix=${PRE_FIX_AGGREGATE} counterfactual_projection=${projection} honest_full_model=${honest} recorded_corpus=${SESSION_CORPUS.length} files`)
}
languageGate()

// ── Integration gate (needs an index; unchanged contract) ───────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-testquality-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// Production symbols: `add` (tested), `untested` (no test refs), `gone` (will be "deleted").
writeFileSync(path.join(root, "src", "calc.ts"),
  "export function add(a: number, b: number): number {\n" +
  "  if (a > 0) { if (b > 0) { return a + b } else { return a } } else { return b }\n" +
  "}\n" +
  "export function untested(a: number): number {\n" +
  "  if (a > 10) { return a * 2 } else if (a > 5) { return a + 1 } else { return 0 }\n" +
  "}\n" +
  "export function gone(a: number): number { return a }\n")

// Rich test: assertions + error handling + parameterized + comments.
writeFileSync(path.join(root, "src", "calc.test.ts"),
  "import { add, gone } from './calc'\n" +
  "import { expect, assert } from './assertlib'\n" +
  "// covers arithmetic behavior and error paths\n" +
  "export function testAdd(): void {\n" +
  "  expect(add(1, 2)).toBe(3)\n" +
  "  assert(add(2, 2) === 4)\n" +
  "  assert(gone(1) === 1)\n" +
  "  try { add(1, 2) } catch (e) { throw new Error('must not throw') }\n" +
  "  const cases = [[1,2,3],[2,2,4]]\n" +
  "  for (const [a,b,exp] of cases) it.each(cases)('adds', () => expect(add(a,b)).toBe(exp))\n" +
  "}\n")

// Weak test: calls add but has NO assertion / error-handling evidence.
writeFileSync(path.join(root, "src", "weak.spec.ts"),
  "import { add } from './calc'\n" +
  "export function testWeak(): void { add(1, 1) }\n")

const projectId = getProjectId(root)
let indexUnavailable = false
try {
  await indexProjectParallel(projectId, root, {})
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  // Sandbox precondition (FIX-CHARTER §5): no ~/.bb/projects/<hash> creation here.
  if (message.includes("ENOENT") && message.includes(".bb/projects")) {
    console.log("\n  SKIP(env): index harness unavailable in this sandbox (" + message.split("\n")[0] + ")")
    indexUnavailable = true
  } else {
    check("test-quality session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
    indexUnavailable = true
  }
}

try {
  if (!indexUnavailable) {
    // ---- quality: independent measurement + unknown handling ----
    const quality = await testQuality(projectId)
    check("quality returns files", quality.files.length === 2, `files=${quality.files.length}`)

    const richQ = quality.files.find((f) => f.relativePath.includes("calc.test.ts"))
    const weakQ = quality.files.find((f) => f.relativePath.includes("weak.spec.ts"))
    check("rich test detected", !!richQ)
    check("weak test detected", !!weakQ)

    if (richQ && weakQ) {
      const richDims = Object.fromEntries(richQ.dimensions.map((d) => [d.id, d]))
      const weakDims = Object.fromEntries(weakQ.dimensions.map((d) => [d.id, d]))

      check("assertions measured independently (supported)", richDims.assertions?.supported === true)
      check("error_handling measured independently", richDims.error_handling?.supported === true)
      check("parameterization measured from content evidence", richDims.parameterization?.supported === true)
      check("rich assertions evidence > weak assertions evidence",
        (richDims.assertions?.evidenceStrength ?? 0) > (weakDims.assertions?.evidenceStrength ?? 0),
        `rich=${richDims.assertions?.evidenceStrength} weak=${weakDims.assertions?.evidenceStrength}`)
      check("rich error_handling evidence > weak", (richDims.error_handling?.evidenceStrength ?? 0) > (weakDims.error_handling?.evidenceStrength ?? 0))
      check("rich parameterization present (>0)", (richDims.parameterization?.evidenceStrength ?? 0) > 0)
      check("weak parameterization absent (0)", (weakDims.parameterization?.evidenceStrength ?? 0) === 0)
      check("rich overall >= weak overall", (richQ.overall ?? -1) >= (weakQ.overall ?? 1) - 1e-9, `rich=${richQ.overall} weak=${weakQ.overall}`)
      check("weak test flags no-assertion issue", weakQ.issues.some((i) => i.category === "no_assertion_evidence"))
    }

    const noContent = await testQuality(projectId, { maxFiles: 0 })
    const anyFile = noContent.files[0]
    check("unread file → content dims unknown (supported=false)", !!anyFile && anyFile.dimensions.some((d) => d.id === "assertions" && d.supported === false))
    check("unknown dims listed in unsupported[]", !!anyFile && anyFile.unsupported.includes("assertions") && anyFile.unsupported.includes("error_handling"))
    check("overall is null-ish when nothing measurable", noContent.summary.filesUnknown >= 0)

    // ---- suggestions: evidence-first, changed-symbol scenarios ----
    const changedAdd = await testSuggestions(projectId, [{ name: "add", file: "src/calc.ts", kind: "modified" }])
    check("suggestions run for changed add", changedAdd.changedSymbols.length === 1)
    check("changed add → extend_existing_test (existing tests first)", changedAdd.changedSymbols[0].actions.some((a) => a.action === "extend_existing_test"))
    check("changed add → NOT naming fallback (has evidence)", changedAdd.changedSymbols[0].namingFallback === false)
    check("affectedExistingTests recorded", changedAdd.affectedExistingTests.length > 0)

    const changedUntested = await testSuggestions(projectId, [{ name: "untested", file: "src/calc.ts", kind: "modified" }])
    check("untested → create_test suggestion", changedUntested.changedSymbols[0].actions.some((a) => a.action === "create_test"))
    check("untested → naming fallback flagged (low confidence)", changedUntested.changedSymbols[0].namingFallback === true)

    const addedUntested = await testSuggestions(projectId, [{ name: "untested", file: "src/calc.ts", kind: "added" }])
    check("added symbol scenario is preserved", addedUntested.changedSymbols[0].changeType === "added")
    check("added untested symbol recommends create_test", addedUntested.changedSymbols[0].actions.some((a) => a.action === "create_test"))
    check("added untested symbol flags naming fallback", addedUntested.changedSymbols[0].namingFallback === true)

    const changedDeleted = await testSuggestions(projectId, [{ name: "gone", file: "src/calc.ts", kind: "deleted" }])
    check("deleted → review_deleted_symbol_coverage", changedDeleted.changedSymbols[0].actions.some((a) => a.action === "review_deleted_symbol_coverage"))
    check("deleted → existing referencing test surfaced", changedDeleted.affectedExistingTests.some((t) => t.changedSymbol === "gone"))
  }
} catch (error) {
  check("test-quality session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nTEST-QUALITY: PASS" : `\nTEST-QUALITY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
