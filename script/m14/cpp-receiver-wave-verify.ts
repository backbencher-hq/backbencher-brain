/**
 * THE RECEIVER WAVE'S CONTROL — which of the walker gaps the analyzer's per-function written-type
 * table and scope stack actually miss, and whether the wave's fix changes the row set.
 *
 * WHY A CONTROL AND NOT A FIXTURE. The receiver-typing emission is flag-gated
 * (`BB_CPP_INDEX_CONSUME=1`) and requires a COMPLETE project index, and the fixture suite runs
 * WITHOUT the flag — by design, so the accepted D1–D6 behaviour stays byte-identical without it.
 * So the suite pins the ROWS (the fixture `cpp/receiver-walker-gaps`) and this control pins the
 * OWNER, in the other direction, exactly as `cpp-citation-verify.ts` does for the citation claim.
 *
 * THE THREE DIRECTIONS, because a wave that adds evidence to rows must not move the rows:
 *   1. FLAG OFF — the baseline row set, and NO row carries an owner. The flag must not leak.
 *   2. FLAG ON  — the SAME row set, byte for byte (no row emitted, no row suppressed), and the
 *                 owner metadata appears on every shape whose owner the index declares.
 *   3. THE NEGATIVE — a receiver whose type NOTHING declares keeps NO owner: the emission rule
 *      requires the index to declare the leaf under an owner the index knows, and an owner that
 *      is guessed is the failure this whole rule exists to prevent.
 *
 * IT IS A MEASUREMENT FIRST. The report says which shapes are covered and which are not, and the
 * control fails while any shape is uncovered — so the fix is aimed at the gaps this control
 * NAMES, not at a guess about the grammar.
 *
 * USAGE
 *   bun run script/m14/cpp-receiver-wave-verify.ts [--prove-red]
 *   bun run script/m14/cpp-receiver-wave-verify.ts --analyzer=<path> [--prove-red]
 *
 *   `--analyzer=<path>` points the control at a DIFFERENT analyzer build — which is how the RED
 *   PROOF is run: the control is run against a pre-fix copy of `src/ast/real-cpp-analyzer.ts` and
 *   must FAIL on it, because a control that cannot fail proves nothing.
 *
 * EXIT: 0 every shape covered and the row set unmoved · 2 usage/environment · 3 CONTROL DID NOT
 *       FIRE. With --prove-red the exit is 3 when the control DOES fire — the proof it can fail.
 */
import * as path from "node:path"
import { readFileSync, existsSync } from "node:fs"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`${f}=`))
  return hit ? hit.slice(f.length + 1) : null
}
const FIXTURE = path.join(ROOT, "validation/m14/fixtures/cpp/receiver-walker-gaps.cpp")
const ANALYZER = argOf("--analyzer") ?? path.join(ROOT, "src/ast/real-cpp-analyzer.ts")
const PROVE_RED = process.argv.includes("--prove-red")

/** THE SHAPES — each with the line the `calls` row must be on, the leaf, and the owner. */
const SHAPES: { shape: string; line: number; leaf: string; owner: string; note: string }[] = [
  { shape: "for-range typed local", line: 14, leaf: "draw", owner: "Widget", note: "the range-for's declarator is not a `declaration` node" },
  { shape: "for-init typed local", line: 15, leaf: "draw", owner: "Widget", note: "the for-statement's initializer IS a declaration, and the measurement says it is REACHED" },
  { shape: "if-init typed local", line: 16, leaf: "draw", owner: "Widget", note: "the C++98 `if (T x = ...)` init is an init_declarator under a condition node" },
  { shape: "multi-declarator local", line: 17, leaf: "draw", owner: "Widget", note: "one declaration, two declarators — the SECOND name is the one a single-declarator read drops" },
  { shape: "out-of-line member body", line: 18, leaf: "draw", owner: "Widget", note: "the class scope of an out-of-line definition" },
  { shape: "lambda in a member body", line: 19, leaf: "draw", owner: "Widget", note: "the class scope through a lambda scope" },
]
/** THE NEGATIVE — a receiver whose type nothing declares keeps NO owner. */
const NEGATIVE = { shape: "unknown owner", line: 24, leaf: "draw" }

if (!existsSync(FIXTURE)) {
  console.error(`cpp-receiver-wave-verify: the fixture is absent (${FIXTURE})`)
  process.exit(2)
}

// ── the index, over the fixture itself, COMPLETE by construction ──────────────────────────────────
const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const spec: any = indexMod.CPP_DECLARATION_SPEC
if (!spec) {
  console.error("cpp-receiver-wave-verify: project-index.ts does not export CPP_DECLARATION_SPEC")
  process.exit(2)
}
const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
if (!existsSync(wasm)) {
  console.error(`cpp-receiver-wave-verify: the grammar is absent (${wasm})`)
  process.exit(2)
}
const built: any = await indexMod.buildProjectIndexStreaming(wasm, [FIXTURE], spec)
built.complete = true
indexMod.buildResolutionTables(built)

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const parser: any = await getParser("cpp")
const analyzerMod: any = await import(ANALYZER)
const analyzer: any = new analyzerMod.RealCppAnalyzer()
const content = readFileSync(FIXTURE, "utf8")
const tree = parser.parse(content)

/** One run of the analyzer, with the consume flag as the caller set it. */
const runAnalyzer = async (flagOn: boolean): Promise<any[]> => {
  if (flagOn) process.env.BB_CPP_INDEX_CONSUME = "1"
  else delete process.env.BB_CPP_INDEX_CONSUME
  const result: any = await analyzer.analyze(tree.rootNode, content, FIXTURE, {
    projectIndex: built,
    projectRoot: path.dirname(FIXTURE),
  } as any)
  return (result.relationships ?? []).map((r: any) => ({
    type: r.type,
    from: r.source ?? r.from,
    target: r.target,
    line: r.metadata?.line ?? r.line,
    qualified: r.metadata?.qualified ?? null,
    owner: (r.metadata?.owner as string | undefined) ?? null,
  }))
}

/** THE ROW SET, as the comparable identity of a row: its kind, its source, its target, its line. */
const rowKey = (r: any): string => `${r.type}|${r.from}|${r.target}|${r.line}|${r.qualified ?? ""}`

const offRows = await runAnalyzer(false)
const onRows = await runAnalyzer(true)

// ── direction 1: the flag OFF — no row carries an owner ───────────────────────────────────────────
const offOwners = offRows.filter((r: any) => r.owner !== null)
const flagClean = offOwners.length === 0

// ── direction 2: the row set is UNMOVED by the flag ───────────────────────────────────────────────
const offKeys = offRows.map(rowKey).sort()
const onKeys = onRows.map(rowKey).sort()
const rowSetMoved = offKeys.length !== onKeys.length || offKeys.some((k: string, i: number) => k !== onKeys[i])

// ── direction 3: the shapes, EVERY row on the line ────────────────────────────────────────────────
const ownersOn = (rows: any[], line: number, leaf: string): { rows: any[]; owners: (string | null)[] } => {
  const hit = rows.filter((r: any) => r.line === line && r.target === leaf)
  return { rows: hit, owners: hit.map((r: any) => r.owner) }
}
const report: any[] = []
let covered = 0
for (const s of SHAPES) {
  const { rows, owners } = ownersOn(onRows, s.line, s.leaf)
  const ok = rows.length > 0 && owners.every((o) => o === s.owner)
  if (ok) covered++
  report.push({ shape: s.shape, line: s.line, leaf: s.leaf, expectedOwner: s.owner, owners, rowCount: rows.length, ok, note: s.note })
}
const neg = ownersOn(onRows, NEGATIVE.line, NEGATIVE.leaf)
const negativeOk = neg.rows.length > 0 && neg.owners.every((o) => o === null)

// ── the report, then the control ──────────────────────────────────────────────────────────────────
console.log("cpp-receiver-wave-verify — the walker gaps, measured")
console.log("  fixture : validation/m14/fixtures/cpp/receiver-walker-gaps.cpp")
console.log("  analyzer:", path.relative(ROOT, ANALYZER))
console.log("  index   : COMPLETE, the shipped C++ declaration spec, over the fixture itself")
for (const r of report) {
  const owners = r.owners.length === 0 ? "(no row)" : r.owners.map((o: string | null) => (o === null ? "(none)" : o)).join(",")
  console.log(
    `  ${r.ok ? "PASS" : "FAIL"} ${r.shape.padEnd(28)} line ${String(r.line).padStart(2)} leaf ${r.leaf.padEnd(6)} ` +
      `rows=${r.rowCount} owner=${owners}`,
  )
}
console.log(`  covered ${covered} of ${SHAPES.length}`)
console.log(
  `  ${negativeOk ? "PASS" : "FAIL"} ${NEGATIVE.shape.padEnd(28)} line ${String(NEGATIVE.line).padStart(2)} ` +
    `rows=${neg.rows.length} owner must be absent`,
)
console.log(`  ${flagClean ? "PASS" : "FAIL"} the flag OFF leaks no owner (${offOwners.length} rows carry one)`)
console.log(`  ${rowSetMoved ? "FAIL" : "PASS"} the flag moves no row (off ${offKeys.length} · on ${onKeys.length})`)

const allCovered = covered === SHAPES.length
const ok = allCovered && negativeOk && flagClean && !rowSetMoved

if (PROVE_RED) {
  if (ok) {
    console.error("cpp-receiver-wave-verify --prove-red: the control did NOT fire — the gaps are covered, so this proof is void")
    process.exit(0)
  }
  console.error(`cpp-receiver-wave-verify --prove-red: the control FIRED (${covered}/${SHAPES.length} covered) — the gaps are real and named`)
  process.exit(3)
}
if (!ok) {
  const why: string[] = []
  if (!allCovered) why.push(`${SHAPES.length - covered} shape(s) uncovered`)
  if (!negativeOk) why.push("the negative shape carries an owner")
  if (!flagClean) why.push("the flag leaks an owner")
  if (rowSetMoved) why.push("the flag moved a row")
  console.error(`cpp-receiver-wave-verify: CONTROL DID NOT FIRE — ${why.join(" · ")}`)
  process.exit(3)
}
console.log("PASS — every shape carries the receiver evidence, the negative carries none, and the row set is unmoved")
process.exit(0)
