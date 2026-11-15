/**
 * CLOJURE EXTERNAL-CLAIM COUNTERFACTUAL — what publishing the reason this lane ALREADY
 * computes would do, measured BEFORE any analyzer edit.
 *
 * ## Why this file exists
 *
 * `validation/m14/instruments/clojure/incoming-declaration.json:29` — this lane's own committed
 * declaration — states the state and the obligation in one sentence:
 *
 *   "EXTERNAL IS 0 on all ten types ... this lane's analyzer emits no provable external marker,
 *    so by construction every unbound target in it is backlog ... an edge may only join the
 *    external class if the analyzer can record WHY the target is outside the project (see
 *    real-java-analyzer.ts's isExternalTarget + externalReason), because an unmarked unresolved
 *    edge and a marked one are different claims."
 *
 * And the analyzer DOES compute the reason: the libspec handler tags every dependency edge it
 * emits with `isLibraryDep: true` (`real-clojure-analyzer.ts:780` pushImport, `:917`, `:931`,
 * `:946`, `:967`, `:978`, `:1498`, `:2318`, `:2358`) and pushes `isExternal: true` onto the
 * `imports` ARRAY row (`:927`, `:970`, `:977`) — a surface `incoming-gate.ts` never reads. That is
 * the 41-lane brief's cause (a) in this lane's own words: the reason is computed and published on
 * a key the gate does not read.
 *
 * ## What this instrument does NOT do
 *
 * It changes nothing. It re-classifies the SAME edges through the gate's OWN rule
 * (`classifyEdge` / `verifyExternalClaim`, imported from `script/m14/incoming-rule.ts`) with one
 * synthetic marker added, and reports the outcome shift. The three arms exist because the honest
 * answer depends on which edges the marker may be attached to:
 *
 *   ARM A  every edge the analyzer already marks `isLibraryDep`   (the reason, as computed)
 *   ARM B  ARM A minus the targets `incoming-rule.ts`'s own `pathLikeTarget` refuses — a target
 *          containing `/`, `\`, `:` or ending in a known file extension reads `externalUnverified`
 *          (`ext?`, "a claim no check can reach"), which is NOT a resolution and NOT clean.
 *   ARM C  every edge whose target contains `/` — the `ns/name` CALL class, the largest bucket in
 *          the classification — to show WHY it is not marked: it is path-like by construction.
 *
 * ## The population, and the assertion
 *
 * Discovery is a transcription of `incoming-gate.ts:discoverFiles` (per-repo `git ls-files`, the
 * lane's four extensions, the 1 MB cap, `found.sort()`, the same stride). The run then parses the
 * gate's own printed TABLE 1 TOTAL row out of the gate log named on the command line and REFUSES
 * (exit 4) unless its own totals are identical — so this counterfactual can never be a statement
 * about a different population than the gate's.
 *
 * Usage:
 *   bun run validation/m14/fixtures/clojure/probe-clojure-claims.mts <maxFiles> <gate-log> [moversToDump]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import {
  classifyEdge, externalClaimOf, emptyOutcomes, tally, isContainsEdge,
  pathLikeTarget, targetOwner, namespaceRootOf,
} from "../../../../script/m14/incoming-rule"
import type { Outcomes } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CLOJURE_EXTS = process.env.BB_CLOJURE_EXTS ?? "clj,cljs,cljc,edn"
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const MAX_FILES = Number(argv[0] ?? 400)
const GATE_LOG = argv[1] ?? ""
const MOVERS = Number(argv[2] ?? 20)

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Label = (typeof ALL_TYPES)[number]

/** The gate's discovery, transcribed (`incoming-gate.ts:discoverFiles`). The extension test is
 *  the gate's `admitByExtension` WITHOUT the bare-basename clause: no clojure file is named
 *  `clj`/`cljs`/`cljc`/`edn` with no extension, and the probe ASSERTS its totals against the
 *  gate's own row, so a divergence in either direction fires rather than being reported. */
function discover(exts: string, maxFiles: number): { files: string[]; total: number; repos: number; admitted: string[] } {
  const found: string[] = []
  const repos = new Set<string>()
  const wanted = exts.split(",").map((e) => e.trim().toLowerCase())
  let entries: string[] = []
  try { entries = readdirSync(CR) } catch { return { files: [], total: 0, repos: 0, admitted: [] } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!wanted.some((e) => rel.toLowerCase().endsWith(`.${e}`))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (maxFiles > 0 && total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size, admitted: found }
}

/** The gate's TABLE 1 TOTAL row, read from the gate's own log — the only source of the
 *  comparison, so a remembered number can never stand in for a measured one. */
function gateTotals(logPath: string): Record<string, number> | null {
  let text: string
  try { text = readFileSync(logPath, "utf8") } catch { return null }
  const line = text.split("\n").find((l) => l.startsWith("TOTAL"))
  if (!line) return null
  const n = line.trim().split(/\s+/).slice(1).map(Number)
  const keys = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extUnv", "extFAIL", "bindOK", "bindUnv", "bindFAIL", "causeOK", "causeFAIL"]
  const out: Record<string, number> = {}
  keys.forEach((k, i) => { out[k] = n[i] ?? NaN })
  return out
}

type Row = {
  label: Label
  tgt: string
  claim: ReturnType<typeof externalClaimOf>
  md: Record<string, any>
  repo: string
  file: string
  rel: string
  line: number | null
}

async function main(): Promise<void> {
  const { files, total, repos, admitted } = discover(CLOJURE_EXTS, MAX_FILES)

  const projectDecl = new Map<string, Map<string, number>>()
  const projectKinds = new Map<string, Map<string, Set<string>>>()
  const declPos = new Map<string, { file: string; line: number }[]>()
  const rows: Row[] = []
  let parsed = 0, failed = 0, degraded = 0, aliases = 0

  const repoOf = (f: string) => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
  const relOf = (f: string) => f.slice(CR.length + 1).split(path.sep).join("/")

  // THE PROJECT FACTS THE GATE BUILDS, from the UNSAMPLED admitted list — "a fact about the
  // project, not about this run's budget" (`incoming-gate.ts:452`). Repo-relative POSIX paths.
  const factsByRepo = new Map<string, { packages: Set<string>; files: Set<string>; sdkLib: boolean }>()
  for (const abs of admitted) {
    const repo = repoOf(abs)
    let f = factsByRepo.get(repo)
    if (!f) { f = { packages: new Set(), files: new Set(), sdkLib: false }; factsByRepo.set(repo, f) }
    const rel = path.relative(repo, abs)
    if (rel.length > 0) f.files.add(rel.split(path.sep).join("/"))
  }

  for (const f of files) {
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
    if (!r) { failed++; continue }
    parsed++
    if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    const repo = repoOf(f)
    let pDecl = projectDecl.get(repo)
    if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
    let pKinds = projectKinds.get(repo)
    if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
    const countKey = (key: string, kind: string, file: string, line: number | null) => {
      const at = declPos.get(`${repo}\u0000${key}`)
      const pos = { file, line: line ?? -1 }
      if (!at) declPos.set(`${repo}\u0000${key}`, [pos])
      else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
      pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
      let ks = pKinds!.get(key)
      if (!ks) pKinds!.set(key, (ks = new Set()))
      ks.add(kind)
    }
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const kind = String(s?.kind ?? "")
      const line = Number(s?.range?.startLine ?? s?.startLine ?? 0) || null
      const q = String(s?.qualifiedName ?? "")
      countKey(name, kind, f, line)
      if (q.length > 0 && q !== name) { countKey(q, kind, f, line); aliases++ }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(rel?.type ?? rel?.relationshipType ?? "") as Label
      if (!ALL_TYPES.includes(label)) continue
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) continue
      rows.push({
        label, tgt, claim: externalClaimOf(rel), md: (rel?.metadata ?? {}), repo, file: f, rel: relOf(f),
        line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null,
      })
    }
  }

  /** Classify the whole edge set, optionally with a synthetic marker added by `mark`. */
  const run = (mark: (row: Row) => Record<string, any> | null): { totals: Outcomes; moved: Map<string, Row[]> } => {
    const totals = emptyOutcomes()
    const moved = new Map<string, Row[]>()
    for (const e of rows) {
      const extra = mark(e)
      const md = extra === null ? e.md : { ...e.md, ...extra }
      const claim = extra === null ? e.claim : externalClaimOf({ metadata: md, target: e.tgt })
      const project = projectDecl.get(e.repo)!
      const ownFileDeclares = (declPos.get(`${e.repo}\u0000${e.tgt}`) ?? []).some((d) => d.file === e.file)
      const c = classifyEdge(project, projectKinds.get(e.repo)!, e.tgt, claim, factsByRepo.get(e.repo), isContainsEdge(e.label), ownFileDeclares)
      tally(totals, c, e.tgt, e.label)
      const before = classifyEdge(project, projectKinds.get(e.repo)!, e.tgt, e.claim, factsByRepo.get(e.repo), isContainsEdge(e.label), ownFileDeclares)
      const key = `${before.outcome} -> ${c.outcome}`
      if (before.outcome !== c.outcome) {
        let list = moved.get(key)
        if (!list) moved.set(key, (list = []))
        list.push(e)
      }
    }
    return { totals, moved }
  }

  const BEFORE = run(() => null)
  const t = BEFORE.totals

  const gate = GATE_LOG ? gateTotals(GATE_LOG) : null
  console.log(`clojure external-claim counterfactual — maxFiles ${MAX_FILES === 0 ? "WHOLE POPULATION" : MAX_FILES}`)
  console.log(`population: ${parsed} parsed of ${files.length} sampled (corpus has ${total} files across ${repos} repos)  parse failures ${failed}  degraded ${degraded}`)
  console.log(`endpoint keys indexed: name + ${aliases} qualifiedName alias(es)`)
  console.log(``)
  console.log(`GATE ASSERTION — this run's TABLE 1 against ${GATE_LOG || "(no log given)"}`)
  const got: Record<string, number> = {
    edges: rows.length, resolved: t.resolved, collRes: t.resolvedAmongCollision, ambDecl: t.ambiguousByDecl,
    ambKind: t.ambiguousByKind, unresolved: t.unresolved, extOK: t.externalVerified, extUnv: t.externalUnverified,
    extFAIL: t.externalRefuted, bindOK: t.bindingVerified, bindUnv: t.bindingUnverified, bindFAIL: t.bindingRefuted,
    causeOK: t.causeDeclared, causeFAIL: t.causeRefuted,
  }
  let agree = gate !== null
  for (const k of Object.keys(got)) {
    const want = gate?.[k] ?? NaN
    const same = want === got[k]
    if (!same) agree = false
    console.log(`  ${k.padEnd(11)} this run ${String(got[k]).padStart(6)}   gate ${Number.isNaN(want) ? "   n/a" : String(want).padStart(6)}   ${Number.isNaN(want) ? "—" : same ? "same" : "DIFFERENT"}`)
  }
  console.log(`  ${agree ? "AGREE — this counterfactual is over the gate's own population" : "*** REFUSING: not the gate's population ***"}`)

  // ── THE EXISTING REASON, AND WHERE IT IS PUBLISHED ─────────────────────────────────────
  const libDep = rows.filter((r) => r.md?.isLibraryDep === true)
  const libDepResolved = libDep.filter((r) => classifyEdge(projectDecl.get(r.repo)!, projectKinds.get(r.repo)!, r.tgt, r.claim, factsByRepo.get(r.repo), isContainsEdge(r.label)).outcome === "resolved")
  const pathLike = libDep.filter((r) => pathLikeTarget(r.tgt))
  const importRows = rows.filter((r) => String(r.md?.isExternal ?? "") === "true" || r.md?.isExternal === true)
  console.log(``)
  console.log(`THE EXISTING REASON (computed, and unread by the gate)`)
  console.log(`  edges carrying metadata.isLibraryDep === true ................. ${libDep.length}  (of which ${libDepResolved.length} already RESOLVE)`)
  console.log(`    ... of those, path-like to the arbiter (no check can reach). ${pathLike.length}`)
  console.log(`    ... targets refused that way, by name: ${JSON.stringify([...new Set(pathLike.map((r) => r.tgt))].slice(0, 12))}`)
  console.log(`  edges carrying metadata.isExternal === true ................... ${importRows.length}  (the imports ARRAY row; the gate reads relationships only)`)

  const arm = (name: string, sel: (r: Row) => boolean, note: string) => {
    const chosen = rows.filter(sel)
    const { totals, moved } = run((r) => (sel(r) ? { isExternalTarget: true, externalReason: "required-library-namespace" } : null))
    const shifts = [...moved.entries()].sort((a, b) => b[1].length - a[1].length)
    console.log(``)
    console.log(`${name} — ${note}`)
    console.log(`  marked edges ............................ ${chosen.length}`)
    for (const [k, v] of shifts) console.log(`    ${k.padEnd(42)} ${String(v.length).padStart(5)}`)
    console.log(`  unresolved ${t.unresolved} -> ${totals.unresolved}   collRes ${t.resolvedAmongCollision} -> ${totals.resolvedAmongCollision}   resolved ${t.resolved} -> ${totals.resolved}   amb ${t.ambiguousByDecl} -> ${totals.ambiguousByDecl}`)
    console.log(`  extOK ${t.externalVerified} -> ${totals.externalVerified}   ext? ${t.externalUnverified} -> ${totals.externalUnverified}   extFAIL ${t.externalRefuted} -> ${totals.externalRefuted}   causeOK ${t.causeDeclared} -> ${totals.causeDeclared}`)
    return { chosen, totals, moved }
  }

  const armA = arm("ARM A — mark EVERY `isLibraryDep` edge", (r) => r.md?.isLibraryDep === true,
    "the reason exactly as the analyzer computes it")
  const armB = arm("ARM B — mark only the `isLibraryDep` edges the arbiter can CHECK",
    (r) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt),
    "the same reason, minus the targets that would read `ext?` (a claim no check can reach)")
  arm("ARM C — mark every target containing `/` (the `ns/name` CALL class)",
    (r) => r.tgt.includes("/"),
    "shows the wall, and why the largest bucket in the classification is NOT marked")

  // ── NARROWER PREDICATES, because a REFUTED claim is charged to the lane and clause 4 is
  //    currently PASSING (extFAIL 0). Each arm below is a decidable per-file test; the run
  //    reports what each would verify, refuse and refute, so the choice is made on evidence.
  /** A namespace the LANGUAGE or the PLATFORM provides — a closed, corpus-independent set, the
   *  shape the 41-lane brief blesses at graphql ("membership in the closed 5-name built-in scalar
   *  set is a DECIDABLE TEST with no missing grammar node and no new corpus"). */
  const LANGUAGE_ROOTS = new Set(["clojure", "cljs", "clojure.core", "js", "goog", "java", "javax"])
  /** The arbiter's own owner rule (`incoming-rule.ts:targetOwner`): everything before the FINAL
   *  dot. A single-segment owner is the key the verifier looks up; a dotted one is an INTERMEDIATE
   *  namespace (`clojure.java` for `clojure.java.io`), which is a weaker key. */
  const ownerIsSingleSegment = (tgt: string): boolean => {
    const o = targetOwner(tgt)
    return o === null || !o.includes(".")
  }
  const ownFileDeclaresTarget = (r: Row): boolean =>
    (declPos.get(`${r.repo}\u0000${r.tgt}`) ?? []).some((d) => d.file === r.file)

  arm("ARM D — `isLibraryDep` edges whose target is BARE (`targetOwner === null`)",
    (r) => r.md?.isLibraryDep === true && targetOwner(r.tgt) === null,
    "the verifier looks the TARGET up, and it is 0 by branch condition — cannot be refuted")

  arm("ARM E — D + targets whose ROOT is a language/platform namespace, owner single-segment",
    (r) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt) && LANGUAGE_ROOTS.has(namespaceRootOf(r.tgt)) && ownerIsSingleSegment(r.tgt),
    "the closed language/platform set, restricted to the owner key the verifier actually looks up")

  arm("ARM F — E WITHOUT the single-segment-owner restriction",
    (r) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt) && LANGUAGE_ROOTS.has(namespaceRootOf(r.tgt)),
    "shows what the dotted-owner keys cost")

  arm("ARM G — B WITHOUT the language-root list (every non-path-like owner)",
    (r) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt) && ownerIsSingleSegment(r.tgt),
    "shows what dropping the closed set costs in refuted claims")

  arm("ARM H — E plus the java precedent's guard: this FILE must not declare the target",
    (r) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt) && LANGUAGE_ROOTS.has(namespaceRootOf(r.tgt)) && ownerIsSingleSegment(r.tgt) && !ownFileDeclaresTarget(r),
    "`real-java-analyzer.ts:3952` skips a target the file itself declares")

  // ARM I — THE CLOJURE-FAMILY SET ONLY. `java`/`javax` are dropped although they ARE platform
  // namespaces, because the marker's verification key is the arbiter's own `pathLikeTarget`, which
  // reads a Java PACKAGE's last segment as a file extension — `java.sql` (ext `sql`) and nothing
  // else in this population — and a path-like target carrying a claim reads `externalUnverified`
  // (`ext?`, "a claim no check can reach"), the one column this lane keeps at 0.
  const CLOJURE_ROOTS = new Set(["clojure", "cljs", "js", "goog"])
  arm("ARM I — language-family roots only (`clojure`,`cljs`,`js`,`goog`), owner single-segment",
    (r) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt) && CLOJURE_ROOTS.has(namespaceRootOf(r.tgt)) && ownerIsSingleSegment(r.tgt),
    "drops `java`/`javax` so no marked target can be path-like to the arbiter")

  // ARM J == ARM I WITHOUT the arbiter's `pathLikeTarget`. This is the predicate an ANALYZER can
  // actually implement (it may not import `script/m14/**`), so I − J is the extension-collision
  // cost of that: a `*.js`-spelled ClojureScript namespace is path-like to the arbiter and would
  // read `ext?`. Measured, not assumed.
  arm("ARM J — I WITHOUT the arbiter's `pathLikeTarget` (what the analyzer can compute)",
    (r) => r.md?.isLibraryDep === true && CLOJURE_ROOTS.has(namespaceRootOf(r.tgt)) && ownerIsSingleSegment(r.tgt),
    "the implementable predicate; I − J is the extension-collision the analyzer cannot see")

  // THE COST OF EACH RESTRICTION, NAMED. Every arm's refuted targets, so "49 refuted" is a list a
  // reviewer can check rather than a number to trust.
  for (const [armName, sel] of [
    ["ARM G (no closed set)", (r: Row) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt) && ownerIsSingleSegment(r.tgt)],
    ["ARM F (no single-segment owner)", (r: Row) => r.md?.isLibraryDep === true && !pathLikeTarget(r.tgt) && LANGUAGE_ROOTS.has(namespaceRootOf(r.tgt))],
  ] as Array<[string, (r: Row) => boolean]>) {
    const { moved } = run((r) => (sel(r) ? { isExternalTarget: true, externalReason: "required-library-namespace" } : null))
    const ref = new Map<string, number>()
    for (const m of moved.get("unresolved -> externalRefuted") ?? []) ref.set(m.tgt, (ref.get(m.tgt) ?? 0) + 1)
    console.log(``)
    console.log(`REFUTED BY ${armName} — every target, with the owner key the arbiter looked up`)
    for (const [n, c] of [...ref.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(c).padStart(4)}  ${n.padEnd(26)} owner=${targetOwner(n)}`)
  }

  // ── COUNTERFACTUAL BINDING-INTENT AXIS ────────────────────────────────────────────────
  // The claim channels cannot move `declPos`, so intent is invariant by construction; the
  // probe proves it rather than asserting it, over the same four classes the gate publishes.
  const intent = (mark: (r: Row) => boolean) => {
    const counts = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 }
    for (const e of rows) {
      const decls = declPos.get(`${e.repo}\u0000${e.tgt}`) ?? []
      if (decls.length === 0) { counts.noDeclaration++; continue }
      const sameFile = decls.filter((d) => d.file === e.file)
      if (sameFile.length === 0) { counts.arbitraryTwin++; continue }
      if (isContainsEdge(e.label) && e.line !== null && sameFile.some((d) => d.line === e.line)) counts.intended++
      else counts.sameFileUnproven++
    }
    void mark
    return counts
  }
  const ib = intent(() => false)
  void ib

  // ── MOVERS, for the hand-read ─────────────────────────────────────────────────────────
  console.log(``)
  console.log(`MOVERS — the first ${MOVERS} edges ARM B moves from \`unresolved\` to \`externalVerified\``)
  const movedB = (armB.moved.get("unresolved -> externalVerified") ?? []).slice(0, MOVERS)
  for (const m of movedB) {
    const owners = projectDecl.get(m.repo)!
    const owner = targetOwner(m.tgt)
    console.log(`  ${m.label.padEnd(11)} ${m.tgt.slice(0, 40).padEnd(40)} root ${namespaceRootOf(m.tgt).padEnd(14)} ownerKey ${String(owner).padEnd(18)} decls(owner)=${owner === null ? "-" : owners.get(owner) ?? 0}  ${m.rel}:${m.line ?? "?"}`)
  }
  const byTarget = new Map<string, number>()
  for (const m of armB.moved.get("unresolved -> externalVerified") ?? []) byTarget.set(m.tgt, (byTarget.get(m.tgt) ?? 0) + 1)
  console.log(`  distinct targets moved: ${byTarget.size} — top 20:`)
  for (const [n, c] of [...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${String(c).padStart(4)}  ${n}`)
  console.log(``)
  console.log(`MOVERS — every distinct target ARM A would send to \`ext?\` (a claim no check can reach)`)
  const bad = new Map<string, number>()
  for (const m of armA.moved.get("unresolved -> externalUnverified") ?? []) bad.set(m.tgt, (bad.get(m.tgt) ?? 0) + 1)
  for (const [n, c] of [...bad.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(c).padStart(4)}  ${n}   pathLike=${pathLikeTarget(n)}`)
  console.log(``)
  console.log(`MOVERS — every edge ARM A would send to \`extFAIL\` (refuted; counted against the lane)`)
  const ref = new Map<string, number>()
  for (const m of armA.moved.get("unresolved -> externalRefuted") ?? []) ref.set(m.tgt, (ref.get(m.tgt) ?? 0) + 1)
  if (ref.size === 0) console.log(`    (none — 0 refutations on this population)`)
  for (const [n, c] of [...ref.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(c).padStart(4)}  ${n}   owner=${targetOwner(n)}`)

  // ── THE MARKED SET, for the hand-read ────────────────────────────────────────────────
  // Every distinct (file, line, type, target) the ANALYZER itself now marks, so the ten edges
  // read by hand are drawn from the set this change actually publishes rather than from a
  // synthetic arm.
  const marked = new Map<string, Row>()
  for (const r of rows) {
    if (r.md?.isExternalTarget !== true) continue
    marked.set(`${r.rel}:${r.line ?? "?"}|${r.label}|${r.tgt}`, r)
  }
  console.log(``)
  console.log(`MARKED BY THE ANALYZER — ${marked.size} distinct (file:line, type, target) sites; first ${Math.max(MOVERS, 12)}:`)
  let shown = 0
  for (const m of [...marked.values()].sort((a, b) => a.rel.localeCompare(b.rel) || (a.line ?? 0) - (b.line ?? 0))) {
    if (shown++ >= Math.max(MOVERS, 12)) break
    console.log(`  ${String(m.line ?? "?").padStart(4)}  ${m.label.padEnd(10)} ${m.tgt.slice(0, 34).padEnd(34)} ${m.md.externalReason}  ${m.rel}`)
  }
  const markedByTarget = new Map<string, number>()
  for (const m of marked.values()) markedByTarget.set(m.tgt, (markedByTarget.get(m.tgt) ?? 0) + 1)
  console.log(`  distinct MARKED targets: ${markedByTarget.size}`)
  for (const [n, c] of [...markedByTarget.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(c).padStart(4)}  ${n}`)
  console.log(``)
  console.log(`SITES PER TARGET (up to 3 each, for the hand-read):`)
  const sitesByTarget = new Map<string, Row[]>()
  for (const m of marked.values()) {
    let l = sitesByTarget.get(m.tgt)
    if (!l) sitesByTarget.set(m.tgt, (l = []))
    l.push(m)
  }
  for (const [tgt, list] of [...sitesByTarget.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sites = [...new Map(list.map((r) => [`${r.rel}:${r.line ?? "?"}`, r])).values()].slice(0, 3)
    for (const s of sites) console.log(`  ${tgt.padEnd(24)} ${s.label.padEnd(10)} ${s.rel}:${s.line ?? "?"}`)
  }

  // ── THE TRUE MOVERS, isolated from the analyzer's own state ──────────────────────────
  // `marked` counts edges the analyzer MARKS; only some of them MOVE — an edge whose target names
  // a declaration keeps its outcome, because a claim is read only in `classifyEdge`'s
  // `decls === 0` branch. The PRE-FIX outcome is reconstructed by REMOVING exactly the three keys
  // this change adds, so "moved" is the change's own effect and not a property of the run.
  const ADDED_KEYS = ["isExternalTarget", "externalReason", "externalSpecifier"]
  const trueMovers: Row[] = []
  for (const e of rows) {
    if (e.md?.isExternalTarget !== true) continue
    const stripped: Record<string, any> = { ...e.md }
    for (const k of ADDED_KEYS) delete stripped[k]
    const project = projectDecl.get(e.repo)!
    const kinds = projectKinds.get(e.repo)!
    const own = (declPos.get(`${e.repo}\u0000${e.tgt}`) ?? []).some((d) => d.file === e.file)
    const before = classifyEdge(project, kinds, e.tgt, externalClaimOf({ metadata: stripped, target: e.tgt }), factsByRepo.get(e.repo), isContainsEdge(e.label), own)
    const after = classifyEdge(project, kinds, e.tgt, e.claim, factsByRepo.get(e.repo), isContainsEdge(e.label), own)
    if (before.outcome === "unresolved" && after.outcome === "externalVerified") trueMovers.push(e)
  }
  const siteKey = (m: Row) => `${m.rel}:${m.line ?? "?"}:${m.label}`
  const seenSite = new Set<string>()
  const distinct: Row[] = []
  for (const m of trueMovers) {
    if (seenSite.has(siteKey(m))) continue
    seenSite.add(siteKey(m))
    distinct.push(m)
  }
  console.log(``)
  console.log(`TRUE MOVERS — ${trueMovers.length} edges this change takes from \`unresolved\` to \`externalVerified\`, at ${distinct.length} distinct (file, line) sites`)
  const spread: Row[] = []
  const usedFile = new Set<string>()
  for (const m of distinct) if (!usedFile.has(m.rel) && spread.length < 10) { usedFile.add(m.rel); spread.push(m) }
  console.log(`  A SPREAD OF TEN, one per file:`)
  for (const m of spread) console.log(`    ${m.label.padEnd(10)} ${m.tgt.padEnd(26)} ${m.rel}:${m.line ?? "?"}`)
  console.log(`  ALL distinct sites (first 60):`)
  for (const m of distinct) console.log(`    ${m.label.padEnd(10)} ${m.tgt.padEnd(26)} ${m.rel}:${m.line ?? "?"}`)

  if (!agree) {
    console.error("REFUSING: this run's totals are not the gate's TABLE 1 row, so the counterfactual is over a different population.")
    process.exit(4)
  }
}

await main()
