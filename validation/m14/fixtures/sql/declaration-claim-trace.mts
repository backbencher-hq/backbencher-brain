/**
 * DECLARATION CLAIM TRACE — which entry path reaches each declaration node first, and what the
 * analyzer's own recovery counters say about it.
 *
 * ## WHY THIS EXISTS
 *
 * `sweep-reachability.mts` measures the population: 880 declaration nodes nested inside another
 * declaration, over 3 corpus files, almost all of them published. `sweep-ablation.mts` measures
 * the consequence: removing `sweepDeclarations` loses 3,629 edges and 1,663 symbols over 234
 * files, so the pass is load-bearing. Neither says WHICH path claims those declarations, and the
 * counter that names them — `metadata.ambiguity.sweepDeclarationsRecovered` — reads 0 on all
 * 1,959 files measured.
 *
 * Three readings fit "counter 0, pass load-bearing": the counter is broken; the pass is dead and
 * the ablation is measuring something else; or the pass publishes through a path its counter does
 * not watch. This separates them by OBSERVING the claim, not by reading the counter.
 *
 * ## THE INSTRUMENT
 *
 * `markDeclaration` is the single guard every declaration passes through — the root walk
 * (`processStatement`), the sweep's own declaration branch, the resync pass and the EXECUTE pass
 * all call it, and it returns true exactly once per `(absolute start index, node type)`. Wrapping
 * it on the PROTOTYPE therefore observes the first claim of every declaration in the file and
 * attributes it to the entry path in the call stack.
 *
 * TypeScript `private` is compile-time only: at runtime the method is an ordinary prototype
 * property and `engine.ts` reaches the analyzer through a dynamic `import()` that the ESM module
 * cache returns once, so the wrapper is installed for every `parseFile` call and reverted after.
 * `src/` is not edited and the wrapper delegates to the original on every call.
 *
 * Entry paths are named by the METHOD that contains the `markDeclaration` CALL SITE, resolved from a
 * `ts.createSourceFile` tree of the CURRENT analyzer rather than hard-coded, so a line move shows up
 * as a renamed path instead of silently mis-attributing:
 *
 *   processStatement        the method that owns the claim, which every entry path routes through
 *   sweepDeclarations       the sweep's own frame, reached from the root walk or from the nested-statement re-entry
 *   processRoot             the root walk's own `processStatement` call
 *   resync                  the statement-slice re-parse
 *   execute                 the EXECUTE-literal pass
 *   line<N>                 a frame inside no method — reported rather than folded into a neighbour
 *
 * No pattern-matching over the analyzer's source text, in either direction: the enclosing method,
 * the call-site anchors, and the stack frames are all resolved structurally. See the notes on
 * `METHOD_SPANS` and `calleeName`.
 *
 * ## USAGE
 *   npx tsx validation/m14/fixtures/sql/declaration-claim-trace.mts [--out FILE] FILE.sql [FILE.sql ...]
 *   npx tsx validation/m14/fixtures/sql/declaration-claim-trace.mts --corpus     # every admitted file, sharded
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import * as ts from "typescript"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { RealSqlAnalyzer } from "../../../../src/ast/real-sql-analyzer"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT || "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const LANG = "sql"
const SIZE_CAP = 512 * 1024
const CORPUS_MODE = argv.includes("--corpus")
const SHARDS = Number(argOf("--shards") ?? "0")
const SHARD = Number(argOf("--shard") ?? "0")

/** The analyzer source, parsed ONCE into a syntax tree, so nothing below reads it as text. */
const ANALYZER_ABS = path.join(ROOT, "src/ast/real-sql-analyzer.ts")
const ANALYZER_FILE = "real-sql-analyzer.ts"
const ANALYZER_TEXT = readFileSync(ANALYZER_ABS, "utf8")
const ANALYZER_SF = ts.createSourceFile(ANALYZER_ABS, ANALYZER_TEXT, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

/**
 * WHY A SYNTAX TREE AND NOT A PATTERN. This instrument has to answer "which METHOD is this line
 * inside", and the first version answered it by scanning the source backwards for a line shaped
 * like a method declaration. That is the failure mode the lane's own rules name: a pattern over
 * source text matches a commented-out method, a method name inside a string, and a call to
 * `if (x) {` shaped like a signature, with no way to tell the three apart. It also had to strip
 * keywords by hand, which is a list that goes stale. So the attribution is resolved from
 * `ts.createSourceFile` output — `node.type` and named children — and the keyword list is not
 * needed because a `MethodDeclaration` is a distinct node kind.
 *
 * PARSE ONLY, not a typecheck: `ts.createProgram` is `npm run typecheck`. This wants syntax, and a
 * syntax tree is enough to name every frame.
 */
type MethodSpan = { name: string; from: number; to: number }
const METHOD_SPANS: MethodSpan[] = []
{
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name !== undefined) {
      const name = ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name) ? node.name.text : undefined
      if (name !== undefined) {
        const { line: from } = ANALYZER_SF.getLineAndCharacterOfPosition(node.getStart(ANALYZER_SF))
        const { line: to } = ANALYZER_SF.getLineAndCharacterOfPosition(node.getEnd())
        METHOD_SPANS.push({ name, from: from + 1, to: to + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ANALYZER_SF)
}

/**
 * Which method a line belongs to, resolved from the syntax tree. A stack frame gives a line, not a
 * function, and a line number alone rots the moment anything above it moves — so the attribution is
 * resolved to a NAME every time it is printed. Where method spans nest, the INNERMOST wins: a line
 * inside a local helper declared in a method belongs to the helper.
 */
function enclosingMethod(line: number): string {
  let best: MethodSpan | undefined
  for (const m of METHOD_SPANS) {
    if (line < m.from || line > m.to) continue
    if (!best || (m.to - m.from) < (best.to - best.from)) best = m
  }
  return best ? best.name : line > 0 ? `line${line}` : "unknown"
}

/**
 * The attribution for one call: the method whose body contains the `markDeclaration` CALL SITE, and
 * the method that called it. Both are needed. `markDeclaration` is called from `processStatement`
 * (reached by the root walk, by the sweep's nested-statement re-entry, and by the resync and
 * EXECUTE passes) and from `sweepDeclarations`'s own declaration branch, and the two are
 * indistinguishable from the node type alone.
 */
function attribute(frames: number[]): string {
  // `processStatement` recurses into itself, so two consecutive frames can carry the same method
  // name; collapsing runs keeps the chain readable and keeps the DISTINCTION — which is the whole
  // point — because a run of `processStatement` reached from `sweepDeclarations` is a different
  // path from the same run reached from `processRoot`.
  const chain: string[] = []
  for (const f of frames.slice(0, 6)) {
    const m = enclosingMethod(f)
    if (chain[chain.length - 1] !== m) chain.push(m)
  }
  return chain.join(" <- ")
}

/**
 * The analyzer's source lines on the live stack, in order.
 *
 * A V8 frame reads `at <fn> (<file>:<line>:<col>)`, so the file and line are recovered by cutting at
 * the last `(` and splitting the remainder on `:` — by string position, not by pattern. The frames
 * that matter are identified by the file name ENDING in the analyzer's file name, which is how a
 * frame from this instrument's own file is excluded.
 */
function analyzerFrames(stack: string): number[] {
  const out: number[] = []
  for (const frame of stack.split("\n")) {
    const open = frame.lastIndexOf("(")
    if (open < 0) continue
    let inner = frame.slice(open + 1)
    if (inner.endsWith(")")) inner = inner.slice(0, -1)
    const parts = inner.split(":")
    if (parts.length < 3) continue
    if (!(parts[0] ?? "").endsWith(ANALYZER_FILE)) continue
    const line = Number(parts[1])
    if (Number.isFinite(line) && line > 0) out.push(line)
  }
  return out
}

const proto = RealSqlAnalyzer.prototype as any
const originalMark = proto.markDeclaration
if (typeof originalMark !== "function") { console.error("markDeclaration is not on the prototype"); process.exit(3) }

type Tally = Map<string, number>
const firstClaim: Tally = new Map()
const repeats: Tally = new Map()
let currentFile = ""
let tracedFiles = 0
const perFile: any[] = []

function install() {
  proto.markDeclaration = function (node: any, state: any) {
    const frames = analyzerFrames(new Error().stack ?? "")
    const claimed = originalMark.call(this, node, state)
    const path = attribute(frames)
    const t = claimed ? firstClaim : repeats
    const k = `${node.type} via ${path}`
    t.set(k, (t.get(k) ?? 0) + 1)
    return claimed
  }
}
function remove() { proto.markDeclaration = originalMark }

/**
 * The dotted name of a call's callee, built from the tree: `this.processStatement`,
 * `state.nestedStatements.add`. Property-access chains are unwrapped node by node, so an anchor is
 * found by its structure and not by the spelling of the line it happens to sit on.
 */
function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expr)) {
    const left = calleeName(expr.expression)
    return left === undefined ? undefined : `${left}.${expr.name.text}`
  }
  if (ts.isIdentifier(expr)) return expr.text
  /**
   * `this` is a `ThisKeyword` node in the syntax tree, NOT an identifier, so the identifier branch
   * above does not see it. Without this branch every `this.x(...)` call in the analyzer resolves to
   * undefined and every `this.`-anchored label below reads `absent` — which is what the first
   * version of this walk did, silently reporting three missing anchors instead of three bugs in it.
   */
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return "this"
  if (ts.isCallExpression(expr)) return calleeName(expr.expression)
  if (ts.isNonNullExpression(expr)) return calleeName(expr.expression)
  return undefined
}

/** Every call of `name` in the analyzer, as `method@line`, located by AST walk. */
function callSites(name: string): { anchor: string; method: string; line: number }[] {
  const found: { anchor: string; method: string; line: number }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === name) {
      const line = ANALYZER_SF.getLineAndCharacterOfPosition(node.getStart(ANALYZER_SF)).line + 1
      found.push({ anchor: `${enclosingMethod(line)}@${line}`, method: enclosingMethod(line), line })
    }
    ts.forEachChild(node, visit)
  }
  visit(ANALYZER_SF)
  return found
}

/** The line numbers the labels are derived from, so a reader can check the attribution. */
function labelAnchors(): Record<string, string> {
  const out: Record<string, string> = {}
  const at = (name: string, label: string) => {
    const hits = callSites(name)
    out[label] = hits.length === 0 ? "absent" : hits.map((h) => h.anchor).join(", ")
    out[`${label}Count`] = String(hits.length)
  }
  at("this.processStatement", "processRoot")
  at("this.sweepDeclarations", "sweepCall")
  at("state.nestedStatements.add", "nestedStatementsAdd")
  at("this.markDeclaration", "markDeclarationCallSites")
  return out
}

async function traceOne(abs: string, label: string) {
  currentFile = label
  const before = new Map(firstClaim)
  install()
  let r: any
  try { r = await parseFile(abs, LANG) } catch { remove(); return null }
  remove()
  const delta = new Map<string, number>()
  for (const [k, v] of firstClaim) { const d = v - (before.get(k) ?? 0); if (d > 0) delta.set(k, d) }
  const amb = r?.metadata?.ambiguity ?? {}
  tracedFiles++
  perFile.push({
    file: label,
    symbols: (r?.symbols ?? []).length,
    firstClaims: Object.fromEntries([...delta].sort((a, b) => b[1] - a[1])),
    counters: {
      sweepDeclarationsRecovered: amb.sweepDeclarationsRecovered ?? 0,
      sweepStatementsDispatched: amb.sweepStatementsDispatched ?? 0,
      resyncDeclarations: amb.resyncDeclarations ?? 0,
      executeRecovered: amb.executeRecovered ?? 0,
    },
  })
  return delta
}

const explicit = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--shards", "--shard"].includes(argv[i - 1]!)))
const targets: { abs: string; label: string }[] = []
if (!CORPUS_MODE && explicit.length > 0) {
  for (const t of explicit) targets.push({ abs: path.resolve(t), label: t })
} else {
  const admitted: { abs: string; label: string }[] = []
  for (const entry of readdirSync(CR)) {
    const dir = path.join(CR, entry)
    let tracked: string[] = []
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text = ""
      try { if (statSync(abs).size > SIZE_CAP) continue; text = readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== LANG) continue
      admitted.push({ abs, label: `${entry}/${rel}` })
    }
  }
  admitted.sort((a, b) => (a.label < b.label ? -1 : 1))
  const slice = SHARDS > 0 ? admitted.filter((_, i) => i % SHARDS === SHARD) : admitted
  for (const t of slice) targets.push(t)
}
console.log(`declaration claim trace — production parseFile, markDeclaration wrapped on the prototype`)
console.log(`targets ${targets.length}`)
console.log(`label anchors ${JSON.stringify(labelAnchors())}`)

for (const t of targets) await traceOne(t.abs, t.label)

const roll = (t: Tally) => Object.fromEntries([...t].sort((a, b) => b[1] - a[1]))
console.log(`\nfiles traced ${tracedFiles}`)
console.log(`\nFIRST CLAIM of each declaration node, by node type and entry path`)
for (const [k, v] of Object.entries(roll(firstClaim))) console.log(`  ${String(v).padStart(7)}  ${k}`)
console.log(`\nREPEAT visits (guard returned false)`)
for (const [k, v] of Object.entries(roll(repeats))) console.log(`  ${String(v).padStart(7)}  ${k}`)
let cSweep = 0, cStmt = 0, cResync = 0, cExec = 0
for (const f of perFile) { cSweep += f.counters.sweepDeclarationsRecovered; cStmt += f.counters.sweepStatementsDispatched; cResync += f.counters.resyncDeclarations; cExec += f.counters.executeRecovered }
console.log(`\ncounters over the traced files`)
console.log(`  sweepDeclarationsRecovered ${cSweep}`)
console.log(`  sweepStatementsDispatched  ${cStmt}`)
console.log(`  resyncDeclarations         ${cResync}`)
console.log(`  executeRecovered           ${cExec}`)

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/declaration-claim-trace.mts",
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    method: "RealSqlAnalyzer.prototype.markDeclaration wrapped; TypeScript `private` is compile-time only and engine.ts dynamic-imports the module once, so the wrapper sees every call and src/ is untouched",
    labelResolution: "the caller line comes from the live stack (string positions, no pattern) and the path label from a ts.createSourceFile walk of the CURRENT analyzer — a MethodDeclaration span for the enclosing method, a PropertyAccess chain for the call site — so a line move renames the path instead of mis-attributing it",
    labelAnchors: labelAnchors(),
    corpusRoot: CR,
    population: CORPUS_MODE ? `admitted corpus files${SHARDS > 0 ? `, strided slice ${SHARD} of ${SHARDS}` : ""}` : `explicit list of ${explicit.length}`,
    filesTraced: tracedFiles,
    firstClaim: roll(firstClaim),
    repeatVisits: roll(repeats),
    counters: { sweepDeclarationsRecovered: cSweep, sweepStatementsDispatched: cStmt, resyncDeclarations: cResync, executeRecovered: cExec },
    filesWithANonZeroFirstClaim: perFile.filter((f) => Object.keys(f.firstClaims).length > 0),
    perFile,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}