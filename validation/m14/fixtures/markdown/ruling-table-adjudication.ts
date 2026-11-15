/**
 * MARKDOWN RULING-TABLE ADJUDICATION — the arbiter's decision procedure, run over the
 * whole corpus, so the ruling table has a verdict even where the arbiter itself cannot
 * finish.
 *
 * ## Why this exists, and what it is NOT
 *
 * `script/m14/ontology-coverage-gate.ts markdown` is the arbiter, and on this corpus it
 * does not reach a verdict. It is wired — `script/m14/markdown-ruled.ts` is imported into
 * `RULED_BY_LANG` on `analyzer/MARKDOWN` — and two runs on the wired table both died at
 * the SHARED per-file self-destruct, `src/ast/engine.ts:1411`:
 *
 *   run 1  15,234 admitted files, exit 1, `[BB-HANG] parser stuck 120s` on
 *          `Grace/sdk/generated/matrix/openapi-generator/rust/docs/DiffDto.md`
 *          after `[BB-PARSE-ERR] memory access out of bounds` on four files
 *   run 2  15,234 admitted files, exit 1, `[BB-HANG]` on
 *          `FsToolkit.ErrorHandling/gitbook/validation/ofChoice.md` after traps on three
 *          DIFFERENT files
 *
 * Six distinct files across two runs, zero overlap, and every one of them parses alone in
 * 60–2,678 ms. The trap needs concurrency; it is not a property of a file, so no
 * file-level workaround exists at this lane's level and the arbiter's verdict on this
 * corpus is UNAVAILABLE. That is a §8 report, not a result.
 *
 * So this script runs the arbiter's PROCEDURE — not the arbiter — over the whole admitted
 * population, with the same two instruments and the same four-way decision:
 *
 *   EMITTED             production `parseFile` produced the type on this corpus
 *   FALSIFIED           not emitted, and the type's own probe finds the construct
 *   RULED-SOUND         not emitted, the construct is absent by instrument, and the spec
 *                       carries a RULED decision that names the type
 *   RULED-UNJUSTIFIED   not emitted, construct absent, NO written ruling
 *
 * The rules are transcribed from `ontology-coverage-gate.ts` and the row source is
 * `script/m14/markdown-ruled.ts` — the same module the arbiter imports — so the table
 * under test is the arbiter's table, not a copy of it. What differs is stated below.
 *
 * ## The one difference, and it makes this result STRONGER than the arbiter's
 *
 * The arbiter enumerates node types with ONE wasm — `(LANGS as any)[LANG]?.wasm`, the
 * BLOCK grammar. This script enumerates the UNION of the block grammar and the companion
 * inline grammar, because every instrument-A row in `MARKDOWN_RULED` is stated against
 * that union (104 distinct types over a 1,200-file draw; the union is recomputed here
 * over the whole population). Absence over a superset implies absence over the arbiter's
 * subset, so a ruling this script calls sound would also be sound under the arbiter's
 * narrower denominator, and one it calls FALSIFIED would be falsified a fortiori.
 *
 * ## What it still cannot do
 *
 * It shares the arbiter's blind spot by construction: `EMITTED` counts are read from
 * `whole-corpus-census.ts` (production `parseFile`), and a type absent from BOTH the
 * analyzer and the oracle is invisible to both. That is the failure the workstream
 * document exists to name, and no reimplementation of the arbiter fixes it — only a
 * measurement of the language does, which is what the four probes in
 * `validation/m60/markdown/` are.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/ruling-table-adjudication.ts \
 *     [--shards 8] [--census validation/m60/markdown/whole-corpus-census.json]
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { MARKDOWN_RULED, type Ruled } from "../../../../script/m14/markdown-ruled"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = path.join(HERE, "ruling-table-adjudication.ts")
const REPO = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SHARDS = Math.max(1, Number(arg("shards", "8")))
const CENSUS = arg("census", path.join(REPO, "validation/m60/markdown/whole-corpus-census.json"))
const SHARD_DIR = arg("shard-dir", "")
/** Opt-in: reuse a shard payload on disk iff it was measured over this population. */
const RESUME = argv.includes("--resume")
const SHARD_INDEX = argv.indexOf("--shard")
const IS_CHILD = SHARD_INDEX >= 0
const CHILD_SHARDS = Number(argv[SHARD_INDEX + 1] ?? "1")
const CHILD_INDEX = Number(argv[SHARD_INDEX + 2] ?? "0")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ─────────────────────────────────────────────────────────── corpus (gate's admission)
type FileRec = { repo: string; dir: string; rel: string; abs: string; text: string }
const files: FileRec[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    // The gate's admission test, verbatim.
    if (detectLanguageFromPath(abs, text) !== "markdown") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}

/** Names the population, so `--resume` can refuse a payload measured over a different one. */
const populationHash = createHash("sha256").update(files.map((f) => `${f.repo}/${f.rel}`).join("\n")).digest("hex")

/** The arbiter's `rulingFor()`: a RULED decision whose resolution names the type. */
function rulingFor(t: Type): { reason: string; src: string } | null {
  const specPath = path.join(REPO, "script/m14/spec/markdown-completeness.json")
  let raw: string
  try { raw = readFileSync(specPath, "utf8") } catch { return null }
  const d = JSON.parse(raw)
  for (const dec of d?.design_decision?.decisions ?? []) {
    if (dec.status !== "RULED") continue
    const body = String(dec.resolution ?? "")
    if (new RegExp(`\`${t}\``, "i").test(body) || new RegExp(`\\b${t}\\b`, "i").test(body)) {
      if (/ontology|emits|excluded|type/i.test(body)) return { reason: body, src: `script/m14/spec/markdown-completeness.json#${dec.id}` }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────── instrument A, both grammars
async function inventory(): Promise<{ union: Record<string, number>; blockDistinct: number; inlineDistinct: number; unionDistinct: number; parsed: number; failures: string[] }> {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const load = async (file: string) => WSL.load(readFileSync(path.join(REPO, "wasm", file)))
  const block = await load("tree-sitter-markdown.wasm")
  const inline = await load("tree-sitter-markdown_inline.wasm")
  const pb = new WSP(); pb.setLanguage(block)
  const pi = new WSP(); pi.setLanguage(inline)
  const blockTypes: Record<string, number> = {}
  const inlineTypes: Record<string, number> = {}
  const union: Record<string, number> = {}
  let parsed = 0
  const failures: string[] = []
  for (const f of files) {
    let tb: any, ti: any
    try { tb = pb.parse(f.text) } catch (e: any) { if (failures.length < 12) failures.push(`${f.repo}/${f.rel}: block ${String(e?.message ?? e).slice(0, 60)}`); continue }
    parsed++
    const walk = (n: any, into: Record<string, number>) => {
      into[n.type] = (into[n.type] ?? 0) + 1
      union[n.type] = (union[n.type] ?? 0) + 1
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), into)
    }
    walk(tb.rootNode, blockTypes)
    tb.delete?.()
    // The companion grammar is a separate parse of the same source: tree-sitter-markdown
    // ships it for INJECTION, and `pass2-labelling-probe.ts` established that the block
    // tree alone omits every inline type. A block-only inventory is the narrower
    // denominator, which is why the union is the one a ruling is stated against.
    try { ti = pi.parse(f.text) } catch { ti = null }
    if (ti) { walk(ti.rootNode, inlineTypes); ti.delete?.() }
  }
  return {
    union,
    blockDistinct: Object.keys(blockTypes).length,
    inlineDistinct: Object.keys(inlineTypes).length,
    unionDistinct: Object.keys(union).length,
    parsed,
    failures,
  }
}

// ─────────────────────────────────────────────────────────── child mode
if (IS_CHILD) {
  if (!SHARD_DIR) { console.error("--shard requires --shard-dir"); process.exit(2) }
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const load = async (file: string) => WSL.load(readFileSync(path.join(REPO, "wasm", file)))
  const pb = new WSP(); pb.setLanguage(await load("tree-sitter-markdown.wasm"))
  const pi = new WSP(); pi.setLanguage(await load("tree-sitter-markdown_inline.wasm"))
  const blockTypes: Record<string, number> = {}
  const inlineTypes: Record<string, number> = {}
  const union: Record<string, number> = {}
  let parsed = 0
  const failures: string[] = []
  const mine = files.filter((_, i) => i % CHILD_SHARDS === CHILD_INDEX)
  const t0 = Date.now()
  for (const f of mine) {
    let tb: any
    try { tb = pb.parse(f.text) } catch (e: any) { if (failures.length < 12) failures.push(`${f.repo}/${f.rel}: ${String(e?.message ?? e).slice(0, 60)}`); continue }
    parsed++
    const walk = (n: any, into: Record<string, number>) => {
      into[n.type] = (into[n.type] ?? 0) + 1
      union[n.type] = (union[n.type] ?? 0) + 1
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), into)
    }
    walk(tb.rootNode, blockTypes)
    tb.delete?.()
    try {
      const ti = pi.parse(f.text)
      if (ti) { walk(ti.rootNode, inlineTypes); ti.delete?.() }
    } catch { /* an inline trap is recorded by the block pass on the same file */ }
  }
  mkdirSync(SHARD_DIR, { recursive: true })
  writeFileSync(path.join(SHARD_DIR, `${CHILD_INDEX}.json`), JSON.stringify({
    shard: CHILD_INDEX, shards: CHILD_SHARDS, populationSha256: populationHash,
    assigned: mine.length, parsed, failures,
    blockDistinct: Object.keys(blockTypes).length, inlineDistinct: Object.keys(inlineTypes).length,
    unionDistinct: Object.keys(union).length,
    blockTypes, inlineTypes, union, tookMs: Date.now() - t0,
  }))
  console.log(`@@DONE@@ shard ${CHILD_INDEX}: ${mine.length} files, ${parsed} parsed, union ${Object.keys(union).length} node types, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  process.exit(0)
}

// ─────────────────────────────────────────────────────────── parent mode
console.log("markdown ruling-table adjudication — the arbiter's procedure, whole corpus")
console.log(`corpus ${CR}`)
console.log(`admitted by the gate's test: ${files.length} markdown files`)
console.log(`ruling table: script/m14/markdown-ruled.ts, ${MARKDOWN_RULED.length} rows, types ${MARKDOWN_RULED.map((r) => r.type).join(", ")}`)
console.log(`EMITTED counts read from: ${CENSUS}`)
console.log("")

const shardDir = SHARD_DIR || path.join(HERE, ".adjudication-shards")
const union: Record<string, number> = {}
let blockDistinct = 0
let inlineDistinct = 0
let totalParsed = 0
const lostShards: number[] = []
const reusedShards: number[] = []
const parseFailures: string[] = []
const mergeCounts = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v
  return a
}
for (let s = 0; s < SHARDS; s++) {
  const mine = files.filter((_, i) => i % SHARDS === s)
  if (mine.length === 0) continue
  // Same opt-in resume contract as whole-corpus-census.ts: a payload is reusable only if it
  // was measured over this population with this shard count, and a resumed run says so.
  if (RESUME) {
    const p = path.join(shardDir, `${s}.json`)
    try {
      const prev = JSON.parse(readFileSync(p, "utf8")) as any
      if (prev?.populationSha256 === populationHash && prev?.shards === SHARDS) {
        mergeCounts(union, prev.union ?? {})
        blockDistinct = Math.max(blockDistinct, prev.blockDistinct ?? 0)
        inlineDistinct = Math.max(inlineDistinct, prev.inlineDistinct ?? 0)
        totalParsed += prev.parsed ?? 0
        parseFailures.push(...(prev.parseFailures ?? []))
        reusedShards.push(s)
        console.log(`shard ${s}: REUSED ${prev.parsed} parsed, union ${Object.keys(prev.union ?? {}).length} node types`)
        continue
      }
      console.log(`shard ${s}: stale payload on disk, re-running`)
    } catch {
      console.log(`shard ${s}: no reusable payload, running`)
    }
  }
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", SELF, "--shard", String(SHARDS), String(s), "--shard-dir", shardDir],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: REPO },
  )
  const done = (r.stdout ?? "").split("\n").find((l) => l.startsWith("@@DONE@@"))
  if (r.status !== 0 || !done) { lostShards.push(s); console.log(`shard ${s}: LOST (exit ${r.status}, ${mine.length} files)`); continue }
  console.log(done.replace("@@DONE@@ ", ""))
  const o = JSON.parse(readFileSync(path.join(shardDir, `${s}.json`), "utf8"))
  blockDistinct = Math.max(blockDistinct, o.blockDistinct)
  inlineDistinct = Math.max(inlineDistinct, o.inlineDistinct)
  totalParsed += o.parsed
  parseFailures.push(...o.failures)
  for (const [k, v] of Object.entries(o.union as Record<string, number>)) union[k] = (union[k] ?? 0) + v
}
const unionDistinct = Object.keys(union).length

// ─────────────────────────────────────────────────────────── the census's EMITTED counts
let census: any = null
try { census = JSON.parse(readFileSync(CENSUS, "utf8")) } catch { /* reported below */ }

const rows: { type: Type; status: string; detail: string }[] = []
for (const t of ALL_TYPES) {
  const obs = census?.types?.[t]?.count ?? 0
  if (obs > 0) {
    rows.push({
      type: t, status: "EMITTED",
      detail: `${obs.toLocaleString()} edges in ${(census?.types?.[t]?.files ?? 0).toLocaleString()} files over ${(census?.population?.admittedByRouter ?? 0).toLocaleString()} admitted files, e.g. ${(census?.types?.[t]?.exampleFiles ?? []).slice(0, 2).join(", ")}`,
    })
    continue
  }
  const ruled = MARKDOWN_RULED.find((r: Ruled) => r.type === t)
  // Instrument B, measured: walk the population's trees and run the row's own counter.
  let bCounts: { occurrences: number; files: number; examples: string[] } | null = null
  if (ruled?.instrument === "B:parse-tree-count" && typeof ruled.countOnTree === "function") {
    const hits: string[] = []
    let occurrences = 0
    const wts: any = await import("web-tree-sitter")
    const WSP = wts.Parser ?? wts.default
    const WSL = wts.Language ?? wts.default?.Language
    await WSP.init({ locateFile: () => path.join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    const pb = new WSP()
    pb.setLanguage(await WSL.load(readFileSync(path.join(REPO, "wasm", "tree-sitter-markdown.wasm"))))
    const filesHit = new Set<string>()
    for (const f of files) {
      const before = hits.length
      try { ruled.countOnTree(pb.parse(f.text)?.rootNode, `${f.repo}/${f.rel}`, hits) } catch { continue }
      occurrences += hits.length - before
      if (hits.length > before) filesHit.add(`${f.repo}/${f.rel}`)
    }
    bCounts = { occurrences, files: filesHit.size, examples: hits.slice(0, 3) }
    if (occurrences > 0) {
      rows.push({ type: t, status: "FALSIFIED", detail: `NOT EMITTED, but the construct occurs ${occurrences}x across ${filesHit.size} file(s) on the PARSE TREE. Instrument B. e.g. ${hits[0] ?? ""}` })
      continue
    }
  }
  if (ruled?.instrument === "A:grammar-inventory") {
    const present = (ruled.nodeTypesThatWouldMeanIt ?? []).filter((n) => n in union)
    if (present.length > 0) {
      rows.push({ type: t, status: "FALSIFIED", detail: `NOT EMITTED, but the grammar DOES produce ${present.join(", ")} — the construct exists. Instrument A.` })
      continue
    }
  }
  const ruling = rulingFor(t)
  if (!ruling) {
    rows.push({ type: t, status: "RULED-UNJUSTIFIED", detail: "NOT EMITTED and its construct is absent, but NO written ruling was found in the spec" })
    continue
  }
  // Instrument B has to be COUNTED, not asserted. The first version of this script printed
  // "the construct occurs 0x on the parse tree" for a `B:parse-tree-count` row without ever
  // calling `countOnTree` — a RULED-SOUND with no measurement behind it, which is the exact
  // failure this workstream exists to catch, inside the instrument written to catch it. No
  // markdown row declares instrument B today, so the branch was unreachable; it is now
  // unreachable AND loud rather than unreachable and quiet.
  const basis = ruled?.instrument === "A:grammar-inventory"
    ? `the grammar produced ${unionDistinct} distinct node types across ${totalParsed.toLocaleString()} parsed files (${blockDistinct} block, ${inlineDistinct} inline, union) and NONE expresses it`
    : bCounts === null
      ? "UNDECIDED — this row declares instrument B, whose `countOnTree` was not run by this script, so no count exists to rule on"
      : `the construct occurs ${bCounts.occurrences}x across ${bCounts.files} file(s) on the parse tree`
  rows.push({ type: t, status: "RULED-SOUND", detail: `NOT EMITTED; ${basis}. Written ruling: ${ruling.src}. Probe: ${ruled?.instrument ?? "(none declared)"}` })
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log("")
console.log(`${w("type", 14)}${w("status", 18)}detail`)
console.log("-".repeat(150))
for (const r of rows) console.log(`${w(r.type, 14)}${w(r.status, 18)}${r.detail}`)
const falsified = rows.filter((r) => r.status === "FALSIFIED")
const unjustified = rows.filter((r) => r.status === "RULED-UNJUSTIFIED")
const emitted = rows.filter((r) => r.status === "EMITTED")
const sound = rows.filter((r) => r.status === "RULED-SOUND")
console.log("-".repeat(150))
console.log(`emitted ${emitted.length}/10   ruled-sound ${sound.length}   FALSIFIED ${falsified.length}   ruled-without-justification ${unjustified.length}`)
console.log(`instrument A denominator: ${unionDistinct} distinct node types (block ${blockDistinct}, inline ${inlineDistinct}) over ${totalParsed} parsed files; shards lost ${lostShards.length}, reused from a prior invocation over the same population ${reusedShards.length}`)
if (parseFailures.length) console.log(`tree-sitter parse failures: ${parseFailures.length}; first: ${parseFailures.slice(0, 3).join(" | ")}`)
if (falsified.length) {
  console.log(`\n>>> THIS FAILS. ${falsified.map((r) => r.type).join(", ")} claimed inapplicable but demonstrably derivable from real code.`)
}
process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1

const outPath = path.join(path.dirname(path.resolve(CENSUS)), "ruling-table-adjudication.json")
writeFileSync(outPath, JSON.stringify({
  instrument: "markdown ruling-table adjudication (validation/m14/fixtures/markdown/ruling-table-adjudication.ts)",
  whatThisIs: "the procedure of script/m14/ontology-coverage-gate.ts applied to the whole admitted population, over the arbiter's own ruling table, with instrument A stated against the UNION of both pinned grammars",
  whatThisIsNot: "the arbiter's output. The arbiter was run twice on this corpus and both runs were killed by the shared self-destruct at src/ast/engine.ts:1411 before printing a verdict.",
  corpusRoot: CR,
  admittedByGateTest: files.length,
  census,
  instrumentA: { unionDistinct, blockDistinct, inlineDistinct, parsedFiles: totalParsed, shards: SHARDS, lostShards, nodeTypes: union },
  rows,
  summary: { emitted: emitted.length, ruledSound: sound.length, falsified: falsified.length, ruledWithoutJustification: unjustified.length },
}, null, 2) + "\n")
console.log(`\nwrote ${outPath}`)
