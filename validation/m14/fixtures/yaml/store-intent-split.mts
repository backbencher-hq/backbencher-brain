// YAML — STORE-SIDE INTENT SPLIT, the clause-4 evidence the completion package says is NOT done.
//
// WHY. Clause 4 asks whether a resolved edge that had MORE THAN ONE declaration to choose from was
// bindable DETERMINATELY. The gate answers it from the MODEL (`resolvedAmongCollision` / `ofWhich`,
// and a whole-population BINDING INTENT table), and yaml's model-side reading is
// `contains 1,380,046 intended / 0 sameFileUnproven / 0 arbitraryTwin / 0 nothing`. The STRONGER
// test puts the population through a real STORE and reads what production actually chose off
// `brain_relationship.target_symbol_id`. That is what json/hcl/xml did for their lanes and what this
// instrument does for yaml.
//
// WHAT IT MEASURES, and the two rules it refuses to bend:
//
//   * ONE PROJECT PER REPOSITORY. The gate resolves PER PROJECT (the repository a file belongs to),
//     so a single temp root holding every repo would manufacture cross-repo collisions that
//     production cannot see. Each repository is copied to its own root and indexed as its own
//     project, which is also what makes this instrument's `collision` count comparable with the
//     gate's `ofWhich`.
//   * THE LINE TEST ONLY WHERE THE EDGE LINE IS THE TARGET SYMBOL'S LINE. The gate's own constant
//     (`incoming-gate.ts:502`, `{contains, exports}`) is restated here and the instrument ALSO prints
//     the measured per-type own-file+own-line share, so a drift in that constant shows up in this
//     artifact instead of hiding behind a copied list.
//
// WHAT IT COUNTS, per type:
//   edges · bound (target_symbol_id non-null) · intended (own file AND own line) · sameFileOffLine ·
//   arbitraryTwin (only another file answers) · unbound · collision rows (>= 2 declarations answer to
//   the target) and the collision split (intended / sameFileOffLine / arbitraryTwin / unbound).
//
// TWO RULES THIS INSTRUMENT GOT WRONG ON ITS FIRST RUN, both stated because each one changed a
// number and both were caught by checking against the gate rather than by reading the code:
//
//   (1) THE LINE TEST USES THE EDGE'S LINE, NOT THE SOURCE SYMBOL'S. A `contains` edge is written on
//       the TARGET symbol's line while its SOURCE is the parent, so `src.line === tgt.line` is false
//       for ordinary containment and read `intended 348 of 3,271` on boundary against the gate's
//       1,380,046 of 1,380,046. The gate's own test is `line IS the declaration's line
//       (in the edge's own file)`; this instrument now uses exactly that.
//   (2) THE COLLISION TEST USES THE MODEL'S TARGET, NOT THE STORE'S DISPATCHED NAME. The store's
//       `target_external` for a `contains` row is the LEAF name (`on`, `push`, `item_0`), which many
//       documents declare, so a bare-name test read 1,056 collisions in boundary where the gate reads
//       0 — the model's contains target is the QUALIFIED path
//       (`.github.workflows.security-scan.on.push`), which is unique unless a document declares the
//       same key twice. The bound symbol's `qualified_name` IS that target, so a contains row is a
//       collision when the project declares that qualified name more than once — the duplicate-key
//       shape the gate's own `selfTest` pins (`resolvedAmongCollision 1`, `ambiguousByDecl 0`).
//
// CROSS-CHECK (`BB_SIS_MODEL=1`, off by default because it doubles the run): the same drawn files
// are parsed through `pool-worker`'s model path and the per-type EDGE counts are printed beside the
// store's ROW counts, so a store that lost or duplicated rows shows up as a named delta instead of
// hiding behind a plausible table.
//
// ONE RUN, ONE INDEX PER REPO. The store is order- and run-dependent (the lane's §5p finding), so
// every figure is a single run and is labelled with the population it indexed.
//
// USAGE
//   npx tsx validation/m14/fixtures/yaml/store-intent-split.mts
//   BB_SIS_REPOS=kubernetes,ansible   bound to named repositories
//   BB_SIS_LIMIT=300                  bound the file count per repository
//   BB_SIS_OUT=path.json              write the report
//   BB_SIS_KEEP=1                     keep the temp trees and the data dir

import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs"
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Node } from "web-tree-sitter"
import { tmpdir } from "node:os"
import path from "node:path"

const REPO_ROOT = process.env.BB_REPO || path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_SIS_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const LIMIT = Number(process.env.BB_SIS_LIMIT ?? "0")
const OUT = process.env.BB_SIS_OUT ?? ""
const EXT_RE = /\.(yaml|yml)$/
const SIZE_CAP = 1024 * 1024

/** The gate's own constant for where a line-based intent test is sound (`incoming-gate.ts:502`). */
const LINE_IS_TARGET_LINE: ReadonlySet<string> = new Set(["contains", "exports"])

const DATA_DIR = path.join(REPO_ROOT, ".tmp-yaml", "bb-data")
mkdirSync(DATA_DIR, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR

type TypeCounters = {
  edges: number; bound: number; unbound: number; sameFile: number; otherFile: number
  intended: number; sameFileOffLine: number; arbitraryTwin: number
  collisions: number; collIntended: number; collSameFileOffLine: number; collArbitraryTwin: number; collUnbound: number
}
const blank = (): TypeCounters => ({
  edges: 0, bound: 0, unbound: 0, sameFile: 0, otherFile: 0,
  intended: 0, sameFileOffLine: 0, arbitraryTwin: 0,
  collisions: 0, collIntended: 0, collSameFileOffLine: 0, collArbitraryTwin: 0, collUnbound: 0,
})

const { indexProjectParallel, ParallelIndexerConfig } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)
const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
const WITH_MODEL = process.env.BB_SIS_MODEL === "1"
const modelEdges: Record<string, number> = {}
// The MODEL's distinct (source, target) pairs, so the store's distinct-pairs column has something
// to be compared with. Without it a negative store delta cannot be told apart from the model
// emitting the same pair twice, and those are different findings: one is a store LOSS, the other is
// an analyzer emitting a duplicate edge. The yaml model is dedup-free by construction (381 pairs
// for 381 `contains` edges on boundary's build.yml), but "by construction" is not a measurement.
const modelPairs = new Map<string, Set<string>>()

const temp = mkdtempSync(path.join(tmpdir(), "bb-yaml-sis-"))
const perType: Record<string, TypeCounters> = {}
const seenPair = new Map<string, Set<string>>()
const collisionSnapshots: any[] = []
let reposIndexed = 0, filesIndexed = 0, indexMs = 0
const repoFailures: string[] = []
// FILES PRODUCTION'S OWN DISCOVERY REFUSES, and they are EXCLUDED rather than parsed. This is the
// correction of a phantom finding: on its first run this instrument drew every tracked `.yaml`/
// `.yml` under the cap, while the indexer it was measuring refuses its built-in `skipPatterns`
// (lockfiles, `.generated.`, `generated/`, `deps/`, `build/`, …). MEASURED over the whole corpus:
// **53 of 18,364 admitted files**, but they carry **101,658 `contains` edges** — 7.4% of the lane's
// 1,380,046 — essentially all of it `pnpm-lock.yaml` (vault 17,151 · consul 15,785 · nomad 15,292 ·
// gql-graphql-eslint 14,974 · element-plus 13,470 · shadcn-svelte 9,993 · vue-core 5,610 ·
// svelte 4,424). The first run therefore read store 13,162 against model 24,126 on 115 files and
// reported a **-10,964 STORE LOSS that was entirely my own population**: `ui/pnpm-lock.yaml` had
// model 15,785 · store 0 because the indexer never wrote a `brain_file` row for it at all. Parsing
// a file the product refuses says nothing about the store, so the admission is applied here and the
// count of refusals is REPORTED instead of silently dropped.
const refusedByDiscovery: { file: string; pattern: string }[] = []

try {
  for (const name of readdirSync(CR).sort()) {
    if (REPOS.length > 0 && !REPOS.includes(name)) continue
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    const admitted: string[] = []
    for (const rel of tracked) {
      if (!EXT_RE.test(rel.toLowerCase())) continue
      try { if (statSync(path.join(dir, rel)).size > SIZE_CAP) continue } catch { continue }
      const abs = path.join(dir, rel)
      const refused = (ParallelIndexerConfig as any).skipPatterns.find((p: RegExp) => p.test(abs))
      if (refused) { refusedByDiscovery.push({ file: `${name}/${rel}`, pattern: String(refused) }); continue }
      admitted.push(rel)
    }
    const drawn = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
    if (drawn.length === 0) continue

    const root = path.join(temp, name)
    for (const rel of drawn) {
      const dest = path.join(root, rel)
      mkdirSync(path.dirname(dest), { recursive: true })
      cpSync(path.join(dir, rel), dest)
    }

    const PID = getProjectId(root)
    const t0 = Date.now()
    try {
      await indexProjectParallel(PID as any, root, {})
    } catch (e: any) {
      repoFailures.push(`${name}: index threw ${e?.message ?? e}`)
      continue
    }
    indexMs += Date.now() - t0
    const raw = await BrainDatabase.getRawInstance(PID as any)

    // ---- declarations, by id and by the two keys the resolver's own rule uses ----------------------
    const symOf = new Map<string, { name: string; qname: string; file: string; line: number | null; kind: string }>()
    const byName = new Map<string, Array<{ file: string; line: number | null; qname: string }>>()
    const byQName = new Map<string, Array<{ file: string; line: number | null; qname: string }>>()
    if (WITH_MODEL) {
      for (const rel of drawn) {
        try {
          const res: any = await parseFile(path.join(root, rel), root, { projectRoot: root } as any)
          for (const e of res?.relationships ?? []) {
            const t = String(e?.type ?? "")
            modelEdges[t] = (modelEdges[t] ?? 0) + 1
            const set = modelPairs.get(t) ?? (modelPairs.set(t, new Set()), modelPairs.get(t)!)
            set.add(`${String(e?.source ?? "")}|${String(e?.target ?? "")}`)
          }
        } catch { /* a file the model refuses is reported by its absence from the model column */ }
      }
    }
    for (const s of raw.prepare(`SELECT id, name, qualified_name, file_id, line_start, symbol_type FROM brain_symbol WHERE project_id = ?`).all(PID) as any[]) {
      const rec = {
        name: String(s.name ?? ""), qname: String(s.qualified_name ?? ""),
        file: String(s.file_id ?? ""), line: s.line_start ?? null, kind: String(s.symbol_type ?? ""),
      }
      symOf.set(String(s.id), rec)
      const push = (m: Map<string, any[]>, k: string) => { const l = m.get(k); if (l) l.push(rec); else m.set(k, [rec]) }
      if (rec.name.length > 0) push(byName, rec.name)
      if (rec.qname.length > 0) push(byQName, rec.qname)
    }

    const rows = raw.prepare(`
      SELECT id, relationship_type AS type, source_symbol_id AS src, target_symbol_id AS tgt,
             target_external AS target, line_number AS line
      FROM brain_relationship WHERE project_id = ?`).all(PID) as any[]

    for (const r of rows) {
      const type = String(r.type ?? "")
      const row = (perType[type] ??= blank())
      row.edges++
      // THE SAME LOGICAL EDGE STORED MORE THAN ONCE. Counted, not assumed: the store is keyed by
      // the row id, which carries a NAME it resolved at insert time, so one (source_symbol_id,
      // target_symbol_id) pair can land twice under two spellings of the same name — measured on
      // boundary's `build.yml` as 637 rows over 381 distinct pairs, and on 2 of 2 repositories so
      // far. This is the column that makes the model-vs-store delta MEANINGFUL once both sides
      // describe the same population: a positive delta is duplication, and it is a store finding.
      const pairSeen = (seenPair.get(type) ?? (seenPair.set(type, new Set()), seenPair.get(type)!))
      pairSeen.add(`${String(r.src ?? "")}|${String(r.tgt ?? "")}`)
      const src = symOf.get(String(r.src ?? ""))
      const tgt = r.tgt === null || r.tgt === undefined ? undefined : symOf.get(String(r.tgt))
      const bound = tgt !== undefined
      const sameFile = bound && src !== undefined && tgt!.file === src.file
      if (bound) { row.bound++; if (sameFile) row.sameFile++; else row.otherFile++ } else row.unbound++
      // THE EDGE'S LINE, against the bound declaration's own line — the gate's exact test.
      const ownLine = bound && sameFile && r.line !== null && r.line !== undefined && tgt!.line !== null && tgt!.line === r.line
      if (LINE_IS_TARGET_LINE.has(type)) {
        if (!bound) { /* unbound */ }
        else if (!sameFile) row.arbitraryTwin++
        else if (ownLine) row.intended++
        else row.sameFileOffLine++
      }

      // ---- how many declarations ANSWER to the MODEL's target, per the resolver's own rule ---------
      const target = String(r.target ?? "")
      let answering: Array<{ file: string; line: number | null; qname: string }>
      if (type === "contains") {
        // The store's target cell for a contains row is the LEAF name; the model's target is the
        // QUALIFIED path, which is what the bound symbol carries (see this file's header, rule 2).
        answering = tgt !== undefined ? (byQName.get(tgt.qname) ?? []) : []
      } else {
        const exact = byQName.get(target) ?? []
        answering = exact.length > 0 ? exact : (byName.get(target) ?? [])
      }
      if (answering.length < 2) continue
      row.collisions++
      if (!bound) row.collUnbound++
      else if (!sameFile) row.collArbitraryTwin++
      else if (ownLine) row.collIntended++
      else row.collSameFileOffLine++
      if (collisionSnapshots.length < 200) {
        collisionSnapshots.push({
          repo: name, type, id: String(r.id), target, edgeLine: r.line ?? null,
          source: src ? { name: src.name, qname: src.qname, file: src.file, line: src.line } : null,
          answering: answering.slice(0, 4),
          boundTo: tgt ? { name: tgt.name, qname: tgt.qname, file: tgt.file, line: tgt.line } : null,
          ownLine,
        })
      }
    }
    reposIndexed++
    filesIndexed += drawn.length
    console.log(`  ${name}: ${drawn.length} files indexed, ${rows.length} relationship rows`)
  }

  // ---- report -------------------------------------------------------------------------------------
  const total = blank()
  for (const r of Object.values(perType)) {
    for (const k of Object.keys(total) as (keyof TypeCounters)[]) total[k] += r[k]
  }
  const report = {
    instrument: "yaml store-side intent split — clause 4 read off brain_relationship.target_symbol_id",
    runLabel: "ONE RUN per repository; the store is order- and run-dependent, so no figure here may be compared across runs without re-running",
    population: { corpusRoot: CR, repos: REPOS.length ? REPOS : "ALL", reposIndexed, filesIndexed, indexMs, dataDir: DATA_DIR },
    scoping: {
      oneProjectPerRepository: "the gate resolves per project (the repository a file belongs to), so each repo is its own root and its own project id",
      lineTestAppliesTo: [...LINE_IS_TARGET_LINE],
      collisionRule: "a row is a collision when the target is answered by >= 2 declarations: an EXACT qualified_name match if any exist, else bare-name matches — the resolver's own two-key rule",
    },
    perType,
    total,
    duplicateRowsByType: Object.fromEntries([...seenPair].map(([t, s]) => [t, (perType[t]?.edges ?? 0) - s.size])),
    collisionSnapshots,      modelEdges: WITH_MODEL ? modelEdges : "(not measured — BB_SIS_MODEL=1 measures the same files through pool-worker)",
    modelDistinctPairs: WITH_MODEL ? Object.fromEntries([...modelPairs].map(([t, s]) => [t, s.size])) : "(not measured)",
      // NOT a defect and NOT part of either column: the files production's own discovery refuses,
      // listed so a reader can see the population the store was asked about instead of inferring it.
      refusedByDiscovery: { count: refusedByDiscovery.length, files: refusedByDiscovery.slice(0, 60) },
    repoFailures,
  }
  const text = JSON.stringify(report, null, 2)
  if (OUT) writeFileSync(OUT, text)

  const w = (s: unknown, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
  console.log("\nSTORE-SIDE INTENT (each repository its own project)")
  console.log(w("type", 14) + w("edges", 12) + w("bound", 12) + w("intended", 11) + w("sameFileOffL", 14) + w("arbitraryTwin", 14) + w("unbound", 10) + w("collisions", 12) + w("collIntend", 12) + w("collTwin", 10) + "collUnbound")
  for (const [type, r] of Object.entries(perType).sort((a, b) => b[1].edges - a[1].edges)) {
    console.log(w(type, 14) + w(r.edges, 12) + w(r.bound, 12) + w(r.intended, 11) + w(r.sameFileOffLine, 14) + w(r.arbitraryTwin, 14) + w(r.unbound, 10) + w(r.collisions, 12) + w(r.collIntended, 12) + w(r.collArbitraryTwin, 10) + String(r.collUnbound))
  }
  console.log(w("TOTAL", 14) + w(total.edges, 12) + w(total.bound, 12) + w(total.intended, 11) + w(total.sameFileOffLine, 14) + w(total.arbitraryTwin, 14) + w(total.unbound, 10) + w(total.collisions, 12) + w(total.collIntended, 12) + w(total.collArbitraryTwin, 10) + String(total.collUnbound))
  console.log("\nDUPLICATE STORE ROWS — the same (source_symbol_id, target_symbol_id) pair stored more than once")
  for (const [t, n] of Object.entries(report.duplicateRowsByType as Record<string, number>)) {
    if (n > 0) console.log(`  ${w(t, 24)} rows ${String(perType[t]?.edges ?? 0).padStart(9)} · distinct pairs ${String(seenPair.get(t)?.size ?? 0).padStart(9)} · duplicated ${String(n).padStart(9)}`)
  }
  if (refusedByDiscovery.length > 0) {
    console.log(`\nREFUSED BY PRODUCTION DISCOVERY — excluded from BOTH columns, so the delta is not this: ${refusedByDiscovery.length} file(s)`)
    for (const r of refusedByDiscovery.slice(0, 12)) console.log(`  ${r.file}  (matches ${r.pattern})`)
  }
  if (WITH_MODEL) {
    console.log("\nMODEL VS STORE — the same files, per type (both sides now the DISCOVERY-ADMITTED population, so a positive delta is duplication and a NEGATIVE delta would be a real loss)")
    const types = [...new Set([...Object.keys(modelEdges), ...Object.keys(perType)])].sort()
    for (const t of types) {
      const m = modelEdges[t] ?? 0, s = perType[t]?.edges ?? 0
      console.log(`  ${w(t, 24)} model ${String(m).padStart(9)} · store ${String(s).padStart(9)} · delta ${String(s - m).padStart(9)}`)
    }
    console.log("\nDISTINCT PAIRS — model edges against store rows, so a LOSS and a DUPLICATE are told apart")
    for (const t of types) {
      const mEdges = modelEdges[t] ?? 0, mPairs = modelPairs.get(t)?.size ?? 0
      const sRows = perType[t]?.edges ?? 0, sPairs = seenPair.get(t)?.size ?? 0
      console.log(`  ${w(t, 24)} model ${String(mEdges).padStart(9)} edges / ${String(mPairs).padStart(9)} pairs · store ${String(sRows).padStart(9)} rows / ${String(sPairs).padStart(9)} pairs · pairs delta ${String(sPairs - mPairs).padStart(9)} · duplicates ${String(sRows - sPairs).padStart(9)}`)
    }
  }
  console.log(`\nrepos ${reposIndexed} · files ${filesIndexed} · index ${(indexMs / 1000).toFixed(1)}s`)
  if (repoFailures.length) console.log(`REPO FAILURES (${repoFailures.length}): ${repoFailures.slice(0, 5).join(" | ")}`)
  if (OUT) console.log(`written to ${OUT}`)
} finally {
  if (process.env.BB_SIS_KEEP !== "1") rmSync(temp, { recursive: true, force: true })
}
