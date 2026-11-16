// script/m14/tmp/c907-lockstep.ts — does #907's recovery move the differential?
//
// The repo's rule is that an analyzer change which shifts lane matching changes the
// oracle in the SAME commit. The design claim for this fix is that it is F5-neutral:
// it adds Symbols, and pushes no scope, so no relationship should move. This probe
// tests that claim on the real corpus file rather than asserting it.
//
// Run: bun script/m14/tmp/c907-lockstep.ts [file]
import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveCCalls } from "../differential"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const F = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/jq/src/jv_print.c"
const src = readFileSync(F, "utf8")
const root = parser.parse(src).rootNode

// truth side (what the oracle derives from the tree)
let truth: any[] = []
try {
  truth = deriveCCalls(root, src) as any[]
} catch (e) {
  console.log(`deriveCCalls threw: ${(e as Error).message}`)
}
const tKey = (e: any) => `${e.label ?? e.type}:${e.from ?? e.source ?? "?"}->${e.target}`
const truthSet = new Set(truth.map(tKey))

// analyzer side (the production entry)
const r: any = await parseFile(F, "<corpus-root>/bb_tests/repositories/jq")
const mine: any[] = r.relationships ?? []
const aKey = (e: any) => `${String(e.type)}:${e.source ?? "global"}->${e.target}`

const truthOnly = [...truthSet].filter((k) => !mine.some((m) => aKey(m) === k))
const analyzerOnly = mine.map(aKey).filter((k) => !truthSet.has(k))

const byLabel = (rows: any[]) => rows.reduce<Record<string, number>>((acc, e) => {
  const k = String(e.label ?? e.type)
  acc[k] = (acc[k] ?? 0) + 1
  return acc
}, {})

console.log(`file: ${F.split("/").pop()}`)
console.log(`  truth rows=${truth.length} ${JSON.stringify(byLabel(truth))}`)
console.log(`  analyzer rows=${mine.length} ${JSON.stringify(byLabel(mine))}`)
console.log(`  symbols=${r.symbols?.length}, functions=${(r.symbols ?? []).filter((s: any) => String(s.kind) === "function").length}`)
console.log(`  truth-only=${truthOnly.length}${truthOnly.length ? ` e.g. ${truthOnly.slice(0, 4).join(" | ")}` : ""}`)
console.log(`  analyzer-only=${analyzerOnly.length}${analyzerOnly.length ? ` e.g. ${analyzerOnly.slice(0, 4).join(" | ")}` : ""}`)
const touchRecovered = analyzerOnly.filter((k) => /jv_dumpf|jv_dump\b/.test(k))
console.log(`  analyzer-only rows naming the RECOVERED functions: ${touchRecovered.length}${touchRecovered.length ? ` -> ${touchRecovered.join(" | ")}` : " (none — recovery is edge-neutral)"}`)
