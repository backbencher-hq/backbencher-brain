/**
 * c-citation-probe — evidence instrument for D7 CLAIMED (ISO-C citation emission).
 *
 * Runs the analyzer on ONE file and prints every `calls` row with its target, whether the file declares the
 * target, and the `metadata.languageNamespace` citation (if any). Then asserts the four fixture invariants,
 * exits 1 on any violation:
 *   1. a listed ISO-C name NOT declared in the file CARRIES the citation, and it cites exactly its target;
 *   2. a SAME-FILE-DECLARED listed name carries NO citation (the claim may never excuse a project name);
 *   3. an UNLISTED library name carries NO citation (vocabulary is the authority; no invented names);
 *   4. a third-party non-listed name carries NO citation.
 * Usage: bun run script/m14/c-citation-probe.ts [fixture.c]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealCAnalyzer } from "../../src/ast/real-c-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const rel = process.argv[2] ?? "validation/m14/fixtures/c/iso-c-citation-997.c"
const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
const parser: any = await getParser("c")
const analyzer = new RealCAnalyzer()
const result: any = await analyzer.analyze(parser.parse(src).rootNode, src, rel)
const LISTED = new Set(["strlen", "malloc", "memcpy", "free"])
const failures: string[] = []
let cited = 0
for (const e of (result.relationships ?? []) as any[]) {
  if (String(e.type) !== "calls") continue
  const target = String(e.target)
  const md = (e.metadata ?? {}) as any
  const citation: string[] | undefined = md.languageNamespace
  console.log(`calls ${e.source} -> ${target} @${e.line_number} · citation=${citation ? JSON.stringify(citation) : "none"}`)
  if (citation) cited++
}
const declaredNames = new Set<string>(["free"]) // this fixture declares `free`; others are undeclared
const check = (target: string, wantCitation: boolean): void => {
  const row = ((result.relationships ?? []) as any[]).find((e) => String(e.type) === "calls" && String(e.target) === target)
  if (!row) { failures.push(`row calls -> ${target} missing`); return }
  const md = (row.metadata ?? {}) as any
  const citation: string[] | undefined = md.languageNamespace
  if (wantCitation) {
    if (!citation || citation.length !== 1 || citation[0] !== target) failures.push(`listed undeclared ${target} did not cite exactly ["${target}"] (got ${JSON.stringify(citation)})`)
  } else {
    if (citation) failures.push(`target ${target} MUST stay uncited but carries ${JSON.stringify(citation)}`)
  }
}
for (const t of ["strlen", "malloc", "memcpy"]) check(t, true)
check("free", false)          // same-file declared
check("strlcpy", false)       // unlisted library
check("PyObject_Call", false) // non-listed third party
void declaredNames
console.log(`calls rows with a citation: ${cited}`)
if (failures.length > 0) {
  console.error(`CITATION CONTRACT FAILED — ${failures.length} finding(s):`)
  for (const f of failures) console.error("  " + f)
  process.exit(1)
}
console.log("CITATION CONTRACT PASSED — positives cited exactly; same-file-declared, unlisted and third-party names uncited")
