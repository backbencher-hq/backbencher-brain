// script/m14/tmp/sw-fixture-probe.ts — analyzer + oracle output for the new swift
// fixtures (authored with the pins BEFORE running, this probe only checks them).
// Run: bun script/m14/tmp/sw-fixture-probe.ts [name...]
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

const names = process.argv.slice(2)
const files = names.length > 0
  ? names.map((n) => `${n}.swift`)
  : ["case-pattern-recovery.swift", "unwrap-write-gate.swift", "enum-construction-splice.swift", "error-recovery-nominal.swift"]

const COMPARED = new Set(["extends", "implements", "instantiates", "calls", "uses", "references"])
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), "utf8")
  const pp = new P(); pp.setLanguage(LANG)
  const root = pp.parse(src).rootNode
  const r: any = await new RealSwiftAnalyzer().analyze(root, src, f, { typeKinds: new Map() } as any)
  console.log(`\n########## ${f} (hasError=${root.hasError}) ##########`)
  console.log("-- symbols --")
  for (const s of r.symbols ?? []) {
    console.log(`  ${s.name} | ${s.kind} | owner=${s.ownerName} | vis=${s.visibility} | line=${s.range?.startLine}`)
  }
  const rels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), from: String(x.source), target: String(x.target), conf: x.confidence, meta: JSON.stringify(x.metadata ?? {}) }))
  console.log("-- analyzer relationships (compared kinds) --")
  for (const x of rels) if (COMPARED.has(x.label) || x.label === "contains") console.log(`  ${x.label} ${x.from} -> ${x.target} @${x.conf} ${x.meta}`)
  const truth = mod.deriveSwiftEdges(root, new Set<string>())
  for (const e of mod.deriveSwiftBareUses(root, r.symbols ?? [])) truth.push(e)
  const analyzed = rels.filter((x: any) => COMPARED.has(x.label))
  const aOnly = analyzed.filter((x: any) => !truth.some((t: any) => t.label === x.label && t.target === x.target))
  const oOnly = truth.filter((t: any) => COMPARED.has(t.label) && !analyzed.some((x: any) => x.label === t.label && x.target === t.target))
  console.log(`-- one-sided: analyzer-only=${aOnly.length} oracle-only=${oOnly.length}`)
  for (const x of aOnly) console.log(`  A-ONLY ${x.label} ${x.from} -> ${x.target} @${x.conf}`)
  for (const x of oOnly) console.log(`  O-ONLY ${x.label} -> ${x.target}`)
}
