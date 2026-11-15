// ER3 wave — probe #4: the OTP-28-era node types the 450-file census missed
// (nominal / deprecated_* / feature_attribute / replacement_cr_clauses /
// multi_string), each dumped from a REAL corpus site with its source line, so
// no node type in the full inventory is left without a measured shape.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"
const WANT = new Set((process.env.WANT ?? "nominal,deprecated_attribute,feature_attribute,replacement_cr_clauses,multi_string,deprecation_desc,deprecated_fa,deprecated_fas,deprecated_wildcard").split(","))

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))

  const dump = (n: any, d: number, md: number, p = "") => {
    const t = n.text.length > 50 ? n.text.slice(0, 50).replace(/\n/g, "\\n") + "…" : n.text.replace(/\n/g, "\\n")
    console.log(`${p}${n.type}${n.isNamed ? "" : " (anon)"} [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${t}`)
    if (d >= md) return
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, d + 1, md, p + "  ") }
  }

  const files: string[] = []
  for (const d of ["otp", "rebar3", "cowboy"]) {
    const base = path.join(REPO_ROOT, d)
    if (!fs.existsSync(base)) continue
    const st = [base]
    while (st.length > 0) {
      const cur = st.pop()!
      let es: fs.Dirent[]
      try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of es) {
        if (e.name === ".git") continue
        const p = path.join(cur, e.name)
        if (e.isDirectory()) st.push(p)
        else if (e.name.endsWith(".erl")) files.push(p)
      }
    }
  }
  files.sort()
  const counts = new Map<string, number>()
  const shown = new Set<string>()
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let t: any
    try { t = parser.parse(content) } catch { continue }
    if (!t) continue
    const st: any[] = [t.rootNode]
    while (st.length > 0) {
      const n = st.pop()!
      if (WANT.has(n.type)) {
        counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
        if (!shown.has(n.type)) {
          shown.add(n.type)
          console.log(`\n--- ${n.type} :: ${path.basename(f)}:${n.startPosition.row + 1}`)
          dump(n, 0, 4, "  ")
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) st.push(c) }
    }
  }
  console.log("\ncounts over the FULL corpus:", JSON.stringify(Object.fromEntries(counts), null, 1))
}
main().catch(e => { console.error(String(e)); process.exit(1) })
