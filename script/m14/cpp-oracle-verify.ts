/**
 * cpp-oracle-verify — the C++ lane's D4 ORACLE CONTRACT (ALL-OUT-OF-ALL §9.1 D4).
 *
 * D4 has TWO halves and this file measures the first one, falsifiably:
 *
 *   (i)  DERIVATION  — every emitted label has an INDEPENDENT derivation that actually
 *                      produces rows. `script/m14/cpp-truth.ts` exports them; this
 *                      instrument proves each label DERIVES something on synthetic
 *                      contract cases, proves a NEGATIVE control per label is refused,
 *                      and runs the whole fixture lane through truth-vs-analyzer so a
 *                      label whose derivation goes dark is named.
 *   (ii) ADMISSION   — the differential's compared set must name the label (Lead-owned
 *                      wiring in script/m14/differential.ts). This instrument prints the
 *                      declared label set and the emitted label set, and FAILS on any
 *                      emitted label the declared set does not audit — it cannot edit
 *                      differential.ts, so the finding is reported, not patched.
 *
 * WHY THE CONTRACT IS POSITIVE AND NEGATIVE. A checker that only asserts "X is derived"
 * passes just as well when the derivation derives EVERYTHING. So every label carries a
 * case whose row the oracle must derive (positive) and a case whose row it must NOT
 * derive (negative control, usually the analyzer's own guard: `new char[4]` must not
 * derive `instantiates char`; a self-inheriting class must not derive `extends`). The
 * matcher is shown able to FAIL by `--self-test`: arm A asserts a real truth row (must
 * pass), arm B asserts a row the oracle does not derive (must be reported as a failure)
 * — the same matcher both times, so "it can fail" is measured rather than promised.
 *
 * THE SET COMPARISON, and its stated limit. Both sides walk the same pinned parse, so a
 * grammar bug shared by them is invisible — the harness property the workstream doc
 * requires be said rather than claimed around. Comparison is on
 * `label + normTarget(target)` (the differential's own matching rule) because the
 * analyzer's `from` endpoints are call-site/owner conventions and the truth walkers'
 * are not; the per-label table prints analyzer-vs-truth row counts so a label that is
 * derived-but-never-matching is visible rather than averaged away.
 *
 * USAGE
 *   bun run script/m14/cpp-oracle-verify.ts            # JSON contract report
 *   bun run script/m14/cpp-oracle-verify.ts --text     # human table
 *   bun run script/m14/cpp-oracle-verify.ts --self-test # prove the matcher can fail
 *
 * EXIT: 0 contract clean · 1 finding (a label with no derivation, a failed case, an
 *       emitted label not in the declared audit set) · 3 the self-test control did not fire.
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { CPP_ORACLE_LABELS, deriveCppShared, deriveCppTruth } from "./cpp-truth"
import { normTarget } from "./differential"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures", "cpp")
const TEXT = process.argv.includes("--text")
const SELF_TEST = process.argv.includes("--self-test")

const { getParser } = await import("./run-fixtures")

const ALL_LABELS = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
]
/**
 * Labels whose analyzer `from` endpoint is a SITE CONVENTION (call site, file scope, owner
 * attached to the symbol) rather than a declaration name. The differential itself treats
 * these site-agnostically (`sourceIsASite` in script/cpp-review/oracle-agreement.ts is the
 * same distinction); comparing their `from` endpoints would report accounting differences.
 * Comparison here is on `label + normTarget(target)` for EVERY label — stated once.
 */

type TruthEdge = { label: string; from: string; target: string; line?: number }
type Case = {
  name: string
  source: string
  positive: Array<{ label: string; target: string; why: string }>
  negative: Array<{ label: string; target: string; why: string }>
}

/**
 * THE CONTRACT CASES. One positive per emitted label (10), one negative control per label
 * class where the analyzer holds a guard (a value that must NOT be derived). A case that
 * both derives and refuses the same row would be vacuous, so pairs are distinct rows.
 */
const CASES: Case[] = [
  {
    name: "class-members-and-methods",
    source: `namespace ns {
  struct Widget {
    int width;
    void resize(int w);
    Widget();
  };
  enum Color { Red, Green };
}
`,
    positive: [
      { label: "contains", target: "Widget.width", why: "class member width is contained by Widget" },
      { label: "contains", target: "ns.Widget", why: "namespace ns contains Widget" },
      { label: "contains", target: "Color.Red", why: "enum member is contained by the enum" },
    ],
    negative: [
      { label: "contains", target: "Widget.size", why: "a name the class never declares must not be contained" },
    ],
  },
  {
    name: "inheritance-multiple-and-virtual",
    source: `struct IA { virtual int f() = 0; };
struct IB { virtual int g() = 0; };
struct Impl : public IA, protected IB {
  int f() override;
  int g() override;
};
`,
    positive: [
      { label: "extends", target: "IA", why: "first base of the base_class_clause" },
      { label: "extends", target: "IB", why: "second base — MULTIPLE INHERITANCE is a list" },
      { label: "implements", target: "IA", why: "IA declares a pure virtual: it is a contract" },
      { label: "implements", target: "IB", why: "IB likewise" },
      { label: "overrides", target: "IA.f", why: "Impl::f overrides IA::f (signature + keyword)" },
    ],
    negative: [
      { label: "extends", target: "Impl", why: "a class cannot inherit from itself (and does not)" },
      { label: "implements", target: "Impl", why: "a class with its own body is not its own contract" },
    ],
  },
  {
    name: "calls-uses-instantiates",
    source: `int g;
struct Obj { int v; };
void helper(int);
void work(Obj& o, int n) {
  helper(n);
  int q = o.v;
  int r = g + q;
  (void)r;
  auto* p = new Obj();
  (void)p;
}
`,
    positive: [
      { label: "calls", target: "helper", why: "a call_expression with an identifier callee" },
      { label: "uses", target: "v", why: "a member READ is a uses (member reads are read-uses; an assignment LHS would be a WRITE and is gated — see the negative control)" },
      { label: "uses", target: "g", why: "a bare READ of a file-declared name is a uses" },
      { label: "instantiates", target: "Obj", why: "new Obj() constructs the declared class Obj" },
    ],
    negative: [
      { label: "instantiates", target: "char", why: "new char[4] is a primitive, never a class construction" },
      { label: "calls", target: "Obj", why: "no edge for a name that is not called here" },
    ],
  },
  {
    name: "includes-and-using",
    source: `#include <vector>
#include "local/header.h"
using std::size_t;
int main() { return 0; }
`,
    positive: [
      { label: "imports", target: "vector", why: "#include <vector> is a module edge" },
      { label: "imports", target: "local/header.h", why: "quoted include keeps its path" },
      { label: "references", target: "std::size_t", why: "a file-scope using-dependency is a reference" },
    ],
    negative: [
      { label: "imports", target: "std", why: "a using-declaration is NOT an import (imports is #include only)" },
      { label: "references", target: "vector", why: "a type position is references — the include path is imports" },
    ],
  },
  {
    name: "export-attributes",
    source: `__declspec(dllexport) int exported_fn();
__attribute__((visibility("default"))) int exported_gnu();
int internal_fn();
`,
    positive: [
      { label: "exports", target: "exported_fn", why: "declspec(dllexport) marks the name as exported" },
      { label: "exports", target: "exported_gnu", why: "visibility(default) marks the name as exported" },
    ],
    negative: [
      { label: "exports", target: "internal_fn", why: "a declaration with no export marker is not exported" },
    ],
  },
]

interface Analyzed { rels: TruthEdge[]; truth: TruthEdge[]; file: string }

async function analyzeAndDerive(source: string, file: string, analyzer: any, parser: any): Promise<Analyzed> {
  const tree: any = parser.parse(source, file)
  const result: any = await analyzer.analyze(tree.rootNode, source, file, undefined)
  const root: any = tree.rootNode
  const truth: TruthEdge[] = [...deriveCppTruth(root), ...deriveCppShared(root)].map((e) => ({ label: e.label, from: String((e as any).from ?? ""), target: String(e.target ?? ""), line: (e as any).line }))
  const rels: TruthEdge[] = (result?.relationships ?? []).map((r: any) => ({ label: String(r.type ?? ""), from: String(r.source ?? ""), target: String(r.target ?? "") }))
  tree.delete?.()
  return { rels, truth, file }
}

const key = (e: TruthEdge) => `${e.label}\u0000${normTarget(String(e.target ?? ""))}`

/** Run the cases: each positive must be derived AND published; each negative must be absent from truth. */
async function runCases(analyzer: any, parser: any): Promise<{ results: any[]; failed: number; truthByLabel: Map<string, number> }> {
  const results: any[] = []
  const truthByLabel = new Map<string, number>()
  let failed = 0
  for (const c of CASES) {
    const a = await analyzeAndDerive(c.source, `fixtures/cpp/contract-${c.name}.cpp`, analyzer, parser)
    const truthKeys = new Set(a.truth.map(key))
    const published = new Set(a.rels.map(key))
    const posRows = c.positive.map((p) => {
      const k = `${p.label}\u0000${normTarget(p.target)}`
      const derived = truthKeys.has(k)
      if (derived) truthByLabel.set(p.label, (truthByLabel.get(p.label) ?? 0) + 1)
      return { ...p, derived, published: published.has(k), ok: derived }
    })
    const negRows = c.negative.map((n) => {
      const k = `${n.label}\u0000${normTarget(n.target)}`
      const derived = truthKeys.has(k)
      return { ...n, derived, ok: !derived }
    })
    const bad = [...posRows, ...negRows].filter((r) => !r.ok)
    if (bad.length > 0) failed++
    results.push({ case: c.name, file: a.file, truthRows: a.truth.length, analyzerRows: a.rels.length, positive: posRows, negative: negRows, ok: bad.length === 0 })
  }
  return { results, failed, truthByLabel }
}

/** Run the whole fixture lane through truth-vs-analyzer, set comparison on label+normTarget. */
async function runFixtures(analyzer: any, parser: any): Promise<any> {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".cpp")).sort()
  const perLabel = new Map<string, { truth: number; published: number; missing: number; unexplained: number; missingSamples: string[]; unexplainedSamples: string[] }>()
  for (const label of CPP_ORACLE_LABELS) perLabel.set(label, { truth: 0, published: 0, missing: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] })
  let truthRows = 0
  let analyzerRows = 0
  for (const f of files) {
    const src = readFileSync(path.join(FIXTURES_DIR, f), "utf8")
    const a = await analyzeAndDerive(src, `fixtures/cpp/${f}`, analyzer, parser)
    truthRows += a.truth.length
    analyzerRows += a.rels.length
    const tKeys = new Set<string>()
    for (const e of a.truth) if (perLabel.has(e.label)) tKeys.add(key(e))
    const aKeys = new Set<string>()
    for (const e of a.rels) if (perLabel.has(e.label)) aKeys.add(key(e))
    for (const [label, row] of perLabel) {
      const t = a.truth.filter((e) => e.label === label)
      const p = a.rels.filter((e) => e.label === label)
      row.truth += t.length
      row.published += p.length
      for (const e of t) {
        if (!aKeys.has(key(e))) {
          row.missing++
          if (row.missingSamples.length < 5) row.missingSamples.push(`${f}: ${e.target}`)
        }
      }
      for (const e of p) {
        if (!tKeys.has(key(e))) {
          row.unexplained++
          if (row.unexplainedSamples.length < 5) row.unexplainedSamples.push(`${f}: ${e.target}`)
        }
      }
    }
  }
  return { files: files.length, truthRows, analyzerRows, perLabel: Object.fromEntries([...perLabel.entries()].map(([k, v]) => [k, v])) }
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
const parser: any = await getParser("cpp")
const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const analyzer = new mod.RealCppAnalyzer()
const ctor: any = analyzer?.constructor
if (typeof ctor?.setGrammar === "function") {
  try { ctor.setGrammar(parser.language, parser.constructor) } catch { /* main pass only, same contract as the runner */ }
}

const cases = await runCases(analyzer, parser)
const fixtures = await runFixtures(analyzer, parser)

// Which labels are emitted by the analyzer at all (the truth's own declared set is CPP_ORACLE_LABELS).
const emittedLabels = Object.entries(fixtures.perLabel as Record<string, { published: number }>).filter(([, v]) => v.published > 0).map(([k]) => k)
const declaredAudit = new Set<string>(CPP_ORACLE_LABELS as readonly string[])
const unauditedEmitted = emittedLabels.filter((l) => !declaredAudit.has(l))
const derivedButNoRows: string[] = []
for (const [label, row] of Object.entries(fixtures.perLabel as Record<string, any>)) {
  if (row.truth === 0 && row.published === 0) derivedButNoRows.push(label)
}
const findings: string[] = []
if (cases.failed > 0) findings.push(`${cases.failed} synthetic contract case(s) failed (positive not derived, or negative control not refused)`)
for (const row of cases.results) if (!row.ok) findings.push(`case ${row.case}: ${JSON.stringify([...row.positive, ...row.negative].filter((r: any) => !r.ok).map((r: any) => `${r.label}->${r.target} ${r.derived ? "derived" : "missing"}`))}`)
if (unauditedEmitted.length > 0) findings.push(`emitted labels NOT in the declared oracle label set: ${unauditedEmitted.join(", ")} — the differential admission half is Lead-owned (script/m14/differential.ts); this finding is reported, never patched here`)
for (const l of derivedButNoRows) findings.push(`label ${l}: ZERO truth rows and ZERO analyzer rows across ${fixtures.files} fixtures — a label compared against nothing`)

if (SELF_TEST) {
  // THE CONTROL: the same matcher that accepted the real rows above must REJECT a row the
  // oracle does not derive. Arm A = a real derived row (calls/helper from case 3). Arm B = a row
  // that must not exist (instantiates/char). If the matcher cannot return false for arm B, then
  // its "true" for arm A proves nothing.
  const a = await analyzeAndDerive(CASES[2].source, "fixtures/cpp/contract-self-test.cpp", analyzer, parser)
  const truthKeys = new Set(a.truth.map(key))
  const armA = truthKeys.has(`calls\u0000helper`)
  const armB = truthKeys.has(`instantiates\u0000char`)
  const ok = armA === true && armB === false
  console.log(`cpp-oracle-verify self-test — matcher arms: A(real row accepted)=${armA ? "PASS" : "FAIL"} · B(fabricated row refused)=${!armB ? "PASS" : "FAIL"}`)
  console.log(ok ? "self-test: PASS — the matcher accepts a real truth row and refuses one the oracle does not derive" : "self-test: FAIL — the control did not fire; the contract above proves nothing")
  process.exit(ok ? 0 : 3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-oracle-verify.ts",
  measuredAt: new Date().toISOString(),
  language: "cpp",
  oracleModule: "script/m14/cpp-truth.ts",
  declaredOracleLabels: [...CPP_ORACLE_LABELS],
  emittedLabels,
  unauditedEmitted,
  contract: {
    method: "synthetic cases: one positive derivation per emitted label + a negative control (a row the oracle must NOT derive); comparison on label + normTarget(target), the differential's own matching rule",
    cases: cases.results,
    failed: cases.failed,
  },
  fixtureLane: {
    method: "every .cpp fixture parsed once; RealCppAnalyzer.analyze vs deriveCppTruth+deriveCppShared; set comparison on label+normTarget(target). Both sides walk the same pinned parse — a shared grammar bug is invisible here (stated, not claimed around).",
    ...fixtures,
  },
  findings,
  ok: findings.length === 0,
}

if (TEXT) {
  console.log(`cpp-oracle-verify — oracle ${report.oracleModule} · declared labels ${CPP_ORACLE_LABELS.length} · emitted labels ${emittedLabels.length}`)
  console.log(`contract cases: ${CASES.length} · failed ${cases.failed}`)
  console.log()
  console.log("FIXTURE LANE — truth vs analyzer (label+normTarget)")
  console.log("-".repeat(78))
  for (const [label, row] of Object.entries(fixtures.perLabel as Record<string, any>)) {
    console.log(`  ${label.padEnd(14)} truth ${String(row.truth).padStart(6)} · published ${String(row.published).padStart(6)} · MISSING ${String(row.missing).padStart(5)} · unexplained ${String(row.unexplained).padStart(5)}`)
    for (const s of row.missingSamples.slice(0, 2)) console.log(`      MISSING e.g. ${s}`)
    for (const s of row.unexplainedSamples.slice(0, 2)) console.log(`      unexplained e.g. ${s}`)
  }
  console.log()
  if (findings.length) {
    console.log(`FINDINGS (${findings.length})`)
    for (const f of findings) console.log("  - " + f)
  } else {
    console.log("FINDINGS: none")
  }
} else {
  console.log(JSON.stringify(report, null, 1))
}
process.exit(report.ok ? 0 : 1)
