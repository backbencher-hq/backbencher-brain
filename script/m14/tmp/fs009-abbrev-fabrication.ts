// FS009 — the TYPE-ABBREVIATION FABRICATION, sized: `type Alias = SomeType` in F# is an
// ALIAS, but the grammar's recovery shape (union_type_defn + union_type_case + ERROR) is
// indistinguishable from a one-case discriminated union, and the analyzer's DU arm runs
// FIRST. So every type abbreviation in the corpus may be publishing a phantom `enum`
// symbol for an ALIAS and a phantom `enum_member` for the type being aliased.
//
// WHAT IT MEASURES, over real F# files
//   abbrevFiles   : files containing a `type X = <identifier>` abbreviation shape
//   phantomEnum   : symbols the analyzer called `enum` whose only `enum_member` child is
//                   the ALIASED TYPE'S OWN NAME (the fabricated case)
//   phantomCase   : those enum_member symbols
//   realEnum      : control — enums with >= 2 cases (a C#-style enum always has >= 2, or
//                   at minimum a case that is not the aliased name)
//   corroboration : for each phantom case, is the name a TYPE declared elsewhere? (the
//                   proof that it is a reference to a type, not a case of this one)
//
// Run:
//   bun script/m14/tmp/fs009-abbrev-fabrication.ts --repo fsharp --limit 400
//   bun script/m14/tmp/fs009-abbrev-fabrication.ts --all --limit 400 --json out.json --examples
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "400")
const EXT = (argOf("--ext") ?? "fs,fsi,fsx").split(",")
const ALL = process.argv.includes("--all")
const REPOS = ALL ? fs.readdirSync(CORPUS_ROOT).filter((d) => { try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false } }) : [argOf("--repo") ?? "fsharp"]

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
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  let files = 0
  const abbrevFiles: string[] = []
  const phantomEnums: any[] = []
  const phantomCases: any[] = []
  const controlEnums: any[] = []
  let enumTotal = 0, caseTotal = 0
  const perRepo: Record<string, any> = {}

  for (const repo of REPOS) {
    const repoDir = path.join(CORPUS_ROOT, repo)
    const list = walk(repoDir, EXT, [], LIMIT)
    const r = { files: 0, phantomEnums: 0, phantomCases: 0, controlEnums: 0 }
    for (const file of list) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++; r.files++
      const rel = path.relative(CORPUS_ROOT, file)
      let res: any
      try { res = await ASTEngine.parseFile(file, src) } catch { continue }
      const syms: any[] = res.symbols ?? []
      // every type name DECLARED in this file, for corroboration
      const declaredTypes = new Set<string>()
      for (const s of syms) {
        const t = String(s.kind)
        if (["class", "type", "interface", "enum", "struct", "union"].includes(t)) declaredTypes.add(String(s.name))
      }
      const enums = syms.filter((s) => String(s.kind) === "enum")
      enumTotal += enums.length
      for (const e of enums) {
        const cases = syms.filter((s) => String(s.kind) === "enum_member" && String(s.ownerName) === String(e.name))
        caseTotal += cases.length
        // the class: a 1-case "enum" whose case is NOT declared in this file is a
        // recovery-shaped alias; a case that IS a declared type here is the fabrication.
        if (cases.length === 1) {
          const c = cases[0]
          const corroborated = declaredTypes.has(String(c.name)) && String(c.name) !== String(e.name)
          const row = { repo, file: rel, enum: e.name, enumLine: e.range?.startLine, case: c.name, caseLine: c.range?.startLine, corroboratedAsDeclaredType: corroborated }
          if (corroborated) { phantomEnums.push(row); r.phantomEnums++ }
          else controlEnums.push(row)
        } else {
          controlEnums.push({ repo, file: rel, enum: e.name, enumLine: e.range?.startLine, cases: cases.map((c) => c.name) })
          r.controlEnums++
        }
      }
      if (phantomEnums.some((p) => p.file === rel)) abbrevFiles.push(rel)
    }
    perRepo[repo] = r
  }
  for (const p of phantomEnums) phantomCases.push(`${p.file}:${p.enumLine}  enum ${p.enum} -> phantom case ${p.case}`)

  const out = { at: new Date().toISOString(), repos: REPOS, limit: LIMIT, files, enumTotal, caseTotal, phantomEnums, phantomCases, controlCount: controlEnums.length, controlSample: controlEnums.slice(0, 80), perRepo }
  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify(out, null, 1)) }
  console.log(`files ${files}  enums ${enumTotal}  enum_members ${caseTotal}  phantomEnums ${phantomEnums.length}  controls ${controlEnums.length}`)
  console.log(`\n== per repo ==`)
  for (const [k, v] of Object.entries(perRepo)) console.log(`  ${k.padEnd(14)} files ${String(v.files).padStart(4)}  phantom ${String(v.phantomEnums).padStart(3)}  control ${String(v.controlEnums).padStart(4)}`)
  if (argOf("--examples")) {
    console.log(`\n== phantom aliases (all) ==`)
    for (const p of phantomEnums.slice(0, 60)) console.log(`  ${p.file}:${p.enumLine}  "type ${p.enum} = ${p.case}"   -> enum + phantom enum_member "${p.case}"`)
    console.log(`\n== controls (multi-case enums, and 1-case enums whose case is NOT a declared type) ==`)
    for (const c of controlEnums.slice(0, 20)) console.log(`  ${c.file}:${c.enumLine}  ${c.enum}  ${JSON.stringify(c.cases)}`)
  }
}
void main()
