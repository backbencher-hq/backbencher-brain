// HCL lane — STORE DETERMINISM (adapted from xml-lane's validation/m14/fixtures/xml/store-determinism.mts,
// same three arms and comparison; only the extension list and the temp prefix differ): does the same file set, indexed in a different ORDER, produce the
// same bindings?
//
// WHY. `xml contains` binds 95.4% / same-file 87.0% / **cross-file 8.5%** in the libxslt store run,
// while the gate's exact intent test reads `twin 0` over the whole corpus. One candidate for that
// disagreement is the EAGER insert-time resolver being only as good as the table's state when a
// given batch runs — and if resolution is order-dependent then the graph is NONDETERMINISTIC: the
// same corpus indexed in a different file order would write different `target_symbol_id`s. That
// would outrank every lane's residual, so it is tested directly rather than argued.
//
// THE TEST. The same files are copied into three separate scratch projects (a fresh project id per
// arm, so no arm can see another's rows), and indexed with an EXPLICIT file list — `skipDiscovery`
// makes the order this file's own choice:
//
//   A  sorted order   (the control)
//   B  reversed order (the same set, a different dispatch order)
//   C  sorted order with BB_TEST_FORCE_EDGE_RESOLVE=1 (the indexer's own A/B arm: eager resolution
//      where the pool path would otherwise defer it)
//
// The comparison is structural, not by row id: a row is keyed by
// (source file relative path, relationship type, target_external, line) and its value is
// (target file relative path, target symbol name). Symbol and file ids are project-local, so ids
// cannot be compared across arms and are not.
//
// HONEST LIMITS, stated before the numbers: three arms cannot prove determinism in general; it can
// only fail to falsify it. A different order under a DIFFERENT concurrency or a different file set
// is not covered here. The claim this supports is exactly "this set, these three orders".
//
// USAGE
//   HOME=$PWD/.tmp-xml/home bun validation/m14/fixtures/xml/store-determinism.mts
//   BB_DET_REPO=libxslt BB_DET_FILES=400 BB_DET_OUT=... bun ...
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../../src/cli/index"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_DET_REPO ?? "libxslt"
const WANT = Number(process.env.BB_DET_FILES ?? "400")
const OUT = process.env.BB_DET_OUT ?? ""
const EXT_RE = /\.(tf|tfvars|hcl|tofu)$/

// ── discovery, the same admission the store probe and this lane's census use
const repoDir = path.join(CR, REPO)
const tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0").filter(Boolean)
  .filter((rel) => EXT_RE.test(rel.toLowerCase()))
  .filter((rel) => { try { return statSync(path.join(repoDir, rel)).size <= 512 * 1024 } catch { return false } })
  .sort()
const chosen = tracked.slice(0, WANT)
if (chosen.length === 0) { console.error(`no files under ${repoDir}`); process.exit(2) }

const { indexProjectParallel } = await import("../../../../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../../../../src/brain/database")

type Binding = string
type ArmResult = {
  arm: string; order: string; projectId: string; root: string; files: number; indexMs: number
  rows: number; storedRows: number; bound: number; unbound: number; duplicateKeys: number; duplicateIds: number
  ambiguousExamples: { key: string; value: string; rid: string }[]
  byType: Record<string, { rows: number; bound: number; unbound: number }>
  map: Map<string, Binding>
  typeOf: Map<string, string>
}

async function runArm(label: string, order: string, orderList: string[], forceEager: boolean): Promise<ArmResult> {
  const root = mkdtempSync(path.join(tmpdir(), `bb-hcl-det-${label}-`))
  // The tree is identical in every arm; only the index ORDER differs, which is what makes the arms
  // comparable. A separate root per arm gives a separate project id and therefore a separate store.
  for (const rel of orderList) {
    const dest = path.join(root, REPO, rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    cpSync(path.join(repoDir, rel), dest)
  }
  const PID = getProjectId(root)
  const prev = process.env.BB_TEST_FORCE_EDGE_RESOLVE
  if (forceEager) process.env.BB_TEST_FORCE_EDGE_RESOLVE = "1"
  const t0 = Date.now()
  try {
    await indexProjectParallel(PID as any, root, {
      skipDiscovery: true,
      files: orderList.map((rel) => path.join(root, REPO, rel)),
    } as any)
  } finally {
    if (prev === undefined) delete process.env.BB_TEST_FORCE_EDGE_RESOLVE
    else process.env.BB_TEST_FORCE_EDGE_RESOLVE = prev
  }
  const indexMs = Date.now() - t0
  const raw = await BrainDatabase.getRawInstance(PID as any)

  const fileRows = raw.prepare(`SELECT id, path FROM brain_file WHERE project_id = ?`).all(PID) as any[]
  const fileOf = new Map<string, string>()
  for (const f of fileRows) {
    const p = String(f.path ?? "")
    const at = p.indexOf(REPO + "/")
    fileOf.set(String(f.id), at >= 0 ? p.slice(at + REPO.length + 1) : path.basename(p))
  }
  // NO JOIN. The first version joined `brain_symbol` twice to read the endpoints and the join FANNED
  // OUT on duplicated symbol rows: 2,087 joined rows for 1,831 distinct relationship ids on a
  // 100-file arm, and every ambiguous key was the SAME relationship id repeated — a probe artifact
  // that manufactured 482 phantom "differences" before it was caught. The row id is the store's own
  // identity and it already embeds the source file, the source symbol, the line, the target and the
  // type, so the endpoints are looked up in maps instead of joined.
  const symRows = raw.prepare(`SELECT id, name, file_id FROM brain_symbol WHERE project_id = ?`).all(PID) as any[]
  const symOf = new Map<string, { name: string; file: string }>()
  for (const s of symRows) symOf.set(String(s.id), { name: String(s.name ?? ""), file: String(s.file_id ?? "") })

  const storedRows = (raw.prepare(`SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ?`).get(PID) as any)?.c ?? 0
  const rows = raw.prepare(`
    SELECT id AS rid, relationship_type AS type, target_external AS target_external,
           line_number AS line, target_symbol_id AS tgt_id
    FROM brain_relationship WHERE project_id = ?
  `).all(PID) as any[]

  const map = new Map<string, Binding>()
  const typeOf = new Map<string, string>()
  const byType: Record<string, { rows: number; bound: number; unbound: number }> = {}
  let bound = 0, unbound = 0, duplicateKeys = 0, duplicateIds = 0
  const ridSeen = new Set<string>()
  const ambiguousExamples: { key: string; value: string; rid: string }[] = []
  for (const r of rows) {
    const type = String(r.type ?? "")
    const b = (byType[type] ??= { rows: 0, bound: 0, unbound: 0 })
    b.rows++
    if (r.tgt_id === null || r.tgt_id === undefined) { b.unbound++; unbound++ } else { b.bound++; bound++ }
    const rid = String(r.rid ?? "")
    if (ridSeen.has(rid)) duplicateIds++
    ridSeen.add(rid)
    // CROSS-ARM IDENTITY: the row id minus the project prefix. The id is
    // `${projectId}:rel:${sourceIdentity}:${targetName}:${relType}:${relLine}` and every component
    // after the prefix is a property of the FILE, not of the store's row numbering.
    // The row id is `${projectId}:rel:${sourceId}:${target}:${type}:${line}` and `sourceId` is
    // ITSELF prefixed with the project id (a file-level source symbol), so stripping the prefix
    // once left the project id in the middle of the key and NO key matched across arms — the
    // second version of this probe therefore compared 0 rows. Every occurrence is removed.
    const key = rid.split(`${PID}:`).join("")
    const t = r.tgt_id === null || r.tgt_id === undefined ? null : symOf.get(String(r.tgt_id))
    const val = t === null || t === undefined
      ? "(unbound)"
      : `${fileOf.get(t.file) ?? "?"}\u0000${t.name}`
    if (map.has(key) && map.get(key) !== val) {
      duplicateKeys++
      if (ambiguousExamples.length < 5) ambiguousExamples.push({ key, value: val, rid })
    }
    map.set(key, val)
    typeOf.set(key, type)
  }
  return { arm: label, order, projectId: String(PID), root, files: orderList.length, indexMs, rows: rows.length, storedRows, bound, unbound, duplicateKeys, duplicateIds, ambiguousExamples, byType, map, typeOf }
}

const A = await runArm("A", "sorted", chosen, false)
const B = await runArm("B", "reversed", [...chosen].reverse(), false)
const C = await runArm("C", "sorted+FORCE_EAGER", chosen, true)

function compare(x: ArmResult, y: ArmResult) {
  let common = 0, differing = 0, onlyX = 0, onlyY = 0
  const examples: string[] = []
  const differingByType: Record<string, number> = {}
  for (const [k, v] of x.map) {
    if (!y.map.has(k)) { onlyX++; continue }
    common++
    const w = y.map.get(k)!
    if (w !== v) {
      differing++
      const t = x.typeOf.get(k) ?? "(unknown)"
      differingByType[t] = (differingByType[t] ?? 0) + 1
      if (examples.length < 5) examples.push(`${k.replace(/\u0000/g, " | ")}   ${x.arm}=${v.replace(/\u0000/g, " | ")}   ${y.arm}=${w.replace(/\u0000/g, " | ")}`)
    }
  }
  for (const k of y.map.keys()) if (!x.map.has(k)) onlyY++
  return { compared: common, differing, differingByType, onlyInX: onlyX, onlyInY: onlyY, examples }
}

const report = {
  instrument: "xml store determinism — same file set, three index orders, bindings compared structurally",
  repo: REPO, filesRequested: WANT, filesUsed: chosen.length,
  admission: "git-tracked, xml-family suffix, <= 512 KiB, sorted; arms B and C use the SAME set",
  arms: [A, B, C].map((a) => ({ arm: a.arm, order: a.order, projectId: a.projectId.slice(0, 12), files: a.files, indexMs: a.indexMs, rows: a.rows, bound: a.bound, unbound: a.unbound, distinctRowKeys: a.map.size, storedRows: a.storedRows, distinctRowIds: a.map.size, duplicateKeysWithDifferentValue: a.duplicateKeys, duplicateIds: a.duplicateIds, ambiguousExamples: a.ambiguousExamples, byType: a.byType })),
  comparisons: {
    "A_vs_B_sorted_vs_reversed": compare(A, B),
    "A_vs_C_eager_vs_deferred": compare(A, C),
    "B_vs_C": compare(B, C),
  },
  reading: {
    determinism: "differing === 0 and onlyInX === 0 and onlyInY === 0 means the same file set produced the same bindings under this order change — order-independent for these three arms, which is the test the hypothesis needed. Any non-zero `differing` is a store determinism defect and outranks every lane's residual.",
    identity: "the comparison key is the row id minus the project prefix (it embeds the source file and symbol, the line, the target and the type), and the endpoints are read from maps, NOT joined — the join fanned out on duplicated symbol rows and manufactured 482 phantom differences in the first version of this probe. `duplicateIds` reports rows sharing an id inside one arm if that ever happens.",
    unboundIsNotDeterminism: "A row that is unbound in one arm and bound in another counts as `differing` here, so the two questions are not confused.",
  },
  limits: "Three arms cannot prove determinism; they can fail to falsify it. Different concurrency, a different file set, or a partially-populated store are NOT covered.",
}
const text = JSON.stringify(report, null, 2)
if (OUT) writeFileSync(OUT, text)
console.log(text)
// the scratch trees and the per-arm project databases are this probe's own residue
const { homedir } = await import("node:os")
for (const a of [A, B, C]) {
  rmSync(a.root, { recursive: true, force: true })
  rmSync(path.join(homedir(), ".bb", "projects", a.projectId), { recursive: true, force: true })
}
