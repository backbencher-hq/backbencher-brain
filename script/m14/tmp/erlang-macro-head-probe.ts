// ER3 — the macro-headed function clause class. A clause head that is a MACRO
// use (`?NAME(X) -> …`) is a real function definition whose NAME only exists
// after the preprocessor expands the macro. This probe reads every corpus site
// and, when the macro is defined in the SAME file, prints the macro's own
// replacement text — which is what a sound derivation would have to resolve.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
  const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }
  const cb = (n: any, t: string) => kids(n).find((c: any) => c.type === t)

  const files: string[] = []
  for (const d of ["otp", "rebar3", "cowboy"]) {
    const base = path.join(REPO_ROOT, d)
    if (!fs.existsSync(base)) continue
    const st = [base]
    while (st.length > 0) {
      const cur = st.pop()!
      let es: fs.Dirent[]
      try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of es) { if (e.name === ".git") continue; const p = path.join(cur, e.name); if (e.isDirectory()) st.push(p); else if (e.name.endsWith(".erl")) files.push(p) }
    }
  }
  files.sort()
  let sites = 0
  let local = 0
  let derivable = 0
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let t: any
    try { t = parser.parse(content) } catch { continue }
    if (!t) continue
    // in-file macro definitions
    const defs = new Map<string, string>()
    for (const top of kids(t.rootNode)) {
      if (top.type !== "pp_define") continue
      const lhs = cb(top, "macro_lhs")
      const v = lhs ? cb(lhs, "var") : undefined
      if (!v?.text) continue
      // the replacement: every named child of pp_define that is not the lhs
      const parts: string[] = []
      for (let i = 0; i < top.namedChildCount; i++) {
        const c = top.namedChild(i)
        if (!c || c === lhs) continue
        parts.push(c.text)
      }
      defs.set(v.text, parts.join(" ").replace(/\s+/g, " ").trim())
    }
    for (const fd of kids(t.rootNode)) {
      if (fd.type !== "fun_decl") continue
      for (const cl of kids(fd)) {
        if (cl.type !== "function_clause") continue
        const mac = cb(cl, "macro_call_expr")
        if (!mac) continue
        sites++
        const mName = (cb(mac, "var") || cb(mac, "atom"))?.text ?? "?"
        const headText = cl.text.split("\n")[0].slice(0, 90)
        const d = defs.get(mName)
        if (d !== undefined) {
          local++
          // A sound derivation needs the replacement to be a single atom-headed
          // application: that atom IS the real function name.
          const isAtomHead = d.length > 0 && /^[a-z_][A-Za-z0-9_@]*\s*\(/.test(d)
          if (isAtomHead) derivable++
          console.log(`${path.relative(REPO_ROOT, f)}:${cl.startPosition.row + 1}  ?${mName}  head="${headText}"  localDefine=${d.length ? `"${d.slice(0, 70)}"` : "NONE"} atomHead=${isAtomHead}`)
        } else {
          console.log(`${path.relative(REPO_ROOT, f)}:${cl.startPosition.row + 1}  ?${mName}  head="${headText}"  localDefine=NONE (external/include)`)
        }
      }
    }
  }
  console.log(`\nsites=${sites} locallyDefined=${local} atomHeadedReplacement=${derivable}`)
}
main().catch(e => { console.error(String(e)); process.exit(1) })
