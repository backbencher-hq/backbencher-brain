import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const errsOf = (s: string) => { const t = parser.parse(s); let n = 0; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return n }
const cases: Array<[string, string]> = [
  ["G1 @Query template", 'import org.grails.datastore.mapping.query.api.Queryable\n@Query("delete from ${Product p} where 1=1")\ndef x = 1'],
  ["G2 SELECT $p FROM", "class C { static void main(String[] a) { def p = 1; def name = 'x'; println \"SELECT $p FROM ${Product p} JOIN ${Attribute attr = p.attributes} WHERE ${attr.name} = $name\" } }"],
  ["G3 triple @Cypher", 'class C { static void main(String[] a) { println """MATCH ${Person p}""" } }'],
  ["G4 command in interp", "class C { static foo(a) { a }; static void main(String[] a) { def p = 'P'; println \"x ${C.foo p} y\" } }"],
  ["G5 assignment interp", "class C { static void main(String[] a) { def p = 1; def q = 0; println \"${q = p}\" } }"],
  ["G6 plain interp", "class C { static void main(String[] a) { def x = 1; println \"v=${x}\" } }"],
  ["G7 interpol id", "class C { static void main(String[] a) { def x = 1; println \"a=$x.b\" } }"],
  ["C1 spaced chain", "class C { def m(p) { p = p.then { it * 2 } then { it + 6 } } }"],
  ["C2 subscript assign", "class C { def m(p, v) { p.properties['a', 'b'] = v } }"],
  ["K1 int('x') non-gap", "class C { def m() { def t = int('x') } }"],
  ["K2 attrs.int", "class C { def m(attrs) { def t = attrs.int('total') } }"],
  ["K3 A2 decl-RHS", "class C { def m(e) { def x = e.evaluateMappings mappings } }"],
  ["K4 return foo bar", "class C { def m() { def foo; def bar; return foo bar } }"],
]
for (const [n, s] of cases) console.log(`  ${n.padEnd(22)} errs=${errsOf(s)}`)
