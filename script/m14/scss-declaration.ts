#!/usr/bin/env bun
/**
 * SCSS INCOMING DECLARATION — the whole-population closure, written only when it RECONCILES.
 *
 * WHY THIS FILE EXISTS. The completion gate (Lead-owned `script/m14/completion-gate.ts`) reads ONE
 * file per lane — `validation/m14/instruments/<lane>/incoming-declaration.json` — and answers the
 * owner's five conditions from it. A lane that edits that file by hand is publishing a table it did
 * not sum; this generator is the lane's own instrument, and it REFUSES TO WRITE on any of:
 *   · a TABLE 1 row whose eleven terms do not sum to its edge count (unclassed ceiling 0);
 *   · an arm whose header says it parsed fewer files than the population holds;
 *   · an arm that did not use the project index (this population's declaration says index=yes);
 *   · a cause census whose partition is not exact;
 *   · an extended census whose leak guard did not hold.
 *
 * THE ELEVEN-TERM CLOSURE, exactly as the fleet states it:
 *   resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL
 *     + extOK + ext? + extFAIL + causeOK + causeFAIL = edges
 * `amb(kind)` and `collRes` are reported BESIDE their parent buckets and NEVER added.
 * The five gate buckets are a DECLARED COARSENING: external = extOK + ext?; otherUnresolved =
 * unresolved + extFAIL + the binding terms + the cause terms.
 *
 * THE POPULATION STRING IS THE FULL FORM in `meta` AND in every cause ruling
 * (`parsed=N/N admitted=N exts=<exts> index=<yes|no>`), because the gate's single regex reads that
 * shape and a shorter spelling parses as NULL — the yaml lane's measured trap.
 *
 * RUN:  bun script/m14/scss-declaration.ts
 * WRITE: validation/m14/instruments/scss/incoming-declaration.json
 * EXIT: 0 written · 3 an input artifact is missing · 5 AN INVARIANT FAILED (nothing written)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const DIR = resolve(ROOT, "validation/m14/measurements/scss")
const POP_PATH = resolve(ROOT, "validation/m14/measurements/scss-population.json")
const EXT_PATH = resolve(ROOT, "validation/m14/measurements/scss-extended-census.json")
const CAUSE_PATH = resolve(ROOT, "validation/m14/measurements/scss-cause-census.json")
const GRAMMAR_PATH = resolve(ROOT, "validation/m14/measurements/scss-grammar-nodes.json")
const ANALYZER_PATH = resolve(ROOT, "src/ast/real-scss-analyzer.ts")
const OUT_PATH = resolve(ROOT, "validation/m14/instruments/scss/incoming-declaration.json")

const fail = (msg: string, code = 5): never => {
  console.error(`SCSS DECLARATION REFUSED — ${msg}`)
  process.exit(code)
}

const armLog = (() => {
  if (!existsSync(DIR)) fail(`no arm directory ${DIR}`, 3)
  const c = readdirSync(DIR).filter((f) => /^scss-gate-whole-.*\.txt$/.test(f)).sort()
  if (c.length === 0) fail("no whole-population arm log", 3)
  return resolve(DIR, c[c.length - 1]!)
})()
for (const [p, what] of [[POP_PATH, "population artifact"], [EXT_PATH, "extended census"], [CAUSE_PATH, "cause census"], [GRAMMAR_PATH, "grammar-node inventory"]] as const) {
  if (!existsSync(p)) fail(`missing ${what} at ${p}`, 3)
}

const pop = JSON.parse(readFileSync(POP_PATH, "utf8")) as {
  admitted: number
  tracked: number
  repositoriesCarrying: number
  repositories: Array<{ repo: string; tracked: number; admitted: number }>
  overCap: Array<{ path: string; bytes: number }>
  extensions: string[]
  capBytes: number
  populationRule: string
}
const ext = JSON.parse(readFileSync(EXT_PATH, "utf8")) as {
  kind: string
  guard: { filesAdmitted: number; filesRead: number; filesFailed: number }
  counts: Record<string, number>
  servedBuildR1: { servedWasSha256: string; namedTypes: number; totalIds: number; stemMatches: Record<string, string[]> }
}
const cause = JSON.parse(readFileSync(CAUSE_PATH, "utf8")) as {
  partition: { tableUnresolved: number; dumpedUnresolved: number; totalClassified: number; exact: boolean }
  classes: Array<{ cause: string; class: string; edges: number; rowsByLabel: Record<string, number>; statement: string; falsifier: { run: string; wouldFail: string; measuredHits: number; hitExamples: string[] }; examples: string[] }>
  problems: string[]
}
const grammar = JSON.parse(readFileSync(GRAMMAR_PATH, "utf8")) as { servedDigest: string | null; namedTypes: number; totalIds: number }
const armText = readFileSync(armLog, "utf8")

const EXTS = pop.extensions.join(",")
const POPULATION = `parsed=${pop.admitted}/${pop.admitted} admitted=${pop.admitted} exts=${EXTS} index=yes`

// ── TABLE 1 ────────────────────────────────────────────────────────────────────────────────────
interface Row {
  edges: number
  resolved: number
  collRes: number
  ambDecl: number
  ambKind: number
  unresolved: number
  extOK: number
  extUnk: number
  extFAIL: number
  bindOK: number
  bindUnk: number
  bindFAIL: number
  causeOK: number
  causeFAIL: number
}
const table = new Map<string, Row>()
{
  const lines = armText.split("\n")
  const header = lines.findIndex((l) => l.startsWith("type ") && l.includes("edges") && l.includes("causeFAIL"))
  if (header < 0) fail("the arm log has no TABLE 1 header")
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i]!
    // TABLE 1's header is followed by a rule line, then rows, then a rule line and TOTAL. The
    // first rule line is NOT the end of the table — skipping it is what makes the parser see rows.
    if (/^-{10,}/.test(line.trim())) continue
    if (line.trim() === "" || line.startsWith("TOTAL")) break
    const m = /^([a-z_]+)\s+(.+)$/.exec(line)
    if (!m) break
    const n = m[2]!.trim().split(/\s+/).map(Number)
    if (n.length < 14 || n.some((x) => !Number.isFinite(x))) break
    table.set(m[1]!, {
      edges: n[0]!, resolved: n[1]!, collRes: n[2]!, ambDecl: n[3]!, ambKind: n[4]!, unresolved: n[5]!,
      extOK: n[6]!, extUnk: n[7]!, extFAIL: n[8]!, bindOK: n[9]!, bindUnk: n[10]!, bindFAIL: n[11]!,
      causeOK: n[12]!, causeFAIL: n[13]!,
    })
  }
  if (table.size === 0) fail("TABLE 1 parsed as empty")
}
const parsedMatch = /population: (\d+) parsed of (\d+)/.exec(armText)
if (!parsedMatch) fail("the arm header carries no 'population: N parsed of M' line — this arm is not a population run")
const parsed = Number(parsedMatch![1])
const populationTotal = Number(parsedMatch![2])
if (parsed !== pop.admitted || populationTotal !== pop.admitted) {
  fail(`population mismatch: arm parsed ${parsed}/${populationTotal}, artifact says ${pop.admitted} admitted`)
}
if (!armText.includes("project index: USED")) fail("the arm did not use the project index; the declaration says index=yes")

// ── the ext census guard ──────────────────────────────────────────────────────────────────────
if (ext.kind !== "WHOLE POPULATION") fail(`the extended census is a ${ext.kind}, not the population`)
if (ext.guard.filesRead !== ext.guard.filesAdmitted || ext.guard.filesFailed !== 0) {
  fail(`the extended census guard failed: read ${ext.guard.filesRead} of ${ext.guard.filesAdmitted}, ${ext.guard.filesFailed} failed`)
}
if (ext.guard.filesAdmitted !== pop.admitted) fail(`the extended census covered ${ext.guard.filesAdmitted}, the population is ${pop.admitted}`)

// ── the cause census partition ────────────────────────────────────────────────────────────────
if (!cause.partition.exact || cause.problems.length > 0) fail(`the cause census partition is not exact: ${cause.problems.join("; ")}`)
if (cause.classes.reduce((a, c) => a + c.edges, 0) !== cause.partition.tableUnresolved) {
  fail("the cause census classes do not sum to TABLE 1's unresolved total")
}

// ── the per-type rows ─────────────────────────────────────────────────────────────────────────
const ORDER = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]
const types: Record<string, any> = {}
let sumEdges = 0
let sumUnresolvedByType: Record<string, number> = {}
for (const [label, r] of table) {
  const closure = {
    edges: r.edges,
    resolved: r.resolved,
    collRes: r.collRes,
    ambDecl: r.ambDecl,
    ambKind: r.ambKind,
    unresolved: r.unresolved,
    extOK: r.extOK,
    extUnk: r.extUnk,
    extFAIL: r.extFAIL,
    bindOK: r.bindOK,
    bindUnk: r.bindUnk,
    bindFAIL: r.bindFAIL,
    causeOK: r.causeOK,
    causeFAIL: r.causeFAIL,
  }
  const sum = r.resolved + r.ambDecl + r.unresolved + r.bindOK + r.bindUnk + r.bindFAIL + r.extOK + r.extUnk + r.extFAIL + r.causeOK + r.causeFAIL
  if (sum !== r.edges) fail(`closure does not sum for ${label}: ${sum} vs edges ${r.edges} — the unclassed ceiling is 0, so nothing is parked`)
  const external = r.extOK + r.extUnk
  const otherUnresolved = r.unresolved + r.extFAIL + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK + r.causeFAIL
  const bucketSum = r.resolved + external + r.ambDecl + otherUnresolved + 0
  if (bucketSum !== r.edges) fail(`the five gate buckets do not partition ${label}: ${bucketSum} vs ${r.edges}`)
  types[label] = {
    edges: r.edges,
    resolved: r.resolved,
    ambiguous: r.ambDecl,
    otherUnresolved,
    external,
    unclassed: 0,
    _ambKind: r.ambKind,
    _collRes: r.collRes,
    closure,
  }
  sumEdges += r.edges
  sumUnresolvedByType[label] = r.unresolved
}
for (const label of ORDER) {
  if (!types[label]) fail(`TABLE 1 has no row for the vocabulary type "${label}" — the declaration must publish all fourteen`)
}
const causeByLabel: Record<string, number> = {}
for (const c of cause.classes) for (const [l, n] of Object.entries(c.rowsByLabel)) causeByLabel[l] = (causeByLabel[l] ?? 0) + n
for (const [label, n] of Object.entries(sumUnresolvedByType)) {
  if ((causeByLabel[label] ?? 0) !== n) fail(`the cause census labels ${label} as ${causeByLabel[label] ?? 0} wall rows but TABLE 1 says ${n} unresolved`)
}

const totalEdges = types !== null ? Object.values(types).reduce((a: number, t: any) => a + t.edges, 0) : 0
if (totalEdges !== sumEdges) fail("internal: edge total mismatch")

const analyzerDigest = "sha256:" + createHash("sha256").update(readFileSync(ANALYZER_PATH)).digest("hex").slice(0, 16)

const declaration = {
  meta: {
    lang: "scss",
    instrument: "script/m14/incoming-gate.ts (ONE whole-population run with --dump, index-assisted; the closure is not chunked)",
    sample: pop.admitted,
    corpusTotal: pop.admitted,
    corpusRepos: pop.repositoriesCarrying,
    parsed: pop.admitted,
    population: POPULATION,
    populationRule: pop.populationRule,
    populationNote:
      "ONE WHOLE-POPULATION RUN, NOT SAMPLES: the arm parsed 4,433 of 4,433 admitted with 0 parse failures and 0 degraded, so every bucket below is the population's. " +
      "THE ARM IS INDEX-ASSISTED ON PURPOSE: `.scss` is in src/ast/parallel-indexer.ts PROJECT_INDEX_EXTENSIONS and incoming-gate.ts carries an SCSS_DECLARATION_SPEC, so production builds a project index for this language and the resolution scope here is per project. " +
      `The 2 over-cap paths are carried BY NAME in the population artifact (${pop.overCap.map((o) => o.path).join(", ")}); a disk walk would be a different population.`,
    metric: "ambiguous counted by DECLARATIONS (distinct declarations), not distinct kinds; amb(kind) is a subset reported beside",
    analyzer: "src/ast/real-scss-analyzer.ts",
    analyzerDigest,
    analyzerDigestsNote: "sha256 of the analyzer the arm measured, first 16 hex characters.",
    generated: new Date().toISOString().slice(0, 10),
    armCommand: "BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts scss scss 0 --dump --index",
    armLog: armLog.replace(ROOT + "/", ""),
    supersedes:
      "THIS ARM SUPERSEDES the 2026-10-23 run taken before the Lead's shared-filter exemption 0f313a05d: " +
      "that run measured the analyzer through a filter that DELETED every `@mixin <name>`/`@function <name>` " +
      "target, so its TABLE 1 read `calls 0` and `mixes_in 0` while the analyzer emitted both. The superseded " +
      "artifact and the reason are preserved at validation/m14/measurements/scss/SUPERSEDED-pre-0f313a05d.md " +
      "and scss-gate-whole-2026-10-23.SUPERSEDED-pre-0f313a05d.txt — a number whose meaning changed is " +
      "superseded visibly, never edited.",
    artifacts: {
      population: "validation/m14/measurements/scss-population.json",
      extendedCensus: "validation/m14/measurements/scss-extended-census.json",
      causeCensus: "validation/m14/measurements/scss-cause-census.json",
      grammarNodes: "validation/m14/measurements/scss-grammar-nodes.json",
    },
  },
  rules: {
    measurement: "one whole-population run; TABLE 1 of the incoming gate; the eleven-term closure re-checked here before writing, per type",
    population: "the whole admitted set; no stride and no subsample",
    closure:
      "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges. amb(kind) and collRes are reported beside their parent buckets and NEVER added. unclassed ceiling is 0.",
    direction: "resolved/external are FLOORS (may not decrease). ambiguous/otherUnresolved/unclassed are CEILINGS (may not increase).",
    bucketMapping: "external = extOK + ext?; otherUnresolved = unresolved + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL. The five gate buckets are a declared coarsening of the eleven terms; every row publishes the eleven terms in `closure`.",
  },
  types,
  causeRulings: Object.fromEntries(
    cause.classes.map((c) => [
      c.cause,
      {
        population: POPULATION,
        edges: c.edges,
        class: c.class,
        statement: c.statement,
        rowsByLabel: c.rowsByLabel,
        examples: c.examples,
        falsifier: {
          run: c.falsifier.run,
          wouldFail: c.falsifier.wouldFail,
          measuredHits: c.falsifier.measuredHits,
          hitExamples: c.falsifier.hitExamples,
        },
      },
    ]),
  ),
  resolution_caveats: [
    "THE RESOLUTION SCOPE IS PER PROJECT, WHICH IS PRODUCTION'S SCOPE (index=yes). `parallel-indexer.resolveRelationships` fills `target_symbol_id` only from a project-scoped qualified-name exact match, or from a bare name whose count IN THAT PROJECT is exactly 1. A name that collides with a declaration in ANOTHER repository reads unresolved here and would not necessarily read so in a pooled scope, and this lane publishes the per-project numbers as the verdict's.",
    "`collRes` IS A SUBSET OF `resolved` AND IS NEVER ADDED: a resolved edge whose target had MORE THAN ONE declaration in the project, so production's own-file tie-break chose the row. The fleet's own indexer measures 37,318 of 49,729 such picks as WRONG, so this lane's resolved column is a FLOOR on correct resolution, not a count of correct edges. The number is published per row so a reader can discount it.",
    "`amb(kind)` IS A SUBSET OF `amb(decl)`: it counts distinct KINDS among the colliding declarations, while amb(decl) counts distinct DECLARATIONS. Two different questions about the same edges; only the by-declaration count is in the closure.",
    "★ `mixes_in` IS PUBLISHED FOR EVERY CLEAN `include_statement` — including includes whose mixin this file does NOT declare — with the target in the lane's published spelling (`@mixin <name>`). Those rows are UNRESOLVED rather than absent: the mixin is declared in another file or in a dependency the project does not carry, and the cause census counts them as M1. THE NAMESPACED FORM `@include ns.mixin` IS A MEASURED WALL: the served build splits the node at the dot, so the mixin name is not a node this walk can read; the extended census counts those sites (`includeUnparsable`) and R2 (a grammar patch to accept a dotted callable path) is the named available remedy, NOT taken this round.",
    "★ `part_of` IS A LABEL MOVE, NOT A NEW EDGE: the Sass file-inclusion form of `@import` (exactly one `string_value` named child, specifier not a stylesheet URL) was published as `imports` by the CSS delegate and is published as `part_of` now, with the mandatory `metadata.partRole: \"library\"`. Source, target, line and the delegate's `importProjectFile` claim are unchanged. `imports` therefore holds the stylesheet-loading forms only (`url(...)`, a media query, a `.css` specifier, a protocol URL, `sass:`), and the `@use`/`@forward` RELATIONSHIP EDGE is still a MEASURED GAP with its own proposal (validation/m14/proposals/scss-imports-use-forward.md) — it is not claimed here.",
    "★ THE TWO RULED TYPES ARE `decorates` AND `renders`, each with its ladder walked and its measurement cited in script/m14/spec/scss-completeness.json's `excluded` entries and in validation/m14/verification/SCSS-EXTENDED-TYPES.md: R1 was measured over the served build's OWN node inventory (validation/m14/measurements/scss-grammar-nodes.json: 90 named types of 195 ids; the decorator/render stems match 0), R2 is unavailable because a patch would have to INVENT SYNTAX the language does not have, and R3 has no node type that carries either relation (the near miss is `!important`/`!global`/`!default` for decorates — modifiers that name no callable — and `content:`/pseudo-elements for renders — value generation, not component rendering).",
    "★ THIS ARM MEASURED THE ANALYZER THROUGH A SHARED FILTER THAT WAS FIXED MID-CAMPAIGN, AND THE FIX IS PART OF THE NUMBER. `src/ast/pool-worker.ts` `filterNoiseRelationships` (rule added 2026-10-21) refused any target leaf containing whitespace as a code snippet, and this lane's published callable spelling is `@mixin <name>`/`@function <name>` — so every `calls` and `mixes_in` row was SILENTLY DELETED before the store. MEASURED on bootstrap: before the Lead's exemption `0f313a05d`, `mixes_in 0 / 327 emitted`, `calls 0 / 51`; after it, `mixes_in 327 (213 resolved)`, `calls 51 (51 resolved)`. ⇒ A FIX FOR ONE LANE'S SNIPPETS WAS EATING ANOTHER LANE'S EDGES, and the earlier arm is SUPERSEDED (see meta.supersedes) rather than edited.",
    "★ 27 OF THE ARM'S 553 UNRESOLVED ROWS ARE A DECLARED DEFECT, NOT A WALL-RELEASE: class E1b — an `@extends` target that IS declared as a rule in the same file yet left unresolved. The cause census separates it from the 128 E1 rows where the selector is genuinely out of the per-file analyzer's reach. It is counted so the defect is a number rather than a sentence; it is not released as a wall.",
    "THE LANE'S `contains` EDGES CARRY A LARGE `collRes` SHARE BY CONSTRUCTION (a member answers to its owner's name, and CSS selectors repeat across files); the per-row collRes column is where a reader must look before comparing this lane's resolved share with a lane whose scope differs.",
  ],
}

mkdirSync(resolve(ROOT, "validation/m14/instruments/scss"), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(declaration, null, 2) + "\n")

console.log("SCSS INCOMING DECLARATION — written and reconciled")
console.log(`  population: ${POPULATION} · ${pop.repositoriesCarrying} repositories`)
console.log(`  arm: ${armLog.replace(ROOT + "/", "")} · analyzer ${analyzerDigest}`)
console.log(`  types ${Object.keys(types).length} · total edges ${totalEdges}`)
for (const label of ORDER) {
  const t = types[label]!
  console.log(`    ${label.padEnd(12)} edges ${String(t.edges).padStart(7)} · resolved ${String(t.resolved).padStart(7)} · amb ${String(t.ambiguous).padStart(6)} · otherUnresolved ${String(t.otherUnresolved).padStart(6)} · external ${String(t.external).padStart(6)} · closure sum OK`)
}
console.log(`  cause rulings ${cause.classes.length}, partition exact over ${cause.partition.tableUnresolved} wall rows`)
console.log(`  -> ${OUT_PATH}`)
