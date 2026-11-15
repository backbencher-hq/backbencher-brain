/**
 * `overrides` RESOLVES ZERO ON SIX LANGUAGES — THE SHAPE SPLIT.
 *
 * `contains` resolves ~100% on the same runs. Two hypotheses, and they need different fixes:
 *   NAMING     — the target spelling is one no declaration can ever carry (which is what `imports`
 *                turned out to be: a module, not a symbol);
 *   MECHANISM  — the declaration exists and the resolver is not reaching it.
 *
 * THE THREE-WAY SPLIT, per lane, by the gate's own key space (per PROJECT):
 *   (a) a member the EDGE'S OWN FILE declares   -> a TRUE row the resolver failed to bind
 *   (b) a member another file of the project declares -> exists, wrong key
 *   (c) a member NOTHING declares               -> a WRONG row (clause 1), not a resolution failure
 *
 * AND THE PRICING, in the gate's own columns: `classifyEdge` on the target AS EMITTED, and on the
 * LEAF (the last dotted segment) — BOTH columns, resolved and amb(decl), because a fix that turns
 * unresolved into ambiguous has moved the problem rather than solved it.
 *
 * USAGE  BB_CC_REPOS=<repo> npx tsx validation/m14/fixtures/scss/lane-overrides-shapes.mts <lane>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { classifyEdge } from "../../../../script/m14/incoming-rule"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANE = process.argv[2]
const OUT = process.argv[3]
const ONLY_REPOS = (process.env.BB_CC_REPOS ?? "").split(",").map((x) => x.trim()).filter(Boolean)
if (!LANE) { console.error("usage: lane-overrides-shapes.mts <lane>"); process.exit(2) }

type Row = { repo: string; rel: string; abs: string }
const rows: Row[] = []
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(name)) continue
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 1024 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANE) continue
    rows.push({ repo: name, rel, abs })
  }
}

const decl = new Map<string, Map<string, number>>()      // project -> name -> count
const kinds = new Map<string, Map<string, Set<string>>>()
const own = new Map<string, Map<string, number>>()       // "project\u0000file" -> name -> count
type Edge = { repo: string; file: string; source: string; target: string; leaf: string; line: number | undefined; conf: number | undefined }
const edges: Edge[] = []
let parsed = 0, failed = 0
for (const f of rows) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (!decl.has(f.repo)) { decl.set(f.repo, new Map()); kinds.set(f.repo, new Map()) }
  const d = decl.get(f.repo)!, k = kinds.get(f.repo)!
  const bump = (key: string, kind: string) => {
    d.set(key, (d.get(key) ?? 0) + 1)
    let s = k.get(key); if (!s) k.set(key, (s = new Set())); s.add(kind)
  }
  const relKey = f.repo + "\u0000" + f.rel
  const o = new Map<string, number>()
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const kind = String(s?.kind ?? "")
    bump(name, kind); o.set(name, (o.get(name) ?? 0) + 1)
    const q = String(s?.qualifiedName ?? ""); if (q && q !== name) bump(q, kind)
  }
  own.set(relKey, o)
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    if (String(rel?.type ?? rel?.relationshipType ?? "") !== "overrides") continue
    const target = String(rel?.target ?? "")
    edges.push({ repo: f.repo, file: f.rel, source: String(rel?.source ?? ""), target, leaf: target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target, line: rel?.line_number, conf: rel?.confidence })
  }
}

const classify = (e: Edge, tgt: string) => {
  const c: any = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, tgt, null)
  return String(c?.outcome ?? "?")
}
const tally = (fn: (e: Edge) => string) => {
  const t: Record<string, number> = {}
  for (const e of edges) { const key = fn(e); t[key] = (t[key] ?? 0) + 1 }
  return t
}
const shape = tally((e) => {
  const o = own.get(e.repo + "\u0000" + e.file) ?? new Map()
  const d = decl.get(e.repo)!
  if ((o.get(e.leaf) ?? 0) > 0) return "ownFileDeclaresLeaf"
  if ((d.get(e.leaf) ?? 0) > 0) return "projectDeclaresLeafElsewhere"
  if ((d.get(e.target) ?? 0) > 0) return "projectDeclaresFullTarget"
  return "NOTHING-DECLARES-IT"
})
const report = {
  instrument: "`overrides` SHAPE SPLIT and PRICING — NAMING versus MECHANISM, in the gate's own columns",
  lane: LANE,
  population: { admitted: rows.length, parsed, failed, repos: decl.size, repoFilter: ONLY_REPOS.length ? ONLY_REPOS : "ALL", admission: "git-tracked, <= 1 MiB, detectLanguageFromPath === lane" },
  scope: "per PROJECT (the repository a file belongs to) — the gate's default",
  overridesEdges: edges.length,
  targetSpellings: (() => {
    const dotted = edges.filter((e) => e.target.includes(".")).length
    const colon = edges.filter((e) => e.target.includes(":")).length
    const slash = edges.filter((e) => e.target.includes("/")).length
    const sample = [...new Set(edges.map((e) => e.target))].slice(0, 8)
    return { dotted, colon, slash, bare: edges.length - dotted - colon - slash, sample, distinct: new Set(edges.map((e) => e.target)).size }
  })(),
  theThreeWaySplit: shape,
  pricing: {
    asEmitted: (() => { const t: Record<string, number> = {}; for (const e of edges) { const k = classify(e, e.target); t[k] = (t[k] ?? 0) + 1 } return t })(),
    onLeaf: (() => { const t: Record<string, number> = {}; for (const e of edges) { const k = classify(e, e.leaf); t[k] = (t[k] ?? 0) + 1 } return t })(),
    /**
     * THE THIRD SPELLING, and the one the convention's own provenance points at: the local edge label
     * joins owner and member with `.` (`localEdgeLabel`, override-context.ts:132) while the store's
     * qualified names join them with `::` (`publishFileScopedIdentities` in the CSS delegate). If the
     * owner-qualified key EXISTS in the gate's key space under `::`, then aligning the SEPARATOR keeps
     * the owner information the label exists to carry AND resolves — where the bare leaf throws the
     * owner away and lands 581 rows in `ambDeclOnly`.
     */
    onOwnerDoubleColon: (() => { const t: Record<string, number> = {}; for (const e of edges) {
      const i = e.target.lastIndexOf(".")
      const alt = i > 0 ? `${e.target.slice(0, i)}::${e.target.slice(i + 1)}` : e.target
      const k = classify(e, alt); t[k] = (t[k] ?? 0) + 1 } return t })(),
    onOwnerDoubleColon_available: (() => { let n = 0; for (const e of edges) {
      const i = e.target.lastIndexOf(".")
      if (i <= 0) continue
      const alt = `${e.target.slice(0, i)}::${e.target.slice(i + 1)}`
      const d = decl.get(e.repo)!; if ((d.get(alt) ?? 0) > 0) n++ } return n })(),
  },
  reading: {
    split: "ownFileDeclaresLeaf = a TRUE row the resolver failed to bind (the overriding class declares the member in the same file) · projectDeclaresLeafElsewhere = the member exists on another declaration in the project · NOTHING-DECLARES-IT = a WRONG row, not a resolution failure (clause 1).",
    pricing: "asEmitted is the gate's columns for the target as written; onLeaf is the same for the LAST dotted segment. Both columns are reported, because a fix that turns unresolved into ambiguous has moved the problem rather than solved it.",
  },
}
writeFileSync(OUT ?? `validation/m14/fixtures/scss/overrides-shapes-${LANE}.json`, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ lane: LANE, population: report.population, edges: report.overridesEdges, spellings: report.targetSpellings, split: report.theThreeWaySplit, pricing: report.pricing }, null, 2))
