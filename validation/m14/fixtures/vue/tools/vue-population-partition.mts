/**
 * VUE AT POPULATION SCOPE — the three things the population row unblocked, in ONE instrument:
 *   1. the clause-2 PARTITION per type, with the buckets closing exactly against the gate's own row;
 *   2. the SVG FABRICATION count (markup emitted as `instantiates`);
 *   3. the `calleeExpression` SPLIT (receiver vs bare), plus how many receiver edges the FILE ITSELF
 *      proves (the owner-qualification route).
 *
 * MODELS THE GATE'S OWN PREDICATE: per PROJECT, `declCount` (1 -> resolved, >1 -> amb(decl), 0 ->
 * unresolved), which is exactly `classifyEdge`'s count model. A cross-check that reproduces the gate's
 * totals is the strongest evidence available that the key space here is the gate's — and a MISMATCH is
 * an instrument fault, reported as one, not a finding.
 *
 *   npx tsx validation/m14/fixtures/vue/tools/vue-population-partition.mts --files=0
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=0").split("=")[1])
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
const pascal = (s: string) => s.split(/[-_]/).map((w) => w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)).join("")
const SVG_MARKUP = new Set(["feFlood","feColorMatrix","feOffset","feGaussianBlur","feComposite","feBlend","feMerge","feMergeNode","feTurbulence","feDisplacementMap","feDropShadow","feImage","feMorphology","feTile","foreignObject","linearGradient","radialGradient","clipPath","mask","pattern","marker","symbol","use","textPath","animate","animateTransform","filter","stop"])
const CLASS_LIKE = new Set(["class","interface","struct","enum","trait","type"])

type Row = { edges: number; resolved: number; amb: number; unresolved: number }
const byType = new Map<string, Row>()
const usage = { edges: 0, stemHit: 0, svgMarkup: 0, library: 0, other: 0 }
const calls = { edges: 0, withReceiver: 0, thisReceiver: 0, noReceiver: 0, fileProvesMember: 0 }
let files = 0, population = 0

for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const wanted: string[] = []
  const stems = new Set<string>()
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vue")) continue
    const abs = path.join(repo, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    const base = rel.slice(rel.lastIndexOf("/") + 1, rel.length - 4)
    stems.add(base); stems.add(kebab(base)); stems.add(pascal(base))
    wanted.push(abs)
  }
  if (wanted.length === 0) continue
  population += wanted.length
  wanted.sort()
  let pick = wanted
  if (N > 0 && pick.length > N) {
    const stride = pick.length / N
    const sel: string[] = []
    for (let i = 0; i < N; i++) sel.push(pick[Math.floor(i * stride)])
    pick = [...new Set(sel)].sort()
  }
  const declCount = new Map<string, number>()
  const parsed: { rel: string; rels: any[]; members: Set<string> }[] = []
  for (const abs of pick) {
    files++
    const rel = path.relative(repo, abs).split(path.sep).join("/")
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    const members = new Set<string>()
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length > 0) declCount.set(n, (declCount.get(n) ?? 0) + 1)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) declCount.set(q, (declCount.get(q) ?? 0) + 1)
      const owner = String(s.ownerName ?? (s.metadata as any)?.owner ?? "")
      if (owner.length > 0 && CLASS_LIKE.has(String(s.kind ?? "").toLowerCase())) members.add(`${owner}.${n}`)
    }
    parsed.push({ rel, rels: res.relationships ?? [], members })
  }
  for (const { rels, members } of parsed) {
    for (const r of rels) {
      const type = String(r.type ?? r.relationshipType ?? "")
      if (type.length === 0) continue
      const t = String(r.target ?? "")
      const row = byType.get(type) ?? { edges: 0, resolved: 0, amb: 0, unresolved: 0 }
      const decls = declCount.get(t) ?? 0
      row.edges++
      if (decls === 1) row.resolved++
      else if (decls > 1) row.amb++
      else row.unresolved++
      byType.set(type, row)
      const md = (r.metadata ?? {}) as any
      if (md.isComponentUsage === true) {
        usage.edges++
        if (stems.has(t) || stems.has(kebab(t)) || stems.has(pascal(t))) usage.stemHit++
        else if (SVG_MARKUP.has(t)) usage.svgMarkup++
        else if (/^[a-z]+-[a-z0-9-]+$/.test(t)) usage.library++
        else usage.other++
      }
      if (type === "calls" && typeof md.calleeExpression === "string") {
        calls.edges++
        const full = String(md.calleeExpression)
        if (full.includes(".")) {
          calls.withReceiver++
          if (full.startsWith("this.")) calls.thisReceiver++
          const owner = full.slice(0, full.indexOf("."))
          if (members.has(`${owner}.${t}`)) calls.fileProvesMember++
        } else calls.noReceiver++
      }
    }
  }
}

const order = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
let T = { edges: 0, resolved: 0, amb: 0, unresolved: 0 }
console.log(`VUE POPULATION PARTITION — ${files}/${population} .vue files (files=0 means ALL)`)
console.log(`type          edges    resolved   amb(decl)  unresolved   closure`)
for (const t of [...order, ...[...byType.keys()].filter((k) => !order.includes(k))]) {
  const r = byType.get(t)
  if (r === undefined) continue
  const closes = r.resolved + r.amb + r.unresolved === r.edges
  console.log(`${t.padEnd(12)} ${String(r.edges).padStart(6)} ${String(r.resolved).padStart(10)} ${String(r.amb).padStart(10)} ${String(r.unresolved).padStart(11)}   ${closes ? "EXACT" : "BROKEN"}`)
  T.edges += r.edges; T.resolved += r.resolved; T.amb += r.amb; T.unresolved += r.unresolved
}
console.log(`${"TOTAL".padEnd(12)} ${String(T.edges).padStart(6)} ${String(T.resolved).padStart(10)} ${String(T.amb).padStart(10)} ${String(T.unresolved).padStart(11)}   ${T.resolved + T.amb + T.unresolved === T.edges ? "EXACT" : "BROKEN"}`)
console.log(`\nCROSS-CHECK against the gate's population row (project scope): 24,982 edges · 4,668 resolved · 5,499 amb · 14,815 unresolved`)
const p = (n: number, d: number) => d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "-"
console.log(`\nSVG FABRICATION — isComponentUsage ${usage.edges}: stemHit ${usage.stemHit} (${p(usage.stemHit, usage.edges)}) · SVG MARKUP ${usage.svgMarkup} (${p(usage.svgMarkup, usage.edges)}) · library ${usage.library} (${p(usage.library, usage.edges)}) · other ${usage.other}`)
console.log(`CALLS SPLIT — ${calls.edges}: with a RECEIVER ${calls.withReceiver} (this. ${calls.thisReceiver}) · BARE ${calls.noReceiver} · receiver edges THE FILE ITSELF PROVES ${calls.fileProvesMember}`)
