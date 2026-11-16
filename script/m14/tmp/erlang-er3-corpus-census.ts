// script/m14/tmp/erlang-er3-corpus-census.ts
//
// ER3 corpus census: the big-corpus face of the type-dependency narrowing.
//
// Why it exists: the lane's F5 sweep compares a 60-file sample per corpus, and
// the M12 differential is two fixtures. A rule about what a type expression
// MEANS has to be checked on every .erl file the lane can read, not on files
// chosen by a sampler.
//
// For every .erl and .hrl under a corpus it reports, from ONE parse per file:
//   1. analyzer-vs-oracle disagreements under the harness's own match semantics
//      (label + normTarget, as F5 compares) AND under exact target matching;
//   2. the ER3 census: how many type-dependency edges exist, how many cite a
//      site line that actually APPLIES the named type (`name(` / `mod:name(`),
//      and a per-group (kind|context) tally so a before/after run of the same
//      artifact shows exactly which classes the narrowing removed;
//   3. the classes the narrowing forbids (record-type instantiates at 0 is the
//      claim; a bare-atom type reference at 0 is the other).
//
// The analyzer under test is whatever is on disk — run it once with the tree as
// it stands and once with the pre-ER3 analyzer swapped in (git show <rev>:...),
// tagging each run, and the artifact then carries both sides.
//
// Run: BB_CENSUS_TAG=post bun script/m14/tmp/erlang-er3-corpus-census.ts rebar3 otp
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
import { deriveErlangEdges, normTarget } from "../differential"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const TAG = process.env.BB_CENSUS_TAG ?? "unset"
// Sharding exists because a single SYNC call cannot outlive 10 minutes on this
// build and OTP is 3,872 files under a loaded box: `BB_CENSUS_SHARD=1/3`
// processes every third file of the SORTED path list (deterministic), and
// `--merge` sums the shards straight out of the artifact — the aggregate is
// derived from evidence, never typed by hand.
const SHARD = process.env.BB_CENSUS_SHARD ?? ""
const MERGE_AT = process.argv.indexOf("--merge")
const OUT = path.join(ROOT, "validation/m14/results/archive/erlang-er3-corpus-census.json")
// The kinds F5 compares for erlang (differential.ts's compared-label filter).
const AUDITED = new Set(["calls", "implements", "instantiates", "uses", "references"])

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-erlang.wasm")))
const parser = new P()
parser.setLanguage(lang)

const loadAvg = (): number => {
  try { return Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]) } catch { return 0 }
}
const rev = (repo: string): string => {
  try {
    const p = Bun.spawnSync(["git", "-C", path.join(CORPUS, repo), "rev-parse", "HEAD"])
    return new TextDecoder().decode(p.stdout).trim().slice(0, 12)
  } catch { return "n/a" }
}
const leaf = (t: string): string => t.split(/[:.]/).filter(Boolean).pop() ?? t

/** Does `code` APPLY `name` — `name(` / `mod:name(` (type application) or
 *  `#name{` (record type)? Scanned, never compiled: a target name is arbitrary
 *  text, and `new RegExp` over it threw `Invalid regular expression: invalid
 *  quantifier` on two corpus files (sofs.erl's type names carry `|`/`+`),
 *  silently dropping their edges — the first version of this probe measured
 *  itself. */
const appliesName = (code: string, name: string): "call-head" | "remote" | "record-type" | "none" => {
  if (!name) return "none"
  const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c)
  for (let i = 0; i < code.length; i++) {
    // #name{ ... } — a record type
    if (code[i] === "#" && code.startsWith(name, i + 1) && (code[i + 1 + name.length] ?? "") === "{") return "record-type"
  }
  let at = code.indexOf(`${name}(`)
  while (at >= 0) {
    const before = at > 0 ? code[at - 1] : " "
    if (!isWordChar(before)) {
      // `mod:name(` — the character immediately before `name(` is the colon;
      // the first version of this helper tested the char TWO back (an
      // off-by-one) and filed every remote type under call-head.
      if (before === ":") {
        let j = at - 2
        while (j >= 0 && isWordChar(code[j])) j--
        if (j < at - 2) return "remote"
      }
      return "call-head"
    }
    at = code.indexOf(`${name}(`, at + 1)
  }
  return "none"
}

type RepoReport = Record<string, any>
const runs: Record<string, RepoReport> = {}
const readDoc = () => existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : { schemaVersion: 1, kind: "erlang-er3-corpus-census", note: "Exhaustive .erl/.hrl ER3 census: analyzer-vs-oracle disagreements under F5's match semantics plus the per-edge site check. Runs are tagged so one artifact can carry a pre/post pair; a repo row may be SHARDED (repo#shardIofN) when one run cannot fit a 10-minute call, and --merge sums the shards back into the repo row from this file.", runs: {} }
const writeDoc = (doc: any) => { doc.generatedAt = new Date().toISOString(); writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n") }

// --merge <tag> <repo> <n> — sum the shard rows of one repo from the artifact.
if (MERGE_AT > 0) {
  const [tag, repo, nRaw] = process.argv.slice(MERGE_AT + 1)
  const n = Number(nRaw)
  const doc = readDoc()
  const rows = doc.runs[tag] ?? {}
  const shards = Object.keys(rows).filter((k) => k.startsWith(`${repo}#shard`))
  if (shards.length !== n) { console.error(`merge: expected ${n} shards for ${repo}@${tag}, found ${shards.length}`); process.exit(1) }
  const numeric = (o: any, k: string) => Object.values(o?.totals ?? {}).reduce ? (o.totals[k] ?? 0) : 0
  const sumKey = (k: string) => shards.reduce((a, s) => a + (rows[s].totals?.[k] ?? 0), 0)
  const sumGroup = (k: string) => { const out: Record<string, number> = {}; for (const s of shards) for (const [g, v] of Object.entries(rows[s][k] ?? {})) out[g] = (out[g] ?? 0) + (v as number); return out }
  const sumTargets = () => { const out: Record<string, number> = {}; for (const s of shards) for (const [g, v] of Object.entries(rows[s].typeRefTargets ?? {})) out[g] = (out[g] ?? 0) + (v as number); return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25)) }
  const collect = (key: string) => shards.flatMap((s) => (rows[s].samples?.[key] ?? []).slice(0, 15))
  void numeric
  rows[repo] = {
    repo, tag,
    revision: rows[shards[0]].revision,
    shards: n,
    shardKeys: shards.sort(),
    erl: { files: sumKey("files") },
    hrl: {},
    // bucket-level rows stay per shard; the totals below are the sums
    totals: Object.fromEntries(Object.keys(rows[shards[0]].totals).map((k) => [k, sumKey(k)])),
    edgeGroups: sumGroup("edgeGroups"),
    typeRefForms: sumGroup("typeRefForms"),
    typeRefTargets: sumTargets(),
    samples: { missing: collect("missing"), unexplained: collect("unexplained"), site: collect("site") },
    wallSeconds: Number(shards.reduce((a, s) => a + (rows[s].wallSeconds ?? 0), 0).toFixed(1)),
    load1: Math.max(...shards.map((s) => rows[s].load1 ?? 0)),
    mergedFromShards: true,
  }
  writeDoc(doc)
  const t = rows[repo].totals
  console.log(`merged ${repo}@${tag} from ${n} shards: files=${t.files} err=${t.parseErrors} oracle=${t.oracleEdges} analyzer=${t.analyzerEdges} MISSING=${t.missingCoarse}(exact ${t.missingExact}) UNEXPLAINED=${t.unexplainedCoarse}(exact ${t.unexplainedExact}) typeRefs=${t.typeRefEdges} siteViolations=${t.typeRefSiteViolations} recordTypeInstantiates=${t.recordTypeInstantiates}`)
  process.exit(0)
}

for (const repo of REPOS) {
  const dir = path.join(CORPUS, repo)
  const files: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try { entries = readdirSync(d) } catch { return }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules") continue
      const p = path.join(d, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (e.endsWith(".erl") || e.endsWith(".hrl")) files.push(p)
    }
  }
  walk(dir)
  files.sort()

  const buckets: Record<string, any> = {}
  // How each type-dependency edge's site APPLIES the cited name — the ER3
  // decomposition, so the report can say what the narrowing kept and dropped
  // instead of only reporting a net delta.
  const forms: Record<string, number> = {}
  const groupCounts: Record<string, number> = {}
  const typeRefTargets: Record<string, number> = {}
  const samples: { missing: string[]; unexplained: string[]; site: string[] } = { missing: [], unexplained: [], site: [] }
  const started = Date.now()

  for (const bucket of ["erl", "hrl"]) {
    const all = files.filter((f) => f.endsWith(`.${bucket}`))
    const subset = SHARD
      ? all.filter((_, i) => i % Number(SHARD.split("/")[1]) === Number(SHARD.split("/")[0]) - 1)
      : all
    const b = buckets[bucket] = {
      files: subset.length, parseErrors: 0, crashes: 0,
      oracleEdges: 0, analyzerEdges: 0,
      missingCoarse: 0, unexplainedCoarse: 0, missingExact: 0, unexplainedExact: 0,
      parseErrorFiles: [] as string[], crashFiles: [] as string[],
    }
    for (const f of subset) {
      const rel = path.relative(CORPUS, f)
      let src: string
      try { src = readFileSync(f, "utf8") } catch { b.crashes++; if (b.crashFiles.length < 20) b.crashFiles.push(rel); continue }
      let tree: any
      try {
        tree = parser.parse(src)
        if (!tree) { b.crashes++; if (b.crashFiles.length < 20) b.crashFiles.push(rel); continue }
        if (tree.rootNode.hasError) { b.parseErrors++; if (b.parseErrorFiles.length < 60) b.parseErrorFiles.push(rel) }
        const res = new RealErlangAnalyzer().analyze(tree.rootNode, src, f)
        const truth = deriveErlangEdges(tree.rootNode).filter((e: any) => AUDITED.has(e.label))
        // TWO dedupes, deliberately different:
        //   rows      — (label,target), the granularity F5 compares and the
        //               analyzer side of this census matches it;
        //   classRows — (label,context,target), because a file may reference one
        //               NAME as two different things (`?socket(...)` is a macro
        //               use, `socket()` a type dependency) and a (label,target)
        //               dedupe would silently drop the second from the class
        //               tally. The first version of this probe made exactly that
        //               mistake and reported a class delta the analyzer never
        //               made (macro use +93 on OTP: measured site-by-site, the
        //               real change was ONE site, socket.erl:1680).
        const rows: any[] = []
        const seen = new Set<string>()
        const classRows: any[] = []
        const seenClass = new Set<string>()
        for (const r of res.relationships as any[]) {
          const label = String(r.type)
          if (!AUDITED.has(label)) continue
          const target = String(r.target)
          const context = String(r.metadata?.context ?? "")
          const line = (r as any).line_number ?? r.lineNumber ?? 0
          const key = `${label}|${target}`
          if (!seen.has(key)) { seen.add(key); rows.push({ label, target, context, line }) }
          const ckey = `${label}|${context}|${target}`
          if (!seenClass.has(ckey)) { seenClass.add(ckey); classRows.push({ label, target, context, line }) }
        }
        b.oracleEdges += truth.length
        b.analyzerEdges += rows.length

        for (const te of truth) {
          const coarse = rows.some((r) => r.label === te.label && normTarget(r.target) === normTarget(te.target))
          const exact = rows.some((r) => r.label === te.label && r.target === te.target)
          if (!coarse) { b.missingCoarse++; if (samples.missing.length < 40) samples.missing.push(`MISSING     ${rel} :: ${te.label} ${te.from} -> ${te.target}`) }
          if (!exact) b.missingExact++
        }
        for (const r of rows) {
          const coarse = truth.some((te: any) => te.label === r.label && normTarget(te.target) === normTarget(r.target))
          const exact = truth.some((te: any) => te.label === r.label && te.target === r.target)
          if (!coarse) { b.unexplainedCoarse++; if (samples.unexplained.length < 40) samples.unexplained.push(`UNEXPLAINED ${rel} :: ${r.label} -> ${r.target} (${r.context})`) }
          if (!exact) b.unexplainedExact++
        }

        for (const r of classRows) {
          const g = `${r.label}|${r.context || "-"}`
          groupCounts[g] = (groupCounts[g] ?? 0) + 1
          if (r.context === "type reference") {
            b.typeRefEdges = (b.typeRefEdges ?? 0) + 1
            const lf = leaf(r.target)
            typeRefTargets[lf] = (typeRefTargets[lf] ?? 0) + 1
            const lineText = src.split("\n")[(r.line || 0) - 1] ?? ""
            // The ER3 contract, per EDGE: a type dependency's site must APPLY the
            // name it cites, in one of the language's two application forms —
            // `name(...)` / `mod:name(...)` (a type application) or `#name{...}`
            // (a record type). A bare mention is an atom literal or a field key,
            // and the narrowing forbids it.
            const code = lineText.replace(/%.*$/, "")
            const form = appliesName(code, lf)
            forms[form] = (forms[form] ?? 0) + 1
            if (form === "none") {
              b.typeRefSiteViolations = (b.typeRefSiteViolations ?? 0) + 1
              if (samples.site.length < 40) samples.site.push(`SITE ${rel}:${r.line} cites ${r.target} but the line does not apply it: ${lineText.trim().slice(0, 90)}`)
            }
          }
          // Forbidden classes (must stay 0): a record TYPE must never be read as
          // a construction.
          if (r.label === "instantiates" && /-type |-opaque /.test(src.split("\n")[(r.line || 0) - 1] ?? "")) {
            b.recordTypeInstantiates = (b.recordTypeInstantiates ?? 0) + 1
          }
        }
        tree.delete?.()
      } catch (e: any) {
        b.crashes++
        if (b.crashFiles.length < 20) b.crashFiles.push(`${rel} :: ${String(e?.message ?? e).slice(0, 140)}`)
        continue
      }
    }
  }

  const roof = (o: any, k: string) => Object.values(o).reduce((a: number, x: any) => a + (x[k] ?? 0), 0)
  const key = SHARD ? `${repo}#shard${SHARD.split("/")[0]}of${SHARD.split("/")[1]}` : repo
  runs[key] = {
    // (written after THIS repo, so a long multi-repo run still lands evidence)
    repo, revision: rev(repo), tag: TAG, ...(SHARD ? { shard: SHARD } : {}),
    ...buckets,
    totals: Object.fromEntries(["files", "parseErrors", "crashes", "oracleEdges", "analyzerEdges", "missingCoarse", "unexplainedCoarse", "missingExact", "unexplainedExact", "typeRefEdges", "typeRefSiteViolations", "recordTypeInstantiates"]
      .map((k) => [k, roof(buckets, k)])),
    edgeGroups: Object.fromEntries(Object.entries(groupCounts).sort((a, b) => b[1] - a[1])),
    typeRefForms: Object.fromEntries(Object.entries(forms).sort((a, b) => b[1] - a[1])),
    typeRefTargets: Object.fromEntries(Object.entries(typeRefTargets).sort((a, b) => b[1] - a[1]).slice(0, 25)),
    samples,
    wallSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    load1: loadAvg(),
  }
  // Durable per-repo write: a background run on a loaded box may be killed
  // between repos, and evidence that never reached disk did not happen.
  const write = () => {
    const prev = readDoc()
    prev.runs[TAG] = { ...(prev.runs[TAG] ?? {}), ...runs }
    writeDoc(prev)
  }
  write()
  const t = runs[key].totals
  console.log(`${key}@${runs[key].revision} [${TAG}] erl=${buckets.erl.files} hrl=${buckets.hrl.files} oracle=${t.oracleEdges} analyzer=${t.analyzerEdges} MISSING=${t.missingCoarse}(exact ${t.missingExact}) UNEXPLAINED=${t.unexplainedCoarse}(exact ${t.unexplainedExact}) typeRefs=${t.typeRefEdges} siteViolations=${t.typeRefSiteViolations} recordTypeInstantiates=${t.recordTypeInstantiates} files=${t.files} in ${runs[key].wallSeconds}s load1=${runs[key].load1}`, new Date().toISOString())
}
parser.delete?.()

console.log(`wrote ${path.relative(ROOT, OUT)}`)
