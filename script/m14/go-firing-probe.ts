/**
 * GO FIRING PROBE — does each relationship PUSH SITE add a row on a real corpus?
 *
 * ## Why this exists
 *
 * `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1 question 2 is "**Fires** — it
 * produces edges on a real corpus. A branch that never matches is dead code and
 * derivation cannot see it." Source derivation answers question 1 only, so a
 * push site whose predicate can never be true is invisible to every gate that
 * reads the analyzer's own text.
 *
 * This lane's `calls` type has FOUR push sites and they are not
 * metadata-distinguishable in two pairs:
 *
 *   line 2573  metadata {relationshipType, callExpression, isPackageQualified}  0.8
 *   line 2727  metadata {relationshipType, callExpression, isPackageQualified}  0.8
 *   line 2904  metadata {relationshipType, isAsynchronous, pattern}             0.9
 *   line 2991  metadata {relationshipType, isDeferred, pattern}                 0.9
 *
 * `script/m14/go-ontology-census.ts` reports one metadata key-set per type, so
 * it can see that the 0.9 pair contributes nothing — but a key-set histogram
 * cannot say WHY, and "the branch is dead" and "the branch is deduped" are
 * different findings with different fixes. This probe separates them:
 *
 *   SITE      the 0.9 metadata discriminators, counted on production output.
 *   CONSTRUCT `go_statement` / `defer_statement` nodes on the raw tree that have
 *             a `call_expression` child — the population the branch is written
 *             for, counted WITHOUT the analyzer so it cannot be circular.
 *   UNCOVERED spawn sites whose (containing function, callee leaf) has NO
 *             `calls` edge at ANY confidence. This is the coverage question and
 *             it is the one that matters: if it is 0 the dedupe lost nothing
 *             and the dead branch is cosmetic; if it is non-zero, real call
 *             edges are missing from the graph.
 *
 * Both sides use the SAME endpoint convention (leaf after the final `.`,
 * containing `function_declaration` / `method_declaration` / `func_literal`
 * ancestor name, `global` at file scope) so a disagreement is a disagreement
 * and not a spelling difference.
 *
 * ## WHAT A NON-ZERO UNCOVERED COUNT DOES AND DOES NOT PROVE
 *
 * It proves the analyzer published no `calls` edge for that site. It does NOT
 * prove the call is unreachable: the target may be a builtin (filtered on
 * purpose), a local func variable (not a static call), or a dot-imported name.
 * Those rows are counted separately and named, not merged into the finding.
 *
 * USAGE
 *   npx tsx script/m14/go-firing-probe.ts --out firing.json [--repo a,b] [--shard=i/n]
 *   npx tsx script/m14/go-firing-probe.ts --merge a.json b.json --out firing.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const REPOS = (argOf("--repo", "go-stdlib,cobra") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024
const SAMPLE = 12
/** Same reason as the census's SKIP: `parseFile` arms a 120 s self-destruct
 *  around the parse, so one pathological file ends the shard silently. */
const SKIP = new Set((process.env.BB_GO_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean))

type Shard = {
  schema: "go-firing-probe/1"
  repos: string[]
  revisions: Record<string, string>
  corpusAdmitted: number
  drawn: number
  parsedThroughProductionEntry: number
  parseFailures: number
  /** Edge counts per PUSH SITE, keyed by the metadata discriminator that
   *  identifies the site. `other` is a row the discriminators do not explain,
   *  which is itself a finding rather than a rounding bucket. */
  sites: Record<string, number>
  /** Raw-tree construct counts. No analyzer involved. */
  construct: Record<string, number>
  /** Spawn sites (go/defer) with no `calls` edge at any confidence. */
  uncovered: { total: number; byKind: Record<string, number>; samples: string[] }
  /** Rows whose metadata key-set no discriminator names. Kept, not summed. */
  otherSamples: string[]
  wallMs: number
}

const leafOf = (raw: string): string => {
  const d = raw.lastIndexOf(".")
  return d === -1 ? raw : raw.slice(d + 1)
}
/** The metadata discriminators, one per push site, read off the push sites in
 *  `src/ast/real-go-analyzer.ts`. Kept as data so a new site that adds a
 *  discriminator shows up as `other` instead of silently joining a bucket. */
/** Push-site identity, read off the metadata each site writes.
 *
 *  TWO THINGS THIS HAD TO GET RIGHT, both found by running it rather than by
 *  reading it — which is the argument for having the probe:
 *
 *  1. DISPATCH ON THE LABEL FIRST. `isPackageQualified` is a BOOLEAN that is
 *     `false` for an unqualified call, not `undefined`, so a classifier that
 *     tests `md.callExpression && md.isPackageQualified` falls through on
 *     exactly the rows it meant to catch: measured on cobra, 359 of 2,413
 *     `calls` edges (`AppendActiveHelp -> Sprintf`, no dot) landed in the
 *     `instantiates` bucket and the two buckets stopped summing to the census's
 *     per-type edge counts. A false predicate in the INSTRUMENT is
 *     indistinguishable from a finding until the two are reconciled, so the
 *     classifier now keys on the relationship type and only then on the
 *     discriminator.
 *  2. `contains` is published with `metadata: {}` and the lane's own
 *     `evidenceClass` pass then writes the tier into it, so a one-key key-set
 *     identifies that site and nothing else. `imports` likewise carries no
 *     `relationshipType`, so `isGoImportDep` is its discriminator.
 *
 *  A row no discriminator names is kept in `otherSamples` with its key-set
 *  rather than summed into an opaque bucket. */
const siteOf = (label: string, md: any): string => {
  const m: any = md && typeof md === "object" ? md : {}
  const rt = String(m.relationshipType ?? "")
  const keys = Object.keys(m)
  switch (label) {
    case "calls":
      if (m.isAsynchronous) return "calls:go_goroutine"
      if (m.isDeferred) return "calls:go_defer"
      return `calls:${rt || "?"}`
    case "instantiates":
      if (m.isConstructor) return `instantiates:${rt || "composite_literal"}`
      return `instantiates:${rt || "?"}`
    case "uses":
      if (m.selectorExpression) return "uses:selector"
      if (m.operationType) return "uses:channel"
      if (m.nodeType) return "uses:identifier"
      return `uses:${rt || "?"}`
    case "references":
      return `references:${rt || "?"}:${m.qualifiedType ? "qualified" : "bare"}`
    case "contains":
      return keys.length === 1 && m.evidenceClass ? "contains:owner_name_pass" : `contains:${rt || "?"}`
    case "exports":
      return `exports:${m.exportForm || rt || "?"}`
    case "extends":
      if (m.embeddedInterface) return "extends:interface_embedding"
      if (m.embeddedStruct) return "extends:struct_embedding"
      return `extends:${rt || "?"}`
    case "implements":
      return `implements:${m.receiverSet || "?"}`
    case "overrides":
      return `overrides:${rt || "?"}`
    case "imports":
      return m.isGoImportDep ? "imports:import_spec" : `imports:${rt || "?"}`
    default:
      if (keys.length === 0) return `${label}:no-metadata`
      return "other"
  }
}

const bump = (m: Record<string, number>, k: string, by = 1): void => { m[k] = (m[k] ?? 0) + by }

if (process.argv.includes("--merge")) {
  const acc: Shard = {
    schema: "go-firing-probe/1", repos: [], revisions: {}, corpusAdmitted: 0, drawn: 0,
    parsedThroughProductionEntry: 0, parseFailures: 0, sites: {}, construct: {},
    uncovered: { total: 0, byKind: {}, samples: [] }, otherSamples: [], wallMs: 0,
  }
  const parts = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== OUT && a.endsWith(".json"))
  for (const p of parts) {
    const s = JSON.parse(readFileSync(p, "utf8")) as Shard
    for (const r of s.repos) if (!acc.repos.includes(r)) acc.repos.push(r)
    Object.assign(acc.revisions, s.revisions)
    acc.corpusAdmitted = Math.max(acc.corpusAdmitted, s.corpusAdmitted)
    acc.drawn += s.drawn
    acc.parsedThroughProductionEntry += s.parsedThroughProductionEntry
    acc.parseFailures += s.parseFailures
    acc.wallMs += s.wallMs
    for (const [k, v] of Object.entries(s.sites)) bump(acc.sites, k, v)
    for (const [k, v] of Object.entries(s.construct)) bump(acc.construct, k, v)
    acc.uncovered.total += s.uncovered.total
    for (const [k, v] of Object.entries(s.uncovered.byKind)) bump(acc.uncovered.byKind, k, v)
    for (const x of s.uncovered.samples) if (acc.uncovered.samples.length < SAMPLE * 4) acc.uncovered.samples.push(x)
    for (const x of s.otherSamples ?? []) if (acc.otherSamples.length < SAMPLE * 4) acc.otherSamples.push(x)
  }
  if (OUT) { writeFileSync(OUT, JSON.stringify(acc, null, 2)); console.log(`merged ${parts.length} shards -> ${OUT}`) }
  report(acc)
  process.exit(0)
}

const files: Array<{ repo: string; dir: string; rel: string; abs: string }> = []
const revisions: Record<string, string> = {}
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  try { statSync(dir) } catch { continue }
  try { revisions[repo] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.go"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (SKIP.has(`${repo}/${rel}`)) continue
    files.push({ repo, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : a.repo + "/" + b.rel > b.repo + "/" + b.rel ? 1 : 0))
let draw = files
const shardArg = process.argv.find((a) => a.startsWith("--shard="))
if (shardArg) {
  const [i, n] = shardArg.slice("--shard=".length).split("/").map(Number)
  draw = files.filter((_, k) => k % n === i)
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-go.wasm"))))

const out: Shard = {
  schema: "go-firing-probe/1", repos: REPOS, revisions, corpusAdmitted: files.length, drawn: draw.length,
  parsedThroughProductionEntry: 0, parseFailures: 0, sites: {}, construct: {},
  uncovered: { total: 0, byKind: {}, samples: [] }, otherSamples: [], wallMs: 0,
}

/** The callee of a `go_statement` / `defer_statement`, read from the raw tree:
 *  `*_statement` -> `call_expression` -> `function`/`selector_expression`. The
 *  callee TEXT is the whole expression; the analyzer publishes the resolved
 *  target, so the comparison applies the same leaf rule to both sides. */
function spawnCallee(n: any): string {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c || c.type !== "call_expression") continue
    // The `function` FIELD, not the call's text: `outFile.Close()` has text
    // `outFile.Close()` and a leaf rule that splits on `.` would publish
    // `Close()` — the argument list included — which is an endpoint no symbol
    // binds to. Measured: before this fix every one of cobra's 49 spawn sites
    // read as uncovered, which is a defect in the PROBE and not in the lane.
    const fn = c.childForFieldName?.("function") ?? (c.namedChildCount > 0 ? c.namedChild(0) : undefined)
    return fn ? String(fn.text ?? "") : ""
  }
  return ""
}
/** The enclosing declaration's name, or `global` at file scope — the same
 *  spelling the analyzer's `resolveGoWorkSource` fallback publishes. */
function enclosingFn(n: any): string {
  let cur = n.parent
  while (cur) {
    if (cur.type === "function_declaration" || cur.type === "method_declaration") {
      return String(cur.childForFieldName?.("name")?.text ?? "global")
    }
    cur = cur.parent
  }
  return "global"
}

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const fileLabel = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { out.parseFailures++; continue }
    out.parsedThroughProductionEntry++

    for (const x of r?.relationships ?? []) {
      const s = siteOf(String(x.type ?? x.relationshipType ?? "?"), x.metadata)
      bump(out.sites, s)
      // A row the discriminators cannot name is a finding, not a rounding
      // bucket, so it is kept with its key-set and its type rather than
      // summed into an opaque `other`.
      if (s === "other" && out.otherSamples.length < SAMPLE * 4) {
        out.otherSamples.push(`${String(x.type ?? x.relationshipType)} ${fileLabel} "${x.source}" -> "${x.target}" md=${JSON.stringify(x.metadata)}`)
      }
    }

    const tree = parser.parse(readFileSync(f.abs, "utf8"))
    if (!tree) { tree?.delete?.(); continue }
    // The analyzer's own `calls` edge set for this file, as (source|target) keys.
    const callKeys = new Set<string>()
    for (const x of r?.relationships ?? []) {
      const l = String(x.type ?? x.relationshipType ?? "")
      if (l === "calls" || l === "brain_call" || l === "Calls") callKeys.add(`${x.source}|${x.target}`)
    }
    const walk = (n: any): void => {
      if (n.type === "go_statement" || n.type === "defer_statement") {
        const kind = n.type === "go_statement" ? "go" : "defer"
        bump(out.construct, `${kind}_statement`, 1)
        const callee = spawnCallee(n)
        if (callee) {
          bump(out.construct, `${kind}_statement_with_call`, 1)
          const src = enclosingFn(n)
          const leaf = leafOf(callee)
          if (!callKeys.has(`${src}|${leaf}`)) {
            out.uncovered.total++
            // Split by WHY there is no edge, because the two reasons have
            // opposite meanings: an immediately-invoked `func(){…}()` literal is
            // correctly not a static call target (`isGoResolvableCallTarget`
            // refuses it, and the analyzer's own comment says so), while a
            // NAMED callee with no edge is a lost row.
            const anon = callee.startsWith("func")
            bump(out.uncovered.byKind, anon ? `${kind}_func_literal` : `${kind}_named_callee`, 1)
            if (anon) bump(out.construct, `${kind}_func_literal_call`, 1)
            else bump(out.construct, `${kind}_named_callee_call`, 1)
            if (out.uncovered.samples.length < SAMPLE) {
              out.uncovered.samples.push(`${fileLabel} ${src} -${kind}-> ${leaf}  (${callee.replace(/\s+/g, " ").slice(0, 60)})`)
            }
          } else {
            bump(out.construct, `${kind}_named_callee_covered`, 1)
          }
        }
      }
      for (let k = 0; k < n.namedChildCount; k++) {
        const c = n.namedChild(k)
        if (c) walk(c)
      }
    }
    walk(tree.rootNode)
    tree.delete?.()
  }
}
const t0 = Date.now()
await Promise.all(Array.from({ length: Number(process.env.BB_GO_CENSUS_WORKERS ?? "4") }, () => worker()))
out.wallMs = Date.now() - t0

function report(a: Shard): void {
  console.log(`\ngo firing probe — ${a.parsedThroughProductionEntry} files through parseFile (${a.parseFailures} failures), ${a.wallMs} ms`)
  console.log(`corpus admitted ${a.corpusAdmitted}  drawn ${a.drawn}\n`)
  console.log("PUSH SITES, by the metadata discriminator that identifies the site:")
  const rows = Object.entries(a.sites).sort((x, y) => y[1] - x[1])
  const w = Math.max(0, ...rows.map((r) => r[0].length))
  for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}  ${String(v).padStart(9)}`)
  console.log(`\nCONSTRUCTS on the raw tree (no analyzer):`)
  for (const [k, v] of Object.entries(a.construct).sort()) console.log(`  ${k.padEnd(34)}  ${String(v).padStart(9)}`)
  console.log(`\nSPAWN SITES WITH NO calls EDGE AT ANY CONFIDENCE: ${a.uncovered.total}`)
  for (const [k, v] of Object.entries(a.uncovered.byKind).sort()) console.log(`  ${k.padEnd(34)}  ${String(v).padStart(9)}`)
  for (const s of a.uncovered.samples) console.log(`   ${s}`)
  if (a.otherSamples.length) {
    console.log(`\nROWS NO DISCRIMINATOR NAMES (${a.sites.other ?? 0} counted):`)
    for (const s of a.otherSamples) console.log(`   ${s}`)
  }
}
report(out)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
