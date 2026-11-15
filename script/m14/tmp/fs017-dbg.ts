import * as fs from "fs"; import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const src = `type Dep = class end
type Other = class end
type R = { F : Dep; G : int }
type Holder() =
    let mutable f : Dep = null
    member this.M(x : Dep, y : Other) : Dep = f
`
const tree = parser.parse(src)
const findDesc = (n: any, p: (x:any)=>boolean, d=5): any => {
  if (d<=0) return undefined
  for (let i=0;i<n.namedChildCount;i++){const c=n.namedChild(i); if(c){ if(p(c))return c; const f=findDesc(c,p,d-1); if(f)return f }}
  return undefined
}
const st: any[] = [tree.rootNode]
while (st.length) {
  const n = st.pop()
  if (n.type === "simple_type") {
    const li = findDesc(n, (c:any)=>c.type==="long_identifier", 3)
    const id  = li ? findDesc(li, (c:any)=>c.type==="identifier", 3) : findDesc(n,(c:any)=>c.type==="identifier",2)
    console.log(`simple_type ${JSON.stringify(n.text)}  parent=${n.parent?.type}  li=${li?JSON.stringify(li.text):"none"}  id=${id?JSON.stringify(id.text):"none"}`)
  }
  for (let i=0;i<n.namedChildCount;i++){const c=n.namedChild(i); if(c) st.push(c)}
}
