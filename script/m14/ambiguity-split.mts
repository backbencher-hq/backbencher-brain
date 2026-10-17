// THE AMBIGUITY COLUMN, SPLIT — TRACKED COPY (task-96, 2026-10-14), promoted from gitignored scratch
// because the record quotes its numbers and a gitignored instrument that produces quoted figures cannot be
// audited or re-run by a successor. Same classification as `.tmp-pb/ambsplit.mts`; the aggregator is FIXED.
//
// THE DEFECT THIS COPY FIXES. The classifier emits FOUR verdicts:
//     intended · sameFileUnique(determinate) · sameFileMulti(GENUINE) · crossFile(s.id picks)
// and the old aggregator tested for `endsWith("|sameFileOffLine")` — a string no verdict produces. So the
// printed `sameFileOffLine` was STRUCTURALLY ZERO and the printed `crossFile` was
// determinate + GENUINE + crossFile(s.id picks) summed into one column. Every share quoted from that line
// (php 80.0% · python 81.6% · java 77.0% · javascript 71.6%) is an UPPER BOUND on the arbitrary class.
//
// Usage:
//   LANES_JSON='[["powershell",["ps1","psm1","psd1"],0]]' npx tsx script/m14/ambiguity-split.mts
//   (cap 0 = the whole population the walk finds; a positive cap STRIDES and prints SAMPLED — a strided
//    share is NOT COMPARABLE to a whole-population one and the line says so.)
// AGGREGATOR FIXED 2026-10-14 (task-96): the four verdicts the classifier emits are now the four
//
// The store binds an ambiguous name with `LIMIT 1 … ORDER BY s.id`, i.e. the LEXICOGRAPHICALLY smallest
// line rather than the intended symbol (the control arm measures 37,318 of 49,729 such picks WRONG — a
// RATE, not a verdict on any edge). So `amb(decl)` has THREE outcomes, and this instrument separates them:
//
//   intended        a declaration of the key is IN THE EDGE'S OWN FILE ON THE EDGE'S OWN LINE
//   sameFileOffLine a declaration is in the edge's own file, but not on the edge's line (for a reference
//                   type this is the EXPECTED shape — the type is declared elsewhere in the same file)
//   crossFile       NO declaration in the edge's own file: the store's tie-break is choosing between
//                   OTHER FILES, which is where the lexicographic pick is arbitrary
//
// PROTOBUF RUNS AS THE CONTROL: its split is already known (contains 2,205 all intended · uses 1,028
// same-file · 37 cross-file), so if this instrument does not reproduce it, its other lanes' numbers are
// not admissible either.
import { readdirSync, statSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
const REPO = (import.meta as any).dir
  ? path.resolve(path.join((import.meta as any).dir, "..", ".."))
  : path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."))
const CR = "$HOME/fixtures/repositories"
const ASTEngine: any = (await import(`${REPO}/src/ast/engine.ts`)).ASTEngine
const rule: any = await import(`${REPO}/script/m14/incoming-rule.ts`)
const LANES: Array<[string, string[], number]> = JSON.parse(process.env.LANES_JSON || "[]") // [lane, exts, cap] cap 0 = all

const byExt = new Map<string, string[]>()
for (const repo of readdirSync(CR).sort()) {
  const dir = path.join(CR, repo)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const walk = (d: string, depth = 0): void => {
    if (depth > 24) return
    let ents: string[] = []
    try { ents = readdirSync(d) } catch { return }
    for (const e of ents) {
      const p = path.join(d, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (e !== "node_modules" && e !== ".git") walk(p, depth + 1) }
      else { const i = e.lastIndexOf("."); if (i > 0) { const x = e.slice(i + 1); const a = byExt.get(x) ?? []; a.push(p); byExt.set(x, a) } }
    }
  }
  walk(dir)
}
const repoOf = (f: string) => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])

for (const [lane, exts, cap] of LANES) {
  const all: string[] = []
  for (const x of exts) all.push(...(byExt.get(x) ?? []))
  all.sort()
  const step = cap > 0 ? Math.max(1, Math.ceil(all.length / cap)) : 1
  const files = cap > 0 ? all.filter((_, i) => i % step === 0) : all

  const decl = new Map<string, Map<string, number>>()
  const declPos = new Map<string, Map<string, Array<{ file: string; line: number | null }>>>()
  const declaredInFile = new Map<string, Set<string>>()
  type E = { repo: string; file: string; type: string; target: string; line: number | null }
  const edges: E[] = []
  const B = 12
  for (let i = 0; i < files.length; i += B) {
    const out = await Promise.all(files.slice(i, i + B).map(async (f) => {
      try { return { f, r: await ASTEngine.parseFile(f, readFileSync(f, "utf8"), { projectRoot: repoOf(f) }) } } catch { return { f, r: null } }
    }))
    for (const { f, r } of out) {
      if (!r) continue
      const repo = repoOf(f)
      let d = decl.get(repo); if (!d) decl.set(repo, (d = new Map()))
      let dp = declPos.get(repo); if (!dp) declPos.set(repo, (dp = new Map()))
      let fs = declaredInFile.get(f); if (!fs) declaredInFile.set(f, (fs = new Set()))
      for (const s of r.symbols ?? []) {
        const n = String(s?.name ?? ""); const q = String(s?.qualifiedName ?? "")
        const ln = Number(s?.range?.startLine ?? 0) || null
        for (const key of [n, q]) {
          if (!key) continue
          d.set(key, (d.get(key) ?? 0) + 1); fs.add(key)
          let ps = dp.get(key); if (!ps) dp.set(key, (ps = []))
          ps.push({ file: f, line: ln })
        }
      }
      for (const rel of r.relationships ?? []) {
        edges.push({
          repo, file: f, type: String(rel?.type ?? ""), target: String(rel?.target ?? ""),
          line: typeof rel?.line_number === "number" ? rel.line_number : null,
        })
      }
    }
  }

  const amb = new Map<string, number>()      // type|verdict
  const byBreak = new Map<string, number>()
  const byFiles = new Map<string, number>()
  const total = new Map<string, number>()
  const samples = new Map<string, string[]>()
  for (const e of edges) {
    if (!e.target) continue
    const own = (declaredInFile.get(e.file) ?? new Set()).has(e.target)
    const c: any = rule.classifyEdge(decl.get(e.repo) ?? new Map(), new Map(), e.target, null, { packages: new Set(), files: new Set(), sdkLib: false }, undefined, own)
    total.set(`${e.type}|${c.outcome}`, (total.get(`${e.type}|${c.outcome}`) ?? 0) + 1)
    if (c.outcome !== "ambBoth" && c.outcome !== "ambDeclOnly") continue
    const ps = declPos.get(e.repo)?.get(e.target) ?? []
    const intended = e.line !== null && ps.some((p) => p.file === e.file && p.line === e.line)
    // HOW MANY DECLARATIONS DOES THE EDGE'S OWN FILE HOLD? The resolver prefers the own FILE, so:
    //   exactly one  -> DETERMINATE (the own-file preference settles it, whatever line it is on)
    //   two or more  -> GENUINELY AMBIGUOUS (no rule can pick among them from the edge alone)
    //   none         -> the `s.id` class: the store picks among OTHER FILES by the lexicographically
    //                   smallest id, and a proximity rule is the only thing that could improve it
    const nSame = ps.filter((p) => p.file === e.file).length
    const sameFile = nSame > 0
    const verdict = intended ? "intended" : nSame === 1 ? "sameFileUnique(determinate)" : nSame > 1 ? "sameFileMulti(GENUINE)" : "crossFile(s.id picks)"
    amb.set(`${e.type}|${verdict}`, (amb.get(`${e.type}|${verdict}`) ?? 0) + 1)
    // WHAT A SAME-FILE PROXIMITY RULE WOULD BREAK: a cross-file binding is not automatically wrong —
    // for `exports` a re-export legitimately names another file's symbol, and `contains` binds a
    // parent to members that may live elsewhere. Counted, not judged, per type.
    if (verdict.startsWith("crossFile")) {
      const k = `${e.type}|WOULD-BREAK(a same-file rule cannot see the cross-file answer)`
      byBreak.set(k, (byBreak.get(k) ?? 0) + 1)
    }
    // THE LAST NUMBER: how many DISTINCT FILES hold this edge's candidates? A proximity rule has signal
    // only at 2+; at exactly 1 every candidate shares ONE other file and NO rule can choose — the floor.
    if (verdict === "crossFile(s.id picks)") {
      const nf = new Set(ps.map((x) => x.file)).size
      const bucket = nf <= 1 ? "1 file (FLOOR: no rule can choose)" : nf === 2 ? "2 files" : nf <= 5 ? "3-5 files" : nf <= 20 ? "6-20 files" : "21+ files"
      byFiles.set(`${e.type}|${bucket}`, (byFiles.get(`${e.type}|${bucket}`) ?? 0) + 1)
      if (nf === 2) {
        const a = samples.get("TWO-FILES") ?? []
        if (a.length < 4) a.push(`${path.relative(CR, e.file)}:${e.line ?? "?"} → ${e.target} (decls=${ps.length}, files=2)`)
        samples.set("TWO-FILES", a)
      }
      const a = samples.get(`${lane}|${e.type}`) ?? []
      if (a.length < 5) a.push(`${path.relative(CR, e.file)}:${e.line ?? "?"} → ${e.target} (decls=${ps.length}, files=${new Set(ps.map((p) => p.file)).size})`)
      samples.set(`${lane}|${e.type}`, a)
    }
  }
  // ── THE AGGREGATOR, FIXED 2026-10-14 (task-96). It used to read:
  //      for (const [k, v] of amb) { if (k.endsWith("|intended")) i1 += v;
  //                                  else if (k.endsWith("|sameFileOffLine")) i2 += v; else i3 += v }
  //    while the classifier above emits FOUR verdicts and NONE of them is `sameFileOffLine`:
  //      intended · sameFileUnique(determinate) · sameFileMulti(GENUINE) · crossFile(s.id picks)
  //    So `i2` was STRUCTURALLY ZERO and `i3` — printed as `crossFile` — was
  //      determinate + GENUINE + crossFile(s.id picks) summed into one column.
  //    THE FIX IS HERE AND NOT IN THE VERDICTS: the producer's four classes are the actionable set
  //    (determinate is settled by the resolver's own-file preference; GENUINE is not), so renaming
  //    them to satisfy the old string would put the LESS informative classification back.
  const sum = (p: string) => [...amb].filter(([k]) => k.startsWith(p + "|")).reduce((a, [, v]) => a + v, 0)
  const ambTotal = [...total].filter(([k]) => /ambBoth|ambDeclOnly/.test(k)).reduce((a, [, v]) => a + v, 0)
  const cls = (name: string) => [...amb].filter(([k]) => k.endsWith("|" + name)).reduce((a, [, v]) => a + v, 0)
  const i1 = cls("intended")
  const iDet = cls("sameFileUnique(determinate)")
  const iGen = cls("sameFileMulti(GENUINE)")
  const iCross = cls("crossFile(s.id picks)")
  const iOffLine = iDet + iGen          // the OLD coarse class, RECOVERED — see the header
  // A VOCABULARY GUARD: a verdict this aggregator does not know must FAIL LOUDLY rather than be
  // silently summed into a catch-all. This is the defect being fixed, caught at the source.
  let unknown = 0
  for (const [k, v] of amb) if (!/\|(intended|sameFileUnique\(determinate\)|sameFileMulti\(GENUINE\)|crossFile\(s\.id picks\))$/.test(k)) { unknown += v; console.error(`  !! UNKNOWN VERDICT not matched by this aggregator: ${k} (${v})`) }
  console.log(`\n### ${lane}   POPULATION: files ${files.length}/${all.length}${cap > 0 ? " (STRIDE — SAMPLED, NOT COMPARABLE to a whole-population share)" : " (WHOLE POPULATION)"} · edges ${edges.length}`)
  console.log(`amb(decl) ${ambTotal} = intended ${i1} + determinate ${iDet} + GENUINE ${iGen} + s.id-only/crossFile ${iCross}`)
  console.log(`   self-check: ${i1 + iDet + iGen + iCross} of ${ambTotal} ambiguous edges classified${unknown ? ` — ${unknown} UNKNOWN` : " (exact)"}`)
  console.log(`   OLD COARSE CLASS, RECOVERED: sameFileOffLine = determinate + GENUINE = ${iOffLine}`)
  console.log(`   BEFORE THIS FIX the aggregator printed: intended ${i1} + sameFileOffLine 0 + **crossFile ${i1 + iDet + iGen + iCross}**`)
  console.log(`   => the printed \"crossFile\" was ${iCross > 0 ? ((i1 + iDet + iGen + iCross) / iCross).toFixed(2) + "x" : "n/a"} the measured s.id-only class`)
  for (const [k, v] of [...amb].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`   ${k.padEnd(38)} ${v}`)
  console.log(`   DISTINCT-FILE DISTRIBUTION OF THE s.id-ONLY CLASS:`)
  for (const [k, v] of [...byFiles].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`      ${k.padEnd(64)} ${v}`)
  const tot = [...byFiles].reduce((a, [, v]) => a + v, 0)
  const floor = [...byFiles].filter(([k]) => k.includes("FLOOR")).reduce((a, [, v]) => a + v, 0)
  console.log(`      TOTAL s.id-only ${tot} · 1-file FLOOR ${floor} (${tot ? (100 * floor / tot).toFixed(1) : "-"}%) · multi-file ${tot - floor}`)
  if (samples.get("TWO-FILES")) { console.log(`   TWO-FILE SAMPLES (the smallest reachable case):`); for (const x of samples.get("TWO-FILES")!) console.log(`      ${x}`) }
  console.log(`   WOULD-BREAK counts (a same-file proximity rule vs the cross-file class it cannot see):`)
  for (const [k, v] of [...byBreak].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`      ${k.padEnd(72)} ${v}`)
  for (const [k, v] of samples) { console.log(`   crossFile samples ${k}:`); for (const s of v) console.log(`      ${s}`) }
}
