// script/m14/tmp/oc-framework-dump.ts — what does the repaired objective-c analyzer
// actually emit for the CONV-OC-1 fixture? An expectation is written from a MEASUREMENT,
// never from what the fix intended.
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FILE = path.join(ROOT, "validation/m14/fixtures/objc/framework-surface-pins.m")

const wts: any = WTS
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
const parser = new P()
parser.setLanguage(language)

const mod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer.ts"))
const analyzer = new mod.RealObjectiveCAnalyzer()
const src = readFileSync(FILE, "utf8")
const result = analyzer.analyze(parser.parse(src).rootNode, src, FILE)

console.log("detectedFrameworks:", JSON.stringify(result.metadata.detectedFrameworks))
console.log("framework:", JSON.stringify(result.metadata.framework))
console.log("frameworkPatterns:", JSON.stringify(result.metadata.frameworkPatterns))
console.log("imports:", JSON.stringify(result.imports.map((i: any) => i.module)))
console.log("symbols:", JSON.stringify(result.symbols.map((s: any) => `${s.name}:${s.kind}`)))
