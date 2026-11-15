/**
 * LUA `calls` FILE-SCOPE PRICING — the price of the ONLY externality rule a per-file analyzer can
 * actually implement on a `calls` target, taken in the order the record demands, PLUS the shape
 * split that finally NAMES the class.
 *
 * ## Why this file exists
 *
 * `calls` is this lane's largest remaining cause: **41,640 not-resolved edges (29,121 amb + 12,519
 * unresolved), 30.9% of the residual**, all on ONE marker signature (`luaSpecific`). The attractive
 * fix is an external marker on the 12,519 unresolved, and the lane's own record says why that is
 * NOT a price: the 2026-10-09 simulation M2 ("a bare identifier target the project declares
 * nowhere, restricted to calls") reads `marked 12,517 · externalVerified 12,517 · REFUTED 0` — and
 * **M2's rule was evaluated against the PROJECT key space, so its applicability condition IS the
 * arbiter's refutation condition** (archive/docs-pre-consolidation/analyzers-HANDOFF.md §5k/§5l, `incoming-rule.ts:600`:
 * for a bare target the arbiter's check is `declCount.get(tgt) > 0 ? refuted : verified`, and
 * `classifyEdge` consults a generic claim ONLY inside `decls === 0` — so the check is evaluated on
 * the branch where it cannot fire). A per-FILE analyzer owns only its OWN file's declared names.
 *
 * ## THE FOUR STEPS, in the order the record requires them
 *
 *   1. THE ANALYZER-SIDE DECLARED-NAME SET PER FILE — `ownKeys(F)`, built from that file's OWN
 *      `parseFile` output (every symbol's `name` and `qualifiedName`). This is the whole of what a
 *      per-file analyzer can test, and nothing else is used.
 *   2. THE PROJECT KEY SPACE — `declCount` / `kinds`, built exactly as `incoming-gate.ts:countKey`
 *      does (name, plus `qualifiedName` as an alias of the SAME declaration), per project, from the
 *      UNSAMPLED admitted population. Production's scope (`WHERE s.project_id = ?`).
 *   3. THE REFUTATION COUNT OF THE FILE-SCOPED RULE — the edges where the rule FIRES
 *      (`tgt ∉ ownKeys(F)`) and the project DOES declare the name, i.e. the claims the rule would
 *      make that are FALSE. This is the number M2 could not produce, and it cannot be read off the
 *      unresolved column: `ownKeys(F) ⊆ projectKeys` by construction, so on the `decls === 0`
 *      branch the rule fires on EVERY edge and is never refuted there.
 *   4. THE CROSS-TAB — own × project, with the arbiter's OWN verdict for each cell, computed by
 *      calling `classifyEdge` from `script/m14/incoming-rule.ts` with the marker the analyzer would
 *      write (`isExternalBase` -> `{kind:"owner"}` through `externalClaimOf`, the arbiter's own
 *      reader). One rule, not a copy: the probe classifies with the module the gate classifies with.
 *
 * ## And the second measurement: WHAT THE 41,640 SHARE
 *
 * A cause is not named until the edges are split by what they share. `calleeShape` is published by
 * the analyzer as the two marker keys `calleeIdentifier` / `calleeIndexed` (LUA-G5's outstanding
 * item — `callee()` already computed it and threw it away), and this probe splits the whole `calls`
 * population by it. The two keys are a PARTITION, so the gate's marker table gains two rows whose
 * sum is the row it replaces.
 *
 * ## THE FALSIFIER ARM, because §6.11 applies to this file too
 *
 * A ruling that says "no honest claim exists here" is a CHARACTERISATION unless the instrument that
 * produced it could have said otherwise. So two counter-predicates are priced on the same walk:
 *
 *   * THE DECLARED-LIST RULE (`--list`): the ONE model §5l rule 1 allows — a DECLARED surface the
 *     analyzer owns and the project can refute, here the Lua 5.4 reference manual §6.1 basic
 *     functions plus `_G`/`_VERSION`, applied to bare `calls` targets. Its coverage AND its
 *     refutation count are both measured, so the "just build a list" answer is answered with
 *     numbers rather than with the lane's earlier refusal.
 *   * `--selftest`: planted edges driven through the SAME `priceEdge()` the walk uses, asserting
 *     each counter CAN go non-zero and that the negative arms stay zero.
 *
 * ## Population and scope
 *
 * The gate's own discovery rule, spelled once here: a directory under the corpus root that is a real
 * git checkout, `git ls-files`, the lane's admitted extension, the 1 MB engine cap, sorted, then a
 * per-project stride only when `--files=N` is given (0 = the whole admitted population). Edges come
 * from `parseFile` (`src/ast/pool-worker.ts`) with `{ projectRoot: repo }` — exactly the call
 * `incoming-gate.ts:794` makes. TABLE 1's scope is PER PROJECT, and so is this probe's.
 *
 *   npx tsx validation/m14/fixtures/lua/tools/calls-file-scope-pricing.mts [--files=N] [--list] [--selftest]
 *
 * Read-only; no store, no writes.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = ["lua"]

const argv = process.argv.slice(2)
const argOf = (f: string, d: string): string => {
  const hit = argv.find((a) => a === f || a.startsWith(`${f}=`))
  if (!hit) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const SAMPLE = Number(argOf("--files", "0"))
const WITH_LIST = argv.includes("--list")
const SELFTEST = argv.includes("--selftest")

/**
 * THE ONE RULE, IMPORTED. `classifyEdge` and `tally` are the gate's own classification, and
 * `externalClaimOf` is the arbiter's own reader of a marker — so the claim this probe prices is
 * spelled the way the analyzer would have to spell it, and the outcome is the outcome the gate
 * would report. A second copy of any of the three would be a second rule.
 */
const RULE: any = await import(path.join(ROOT, "script/m14/incoming-rule.ts"))
const { classifyEdge, emptyOutcomes, tally, externalClaimOf } = RULE

/** The marker a lane attaches to say "this target is outside the project". */
const FILE_SCOPED_CLAIM = externalClaimOf({ metadata: { isExternalBase: true } })

/**
 * LUA 5.4's OWN GLOBAL SURFACE, transcribed from the reference manual §6.1 ("Basic Functions") plus
 * the two §6.1 variables `_G` and `_VERSION`. It is a DECLARED list with a citation — the shape §5l
 * rule 1 requires — and it is the strongest honest candidate for the unresolved `calls` class,
 * because it is a surface the LANGUAGE fixes rather than a name list guessed from the corpus.
 *
 * It is deliberately NOT the eight stdlib TABLES: those are RECEIVERS, and `markStdlibExternal`
 * already covers a member read off one of them. A bare `type(x)` has no receiver at all, which is
 * why the receiver rule cannot reach it and why this list exists as a separate arm.
 *
 * `require`, `module`, `pcall` and `xpcall` are IN the list and are also excluded from `calls`
 * emission by the analyzer (`real-lua-analyzer.ts:1012-1026`), so their measured edge count is a
 * check on this probe as much as on the rule.
 */
const LUA54_GLOBALS = new Set([
  "_G", "_VERSION",
  "assert", "collectgarbage", "dofile", "error", "getmetatable", "ipairs", "load", "loadfile",
  "next", "pairs", "pcall", "print", "rawequal", "rawget", "rawlen", "rawset", "require", "select",
  "setmetatable", "tonumber", "tostring", "type", "warn", "xpcall",
])

// ─────────────────────────────────────────────────────────────────────────────────────────────
// STEP 3/4 — THE PRICE OF ONE EDGE, as a pure function so the walk and --selftest cannot drift.
// `ownKeys` is the analyzer-side set for THE EDGE'S OWN FILE (step 1); `declCount`/`kinds` are the
// project key space (step 2). Nothing else is read, because nothing else exists in a file.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export type Priced = {
  /** the file-scoped rule fires: the edge's own file does not declare this name */
  ruleFires: boolean
  /** ...and the project declares it anyway — a FALSE claim. THE REFUTATION COUNT OF STEP 3. */
  wouldRefute: boolean
  /** ...and the project declares it exactly once / more than once (which branch it lands on) */
  elsewhereUnique: boolean
  elsewhereColliding: boolean
  /** the rule fires and the project declares it nowhere: the claim coincides with the truth */
  nowhere: boolean
  /** the edge's own file declares the name, so the rule is silent */
  ownDeclared: boolean
  /** the arbiter's verdict for the edge AS IT STANDS (no mark) */
  base: string
  /** the arbiter's verdict for the edge IF the file-scoped marker were attached */
  claimed: string
}

export function priceEdge(
  declCount: Map<string, number>, kinds: Map<string, Set<string>>,
  ownKeys: Set<string>, tgt: string, claim: any,
): Priced {
  const decls = declCount.get(tgt) ?? 0
  const own = ownKeys.has(tgt)
  const base = classifyEdge(declCount, kinds, tgt, null)
  const claimed = classifyEdge(declCount, kinds, tgt, claim)
  return {
    ruleFires: !own,
    wouldRefute: !own && decls > 0,
    elsewhereUnique: !own && decls === 1,
    elsewhereColliding: !own && decls > 1,
    nowhere: !own && decls === 0,
    ownDeclared: own,
    base: String(base.outcome),
    claimed: String(claimed.outcome),
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Discovery — the gate's own rule.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const admittedExt = (rel: string): boolean => {
  const dot = rel.lastIndexOf(".")
  const slash = rel.lastIndexOf("/")
  return dot > slash && EXTS.includes(rel.slice(dot + 1).toLowerCase())
}

function discover(): Map<string, { files: string[]; population: number }> {
  const out = new Map<string, { files: string[]; population: number }>()
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    const files: string[] = []
    for (const rel of tracked) {
      if (!admittedExt(rel)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      files.push(abs)
    }
    files.sort()
    const population = files.length
    if (SAMPLE > 0 && files.length > SAMPLE) {
      const stride = files.length / SAMPLE
      const picked: string[] = []
      for (let i = 0; i < SAMPLE; i++) picked.push(files[Math.floor(i * stride)])
      files.length = 0
      files.push(...[...new Set(picked)].sort())
    }
    if (files.length > 0) out.set(dir, { files, population })
  }
  return out
}

const { parseFile } = SELFTEST ? { parseFile: null as any } : await import(path.join(ROOT, "src/ast/pool-worker.ts"))

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE WALK
// ─────────────────────────────────────────────────────────────────────────────────────────────
type Edge = { rel: string; tgt: string; mark: Record<string, any> }

const totals = {
  files: 0, population: 0, failed: 0, empty: 0, edges: 0,
  resolved: 0, amb: 0, ambKind: 0, unres: 0, extOK: 0, extQ: 0, extFAIL: 0,
  bindOK: 0, bindQ: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0,
}
/** The four-step cross-tab, and the arbiter's verdict inside each cell. */
const cells: Record<string, { n: number; base: Record<string, number>; claimed: Record<string, number> }> = {}
const bump = (bag: Record<string, number>, k: string): void => { bag[k] = (bag[k] ?? 0) + 1 }
const cell = (k: string) => (cells[k] ??= { n: 0, base: {}, claimed: {} })

/** The shape split — read from the analyzer's OWN published markers, never re-derived here. */
const shapes = new Map<string, { n: number; unres: number; amb: number; resolved: number; refute: number }>()
/** The unresolved class's target distribution, for the declared-list question. */
const unresNames = new Map<string, number>()
const refuteNames = new Map<string, number>()
const refuteExamples: string[] = []
/** The declared-list arm. */
const listArm = new Map<string, number>()
const listRefuteExamples: string[] = []

const repos = SELFTEST ? new Map<string, { files: string[]; population: number }>() : discover()
for (const [repo, { files, population }] of repos) {
  totals.population += population
  const declCount = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  const ownKeys = new Map<string, Set<string>>()
  const calls: Edge[] = []
  const countKey = (key: string, kind: string): void => {
    declCount.set(key, (declCount.get(key) ?? 0) + 1)
    let ks = kinds.get(key)
    if (!ks) kinds.set(key, (ks = new Set()))
    ks.add(kind)
  }
  for (const abs of files) {
    const rel = path.relative(repo, abs).split(path.sep).join("/")
    let res: any
    try {
      // THE PRODUCTION PATH AND THE GATE'S OWN CALL — see `incoming-gate.ts:794`.
      res = await parseFile(abs, repo, { projectRoot: repo } as any)
    } catch {
      totals.failed++
      continue
    }
    if (!res) { totals.failed++; continue }
    totals.files++
    const syms = Array.isArray(res.symbols) ? res.symbols : []
    const rels = Array.isArray(res.relationships) ? res.relationships : []
    if (syms.length === 0 && rels.length === 0) totals.empty++
    const own = new Set<string>()
    for (const s of syms) {
      const n = String(s?.name ?? "")
      if (n.length === 0) continue
      countKey(n, String(s?.kind ?? ""))
      own.add(n)
      // THE QUALIFIED-NAME ALIAS, spelled as the gate spells it (`countKey(q)` for the SAME
      // declaration) — and STEP 1's set gets it too, because a per-file analyzer can compute it.
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== n) { countKey(q, String(s?.kind ?? "")); own.add(q) }
    }
    ownKeys.set(rel, own)
    for (const r of rels) {
      const label = String(r?.type ?? r?.relationshipType ?? "")
      if (label !== "calls") continue
      calls.push({ rel, tgt: String(r?.target ?? r?.to ?? r?.toSymbol ?? ""), mark: (r?.metadata ?? {}) as Record<string, any> })
    }
  }

  for (const e of calls) {
    totals.edges++
    if (e.tgt.length === 0) { totals.unres++; continue }
    const own = ownKeys.get(e.rel) ?? new Set<string>()
    const p = priceEdge(declCount, kinds, own, e.tgt, FILE_SCOPED_CLAIM)
    // The columns, counted through the gate's OWN tally so they can be compared with its table.
    const out = emptyOutcomes()
    tally(out, classifyEdge(declCount, kinds, e.tgt, null), e.tgt, "calls")
    totals.resolved += out.resolved
    totals.amb += out.ambiguousByDecl
    totals.ambKind += out.ambiguousByKind
    totals.unres += out.unresolved
    totals.extOK += out.externalVerified
    totals.extQ += out.externalUnverified
    totals.extFAIL += out.externalRefuted
    totals.bindOK += out.bindingVerified
    totals.bindQ += out.bindingUnverified
    totals.bindFAIL += out.bindingRefuted
    totals.causeOK += out.causeDeclared
    totals.causeFAIL += out.causeRefuted

    const keyName = p.ownDeclared ? "ownDeclared"
      : p.elsewhereUnique ? "elsewhereUnique"
        : p.elsewhereColliding ? "elsewhereColliding" : "nowhere"
    const c = cell(keyName)
    c.n++
    bump(c.base, p.base)
    bump(c.claimed, p.claimed)

    const shape = e.mark.calleeIdentifier === true ? "identifier"
      : e.mark.calleeIndexed === true ? "indexed" : "UNPUBLISHED"
    const s = shapes.get(shape) ?? { n: 0, unres: 0, amb: 0, resolved: 0, refute: 0 }
    s.n++
    if (p.base === "unresolved") s.unres++
    else if (p.base === "ambDeclOnly" || p.base === "ambBoth") s.amb++
    else if (p.base === "resolved") s.resolved++
    if (p.wouldRefute) s.refute++
    shapes.set(shape, s)

    if (p.base === "unresolved") unresNames.set(e.tgt, (unresNames.get(e.tgt) ?? 0) + 1)
    if (p.wouldRefute) {
      refuteNames.set(e.tgt, (refuteNames.get(e.tgt) ?? 0) + 1)
      if (refuteExamples.length < 14) {
        refuteExamples.push(`${e.tgt.padEnd(28)} ${p.base.padEnd(14)} -> claimed ${p.claimed.padEnd(18)} decls=${declCount.get(e.tgt) ?? 0}  ${e.rel}`)
      }
    }

    // ── THE DECLARED-LIST ARM (§5l rule 1's model), priced on the same edge.
    if (WITH_LIST && shape !== "indexed") {
      const hit = LUA54_GLOBALS.has(e.tgt)
      if (hit) {
        const decls = declCount.get(e.tgt) ?? 0
        const verdict = decls > 0 ? "REFUTED" : p.base === "unresolved" ? "CLAIMS-AN-UNRESOLVED" : `no-op(${p.base})`
        listArm.set(verdict, (listArm.get(verdict) ?? 0) + 1)
        if (decls > 0 && listRefuteExamples.length < 10) {
          listRefuteExamples.push(`${e.tgt} decls=${decls}  ${e.rel}`)
        }
      } else listArm.set("not-on-the-list", (listArm.get("not-on-the-list") ?? 0) + 1)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SELF-TEST — §6.11's requirement, run through the SAME `priceEdge` the walk uses.
//
// IT RUNS BEFORE THE WALK on purpose: the walk parses 3,250 files, and a self-test that costs a
// corpus run is a self-test nobody runs. The walk below is SKIPPED when this flag is set.
// ─────────────────────────────────────────────────────────────────────────────────────────────
if (SELFTEST) {
  const dc = new Map<string, number>([["local", 1], ["shared", 3], ["ownThing", 1]])
  const kd = new Map<string, Set<string>>([["local", new Set(["function"])], ["shared", new Set(["function"])], ["ownThing", new Set(["variable"])]])
  const own = new Set<string>(["ownThing"])
  const rows: Array<[string, Priced, Partial<Priced>]> = [
    ["own file declares it -> rule silent", priceEdge(dc, kd, own, "ownThing", FILE_SCOPED_CLAIM), { ownDeclared: true, ruleFires: false, wouldRefute: false }],
    ["elsewhere, ONE declaration -> FALSE claim, gate reports resolved", priceEdge(dc, kd, own, "local", FILE_SCOPED_CLAIM), { ruleFires: true, wouldRefute: true, elsewhereUnique: true, base: "resolved" }],
    ["elsewhere, THREE declarations -> FALSE claim, gate reports amb+CONTRADICTED", priceEdge(dc, kd, own, "shared", FILE_SCOPED_CLAIM), { ruleFires: true, wouldRefute: true, elsewhereColliding: true, base: "ambDeclOnly" }],
    ["nowhere -> rule fires and the claim coincides with the truth (verified by construction)", priceEdge(dc, kd, own, "ghostlyAbsent", FILE_SCOPED_CLAIM), { ruleFires: true, wouldRefute: false, nowhere: true, base: "unresolved", claimed: "externalVerified" }],
    ["NEGATIVE ARM: an empty key space refuses nothing and the counters stay zero", priceEdge(new Map(), new Map(), new Set(["anything"]), "anything", FILE_SCOPED_CLAIM), { ownDeclared: true, ruleFires: false, wouldRefute: false }],
  ]
  let bad = 0
  console.log(`SELF-TEST — every counter below is driven through the SAME priceEdge() the walk calls.`)
  for (const [name, got, want] of rows) {
    const wrong = Object.entries(want).filter(([k, v]) => (got as any)[k] !== v)
    if (wrong.length) bad++
    console.log(`  ${wrong.length === 0 ? "ok  " : "FAIL"} ${name}`)
    console.log(`       got  ${JSON.stringify(got)}`)
    if (wrong.length) console.log(`       want ${JSON.stringify(want)}  (mismatch: ${wrong.map(([k, v]) => `${k}=${v}`).join(", ")})`)
  }
  // THE NEGATIVE ARM OF THE RULE ITSELF: the refutation counter MUST be able to read zero as well
  // as non-zero, or it is not a counter. The empty-key-space row above is that arm, and it is
  // asserted separately so a future edit that makes `wouldRefute` constant fails here.
  const zero = priceEdge(new Map(), new Map(), new Set<string>(), "x", FILE_SCOPED_CLAIM)
  if (zero.wouldRefute !== false) { bad++; console.log("  FAIL the negative arm read a refutation from an empty key space") }
  console.log(`  ${bad === 0 ? "SELFTEST PASS" : `SELFTEST FAIL (${bad})`} — ${rows.length} planted rows + 1 negative arm`)
  console.log(`  NOTE: this proves the COUNTERS can move. It proves nothing about the corpus — that is the walk.`)
  process.exit(bad === 0 ? 0 : 1)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────────────────────
const w = (s: any, n: number): string => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : ((a / b) * 100).toFixed(1) + "%")

console.log(`lua calls FILE-SCOPE PRICING — ${SAMPLE > 0 ? `per-project STRIDE of ${SAMPLE} files` : "WHOLE admitted population"}, PRODUCTION path`)
console.log(`  POPULATION: ${totals.files} parsed of ${totals.population} admitted · ${repos.size} repos · parse failures ${totals.failed} · files returning NO symbols AND NO relationships ${totals.empty}`)
console.log(`  PATH: every edge from \`parseFile\` (src/ast/pool-worker.ts) with { projectRoot: repo } — the call incoming-gate.ts:794 makes.`)
console.log(`  SCOPE: PER PROJECT (TABLE 1's scope, the verdict's). The project key space is built from the UNSAMPLED admitted population.`)
console.log(`  RULE: classifyEdge/tally/externalClaimOf IMPORTED from script/m14/incoming-rule.ts. The marker priced is the one the analyzer would have to write.`)
console.log()
console.log(`STEP 0 — THIS PROBE'S \`calls\` ROW vs THE GATE'S OWN COLUMNS (a probe that does not reproduce them is a second instrument, not a check)`)
console.log(`  ${w("", 12)} ${w("edges", 8)} ${w("resolved", 9)} ${w("amb", 8)} ${w("unres", 8)} ${w("extOK", 7)} ${w("ext?", 6)} ${w("extFAIL", 8)} ${w("bindOK", 7)} ${w("bind?", 6)} ${w("bindFAIL", 9)}`)
console.log(`  ${w("THIS PROBE", 12)} ${w(totals.edges, 8)} ${w(totals.resolved, 9)} ${w(totals.amb, 8)} ${w(totals.unres, 8)} ${w(totals.extOK, 7)} ${w(totals.extQ, 6)} ${w(totals.extFAIL, 8)} ${w(totals.bindOK, 7)} ${w(totals.bindQ, 6)} ${w(totals.bindFAIL, 9)}`)
console.log()

console.log(`STEP 1+2 — THE TWO KEY SPACES`)
console.log(`  ownKeys(F)          the edge's OWN FILE's declarations, from that file's parse output alone (name + qualifiedName)`)
console.log(`  declCount / kinds   the project's, built as incoming-gate.ts:countKey builds them. ownKeys(F) is a SUBSET of it — which is why`)
console.log(`                      the unresolved column cannot price this rule: on \`decls === 0\` the rule fires on EVERY edge.`)
console.log()

console.log(`STEP 3+4 — THE CROSS-TAB (own x project), with the ARBITER'S OWN VERDICT in each cell`)
const CELL_ORDER = ["ownDeclared", "elsewhereUnique", "elsewhereColliding", "nowhere"]
const cellLabel: Record<string, string> = {
  ownDeclared: "own file declares it — rule SILENT",
  elsewhereUnique: "elsewhere only, 1 decl",
  elsewhereColliding: "elsewhere only, 2+ decls",
  nowhere: "nowhere in the project",
}
let refuteTotal = 0, fireTotal = 0
console.log(`  ${w("cell", 32)} ${w("edges", 8)} ${w("share", 8)} ${w("rule fires", 11)} ${w("REFUTED", 9)}  arbiter, AS IT STANDS -> IF MARKED`)
console.log("-".repeat(128))
for (const k of CELL_ORDER) {
  const c = cells[k] ?? { n: 0, base: {}, claimed: {} }
  const fires = k === "ownDeclared" ? 0 : c.n
  const ref = k === "elsewhereUnique" || k === "elsewhereColliding" ? c.n : 0
  fireTotal += fires; refuteTotal += ref
  const show = (bag: Record<string, number>): string =>
    Object.entries(bag).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n}:${v}`).join(" ")
  console.log(`  ${w(cellLabel[k], 32)} ${w(c.n, 8)} ${w(pct(c.n, totals.edges), 8)} ${w(fires, 11)} ${w(ref, 9)}  ${show(c.base)}`)
  console.log(`  ${w("", 32)} ${w("", 8)} ${w("", 8)} ${w("", 11)} ${w("", 9)}  -> ${show(c.claimed)}`)
}
console.log("-".repeat(128))
console.log(`  edges ${totals.edges} · the rule FIRES on ${fireTotal} (${pct(fireTotal, totals.edges)}) · of those it is FALSE on ${refuteTotal} (${pct(refuteTotal, totals.edges)} of all calls, ${pct(refuteTotal, fireTotal)} of the firings)`)
console.log(`  THE REFUTATION COUNT OF STEP 3 IS ${refuteTotal}. Those are edges the graph would ASSERT are outside the project while the`)
console.log(`  project declares the name — and by the arbiter's own classification (right column) they land on \`resolved\` (decls=1,`)
console.log(`  where a generic claim is NEVER READ) or on \`amb + CONTRADICTED\` (decls>1). NOT ONE of them becomes extFAIL.`)
console.log()
console.log(`  REFUTED-claim examples (the rule would be false here):`)
for (const e of refuteExamples) console.log(`    ${e}`)
if (refuteExamples.length === 0) console.log(`    none`)
console.log()

console.log(`THE CLASS BY SHAPE — the analyzer's OWN published marker keys (calleeIdentifier / calleeIndexed)`)
console.log(`  ${w("shape", 14)} ${w("edges", 8)} ${w("share", 8)} ${w("resolved", 9)} ${w("amb", 8)} ${w("unres", 8)} ${w("rule-FALSE", 11)}`)
console.log("-".repeat(76))
for (const [s, v] of [...shapes].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${w(s, 14)} ${w(v.n, 8)} ${w(pct(v.n, totals.edges), 8)} ${w(v.resolved, 9)} ${w(v.amb, 8)} ${w(v.unres, 8)} ${w(v.refute, 11)}`)
}
if (shapes.has("UNPUBLISHED")) {
  console.log(`  UNPUBLISHED = the analyzer published NEITHER shape key. Before this change that is EVERY edge; after it, a`)
  console.log(`  non-zero value means a call site reached the metadata without passing the shape test — a HOLE, not a class.`)
}
console.log()

console.log(`THE UNRESOLVED CLASS — what it is made of (${totals.unres} edges, ${unresNames.size} distinct targets)`)
const top = [...unresNames].sort((a, b) => b[1] - a[1])
let cum = 0
const head = top.slice(0, 25)
for (const [, n] of head) cum += n
console.log(`  top-25 targets cover ${cum} of ${totals.unres} (${pct(cum, totals.unres)}); top-100 cover ${pct(top.slice(0, 100).reduce((a, [, n]) => a + n, 0), totals.unres)}`)
console.log(`  head: ${head.slice(0, 16).map(([n, c]) => `${n}x${c}`).join("  ")}`)
console.log(`  THE LIST QUESTION, measured: a declared name list can only cover the HEAD of this distribution. ${unresNames.size}`)
console.log(`  distinct targets mean the tail is the class, and the tail is what a per-file analyzer cannot name.`)
console.log()

if (WITH_LIST) {
  console.log(`THE DECLARED-LIST ARM — Lua 5.4 reference manual §6.1 basic functions + _G/_VERSION, on NON-index call targets`)
  console.log(`  (this is the ONE model §5l rule 1 allows: a surface the analyzer OWNS and the project can REFUTE)`)
  for (const [k, v] of [...listArm].sort((a, b) => b[1] - a[1])) console.log(`    ${w(k, 26)} ${v}`)
  console.log(`  REFUTED by the project here would be a FALSE claim, and it is non-zero or zero — either way it is measured:`)
  for (const e of listRefuteExamples) console.log(`    ${e}`)
  if (listRefuteExamples.length === 0) console.log(`    none — the arm claims, and the project confirms every time it fires`)
  console.log(`  \`no-op(...)\` is the arm contributing NOTHING: the name is already resolved or ambiguous, so the mark cannot move it.`)
  console.log()
}
console.log(`SCOPE OF THIS PRICE, stated so it cannot be read as more:`)
console.log(`  * The rule is priced where a CLAIM IS CONSULTED. `+"`classifyEdge`"+` reads a generic claim only at \`decls === 0\`,`)
console.log(`    so on the ${refuteTotal} FALSE firings the gate would report \`resolved\` (silently) or \`amb+CONTRADICTED\` — never extFAIL.`)
console.log(`  * A deduped edge carries the FIRST call site's shape (addRelationship's key is type+source+target), so the shape`)
console.log(`    split describes published EDGES, not call sites.`)
console.log(`  * PRICE, NOT EMISSION: nothing here writes a marker, and no analyzer change follows from a number in this table.`)
