// validation/m14/fixtures/erlang/erl-residual-classify.ts
//
// THE ERLANG RESIDUAL, BUCKETED BY NAMED CAUSE — and the COUNTERFACTUAL that decides whether the
// top cause is doable.
//
// WHY IT EXISTS. `incoming-gate.ts erlang erl,hrl 400` prints the totals and a 25-NAME worklist
// per type; a 25-name cap on a 21,539-edge `calls` residual cannot say WHICH CONSTRUCT carries the
// mass, and the classification clause asks for exactly that. This probe re-walks the SAME
// population with the SAME resolution rule (`classifyEdge` is IMPORTED from
// `script/m14/incoming-rule.ts`, never re-implemented) and buckets every unresolved edge by
// (type · metadata context · target shape · what the qualifier can reach).
//
// TWO PASSES, because the gate's key space is COMPLETE when it classifies: every file is parsed
// and every symbol counted FIRST, then the edges are classified against the finished table. A
// one-pass probe classified a file's edges while later files were still unread, so a name declared
// in an unvisited file read unique — it reported 44,426 resolved / 15,686 ambiguous where the gate
// reported 42,057 / 19,202. The `pending` structure below is that defect's fix; the CROSS-CHECK
// line at the top of the output is what catches a recurrence.
//
// AND IT ANSWERS THE DOABILITY QUESTION, which no count of the residual can: for a target spelled
// `<module>:<function>`, is there a DECLARATION in the run that the qualifier picks out? The
// analyzer publishes `ownerName` (the module) and `name` on every function symbol, so the answer
// is computable TODAY, over the same key space, without editing the analyzer:
//
//     alias(key) = `${ownerName}:${name}`     -- what a published qualifiedName would index
//
// Three outcomes for a colon-shaped target, and they are different findings:
//   WOULD-RESOLVE   exactly ONE declaration would answer the aliased key -> the edge becomes
//                   answerable by an exact qualified-name match (production's strategy 1)
//   WOULD-COLLIDE   TWO OR MORE would answer it (a module's same-named functions at different
//                   arities) -> the target becomes AMBIGUOUS, not resolved. Its own column
//                   because it is NOT a gain.
//   STILL-DARK      no declaration answers even with the alias, split into "the module IS
//                   represented in the run but this function is not declared in it" and "no
//                   declaration in the run is owned by that module at all".
//
// THE INVARIANT IT CHECKS SO THE COUNTERFACTUAL CANNOT BE A LAUNDERING: an alias is a NEW KEY in
// the name table, so it can only give an answer to an edge whose target EQUALS the alias spelling.
// If a currently-RESOLVED edge carries a colon-shaped target, adding aliases could move IT — so
// that count is printed and must be 0 for the projection to be sound.
//
//   bun run validation/m14/fixtures/erlang/erl-residual-classify.ts --max 400
//   bun run validation/m14/fixtures/erlang/erl-residual-classify.ts --repo rebar3 --max 0
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import {
  classifyEdge, externalClaimOf, isContainsEdge,
} from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const LANE = "erlang"
const EXTS = ["erl", "hrl"]

const argv = process.argv.slice(2)
const num = (flag: string, dflt: number): number => {
  const i = argv.indexOf(flag)
  return i >= 0 ? Number(argv[i + 1]) : dflt
}
const MAX = num("--max", 400)
const REPO_ARG = argv.find((a) => a.startsWith("--repo="))
const ONLY_REPOS = REPO_ARG ? new Set(REPO_ARG.slice(7).split(",").map((s) => s.trim())) : undefined
const SHOW = num("--show", 22)
/** `--hand N` — print N edges that RESOLVE through a `mod:thing` key, with the declaration each
 *  binds to, so the binding can be hand-read in the source. See §7 of ERLANG-FIX.md. */
const HAND = num("--hand", 0)
const HAND_SKIP = num("--skip", 0)

function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

function discover(): { files: string[]; total: number; repos: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], total: 0, repos: 0, overCap } }
  for (const name of entries.sort()) {
    if (ONLY_REPOS && !ONLY_REPOS.has(name)) continue
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admitByExtension(rel, EXTS, LANE)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  let files = found
  if (MAX > 0 && found.length > MAX) {
    const stride = Math.max(1, Math.floor(found.length / MAX))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total: found.length, repos: repos.size, overCap }
}

const repoOf = (f: string): string => path.join(CR, f.startsWith(CR) ? f.slice(CR.length + 1).split(path.sep)[0] : f)

type Pos = { file: string; line: number }
/**
 * THE POOLED POSITION TABLE, and it is POOLED ON PURPOSE — this is the gate's own scope and the
 * probe's first cut got it wrong. `incoming-gate.ts:888` declares `declPos` ONCE for the whole run,
 * outside the per-project loop, and `:1157` classifies intent against it. So the intent test asks
 * "does ANY FILE IN THIS RUN declare the target?", not "does this project?". With a per-project
 * table this probe read `arbitraryTwin 5,484 / nothingAnywhere 33,164` where the gate reads
 * `5,657 / 32,991` — 173 edges whose only declaration sits in ANOTHER repository, which the pooled
 * table sees and a per-project one cannot. Both tables are kept: RESOLUTION is per project (the
 * verdict's scope), INTENT is pooled (the gate's).
 */
const pooledDeclPos = new Map<string, Pos[]>()
type Proj = {
  decls: Map<string, number>
  kinds: Map<string, Set<string>>
  declPos: Map<string, Pos[]>
  /** alias `owner:name` -> declarations that WOULD answer it (function/method symbols) */
  aliasFn: Map<string, number>
  /** the first (file:line) an alias would bind to — the hand-read list */
  aliasAt: Map<string, string>
  /** modules the run actually publishes a declaration for (ownerName of any symbol) */
  owned: Set<string>
  names: Set<string>
}
const projects = new Map<string, Proj>()
function proj(repo: string): Proj {
  let p = projects.get(repo)
  if (!p) projects.set(repo, (p = {
    decls: new Map(), kinds: new Map(), declPos: new Map(),
    aliasFn: new Map(), aliasAt: new Map(), owned: new Set(), names: new Set(),
  }))
  return p
}
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

type Shape = "module:function" | "path" | "dotted" | "bare" | "empty"
function shapeOf(t: string): Shape {
  if (!t) return "empty"
  if (t.includes("/") || /\.(hrl|erl|beam)$/i.test(t)) return "path"
  if (/^[A-Za-z_@][A-Za-z0-9_@]*:[A-Za-z_@][A-Za-z0-9_@]*$/.test(t)) return "module:function"
  if (t.includes(":")) return "dotted"
  if (t.includes(".")) return "dotted"
  return "bare"
}
function ctxOf(md: any): string {
  const bits: string[] = []
  if (md?.context) bits.push(String(md.context))
  for (const k of ["isInclude", "isLibInclude", "isModuleImport", "importedFunctions", "isRecordType", "isRecordExpr",
    "isRecordField", "exportForm", "isTypeExport", "behaviour", "macroModule", "callArity", "arity",
    "isMacroUse", "isMacroDefinition", "isExternal"]) {
    if (md?.[k] !== undefined && md?.[k] !== false) bits.push(md[k] === true ? k : `${k}=${md[k]}`)
  }
  return bits.length ? bits.join("+") : "(no context)"
}

type Intent = { intended: number; sameFileUnproven: number; arbitraryTwin: number; nothingAnywhere: number }
const emptyIntent = (): Intent => ({ intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 })
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
function intentOf(tgt: string, srcFile: string, line: number | null, label: string): keyof Intent {
  const decls = pooledDeclPos.get(tgt)
  if (!decls || decls.length === 0) return "nothingAnywhere"
  const same = decls.filter((d) => d.file === srcFile)
  if (same.length === 0) return "arbitraryTwin"
  if (LINE_IS_TARGET_LINE.has(label) && line !== null && same.some((d) => d.line === line)) return "intended"
  return "sameFileUnproven"
}
/** the gate's own position push (`countKey`, :977-981), into a given table */
function remember(at: Map<string, Pos[]>, key: string, file: string, line: number | null): void {
  const pos = { file, line: line ?? -1 }
  const cur = at.get(key)
  if (!cur) at.set(key, [pos])
  else if (!cur.some((d) => d.file === file && d.line === pos.line)) cur.push(pos)
}

type Bucket = {
  name: string; count: number; examples: string[]
  wouldResolve: number; wouldCollide: number; stillDark: number
  intent: Intent
}
const buckets = new Map<string, Bucket>()
const bucket = (name: string): Bucket => {
  let b = buckets.get(name)
  if (!b) buckets.set(name, (b = {
    name, count: 0, examples: [], wouldResolve: 0, wouldCollide: 0, stillDark: 0, intent: emptyIntent(),
  }))
  return b
}

const totals = {
  edges: 0, resolved: 0, collRes: 0, amb: 0, unresolved: 0,
  cause: 0, extOK: 0, extQ: 0, extFAIL: 0, bindOK: 0, bindQ: 0, bindFAIL: 0,
}
const intentTotal = emptyIntent()
const intentByType = new Map<string, Intent>()
const rows = new Map<string, { edges: number; resolved: number; collRes: number; amb: number; unresolved: number }>()
const row = (t: string) => {
  let r = rows.get(t)
  if (!r) rows.set(t, (r = { edges: 0, resolved: 0, collRes: 0, amb: 0, unresolved: 0 }))
  return r
}
const resolvedColon: { target: string; file: string; line: number | null }[] = []
type HandRow = { target: string; type: string; edgeLine: number | null; src: string; decls: string[]; ctx: string }
const handList: HandRow[] = []
let symbolNamesWithColon = 0
let aliasedKeys = 0

/** an edge held until the whole key space is built — the gate's own `pending` */
type Pending = {
  type: string; target: string; file: string; line: number | null; md: any; claim: any
}

async function main(): Promise<void> {
  const disc = discover()
  console.error(`population: ${disc.files.length} sampled of ${disc.total} admitted (${disc.repos} repos, ${disc.overCap} over cap)`)
  const pending: Pending[] = []
  let parsed = 0, failed = 0
  const t0 = Date.now()
  // ── PASS 1: parse, build the complete per-project key space, defer every edge ──
  for (let i = 0; i < disc.files.length; i++) {
    const f = disc.files[i]
    if (i % 100 === 0) console.error(`  parse ${i}/${disc.files.length} ${Math.round((Date.now() - t0) / 1000)}s`)
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
    if (!r) { failed++; continue }
    parsed++
    const p = proj(repoOf(f))
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      if (name.includes(":")) symbolNamesWithColon++
      bump(p.decls, name)
      const ks = p.kinds.get(name) ?? new Set<string>()
      ks.add(String(s?.kind ?? ""))
      p.kinds.set(name, ks)
      // THE GATE'S OWN LINE CHAIN (`:1002`), read in full. A shorter chain (`range.startLine ??
      // s.line`) matched nothing on this lane's parseFile result, so every position carried
      // line -1 and the exact `intended` test could never fire — the probe read 0 intended where
      // the gate reads 16,721, which is how the omission was found.
      const line = Number(
        s?.range?.startLine ?? s?.range?.start_line ?? s?.line_start ?? s?.lineStart ?? s?.startLine ?? s?.line ?? 0,
      ) || null
      remember(p.declPos, name, f, line)
      remember(pooledDeclPos, name, f, line)
      p.names.add(name)
      const q = String(s?.qualifiedName ?? "")
      // `countKey`'s OTHER HALF (`incoming-gate.ts:1030-1034`): an alias is the SAME declaration
      // under a second spelling, so it increments the declaration count AND joins the kind set.
      // This branch was dead until the analyzer started publishing aliases, and it was wrong when
      // it woke up — it pushed a NUMBER into the kinds map with `bump`, and `classifyEdge` then
      // threw on the spread. The gate's own code was the reference; the copy is now the same shape.
      if (q.length > 0 && q !== name) {
        bump(p.decls, q)
        aliasedKeys++
        const qs = p.kinds.get(q) ?? new Set<string>()
        qs.add(String(s?.kind ?? ""))
        p.kinds.set(q, qs)
        remember(p.declPos, q, f, line)
        remember(pooledDeclPos, q, f, line)
      }
      const owner = String(s?.ownerName ?? "")
      if (owner) p.owned.add(owner)
      if (owner && owner !== name) {
        const k = `${owner}:${name}`
        const kind = String(s?.kind ?? "").toLowerCase()
        if (kind === "function" || kind === "method") {
          const n = (p.aliasFn.get(k) ?? 0) + 1
          p.aliasFn.set(k, n)
          if (n === 1) p.aliasAt.set(k, `${path.relative(CR, f)}:${line ?? "?"}`)
        }
      }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const raw = String(rel?.type ?? rel?.relationshipType ?? "")
      const type = raw === "brain_import" ? "imports" : raw
      const tgt = String(rel?.target ?? rel?.to ?? "")
      if (!tgt) continue
      pending.push({
        type, target: tgt, file: f,
        line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null,
        md: rel?.metadata ?? {}, claim: externalClaimOf(rel),
      })
    }
  }
  console.error(`  parsed ${parsed} in ${Math.round((Date.now() - t0) / 1000)}s; classifying ${pending.length} edges`)

  // ── PASS 2: classify every edge against the COMPLETE key space ──
  for (const e of pending) {
    const p = proj(repoOf(e.file))
    totals.edges++
    // the gate reads the GLOBAL table here too (`incoming-gate.ts:1154`), because the edge's own
    // file belongs to its own project either way and the two agree on this question.
    const ownFileDeclares = (pooledDeclPos.get(e.target) ?? []).some((d) => d.file === e.file)
    const c = classifyEdge(p.decls, p.kinds, e.target, e.claim, undefined, isContainsEdge(e.type), ownFileDeclares)
    const rw = row(e.type)
    rw.edges++
    const it = intentByType.get(e.type) ?? emptyIntent()
    intentByType.set(e.type, it)
    const cls = intentOf(e.target, e.file, e.line, e.type)
    it[cls]++
    intentTotal[cls]++

    const shape = shapeOf(e.target)
    const mod = shape === "module:function" ? e.target.split(":")[0] : ""
    const fn = shape === "module:function" ? e.target.split(":")[1] : ""
    const would = shape === "module:function" ? (p.aliasFn.get(`${mod}:${fn}`) ?? 0) : 0

    switch (c.outcome) {
      case "resolved":
        rw.resolved++; totals.resolved++
        if (c.boundAmongCollision) { rw.collRes++; totals.collRes++ }
        if (shape === "module:function") {
          resolvedColon.push({ target: e.target, file: path.relative(CR, e.file), line: e.line })
          // THE HAND-READ LIST: a colon target that resolved, the declaration it bound to, and the
          // call site. An alias is the ONLY way a `mod:thing` target can resolve on this lane —
          // `symbolNamesWithColon` is printed above and must be 0 — so every row here is a binding
          // this fix creates.
          if (handList.length < HAND_SKIP + HAND + 400) {
            const at = pooledDeclPos.get(e.target) ?? []
            handList.push({
              target: e.target, type: e.type, edgeLine: e.line,
              src: `${path.relative(CR, e.file)}:${e.line ?? "?"}`,
              decls: at.map((d) => `${path.relative(CR, d.file)}:${d.line}`),
              ctx: ctxOf(e.md),
            })
          }
        }
        break
      case "ambBoth": case "ambDeclOnly": rw.amb++; totals.amb++; break
      case "unresolved": {
        rw.unresolved++; totals.unresolved++
        let name = `${e.type} · ${ctxOf(e.md)} · ${shape}`
        if (shape === "module:function") {
          const inRun = p.owned.has(mod)
          const kind = would === 1 ? "QUALIFIER ANSWERABLE (1 decl)"
            : would > 1 ? `QUALIFIER COLLIDES (${would} decls)`
            : inRun ? "module in run, this function not declared in it"
            : "module absent from the run"
          name = `${e.type} · remote call mod:fn · ${kind}`
        }
        const b = bucket(name)
        b.count++
        b.intent[cls]++
        if (shape === "module:function") {
          if (would === 1) b.wouldResolve++
          else if (would > 1) b.wouldCollide++
          else b.stillDark++
        }
        if (b.examples.length < 3) {
          b.examples.push(`${e.target}  (${path.relative(CR, e.file)}:${e.line ?? "?"})` +
            (would === 1 ? `  -> would bind ${p.aliasAt.get(`${mod}:${fn}`)}` : ""))
        }
        break
      }
      case "causeDeclared": case "causeRefuted": totals.cause++; break
      case "externalVerified": totals.extOK++; break
      case "externalUnverified": totals.extQ++; break
      case "externalRefuted": totals.extFAIL++; break
      case "bindingVerified": totals.bindOK++; break
      case "bindingUnverified": totals.bindQ++; break
      case "bindingRefuted": totals.bindFAIL++; break
    }
    void rw
  }

  const w = (s: string, n: number) => String(s).padEnd(n)
  const n0 = (x: number) => x.toLocaleString("en-US")
  if (HAND > 0) {
    // DETERMINISTIC, and spread rather than head-N: a head-N dump would be the first module
    // alphabetically and nothing else. Stride over the collected rows.
    const stride = Math.max(1, Math.floor(handList.length / Math.max(1, HAND)))
    console.log(`HAND-READ LIST — ${handList.length} resolved 'mod:thing' edges collected; printing ${HAND} on a stride of ${stride}`)
    for (let i = HAND_SKIP, printed = 0; i < handList.length && printed < HAND; i += stride, printed++) {
      const h = handList[i]
      console.log(`  ${printed + 1}. ${h.type}  site ${h.src}`)
      console.log(`       target "${h.target}"`)
      console.log(`       binds -> ${h.decls.length === 1 ? h.decls[0] : `[${h.decls.join(" , ")}] (${h.decls.length} decls)`}`)
      console.log(`       marker ${h.ctx}`)
    }
  }
  console.log(`\nERLANG RESIDUAL BY NAMED CAUSE — ${disc.files.length} parsed of ${disc.total} admitted (${disc.repos} repos)`)
  console.log(`edges ${n0(totals.edges)} · resolved ${n0(totals.resolved)} (of which collRes ${n0(totals.collRes)}) · amb(decl) ${n0(totals.amb)} · unresolved ${n0(totals.unresolved)}`)
  console.log(`causeOK ${totals.cause} · extOK ${totals.extOK} · ext? ${totals.extQ} · extFAIL ${totals.extFAIL} · bindOK ${totals.bindOK} · bind? ${totals.bindQ} · bindFAIL ${totals.bindFAIL} · parseFailures ${failed}`)
  console.log(`CROSS-CHECK: these totals must equal the gate's own TABLE 1 row for the same population; any difference is a probe defect, not a finding.`)
  console.log(`symbols whose NAME contains ':' : ${symbolNamesWithColon}   (a colon-free name space means an alias is a NEW key and nothing else)`)
  console.log(`currently-RESOLVED edges with a 'mod:function' target: ${resolvedColon.length}` +
    (resolvedColon.length ? `  <-- NOT 0: the counterfactual could move these` : `  <-- the alias can only answer edges that are unanswered today`))

  console.log(`\nPER TYPE`)
  console.log(`  ${w("type", 14)}${w("edges", 9)}${w("resolved", 10)}${w("collRes", 9)}${w("amb", 8)}${w("unresolved", 12)}`)
  for (const [t, r] of [...rows.entries()].sort((a, b) => b[1].unresolved - a[1].unresolved)) {
    console.log(`  ${w(t, 14)}${w(n0(r.edges), 9)}${w(n0(r.resolved), 10)}${w(n0(r.collRes), 9)}${w(n0(r.amb), 8)}${w(n0(r.unresolved), 12)}`)
  }

  console.log(`\nINTENT (the gate's own test, recomputed here so before/after is one instrument)`)
  console.log(`  ${w("type", 14)}${w("edges", 9)}${w("intended", 10)}${w("sameFile", 10)}${w("arbTwin", 10)}${w("noDecl", 10)}`)
  for (const [t, it] of intentByType) {
    const e = rows.get(t)?.edges ?? 0
    console.log(`  ${w(t, 14)}${w(n0(e), 9)}${w(n0(it.intended), 10)}${w(n0(it.sameFileUnproven), 10)}${w(n0(it.arbitraryTwin), 10)}${w(n0(it.nothingAnywhere), 10)}`)
  }
  console.log(`  ${w("TOTAL", 14)}${w(n0(totals.edges), 9)}${w(n0(intentTotal.intended), 10)}${w(n0(intentTotal.sameFileUnproven), 10)}${w(n0(intentTotal.arbitraryTwin), 10)}${w(n0(intentTotal.nothingAnywhere), 10)}`)

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  console.log(`\nUNRESOLVED BY NAMED CAUSE (top ${SHOW} of ${sorted.length})`)
  console.log(`  ${w("count", 9)}${w("wouldRes", 10)}${w("wouldColl", 10)}${w("dark", 8)}${w("arbTwin", 9)} CAUSE`)
  for (const b of sorted.slice(0, SHOW)) {
    console.log(`  ${w(n0(b.count), 9)}${w(n0(b.wouldResolve), 10)}${w(n0(b.wouldCollide), 10)}${w(n0(b.stillDark), 8)}${w(n0(b.intent.arbitraryTwin), 9)} ${b.name}`)
  }
  const rest = sorted.slice(SHOW)
  if (rest.length) console.log(`  ... ${rest.length} further bucket(s), ${n0(rest.reduce((a, b) => a + b.count, 0))} unresolved edges`)
  console.log(`\n  examples of the top buckets (for the hand-read):`)
  for (const b of sorted.slice(0, 6)) {
    console.log(`    [${n0(b.count)}] ${b.name}`)
    for (const e of b.examples) console.log(`          ${e}`)
  }

  const colon = sorted.filter((b) => b.name.includes("remote call mod:fn"))
  const wr = colon.reduce((a, b) => a + b.wouldResolve, 0)
  const wc = colon.reduce((a, b) => a + b.wouldCollide, 0)
  const dk = colon.reduce((a, b) => a + b.stillDark, 0)
  const tot = colon.reduce((a, b) => a + b.count, 0)
  const allWould = sorted.reduce((a, b) => a + b.wouldResolve, 0)
  const allColl = sorted.reduce((a, b) => a + b.wouldCollide, 0)
  console.log(`\nDOABILITY LEDGER — publishing the module qualifier as the declaration's qualifiedName`)
  console.log(`  colon-shaped unresolved targets (the whole surface this fix can touch): ${n0(tot)}`)
  console.log(`    WOULD-RESOLVE  (exactly one declaration answers \`mod:fn\`):            ${n0(wr)}`)
  console.log(`    WOULD-COLLIDE  (a module's same-named functions at two arities):        ${n0(wc)}   <- ambiguity, NOT a gain`)
  console.log(`    STILL-DARK     (module absent from the run, or function not in it):     ${n0(dk)}`)
  console.log(`  PROJECTED gate columns: unresolved ${n0(totals.unresolved)} -> ${n0(totals.unresolved - wr - wc)}` +
    `   amb(decl) ${n0(totals.amb)} -> ${n0(totals.amb + wc)}`)
  console.log(`  PROJECTED intent:      arbitraryTwin ${n0(intentTotal.arbitraryTwin)} -> ${n0(intentTotal.arbitraryTwin + wr)}` +
    `  (a bound cross-module call has no declaration in the caller's own file BY CONSTRUCTION)`)
  console.log(`  collRes: ${n0(totals.collRes)} today; unchanged by construction — an alias key is a NEW key, and a key with two`)
  console.log(`           declarations is AMBIGUOUS in the gate's rule, never resolved-with-a-tie-break.`)
  void allWould; void allColl
  console.log(`  qualifiedName aliases the lane publishes TODAY: ${n0(aliasedKeys)}`)
}

await main()
