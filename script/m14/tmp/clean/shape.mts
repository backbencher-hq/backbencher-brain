import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const types: string[] = (grammar as any).types ?? []
const fields: string[] = (grammar as any).fields ?? []
console.log("declared node types:", types.length, " fields:", fields.length)
const KW = ["class","instance","where","with","derive","deriving","import","definition","implementation","infix","special","generic","if","case","let","export","qualified","as","from","module","of","export","::","|"]
const present = KW.filter((k) => types.includes(k))
console.log("keywords present in declared types:", present.length + "/" + KW.length, JSON.stringify(present))
console.log("missing:", JSON.stringify(KW.filter((k)=>!types.includes(k))))
const INH = ["extends","extend","implements","inherit","inheritance","superclass","super","base_class","parent_class","override","overrides","mixin","interface_declaration","trait","subclass","sub_type","class_declaration","class_context","class_member","class_name","derive_declaration"]
console.log("of the probed vocab, IN declared types:", JSON.stringify(INH.filter((k)=>types.includes(k))))
console.log("declared FIELDS:", JSON.stringify([...fields].sort()))
console.log("types containing 'class':", JSON.stringify(types.filter(t=>/class/i.test(t))))
console.log("types containing 'inst':", JSON.stringify(types.filter(t=>/inst/i.test(t))))
