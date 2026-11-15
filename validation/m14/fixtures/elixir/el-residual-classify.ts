// validation/m14/fixtures/elixir/el-residual-classify.ts
//
// THE ELIXIR RESIDUAL, BUCKETED BY NAMED CAUSE — and the counterfactual that decides whether the
// top cause is doable.
//
// WHY IT EXISTS. `incoming-gate.ts elixir ex 400` prints the totals and a 25-NAME worklist per
// type; a 25-name cap on a 2,719-edge `calls` residual cannot say WHICH CONSTRUCT carries the mass,
// and clause 2 asks for exactly that. This probe re-walks the SAME population with the SAME
// resolution rule (`classifyEdge` is IMPORTED from `script/m14/incoming-rule.ts`, never
// re-implemented) and buckets every unresolved edge by (type · metadata context · target shape ·
// what the key space can reach).
//
// TWO PASSES, because the gate's key space is COMPLETE when it classifies: every file is parsed and
// every symbol counted FIRST, then the edges are classified against the finished table. The
// CROSS-CHECK line at the top of the output is what proves this probe counts the gate's edges and
// not its own.
//
// THE SECOND KEY SPACE. `--full` parses the files the stride did NOT sample into a corpus-wide name
// set, so a target that is absent from the 400-file project table can be split into
//   STRIDE-HIDDEN     a declaration EXISTS in this corpus, in a file the cap did not read
//   ABSENT-FROM-CORPUS  nothing in any admitted file (1370 of them) declares it
// which is the difference between "the cap cost us this" and "this is genuinely outside the run".
// It is opt-in because it costs a second full parse.
//
//   bun run validation/m14/fixtures/elixir/el-residual-classify.ts --ext ex --max 400
//   bun run validation/m14/fixtures/elixir/el-residual-classify.ts --ext ex,exs --max 400 --full
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
const LANE = "elixir"

const argv = process.argv.slice(2)
const num = (flag: string, dflt: number): number => {
  const i = argv.indexOf(flag)
  return i >= 0 ? Number(argv[i + 1]) : dflt
}
const str = (flag: string, dflt: string): string => {
  const i = argv.indexOf(flag)
  return i >= 0 ? String(argv[i + 1]) : dflt
}
const MAX = num("--max", 400)
const EXTS = str("--ext", "ex").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
const REPO_ARG = argv.find((a) => a.startsWith("--repo="))
const ONLY_REPOS = REPO_ARG ? new Set(REPO_ARG.slice(7).split(",").map((s) => s.trim())) : undefined
const SHOW = num("--show", 30)
const TOPN = num("--top", 12)
const FULL = argv.includes("--full")
/** `--hand-exports N` — the exports edges the QUALIFIER counterfactual would resolve, on a stride,
 *  with the declaration each qualified key binds to. `--hand-unres N` — the top cause's own edges. */
const HAND_EXPORTS = num("--hand-exports", 0)
const HAND_UNRES = num("--hand-unres", 0)

function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

function discover(): { files: string[]; admitted: string[]; total: number; repos: number; overCap: number; absent: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], admitted: [], total: 0, repos: 0, overCap, absent } }
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
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
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
  return { files, admitted: found, total: found.length, repos: repos.size, overCap, absent }
}

const repoOf = (f: string): string => path.join(CR, f.startsWith(CR) ? f.slice(CR.length + 1).split(path.sep)[0] : f)

type Pos = { file: string; line: number }
/**
 * THE POOLED POSITION TABLE, and it is POOLED ON PURPOSE — this is the gate's own scope
 * (`incoming-gate.ts` declares `declPos` once for the whole run, outside the per-project loop).
 * RESOLUTION is per project (the verdict's scope); INTENT is pooled (the gate's).
 */
const pooledDeclPos = new Map<string, Pos[]>()
type Proj = {
  decls: Map<string, number>
  kinds: Map<string, Set<string>>
  /** owner/scope names the run publishes a declaration under */
  owned: Set<string>
  /** every scope-qualified key (`<scope>.<name>` or a real qualifiedName) */
  qual: Set<string>
  names: Set<string>
  propFields: Set<string>
  /** project-scoped declaration positions, for the counterfactual's hand-read list */
  pos: Map<string, Pos[]>
}
const projects = new Map<string, Proj>()
function proj(repo: string): Proj {
  let p = projects.get(repo)
  if (!p) projects.set(repo, (p = {
    decls: new Map(), kinds: new Map(), owned: new Set(), qual: new Set(), names: new Set(), propFields: new Set(), pos: new Map(),
  }))
  return p
}
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** THE WHOLE-CORPUS NAME SET, built only with `--full`, used to split STRIDE-HIDDEN from ABSENT. */
const corpusNames = new Set<string>()
const corpusQual = new Set<string>()
const corpusOwned = new Set<string>()

type Shape = "empty" | "path" | "erlang-remote" | "erlang-atom" | "dotted" | "bare"
const ERLANG_REMOTE = /^:[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*[?!]?$/
function shapeOf(t: string): Shape {
  if (!t) return "empty"
  if (t.includes("/") || /\.(exs?|erl|hrl|beam|ex)$/i.test(t)) return "path"
  if (ERLANG_REMOTE.test(t)) return "erlang-remote"
  if (t.startsWith(":")) return "erlang-atom"
  if (t.includes(".")) return "dotted"
  return "bare"
}
/** `:lists.flatten` -> ["lists","flatten"]; `Absinthe.Type.Enum` -> ["Absinthe.Type","Enum"] */
function splitTarget(t: string, shape: Shape): { mod: string; leaf: string } {
  if (shape === "erlang-remote") {
    const i = t.indexOf(".")
    return { mod: t.slice(1, i), leaf: t.slice(i + 1) }
  }
  if (shape === "dotted") {
    const i = t.lastIndexOf(".")
    return { mod: t.slice(0, i), leaf: t.slice(i + 1) }
  }
  return { mod: "", leaf: t }
}

/** The Elixir spelling of an Erlang module atom: `:elixir_tokenizer` -> `Elixir.Tokenizer` is NOT
 *  derivable in general (Erlang module names are not Elixir aliases), so the counterfactual keeps
 *  three honest candidates and prints which one answers. */
function erlangCandidates(mod: string): string[] {
  const parts = mod.split("_").filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1))
  return [mod, `Elixir.${parts.join(".")}`, parts.join(".")]
}

const CTX_KEYS = [
  "reasonCode", "evidenceClass", "elixirUsesKind", "exportForm", "exportKind", "overrideForm",
  "callArity", "isPipe", "isCapture", "isDelegate", "directive", "via", "memberAccess",
  "isStruct", "isCallbackDeclaration", "isStructField", "method",
] as const
function ctxOf(md: any): string {
  const bits: string[] = []
  for (const k of CTX_KEYS) {
    const v = md?.[k]
    if (v === undefined || v === false || v === null || v === "") continue
    if (k === "reasonCode" && typeof v === "string") bits.push(v.replace(/^elixir_/, ""))
    else if (k === "callArity" || k === "directive" || k === "isStruct") bits.push(`${k}=${v}`)
    else bits.push(k)
  }
  if (md?.receiver !== undefined) bits.push("receiver")
  if (md?.exportKind !== undefined && !bits.some((b) => b.startsWith("exportKind"))) bits.push("exportKind")
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
function remember(at: Map<string, Pos[]>, key: string, file: string, line: number | null): void {
  const pos = { file, line: line ?? -1 }
  const cur = at.get(key)
  if (!cur) at.set(key, [pos])
  else if (!cur.some((d) => d.file === file && d.line === pos.line)) cur.push(pos)
}
/** the gate's own line chain, read in full (`incoming-gate.ts` countKey call site) */
function lineOf(s: any): number | null {
  return Number(s?.range?.startLine ?? s?.range?.start_line ?? s?.line_start ?? s?.lineStart ?? s?.startLine ?? s?.line ?? 0) || null
}

type Bucket = {
  name: string; count: number; examples: string[]; intent: Intent
  wouldResolve: number; wouldCollide: number; strideHidden: number
  /** THE PRICED TRAP, measured per bucket: if the target were REBASED to its bare leaf, how many
   *  of these edges would land on a UNIQUE key (a "resolution") and how many on a COLLIDING one
   *  (the tie-break class the indexer measures ~75% wrong). A fix that rebases must show both. */
  leafUnique: number; leafCollide: number
}
const buckets = new Map<string, Bucket>()
const bucket = (name: string): Bucket => {
  let b = buckets.get(name)
  if (!b) buckets.set(name, (b = { name, count: 0, examples: [], intent: emptyIntent(), wouldResolve: 0, wouldCollide: 0, strideHidden: 0, leafUnique: 0, leafCollide: 0 }))
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
/** full target tallies, NOT capped — this is the classification table the gate cannot print */
const unresTargets = new Map<string, number>()
const unresByTypeTarget = new Map<string, Map<string, number>>()
/** unresolved, split by whether the corpus (unsampled files included) could answer */
const reach = { strideHidden: 0, absentFromCorpus: 0, wholeCorpusUnknown: 0 }
/** the coarsest classification a reader needs first: unresolved by (type · target shape) */
const rollShape = new Map<string, number>()
/** unresolved by the analyzer's own reasonCode, which is what names the CONSTRUCT */
const rollReason = new Map<string, number>()
/**
 * THE QUALIFIER COUNTERFACTUAL, measured per edge and NOT projected from a bucket count.
 *
 * The fleet-wide cause (b) is "the leaf is published and the qualifier is thrown away". On this lane
 * the qualifier is NOT thrown away — for `exports`/`contains` it is the edge's own SOURCE field
 * (`real-elixir-analyzer.ts` pushes `owner -> s.name`), and the engine derives each declaration's
 * `qualifiedName` as `${scope}.${name}` (`pool-worker.ts`). So the qualified key ALREADY EXISTS in the
 * key space; only the edge's TARGET does not use it. This table answers the two questions the trap
 * demands, for EVERY edge of the type and not only the residual ones:
 *   WOULD-RESOLVE  the qualified key answers with exactly ONE declaration
 *   WOULD-COLLIDE  it answers with TWO OR MORE (a module's same-named members at different arities)
 *   NO-KEY         no declaration publishes it (the qualifier is not a live key here)
 * and, in the transition table, how many edges would LEAVE `resolved` — the direction a projection
 * usually forgets and the one that turns a better-looking table into a regression.
 */
const cfTransitions = new Map<string, number>()
const cfByType = new Map<string, { edges: number; rNow: number; rCf: number; cNow: number; cCf: number; aNow: number; aCf: number; uNow: number; uCf: number }>()
const cfIntentChanged = new Map<string, number>()
type HandExport = { src: string; target: string; qual: string; site: string; intentNow: string; intentCf: string; decls: string[] }
const handExports: HandExport[] = []
type HandUnres = { target: string; type: string; site: string; ctx: string; reach: string }
const handUnres: HandUnres[] = []
let aliasedKeys = 0
let symbolsWithQual = 0

type Pending = { type: string; target: string; file: string; line: number | null; md: any; claim: any; src: string }

async function buildKeySpace(files: string[], deferred: Pending[], label: string, intoProjects = true): Promise<{ parsed: number; failed: number }> {
  let parsed = 0, failed = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (i % 200 === 0 && files.length > 400) console.error(`  [${label}] parse ${i}/${files.length}`)
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
    if (!r) { failed++; continue }
    parsed++
    // THE CORPUS-WIDE PASS MUST NOT TOUCH THE PROJECT TABLES. The first version of this probe let
    // `--full`'s 276 unsampled files write into the SAME per-project key space the sample is
    // classified against — the cross-check line caught it immediately (resolved 24,082 against the
    // gate's 24,107, amb 11,359 against 11,261). The corpus set exists to answer "does ANY admitted
    // file declare this", which is a different question from "does this project's table".
    const p = intoProjects ? proj(repoOf(f)) : null
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      const scope = String(s?.scope ?? "")
      const owner = String(s?.ownerName ?? "")
      const q = String(s?.qualifiedName ?? (s?.metadata?.fqn ?? (scope ? `${scope}.${name}` : name)))
      corpusNames.add(name)
      if (scope) corpusOwned.add(scope)
      if (owner) corpusOwned.add(owner)
      if (q && q !== name) corpusQual.add(q)
      if (!p) continue
      bump(p.decls, name)
      const ks = p.kinds.get(name) ?? new Set<string>()
      ks.add(String(s?.kind ?? ""))
      p.kinds.set(name, ks)
      const line = lineOf(s)
      remember(pooledDeclPos, name, f, line)
      remember(p.pos, name, f, line)
      p.names.add(name)
      if (scope) p.owned.add(scope)
      if (owner) p.owned.add(owner)
      // the engine's own normalisation (`pool-worker.ts`): qualifiedName || metadata.fqn || scope.name
      if (q && q !== name) {
        bump(p.decls, q)
        aliasedKeys++
        symbolsWithQual++
        const qs = p.kinds.get(q) ?? new Set<string>()
        qs.add(String(s?.kind ?? ""))
        p.kinds.set(q, qs)
        remember(pooledDeclPos, q, f, line)
        remember(p.pos, q, f, line)
        p.qual.add(q)
      }
      if (String(s?.kind ?? "") === "property" && (s?.metadata?.isStructField || s?.metadata?.elixirSpecific)) p.propFields.add(name)
    }
    if (!intoProjects) continue
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const raw = String(rel?.type ?? rel?.relationshipType ?? "")
      if (!raw) continue
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (!tgt) continue
      deferred.push({
        type: raw === "brain_import" ? "imports" : raw,
        target: tgt, file: f,
        line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null,
        md: rel?.metadata ?? {}, claim: externalClaimOf(rel),
        src: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""),
      })
    }
  }
  return { parsed, failed }
}

async function main(): Promise<void> {
  const disc = discover()
  console.error(`population: ${disc.files.length} sampled of ${disc.total} admitted (${disc.repos} repos, ${disc.overCap} over cap, ${disc.absent} absent) exts=${EXTS.join(",")}`)
  const pending: Pending[] = []
  const t0 = Date.now()
  const first = await buildKeySpace(disc.files, pending, "sample")
  console.error(`  parsed ${first.parsed}, ${pending.length} edges, ${Math.round((Date.now() - t0) / 1000)}s`)

  if (FULL) {
    const sampled = new Set(disc.files)
    const rest = disc.admitted.filter((f) => !sampled.has(f))
    console.error(`  --full: parsing the ${rest.length} unsampled admitted file(s) for the corpus-wide name set`)
    const second = await buildKeySpace(rest, [], "full", false)
    console.error(`  --full parsed ${second.parsed}; corpus names ${corpusNames.size}, corpus qualified keys ${corpusQual.size}`)
  }

  // ── PASS 2: classify every edge against the COMPLETE key space ──
  for (const e of pending) {
    const p = proj(repoOf(e.file))
    totals.edges++
    const ownFileDeclares = (pooledDeclPos.get(e.target) ?? []).some((d) => d.file === e.file)
    const c = classifyEdge(p.decls, p.kinds, e.target, e.claim, undefined, isContainsEdge(e.type), ownFileDeclares)
    // ── THE SAME EDGE, CLASSIFIED AS IF ITS TARGET WERE `${source}.${leaf}` ──────────────────
    // The independent variable is the TARGET SPELLING and nothing else: same key space, same claim,
    // same own-file fact (recomputed for the new spelling, because that is what production would ask).
    let cfOutcome: string | null = null
    if (e.src) {
      const qual = `${e.src}.${e.target}`
      const ownFile2 = (pooledDeclPos.get(qual) ?? []).some((d) => d.file === e.file)
      const c2 = classifyEdge(p.decls, p.kinds, qual, e.claim, undefined, isContainsEdge(e.type), ownFile2)
      cfOutcome = c2.outcome
      if (!cfByType.has(e.type)) cfByType.set(e.type, { edges: 0, rNow: 0, rCf: 0, cNow: 0, cCf: 0, aNow: 0, aCf: 0, uNow: 0, uCf: 0 })
      const s = cfByType.get(e.type)!
      s.edges++
      const isRes = (o: string) => o === "resolved"
      const isAmb = (o: string) => o === "ambBoth" || o === "ambDeclOnly"
      const isUn = (o: string) => o === "unresolved"
      if (isRes(c.outcome)) s.rNow++
      if (isRes(c2.outcome)) s.rCf++
      if (c.outcome === "resolved" && c.boundAmongCollision) s.cNow++
      if (c2.outcome === "resolved" && c2.boundAmongCollision) s.cCf++
      if (isAmb(c.outcome)) s.aNow++
      if (isAmb(c2.outcome)) s.aCf++
      if (isUn(c.outcome)) s.uNow++
      if (isUn(c2.outcome)) s.uCf++
      const key = `${e.type} · ${c.outcome} -> ${c2.outcome}`
      cfTransitions.set(key, (cfTransitions.get(key) ?? 0) + 1)
      const i1 = intentOf(e.target, e.file, e.line, e.type)
      const i2 = intentOf(qual, e.file, e.line, e.type)
      if (i1 !== i2) cfIntentChanged.set(`${e.type} · ${i1} -> ${i2}`, (cfIntentChanged.get(`${e.type} · ${i1} -> ${i2}`) ?? 0) + 1)
      // THE HAND-READ LIST for the counterfactual: only an edge that is AMBIGUOUS NOW and would be
      // RESOLVED under the qualified spelling, with the declaration the qualified key lands on.
      if (HAND_EXPORTS > 0 && e.type === "exports" && isAmb(c.outcome) && isRes(c2.outcome)) {
        const at = p.pos.get(qual) ?? []
        handExports.push({
          src: e.src, target: e.target, qual, site: `${path.relative(CR, e.file)}:${e.line ?? "?"}`,
          intentNow: i1, intentCf: i2,
          decls: (at.length ? at : pooledDeclPos.get(qual) ?? []).map((d) => `${path.relative(CR, d.file)}:${d.line}`),
        })
      }
    }
    const rw = row(e.type)
    rw.edges++
    const it = intentByType.get(e.type) ?? emptyIntent()
    intentByType.set(e.type, it)
    const cls = intentOf(e.target, e.file, e.line, e.type)
    it[cls]++
    intentTotal[cls]++

    switch (c.outcome) {
      case "resolved":
        rw.resolved++; totals.resolved++
        if (c.boundAmongCollision) { rw.collRes++; totals.collRes++ }
        break
      case "ambBoth": case "ambDeclOnly": rw.amb++; totals.amb++; break
      case "unresolved": {
        rw.unresolved++; totals.unresolved++
        const shape = shapeOf(e.target)
        const { mod, leaf } = splitTarget(e.target, shape)
        // WHAT THE KEY SPACE CAN REACH — the reach test is the doability evidence, so it is
        // computed HERE, per edge, from the finished tables and never guessed from the shape.
        let reachNote: string
        let would = 0
        if (shape === "dotted") {
          const qualHit = p.qual.has(e.target)
          const modKnown = [...p.owned].some((o) => o === mod || o.startsWith(`${mod}.`)) || p.qual.has(mod)
          if (qualHit) { reachNote = "qualified key present (unreachable — probe defect)"; would = 1 }
          else if (modKnown) reachNote = "module declared in project, this member is not"
          else reachNote = "module absent from the project"
        } else if (shape === "erlang-remote") {
          const cands = erlangCandidates(mod)
          const hit = cands.find((cd) => [...p.owned].some((o) => o === cd || o.startsWith(`${cd}.`)) || p.qual.has(cd))
          // A SPELLING COINCIDENCE IS NOT AN ANSWER: `:code.del_path` names the ERLANG module
          // `code`; Elixir's `Code` module is a different thing, and nothing in this run publishes
          // the key `:code.del_path`. The note says what was seen, not what it means.
          if (hit) { reachNote = `erlang atom :${mod} coincides with Elixir module spelling '${hit}' in the run (no ':mod.fn' key exists)`; would = 1 }
          else reachNote = "erlang atom absent from the project (OTP/stdlib reach)"
        } else if (shape === "bare") {
          const inCorpus = FULL ? corpusNames.has(e.target) : false
          reachNote = FULL
            ? (inCorpus ? "STRIDE-HIDDEN: corpus declares it, this project table does not" : "ABSENT-FROM-CORPUS: nothing in any admitted file declares it")
            : "bare name: no declaration in this project table"
        } else reachNote = `shape ${shape}`

        let hidden = false
        if (FULL) {
          const known = corpusNames.has(e.target) || corpusQual.has(e.target)
          hidden = known
          if (known) reach.strideHidden++
          else if (shape === "dotted") {
            const { mod: m2 } = splitTarget(e.target, shape)
            if (corpusOwned.has(m2) || [...corpusOwned].some((o) => o.startsWith(`${m2}.`))) reach.absentFromCorpus++
            else reach.absentFromCorpus++
          } else reach.absentFromCorpus++
        } else reach.wholeCorpusUnknown++

        if (would === 1) {
          // an unresolved edge whose key EXISTS in the project table — reported separately because
          // it would mean the probe disagrees with `classifyEdge`, not that a fix is available
          void would
        }

        const name = `${e.type} · ${ctxOf(e.md)} · ${shape} · ${reachNote}`
        if (HAND_UNRES > 0) {
          handUnres.push({
            target: e.target, type: e.type, site: `${path.relative(CR, e.file)}:${e.line ?? "?"}`,
            ctx: ctxOf(e.md), reach: reachNote,
          })
        }
        const b = bucket(name)
        b.count++
        b.intent[cls]++
        if (hidden) b.strideHidden++
        if (b.examples.length < 3) b.examples.push(`${e.target}  (${path.relative(CR, e.file)}:${e.line ?? "?"})`)
        rollShape.set(`${e.type} · ${shape}`, (rollShape.get(`${e.type} · ${shape}`) ?? 0) + 1)
        const rc = String(e.md?.reasonCode ?? "(none)")
        rollReason.set(rc, (rollReason.get(rc) ?? 0) + 1)
        // THE PRICED TRAP, measured per edge: what the bare leaf alone would reach.
        const leafDecls = p.decls.get(leaf) ?? 0
        if (leafDecls === 1) b.leafUnique++
        else if (leafDecls > 1) b.leafCollide++
        unresTargets.set(e.target, (unresTargets.get(e.target) ?? 0) + 1)
        let m = unresByTypeTarget.get(e.type)
        if (!m) unresByTypeTarget.set(e.type, (m = new Map()))
        m.set(e.target, (m.get(e.target) ?? 0) + 1)
        void leaf
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
  console.log(`\nELIXIR RESIDUAL BY NAMED CAUSE — ${disc.files.length} parsed of ${disc.total} admitted (${disc.repos} repos, exts=${EXTS.join(",")})`)
  console.log(`edges ${n0(totals.edges)} · resolved ${n0(totals.resolved)} (of which collRes ${n0(totals.collRes)}) · amb(decl) ${n0(totals.amb)} · unresolved ${n0(totals.unresolved)}`)
  console.log(`causeOK ${totals.cause} · extOK ${totals.extOK} · ext? ${totals.extQ} · extFAIL ${totals.extFAIL} · bindOK ${totals.bindOK} · bind? ${totals.bindQ} · bindFAIL ${totals.bindFAIL} · parseFailures ${first.failed}`)
  console.log(`CROSS-CHECK: these totals must equal the gate's own TABLE 1 row for the same population; any difference is a probe defect, not a finding.`)
  console.log(`qualifiedName aliases indexed: ${n0(aliasedKeys)} (symbols carrying one: ${n0(symbolsWithQual)})`)
  if (FULL) {
    console.log(`REACH over the ${n0(totals.unresolved)} unresolved edges: STRIDE-HIDDEN ${n0(reach.strideHidden)} · the corpus declares nothing in ANY admitted file ${n0(reach.absentFromCorpus)}`)
  } else {
    console.log(`REACH not measured (no --full): all ${n0(reach.wholeCorpusUnknown)} unresolved are classified against the project table alone.`)
  }

  console.log(`\nPER TYPE (the gate's own rows, recomputed)`)
  console.log(`  ${w("type", 14)}${w("edges", 9)}${w("resolved", 10)}${w("collRes", 9)}${w("amb", 8)}${w("unresolved", 12)}`)
  for (const [t, r] of [...rows.entries()].sort((a, b) => b[1].unresolved - a[1].unresolved)) {
    console.log(`  ${w(t, 14)}${w(n0(r.edges), 9)}${w(n0(r.resolved), 10)}${w(n0(r.collRes), 9)}${w(n0(r.amb), 8)}${w(n0(r.unresolved), 12)}`)
  }

  console.log(`\nINTENT (the gate's own test, recomputed here so before/after is one instrument)`)
  console.log(`  ${w("type", 14)}${w("edges", 9)}${w("intended", 10)}${w("sameFile", 10)}${w("arbTwin", 10)}${w("noDecl", 10)}`)
  for (const [t, it] of intentByType) {
    console.log(`  ${w(t, 14)}${w(n0(rows.get(t)?.edges ?? 0), 9)}${w(n0(it.intended), 10)}${w(n0(it.sameFileUnproven), 10)}${w(n0(it.arbitraryTwin), 10)}${w(n0(it.nothingAnywhere), 10)}`)
  }
  console.log(`  ${w("TOTAL", 14)}${w(n0(totals.edges), 9)}${w(n0(intentTotal.intended), 10)}${w(n0(intentTotal.sameFileUnproven), 10)}${w(n0(intentTotal.arbitraryTwin), 10)}${w(n0(intentTotal.nothingAnywhere), 10)}`)

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  console.log(`\nROLLUP — UNRESOLVED BY (type · target shape), the coarsest reading of the residual`)
  for (const [k, n] of [...rollShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(n0(n), 9)}  ${k}`)
  console.log(`\nROLLUP — UNRESOLVED BY THE ANALYZER'S OWN reasonCode (the construct's name in the code)`)
  for (const [k, n] of [...rollReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(n0(n), 9)}  ${k}`)
  console.log(`\nUNRESOLVED BY NAMED CAUSE (top ${SHOW} of ${sorted.length}; all buckets below close on ${n0(sorted.reduce((a, b) => a + b.count, 0))})`)
  console.log(`  ${w("count", 9)}${w("arbTwin", 9)}${w("hidden", 9)}${w("leaf=1", 9)}${w("leaf>1", 9)} CAUSE`)
  for (const b of sorted.slice(0, SHOW)) {
    console.log(`  ${w(n0(b.count), 9)}${w(n0(b.intent.arbitraryTwin), 9)}${w(n0(b.strideHidden), 9)}${w(n0(b.leafUnique), 9)}${w(n0(b.leafCollide), 9)} ${b.name}`)
  }
  const rest = sorted.slice(SHOW)
  if (rest.length) console.log(`  ... ${rest.length} further bucket(s), ${n0(rest.reduce((a, b) => a + b.count, 0))} unresolved edges`)
  console.log(`\n  examples of the top buckets:`)
  for (const b of sorted.slice(0, 10)) {
    console.log(`    [${n0(b.count)}] ${b.name}`)
    for (const e of b.examples) console.log(`          ${e}`)
  }

  console.log(`\nTOP UNRESOLVED TARGETS PER TYPE (full tally, no 25-name cap)`)
  for (const [t, m] of [...unresByTypeTarget.entries()].sort((a, b) => (rows.get(b[0])?.unresolved ?? 0) - (rows.get(a[0])?.unresolved ?? 0))) {
    if ((rows.get(t)?.unresolved ?? 0) === 0) continue
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOPN)
    console.log(`  ${t} — ${n0(rows.get(t)!.unresolved)} unresolved across ${n0(m.size)} distinct targets`)
    for (const [tgt, n] of top) console.log(`      ${w(n0(n), 7)}  ${tgt}`)
  }

  console.log(`\nCOUNTERFACTUAL — THE SAME EDGE CLASSIFIED WITH ITS TARGET SPELLED \`<edge source>.<leaf>\``)
  console.log(`  (the qualifier the edge ALREADY CARRIES in its source field; the key space already holds`)
  console.log(`   \`<scope>.<name>\` for every declaration, so this asks only whether the TARGET reaches it)`)
  console.log(`  ${w("type", 14)}${w("edges", 9)}${w("res now", 9)}${w("res cf", 9)}${w("coll now", 9)}${w("coll cf", 9)}${w("amb now", 9)}${w("amb cf", 9)}${w("unr now", 9)}${w("unr cf", 9)}`)
  for (const [t, s] of cfByType) {
    console.log(`  ${w(t, 14)}${w(n0(s.edges), 9)}${w(n0(s.rNow), 9)}${w(n0(s.rCf), 9)}${w(n0(s.cNow), 9)}${w(n0(s.cCf), 9)}${w(n0(s.aNow), 9)}${w(n0(s.aCf), 9)}${w(n0(s.uNow), 9)}${w(n0(s.uCf), 9)}`)
  }
  console.log(`  TRANSITIONS (only rows that MOVE; the direction that leaves \`resolved\` is the regression)`)
  for (const [k, n] of [...cfTransitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
    console.log(`    ${w(n0(n), 8)}  ${k}`)
  }
  if (HAND_EXPORTS > 0) {
    console.log(`\nHAND-READ LIST — exports edges AMBIGUOUS now and RESOLVED by the qualified spelling`)
    console.log(`  collected ${n0(handExports.length)}; printing ${HAND_EXPORTS} on a deterministic stride`)
    const stride = Math.max(1, Math.floor(handExports.length / Math.max(1, HAND_EXPORTS)))
    for (let i = 0, k = 0; i < handExports.length && k < HAND_EXPORTS; i += stride, k++) {
      const h = handExports[i]
      console.log(`  ${k + 1}. site ${h.site}`)
      console.log(`       source "${h.src}"  target now "${h.target}" -> would bind via "${h.qual}"`)
      console.log(`       binds -> ${h.decls.length ? h.decls.join(" , ") : "(no position recorded)"}   intent ${h.intentNow} -> ${h.intentCf}`)
    }
  }
  if (HAND_UNRES > 0) {
    console.log(`\nHAND-READ LIST — unresolved edges of the TOP CAUSE ('+' = sampled, not head-N)`)
    const stride = Math.max(1, Math.floor(handUnres.length / Math.max(1, HAND_UNRES)))
    for (let i = 0, k = 0; i < handUnres.length && k < HAND_UNRES; i += stride, k++) {
      const h = handUnres[i]
      console.log(`  ${k + 1}. ${h.type}  ${h.target}   at ${h.site}`)
      console.log(`       marker ${h.ctx} · reach: ${h.reach}`)
    }
  }
  console.log(`  INTENT MOVEMENT under the counterfactual target spelling:`)
  const ic = [...cfIntentChanged.entries()].sort((a, b) => b[1] - a[1])
  if (ic.length === 0) console.log(`    (none)`)
  for (const [k, n] of ic.slice(0, 10)) console.log(`    ${w(n0(n), 8)}  ${k}`)
}

await main()
