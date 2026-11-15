/**
 * probe-c-attribute-blanking — DOES THE FIXTURE PATH SEE WHAT PRODUCTION SEES?
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY: it writes no file and
 * changes no analyzer.
 *
 * THE QUESTION. Three c `exports` fixtures fail on missing rows, and every missing row is an
 * ATTRIBUTE spelling (`__attribute__((visibility("default")))`, `__declspec(dllexport)`). The
 * fixture runner calls the analyzer DIRECTLY:
 *
 *     script/m14/run-fixtures.ts:1023
 *       result = await analyzer.analyze(tree.rootNode, content, ...)
 *
 * with `content` read straight off disk. The gate — and production — go through
 * `pool-worker.parseFile` -> `engine.ts:1157` -> `ASTEngine.parseFile`, and `engine.ts:1637-1653`
 * BLANKS every `__attribute__((...))` and `__declspec(...)` out of the content it hands the
 * PARSER:
 *
 *     const blankKeepingNewlines = (match) => match.replace(/[^\n]/g, " ")
 *
 * — space-for-space, so offsets and line numbers stay honest — and that same blanked `content`
 * is what `engine.ts:1963` hands the ANALYZER:
 *
 *     analysisResult = enhancedAnalyzer.analyze(tree.rootNode, content, filePath, context)
 *
 * `real-c-analyzer.ts`'s own comment at its Form C block says *"the ANALYZER is handed the
 * ORIGINAL content"*. **This probe asks the two paths instead of reading the comments.**
 *
 * WHAT IS MEASURED, per file:
 *   A · the FIXTURE path's `exports` edges   (direct analyzer call, original content)
 *   B · the PRODUCTION path's `exports` edges (pool-worker.parseFile -> engine -> analyzer)
 *   C · the SET DIFFERENCE, both directions
 *   D · whether the analyzer's `content` argument contains the attribute spelling at all
 *      (the direct question: does the analyzer RECEIVE the text it is asked to read?)
 *
 * R4 (charter §21.41): a probe asks the instrument what it says; it does not predict.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { getParser } from "../../../../src/ast/engine"
import { RealCAnalyzer } from "../../../../src/ast/real-c-analyzer"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.resolve(import.meta.dirname ?? ".")

const FILES = [
  "exports-attribute-989.c",
  "export-linkage-marker-989.c",
  "export-marker-class-965.c",
]

/** The `exports` edges of a parse result, as `source -> target@line`. */
function exportEdges(result: any): string[] {
  const rels = (result?.relationships ?? []) as any[]
  const out: string[] = []
  for (const r of rels) {
    if (String(r.type) !== "exports") continue
    const md = (r.metadata ?? {}) as any
    const via = `${md.markerSource ?? "-"}/${md.exportMarkerKind ?? "-"}`
    out.push(`${r.source}->${r.target}@${r.line_number} [${via}]`)
  }
  out.sort()
  return out
}

async function main(): Promise<void> {
  const parser = await getParser("c" as any)

  // The PRODUCTION path, through the gate's own entry point.
  const pool = await import("../../../../src/ast/pool-worker")

  console.log("probe-c-attribute-blanking — FIXTURE path vs PRODUCTION path, `exports` edges")
  console.log("")
  console.log("PATHS")
  console.log("  A (fixture)    script/m14/run-fixtures.ts:1023  analyzer.analyze(tree.rootNode, RAW content)")
  console.log("  B (production) src/ast/pool-worker.ts:1157 -> src/ast/engine.ts:1637 (BLANKED) -> :1963")
  console.log("")

  for (const file of FILES) {
    const full = path.join(HERE, file)
    const raw = readFileSync(full, "utf8")

    // --- A: the fixture path.
    const analyzer = new (RealCAnalyzer as any)()
    const tree = parser.parse(raw)
    const a = exportEdges(await analyzer.analyze(tree.rootNode, raw, `fixtures/c/${file}`))

    // --- B: the production path.
    const b = exportEdges(await pool.parseFile(full, HERE, { projectRoot: HERE } as any))

    // --- D: does the analyzer RECEIVE the attribute spelling on each path?
    const rawHasAttr = raw.includes("__attribute__") || raw.includes("__declspec")
    const blanked = raw
      .replace(/__attribute__\s*\(\([\s\S]*?\)\)/g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/__declspec\s*\([\s\S]*?\)/g, (m) => m.replace(/[^\n]/g, " "))
    const blankedHasAttr = blanked.includes("__attribute__") || blanked.includes("__declspec")

    const setA = new Set(a)
    const setB = new Set(b)
    const onlyA = a.filter((x) => !setB.has(x))
    const onlyB = b.filter((x) => !setA.has(x))

    console.log(`── ${file} ──`)
    console.log(`  A fixture-path exports edges   : ${a.length}`)
    for (const x of a) console.log(`      ${x}`)
    console.log(`  B production-path exports edges : ${b.length}`)
    for (const x of b) console.log(`      ${x}`)
    console.log(`  C only-in-A (fixture sees, production does not): ${onlyA.length}`)
    for (const x of onlyA) console.log(`      ${x}`)
    console.log(`    only-in-B (production sees, fixture does not): ${onlyB.length}`)
    for (const x of onlyB) console.log(`      ${x}`)
    console.log(`  D attribute spelling present in RAW content     : ${rawHasAttr}`)
    console.log(`    attribute spelling present in the BLANKED text the analyzer receives: ${blankedHasAttr}`)
    console.log("")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
