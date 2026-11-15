// Why do 25.9% of low-confidence `overrides` rows stay unresolved?
//
// The retarget pass re-points a guess onto a DECLARING ancestor, but only when
// that ancestor is in the indexed hierarchy. The rows it cannot move are either
// (a) resolvable with more index, or (b) unresolvable in principle from this
// corpus. Those two demand opposite responses — build more index, or stop
// publishing a guess — so the question is worth measuring rather than assuming.
//
// This builds the set of type names the corpus actually DECLARES, then asks, for
// every low-confidence override row, whether its claimed parent is in that set.
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
  const parser = new P(); parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()
  const files = walk(path.join(CORPUS, repo)).slice(0, limit)
  const declaredTypes = new Set<string>()
  // type name -> the member names that type DECLARES, so a guess can be checked
  // against the thing that actually matters: does the claimed OWNER declare the
  // claimed METHOD. The target is `Owner.method`, not a type name.
  const membersByType = new Map<string, Set<string>>()
  const rows: { file: string; line: number; target: string; reason: string }[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    for (const s of res.symbols ?? []) {
      const k = String(s.kind)
      if (k === "class" || k === "interface" || k === "enum" || k === "type") declaredTypes.add(normTarget(String(s.name)))
      const own = s.ownerName ? normTarget(String(s.ownerName)) : ""
      if (own) {
        let set = membersByType.get(own)
        if (!set) { set = new Set(); membersByType.set(own, set) }
        set.add(normTarget(String(s.name)))
      }
    }
    for (const r of res.relationships ?? []) {
      if (String(r.type) !== "overrides") continue
      if (typeof r.confidence === "number" && r.confidence >= 0.7) continue
      rows.push({ file: path.relative(path.join(CORPUS, repo), f), line: r.line_number ?? 0, target: String(r.target), reason: String(r.metadata?.reasonCode ?? "-") })
    }
  }
  // `Owner.method` -> [owner, method]. The owner may itself be dotted.
  const split = (t: string): { owner: string; member: string } => {
    const i = t.lastIndexOf(".")
    return i < 0 ? { owner: "", member: t } : { owner: normTarget(t.slice(0, i)), member: normTarget(t.slice(i + 1)) }
  }
  const ownerMissing: typeof rows = []      // the OWNER type is not in the corpus at all
  const memberMissing: typeof rows = []    // owner exists but does not declare the member
  const resolved: typeof rows = []          // owner exists AND declares it — retarget should have moved this
  for (const r of rows) {
    const { owner, member } = split(r.target)
    if (!declaredTypes.has(owner)) ownerMissing.push(r)
    else if (!(membersByType.get(owner)?.has(member))) memberMissing.push(r)
    else resolved.push(r)
  }
  const absent = [...ownerMissing, ...memberMissing]
  const byReason = new Map<string, number>()
  for (const r of absent) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1)
  console.log(`# scala low-confidence overrides residual — ${repo}, ${files.length} files\n`)
  console.log(`- low-confidence override rows: ${rows.length}`)
  console.log(`- owner DECLARES that member (resolvable — retarget should have moved it): ${resolved.length}`)
  console.log(`- owner exists in corpus but does NOT declare it:                            ${memberMissing.length}`)
  console.log(`- owner type NOT in this corpus at all:                                     ${ownerMissing.length}`)
  console.log(`- => still unresolvable:                                                     ${absent.length}  (${rows.length ? Math.round(100 * absent.length / rows.length) : 0}%)`)
  console.log(`\n## absent rows by reasonCode`)
  for (const [k, v] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
  console.log(`\n## examples of absent`)
  for (const r of absent.slice(0, 12)) console.log(`  ${r.file}:${r.line}  -> ${r.target}  (${r.reason})`)
}
main().catch((e) => { console.error(e); process.exit(1) })
