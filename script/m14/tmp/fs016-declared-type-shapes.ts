// FS016 — the R9 DECLARED-TYPE positions for F#, measured: which node shapes carry a
// WRITTEN type name, where the name is written, and which of them the analyzer can
// currently reach. This is the census that turns "fsharp has no declared-type graph"
// from a census verdict into a per-position map.
//
// R9 is a FAMILY standard: a declaration's written type is a dependency, published as a
// `references` edge marked `metadata.relationshipType === "declared_type"`. Thirteen
// lanes implement it; fsharp emits ZERO, and it is measured ABSENT with the control
// present by script/m60/declared-type-refs-census.ts.
//
// WHAT IT MEASURES, per type-bearing node in real F# files
//   nodeType      the grammar node
//   count / files
//   parents       where it occurs
//   nameSource    the FIELD or child the type name is actually written on, and the
//                 example — because a declared-type edge must carry the line of the
//                 NAME (M59.A7), not of the construct.
//   semantic      which R9 position this is: a parameter, a return type, a field /
//                 let-binding annotation, a record field type, a base type, an
//                 interface implementation, a member property, a union payload,
//                 a type-abbreviation RHS.
//
// Run: bun script/m14/tmp/fs016-declared-type-shapes.ts --all --limit 400
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "400")
const EXT = (argOf("--ext") ?? "fs,fsi,fsx").split(",")
const REPOS = process.argv.includes("--all")
  ? fs.readdirSync(CORPUS_ROOT).filter((d) => { try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false } })
  : [argOf("--repo") ?? "fsharp"]

// The grammar node that HOLDS a written type in F#. These are the wrappers a type can
// wear; the NAME is always a long_identifier/identifier inside one of them.
const TYPE_NODES = ["simple_type", "postfix_type", "paren_type", "generic_type", "function_type", "compound_type", "list_type", "atomic_type", "nullable_type", "struct_type", "static_type", "byref_type", "flexible_type", "types"]

function walk(dir: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj") continue
    const p = path.join(dir, n)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1).toLowerCase())) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

  // The chain from a type-wrapper node to the node the NAME is written on: unwrap
  // wrappers until the first long_identifier/identifier/type_name. This is the R9
  // "which node bears the name" question, answered from the tree.
  const nameNodeOf = (t: Node): Node | null => {
    let cur: Node | null = t
    let guard = 0
    while (cur && guard++ < 8) {
      if (cur.type === "long_identifier") {
        // long_identifier -> identifier (the leaf), or a long_identifier ending in
        // `X<T>` shape where the LAST identifier is the name.
        let leaf: Node | null = null
        for (let i = 0; i < cur.namedChildCount; i++) { const c = cur.namedChild(i); if (c && (c.type === "identifier" || c.type === "long_identifier")) leaf = c }
        return leaf ?? cur
      }
      if (cur.type === "identifier" || cur.type === "type_name") return cur
      if (cur.type === "type_argument") { const c = cur.namedChild(0); if (c) { cur = c; continue } return cur }
      let next: Node | null = null
      for (let i = 0; i < cur.namedChildCount; i++) {
        const c = cur.namedChild(i)
        if (!c) continue
        if (TYPE_NODES.includes(c.type) || c.type === "type_argument" || c.type === "type_arguments" || c.type === "union_type_field" || c.type === "type_argument_defn") { next = c; break }
        if (c.type === "argument_type") { next = c; break }
      }
      if (!next) return null
      cur = next
    }
    return cur && (cur.type === "long_identifier" || cur.type === "identifier") ? cur : null
  }

  const shapes = new Map<string, { count: number; files: Set<string>; parents: Map<string, number>; nameNode: Map<string, number>; ex: any }>()
  let files = 0
  for (const repo of REPOS) {
    for (const file of walk(path.join(CORPUS_ROOT, repo), EXT, [], LIMIT)) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++
      const rel = path.relative(CORPUS_ROOT, file)
      let tree: any
      try { tree = parser.parse(src) } catch { continue }
      const st: any[] = [tree.rootNode]
      while (st.length) {
        const n = st.pop()
        if (TYPE_NODES.includes(n.type)) {
          // only the OUTERMOST wrapper of a written type, so a postfix_type inside a
          // list_type is not counted twice
          const parent = n.parent
          const nestedInType = parent != null && TYPE_NODES.includes(parent.type)
          if (!nestedInType) {
            const nn = nameNodeOf(n)
            const key = `${n.type}  ->  name on ${nn ? nn.type : "NONE"}`
            let s = shapes.get(key)
            if (!s) { s = { count: 0, files: new Set(), parents: new Map(), nameNode: new Map(), ex: null }; shapes.set(key, s) }
            s.count++
            s.files.add(rel)
            const pk = n.parent?.type ?? "(root)"
            s.parents.set(pk, (s.parents.get(pk) ?? 0) + 1)
            s.nameNode.set(nn ? nn.type : "NONE", (s.nameNode.get(nn ? nn.type : "NONE") ?? 0) + 1)
            if (!s.ex) s.ex = { file: rel, line: (nn ?? n).startPosition.row + 1, text: (nn ?? n).text.slice(0, 40), typeText: n.text.slice(0, 40) }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
      tree.delete()
    }
  }

  const rows = [...shapes.entries()].map(([k, s]) => ({
    key: k, count: s.count, files: s.files.size,
    topParents: [...s.parents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a2, b2]) => `${a2}:${b2}`).join(" "),
    nameNodeTypes: [...s.nameNode.entries()].sort((a, b) => b[1] - a[1]).map(([a2, b2]) => `${a2}:${b2}`).join(" "),
    ex: s.ex,
  })).sort((a, b) => b.count - a.count)

  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify({ at: new Date().toISOString(), repos: REPOS, limit: LIMIT, files, rows }, null, 1)) }
  console.log(`FS016 — R9 declared-type positions for F#, over ${files} files\n`)
  console.log(`  ${"count".padStart(7)} ${"files".padStart(5)}  type node -> name-bearing node`)
  for (const r of rows) {
    console.log(`  ${String(r.count).padStart(7)} ${String(r.files).padStart(5)}  ${r.key}`)
    console.log(`          parents: ${r.topParents}`)
    console.log(`          name nodes: ${r.nameNodeTypes}`)
    console.log(`          eg ${r.ex.file}:${r.ex.line}  type=${JSON.stringify(r.ex.typeText)} name=${JSON.stringify(r.ex.text)}`)
  }
  const unreachable = rows.filter((r) => r.nameNodeTypes.includes("NONE:"))
  console.log(`\nshapes where NO name node could be found: ${unreachable.length}`)
  for (const u of unreachable) console.log(`   ${u.count}  ${u.key}   eg ${JSON.stringify(u.ex?.typeText)}`)
}
void main()
