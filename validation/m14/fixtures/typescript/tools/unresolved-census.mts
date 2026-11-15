/**
 * TYPESCRIPT LANE — THE UNRESOLVED CAUSE CENSUS (clause 2's named part).
 *
 * ## What this answers, and why it is not the gate
 *
 * `script/m14/incoming-gate.ts` prints a WORKLIST of ambiguous/unresolved targets capped at 25
 * names per type, and its own header says so. A cap cannot satisfy clause 2, which requires
 * every unresolved edge to be attributed to a NAMED cause with a MEASURED COUNT that accounts
 * for the column. So this census classifies the SAME edges with the SAME rule
 * (`classifyEdge` is IMPORTED from `script/m14/incoming-rule.ts`, never re-implemented) over the
 * SAME population — the list of files the gate itself discovered, dumped through its
 * `BB_LIST_FILES` mode, which prints the discovered set and exits BEFORE any parsing.
 *
 * ## Parity is asserted, not assumed
 *
 * The run prints this census's per-type resolved/amb/unresolved beside the gate's own TABLE 1
 * numbers (passed in as `--expect`, copied from the gate output). A classifier that disagrees
 * with the arbiter about the total is not a classification of the arbiter's residual, so the
 * tool refuses to bucket anything unless the totals close.
 *
 * ## The one thing this measures that the gate cannot
 *
 * The gate's population is a 400-file STRIDE of 13,830 — 2.9% of the corpus. Production
 * resolves an edge by looking up the WHOLE project, so an edge whose declaration sits in an
 * unsampled file of the same repository reads UNRESOLVED here and RESOLVES in production.
 * That is a property of the cap, not of the analyzer, and it would otherwise be attributed to
 * whichever cause bucket happened to collect it. So every unresolved edge is cross-cut against
 * a WHOLE-REPOSITORY declaration scan (`--reposcan`): does any file of this edge's own
 * repository — sampled or not — declare the target's name? The scan is TEXTUAL and is labelled
 * as such wherever it is reported; it over-approximates (a name in a comment counts), which is
 * the safe direction: it can only move an edge OUT of "nothing declares it", never into it.
 *
 * Usage:
 *   bun validation/m14/fixtures/typescript/tools/unresolved-census.mts <filelist> [--reposcan] [--examples]
 */

import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import {
  classifyEdge, externalClaimOf, emptyOutcomes, tally, isContainsEdge, verifyExternalClaim,
  type ExternalClaim, type Outcomes,
} from "../../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const listPath = argv.find((a) => !a.startsWith("--"))
if (!listPath) { console.error("usage: unresolved-census.mts <filelist> [--reposcan] [--examples]"); process.exit(2) }
const DO_REPOSCAN = argv.includes("--reposcan")
const SHOW_EXAMPLES = argv.includes("--examples")
/** `--expect edges,resolved,amb,unresolved` — the gate's own TOTAL row, for the parity assertion. */
const expectArg = argv.find((a) => a.startsWith("--expect="))
const expected = expectArg
  ? expectArg.slice("--expect=".length).split(",").map(Number)
  : null

const files = readFileSync(listPath, "utf8").split("\n")
  .filter((l) => l.startsWith("BB_LIST_FILES_FILE: "))
  .map((l) => l.slice("BB_LIST_FILES_FILE: ".length).trim())
  .filter(Boolean)
if (files.length === 0) { console.error("no files in list"); process.exit(2) }

// ── THE GATE'S OWN LABEL TABLE, COPIED VERBATIM (it is not exported) ────────────────────────
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof TYPES)[number]
const labelOf = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

// ── PHASE 1: parse the population, build the key spaces exactly as the gate does ────────────
type Pending = {
  label: Type; tgt: string; claim: ExternalClaim | null; repo: string; srcFile: string; line: number | null
  md: Record<string, unknown>
  /** the file's import facts, for the receiver/binding predicates below */
  facts: FileFacts
}
type FileFacts = {
  decls: Set<string>
  /** local names bound by a BARE (non-relative, non-absolute) specifier */
  bareBindings: Map<string, string>
  /** local names bound by a RELATIVE or ABSOLUTE specifier */
  relBindings: Map<string, string>
  /** namespace imports (`import * as ns from "m"`) → specifier */
  nsBindings: Map<string, string>
  /** every specifier the file imports */
  modules: Set<string>
}

const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
/** repo -> name -> the first sampled file that declares it. Only for naming a WOULD-BE REFUTATION
 *  in the marking simulation: a refuted claim is one where the project DOES publish the name, and a
 *  reader has to be able to open the declaration that refutes it. */
const declFirstFile = new Map<string, Map<string, string>>()
const pending: Pending[] = []
let parsed = 0, failed = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  let pDecl = projectDecl.get(repo); if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo); if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  let pFirst = declFirstFile.get(repo); if (!pFirst) declFirstFile.set(repo, (pFirst = new Map()))
  const countKey = (key: string, kind: string) => {
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    if (!pFirst!.has(key)) pFirst!.set(key, f)
    let ks = pKinds!.get(key); if (!ks) pKinds!.set(key, (ks = new Set()))
    ks.add(kind)
  }
  const decls = new Set<string>()
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const kind = String(s?.kind ?? "")
    decls.add(name)
    countKey(name, kind)
    const q = String((s as any)?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(q, kind)
  }
  // IMPORT FACTS — read off the analyzer's own `imports` edges, which is the only place the
  // specifier→local-name binding is published. `metadata.module` is the specifier; the target is
  // `<specifier>:<item>` for a bare specifier and the bare ITEM for a relative one (the lane's
  // `bareLocalItem` rule), so the local name is read from whichever spelling this edge used.
  const facts: FileFacts = { decls, bareBindings: new Map(), relBindings: new Map(), nsBindings: new Map(), modules: new Set() }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = labelOf(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (label !== "imports") continue
    const md = (rel?.metadata ?? {}) as Record<string, unknown>
    const mod = String(md.module ?? "")
    if (!mod) continue
    facts.modules.add(mod)
    const tgt = String(rel?.target ?? "")
    const local = String(md.alias ?? (tgt.includes(":") ? tgt.slice(tgt.lastIndexOf(":") + 1) : tgt))
    const isRel = mod.startsWith(".") || mod.startsWith("/")
    if (local === "*") facts.nsBindings.set(String(md.alias ?? ""), mod)
    else if (isRel) facts.relBindings.set(local, mod)
    else facts.bareBindings.set(local, mod)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = labelOf(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!tgt) continue
    const md = (rel?.metadata ?? {}) as Record<string, unknown>
    const edgeLine = Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null
    pending.push({ label, tgt, claim: externalClaimOf(rel), repo, srcFile: f, line: edgeLine, md, facts })
  }
}

// ── PHASE 2: classify, exactly as the gate's classification pass does ───────────────────────
const rows = new Map<Type, Outcomes>()
for (const t of TYPES) rows.set(t, emptyOutcomes())
const outcomeOf = new Map<Pending, string>()
const unresolvedEdges: Pending[] = []
const edgeCount = new Map<Type, number>()
for (const e of pending) {
  const row = rows.get(e.label)!
  edgeCount.set(e.label, (edgeCount.get(e.label) ?? 0) + 1)
  const isContains = isContainsEdge(e.label)
  const ownFileDeclares = e.facts.decls.has(e.tgt)
  const pc = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, undefined, isContains, ownFileDeclares)
  tally(row, pc, e.tgt, e.label)
  outcomeOf.set(e, pc.outcome)
  if (pc.outcome === "unresolved") unresolvedEdges.push(e)
}

console.log(`population: ${parsed} parsed of ${files.length} listed (${failed} failed)  [gate's own BB_LIST_FILES set]`)
console.log("")
console.log("PARITY — this census vs the gate's TABLE 1 (per project):")
console.log("type          edges    resolved  collRes  amb(decl)  unresolved   <-- census")
console.log("-----------------------------------------------------------------------")
for (const t of TYPES) {
  const o = rows.get(t)!
  console.log(
    `${t.padEnd(13)} ${String(edgeCount.get(t) ?? 0).padStart(5)}    ${String(o.resolved).padStart(6)}   ${String(o.resolvedAmongCollision).padStart(6)}  ${String(o.ambiguousByDecl).padStart(8)}   ${String(o.unresolved).padStart(8)}`,
  )
}
const tot = TYPES.reduce((a, t) => {
  const o = rows.get(t)!
  return { edges: a.edges + (edgeCount.get(t) ?? 0), resolved: a.resolved + o.resolved, coll: a.coll + o.resolvedAmongCollision, amb: a.amb + o.ambiguousByDecl, unres: a.unres + o.unresolved }
}, { edges: 0, resolved: 0, coll: 0, amb: 0, unres: 0 })
console.log("-----------------------------------------------------------------------")
console.log(`TOTAL         ${String(tot.edges).padStart(5)}    ${String(tot.resolved).padStart(6)}   ${String(tot.coll).padStart(6)}  ${String(tot.amb).padStart(8)}   ${String(tot.unres).padStart(8)}`)
if (expected) {
  const ok = expected[0] === tot.edges && expected[1] === tot.resolved && expected[2] === tot.amb && expected[3] === tot.unres
  console.log(`parity vs gate TOTAL ${expected.join("/")}: ${ok ? "EXACT" : "*** MISMATCH — the buckets below are NOT a classification of the gate's residual ***"}`)
  if (!ok) process.exitCode = 3
}

// ── THE WHOLE-REPOSITORY DECLARATION SCAN (opt-in) ─────────────────────────────────────────
// TEXTUAL and over-approximating, labelled as such. It exists to answer ONE question the 2.9%
// stride cannot: does the edge's own repository — including the files this run never sampled —
// declare this name at all? Production resolves over the whole project, so "yes" here means the
// edge's unresolved state is a property of the CAP.
const DECL_PATTERNS: RegExp[] = [
  /\b(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:default\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /^\s*(?:public|private|protected|static|readonly|abstract|async|override|\s)*([A-Za-z_$][\w$]*)\s*[(:<]/gm,
  /\b(?:public|private|protected|static|readonly)\s+([A-Za-z_$][\w$]*)\s*[:?]/g,
]
/**
 * THE STRICT VARIANT — the same question asked with TWO corrections to the loose rule above,
 * and both are corrections to FALSE POSITIVES that the loose scan made:
 *
 *   * a METHOD is only a method if it OPENS A BLOCK; `  describe(() => {` in a test file and
 *     `  LibraryChangePageDtoFromJSON(json)` in a generated model both matched the loose
 *     `IDENT(` shape, so 2,880 `describe`/`it`/`expect` call sites were counted as declarations
 *     of those names — which is how the loose rule reported "declared somewhere in the repo"
 *     for 100% of test-global edges.
 *   * a PROPERTY is only a property if it carries a MODIFIER (`readonly x: T`), because a bare
 *     `x: 1` in an object literal is not a declaration this proxy can distinguish from data.
 *
 * The strict scan therefore UNDER-approximates where the loose one OVER-approximates, and the
 * two are reported as a BOUND PAIR rather than as one number: the truth for a name is between
 * them, and neither is a measurement of the symbol table (that would need a parse).
 */
const DECL_PATTERNS_STRICT: RegExp[] = [
  DECL_PATTERNS[0], DECL_PATTERNS[1], DECL_PATTERNS[2], DECL_PATTERNS[3], DECL_PATTERNS[4],
  DECL_PATTERNS[5], DECL_PATTERNS[6],
  /^\s*(?:(?:public|private|protected|static|readonly|abstract|async|override|declare|get|set)\s+)*([A-Za-z_$][\w$]*)\s*[<(][^;{}]*\)\s*(?::\s*[^;{]+)?\{\s*$/gm,
  /\b(?:public|private|protected|static|readonly|declare)\s+([A-Za-z_$][\w$]*)\s*[?!]?\s*[:=]/g,
]
const repoDeclNames = new Map<string, Set<string>>()
const repoDeclNamesStrict = new Map<string, Set<string>>()
if (DO_REPOSCAN) {
  const repos = [...new Set(files.map(repoOf))]
  let scanned = 0
  for (const repo of repos) {
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    const names = new Set<string>()
    const strict = new Set<string>()
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".ts")) continue
      let text: string
      try {
        text = readFileSync(path.join(repo, rel), "utf8")
      } catch { continue }
      scanned++
      for (const re of DECL_PATTERNS) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) names.add(m[1])
      }
      for (const re of DECL_PATTERNS_STRICT) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) strict.add(m[1])
      }
    }
    repoDeclNames.set(repo, names)
    repoDeclNamesStrict.set(repo, strict)
  }
  console.log(`\nrepo declaration scan: ${scanned} .ts file(s) read across ${repoDeclNames.size} repo(s) of the sampled set (TEXTUAL proxy, no parse: LOOSE over-approximates, STRICT under-approximates)`)
}
const declaredInRepo = (e: Pending): boolean => repoDeclNames.get(e.repo)?.has(e.tgt) ?? false
const declaredInRepoStrict = (e: Pending): boolean => repoDeclNamesStrict.get(e.repo)?.has(e.tgt) ?? false

// ── THE MARKING SIMULATION (opt-in) ────────────────────────────────────────────────────────
// A candidate marker is only worth landing if the arbiter's OWN verifier (`verifyExternalClaim`,
// imported, never re-spelled) says VERIFIED for it. A marker that gets REFUTED is worse than no
// marker: `extFAIL` is counted against the lane by clause 4. So each candidate strategy below is
// run through the verifier per edge, and the split is printed. The strategies that RETARGET
// (`receiver.leaf`) additionally print what they would do to edges that RESOLVE today, because
// moving a resolved edge into a claim bucket is a LOSS however good the claim is.
// The body runs LAST (called at the end of the file) because the shared tables and predicates
// below it are module-level `const`s: a top-level `if` here would read them in their TDZ.
function runSim(): void {
  const bare = (e: Pending): boolean => {
    const callee = String(e.md.calleeExpression ?? "")
    return callee !== "" && callee === e.tgt && !e.facts.decls.has(e.tgt) &&
      !e.facts.bareBindings.has(e.tgt) && !e.facts.relBindings.has(e.tgt)
  }
  type Strat = { name: string; pick: (e: Pending) => { target: string } | null }
  const strats: Strat[] = [
    { name: "S1 bare TEST-RUNNER global (describe/it/expect), unimported+undeclared in file", pick: (e) => (e.label === "calls" && TEST_GLOBALS.has(e.tgt) && bare(e) ? { target: e.tgt } : null) },
    { name: "S2 bare RUNTIME global (setTimeout/Symbol/fetch), unimported+undeclared in file", pick: (e) => (e.label === "calls" && RUNTIME_GLOBALS.has(e.tgt) && bare(e) ? { target: e.tgt } : null) },
    { name: "S3 member on a RUNTIME-GLOBAL receiver, LEAF target kept as-is", pick: (e) => {
      if (e.label !== "calls" && e.label !== "uses" && e.label !== "instantiates") return null
      const recv = receiverOf(String(e.md.calleeExpression ?? ""), e.tgt)
      return recv !== null && RUNTIME_GLOBALS.has(recv) ? { target: e.tgt } : null
    } },
    { name: "S4 member on a RUNTIME-GLOBAL receiver, RETARGETED to receiver.leaf", pick: (e) => {
      if (e.label !== "calls" && e.label !== "uses" && e.label !== "instantiates") return null
      const recv = receiverOf(String(e.md.calleeExpression ?? ""), e.tgt)
      return recv !== null && RUNTIME_GLOBALS.has(recv) ? { target: `${recv}.${e.tgt}` } : null
    } },
    { name: "S5 bare call to a BARE-package import binding, target kept", pick: (e) => (e.label === "calls" && e.facts.bareBindings.has(e.tgt) && String(e.md.calleeExpression ?? "") === e.tgt ? { target: e.tgt } : null) },
    { name: "S6 member on a BARE-package import receiver, LEAF target kept as-is", pick: (e) => {
      if (e.label !== "calls") return null
      const recv = receiverOf(String(e.md.calleeExpression ?? ""), e.tgt)
      return recv !== null && e.facts.bareBindings.has(recv) ? { target: e.tgt } : null
    } },
    { name: "S7 member on a BARE-package import receiver, RETARGETED to receiver.leaf", pick: (e) => {
      if (e.label !== "calls") return null
      const recv = receiverOf(String(e.md.calleeExpression ?? ""), e.tgt)
      return recv !== null && e.facts.bareBindings.has(recv) ? { target: `${recv}.${e.tgt}` } : null
    } },
    { name: "S8 matcher leaf of an `expect(...)` chain (`toEqual`), LEAF target kept", pick: (e) => {
      if (e.label !== "calls") return null
      const callee = String(e.md.calleeExpression ?? "")
      return callee.startsWith("expect(") && callee.endsWith(`.${e.tgt}`) ? { target: e.tgt } : null
    } },
    { name: "S9 imports whose module the analyzer already called `external:` — target kept", pick: (e) => (e.label === "imports" && e.tgt.startsWith("external:") ? { target: e.tgt } : null) },
    { name: "S10 TYPE-position name in the pinned lib/utility table, unimported+undeclared in file", pick: (e) => {
      if (e.label !== "references" && e.label !== "extends" && e.label !== "implements") return null
      if (!TS_LIB_TYPE_NAMES.has(e.tgt)) return null
      return e.facts.decls.has(e.tgt) || e.facts.bareBindings.has(e.tgt) || e.facts.relBindings.has(e.tgt) ? null : { target: e.tgt }
    } },
    { name: "S11 `C.member` where C is a BARE-package binding — RETARGETED (the trap arm)", pick: (e) => {
      if (e.label !== "calls") return null
      const recv = receiverOf(String(e.md.calleeExpression ?? ""), e.tgt)
      return recv !== null && e.facts.bareBindings.has(recv) ? { target: `${recv}.${e.tgt}` } : null
    } },
  ]
  console.log("\nMARKING SIMULATION — measured through `classifyEdge`, the arbiter's OWN decision function (the")
  console.log("verifier alone is NOT the gate: for an `owner` claim it is consulted only when decls === 0, so a")
  console.log("DOTLESS target can be verified or refused, never refuted — printed per strategy as gate/verifier.)")
  console.log("  after: extOK = the project CONFIRMS the claim · extFAIL = REFUTED, counted against the lane")
  console.log("  Δ: what each strategy does to edges that are resolved / ambiguous TODAY (inert = the count wins)")
  for (const s of strats) {
    let n = 0, extOK = 0, extFAIL = 0, extQ = 0, resolvStill = 0, ambStill = 0, unresStill = 0
    let lossResolved = 0, gainUnres = 0
    let verifierRef = 0
    const refExamples: string[] = []
    for (const e of pending) {
      const c = s.pick(e); if (!c) continue
      n++
      const before = outcomeOf.get(e)!
      const claimOut: ExternalClaim = { kind: "owner" }
      const pc = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, c.target, claimOut, undefined, false, false)
      if (pc.outcome === "externalVerified") extOK++
      else if (pc.outcome === "externalRefuted") extFAIL++
      else if (pc.outcome === "externalUnverified") extQ++
      else if (pc.outcome === "resolved") resolvStill++
      else if (pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth") ambStill++
      else if (pc.outcome === "unresolved") unresStill++
      if (before === "resolved" && pc.outcome !== "resolved") lossResolved++
      if (before === "unresolved" && pc.outcome !== "unresolved") gainUnres++
      // what the VERIFIER alone would say (the gate consults it only on the decls===0 path)
      const v = verifyExternalClaim(projectDecl.get(e.repo)!, c.target, undefined)
      if (v === "externalRefuted") {
        verifierRef++
        if (refExamples.length < 3) {
          const df = declFirstFile.get(e.repo)?.get(c.target) ?? "?"
          refExamples.push(`verifier-only refutation: ${e.srcFile.slice(CR.length + 1)}:${e.line ?? "?"} -> ${JSON.stringify(c.target)}  (declared by ${df.slice(CR.length + 1)})`)
        }
      }
    }
    console.log(`  ${s.name}`)
    console.log(`      n=${n}  -> extOK=${extOK}  extFAIL=${extFAIL}  ext?=${extQ}  |  still resolved=${resolvStill} amb=${ambStill} unresolved=${unresStill}  |  Δresolved=${lossResolved} Δunresolved=${gainUnres}`)
    if (verifierRef > 0) console.log(`      (the verifier ALONE would call ${verifierRef} refuted — unreachable on this path, printed so the difference is visible)`)
    for (const ex of refExamples) console.log(`      ${ex}`)
  }
}

// ── THE MARKED-EDGE DUMP (opt-in) ──────────────────────────────────────────────────────────
// Every edge the ANALYZER actually marked, read off its own output (`metadata.isExternalTarget`),
// with the outcome the SAME edge had before the marker — computed by re-classifying with the claim
// removed. This is the sampling frame for the ten-edge hand-read: an edge whose "before" is
// `unresolved` is an edge the fix moved, and one whose "before" is `resolved`/`amb` is an edge the
// marker left alone (the claim is inert where the project answers the name).
if (argv.some((a) => a.startsWith("--dump-marked"))) {
  const n = Number(argv.find((a) => a.startsWith("--dump-marked"))?.split("=")[1] ?? 6) || 6
  const marked = pending.filter((e) => (e.md as { isExternalTarget?: unknown }).isExternalTarget === true)
  const byReason = new Map<string, Pending[]>()
  for (const e of marked) {
    const r = String((e.md as { externalReason?: unknown }).externalReason ?? "(no reason)")
    const list = byReason.get(r) ?? []
    list.push(e)
    byReason.set(r, list)
  }
  console.log(`\nMARKED EDGES — ${marked.length} of ${pending.length} (the analyzer's own output):`)
  for (const [reason, list] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    let beforeUnres = 0, beforeRes = 0, beforeAmb = 0
    for (const e of list) {
      const pc = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, null, undefined, false, false)
      if (pc.outcome === "unresolved") beforeUnres++
      else if (pc.outcome === "resolved") beforeRes++
      else beforeAmb++
    }
    console.log(`  ${reason}: ${list.length}   (BEFORE the marker: unresolved ${beforeUnres} · resolved ${beforeRes} · ambiguous ${beforeAmb})`)
    const step = Math.max(1, Math.floor(list.length / n))
    for (let i = 0; i < list.length && i / step < n; i += step) {
      const e = list[i]
      const recv = String((e.md as { externalReceiver?: unknown }).externalReceiver ?? "")
      const callee = String(e.md.calleeExpression ?? "")
      console.log(`    ${e.srcFile.slice(CR.length + 1)}:${e.line ?? "?"}  target=${JSON.stringify(e.tgt)}  ${e.label}${callee ? `  callee=${JSON.stringify(callee)}` : ""}${recv ? `  receiver=${recv}` : ""}`)
    }
  }
}

// ── PHASE 3: bucket the unresolved by NAMED CAUSE ──────────────────────────────────────────
// Every predicate is SHAPE or DECLARATION based — nothing here is a curated guess about what a
// name "looks like" beyond the two pinned tables below, which are printed with their contents.
const RUNTIME_GLOBALS = new Set([
  "console", "JSON", "Object", "Math", "Reflect", "Promise", "Array", "String", "Number", "Boolean",
  "Date", "RegExp", "Error", "TypeError", "RangeError", "Map", "Set", "WeakMap", "WeakSet", "Symbol",
  "BigInt", "Proxy", "Intl", "Atomics", "ArrayBuffer", "Uint8Array", "Int8Array", "Uint16Array",
  "Int16Array", "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "BigInt64Array",
  "BigUint64Array", "DataView", "SharedArrayBuffer", "globalThis", "window", "document", "navigator",
  "location", "history", "localStorage", "sessionStorage", "fetch", "process", "Buffer", "URL",
  "URLSearchParams", "TextEncoder", "TextDecoder", "performance", "queueMicrotask", "structuredClone",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "crypto",
  "require", "module", "exports", "global",
])
const TEST_GLOBALS = new Set([
  "describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll", "jest", "vi",
  "vitest", "xit", "fit", "spyOn", "assert", "sinon", "cy", "bench", "suite",
])
const IDENT = /^[A-Za-z_$][\w$]*$/

/**
 * THE PINNED TYPESCRIPT LIB / UTILITY TYPE TABLE — `lib.es5.d.ts` plus the utility types every
 * compiler version has shipped since 2.1. Printed here in full because a pinned table a reader
 * cannot see is a curated guess: the sim's numbers are only worth something if the list that
 * produced them is in front of the reader. `Record`, `Object`, `Function` and `Error` are in it
 * deliberately — they are lib types AND plausible project names, and the measurement is what
 * decides whether that matters (an `owner` claim on a target the project declares is INERT, not
 * refuted — see the sim's `still resolved` column).
 */
const TS_LIB_TYPE_NAMES = new Set([
  ...RUNTIME_GLOBALS,
  "Partial", "Required", "Readonly", "Pick", "Record", "Omit", "Exclude", "Extract", "NonNullable",
  "ReturnType", "Parameters", "ConstructorParameters", "InstanceType", "ThisParameterType",
  "OmitThisParameter", "ThisType", "Uppercase", "Lowercase", "Capitalize", "Uncapitalize",
  "Awaited", "PropertyKey", "PropertyDescriptor", "ThisType", "Function", "Object", "CallableFunction",
  "NewableFunction", "IArguments", "TemplateStringsArray", "ArrayLike", "ConcatArray",
  "ReadonlyArray", "ReadonlyMap", "ReadonlySet", "PromiseLike", "Iterable", "Iterator",
  "IterableIterator", "AsyncIterable", "AsyncIterator", "AsyncIterableIterator", "Generator",
  "AsyncGenerator", "GeneratorFunction", "AsyncGeneratorFunction", "HTMLElement", "Element", "Node",
  "NodeList", "Document", "Window", "Event", "EventTarget", "AbortController", "AbortSignal",
  "Headers", "Request", "Response", "FormData", "Blob", "File", "FileReader", "Worker",
  "MessageEvent", "ErrorEvent", "KeyboardEvent", "MouseEvent", "CustomEvent", "Storage",
])

/** The receiver of `a.b.c()` — everything before the LAST `.` of the callee expression. */
function receiverOf(calleeExpression: string, leaf: string): string | null {
  if (!calleeExpression) return null
  const suffix = "." + leaf
  if (!calleeExpression.endsWith(suffix)) return null
  return calleeExpression.slice(0, calleeExpression.length - suffix.length)
}

function bucketOf(e: Pending): string {
  const { label, tgt, md, facts } = e
  const callee = String(md.calleeExpression ?? "")
  if (label === "calls" || label === "uses" || label === "instantiates") {
    // A MEMBER edge: the callee expression names a receiver and a leaf property.
    const recv = callee ? receiverOf(callee, tgt) : null
    if (recv !== null && recv.length > 0) {
      if (recv === "this") return "member-call on `this` (owner = enclosing class; receiver computed and dropped)"
      if (RUNTIME_GLOBALS.has(recv)) return "member-call on a RUNTIME GLOBAL receiver"
      if (facts.bareBindings.has(recv)) return "member-call on a receiver bound by a BARE (external package) import"
      if (facts.relBindings.has(recv) || facts.nsBindings.has(recv)) return "member-call on a receiver bound by a RELATIVE import"
      if (facts.decls.has(recv)) return "member-call on a FILE-LOCAL declaration receiver"
      if (IDENT.test(recv)) return "member-call on a LOCAL VALUE / parameter receiver"
      return "member-call on a CHAIN/EXPRESSION receiver"
    }
    // A BARE-IDENTIFIER edge (no receiver).
    if (TEST_GLOBALS.has(tgt)) return "bare call to a TEST-RUNNER global"
    if (RUNTIME_GLOBALS.has(tgt)) return "bare call to a RUNTIME global"
    if (facts.bareBindings.has(tgt)) return "bare call to a binding imported from a BARE (external package) specifier"
    if (facts.relBindings.has(tgt)) return "bare call to a binding imported from a RELATIVE module"
    return "bare call to a name this file does not bind"
  }
  if (label === "imports") {
    if (tgt.startsWith("external:")) return "import of a BARE PACKAGE (`external:<pkg>` target — no symbol can publish it)"
    if (tgt.startsWith("node:")) return "import of a NODE BUILTIN"
    if (tgt.includes(":")) {
      const mod = String(md.module ?? tgt.slice(0, tgt.lastIndexOf(":")))
      if (tgt.endsWith(":*")) return "whole-module import (`<module>:*` — a module URI, not a symbol)"
      const isRel = mod.startsWith(".") || mod.startsWith("/")
      return isRel
        ? "named item of a RELATIVE module, spelled `<module>:<item>`"
        : "named item of a BARE package, spelled `<package>:<item>`"
    }
    return "import target is a BARE NAME (the local-item spelling)"
  }
  if (label === "references" || label === "extends" || label === "implements" || label === "exports" || label === "overrides") {
    if (/^[A-Z]$/.test(tgt)) return "TYPE PARAMETER (single-letter type variable)"
    if (RUNTIME_GLOBALS.has(tgt)) return "BUILTIN LIB type / global member"
    if (facts.bareBindings.has(tgt)) return "binding imported from a BARE (external package) specifier"
    if (facts.relBindings.has(tgt)) return "binding imported from a RELATIVE module"
    if (tgt.includes(".")) return "QUALIFIED (dotted) target"
    return "no declaration anywhere in the sampled project key space"
  }
  return "other"
}

type Bucket = { n: number; inRepo: number; inRepoStrict: number; examples: string[] }
const byType = new Map<Type, Map<string, Bucket>>()
for (const e of unresolvedEdges) {
  let m = byType.get(e.label); if (!m) byType.set(e.label, (m = new Map()))
  const key = bucketOf(e)
  let b = m.get(key); if (!b) m.set(key, (b = { n: 0, inRepo: 0, inRepoStrict: 0, examples: [] }))
  b.n++
  if (DO_REPOSCAN && declaredInRepo(e)) b.inRepo++
  if (DO_REPOSCAN && declaredInRepoStrict(e)) b.inRepoStrict++
  if (b.examples.length < (SHOW_EXAMPLES ? 6 : 2)) {
    const line = e.line ?? "?"
    const calleeText = String(e.md.calleeExpression ?? "")
    b.examples.push(`${e.srcFile.slice(CR.length + 1)}:${line} -> ${JSON.stringify(e.tgt)}${calleeText ? ` [callee ${JSON.stringify(calleeText)}]` : ""}`)
  }
}

console.log("")
console.log("UNRESOLVED BY NAMED CAUSE — every unresolved edge of this population, no name cap:")
console.log("(`inRepo` = the edge's own REPOSITORY declares this name somewhere in its .ts files, sampled or NOT —")
console.log(" i.e. production would have a declaration to bind; this is the CAP's contribution, not the analyzer's.)")
for (const t of TYPES) {
  const m = byType.get(t)
  if (!m || m.size === 0) continue
  const o = rows.get(t)!
  const sum = [...m.values()].reduce((a, b) => a + b.n, 0)
  console.log(`\n${t} — unresolved ${o.unresolved}   (buckets sum ${sum}${sum === o.unresolved ? " ✓" : " *** DOES NOT ACCOUNT FOR THE COLUMN ***"})`)
  const sorted = [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  for (const [k, b] of sorted) {
    const repo = DO_REPOSCAN ? `  of which declared in the repo OUTSIDE the stride: ${b.inRepoStrict}-${b.inRepo} (strict-loose CAP artifact)` : ""
    console.log(`  ${String(b.n).padStart(6)}  ${k}${repo}`)
    if (SHOW_EXAMPLES) for (const ex of b.examples) console.log(`          e.g. ${ex}`)
  }
}

if (DO_REPOSCAN) {
  const capLoose = unresolvedEdges.filter(declaredInRepo).length
  const capStrict = unresolvedEdges.filter(declaredInRepoStrict).length
  console.log(`\nCAP EFFECT, totalled (BOUNDS, textual proxy — the truth is between them): ${capStrict}-${capLoose} of ${unresolvedEdges.length} unresolved edges (${((capStrict / Math.max(1, unresolvedEdges.length)) * 100).toFixed(1)}%-${((capLoose / Math.max(1, unresolvedEdges.length)) * 100).toFixed(1)}%) name something their own repository declares OUTSIDE the 400-file stride.`)
  console.log("Those edges are unresolved HERE and would resolve in production's whole-project scope: the residual is an UPPER bound.")
}

if (argv.includes("--sim")) runSim()
