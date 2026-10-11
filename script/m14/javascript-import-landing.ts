/**
 * JAVASCRIPT IMPORT LANDING — of the rows whose own import statement is DECISIVE, how many
 * actually land on the symbol that statement names?
 *
 * `javascript-import-decidability.ts` measures the POPULATION (how many rows an
 * import-reading resolver could decide). This measures the OUTCOME, and it is deliberately
 * not a read of the resolver's own return value: the expectation is recomputed here from
 * the SOURCE (declarations and import statements, read per file), then compared with the
 * target the store actually holds. A pass that reports 500 corrections and stores nothing
 * looks identical to a pass that corrects nothing; only this comparison distinguishes them.
 *
 * THE EXPECTATION RULE, one case per row, all of it decidable from the source:
 *
 *   own-file   the row's own file declares the leaf          -> NOT this instrument's case
 *   named      `import { x } from './m'` and m declares x      -> expect m's x
 *   alias      `import { x as y }`       row target y          -> expect m's x
 *   default    `import y from './m'`                            -> expect m's y
 *   namespace  `ns.leaf` with `import * as ns from './m'`       -> expect m's leaf
 *
 * A row outside those cases is NOT counted as a failure: "not decidable" and "decided
 * wrongly" are different facts and collapsing them would let a resolver look better by
 * deciding less. Every one is reported by reason.
 *
 *   bun run script/m14/javascript-import-landing.ts [--corpus=<dir>] [--files=N]
 *   exit 0 always; this is an instrument, the gate is verify-js-binding-resolution.ts
 */
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d
const CR = arg("corpus", "$HOME/fixtures/repositories/svelte/packages/svelte/src")!
const FILES = Number(arg("files", "0")) || Number.MAX_SAFE_INTEGER
const TYPES = ["calls", "uses", "references", "instantiates"]

const tracked: string[] = execFileSync("git", ["-C", CR, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 30 })
  .split("\0").filter(Boolean)
const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(CR, rel)
  try {
    if (statSync(abs).size > 512 * 1024) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch { continue }
  admitted.push(rel)
}
admitted.sort()
const sample = admitted.slice(0, FILES)
const sampleSet = new Set(sample)

const leafOf = (t: string): string => {
  const noLine = String(t).replace(/:\d+$/, "")
  const seg = noLine.split(":").filter((s) => s.length > 0)
  const last = seg[seg.length - 1] ?? ""
  return last.split(".").pop() ?? ""
}
const receiverOf = (t: string): string | null => {
  const noLine = String(t).replace(/:\d+$/, "")
  const seg = noLine.split(":").filter((s) => s.length > 0)
  const last = seg[seg.length - 1] ?? ""
  const parts = last.split(".")
  return parts.length > 1 ? parts.slice(0, -1).join(".") : null
}

type FileFacts = {
  rel: string
  declared: Set<string>
  defaults: Set<string>
  bindings: Map<string, { module: string; kind: string; declared: string }[]>
  /** The names this file PUBLISHES (its own `exports` edges) — a barrel publishes names
   *  it does not declare, which is exactly what the re-export route below is about. */
  published: Set<string>
  /** exported name -> the clause(s) that provide it: the module and the name it declares. */
  reexports: Map<string, { module: string; declared: string }[]>
  /**
   * The modules this file REDISTRIBUTES with a bare `export * from './m'`. A redistribution
   * writes no member name, so it cannot be filed by name — the statement is the evidence, and
   * the name carried forward is the same name at the next hop. `export * as ns from './m'` is
   * NOT one: it binds one name and redistributes nothing, which is why the analyzer publishes
   * `starForm` and this instrument reads it rather than assuming.
   */
  stars: string[]
}
const factsByRel = new Map<string, FileFacts>()
const declaredIn = new Map<string, Set<string>>()
let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= sample.length) return
    const rel = sample[i]
    let res: any
    try { res = await parseFile(path.join(CR, rel), CR) } catch { continue }
    const declared = new Set<string>()
    const defaults = new Set<string>()
    for (const s of res?.symbols ?? []) {
      const n = String(s?.name ?? "")
      if (n) declared.add(n)
    }
    const declaredFor = new Map<string, string>()
    const published = new Set<string>()
    const reexports = new Map<string, { module: string; declared: string }[]>()
    const stars: string[] = []
    for (const r of res?.relationships ?? []) {
      const t = String(r.type ?? "").toLowerCase()
      if (t === "exports") {
        const target = String(r.target ?? "")
        const name = leafOf(target)
        if (name) published.add(name)
        if (String(r.metadata?.declaredKind ?? "") === "default" || name === "default") defaults.add(leafOf(String(r.source ?? "")))
      }
      if (t !== "imports") continue
      const target = String(r.target ?? "")
      const module = target.slice(0, target.lastIndexOf(":"))
      const local = target.slice(target.lastIndexOf(":") + 1)
      const declaredName = String(r.metadata?.declaredName ?? "")
      // A RE-EXPORT clause: the edge spells the SOURCE module's member and `exportedAs`
      // (when present) the name this file publishes it under.
      if (r.metadata?.isReExport === true) {
        const exportedAs = String(r.metadata?.exportedAs ?? local)
        if (exportedAs && exportedAs !== "*") {
          const arr = reexports.get(exportedAs) ?? []
          arr.push({ module, declared: declaredName && declaredName !== "*" ? declaredName : local })
          reexports.set(exportedAs, arr)
        } else if (local === "*" && r.metadata?.starForm === "all") {
          // A bare star, and the field is REQUIRED — the same rule the resolver applies, for
          // the same reason: without it the two forms are indistinguishable, and an
          // indistinguishable record is the one a guess would be wrong about.
          stars.push(module)
        }
        continue
      }
      if (local && declaredName && declaredName !== "*" && declaredName !== local) declaredFor.set(local, declaredName)
    }
    const bindings = new Map<string, { module: string; kind: string; declared: string }[]>()
    for (const imp of res?.imports ?? []) {
      const module = String(imp?.path ?? imp?.module ?? "")
      const local = String(imp?.localName ?? imp?.name ?? "")
      if (!local || local === "*") continue
      const arr = bindings.get(local) ?? []
      arr.push({ module, kind: String(imp?.type ?? imp?.importType ?? ""), declared: declaredFor.get(local) ?? local })
      bindings.set(local, arr)
    }
    const facts: FileFacts = { rel, declared, defaults, bindings, published, reexports, stars }
    factsByRel.set(rel, facts)
    for (const n of declared) {
      const s = declaredIn.get(n) ?? new Set<string>()
      s.add(rel)
      declaredIn.set(n, s)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

/** Resolve a specifier from the importing file's own directory, requiring an exact file. */
const moduleFile = (fromRel: string, spec: string): string | null => {
  if (!spec.startsWith(".")) return null
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  for (const c of [p, `${p}.js`, `${p}.mjs`, `${p}.cjs`, `${p}/index.js`, `${p}.jsx`]) if (sampleSet.has(c)) return c
  return null
}

type Route = "named" | "alias" | "default" | "namespace" | "reexport" | "star"
type Verdict = "landed" | "wrong-file" | "detached" | "no-symbol"
const counts: Record<string, Record<Verdict, number>> = {}
const bump = (route: string, v: Verdict) => {
  const c = counts[route] ?? (counts[route] = { landed: 0, "wrong-file": 0, detached: 0, "no-symbol": 0 })
  c[v]++
}
const wrongExamples: string[] = []

/**
 * Follow a re-export chain from a file that PUBLISHES a name it does not declare.
 *
 * Deliberately a second implementation of the resolver's walk rather than a call into it:
 * the whole point of this instrument is to recompute the expectation independently, so if
 * the two disagree the failure shows up here instead of cancelling out. It mirrors the same
 * rules — a local declaration ends the chain, only ONE clause may resolve the name, cycles
 * are refused, depth is bounded.
 */
function chainHit(rel: string, name: string, depth = 0, visited = new Set<string>()): { rel: string; symbol: string } | null {
  const key = `${rel}\u0000${name}`
  if (visited.has(key) || depth > 8) return null
  visited.add(key)
  const facts = factsByRel.get(rel)
  if (!facts) return null
  if (facts.declared.has(name)) return { rel, symbol: name }
  const hits = new Map<string, { rel: string; symbol: string }>()

  for (const clause of facts.reexports.get(name) ?? []) {
    const mf = moduleFile(rel, clause.module)
    if (!mf) continue
    const hit = chainHit(mf, clause.declared, depth + 1, visited)
    if (hit) hits.set(`${hit.rel}\u0000${hit.symbol}`, hit)
  }
  return hits.size === 1 ? [...hits.values()][0] : null
}

/**
 * The STAR route — `export * from './m'` publishes names the barrel never writes, so no clause
 * can be filed for them and the expectation cannot be read off one.
 *
 * Independent of the resolver for the same reason every other rule here is: if the two
 * disagree, the failure has to show up in the table instead of cancelling out. The rules it
 * mirrors are the language's — `default` is never redistributed, two sources that both declare
 * the name are ambiguous and refused, and the union is keyed by (file, symbol) so two sources
 * naming the SAME declaration still agree.
 */
function starHit(rel: string, name: string, depth = 0, visited = new Set<string>()): { rel: string; symbol: string } | null {
  if (name === "default") return null
  // A distinct key from `chainHit`'s on purpose: a clause hop and a star hop at the same
  // (file, name) are different questions, and sharing the key let the clause walk block the
  // star walk that follows it — the same defect the resolver's A28 caught.
  const key = `${rel}\u0000${name}\u0000star`
  if (visited.has(key) || depth > 8) return null
  visited.add(key)
  const facts = factsByRel.get(rel)
  if (!facts) return null
  if (facts.declared.has(name)) return { rel, symbol: name }
  const hits = new Map<string, { rel: string; symbol: string }>()
  for (const module of facts.stars) {
    const mf = moduleFile(rel, module)
    if (!mf) continue
    // The next hop answers by its own declaration or clause, else by a star of its own — a
    // NAMED clause shadows a redistribution for the same name, which the order encodes.
    const hit = chainHit(mf, name, depth + 1, visited) ?? starHit(mf, name, depth + 1, visited)
    if (hit) hits.set(`${hit.rel}\u0000${hit.symbol}`, hit)
  }
  return hits.size === 1 ? [...hits.values()][0] : null
}

/** The expectation for a row, or null when the import statement is not decisive. */
function expectation(
  facts: FileFacts,
  leaf: string,
  callee: string | null,
  params: string[],
): { route: Route; file: string; symbol: string } | null {
  if (facts.declared.has(leaf)) return null // own-file: not this instrument's business
  // A PARAMETER of the row's own source symbol binds the name: the import statement is not
  // decisive for it at all, so it must not sit in the denominator. Leaving these in is what
  // made seven rows read as `wrong-file` when the store's state was in fact the thing this
  // instrument should have asked the resolver to CLEAR (`capture(source, …)` and
  // `toStore(get, set)` in the corpus, both measured).
  if (params.includes(leaf)) return null
  const receiver = receiverOf(callee ?? "")
  if (receiver) {
    for (const b of facts.bindings.get(receiver) ?? []) {
      if (b.kind !== "namespace") continue
      const mf = moduleFile(facts.rel, b.module)
      if (mf && declaredIn.get(leaf)?.has(mf)) return { route: "namespace", file: mf, symbol: leaf }
      if (mf && factsByRel.get(mf)?.published.has(leaf)) {
        const hit = chainHit(mf, leaf)
        if (hit) return { route: "reexport", file: hit.rel, symbol: hit.symbol }
      }
      // …or the barrel writes no name at all, and redistributes the whole module.
      if (mf && (factsByRel.get(mf)?.stars.length ?? 0) > 0 && !factsByRel.get(mf)?.reexports.has(leaf)) {
        const hit = starHit(mf, leaf)
        if (hit) return { route: "star", file: hit.rel, symbol: hit.symbol }
      }
    }
  }
  for (const b of facts.bindings.get(leaf) ?? []) {
    const mf = moduleFile(facts.rel, b.module)
    if (!mf) continue
    // ALIAS FIRST, and the order is load-bearing. The local name of an aliased binding can
    // coincide with a DIFFERENT declaration in the target module: `internal/client/proxy.js`
    // writes `import { state as source } from './reactivity/sources.js'` — a module that
    // also exports a function named `source`. Checking the plain-name branch first made this
    // instrument expect `sources.js:source` for a call that the import statement binds to
    // `sources.js:state`, so it reported the STORE as wrong on ten rows where the store was
    // right and the instrument's expectation was the wrong one. The declared name is the
    // authority whenever it differs from the local one.
    if (b.declared !== leaf && declaredIn.get(b.declared)?.has(mf)) return { route: "alias", file: mf, symbol: b.declared }
    if (declaredIn.get(leaf)?.has(mf)) return { route: b.kind === "default" ? "default" : "named", file: mf, symbol: leaf }
    if (b.kind === "default" && factsByRel.get(mf)?.defaults.has(leaf)) return { route: "default", file: mf, symbol: leaf }
    // THE BARREL: the module publishes the name without declaring it, and its clause names
    // the module that does. The expectation is the DECLARER, which is the whole point of the
    // route — before it, every consumer of a barrel was simply "not decidable".
    const wanted = b.declared && b.declared !== "*" ? b.declared : leaf
    if (!declaredIn.get(wanted)?.has(mf) && factsByRel.get(mf)?.published.has(wanted)) {
      const hit = chainHit(mf, wanted)
      if (hit) return { route: "reexport", file: hit.rel, symbol: hit.symbol }
    }
    if (!declaredIn.get(wanted)?.has(mf) && (factsByRel.get(mf)?.stars.length ?? 0) > 0 && !factsByRel.get(mf)?.reexports.has(wanted)) {
      const hit = starHit(mf, wanted)
      if (hit) return { route: "star", file: hit.rel, symbol: hit.symbol }
    }
  }
  return null
}

// ── THE STORE ────────────────────────────────────────────────────────────────────────────
const workdir = (await import("node:fs")).mkdtempSync(path.join((await import("node:os")).tmpdir(), "bb-js-landing-"))
const projDir = path.join(workdir, "proj")
for (const rel of sample) {
  const dest = path.join(projDir, rel)
  ;(await import("node:fs")).mkdirSync(path.dirname(dest), { recursive: true })
  ;(await import("node:fs")).writeFileSync(dest, readFileSync(path.join(CR, rel)))
}
const dataDir = path.join(workdir, "data")
;(await import("node:fs")).mkdirSync(dataDir, { recursive: true })
process.env.BB_DATA_DIR = dataDir

const { getProjectId } = await import(path.join(process.cwd(), "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(process.cwd(), "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(process.cwd(), "src/brain/database.ts"))
const pid = (getProjectId as any)(projDir)
await indexProjectParallel(pid, projDir, { onProgress: () => {} } as any)

const raw: any = await BrainDatabase.getRawInstance(pid)
const rows = raw.prepare(
  `SELECT r.relationship_type AS t, r.target_external AS tgt, r.metadata AS md,
          sf.relative_path AS sfile, ts.name AS tname, tf.relative_path AS tfile,
          ss.parameters AS sparams
     FROM brain_relationship r
     LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
     LEFT JOIN brain_file sf ON sf.id = ss.file_id
     LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.project_id = ?
      AND r.target_external IS NOT NULL
      AND instr(r.target_external, ':') = 0
      AND instr(r.target_external, '.') = 0`,
).all(pid) as any[]

let undecidable = 0
let ownFile = 0
let shadowed = 0
for (const r of rows) {
  const t = String(r.t)
  if (!TYPES.includes(t)) continue
  const facts = factsByRel.get(String(r.sfile ?? ""))
  if (!facts) { undecidable++; continue }
  const leaf = String(r.tgt)
  if (facts.declared.has(leaf)) { ownFile++; continue }
  let callee: string | null = null
  try { callee = String(JSON.parse(String(r.md ?? "{}"))?.calleeExpression ?? "") || null } catch { callee = null }
  // The row's own source-symbol SIGNATURE (the shadow rule), carried on the row query so
  // the expectation can be withheld for a name the row's own scope binds.
  let params: string[] = []
  try {
    const parsed = JSON.parse(String(r.sparams ?? "[]"))
    if (Array.isArray(parsed)) params = parsed.map((p: any) => String(typeof p === "string" ? p : p?.name ?? ""))
  } catch { params = [] }
  if (params.includes(leaf)) { shadowed++; continue }
  const exp = expectation(facts, leaf, callee, params)
  if (!exp) { undecidable++; continue }
  const verdict: Verdict =
    !r.tname ? "detached"
      : (String(r.tfile) === exp.file && String(r.tname) === exp.symbol) ? "landed"
        : (String(r.tname) === exp.symbol ? "wrong-file" : "no-symbol")
  bump(exp.route, verdict)
  if (verdict !== "landed" && wrongExamples.length < 12) {
    wrongExamples.push(`${t} ${facts.rel} -> ${leaf} : expected ${exp.file}:${exp.symbol}, got ${r.tfile ?? "(detached)"}:${r.tname ?? "-"}`)
  }
}

// ── THE BARREL'S OWN EDGES ──────────────────────────────────────────────────────────────
//
// A re-export is not only a route consumers travel: the `exports` EDGE that publishes the
// name is a stored fact, and the name pass resolves it by name like any other row. Measured
// on the closed population BEFORE the chain existed: `internal/client/index.js` publishes
// `pop` (clause: `./context.js`) and its edge pointed at `compiler/phases/1-parse/index.js`.
const exportEdges = raw.prepare(
  `SELECT r.source_external AS src, r.target_external AS tgt, ts.name AS tname, tf.relative_path AS tfile
     FROM brain_relationship r
     LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.project_id = ? AND r.relationship_type = 'exports' AND r.source_external IS NOT NULL`,
).all(pid) as any[]
const edgeCounts: Record<string, number> = { local: 0, landed: 0, "wrong-file": 0, unresolved: 0, undecidable: 0 }
const edgeWrongExamples: string[] = []
for (const e of exportEdges) {
  const src = String(e.src ?? "")
  const name = leafOf(String(e.tgt ?? ""))
  const facts = factsByRel.get(src)
  if (!facts || !name) { edgeCounts.undecidable++; continue }
  if (facts.declared.has(name)) { edgeCounts.local++; continue } // a local export: not this table
  const hit = chainHit(src, name)
  if (!hit) { edgeCounts.undecidable++; continue }
  const ok = String(e.tfile ?? "") === hit.rel && String(e.tname ?? "") === hit.symbol
  if (ok) edgeCounts.landed++
  else if (!e.tname) edgeCounts.unresolved++
  else edgeCounts["wrong-file"]++
  if (!ok && edgeWrongExamples.length < 8) {
    edgeWrongExamples.push(`${src} -> ${name} : clause says ${hit.rel}:${hit.symbol}, edge holds ${e.tfile ?? "(detached)"}:${e.tname ?? "-"}`)
  }
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`javascript import landing — ${CR}`)
console.log(`project: ${projDir}`)
console.log(`admitted ${admitted.length}   sample ${sample.length}   store rows (bare, 4 labels) ${rows.length}\n`)
console.log(`${pad("route", 12)}${pad("decidable", 11)}${pad("landed", 8)}${pad("wrong-file", 12)}${pad("detached", 10)}${pad("no-symbol", 11)}${pad("% landed", 10)}`)
let T = { landed: 0, "wrong-file": 0, detached: 0, "no-symbol": 0 }
for (const route of ["named", "alias", "default", "namespace", "reexport", "star"]) {
  const c = counts[route] ?? { landed: 0, "wrong-file": 0, detached: 0, "no-symbol": 0 }
  const total = c.landed + c["wrong-file"] + c.detached + c["no-symbol"]
  for (const k of Object.keys(T) as (keyof typeof T)[]) T[k] += c[k]
  console.log(`${pad(route, 12)}${pad(String(total), 11)}${pad(String(c.landed), 8)}${pad(String(c["wrong-file"]), 12)}${pad(String(c.detached), 10)}${pad(String(c["no-symbol"]), 11)}${pad(total ? `${((100 * c.landed) / total).toFixed(1)}%` : "-", 10)}`)
}
const tot = T.landed + T["wrong-file"] + T.detached + T["no-symbol"]
console.log(`${pad("ALL", 12)}${pad(String(tot), 11)}${pad(String(T.landed), 8)}${pad(String(T["wrong-file"]), 12)}${pad(String(T.detached), 10)}${pad(String(T["no-symbol"]), 11)}${pad(tot ? `${((100 * T.landed) / tot).toFixed(1)}%` : "-", 10)}`)
const reexportEdges = edgeCounts.landed + edgeCounts["wrong-file"] + edgeCounts.unresolved
console.log(`\nRE-EXPORT EDGES — names a file publishes without declaring (clause-decidable): ${reexportEdges}`)
console.log(`  landed on the declarer the clause names : ${edgeCounts.landed}`)
console.log(`  pointing at a WRONG file             : ${edgeCounts["wrong-file"]}`)
console.log(`  detached                             : ${edgeCounts.unresolved}`)
console.log(`  local exports (not this table)        : ${edgeCounts.local}`)
console.log(`  no clause evidence in the sample      : ${edgeCounts.undecidable}`)
if (edgeWrongExamples.length) {
  console.log(`  not landed (first ${edgeWrongExamples.length}):`)
  for (const e of edgeWrongExamples) console.log(`    ${e}`)
}
console.log(`\nnot decidable by the import statement: ${undecidable}`)
console.log(`shadowed by the row's own signature (not decidable, and NOT the import): ${shadowed}`)
console.log(`own-file declared (the store lands these by rule): ${ownFile}`)
if (wrongExamples.length) {
  console.log(`\nnot landed (first ${wrongExamples.length}):`)
  for (const e of wrongExamples) console.log(`  ${e}`)
}
