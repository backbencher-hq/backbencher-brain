/**
 * M14 ONTOLOGY — LUA WAVE-2 ADVERSARIAL AUDIT.
 *
 * Pass 1 established the ten verdicts. Wave 2 is the other half of the job: run
 * pass 1's own claims against the two findings that outrank any single lane
 * (docs/analyzers/ONTOLOGY-WORKSTREAM-STATE.md §"the two findings that outrank
 * any single lane"), plus the adversarial reading pass 1 did not do.
 *
 *   F1  `parseFile` is NOT deterministic. It carries cumulative WASM state, so a
 *       figure quoted from one long-running process is a figure about THAT RUN.
 *       This harness is SHARDED (each shard a fresh process, so WASM state cannot
 *       accumulate across shards) and every shard records a `drawDigest`, so two
 *       runs can be compared on a PROVABLY identical file set rather than an
 *       assumed one. Run twice, diff.
 *
 *   F2  A resolution RATE cannot detect a name collision. `endpointResolves` here
 *       is name-based, exactly as the census's was, so it scores a colliding name
 *       as resolved. `collisionPopulation` measures the population F2 hides: for
 *       every edge endpoint that "resolves", how many symbols in that file carry
 *       the same name. A rate that is neither 100 nor 0 hides a population; this
 *       is the number the rate loses.
 *
 * Plus the defect class the BASH lane found in wave 2 — 30 `calls` edges whose
 * target was a POSIX reserved word (`fi`, `then`, `elif`, `esac`, `do`, `done`),
 * because tree-sitter error recovery reads a keyword as a `command_name`. The
 * Lua analogue is 22 reserved words including `end`, `then`, `do`, `repeat`,
 * `until`, `nil`, `true`, `false`. `reservedWordEndpoints` counts them per type.
 * This is asserted, not assumed: `callee()` in the analyzer only returns an
 * identifier or an index field, and an identifier cannot be a keyword in this
 * grammar — but only the count settles it.
 *
 * USAGE
 *   for i in 0..7: npx tsx script/m60/lua-wave2-audit.ts --shard $i/8
 *   npx tsx script/m60/lua-wave2-audit.ts --merge <dir> [--label run1]
 *
 * Output is lane-private by default (`/tmp/opencode/lua-lane/audit/`) because
 * seven lanes run concurrently and two resolving the same DB path is a known
 * SQLite write collision.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const OUTDIR = arg("--outdir", "/tmp/opencode/lua-lane/audit")!
const MERGE = process.argv.includes("--merge")
const LABEL = arg("--label", "run")
const CAP = Number(arg("--cap", "0")) // 0 = every tracked file

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/** Lua 5.1–5.4 reserved words. `goto` is 5.2+. A tree-sitter `identifier` node is
 * never one of these; a node produced by ERROR RECOVERY can be. */
const RESERVED = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
])
/** Literals that are values, never names. An edge naming one is not a fact about
 * the graph. */
const LITERALS = new Set(["nil", "true", "false", "...", "self", "_ENV", "_G"])

interface CorpusFile { repo: string; rel: string; abs: string }

function corpusFiles(): CorpusFile[] {
  const out: CorpusFile[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean).sort()
    } catch { continue }
    const drawn = CAP > 0 ? tracked.slice(0, CAP) : tracked
    for (const rel of drawn) out.push({ repo: e, rel, abs: path.join(dir, rel) })
  }
  return out
}

interface TypeRow {
  edges: number
  files: number
  repos: Record<string, number>
  bothResolved: number
  sourceResolved: number
  targetResolved: number
  neitherResolved: number
  srcUnknownLiteral: number
  tgtUnknownLiteral: number
  srcReservedWord: number
  tgtReservedWord: number
  srcLiteral: number
  tgtLiteral: number
  reservedExamples: string[]
  literalExamples: string[]
  /** F2: endpoints that resolve by NAME but where >1 symbol in the file carries
   * that name. The rate above scores these as resolved; this is what it loses. */
  srcAmbiguousByName: number
  tgtAmbiguousByName: number
  /** F2 sibling: a `calls` source whose ONLY matching symbols are of a kind that
   * cannot be called. The zig lane's class: the rate reads clean while 0.49% of
   * named call sources are not callable. */
  srcResolvedKind: Record<string, number>
  confidenceUnder07: number
  confidenceValues: Record<string, number>
  evidenceClass: Record<string, number>
  metadataRelationshipType: Record<string, number>
  lineNumberPresent: number
  labelShape: Record<string, number>
  /** duplicate (source,target) pairs inside one file — a double-emission smell */
  intraFileDupPairs: number
  dupExamples: string[]
  selfEdges: number
}
function newRow(): TypeRow {
  return {
    edges: 0, files: 0, repos: {}, bothResolved: 0, sourceResolved: 0, targetResolved: 0,
    neitherResolved: 0, srcUnknownLiteral: 0, tgtUnknownLiteral: 0, srcReservedWord: 0,
    tgtReservedWord: 0, srcLiteral: 0, tgtLiteral: 0, reservedExamples: [], literalExamples: [],
    srcAmbiguousByName: 0, tgtAmbiguousByName: 0, srcResolvedKind: {},
    confidenceUnder07: 0, confidenceValues: {}, evidenceClass: {},
    metadataRelationshipType: {}, lineNumberPresent: 0, labelShape: {},
    intraFileDupPairs: 0, dupExamples: [], selfEdges: 0,
  }
}

// ─────────────────────────────────────────────────────────── merge
if (MERGE) {
  const shards = readdirSync(OUTDIR).filter((f) => f.startsWith("shard-") && f.endsWith(".json")).sort()
  if (!shards.length) { console.error(`no shards in ${OUTDIR}`); process.exit(1) }
  const parts = shards.map((f) => JSON.parse(readFileSync(path.join(OUTDIR, f), "utf8")))
  const digests = new Set(parts.map((p: any) => p.drawDigest))
  const byType = new Map<Type, TypeRow>(ALL_TYPES.map((t) => [t, newRow()]))
  /** Arrays are example lists, not counters: concatenating them. The first
   * version tested `Array.isArray(v)` inside the NUMERIC branch's condition, so
   * an array of strings was summed — `"" + "kong/x"` concatenated character by
   * character and `reservedExamples` came back as one long string of letters.
   * The per-shard JSON always held the real arrays; only the merge lost them. */
  const merge = (dst: any, src: any) => {
    for (const k of Object.keys(src)) {
      const v = src[k]
      if (Array.isArray(v)) { dst[k] = [...(dst[k] ?? []), ...v].slice(0, 40); continue }
      if (v === null || typeof v !== "object") { dst[k] = (dst[k] ?? 0) + (v ?? 0); continue }
      // NESTED MAP: the second version of this line was `dst[kk]`, which wrote the
      // inner keys onto the ROW itself, so `confidenceValues`, `evidenceClass`,
      // `metadataRelationshipType`, `labelShape`, `repos` and `srcResolvedKind` all
      // came back empty while the scalar counts beside them were correct. A
      // measurement that silently drops the field it was asked for is worse than
      // one that fails, so the map is merged at its own level.
      if (typeof dst[k] !== "object" || dst[k] === null) dst[k] = {}
      for (const kk of Object.keys(v)) dst[k][kk] = (dst[k][kk] ?? 0) + (v[kk] ?? 0)
    }
  }
  let symbols = 0, emptyNames = 0, unknownKinds = 0, fallbackFiles = 0, fallbackEdges = 0
  let parseErrorFiles = 0, filesWithRel = 0
  const kinds: Record<string, number> = {}
  const otherTypes: Record<string, number> = {}
  for (const p of parts) {
    symbols += p.symbols; emptyNames += p.emptyNames; unknownKinds += p.unknownKinds
    fallbackFiles += p.fallbackFiles; fallbackEdges += p.fallbackEdges
    parseErrorFiles += p.parseErrorFiles
    if (p.filesWithRelationships > 0) filesWithRel += p.filesWithRelationships
    merge(kinds, p.kinds)
    merge(otherTypes, p.otherRelationshipTypes)
    for (const t of ALL_TYPES) merge(byType.get(t)!, p.byType[t])
  }
  const totals: Record<string, number> = {}
  for (const t of ALL_TYPES) totals[t] = byType.get(t)!.edges
  const out = {
    schemaVersion: 1, kind: "lua-wave2-audit-merged", label: LABEL,
    shards: shards.length,
    drawDigests: [...digests],
    drawIdenticalAcrossShards: digests.size === 1,
    filesParsed: parts.reduce((a: number, p: any) => a + p.filesParsed, 0),
    symbols, emptyNames, unknownKinds, kinds, otherRelationshipTypes: otherTypes,
    filesWithRelationships: filesWithRel,
    fallbackFiles, fallbackEdges, parseErrorFiles,
    totals, totalRelationships: Object.values(totals).reduce((a, b) => a + b, 0),
    byType: Object.fromEntries([...byType].map(([k, v]) => [k, v])),
  }
  const dest = path.join(OUTDIR, `merged-${LABEL}.json`)
  writeFileSync(dest, JSON.stringify(out, null, 2))
  console.log(`merged ${shards.length} shards -> ${dest}`)
  console.log(`draw identical across shards: ${out.drawIdenticalAcrossShards}  digests=${out.drawDigests.length}`)
  console.log(`files ${out.filesParsed}  symbols ${out.symbols}  relationships ${out.totalRelationships}`)
  console.log(`emptyNames ${out.emptyNames}  unknownKinds ${out.unknownKinds}  fallback ${out.fallbackFiles}f/${out.fallbackEdges}e  parseErrFiles ${out.parseErrorFiles}`)
  console.log("")
  console.log("type          edges   files  bothRes  ambigSrc ambigTgt  reserved  literals  under07")
  for (const t of ALL_TYPES) {
    const r: any = byType.get(t)!
    const res = r.tgtReservedWord + r.srcReservedWord
    const lit = r.tgtLiteral + r.srcLiteral
    const pct = r.edges ? ((r.bothResolved / r.edges) * 100).toFixed(1) : "  -  "
    console.log(
      `${t.padEnd(13)} ${String(r.edges).padStart(7)} ${String(r.files).padStart(7)} ${pct.padStart(7)}%` +
      ` ${String(r.srcAmbiguousByName).padStart(8)} ${String(r.tgtAmbiguousByName).padStart(8)}` +
      ` ${String(res).padStart(9)} ${String(lit).padStart(9)} ${String(r.confidenceUnder07).padStart(8)}`,
    )
  }
  process.exit(0)
}

// ─────────────────────────────────────────────────────────── shard
const shardArg = arg("--shard", "0/1")!
const [shardI, shardN] = shardArg.split("/").map(Number)
if (!Number.isInteger(shardI) || !Number.isInteger(shardN) || shardN < 1 || shardI < 0 || shardI >= shardN) {
  console.error(`--shard must be i/n with 0 <= i < n; got ${shardArg}`); process.exit(2)
}

const files = corpusFiles()
/** The draw digest is over repo, path AND byte length, so two runs that agree on
 * it agree on the file SET. It cannot prove the bytes are equal — that is what
 * git's index guarantees for tracked files — so it is stated as what it is. */
const digest = createHash("sha256")
for (const f of files) {
  let size = -1
  try { size = statSync(f.abs).size } catch { /* keep -1: a missing file is part of the identity */ }
  digest.update(`${f.repo}\t${f.rel}\t${size}\n`)
}
const drawDigest = digest.digest("hex")

// Contiguous slices, not modulo: a modulo shard would put adjacent files in
// different processes, and the whole point of sharding is that each process has
// a short, independent WASM lifetime.
const lo = Math.floor((files.length * shardI) / shardN)
const hi = Math.floor((files.length * (shardI + 1)) / shardN)
const mine = files.slice(lo, hi)

const byType = new Map<Type, TypeRow>(ALL_TYPES.map((t) => [t, newRow()]))
const otherRelationshipTypes: Record<string, number> = {}
const kinds: Record<string, number> = {}
let symbols = 0, emptyNames = 0, unknownKinds = 0
let fallbackFiles = 0, fallbackEdges = 0, parseErrorFiles = 0, filesWithRelationships = 0

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= mine.length) return
    const f = mine[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, path.join(CR, f.repo)) } catch {
      parseErrorFiles++
      continue
    }
    const syms: any[] = r.symbols ?? []
    symbols += syms.length
    if ((r.relationships ?? []).length > 0) filesWithRelationships++
    if (r.fallback === true) fallbackFiles++

    /** name -> how many symbols carry it, and the kinds. This is the whole of
     * F2's measurement: resolution below is `nameSet.has(x)`, which cannot see
     * that two symbols share the name. */
    const nameCount = new Map<string, number>()
    const nameKinds = new Map<string, Set<string>>()
    for (const s of syms) {
      const nm = typeof s?.name === "string" ? s.name : ""
      if (!nm) { emptyNames++; continue }
      nameCount.set(nm, (nameCount.get(nm) ?? 0) + 1)
      const k = typeof s?.kind === "string" ? s.kind : String(s?.kind)
      kinds[k] = (kinds[k] ?? 0) + 1
      if (!k || k === "unknown" || k === "undefined") unknownKinds++
      let set = nameKinds.get(nm)
      if (!set) nameKinds.set(nm, (set = new Set()))
      set.add(k)
    }
    const nameSet = new Set(nameCount.keys())

    const rels: any[] = r.relationships ?? []
    const seenTypes = new Set<Type>()
    const pairSeen = new Set<string>()
    for (const rel of rels) {
      if (r.fallback === true) fallbackEdges++
      const t = String(rel?.type ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) {
        otherRelationshipTypes[t] = (otherRelationshipTypes[t] ?? 0) + 1
        continue
      }
      const tr = byType.get(t)!
      tr.edges++
      tr.repos[f.repo] = (tr.repos[f.repo] ?? 0) + 1
      seenTypes.add(t)
      const src = String(rel?.source ?? "")
      const tgt = String(rel?.target ?? "")
      if (src === tgt) tr.selfEdges++
      if (src === "unknown") tr.srcUnknownLiteral++
      if (tgt === "unknown") tr.tgtUnknownLiteral++
      if (RESERVED.has(src)) { tr.srcReservedWord++; if (tr.reservedExamples.length < 10) tr.reservedExamples.push(`${label}: ${t} ${src} -> ${tgt}`) }
      if (RESERVED.has(tgt)) { tr.tgtReservedWord++; if (tr.reservedExamples.length < 10) tr.reservedExamples.push(`${label}: ${t} ${src} -> ${tgt}`) }
      if (LITERALS.has(src)) { tr.srcLiteral++; if (tr.literalExamples.length < 10) tr.literalExamples.push(`${label}: ${t} ${src} -> ${tgt}`) }
      if (LITERALS.has(tgt)) { tr.tgtLiteral++; if (tr.literalExamples.length < 10) tr.literalExamples.push(`${label}: ${t} ${src} -> ${tgt}`) }
      const sOk = nameSet.has(src)
      const tOk = nameSet.has(tgt)
      if (sOk) tr.sourceResolved++
      if (tOk) tr.targetResolved++
      if (sOk && tOk) tr.bothResolved++
      if (!sOk && !tOk) tr.neitherResolved++
      // F2: the population the rate cannot see.
      if (sOk && (nameCount.get(src) ?? 0) > 1) tr.srcAmbiguousByName++
      if (tOk && (nameCount.get(tgt) ?? 0) > 1) tr.tgtAmbiguousByName++
      // F2 sibling, the zig class: a `calls` source that resolves only to kinds
      // which cannot be called.
      if (t === "calls" && sOk) {
        for (const k of nameKinds.get(src) ?? []) tr.srcResolvedKind[k] = (tr.srcResolvedKind[k] ?? 0) + 1
      }
      const conf = typeof rel?.confidence === "number" ? rel.confidence : null
      tr.confidenceValues[conf === null ? "absent" : String(conf)] = (tr.confidenceValues[conf === null ? "absent" : String(conf)] ?? 0) + 1
      if (conf !== null && conf < 0.7) tr.confidenceUnder07++
      const ec = String(rel?.metadata?.evidenceClass ?? "absent")
      tr.evidenceClass[ec] = (tr.evidenceClass[ec] ?? 0) + 1
      const mrt = String(rel?.metadata?.relationshipType ?? "absent")
      tr.metadataRelationshipType[mrt] = (tr.metadataRelationshipType[mrt] ?? 0) + 1
      if (typeof rel?.line_number === "number") tr.lineNumberPresent++
      const shape = /^[A-Za-z_][A-Za-z0-9_]*$/.test(tgt) ? "bare"
        : /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(tgt) ? "dotted"
          : /^[A-Za-z_][A-Za-z0-9_]*:[A-Za-z_][A-Za-z0-9_]*$/.test(tgt) ? "colon"
            : tgt.includes("\n") ? "multiline" : tgt.includes("(") || tgt.includes(" ") ? "payload" : "other"
      tr.labelShape[shape] = (tr.labelShape[shape] ?? 0) + 1
      const pk = `${src}\u0000${tgt}`
      if (pairSeen.has(pk)) {
        tr.intraFileDupPairs++
        if (tr.dupExamples.length < 8) tr.dupExamples.push(`${label}: ${src} -[${t}]-> ${tgt}`)
      } else pairSeen.add(pk)
    }
    for (const t of seenTypes) byType.get(t)!.files++
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

mkdirSync(OUTDIR, { recursive: true })
const dest = path.join(OUTDIR, `shard-${String(shardI).padStart(2, "0")}-of-${shardN}.json`)
writeFileSync(dest, JSON.stringify({
  schemaVersion: 1, kind: "lua-wave2-audit-shard", shard: `${shardI}/${shardN}`,
  drawDigest, drawSize: files.length, filesParsed: mine.length,
  symbols, emptyNames, unknownKinds, kinds, otherRelationshipTypes,
  filesWithRelationships, fallbackFiles, fallbackEdges, parseErrorFiles,
  byType: Object.fromEntries([...byType]),
}, null, 2))
console.log(`shard ${shardI}/${shardN}: ${mine.length} files (of ${files.length}) symbols=${symbols} rel=${
  [...byType.values()].reduce((a, b) => a + b.edges, 0)
} digest=${drawDigest.slice(0, 12)} -> ${dest}`)