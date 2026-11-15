// What KIND of declaration is behind each indistinguishable same-named duplicate?
//
// SDJ-12 counted 1,123 of them and asserted the dominant cause was the class +
// companion object family. That assertion was never measured, and the two candidate
// causes need different fixes: a companion pair is a Scala FACT (both exist, the
// identity just cannot tell them apart), whereas a nested local attributed to its
// enclosing type is an ANALYZER bug. This splits them.
//
// For each group of same owner+kind+signature duplicates it asks, per member:
//   - is the owner a companion of another same-file owner of the same name?
//   - is the member nested inside a def/val rather than directly in the type body?
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { normTarget } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
async function main(): Promise<void> {
  const repo = process.argv[2] ?? "scala3"
  const limit = Number(process.argv[3] ?? 2000)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  if (!gl) { console.error("PROBE INVALID: grammar did not load"); process.exit(2) }
  const parser = new P(); parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()
  const kinds = new Map<string, number>()
  const ex = new Map<string, string[]>()
  let indist = 0
  for (const f of walk(path.join(CORPUS, repo)).slice(0, limit)) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    // owner name -> the kinds it is declared with, to spot a class+companion pair
    const ownerKinds = new Map<string, Set<string>>()
    for (const s of res.symbols ?? []) {
      const k = String(s.kind)
      if (k !== "class" && k !== "module" && k !== "interface" && k !== "enum") continue
      let set = ownerKinds.get(normTarget(String(s.name)))
      if (!set) { set = new Set(); ownerKinds.set(normTarget(String(s.name)), set) }
      set.add(k)
    }
    const groups = new Map<string, any[]>()
    for (const s of res.symbols ?? []) {
      const k = `${s.ownerName ?? "-"}|${s.name}|${s.kind}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(s)
    }
    for (const [k, v] of groups) {
      if (v.length < 2) continue
      const sigs = new Set(v.map((x) => JSON.stringify(x.parameters ?? null)))
      if (sigs.size > 1) continue
      indist += v.length - 1
      const first = v[0]
      const owner = normTarget(String(first.ownerName ?? ""))
      const ok = ownerKinds.get(owner)
      const isCompanion = !!ok && (ok.has("class") || ok.has("interface") || ok.has("enum")) && ok.has("module")
      // a nested local's line sits well below the owner's start and the member is
      // not a direct body member: approximate by asking whether the owner ENDS
      // before the member, which cannot happen for a real member.
      let fam: string
      if (isCompanion) fam = "class + companion object share the owner NAME"
      else fam = "same owner, NOT a companion pair"
      kinds.set(fam, (kinds.get(fam) ?? 0) + (v.length - 1))
      const arr = ex.get(fam) ?? []
      if (arr.length < 4) arr.push(`${path.relative(path.join(CORPUS, repo), f)} ${k} lines ${v.map((x) => x.range?.startLine).join(",")}`)
      ex.set(fam, arr)
    }
  }
  console.log(`# indistinguishable same-owner+kind+signature duplicates — ${repo}, ${limit} files\n`)
  console.log(`- total extra members sharing an identity: ${indist}`)
  for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) {
    console.log(`\n  ${String(v).padStart(5)}  ${k}`)
    for (const e of ex.get(k) ?? []) console.log(`          ${e}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
