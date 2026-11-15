// #981's PHANTOM class: a typedef name and a struct tag in the same file, which
// C keeps in SEPARATE namespaces. `contains h1_tunnel_state -> H1_TUNNEL_INIT`
// is true of the typedef alias and false of the struct that shares the name, so
// a consumer resolving that name as a container gets a struct with six phantom
// members.
//
// Measured: how many files carry such a collision, and what the payload
// publishes for each name.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const analyzer = new RealCAnalyzer()
const CORPUS = "/home/sano/ishaq/bb_tests/repositories"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const LIMIT = Number(arg("max-files", "1200"))

function collectC(dir: string, out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let es: fs.Dirent[] = []
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (out.length >= cap) return out
    if (e.name === ".git" || e.name === "node_modules") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectC(full, out, cap)
    else if (e.name.endsWith(".c") || e.name.endsWith(".h")) out.push(full)
  }
  return out
}
const files: string[] = []
for (const repo of ["curl", "libgit2", "redis", "zig"]) collectC(path.join(CORPUS, repo), files, LIMIT)
files.sort()

/** struct/union TAGS, and typedef'd specifier ALIASES, as C's two namespaces have them. */
function namespaces(root: any): { tags: Set<string>; aliases: Set<string> } {
  const tags = new Set<string>()
  const aliases = new Set<string>()
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (!n) continue
    if (n.type === "type_definition") {
      // `typedef <specifier> NAME;`. The ALIAS is in the DECLARATOR, not the `name`
      // field -- `typedef enum { ... } h1_tunnel_state;` has no name field at all, and
      // a first version of this probe read that field, found nothing, and reported 0
      // collisions on the very file that defines the class.
      const inner = n.namedChild(0)
      const specifier = inner && ["struct_specifier", "union_specifier", "enum_specifier"].includes(inner.type) ? inner : null
      const declarator = specifier ? inner.namedChild(specifier.namedChildCount - 1) : n.childForFieldName("declarator")
      const alias = declarator && (declarator.type === "type_identifier" || declarator.type === "identifier") ? declarator.text : null
      if (alias) aliases.add(alias)
      if (specifier?.childForFieldName("name")) tags.add(specifier.childForFieldName("name").text)
    } else if (n.type === "struct_specifier" || n.type === "union_specifier" || n.type === "enum_specifier") {
      const nm = n.childForFieldName("name")
      if (nm) tags.add(nm.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
  return { tags, aliases }
}

let filesParsed = 0
let collisions = 0
let ambiguousEdges = 0
const rows: string[] = []

for (const file of files) {
  let src: string
  try { src = fs.readFileSync(file, "utf8") } catch { continue }
  if (src.length > 400_000) continue
  let root: any
  try { root = parser.parse(src).rootNode } catch { continue }
  filesParsed++
  let result: any
  try { result = analyzer.analyze(root, src, file) } catch { continue }
  const { tags, aliases } = namespaces(root)
  const shared = [...aliases].filter((a) => tags.has(a))
  if (shared.length === 0) continue
  collisions++
  // what does the payload publish for a shared name?
  for (const name of shared) {
    const syms = (result.symbols ?? []).filter((s: any) => String(s.name) === name)
    const kinds = [...new Set(syms.map((s: any) => String(s.kind)))]
    const rels = (result.relationships ?? []).filter((r: any) => String(r.source) === name && String(r.type) === "contains")
    ambiguousEdges += rels.length
    if (rows.length < 30) {
      rows.push(`${path.relative(CORPUS, file)}  \`${name}\`  symbols=[${syms.map((s: any) => `${s.kind}@${s.range?.startLine}`).join(" ")}]  contains-edges=${rels.length}  targets=[${rels.slice(0, 4).map((r: any) => r.target).join(",")}]`)
    }
  }
}
console.log(`files parsed ${filesParsed} of ${files.length}`)
console.log(`files where a TYPEDEF ALIAS and a STRUCT/UNION/ENUM TAG share a name (legal C, separate namespaces): ${collisions}`)
console.log(`\`contains\` edges whose SOURCE is such a shared name, i.e. an AMBIGUOUS OWNER: ${ambiguousEdges}`)
for (const r of rows) console.log("  " + r)
