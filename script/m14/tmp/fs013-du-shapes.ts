// FS013 — the DU / alias / type-extension SHAPE census: for every `union_type_defn`,
// `enum_type_defn` and `type_extension` in the corpus, the STRUCTURAL facts a fix may
// use, counted. No names are used as evidence here — the point is to establish which
// discriminators the tree actually offers, so each fix can be built on one that EXISTS
// rather than on a guess about spelling.
//
// WHAT IT MEASURES, per type_definition body shape
//   cases            : how many union_type_case children
//   casesWithPayload : how many carry `union_type_fields` (an `of` clause) or a `:` type
//                      annotation — the discriminator between a C#-style enum case and a
//                      real F# discriminated-union case.
//   leadPipe         : whether the source before the first case name contains a `|`.
//                      NOT usable as an AST rule (it is a text read) but counted so the
//                      cost of NOT using it is known.
//   rhsKind          : for the ambiguous one-case-no-payload shape, what the aliased
//                      name resolves to INSIDE the file (a declared type / a module /
//                      nothing) — the only in-file evidence that exists.
//   extShape         : for `type_extension`, whether the extended name is ALSO declared
//                      in the file (an extension of a local type) or not (a member-only
//                      type declared only by its extensions).
//
// Run: bun script/m14/tmp/fs013-du-shapes.ts --all --limit 400 --json out.json
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

const collect = (root: any, type: string, out: any[] = []): any[] => {
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === type) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
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

  const shapes = new Map<string, any>()
  const bump = (k: string, n = 1) => shapes.set(k, (shapes.get(k) ?? 0) + n)
  const examples = new Map<string, any[]>()
  const ex = (k: string, v: any) => { const a = examples.get(k) ?? []; if (a.length < 6) a.push(v); examples.set(k, a) }
  let files = 0
  const extRows: any[] = []
  const ambiguous: any[] = []

  for (const repo of REPOS) {
    for (const file of walk(path.join(CORPUS_ROOT, repo), EXT, [], LIMIT)) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++
      const rel = path.relative(CORPUS_ROOT, file)
      let tree: any
      try { tree = parser.parse(src) } catch { continue }

      // what type names does this FILE declare?
      const declaredTypes = new Set<string>()
      const declaredModules = new Set<string>()
      for (const td of collect(tree.rootNode, "type_definition")) {
        const tn = collect(td, "type_name")[0]
        if (tn) { const id = collect(tn, "identifier")[0]; if (id) declaredTypes.add(id.text) }
      }
      for (const m of collect(tree.rootNode, "named_module")) { const id = collect(m, "identifier")[0]; if (id) declaredModules.add(id.text) }

      // ---- union_type_defn ----
      for (const ud of collect(tree.rootNode, "union_type_defn")) {
        const cases = collect(ud, "union_type_case")
        const withPayload = cases.filter((c) => c.namedChildCount > 1).length
        const tn = collect(ud, "type_name")[0]
        const typeName = tn ? (collect(tn, "identifier")[0]?.text ?? "?") : "?"
        const key = cases.length === 1 && withPayload === 0 ? "UNION:1-case:0-payload" : cases.length === 1 ? "UNION:1-case:with-payload" : "UNION:multi-case"
        bump(key)
        if (cases.length === 1 && withPayload === 0) {
          const caseName = collect(cases[0], "identifier")[0]?.text ?? "?"
          const resolvesTo = declaredTypes.has(caseName) ? "TYPE-IN-FILE" : declaredModules.has(caseName) ? "MODULE-IN-FILE" : "nothing-in-file"
          bump(`  1-case rhs resolves to: ${resolvesTo}`)
          ex(`  1-case rhs resolves to: ${resolvesTo}`, { file: rel, line: cases[0].startPosition.row + 1, type: typeName, rhs: caseName })
          if (ambiguous.length < 400) ambiguous.push({ repo, file: rel, line: cases[0].startPosition.row + 1, type: typeName, rhs: caseName, resolvesTo })
        }
        if (withPayload > 0) bump(`  with-payload cases: ${Math.min(withPayload, 9)}+`)
      }
      // ---- enum_type_defn (a real F# enum: `A = 0`) ----
      for (const _e of collect(tree.rootNode, "enum_type_defn")) bump("ENUM:explicit-value")
      // ---- type_extension ----
      for (const te of collect(tree.rootNode, "type_extension")) {
        const tn = collect(te, "type_name")[0]
        const name = tn ? (collect(tn, "identifier")[0]?.text ?? "?") : "?"
        const local = declaredTypes.has(name)
        bump(`EXTENSION:of-a-type-declared-in-file=${local}`)
        extRows.push({ repo, file: rel, line: te.startPosition.row + 1, name, declaredInFile: local })
      }
      // ---- struct_type / delegate / abbrev / measure counts for the kind ladder ----
      for (const _s of collect(tree.rootNode, "struct_type")) bump("STRUCT:struct_type")
      for (const _s of collect(tree.rootNode, "type_declaration")) bump("STRUCT:bare type_declaration (the [<Measure>] form)")
      for (const _s of collect(tree.rootNode, "type_abbrev_defn")) bump("ABBREV:type_abbrev_defn")
      for (const _s of collect(tree.rootNode, "delegate_type_defn")) bump("DELEGATE:delegate_type_defn")
      for (const _s of collect(tree.rootNode, "record_type_defn")) bump("RECORD:record_type_defn")
      for (const _s of collect(tree.rootNode, "interface_type_defn")) bump("INTERFACE:interface_type_defn")
      for (const _s of collect(tree.rootNode, "anon_type_defn")) bump("CLASS:anon_type_defn")
      for (const _s of collect(tree.rootNode, "object_expression")) bump("OBJECT:object_expression")
      for (const _s of collect(tree.rootNode, "exception_definition")) bump("EXCEPTION:exception_definition")
      tree.delete()
    }
  }

  const rows = [...shapes.entries()].sort((a, b) => b[1] - a[1])
  const out = { at: new Date().toISOString(), repos: REPOS, limit: LIMIT, files, shapes: rows, examples: Object.fromEntries(examples), extensions: extRows, ambiguous }
  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify(out, null, 1)) }
  console.log(`FS013 — DU / alias / extension shape census over ${files} files\n`)
  for (const [k, v] of rows) console.log(`  ${String(v).padStart(6)}  ${k}`)
  console.log(`\n== the one-case no-payload shape, by what the RHS resolves to IN-FILE ==`)
  for (const [k, v] of Object.entries(examples)) {
    if (!k.includes("resolves to")) continue
    console.log(`  ${k}`)
    for (const e of v) console.log(`      ${e.file}:${e.line}  type ${e.type} = ${e.rhs}`)
  }
  console.log(`\n== type extensions: ${extRows.length} total, ${extRows.filter((e) => e.declaredInFile).length} extend a type declared in the SAME file, ${extRows.filter((e) => !e.declaredInFile).length} do not ==`)
  for (const e of extRows.filter((x) => !x.declaredInFile).slice(0, 12)) console.log(`      ${e.file}:${e.line}  type ${e.name} with ...   (no local declaration)`)
}
void main()
