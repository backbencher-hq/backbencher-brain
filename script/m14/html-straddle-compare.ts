/**
 * THE STRADDLE CONTROL, COMPARED — one repository, measured WHOLE and measured SPLIT.
 *
 * WHAT IT COMPARES. The gate's own TABLE 1 rows for one repository, read three times: once with
 * the repository's whole admitted set in ONE project scope, and once with the SAME FILES split
 * into two project scopes. The difference per type is the straddle effect, MEASURED on a real
 * repository of the admitted population instead of bounded by assertion.
 *
 * ★ WHAT IT IS FOR, AGAIN, BECAUSE THE SIGN IS THE WHOLE POINT. The arm ran in five disjoint
 *   slices of the sorted admitted list, and the resolution scope is PER PROJECT. A repository that
 *   straddles a slice boundary is measured in two project scopes, each of which sees only HALF of
 *   the repository's own symbol table. A name that collides with a declaration in the half that is
 *   NOT in the slice is INVISIBLE — so the name reads UNIQUE, and the edge RESOLVES. ⇒ THE CHUNKED
 *   `resolved` IS BIASED UPWARD, and this file measures by how much.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const REPO = process.argv[2] ?? "vault"
const DIR = "validation/m14/measurements/html-straddle"

const TYPES = ["calls", "extends", "implements", "uses", "imports", "exports", "contains",
  "references", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]
const BUCKETS = ["edges", "resolved", "amb", "unresolved", "extOK", "bindOK"] as const

function table(path: string): Map<string, Record<string, number>> {
  const text = readFileSync(resolve(ROOT, path), "utf8")
  const out = new Map<string, Record<string, number>>()
  for (const line of text.split("\n")) {
    const m = /^([a-z_]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
    if (!m) continue
    if (!TYPES.includes(m[1])) continue
    // type edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL bindOK bind? bindFAIL causeOK causeFAIL
    out.set(m[1], {
      edges: Number(m[2]), resolved: Number(m[3]), collRes: Number(m[4]),
      amb: Number(m[5]), ambKind: Number(m[6]), unresolved: Number(m[7]),
      extOK: Number(m[8]), extQ: Number(m[9]), extFAIL: Number(m[10]),
      bindOK: Number(m[11]), bindQ: Number(m[12]), bindFAIL: Number(m[13]),
      causeOK: Number(m[14]), causeFAIL: Number(m[15]),
    })
  }
  return out
}

const wholePath = `${DIR}/${REPO}-whole.txt`
const aPath = `${DIR}/${REPO}-half-a.txt`
const bPath = `${DIR}/${REPO}-half-b.txt`
for (const p of [wholePath, aPath, bPath]) {
  if (!existsSync(resolve(ROOT, p))) { console.error(`MISSING ${p}`); process.exit(1) }
}
const whole = table(wholePath)
const halfA = table(aPath)
const halfB = table(bPath)

const rows: any[] = []
for (const t of TYPES) {
  const w = whole.get(t)
  const a = halfA.get(t)
  const b = halfB.get(t)
  if (!w || !a || !b) { console.error(`no row for ${t}`); process.exit(1) }
  const row: any = { type: t }
  for (const k of BUCKETS) row[k] = { whole: w[k] ?? 0, split: (a[k] ?? 0) + (b[k] ?? 0), delta: (a[k] ?? 0) + (b[k] ?? 0) - (w[k] ?? 0) }
  row.resolvedWhole = w.resolved
  row.resolvedSplit = (a.resolved ?? 0) + (b.resolved ?? 0)
  row.resolvedDelta = row.resolvedSplit - row.resolvedWhole
  row.unresolvedDelta = ((a.unresolved ?? 0) + (b.unresolved ?? 0)) - (w.unresolved ?? 0)
  row.ambDelta = ((a.amb ?? 0) + (b.amb ?? 0)) - (w.amb ?? 0)
  row.edgesDelta = ((a.edges ?? 0) + (b.edges ?? 0)) - (w.edges ?? 0)
  rows.push(row)
}

const out = {
  instrument: "html-straddle-control",
  repo: REPO,
  what: "ONE repository of the admitted population, measured WHOLE (one project scope) and SPLIT (two project scopes over the same files). The DELTA is the straddle effect on the arm's resolution buckets.",
  calls: { whole: wholePath, halfA: aPath, halfB: bPath },
  rows,
}
writeFileSync(resolve(ROOT, `${DIR}/${REPO}-straddle.json`), JSON.stringify(out, null, 2) + "\n")

console.log(`THE STRADDLE CONTROL — repo ${REPO}: whole vs split, the same files.`)
console.log(`  type          edges(whole/split/Δ)      resolved(whole/split/Δ)     unresolvedΔ   ambΔ`)
for (const r of rows) {
  console.log(
    `  ${r.type.padEnd(12)} ${String(r.edges.whole).padStart(7)}/${String(r.edges.split).padStart(6)}/${String(r.edgesDelta).padStart(4)}` +
    `   ${String(r.resolvedWhole).padStart(7)}/${String(r.resolvedSplit).padStart(6)}/${String(r.resolvedDelta).padStart(4)}` +
    `   ${String(r.unresolvedDelta).padStart(10)} ${String(r.ambDelta).padStart(6)}`,
  )
}
const totW = rows.reduce((n, r) => n + r.resolvedWhole, 0)
const totS = rows.reduce((n, r) => n + r.resolvedSplit, 0)
console.log(`  TOTAL resolved: whole ${totW} · split ${totS} · Δ ${totS - totW}`)
console.log(`  written: ${DIR}/${REPO}-straddle.json`)
