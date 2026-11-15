import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "ecto_sql"
const DEF = new Set(["def","defp","defmacro","defmacrop","defdelegate","defguard","defguardp"])
function walk(d: string, out: string[] = []): string[] { let e: fs.Dirent[]; try { e = fs.readdirSync(d, {withFileTypes:true}) } catch { return out }
  for (const x of e) { if ([".git","_build","deps","node_modules"].includes(x.name)) continue; const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out); else if (x.name.endsWith(".ex")||x.name.endsWith(".exs")) out.push(p) } return out }
async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const p = new P(); p.setLanguage(g)
  for (const f of walk(path.join(CORPUS_ROOT, REPO))) {
    const text = fs.readFileSync(f, "utf8")
    let res: any; try { res = await ASTEngine.parseFile(f, text) } catch { continue }
    const syms = res.symbols ?? []
    const tree = p.parse(text)
    const stack: any[] = [tree.rootNode]; const out: any[] = []
    while (stack.length) { const n = stack.pop()
      if (n.type === "call") { let id: any = null
        for (let i=0;i<n.childCount;i++){const c=n.child(i); if(c&&c.type==="identifier"){id=c;break}}
        if (id && DEF.has(id.text)) {
          let sig: any = null
          for (let i=0;i<n.childCount;i++){const c=n.child(i); if(c&&c.type!=="identifier"&&c.type!=="do_block"){sig=c;break}}
          if (sig) { if (sig.type==="arguments"&&sig.namedChildCount>0) sig = sig.namedChild(0)
            if (sig && sig.type==="binary_operator" && sig.child(1)?.text==="when") sig = sig.child(0)
            if (sig && sig.type==="call") { let nm:any=null; for(let i=0;i<sig.childCount;i++){const c=sig.child(i); if(c&&c.type==="identifier"){nm=c;break}}
              let ar=0; for(let i=0;i<sig.childCount;i++){const c=sig.child(i); if(c&&c.type==="arguments") ar=c.namedChildCount}
              if (nm) out.push({n:nm.text, ar, line:n.startPosition.row+1, text:n.text.slice(0,80)}) }
            else if (sig && sig.type==="identifier") out.push({n:sig.text, ar:0, line:n.startPosition.row+1, text:n.text.slice(0,80)}) } } }
      for (let i=n.namedChildCount-1;i>=0;i--){const c=n.namedChild(i); if(c) stack.push(c)} }
    const groups = new Map<string, any[]>()
    for (const c of out) { const k = `${c.n}/${c.ar}`; if(!groups.has(k)) groups.set(k,[]); groups.get(k)!.push(c) }
    for (const [k, cs] of groups) { if (cs.length < 2) continue
      const [nm, ar] = k.split("/")
      const cand = syms.filter((s: any) => s.name === nm && (s.metadata?.arity === Number(ar)))
      if (cand.length === 0) {
        const anyName = syms.filter((s: any) => s.name === nm)
        console.log(`MISSING ${path.relative(CORPUS_ROOT, f)} ${k} clauses=${cs.length} anySymbolWithName=${anyName.length}`)
        for (const c of cs.slice(0,3)) console.log(`    line ${c.line}: ${JSON.stringify(c.text)}`)
        if (anyName.length) console.log(`    symbols named ${nm}: ${JSON.stringify(anyName.map((s:any)=>({kind:s.kind, ar:s.metadata?.arity, owner:s.ownerName, vis:s.visibility, line:s.range.startLine})))}`)
      } }
  }
}
main().catch(e=>{console.error(e);process.exit(1)})
