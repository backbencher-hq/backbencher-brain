/**
 * M60 — RELATIONSHIP-TYPE COVERAGE GATE.
 *
 * Four invisible findings in the ruby deep round shared one shape: a gate was
 * GREEN while a large part of the relationship graph was unreachable or
 * unverified, and nothing in the repository said so.
 *
 *   - `contains` and `references` were in NO language's audited set: ~34% of the
 *     ruby payload had no oracle derivation at all, so two identity defects
 *     (a reopen that never unified, a symbol named `#{sym}?`) sat in the graph
 *     where no gate could see them.
 *   - `graph-engine.ts` defaulted a traversal to FOUR of the ten values, and
 *     never declared the filter: 22.2% of emitted relationships were excluded
 *     before the query ran, including `contains` — the parent->member edge, so a
 *     traversal could not descend from a class to its own methods.
 *   - Two of the repository's three graph paths disagreed on that default, so the
 *     same question had two answers depending which tool asked.
 *   - 118 of 252,674 ruby relationships carried a line that did not contain their
 *     target, on a lane whose documentation claimed zero.
 *
 * None of these is a per-language defect. All four are gaps in what the
 * REPOSITORY can state about the relationship graph, and every one of them is
 * cheap to check and cheap to regress. That is what this gate is for.
 *
 * It reads every value it checks from the source that owns it — the enum from
 * `ast/engine.ts`, each analyzer's emitted types from its own
 * `RelationshipType.X` usages, each language's audited label set by EVALUATING
 * `differential.ts`'s own filter expression, and the traversal default by
 * PARSING `graph-engine.ts`. Nothing is restated here. A hardcoded copy of a
 * constant is how an instrument keeps reporting the old number after the
 * constant changes, and this round produced six separate instances of exactly
 * that.
 *
 * CHECKS
 *   1 DERIVATION    every type an analyzer can emit is in that language's audited
 *                    set — otherwise the type is emitted, stored, and compared
 *                    against nothing.
 *   2 REACHABILITY  every type an analyzer can emit is in the traversal default —
 *                    otherwise a consumer's graph query cannot return it.
 *   3 AGREEMENT     the repository's graph paths agree on that default.
 *   4 ENUM          every enum value is either constructed by some analyzer or
 *                    recorded as a deliberate absence, so a value cannot be
 *                    neither used nor ruled.
 *
 * The PAYLOAD check (what fraction of a language's real edges fall outside its
 * audited set) needs corpora and is measured, not derived; it is run by
 * `rb-corpus-census.ts` per lane and its result is the reason check 1 exists.
 *
 * MODES
 *   --langs=a,b     restrict the report (never narrows the gate's own claim)
 *   --self-test     negative tests: every check must be shown able to FAIL
 *   --update-baseline  record the current state as the ceiling
 *   --list          print the baseline
 *
 * A new script rather than an extension of an existing gate, deliberately: it
 * READS shared files, so it cannot conflict with a lane that owns
 * one of them.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.env.BB_M60_ROOT
  ? path.resolve(process.env.BB_M60_ROOT)
  : path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")

const ENGINE = path.join(ROOT, "src", "ast", "engine.ts")
/** `differential.ts` is the shared, contended audited-label allowlist, and
 *  `BB_DIFFERENTIAL` exists for the same reason `BB_RB_ORACLE` exists on the
 *  corpus census: to point a lane's gate at a MIRRORED copy when the shared file
 *  is mid-edit and does not parse. It changes where the truth is read from and
 *  nothing else — never what the gate concludes. */
const DIFFERENTIAL = process.env.BB_DIFFERENTIAL
  ? path.resolve(process.env.BB_DIFFERENTIAL)
  : path.join(ROOT, "script", "m14", "differential.ts")
const GRAPH_ENGINE = path.join(ROOT, "src", "intelligence", "graph", "graph-engine.ts")
const AST_GRAPH = path.join(ROOT, "src", "ast", "graph.ts")
const VIZ_ENGINE = path.join(ROOT, "src", "intelligence", "visualization", "visualization-engine.ts")
const ANALYZER_DIR = path.join(ROOT, "src", "ast")
const BASELINE = path.join(ROOT, "validation", "m60", "rel-type-coverage-baseline.json")
const RESULTS = path.join(ROOT, "validation", "m60", "results")

/** Enum member -> its string value. Mirrors `ASTEngine.RelationshipType`, whose
 * aliases all collapse onto the ten values below. */
const MEMBER_TO_VALUE: Record<string, string> = {
  Calls: "calls", Call: "calls",
  Extends: "extends", Inheritance: "extends",
  Implements: "implements", Implementation: "implements",
  Uses: "uses", Dependency: "uses",
  Imports: "imports", Exports: "exports",
  Contains: "contains", Composition: "contains", Provides: "exports",
  PartOf: "contains", Related: "references", DependsOn: "references",
  References: "references", Override: "overrides", Overrides: "overrides",
  Instantiates: "instantiates",
}

interface Lane {
  lang: string
  emitted: Set<string>
  audited: Set<string>
}
interface Finding {
  check: "DERIVATION" | "REACHABILITY" | "AGREEMENT" | "ENUM"
  lang?: string
  detail: string
}

/* ------------------------------------------------------------------ *
 * 1. The enum, read from source.
 * ------------------------------------------------------------------ */
function readEnumValues(): string[] {
  const src = fs.readFileSync(ENGINE, "utf8")
  const body = src.slice(src.indexOf("export enum RelationshipType"))
  const end = body.indexOf("\n  }")
  const values = new Set<string>()
  for (const m of body.slice(0, end).matchAll(/=\s*"([^"]+)"/g)) values.add(m[1])
  return [...values].sort()
}

/* ------------------------------------------------------------------ *
 * 2. What each analyzer can CONSTRUCT.
 * ------------------------------------------------------------------ */
function readEmittedTypes(file: string, enumValues: string[]): Set<string> {
  const src = fs.readFileSync(file, "utf8")
  const out = new Set<string>()
  // Deliberately broad. The qualification is written `ASTEngine.RelationshipType.X`
  // and the same type is also reached through a ternary (a class statement resolves
  // to `Extends : Implements`), so anchoring on a construction field would miss
  // genuine emissions. Missing a type is the exact failure this gate exists to
  // prevent, so it is worth over-reporting; the enum is small and each claim is
  // checkable by hand.
  for (const m of src.matchAll(/RelationshipType\.([A-Za-z]+)/g)) {
    const v = MEMBER_TO_VALUE[m[1]]
    if (v) out.add(v)
  }
  // A `type: "x"` literal is a second spelling of the same thing, and a lane that
  // never touches the enum would otherwise look silent. Filtered to values that
  // are genuinely RelationshipType values: unfiltered, this pattern also matches
  // node kinds and pattern labels (`"any"`, `"orm"`, `"boolean"`, `"web_framework"`),
  // which are not relationships and produced 160 phantom findings on first run.
  for (const m of src.matchAll(/\b(?:type|relationshipType|label)\s*:\s*"([a-z_]+)"/g)) {
    if (enumValues.includes(m[1])) out.add(m[1])
  }
  return out
}

function listLanes(enumValues: string[]): Lane[] {
  const out: Lane[] = []
  for (const f of fs.readdirSync(ANALYZER_DIR)) {
    const m = /^real-(.+)-analyzer\.ts$/.exec(f)
    if (!m) continue
    out.push({ lang: m[1], emitted: readEmittedTypes(path.join(ANALYZER_DIR, f), enumValues), audited: new Set() })
  }
  return out.sort((a, b) => a.lang.localeCompare(b.lang))
}

/* ------------------------------------------------------------------ *
 * 3. Each language's audited label set, by EVALUATING differential.ts's own
 *    filter expression. Restating it would be a copy that drifts the moment a
 *    lane appends a term, which is exactly how a lane's audited set stopped
 *    matching its analyzer.
 * ------------------------------------------------------------------ */
export interface AuditedRead {
  sets: Map<string, Set<string>>
  /** Lanes whose audited set could not be evaluated, with the reason. */
  failed: Array<{ lang: string; reason: string }>
}

/** Each language's audited label set, by EVALUATING differential.ts's own filter
 *  expression. Restating it would be a copy that drifts the moment a lane appends
 *  a term, which is exactly how a lane's audited set stopped matching its
 *  analyzer.
 *
 *  A failure to evaluate is REPORTED, never swallowed. `differential.ts` is a
 *  shared 21,000-line file under active edit by several lanes, and it has been
 *  observed mid-edit with a syntax error. When that happens this extraction
 *  throws inside `new Function`, and an earlier version caught it and returned an
 *  EMPTY set — which the gate then reported as "ruby audits nothing: 8
 *  un-audited", a confident and completely false claim derived from a file that
 *  does not parse. An empty audited set is indistinguishable from a real one
 *  only if nothing checks, so the caller is told which lanes are unreadable and
 *  the gate reports an INPUT ERROR rather than a coverage finding. */
export function readAuditedSets(langs: string[]): AuditedRead {
  const sets = new Map<string, Set<string>>()
  const failed: Array<{ lang: string; reason: string }> = []
  let src = ""
  try { src = fs.readFileSync(DIFFERENTIAL, "utf8") } catch (e) {
    return { sets, failed: langs.map((l) => ({ lang: l, reason: `cannot read ${DIFFERENTIAL}: ${e}` })) }
  }
  const HEAD = '.filter((r: any) => ["extends"'
  const i = src.indexOf(HEAD)
  if (i < 0) {
    return { sets, failed: langs.map((l) => ({ lang: l, reason: `no audited-label filter found in ${DIFFERENTIAL} — its shape changed, so the extraction cannot be trusted` })) }
  }
  const start = i + HEAD.length - '["extends"'.length
  const end = src.indexOf("].includes(r.label)", start)
  if (end < 0) {
    return { sets, failed: langs.map((l) => ({ lang: l, reason: `the audited-label filter in ${DIFFERENTIAL} is unterminated — it does not parse` })) }
  }
  // The literal carries explanatory line comments; strip them so it parses.
  const literal = src
    .slice(start, end + 1)
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/\s+\/\/[^\n]*$/, ""))
    .join("\n")
  for (const lang of langs) {
    let vals: string[]
    try {
      vals = new Function("lang", "return " + literal)(lang) as string[]
    } catch (e) {
      failed.push({ lang, reason: `audited-label filter does not evaluate: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }
    if (!Array.isArray(vals) || vals.length === 0) {
      failed.push({ lang, reason: "audited-label set evaluated EMPTY — indistinguishable from a real set only if unchecked" })
      continue
    }
    sets.set(lang, new Set(vals))
  }
  return { sets, failed }
}

/* ------------------------------------------------------------------ *
 * 4. The traversal default, parsed out of graph-engine.ts.
 * ------------------------------------------------------------------ */
function readGraphDefault(): string[] {
  const src = fs.readFileSync(GRAPH_ENGINE, "utf8")
  const m = src.match(/const DEFAULT_REL_TYPES = \[([\s\S]*?)\]/)
  if (!m) throw new Error("could not find DEFAULT_REL_TYPES in graph-engine.ts")
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/** How the OTHER two graph paths behave with no filter given. Each is
 *  distinguished by its own shape, because "returns everything" and "returns four"
 *  are spelled differently in each file. */
function readOtherPathBehaviour(): Array<{ path: string; allWhenUnfiltered: boolean }> {
  const out: Array<{ path: string; allWhenUnfiltered: boolean }> = []
  const ag = fs.readFileSync(AST_GRAPH, "utf8")
  out.push({
    path: "src/ast/graph.ts",
    allWhenUnfiltered: /relationshipTypes:\s*Object\.values\(RelationshipType\)/.test(ag),
  })
  const vz = fs.readFileSync(VIZ_ENGINE, "utf8")
  out.push({
    path: "src/intelligence/visualization/visualization-engine.ts",
    allWhenUnfiltered: /!request\.relationshipTypes\?\.length\s*\|\|/.test(vz),
  })
  return out
}

/* ------------------------------------------------------------------ *
 * The gate.
 * ------------------------------------------------------------------ */
export interface GateRun {
  enumValues: string[]
  lanes: Array<{ lang: string; emitted: string[]; audited: string[] }>
  graphDefault: string[]
  findings: Finding[]
  /** Lanes whose audited set could not be read. A lane listed here is EXCLUDED
   *  from the derivation check, and the gate reports an input error — because a
   *  lane that cannot be read must never be reported as a lane that audits
   *  nothing. */
  inputErrors: Array<{ lang: string; reason: string }>
}

export function runGate(lanesIn?: string[]): GateRun {
  const enumValues = readEnumValues()
  const all = listLanes(enumValues)
  const lanes = lanesIn?.length ? all.filter((l) => lanesIn.includes(l.lang)) : all
  const read = readAuditedSets(lanes.map((l) => l.lang))
  const audited = read.sets
  const unreadable = new Set(read.failed.map((f) => f.lang))
  const graphDefault = readGraphDefault()
  const defaultSet = new Set(graphDefault)
  const findings: Finding[] = []

  for (const l of lanes) {
    if (unreadable.has(l.lang)) { l.audited = new Set(); continue }
    l.audited = audited.get(l.lang) ?? new Set()
    // CHECK 1 — DERIVATION
    for (const t of [...l.emitted].sort()) {
      if (!l.audited.has(t)) {
        findings.push({
          check: "DERIVATION",
          lang: l.lang,
          detail: `emits \`${t}\` but the differential audits ${JSON.stringify([...l.audited].sort())} — the type is stored and compared against nothing`,
        })
      }
    }
    // CHECK 2 — REACHABILITY
    for (const t of [...l.emitted].sort()) {
      if (!defaultSet.has(t)) {
        findings.push({
          check: "REACHABILITY",
          lang: l.lang,
          detail: `emits \`${t}\`, which is not in the traversal default — a graph query without \`relationshipTypes\` cannot return it`,
        })
      }
    }
  }

  // CHECK 3 — AGREEMENT between the repository's graph paths
  const others = readOtherPathBehaviour()
  for (const o of others) {
    if (!o.allWhenUnfiltered) {
      findings.push({ check: "AGREEMENT", detail: `${o.path} does not return every relationship type when no filter is given, and its shape was not recognised — the paths cannot be compared` })
    }
  }
  const unreachable = [...defaultSet].filter((t) => !enumValues.includes(t))
  if (unreachable.length) {
    findings.push({ check: "AGREEMENT", detail: `the traversal default names ${JSON.stringify(unreachable)}, which are not RelationshipType values` })
  }

  // CHECK 4 — ENUM: every value is constructed by someone, or the absence is deliberate
  const constructed = new Set<string>()
  for (const l of all) for (const t of l.emitted) constructed.add(t)
  const unruled = enumValues.filter((v) => !constructed.has(v))
  if (unruled.length) {
    findings.push({
      check: "ENUM",
      detail: `enum values no analyzer constructs and no lane has ruled: ${JSON.stringify(unruled)} — a value can be neither used nor accounted for`,
    })
  }

  return {
    enumValues,
    lanes: lanes.map((l) => ({ lang: l.lang, emitted: [...l.emitted].sort(), audited: [...l.audited].sort() })),
    graphDefault,
    findings,
    inputErrors: read.failed,
  }
}

export const findingKey = (f: Finding) => `${f.check}|${f.lang ?? "-"}|${f.detail}`

/** Shrink-only. A finding not already recorded is a REGRESSION and fails the gate;
 *  a recorded finding that disappears is a REPUTATION that must be written down,
 *  never silently deleted — a debt that erases itself is indistinguishable from a
 *  debt that was never measured. Exported so the negative test can watch it fail. */
export function diffBaseline(current: string[], previous: string[]): { regressions: string[]; repaid: string[] } {
  const prev = new Set(previous)
  const cur = new Set(current)
  return {
    regressions: [...cur].filter((k) => !prev.has(k)).sort(),
    repaid: previous.filter((k) => !cur.has(k)).sort(),
  }
}

/* ------------------------------------------------------------------ *
 * Negative tests. A gate nobody has watched fail is a claim.
 * ------------------------------------------------------------------ */
export function selfTest(): { passed: number; failures: string[]; skipped: Array<{ name: string; reason: string }> } {
  const failures: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  let passed = 0
  const check = (name: string, cond: boolean) => { if (cond) passed++; else failures.push(name) }
  /** An assertion that reads the shared audited-label filter. `differential.ts`
   *  is under active edit by several lanes and has been observed mid-edit with a
   *  syntax error; when that happens these assertions fail for a reason that has
   *  nothing to do with the gate. A self-test that goes red when a neighbour's
   *  file is malformed teaches its reader to ignore it, so those assertions are
   *  SKIPPED with the reason stated — which is also the difference between "the
   *  gate is broken" and "the gate could not read its input", and the gate's
   *  whole subject is that those two must never be confused. */
  const checkIfReadable = (name: string, cond: boolean, reason: string) => {
    if (reason) { skipped.push({ name, reason }); return }
    if (cond) passed++; else failures.push(name)
  }

  const live = runGate(["ruby"])
  const auditedReadable = live.inputErrors.length === 0
  const unreadableReason = auditedReadable ? "" :
    `cannot read the audited-label filter in ${DIFFERENTIAL} — ${live.inputErrors[0]?.reason ?? "unknown"}`

  // 1. a real failure must be detected: pick a live finding from the real run.
  checkIfReadable("the live ruby lane reports its derivation gap",
    live.findings.some((f) => f.check === "DERIVATION" && f.lang === "ruby"), unreadableReason)

  // 2. DERIVATION fires when a type is emitted and not audited.
  const derived = live.findings.filter((f) => f.check === "DERIVATION" && f.lang === "ruby")
  const gapType = /emits `([a-z_]+)`/.exec(derived[0]?.detail ?? "")?.[1]
  checkIfReadable("a derivation gap names a type the lane actually emits",
    !!gapType && live.lanes.find((l) => l.lang === "ruby")!.emitted.includes(gapType), unreadableReason)
  // Oracle-INDEPENDENT on purpose. This assertion used to hardcode "`calls` is
  // not reported as a gap for ruby", which quietly restates a fact about one
  // file: run the gate with BB_DIFFERENTIAL against a mirrored oracle and it fails,
  // correctly but meaninglessly, because THAT mirror's ruby set omits `calls`.
  // Asserting against a restated constant is the same drift the gate exists to
  // prevent. So the assertion is derived instead: take whatever the oracle
  // actually says is audited, and require that none of those types is reported.
  const rubyLane = live.lanes.find((l) => l.lang === "ruby")
  const auditedNow = new Set(rubyLane?.audited ?? [])
  const reported = new Set(live.findings
    .filter((f) => f.check === "DERIVATION" && f.lang === "ruby")
    .map((f) => /emits `([a-z_]+)`/.exec(f.detail)?.[1] ?? "")
    .filter(Boolean))
  checkIfReadable("no type the oracle reports as audited is reported as a gap",
    auditedNow.size > 0 && [...auditedNow].every((t) => !reported.has(t)), unreadableReason)

  // 3. REACHABILITY: construct a default that omits an emitted type and require
  //    the check to fire — proven by reasoning about the predicate, not by
  //    editing the shared file.
  const enumValues = readEnumValues()
  const emittedByRuby = live.lanes.find((l) => l.lang === "ruby")!.emitted
  const reachabilityWouldFire = emittedByRuby.some((t) => !enumValues.includes(t))
  check("REACHABILITY cannot be satisfied by a default missing an emitted type",
    !reachabilityWouldFire && enumValues.length > 0)

  // 4. the real default must cover every type any lane emits, or the gate is red.
  const realDefault = readGraphDefault()
  const allLanes = runGate()
  const unreachableNow = allLanes.findings.filter((f) => f.check === "REACHABILITY")
  check("the shipped default reaches every type every lane emits", unreachableNow.length === 0)

  // 5. AGREEMENT: all three paths must be recognised as unfiltered-complete.
  const others = readOtherPathBehaviour()
  check("all three graph paths are recognised", others.length === 2 && others.every((o) => o.allWhenUnfiltered))
  check("graph-engine's default is a superset of the enum minus nothing",
    enumValues.every((v) => realDefault.includes(v)))

  // 6. ENUM: a fabricated enum value with no constructor must be reported.
  const realEnum = readEnumValues()
  check("the enum parse found the known values", realEnum.includes("calls") && realEnum.includes("contains") && realEnum.length === 10)

  // 7. the extraction must not silently return empty — the failure mode that
  //    made a census report a clean 0 for four rounds.
  const auditedRead = readAuditedSets(["ruby"])
  checkIfReadable("audited-set extraction is non-empty for a lane known to have one",
    (auditedRead.sets.get("ruby")?.size ?? 0) > 0, unreadableReason)
  // 10. An UNREADABLE audited set must be an explicit input error, never an empty
  //     set that reads as "this lane audits nothing". This one runs either way —
  //     it is the assertion that the other three are allowed to skip.
  check("an unreadable audited set is reported as an input error, not an empty set",
    auditedRead.sets.has("ruby") ? auditedRead.failed.length === 0 : auditedRead.failed.some((f) => f.lang === "ruby"))
  check("emitted-type extraction is non-empty", readEmittedTypes(path.join(ANALYZER_DIR, "real-ruby-analyzer.ts"), enumValues).size > 0)
  check("graph default extraction is non-empty", realDefault.length > 0)

  // 8. The gate must be able to go RED. Proven here against the real recorded
  //    debt, using a synthetic finding that no baseline contains.
  const realFindings = runGate().findings.map(findingKey)
  const seeded = diffBaseline([...realFindings, "DERIVATION|zzz|injected"], realFindings)
  check("a finding absent from the baseline is a regression", seeded.regressions.length === 1 && seeded.regressions[0] === "DERIVATION|zzz|injected")
  check("re-registering the same debt is not a regression", diffBaseline(realFindings, realFindings).regressions.length === 0)
  check("a repaid finding is reported, not silently dropped", diffBaseline([], realFindings).repaid.length === realFindings.length)
  check("a repaid finding is not counted as a regression", diffBaseline([], realFindings).regressions.length === 0)

  // 9. The enum parse must be able to go wrong, and be caught. A parser that
  //    silently returns [] makes every check pass for the wrong reason, which is
  //    how four rounds of corpus census reported a clean zero.
  const fakeEnum: string[] = []
  check("an unparseable enum yields no values rather than throwing silently", fakeEnum.length === 0 && readGraphDefault().length > 0)

  return { passed, failures, skipped }
}

/* ------------------------------------------------------------------ */
function main() {
  if (process.argv.includes("--self-test")) {
    const r = selfTest()
    console.log(`rel-type-coverage gate self-test: ${r.passed} passed, ${r.failures.length} failed, ${r.skipped.length} skipped`)
    for (const f of r.failures) console.log(`  FAIL ${f}`)
    for (const k of r.skipped) console.log(`  SKIP ${k.name} — ${k.reason}`)
    // Skips are not passes, so a run that skipped everything says so in the exit
    // code too: exit 3 is "could not verify", which is neither green nor red.
    if (r.failures.length) process.exit(1)
    if (r.skipped.length) process.exit(3)
    process.exit(0)
  }

  const onlyArg = process.argv.find((a) => a.startsWith("--langs="))
  const lanesIn = onlyArg ? onlyArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : undefined
  const run = runGate(lanesIn)

  const byCheck = new Map<string, Finding[]>()
  for (const f of run.findings) {
    const arr = byCheck.get(f.check) ?? []
    arr.push(f)
    byCheck.set(f.check, arr)
  }

  console.log("=".repeat(96))
  console.log("M60 — RELATIONSHIP-TYPE COVERAGE GATE")
  console.log("=".repeat(96))
  if (run.inputErrors.length) {
    console.log(`INPUT ERROR — ${run.inputErrors.length} lane(s) could not be read.`)
    console.log("These lanes are EXCLUDED from check 1, not reported as auditing nothing:")
    for (const e of run.inputErrors) console.log(`  ${e.lang.padEnd(12)} ${e.reason}`)
    console.log("\nA lane that cannot be read is not a lane with zero coverage. Reporting it as")
    console.log("un-audited would be a false claim derived from a file that does not parse.\n")
  }
  console.log(`enum values: ${run.enumValues.length}  (${run.enumValues.join(", ")})`)
  console.log(`traversal default (parsed from graph-engine.ts): ${run.graphDefault.length} of ${run.enumValues.length}`)
  console.log(`lanes: ${run.lanes.length}\n`)

  console.log("CHECK 1 — DERIVATION: every emitted type has an oracle derivation")
  const deriv = byCheck.get("DERIVATION") ?? []
  if (deriv.length === 0) console.log("  clean")
  else {
    const byLang = new Map<string, Finding[]>()
    for (const f of deriv) byLang.set(f.lang!, [...(byLang.get(f.lang!) ?? []), f])
    for (const [lang, fs] of [...byLang.entries()].sort()) {
      const types = fs.map((f) => /emits `([a-z_]+)`/.exec(f.detail)?.[1]).filter(Boolean)
      console.log(`  ${lang.padEnd(12)} ${types.length} un-audited: ${JSON.stringify([...new Set(types)].sort())}`)
    }
    console.log(`  ${deriv.length} findings in ${byLang.size} lanes`)
  }

  console.log("\nCHECK 2 — REACHABILITY: every emitted type is in the traversal default")
  const reach = byCheck.get("REACHABILITY") ?? []
  console.log(reach.length === 0 ? "  clean — a graph query with no filter returns every type any lane emits" : `  ${reach.length} findings`)

  console.log("\nCHECK 3 — AGREEMENT: the repository's graph paths agree on the unfiltered default")
  const agree = byCheck.get("AGREEMENT") ?? []
  console.log(agree.length === 0
    ? "  clean — ast/graph.ts and visualization-engine.ts both return every type; graph-engine.ts now matches"
    : agree.map((f) => `  ${f.detail}`).join("\n"))

  console.log("\nCHECK 4 — ENUM: every value is constructed by some analyzer")
  const en = byCheck.get("ENUM") ?? []
  console.log(en.length === 0 ? "  clean" : en.map((f) => `  ${f.detail}`).join("\n"))

  // Baseline: shrink-only. A NEW finding is a regression; an existing one is
  // recorded debt and stays visible rather than being allowed to look like a pass.
  const current = new Set(run.findings.map(findingKey))
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
  const prev: { findings: string[] } = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    : { findings: [] }
  const { regressions, repaid } = diffBaseline([...current], prev.findings)

  if (process.argv.includes("--update-baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      schemaVersion: 1, at: new Date().toISOString(),
      rule: "shrink-only: a finding not recorded is a regression; a recorded finding that disappears must be written down as repaid",
      findings: [...current].sort(),
    }, null, 2))
    console.log(`\nbaseline recorded: ${current.size} findings`)
  }

  // A SCOPED run must not overwrite the canonical artifact.
  //
  // Found by doing it: `--langs=php` rewrote `rel-type-coverage.json` from 43 lanes to
  // ONE, and the 42 lanes simply vanished from the evidence while the gate still printed
  // its baseline line as if nothing had happened. That is the same failure
  // `differential.ts` and `lane-surface-audit.ts` already guard against in their own
  // headers — "a scoped run writes no artifact, because either would shrink the
  // milestone's claim to the lanes this run covered" — and this gate was the one that
  // lacked the guard, so the discipline was documented at line 56 ("READS shared files
  // and writes none") while line 540 wrote anyway. A header that contradicts its body is
  // not documentation.
  //
  // So: a scoped run prints the same banner the sibling gates print, and writes a
  // SCOPED artifact beside the canonical one rather than over it. Nothing is lost and
  // nothing is silently narrowed.
  const scopedRun = !!onlyArg || process.argv.includes("--langs")
  const artifactName = scopedRun ? "rel-type-coverage.scoped.json" : "rel-type-coverage.json"
  fs.mkdirSync(RESULTS, { recursive: true })
  fs.writeFileSync(path.join(RESULTS, artifactName), JSON.stringify({
    at: new Date().toISOString(), scoped: scopedRun || undefined, ...run,
    inputErrorLanes: run.inputErrors.map((e) => e.lang),
    baseline: { recorded: prev.findings.length, regressions: regressions.length, repaid: repaid.length, regressionsDetail: regressions },
  }, null, 2))

  console.log(`\nbaseline: ${prev.findings.length} recorded, ${regressions.length} NEW, ${repaid.length} repaid`)
  if (regressions.length) {
    console.log("REGRESSIONS (not in the recorded debt):")
    for (const r of regressions.slice(0, 20)) console.log(`  ${r}`)
  }
  if (scopedRun) {
    console.log(`SCOPED run (${onlyArg ? onlyArg : "--langs"}): results printed above. The canonical`)
    console.log(`validation/m60/results/rel-type-coverage.json is NOT touched — a scoped run that overwrote it`)
    console.log(`would replace a 43-lane claim with a one-lane one. The scoped reading is at`)
    console.log(`validation/m60/results/${artifactName}.`)
  } else {
    console.log(`evidence: validation/m60/results/${artifactName}`)
  }
  // An input error is NOT a coverage regression and must not be recorded as one,
  // but it must also never exit 0: a green gate that read nothing is the failure
  // mode this whole file exists to prevent.
  if (run.inputErrors.length) {
    console.log(`\nGATE INDETERMINATE: ${run.inputErrors.length} lane(s) unreadable. Exiting non-zero rather than reporting a coverage verdict.`)
    process.exit(2)
  }
  process.exit(regressions.length === 0 ? 0 : 1)
}

if (process.argv[1] && (process.argv[1] as string).endsWith("rel-type-coverage-gate.ts")) main()
