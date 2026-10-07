/**
 * GROOVY LANE NO-REGEX GATE — AST-driven, over the files THIS LANE owns.
 *
 * WHY THIS EXISTS RATHER THAN `script/m14/no-regex-gate.sh`.
 * That gate delegates to `script/m12/regex-census.ts`, whose population is
 * `analyzerFiles(dir)` = `src/ast/real-*-analyzer.ts` ONLY
 * (script/m12/regex-census-core.ts:29-33). So it reports "PASS — 0 regex
 * literals" while a regex literal sits in a lane-owned census script or oracle,
 * and hard rule 1 covers "your analyzer, census scripts, or oracle" — all
 * three. Measured on the lane files as inherited: `groovy-census-driver.mts`
 * carried two regex literals (`out.replace(/\.json$/, ".a.json")` and the
 * `.b.json` twin) under a header that asserted "NO REGEXP anywhere in this
 * file". The shared gate could not see either, because neither is in src/ast.
 *
 * POPULATION IS DERIVED, never hand-listed
 * (docs/M14-HONESTY-CONTRACT.md, "an instrument must declare the population it
 * covered"). A hard-coded `FILES = [...]` array is a defect the moment a file
 * is added beside it, and the instrument keeps reporting 0 with total
 * confidence. This derives membership as: every TypeScript-family source under
 * `script/m14/` and `script/m14/lanes/` whose basename starts with `groovy-`,
 * every source under `validation/m14/groovy/`, and
 * `src/ast/real-groovy-analyzer.ts`. `validation/m14/groovy/` is matched on the
 * DIRECTORY rather than the basename because that is where a lane keeps its
 * non-fixture instruments — the go lane's `validation/m14/go/go-payload-latency.ts`
 * is the precedent — and a basename rule would miss a file named after what it
 * measures rather than which lane it belongs to. If the derived set is empty the
 * gate EXITS 2 rather than printing a vacuous PASS.
 *
 * THE SCAN IS THE SAME SHAPE AS THE SHARED ONE — parse each file with the
 * project's tree-sitter TypeScript parser and walk the syntax tree for `regex`
 * literal nodes and `RegExp` constructor/call nodes. NOT a text scan: a text
 * scan matches regexes inside comments and inside string literals, which is the
 * failure mode the shared gate's own header documents (187 reported where the
 * truth was 5).
 *
 * NO REGEX IN THIS GATE either. Every string test is `endsWith`/`includes` or a
 * char-code comparison, so the instrument does not need policing by itself.
 *
 * USAGE
 *   npx tsx script/m14/lanes/groovy-no-regex-gate.mts
 * Exit 0 = no regex literal in any lane file. Exit 1 = at least one (each is
 * printed with file:line). Exit 2 = empty population, which is NOT a pass.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

// THREE levels up: this file is script/m14/lanes/<gate>.mts, so "../.." is
// `script/` and the derived population comes back EMPTY. The gate refuses to
// print a vacuous PASS on an empty population, which is how that bug was caught
// rather than shipped as "0 regexes across 0 files" — the exact shape the
// honesty contract's population rule was written about.
const ROOT = resolve(new URL("../../..", import.meta.url).pathname)

function isTsp(ts: string): boolean {
  return ts.endsWith(".ts") || ts.endsWith(".tsx") || ts.endsWith(".mts") || ts.endsWith(".cts")
}

/** Derived membership. Returns [] rather than guessing if a directory is absent. */
function laneFiles(): string[] {
  const out: string[] = []
  const analyzer = join(ROOT, "src", "ast", "real-groovy-analyzer.ts")
  if (statSafe(analyzer)) out.push(analyzer)

  const m14 = join(ROOT, "script", "m14")
  for (const f of readdirSafe(m14)) {
    const p = join(m14, f)
    if (!statSafe(p)) continue
    if (f.startsWith("groovy-") && isTsp(f)) out.push(p)
  }
  const lanes = join(m14, "lanes")
  for (const f of readdirSafe(lanes)) {
    if (!f.startsWith("groovy-") || !isTsp(f)) continue
    const p = join(lanes, f)
    if (statSafe(p)) out.push(p)
  }
  // The lane's non-fixture instruments live here; matched on the DIRECTORY.
  const laneInstruments = join(ROOT, "validation", "m14", "groovy")
  for (const f of readdirSafe(laneInstruments)) {
    if (!isTsp(f)) continue
    const p = join(laneInstruments, f)
    if (statSafe(p)) out.push(p)
  }
  return [...new Set(out)].sort()
}
function statSafe(p: string): boolean {
  try { return statSync(p).isFile() } catch { return false }
}
function readdirSafe(d: string): string[] {
  try { return readdirSync(d) } catch { return [] }
}

const files = laneFiles()
const rel = (p: string) => relative(ROOT, p)

if (files.length === 0) {
  console.error("groovy-no-regex-gate: derived population is EMPTY.")
  console.error("  An empty population is not a pass. Check the path or the prefix rule.")
  process.exit(2)
}

const { getParser } = await import(join(ROOT, "src", "ast", "engine.ts"))
const parser = await getParser("typescript")

const findings: string[] = []
for (const file of files) {
  const content = readFileSync(file, "utf8")
  let tree: any
  try { tree = parser.parse(content) } catch { findings.push(`${rel(file)}  PARSE FAILED — not scanned, which is not a pass`); continue }
  const visit = (node: any, depth = 0): void => {
    if (depth > 200 || findings.length > 200) return
    if (node.type === "regex") {
      findings.push(`${rel(file)}:${node.startPosition.row + 1}  regex literal  ${content.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 60))}`)
    }
    // `RegExp(...)` and `new RegExp(...)` — spelled by node type, not by text.
    if (node.type === "new_expression" || node.type === "call_expression") {
      const callee = node.childForFieldName?.("constructor") ?? node.childForFieldName?.("function")
      if (callee?.type === "identifier" && callee.text === "RegExp") {
        findings.push(`${rel(file)}:${node.startPosition.row + 1}  RegExp constructor  ${content.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 60))}`)
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) visit(c, depth + 1)
    }
  }
  visit(tree.rootNode)
  tree.delete?.()
}

console.log(`groovy lane no-regex gate — population: ${files.length} lane files (derived, not hand-listed)`)
for (const f of files) console.log(`  ${rel(f)}`)
console.log("scan: tree-sitter TypeScript AST — regex literal nodes and RegExp constructor/call nodes")
console.log("--------------------------------------------------------------------------")
if (findings.length === 0) {
  console.log(`PASS — 0 regex literals across ${files.length} of ${files.length} lane files`)
  process.exit(0)
}
for (const f of findings) console.log(`  ${f}`)
console.log(`FAIL — ${findings.length} regex literal site(s) across ${files.length} lane files. Replace with a tree-sitter AST walk.`)
process.exit(1)
