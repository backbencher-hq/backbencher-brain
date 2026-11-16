// #924 kotlin E half — the PAIRING contract, measured on a real corpus file.
//
// The lane matches truth against the analyzer by `label + normTarget(target)`, and
// normTarget keeps only the last segment with generics/brackets stripped. This probe
// prints, for one real Exposed file, every `uses` edge on BOTH sides with the key the
// lane actually compares, so the E-half fix can be designed against the contract
// instead of guessed from 14k lines of oracle.
//
// Read-only. Run in a replica:
//   bun script/m14/tmp/c924-kt-uses-pairs.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { deriveKotlinEdges, deriveTreeEdges, normTarget } from "../differential"
import { parseFile } from "../../../src/ast/engine"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const FILE = "Exposed/exposed-tests/src/test/kotlin/org/jetbrains/exposed/v1/tests/shared/dml/MergeTableTest.kt"

async function parser() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-kotlin.wasm")))
  const p = new P()
  p.setLanguage(language)
  return p
}

const abs = path.join(CORPUS, FILE)
const content = fs.readFileSync(abs, "utf8")

const p = await parser()
const tree = p.parse(content)
const root = tree.rootNode

const truth: any[] = [...deriveTreeEdges(root, "kotlin"), ...deriveKotlinEdges(root)]
const res: any = await parseFile(abs, content)

const flat = (s: string) => String(s ?? "").replace(/\s+/g, " ")

const truthUses = truth.filter((e) => e.label === "uses")
const analyzerUses = (res.relationships ?? []).filter((r: any) => String(r.type) === "uses")

console.log(`file: ${FILE}`)
console.log(`\n=== TRUTH uses (${truthUses.length}) ===`)
const truthKeys = new Set<string>()
for (const e of truthUses) {
  const key = `${e.label}|${normTarget(e.target)}`
  truthKeys.add(key)
  console.log(`  ${key}   <- raw ${JSON.stringify(flat(e.target))}`)
}

console.log(`\n=== ANALYZER uses (${analyzerUses.length}) ===`)
for (const r of analyzerUses) {
  const key = `uses|${normTarget(String(r.target))}`
  console.log(`  ${key}   <- published ${JSON.stringify(flat(String(r.target)))}${truthKeys.has(key) ? "" : "   [NO TRUTH ROW WITH THIS KEY]"}`)
}

const analyzerKeys = new Set(analyzerUses.map((r: any) => `uses|${normTarget(String(r.target))}`))
console.log(`\n=== truth keys no analyzer row matches ===`)
for (const k of truthKeys) if (!analyzerKeys.has(k)) console.log(`  ${k}`)
