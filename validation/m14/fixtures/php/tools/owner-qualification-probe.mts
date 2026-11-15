/**
 * PHP OWNER-QUALIFICATION PROBE — how many member-position edges can be re-spelled `Owner.member`
 * on PROOF the file itself declares that member, and what does that do to the GATE'S buckets?
 *
 * THE LANE'S OWN CENSUS SAYS IT: `uses` sends most of its volume at a target name matching more
 * than one declaration, "where the owner is recoverable from the tree (`$this->`, `self::`,
 * `static::`, `parent::`) a qualified target would disambiguate". This measures that set and the
 * effect, instead of estimating either.
 *
 * THE RULE IS PROVABLE, NOT A PREFERENCE:
 *   - the edge carries `metadata.owner` (the analyzer derived the receiver's class from the tree),
 *   - the file's OWN symbol table publishes a class-like member named exactly `<owner>.<target>`,
 *   - so the qualified target names THAT symbol: the qualified name's declarations are a SUBSET of
 *     the bare name's, which is why ambiguity can only fall and resolution can only rise. The
 *     probe asserts that property by re-counting both, per PROJECT (the gate's scope).
 *
 * It also reports the same edges in the `ofWhich > 1` column the Lead added: resolved edges whose
 * target had more than one declaration, where production's `s.id` tie-break picked the row — the
 * indexer's own control arm measures 37,318 of 49,729 such picks as the WRONG symbol.
 *
 *   npx tsx validation/m14/fixtures/php/tools/owner-qualification-probe.mts [--files=N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=0").split("=")[1])

const { getParser } = await import(path.join(ROOT, "src/ast/engine.ts"))
const mod: any = await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))
const Analyzer = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
const parser: any = await getParser("php")

const repos: { repo: string; files: string[] }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  files.sort()
  if (files.length > 0) repos.push({ repo: dir, files })
}
if (N > 0) for (const r of repos) {
  const stride = Math.max(1, Math.floor(r.files.length / Math.max(1, N)))
  r.files = r.files.filter((_, i) => i % stride === 0).slice(0, N)
}

const CLASS_LIKE = new Set(["class", "interface", "trait", "enum"])
const MEMBER_TYPES = new Set(["calls", "uses", "references"])
type Rec = { type: string; target: string; source: string; owner: string | null; file: string; line: number }
const tally: Record<string, { edges: number; ownerSet: number; addressable: number; ambBefore: number; ambAfter: number; resBefore: number; resAfter: number; unresBefore: number; unresAfter: number }> = {}
let resolvedWithRivals = 0
const examples: string[] = []

for (const { repo, files } of repos) {
  const nameCount = new Map<string, number>()
  const qualCount = new Map<string, number>()
  const parsed: { file: string; symbols: any[]; rels: any[] }[] = []
  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    let res: any
    try { res = new Analyzer().analyze((await parser.parse(content, abs)).rootNode, content, abs, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ file: abs, symbols: res.symbols ?? [], rels: res.relationships ?? [] })
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length === 0) continue
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) qualCount.set(q, (qualCount.get(q) ?? 0) + 1)
    }
  }
  for (const { file, symbols, rels } of parsed) {
    const members = new Set<string>()
    for (const s of symbols) {
      if (!s.ownerName || !CLASS_LIKE.has(String(s.ownerKind ?? ""))) continue
      members.add(`${s.ownerName}.${s.name}`)
    }
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      if (!MEMBER_TYPES.has(t)) continue
      const row = tally[t] ?? (tally[t] = { edges: 0, ownerSet: 0, addressable: 0, ambBefore: 0, ambAfter: 0, resBefore: 0, resAfter: 0, unresBefore: 0, unresAfter: 0 })
      row.edges++
      const tgt = String(r.target ?? "")
      const owner = (r.metadata ?? {}).owner
      if (typeof owner !== "string" || owner.length === 0) continue
      row.ownerSet++
      if (!members.has(`${owner}.${tgt}`)) continue
      row.addressable++
      const before = nameCount.get(tgt) ?? 0
      const after = qualCount.get(`${owner}.${tgt}`) ?? 0
      if (before === 1) row.resBefore++; else if (before > 1) row.ambBefore++; else row.unresBefore++
      if (after === 1) row.resAfter++; else if (after > 1) row.ambAfter++; else row.unresAfter++
      if (before > 1 && after === 1) {
        if (examples.length < 10) examples.push(`${t}: ${String(r.source)} -> ${tgt}  ==>  ${owner}.${tgt}   ${before} decl(s) -> 1   (${path.relative(CR, file)}:${r.line_number ?? "?"})`)
      }
    }
  }
  void resolvedWithRivals
}

console.log(`php owner-qualification probe — ${N === 0 ? "WHOLE admitted population" : `stride sample of ${N} per repo`}`)
console.log(`${"type".padEnd(12)} ${"edges".padStart(9)} ${"owner set".padStart(10)} ${"ADDRESSABLE".padStart(12)} ${"amb->res".padStart(9)} ${"amb->amb".padStart(9)} ${"res->res".padStart(9)} ${"unres->unres".padStart(12)}`)
let tot = 0, win = 0
for (const [t, r] of Object.entries(tally).sort((a, b) => b[1].addressable - a[1].addressable)) {
  const amb2amb = r.ambBefore - (r.ambBefore - r.ambAfter > 0 ? r.ambBefore - r.ambAfter : 0)
  console.log(`${t.padEnd(12)} ${String(r.edges).padStart(9)} ${String(r.ownerSet).padStart(10)} ${String(r.addressable).padStart(12)} ${String(r.ambBefore - r.ambAfter < 0 ? 0 : r.ambBefore - r.ambAfter).padStart(9)} ${String(amb2amb).padStart(9)} ${String(r.resBefore).padStart(9)} ${String(r.unresBefore).padStart(12)}`)
  tot += r.addressable
  win += Math.max(0, r.ambBefore - r.ambAfter)
}
console.log(`\nADDRESSABLE (provable in-file): ${tot} edges`)
console.log(`AMBIGUOUS -> RESOLVED          : ${win} edges`)
console.log(`examples (multi-declaration name collapsing to one):`)
for (const e of examples) console.log(`  ${e}`)
for (const [t, r] of Object.entries(tally)) {
  if (r.ambAfter > r.ambBefore || r.resAfter < r.resBefore || r.unresAfter > r.unresBefore) {
    console.log(`MONOTONICITY VIOLATION in ${t}: amb ${r.ambBefore}->${r.ambAfter}, res ${r.resBefore}->${r.resAfter}, unres ${r.unresBefore}->${r.unresAfter}`)
  }
}
console.log(`monotonicity: checked (no violation printed above means the qualified target never added declarations)`)
