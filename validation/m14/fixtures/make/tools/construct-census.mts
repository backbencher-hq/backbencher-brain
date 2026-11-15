/**
 * MAKE CONSTRUCT CENSUS — the counts behind the `coverage` block, over the whole population the
 * PRODUCTION ROUTER admits, measured on the PRODUCTION path.
 *
 * WHY THIS EXISTS, three reasons and each is a defect it replaces:
 *
 * 1. `overrides` IS EMITTED AND THE DECLARATION SAID IT WAS NOT EXERCISED. The lane's spec carried
 *    `corpusUnexercised: ["overrides"]` on a census that recorded `overrides 0` over `otp`, taken
 *    before the emission landed (63c28f2dd). The 120-file firing stride over the same corpus reads
 *    `overrides:2`. "Which of the two is stale" can only be answered by a count over the whole
 *    population — not by the stride that raised it and not by the older census that denied it.
 *
 * 2. THE ANALYZER CITES TWO PROBES THAT DO NOT EXIST. `real-makefile-analyzer.ts`'s `overrides`
 *    block cites `validation/m14/fixtures/make/mk-override-probe.mts` and `…-base.mts` for its
 *    "699 make files across 65 repos — 5 override_directive sites in 3 files" claim. Neither file is
 *    in the tree and neither is in git history (`git log --all --diff-filter=A` returns nothing), so
 *    the claim had no artefact behind it — and a citation to a missing file is worse than no
 *    citation, because it reads like evidence. This instrument IS that artefact.
 *
 * 3. A `grammar-absence` RULING NEEDS A GRAMMAR INVENTORY, AND THE LANE'S CENSUS COULD NOT BUILD ONE.
 *    `key-space-census.json` records `grammar.declaredNodeTypeCount: 0` with an honest note — the
 *    wasm binding exposes no node-type enumeration, so that half was NOT MEASURED. It is measurable
 *    statically and offline: `grammars/tree-sitter-make/src/node-types.json` declares 44 named types
 *    and the spec's `grammarPin.sourceVsWasm` proves the wired wasm agrees with that file in BOTH
 *    directions (0 missing, 0 named-only-in-wasm). So the declared names are a proof about the
 *    grammar actually loaded, and this instrument probes them.
 *
 * THREE DEFECTS IN THIS INSTRUMENT, FOUND BY RUNNING IT AND RECORDED RATHER THAN SMOOTHED:
 *
 *   (a) MEMBERSHIP WAS A COPY OF A RULE INSTEAD OF THE RULE. The first version admitted
 *       `name ends with Makefile|.mk|.make` — the LANE census's copy — and 2 of the 683 files it
 *       admitted (`redis/…/multiconf.make`, `sqlite/ext/jni/jar-dist.make`) then failed with
 *       "Unsupported file type": the production router does not route `.make` at all. Membership is
 *       now `detectLanguageFromPath(f) === "make"` — the router's OWN predicate, imported — and the
 *       three other rules' populations are printed beside it, because a lane whose population
 *       depends on which instrument asks is the programme's most-repeated measurement defect.
 *   (b) THE SUBSTRING PREDICATE SAID `extends` WAS PRESENT. Probing declared names with
 *       `name.includes(word)` matched `anon:basename` (it contains `base`) and flipped the whole
 *       ruling — the same false positive the lane's earlier census recorded for `implements` (4 keys)
 *       and `instantiates` (14 keys) and fixed by whole-word equality. The ruling predicate is now
 *       WHOLE-WORD; substring hits are reported as CANDIDATES with an adjudication, never as a
 *       verdict.
 *   (c) THE SITE WALK LOST EVERY SITE AFTER THE ENGINE RECYCLED ITS PARSER. `engine.ts` recreates a
 *       language's parser every 500 files (`getParser`), so a parser reference held across the loop
 *       goes stale and the walk silently returns nothing: 1 site found against 3 emitted edges, all
 *       missed sites being LATER in the walk. This is §5r's "a collector that cannot read the name it
 *       is looking for reports a defect in the code", and a count of 1 would have been a number about
 *       this instrument. The parser is now re-acquired per file, and the walk REFUSES TO REPORT
 *       (exit 3) unless every emitted `overrides` edge's own line is found as a site.
 *
 * NO REGEX. Every classification here is a JSON read, a Set lookup or a tree walk.
 *
 * Usage: bun validation/m14/fixtures/make/tools/construct-census.mts
 *   out: validation/m14/fixtures/make/construct-census.current.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = resolve(ROOT, "validation/m14/fixtures/make/construct-census.current.json")
const NODE_TYPES = resolve(ROOT, "grammars/tree-sitter-make/src/node-types.json")

const SIZE_CAP = 400_000
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

/**
 * The vocabulary each type's construct would have to be spelled with. Generous ON PURPOSE: a word
 * the grammar does not contain at all is stronger evidence than a narrow list, and `inherits` is in
 * the `extends` list specifically because docker-bake spells inheritance as an ATTRIBUTE KEY
 * (`inherits = ["_common"]`) — the hcl finding that falsified 19 node-type-only rulings.
 */
const VOCAB: Record<string, string[]> = {
  extends: ["extends", "extend", "inherits", "inherit", "derives", "derive", "superclass", "base", "parent", "subclass"],
  implements: ["implements", "implement", "interface", "protocol", "conformance", "satisfies", "trait"],
  instantiates: ["instantiates", "instantiate", "new", "constructor", "object", "class", "struct", "type"],
  // THE POSITIVE CONTROL'S VOCABULARY. `override` is a declared anonymous TOKEN, so this arm must
  // match under the WHOLE-WORD predicate — an inventory that cannot say PRESENT cannot be trusted
  // to say ABSENT.
  overrides: ["overrides", "override", "overridden", "redefine", "redefinition"],
}

/**
 * SUBSTRING CANDIDATES, ADJUDICATED ONE BY ONE AND AGAINST SOURCE. A candidate is a real construct
 * only when the name it matched CAN mean that construct; the programme's rule is to read the flagged
 * case rather than to trust the flag (§5r). Anything that matches by substring and is NOT listed
 * here is reported as UNADJUDICATED and the run refuses to report a ruling on it — the guard fired
 * on this instrument's first run, on `node:override_directive`, which is why the table has a
 * `means` field rather than a bare note: a candidate can be a TRUE spelling of the construct or a
 * coincidence, and the ruling must read the answer rather than the match.
 */
const SUBSTRING_ADJUDICATION: Record<string, { means: boolean; why: string }> = {
  "anon:basename": {
    means: false,
    why: "a shell function token (`$(basename x.c)`) — it contains the letters of `base` and cannot express inheritance; this is the single candidate that made this instrument's first run report `extends PRESENT`",
  },
  "node:override_directive": {
    means: true,
    why: "the directive node itself — `override VAR = v`. It contains the keyword `override` rather than equalling it, and it IS the construct",
  },
}

// ── MEMBERSHIP: the production router's own predicate ─────────────────────────────────────────────
const { detectLanguageFromPath } = await import(`${ROOT}/src/ast/language-detection.ts`)

function walkAll(): string[] {
  const all: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p, depth + 1) }
      else { try { if (statSync(p).size < SIZE_CAP) all.push(p) } catch { /* unreadable */ } }
    }
  }
  walk(CR, 0)
  return all.sort()
}

const relOf = (p: string) => (p.startsWith(CR) ? p.slice(CR.length + 1) : p)
const candidates = walkAll()
/** The router's verdict. `.make` is NOT routed to make, which is why a copy of the lane's census
 *  rule admitted two files production refuses. */
const files = candidates.filter((f) => detectLanguageFromPath(f) === "make")
/** The three other admission rules, as COUNTS, so a population that differs by instrument is
 *  visible in the artefact instead of being discovered later by whoever quotes the number. */
const populationRules = {
  router: "detectLanguageFromPath(p) === 'make' — .mk/.mak/.makefile by extension, Makefile/makefile/GNUmakefile/.makefile/.gnumakefile by basename",
  "lane-census-copy": "name ends with Makefile | .mk | .make (key-space-census.mts)",
  "firing-check": "name ends with Makefile | .mk (firing-check.mjs LANES.MAKE ext set)",
  "incoming-gate": "path lowercased ends with .mk | .mak | .makefile (cannot admit a bare Makefile — its own comment says so)",
}
const countsByRule = {
  router: files.length,
  "lane-census-copy": candidates.filter((f) => ["Makefile", ".mk", ".make"].some((x) => f.endsWith(x))).length,
  "firing-check": candidates.filter((f) => ["Makefile", ".mk"].some((x) => f.endsWith(x))).length,
  "incoming-gate": candidates.filter((f) => [".mk", ".mak", ".makefile"].some((x) => f.toLowerCase().endsWith(x))).length,
}

// ── 1. THE GRAMMAR INVENTORY (static, offline, re-checkable) ─────────────────────────────────────
const declared = JSON.parse(readFileSync(NODE_TYPES, "utf8")) as any[]
const namedTypes: string[] = declared.filter((x) => x?.named === true).map((x) => String(x.type))
const anonymousTokens: string[] = declared.filter((x) => x?.named !== true).map((x) => String(x.type))
const fieldNames: string[] = [...new Set(declared.flatMap((x) => Object.keys(x?.fields ?? {})))]

type SpaceHit = { name: string; wholeWord: boolean; substring: boolean }
const grammarPerType: Record<string, any> = {}
for (const [type, words] of Object.entries(VOCAB)) {
  const probe = (names: string[], space: string): SpaceHit[] => {
    const out: SpaceHit[] = []
    for (const n of names) {
      const low = n.toLowerCase()
      const wholeWord = words.includes(low)
      const substring = words.some((w) => low.includes(w))
      if (wholeWord || substring) out.push({ name: `${space}:${n}`, wholeWord, substring })
    }
    return out
  }
  const hits = [...probe(namedTypes, "node"), ...probe(fieldNames, "field"), ...probe(anonymousTokens, "anon")]
  const whole = hits.filter((h) => h.wholeWord).map((h) => h.name)
  const sub = hits.filter((h) => h.substring && !h.wholeWord).map((h) => h.name)
  const unadjudicated = sub.filter((n) => SUBSTRING_ADJUDICATION[n] === undefined)
  const subThatMean = sub.filter((n) => SUBSTRING_ADJUDICATION[n]?.means === true)
  grammarPerType[type] = {
    vocabulary: words,
    wholeWordMatches: whole,
    substringCandidates: sub,
    adjudication: Object.fromEntries(sub.filter((n) => SUBSTRING_ADJUDICATION[n] !== undefined).map((n) => [n, SUBSTRING_ADJUDICATION[n].why])),
    substringCandidatesThatMean: subThatMean,
    unadjudicatedCandidates: unadjudicated,
    // THE RULING PREDICATE: a construct is expressible iff the grammar declares a name that IS one
    // of its vocabulary words, or a substring candidate that has been READ and adjudicated as
    // spelling the construct. Substring matching alone is not a predicate: it produced this
    // instrument's own false `extends PRESENT` (via `basename`).
    expressible: whole.length > 0 || subThatMean.length > 0,
    expressibleOnlyBySubstring: whole.length === 0 && subThatMean.length > 0,
  }
}

// CONTROL ARM 1 — the inventory must be able to say PRESENT where the language demonstrably has the
// construct. `overrides` is spelled by the declared token `override`.
if (grammarPerType.overrides.expressible !== true) {
  console.error(`GRAMMAR-INVENTORY CONTROL FAILED — \`overrides\` reads INEXPRESSIBLE under the whole-word predicate, but the pinned grammar declares the token \`override\`. An inventory that cannot say PRESENT cannot certify ABSENT. Refusing to report.`)
  process.exit(3)
}
// CONTROL ARM 2 — an UNADJUDICATED substring candidate means a vocabulary word matched a name this
// instrument has not read. Reporting a ruling over it would be reporting over an unread case.
const allUnadjudicated = Object.values(grammarPerType).flatMap((g: any) => g.unadjudicatedCandidates)
if (allUnadjudicated.length > 0) {
  console.error(`GRAMMAR-INVENTORY REFUSAL — ${allUnadjudicated.length} substring candidate(s) have no adjudication: ${allUnadjudicated.join(" ")}. Read each one against the grammar before reporting a ruling that depends on it.`)
  process.exit(3)
}

// ── 2. THE CORPUS: emission on the PRODUCTION path + the construct's own sites ───────────────────
const { parseFile, getParser } = await import(`${ROOT}/src/ast/engine.ts`)

const emissions: Record<string, { edges: number; files: number }> = {}
for (const t of TYPES) emissions[t] = { edges: 0, files: 0 }
const otpEmissions: Record<string, { edges: number; files: number }> = {}
for (const t of TYPES) otpEmissions[t] = { edges: 0, files: 0 }

type Site = { file: string; line: number; name: string }
const overrideSites: Site[] = []
const overridesEdges: Array<{ file: string; line: number; target: string; baseLine: unknown; via: unknown }> = []
let parsed = 0, degraded = 0, failed = 0, totalEdges = 0, siteWalkFiles = 0, siteWalkFailed = 0
const degradedFiles: string[] = [], failedFiles: string[] = [], siteWalkFailedFiles: string[] = []

/** The analyzer's own operator trim, copied by the rule and not by regex: `? + = ! :` by char code. */
const trimOperator = (raw: string): string => {
  let end = raw.length
  while (end > 0) {
    const c = raw.charCodeAt(end - 1)
    if (c === 63 || c === 43 || c === 61 || c === 33 || c === 58) end--
    else break
  }
  return raw.slice(0, end).trim()
}
const firstChildOfType = (node: any, types: Set<string>): any => {
  const stack: any[] = [...(node.namedChildren ?? [])]
  while (stack.length > 0) {
    const n = stack.shift()
    if (!n) continue
    if (types.has(n.type)) return n
    for (const c of n.namedChildren ?? []) stack.push(c)
  }
  return null
}

for (const f of files) {
  const content = readFileSync(f, "utf8")

  // (a) THE SITES — an AST walk. `override_directive` is where the construct occurs whether or not a
  //     base exists, so this is the honest denominator the emitted edges are a subset of.
  //
  //     THE PARSER IS RE-ACQUIRED PER FILE. `engine.ts` recreates a language's parser every 500
  //     files, so a reference held across the loop goes stale and the walk returns nothing — the
  //     first version of this instrument found 1 site against 3 emitted edges and every missed site
  //     was after the recycle.
  try {
    const parser: any = await getParser("make")
    const tree: any = await parser.parse(content, f)
    if (!tree?.rootNode) throw new Error("null root")
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const node: any = stack.pop()
      if (!node) continue
      if (node.type === "override_directive") {
        // The analyzer's own rule: the assignment nested under the directive, then its `word` child.
        const inner = firstChildOfType(node, new Set(["variable_assignment", "shell_assignment"]))
        const w = inner ? firstChildOfType(inner, new Set(["word"])) : null
        const name = w ? trimOperator(String(w.text).trim()) : ""
        overrideSites.push({ file: relOf(f), line: node.startPosition.row + 1, name })
      }
      for (const c of node.namedChildren ?? []) stack.push(c)
    }
    siteWalkFiles++
  } catch (e) { siteWalkFailed++; siteWalkFailedFiles.push(`${relOf(f)}: ${String(e).slice(0, 60)}`) }

  // (b) THE EMISSION, on the PRODUCTION path (`parseFile`, the call `firing-check.mjs` makes).
  let res: any
  try { res = await parseFile(f, content) } catch (e) { failed++; failedFiles.push(`${relOf(f)}: ${String(e).slice(0, 60)}`); continue }
  const md = res?.metadata ?? {}
  if (md.fallback === true || md.analysisVersion === "2.0-basic-fallback") {
    degraded++; degradedFiles.push(`${relOf(f)}: ${String(md.fallbackReason ?? md.analysisVersion).slice(0, 40)}`)
    continue
  }
  parsed++
  const seen = new Set<string>()
  for (const r of res.relationships ?? []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (!TYPES.includes(t as any)) continue
    emissions[t].edges++
    totalEdges++
    seen.add(t)
    if (t === "overrides") {
      overridesEdges.push({
        file: relOf(f),
        line: Number(r.line ?? r.lineNumber ?? -1),
        target: String(r.targetExternal ?? r.target ?? ""),
        baseLine: r?.metadata?.baseLine ?? null,
        via: r?.metadata?.via ?? null,
      })
    }
  }
  for (const t of seen) emissions[t].files++
  if (relOf(f).startsWith("otp/")) {
    const seenOtp = new Set<string>()
    for (const r of res.relationships ?? []) {
      const t = String(r.relationshipType ?? r.type ?? "")
      if (!TYPES.includes(t as any)) continue
      otpEmissions[t].edges++
      seenOtp.add(t)
    }
    for (const t of seenOtp) otpEmissions[t].files++
  }
}

const siteFiles = new Set(overrideSites.map((s) => s.file))
const edgeFiles = new Set(overridesEdges.map((e) => e.file))
const siteKeys = new Set(overrideSites.map((s) => `${s.file}:${s.line}`))
const withBase = new Set(overridesEdges.map((e) => `${e.file}:${e.line}`))
const refused = overrideSites.filter((s) => !withBase.has(`${s.file}:${s.line}`))
/** Every emitted edge is DERIVED from a site, so a site the walk did not find is a site the walk
 *  could not read. Reporting a site count below the edge count would be a number about this
 *  instrument (§5r), so the run refuses instead. */
const edgesWithoutSite = overridesEdges.filter((e) => !siteKeys.has(`${e.file}:${e.line}`))

if (siteWalkFailed > 0) {
  console.error(`SITE-WALK REFUSAL — the AST walk failed on ${siteWalkFailed} file(s): ${siteWalkFailedFiles.slice(0, 3).join(" | ")}. A site count over a partial walk is a count of the walk.`)
  process.exit(3)
}
if (edgesWithoutSite.length > 0) {
  console.error(`SITE-WALK REFUSAL — ${edgesWithoutSite.length} emitted \`overrides\` edge(s) have NO matching site in the AST walk (e.g. ${edgesWithoutSite[0].file}:${edgesWithoutSite[0].line}). Every edge is derived from a site, so the walk is incomplete; the site count is not evidence.`)
  process.exit(3)
}

const artefact = {
  instrument: "validation/m14/fixtures/make/tools/construct-census.mts",
  whatThisIs:
    "Three measurements in one pass over the whole router-admitted make population: (1) a STATIC grammar " +
    "inventory of the pinned grammar's declared node types, fields and tokens, probed with each relationship " +
    "type's vocabulary under a WHOLE-WORD predicate; (2) a per-type EMISSION census on the production path " +
    "(`parseFile`), zeros included; (3) the `override_directive` SITE count from an AST walk, which is the " +
    "denominator the emitted `overrides` edges are a deliberate subset of.",
  whatThisIsNot:
    "Not a resolution measurement. Whether each emitted edge binds to exactly one declaration is the incoming " +
    "gate's question; this measures EMISSION, VOCABULARY and MEMBERSHIP.",
  revision: {
    head: process.env.BB_HEAD ?? null,
    measuredAt: new Date().toISOString(),
    hostLoad1minAtStart: process.env.BB_LOAD ?? null,
    labelledAs: "whole router-admitted make population, production path, one run",
  },
  population: {
    corpusRoot: CR,
    membership: populationRules,
    admittedByRule: countsByRule,
    admitted: files.length,
    parsed,
    degraded,
    failed,
    siteWalkFiles,
    siteWalkFailed,
    repos: new Set(files.map((f) => relOf(f).split("/")[0])).size,
    otpAdmitted: files.filter((f) => relOf(f).startsWith("otp/")).length,
    membershipNote:
      "`admittedByRule` is the finding, not a curiosity: the same language has four different populations " +
      "depending on which instrument asks. `.make` is admitted by the lane's own census copy and REFUSED by " +
      "the production router; `GNUmakefile` is admitted by the router and missed by firing-check's suffix " +
      "rule; a bare `Makefile` can never be admitted by the incoming gate's extension rule.",
  },
  grammarInventory: {
    source: "grammars/tree-sitter-make/src/node-types.json",
    whyStatic:
      "key-space-census.json records grammar.declaredNodeTypeCount = 0 with the note that the wasm binding " +
      "exposes no node-type enumeration. This half is measurable offline, and the spec's grammarPin proves " +
      "the wired wasm agrees with this file in both directions (0 missing, 0 named-only-in-wasm).",
    declaredNamedTypes: namedTypes.length,
    declaredAnonymousTokens: anonymousTokens.length,
    declaredFieldNames: fieldNames.length,
    predicate: "WHOLE-WORD equality between a declared name and a vocabulary word; substring matches are candidates, never verdicts",
    perType: grammarPerType,
    control: {
      arm: "overrides is EXPRESSIBLE (declared token `override`)",
      result: grammarPerType.overrides.expressible ? "PRESENT" : "ABSENT",
      rule: "an inventory that cannot say PRESENT on a construct the language demonstrably has cannot be trusted to say ABSENT on one it lacks",
    },
  },
  emissions: {
    _unit: "edges: relationship rows returned by parseFile; files: distinct files the type fired in",
    productionPath: "src/ast/engine.ts parseFile (the path firing-check.mjs measures)",
    perType: emissions,
    totalEdges,
    otpSubset: otpEmissions,
    otpNote:
      "otp is the lane's own LANES population (the corpus dir firing-check.mjs pins). Reported separately so a " +
      "count over the lane's corpus and a count over the wider population are never averaged into one number.",
  },
  overridesSites: {
    _unit: "a SITE is one `override VAR = value` directive found by AST walk; an EDGE is emitted only where the same file declares a base at another line",
    sites: overrideSites.length,
    siteFiles: siteFiles.size,
    emittedEdges: overridesEdges.length,
    emittedEdgeFiles: edgeFiles.size,
    refusedSites: refused.length,
    refusedReason: "the `override` redefines a command-line or environment binding, which is not a symbol in the graph — the lane's original ruling, kept for exactly these sites",
    perSite: overrideSites,
    perEdge: overridesEdges,
    refusedPerSite: refused,
  },
  zeroStatements: {
    _why:
      "A type that is ABSENT must be printed as a number, not inferred from a missing row (§5s). Each type is " +
      "shown with the grammar verdict it rests on and the emission count beside it.",
    perType: Object.fromEntries(TYPES.map((t) => [t, {
      grammarExpressibleWholeWord: t in grammarPerType ? grammarPerType[t].expressible : null,
      substringCandidates: t in grammarPerType ? grammarPerType[t].substringCandidates : [],
      emittedEdges: emissions[t].edges,
      emittedFiles: emissions[t].files,
      otpEdges: otpEmissions[t].edges,
    }])),
  },
  degradedFiles,
  failedFiles,
  siteWalkFailedFiles,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")

const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`make construct census — ${parsed} parsed · ${degraded} degraded · ${failed} failed of ${files.length} ROUTER-admitted (${artefact.population.repos} repos)`)
console.log(`admitted by rule: ${Object.entries(countsByRule).map(([k, v]) => `${k}=${v}`).join(" · ")}`)
console.log(`grammar ${NODE_TYPES.replace(ROOT + "/", "")}: ${namedTypes.length} named types · ${anonymousTokens.length} tokens · ${fieldNames.length} field names`)
console.log(`\n${w("type", 14)} ${w("grammar(WW)", 12)} ${w("edges", 8)} ${w("files", 7)} ${w("otp edges", 10)}`)
for (const t of TYPES) {
  const g = t in grammarPerType ? (grammarPerType[t].expressible ? "PRESENT" : "absent") : "-"
  const cand = t in grammarPerType && grammarPerType[t].substringCandidates.length > 0 ? `  (substring: ${grammarPerType[t].substringCandidates.join(",")})` : ""
  console.log(`${w(t, 14)} ${w(g, 12)} ${w(emissions[t].edges, 8)} ${w(emissions[t].files, 7)} ${w(otpEmissions[t].edges, 10)}${cand}`)
}
console.log(`\noverride_directive SITES ${overrideSites.length} in ${siteFiles.size} file(s) · EDGES ${overridesEdges.length} in ${edgeFiles.size} file(s) · REFUSED (no base in the same file) ${refused.length}`)
for (const s of overrideSites) console.log(`   site   ${s.file}:${s.line}  ${s.name}`)
for (const e of overridesEdges) console.log(`   EDGE   ${e.file}:${e.line}  ${e.target}  baseLine=${e.baseLine} via=${e.via}`)
for (const s of refused) console.log(`   refused ${s.file}:${s.line}  ${s.name}`)
console.log(`\nsite-walk accounting: ${siteWalkFiles}/${files.length} walked · ${siteWalkFailed} failed · every emitted edge has a site: ${edgesWithoutSite.length === 0}`)
console.log(`grammar inventory control — overrides ${grammarPerType.overrides.expressible ? "PRESENT" : "ABSENT"} via whole-word ${JSON.stringify(grammarPerType.overrides.wholeWordMatches)}`)
console.log(`wrote ${OUT}`)
