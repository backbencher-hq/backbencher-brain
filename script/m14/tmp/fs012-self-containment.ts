// FS012 — SELF-CONTAINMENT and DUPLICATE-SYMBOL, sized over the corpus: a `type
// extension` is not a second declaration of the type it extends, and F# type extensions
// are the primary way member-only and static-member-only types are declared — so this is
// a common shape, not an exotic one.
//
// WHAT IT MEASURES, per file, from the PRODUCTION entry
//   selfContains : a `contains` edge whose source and target are the SAME name — a type
//                  that declares itself. (The oracle's own self-collision guard refuses
//                  these for OVERRIDES; nothing refuses them for CONTAINS.)
//   dupType      : two type-kind symbols with the same name in the same file, where one
//                  carries metadata.nodeType === "type_extension" — the extension
//                  redeclaring an existing type.
//   extMembers   : members whose owner is an EXTENDED type (not a locally declared one),
//                  which is the legitimate output of this shape and the control that
//                  shows the mechanism is otherwise working.
//   orphanOwner  : a member whose owner name is a type declared in ANOTHER file — the
//                  legitimate cross-file case, kept separate from self-containment.
//
// Run:
//   bun script/m14/tmp/fs012-self-containment.ts --repo fsharp --limit 400
//   bun script/m14/tmp/fs012-self-containment.ts --all --limit 400 --json out.json --examples
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

const TYPE_KINDS = new Set(["class", "type", "interface", "enum", "struct", "union"])
const MEMBER_KINDS = new Set(["method", "property", "field", "enum_member", "constructor", "accessor"])

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  let files = 0
  const selfContains: any[] = []
  const dupTypes: any[] = []
  const extMembers = { total: 0, local: 0, foreign: 0 }
  const perRepo: Record<string, any> = {}
  const nonSelfDupTypes: any[] = []

  for (const repo of REPOS) {
    const repoDir = path.join(CORPUS_ROOT, repo)
    const r = { files: 0, selfContains: 0, dupTypes: 0 }
    for (const file of walk(repoDir, EXT, [], LIMIT)) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++; r.files++
      const rel = path.relative(CORPUS_ROOT, file)
      let res: any
      try { res = await ASTEngine.parseFile(file, src) } catch { continue }
      const syms: any[] = res.symbols ?? []
      const rels: any[] = res.relationships ?? []
      const localTypes = new Set(syms.filter((s) => TYPE_KINDS.has(String(s.kind))).map((s) => String(s.name)))
      for (const e of rels) {
        if (String(e.type) === "contains" && String(e.source) === String(e.target)) {
          selfContains.push({ repo, file: rel, label: e.type, name: e.source, line: e.line_number, meta: e.metadata })
          r.selfContains++
        }
      }
      // duplicate type symbols
      const byName = new Map<string, any[]>()
      for (const s of syms) if (TYPE_KINDS.has(String(s.kind))) { const a = byName.get(String(s.name)) ?? []; a.push(s); byName.set(String(s.name), a) }
      for (const [name, arr] of byName) {
        if (arr.length < 2) continue
        const hasExt = arr.some((s) => String(s.metadata?.nodeType) === "type_extension")
        if (hasExt) { dupTypes.push({ repo, file: rel, name, count: arr.length, kinds: arr.map((s) => `${s.kind}@${s.range?.startLine}:${s.metadata?.nodeType}`) }); r.dupTypes++ }
        else nonSelfDupTypes.push({ repo, file: rel, name, kinds: arr.map((s) => `${s.kind}@${s.range?.startLine}:${s.metadata?.nodeType}`) })
      }
      // extension members: owner not declared in THIS file
      for (const s of syms) {
        if (!MEMBER_KINDS.has(String(s.kind))) continue
        const o = s.ownerName
        if (!o) continue
        if (localTypes.has(String(o))) { extMembers.local++ } else { extMembers.foreign++; extMembers.total++ }
      }
    }
    perRepo[repo] = r
  }

  const out = { at: new Date().toISOString(), repos: REPOS, limit: LIMIT, files, selfContains, dupTypes, nonSelfDupTypes: nonSelfDupTypes.slice(0, 100), extMembers, perRepo }
  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify(out, null, 1)) }
  console.log(`files ${files}`)
  console.log(`  self-contains edges (a type containing itself)  : ${selfContains.length}`)
  console.log(`  duplicate type symbols where one is a type_extension : ${dupTypes.length}`)
  console.log(`  duplicate type symbols for another reason       : ${nonSelfDupTypes.length}`)
  console.log(`  members owned by a type NOT declared in-file    : ${extMembers.foreign} (of ${extMembers.local + extMembers.foreign} owned members)`)
  console.log(`\n== per repo ==`)
  for (const [k, v] of Object.entries(perRepo)) console.log(`  ${k.padEnd(14)} files ${String(v.files).padStart(4)}  self-contains ${String(v.selfContains).padStart(3)}  dupTypes ${String(v.dupTypes).padStart(4)}`)
  if (argOf("--examples")) {
    console.log(`\n== self-contains, all ==`)
    for (const s of selfContains.slice(0, 40)) console.log(`  ${s.file}:${s.line}  ${s.name}  ${JSON.stringify(s.meta)}`)
    console.log(`\n== duplicate types via extension, first 30 ==`)
    for (const d of dupTypes.slice(0, 30)) console.log(`  ${d.file}  ${d.name} x${d.count}  ${JSON.stringify(d.kinds)}`)
    if (nonSelfDupTypes.length) {
      console.log(`\n== duplicate types for another reason, first 20 ==`)
      for (const d of nonSelfDupTypes.slice(0, 20)) console.log(`  ${d.file}  ${d.name}  ${JSON.stringify(d.kinds)}`)
    }
  }
}
void main()
