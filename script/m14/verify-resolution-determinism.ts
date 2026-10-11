#!/usr/bin/env bun
/**
 * JAVASCRIPT lane — RESOLUTION DETERMINISM: the same source, indexed twice, must
 * produce the same resolved endpoints.
 *
 * ## Why this exists
 *
 * Two consumers with byte-identical code must get byte-identical answers from
 * `bb_graph`, `bb_impact` and hover. Nothing asserted that, and the lane's own
 * store-resolution instrument carried it as a *limitation* in prose ("the total
 * moves ~8 rows between runs"). A limitation in prose is a defect nobody is
 * asked to fix, so it is a gate here instead: the same deterministic draw is
 * indexed into TWO separate projects, and every `brain_relationship` row is
 * compared across the two runs by its endpoints.
 *
 * ## What the divergence is (measured, and asserted rather than argued)
 *
 * On the pinned 250-file JS draw the row SET is identical — identity, source,
 * symbol set and even the module-aware planner's own decisions agree on all
 * 19,855 rows (this gate checks that, and prints it) — and the disagreement is
 * the resolved TARGET of a handful of `imports` rows whose `target_external` is
 * the `module:item` form: 8, 9, 10, 4 and 28 rows across the five pairs measured
 * so far, a spread that grows with scheduling pressure.
 *
 * The mechanism is insert-time resolution against a PARTIAL symbol table.
 * `parallel-indexer.ts` resolves each relationship's target as it stores the
 * batch (`resolveTargetStmt`, keyed on the target's LEAF name — `zimmerframe:walk`
 * is asked for as `walk`), and for a parallel index the per-batch flushes arrive
 * in worker-completion order. A leaf match with `LIMIT 1` over *the symbols
 * stored so far* therefore answers a question about a table that is still
 * growing, and the answer stands: every later pass (`resolveImportTargets`, the
 * name strategies, the I13 pass) is guarded on `target_symbol_id IS NULL`, which
 * makes a wrong insert-time attachment FINAL.
 *
 * That is what this gate demonstrates rather than describes. Each SIDE of a
 * divergence is classified, from that run's own written tables, against every
 * mechanism that can write a `module:item` target — the insert-time leaf ranking
 * over the prefix that existed when the row was written, the same ranking over
 * the complete table, and the module-aware planner — and the label is printed
 * with the evidence (how many candidate FILES had been written by then). A side
 * that matches none of them is reported as unexplained and fails the gate, so
 * the report cannot be satisfied by mislabelling a defect it does not know.
 *
 * ## Usage
 *
 *   bun run script/m14/verify-resolution-determinism.ts [--corpus=<dir>] [--files=250] [--json=<out>]
 *
 * Each round runs in a CHILD process: the second round must create its own data
 * dir, and `BB_DATA_DIR` is read by modules that have already been imported by
 * the time a single-process second round would run.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILES = Number(arg("files") ?? "250")
const CORPUS = arg("corpus") ?? "$HOME/fixtures/repositories/svelte"
const JSON_OUT = arg("json")
const ONE_ROUND = arg("one-round")

const JS_EXTS = /\.(js|mjs|cjs)$/

/** git-tracked js-family files under one corpus, size-capped, sorted (deterministic). */
function admitted(): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", CORPUS, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0").filter(Boolean)
  } catch {
    console.error(`not a git checkout: ${CORPUS}`)
    process.exit(1)
  }
  const out: string[] = []
  for (const rel of tracked.sort()) {
    if (!JS_EXTS.test(rel)) continue
    const abs = path.join(CORPUS, rel)
    try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
    out.push(abs)
  }
  return out
}

type Row = {
  id: string
  /** brain_relationship.rowid — the insert ORDER of the row, used as the time anchor below. */
  rid: number
  t: string
  tgt: string | null
  src: string | null
  ssym: string | null
  tsym: string | null
  sname: string | null
  sfile: string | null
  tname: string | null
  tfile: string | null
}
type Sym = {
  id: string
  rowid: number
  name: string
  file: string
  isDeclaration: number
  /** `brain_file.language` of the file that declares it — the ranking's 3rd key. */
  lang: string
}
type SettleAgain = {
  scanned: number
  planned: number
  corrected: number
  settled: number
  unresolved: number
  unchanged: number
  attached: number
}
type Dump = {
  pid: string
  rows: Row[]
  symbols: Sym[]
  langs: Record<string, string>
  fileIds: Record<string, string>
  /**
   * `settleImportTargets` asked a SECOND time over the store the index run just
   * settled. The pass is a fixed point by construction, so this must report no
   * correction and no settlement: a non-zero number here means the stored target
   * is still not a function of the complete tables, whatever the endpoints say.
   */
  settleAgain: SettleAgain
  /**
   * row id -> the symbol the MODULE-AWARE planner decides for it, asked of the
   * FINAL index regardless of what the row already carries. The other mechanism
   * (the insert-time leaf ranking) is recomputed by the parent from `symbols`.
   */
  plan: Record<string, string | null>
}

// ────────────────────────────────────────────────────────────────────────────
// ONE ROUND — child process. Indexes the draw into its own project and dumps
// every relationship endpoint plus the symbol table the insert-time ranking
// consults (name, file, declaration tier, insertion order).
// ────────────────────────────────────────────────────────────────────────────
async function oneRound(out: string) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-js-det-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = admitted().slice(0, FILES)
  if (taken.length === 0) { console.error(`no js files under ${CORPUS}`); process.exit(1) }
  for (const f of taken) {
    const rel = path.relative(CORPUS, f)
    const dest = path.join(projDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any
  await indexProjectParallel(pid, projDir, { onProgress: () => {} })

  const raw: any = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[]
  const rows: Row[] = (q(`
    SELECT r.id AS id, r.rowid AS rid, r.relationship_type AS t, r.target_external AS tgt, r.source_external AS src,
           r.source_symbol_id AS ssym, r.target_symbol_id AS tsym,
           ss.name AS sname, sf.relative_path AS sfile, ts.name AS tname, tf.relative_path AS tfile
      FROM brain_relationship r
      LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
      LEFT JOIN brain_file sf ON sf.id = ss.file_id
      LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
      LEFT JOIN brain_file tf ON tf.id = ts.file_id
     WHERE r.project_id = ?`, pid) as any[]).map((r: any) => ({
    id: String(r.id), rid: Number(r.rid), t: String(r.t), tgt: r.tgt ?? null, src: r.src ?? null,
    ssym: r.ssym ?? null, tsym: r.tsym ?? null,
    sname: r.sname ?? null, sfile: r.sfile ?? null, tname: r.tname ?? null, tfile: r.tfile ?? null,
  }))
  const symbols: Sym[] = (q(`
    SELECT s.id AS id, s.rowid AS rowid, s.name AS name, s.file_id AS file,
           COALESCE(s.is_declaration, 0) AS isDeclaration, COALESCE(f.language, '') AS lang
      FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? ORDER BY s.rowid`, pid) as any[]).map((s: any) => ({
    id: String(s.id), rowid: Number(s.rowid), name: String(s.name ?? ""),
    file: String(s.file ?? ""), isDeclaration: Number(s.isDeclaration ?? 0),
    lang: String(s.lang ?? ""),
  }))
  // The module-aware planner, asked of the FINAL index and WITHOUT its
  // `target_symbol_id IS NULL` guard: the decision it *would* make for every
  // `module:item` row. This is the second mechanism the divergence is between.
  const { buildImportResolutionIndex, planImportResolutions } = await import(path.join(ROOT, "src/ast/import-resolution.ts"))
  const files = q(`SELECT id AS fileId, relative_path AS relativePath FROM brain_file WHERE project_id = ?`, pid) as any[]
  const importRows = q(`SELECT file_id AS fileId, import_path AS importPath FROM brain_import WHERE project_id = ?`, pid) as any[]
  const symRows = q(`SELECT id AS symbolId, file_id AS fileId, name, qualified_name AS qname FROM brain_symbol WHERE project_id = ?`, pid) as any[]
  const exportRows = q(`SELECT r.source_external AS src, r.target_external AS tgt, r.target_symbol_id AS sym, r.metadata AS md, tf.relative_path AS symFile
                          FROM brain_relationship r
                          LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
                          LEFT JOIN brain_file tf ON tf.id = ts.file_id
                         WHERE r.project_id = ? AND r.relationship_type = 'exports' AND r.target_external IS NOT NULL`, pid) as any[]
  const symFile = new Map<string, string>()
  for (const r of symRows) symFile.set(String(r.symbolId), String(r.fileId))
  const pathOf = new Map<string, string>()
  for (const f of files) pathOf.set(String(f.fileId), String(f.relativePath))
  const baseOf = new Map<string, string[]>()
  for (const f of files) {
    const tail = String(f.relativePath).split("/").pop() ?? ""
    const stem = tail.includes(".") ? tail.slice(0, tail.lastIndexOf(".")) : tail
    const arr = baseOf.get(stem) ?? []
    arr.push(String(f.fileId))
    baseOf.set(stem, arr)
  }
  const exportIdx: Array<{ fileId: string; name: string; isDefault?: boolean; symbolId?: string }> = []
  for (const er of exportRows) {
    if (!er.sym) continue
    const fileId = symFile.get(String(er.sym))
    if (!fileId) continue
    const spelling = er.src ?? ""
    if (pathOf.get(fileId) !== spelling) {
      const cands = baseOf.get(spelling) ?? []
      if (cands.length !== 1 || cands[0] !== fileId) continue
    }
    let isDefault = false
    if (er.md) { try { isDefault = JSON.parse(er.md)?.isDefault === true } catch { /* not a default */ } }
    exportIdx.push({ fileId, name: String(er.tgt), isDefault, symbolId: String(er.sym) })
  }
  const planIdx = buildImportResolutionIndex(files, symRows, importRows, exportIdx)
  const planInput = (q(`SELECT id, target_external, source_external, metadata
                          FROM brain_relationship
                         WHERE project_id = ? AND relationship_type = 'imports'
                           AND target_external IS NOT NULL AND instr(target_external, ':') > 0`, pid) as any[]).map((r: any) => ({
    id: String(r.id), target_external: String(r.target_external), source_external: r.source_external ?? null,
    metadata: (() => { try { return JSON.parse(r.metadata ?? "null") } catch { return null } })(),
  }))
  const plan: Record<string, string | null> = {}
  for (const p of planImportResolutions(planInput as any, planIdx)) plan[p.id] = p.symbolId

  const langs: Record<string, string> = {}
  const fileIds: Record<string, string> = {}
  for (const f of q(`SELECT id, relative_path AS p, COALESCE(language, '') AS l FROM brain_file WHERE project_id = ?`, pid) as any[]) {
    langs[String(f.p)] = String(f.l)
    fileIds[String(f.p)] = String(f.id)
  }
  // IDEMPOTENCE, measured rather than argued: ask the settlement pass to run
  // again over the store it has just settled. `scanned`/`planned` must be
  // non-zero (or the pass was never reached and this check is vacuous, which is
  // reported too) while `corrected` and `settled` must both be 0.
  const { settleImportTargets } = await import(path.join(ROOT, "src/ast/import-resolution.ts"))
  const again = settleImportTargets(raw as any, pid)
  const settleAgain: SettleAgain = {
    scanned: again.scanned, planned: again.planned, corrected: again.corrected,
    settled: again.settled, unresolved: again.unresolved, unchanged: again.unchanged,
    attached: again.attached,
  }
  fs.writeFileSync(out, JSON.stringify({ pid: String(pid), rows, symbols, langs, fileIds, plan, settleAgain } satisfies Dump))
  process.stderr.write(`round done: ${rows.length} rows, ${symbols.length} symbols, settle-again ${again.corrected}c/${again.settled}s of ${again.scanned} -> ${out}\n`)
}

// ────────────────────────────────────────────────────────────────────────────
// COMPARISON + ATTRIBUTION — parent process.
// ────────────────────────────────────────────────────────────────────────────
const norm = (id: string | null, pid: string) => (id == null ? null : String(id).split(pid).join("P"))
const itemLeaf = (tgt: string): string => {
  const noLine = tgt.replace(/:\d+$/, "")
  const colon = noLine.lastIndexOf(":")
  return colon >= 0 ? noLine.slice(colon + 1) : noLine
}

/**
 * Every mechanism that can write a `module:item` row's target, recomputed from
 * ONE run's own written tables, so a side of a divergence is CLASSIFIED rather
 * than assumed:
 *
 *   `atInsert`  the insert-time leaf ranking over the symbols that existed when
 *               the row was written. Existence is read from insertion order: a
 *               candidate's file is available iff its first symbol was written no
 *               later than the row's own importing file's first symbol — rowids
 *               come from one increasing sequence per table, so this is a
 *               within-table, run-local fact.
 *   `atEnd`     the same ranking over the COMPLETE symbol table.
 *   `planner`   the module-aware planner's decision for the row.
 */
function rank(cands: Sym[], rowFile: string | null, rowLang: string): string | null {
  if (cands.length === 0) return null
  const sorted = [...cands].sort((a, b) => {
    if (a.isDeclaration !== b.isDeclaration) return a.isDeclaration - b.isDeclaration
    const sa = rowFile != null && a.file === rowFile ? 1 : 0
    const sb = rowFile != null && b.file === rowFile ? 1 : 0
    if (sa !== sb) return sb - sa
    const la = a.lang === rowLang ? 1 : 0
    const lb = b.lang === rowLang ? 1 : 0
    if (la !== lb) return lb - la
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return sorted[0].id
}

/** min symbol rowid per file — the file's position in the insertion order. */
function fileFirstRowid(symbols: Sym[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of symbols) {
    const cur = m.get(s.file)
    if (cur == null || s.rowid < cur) m.set(s.file, s.rowid)
  }
  return m
}

function mechanisms(
  row: Row,
  symbols: Sym[],
  order: Map<string, number>,
  rowFile: string | null,
  rowLang: string,
  plan: string | null,
): { atInsert: string | null; atEnd: string | null; planner: string | null; detail: string } {
  const leaf = itemLeaf(row.tgt ?? "")
  const cands = symbols.filter((s) => s.name === leaf)
  const myOrder = rowFile != null ? (order.get(rowFile) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
  const existed = cands.filter((c) => (order.get(c.file) ?? Number.MAX_SAFE_INTEGER) <= myOrder)
  const atInsert = rank(existed, rowFile, rowLang)
  const atEnd = rank(cands, rowFile, rowLang)
  return {
    atInsert,
    atEnd,
    planner: plan,
    detail: `${existed.length}/${cands.length} candidate files written by then`,
  }
}

function label(side: string | null, m: { atInsert: string | null; atEnd: string | null; planner: string | null }): string | null {
  if (side == null) return "unresolved (nothing attached it)"
  if (m.planner != null && side === m.planner) return "module-aware planner"
  if (m.atInsert != null && side === m.atInsert) return "insert-time leaf ranking (prefix of the symbol table)"
  if (m.atEnd != null && side === m.atEnd) return "leaf ranking over the complete table"
  return null
}

async function main() {
  if (ONE_ROUND) { await oneRound(ONE_ROUND); return }
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-js-det-run-"))
  const aPath = path.join(workdir, "round-a.json")
  const bPath = path.join(workdir, "round-b.json")
  const self = fileURLToPath(import.meta.url)
  const spawnRound = (out: string) =>
    execFileSync(process.execPath, [self, `--corpus=${CORPUS}`, `--files=${FILES}`, `--one-round=${out}`], {
      stdio: ["ignore", "ignore", "inherit"],
    })
  console.log(`resolution determinism: indexing the same draw twice`)
  console.log(`corpus:        ${CORPUS}`)
  console.log(`files per run: ${FILES} (deterministic FIRST of the sorted admitted list)`)
  spawnRound(aPath)
  spawnRound(bPath)

  const A = JSON.parse(fs.readFileSync(aPath, "utf8")) as Dump
  const B = JSON.parse(fs.readFileSync(bPath, "utf8")) as Dump
  const checks: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  // 1. The two runs' INPUT sets must agree, or the comparison means nothing.
  const normRow = (r: Row, pid: string) => JSON.stringify([norm(r.id, pid), r.t, r.tgt, r.src])
  const setA = new Set(A.rows.map((r) => normRow(r, A.pid)))
  const setB = new Set(B.rows.map((r) => normRow(r, B.pid)))
  const onlyA = [...setA].filter((k) => !setB.has(k))
  const onlyB = [...setB].filter((k) => !setA.has(k))
  check(
    "row identity sets are equal across runs",
    onlyA.length === 0 && onlyB.length === 0,
    `A=${A.rows.length} B=${B.rows.length} A-only=${onlyA.length} B-only=${onlyB.length}`,
  )
  const symKey = (s: Sym, pid: string) => JSON.stringify([norm(s.id, pid), s.name, norm(s.file, pid), s.isDeclaration])
  const ssA = new Set(A.symbols.map((s) => symKey(s, A.pid)))
  const ssB = new Set(B.symbols.map((s) => symKey(s, B.pid)))
  const symOnlyA = [...ssA].filter((k) => !ssB.has(k)).length
  const symOnlyB = [...ssB].filter((k) => !ssA.has(k)).length
  check(
    "symbol identity sets are equal across runs",
    symOnlyA === 0 && symOnlyB === 0,
    `A=${A.symbols.length} B=${B.symbols.length} A-only=${symOnlyA} B-only=${symOnlyB}`,
  )

  // 2. THE PROPERTY — every row's resolved endpoints are the same in both runs.
  const byIdA = new Map<string, Row>()
  for (const r of A.rows) byIdA.set(norm(r.id, A.pid)!, r)
  const byIdB = new Map<string, Row>()
  for (const r of B.rows) byIdB.set(norm(r.id, B.pid)!, r)
  const ids = [...new Set([...byIdA.keys(), ...byIdB.keys()])]
  const divergent: { id: string; a: Row | undefined; b: Row | undefined; attribution: string }[] = []
  for (const id of ids) {
    const ra = byIdA.get(id)
    const rb = byIdB.get(id)
    if (!ra && !rb) continue
    if (ra && rb &&
      norm(ra.ssym, A.pid) === norm(rb.ssym, B.pid) &&
      norm(ra.tsym, A.pid) === norm(rb.tsym, B.pid)) continue
    divergent.push({ id, a: ra, b: rb, attribution: "evidence does not explain it: not yet attributed" })
  }

  // 3. ATTRIBUTION — each side of every divergence is classified against the
  // mechanisms that can write a `module:item` target, recomputed from that run's
  // own tables. A side that matches none of them is unexplained and fails the
  // gate, so the report cannot be satisfied by inventing a cause.
  const orderA = fileFirstRowid(A.symbols)
  const orderB = fileFirstRowid(B.symbols)
  for (const d of divergent) {
    const compute = (S: Dump, row: Row | undefined, order: Map<string, number>) => {
      if (!row) return null
      const rowFile = row.src ? (S.fileIds[row.src] ?? null) : null
      const rowLang = row.src ? (S.langs[row.src] ?? "") : ""
      // Every mechanism's answer is normalized to the `P:` form before it is
      // compared with a side, or the run's own project-id prefix would make a
      // correct classification look like "no known mechanism".
      const m = mechanisms(row, S.symbols, order, rowFile, rowLang, norm(S.plan[row.id] ?? null, S.pid))
      return {
        ...m,
        atInsert: norm(m.atInsert, S.pid),
        atEnd: norm(m.atEnd, S.pid),
        planner: norm(m.planner, S.pid),
      }
    }
    const ma = compute(A, d.a, orderA)
    const mb = compute(B, d.b, orderB)
    const sideA = d.a ? norm(d.a.tsym, A.pid) : null
    const sideB = d.b ? norm(d.b.tsym, B.pid) : null
    const lA = ma ? label(sideA, ma) : "absent"
    const lB = mb ? label(sideB, mb) : "absent"
    d.attribution = lA && lB && lA !== "absent" && lB !== "absent"
      ? `A: ${lA}; B: ${lB} (${ma?.detail ?? "-"} / ${mb?.detail ?? "-"})`
      : `evidence does not explain it: A=${sideA ?? "NULL"} (${lA ?? "no known mechanism"}), B=${sideB ?? "NULL"} (${lB ?? "no known mechanism"})`
  }
  const unexplained = divergent.filter((d) => d.attribution.startsWith("evidence does not explain it"))
  check(
    "every divergent row is attributed to a mechanism (not merely reported)",
    unexplained.length === 0,
    `${divergent.length} divergent, ${unexplained.length} unexplained`,
  )
  check(
    "resolved endpoints are identical across runs",
    divergent.length === 0,
    divergent.length === 0 ? `0 of ${ids.length} rows diverge` : `${divergent.length} of ${ids.length} rows diverge`,
  )

  // 4. THE FIXED POINT — the settlement pass must have nothing left to do on the
  // store the index run just produced, in BOTH runs. Without this the property
  // above could hold for a store that is still a function of scheduling, just
  // one that happened to answer the same way twice.
  //
  // The non-vacuity predicate is `scanned > 0` and deliberately NOT `planned > 0`:
  // whether the module-aware planner proves anything is a property of the DRAW
  // (lodash's 250-file draw has 77 `module:item` rows and proves none of them,
  // because its modules are CommonJS and carry no export surface), whereas
  // `scanned` is the count of rows the pass actually read. Both are printed, and
  // the gauges are compared between the runs below, so a draw where the pass had
  // nothing attached to re-decide SHOWS as `attached 0` rather than passing
  // quietly as a strong result.
  const vacuous = [A, B].filter((S) => (S.settleAgain?.scanned ?? 0) === 0)
  const unsettled = [A, B].filter((S) => (S.settleAgain?.corrected ?? 0) !== 0 || (S.settleAgain?.settled ?? 0) !== 0)
  const show = (S: Dump) =>
    S.settleAgain
      ? `${S.settleAgain.corrected} corrected / ${S.settleAgain.settled} settled / ${S.settleAgain.unchanged} unchanged` +
        ` / ${S.settleAgain.unresolved} with no answer / ${S.settleAgain.attached} attached, of ${S.settleAgain.scanned} scanned (${S.settleAgain.planned} planner-proven)`
      : "(no settlement record)"
  check(
    "the settlement pass is a fixed point on the store it just settled",
    unsettled.length === 0,
    `A: ${show(A)}; B: ${show(B)}`,
  )
  check(
    "the settlement pass actually read the population (the checks above are not vacuous)",
    vacuous.length === 0,
    `A: ${A.settleAgain?.scanned ?? 0} rows read, ${A.settleAgain?.attached ?? 0} of them carrying a target; B: ${B.settleAgain?.scanned ?? 0} read, ${B.settleAgain?.attached ?? 0} carrying one`,
  )
  // 5. THE PASS'S OWN GAUGES must agree to the row across the two runs. This is
  // the determinism property stated on the PASS rather than on the store: two
  // indexings of the same source must leave the pass the same amount of work to
  // find, with the same answers already stored — otherwise the pass is a function
  // of something other than the tables it reads.
  const gaugeKeys: (keyof SettleAgain)[] = ["scanned", "planned", "attached", "unchanged", "unresolved", "corrected", "settled"]
  const gaugeDiff = A.settleAgain && B.settleAgain
    ? gaugeKeys.filter((k) => A.settleAgain[k] !== B.settleAgain[k]).map((k) => `${k} ${A.settleAgain[k]} vs ${B.settleAgain[k]}`)
    : ["a run carries no settlement record"]
  check(
    "the settlement pass's own gauges agree across runs",
    gaugeDiff.length === 0,
    gaugeDiff.length === 0 ? gaugeKeys.map((k) => `${k}=${A.settleAgain?.[k] ?? "?"}`).join(" ") : gaugeDiff.join("; "),
  )

  for (const d of divergent) {
    const show = (r: Row | undefined) =>
      r ? `${r.t} ${r.tgt} -> ${r.tname ?? "NULL"} @ ${r.tfile ?? "-"}` : "(absent)"
    console.log(`\ndivergent ${d.id}`)
    console.log(`  A: ${show(d.a)}`)
    console.log(`  B: ${show(d.b)}`)
    console.log(`  attribution: ${d.attribution}`)
  }

  console.log("")
  let failed = 0
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`)
    if (!c.ok) failed++
  }
  console.log(`resolution-determinism: ${checks.length} checks, ${checks.length - failed} pass, ${failed} fail`)
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpus: CORPUS, files: FILES,
      rowsA: A.rows.length, rowsB: B.rows.length, symbolsA: A.symbols.length,
      divergentCount: divergent.length,
      divergent: divergent.map((d) => ({
        id: d.id, attribution: d.attribution,
        a: d.a ? { tgt: d.a.tgt, tname: d.a.tname, tfile: d.a.tfile } : null,
        b: d.b ? { tgt: d.b.tgt, tname: d.b.tname, tfile: d.b.tfile } : null,
      })),
      checks, verdict: failed === 0 ? "PASS" : "FAIL",
    }, null, 2) + "\n")
    console.log(`wrote ${JSON_OUT}`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

await main()
