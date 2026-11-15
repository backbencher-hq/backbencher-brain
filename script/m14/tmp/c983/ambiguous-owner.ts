// #981's PHANTOM class, measured as the payload actually publishes it.
//
// `typedef enum { ... } X;` and `struct X { ... };` are legal C -- typedef names
// and tags live in SEPARATE namespaces -- so both are called `X`. The analyzer
// mints the anonymous enum's owner name from the ALIAS, so it publishes
// `contains X -> <enum member>` beside the struct's own `contains X -> <field>`.
// A consumer resolving `X` as a container gets a struct carrying members it does
// not have.
//
// The right measurement is not "is the name shared" but "does the payload publish
// members of MORE THAN ONE kind under one owner name", which is the shape that
// actually misleads. A typedef alias that never becomes an owner, or a tag that is
// only forward-referenced, is not this class.
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

/**
 * ownerName -> the set of member KINDS the payload published under it. Two kinds
 * under one owner is the ambiguous-owner shape; a property and a nested inline
 * aggregate's field is a DIFFERENT owner path and does not count.
 */
function ownerMemberKinds(result: any): Map<string, Set<string>> {
  const byOwner = new Map<string, Set<string>>()
  for (const s of result.symbols ?? []) {
    const owner = String(s.ownerName ?? "")
    if (!owner) continue
    if (!byOwner.has(owner)) byOwner.set(owner, new Set())
    byOwner.get(owner)!.add(String(s.kind))
  }
  return byOwner
}

let filesParsed = 0
let ambiguousOwners = 0
let ambiguousEdges = 0
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

  // The container symbol's OWN `ownerName` is not the identity here: a top-level
  // struct carries no ownerName and puts its name in `scope`. So the test is on the
  // MEMBERS alone -- an owner name carrying both an `enum_member` and a `property`
  // is the ambiguous shape, and a first version keyed on the container's ownerName
  // and found 0 on the file that defines the class.
  const memberKinds = ownerMemberKinds(result)

  for (const [owner, mk] of memberKinds) {
    if (!mk) continue
    const hasEnumMembers = mk.has("enum_member")
    const hasFields = mk.has("property")
    if (!hasEnumMembers || !hasFields) continue
    ambiguousOwners++
    nameTally.set(`${path.relative(CORPUS, file)}:${owner}`, 1)
    const rels = (result.relationships ?? []).filter((r: any) => String(r.source) === owner && String(r.type) === "contains")
    ambiguousEdges += rels.length
    if (rows.length < 25) {
      rows.push(
        `${path.relative(CORPUS, file)}  owner=\`${owner}\`  contains-edges=${rels.length}  members=${[...mk].join("+")}  first-targets=[${rels.slice(0, 5).map((r: any) => r.target).join(",")}]`,
      )
    }
  }
}
console.log(`files parsed ${filesParsed} of ${files.length}`)
console.log(`AMBIGUOUS OWNERS: an owner name carrying members of BOTH an enum and a struct/union: ${ambiguousOwners}`)
console.log(`\`contains\` edges published under such an owner: ${ambiguousEdges}`)
for (const [k] of [...nameTally.entries()].slice(0, 25)) rows.push(`  ${k}`)
for (const r of rows) console.log("  " + r)
