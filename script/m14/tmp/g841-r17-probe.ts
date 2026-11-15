// Round 17 battery: family A (command-call values, RHS-restricted admission).
// Usage: bun g841-r17-probe.ts <wasm-path>
import fs from "node:fs"
const WASM = process.argv[2]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(WASM))
const parser = new P()
parser.setLanguage(lang)
const errsOf = (src: string) => { const t = parser.parse(src); let n = 0; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return n }
const body = (l: string) => `class C {\n    void m() {\n        ${l}\n    }\n}\n`
const kinds = (src: string) => { const t = parser.parse(src); const out: string[] = []; const w = (x: any) => { if (["juxt_function_call", "method_invocation", "closure", "array_initializer", "ERROR", "field_declaration", "method_declaration", "constructor_declaration", "field_access"].includes(x.type)) out.push(`${x.type}@${x.startPosition.row + 1}`); for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return out.join(" ") }
const juxtArgs = (src: string) => { const t = parser.parse(src); let n = -1; const w = (x: any) => { if (x.type === "juxt_function_call") { const a = x.childForFieldName("args"); n = a ? a.namedChildCount : -1 } for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return n }

console.log(`WASM=${WASM} md5=${await Bun.CryptoHasher && (await import("node:crypto")).createHash("md5").update(fs.readFileSync(WASM)).digest("hex")}`)
console.log("--- family A: must be clean (0 errors) ---")
console.log(`  A1 decl-RHS dotted   errs=${errsOf(body("def allMappings = evaluator.evaluateMappings mappings"))}  ${kinds(body("def allMappings = evaluator.evaluateMappings mappings"))}`)
console.log(`  A2 decl-RHS bare     errs=${errsOf(body("def x = foo bar"))}  ${kinds(body("def x = foo bar"))}`)
console.log(`  A3 assign-RHS dotted errs=${errsOf(body("generator.urlMappingsHolder = getUrlMappingsHolder mappings"))}  ${kinds(body("generator.urlMappingsHolder = getUrlMappingsHolder mappings"))}`)
console.log(`  A4 field-decl-RHS    errs=${errsOf("class C {\n    def x = foo bar\n    def foo\n    def bar\n}\n")}  ${kinds("class C {\n    def x = foo bar\n    def foo\n    def bar\n}\n")}`)
console.log("--- refuted supersets: must still have errors ---")
console.log(`  R1 return foo bar    errs=${errsOf(body("return foo bar"))}  (must be >0)`)
console.log(`  R2 nested expr foo bar errs=${errsOf(body("def y = 1 + (foo bar)"))}  (must be >0)`)
console.log("--- structural: closure vs array, comma binding ---")
console.log(`  C1 def x = { foo bar } errs=${errsOf(body("def x = { foo bar }"))}  ${kinds(body("def x = { foo bar }"))}`)
console.log(`  C2 comma: def x = f bar, baz  errs=${errsOf(body("def x = f bar, baz"))} juxtArgs=${juxtArgs(body("def x = f bar, baz"))}  ${kinds(body("def x = f bar, baz"))}`)
console.log(`  C3 assert-colon shape errs=${errsOf(body("assert x = f y: 'msg'"))}  (record only)`)
console.log("--- round-16 tie-breakers: must hold ---")
console.log(`  D1 int('x') non-gap  errs=${errsOf(body("def t = int('x')"))}  (must be >0)`)
console.log(`  D2 B attrs.int       errs=${errsOf(body("def t = attrs.int('total')"))}  (must be 0)`)
const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/FormTagLib.groovy"
const srcF = fs.readFileSync(F, "utf8")
console.log(`  D3 FormTagLib        errs=${errsOf(srcF)}  line503=${kinds(srcF.split("\n").slice(490, 515).join("\n") === srcF ? srcF : srcF)}`)
