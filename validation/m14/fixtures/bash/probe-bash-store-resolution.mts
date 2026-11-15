/**
 * BASH — what the STORE does with this lane's edges, measured through production `parseFile`.
 *
 * ## The question this round is answering
 *
 * The supervisor's brief ranks three causes for a bad incoming number: A (the published
 * name is not an identifier), B (emitter/publisher format mismatch), C (external). For
 * bash, round 22's `probe-bash-abc.mts` run measured B = 0 (29 dotted unresolved targets,
 * 0 of which have their final segment published) and left A at 227 ambiguous targets /
 * 3,019 ambiguous edges.
 *
 * A cannot be acted on until one thing is measured, and it is not in the analyzer:
 *
 * **An ambiguous target is only a defect if the CONSUMER cannot pick a declaration.**
 * `script/m14/incoming-check.ts` builds ONE global `name -> distinct kinds` map across
 * every file and calls a target ambiguous when the map holds more than one kind. The
 * consumer is `src/ast/parallel-indexer.ts`, and its rule is not that one. It is:
 *
 *   insert time  `resolveTargetStmt` (parallel-indexer.ts:2239-2245) — `WHERE project_id
 *                = ? AND s.name = ?` with `ORDER BY (s.file_id = ?) DESC, is_declaration
 *                ASC, (f.language = ?) DESC, s.id LIMIT 1`. The match is by bare name
 *                PROJECT-WIDE and the tie-break PREFERS THE EDGE'S OWN FILE. A `contains`
 *                edge takes a different statement (`:2354-2360`) ordered by
 *                `line_start = relLine DESC`, because a contains edge's line is the
 *                child's own naming line (#921), not a site.
 *   second pass  strategy 1 `_res_qname` exact qualified_name; strategy 2 `_res_name_unique`
 *                name-only `HAVING COUNT(*) = 1` (:3764, :3780-3792); strategy 3 dotted
 *                partial `MIN(sym.id)` (:3794-3833); strategy 4 the import form.
 *
 * Read that against bash and the A column inverts: a bare-name target in bash is not
 * ambiguous to the store, it is RESOLVED — deterministically, same-file first. The cost is
 * not an unresolved edge. It is an edge attached to a declaration in a file the script
 * never sourced, because nothing in this file declares that name.
 *
 * That is the population this probe counts, per type, and it is a different number from
 * every other one in circulation: not "ambiguous", not "unresolved", not "external". It
 * is RESOLVED-TO-ANOTHER-FILE, and `probe-bash-abc.mts` cannot see it because it never
 * asks the store's question.
 *
 * ## What is modelled and what is not — read this before quoting a number
 *
 * MODELLED, from the SQL quoted above:
 *   - the symbol universe: `parseFile`'s own output, i.e. after `keepSymbol`
 *     (pool-worker.ts:918) and after the relationship-target sanitizer
 *     (pool-worker.ts:614-665, which has a bash-specific `imports`/`references` path
 *     exemption at :637);
 *   - `extractLeaf` (parallel-indexer.ts:3377-3387): strip `:\d+`, strip `/\d+`, split on
 *     `:` take last, split on `.` take last;
 *   - insert-time target resolution and the `contains`-by-line variant;
 *   - second-pass strategies 1, 2 and 3, in that order, on what is still NULL;
 *   - the insert filter `startLine < 1` (parallel-indexer.ts:3032).
 *
 * NOT MODELLED, and each one moves the numbers in the stated direction:
 *   - the insert-time name filter `isIndexArtifactName(name)` (parallel-indexer.ts:3029).
 *     It removes symbols, so this probe's resolution counts are an UPPER BOUND on what
 *     the store resolves and its unresolved counts a LOWER bound.
 *   - `brain_symbol.is_declaration`, which appears in three ORDER BYs. `parseFile` does not
 *     publish it for bash, so every row compares equal and the ordering falls through to
 *     `id`. A real run may order differently.
 *   - `file_id` is an opaque store id; here it is the file's ORDINAL in the sample list.
 *     `MIN(id)` therefore picks a deterministic but arbitrary winner among files. That is
 *     the arbitrariness being measured, but the per-file attribution is reproducible
 *     rather than correct, and `other_file_other_repo` in particular depends on it.
 *   - a corpus is not a project: the store indexes one project root at a time, so
 *     cross-file resolution here is an UPPER bound too. `--repo <name>` measures one repo.
 *   - strategy 4 (`src/ast/import-resolution.ts`) is not re-implemented. The residue after
 *     strategies 1-3 is reported as `null` and named, not absorbed.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-store-resolution.mts \
 *     [--sample 600] [--ext sh] [--order path|hash] [--router] [--repo <name>] [--json out]
 *
 * NO REGEX in the measurement path: every name is `r.symbols[].name`, every target is
 * `r.relationships[].target`. The two regexes in the file are `extractLeaf`'s, quoted from
 * the store so the two agree by construction.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const has = (n: string) => argv.includes(`--${n}`)
const SAMPLE = Number(flag("sample") ?? 600)
const EXT = flag("ext") ?? "sh"
const ORDER = flag("order") ?? "path"
const REPO = flag("repo")

interface FileRec { abs: string; dir: string; repo: string }
const files: FileRec[] = []

if (ORDER === "path") {
  const listed = execFileSync(
    "bash",
    ["-lc", `find ${CR} -name '*.${EXT}' -type f 2>/dev/null | sort | head -${SAMPLE}`],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  ).trim().split("\n").filter(Boolean)
  for (const abs of listed) {
    files.push({ abs, dir: path.dirname(abs), repo: abs.slice(CR.length + 1).split("/")[0] })
  }
} else {
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
        .split("\n").filter(Boolean)
    } catch { continue }
    const recs: FileRec[] = []
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      if (detectLanguageFromPath(abs, "") !== "bash") continue
      recs.push({ abs, dir, repo: e })
    }
    recs.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
    files.push(...recs)
  }
  if (!has("router")) files.length = Math.min(files.length, SAMPLE)
}
if (REPO) {
  const keep = files.filter((f) => f.repo === REPO)
  files.length = 0
  files.push(...keep)
}

/** `extractLeaf`, verbatim from parallel-indexer.ts:3377-3387, so the leaf this probe
 * compares against is the store's function and not a paraphrase of it. */
const extractLeaf = (name: string) => {
  // no-regex rule: strip a trailing `:<digits>` / `/<digits>` by character scan.
  const stripNumericSuffix = (s: string, sep: number): string => {
    let cut = s.length
    for (let i = s.length - 1; i > 0; i--) {
      const c = s.charCodeAt(i)
      if (c >= 48 && c <= 57) { cut = i; continue }
      if (c === sep && cut < s.length) return s.slice(0, i)
      break
    }
    return s
  }
  const noLine = stripNumericSuffix(name, 58 /* : */)
  const noArity = stripNumericSuffix(noLine, 47 /* / */)
  const byColon = noArity.split(":")
  const lastColon = byColon[byColon.length - 1]
  const byDot = lastColon.split(".")
  return byDot[byDot.length - 1]
}

interface Sym { id: string; file: number; name: string; qualifiedName: string; kind: string; line: number }
interface Rel { type: string; source: string; target: string; file: number; line: number; metadata: Record<string, unknown> }

/** The marker KEYS this lane publishes on an edge to say "the target is not a local
 * declaration". Read as key presence, not value, because the lane writes several of them
 * `cond || undefined` — the key is on the row and the value is what carries the claim
 * (documented in docs/analyzers/bash.md, "one payload caveat"). */
const MARKER_KEYS = [
  "isExternalCommand", "isExternal", "isSourceImport", "isSourceDependency",
  "variableDeclaredInFile", "resolution", "targetResolution",
] as const

/** What the row says about its own target, as a single label, so a bucket can be read
 * against what the analyzer already claimed. `marked-external` is the claim "this name
 * denotes something outside this file"; `unmarked` means the row says nothing, which is the
 * state round 21 closed. */
function markerLabel(md: Record<string, unknown>): string {
  const v = md.isExternalCommand ?? md.isExternal
  if (v === true) return "marked:isExternalCommand"
  const r = String(md.resolution ?? md.targetResolution ?? "")
  if (r) return `marked:resolution=${r}`
  if (md.isSourceImport === true || md.isSourceDependency === true) return "marked:isSource*"
  if ("variableDeclaredInFile" in md) return `marked:variableDeclaredInFile=${String(md.variableDeclaredInFile)}`
  for (const k of MARKER_KEYS) if (k in md) return `marked:${k}`
  return "UNMARKED"
}

/** Per-file parse results, kept so the measurement can be RE-RUN over a subset without
 * re-parsing. `--per-repo` needs that: the store indexes one project root at a time, and a
 * corpus of 121 repos is not a project, so a cross-file attachment that leaves the repo is
 * an artifact of the harness and a cross-file attachment that stays inside it is the real
 * population. */
const perFileSyms: Sym[][] = []
const perFileRels: Rel[][] = []
let parsed = 0
let failed = 0
let degraded = 0
const digest = createHash("sha256")

for (let i = 0; i < files.length; i++) {
  const f = files[i]
  perFileSyms.push([])
  perFileRels.push([])
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
    parsed++
  } catch {
    failed++
    continue
  }
  if (r?.degraded) degraded++
  for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const line = Number(s?.startLine ?? s?.range?.startLine ?? 0)
    // parallel-indexer.ts:3032 — `startLine < 1` skips the row, so the symbol cannot be a
    // resolution target. Modelled, because counting it as one would overstate resolution.
    if (line < 1) continue
    perFileSyms[i].push({
      id: `${i}:${name}:${line}`, file: i, name,
      qualifiedName: String(s?.qualifiedName ?? name), kind: String(s?.kind ?? ""), line,
    })
  }
  for (const e of Array.isArray(r?.relationships) ? r.relationships : []) {
    const type = String(e?.type ?? e?.relationshipType ?? "")
    const source = String(e?.source ?? e?.from ?? "")
    const target = String(e?.target ?? e?.to ?? "")
    if (!target) continue
    const line = Number(e?.line_number ?? e?.lineNumber ?? 0)
    perFileRels[i].push({ type, source, target, file: i, line, metadata: (e?.metadata ?? {}) as Record<string, unknown> })
    digest.update(`${f.abs}\u0000${type}\u0000${source}\u0000${target}\u0000${line}\n`)
  }
}

/** The id the store compares as TEXT: `${fileId}:${name}:${line}` (parallel-indexer.ts:3458).
 * `fileId` is opaque there and an ordinal here, so `MIN(id)` is deterministic but arbitrary
 * across files — declared in the header, and it is exactly the arbitrariness measured. */
const byId = (a: Sym, b: Sym) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

type Bucket =
  | "insert_same_file" | "insert_other_file"
  | "s1_qualified_name" | "s2_name_unique" | "s3_dotted_partial" | "null" | "self"

const COLS: Bucket[] = [
  "insert_same_file", "insert_other_file", "s1_qualified_name", "s2_name_unique",
  "s3_dotted_partial", "null", "self",
]
const pad = (s: string | number, n: number) => String(s).padEnd(n)
const padl = (s: string | number, n: number) => String(s).padStart(n)

interface Result {
  files: number
  symbols: number
  edges: number
  perType: Map<string, Record<string, number>>
  total: Record<string, number>
  bucketMarkers: Map<string, Map<string, number>>
  otherFile: Map<string, { total: number; pathNamed: number; sameRepo: number; otherRepo: number; unmarked: number }>
  otherFileKind: Map<string, number>
  nullLeaves: Map<string, Map<string, number>>
  otherFileExamples: string[]
  nullExamples: string[]
  detailRows: string[]
}

const DETAIL = flag("detail")
const DETAIL_LIMIT = Number(flag("detail-limit") ?? 240)

/** The whole model, over the given file indices. Called once for the full sample and, under
 * `--per-repo`, once per repository so the cross-file columns mean "another file in the same
 * project" rather than "another file somewhere in the corpus". */
function measure(idx: number[]): Result {
  const byName = new Map<string, Sym[]>()
  const byQName = new Map<string, Sym[]>()
  /** file index -> every path this run's own `source`/`.` edges name out of that file */
  const sourced = new Map<number, Set<string>>()
  const syms: Sym[] = []
  const rels: Rel[] = []

  for (const i of idx) {
    for (const sym of perFileSyms[i]) {
      syms.push(sym)
      const la = byName.get(sym.name)
      if (la) la.push(sym)
      else byName.set(sym.name, [sym])
      const qa = byQName.get(sym.qualifiedName)
      if (qa) qa.push(sym)
      else byQName.set(sym.qualifiedName, [sym])
    }
    for (const r of perFileRels[i]) rels.push(r)
    // A `source`/`.` edge is the ONLY statement bash makes that one file reads another.
    const paths = new Set<string>()
    for (const r of perFileRels[i]) {
      if (r.type === "imports" || r.type === "references") paths.add(extractLeaf(r.target))
    }
    sourced.set(i, paths)
  }

  /** resolveTargetStmt (:2239) and resolveContainsTargetStmt (:2354), in that order. */
  function resolveAtInsert(target: string, file: number, type: string, line: number): Sym | null {
    const leaf = extractLeaf(target)
    const cands = byName.get(leaf)
    if (!cands || cands.length === 0) return null
    const sorted = [...cands].sort((a, b) => {
      const af = a.file === file ? 0 : 1
      const bf = b.file === file ? 0 : 1
      if (af !== bf) return af - bf
      if (type === "contains") {
        const al = a.line === line ? 0 : 1
        const bl = b.line === line ? 0 : 1
        if (al !== bl) return al - bl
      }
      return byId(a, b)
    })
    return sorted[0]
  }

  /** Strategy 2's universe: names declared exactly once in this scope (:3764). */
  const nameUnique = new Map<string, Sym[]>()
  for (const [name, arr] of byName) if (arr.length === 1) nameUnique.set(name, arr)

  function bucketOf(r: Rel): { bucket: Bucket; hit: Sym | null } {
    if (r.source === r.target) return { bucket: "self", hit: null }
    const at = resolveAtInsert(r.target, r.file, r.type, r.line)
    if (at) return { bucket: at.file === r.file ? "insert_same_file" : "insert_other_file", hit: at }
    const q = byQName.get(r.target)
    if (q && q.length) return { bucket: "s1_qualified_name", hit: q[0] }
    const u = nameUnique.get(r.target)
    if (u && u.length) return { bucket: "s2_name_unique", hit: u[0] }
    if (r.target.includes(".")) {
      const after = r.target.slice(r.target.indexOf(".") + 1)
      const d = byName.get(after)
      if (d && d.length) return { bucket: "s3_dotted_partial", hit: [...d].sort(byId)[0] }
    }
    return { bucket: "null", hit: null }
  }

  const perType = new Map<string, Record<string, number>>()
  const bucketMarkers = new Map<string, Map<string, number>>()
  const otherFile = new Map<string, { total: number; pathNamed: number; sameRepo: number; otherRepo: number; unmarked: number }>()
  /** edge type x the KIND of declaration it was attached to, for the other-file bucket.
   * A `calls` edge attached to a `variable` is the sharpest form of the defect: bash cannot
   * call a variable, so the row asserts a call site against something that is not callable. */
  const otherFileKind = new Map<string, number>()
  const nullLeaves = new Map<string, Map<string, number>>()
  const otherFileExamples: string[] = []
  const nullExamples: string[] = []
  const detailRows: string[] = []

  for (const r of rels) {
    let row = perType.get(r.type)
    if (!row) perType.set(r.type, (row = {}))
    const { bucket, hit } = bucketOf(r)
    row[bucket] = (row[bucket] ?? 0) + 1

    let bm = bucketMarkers.get(bucket)
    if (!bm) bucketMarkers.set(bucket, (bm = new Map()))
    const ml = markerLabel(r.metadata)
    bm.set(ml, (bm.get(ml) ?? 0) + 1)

    if (DETAIL && r.type === DETAIL && bucket !== "insert_same_file") {
      const where = hit ? `${files[hit.file].repo}/${path.basename(files[hit.file].abs)}:${hit.line} (${hit.kind})` : "-"
      detailRows.push(
        `${bucket.padEnd(18)} ${files[r.file].repo}/${path.basename(files[r.file].abs)}:${r.line} ` +
        `[${r.source} -> ${r.target}] lands on ${where}  ${ml}`,
      )
    }

    if (bucket === "insert_other_file" && hit) {
      let slot = otherFile.get(r.type)
      if (!slot) otherFile.set(r.type, (slot = { total: 0, pathNamed: 0, sameRepo: 0, otherRepo: 0, unmarked: 0 }))
      slot.total++
      if (ml === "UNMARKED") slot.unmarked++
      // Did THIS file ever say it reads that file? Only a `source`/`.` edge says so, and
      // only as a PATH STRING — the store never joins an edge to the file it names, it just
      // resolves the NAME. So this column is not "did it resolve correctly", it is "did any
      // edge in this file even mention the file it landed in". The test is a path-suffix
      // match: some path this file sources ends at, or is ended by, the target file's
      // corpus-relative path, or carries the target file's basename.
      const targetRel = `${files[hit.file].repo}/${path.relative(files[hit.file].dir, files[hit.file].abs)}`
      const base = path.basename(files[hit.file].abs)
      const declared = [...(sourced.get(r.file) ?? [])].some((p) =>
        p.length > 0 && (targetRel.endsWith(p) || p.endsWith(targetRel) || (p.endsWith(base) && targetRel.includes(base))),
      )
      const sameRepo = files[hit.file]?.repo === files[r.file]?.repo
      otherFileKind.set(`${r.type} -> ${hit.kind || "(empty)"}`, (otherFileKind.get(`${r.type} -> ${hit.kind || "(empty)"}`) ?? 0) + 1)
      if (declared) slot.pathNamed++
      else if (sameRepo) slot.sameRepo++
      else slot.otherRepo++
      if (otherFileExamples.length < 15) {
        otherFileExamples.push(
          `${files[r.file].repo}/${path.basename(files[r.file].abs)}:${r.line} -[${r.type}]-> ` +
          `${extractLeaf(r.target)} @ ${files[hit.file].repo}/${path.basename(files[hit.file].abs)}:${hit.line}` +
          `  (${declared ? "path-named by a source/. edge" : sameRepo ? "same repo, never sourced" : "OTHER REPO"})` +
          `  ${ml}`,
        )
      }
    }
    if (bucket === "null") {
      let h = nullLeaves.get(r.type)
      if (!h) nullLeaves.set(r.type, (h = new Map()))
      const lf = extractLeaf(r.target)
      h.set(lf, (h.get(lf) ?? 0) + 1)
      if (nullExamples.length < 15 && !nullExamples.some((e) => e.endsWith(`-> ${lf}`))) {
        nullExamples.push(`${files[r.file].repo}/${path.basename(files[r.file].abs)}:${r.line} -[${r.type}]-> ${lf}`)
      }
    }
  }

  const total: Record<string, number> = {}
  for (const row of perType.values()) for (const [k, v] of Object.entries(row)) total[k] = (total[k] ?? 0) + v
  return {
    files: idx.length, symbols: syms.length, edges: rels.length,
    perType, total, bucketMarkers, otherFile, otherFileKind, nullLeaves,
    otherFileExamples, nullExamples, detailRows,
  }
}

function report(res: Result, label: string, verbose: boolean): void {
  console.log()
  console.log(`── ${label}   files ${res.files}  symbols ${res.symbols}  edges ${res.edges}`)
  console.log(`${pad("type", 12)}${COLS.map((c) => padl(c, 19)).join("")}`)
  for (const [t, row] of [...res.perType.entries()].sort()) {
    console.log(`${pad(t, 12)}${COLS.map((c) => padl(row[c] ?? 0, 19)).join("")}`)
  }
  console.log(`${pad("TOTAL", 12)}${COLS.map((c) => padl(res.total[c] ?? 0, 19)).join("")}`)
  console.log()
  console.log(`WHAT THE ROW ALREADY SAYS ABOUT ITS OWN TARGET, per bucket`)
  console.log(`  the lane publishes marker keys on an edge; this is whether the bucket's rows carry one.`)
  console.log(`  UNMARKED is the state round 21 drove to 0 on the UNRESOLVED residue. It is not 0 here.`)
  for (const b of COLS) {
    const m = res.bucketMarkers.get(b)
    if (!m || m.size === 0) continue
    const n = [...m.values()].reduce((x, y) => x + y, 0)
    console.log(`  ${pad(b, 19)} ${padl(n, 6)}  ${[...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}(${v})`).join(" ")}`)
  }
  console.log()
  console.log(`insert_other_file, by what the EDGE ITSELF says about the file it landed in`)
  console.log(`${pad("type", 12)}${padl("total", 8)}${padl("path-named", 13)}${padl("same repo", 12)}${padl("other repo", 12)}${padl("unmarked", 11)}`)
  let ofTot = 0, ofSrc = 0, ofSame = 0, ofOther = 0, ofUnm = 0
  for (const [t, s] of [...res.otherFile.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${pad(t, 12)}${padl(s.total, 8)}${padl(s.pathNamed, 13)}${padl(s.sameRepo, 12)}${padl(s.otherRepo, 12)}${padl(s.unmarked, 11)}`)
    ofTot += s.total; ofSrc += s.pathNamed; ofSame += s.sameRepo; ofOther += s.otherRepo; ofUnm += s.unmarked
  }
  console.log(`${pad("TOTAL", 12)}${padl(ofTot, 8)}${padl(ofSrc, 13)}${padl(ofSame, 12)}${padl(ofOther, 12)}${padl(ofUnm, 11)}`)
  console.log(`  the honest reading: a row marked external and a row attached to another file's declaration are not`)
  console.log(`  the same fact. The MARKER is the analyzer's claim; the ATTACHMENT is what the store did with it.`)
  console.log(`  edge type -> kind of the declaration it was attached to:`)
  for (const [k, v] of [...res.otherFileKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${padl(v, 6)}  ${k}`)
  if (verbose) {
    console.log(`  examples:`)
    for (const e of res.otherFileExamples) console.log(`    ${e}`)
  }
  if (verbose) {
    console.log()
    console.log(`null residue, top leaves per type (a leaf this scope publishes nowhere)`)
    for (const [t, h] of [...res.nullLeaves.entries()].sort()) {
      const top = [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      console.log(`  ${pad(t, 12)} ${padl([...h.values()].reduce((a, b) => a + b, 0), 6)}  ${top.map(([k, v]) => `${k}(${v})`).join(" ")}`)
    }
    console.log(`  examples:`)
    for (const e of res.nullExamples) console.log(`    ${e}`)
  }
  if (DETAIL && res.detailRows.length) {
    console.log()
    console.log(`DETAIL every "${DETAIL}" edge that did NOT resolve in its own file (${res.detailRows.length})`)
    for (const row of res.detailRows.slice(0, DETAIL_LIMIT)) console.log(`  ${row}`)
    if (res.detailRows.length > DETAIL_LIMIT) console.log(`  … and ${res.detailRows.length - DETAIL_LIMIT} more`)
  }
}

const ALL = files.map((_, i) => i)
const ANALYZER_DIGEST = digest.digest("hex").slice(0, 16)

console.log(`BASH STORE-RESOLUTION MODEL   corpus=${CR}`)
console.log(
  `  files ${files.length} (parsed ${parsed}, failed ${failed}, degraded ${degraded})  ` +
  `repos ${new Set(files.map((f) => f.repo)).size}  digest ${ANALYZER_DIGEST}`,
)
console.log(
  `  population: sample=${SAMPLE} order=${ORDER} ext=${EXT} router=${has("router")} ` +
  `repo=${REPO ?? "(all)"} entry=parseFile(src/ast/pool-worker.ts)`,
)
console.log()
console.log(`BUCKET               meaning`)
console.log(`  insert_same_file    resolved at insert to a declaration in the EDGE'S OWN file`)
console.log(`  insert_other_file   resolved at insert to a declaration in ANOTHER file in this scope — the store prefers the edge's own file and found none`)
console.log(`  s1_qualified_name   second pass strategy 1: target_external equals a stored qualified_name`)
console.log(`  s2_name_unique      second pass strategy 2: the bare name is declared exactly ONCE in this scope`)
console.log(`  s3_dotted_partial   second pass strategy 3: a dotted target whose post-first-dot substring names a symbol`)
console.log(`  null                no strategy resolves it; the store keeps the name in target_external only`)
console.log(`  self                source === target, skipped by incoming-check before either counter`)

const whole = measure(ALL)
report(whole, "SCOPE = every sampled file (the corpus, which is NOT a project)", !has("per-repo"))

/** Aggregates over the one-repo scopes. Declared at module scope because the JSON block
 * below reads them and it must not be conditional on the flag being set to be type-checked
 * or emitted. */
const agg = { files: 0, symbols: 0, edges: 0, ...Object.fromEntries(COLS.map((c) => [c, 0])) } as Record<string, number>
const aggPerType = new Map<string, Record<string, number>>()
let aggUnm = 0
let aggPath = 0
const aggKind = new Map<string, number>()
/** the marker split of the one-repo `insert_other_file` bucket, which is the number the
 * report quotes and which the corpus arm alone cannot give. */
const aggMarker = new Map<string, Map<string, number>>()

// `--per-repo` re-measures with one repository as the scope, because the store indexes ONE
// project root at a time. The whole-corpus arm's `other repo` column is a harness artifact
// by construction; this arm is the population a real bash index would see.
interface RepoRow { repo: string; files: number; edges: number; same: number; other: number; pathNamed: number; unmarked: number; null: number }
const perRepoRows: RepoRow[] = []
if (has("per-repo")) {
  const byRepo = new Map<string, number[]>()
  for (const i of ALL) {
    const r = files[i].repo
    const a = byRepo.get(r)
    if (a) a.push(i)
    else byRepo.set(r, [i])
  }
  for (const [repo, idx] of [...byRepo.entries()].sort()) {
    const res = measure(idx)
    for (const c of COLS) agg[c] = (agg[c] ?? 0) + (res.total[c] ?? 0)
    // Per-TYPE sums for the one-repo scope. Printed rather than inferred: the corpus arm's
    // per-type table and this one have different denominators, and subtracting one column
    // from another is how a subtraction becomes an unlabelled claim.
    for (const [t, row] of res.perType) {
      let a = aggPerType.get(t)
      if (!a) aggPerType.set(t, (a = {}))
      for (const [k, v] of Object.entries(row)) a[k] = (a[k] ?? 0) + v
    }
    let unmarked = 0
    let pathNamed = 0
    for (const s of res.otherFile.values()) { unmarked += s.unmarked; pathNamed += s.pathNamed }
    aggUnm += unmarked
    aggPath += pathNamed
    for (const [k, v] of res.otherFileKind) aggKind.set(k, (aggKind.get(k) ?? 0) + v)
    const om = res.bucketMarkers.get("insert_other_file")
    if (om) {
      let a = aggMarker.get("insert_other_file")
      if (!a) aggMarker.set("insert_other_file", (a = new Map()))
      for (const [k, v] of om) a.set(k, (a.get(k) ?? 0) + v)
    }
    agg.files += res.files
    agg.symbols += res.symbols
    agg.edges += res.edges
    perRepoRows.push({
      repo, files: res.files, edges: res.edges,
      same: res.total.insert_same_file ?? 0,
      other: res.total.insert_other_file ?? 0,
      pathNamed, unmarked, null: res.total.null ?? 0,
    })
  }
  console.log()
  console.log(`── SCOPE = ONE REPOSITORY PER MEASUREMENT (a project root). Sum of ${perRepoRows.length} repos.`)
  console.log(`   the corpus arm above resolves across repository boundaries, which no index does.`)
  console.log(`   ${pad("repo", 26)}${padl("files", 7)}${padl("edges", 9)}${padl("same", 9)}${padl("other", 8)}${padl("path-named", 13)}${padl("unmarked", 11)}${padl("null", 9)}`)
  for (const r of perRepoRows.sort((a, b) => (b.other as number) - (a.other as number)).slice(0, 30)) {
    console.log(`   ${pad(String(r.repo), 26)}${padl(r.files, 7)}${padl(r.edges, 9)}${padl(r.same, 9)}${padl(r.other, 8)}${padl(r.pathNamed, 13)}${padl(r.unmarked, 11)}${padl(r.null, 9)}`)
  }
  console.log(`   ${pad("SUM", 26)}${padl(agg.files, 7)}${padl(agg.edges, 9)}${padl(agg.insert_same_file, 9)}${padl(agg.insert_other_file, 8)}${padl(aggPath, 13)}${padl(aggUnm, 11)}${padl(agg.null, 9)}`)
  console.log()
  console.log(`   per-TYPE, summed over the ${perRepoRows.length} one-repo scopes:`)
  console.log(`   ${pad("type", 14)}${COLS.map((c) => padl(c, 19)).join("")}`)
  for (const [t, row] of [...aggPerType.entries()].sort()) {
    console.log(`   ${pad(t, 14)}${COLS.map((c) => padl(row[c] ?? 0, 19)).join("")}`)
  }
  console.log(`   ${pad("SUM", 14)}${COLS.map((c) => padl(agg[c] ?? 0, 19)).join("")}`)
  console.log(`   insert_other_file -> kind of declaration, summed over the per-repo scopes:`)
  for (const [k, v] of [...aggKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${padl(v, 6)}  ${k}`)
  const am = aggMarker.get("insert_other_file")
  if (am) {
    console.log(`   insert_other_file -> what the row says about its own target, summed over the per-repo scopes:`)
    for (const [k, v] of [...am.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${padl(v, 6)}  ${k}`)
  }
}

const jf = flag("json")
if (jf) {
  const out = {
    population: {
      corpusRoot: CR, order: ORDER, ext: EXT, sample: files.length, router: has("router"), repo: REPO ?? null,
      entry: "parseFile(src/ast/pool-worker.ts)", repos: new Set(files.map((f) => f.repo)).size,
      parsed, failed, degraded, edges: whole.edges, symbols: whole.symbols,
      analyzerDigest: ANALYZER_DIGEST,
    },
    scopeCorpus: {
      total: whole.total,
      perType: Object.fromEntries([...whole.perType.entries()].sort()),
      markerByBucket: Object.fromEntries([...whole.bucketMarkers.entries()].sort().map(([b, m]) => [b, Object.fromEntries([...m.entries()].sort((x, y) => y[1] - x[1]))])),
      otherFileByType: Object.fromEntries([...whole.otherFile.entries()].sort()),
      otherFileByKind: Object.fromEntries([...whole.otherFileKind.entries()].sort((a, b) => b[1] - a[1])),
      otherFileExamples: whole.otherFileExamples,
      nullResidue: Object.fromEntries([...whole.nullLeaves.entries()].sort().map(([t, h]) => [t, [...h.entries()].sort((a, b) => b[1] - a[1])])),
    },
    perRepo: has("per-repo")
      ? {
        rows: perRepoRows,
        perTypeSummed: Object.fromEntries([...aggPerType.entries()].sort()),
        totals: Object.fromEntries(COLS.map((c) => [c, agg[c] ?? 0])),
        otherFilePathNamed: aggPath,
        otherFileUnmarked: aggUnm,
        otherFileByKind: Object.fromEntries([...aggKind.entries()].sort((a, b) => b[1] - a[1])),
        otherFileByMarker: Object.fromEntries([...(aggMarker.get("insert_other_file") ?? new Map()).entries()].sort((a, b) => b[1] - a[1])),
      }
      : null,
  }
  writeFileSync(jf as string, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${jf as string}`)
}
