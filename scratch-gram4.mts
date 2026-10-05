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
function features(root: any): { keys: Set<string>; refs: number } {
  const keys = new Set<string>(); let refs = 0
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i); if (!c) continue
      stack.push(c)
      if (c.type === "pair") {
        const k = c.childForFieldName?.("key")
        const sc = k?.namedChildren?.find((x: any) => x.type === "string_content")
        if (sc) keys.add(String(sc.text ?? ""))
        const v = c.childForFieldName?.("value")
        if (v?.type === "string") { const t = v.text ?? ""; if (t.startsWith("#")) refs++ }
      }
    }
  }
  return { keys, refs }
}
let ok=0,bad=0;const badEx:string[]=[]
for (const f of walk.files){
  let tree:any
  try{ tree=p.parse(readFileSync(f.abs,"utf8")) }catch(e:any){ bad++; if(badEx.length<5)badEx.push(`${f.abs} :: PARSE ${String(e?.message??e).slice(0,100)}`); continue }
  let vals=0
  for(let i=0;i<tree.rootNode.namedChildCount;i++){const c=tree.rootNode.namedChild(i);if(c&&VALUE_TYPES.has(c.type))vals++}
  if(vals>1){ try{ features(tree.rootNode) }catch(e:any){ bad++; if(badEx.length<5)badEx.push(`${f.abs} :: WALK ${String(e?.message??e).slice(0,100)}`); tree.delete?.(); continue } }
  ok++
  tree.delete?.()
}
console.log("ok",ok,"bad",bad); console.log(badEx.join("\n"))
