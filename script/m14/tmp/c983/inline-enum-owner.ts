// #986 candidate: an INLINE enum used as a member's type is owner-qualified to
// the CONTAINER, where the identical inline STRUCT case composes the member path.
//
//   typedef union {          typedef union {
//     enum { A_ONE } first;     struct { int x; } pt;
//   } U;                      } U2;
//
//   analyzer: U.A_ONE        analyzer: U2.pt.x
//            ^^^^^^^^^                  ^^^^^^^ correct, #950/#958
//
// #961 added `if (scope && scope !== "global" && enumName === "anonymous_enum")
// enumName = scope` for a FUNCTION-LOCAL enum. An inline enum member is not
// function-local, but it is also anonymous, so it takes the same branch and
// collapses onto the container name -- losing the member that carries it.
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
const LIMIT = Number(arg("max-files", "4000"))

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

let filesParsed = 0
let collapsed = 0
let collapsedEdges = 0
const rows: string[] = []
const nameTally = new Map<string, number>()

for (const file of files) {
  let src: string
  try { src = fs.readFileSync(file, "utf8") } catch { continue }
  if (src.length > 400_000) continue
  let root: any
  try { root = parser.parse(src).rootNode } catch { continue }
  filesParsed++
  let result: any
  try { result = analyzer.analyze(root, src, file) } catch { continue }

  // Ground truth from the PARSE: an enum_specifier that is a member's type, inside a
  // named struct/union. Its owner path must be `<container>.<member>`.
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (!n) continue
    if (n.type === "enum_specifier" && !n.childForFieldName("name")) {
      const fieldDecl = n.parent
      if (fieldDecl?.type === "field_declaration") {
        const decl = fieldDecl.childForFieldName("declarator")
        const memberName = decl && (decl.type === "identifier" || decl.type === "field_identifier") ? decl.text : null
        const body = fieldDecl.parent
        const ownerSpec = body?.parent
        if (memberName && ownerSpec && (ownerSpec.type === "struct_specifier" || ownerSpec.type === "union_specifier")) {
          const ownerTag = ownerSpec.childForFieldName("name")?.text
          // a typedef'd anonymous container: the alias names it
          let container = ownerTag ?? null
          if (!container && ownerSpec.parent?.type === "type_definition") {
            const d = ownerSpec.parent.childForFieldName("declarator")
            if (d && (d.type === "type_identifier" || d.type === "identifier")) container = d.text
          }
          if (container) {
            const published = (result.symbols ?? []).filter((s: any) => String(s.kind) === "enum" && String(s.name) === container)
            if (published.length > 0) {
              collapsed++
              nameTally.set(`${path.relative(CORPUS, file)}  ${container}.${memberName}`, 1)
              const rels = (result.relationships ?? []).filter((r: any) => String(r.type) === "contains" && String(r.source) === container)
              collapsedEdges += rels.length
              if (rows.length < 25) {
                rows.push(
                  `${path.relative(CORPUS, file)}  inline enum \`enum { ... } ${memberName};\` inside \`${container}\`  ->  published as \`${container}.<member>\` (expected \`${container}.${memberName}.<member>\`)   container contains-edges=${rels.length}`,
                )
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
}
console.log(`files parsed ${filesParsed} of ${files.length}`)
console.log(`INLINE ENUM MEMBERS collapsed onto the container name (the struct spelling composes \`owner.member\`): ${collapsed}`)
console.log(`\`contains\` edges published under a container that has at least one collapsed inline enum: ${collapsedEdges}`)
for (const r of rows) console.log("  " + r)
for (const [k] of [...nameTally.entries()].slice(0, 40)) console.log(`  ${k}`)
