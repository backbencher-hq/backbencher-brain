/**
 * THE GRAMMAR HOLE THE FOURTH PROPERTY FOUND — a watchdog, not a fixture.
 *
 * WHAT HAPPENED. `cause-claim-oracle.ts` — bucket 3's independent implementation — refuted THREE
 * claims out of 284,377, each of the same shape: an edge whose declared cause named a base that the
 * EMITTING FILE ITSELF declares (`scope.dart` claiming `AbstractTypeParameterScope`, which line 53
 * of that file declares). A refutation means the claim is FALSE, so this was either an analyzer bug,
 * a degraded parse, or an oracle false positive. It is neither of the last two:
 *
 *   - the parses are FULL (`fallback: null`, `analysisVersion` 4.0.0, no degradation), so the
 *     analyzer saw the whole file and still could not name the class;
 *   - the gap is the GRAMMAR: `abstract class Selector(final Token token) { … }` is dart's
 *     declaring-constructor (primary-constructor) form, and the bundled `tree-sitter-dart.wasm`
 *     — itself a LOCAL REBUILD shipped as `tree-sitter-dart-new.wasm`, per
 *     `reviews/m60-grammar-unmatched-source-read.md` — produces ERROR nodes for it. The class node
 *     never exists, so no analyzer walk could publish it.
 *
 * WHY THE CONSEQUENCE IS BIGGER THAN THREE ROWS. The class symbol and its OWNED members are lost,
 * and the members' nodes are recovered OUTSIDE the class body: a method declared inside a
 * primary-constructor class is published with an owner that is not that class. Three refuted claims
 * are the visible tip; the invisible part is every symbol and edge in such a class carrying the wrong
 * owner.
 *
 * WHAT THIS FILE DOES. It is a WATCHDOG, so it asserts the DEFECT IS STILL PRESENT and fails the day
 * it closes — at which point the lane doc's GRAMMAR HOLE section and the spec entry are stale and
 * must be corrected. A fixture that pinned the wrong behaviour silently would be worse than no
 * fixture; one that fails when the behaviour is FIXED is what makes the hole impossible to forget.
 * It also measures the corpus population, because "some dart-sdk files" is not a size: the form's
 * appearance in any project that had none is a population change worth a red run.
 *
 * Run: npx tsx validation/m14/fixtures/dart/primary-constructor-hole.ts
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import * as WTS from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const ROOT = process.cwd()

/** The two forms, side by side: one the grammar has always known, one it does not. */
const ORDINARY = `abstract class OrdinaryBase {
  final int seed;
  OrdinaryBase(this.seed);
  int get doubled => seed * 2;
  int methodOwn() => 0;
}
`
const PRIMARY = `abstract class PrimaryBase(final int seed) {
  int get doubled => seed * 2;
  int methodOwn() => 0;
}
`
/** The second shape matters separately: with an `extends` clause the grammar's ERROR recovery has
 *  somewhere to put the members, so they can be recovered OUTSIDE the class rather than dropped.
 *  "Lost" and "attributed to the wrong owner" are different defects and are measured apart. */
const PRIMARY_EXTENDS = `abstract class Base {
  int get doubled => 0;
}
class Impl(String label) extends Base {
  @override
  int get doubled => 0;
  int methodOwn() => 1;
}
`

const dir = mkdtempSync(path.join(tmpdir(), "dt-primary-"))
writeFileSync(path.join(dir, "ordinary.dart"), ORDINARY)
writeFileSync(path.join(dir, "primary.dart"), PRIMARY)
writeFileSync(path.join(dir, "primary_extends.dart"), PRIMARY_EXTENDS)

const Parser: any = (WTS as any).Parser ?? (WTS as any).default?.Parser
const Language: any = (WTS as any).Language ?? (WTS as any).default?.Language
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
const parser = new Parser()
parser.setLanguage(lang)

const failures: string[] = []
const countErrors = (src: string): number => {
  const root = parser.parse(src).rootNode
  let n = 0
  const scan = (node: any): void => {
    if (node.isError || node.isMissing) n++
    for (let i = 0; i < node.childCount; i++) scan(node.child(i))
  }
  scan(root)
  return n
}

// ---------------------------------------------------------------------------------------------
// CONTROL — the instrument's falsifier. A scanner that reported "the grammar cannot parse this"
// for BOTH forms would be decoration, and the `ordinary` half is the only thing that can tell the
// two apart. It must also be able to say the hole HAS closed, which is the exit condition below.
// ---------------------------------------------------------------------------------------------
const ordinaryErrors = countErrors(ORDINARY)
if (ordinaryErrors !== 0) failures.push(`control: the ORDINARY class form produced ${ordinaryErrors} error node(s) — the scan does not distinguish the two forms`)
const primaryErrors = countErrors(PRIMARY)
if (primaryErrors === 0) failures.push("control: the PRIMARY-CONSTRUCTOR form parsed with NO error node — the hole this watchdog exists for has CLOSED (see the exit note below)")

/** the analyzer's view of each file: the class symbol, and where its members were attributed */
async function analyzerView(src: string): Promise<{ file: string; names: string[]; doubled: any[]; methodOwn: any[] }> {
  const f = path.join(dir, src)
  const out: any = await parseFile(f, dir, { projectRoot: dir } as any)
  const syms = (out?.symbols ?? []) as any[]
  const where = (s: any) => ({ name: s.name, kind: s.kind, ownerName: s.ownerName ?? null, scope: s.scope ?? null })
  return {
    file: src,
    names: syms.map((s) => s.name),
    doubled: syms.filter((s) => s.name === "doubled").map(where),
    methodOwn: syms.filter((s) => s.name === "methodOwn").map(where),
  }
}
const ordinary = await analyzerView("ordinary.dart")
const primary = await analyzerView("primary.dart")
const primaryExtends = await analyzerView("primary_extends.dart")
// the `extends` shape must show the SAME hole: the class gone, its members recovered elsewhere.
if (primaryExtends.names.includes("Impl")) failures.push("the primary-constructor class WITH an `extends` clause IS published now — the hole has CLOSED (see the exit note below)")
for (const s of [...primaryExtends.methodOwn, ...primaryExtends.doubled]) {
  if (s.ownerName === "Impl" || s.scope === "Impl") failures.push(`a member of the primary-constructor class is attributed to it now (${s.name} owner=${s.ownerName ?? s.scope}) — the hole has CLOSED (see the exit note below)`)
}

if (!ordinary.names.includes("OrdinaryBase")) failures.push("control: the analyzer did not publish the ORDINARY class — the comparison below would be meaningless")
if (primary.names.includes("PrimaryBase")) failures.push("the primary-constructor class IS published now — the hole has CLOSED (see the exit note below)")
/** the mis-attribution half: the member exists, but not under the class that declares it */
for (const s of primary.methodOwn) {
  if (s.ownerName === "PrimaryBase" || s.scope === "PrimaryBase") {
    failures.push(`the member of a primary-constructor class is now attributed to it (owner=${s.ownerName ?? s.scope}) — the hole has CLOSED (see the exit note below)`)
  }
}

if (failures.length > 0) {
  console.error("PRIMARY-CONSTRUCTOR WATCHDOG — the defect is no longer what this file records:")
  for (const f of failures) console.error(`  ${f}`)
  console.error("\n  ACTION: the grammar gap is closed or changed. Update the GRAMMAR HOLE section of")
  console.error("  docs/analyzers/dart.md, the DT-PC spec entry, and this watchdog — and")
  console.error("  re-measure the corpus arms, because a grammar bump moves every table in that document.")
  process.exit(3)
}

console.log("watchdog control: PASS — the ordinary form parses clean and is published; the")
console.log("primary-constructor form still errors in the grammar, and the analyzer still loses the class.")
console.log(`\n  ordinary.dart  error nodes ${ordinaryErrors} · symbols ${JSON.stringify(ordinary.names)}`)
console.log(`  primary.dart   error nodes ${primaryErrors} · symbols ${JSON.stringify(primary.names)}`)
console.log(`  primary class members: ${JSON.stringify(primary.methodOwn)}`)
console.log(`  primary_extends.dart error nodes ${countErrors(PRIMARY_EXTENDS)} · symbols ${JSON.stringify(primaryExtends.names)}`)
console.log(`  its members: ${JSON.stringify([...primaryExtends.methodOwn, ...primaryExtends.doubled])}`)

// ---------------------------------------------------------------------------------------------
// THE POPULATION — measured, with the gate's admission rule, so "some files" becomes a number and a
// project that newly starts using the form is a red run rather than a silent drift.
// ---------------------------------------------------------------------------------------------
function blank(text: string): string {
  const out = text.split("")
  const n = text.length
  let i = 0
  const blankRange = (from: number, to: number) => { for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " " }
  while (i < n) {
    const c = text[i], d = text[i + 1]
    if (c === "/" && d === "/") { const s = i; while (i < n && text[i] !== "\n") i++; blankRange(s, i); continue }
    if (c === "/" && d === "*") { const s = i; i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i = Math.min(n, i + 2); blankRange(s, i); continue }
    const isRaw = (c === "r" || c === "R") && (d === "'" || d === '"')
    if (c === "'" || c === '"' || isRaw) {
      const q = isRaw ? d : c, s = i
      if (isRaw) i++
      const triple = text[i + 1] === q && text[i + 2] === q
      i += triple ? 3 : 1
      while (i < n) {
        if (text[i] === "\\" && !isRaw) { i += 2; continue }
        if (triple ? text[i] === q && text[i + 1] === q && text[i + 2] === q : text[i] === q) { i += triple ? 3 : 1; break }
        i++
      }
      blankRange(s, i); continue
    }
    i++
  }
  return out.join("")
}
/** a class NAME immediately followed by a parameter list — the declaring-constructor form. `class
 *  Foo._(…)` is a named constructor and does not match (the `.` precedes the paren). */
const FORM = /\bclass\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*<[^;{}()]*?>)?\s*\(/g

/** measured 2026-10-10 on the dart population; a project that HAD none appearing is the signal */
const BASELINE: Record<string, number> = { "pb-reference": 0, "nvim-treesitter": 0, "dart-http": 0, riverpod: 0, proxicall: 0, "flutter-packages": 0, "dart-sdk": 440 }

let totFiles = 0, totDecls = 0, totDart = 0
const newExposure: string[] = []
for (const name of Object.keys(BASELINE)) {
  const repoDir = path.join(CR, name)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean).filter((r) => r.endsWith(".dart")) } catch {
    console.log(`${name.padEnd(18)} repository not present`)
    continue
  }
  let files = 0, decls = 0, dart = 0
  for (const r of tracked) {
    const abs = path.join(repoDir, r)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    dart++
    const hits = blank(readFileSync(abs, "utf8")).match(FORM)
    if (hits && hits.length > 0) { files++; decls += hits.length }
  }
  totFiles += files; totDecls += decls; totDart += dart
  const grew = files > 0 && (BASELINE[name] ?? 0) === 0
  console.log(`${name.padEnd(18)} ${String(files).padStart(5)} of ${String(dart).padStart(6)} admitted files carry the form; ${String(decls).padStart(5)} declarations${grew ? "   <<< NEW EXPOSURE" : ""}`)
  if (grew) newExposure.push(`${name}: ${decls} declarations in ${files} file(s), baseline 0`)
}
console.log(`\nTOTAL ${totFiles} of ${totDart} admitted files (${totDart ? (100 * totFiles / totDart).toFixed(2) : "0.00"}%), ${totDecls} declarations`)
if (newExposure.length > 0) {
  console.error("\nPOPULATION CHANGE — a project that used none of this form on 2026-10-10 now uses it:")
  for (const e of newExposure) console.error(`  ${e}`)
  console.error("  ACTION: the grammar's reach is now wider than the doc's GRAMMAR HOLE paragraph says;")
  console.error("  update the counts there and the DT-PC spec entry, then re-run the corpus arms.")
  process.exit(3)
}
