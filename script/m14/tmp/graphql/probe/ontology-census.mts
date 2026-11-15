/**
 * ONTOLOGY CENSUS — every one of the ten relationship types, measured.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter, and for `graphql` it
 * refuses to report at all: `RULED_BY_LANG` has entries for `bash` and `json`
 * and none for `graphql`, so it exits 2 with "no RULING TABLE for graphql"
 * rather than calling the lane's types EMITTED or RULED. The refusal is the
 * gate's own correct behaviour — a gate with an empty table would call every
 * un-emitted type RULED-UNJUSTIFIED, which is a verdict about the TABLE and not
 * about the lane — so the table is the supervisor's to write (§8), and this
 * probe is the measurement that table has to be written FROM.
 *
 * ## What it measures, and with which instrument
 *
 * Two, and which one applies is decided by the QUESTION, never by convenience:
 *
 *   A. GRAMMAR INVENTORY — for a type that needs a node type the language does
 *      not have. Enumerating every node type the grammar actually produces over
 *      the whole admitted corpus is positive evidence of absence. A text regex
 *      is the wrong instrument and this repository has two recorded proofs:
 *      a bash `extends` probe that matched `class voice` inside a telnet IAC
 *      word list in a string, and an `instantiates` probe that matched
 *      `new Map(` in a bash file carrying embedded JavaScript in a heredoc.
 *
 *   B. PARSE-TREE COUNT — for a type the language CAN express. GraphQL's
 *      `extend` and a re-declared field name are ordinary GraphQL, so no
 *      grammar inventory finds them; they have to be counted on the tree, where
 *      a string literal or a description cannot fake them.
 *
 * Every number below comes from the PRODUCTION entry point, `parseFile` from
 * `src/ast/pool-worker.ts` — not `analyze()`, which is a per-file unit that
 * skips the pipeline stages (pool-worker timeouts, truncation, the ERROR/MISSING
 * walk, enhancements). A count taken from `analyze()` is a count of the
 * analyzer, not of the product.
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { HERE, OUT, ROOT } from "../paths.mts"

// The two production modules under measurement, loaded by absolute path so the probe runs
// from the lane directory the way every other probe here does.
const { detectLanguageFromPath: detect } = (await import(path.join(ROOT, "src/ast/language-detection"))) as any
const { parseFile } = (await import(path.join(ROOT, "src/ast/pool-worker"))) as any

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/**
 * The SERIALIZED spelling of each ontology type, read off `src/ast/types.ts`
 * rather than off the enum's member names.
 *
 * `RelationshipType.Imports` has the VALUE `"brain_import"`, so a probe that
 * looks for the string `"imports"` in `relationships[].type` can never see an
 * import edge in ANY lane. `script/m14/verify-doc-truth-emissions.ts:160`
 * already carries the alias table for exactly this reason; the ontology gate's
 * `ALL_TYPES` does not (see §8 of the lane report), so this probe normalises
 * before it counts.
 */
const SERIALIZED: Record<string, Type> = { brain_import: "imports" }
const normalize = (t: string): string => SERIALIZED[t] ?? t

// ---------------------------------------------------------------- corpus walk
const admitted: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const unroutedByExt: Record<string, number> = {}
const reposSeen: Record<string, number> = {}
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!fs.statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!/\.(graphql|gql|graphqls)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (fs.statSync(abs).size > 512 * 1024) continue
      text = fs.readFileSync(abs, "utf8")
    } catch {
      continue
    }
    const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()
    if (detect(abs, text) === "graphql") {
      admitted.push({ repo: e, dir, rel, abs, text })
      reposSeen[e] = (reposSeen[e] ?? 0) + 1
    } else {
      // A GraphQL document the ROUTER does not send to this lane. Counted, because
      // "the corpus has N GraphQL files" and "the product indexes N of them" are
      // different numbers and only the second one is a coverage claim.
      unroutedByExt[ext] = (unroutedByExt[ext] ?? 0) + 1
    }
  }
}

const label = (f: { repo: string; rel: string }) => `${f.repo}/${f.rel}`

// ------------------------------------------------------------------ sharding
//
// WHY THIS EXISTS, as a measurement rather than a precaution.
//
// The first run over the BROADENED corpus died. Not with an exception this probe
// could catch — with `[BB-PARSE-ERR] … memory access out of bounds` twice, and
// then nothing: a web-tree-sitter **abort** poisons the wasm module, so every
// later call in that process throws too, and the run ends with no JSON and no
// exit status. A harness whose result depends on whether the machine was busy is
// not a harness, so the production phase is now shardable and each shard is its
// own process: an abort costs one shard, and the shard that owns it is re-run
// file-by-file so the offending file is NAMED rather than lost.
//
// The two files the abort named are both individually fine — measured, each
// through production `parseFile` on its own, at concurrency 1 AND at 8:
//   hasura-engine/cli/pkg/metadata/testdata/projectv3/metadata/actions.graphql
//     — 0 BYTES. Parses to 0 symbols and 1 engine error, no abort.
//   gql-graphql-platform/…/PageConnectionCompositeSchemaTests.PageConnection_Field_
//     With_CompositeSourceSchema_Builds_Schema.graphql — 2,286 bytes, 26 symbols,
//     52 relationships, 0 errors. No abort at any concurrency tried.
//
// So the abort is a function of the CONCURRENT SET, not of either file, which is
// a finding about concurrent use of the production entry point rather than about
// either document. It is reported, not fixed: `src/ast/pool-worker.ts` is shared
// machinery (§8 of the lane brief).
const PARSE_SHARD = process.env.BB_PARSE_SHARD ?? "" // "i/n"
const MERGE_SHARDS = (process.env.BB_MERGE_SHARDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
/** Workers inside one shard. Lower than the old hard-coded 8, for the reason above. */
const PARSE_WORKERS = Number(process.env.BB_PARSE_WORKERS ?? 4)
/** The shard specs the merge consumed, for the artifact's own population statement. */
const PARSE_SHARDS: string[] = (process.env.BB_PARSE_SHARDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
/**
 * A stable, content-derived shard assignment.
 *
 * Derived from the file's own label rather than from its POSITION, because the
 * admitted list is walked in `readdirSync` order and one new clone at the corpus
 * root renumbers every position after it — which would silently change which
 * shard a file belongs to and make "re-run shard 3" a different measurement.
 */
const shardOf = (f: { repo: string; rel: string }): number => {
  const s = `${f.repo}/${f.rel}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
const shardFilesOf = (list: typeof admitted, spec: string): typeof admitted => {
  const [i, n] = spec.split("/").map((x) => Number(x))
  if (!Number.isFinite(i) || !Number.isFinite(n) || n <= 0) throw new Error(`BB_PARSE_SHARD must be "i/n", got ${spec}`)
  return list.filter((f) => shardOf(f) % n === i % n)
}

// ------------------------------------------- production parseFile over everything
const typeCount = new Map<Type, number>()
const typeFiles = new Map<Type, Set<string>>()
/** Every file a type fires in, uncapped — the number the gate's "M+ files" is read from. */
const typeFileSet = new Map<Type, Set<string>>()
const roleCount = new Map<string, number>()
const confLow = new Map<Type, number>()
const kindCount = new Map<string, number>()
const evidenceClassCount = new Map<string, number>()
const markerCount = new Map<string, number>()
const perFile: Array<{ file: string; symbols: number; relationships: number; exports: number; imports: number; errors: number }> = []
let emptyNameSymbols = 0
let unknownEndpoints = 0
let emptyEndpoints = 0
let crashed = 0
/** parseFile returned success:false — a real parse failure, not an empty file. */
const failedFiles: string[] = []
/** Non-empty file that returned zero symbols AND zero relationships with success:true.
 *  The signature of a worker self-timeout. Needs a human to confirm per file. */
const emptyYieldFiles: string[] = []
const unknownEndpointExamples: string[] = []

interface Sym {
  file: string
  name: string
  qualified: string
  kind: string
}
const syms: Sym[] = []
/** Every endpoint string the analyzer emitted, for the project-scope index. */
const endpointSource = new Map<Type, Array<{ source: string; target: string; file: string; line: number }>>()

const idx = { n: 0 }
/** The slice this process is responsible for: the whole corpus, or one shard of it. */
const parseTargets = PARSE_SHARD ? shardFilesOf(admitted, PARSE_SHARD) : admitted
async function worker() {
  for (;;) {
    const i = idx.n++
    const f = parseTargets[i]
    if (!f) return
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      crashed++
      continue
    }
    const lab = label(f)
    const nSym = r.symbols?.length ?? 0
    const nRel = r.relationships?.length ?? 0
    // A worker that trips the 45s self-timeout in pool-worker.ts returns a NORMAL
    // result carrying empty arrays. Nothing in that result says "timed out", so this
    // walk used to absorb the timeout as "this file has nothing in it" and the
    // artifact then claimed 1905/1905 coverage it did not have. Measured on this
    // corpus: 2 of 1905 files alternate between their full complement and zero across
    // runs of this same probe, and a run that loses one also prints [BB-HANG] naming
    // that exact file. Counted here rather than hidden.
    if (r.success === false) failedFiles.push(lab)
    else if (f.text.length > 0 && nSym === 0 && nRel === 0) emptyYieldFiles.push(`${lab} (${f.text.length} bytes)`)
    perFile.push({
      file: lab,
      symbols: r.symbols?.length ?? 0,
      relationships: r.relationships?.length ?? 0,
      exports: r.exports?.length ?? 0,
      imports: r.imports?.length ?? 0,
      errors: r.errors?.length ?? 0,
    })
    for (const s of r.symbols ?? []) {
      const name = String(s.name ?? "")
      if (name.length === 0) {
        emptyNameSymbols++
        continue
      }
      const kind = String(s.kind ?? "")
      kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1)
      syms.push({ file: lab, name, qualified: String(s.qualifiedName ?? `${s.ownerName ? `${s.ownerName}.` : ""}${name}`), kind })
    }
    for (const rel of r.relationships ?? []) {
      const t = normalize(String(rel.type ?? rel.relationshipType ?? "").toLowerCase()) as Type
      const source = String(rel.source ?? "")
      const target = String(rel.target ?? "")
      const line = Number(rel.line_number ?? 0)
      if (!ALL_TYPES.includes(t)) continue
      typeCount.set(t, (typeCount.get(t) ?? 0) + 1)
      if (!typeFileSet.has(t)) typeFileSet.set(t, new Set<string>())
      // The file COUNT and the file EXAMPLES are two different numbers and used to
      // share one capped `Set`, so every type reported "6 files" however many it
      // actually spanned — `uses` reported 6 across the corpus it fires in ~355
      // files of. `ontology-coverage-gate.ts` states its verdict as "N edges in M+
      // files", so M has to be the real M.
      typeFileSet.get(t)?.add(lab)
      // No cap here. A cap taken during collection records whichever files the worker
      // race happened to reach first, so the published examples changed on every re-run
      // even when every measured count was identical. The set is kept whole and the 6
      // published examples are chosen by sort at write time.
      const fs_ = typeFiles.get(t) ?? new Set<string>()
      fs_.add(lab)
      typeFiles.set(t, fs_)
      const role = String(rel.metadata?.relationshipRole ?? "")
      roleCount.set(`${t}|${role}`, (roleCount.get(`${t}|${role}`) ?? 0) + 1)
      const marker = String(rel.metadata?.relationshipType ?? "")
      if (marker) markerCount.set(marker, (markerCount.get(marker) ?? 0) + 1)
      const ec = String(rel.metadata?.evidenceClass ?? "")
      evidenceClassCount.set(ec || "(absent)", (evidenceClassCount.get(ec || "(absent)") ?? 0) + 1)
      if (Number(rel.confidence ?? 1) < 0.7) confLow.set(t, (confLow.get(t) ?? 0) + 1)
      for (const ep of [source, target]) {
        if (ep === "unknown") {
          unknownEndpoints++
          unknownEndpointExamples.push(`${lab}:${line} ${t} ${source} -> ${target}`) // sorted+capped at write; see resolutionFiles
        }
        if (ep.length === 0) emptyEndpoints++
      }
      const arr = endpointSource.get(t) ?? []
      arr.push({ source, target, file: lab, line })
      endpointSource.set(t, arr)
    }
  }
}
await Promise.all(Array.from({ length: PARSE_WORKERS }, () => worker()))

/**
 * SHARD MODE: hand the shard's tallies to the merge process and stop.
 *
 * The write is what makes an abort survivable — an abort kills the process before
 * this line, so a missing shard FILE is the signal, and `merge` refuses a
 * population whose shard set does not account for every admitted file. A harness
 * that silently merges 3 of 4 shards is the exact failure the honesty contract's
 * "declare the population" rule exists to prevent.
 */
if (PARSE_SHARD) {
  const out = process.env.BB_PARSE_SHARD_OUT
  if (!out) throw new Error("BB_PARSE_SHARD is set, so BB_PARSE_SHARD_OUT must name the file to write")
  const dump = {
    kind: "m60-ontology-census-parse-shard",
    shard: PARSE_SHARD,
    workers: PARSE_WORKERS,
    corpusRoot: CR,
    admittedTotal: admitted.length,
    files: parseTargets.map(label),
    totals: { emptyNameSymbols, unknownEndpoints, emptyEndpoints, crashed },
  // Sorted by path: rows arrive in worker-completion order, so an unsorted array made
  // every re-run diff against the committed artifact for rows whose numbers never moved.
  perFile,
    syms,
    endpointSource: Object.fromEntries([...endpointSource].map(([k, v]) => [k, v])),
    maps: {
      typeCount: Object.fromEntries(typeCount),
      typeFiles: Object.fromEntries([...typeFiles].map(([k, v]) => [k, [...v]])),
      typeFileSet: Object.fromEntries([...typeFileSet].map(([k, v]) => [k, [...v]])),
      roleCount: Object.fromEntries(roleCount),
      confLow: Object.fromEntries(confLow),
      kindCount: Object.fromEntries(kindCount),
      evidenceClassCount: Object.fromEntries(evidenceClassCount),
      markerCount: Object.fromEntries(markerCount),
    },
  unknownEndpointExamples: unknownEndpointExamples.slice().sort().slice(0, 8),
    unroutedByExt,
    reposSeen,
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(dump))
  const rels = [...typeCount.values()].reduce((a, b) => a + b, 0)
  console.log(`parse shard ${PARSE_SHARD}: ${parseTargets.length} of ${admitted.length} admitted files, ${syms.length} symbols, ${rels} ontology relationships, ${crashed} crashed`)
  process.exit(0)
}

/**
 * MERGE MODE: read the shard files back instead of parsing, then run the grammar
 * phase — which never calls `parseFile`, so it carries no abort risk.
 */
if (MERGE_SHARDS.length > 0) {
  const add = (m: Map<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from ?? {})) m.set(k, (m.get(k) ?? 0) + v) }
  const covered = new Set<string>()
  for (const shardPath of MERGE_SHARDS) {
    const d = JSON.parse(fs.readFileSync(shardPath, "utf8"))
    if (d.kind !== "m60-ontology-census-parse-shard") throw new Error(`${shardPath} is not a parse shard`)
    for (const f of d.files as string[]) {
      if (covered.has(f)) throw new Error(`shard overlap: ${f} appears in more than one shard, so merging would double-count it`)
      covered.add(f)
    }
    const m = d.maps
    add(typeCount, m.typeCount)
    add(roleCount, m.roleCount)
    add(confLow, m.confLow)
    add(kindCount, m.kindCount)
    add(evidenceClassCount, m.evidenceClassCount)
    add(markerCount, m.markerCount)
    for (const [k, v] of Object.entries(m.typeFiles ?? {}) as Array<[string, string[]]>) { const s = typeFiles.get(k as Type) ?? new Set<string>(); for (const x of v) s.add(x); typeFiles.set(k as Type, s) }
    for (const [k, v] of Object.entries(m.typeFileSet ?? {}) as Array<[string, string[]]>) { const s = typeFileSet.get(k as Type) ?? new Set<string>(); for (const x of v) s.add(x); typeFileSet.set(k as Type, s) }
    syms.push(...(d.syms as Sym[]))
    perFile.push(...(d.perFile as any[]))
    for (const [k, v] of Object.entries(d.endpointSource ?? {}) as Array<[string, any[]]>) endpointSource.set(k as Type, v)
    emptyNameSymbols += d.totals.emptyNameSymbols
    unknownEndpoints += d.totals.unknownEndpoints
    emptyEndpoints += d.totals.emptyEndpoints
    crashed += d.totals.crashed
    unknownEndpointExamples.push(...(d.unknownEndpointExamples as string[]))
    for (const [k, v] of Object.entries(d.unroutedByExt ?? {})) unroutedByExt[k] = (unroutedByExt[k] ?? 0) + (v as number)
    for (const [k, v] of Object.entries(d.reposSeen ?? {})) reposSeen[k] = (reposSeen[k] ?? 0) + (v as number)
  }
  // THE POPULATION CHECK. Every admitted file must be covered exactly once, or the
  // merge is reporting a count about a subset while printing the whole corpus's
  // size beside it.
  const missing = admitted.map(label).filter((f) => !covered.has(f))
  if (missing.length > 0) {
    console.log(`\nREFUSING TO MERGE: ${missing.length} admitted file(s) are covered by no shard, first:`)
    for (const f of missing.slice(0, 10)) console.log(`  ${f}`)
    console.log(`shards read: ${MERGE_SHARDS.length} covering ${covered.size} of ${admitted.length} admitted files`)
    process.exit(3)
  }
  console.log(`merged ${MERGE_SHARDS.length} shard(s) covering ${covered.size} of ${admitted.length} admitted files`)
}

// ------------------------------------------------------ project-scope resolution
// Mirrors the STORE's own two strategies (parallel-indexer `resolveRelationships`):
// strategy 1 is an exact qualified-name match; strategy 2 is a BARE name and
// only when it is unique project-wide (`cnt = 1`). A name with several owners is
// undecidable BY THE STORE'S OWN RULE, and counting it as resolved would flatter
// the lane; it is counted in its own class.
const byQualified = new Set<string>()
const bareCount = new Map<string, number>()
for (const s of syms) {
  byQualified.add(s.qualified)
  byQualified.add(s.name)
  bareCount.set(s.name, (bareCount.get(s.name) ?? 0) + 1)
}
const BUILTIN = new Set(["Int", "Float", "String", "Boolean", "ID"])
const METAFIELD = new Set(["__typename", "__schema", "__type", "__type(name:)", "__directive", "__field"])
const resolve = (ep: string): "qualified" | "bare_unique" | "builtin" | "metafield" | "ambiguous" | "absent" => {
  if (ep.length === 0) return "absent"
  if (BUILTIN.has(ep)) return "builtin"
  if (METAFIELD.has(ep) || ep.startsWith("__")) return "metafield"
  if (byQualified.has(ep)) return "qualified"
  const bare = ep.includes(".") ? ep.slice(ep.lastIndexOf(".") + 1) : ep
  const cnt = bareCount.get(ep) ?? bareCount.get(bare) ?? 0
  if (cnt === 1) return "bare_unique"
  if (cnt > 1) return "ambiguous"
  return "absent"
}

/**
 * Resolution, reported PER ENDPOINT SIDE.
 *
 * Reporting the two sides together is how a number becomes unreadable: `exports`
 * measures 50% pooled, which reads like half the schema's public surface is
 * unresolvable, when the truth is that the SOURCE is the file — spelled `(file)` with
 * `metadata.fileLevel=true`, which the store rewrites to the project-relative path on
 * exactly that flag — and every TARGET resolves. A consumer querying the store sees a
 * resolved file; this probe resolves symbols only, so it has to say which half it is
 * looking at or the pooled figure is a artefact of the instrument.
 */
const resolutionSides: Record<string, { source: Record<string, number>; target: Record<string, number> }> = {}
const resolution: Record<string, Record<string, number>> = {}
const resolutionFiles: Record<string, Array<{ file: string; line: number; source: string; target: string; verdict: string }>> = {}
for (const [t, edges] of endpointSource) {
  const row: Record<string, number> = { qualified: 0, bare_unique: 0, builtin: 0, metafield: 0, ambiguous: 0, absent: 0 }
  const bad: Array<{ file: string; line: number; source: string; target: string; verdict: string }> = []
  for (const e of edges) {
    const vs = resolve(e.source)
    const vt = resolve(e.target)
    row[vs]++
    row[vt]++
    if (vs === "absent" || vt === "absent") {
      bad.push({ file: e.file, line: e.line, source: e.source, target: e.target, verdict: `${vs}/${vt}` })
    }
  }
  resolution[t] = row
  // Sorted then capped, not capped while scanning: `edges` arrives in worker-completion
  // order, so "the first 12" was whichever 12 the race produced. Sorting first makes
  // the published examples a function of the corpus rather than of the scheduler.
  resolutionFiles[t] = bad
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
    .slice(0, 12)
  const srcRow: Record<string, number> = {}
  const tgtRow: Record<string, number> = {}
  for (const e of edges) {
    const vs = resolve(e.source)
    const vt = resolve(e.target)
    srcRow[vs] = (srcRow[vs] ?? 0) + 1
    tgtRow[vt] = (tgtRow[vt] ?? 0) + 1
  }
  resolutionSides[t] = { source: srcRow, target: tgtRow }
}

// ------------------------------------------------ instrument A: grammar inventory
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

const nodeTypeCount = new Map<string, number>()
let totalNodes = 0
let errorFiles = 0
let errorNodes = 0
for (const f of admitted) {
  const t = parser.parse(f.text)
  if (!t) continue
  let bad = 0
  const stack = [t.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    nodeTypeCount.set(n.type, (nodeTypeCount.get(n.type) ?? 0) + 1)
    totalNodes++
    if (n.type === "ERROR" || n.isMissing) bad++
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (bad > 0) {
    errorFiles++
    errorNodes += bad
  }
  t.delete?.()
}

/** Top-level definitions of a document, unwrapped through the grammar's pass-through rules. */
const WRAPPERS = new Set(["Document", "Definition", "ExecutableDefinition", "TypeSystemDefinition", "TypeSystemExtension", "TypeDefinition", "TypeExtension"])
const unwrap = (n: any): any => {
  let cur = n
  for (;;) {
    if (!WRAPPERS.has(cur.type)) return cur
    const kids = (cur.namedChildren ?? []).filter((c: any) => c)
    if (kids.length !== 1) return cur
    cur = kids[0]
  }
}
const nameOf = (n: any): string | undefined => {
  for (const c of n.namedChildren ?? []) {
    if (c && c.type === "Name") return c.text
  }
  return undefined
}
const topDefs = (root: any): any[] => {
  const doc = root.type === "Document" ? root : (root.namedChildren ?? []).find((c: any) => c && c.type === "Document")
  if (!doc) return []
  return (doc.namedChildren ?? []).filter((c: any) => c && c.type === "Definition").map(unwrap)
}
const collectNamedTypes = (node: any): Array<{ name: string; node: any }> => {
  const out: Array<{ name: string; node: any }> = []
  const seen = new Set<string>()
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "NamedType") {
      const nm = nameOf(n)
      if (nm && !seen.has(nm)) {
        seen.add(nm)
        out.push({ name: nm, node: n })
      }
      continue
    }
    for (const c of n.namedChildren ?? []) if (c) stack.push(c)
  }
  return out
}
const firstChildOfType = (node: any, type: string): any => {
  for (const c of node.namedChildren ?? []) if (c && c.type === type) return c
  return null
}
const walkAll = (root: any, fn: (n: any) => void) => {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    fn(n)
    for (let i = (n.namedChildren?.length ?? 0) - 1; i >= 0; i--) {
      const c = n.namedChildren[i]
      if (c) stack.push(c)
    }
  }
}

const EXT_TO_DEF: Record<string, string> = {
  ObjectTypeExtension: "ObjectTypeDefinition",
  InterfaceTypeExtension: "InterfaceTypeDefinition",
  UnionTypeExtension: "UnionTypeDefinition",
  EnumTypeExtension: "EnumTypeDefinition",
  ScalarTypeExtension: "ScalarTypeDefinition",
  InputObjectTypeExtension: "InputObjectTypeDefinition",
}
const DEF_KINDS = new Set(Object.keys(EXT_TO_DEF).concat(Object.values(EXT_TO_DEF)))

/** project-scope: which name is declared as which kind, across the whole corpus. */
const declaredKindByName = new Map<string, Set<string>>()
/** project-scope: every field name any type of this name declares, in any file. */
const fieldsByTypeName = new Map<string, Set<string>>()
/** per-document: type name -> the field names THIS document declares on it. */
const localFieldsByType = new Map<string, Set<string>>()

type Probe = { occurrences: number; files: number; examples: string[] }
const newProbe = (): Probe => ({ occurrences: 0, files: 0, examples: [] })
const probes: Record<string, Probe> = {
  /** A: node types that would express a CALL. */
  "A:call_node": newProbe(),
  /** A: node types that would express object CONSTRUCTION. */
  "A:instantiation_node": newProbe(),
  /** A: node types that would express a SUPERTYPE clause other than `implements`. */
  "A:supertype_clause_node": newProbe(),
  /** A: node types that would express an IMPORT. */
  "A:import_node": newProbe(),
/** B: a second top-level declaration of a name already declared in the SAME document. */
  "B:dup_toplevel_declaration": newProbe(),
  /** B: the same, restricted to documents the grammar parses with ZERO ERROR/MISSING nodes. */
  "B:dup_toplevel_declaration_in_a_clean_document": newProbe(),
  /** B: a field name declared twice inside one type across its definition and its extensions. */
  "B:field_redeclared_in_type": newProbe(),
  /** B: an enum member declared twice across definition and extension in one document. */
  "B:enum_value_redeclared": newProbe(),
  /** B: `implements` naming an OBJECT type — inheritance-shaped, not interface-shaped. */
  "B:implements_an_object_type": newProbe(),
  /**
   * B: the same, restricted to a supertype that is declared an object and NEVER an
   * interface. `Vehicle` in hasura's `0032_supergraph.graphql` is declared BOTH ways
   * in the corpus, so "some file declares it an object" is not the claim; "no file
   * declares it an interface" is.
   */
  "B:implements_an_unambiguously_object_type": newProbe(),
  /** B: and that, restricted to a document the grammar parses with zero ERROR/MISSING nodes. */
  "B:implements_an_unambiguously_object_type_in_a_clean_document": newProbe(),
  /** B: extension blocks of a type this document does not define (the split-schema shape). */
  "B:extension_of_an_undeclared_type": newProbe(),
  /** A: does the grammar produce a COMMENT node at all? Without one a comment convention is invisible on the tree. */
  "A:comment_node": newProbe(),
  /** B: the `#import "<file>"` convention, counted ON THE TREE — the grammar DOES produce comment nodes. */
  "B:hash_import_directive": newProbe(),
  /** A/B: how many `Type` nodes a declaration writes — the positions R9's declared-type graph is built from. */
  "B:type_node_in_a_declaration": newProbe(),
  /**
   * B: a member of a type that ALSO declares the member on a type it implements.
   *
   * This is the one place GraphQL has an override-shaped construct. The
   * specification requires an implementing type to declare every field of the
   * interface (§3.6 "IsValidImplementation"), so `type A implements I` plus a
   * `f` on `A` and a `f` on `I` is the object SUPPLYING the interface's member —
   * which is what an override is in every other lane in this family. It needs
   * both declarations, so it is counted at PROJECT scope: an interface declared in
   * one file and implemented in another is the ordinary case, not an edge case.
   */
  "B:member_implemented_from_an_interface": newProbe(),
  /** B: the same, restricted to a document that parses with zero ERROR/MISSING nodes. */
  "B:member_implemented_from_an_interface_in_a_clean_document": newProbe(),
  /** B: of those, the ones whose IMPLEMENTING type is an object (an interface implementing an interface is a different fact). */
  "B:member_supplied_by_an_object_type": newProbe(),
  /** B: interface-extends-interface — the spec forbids it, so a non-zero count here is a corpus fact worth recording. */
  "B:an_interface_implementing_another_interface": newProbe(),
  /**
   * B: the same-document subset of both project-scope probes.
   *
   * This is the DECIDING measurement, because the analyzer is a PER-FILE unit: it
   * cannot know that a supertype is an object rather than an interface, nor that a
   * field on the far side of an `implements` clause is an interface member, unless
   * the document it is reading says so itself. `implements` and the member lists are
   * resolved against THIS document's own declarations only, so the counts below are
   * exactly what a per-file analyzer can derive — and the difference between them and
   * the project-scope counts above is the cross-file remainder, which is a declared
   * limitation with a number on it rather than a silent gap.
   */
  "B:implements_an_unambiguously_object_type_in_the_same_document": newProbe(),
  "B:member_supplied_from_an_interface_in_the_same_document": newProbe(),
}
const hit = (key: string, lab: string, what: string) => {
  const p = probes[key]
  p.occurrences++
  if (p.examples.length < 8) p.examples.push(`${lab}: ${what}`)
}
/**
 * Register the file a probe fired in.
 *
 * It is a function and not an inline `hitFile.add`, because the PRE-PASS below
 * fires the two same-document probes — and it runs BEFORE the main walk, which is
 * where the file tally used to happen. So those two probes reported an occurrence
 * count with `files: 0`, which is not a weaker measurement but an incoherent one:
 * 1,054 occurrences in no file is a claim about nothing. The tally is now recorded
 * at the point of the hit, so a probe's file count is correct wherever it fires.
 */
const hitFilesByProbe = new Map<string, Set<string>>()
const noteFile = (key: string, lab: string) => {
  const s = hitFilesByProbe.get(key) ?? new Set<string>()
  s.add(lab)
  hitFilesByProbe.set(key, s)
}

const CALL_NODES = new Set(["CallExpression", "FunctionDefinition", "FunctionDeclaration", "MethodDefinition", "Invocation", "MacroInvocation", "Call"])
const INSTANTIATION_NODES = new Set(["NewExpression", "ObjectCreationExpression", "ConstructorInvocation", "ObjectInstantiation", "Instantiation"])
const SUPERTYPE_CLAUSE_NODES = new Set(["ExtendsClause", "SuperClass", "SuperclassClause", "ClassHeritage", "InheritanceSpecifier", "BaseClause", "ClassExtends", "Heritage", "InterfaceExtends", "ParentClass"])
const IMPORT_NODES = new Set(["ImportDeclaration", "Import", "ImportStatement", "ModuleImport", "Require", "UseDeclaration", "Include"])

/**
 * PRE-PASS: classify every top-level definition in the corpus, and index every field
 * name every type declares.
 *
 * It exists because two of the probes need a PROJECT-scope answer — `implements` naming
 * an object type, and a member supplied from an implemented interface — and a
 * single forward pass can only see the files it has already read. An interface declared
 * in the last file and implemented in the first is the ordinary shape of a split
 * schema, so a forward pass would report zero for both and the ruling would rest on
 * an instrument that cannot see the construct.
 */
/**
 * The `implements` names are recorded as STRINGS and a line, never as tree handles:
 * the pre-pass deletes its tree, and a `Node` read after `delete()` returns an empty
 * child list rather than an error, so a retained handle silently reads as "no
 * interfaces here" — which is what the first version of this probe measured.
 */
interface PreDecl {
  name: string
  kind: string
  isExt: boolean
  implements: Array<{ name: string; line: number }>
}
const prepass = new Map<string, { decls: PreDecl[] }>()
for (const f of admitted) {
  const lab = label(f)
  const t = parser.parse(f.text)
  if (!t) continue
  const decls: PreDecl[] = []
  const localFields = new Map<string, Set<string>>()
  for (const d of topDefs(t.rootNode)) {
    if (d.type === "SchemaDefinition" || d.type === "SchemaExtension") {
      declaredKindByName.set("schema", new Set([...(declaredKindByName.get("schema") ?? []), "schema"]))
      continue
    }
    if (d.type === "DirectiveDefinition") {
      const nm = nameOf(d)
      if (nm) declaredKindByName.set(nm, new Set([...(declaredKindByName.get(nm) ?? []), "directive"]))
      continue
    }
    if (!DEF_KINDS.has(d.type)) continue
    const isExt = d.type.endsWith("Extension")
    const kind = isExt ? EXT_TO_DEF[d.type] : d.type
    const nm = nameOf(d)
    if (!nm) continue
    declaredKindByName.set(nm, new Set([...(declaredKindByName.get(nm) ?? []), kind]))
    const implNode = firstChildOfType(d, "ImplementsInterfaces")
    const implNames = implNode ? collectNamedTypes(implNode).map((x) => ({ name: x.name, line: x.node.startPosition.row + 1 })) : []
    decls.push({ name: nm, kind, isExt, implements: implNames })
    const fields = new Set<string>()
    walkAll(d, (n) => {
      if (n.type !== "FieldDefinition") return
      const fname = nameOf(n)
      if (fname) fields.add(fname)
    })
    const project = fieldsByTypeName.get(nm) ?? new Set<string>()
    for (const fname of fields) project.add(fname)
    fieldsByTypeName.set(nm, project)
    const own = localFields.get(nm) ?? new Set<string>()
    for (const fname of fields) own.add(fname)
    localFields.set(nm, own)
  }
  // SECOND pass over this file's own definitions: `implements` names a type that is
  // often declared LATER in the same file (github-schema.graphql puts `interface
  // Node` after every type that implements it), so a single forward pass resolves the
  // clause against an empty member list and reads as "no shared member".
  for (const d of decls) {
    const hereFields = localFields.get(d.name)
    if (!hereFields) continue
    for (const i of d.implements) {
      const theirKind = decls.find((x) => x.name === i.name && !x.isExt)?.kind
      if (theirKind === "ObjectTypeDefinition" || theirKind === "InputObjectTypeDefinition") {
        hit("B:implements_an_unambiguously_object_type_in_the_same_document", lab, `${d.name} implements ${i.name} line ${i.line}`)
        noteFile("B:implements_an_unambiguously_object_type_in_the_same_document", lab)
      }
      const theirFields = localFields.get(i.name)
      if (!theirFields) continue
      for (const f of hereFields) {
        if (theirFields.has(f)) {
          hit("B:member_supplied_from_an_interface_in_the_same_document", lab, `${d.name}.${f} supplies ${i.name}.${f} line ${i.line}`)
          noteFile("B:member_supplied_from_an_interface_in_the_same_document", lab)
        }
      }
    }
  }

  prepass.set(lab, { decls })
  localFieldsByType.set(lab, localFields)
  t.delete?.()
}

for (const f of admitted) {
  const lab = label(f)
  const t = parser.parse(f.text)
  if (!t) continue
  const before = new Map(Object.entries(probes).map(([k, v]) => [k, v.occurrences]))
  const defs = topDefs(t.rootNode)
  // A document is CLEAN when the grammar produced no ERROR and no MISSING node in it.
  // Two of the construct probes are reported twice — once over every document and once
  // over the clean ones — because "the corpus contains this shape" and "this shape
  // occurs in a document the tool accepts" are different claims, and only the second
  // one can carry a rule about what a conforming tool DOES with the construct.
  let dirty = 0
  walkAll(t.rootNode, (n) => {
    if (n.type === "ERROR" || n.isMissing) dirty++
  })
  const clean = dirty === 0
  const hitIfClean = (key: string, what: string) => {
    if (clean) hit("B:dup_toplevel_declaration_in_a_clean_document", lab, what)
  }

  walkAll(t.rootNode, (n) => {
    if (CALL_NODES.has(n.type)) hit("A:call_node", lab, n.type)
    if (INSTANTIATION_NODES.has(n.type)) hit("A:instantiation_node", lab, n.type)
    if (SUPERTYPE_CLAUSE_NODES.has(n.type)) hit("A:supertype_clause_node", lab, n.type)
    if (IMPORT_NODES.has(n.type)) hit("A:import_node", lab, n.type)
    if (n.type === "comment") hit("A:comment_node", lab, JSON.stringify(n.text.slice(0, 60)))
    // The `#import "<file>"` convention of graphql-import / graphql-toolkit lives in a
    // COMMENT, and the grammar DOES produce comment nodes (see `A:comment_node`), so
    // this probe is a parse-tree count and not a text grep.
    if (n.type === "comment" && /^#\s*import\b/i.test(n.text)) hit("B:hash_import_directive", lab, JSON.stringify(n.text.slice(0, 80)))
  })

  // The pre-pass already classified every top-level definition in the corpus.
  const declaredHere: PreDecl[] = prepass.get(lab)?.decls ?? []
  const implemented: Array<{ owner: string; iface: string; line: number; ownerKind: string }> = []

  // B: a second top-level declaration of a name already declared in this document
  const seenDecl = new Set<string>()
  for (const d of declaredHere) {
    if (d.isExt) continue
    if (seenDecl.has(`${d.kind}|${d.name}`)) {
      hit("B:dup_toplevel_declaration", lab, `${d.kind} ${d.name}`)
      hitIfClean(lab, `${d.kind} ${d.name}`)
    }
    seenDecl.add(`${d.kind}|${d.name}`)
  }

  // B: field / enum-value redefinition inside ONE type across its definition and extensions
  const membersByType = new Map<string, Map<string, number>>()
  for (const d of declaredHere) {
    const key = `${d.kind}|${d.name}`
    const bag = membersByType.get(key) ?? new Map<string, number>()
    membersByType.set(key, bag)
    walkAll(d, (n) => {
      if (n.type === "FieldDefinition") {
        const nm = nameOf(n)
        if (nm) bag.set(`field:${nm}`, (bag.get(`field:${nm}`) ?? 0) + 1)
      }
      if (n.type === "EnumValueDefinition") {
        const ev = firstChildOfType(n, "EnumValue")
        const nm = ev ? nameOf(ev) : undefined
        if (nm) bag.set(`enum:${nm}`, (bag.get(`enum:${nm}`) ?? 0) + 1)
      }
    })
  }
  for (const [key, bag] of membersByType) {
    for (const [m, c] of bag) {
      if (c > 1) {
        const kindOfM = m.startsWith("field:") ? "B:field_redeclared_in_type" : "B:enum_value_redeclared"
        hit(kindOfM, lab, `${key} ${m} x${c}`)
      }
    }
  }

  // B: `extend X` where this document declares no `X`
  const declaredNames = new Set(declaredHere.filter((d) => !d.isExt).map((d) => `${d.kind}|${d.name}`))
  for (const d of declaredHere) {
    if (!d.isExt) continue
    if (!declaredNames.has(`${d.kind}|${d.name}`)) hit("B:extension_of_an_undeclared_type", lab, `extend ${d.kind} ${d.name}`)
  }

  // B: every `Type` node a declaration writes — the positions R9's declared-type graph
  // is built from. Counted so the implemented edge count has a measurement behind it
  // rather than an assertion.
  walkAll(t.rootNode, (n) => {
    if (n.type === "Type") {
      const parent = n.parent
      if (!parent) return
      if (parent.type === "FieldDefinition" || parent.type === "InputValueDefinition" || parent.type === "VariableDefinition") {
        hit("B:type_node_in_a_declaration", lab, `${parent.type} line ${n.startPosition.row + 1}`)
      }
    }
  })

  // B: `implements` naming something declared as an OBJECT — inheritance-shaped.
  for (const d of declaredHere) {
    for (const { name, line } of d.implements) {
      const kinds = declaredKindByName.get(name)
      const isObject = !!kinds && [...kinds].some((k) => k === "ObjectTypeDefinition" || k === "InputObjectTypeDefinition")
      const isInterface = !!kinds && kinds.has("InterfaceTypeDefinition")
      if (isObject) {
        hit("B:implements_an_object_type", lab, `${d.name} implements ${name} (${[...kinds!].join("/")}) line ${line}`)
        if (!isInterface) {
          hit("B:implements_an_unambiguously_object_type", lab, `${d.name} implements ${name} (${[...kinds!].join("/")}) line ${line}`)
          if (clean) hit("B:implements_an_unambiguously_object_type_in_a_clean_document", lab, `${d.name} implements ${name} line ${line}`)
        }
      }
      if (d.kind === "InterfaceTypeDefinition" && isInterface) {
        hit("B:an_interface_implementing_another_interface", lab, `${d.name} implements ${name} line ${line}`)
      }
      implemented.push({ owner: d.name, iface: name, line, ownerKind: d.kind })
    }
  }

  // B: the override-shaped construct. `A implements I` plus a field `f` on A and a
  // field `f` on I: the specification REQUIRES the object to supply the interface's
  // member (§3.6), so the object's field is the one that implements it. Both
  // declarations are needed, so this is counted at PROJECT scope.
  const localFields = localFieldsByType.get(lab)
  for (const { owner, iface, line, ownerKind } of implemented) {
    const mine = localFields?.get(owner)
    const theirs = fieldsByTypeName.get(iface)
    if (!mine || !theirs) continue
    for (const f of mine) {
      if (!theirs.has(f)) continue
      hit("B:member_implemented_from_an_interface", lab, `${owner}.${f} supplies ${iface}.${f} (implements line ${line})`)
      if (clean) hit("B:member_implemented_from_an_interface_in_a_clean_document", lab, `${owner}.${f} supplies ${iface}.${f}`)
      if (ownerKind === "ObjectTypeDefinition") hit("B:member_supplied_by_an_object_type", lab, `${owner}.${f} supplies ${iface}.${f}`)
    }
  }

  for (const [k, v] of Object.entries(probes)) {
    if (v.occurrences > (before.get(k) ?? 0)) noteFile(k, lab)
  }
  t.delete?.()
}
for (const k of Object.keys(probes)) probes[k].files = hitFilesByProbe.get(k)?.size ?? 0

/** Field-level inventory: every anonymous keyword token the grammar produced. */
const anonymousTokens = new Map<string, number>()
for (const f of admitted) {
  const t = parser.parse(f.text)
  if (!t) continue
  const stack = [t.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n.isNamed) anonymousTokens.set(n.type, (anonymousTokens.get(n.type) ?? 0) + 1)
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  t.delete?.()
}

// ------------------------------------------- constructibility: production parseFile
//
// The corpus census answers "does this type FIRE on real code". It cannot answer
// "can the analyzer CONSTRUCT it at all", and for four types here the corpus
// answer is 0 — which is exactly the state in which a dead branch and a correct
// ruling look identical. So question 1 of the six is measured separately, by
// running the SAME production entry point over inputs that provoke every family.
//
// Two things make this a measurement rather than a demonstration:
//
//   1. It goes through `parseFile`, not `analyze()`. The m14 fixture runner calls
//      `analyzer.analyze(...)` DIRECTLY (script/m14/run-fixtures.ts:678, with the
//      reason at :468), so a passing fixture proves the ANALYZER behaves and not
//      that the PRODUCT emits. For a lane whose four missing types were all
//      implemented in this workstream, that distinction is the whole question.
//   2. It runs the lane's OWN tracked fixtures plus the construct corpus, both of
//      which are in the repository, so the number reproduces from a clean checkout
//      with no corpus at all.
const constructibility: Record<string, { corpus: number; fixture: number; fixtureFile: string; fixtureExample: string }> = {}
const CONSTRUCT_FIXTURES: Array<{ rel: string; expect: Partial<Record<Type, number>> }> = [
  // One file per ontology type the lane can construct that the corpus does not
  // provoke. `calls`, `imports` and `instantiates` are absent BY DESIGN and are
  // not listed: there is no GraphQL text that provokes them, which is what
  // instrument A measured, and writing a file that "provokes" one would mean
  // inventing a construct the language does not have.
  { rel: "validation/m14/fixtures/graphql/ontology-heritage-and-surface.graphql", expect: { exports: 6, extends: 1, implements: 2, overrides: 2, references: 7, contains: 7 } },
]
{
  const fixtureFiles = CONSTRUCT_FIXTURES.map((c) => path.join(ROOT, c.rel))
  const fixCount = new Map<Type, number>()
  const fixExample = new Map<Type, string>()
  for (const abs of fixtureFiles) {
    const r = await parseFile(abs, path.dirname(abs))
    for (const x of r.relationships ?? []) {
      const t = normalize(String(x.type ?? x.relationshipType ?? "").toLowerCase())
      if (!ALL_TYPES.includes(t as Type)) continue
      fixCount.set(t as Type, (fixCount.get(t as Type) ?? 0) + 1)
      if (!fixExample.has(t as Type)) fixExample.set(t as Type, `${path.relative(ROOT, abs)}: ${x.source} -> ${x.target}`)
    }
  }
  for (const c of CONSTRUCT_FIXTURES) {
    for (const t of ALL_TYPES) {
      const got = fixCount.get(t) ?? 0
      const want = c.expect[t] ?? 0
      constructibility[t] = {
        corpus: typeCount.get(t) ?? 0,
        fixture: got,
        fixtureFile: want ? c.rel : "",
        fixtureExample: want ? (fixExample.get(t) ?? "") : "",
      }
    }
  }
}

// ------------------------------------------------------------------- the report
const totalRels = [...typeCount.values()].reduce((a, b) => a + b, 0)
const totalSyms = syms.length

const out: Record<string, any> = {
  schemaVersion: 1,
  kind: "m60-ontology-census",
  lane: "graphql",
  generatedAt: new Date().toISOString(),
  producedBy: "script/m14/tmp/graphql/probe/ontology-census.mts",
  corpusRoot: CR,
  entryPoint: "src/ast/pool-worker.ts::parseFile",
  sampling: {
    method: "EXHAUSTIVE over the corpus root's git-tracked files; no sampling, no random draw",
    productionParse: MERGE_SHARDS.length > 0
      ? `${MERGE_SHARDS.length} child processes, ${PARSE_SHARDS.join(" ")}, ${PARSE_WORKERS} workers each; the merge refuses any admitted file no shard covers`
      : `one process, ${PARSE_WORKERS} concurrent parseFile workers`,
    repositories: Object.keys(reposSeen).length,
    admittedFiles: admitted.length,
    // perFile.length counted ROWS, and a timed-out file still gets a row. Subtracting
    // the files that came back empty keeps this field meaning "files we actually read".
    filesCoveredByTheProductionPhase: perFile.length - emptyYieldFiles.length - failedFiles.length,
    perRepo: reposSeen,
    floorReference: "the project's stated 200+-file-per-family census floor; this census is over the whole admitted set",
    filesOverSizeCapSkipped: "tracked files > 512 KiB are skipped by the same rule script/m14/ontology-coverage-gate.ts uses",
  },
  routing: {
    note: "files with a graphql extension that detectLanguageFromPath does NOT route to this lane",
    unroutedByExtension: unroutedByExt,
  },
  totals: {
    symbols: totalSyms,
    relationshipsInOntology: totalRels,
    filesWithParseErrors: errorFiles,
    errorNodes,
    crashedFiles: crashed,
    parseReturnedFailure: failedFiles.length,
    zeroYieldNonEmptyFiles: emptyYieldFiles.length,
    emptyNameSymbols,
    unknownEndpoints,
    emptyEndpoints,
  },
  // Named so a reader can discount the totals above by exactly these files rather
  // than having to trust that 1905 rows means 1905 parses.
  filesThatYieldedNothingDespiteBytes: emptyYieldFiles.slice().sort(),
  filesParseFileReportedFailure: failedFiles.slice().sort(),
  emitted: Object.fromEntries(
    ALL_TYPES.map((t) => [
      t,
      {
        count: typeCount.get(t) ?? 0,
        // The file count is stored, not only printed. `ontology-coverage-gate.ts`
        // states a verdict as "N edges in M+ files", so M is a first-class part of
        // the claim; keeping it in the console output only meant the artifact could
        // not answer a reader's second question.
        files: typeFileSet.get(t)?.size ?? 0,
        // Sorted, not insertion-ordered: these sets are filled by 4 concurrent
        // parseFile workers, so insertion order is a race and re-running the probe
        // produced a 1,720-line diff on an artifact whose every measured count was
        // identical. The SET is the measurement; the order is presentation, and
        // presentation must not make a re-run look like a change.
        // Lexicographic, not frequency-then-race: a deterministic rule a reader can
        // restate. Take the 6 lowest paths.
        exampleFiles: [...(typeFiles.get(t) ?? [])].sort().slice(0, 6),
      },
    ]),
  ),
  rolesByType: Object.fromEntries([...roleCount.entries()].sort((a, b) => b[1] - a[1])),
  metadataMarkers: Object.fromEntries([...markerCount.entries()].sort((a, b) => b[1] - a[1])),
  evidenceClasses: Object.fromEntries([...evidenceClassCount.entries()].sort((a, b) => b[1] - a[1])),
  confidenceUnder07ByType: Object.fromEntries(ALL_TYPES.map((t) => [t, confLow.get(t) ?? 0])),
  symbolKinds: Object.fromEntries([...kindCount.entries()].sort((a, b) => b[1] - a[1])),
  resolutionPerType: resolution,
  resolutionPerSide: resolutionSides,
  resolutionExamples: resolutionFiles,
  unknownEndpointExamples,
  instrumentA: {
    nodeTypesObserved: nodeTypeCount.size,
    totalNodes,
    inventory: Object.fromEntries([...nodeTypeCount.entries()].sort((a, b) => b[1] - a[1])),
    anonymousTokens: Object.fromEntries([...anonymousTokens.entries()].sort((a, b) => b[1] - a[1])),
  },
  instrumentB: probes,
  constructibility: {
    note: "question 1 of the six (EXISTS), measured through the SAME production parseFile over the lane's own tracked fixtures. `corpus` is the count on real code; `fixture` is the count on a file that provokes the family. corpus 0 / fixture > 0 is a live branch the corpus happens not to reach — NOT dead code and NOT a correct ruling, and the two are indistinguishable without this block.",
    viaProductionParseFile: true,
    noteFixtureRunner: "script/m14/run-fixtures.ts:678 calls analyzer.analyze() directly, so a passing m14 fixture does NOT establish production emission; this block does.",
    perType: constructibility,
  },
  declaredKindByName: Object.fromEntries([...declaredKindByName.entries()].map(([k, v]) => [k, [...v].sort()])),
  // Sorted by path at the WRITE, not at the shard merge: rows arrive in
  // worker-completion order, and an unsorted array made every re-run diff against the
  // committed artifact for rows whose numbers never moved (measured: 0 of 1,905 files
  // changed value across 3 runs; only their order did).
  perFile: perFile.slice().sort((a, b) => a.file.localeCompare(b.file)),
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "ontology-census.json"), JSON.stringify(out, null, 2) + "\n")

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`ontology census — graphql`)
console.log(`corpus ${CR}: ${admitted.length} admitted files across ${Object.keys(reposSeen).length} repos; unrouted-by-router ${JSON.stringify(unroutedByExt)}`)
console.log(`parseFile: ${totalSyms} symbols, ${totalRels} ontology relationships, ${errorFiles} files with ERROR/MISSING, ${crashed} crashes`)
console.log(`empty-name symbols ${emptyNameSymbols}; 'unknown' endpoints ${unknownEndpoints}; empty endpoints ${emptyEndpoints}`)
console.log("")
console.log(`${w("type", 14)}${w("edges", 9)}${w("files", 8)}roles`)
for (const t of ALL_TYPES) {
  const n = typeCount.get(t) ?? 0
  const roles = [...roleCount.entries()].filter(([k]) => k.startsWith(`${t}|`)).map(([k, v]) => `${k.split("|")[1] || "(none)"}:${v}`)
  console.log(`${w(t, 14)}${w(String(n), 9)}${w(String(typeFileSet.get(t)?.size ?? 0), 8)}${roles.slice(0, 12).join(" ")}`)
}
console.log("")
const goodOf = (r: Record<string, number>) => (r.qualified ?? 0) + (r.bare_unique ?? 0) + (r.builtin ?? 0) + (r.metafield ?? 0)
console.log("resolution (project scope, the store's own two strategies; SOURCE and TARGET separately):")
for (const t of ALL_TYPES) {
  const sides = resolutionSides[t]
  if (!sides) continue
  const sTot = Object.values(sides.source).reduce((a, b) => a + b, 0)
  const tTot = Object.values(sides.target).reduce((a, b) => a + b, 0)
  console.log(`  ${w(t, 14)} src ${sTot} resolvable ${goodOf(sides.source)} (${((100 * goodOf(sides.source)) / (sTot || 1)).toFixed(2)}%)   tgt ${tTot} resolvable ${goodOf(sides.target)} (${((100 * goodOf(sides.target)) / (tTot || 1)).toFixed(2)}%)`)
  console.log(`  ${w("", 14)}   source classes ${JSON.stringify(sides.source)}`)
  console.log(`  ${w("", 14)}   target classes ${JSON.stringify(sides.target)}`)
}
console.log("")
console.log(`confidence < 0.7 by type: ${JSON.stringify(Object.fromEntries([...confLow.entries()]))}`)
console.log(`evidenceClass: ${JSON.stringify(out.evidenceClasses)}`)
console.log(`symbol kinds: ${JSON.stringify(out.symbolKinds)}`)
console.log("")
console.log("constructibility (production parseFile over the lane's own fixtures) — corpus / fixture:")
for (const t of ALL_TYPES) {
  const c = constructibility[t]
  if (!c) continue
  console.log(`  ${w(t, 14)}${w(String(c.corpus), 9)}${w(String(c.fixture), 9)}${c.fixtureExample}`)
}
console.log("")
console.log(`instrument A — grammar inventory over the corpus: ${nodeTypeCount.size} distinct node types, ${totalNodes} nodes`)
console.log(`  anonymous tokens: ${JSON.stringify(out.instrumentA.anonymousTokens)}`)
console.log("instrument B — parse-tree counts:")
for (const [k, v] of Object.entries(probes)) console.log(`  ${w(k, 44)}${w(String(v.occurrences), 8)}${w(String(v.files), 8)}${v.examples.slice(0, 2).join(" | ")}`)
console.log("")
console.log(`wrote ${path.relative(ROOT, path.join(OUT, "ontology-census.json"))}`)