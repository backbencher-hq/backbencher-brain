// #916 mirror diagnostics: does deriveCCalls see a `uses -> sqlite3SharedCacheList`
// truth edge for btree.c, and if not, which gate blocks it?
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { deriveCCalls } = await import(path.join(ROOT, "script/m14/differential.ts"))

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))

const FILES = [
  ["/home/ishaq2321/bb_tests/repositories/sqlite/src/btree.c", "sqlite3SharedCacheList"],
  ["/home/ishaq2321/bb_tests/repositories/sqlite/src/notify.c", "sqlite3BlockedList"],
]
for (const [file, target] of FILES) {
  const src = readFileSync(file, "utf8")
  const parser = new P()
  parser.setLanguage(lang)
  const root = parser.parse(src).rootNode
  const edges: any[] = deriveCCalls(root, src)
  const hits = edges.filter((e) => e.target === target)
  console.log(`\n=== ${file.split("/").pop()} :: target ${target}`)
  console.log(`  deriveCCalls edges=${edges.length} touching=${hits.length}`)
  for (const h of hits.slice(0, 6)) console.log(`    ${h.label} ${h.from} -> ${h.target}`)

  // The truncated declaration + its sibling, as the mirror helper reads them.
  const found: any[] = []
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "declaration") {
      let missing = false
      for (let i = 0; i < n.childCount; i++) if (n.child(i)?.isMissing) missing = true
      if (missing) found.push(n)
    }
    for (let k = 0; k < n.namedChildCount; k++) st.push(n.namedChild(k))
  }
  console.log(`  truncated declarations: ${found.length}`)
  for (const n of found.slice(0, 6)) {
    const kids = n.namedChildren.filter((k: any) => !!k)
    const last = kids[kids.length - 1]
    const next = n.nextSibling
    let anc: any = n
    let inErr = false
    while (anc) {
      if (anc.type === "ERROR") inErr = true
      anc = anc.parent
    }
    console.log(`    decl@L${n.startPosition.row + 1} text="${n.text.replace(/\n/g, " ").slice(0, 60)}"`)
    console.log(`      lastNamed=${last?.type}:"${last?.text}" next=${next?.type}:"${(next?.text ?? "").replace(/\n/g, " ").slice(0, 40)}" inERROR=${inErr}`)
    // Replicate the mirror helper inline to see what it decides.
    let cur: any = last
    let guard = 0
    while (cur && !["identifier", "field_identifier", "type_identifier"].includes(cur.type) && guard++ < 32) {
      const byField = typeof cur.childForFieldName === "function" ? cur.childForFieldName("declarator") : null
      if (byField) {
        cur = byField
        continue
      }
      const cs = (cur.namedChildren ?? []).filter((k: any) => !!k)
      const clean = cs.find((k: any) => !k.isError && !k.isMissing)
      cur = clean ?? cs[0] ?? null
    }
    console.log(`      descent -> ${cur?.type}:"${cur?.text}"`)
    const nm = (next?.text ?? "").trim()
    let name = ""
    for (const ch of nm) {
      if (/[A-Za-z0-9_$]/.test(ch)) name += ch
      else break
    }
    const after = nm.slice(name.length).trimStart()
    console.log(`      recoveredName=${name} after="${after.slice(0, 3)}" match=${!!name && (after.startsWith("=") || after.startsWith("("))}`)
  }

  // Every occurrence of the target identifier, with the parent the use-walker sees.
  const occ: any[] = []
  const st2: any[] = [root]
  while (st2.length) {
    const n = st2.pop()
    if ((n.type === "identifier" || n.type === "type_identifier") && n.text === target) occ.push(n)
    for (let k = 0; k < n.namedChildCount; k++) st2.push(n.namedChild(k))
  }
  console.log(`  identifier occurrences of "${target}": ${occ.length}`)
  for (const n of occ.slice(0, 8)) {
    let top = n
    let errAnc = false
    while (top.parent) {
      top = top.parent
      if (top.type === "ERROR") errAnc = true
    }
    const p = n.parent
    console.log(`    L${n.startPosition.row + 1} parent=${p?.type} topAncestor=${top?.type} errAncestor=${errAnc}`)
  }
}
