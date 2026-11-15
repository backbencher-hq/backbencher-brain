// script/m14/tmp/surface-binding-audit.ts — is every analyzer that MENTIONS the framework
// contract actually being ADJUDICATED by the R8 census?
//
// "Clean" and "not examined" both print zero. The objective-c fix proved the gap is real:
// wrapping the metadata literal in an IIFE dropped the lane from adjudication while every
// count stayed at zero. This lists the files that name a contract key without publishing
// one the census can read, so the blind spot is measured rather than assumed away.
//
// The key-name scan is deliberately TEXT-level HERE and only here: it is the cohort
// selector (which files merit examination), not a verdict. Every verdict still comes from
// the structural classifier.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { scanFile } from "../../m60/framework-surface-census"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const AST = path.join(ROOT, "src/ast")

const wts: any = WTS
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
const parser = new P()
parser.setLanguage(language)

const CONTRACT = /detectedFrameworks|frameworkPatterns|hasFrameworkIntelligence/
const files = readdirSync(AST).filter((f) => /^real-.*-analyzer\.ts$/.test(f)).sort()

const examined: string[] = []
const unreadable: string[] = []
const silent: string[] = []
for (const f of files) {
  const src = readFileSync(path.join(AST, f), "utf8")
  const { scan } = scanFile(parser, path.join(AST, f), src)
  const mentions = CONTRACT.test(src)
  const keys = scan.publishedContractKeys
  if (keys.length) examined.push(`${f} [${keys.join(", ")}]`)
  else if (mentions) unreadable.push(f)
  else silent.push(f)
}

console.log(`analyzers scanned: ${files.length}`)
console.log(`examined as a contract binding: ${examined.length}`)
console.log(`mentions the contract but publishes nothing readable: ${unreadable.length}`)
for (const f of unreadable) console.log(`   UNREADABLE ${f}`)
console.log(`no framework surface at all (not applicable): ${silent.length}`)
console.log(`   ${silent.join(" ")}`)
console.log(examined.join("\n"))
