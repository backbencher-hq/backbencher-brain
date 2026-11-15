/**
 * ZIG AMBIGUITY SPLIT — `incoming-check`'s 19,962, decomposed.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-check.ts` produced the whole-corpus number for this lane:
 * 600 files, 7 types fired, **19,962 ambiguous** and 14,461 unresolved targets.
 * That number is correct and it is not actionable, because AMBIGUOUS is a single
 * counter standing for at least three different defects with three different fixes.
 *
 * The brief that carries this round names them:
 *
 *   1. N declarations share a name in DIFFERENT SCOPES — a scoping failure this
 *      lane may be able to repair;
 *   2. a name is declared in >1 table/module and the analyzer does not model
 *      which one is in scope;
 *   3. two genuinely different symbols share a published name, and the published
 *      name is not a unique identifier at all.
 *
 * If (3) dominates, the finding is about the PUBLISHED-NAME CONTRACT and not about
 * this analyzer, and saying otherwise would be the dishonest reading.
 *
 * ## What "ambiguous" actually means in that instrument — read this before the numbers
 *
 * `incoming-check.ts` builds `published: Map<name, kind[]>` — a name mapped to the
 * set of DISTINCT `SymbolKind`s under which it is published — and calls a target
 * ambiguous when `hits.length > 1`.
 *
 * So **ambiguous does NOT mean "N declarations share this name".** It means
 * *"this bare name is published under two or more different SymbolKinds"*. Two
 * members named `reserved`, one in `Elf32.Chdr` and one in `Elf64.Chdr`, are both
 * `property`, so they are **not** counted ambiguous by that instrument at all.
 *
 * That matters twice over. It means the 19,962 is a count of CROSS-KIND name
 * collisions, and it means this file has to reproduce `incoming-check`'s map
 * exactly to compare against it — so it does, deliberately, including its indexing
 * of `qualifiedName` beside `name` and its `hits.length > 1` test.
 *
 * ## The three buckets, defined so each can be computed and each can fail
 *
 * For an ambiguous edge (`type`, `source`, `target`) with target `T`, let
 * `S(T)` be every published declaration whose bare name is `T`, plus every one
 * whose `qualifiedName` is exactly `T`, deduped on `(file, qualifiedName, kind)`.
 *
 *   B3  published-name-is-not-unique
 *       `S(T)` is non-empty but every member of `S(T)` has the SAME
 *       `qualifiedName`. Spelling the target with the qualified name therefore
 *       cannot disambiguate it, because the qualified name is shared too. The
 *       edge names something that has no unique spelling in the index at all.
 *       NOT repairable by changing what an edge says.
 *
 *   B1  spelling-available-here  (the scoping failure this lane owns)
 *       `S(T)` holds two or more DISTINCT `qualifiedName`s, AND the edge's own
 *       `source + "." + T` is a published `qualifiedName` that is UNIQUE among
 *       `S(T)`. The analyzer was standing on the disambiguating coordinate — for
 *       `contains` the source IS the owner's absolute path — and did not put it
 *       on the edge. Repairable inside `real-zig-analyzer.ts`.
 *
 *   B2  scope-not-modelled
 *       `S(T)` holds two or more DISTINCT `qualifiedName`s, but the edge carries
 *       no coordinate that selects one: `source + "." + T` is absent, or is present
 *       and matches more than one member of `S(T)`. The information needed to
 *       disambiguate is not on the edge and not derivable from it.
 *
 * B1 and B2 are the two the brief calls repairable; B3 is not, and a B3 count is a
 * statement about the published-name contract rather than about this analyzer.
 *
 * ## Two things this file refuses to do
 *
 * 1. It does NOT widen the resolution universe with qualified names to make the
 *    numbers look better. `incoming-check`'s map is reproduced verbatim, so
 *    `--compare` can print this instrument's ambiguous count next to the fleet
 *    figure and the two must agree or the file says so.
 * 2. It does NOT report an unresolved target as a defect. An unresolved target
 *    naming something outside the 600-file window is not a defect, and this
 *    file reports unresolved per type only so the reader can subtract it.
 *
 * ## Usage
 *
 *   # one shard
 *   npx tsx validation/m14/fixtures/zig/ambiguity-split.ts --raw <out.json> [--files-from f.txt]
 *   # the merge, over the shard raws
 *   npx tsx validation/m14/fixtures/zig/ambiguity-split.ts --merge 'raw-*.json' [--compare <tsv>]
 *
 * Sharding is not optional here: `parseFile` carries cumulative WASM state, and
 * the census this lane already runs records that a single-process walk over the
 * full 3,834-file population trips the engine's 120 s `[BB-HANG]` self-destruct
 * on `zig/lib/std/builtin/assembly.zig` — a file that parses in 2.98 s alone.
 * 600 files in eight shards stays inside that, and the merge asserts the union of
 * the shards' file keys so a lost shard is visible rather than silently smaller.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (k: string, d = ""): string => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (!hit) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}

const SAMPLE = Number(arg("sample", "600"))
const SEED = arg("seed", "ontology-census-v1")
const RAW = arg("raw", "")
const FILES_FROM = arg("files-from", "")
const MERGE_GLOB = arg("merge", "")

// `imports`, not `brain_import`: `src/ast/types.ts:69` spells `RelationshipType.Imports`
// `brain_import` and `src/ast/engine.ts:454` spells the SAME member `imports`. Analyzers
// import the enum from engine, so a stored row carries `imports` and an instrument keyed on
// `brain_import` reports the type as 0 in every language WHILE EMITTING IT — a table that
// always reads zero looks like a finding. Both spellings are accepted here, matching the
// repair `incoming-check.ts` carries on `origin/main`, so `--compare` is like-for-like.
const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const
type Type = (typeof TYPES)[number]

const LABEL_ALIASES: Record<string, Type> = {
  calls: "calls",
  call: "calls",
  uses: "uses",
  contains: "contains",
  composition: "contains",
  part_of: "contains",
  imports: "imports",
  brain_import: "imports",
  references: "references",
  depends_on: "references",
  related: "references",
  exports: "exports",
  provides: "exports",
  extends: "extends",
  inheritance: "extends",
  implements: "implements",
  implementation: "implements",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
}

// ─────────────────────────────────────────────────────────── corpus draw
// Identical rule to `ontology-census.ts`: `git ls-files '*.zig'` per corpus repo,
// size-capped, ordered by sha256(`<seed>|<repo>/<rel>`), first N. Reproducible from a
// clean corpus; a hashed order is not claimed to be a statistical random sample.
type FileRec = { key: string; abs: string; dir: string }
function draw(): { draw: FileRec[]; admitted: number; drawHash: string } {
  const all: FileRec[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > 512 * 1024) continue
      } catch {
        continue
      }
      all.push({ key: `${e}/${rel}`, abs, dir })
    }
  }
  const hashed = all
    .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${f.key}`).digest("hex") }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((x) => x.f)
  let picked = SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
  if (FILES_FROM) {
    const want = new Set(
      readFileSync(path.resolve(ROOT, FILES_FROM), "utf8")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    picked = picked.filter((f) => want.has(f.key))
  }
  const drawHash = createHash("sha256").update(picked.map((f) => f.key).sort().join("\n")).digest("hex")
  return { draw: picked, admitted: all.length, drawHash }
}

// ─────────────────────────────────────────────────────────── shard mode
type SymRec = { n: string; k: string; q: string; o: string; l: number }
type RelRec = { t: string; s: string; g: string; l: number }

async function shard(): Promise<void> {
  const { draw: files, admitted, drawHash } = draw()
  const symbols: Record<string, SymRec[]> = {}
  const rels: Record<string, RelRec[]> = {}
  const fallback: string[] = []
  const failed: string[] = []
  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (e) {
      failed.push(`${f.key}: ${(e as Error)?.message ?? e}`)
      continue
    }
    if (!r) {
      failed.push(`${f.key}: no result`)
      continue
    }
    if (r.fallback === true) fallback.push(f.key)
    symbols[f.key] = (Array.isArray(r.symbols) ? r.symbols : []).map((s: any) => ({
      n: String(s?.name ?? ""),
      k: String(s?.kind ?? s?.type ?? ""),
      q: String(s?.qualifiedName ?? ""),
      o: String(s?.ownerName ?? s?.scope ?? ""),
      l: Number(s?.startLine ?? 0),
    }))
    rels[f.key] = (Array.isArray(r.relationships) ? r.relationships : []).map((x: any) => ({
      t: String(x?.type ?? x?.relationshipType ?? ""),
      s: String(x?.source ?? x?.from ?? x?.fromSymbol ?? ""),
      g: String(x?.target ?? x?.to ?? x?.toSymbol ?? ""),
      l: Number(x?.line_number ?? 0),
    }))
  }
  const payload = {
    tool: "zig-ambiguity-split",
    mode: "raw",
    seed: SEED,
    corpusRoot: CR,
    corpusAdmitted: admitted,
    drawHash: `sha256:${drawHash}`,
    files: files.map((f) => f.key),
    symbols,
    rels,
    fallback,
    failed,
  }
  if (!RAW) {
    console.error("--raw is required in shard mode")
    process.exit(2)
  }
  writeFileSync(RAW, JSON.stringify(payload))
  const nsym = Object.values(symbols).reduce((a, b) => a + b.length, 0)
  const nrel = Object.values(rels).reduce((a, b) => a + b.length, 0)
  console.log(`zig ambiguity-split raw -> ${RAW}`)
  console.log(`  files ${files.length}  symbols ${nsym}  relationships ${nrel}  fallback ${fallback.length}  failed ${failed.length}`)
  console.log(`  draw ${`sha256:${drawHash}`}`)
}

// ─────────────────────────────────────────────────────────── merge mode
type Site = { file: string; q: string; k: string; l: number }

function merge(): void {
  const pattern = MERGE_GLOB
  if (!pattern) {
    console.error("--merge '<glob>' is required in merge mode")
    process.exit(2)
  }
  const base = path.resolve(ROOT, path.dirname(pattern))
  const rx = new RegExp("^" + path.basename(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$")
  const shards = readdirSync(base)
    .filter((n) => rx.test(n))
    .sort()
  if (shards.length === 0) {
    console.error(`no shard raws matched ${pattern} under ${base}`)
    process.exit(2)
  }
  const symByFile: Record<string, SymRec[]> = {}
  const relByFile: Record<string, RelRec[]> = {}
  const fallback: string[] = []
  const failed: string[] = []
  const drawHashes = new Set<string>()
  let corpusAdmitted = 0
  let seeds = new Set<string>()
  for (const n of shards) {
    const j = JSON.parse(readFileSync(path.join(base, n), "utf8"))
    drawHashes.add(j.drawHash)
    seeds.add(j.seed)
    corpusAdmitted = j.corpusAdmitted
    for (const f of j.files as string[]) {
      if (symByFile[f]) throw new Error(`shard overlap on ${f} — two shards walked the same file`)
      symByFile[f] = j.symbols[f] ?? []
      relByFile[f] = j.rels[f] ?? []
    }
    fallback.push(...(j.fallback ?? []))
    failed.push(...(j.failed ?? []))
  }

  const files = Object.keys(symByFile).sort()
  const unionHash = `sha256:` + createHash("sha256").update(files.join("\n")).digest("hex")

  // `incoming-check.ts`'s map, reproduced verbatim: bare name -> DISTINCT kinds, with
  // qualifiedName indexed beside it when it differs. Reproduced rather than
  // approximated so `--compare` is a like-for-like comparison.
  const kindsOf = new Map<string, Set<string>>()
  const sitesOf = new Map<string, Site[]>()
  const qualSites = new Map<string, Site[]>()
  const addSite = (map: Map<string, Site[]>, k: string, v: Site) => {
    const a = map.get(k)
    if (a) a.push(v)
    else map.set(k, [v])
  }
  for (const f of files) {
    for (const s of symByFile[f]) {
      if (s.n.length === 0) continue
      let set = kindsOf.get(s.n)
      if (!set) kindsOf.set(s.n, (set = new Set()))
      set.add(s.k)
      addSite(sitesOf, s.n, { file: f, q: s.q || s.n, k: s.k, l: s.l })
      if (s.q.length > 0 && s.q !== s.n) {
        set = kindsOf.get(s.q)
        if (!set) kindsOf.set(s.q, (set = new Set()))
        set.add(s.k)
        addSite(qualSites, s.q, { file: f, q: s.q, k: s.k, l: s.l })
      }
    }
  }
  // A target string is looked up in one map. `incoming-check` puts a symbol in the
  // map under BOTH spellings, so the site list for a spelling must be able to
  // contain the same symbol found either way — dedupe on (file,q,k,l).
  const sitesFor = (t: string): Site[] => {
    const byName = sitesOf.get(t) ?? []
    const byQual = qualSites.get(t) ?? []
    const seen = new Set<string>()
    const out: Site[] = []
    for (const s of [...byName, ...byQual]) {
      const id = `${s.file}|${s.q}|${s.k}|${s.l}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push(s)
    }
    return out
  }

  type Row = {
    edges: number
    distinctTargets: number
    unresolved: number
    ambiguous: number
    selfLoops: number
    B1_spellingAvailable: number
    B2_scopeNotModelled: number
    B3_publishedNameNotUnique: number
    b3Names: Record<string, number>
    b1Names: Record<string, number>
    b2Names: Record<string, number>
  }
  const blank = (): Row => ({
    edges: 0,
    distinctTargets: 0,
    unresolved: 0,
    ambiguous: 0,
    selfLoops: 0,
    B1_spellingAvailable: 0,
    B2_scopeNotModelled: 0,
    B3_publishedNameNotUnique: 0,
    b3Names: {},
    b1Names: {},
    b2Names: {},
  })
  const perType: Record<string, Row> = {}
  for (const t of TYPES) perType[t] = blank()

  const declaredNames: string[] = []
  for (const f of files) for (const s of symByFile[f]) if (s.n.length > 0) declaredNames.push(s.n)

  const named = new Set<string>()
  const ambNames = new Set<string>()
  for (const f of files) {
    for (const raw of relByFile[f]) {
      const t = LABEL_ALIASES[raw.t]
      if (!t) continue
      const row = perType[t]
      if (!row) continue
      row.edges++
      const src = raw.s
      const tgt = raw.g
      if (tgt.length === 0) continue
      if (src === tgt) {
        row.selfLoops++
        // `incoming-check.ts` reports `ambiguousTargets`/`unresolvedTargets` from a SECOND
        // pass (its lines 197-216) that re-walks `rels` and does NOT skip self-loops, so
        // the figure it prints includes them. Counted here rather than silently matched,
        // because a self-loop whose target also names a colliding declaration is a
        // collision the reverse walk will hit too.
        const sh = kindsOf.get(tgt)
        if (sh && sh.size === 0) row.unresolved++
        else if (sh && sh.size > 1) row.ambiguous++
        continue
      }
      const hits = kindsOf.get(tgt)
      if (!hits || hits.size === 0) {
        row.unresolved++
        continue
      }
      named.add(tgt)
      if (hits.size > 1) {
        row.ambiguous++
        ambNames.add(tgt)
        const sites = sitesFor(tgt)
        const quals = new Set(sites.map((s) => s.q))
        if (quals.size <= 1) {
          row.B3_publishedNameNotUnique++
          row.b3Names[tgt] = (row.b3Names[tgt] ?? 0) + 1
        } else {
          const comp = `${src}.${tgt}`
          const compQuals = new Set(
            sites.filter((s) => s.q === comp).map((s) => `${s.file}|${s.q}|${s.k}`),
          )
          if (compQuals.size === 1) {
            row.B1_spellingAvailable++
            row.b1Names[tgt] = (row.b1Names[tgt] ?? 0) + 1
          } else {
            row.B2_scopeNotModelled++
            row.b2Names[tgt] = (row.b2Names[tgt] ?? 0) + 1
          }
        }
      }
      }
  }
  for (const t of TYPES) {
    const targets = new Set<string>()
    for (const f of files)
      for (const raw of relByFile[f])
        if (LABEL_ALIASES[raw.t] === t && raw.g.length > 0 && kindsOf.has(raw.g)) targets.add(raw.g)
    perType[t].distinctTargets = targets.size
  }

  const orphans = declaredNames.filter((n) => !named.has(n)).length
  const report = {
    tool: "zig-ambiguity-split",
    mode: "merge",
    shards: shards.map((n) => path.basename(n)),
    shardCount: shards.length,
    seed: [...seeds],
    corpusAdmitted,
    files: files.length,
    unionHash,
    drawHashes: [...drawHashes],
    symbols: files.reduce((a, f) => a + symByFile[f].length, 0),
    relationships: files.reduce((a, f) => a + relByFile[f].length, 0),
    fallbackFiles: fallback.length,
    failedFiles: failed,
    distinctIncomingTargets: named.size,
    declaredNames: declaredNames.length,
    orphanDeclarations: orphans,
    orphanRate: declaredNames.length ? orphans / declaredNames.length : 0,
    ambiguousTargetNames: ambNames.size,
    perType,
  }

  const out = arg("out", "")
  if (out) writeFileSync(path.resolve(ROOT, out), JSON.stringify(report, null, 2))

  const pad = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
  console.log(`zig ambiguity split — ${report.files} file(s) over ${shards.length} shard(s), ${report.symbols} symbols, ${report.relationships} relationships`)
  console.log(`corpus admitted ${corpusAdmitted}  fallback ${fallback.length}  failed ${report.failedFiles.length}  union ${unionHash}`)
  if (drawHashes.size > 1) console.log(`WARNING: shards disagree on drawHash: ${[...drawHashes].join(" ")}`)
  console.log("")
  console.log(
    pad("type", 13) + pad("edges", 9) + pad("distinct", 10) + pad("amb", 9) + pad("B1", 9) + pad("B2", 9) + pad("B3", 9) + "unres",
  )
  console.log("-".repeat(76))
  let te = 0, ta = 0, tb1 = 0, tb2 = 0, tb3 = 0, tu = 0
  for (const t of TYPES) {
    const r = perType[t]
    te += r.edges
    ta += r.ambiguous
    tb1 += r.B1_spellingAvailable
    tb2 += r.B2_scopeNotModelled
    tb3 += r.B3_publishedNameNotUnique
    tu += r.unresolved
    console.log(
      pad(t, 13) + pad(r.edges, 9) + pad(r.distinctTargets, 10) + pad(r.ambiguous, 9) + pad(r.B1_spellingAvailable, 9) + pad(r.B2_scopeNotModelled, 9) + pad(r.B3_publishedNameNotUnique, 9) + r.unresolved,
    )
  }
  console.log("-".repeat(76))
  console.log(
    pad("TOTAL", 13) + pad(te, 9) + pad("", 10) + pad(ta, 9) + pad(tb1, 9) + pad(tb2, 9) + pad(tb3, 9) + tu,
  )
  console.log("")
  console.log(`B1 spelling available on the edge itself : ${tb1}  (${pct(tb1, ta)} of ambiguous)`)
  console.log(`B2 scope not modelled                    : ${tb2}  (${pct(tb2, ta)} of ambiguous)`)
  console.log(`B3 published name is not a unique id      : ${tb3}  (${pct(tb3, ta)} of ambiguous)`)
  console.log(`distinct names carrying an ambiguous edge : ${ambNames.size}`)
  console.log(`declarations nothing names (orphans)      : ${orphans} of ${declaredNames.length} (${(report.orphanRate * 100).toFixed(2)}%)`)

  const cmp = arg("compare", "")
  if (cmp) {
    const tsv = readFileSync(path.resolve(ROOT, cmp), "utf8")
    const row = tsv.split("\n").find((l) => l.split("\t")[0] === "zig")
    if (!row) console.log(`\n--compare: no zig row in ${cmp}`)
    else {
      const [, f, fired, amb, unres] = row.split("\t")
      console.log("")
      console.log(`--compare ${cmp} (the fleet figure):`)
      console.log(`  files    ${pad(row[1] ?? "", 10)} this run ${pad(report.files, 10)} ${report.files === Number(f) ? "AGREE" : "DIFFER"}`)
      console.log(`  fired    ${pad(fired, 10)} this run ${pad(TYPES.filter((t) => perType[t].edges > 0).length, 10)} ${TYPES.filter((t) => perType[t].edges > 0).length === Number(fired) ? "AGREE" : "DIFFER"}`)
      console.log(`  amb      ${pad(amb, 10)} this run ${pad(ta, 10)} ${ta === Number(amb) ? "AGREE" : "DIFFER"}`)
      console.log(`  unres    ${pad(unres, 10)} this run ${pad(tu, 10)} ${tu === Number(unres) ? "AGREE" : "DIFFER"}`)
    }
  }

  // The top names in each bucket, so a reader can go and look at them.
  const top = (rec: Record<string, number>, n = 12) =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k} (${v})`)
  console.log("")
  for (const t of TYPES) {
    const r = perType[t]
    if (r.B1_spellingAvailable) console.log(`${t} B1 top: ${top(r.b1Names).join(", ")}`)
    if (r.B2_scopeNotModelled) console.log(`${t} B2 top: ${top(r.b2Names).join(", ")}`)
    if (r.B3_publishedNameNotUnique) console.log(`${t} B3 top: ${top(r.b3Names).join(", ")}`)
  }
}

function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`
}

if (MERGE_GLOB) merge()
else await shard()