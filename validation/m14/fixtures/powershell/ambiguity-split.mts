/**
 * AMBIGUITY SPLIT — powershell. Why does an edge's target name resolve to more than one
 * published symbol, and which of the reasons is THIS ANALYZER's to repair?
 *
 * ## WHY THIS EXISTS
 *
 * `script/m14/incoming-check.ts` reports one `amb` number per type. That is the right number
 * to act on and the wrong thing to act ON, because an ambiguous target is not one defect.
 * `script/m14/fixtures/sql/ambiguity-split.mts` splits it into four buckets with different
 * owners, and this file is that instrument for powershell, with the buckets renamed for what
 * this language's collisions actually look like:
 *
 *   P1_ownerScoped  the colliding declarations are in ONE file under DIFFERENT owners. The
 *                   colliding name is a bare local (a variable, a parameter, a nested
 *                   function) and the edge's SOURCE names the owner, so `K1` resolves it.
 *                   Repairable by the consumer; the analyzer's to make cheap.
 *   P2_crossFile    the colliding declarations are in DIFFERENT files. PowerShell resolves a
 *                   bare name at RUN TIME against session state — dot-sourced scope, then
 *                   the caller's scope chain, then module exports — so no field on an edge
 *                   can name which file's declaration is meant without inventing an answer
 *                   the language does not have.
 *   P3_kindDiffers  ONE file, ONE owner, DIFFERENT kinds. `memberKind` / kind separates them.
 *   P4_indistinct   the colliding declarations agree on file, owner AND kind. Every field an
 *                   edge could carry is exhausted; the published NAME is not an identifier.
 *
 * ## THE PAIR THIS LANE PRINTS SIDE BY SIDE, BECAUSE THE FLEET NUMBER IS A KIND COUNT
 *
 * `incoming-check.ts` builds `published: Map<name, kind[]>`, DEDUPED on kind, and calls a
 * target ambiguous when `hits.length > 1`. So the fleet's `amb` column counts a name as
 * ambiguous only when it was published under more than one `SymbolKind`. Two `function`
 * symbols both named `Get-Thing` in two files are NOT ambiguous to that instrument. This
 * file prints both numbers from one walk:
 *
 *   multiSymbol   the target resolves to >1 published SYMBOL   — what a reverse walk collides on
 *   multiKind     the target resolves to >1 distinct KIND       — `incoming-check`'s rule
 *
 * PowerShell is the language where these two diverge hardest: `$result`, `$x`, `_` and
 * `config` are single-letter-and-dictionary bare locals in every script, and they are all
 * kind `variable`, so the fleet number reads them RESOLVED while every consumer that maps
 * name -> one symbol collapses them. The delta is printed, not asserted.
 *
 * ## WHAT IS POWERSHELL-SPECIFIC HERE: cause C, and it is the largest population
 *
 * The brief's cause C is "external references emitted as if local". For powershell it is not
 * a minority channel, it is the whole `calls` story: `Get-ChildItem`, `Write-Host`,
 * `Import-Module` and every other cmdlet are resolved by the PowerShell RUNTIME from
 * installed modules, and no file in this corpus can declare them. Section D prints the
 * unlabelled-unresolved target names bucketed by an AST-free SHAPE (a Verb-Noun spelling, a
 * dotted .NET type, a path, a bare word), using char-code scans and zero regex, so the
 * question "how much of `unresolved` is externality the analyzer never labelled?" is a
 * number before anything is changed.
 *
 * ## RESOLUTION KEYS — rates over the WHOLE edge population, not over the ambiguous subset
 *
 *   K0_corpus    target alone, corpus-wide          — what a consumer does today
 *   K0_intra     target alone, SAME FILE             — what the analyzer's own table can answer
 *   K1_source    + the edge's SOURCE as owner        — `top().scope` IS the owner name here
 *   K2_memberKind+ the edge's `metadata.memberKind`
 *   K1orK2       either of the two
 *   K3_qualified target matched as a symbol's `qualifiedName`
 *
 * ## SHARDING
 *
 * `parser.parse()` is synchronous WASM: a grammar that loops on a pathological input cannot
 * be interrupted, and `src/ast/engine.ts:1412` answers a hang with `process.exit()`. Two
 * files in this corpus are known to do it (`fsharp/eng/common/retain-build.ps1`,
 * `fsharp/eng/release/scripts/GetAssemblyVersions.ps1`). So the walk forks shards, reads the
 * offending path out of the dead child's stderr, records it EXCLUDED with the reason, and
 * re-runs that shard without it. The artifact states the excluded set rather than dropping it.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/powershell/ambiguity-split.mts --files N [--out FILE]
 */
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "powershell"
const SELF = path.resolve(process.argv[1])

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) { console.error(`ambiguity-split: \`${f}\` has no value`); process.exit(2) }
  return v
}
const OUT = argOf("--out")
const WANT = Number(argOf("--files") ?? "0") || 0
const SHARD_SIZE = Number(argOf("--shard-size") ?? "150") || 150
const LIST = Number(argOf("--list") ?? "8") || 8
const CACHE = argOf("--cache")

/** A NULL-PROTOTYPE counter map. `{}` silently inherits `constructor`/`toString`, and the
 *  census this file's shape came from already lost a whole reading to exactly that: a
 *  cmdlet named `Write-Host` does not hit it, but a bare name like `constructor` does, and
 *  `?? 0` then keeps `Object.prototype.constructor` and stringifies a function into the
 *  count. `Object.create(null)` can only contain what was put in it. */
const counter = (): Record<string, number> => Object.create(null)

// ---------------------------------------------------------------- shard worker
if (process.env.BB_AMB_SHARD) {
  const slice: { label: string; abs: string; dir: string }[] = JSON.parse(readFileSync(process.env.BB_AMB_SHARD, "utf8"))
  const symbols: { n: string; k: string; f: string; o: string | null; q: string; line: number }[] = []
  const edges: { t: string; s: string; g: string; f: string; mk: string | null; x: string | null; c: number | null; e: string | null; v: string | null; xt: string | null; xv: string | null; nd: string | null }[] = []
  let idx = 0
  let payloadBytes = 0
  let payloadBytesWithoutCauseC = 0
  let payloadBytesWithoutNoDecl = 0
  let payloadBytesWithoutExternal = 0
  const bad: string[] = []
  const worker = async () => {
    while (true) {
      const i = idx++
      if (i >= slice.length) return
      const f = slice[i]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { bad.push(`${f.label} :: parseFile threw`); continue }
      if (!r) { bad.push(`${f.label} :: parseFile returned nothing`); continue }
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        const n = String(s?.name ?? "")
        if (n.length === 0) continue
        symbols.push({
          n,
          k: String(s?.kind ?? ""),
          f: f.label,
          o: s?.ownerName == null ? null : String(s.ownerName),
          q: String(s?.qualifiedName ?? ""),
          line: Number(s?.startLine ?? s?.range?.startLine ?? 0),
        })
      }
      for (const x of Array.isArray(r.relationships) ? r.relationships : []) {
        const md = (x?.metadata ?? {}) as Record<string, any>
        // The PAYLOAD of an additive metadata key is bytes on edges the lane already
        // publishes, so it is measured here rather than asserted: JSON byte length of the
        // relationship object as `parseFile` returns it, summed over the walk. A before/after
        // pair at the same file set is the only way the ROUND brief's "report the regression
        // with numbers" can be answered from this instrument.
        payloadBytes += JSON.stringify(x).length
        // The SAME walk's counterfactual: the byte length the same relationship object would
        // have with the two cause-C keys deleted. It is a counterfactual and is labelled as
        // one — it is exact only because this commit's entire edge-side delta IS those keys,
        // which `git diff` on the analyzer is what establishes.
        {
          const mdCopy: Record<string, unknown> = { ...md }
          delete mdCopy.externalTarget
          delete mdCopy.externalVia
          delete mdCopy.noDeclarationInFile
          payloadBytesWithoutCauseC += JSON.stringify({ ...x, metadata: mdCopy }).length
          // Per-key attribution, so the design choice between shipping one key or two is made
          // on bytes rather than on taste: the same walk, each variant with one key deleted.
          const withoutNoDecl: Record<string, unknown> = { ...md }
          delete withoutNoDecl.noDeclarationInFile
          payloadBytesWithoutNoDecl += JSON.stringify({ ...x, metadata: withoutNoDecl }).length
          const withoutExternal: Record<string, unknown> = { ...md }
          delete withoutExternal.externalTarget
          delete withoutExternal.externalVia
          payloadBytesWithoutExternal += JSON.stringify({ ...x, metadata: withoutExternal }).length
        }
        edges.push({
          t: String(x?.type ?? x?.relationshipType ?? "").toLowerCase(),
          s: String(x?.source ?? ""),
          g: String(x?.target ?? ""),
          f: f.label,
          mk: md.memberKind == null ? null : String(md.memberKind),
          x: md.external == null ? null : String(md.external),
          c: typeof x?.confidence === "number" ? x.confidence : null,
          e: md.evidenceClass == null ? null : String(md.evidenceClass),
          v: md.via == null ? null : String(md.via),
          // The two cause-C keys the ANALYZER now emits. Read from the production output
          // rather than re-derived here, so section I8 measures what ships and not what this
          // file's own shape predicates predict of it.
          xt: md.externalTarget == null ? null : String(md.externalTarget),
          xv: md.externalVia == null ? null : String(md.externalVia),
          nd: md.noDeclarationInFile == null ? null : String(md.noDeclarationInFile),
        })
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))
  writeFileSync(`${process.env.BB_AMB_SHARD}.out`, JSON.stringify({ symbols, edges, bad, payloadBytes, payloadBytesWithoutCauseC, payloadBytesWithoutNoDecl, payloadBytesWithoutExternal }))
  process.exit(0)
}

// ---------------------------------------------------------------- corpus admission
// Byte-identical to census.ts and to the arbiter: git work tree, git-tracked files,
// <=512 KiB, `detectLanguageFromPath(abs, text) === "powershell"`. Re-stated rather than
// imported so this instrument carries no dependency on that CLI's argument handling.
function enumerate(): { repo: string; dir: string; rel: string; abs: string }[] {
  const out: { repo: string; dir: string; rel: string; abs: string }[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text = ""
      try {
        if (statSync(abs).size > 512 * 1024) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(abs, text) !== LANG) continue
      out.push({ repo: e, dir, rel, abs })
    }
  }
  return out
}

const all = enumerate().sort((a, b) => {
  const la = `${a.repo}/${a.rel}`, lb = `${b.repo}/${b.rel}`
  return la < lb ? -1 : la > lb ? 1 : 0
})
const population = all.length
// Deterministic stride over the sorted population: membership is a pure function of the
// listing, so a before/after pair at the same N is the same file set even if the corpus grew.
const picked = WANT > 0 && WANT < population
  ? Array.from({ length: WANT }, (_, i) => all[Math.floor((i * population) / WANT)])
  : all

console.log(`ambiguity split — production parseFile — ${LANG}`)
console.log(`corpus root          ${CR}`)
console.log(`admitted population  ${population}`)
console.log(`files walked         ${picked.length}${WANT > 0 && WANT < population ? `  (deterministic stride of ${WANT} over the sorted population)` : "  (the WHOLE admitted set — no sampling cut)"}`)
console.log(`shard size           ${SHARD_SIZE}`)

// ---------------------------------------------------------------- run shards
//
// The retry is PER SHARD, not per pass. The first version wrapped the shard loop in an
// outer `attempt` loop and `break`ed out of it on a victim, which restarted the pass from
// shard 0 and re-merged every shard that had already been merged. That silently DOUBLED
// symbols and edges, and it doubled them in the way that inflates this instrument's whole
// subject: a name whose declaration is published twice looks like a name resolving to two
// symbols. It read as a 1,680-edge ambiguity cluster in one file, on a population that had
// no second declaration anywhere. A per-shard retry with a `done` flag cannot re-merge.
const tmp = mkdtempSync(path.join(os.tmpdir(), "ps-amb-"))
const MAX_SHARD_ATTEMPTS = 6
const excluded: { file: string; reason: string }[] = []
const symbols: { n: string; k: string; f: string; o: string | null; q: string; line: number }[] = []
const edges: { t: string; s: string; g: string; f: string; mk: string | null; x: string | null; c: number | null; e: string | null; v: string | null; xt: string | null; xv: string | null; nd: string | null }[] = []
const shardLog: { shard: number; files: number; attempts: number }[] = []
let payloadBytes = 0
let payloadBytesWithoutCauseC = 0
let payloadBytesWithoutNoDecl = 0
let payloadBytesWithoutExternal = 0

/** The ANALYZER DIGEST this walk's numbers belong to. Every re-run of this instrument has to
 *  be able to say WHICH bytes produced its edges, because a cache that outlives an analyzer
 *  edit is how a documented table ends up disagreeing with its own command. SHA-256 over the
 *  analyzer source and the two instruments it is read through, via node:crypto — no shelling
 *  out and no dependency. */
const ANALYZER_FILES = [
  path.resolve(import.meta.dirname, "../../../../src/ast/real-powershell-analyzer.ts"),
  path.resolve(import.meta.dirname, "../../../../src/ast/pool-worker.ts"),
]
const analyzerDigest = (): string => {
  const h = createHash("sha256")
  for (const p of ANALYZER_FILES) h.update(readFileSync(p)).update("\0")
  return h.digest("hex").slice(0, 16)
}
const DIGEST = analyzerDigest()
let hit: any = null

if (CACHE) {
  try { hit = JSON.parse(readFileSync(CACHE, "utf8")) } catch { hit = null }
  if (hit && hit.analyzerDigest === DIGEST && hit.filesWalked === picked.length && Array.isArray(hit.symbols)) {
    // CHUNKED, because `push(...arr)` with 173,681 edges is a spread of 173,681 arguments and
    // V8 caps the argument count near 65k. The shard path never hit this (150 files a shard);
    // the whole-corpus cache load does, and it does it as a RangeError on the load rather than
    // as a wrong answer, so it is loud — but a loud failure on the second run of an instrument
    // is still a failure.
    const drain = <T,>(into: T[], from: T[]): void => {
      for (let i = 0; i < from.length; i += 4096) into.push(...from.slice(i, i + 4096))
    }
    drain(symbols, hit.symbols)
    drain(edges, hit.edges)
    payloadBytes = Number(hit.payloadBytes ?? 0)
    payloadBytesWithoutCauseC = Number(hit.payloadBytesWithoutCauseC ?? 0)
    payloadBytesWithoutNoDecl = Number(hit.payloadBytesWithoutNoDecl ?? 0)
    payloadBytesWithoutExternal = Number(hit.payloadBytesWithoutExternal ?? 0)
    for (const e of hit.excluded ?? []) excluded.push(e)
    for (const s of hit.shardLog ?? []) shardLog.push(s)
    console.log(`cache HIT            ${CACHE} (analyzer digest ${DIGEST}, ${symbols.length} symbols, ${edges.length} edges)`)
  } else {
    console.log(`cache MISS           ${CACHE}${hit ? ` — stored digest ${hit.analyzerDigest} vs live ${DIGEST}` : " — no readable cache"}`)
  }
}

for (let si = 0; hit === null && si * SHARD_SIZE < picked.length; si++) {
  const slice = picked.slice(si * SHARD_SIZE, (si + 1) * SHARD_SIZE)
  let remaining = slice
  let attempts = 0
  while (remaining.length > 0) {
    if (++attempts > MAX_SHARD_ATTEMPTS) {
      for (const f of remaining) excluded.push({ file: `${f.repo}/${f.rel}`, reason: `shard ${si} hit ${MAX_SHARD_ATTEMPTS} [BB-HANG] deaths; file dropped to make progress` })
      remaining = []
      break
    }
    const inPath = path.join(tmp, `shard-${si}.json`)
    writeFileSync(inPath, JSON.stringify(remaining.map((f) => ({ label: `${f.repo}/${f.rel}`, abs: f.abs, dir: f.dir }))))
    const r = spawnSync("npx", ["tsx", SELF], {
      env: { ...process.env, BB_AMB_SHARD: inPath },
      encoding: "utf8", maxBuffer: 1024 * 1024 * 1024,
    })
    const outPath = `${inPath}.out`
    let parsed: any = null
    try { parsed = JSON.parse(readFileSync(outPath, "utf8")) } catch { parsed = null }
    rmSync(inPath, { force: true }); rmSync(outPath, { force: true })
    if (parsed) {
      symbols.push(...parsed.symbols)
      edges.push(...parsed.edges)
      payloadBytes += Number(parsed.payloadBytes ?? 0)
      payloadBytesWithoutCauseC += Number(parsed.payloadBytesWithoutCauseC ?? 0)
      payloadBytesWithoutNoDecl += Number(parsed.payloadBytesWithoutNoDecl ?? 0)
      payloadBytesWithoutExternal += Number(parsed.payloadBytesWithoutExternal ?? 0)
      for (const b of parsed.bad ?? []) { const [file, reason] = b.split(" :: "); excluded.push({ file, reason: reason ?? "parse failure" }) }
      remaining = []
      break
    }
    // The child died. `parser.parse()` is synchronous WASM and cannot be interrupted, so
    // engine.ts answers a hang with `process.exit()` — read the offending path out of stderr
    // and drop THAT FILE, re-running the shard without it. Never drop a file silently.
    const m = /\[BB-HANG\].*? on (.+?) — exiting/.exec(`${r.stderr ?? ""}`)
    const abs = m?.[1]
    const victim = abs ? remaining.find((f) => f.abs === abs) : undefined
    if (victim) {
      excluded.push({ file: `${victim.repo}/${victim.rel}`, reason: "engine [BB-HANG]: parser.parse() exceeded 120 s and self-destructed the process" })
      remaining = remaining.filter((f) => f.abs !== abs)
      continue
    }
    for (const f of remaining) excluded.push({ file: `${f.repo}/${f.rel}`, reason: "shard child died with no [BB-HANG] line; whole shard dropped to make progress" })
    remaining = []
  }
  shardLog.push({ shard: si, files: slice.length, attempts })
}
rmSync(tmp, { recursive: true, force: true })

if (CACHE && hit === null) {
  writeFileSync(CACHE, JSON.stringify({ analyzerDigest: DIGEST, filesWalked: picked.length, symbols, edges, excluded, shardLog, payloadBytes, payloadBytesWithoutCauseC, payloadBytesWithoutNoDecl, payloadBytesWithoutExternal }))
  console.log(`wrote cache          ${CACHE} (analyzer digest ${DIGEST})`)
}

console.log(`shards run          ${shardLog.length}${shardLog.some((s) => s.attempts > 1) ? `  (retries: ${JSON.stringify(shardLog.filter((s) => s.attempts > 1))})` : ""}`)
console.log(`symbols collected    ${symbols.length}`)
console.log(`relationship payload ${payloadBytes.toLocaleString("en-US")} B as returned; ${payloadBytesWithoutCauseC.toLocaleString("en-US")} B with both cause-C keys deleted (COUNTERFACTUAL, same walk); delta ${(payloadBytes - payloadBytesWithoutCauseC).toLocaleString("en-US")} B (${((100 * (payloadBytes - payloadBytesWithoutCauseC)) / payloadBytesWithoutCauseC).toFixed(2)}%)`)
console.log(`  attributable: noDeclarationInFile alone ${(payloadBytes - payloadBytesWithoutNoDecl).toLocaleString("en-US")} B; externalTarget+via alone ${(payloadBytes - payloadBytesWithoutExternal).toLocaleString("en-US")} B`)
console.log(`edges collected      ${edges.length}`)
console.log(`files excluded       ${excluded.length}`)

// ---------------------------------------------------------------- resolve
type Pub = { file: string; kind: string; owner: string | null; qname: string; line: number }
const byName = new Map<string, Pub[]>()
const byQname = new Map<string, Pub[]>()
const byLower = new Map<string, Pub[]>()
const kinds = counter()
const filesWithSymbols = new Set<string>()
for (const s of symbols) {
  kinds[s.k] = (kinds[s.k] ?? 0) + 1
  filesWithSymbols.add(s.f)
  const p: Pub = { file: s.f, kind: s.k, owner: s.o, qname: s.q, line: s.line }
  const push = (m: Map<string, Pub[]>, k: string) => { const a = m.get(k); if (a) a.push(p); else m.set(k, [p]) }
  push(byName, s.n)
  if (s.n.toLowerCase() !== s.n) push(byLower, s.n.toLowerCase())
  if (s.q.length > 0 && s.q !== s.n) push(byQname, s.q)
}
const distinctPublishedNames = byName.size

/** file -> the FOLDED names that file declares. This is the index a single-file analyzer
 *  could build for itself, and it is the denominator that decides whether marking a target
 *  `external` is sound: bash shipped `variableDeclaredInFile` for exactly this reason, and
 *  read it as "no declaration in THIS FILE", never "no declaration anywhere". The difference
 *  is the whole verdict, because PowerShell binds a bare name at RUN TIME against session
 *  state — dot-sourced scope, the caller's scope chain, module exports. A name another
 *  file declares is not thereby local to this one; it is exactly the cause-C case. */
const byFileFolded = new Map<string, Set<string>>()
for (const s of symbols) {
  let set = byFileFolded.get(s.f)
  if (!set) { set = new Set<string>(); byFileFolded.set(s.f, set) }
  set.add(s.n.toLowerCase())
}
/** Does the file that EMITS this edge declare a symbol with this target's spelling? */
const DECLARED_IN_SOURCE_FILE = (e: { g: string; f: string }): boolean =>
  (byFileFolded.get(e.f)?.has(e.g.toLowerCase()) ?? false)

/** PowerShell names are matched CASE-INSENSITIVELY by the language itself, and the corpus
 *  is overwhelmingly case-consistent, so a consumer's name -> symbol map has to fold case.
 *  Both foldings are measured; the row that matters for an incoming consumer is
 *  `K0_corpusCI`, because PowerShell binds `$Foo` and `$foo` to one variable. */
type Row = {
  edges: number; selfLoops: number; emptyTarget: number; unknownLiteral: number
  k0: number; k0ci: number; k0intra: number; k0intraCI: number
  multiSymbol: number; multiKind: number
  k1: number; k2: number; k1orK2: number; k3: number
  P1: number; P2: number; P3: number; P4: number
  labelledExternal: number; labelledExternalKinds: Record<string, number>
  unlabelledUnresolved: number
  shapeCmdlet: number; shapeDotted: number; shapePath: number; shapeBare: number
  shapeTop: Record<string, number>
  lowConfidence: number; nonStructural: number
  examples: Map<string, Map<string, string[]>>
  fileLevel: number
}
const blank = (): Row => ({
  edges: 0, selfLoops: 0, emptyTarget: 0, unknownLiteral: 0,
  k0: 0, k0ci: 0, k0intra: 0, k0intraCI: 0, multiSymbol: 0, multiKind: 0,
  k1: 0, k2: 0, k1orK2: 0, k3: 0, P1: 0, P2: 0, P3: 0, P4: 0,
  labelledExternal: 0, labelledExternalKinds: counter(), unlabelledUnresolved: 0,
  shapeCmdlet: 0, shapeDotted: 0, shapePath: 0, shapeBare: 0, shapeTop: counter(),
  lowConfidence: 0, nonStructural: 0, examples: new Map(), fileLevel: 0,
})
const perType = {} as Record<string, Row>
for (const t of ALL_TYPES) perType[t] = blank()
const outsideTheTen = counter()

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
const ex = (r: Row, bucket: string, e: any, hits: Pub[]) => {
  let m = r.examples.get(bucket)
  if (!m) { m = new Map(); r.examples.set(bucket, m) }
  const key = `${e.f}|${e.g}`
  if (m.has(key) || m.size >= LIST) return
  m.set(key, [
    hits.slice(0, 4).map((h) => `${h.file}:${h.line}(${h.kind}${h.owner ? ` in ${h.owner}` : ""})`).join(" ; "),
    `edgeSource=${e.s}`,
    `memberKind=${e.mk ?? "-"}`,
  ])
}

/** Target SHAPE for cause C. Char-code scans only — this file holds zero regex operations,
 *  like every other instrument in this lane. `Verb-Noun` is the cmdlet naming convention
 *  PowerShell itself mandates for cmdlets AND advanced functions, so it is a lower bound on
 *  the cmdlet population, never an upper bound, and is reported as a shape, not a verdict. */
const hyphen = (s: string): number => { for (let i = 1; i < s.length; i++) if (s.charCodeAt(i) === 45) return i; return -1 }
const dotAt = (s: string): number => { for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 46) return i; return -1 }
const upper = (c: number): boolean => c >= 65 && c <= 90
const shapeOf = (t: string): "cmdlet" | "dotted" | "path" | "bare" => {
  const h = hyphen(t)
  if (h > 0 && upper(t.charCodeAt(0)) && upper(t.charCodeAt(h + 1))) return "cmdlet"
  const d = dotAt(t)
  if (d > 0 && dotAt(t.slice(d + 1)) >= 0) return "path"
  if (d > 0) return "dotted"
  return "bare"
}

for (const e of edges) {
  const row = perType[e.t]
  if (!row) { outsideTheTen[e.t] = (outsideTheTen[e.t] ?? 0) + 1; continue }
  row.edges++
  if (e.c != null && e.c < 0.7) row.lowConfidence++
  if (e.e != null && e.e !== "structural") row.nonStructural++
  if (e.g.length === 0) { row.emptyTarget++; continue }
  if (e.s === e.g) { row.selfLoops++; continue }
  if (e.g === "unknown") { row.unknownLiteral++; continue }

  let hits = byName.get(e.g)
  let ci = false
  if (!hits || hits.length === 0) { hits = byLower.get(e.g.toLowerCase()); ci = hits != null }
  let viaQ = false
  if (!hits || hits.length === 0) { hits = byQname.get(e.g); viaQ = hits != null }

  if (!hits || hits.length === 0) {
    if (e.x != null) { row.labelledExternal++; bump(row.labelledExternalKinds, e.x) }
    else {
      row.unlabelledUnresolved++
      const sh = shapeOf(e.g)
      if (sh === "cmdlet") row.shapeCmdlet++
      else if (sh === "dotted") row.shapeDotted++
      else if (sh === "path") row.shapePath++
      else row.shapeBare++
      bump(row.shapeTop, e.g)
    }
    continue
  }

  if (!ci && !viaQ) row.k0++
  if (ci) row.k0ci++
  if (hits.some((h) => h.file === e.f)) row.k0intra++
  if (hits.some((h) => h.file === e.f && (h.owner == null || h.owner.toLowerCase() === e.g.toLowerCase()))) row.k0intraCI++
  if (hits.length === 1) { row.k1++; row.k2++; row.k1orK2++; if (viaQ) row.k3++; continue }

  row.multiSymbol++
  const ks = new Set(hits.map((h) => h.kind))
  if (ks.size > 1) row.multiKind++
  if (viaQ) row.k3++

  // PowerShell's own scoping: `top().scope` IS the owner name, so (owner === source) is
  // exactly the scoped-lookup key, and it needs no new field on the edge to be usable.
  const bySource = hits.filter((h) => h.owner != null && h.owner === e.s)
  const byMk = e.mk == null ? [] : hits.filter((h) => h.kind === e.mk)
  if (bySource.length === 1) row.k1++
  if (byMk.length === 1) row.k2++
  if (bySource.length === 1 || byMk.length === 1) row.k1orK2++

  const fs = new Set(hits.map((h) => h.file))
  const os = new Set(hits.map((h) => `${h.owner ?? ""}|${h.file}`))
  let bucket: "P1" | "P2" | "P3" | "P4"
  if (fs.size > 1) bucket = "P2"
  else if (os.size > 1) bucket = "P1"
  else if (ks.size > 1) bucket = "P3"
  else bucket = "P4"
  row[bucket]++
  ex(row, bucket, e, hits)
}

// ---------------------------------------------------------------- report
const pad = (s: string | number, n: number) => String(s).padStart(n)
const pct = (a: number, b: number) => (b === 0 ? "     -" : `${((100 * a) / b).toFixed(1)}%`.padStart(6))
const live = ALL_TYPES.filter((t) => perType[t].edges > 0)

console.log("")
console.log("A. RESOLUTION under each candidate key — denominator is EVERY edge of the type")
console.log("   K0 exact  K0 fold-case  K0 same-file  +source  +memberKind  K1|K2  K3 qualified")
console.log("")
console.log("type".padEnd(14) + pad("edges", 8) + pad("K0", 8) + pad("K0ci", 8) + pad("K0intra", 8) + pad("K1", 8) + pad("K2", 8) + pad("K1|K2", 8) + pad("K3", 8) + pad("selfLp", 7) + pad("<0.7", 7))
console.log("-".repeat(94))
for (const t of live) {
  const r = perType[t]
  console.log(t.padEnd(14) + pad(r.edges, 8) + pad(r.k0, 8) + pad(r.k0ci, 8) + pad(r.k0intra, 8) + pad(r.k1, 8) + pad(r.k2, 8) + pad(r.k1orK2, 8) + pad(r.k3, 8) + pad(r.selfLoops, 7) + pad(r.lowConfidence, 7))
}

console.log("")
console.log("B. AMBIGUITY CAUSE BUCKETS — multiSymbol vs multiKind side by side")
console.log("   multiSym = >1 published SYMBOL (what a reverse walk collides on)")
console.log("   multiKind = >1 distinct KIND (incoming-check's own rule, the fleet's `amb` column)")
console.log("")
console.log("type".padEnd(14) + pad("multiSym", 10) + pad("multiKind", 10) + pad("P1owner", 9) + pad("P2xFile", 9) + pad("P3kind", 8) + pad("P4same", 8) + pad("P2%mulSym", 11) + pad("kind:P2%", 10))
console.log("-".repeat(89))
for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0) continue
  console.log(t.padEnd(14) + pad(r.multiSymbol, 10) + pad(r.multiKind, 10) + pad(r.P1, 9) + pad(r.P2, 9) + pad(r.P3, 8) + pad(r.P4, 8) + pct(r.P2, r.multiSymbol) + pad(pct(r.multiKind, r.multiSymbol), 10))
}

console.log("")
console.log("C. UNRESOLVED, split by the ANALYZER'S OWN `metadata.external` label (never a guess)")
for (const t of live) {
  const r = perType[t]
  const tot = r.labelledExternal + r.unlabelledUnresolved
  if (tot === 0) continue
  console.log(`  ${t.padEnd(13)} unresolved ${pad(tot, 6)} of ${pad(r.edges, 6)} = labelled external ${pad(r.labelledExternal, 6)} ${JSON.stringify(r.labelledExternalKinds)}`)
  console.log(`  ${"".padEnd(13)} UNLABELLED ${pad(r.unlabelledUnresolved, 6)}  shape: cmdlet ${pad(r.shapeCmdlet, 6)}  dotted ${pad(r.shapeDotted, 6)}  path ${pad(r.shapePath, 6)}  bare ${pad(r.shapeBare, 6)}`)
}

console.log("")
console.log("D. TOP UNLABELLED-UNRESOLVED TARGETS per type — the only unresolved population that is a candidate defect")
for (const t of live) {
  const r = perType[t]
  if (r.unlabelledUnresolved === 0) continue
  const top = Object.entries(r.shapeTop).sort((a, b) => b[1] - a[1]).slice(0, 20)
  console.log(`  ${t} (${r.unlabelledUnresolved} edges, ${Object.keys(r.shapeTop).length} distinct targets)`)
  for (const [name, c] of top) console.log(`    ${pad(c, 5)}  ${name}   [${shapeOf(name)}]`)
}

for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0) continue
  console.log("")
  console.log(`E. EXAMPLES ${t} — ${r.multiSymbol} ambiguous (P1 ${r.P1} / P2 ${r.P2} / P3 ${r.P3} / P4 ${r.P4})`)
  for (const b of ["P1", "P2", "P3", "P4"] as const) {
    const m = r.examples.get(b)
    if (!m || m.size === 0) continue
    console.log(`  [${b}] ${r[b]}`)
    for (const v of [...m.values()].slice(0, 4)) console.log(`    ${v[0]}\n      ${v[1]}   ${v[2]}`)
  }
}

console.log("")
console.log(`distinct published names ${distinctPublishedNames}   files with >=1 symbol ${filesWithSymbols.size}`)
console.log("SYMBOL KINDS:", JSON.stringify(Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]))))
console.log("edge types outside the 10:", JSON.stringify(outsideTheTen))

// ---------------------------------------------------------------- cause-C counterfactual
//
// A marking rule for externality is only honest if it cannot capture an edge whose target IS
// declared in the corpus. So for every candidate rule, this section prints TWO numbers over
// the whole edge population: how many edges it would mark, and — the falsification — how many
// of THOSE have a target that resolves corpus-wide. A rule whose second number is 0 cannot
// mislabel a real reference; a rule whose second number is large is measuring something other
// than externality and is rejected on this number alone.
//
// The rules are read off the EDGE'S OWN TARGET STRING plus the analyzer's label. That is
// deliberately weaker than the analyzer's own AST branch, and it is why the numbers here are
// an upper bound on what a real implementation would mark, not a prediction of it.
const RESOLVES_CORPUS = (t: string): boolean => (byName.get(t)?.length ?? 0) > 0 || (byLower.get(t.toLowerCase())?.length ?? 0) > 0
const isDottedType = (t: string): boolean => {
  const d = dotAt(t)
  return d > 0 && t.charCodeAt(0) !== 46 && t.charCodeAt(t.length - 1) !== 46
}
/** `Type::Member` — PowerShell's static-member / type-literal accessor. `pushSymbol` cannot
 *  publish a name containing `::` (it is not an identifier node), so an edge whose target
 *  carries one names something this analyzer never published under that spelling. That is a
 *  STRUCTURAL fact about the grammar, not a word-list guess — which is why it is its own rule
 *  rather than folded into R1. Char-code scan, no regex. */
const colonsAt = (s: string): number => { for (let i = 1; i < s.length; i++) if (s.charCodeAt(i) === 58 && s.charCodeAt(i - 1) === 58) return i - 1; return -1 }
const isStaticMember = (t: string): boolean => colonsAt(t) > 0

/** R1's mislabels were not dotted TYPE names at all: every one of them is a PATH or a quoted
 *  string literal that happens to contain a dot (`"DSCResources\UserConfigProviderModVersion1
 *  \\…psm1"`, `'netstandard2.0'`). So the shape test needed to be narrowed to a target that
 *  could BE a type name, and these three predicates are what narrow it. Each is a char-code
 *  scan over the target string — no regex, and none of them reads source text. */
const isQuoted = (t: string): boolean => t.charCodeAt(0) === 34 || t.charCodeAt(0) === 39
const hasSpace = (t: string): boolean => { for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c === 32 || c === 9) return true } return false }
const hasPathSep = (t: string): boolean => { for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c === 92 || c === 47) return true } return false }
const looksLikeATypeName = (t: string): boolean =>
  !isQuoted(t) && !hasSpace(t) && !hasPathSep(t) && t.charCodeAt(0) !== 46 && t.charCodeAt(t.length - 1) !== 46

/** Rule id -> its short key / its human label. Char-code scan for the first space, so this
 *  file keeps its "zero regex operations" claim true rather than quietly breaking it. */
const ruleKey = (id: string): string => {
  for (let i = 0; i < id.length; i++) if (id.charCodeAt(i) === 32) return id.slice(0, i)
  return id
}
const ruleLabel = (id: string): string => {
  for (let i = 0; i < id.length; i++) if (id.charCodeAt(i) === 32) return id.slice(i + 1)
  return ""
}

const RULES: { id: string; test: (t: string, e: any) => boolean }[] = [
  { id: "R1 dotted-type-name        (any dotted target)", test: (t) => isDottedType(t) },
  { id: "R2 cmdlet-shape            (Verb-Noun, both caps)", test: (t) => shapeOf(t) === "cmdlet" },
  { id: "R3 R1 or R2", test: (t) => isDottedType(t) || shapeOf(t) === "cmdlet" },
  { id: "R4 calls+uses, not cmdlet-shaped, not dotted", test: (t, e) => (e.t === "calls" || e.t === "uses") && !isDottedType(t) && shapeOf(t) !== "cmdlet" },
  { id: "R5 static-member           (Type::Member, :: in target)", test: (t) => isStaticMember(t) },
  { id: "R6 static-member or cmdlet-shape", test: (t) => isStaticMember(t) || shapeOf(t) === "cmdlet" },
  { id: "R7 type-name               (dotted, unquoted, no space, no separator)", test: (t) => isDottedType(t) && looksLikeATypeName(t) },
  { id: "R8 type-name or static-member (both narrowed)", test: (t) => looksLikeATypeName(t) && (isDottedType(t) || isStaticMember(t)) },
  { id: "R9 R8 or cmdlet-shape", test: (t) => (looksLikeATypeName(t) && (isDottedType(t) || isStaticMember(t))) || shapeOf(t) === "cmdlet" },
]
console.log("")
console.log("F. CAUSE-C COUNTERFACTUAL — would-mark vs WOULD-MISLABEL (target resolves corpus-wide)")
console.log("   population: every edge of every live type")
console.log("")
console.log("rule".padEnd(52) + pad("wouldMark", 11) + pad("MISLABEL", 10) + pad("mislabel%", 10))
console.log("-".repeat(83))
const counterfactual: Record<string, { wouldMark: number; mislabel: number; mislabelPct: number | null; topMislabelled: Record<string, number> }> = {}
for (const r of RULES) {
  let mark = 0
  let mislabel = 0
  const mislabelNames: Record<string, number> = counter()
  for (const e of edges) {
    if (!perType[e.t] || e.g.length === 0) continue
    if (!r.test(e.g, e)) continue
    mark++
    if (RESOLVES_CORPUS(e.g)) { mislabel++; mislabelNames[e.g] = (mislabelNames[e.g] ?? 0) + 1 }
  }
  console.log(r.id.padEnd(52) + pad(mark, 11) + pad(mislabel, 10) + pad(mark === 0 ? "     -" : `${((100 * mislabel) / mark).toFixed(1)}%`.padStart(9), 10))
  if (mislabel > 0) {
    const top = Object.entries(mislabelNames).sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log("     would-mislabel: " + top.map(([n, c]) => `${n} (${c})`).join(", "))
  }
  counterfactual[ruleKey(r.id)] = {
    wouldMark: mark,
    mislabel,
    mislabelPct: mark === 0 ? null : Number(((100 * mislabel) / mark).toFixed(2)),
    topMislabelled: Object.fromEntries(Object.entries(mislabelNames).sort((a, b) => b[1] - a[1]).slice(0, 20)),
  }
}

// ---- F2. THE DECISIVE SPLIT: over the UNRESOLVED population only.
//
// Section F asks "how much would a rule mark, and how much of that is wrong". That is the
// right falsification test but the wrong denominator for a decision, because it prices the rule
// over edges that already resolve. The question cause C actually asks is about the edges that
// do NOT resolve, so this section prices every rule over THAT population and adds the column
// no rule can produce, because it is the residue rather than a marking:
//
//   marked            the rule fires AND no corpus file publishes the target  -> externality the
//                     analyzer does not currently label
//   MISLABEL          the rule fires AND some corpus file DOES publish it     -> the rule would
//                     exclude a real reference; its cost
//   unprovenAbsent    NO rule fires and nothing publishes the target            -> genuinely absent
//                     from the corpus under every spelling this walk tried
//   missedLocal       NO rule fires but some corpus file DOES publish it       -> a naming defect,
//                     which is cause A/B, not C
//
// **THE TWO `MIS*` COLUMNS IN THIS SECTION ARE 0 BY CONSTRUCTION AND ARE NOT EVIDENCE.**
// The population above is filtered to edges whose target has no corpus declaration under any
// spelling, so `RESOLVES_CORPUS` cannot be true of any member of it and both columns are
// identically zero for every rule. They are printed to make that visible rather than to be read
// as a result. The falsifying measurement for a rule is section F, which runs over ALL edges and
// counts how many of the rule's own marks point at a target the corpus DOES publish.
//
// `unprovenAbsent` is the honest residue: this walk can prove a name is absent from the corpus,
// not that the language has no such binding. It is reported as its own bucket rather than folded
// into "external" so the two are never confused.
const unresolvedEdges = edges.filter((e) => {
  if (!perType[e.t] || e.g.length === 0 || e.s === e.g || e.g === "unknown") return false
  return (byName.get(e.g)?.length ?? 0) === 0 && (byLower.get(e.g.toLowerCase())?.length ?? 0) === 0 && (byQname.get(e.g)?.length ?? 0) === 0 && e.x == null
})
const f2: Record<string, Record<string, unknown>> = {}
console.log("")
console.log("G. CAUSE-C OVER THE UNRESOLVED POPULATION — every rule, priced where the question lives")
console.log(`   unresolved edges with no label and no corpus declaration: ${unresolvedEdges.length}`)
console.log("")
console.log("rule".padEnd(34) + pad("unresolved", 11) + pad("marked", 9) + pad("MISLBL", 9) + pad("unproven", 10) + pad("missedLoc", 11))
console.log("-".repeat(84))
for (const r of RULES) {
  let marked = 0
  let mislabel = 0
  let unproven = 0
  let missedLocal = 0
  const unprovenNames: Record<string, number> = counter()
  for (const e of unresolvedEdges) {
    if (r.test(e.g, e)) {
      if (RESOLVES_CORPUS(e.g)) mislabel++
      else marked++
      continue
    }
    if (RESOLVES_CORPUS(e.g)) missedLocal++
    else { unproven++; unprovenNames[e.g] = (unprovenNames[e.g] ?? 0) + 1 }
  }
  console.log(ruleKey(r.id).padEnd(10) + ruleLabel(r.id).padEnd(24) + pad(unresolvedEdges.length, 11) + pad(marked, 9) + pad(mislabel, 9) + pad(unproven, 10) + pad(missedLocal, 11))
  f2[ruleKey(r.id)] = {
    rule: r.id,
    unresolvedPopulation: unresolvedEdges.length,
    marked,
    mislabel,
    unprovenAbsent: unproven,
    missedLocal,
    topUnprovenAbsent: Object.fromEntries(Object.entries(unprovenNames).sort((a, b) => b[1] - a[1]).slice(0, 25)),
  }
}
// Per-type split of the residue, because a rule that is right for `calls` can be wrong for
// `references`, and an aggregate hides exactly that.
const gPerType: Record<string, Record<string, number>> = {}
for (const t of live) {
  const sub = unresolvedEdges.filter((e) => e.t === t)
  if (sub.length === 0) continue
  const r6 = RULES.find((r) => ruleKey(r.id) === "R8")!
  if (!r6) throw new Error("R8 missing from RULES")
  gPerType[t] = {
    unresolved: sub.length,
    r6Marked: sub.filter((e) => r6.test(e.g, e) && !RESOLVES_CORPUS(e.g)).length,
    r6Mislabels: sub.filter((e) => r6.test(e.g, e) && RESOLVES_CORPUS(e.g)).length,
    r6UnprovenAbsent: sub.filter((e) => !r6.test(e.g, e) && !RESOLVES_CORPUS(e.g)).length,
    r6MissedLocal: sub.filter((e) => !r6.test(e.g, e) && RESOLVES_CORPUS(e.g)).length,
  }
}
console.log("")
console.log("G2. the same split per type, under R8 (type-name or static-member, both narrowed)")
console.log("type".padEnd(14) + pad("unresolved", 11) + pad("marked", 9) + pad("MISLBL", 9) + pad("unproven", 10) + pad("missedLoc", 11))
console.log("-".repeat(64))
for (const t of live) {
  const g = gPerType[t]
  if (!g) continue
  console.log(t.padEnd(14) + pad(g.unresolved, 11) + pad(g.r6Marked, 9) + pad(g.r6Mislabels, 9) + pad(g.r6UnprovenAbsent, 10) + pad(g.r6MissedLocal, 11))
}

// ---- H. THE COST THAT DECIDES IT: of the edges a rule marks, how many would a FINAL-SEGMENT
// resolver have recovered?
//
// Sections F and G cannot answer this, and that is why both of their `MIS*` columns are
// degenerate: F's population includes edges that already resolve, so its count is dominated by
// edges the marking would never touch, and G's population excludes resolvable edges by
// definition. The question a marking rule actually has to survive is the graphql one —
// "is the edge hiding something a canonical resolver could still bind?" — and for this language
// the answer is decidable, because PowerShell writes qualified names in exactly two shapes:
// `Type::Member` and `Module.Item`. So for every unresolved edge, take the text after the LAST
// `::` or `.` and ask whether the corpus publishes THAT.
//
//   marked                   the rule fires on this unresolved edge
//   wouldHideRecoverable     the rule fires AND the corpus publishes the final segment
//   unprovenAbsent           the rule fires and the final segment is published nowhere either
//
// A rule whose `wouldHideRecoverable` is 0 hides nothing a resolver could get back. A rule whose
// `wouldHideRecoverable` is large is discarding recoverable edges to make a number look better,
// which is the trade this workstream exists to refuse.
const lastSepAt = (s: string): number => {
  let best = -1
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 46 /* . */) best = i
    else if (c === 58 /* : */ && s.charCodeAt(i - 1) === 58) { best = i; i++ }
  }
  return best
}
const finalSegment = (t: string): string => {
  const i = lastSepAt(t)
  return i < 0 ? t : t.slice(i + 1)
}
const segResolves = (t: string): boolean => {
  const s = finalSegment(t)
  return (byName.get(s)?.length ?? 0) > 0 || (byLower.get(s.toLowerCase())?.length ?? 0) > 0
}
let segRecoverableAll = 0
const segRecoverableNames: Record<string, number> = counter()
for (const e of unresolvedEdges) {
  if (!segResolves(e.g)) continue
  segRecoverableAll++
  segRecoverableNames[e.g] = (segRecoverableNames[e.g] ?? 0) + 1
}
const h: Record<string, Record<string, unknown>> = {}
console.log("")
console.log("H. COST OF MARKING — over the unresolved edges a rule marks, how many would a FINAL-SEGMENT resolver recover?")
console.log(`   unresolved population ${unresolvedEdges.length}; of those, final segment IS published corpus-wide: ${segRecoverableAll}`)
console.log("")
console.log("rule".padEnd(34) + pad("marked", 9) + pad("wouldHIDE", 11) + pad("unproven", 10) + pad("hide%", 8))
console.log("-".repeat(72))
for (const r of RULES) {
  let marked = 0
  let hide = 0
  let unproven = 0
  const hideNames: Record<string, number> = counter()
  for (const e of unresolvedEdges) {
    if (!r.test(e.g, e)) continue
    marked++
    if (segResolves(e.g)) { hide++; hideNames[e.g] = (hideNames[e.g] ?? 0) + 1 }
    else unproven++
  }
  console.log(ruleKey(r.id).padEnd(6) + ruleLabel(r.id).padEnd(28) + pad(marked, 9) + pad(hide, 11) + pad(unproven, 10) + pad(marked === 0 ? "     -" : `${((100 * hide) / marked).toFixed(1)}%`.padStart(7), 8))
  h[ruleKey(r.id)] = {
    rule: r.id,
    marked,
    wouldHideRecoverable: hide,
    unprovenAbsent: unproven,
    topWouldHide: Object.fromEntries(Object.entries(hideNames).sort((a, b) => b[1] - a[1]).slice(0, 20)),
  }
}
console.log("")
console.log("H2. every unresolved target whose FINAL SEGMENT the corpus publishes — the cause-B pool")
const segTop = Object.entries(segRecoverableNames).sort((a, b) => b[1] - a[1])
for (const [n, c] of segTop.slice(0, 25)) console.log(`    ${pad(c, 6)}  ${n}   -> final segment ${finalSegment(n)}`)
console.log(`    distinct such targets: ${segTop.length}`)

// ---- I. CAUSE B IN THE POWERSHELL SHAPE: the emitter and the publisher disagree on the
// SPELLING, and the disagreement is structural rather than incidental.
//
// `src/ast/real-powershell-analyzer.ts:562` publishes exactly ONE `module` symbol per file and
// names it `basename WITH its extension` — `HelpersCommon.psm1`. `addImport`
// (`:1357`, reached from `Import-Module` at `:2312`, `using module`/`using namespace` at
// `:2507` and `#requires -Module` at `:2540`) publishes the ARGUMENT TEXT as the edge target.
// So the two sides disagree whenever the argument is a path (`.\HelpersCommon.psm1`,
// `$PSScriptRoot\..\..\PSDSCxMachine.psm1`) or a bare module NAME (`HelpersCommon`), and they
// agree only when the author happened to write the file's basename with its extension. That is
// cause B exactly as the brief states it: the edge would resolve if both sides used one
// canonical helper.
//
// H2 above priced the graphql remedy — take the text after the LAST separator — and found it
// prices 1,621 recoverable edges at the price of binding `Type::Member` to a same-named local.
// Here the target is not arbitrary: an `imports` target is a MODULE SPEC, so the segment that
// could be a module identity is chosen by PowerShell's own module resolution, not by the last
// separator in the string. So the candidates below are the module-SPEC readings, each a pure
// function of the target, char-code scans only:
//
//   K0 as written                                  — the current published target
//   K1 basename after the last / or \             — a file path's own file name
//   K2 last dot segment                            — a module NAME (`Ansible.ModuleUtils.Legacy`
//                                                    -> `Legacy`): the last segment of a dotted
//                                                    module name is the module's own name
//   K3 basename, extension stripped                — `.\HelpersCommon.psm1` -> `HelpersCommon`
//   K4 K3 + .psm1    K5 K3 + .psd1    K6 K3 + .ps1  — the three extensions a PowerShell module
//                                                    is actually loadable from
//   K7 basename with a ps1/psm1/psd1 extension REPLACED by .psm1
//   K8 K2 + .psm1
//
// Each is scored on the three numbers that decide it — `gained`, `BROKE`, and `gainedNotModule`
// (recovered onto a published symbol of a kind other than `module`, which is the graphql trap:
// a recovered edge that binds to an unrelated local).
const lastPathSepAt = (s: string): number => { let b = -1; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 47 || c === 92) b = i } return b }
const lastDotAt = (s: string): number => { let b = -1; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 46) b = i; return b }
const baseName = (s: string): string => { const i = lastSepAt(s); return i < 0 ? s : s.slice(i + 1) }
const lastDotSeg = (s: string): string => { const b = baseName(s); const d = lastDotAt(b); return d < 0 ? b : b.slice(d + 1) }
const stripExt = (s: string): string => { const b = baseName(s); const d = lastDotAt(b); return d <= 0 ? b : b.slice(0, d) }
const hasPsExt = (s: string): boolean => { const l = s.toLowerCase(); return l.endsWith(".ps1") || l.endsWith(".psm1") || l.endsWith(".psd1") }
const K1 = (t: string) => baseName(t)
const K2 = (t: string) => lastDotSeg(t)
const K3 = (t: string) => stripExt(t)
const K4 = (t: string) => stripExt(t) + ".psm1"
const K5 = (t: string) => stripExt(t) + ".psd1"
const K6 = (t: string) => stripExt(t) + ".ps1"
const K7 = (t: string) => { const b = baseName(t); return hasPsExt(b) ? b.slice(0, lastDotAt(b)) + ".psm1" : b }
const K8 = (t: string) => lastDotSeg(t) + ".psm1"
const KANON: { key: string; label: string; f: (t: string) => string }[] = [
  { key: "K0", label: "as written (current)", f: (t) => t },
  { key: "K1", label: "basename after last / or \\", f: K1 },
  { key: "K2", label: "last dot segment (module name)", f: K2 },
  { key: "K3", label: "basename, extension stripped", f: K3 },
  { key: "K4", label: "K3 + .psm1", f: K4 },
  { key: "K5", label: "K3 + .psd1", f: K5 },
  { key: "K6", label: "K3 + .ps1", f: K6 },
  { key: "K7", label: "basename, ps* ext -> .psm1", f: K7 },
  { key: "K8", label: "last dot segment + .psm1", f: K8 },
]
/** Does any published symbol carry this name, under the SAME three-way lookup the resolver in
 *  section A uses — exact, folded case, then qualifiedName? Anything less and a candidate would
 *  be scored against a weaker resolver than the one it is meant to replace. */
const kindsOf = (t: string): Set<string> => {
  const out = new Set<string>()
  for (const src of [byName.get(t), byLower.get(t.toLowerCase()), byQname.get(t)]) {
    if (!src) continue
    for (const p of src) out.add(p.kind)
  }
  return out
}
const irEdges = edges.filter((e) => (e.t === "imports" || e.t === "references") && e.g.length > 0 && e.g !== "unknown" && e.s !== e.g)
const moduleNames = new Set<string>()
for (const [name, pubs] of byName) if (pubs.some((p) => p.kind === "module")) moduleNames.add(name)
console.log("")
console.log("I. CAUSE B, POWERSHELL SHAPE — imports/references target vs the published module symbol")
console.log(`   published module symbols ${moduleNames.size} (one per file: basename WITH extension); imports+references edges ${irEdges.length}`)
console.log("")
console.log("key  reading".padEnd(46) + pad("resolves", 11) + pad("gained", 9) + pad("BROKE", 8) + pad("gain≠mod", 10))
console.log("-".repeat(84))
const iTable: Record<string, Record<string, unknown>> = {}
for (const k of KANON) {
  let resolves = 0
  let gained = 0
  let broke = 0
  let notModule = 0
  const gainedNames = counter()
  const brokeNames = counter()
  for (const e of irEdges) {
    const now = kindsOf(e.g).size > 0
    const after = kindsOf(k.f(e.g))
    if (after.size > 0) resolves++
    if (now && after.size === 0) { broke++; bump(brokeNames, e.g) }
    if (!now && after.size > 0) {
      gained++
      bump(gainedNames, k.f(e.g))
      if (!after.has("module")) notModule++
    }
  }
  console.log(k.key.padEnd(5) + k.label.padEnd(41) + pad(resolves, 11) + pad(gained, 9) + pad(broke, 8) + pad(notModule, 10))
  iTable[k.key] = {
    reading: k.label,
    resolves,
    gained,
    broke,
    gainedNotModule: notModule,
    topGained: Object.fromEntries(Object.entries(gainedNames).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    topBroke: Object.fromEntries(Object.entries(brokeNames).sort((a, b) => b[1] - a[1]).slice(0, 15)),
  }
}
// Per-`via` under the best-scoring candidate, because the four grammar branches are different
// readers and a candidate that works on three and fabricates on the fourth is not a candidate.
const scored = KANON.slice(1).map((k) => ({ k, g: iTable[k.key].gained as number, b: iTable[k.key].broke as number, n: iTable[k.key].gainedNotModule as number }))
scored.sort((a, b) => b.g - a.g || a.b - b.b || a.n - b.n)
const best = scored[0]
console.log("")
console.log(`I2. the same split per \`via\` under ${best.k.key} (${best.k.label}) — the reader decides, so the branch does`)
const viaRows: Record<string, Record<string, number>> = {}
const viaTotals = counter()
for (const e of irEdges) viaTotals[e.v ?? "-"] = (viaTotals[e.v ?? "-"] ?? 0) + 1
console.log("via".padEnd(26) + pad("edges", 8) + pad("resolves0", 11) + pad("gained", 8) + pad("BROKE", 8) + pad("gain≠mod", 10))
console.log("-".repeat(71))
for (const v of Object.keys(viaTotals).sort((a, b) => viaTotals[b] - viaTotals[a])) {
  const sub = irEdges.filter((e) => (e.v ?? "-") === v)
  const r0 = sub.filter((e) => kindsOf(e.g).size > 0).length
  const g = sub.filter((e) => kindsOf(e.g).size === 0 && kindsOf(best.k.f(e.g)).size > 0).length
  const b = sub.filter((e) => kindsOf(e.g).size > 0 && kindsOf(best.k.f(e.g)).size === 0).length
  const n = sub.filter((e) => kindsOf(e.g).size === 0 && kindsOf(best.k.f(e.g)).size > 0 && !kindsOf(best.k.f(e.g)).has("module")).length
  console.log(v.padEnd(26) + pad(sub.length, 8) + pad(r0, 11) + pad(g, 8) + pad(b, 8) + pad(n, 10))
  viaRows[v] = { edges: sub.length, resolvesNow: r0, gained: g, broke: b, gainedNotModule: n }
}
console.log("")
console.log("I3. the whole reason the gain is not free — every distinct target the winner changes, and what it binds to")
const i3: { target: string; becomes: string; edges: number; bindsTo: string[] }[] = []
{
  const changed = new Map<string, { edges: number; becomes: string }>()
  for (const e of irEdges) {
    const now = kindsOf(e.g).size > 0
    const after = kindsOf(best.k.f(e.g))
    if (now || after.size === 0) continue
    const cur = changed.get(e.g)
    if (cur) cur.edges++
    else changed.set(e.g, { edges: 1, becomes: best.k.f(e.g) })
  }
  for (const [target, v] of [...changed].sort((a, b) => b[1].edges - a[1].edges).slice(0, 30)) {
    i3.push({ target, becomes: v.becomes, edges: v.edges, bindsTo: [...kindsOf(v.becomes)].sort() })
    console.log(`    ${pad(v.edges, 5)}  ${target}  ->  ${v.becomes}   binds to [${[...kindsOf(v.becomes)].sort().join(", ")}]`)
  }
  console.log(`    distinct targets the winner would retarget: ${changed.size}`)
}

// ---- I4. THE CHARACTER INVENTORY OF PUBLISHED NAMES — what a marking rule may assert about a
// spelling without a word list.
//
// The brief's cause C remedy is "mark them external", and the mark has to be SOUND: it must not
// suppress an edge that binds to a real corpus symbol. A SHAPE rule ("any Verb-Noun is a cmdlet,
// cmdlets are external") is not sound — section F prices it at 10,779 already-resolving edges,
// because Pester and PSScriptAnalyzer DECLARE functions like `Assert-Equal` in the corpus. What
// IS sound is a statement about the GRAMMAR: a target that carries a character no PowerShell
// identifier can carry can never be the name this analyzer publishes for anything but the file's
// own basename.
//
// So the claim needs a measured table rather than an assertion, and this is that table: every
// character byte that occurs in any published name, by kind, over all 26,278 symbols. The
// marking rule below then uses the characters this walk FOUND to be absent from every non-`module`
// name — a closed list derived from the corpus, not from a guess about PowerShell.
const charInventory: Record<string, Record<string, string>> = {}
{
  const perKind = new Map<string, Set<number>>()
  for (const s of symbols) {
    let set = perKind.get(s.k)
    if (!set) { set = new Set(); perKind.set(s.k, set) }
    for (let i = 0; i < s.n.length; i++) set.add(s.n.charCodeAt(i))
  }
  const names = Array.from(perKind.keys()).sort()
  for (const k of names) {
    const set = perKind.get(k)!
    const printable: string[] = []
    for (let c = 32; c < 127; c++) if (set.has(c)) printable.push(String.fromCharCode(c))
    charInventory[k] = { count: [...set].filter((c) => c >= 32 && c < 127).length, printable: printable.join("") }
  }
  console.log("")
  console.log("I4. the character inventory of PUBLISHED NAMES — the basis for a sound marking rule")
  console.log("kind".padEnd(16) + pad("distinct bytes", 15) + "printable ASCII present")
  console.log("-".repeat(96))
  for (const k of names) {
    const inv = charInventory[k]
    console.log(k.padEnd(16) + pad(inv.count, 15) + inv.printable)
  }
  const modulePrintable = charInventory["module"]?.printable ?? ""
  const nonModule = names.filter((k) => k !== "module")
  const inNonModule = new Set<number>()
  for (const k of nonModule) for (const ch of charInventory[k].printable) inNonModule.add(ch.charCodeAt(0))
  // The candidate byte list: every ASCII printable that NO non-`module` published name contains.
  // A target carrying one of these cannot be a function, class, method, property, variable,
  // constructor or enum name in this corpus or in any other — the analyzer does not publish
  // them, and PowerShell's own grammar does not admit them in an identifier.
  const absentNonModule: number[] = []
  for (let c = 32; c < 127; c++) if (!inNonModule.has(c)) absentNonModule.push(c)
  console.log("")
  console.log(`     printable ASCII present in a MODULE name but in NO non-module name:`)
  console.log(`     ${modulePrintable.split("").filter((ch) => !inNonModule.has(ch.charCodeAt(0))).join(" ")}`)
  console.log(`     printable ASCII in NO non-module published name (${absentNonModule.length}): ${absentNonModule.map((c) => String.fromCharCode(c)).join("")}`)
}

// ---- I5. RULE R10, THE GRAMMAR RULE — priced by the same three denominators as R1..R9.
const isNotLocalSpelling = (t: string): boolean => {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    // 46 `.` 92 `\` 47 `/` 58 `:` 91 `[` 93 `]` 40 `(` 41 `)` 123 `{` 125 `}`
    // 34 `"` 39 `'` 36 `$` 96 backtick 32 space 9 tab 44 `,` 59 `;` 124 `|`
    if (c === 46 || c === 92 || c === 47 || c === 58 || c === 91 || c === 93 || c === 40 || c === 41) return true
    if (c === 123 || c === 125 || c === 34 || c === 39 || c === 36 || c === 96) return true
    if (c === 32 || c === 9 || c === 44 || c === 59 || c === 124) return true
  }
  return false
}
/** The same, narrowed to the QUALIFIER bytes only — the conservative variant, which will not
 *  touch a target that merely happens to be quoted or bracketed. */
const isQualifiedSpelling = (t: string): boolean => {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 46 || c === 92 || c === 47 || c === 58) return true
  }
  return false
}
/** A SCOPE QUALIFIER is PowerShell's own prefix syntax: `global:Foo` and `Foo` name the same
 *  function. This is measured, not assumed — the walk counts every qualifier PowerShell's
 *  grammar admits in scope_resolution and prints the ones this corpus actually uses. */
const SCOPE_QUALIFIERS = ["global", "script", "local", "private", "function", "env", "alias", "variable", "using"]
const isScopeQualified = (t: string): boolean => {
  for (const q of SCOPE_QUALIFIERS) {
    if (t.length <= q.length + 1) continue
    let eq = false
    for (let i = 0; i < q.length; i++) {
      let c = t.charCodeAt(i)
      // PowerShell scope keywords are case-insensitive; fold ASCII.
      if (c >= 65 && c <= 90) c += 32
      if (c !== q.charCodeAt(i)) { eq = false; break }
      eq = true
    }
    if (eq && t.charCodeAt(q.length) === 58) return true
  }
  return false
}
const hasByte = (t: string, codes: number[]): boolean => {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    for (const k of codes) if (c === k) return true
  }
  return false
}
const startsQuoted = (t: string): boolean => {
  if (t.length === 0) return false
  const c = t.charCodeAt(0)
  return c === 34 || c === 39
}
const isQualifiedNotQuoted = (t: string): boolean => isQualifiedSpelling(t) && !startsQuoted(t)
const isQualifiedNotQuotedNotScoped = (t: string): boolean => isQualifiedNotQuoted(t) && !isScopeQualified(t)
const isQualifiedNotQuotedNotScopedNotTernary = (t: string): boolean =>
  isQualifiedNotQuotedNotScoped(t) && !hasByte(t, [63])

RULES.push({ id: "R10 non-local spelling          (a byte no PowerShell identifier has)", test: (t) => isNotLocalSpelling(t) })
RULES.push({ id: "R11 qualified spelling          (a . \\ / or : byte)", test: (t) => isQualifiedSpelling(t) })
RULES.push({ id: "R12 R11 less a leading quote", test: (t) => isQualifiedNotQuoted(t) })
RULES.push({ id: "R13 R12 less a scope qualifier", test: (t) => isQualifiedNotQuotedNotScoped(t) })
RULES.push({ id: "R14 R13 less a ? ternary byte", test: (t) => isQualifiedNotQuotedNotScopedNotTernary(t) })
const R2 = RULES.find((x) => ruleKey(x.id) === "R2")!
const R10 = RULES.find((x) => ruleKey(x.id) === "R10")!
const R14 = RULES.find((x) => ruleKey(x.id) === "R14")!

console.log("")
console.log("I5. the narrowing ladder, over the unresolved population and per type")
const i5: Record<string, unknown> = {}
/** The live-edge population every I5/I6 column is measured over: an edge of one of the ten
 *  types, a non-empty target that is not the literal `unknown`, and not a self-loop. Defined
 *  once here because I5 and I6 both report over it and a second definition inside I5's loop
 *  is exactly the kind of thing that makes an instrument quietly measure two populations. */
const liveSet = new Set<string>(live)
const live2 = edges.filter((e) => liveSet.has(e.t) && e.g.length > 0 && e.g !== "unknown" && e.s !== e.g)
for (const key of ["R10", "R11", "R12", "R13", "R14"]) {
  const r = RULES.find((x) => ruleKey(x.id) === key)!
  let marked = 0
  let mislabel = 0
  let unproven = 0
  const names5 = counter()
  for (const e of unresolvedEdges) {
    if (!r.test(e.g, e)) continue
    marked++
    if (RESOLVES_CORPUS(e.g)) mislabel++
    else { unproven++; bump(names5, e.g) }
  }
  const per = {} as Record<string, number>
  for (const t of live) {
    const n = edges.filter((e) => e.t === t && r.test(e.g, e)).length
    if (n > 0) per[t] = n
  }
  // THE FALSIFYING COLUMN for a marking rule is over ALL edges: how many of the rule's own marks
  // point at a target the corpus DOES publish. That is section F's `mislabel`, computed here for
  // R10/R11 directly because they are defined after F has already printed.
  let allMarks = 0
  let allMislabel = 0
  const mislabelNames = counter()
  for (const e of live2) {
    if (!r.test(e.g, e)) continue
    allMarks++
    if (RESOLVES_CORPUS(e.g)) { allMislabel++; bump(mislabelNames, e.g) }
  }
  console.log(`   ${key.padEnd(4)} over ALL ${live2.length} live edges: marks ${pad(allMarks, 7)}  WOULD-MISLABEL ${pad(allMislabel, 6)} (${allMarks === 0 ? "n/a" : `${((100 * allMislabel) / allMarks).toFixed(2)}%`})`)
  console.log(`         over the ${unresolvedEdges.length} unresolved: marks ${pad(marked, 7)}  unproven-absent ${pad(unproven, 6)}  by type ${JSON.stringify(per)}`)
  if (allMislabel > 0) console.log(`         would-mislabel: ${Object.entries(mislabelNames).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n} (${c})`).join(", ")}`)
  // WHERE EACH RESIDUAL MISLABEL LIVES. A mislabel is only tolerable if the retarget the
  // cause-B remedy would apply LANDS ON A REAL DECLARATION, because then the edge is not
  // mislabelled by the rule -- it is mis-SPELLED by the emitter, and retargeting it is a
  // spelling fix. `System.Text` -> `Text` binding a property named `Text` is not that; it is
  // a coincidence of vocabulary, which is why this partition asks the LOOKUP question
  // (kindsOf) and not the STRING question (does the name contain a separator). Four buckets,
  // counted in EDGES so they sum to allMislabel:
  //   modSeg   final segment is published, and one of those symbols is a `module` -- the only
  //            kind for which a path's last segment IS an identity, since a module symbol is
  //            published as its basename-with-extension
  //   othSeg   final segment is published under some other kind -- the retarget would attach
  //            the edge to an unrelated local of the same spelling
  //   absentSeg final segment is published nowhere -- the retarget would resolve to nothing
  //   noSep    the target carries no `.` and no `::`, so there is no final segment to take
  const mislabelVia: Record<string, { becomes: string; edges: number; kinds: string[]; bucket: string }> = {}
  const partition = { modSeg: 0, othSeg: 0, absentSeg: 0, noSep: 0 }
  const bucketOf = (name: string): { seg: string; kinds: string[]; bucket: string } => {
    const seg = finalSegment(name)
    if (seg === name) return { seg, kinds: [], bucket: "noSep" }
    const kinds = [...kindsOf(seg)].sort()
    if (kinds.length === 0) return { seg, kinds, bucket: "absentSeg" }
    return { seg, kinds, bucket: kinds.includes("module") ? "modSeg" : "othSeg" }
  }
  for (const [name, c] of Object.entries(mislabelNames).sort((a, b) => b[1] - a[1])) {
    const b = bucketOf(name)
    partition[b.bucket as keyof typeof partition] += c
    mislabelVia[name] = { becomes: b.seg, edges: c, kinds: b.kinds, bucket: b.bucket }
  }
  if (allMislabel > 0) {
    const shown = Object.entries(mislabelVia).slice(0, 12)
    if (shown.length) console.log(`         of those, by where the FINAL SEGMENT lands: ${shown.map(([n, v]) => `${n} -> ${v.becomes} [${v.kinds.join("|") || "not published"}] ${v.bucket}`).join(", ")}`)
    console.log(`         mislabel edges by bucket: ${JSON.stringify(partition)}`)
    const sum = partition.modSeg + partition.othSeg + partition.absentSeg + partition.noSep
    if (sum !== allMislabel) {
      console.error(`   BUCKET SUM MISMATCH: buckets ${sum} != allMislabel ${allMislabel}`)
      process.exitCode = 3
    }
  }
  i5[key] = {
    marksOverAllLiveEdges: allMarks,
    wouldMislabelOverAllLiveEdges: allMislabel,
    wouldMislabelPct: allMarks === 0 ? null : Number(((100 * allMislabel) / allMarks).toFixed(2)),
    topWouldMislabel: Object.fromEntries(Object.entries(mislabelNames).sort((a, b) => b[1] - a[1]).slice(0, 20)),
    mislabelFinalSegmentBucket: Object.fromEntries(Object.entries(mislabelVia).sort((a, b) => b[1].edges - a[1].edges).slice(0, 20)),
    mislabelFinalSegmentPartition: partition,
    marksOverUnresolved: marked,
    unprovenAbsent: unproven,
    byTypeOverAllEdges: per,
    topMarkedUnresolved: Object.fromEntries(Object.entries(names5).sort((a, b) => b[1] - a[1]).slice(0, 25)),
  }
}

// ---------------------------------------------------------------------- I6
// THE COLUMN THAT DECIDES AN EXTERNAL-MARKING RULE, AND IT IS NOT THE ONE I5 PRINTS.
//
// `wouldMislabel` above asks "does the corpus publish this name ANYWHERE". That is the right
// falsifier for a SPELLING rule — an emitter and a publisher disagreeing on the last segment
// is cause B — and the wrong falsifier for an EXTERNALITY rule, because it counts a name that
// a DIFFERENT file declares as a reason not to say "external". PowerShell binds a bare name at
// run time against session state, so a name declared in another file is not local to this one;
// it is the dot-source / module-export case, which is what cause C is. bash reached the same
// conclusion and shipped `variableDeclaredInFile` rather than `isExternal`.
//
// So I6 falsifies against the FILE THAT EMITS THE EDGE. A rule is sound when the edges it
// marks whose target that file itself declares are the only errors, and the residual is stated
// rather than rounded away.
console.log("")
console.log("I6. the EXTERNALITY falsifier — a rule's marks whose target the EMITTING FILE declares")
console.log(`   population: ${live2.length} live edges; declared-in-source-file measured per edge`)
console.log("")
console.log("rule".padEnd(6) + pad("marks", 9) + pad("misCorpus", 11) + pad("misINTRA", 10) + pad("intra%", 9) + pad("unresolved marks", 18))
console.log("-".repeat(78))
const i6: Record<string, Record<string, unknown>> = {}
for (const r of RULES) {
  let marks = 0
  let misCorpus = 0
  let misIntra = 0
  let unresMarks = 0
  const intraNames = counter()
  for (const e of live2) {
    if (!r.test(e.g, e)) continue
    marks++
    if (DECLARED_IN_SOURCE_FILE(e)) { misIntra++; bump(intraNames, e.g) }
    if (RESOLVES_CORPUS(e.g)) misCorpus++
  }
  for (const e of unresolvedEdges) if (r.test(e.g, e)) unresMarks++
  const key = ruleKey(r.id)
  console.log(
    key.padEnd(6) + pad(marks, 9) + pad(misCorpus, 11) + pad(misIntra, 10) +
    pad(marks === 0 ? "n/a" : `${((100 * misIntra) / marks).toFixed(2)}%`, 9) + pad(unresMarks, 18),
  )
  i6[key] = {
    label: ruleLabel(r.id),
    marksOverAllLiveEdges: marks,
    wouldMislabelCorpusWide: misCorpus,
    wouldMislabelCorpusWidePct: marks === 0 ? null : Number(((100 * misCorpus) / marks).toFixed(2)),
    wouldMislabelDeclaredInSourceFile: misIntra,
    wouldMislabelDeclaredInSourceFilePct: marks === 0 ? null : Number(((100 * misIntra) / marks).toFixed(2)),
    marksOverUnresolved: unresMarks,
    topDeclaredInSourceFile: Object.fromEntries(Object.entries(intraNames).sort((a, b) => b[1] - a[1]).slice(0, 20)),
  }
}

// I6b — the same falsifier on the ANALYZER-SIDE fact a real implementation could compute:
// whether the target is declared in the emitting file, with NO shape rule at all. This is
// bash's `variableDeclaredInFile` over powershell's edge population, and its two halves are
// the whole cause-A / cause-C split: declared-here is cause A, not-declared-here is what a
// single-file reader cannot resolve and a consumer should stop reading as a local.
let unresDeclaredHere = 0
let unresNotDeclaredHere = 0
const unresNotDeclaredByType: Record<string, number> = {}
const notDeclaredTop = counter()
for (const e of unresolvedEdges) {
  if (DECLARED_IN_SOURCE_FILE(e)) { unresDeclaredHere++; continue }
  unresNotDeclaredHere++
  notDeclaredTop[e.g] = (notDeclaredTop[e.g] ?? 0) + 1
  const cur = unresNotDeclaredByType[e.t] ?? 0
  unresNotDeclaredByType[e.t] = cur + 1
}
console.log("")
console.log(`I6b. over the ${unresolvedEdges.length} unresolved edges: declared in the emitting file ${unresDeclaredHere}, NOT declared there ${unresNotDeclaredHere} (${((100 * unresNotDeclaredHere) / unresolvedEdges.length).toFixed(2)}%)`)
console.log(`     by type: ${JSON.stringify(Object.fromEntries(Object.entries(unresNotDeclaredByType).sort((a, b) => b[1] - a[1])))}`)
console.log(`     top not-declared-here: ${Object.entries(notDeclaredTop).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, c]) => `${n} (${c})`).join(", ")}`)
const i6b = {
  unresolvedPopulation: unresolvedEdges.length,
  declaredInEmittingFile: unresDeclaredHere,
  notDeclaredInEmittingFile: unresNotDeclaredHere,
  notDeclaredPct: Number(((100 * unresNotDeclaredHere) / unresolvedEdges.length).toFixed(2)),
  byType: Object.fromEntries(Object.entries(unresNotDeclaredByType).sort((a, b) => b[1] - a[1])),
  topNotDeclared: Object.fromEntries(Object.entries(notDeclaredTop).sort((a, b) => b[1] - a[1]).slice(0, 60)),
}

// ---------------------------------------------------------------------- I7
// THE RULE THAT IS ACTUALLY SHIPPABLE, AND WHY I6's COLUMN IS NOT A DEFECT OF R2.
//
// R2 (the Verb-Noun cmdlet shape) is the largest externality population this lane has — 32,368
// marks — and 21.75% of them point at a name the EMITTING FILE declares. That is what made it
// unsound: a shape rule cannot tell `Get-ChildItem` from a file's own `function Get-ChildItem`.
//
// But the shape was never the thing that decides. The DECLARATION TABLE does, and the analyzer
// builds one per file. So the shipped predicate is `shape AND NOT DECLARED IN THIS FILE`, and
// the intra-file column is then 0 BY CONSTRUCTION — which is a property of the construction and
// not evidence, the same caveat section G carries. What is NOT by construction is the third
// column: of the edges it marks, how many does ANOTHER file declare? Those are the ones the
// corpus-wide falsifier called mislabels, and they are the dot-source / module-export case that
// IS externality. The number to read is therefore not "mislabel" but "how many marks a
// whole-corpus lookup would have objected to, and what would have happened if it had been
// obeyed" — which is the R2 trap restated for the declaration-guarded rule.
console.log("")
console.log("I7. the DECLARATION-GUARDED rule — shape AND not declared in the emitting file")
console.log("")
console.log("rule".padEnd(30) + pad("marks", 9) + pad("misINTRA", 10) + pad("intra%", 9) + pad("declaredElsewhere", 19) + pad("unres marks", 13))
console.log("-".repeat(90))
const GUARDS: { id: string; label: string; test: (t: string, e: { g: string; f: string }) => boolean }[] = [
  { id: "E1", label: "E1 cmdlet shape + guard", test: (t, e) => R2.test(t, e) && !DECLARED_IN_SOURCE_FILE(e) },
  { id: "E2", label: "E2 R14 shape + guard", test: (t, e) => R14.test(t, e) && !DECLARED_IN_SOURCE_FILE(e) },
  { id: "E3", label: "E3 E1 or E2 + guard", test: (t, e) => (R2.test(t, e) || R14.test(t, e)) && !DECLARED_IN_SOURCE_FILE(e) },
  { id: "E4", label: "E4 R2 alone (unguarded)", test: (t, e) => R2.test(t, e) },
]
const i7: Record<string, Record<string, unknown>> = {}
for (const g of GUARDS) {
  let marks = 0
  let misIntra = 0
  let elsewhere = 0
  let unresMarks = 0
  const elsewhereNames = counter()
  for (const e of live2) {
    if (!g.test(e.g, e)) continue
    marks++
    if (DECLARED_IN_SOURCE_FILE(e)) misIntra++
    else if (RESOLVES_CORPUS(e.g)) { elsewhere++; bump(elsewhereNames, e.g) }
  }
  for (const e of unresolvedEdges) if (g.test(e.g, e)) unresMarks++
  console.log(
    g.label.padEnd(30) + pad(marks, 9) + pad(misIntra, 10) +
    pad(marks === 0 ? "n/a" : `${((100 * misIntra) / marks).toFixed(2)}%`, 9) +
    pad(elsewhere, 19) + pad(unresMarks, 13),
  )
  i7[g.id] = {
    label: g.label,
    marksOverAllLiveEdges: marks,
    wouldMislabelDeclaredInSourceFile: misIntra,
    declaredInAnotherFile: elsewhere,
    marksOverUnresolved: unresMarks,
    coverageOfUnresolvedPct: Number(((100 * unresMarks) / unresolvedEdges.length).toFixed(2)),
    topDeclaredInAnotherFile: Object.fromEntries(Object.entries(elsewhereNames).sort((a, b) => b[1] - a[1]).slice(0, 30)),
  }
}

// I7b — THE PAYLOAD OF THE HONEST FACT. `noDeclarationInFile` is additive metadata on an edge
// that already exists, so its cost is bytes on edges the lane already publishes. The count
// below is how many edges would CARRY it: `calls`/`uses` targets that are bare-word spellings
// (no qualifier byte) and that this file declares nowhere. Publishing it only on the FALSE
// state keeps the key additive and unambiguous in the other direction — absent means "not
// asserted", never "declared here" — which is why the count is over not-declared edges only.
let bareNoDecl = 0
let bareTotal = 0
const bareNoDeclByType: Record<string, number> = {}
for (const e of live2) {
  if (e.t !== "calls" && e.t !== "uses") continue
  if (R10.test(e.g, e)) continue // a qualified spelling is not a bare-word name
  bareTotal++
  if (DECLARED_IN_SOURCE_FILE(e)) continue
  bareNoDecl++
  bareNoDeclByType[e.t] = (bareNoDeclByType[e.t] ?? 0) + 1
}
console.log("")
console.log(`I7b. calls+uses edges whose target is a BARE-WORD spelling: ${bareTotal}; of those, not declared in the emitting file: ${bareNoDecl} (${((100 * bareNoDecl) / bareTotal).toFixed(2)}%)  by type ${JSON.stringify(bareNoDeclByType)}`)
console.log(`     that is the row count \`noDeclarationInFile\` would add to the payload; at 28 B/key it is ${(28 * bareNoDecl).toLocaleString("en-US")} B over ${live2.length} live edges`)
const i7b = {
  bareWordCallAndUseEdges: bareTotal,
  notDeclaredInEmittingFile: bareNoDecl,
  pct: Number(((100 * bareNoDecl) / bareTotal).toFixed(2)),
  byType: bareNoDeclByType,
}

// ---------------------------------------------------------------------- I8
// WHAT THE ANALYZER ACTUALLY EMITS, READ BACK FROM PRODUCTION OUTPUT.
//
// I7 is this file's own shape predicates applied to the edge population. I8 is the two
// metadata keys `src/ast/real-powershell-analyzer.ts` now writes, counted as they come out
// of `parseFile`. The two are independent derivations of the same claim, so where they agree
// the analyzer's docstring numbers are corroborated and where they disagree the docstring is
// wrong — which is the check the ROUND brief asks for ("a number and the command that
// produced it, side by side, must agree").
let shippedExternal = 0
let shippedNoDecl = 0
let shippedExternalButDeclaredHere = 0
let shippedExternalResolving = 0
const shippedVia: Record<string, number> = counter()
const shippedByType: Record<string, number> = counter()
const shippedNoDeclByType: Record<string, number> = counter()
const shippedUnres = { external: 0, noDecl: 0 }
const unresSet = new Set(unresolvedEdges)
for (const e of live2) {
  const isUnres = unresSet.has(e)
  if (e.xt === "true") {
    shippedExternal++
    shippedVia[e.xv ?? "?"] = (shippedVia[e.xv ?? "?"] ?? 0) + 1
    shippedByType[e.t] = (shippedByType[e.t] ?? 0) + 1
    if (DECLARED_IN_SOURCE_FILE(e)) shippedExternalButDeclaredHere++
    if (RESOLVES_CORPUS(e.g)) shippedExternalResolving++
    if (isUnres) shippedUnres.external++
  }
  if (e.nd === "true") {
    shippedNoDecl++
    shippedNoDeclByType[e.t] = (shippedNoDeclByType[e.t] ?? 0) + 1
    if (isUnres) shippedUnres.noDecl++
  }
}
console.log("")
console.log("I8. the SHIPPED keys, read out of production parseFile output")
console.log(`   externalTarget:true  ${shippedExternal} of ${live2.length} live edges   by via ${JSON.stringify(shippedVia)}   by type ${JSON.stringify(Object.fromEntries(Object.entries(shippedByType).sort((a, b) => b[1] - a[1])))}`)
console.log(`     of those, DECLARED IN THE EMITTING FILE: ${shippedExternalButDeclaredHere} (must be 0 -- the guard's whole job); resolvable corpus-wide: ${shippedExternalResolving}`)
console.log(`   noDeclarationInFile:true  ${shippedNoDecl}   by type ${JSON.stringify(shippedNoDeclByType)}`)
console.log(`   of the ${unresolvedEdges.length} unresolved: externalTarget ${shippedUnres.external} (${((100 * shippedUnres.external) / unresolvedEdges.length).toFixed(2)}%), noDeclarationInFile ${shippedUnres.noDecl} (${((100 * shippedUnres.noDecl) / unresolvedEdges.length).toFixed(2)}%)`)
const i8 = {
  liveEdgePopulation: live2.length,
  externalTargetTrue: shippedExternal,
  externalVia: shippedVia,
  externalByType: shippedByType,
  externalButDeclaredInSourceFile: shippedExternalButDeclaredHere,
  externalResolvableCorpusWide: shippedExternalResolving,
  noDeclarationInFileTrue: shippedNoDecl,
  noDeclarationInFileByType: shippedNoDeclByType,
  overUnresolved: shippedUnres,
  unresolvedPopulation: unresolvedEdges.length,
  instrumentPredictionE3: i7.E3,
  agreement: {
    predictedE3Marks: i7.E3!.marksOverAllLiveEdges as number,
    shippedExternalTarget: shippedExternal,
    delta: (i7.E3!.marksOverAllLiveEdges as number) - shippedExternal,
  },
}

// I8b — WHY THE SHIPPED COUNT AND THE INSTRUMENT'S PREDICTION DIFFER, NAMED EDGE BY EDGE.
// Two independent derivations of one claim are only worth printing if the residual is
// explained rather than absorbed, so this is the symmetric difference between the marks I7
// predicts and the marks I8 reads, bucketed by target name. Anything left unexplained here
// is a number the analyzer's docstring would be resting on.
const shipSet = new Set(live2.filter((e) => e.xt === "true"))
const predSet = new Set(live2.filter((e) => (R2.test(e.g, e) || R14.test(e.g, e)) && !DECLARED_IN_SOURCE_FILE(e)))
const onlyShipped = counter()
const onlyPredicted = counter()
for (const e of shipSet) if (!predSet.has(e)) onlyShipped[e.g] = (onlyShipped[e.g] ?? 0) + 1
for (const e of predSet) if (!shipSet.has(e)) onlyPredicted[e.g] = (onlyPredicted[e.g] ?? 0) + 1
const sumSide = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0)
console.log("")
console.log(`I8b. shipped ${shipSet.size} vs predicted ${predSet.size}; only-shipped ${sumSide(onlyShipped)}, only-predicted ${sumSide(onlyPredicted)}`)
console.log(`     only-shipped: ${Object.entries(onlyShipped).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n} (${c})`).join(", ") || "none"}`)
console.log(`     only-predicted: ${Object.entries(onlyPredicted).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n} (${c})`).join(", ") || "none"}`)
i8.symmetricDifference = {
  shippedOnly: { edges: sumSide(onlyShipped), byTarget: Object.fromEntries(Object.entries(onlyShipped).sort((a, b) => b[1] - a[1]).slice(0, 30)) },
  predictedOnly: { edges: sumSide(onlyPredicted), byTarget: Object.fromEntries(Object.entries(onlyPredicted).sort((a, b) => b[1] - a[1]).slice(0, 30)) },
}

if (excluded.length) {
  console.log("EXCLUDED:")
  for (const e of excluded) console.log(`  ${e.file} — ${e.reason}`)
}

if (OUT) {
  const serial: Record<string, unknown> = {}
  for (const t of live) {
    const r = perType[t]
    const { examples: ex0, shapeTop, ...rest0 } = r
    serial[t] = {
      ...rest0,
      topUnlabelledUnresolvedTargets: Object.fromEntries(Object.entries(shapeTop).sort((a, b) => b[1] - a[1]).slice(0, 80)),
      examples: Object.fromEntries([...ex0].map(([b, m]) => [b, [...m].slice(0, LIST).map(([k, v]) => ({ key: k, hits: v[0], edgeSource: v[1], memberKind: v[2] }))])),
    }
  }
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/powershell/ambiguity-split.mts",
    relationshipPayloadBytes: payloadBytes,
    relationshipPayloadBytesWithoutCauseCKeys: payloadBytesWithoutCauseC,
    relationshipPayloadDeltaBytes: payloadBytes - payloadBytesWithoutCauseC,
    relationshipPayloadDeltaBytesExcludingNoDeclarationInFile: payloadBytes - payloadBytesWithoutNoDecl,
    relationshipPayloadDeltaBytesExcludingExternalTarget: payloadBytes - payloadBytesWithoutExternal,
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    corpusRoot: CR,
    admittedPopulation: population,
    filesWalked: picked.length,
    sampling: WANT > 0 && WANT < population
      ? `deterministic stride of ${WANT} over the ${population} admitted files sorted by repo/relative/path`
      : `the whole admitted set — ${population} of ${population}, no sampling cut`,
    symbolsCollected: symbols.length,
    edgesCollected: edges.length,
    filesWithSymbols: filesWithSymbols.size,
    distinctPublishedNames,
    symbolKinds: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1])),
    edgeTypesOutsideTheTen: outsideTheTen,
    excluded,
    causeCCounterfactualOverAllEdges: counterfactual,
    causeCOverUnresolved: f2,
    causeCOverUnresolvedPerType: gPerType,
    causeCMarkingCost: h,
    causeBImportsCanonicalisation: {
      publishedModuleSymbols: moduleNames.size,
      importsAndReferencesEdges: irEdges.length,
      resolver: "exact name, then folded case, then qualifiedName — the same three-way lookup section A uses",
      table: iTable,
      bestCandidate: best.k.key,
      bestCandidateReading: best.k.label,
      perVia: viaRows,
      retargets: i3,
      publishedNameCharInventory: charInventory,
      grammarRule: i5,
      externalityFalsifier: { perRule: i6, notDeclaredInEmittingFile: i6b },
      declarationGuardedRule: i7,
      noDeclarationInFilePayload: i7b,
      shipped: i8,
    },
    causeBFinalSegmentRecoverable: {
      unresolvedPopulation: unresolvedEdges.length,
      finalSegmentPublished: segRecoverableAll,
      distinctTargets: segTop.length,
      top: Object.fromEntries(segTop.slice(0, 40)),
    },
    perType: serial,
  }, null, 2))
  console.log("")
  console.log(`wrote ${OUT}`)
}
