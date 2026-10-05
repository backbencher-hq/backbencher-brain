import { readFileSync } from "node:fs"
import * as path from "node:path"
import { admittedFiles } from "./validation/m14/fixtures/json/admitted-files"
const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))
const p = new Parser()
const lang = await Language.load(wasm)
p.setLanguage(lang)
const walk = admittedFiles("$HOME/fixtures/repositories")
const VALUE_TYPES = new Set(["object","array","string","number","true","false","null"])
function countValues(root:any){let n=0;for(let i=0;i<root.namedChildCount;i++){const c=root.namedChild(i);if(c&&VALUE_TYPES.has(c.type))n++}return n}
let ok=0,bad=0;const badEx:string[]=[]
for (const f of walk.files){
  let tree:any
  try{ tree=p.parse(readFileSync(f.abs,"utf8")) }catch(e:any){ bad++; if(badEx.length<5)badEx.push(`${f.abs} :: ${String(e?.message??e).slice(0,100)}`); continue }
  try{ countValues(tree.rootNode); ok++ }catch(e:any){ bad++; if(badEx.length<5)badEx.push(`${f.abs} :: post ${String(e?.message??e).slice(0,100)}`) }
  tree.delete?.()
}
console.log("ok",ok,"bad",bad); console.log(badEx.join("\n"))
