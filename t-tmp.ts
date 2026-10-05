import { readFileSync } from "node:fs"
import { ASTEngine } from "./src/ast/engine"
const f = process.argv[2]; const needle = process.argv[3]
const c = readFileSync(f, "utf8")
const { tree } = await ASTEngine.parseTree(f, c)
const out: string[] = []
const walk = (n: any, d: number) => {
  if (d > 6) return
  out.push(`${"  ".repeat(d)}${n.type} <${n.startPosition.row+1}:${n.startPosition.column}>-${n.endPosition.row+1}:${n.endPosition.column}> ${JSON.stringify(n.text.length>90?n.text.slice(0,90).replace(/\n/g,"\\n")+"…":n.text.replace(/\n/g,"\\n"))}`)
  for (let i=0;i<n.childCount;i++){ const ch=n.child(i); if(ch) walk(ch,d+1) }
}
const visit=(n:any)=>{ if(n.text.includes(needle)&&n.text.length<300){ walk(n,0); return true } for(let i=0;i<n.childCount;i++){const ch=n.child(i); if(ch&&visit(ch))return true} return false }
if(!visit(tree.rootNode)) { console.log("no hit; printing top level"); walk(tree.rootNode,0) }
console.log(out.slice(0,120).join("\n"))
