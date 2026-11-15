/**
 * CLOJURE INCOMING CLASSIFY — the split of the gate's `ambiguousByDecl` / `unresolved`
 * numbers into classes that have different owners.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-gate.ts` answers ONE question per lane — does every emitted edge
 * resolve to exactly one declaration in its own project — and at the whole admitted
 * population it answers NO for clojure:
 *
 *   npx tsx script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0
 *   VERDICT: FAIL — 4278 ambiguous + 19220 unresolved of 43454 edges
 *
 * A single number cannot be acted on, because it mixes findings with different owners: a
 * spelling the analyzer TARGETS but does not PUBLISH (fixable), a name two namespaces
 * genuinely both declare (a language fact), a JVM class or static member no Clojure corpus
 * carries (external), and a clojure.core name the suppression gate should have caught (a
 * defect). This file buys the split.
 *
 * ## The counting rule is IMPORTED, not copied
 *
 * `classifyEdge` / `tally` come from `script/m14/incoming-rule.ts` — the module the arbiter
 * itself imports — so this census cannot drift from the gate it explains. What this file
 * adds is FACTS ABOUT THE COUNTED THING: who declares the name, whether the edge's own file
 * declares it, and whether a declaration with that NAME exists under the qualifier the
 * target spells (the fixable class) or elsewhere.
 *
 * ## The population is the GATE's, replicated and asserted
 *
 * Discovery is a transcription of `discoverFiles` in `incoming-gate.ts`: whole-corpus
 * `git ls-files` per checkout, the lane's admitted extensions, the same 1 MB cap, the same
 * `found.sort()` and the same stride. It is replicated rather than imported because the gate
 * does not export it — and replication is only safe because the run ASSERTS its totals
 * against the gate's own printed line for the same `maxFiles`. If the two ever disagree the
 * run FAILS (`GATE COMPARISON`, exit 4) instead of printing a classification of a different
 * population. Run with `maxFiles 0` for the whole admitted population.
 *
 * ## The classes, and why the precedence is stated
 *
 * AMBIGUOUS (the project publishes the name more than once). The actionable question is
 * whether the EDGE'S OWN FILE declares it, because both resolvers put the edge's own file
 * FIRST — `resolveTargetStmt` / `resolveContainsTargetStmt` are `ORDER BY (s.file_id = ?)
 * DESC, … LIMIT 1` — so a collision is DETERMINATE whenever the edge's own file declares the
 * name exactly once. The gate cannot see that (it is handed a name-keyed count and no file);
 * this file can:
 *
 *   AMB-OWN-FILE-ONE     the edge's own file declares it exactly once → production's own
 *                        preference picks it and no tie-break is involved.
 *   AMB-OWN-FILE-MULTI   the edge's own file declares it 2+ times → a real same-file
 *                        collision (Clojure allows redefinition).
 *   AMB-CROSS-FILE       the edge's own file declares it nowhere → two namespaces both
 *                        declare the name and a bare target cannot say which. Respelling the
 *                        edge to `<ns>/<name>` would name exactly one — CLJ-IN2, sized here.
 *
 * UNRESOLVED (the target names no declaration in the project). Precedence QUAL > DOT/ARROW >
 * BARE, because a target carrying `/` or `.` must be read the way the language spells it
 * before any bare-name question is asked:
 *
 *   QUAL-NAME-IN-NS      `<ns>/<name>` and the project DOES declare `<name>` in `<ns>` — the
 *                        declaration exists and the edge names it correctly; what is missing
 *                        is that the DECLARATION's published key is the dot form
 *                        (`pool-worker.ts:1228` falls back to `${scope}.${name}`). Fixable:
 *                        publish the language's own `ns/name` as the symbol's `qualifiedName`
 *                        and every one of these resolves. (CLJ-IN1)
 *   QUAL-NAME-ELSEWHERE  `<ns>/<name>`, `<name>` declared elsewhere in the project — the
 *                        qualifier is an alias the analyzer could not map, or a sub-namespace
 *                        that is not a file in this corpus.
 *   QUAL-STATIC-INTEROP  `<Class>/<member>`, `<Class>` capitalised and `<name>` declared
 *                        nowhere: a JVM static (`System/getenv`, `Integer/valueOf`,
 *                        `Instant/now`). A Clojure corpus does not declare `java.lang.System`.
 *   QUAL-EXTERNAL        `<lib>/<name>` with a non-capitalised qualifier, `<name>` declared
 *                        nowhere: a library this corpus does not carry (`planck.shell`,
 *                        `cljs.core`).
 *   QUAL-NS-NO-NAME      `<ns>/<name>`, `<ns>` IS a namespace of this corpus and it declares
 *                        no `<name>` — the analyzer named a var that the namespace does not
 *                        declare (`:refer`ed names, or a name only present in another cljs
 *                        build). A real finding, sized here.
 *   IMPORT-PACKAGE       an `imports` target that is not a declaration (`java.util`, the
 *                        package half of an import clause).
 *   DOT-NS-UNRESOLVED    a dotted target that IS a namespace of this corpus yet did not
 *                        resolve — a real finding rather than an external one.
 *   DOT-CLASS            a dotted target whose LAST segment is capitalised (`java.io.File`,
 *                        `java.lang.String`, `Ops$Op` in a heritage position).
 *   DOT-MEMBER           a dotted target whose last segment is not a class (`.toLowerCase`,
 *                        `ClassResolver.resolve-class`, `Foo.foo`).
 *   ARROW-TYPE           the `->Name` / `Name.` constructor spellings.
 *   BARE-TYPE            a bare, capitalised target declared nowhere (`Thread`, `Object`,
 *                        `IPending`, `ConstructorExport`) — a JVM class in a ctor/heritage
 *                        position, since no Clojure declaration answers to it.
 *   BARE-CORE-LEAK       a bare target declared nowhere whose name IS a clojure.core builtin
 *                        (`CLOJURE_CORE_BUILTINS`, imported from the analyzer) — a REAL
 *                        DEFECT: the suppression gate admitted a core call. Measured 0
 *                        RESIDUAL by `script/m14/tmp/clj-gate-census.ts` on three corpora.
 *   BARE-UNKNOWN         bare, declared nowhere, not a core name, not capitalised — an
 *                        external var, a `:refer :all` name (the documented `[*]` path), or a
 *                        typo.
 *
 * ## What it does NOT do
 *
 * No text matching over the corpus and not one regular expression over source: every fact
 * comes from the published `ParseResult` of production's own `parseFile`. The class tests
 * read the TARGET STRING, which is a published field — not source text.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/clojure/incoming-classify.ts [maxFiles] [--json]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { CLOJURE_CORE_BUILTINS } from "../../../../src/ast/real-clojure-analyzer"
import { classifyEdge, externalClaimOf, emptyOutcomes, tally } from "../../../../script/m14/incoming-rule"
import type { Outcomes, Classified } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** The lane's ADMITTED spelling set — `incoming-gate.ts`'s lane table: clojure = clj,cljs,cljc,edn. */
const CLOJURE_EXTS = process.env.BB_CLOJURE_EXTS ?? "clj,cljs,cljc,edn"

/** The engine limit `pool-worker.ts` FULL_AST_LIMIT draws (`incoming-gate.ts` SIZE_CAP). */
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const MAX_FILES = Number(argv.find((a) => !a.startsWith("--")) ?? 120)

/** The gate's discovery, transcribed. */
function discover(ext: string, maxFiles: number): {
  files: string[]; total: number; repos: number; overCap: number; absent: number
} {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0, overCap: 0, absent: 0 }
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
    for (const rel of tracked) {
      if (!ext.split(",").some((x) => rel.toLowerCase().endsWith(`.${x.trim().toLowerCase()}`))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch {
        absent++
        continue
      }
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
  return { files, total, repos: repos.size, overCap, absent }
}

const repoOf = (f: string): string => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
const relOf = (f: string): string => f.slice(CR.length + 1).split(path.sep).join("/")

type Site = { file: string; line: number; kind: string; name: string; qualifiedName: string; scope: string; rangeKey: string }
type NameEntry = { sites: Site[]; kinds: Set<string> }

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

/** The name in a `<qualifier>/<name>` target, split at the FIRST slash — which is what the
 *  analyzer's own `resolveQualified` / `resolveCallee` do (`h2x//` is a name whose own name
 *  contains a slash, so the rest after the first slash IS the name). */
function splitQualified(tgt: string): { qual: string; name: string } | null {
  const slash = tgt.indexOf("/")
  if (slash <= 0) return null
  return { qual: tgt.slice(0, slash), name: tgt.slice(slash + 1) }
}

/** WHICH CLASS A NOT-RESOLVED EDGE BELONGS TO. Facts in, class out — reads no source text. */
function classifyNotResolved(
  tgt: string,
  label: string,
  ambiguous: boolean,
  ownFileSites: Site[],
  projectByName: Map<string, Site[]>,
  /** the project's NAMESPACES (module names + symbol scopes) — tells an unresolved dotted
   *  name that IS a namespace of this corpus apart from one that is not, which are two very
   *  different findings (a real reference that failed to resolve vs a dependency outside). */
  isProjectNamespace: (name: string) => boolean,
): string {
  if (ambiguous) {
    if (ownFileSites.length === 0) return "AMB-CROSS-FILE"
    return ownFileSites.length === 1 ? "AMB-OWN-FILE-ONE" : "AMB-OWN-FILE-MULTI"
  }
  if (tgt.startsWith("->") || tgt.endsWith(".")) return "ARROW-TYPE"
  const q = splitQualified(tgt)
  if (q) {
    const named = projectByName.get(q.name) ?? []
    if (named.some((s) => s.scope === q.qual || s.name === q.qual)) return "QUAL-NAME-IN-NS"
    if (named.length > 0) return "QUAL-NAME-ELSEWHERE"
    if (isProjectNamespace(q.qual)) return "QUAL-NS-NO-NAME"
    const first = q.qual.split(".")[0]
    return /^[A-Z]/.test(first) && !q.qual.includes(".") ? "QUAL-STATIC-INTEROP" : "QUAL-EXTERNAL"
  }
  if (tgt.includes(".")) {
    if (label === "imports") return "IMPORT-PACKAGE"
    const last = tgt.split(".").pop() ?? ""
    if (/^[A-Z]/.test(last)) return "DOT-CLASS"
    // a dotted target that IS a namespace of this corpus but did not resolve: a real finding
    return isProjectNamespace(tgt) ? "DOT-NS-UNRESOLVED" : "DOT-MEMBER"
  }
  if (CLOJURE_CORE_BUILTINS[tgt] === true) return "BARE-CORE-LEAK"
  return /^[A-Z]/.test(tgt) ? "BARE-TYPE" : "BARE-UNKNOWN"
}

async function main(): Promise<void> {
  const { files, total, repos, overCap, absent } = discover(CLOJURE_EXTS, MAX_FILES)

  const projectDecl = new Map<string, Map<string, number>>()
  const projectKinds = new Map<string, Map<string, Set<string>>>()
  const projectNames = new Map<string, Map<string, NameEntry>>()
  /** the project's declarations keyed by BARE NAME only — the QUAL-NAME-IN-NS test */
  const projectByName = new Map<string, Map<string, Site[]>>()
  /** the project's NAMESPACES: every non-empty symbol `scope`, every module symbol's name */
  const projectScopes = new Map<string, Set<string>>()
  const projectModules = new Map<string, Set<string>>()

  const pending: { label: string; tgt: string; claim: any; sig: string; repo: string; file: string }[] = []
  const edgesByType = new Map<string, number>()
  for (const t of ALL_TYPES) edgesByType.set(t, 0)

  let parsed = 0
  let failed = 0
  let degraded = 0
  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
    } catch {
      failed++
      continue
    }
    if (!r) { failed++; continue }
    parsed++
    if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    const repo = repoOf(f)
    const rel = relOf(f)
    let pDecl = projectDecl.get(repo)
    if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
    let pKinds = projectKinds.get(repo)
    if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
    let pNames = projectNames.get(repo)
    if (!pNames) projectNames.set(repo, (pNames = new Map()))
    let pByName = projectByName.get(repo)
    if (!pByName) projectByName.set(repo, (pByName = new Map()))
    let pScopes = projectScopes.get(repo)
    if (!pScopes) projectScopes.set(repo, (pScopes = new Set()))
    let pModules = projectModules.get(repo)
    if (!pModules) projectModules.set(repo, (pModules = new Set()))

    const countKey = (key: string, kind: string, site: Site) => {
      pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
      let ks = pKinds!.get(key)
      if (!ks) pKinds!.set(key, (ks = new Set()))
      ks.add(kind)
      let e = pNames!.get(key)
      if (!e) { e = { sites: [], kinds: new Set() }; pNames!.set(key, e) }
      e.kinds.add(kind)
      e.sites.push(site)
    }

    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const kind = String(s?.kind ?? "")
      const scope = String(s?.scope ?? "")
      const q = String(s?.qualifiedName ?? "")
      const line = Number(s?.startLine ?? s?.range?.startLine ?? 0)
      const rk = `${s?.startIndex ?? s?.range?.startIndex ?? "?"}-${s?.endIndex ?? s?.range?.endIndex ?? "?"}`
      if (scope.length > 0) pScopes!.add(scope)
      if (kind === "module") pModules!.add(name)
      const site: Site = { file: rel, line, kind, name, qualifiedName: q, scope, rangeKey: rk }
      countKey(name, kind, site)
      if (q.length > 0 && q !== name) countKey(q, kind, site)
      let bn = pByName!.get(name)
      if (!bn) { bn = []; pByName!.set(name, bn) }
      bn.push(site)
    }

    for (const reln of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(reln?.type ?? reln?.relationshipType ?? "")
      if (!ALL_TYPES.includes(label)) continue
      edgesByType.set(label, (edgesByType.get(label) ?? 0) + 1)
      const tgt = String(reln?.target ?? reln?.to ?? reln?.toSymbol ?? "")
      if (tgt.length === 0) continue
      const md = reln?.metadata ?? {}
      const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
      markKeys.sort()
      pending.push({ label, tgt, claim: externalClaimOf(reln), sig: markKeys.length ? markKeys.join("+") : "(no marker)", repo, file: rel })
    }
  }

  // ---------------------------------------------------------------- pooled key space, built ONCE
  const allDecl = new Map<string, number>()
  const allKinds = new Map<string, Set<string>>()
  for (const m of projectDecl.values()) for (const [k, v] of m) allDecl.set(k, (allDecl.get(k) ?? 0) + v)
  for (const m of projectKinds.values()) for (const [k, v] of m) {
    let s = allKinds.get(k)
    if (!s) allKinds.set(k, (s = new Set()))
    for (const x of v) s.add(x)
  }

  // ---------------------------------------------------------------- one classification pass
  const totals: Outcomes = emptyOutcomes()
  const pooledTotals: Outcomes = emptyOutcomes()
  const byType: Record<string, { edges: number; resolved: number; amb: number; unres: number }> = {}
  for (const t of ALL_TYPES) byType[t] = { edges: 0, resolved: 0, amb: 0, unres: 0 }

  type NotRes = { label: string; tgt: string; file: string; cls: string; decls: number; kinds: string; marker: string }
  const notRes: NotRes[] = []
  const classCounts = new Map<string, { edges: number; targets: Set<string>; files: Set<string> }>()
  const classByType = new Map<string, number>()

  for (const e of pending) {
    // THE ARBITER'S OWN CALL SHAPE: `contains` is the one label production resolves with a
    // different statement (`resolveContainsTargetStmt`), so `classifyEdge` must be told —
    // `incoming-gate.ts:1104` passes `isContainsEdge(label)` and this census must not be a
    // second rule. Omitting it is what made this file's first run read `contains` 2,080
    // ambiguous where the gate reads 2,080 `collRes` (the exact delta, in both columns).
    const isContains = e.label === "contains"
    const entryAll = projectNames.get(e.repo)?.get(e.tgt)
    const ownFileDeclares = (entryAll?.sites ?? []).some((s) => s.file === e.file)
    const pDecl = projectDecl.get(e.repo)!
    const pC: Classified = classifyEdge(pDecl, projectKinds.get(e.repo)!, e.tgt, e.claim, undefined, isContains, ownFileDeclares)
    tally(totals, pC, e.tgt, e.label)
    tally(pooledTotals, classifyEdge(allDecl, allKinds, e.tgt, e.claim, undefined, isContains), e.tgt, e.label)

    byType[e.label].edges++
    const ambiguous = pC.outcome === "ambDeclOnly" || pC.outcome === "ambBoth"
    if (ambiguous) byType[e.label].amb++
    else if (pC.outcome === "resolved") { byType[e.label].resolved++; continue }
    else if (pC.outcome === "unresolved") byType[e.label].unres++
    else continue

    const ownFileSites = (entryAll?.sites ?? []).filter((s) => s.file === e.file)
    const scopes = projectScopes.get(e.repo) ?? new Set<string>()
    const modules = projectModules.get(e.repo) ?? new Set<string>()
    const isProjectNamespace = (n: string) => modules.has(n) || scopes.has(n)
    const cls = ambiguous
      ? classifyNotResolved(e.tgt, e.label, true, ownFileSites, new Map(), isProjectNamespace)
      : classifyNotResolved(e.tgt, e.label, false, ownFileSites, projectByName.get(e.repo) ?? new Map(), isProjectNamespace)
    notRes.push({ label: e.label, tgt: e.tgt, file: e.file, cls, decls: pC.decls, kinds: pC.kinds, marker: e.sig })
    let b = classCounts.get(cls)
    if (!b) classCounts.set(cls, (b = { edges: 0, targets: new Set(), files: new Set() }))
    b.edges++
    b.targets.add(e.tgt)
    b.files.add(e.file)
    const k = `${e.label}/${cls}`
    classByType.set(k, (classByType.get(k) ?? 0) + 1)
  }

  // ---------------------------------------------------------------- GATE COMPARISON
  //
  // The gate's OWN printed lines for this lane, transcribed:
  //   120  npx tsx script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 120
  //          TABLE 1 TOTAL 8433 / 2472 / 170 / 5791         (VERDICT FAIL)
  //   0    npx tsx script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0
  //          TABLE 1 TOTAL 43454 / 19956 / 4278 / 19220      (VERDICT FAIL)
  //          TABLE 2 TOTAL 43454 / 20743 / 4936 / 17775
  //
  // The sample line is 5x optimistic on the residual because a stride sample truncates each
  // project's symbol table (the gate's own header says so). Both are asserted so a
  // classification can never be read against the wrong population.
  const expected = MAX_FILES === 0
    ? { edges: 43454, resolved: 19956, amb: 4278, unres: 19220, pooledResolved: 20743, pooledAmb: 4936, pooledUnres: 17775 }
    : MAX_FILES === 120
      ? { edges: 8433, resolved: 2472, amb: 170, unres: 5791, pooledResolved: null, pooledAmb: null, pooledUnres: null }
      : null
  const cmp = {
    edges: { got: pending.length, want: expected?.edges ?? null },
    resolved: { got: totals.resolved, want: expected?.resolved ?? null },
    amb: { got: totals.ambiguousByDecl, want: expected?.amb ?? null },
    unres: { got: totals.unresolved, want: expected?.unres ?? null },
  }
  const pooledCmp = {
    resolved: { got: pooledTotals.resolved, want: expected?.pooledResolved ?? null },
    amb: { got: pooledTotals.ambiguousByDecl, want: expected?.pooledAmb ?? null },
    unres: { got: pooledTotals.unresolved, want: expected?.pooledUnres ?? null },
  }
  const cmpOK = expected ? Object.values(cmp).every((v) => v.got === v.want) : null
  const pooledOK = expected && expected.pooledResolved !== null
    ? Object.values(pooledCmp).every((v) => v.got === v.want)
    : null

  const classes = [...classCounts.entries()].sort((a, b) => b[1].edges - a[1].edges)
  const fixable = classCounts.get("QUAL-NAME-IN-NS")?.edges ?? 0

  const report = {
    command: `npx tsx validation/m14/fixtures/clojure/incoming-classify.ts ${MAX_FILES}`,
    population: { parsed, failed, degraded, sampled: files.length, admittedTotal: total, repos, overCap, absent, exts: CLOJURE_EXTS },
    gateComparison: { asserted: expected !== null, ok: cmpOK, pooledOk: pooledOK, expect: expected, got: cmp, pooledGot: pooledCmp },
    totals: {
      edges: pending.length,
      resolved: totals.resolved,
      ambiguousByDecl: totals.ambiguousByDecl,
      unresolved: totals.unresolved,
      pooledResolved: pooledTotals.resolved,
      pooledAmbiguousByDecl: pooledTotals.ambiguousByDecl,
      pooledUnresolved: pooledTotals.unresolved,
    },
    byType,
    classes: Object.fromEntries(classes.map(([k, v]) => [k, { edges: v.edges, distinctTargets: v.targets.size, distinctFiles: v.files.size }])),
    classesByType: Object.fromEntries([...classByType.entries()].sort()),
    fixableByQualifiedName: fixable,
    examples: Object.fromEntries(classes.map(([k]) => [k, notRes.filter((n) => n.cls === k).slice(0, 10).map((n) => ({ type: n.label, tgt: n.tgt, file: n.file, decls: n.decls, kinds: n.kinds, marker: n.marker }))])),
    topAmbiguousTargets: topNames(notRes.filter((n) => n.cls.startsWith("AMB-")).map((n) => n.tgt), 20),
    topUnresolvedTargets: topNames(notRes.filter((n) => !n.cls.startsWith("AMB-")).map((n) => n.tgt), 25),
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`clojure incoming classify — ${MAX_FILES === 0 ? "WHOLE POPULATION" : `stride sample of ${MAX_FILES}`}`)
  console.log(`population: ${parsed} parsed of ${files.length} sampled (corpus has ${total} .${CLOJURE_EXTS} files across ${repos} repos)`)
  console.log(`  skipped by the gate's own admission rule: ${absent} tracked-but-absent + ${overCap} over the 1 MB cap`)
  console.log(`  parse failures ${failed}   degraded (regex fallback) ${degraded}`)
  console.log(``)
  console.log(`GATE COMPARISON (counting rule imported from incoming-rule.ts; the RECORDED line is the gate's own printed TABLE 1 for this maxFiles)`)
  for (const [k, v] of Object.entries(cmp)) {
    console.log(`  ${k.padEnd(9)} this run ${String(v.got).padStart(6)}   recorded ${v.want === null ? "   n/a" : String(v.want).padStart(6)}   ${v.got === v.want ? "same" : v.want === null ? "—" : "DIFFERENT"}`)
  }
  console.log(`  ${cmpOK === null ? "reference only — this is neither maxFiles 120 nor 0" : cmpOK ? "ASSERTED: this run reproduces the gate's TABLE 1 line, so a population or analyzer move still fires" : "*** MISMATCH: this classification is of a different population ***"}`)
  if (expected?.pooledResolved !== null && expected !== null) {
    for (const [k, v] of Object.entries(pooledCmp)) {
      console.log(`  pooled/${k.padEnd(2)} this run ${String(v.got).padStart(6)}   recorded ${String(v.want).padStart(6)}   ${v.got === v.want ? "same" : "DIFFERENT"}`)
    }
  }
  console.log(``)
  console.log(`by type         edges   resolved      amb  unresolved`)
  for (const t of ALL_TYPES) {
    const b = byType[t]
    if (b.edges === 0) continue
    console.log(`  ${t.padEnd(12)} ${String(b.edges).padStart(5)} ${String(b.resolved).padStart(9)} ${String(b.amb).padStart(8)} ${String(b.unres).padStart(10)}`)
  }
  console.log(``)
  console.log(`CLASSES (${notRes.length} not-resolved edges)`)
  console.log(`  ${"class".padEnd(20)} ${"edges".padStart(6)}  ${"targets".padStart(7)}  ${"files".padStart(6)}`)
  for (const [k, v] of classes) {
    console.log(`  ${k.padEnd(20)} ${String(v.edges).padStart(6)}  ${String(v.targets.size).padStart(7)}  ${String(v.files.size).padStart(6)}`)
  }
  console.log(`  FIXABLE by publishing the language's own qualified spelling (QUAL-NAME-IN-NS): ${fixable}`)
  console.log(`  by type/class: ${JSON.stringify(report.classesByType)}`)
  console.log(``)
  console.log(`TOP AMBIGUOUS TARGETS`)
  for (const [n, c] of report.topAmbiguousTargets) console.log(`  ${String(c).padStart(4)}  ${n}`)
  console.log(``)
  console.log(`TOP UNRESOLVED TARGETS`)
  for (const [n, c] of report.topUnresolvedTargets) console.log(`  ${String(c).padStart(4)}  ${n}`)
  console.log(``)
  for (const [k] of classes) {
    console.log(`EXAMPLES — ${k}`)
    for (const x of report.examples[k]) console.log(`  ${String(x.type).padEnd(11)} ${x.tgt.slice(0, 44).padEnd(44)} decls ${String(x.decls).padStart(2)}  ${x.file.slice(0, 62)}`)
    console.log(``)
  }
  if (cmpOK === false || pooledOK === false) {
    console.error("REFUSING: the totals do not reproduce the gate's own line for this maxFiles, so this classification is of a different population.")
    process.exit(4)
  }
}

function topNames(names: string[], n: number): [string, number][] {
  const m = new Map<string, number>()
  for (const x of names) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
}

await main()
