/**
 * probe-c-marker-verdict — WHAT VERDICT DOES EACH MARKER GET, AND ON WHICH AST?
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY.
 *
 * THE QUESTION. `engine.ts` parses the BLANKED content (its `parseRaw` blanks
 * `__attribute__((...))` and `__declspec(...)`) but hands the ANALYZER the ORIGINAL content
 * (`parseFile` keeps its own `content` parameter and passes that to
 * `enhancedAnalyzer.analyze(tree.rootNode, content, ...)`). So on the production path:
 *
 *   · the AST's node TEXTS are blanked (a `__declspec(dllexport)` attribute node is a run of
 *     spaces, and a `preproc_def`'s VALUE may be a run of spaces or absent);
 *   · the analyzer's OWN `content` is the original text.
 *
 * The lane's fix reads a macro's replacement list from the analyzer's own content, so the
 * question this probe answers is: **for each marker in the fixture, what verdict does the
 * analyzer reach, and does the AST's shape change it?**
 *
 * It runs the analyzer twice on the same fixture:
 *   A · parse the ORIGINAL content, give the analyzer the ORIGINAL content  (the FIXTURE path)
 *   B · parse the BLANKED content, give the analyzer the ORIGINAL content (the PRODUCTION path)
 *
 * and prints the marker verdicts from the analyzer's own verdict map, plus the `exports` edges.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealCAnalyzer } from "../../../../src/ast/real-c-analyzer"

const HERE = path.resolve(import.meta.dirname ?? ".")

/** `engine.ts`'s own blanking, reproduced verbatim (it is a two-line rule). */
function blankLikeEngine(text: string): string {
  const blankKeepingNewlines = (m: string): string => m.replace(/[^\n]/g, " ")
  return text
    .replace(/__attribute__\s*\(\([\s\S]*?\)\)/g, blankKeepingNewlines)
    .replace(/__declspec\s*\([\s\S]*?\)/g, blankKeepingNewlines)
}

function verdictRows(analyzer: any): string[] {
  const map: Map<string, any> = analyzer.exportMarkerVerdicts ?? new Map()
  const out: string[] = []
  for (const [name, v] of map) {
    const kind = v.unreadable ? "UNREADABLE" : v.nonBoundary ? "nonBoundary" : v.boundary ? "boundary" : v.empty ? "empty" : "other"
    out.push(`      ${name.padEnd(26)} defs=${v.defs} kind=${kind} allExtern=${v.allExtern} allAttribute=${v.allAttribute}`)
  }
  return out.sort()
}

function edges(result: any): string[] {
  const out: string[] = []
  for (const r of result.relationships ?? []) {
    if (String(r.type) !== "exports") continue
    const md = r.metadata ?? {}
    out.push(`      ${r.source}->${r.target}@${r.line_number} [${md.markerSource ?? "-"}/${md.exportMarkerKind ?? "-"}]`)
  }
  return out.sort()
}

async function main(): Promise<void> {
  const parser = await getParser("c" as any)
  const file = path.join(HERE, "exports-attribute-989.c")
  const raw = readFileSync(file, "utf8")
  const blanked = blankLikeEngine(raw)

  console.log("probe-c-marker-verdict — the SAME analyzer, TWO ASTs")
  console.log("")
  console.log("A = parse(ORIGINAL) + analyzer(ORIGINAL)   [the FIXTURE path]")
  console.log("B = parse(BLANKED) + analyzer(ORIGINAL)   [the PRODUCTION path]")
  console.log("")

  const a = new (RealCAnalyzer as any)()
  const aRes = await a.analyze(parser.parse(raw).rootNode, raw, "fixtures/c/exports-attribute-989.c")
  console.log("── A ──")
  console.log("  marker verdicts:")
  for (const l of verdictRows(a)) console.log(l)
  console.log("  exports edges:")
  for (const l of edges(aRes)) console.log(l)

  const b = new (RealCAnalyzer as any)()
  const bRes = await b.analyze(parser.parse(blanked).rootNode, raw, "fixtures/c/exports-attribute-989.c")
  console.log("")
  console.log("── B ──")
  console.log("  marker verdicts:")
  for (const l of verdictRows(b)) console.log(l)
  console.log("  exports edges:")
  for (const l of edges(bRes)) console.log(l)

  console.log("")
  console.log("── the BLANKED `#define` lines (what B's AST holds) ──")
  for (const line of blanked.split("\n")) {
    if (line.includes("#define")) console.log(`      ${JSON.stringify(line)}`)
  }

  // The declaration that differs: `SINGLE_PLATFORM_EXPORT void *single_platform_marker(int n);`
  // (line 145), immediately after the `#define` at line 144.
  console.log("")
  console.log("── WHERE THE AST DIFFERS: the region around line 144-145 ──")
  for (const [label, src] of [["A (original)", raw], ["B (blanked)", blanked]] as Array<[string, string]>) {
    const root = parser.parse(src).rootNode
    console.log(`  ${label}:`)
    const dump = (n: any, depth: number): void => {
      if (n.startPosition.row + 1 >= 143 && n.startPosition.row + 1 <= 146) {
        console.log(`      ${"  ".repeat(depth)}${n.type} [${n.startPosition.row + 1}:${n.startPosition.column}]-${n.endPosition.row + 1}:${n.endPosition.column} ${JSON.stringify(n.text.slice(0, 60))}`)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) dump(c, depth + 1)
      }
    }
    dump(root, 0)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
