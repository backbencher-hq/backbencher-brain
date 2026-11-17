/**
 * THE RECEIVER WAVE'S CONTROL — the two arms of receiver typing, measured together, on one fixture
 * whose shapes sit on opposite sides of the line between them.
 *
 * THE TWO ARMS, stated as the code now actually behaves:
 *   · the INDEX arm (`BB_CPP_INDEX_CONSUME=1`, requires a COMPLETE project index) resolves a receiver
 *     from its WRITTEN declaration type — constructor temp, `new`, typed local — wherever the written
 *     type is in the same function or the enclosing class is known from the walking scope stack;
 *   · the INDEX-FREE arm (`BB_CPP_LOCAL_RECEIVER=0` is its kill-switch; ON by default) anchors the
 *     two shapes whose receiver the language ITSELF names without inference: a bare call in a member
 *     body (implicit `this`) and `this->m()`. It checks the enclosing class's PUBLISHED symbols.
 *
 * WHY THIS FIXTURE CAN MEASURE BOTH ARMS AND A FIXTURE-BASED CONTROL CANNOT. The fixture
 * `cpp/receiver-walker-gaps` is a single file, so a COMPLETE index over it is constructible here; the
 * index arm stays flag-gated because the fixture suite runs without an index. But two of its six
 * shapes — the out-of-line member body and the lambda-in-a-member-body — ARE the index-free arm's
 * shape too, because both are bare calls inside a member body whose class is in this file. That
 * coincidence is the measurement: with the index flag OFF and the local arm ON, exactly those two
 * shapes carry an owner and the four written-local shapes do not. A control that asserted "flag OFF
 * means no owner anywhere" would now be asserting something FALSE — and it would fail for the right
 * reason, not the wrong one.
 *
 * THE FOUR DIRECTIONS, each falsifiable:
 *   1. BOTH ARMS OFF (no index flag + `BB_CPP_LOCAL_RECEIVER=0`) — the baseline row set, and NO row
 *      carries an owner. This is the pre-feature output, and it is what the kill-switch promises.
 *   2. LOCAL ARM ONLY (no index flag, local ON — the shipped default) — owners appear on the two
 *      anchor shapes the local arm can reach, and on NOTHING else: the written-local shapes stay
 *      unowned, which is the boundary between the arms.
 *   3. INDEX ARM ON (local ON) — the SAME row set, byte for byte, and every one of the six shapes
 *      carries the owner the index declares.
 *   4. THE NEGATIVE — a receiver whose type NOTHING declares keeps NO owner IN EVERY ARM: an owner
 *      that is guessed is the failure both arms exist to prevent.
 *
 * IT IS A MEASUREMENT FIRST. The report says which shapes are covered in which arm, and the control
 * fails while any direction is unmet — so a fix is aimed at the gaps this control NAMES.
 *
 * USAGE
 *   bun run script/m14/cpp-receiver-wave-verify.ts [--prove-red]
 *   bun run script/m14/cpp-receiver-wave-verify.ts --analyzer=<path> [--prove-red]
 *
 *   `--analyzer=<path>` points the control at a DIFFERENT analyzer build — which is how the RED
 *   PROOF is run: the control is run against a pre-fix copy of `src/ast/real-cpp-analyzer.ts` and
 *   must FAIL on it, because a control that cannot fail proves nothing.
 *
 * EXIT: 0 every direction holds · 2 usage/environment · 3 CONTROL DID NOT FIRE. With --prove-red
 *       the exit is 3 when the control DOES fire — the proof it can fail.
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

/** THE INDEX ARM'S SIX SHAPES — each with the line the `calls` row must be on, the leaf, and the owner. */
const SHAPES: { shape: string; line: number; leaf: string; owner: string; note: string }[] = [
  { shape: "for-range typed local", line: 14, leaf: "draw", owner: "Widget", note: "the range-for's declarator is not a `declaration` node" },
  { shape: "for-init typed local", line: 15, leaf: "draw", owner: "Widget", note: "the for-statement's initializer IS a declaration, and the measurement says it is REACHED" },
  { shape: "if-init typed local", line: 16, leaf: "draw", owner: "Widget", note: "the C++98 `if (T x = ...)` init is an init_declarator under a condition node" },
  { shape: "multi-declarator local", line: 17, leaf: "draw", owner: "Widget", note: "one declaration, two declarators — the SECOND name is the one a single-declarator read drops" },
  { shape: "out-of-line member body", line: 18, leaf: "draw", owner: "Widget", note: "BOTH arms can anchor this one: the index reads the class scope through the qualified declarator, and the index-free arm reads the bare callee in a member body" },
  { shape: "lambda in a member body", line: 19, leaf: "draw", owner: "Widget", note: "also both arms: the class scope through a lambda scope (index) and the bare callee's enclosing class (index-free)" },
]
/**
 * THE TWO SHAPES THE INDEX-FREE ARM CAN ANCHOR — the bare calls inside a member body whose class is
 * declared in this file. Everything else on this fixture is a WRITTEN-LOCAL receiver: its type is not
 * `this` and the callee is not bare, so the local arm must stay silent on it.
 */
const LOCAL_ANCHOR_LINES = new Set([18, 19])
/** THE NEGATIVE — a receiver whose type nothing declares keeps NO owner in every arm. */
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

interface Arm {
  name: string
  index: boolean
  local: boolean
}
/** One run of the analyzer, with BOTH switches as the caller set them. */
const runAnalyzer = async (arm: Arm): Promise<any[]> => {
  if (arm.index) process.env.BB_CPP_INDEX_CONSUME = "1"
  else delete process.env.BB_CPP_INDEX_CONSUME
  if (arm.local) delete process.env.BB_CPP_LOCAL_RECEIVER
  else process.env.BB_CPP_LOCAL_RECEIVER = "0"
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
const ownersOn = (rows: any[], line: number, leaf: string): { rows: any[]; owners: (string | null)[] } => {
  const hit = rows.filter((r: any) => r.line === line && r.target === leaf)
  return { rows: hit, owners: hit.map((r: any) => r.owner) }
}
const ownerText = (owners: (string | null)[]): string =>
  owners.length === 0 ? "(no row)" : owners.map((o) => (o === null ? "(none)" : o)).join(",")

const baseRows = await runAnalyzer({ name: "both arms OFF (kill-switches)", index: false, local: false })
const localRows = await runAnalyzer({ name: "local arm only (the shipped default)", index: false, local: true })
const fullRows = await runAnalyzer({ name: "index arm ON (local arm ON too)", index: true, local: true })

// ── direction 1: BOTH ARMS OFF — the pre-feature output: no row carries an owner ──────────────────
const baseOwners = baseRows.filter((r: any) => r.owner !== null)
const baseClean = baseOwners.length === 0

// ── direction 2: LOCAL ARM ONLY — the two anchor shapes carry the owner, NOTHING else does ────────
const localAnchor = SHAPES.filter((s) => LOCAL_ANCHOR_LINES.has(s.line)).map((s) => ({
  ...s,
  ...ownersOn(localRows, s.line, s.leaf),
}))
const localSilent = SHAPES.filter((s) => !LOCAL_ANCHOR_LINES.has(s.line)).map((s) => ({
  ...s,
  ...ownersOn(localRows, s.line, s.leaf),
}))
const localAnchorOk = localAnchor.every((r) => r.rows.length > 0 && r.owners.every((o) => o === r.owner))
const localSilentOk = localSilent.every((r) => r.rows.length > 0 && r.owners.every((o) => o === null))

// ── direction 3: the row set is UNMOVED by either arm, and the INDEX arm covers every shape ───────
const baseKeys = baseRows.map(rowKey).sort()
const localKeys = localRows.map(rowKey).sort()
const fullKeys = fullRows.map(rowKey).sort()
const sameKeys = (a: string[], b: string[]): boolean => a.length === b.length && a.every((k: string, i: number) => k === b[i])
const rowSetMoved = !sameKeys(baseKeys, localKeys) || !sameKeys(baseKeys, fullKeys)
const report: any[] = []
let covered = 0
for (const s of SHAPES) {
  const { rows, owners } = ownersOn(fullRows, s.line, s.leaf)
  const ok = rows.length > 0 && owners.every((o) => o === s.owner)
  if (ok) covered++
  report.push({ shape: s.shape, line: s.line, leaf: s.leaf, expectedOwner: s.owner, owners, rowCount: rows.length, ok, note: s.note })
}

// ── direction 4: THE NEGATIVE — no owner in ANY arm ───────────────────────────────────────────────
const negBase = ownersOn(baseRows, NEGATIVE.line, NEGATIVE.leaf)
const negLocal = ownersOn(localRows, NEGATIVE.line, NEGATIVE.leaf)
const negFull = ownersOn(fullRows, NEGATIVE.line, NEGATIVE.leaf)
const negativeOk =
  negBase.rows.length > 0 && negBase.owners.every((o) => o === null) &&
  negLocal.rows.length > 0 && negLocal.owners.every((o) => o === null) &&
  negFull.rows.length > 0 && negFull.owners.every((o) => o === null)

// ── the report, then the control ──────────────────────────────────────────────────────────────────
console.log("cpp-receiver-wave-verify — the two arms, measured on one fixture")
console.log("  fixture : validation/m14/fixtures/cpp/receiver-walker-gaps.cpp")
console.log("  analyzer:", path.relative(ROOT, ANALYZER))
console.log("  index   : COMPLETE, the shipped C++ declaration spec, over the fixture itself")
console.log(`  arms    : BOTH-OFF ${baseRows.length} rows · LOCAL-ONLY ${localRows.length} rows · INDEX-ON ${fullRows.length} rows`)
for (const r of report) {
  console.log(
    `  ${r.ok ? "PASS" : "FAIL"} ${r.shape.padEnd(28)} line ${String(r.line).padStart(2)} leaf ${r.leaf.padEnd(6)} ` +
      `rows=${r.rowCount} index-arm owner=${ownerText(r.owners)}`,
  )
}
console.log(`  covered by the INDEX arm: ${covered} of ${SHAPES.length}`)
for (const r of localAnchor) {
  console.log(`  ${r.owners.every((o) => o === r.owner) ? "PASS" : "FAIL"} local arm anchors ${r.shape.padEnd(28)} line ${String(r.line).padStart(2)} owner=${ownerText(r.owners)}`)
}
for (const r of localSilent) {
  console.log(`  ${r.owners.every((o) => o === null) ? "PASS" : "FAIL"} local arm silent on ${r.shape.padEnd(27)} line ${String(r.line).padStart(2)} owner=${ownerText(r.owners)}`)
}
console.log(
  `  ${negativeOk ? "PASS" : "FAIL"} ${NEGATIVE.shape.padEnd(28)} line ${String(NEGATIVE.line).padStart(2)} ` +
    `owner must be absent in every arm (both-off ${ownerText(negBase.owners)} · local ${ownerText(negLocal.owners)} · index ${ownerText(negFull.owners)})`,
)
console.log(`  ${baseClean ? "PASS" : "FAIL"} both arms OFF carry no owner anywhere (${baseOwners.length} rows carry one)`)
console.log(`  ${rowSetMoved ? "FAIL" : "PASS"} neither arm moves a row (both-off ${baseKeys.length} · local ${localKeys.length} · index ${fullKeys.length})`)

const allCovered = covered === SHAPES.length
const ok = allCovered && localAnchorOk && localSilentOk && negativeOk && baseClean && !rowSetMoved

if (PROVE_RED) {
  if (ok) {
    console.error("cpp-receiver-wave-verify --prove-red: the control did NOT fire — the arms are covered, so this proof is void")
    process.exit(0)
  }
  console.error(`cpp-receiver-wave-verify --prove-red: the control FIRED (${covered}/${SHAPES.length} covered) — the gaps are real and named`)
  process.exit(3)
}
if (!ok) {
  const why: string[] = []
  if (!allCovered) why.push(`${SHAPES.length - covered} shape(s) uncovered by the index arm`)
  if (!localAnchorOk) why.push("the local arm does not anchor a member-body shape")
  if (!localSilentOk) why.push("the local arm claims a written-local receiver")
  if (!negativeOk) why.push("the negative shape carries an owner")
  if (!baseClean) why.push("a kill-switch leaks an owner")
  if (rowSetMoved) why.push("an arm moved a row")
  console.error(`cpp-receiver-wave-verify: CONTROL DID NOT FIRE — ${why.join(" · ")}`)
  process.exit(3)
}
console.log("PASS — each arm covers exactly its own shapes, the kill-switches are clean, the negative carries none, and no arm moves a row")
process.exit(0)
