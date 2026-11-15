/**
 * MARKDOWN FIRING-CORPUS CENSUS — the coverage block's own measurement, on current bytes.
 *
 * ## Why a second census next to `validation/m60/markdown/whole-corpus-census.json`
 *
 * The board's markdown row descends from `script/m14/firing-check.mjs MARKDOWN_B`, whose
 * population is **redwood** and whose default is a 120-file even stride. The whole-population
 * census that already exists was measured over 17,456 admitted files on 2026-10-04 22:19, and
 * `src/ast/real-markdown-analyzer.ts` last changed 2026-10-05 14:13 (`a74cf929e`, MD-G4): the
 * number and the bytes it describes are not the same bytes. So this script measures TWO things
 * on the CURRENT tree, and both are needed by the coverage block:
 *
 *   1. THE WHOLE FIRING CORPUS, not a draw of it. Every `.md` file under redwood that
 *      `firing-check.mjs` would admit (same extension, same 400 KB cap, same exact-name
 *      `.git`/`node_modules` skip — corrected in 28d79cb99), through the same production path:
 *      `engine.parseFile`. So a type that is SILENT in the 120-file log can be told apart from
 *      a type that is ABSENT FROM THE FIRING CORPUS — which is the actual question for
 *      `imports` (MD-G3).
 *
 *   2. INSTRUMENT A, re-run over the grammar-inventory denominator. The adjudication shards in
 *      `validation/m14/fixtures/markdown/.adjudication-shards/` hold the union of both pinned
 *      grammars' node types over the whole admitted population; this script merges them and
 *      re-applies each `MARKDOWN_RULED` row's vocabulary test — WITH A PLANTED POSITIVE CONTROL,
 *      because a membership test that has only ever returned 0 is not evidence that the
 *      vocabulary is absent, only that nothing was looked for (rule-book §7).
 *
 * Nothing here is a copy of the analyzer's rules: the edge counts come out of `parseFile`, and
 * the node types come out of the pinned wasms. The only hand-written data read is the ruling
 * table `script/m14/markdown-ruled.ts` — the arbiter's own module, not a copy of it.
 *
 * ## `BB_MD_CORPUS` takes a comma-separated list, and that is how `imports` is re-verified
 *
 * `imports` is the one silent type that IS emitted (MD-G3), so the question for it is not
 * whether the grammar can express it but where on earth it fires: the 2026-10-04 census
 * attributes all 105 of its edges to four repos — traefik 57, bulma 35, vega 12, scala3 1 —
 * and NONE of them is redwood. `BB_MD_CORPUS=traefik,bulma,vega,scala3` therefore re-measures
 * the construct on the bytes that exist now, against the census's own attribution; the redwood
 * row (the firing log's corpus) is measured by the default invocation. The two are reported
 * separately and never averaged, because they answer different questions.
 *
 * Usage:
 *   bun validation/m14/fixtures/markdown/firing-corpus-census.ts [--shards 6] [--out <path>]
 *   BB_MD_CORPUS=traefik,bulma,vega,scala3 bun … --out validation/m14/fixtures/markdown/imports-reverification.json
 *   (# children are spawned as `--shard i --shards N --shard-dir <dir>` and write one JSON each)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = path.join(HERE, "firing-corpus-census.ts")
const REPO = path.resolve(HERE, "../../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
/** One or more repo dirs under the corpus root. Default is firing-check's MARKDOWN_B corpus. */
const CORPUS_DIRS = (process.env.BB_MD_CORPUS ?? "redwood").split(",").filter(Boolean)
const SIZE_CAP = 400_000 // firing-check's admission cap
const POP_CAP = Number(process.env.BB_SAMPLE_POP || 20000)

const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SHARD_INDEX = argv.indexOf("--shard")
const IS_CHILD = SHARD_INDEX >= 0
const CHILD_SHARDS = Number(argv[SHARD_INDEX + 1] ?? "1")
const CHILD_INDEX = Number(argv[SHARD_INDEX + 2] ?? "0")
const SHARD_DIR = argOf("shard-dir", path.join(HERE, ".firing-census-shards"))
const OUT = path.resolve(REPO, argOf("out", "validation/m14/fixtures/markdown/firing-corpus-census.json"))
const SKIP_EDGES = argv.includes("--instrument-a-only")

const ONTOLOGY_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const sha256 = (buf: Buffer | string): string => createHash("sha256").update(buf).digest("hex")

/** The ONE admission this script and the firing log share: `.md`, under 400 KB, no VCS/vendor dirs. */
type Admitted = { repo: string; abs: string }
function population(): Admitted[] {
  const all: Admitted[] = []
  for (const repo of CORPUS_DIRS) {
    const walk = (d: string, depth: number): void => {
      if (all.length >= POP_CAP || depth > 20) return
      let ents: ReturnType<typeof readdirSync>
      try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of ents as any[]) {
        if (all.length >= POP_CAP) return
        const p = path.join(d, e.name)
        // EXACT NAME, matching firing-check.mjs as of 28d79cb99. Until that commit this walk —
        // and firing-check's — used a SUBSTRING test, which pruned `.github` (and `.gitlab`,
        // `.gitbook`) as well as `.git`: this census recorded 2,101 redwood files where the
        // corpus holds 2,105, and because BOTH instruments shared the wrong rule the loss was
        // invisible in both at once. That is the lesson the shared-admission bug teaches, and
        // it is why the corrected rule is copied here rather than re-invented.
        if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p, depth + 1) }
        else if (e.name.endsWith(".md")) { try { if (statSync(p).size < SIZE_CAP) all.push({ repo, abs: p }) } catch { /* unreadable */ } }
      }
    }
    walk(path.join(CORPUS_ROOT, repo), 0)
  }
  return all.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
}
const labelOf = (f: Admitted): string => `${f.repo}/${path.relative(path.join(CORPUS_ROOT, f.repo), f.abs)}`

// ─────────────────────────────────────────────────────────── child: parseFile over my slice
if (IS_CHILD) {
  if (!SHARD_DIR) { console.error("--shard requires --shard-dir"); process.exit(2) }
  const files = population()
  const mine = files.filter((_, i) => i % CHILD_SHARDS === CHILD_INDEX)
  const types: Record<string, number> = {}
  const importSites: { file: string; target: string; line: number | null }[] = []
  const degradedFiles: { file: string; reason: string }[] = []
  const errors: string[] = []
  let parsed = 0
  const t0 = Date.now()
  if (!SKIP_EDGES) {
    const { parseFile } = await import(`${REPO}/src/ast/engine.ts`)
    for (const f of mine) {
      const rel = labelOf(f)
      let content: string
      try { content = readFileSync(f.abs, "utf8") } catch { errors.push(`${rel}: unreadable`); continue }
      try {
        const res = await parseFile(f.abs, content)
        const md: any = (res as any)?.metadata ?? {}
        // firing-check's own degradation test, verbatim: a degraded file is not analyzer evidence.
        const degraded = md.fallback === true || md.analysisVersion === "2.0-basic-fallback"
        if (degraded) { degradedFiles.push({ file: rel, reason: String(md.fallbackReason ?? md.analysisVersion).slice(0, 60) }); continue }
        parsed++
        for (const r of ((res as any)?.relationships ?? []) as any[]) {
          const t = r.relationshipType ?? r.type
          if (!t) continue
          types[t] = (types[t] ?? 0) + 1
          if (t === "imports") {
            // UniversalRelationship's line field is `line_number` (src/ast/types.ts:206).
            // The first version of this record read `lineNumber`/`line`, so every site in the
            // artifact carried `null` while the analyzer had emitted the line all along.
            importSites.push({
              file: rel,
              target: String(r.targetSymbol ?? r.target ?? r.targetName ?? ""),
              line: typeof r.line_number === "number" ? r.line_number : typeof r.lineNumber === "number" ? r.lineNumber : null,
            })
          }
        }
      } catch (e: any) { errors.push(`${rel}: ${String(e?.message ?? e).slice(0, 60)}`) }
    }
  }
  mkdirSync(SHARD_DIR, { recursive: true })
  const payload = {
    shard: CHILD_INDEX, shards: CHILD_SHARDS, corpusDirs: CORPUS_DIRS,
    populationSize: files.length, assigned: mine.length, parsed,
    types, importSites, degradedFiles, errors, tookMs: Date.now() - t0,
    analyzerSha256: sha256(readFileSync(path.join(REPO, "src/ast/real-markdown-analyzer.ts"))),
  }
  writeFileSync(path.join(SHARD_DIR, `${CHILD_INDEX}.json`), JSON.stringify(payload, null, 1) + "\n")
  console.log(`@@DONE@@ shard ${CHILD_INDEX}: ${mine.length} files, ${parsed} parsed, ${Object.keys(types).length} types, ${degradedFiles.length} degraded, ${importSites.length} imports sites, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  process.exit(0)
}

// ─────────────────────────────────────────────────────────── parent
const SHARDS = Math.max(1, Number(argOf("shards", "6")))
const files = population()
console.log("markdown firing-corpus census — production parseFile, whole population")
console.log(`corpus        ${CORPUS_DIRS.map((d) => path.join(CORPUS_ROOT, d)).join(", ")}`)
console.log(`admission     .md, < ${SIZE_CAP} bytes, no .git/node_modules (firing-check.mjs's own rule)`)
console.log(`population    ${files.length} files`)
console.log(`analyzer      src/ast/real-markdown-analyzer.ts sha256 ${sha256(readFileSync(path.join(REPO, "src/ast/real-markdown-analyzer.ts"))).slice(0, 16)}`)
console.log("")

const types: Record<string, number> = {}
const importSites: any[] = []
const degradedFiles: any[] = []
const errors: string[] = []
const lostShards: number[] = []
let parsed = 0
if (!SKIP_EDGES) {
  for (let s = 0; s < SHARDS; s++) {
    const mine = files.filter((_, i) => i % SHARDS === s)
    if (mine.length === 0) continue
    const r = spawnSync(process.execPath, [SELF, "--shard", String(SHARDS), String(s), "--shard-dir", SHARD_DIR], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: REPO })
    const done = (r.stdout ?? "").split("\n").find((l) => l.startsWith("@@DONE@@"))
    if (r.status !== 0 || !done) { lostShards.push(s); console.log(`shard ${s}: LOST (exit ${r.status}, ${mine.length} files) — reported, not counted as zero`); continue }
    console.log(done.replace("@@DONE@@ ", ""))
    const o = JSON.parse(readFileSync(path.join(SHARD_DIR, `${s}.json`), "utf8"))
    parsed += o.parsed
    for (const [k, v] of Object.entries(o.types as Record<string, number>)) types[k] = (types[k] ?? 0) + v
    importSites.push(...o.importSites)
    degradedFiles.push(...o.degradedFiles)
    errors.push(...o.errors)
  }
}

// ─────────────────────────────────────────────────────────── instrument A: node-type union + control
const shardDirA = path.join(HERE, ".adjudication-shards")
const union: Record<string, number> = {}
let aShards = 0, aParsed = 0
const popHashes = new Set<string>()
try {
  for (const f of readdirSync(shardDirA).sort()) {
    const j = JSON.parse(readFileSync(path.join(shardDirA, f), "utf8"))
    aShards++; aParsed += j.parsed ?? 0
    if (j.populationSha256) popHashes.add(j.populationSha256)
    for (const [k, v] of Object.entries(j.union as Record<string, number>)) union[k] = (union[k] ?? 0) + v
  }
} catch { /* reported as 0 types below */ }
const unionNames = Object.keys(union).sort()
const { MARKDOWN_RULED } = await import(`${REPO}/script/m14/markdown-ruled.ts`)
/** The exact membership test `ruling-table-adjudication.ts` runs for an A row. */
const presentIn = (vocab: string[], names: string[]): string[] => vocab.filter((n) => names.includes(n))

const instrumentA: any[] = []
let controlFires = 0
for (const row of MARKDOWN_RULED as any[]) {
  if (row.instrument !== "A:grammar-inventory") continue
  const vocab: string[] = row.nodeTypesThatWouldMeanIt ?? []
  const present = presentIn(vocab, unionNames)
  // THE CONTROL. Plant one node type the union is KNOWN to contain into the row's own
  // vocabulary and re-run the SAME filter: if the filter cannot see a planted member, then
  // every 0 above is a statement about the filter, not about the grammar (rule-book §7).
  const plantedName = unionNames.includes("document") ? "document" : unionNames[0]
  const plantedPresent = presentIn([...vocab, plantedName], unionNames)
  const controlFiresHere = plantedPresent.includes(plantedName) && present.length === 0
  if (controlFiresHere) controlFires++
  instrumentA.push({
    type: row.type, vocabularySize: vocab.length, presentInUnion: present,
    control: { planted: plantedName, vocabularySize: vocab.length + 1, presentAfterPlanting: plantedPresent, fires: controlFiresHere },
  })
}

// wasm pins: the inventory's denominator is only the grammar's if these bytes are the pinned ones.
let pins: any = null
try {
  const p = JSON.parse(readFileSync(path.join(REPO, "validation/m14/grammar-pins.json"), "utf8"))
  // The lane entries live under `lanes` (schemaVersion 2); the earlier `p.markdown` lookup
  // found nothing and reported MISMATCH on two files that hash to their pinned values —
  // a false alarm produced by reading the wrong key, recorded here because a pin check that
  // can only say MISMATCH is worse than no check.
  const mdPins = p?.lanes?.markdown ?? p?.markdown
  const wired = mdPins?.wired
  const inlineCopy = (mdPins?.copies ?? []).find((c: any) => String(c.label ?? "").includes("INLINE"))
  const blockSha = sha256(readFileSync(path.join(REPO, "wasm/tree-sitter-markdown.wasm")))
  const inlineSha = sha256(readFileSync(path.join(REPO, "wasm/tree-sitter-markdown_inline.wasm")))
  pins = {
    block: { sha256: blockSha, pinnedSha256: wired?.sha256 ?? null, matches: wired?.sha256 === blockSha },
    inline: { sha256: inlineSha, pinnedSha256: inlineCopy?.sha256 ?? null, matches: inlineCopy?.sha256 === inlineSha },
  }
} catch (e: any) { pins = { error: String(e?.message ?? e).slice(0, 80) } }

// ─────────────────────────────────────────────────────────── report
console.log("── firing corpus, production parseFile over the WHOLE population ──")
if (lostShards.length) console.log(`shards lost: ${lostShards.join(",")} of ${SHARDS} — those files were NOT measured and are not zero`)
console.log(`parsed ${parsed}/${files.length} files, ${degradedFiles.length} degraded (excluded, not analyzer evidence)`)
for (const t of ONTOLOGY_TYPES) console.log(`  ${t.padEnd(13)} ${String(types[t] ?? 0).padStart(7)}`)
const extra = Object.keys(types).filter((t) => !ONTOLOGY_TYPES.includes(t))
if (extra.length) console.log(`  non-ontology types: ${extra.map((t) => `${t}:${types[t]}`).join(" ")}`)
console.log(`imports sites: ${importSites.length}${importSites.length ? ` e.g. ${importSites.slice(0, 3).map((s) => `${s.file}:${s.line}`).join(", ")}` : ""}`)
if (degradedFiles.length) console.log(`degraded files: ${degradedFiles.slice(0, 4).map((d) => `${d.file} (${d.reason})`).join(", ")}${degradedFiles.length > 4 ? ` …+${degradedFiles.length - 4}` : ""}`)
console.log("")
console.log("── instrument A: node-type union over the admitted population, and the planted control ──")
console.log(`union ${unionNames.length} distinct node types over ${aParsed.toLocaleString()} parsed files (${aShards} shards, population hashes ${[...popHashes].join(",") || "none"})`)
for (const r of instrumentA) console.log(`  ${String(r.type).padEnd(13)} vocabulary ${String(r.vocabularySize).padStart(2)}  present in union: ${r.presentInUnion.length === 0 ? "NONE" : r.presentInUnion.join(",")}   control(planted ${r.control.planted}): ${r.control.fires ? "FIRES" : "DID NOT FIRE"}`)
console.log(`controls fired ${controlFires}/${instrumentA.length}`)
console.log(`wasm pins  block ${pins?.block?.matches ? "MATCH" : "MISMATCH"}  inline ${pins?.inline?.matches ? "MATCH" : "MISMATCH"}`)

writeFileSync(OUT, JSON.stringify({
  instrument: "markdown firing-corpus census + instrument A re-run (validation/m14/fixtures/markdown/firing-corpus-census.ts)",
  whatThisIs: "production `parseFile` over the WHOLE redwood markdown population (firing-check's own corpus and admission), plus the pinned grammars' node-type union re-tested against each A-row vocabulary with a planted positive control",
  whatThisIsNot: "script/m14/firing-check.mjs's output — that instrument strides 120 files, this one measures every admitted file, and the two are reported together, never merged",
  command: `bun validation/m14/fixtures/markdown/firing-corpus-census.ts --shards ${SHARDS}`,
  corpusRoot: CORPUS_ROOT, corpusDirs: CORPUS_DIRS, admission: `.md, < ${SIZE_CAP} bytes, no .git/node_modules`,
  analyzerSha256: sha256(readFileSync(path.join(REPO, "src/ast/real-markdown-analyzer.ts"))),
  population: files.length, shards: SHARDS, lostShards, parsed,
  degraded: { count: degradedFiles.length, files: degradedFiles },
  types, importSites, errors,
  instrumentA: { unionDistinct: unionNames.length, parsedFiles: aParsed, shards: aShards, populationHashes: [...popHashes], rows: instrumentA, controlsFired: controlFires },
  wasmPins: pins,
}, null, 2) + "\n")
console.log(`\nwrote ${path.relative(REPO, OUT)}`)
