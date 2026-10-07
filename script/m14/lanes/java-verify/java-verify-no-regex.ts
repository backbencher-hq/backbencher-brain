/**
 * NO-REGEX CHECK FOR THIS LANE'S INSTRUMENTS — VERIFY_JAVA9.
 *
 * ## Why this file exists at all
 *
 * `script/m14/no-regex-gate.sh` reports "regex census gate PASSED" with
 * `TOTAL 4 in scope (whole tree: 4)`, and that PASS says NOTHING about this
 * lane. Its scope line reads:
 *
 *     scope: src/ast — 48 of 48 scanned analyzers in scope
 *
 * and `analyzerFiles()` in the shared scanner filters to
 * `real-*-analyzer.ts`. So the four census/oracle/mutant/payload scripts this
 * lane added under `script/m14/lanes/java-verify/` are not in the population the
 * gate scans. That is exactly the failure the honesty contract's "Rule: an
 * instrument must declare the population it covered" was written about: a
 * confident PASS about a population the instrument never looked at. Reported to
 * the master as a shared-harness scope gap; NOT fixed here, because
 * `script/m14/**` and `script/m12/**` are master-owned.
 *
 * So the lane checks its own instruments, and prints the population it covered.
 *
 * ## HOW IT SCANS
 *
 * By AST, the same way the shared scanner does: the files are parsed with the
 * project's own tree-sitter TypeScript grammar and the tree is walked for
 * `regex` nodes and `new RegExp(...)` constructors. A text scan for `/.../`
 * cannot tell `split("/re/")` from `split(".")`, which is the false positive
 * REVIEW-2026-10-04 §5 names. Walking the grammar does not have that problem,
 * because a string literal IS a string_literal node and a pattern IS a regex
 * node.
 *
 * A `String.prototype.split/replace/match/search/test` call whose FIRST argument
 * is a `regex` node is reported as a regex usage. A call whose first argument is
 * a `string` node is NOT — that is a delimiter walk, and java's analyzer and every
 * instrument in this lane use only those.
 *
 * ## NO REGEX IN THIS FILE
 * Tree walks and `indexOf` over node text. The one `indexOf` call is on a
 * node-type string, which is not source text.
 *
 * ## USAGE
 *   bun script/m14/lanes/java-verify/java-verify-no-regex.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine"

const LANE_DIR = join(import.meta.dir)
const ANALYZER = join(LANE_DIR, "../../../../src/ast/real-java-analyzer.ts")

// The population, DERIVED by readdir and printed, never a hand-written list: a
// list that silently stops covering a new file reports 0 with total confidence.
const files = readdirSync(LANE_DIR)
  .filter((f) => f.endsWith(".ts") || f.endsWith(".mjs"))
  .filter((f) => f.indexOf("tmp-") !== 0)
  .sort()
  .map((f) => join(LANE_DIR, f))
files.push(ANALYZER)

console.log(`LANE NO-REGEX CHECK (VERIFY_JAVA9)`)
console.log(`population: ${files.length} files — every .ts/.mjs in script/m14/lanes/java-verify/ (${readdirSync(LANE_DIR).filter((f) => (f.endsWith(".ts") || f.endsWith(".mjs")) && f.indexOf("tmp-") !== 0).length}, derived by readdir) plus src/ast/real-java-analyzer.ts`)
console.log(`method: parse with tree-sitter TypeScript, walk for \`regex\` nodes and RegExp constructors\n`)

const STRING_METHODS = new Set(["split", "replace", "replaceAll", "match", "matchAll", "search", "test", "exec"])
const parser = await getParser("typescript")

interface Hit { file: string; line: number; kind: string; text: string }
const hits: Hit[] = []
let scanned = 0, parseFailures = 0

for (const abs of files) {
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { continue }
  scanned++
  let tree: any
  try { tree = parser.parse(content) } catch { parseFailures++; continue }
  const walk = (n: any) => {
    if (n.type === "regex") {
      hits.push({ file: relative(process.cwd(), abs), line: n.startPosition.row + 1, kind: "regex literal", text: String(n.text).slice(0, 60) })
    }
    // `new RegExp(...)` — the constructor form of the same thing
    if (n.type === "new_expression") {
      let ctor = ""
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c.type === "identifier" && String(c.text) === "RegExp") ctor = "RegExp"
      }
      if (ctor) hits.push({ file: relative(process.cwd(), abs), line: n.startPosition.row + 1, kind: "new RegExp", text: String(n.text).slice(0, 60) })
    }
    // a String method called WITH a pattern
    if (n.type === "call_expression") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "member_expression") {
          const prop = c.childForFieldName?.("property")
          const method = prop ? String(prop.text ?? "") : ""
          if (!STRING_METHODS.has(method)) continue
          const argsNode = n.childForFieldName?.("arguments")
          if (!argsNode || argsNode.namedChildCount === 0) continue
          const first = argsNode.namedChild(0)
          if (first && first.type === "regex") {
            hits.push({ file: relative(process.cwd(), abs), line: n.startPosition.row + 1, kind: "String." + method + "(/pattern/)", text: String(n.text).slice(0, 70) })
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(tree.rootNode)
  tree.delete?.()
}

console.log(`scanned ${scanned}/${files.length} files · ${parseFailures} parse failures · ${hits.length} regex usages\n`)

// Attribute every hit to a file this lane WROTE or to bytes carried over verbatim
// from a shared script. The distinction is the point: a hit in a lane's own code is
// that lane's defect, while a hit inherited by a byte-for-byte copy of a shared
// harness belongs to the harness's owner. Blurring the two is how a lane ends up
// either fixing another lane's file or claiming a clean scan it did not earn.
const SHARED_COPY = "firing-check-v2-lane.mjs"
const own = hits.filter((h) => h.file.indexOf(SHARED_COPY) < 0)
const inherited = hits.filter((h) => h.file.indexOf(SHARED_COPY) >= 0)

console.log(`=== IN THIS LANE'S OWN CODE (${own.length}) ===`)
for (const h of own) console.log(`  ${h.file}:${h.line}  ${h.kind}  ${h.text}`)
if (own.length === 0) console.log(`  none. No regular expression in any instrument this lane wrote, nor in src/ast/real-java-analyzer.ts.`)

console.log(`\n=== CARRIED OVER VERBATIM FROM A SHARED SCRIPT (${inherited.length}) ===`)
console.log(`  ${SHARED_COPY} is script/m14/firing-check-v2.mjs with exactly ONE line changed`)
console.log(`  (REPO resolved from import.meta.url instead of a hard-coded absolute path).`)
console.log(`  Every regex below is the shared script's own, unchanged, and belongs to the`)
console.log(`  owner of script/m14/**. Reported, NOT fixed here -- and NOT counted against`)
console.log(`  this lane, because a lane that edits another lane's harness bytes to satisfy`)
console.log(`  its own rule has broken the separation the rule exists to protect.`)
for (const h of inherited) console.log(`  ${h.file}:${h.line}  ${h.kind}  ${h.text}`)

if (hits.length === 0) console.log(`\nno regular expression anywhere in this population.`)
if (parseFailures > 0) console.log(`\nNOTE: ${parseFailures} file(s) did not parse, so this is a statement about ${scanned - parseFailures} files and NOT about the whole population. Silence about the rest is not a pass.`)
