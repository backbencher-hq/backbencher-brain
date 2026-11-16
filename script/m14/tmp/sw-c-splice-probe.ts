// script/m14/tmp/sw-c-splice-probe.ts — full edge dump (with sources) for the
// #942 enum-construction-splice fixture, both sides.
import * as fs from "node:fs"
import * as path from "node:path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const DIR = path.join(ROOT, "validation/m14/fixtures/swift")
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const mod: any = await import("../../../script/m14/differential")

const f = process.argv[2] ?? "enum-construction-splice.swift"
const src = fs.readFileSync(path.join(DIR, f), "utf8")
const pp = new P(); pp.setLanguage(LANG)
const root = pp.parse(src).rootNode
const r: any = await new RealSwiftAnalyzer().analyze(root, src, f, { typeKinds: new Map() } as any)
console.log(`### ${f} hasError=${root.hasError}`)
console.log("-- symbols --")
for (const s of r.symbols ?? []) console.log(`  ${s.name} | ${s.kind} | owner=${s.ownerName} | line=${s.range?.startLine}`)
console.log("-- analyzer ALL rels --")
for (const x of r.relationships ?? []) {
  console.log(`  ${String(x.type).toLowerCase()} ${x.source} -> ${x.target} @${x.confidence} L${x.line_number} ${JSON.stringify(x.metadata ?? {})}`)
}
const truth: any[] = mod.deriveSwiftEdges(root, new Set<string>())
for (const e of mod.deriveSwiftBareUses(root, r.symbols ?? [])) truth.push(e)
console.log("-- oracle truth --")
for (const t of truth) console.log(`  ${t.label} ${t.source ?? "?"} -> ${t.target}`)
