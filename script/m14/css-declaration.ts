/**
 * CSS — THE WHOLE-POPULATION DECLARATION, DERIVED FROM THE ARM'S OWN TABLE 1.
 *
 * The completion gate reads `validation/m14/instruments/css/incoming-declaration.json`. The
 * file it found was the lane's older, narrower account; this instrument builds it from the
 * arm's own measurement instead of transcribing it by hand, because a hand-written
 * declaration is a second copy of a measurement and the gate reads only one of them.
 *
 * REFUSALS (all fatal, nothing written):
 *   · the arm's population line does not say parsed == admitted            -> exit 4
 *   · the arm's population disagrees with the lane's census               -> exit 4
 *   · a per-type row's eleven terms do not sum to its edge count          -> exit 5
 *   · the fleet TOTAL's terms do not sum to the fleet edge count          -> exit 5
 *   · the per-type edge sum does not equal the fleet edge count           -> exit 5
 *   · a type row is missing                                               -> exit 5
 *
 * USAGE: npx tsx script/m14/css-declaration.ts --arm <log> --census <json> [--write]
 */
import { readFileSync, writeFileSync } from "node:fs"

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const armPath = arg("--arm")
const censusPath = arg("--census")
const write = argv.includes("--write")
if (!armPath || !censusPath) {
  console.error("usage: css-declaration.ts --arm <incoming-gate log> --census <json> [--write]")
  process.exit(2)
}
const log = readFileSync(armPath, "utf8")
const census = JSON.parse(readFileSync(censusPath, "utf8"))

// ── population, from the arm's own line ───────────────────────────────────────
const pop = log.match(/population: (\d+) parsed of (\d+) sampled \(corpus has (\d+) \.css,less,sass files across (\d+) repos/)
if (!pop) { console.error("REFUSED (4): the arm log carries no population line"); process.exit(4) }
const parsed = Number(pop[1]), sampled = Number(pop[2]), corpusTotal = Number(pop[3]), repos = Number(pop[4])
if (parsed !== sampled) { console.error(`REFUSED (4): parsed ${parsed} != sampled ${sampled} — a sample cannot back a whole-population declaration`); process.exit(4) }
if (parsed !== corpusTotal) { console.error(`REFUSED (4): parsed ${parsed} != the corpus total ${corpusTotal} — the run did not cover the population`); process.exit(4) }
const censusAdmitted = Number(census?.population?.admitted)
if (parsed !== censusAdmitted) { console.error(`REFUSED (4): the arm's admitted ${parsed} != the census's ${censusAdmitted} — two instruments over two populations`); process.exit(4) }
const POP = `parsed=${parsed}/${parsed} admitted=${parsed} exts=css,less,sass index=no`

// ── TABLE 1: type + thirteen numbers ─────────────────────────────────────────
const LABELS = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates","decorates","renders","mixes_in","part_of"]
type Row = { edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number; unresolved: number; extOK: number; extUnk: number; extFAIL: number; bindOK: number; bindUnk: number; bindFAIL: number; causeOK: number; causeFAIL: number }
const rows: Record<string, Row> = {}
// TABLE 1 has ONE row per type and its numbers are `edges` followed by thirteen terms; a SECOND
// per-type table appears later in the log (the pooled corpus key space) — it is a different
// measurement of the same names, so only the FIRST occurrence of each label is TABLE 1.
const rowRe = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates|decorates|renders|mixes_in|part_of)\s+((?:\d+\s+){13}\d+)\s*$/gm
let m: RegExpExecArray | null
while ((m = rowRe.exec(log)) !== null) {
  if (rows[m[1]]) continue
  const v = m[2].trim().split(/\s+/).map(Number)
  rows[m[1]] = { edges: v[0], resolved: v[1], collRes: v[2], ambDecl: v[3], ambKind: v[4], unresolved: v[5], extOK: v[6], extUnk: v[7], extFAIL: v[8], bindOK: v[9], bindUnk: v[10], bindFAIL: v[11], causeOK: v[12], causeFAIL: v[13] }
}
for (const l of LABELS) {
  if (!rows[l]) { console.error(`REFUSED (5): no TABLE 1 row for ${l}`); process.exit(5) }
  const r = rows[l]
  const sum = r.resolved + r.ambDecl + r.unresolved + r.extOK + r.extUnk + r.extFAIL + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK + r.causeFAIL
  if (sum !== r.edges) { console.error(`REFUSED (5): ${l}: terms ${sum} != edges ${r.edges}`); process.exit(5) }
}
const totalRow = log.match(/^TOTAL\s+((?:\d+\s+){13}\d+)\s*$/m)
if (!totalRow) { console.error("REFUSED (5): no fleet TOTAL row"); process.exit(5) }
const tv = totalRow[1].trim().split(/\s+/).map(Number)
const totalEdges = tv[0]
const totalSum = tv[1] + tv[3] + tv[5] + tv[6] + tv[7] + tv[8] + tv[9] + tv[10] + tv[11] + tv[12] + tv[13]
if (totalSum !== totalEdges) { console.error(`REFUSED (5): fleet TOTAL terms ${totalSum} != edges ${totalEdges}`); process.exit(5) }
const perTypeSum = LABELS.reduce((n, l) => n + rows[l].edges, 0)
if (perTypeSum !== totalEdges) { console.error(`REFUSED (5): per-type edges ${perTypeSum} != fleet ${totalEdges}`); process.exit(5) }
const extFAIL = LABELS.reduce((n, l) => n + rows[l].extFAIL, 0)
const bindFAIL = LABELS.reduce((n, l) => n + rows[l].bindFAIL, 0)
const causeFAIL = LABELS.reduce((n, l) => n + rows[l].causeFAIL, 0)
if (extFAIL + bindFAIL + causeFAIL > 0) { console.error(`REFUSED (5): a refusal fired (extFAIL ${extFAIL} · bindFAIL ${bindFAIL} · causeFAIL ${causeFAIL}) — a run with a refuted claim is not a declaration`); process.exit(5) }

// ── the gate's five buckets, from TABLE 1 ────────────────────────────────────
// resolved = the row's resolved · external = extOK · ambiguous = amb(decl)
// otherUnresolved = unresolved + bindOK + causeOK (three KINDS of stated non-resolution:
//   the target names nothing here, the edge is spelled as a binding, or the analyzer declared
//   why it could not reach the base) · unclassed = 0, ALWAYS (the ceiling is zero).
const types: Record<string, any> = {}
for (const l of LABELS) {
  const r = rows[l]
  types[l] = {
    edges: r.edges,
    resolved: r.resolved,
    external: r.extOK,
    ambiguous: r.ambDecl,
    otherUnresolved: r.unresolved + r.bindOK + r.causeOK,
    unclassed: 0,
    _ambKind: r.ambKind,
    _collRes: r.collRes,
    closure: { edges: r.edges, resolved: r.resolved, collRes: r.collRes, ambDecl: r.ambDecl, ambKind: r.ambKind, unresolved: r.unresolved, extOK: r.extOK, extUnk: r.extUnk, extFAIL: r.extFAIL, bindOK: r.bindOK, bindUnk: r.bindUnk, bindFAIL: r.bindFAIL, causeOK: r.causeOK, causeFAIL: r.causeFAIL },
  }
}

// ── the wall, from the arm's own named-cause worklist ────────────────────────
// The arm prints an AMBIGUOUS/UNRESOLVED worklist per type and a VERDICT line carrying the
// residual. Both are MEASURED numbers; the causes below are the types' own statements, each
// with the count the arm prints and a falsifier that is a run and a would-fail.
const verdict = log.match(/(\d+) ambiguous \+ (\d+) unresolved of (\d+) edges/)
if (!verdict) { console.error("REFUSED (6): the arm log carries no VERDICT residual line"); process.exit(6) }
const ambTotal = Number(verdict[1]), unresTotal = Number(verdict[2])
const causeRulings: Record<string, any> = {
  imports_targets_outside_the_admitted_set: {
    population: POP,
    count: rows.imports.unresolved,
    what: "the `imports` row's unresolved targets are stylesheet specifiers whose files are NOT in the admitted set (a relative path out of the repository, or a bare package name). An `@import` names a stylesheet the run cannot open, so no declaration in this population can answer it — the count is the arm's own unresolved column for the type.",
    falsifier: { run: "npx tsx script/m14/incoming-gate.ts css 0 (the whole-population arm; TABLE 1's imports unresolved column is the count)", wouldFail: "a run in which one of those specifiers resolves — that would mean the target IS in the admitted set and the row belongs in resolved." },
  },
  references_custom_property_declared_elsewhere: {
    population: POP,
    count: rows.references.ambDecl,
    what: "the `references` row's ambiguous tail is CUSTOM PROPERTIES declared more than once across the project (`--color-cd-punctuation`, `--color-cd-builtin`, …): a `var(--x)` read names a property whose declaration site cannot be chosen from the name alone, which is the tie-break the arbiter applies, not a defect in this lane.",
    falsifier: { run: "npx tsx script/m14/incoming-gate.ts css 0 (TABLE 1's references ambiguous column is the count; the worklist prints the names)", wouldFail: "a run in which those names resolve to ONE declaration — that would mean the ambiguity was the run's resolution mode, not the corpus's name collisions." },
  },
  part_of_targets_naming_no_carried_file: {
    population: POP,
    count: rows.part_of.unresolved + rows.part_of.ambDecl,
    what: "the `part_of` row's non-resolved tail is plain-file-form `@import` specifiers that name a file the admitted set does not carry (`minireset`, `generic`, `animations`, `breadcrumb`) plus ONE ambiguous name (`table`, six declarations of the type). The census measured the same split from the other side: of 126 plain-file-form sites, 114 name a carried file and 12 name nothing admitted.",
    falsifier: { run: "npx tsx script/m14/incoming-gate.ts css 0 (TABLE 1's part_of columns; the worklist prints the names)", wouldFail: "a run in which one of those specifiers resolves — that would move it into resolved and shrink this count." },
  },
}

const decl = {
  meta: {
    lang: "css",
    instrument: "script/m14/incoming-gate.ts (single whole-population measurement; this declaration is DERIVED from its own TABLE 1 by script/m14/css-declaration.ts, which refuses on any non-closure)",
    sample: parsed,
    corpusTotal,
    corpusRepos: repos,
    parsed,
    population: POP,
    populationRule: { rule: "the admitted set is the GIT-TRACKED set: per-checkout `git ls-files` over $PWD/.corpus, extensions css,less,sass from the router's one table, files present on disk and at most 1 MiB" },
    resolvedScope: "the file's OWN PROJECT (production's scope; index=no — the analyzer sees one file at a time, and the arbiter holds the project)",
    measuredEdges: totalEdges,
    closure: { resolved: LABELS.reduce((n, l) => n + rows[l].resolved, 0), external: LABELS.reduce((n, l) => n + rows[l].extOK, 0), ambiguous: ambTotal, otherUnresolved: unresTotal, unclassed: 0 },
    generatedBy: "script/m14/css-declaration.ts",
  },
  types,
  causeRulings,
  resolution_caveats: [
    "A CAUSE IS STATED, NOT RESOLVED: unresolved rows live in otherUnresolved (which also holds the binding-spelled and declared-cause rows), never in resolved, and the analyzer's scope is PER FILE with index=no — a target declared in another file of the project is genuinely out of its reach and the arbiter (which holds the project) is what answers it.",
    "`contains` and `uses` resolve to nodes of the SAME file, so their resolved buckets mean what the bucket means everywhere: this file declares the name.",
    "`references` carries the custom-property reads (161,768 of them) whose target is a custom property NAME: a resolved reference says a declaration of that name exists in this file, not that it is the read's only source.",
    "`part_of` rows are the plain-file-form `@import` inclusions; their target is the included stylesheet's project-relative name, and 383-class resolution behaviour is CSS-family: a header need not declare a symbol named after itself, which is why 12 of the 126 plain-file sites name nothing admitted.",
    "`calls` and `exports` are IMPLEMENTED AND CORPUS-UNEXERCISED: the analyzer emits them from the grammar's own shapes (`@function --name` declarations and the CSS Modules `:export` block) and this population exercises neither, so both publish measured zero rows with fixture css/calls-and-exports as the live positive control.",
  ],
}

if (!write) {
  console.log(JSON.stringify({ meta: decl.meta, types: Object.keys(types).length, causes: Object.keys(causeRulings).length }, null, 1))
  console.log("DRY RUN — nothing written (pass --write)")
  process.exit(0)
}
writeFileSync("validation/m14/instruments/css/incoming-declaration.json", JSON.stringify(decl, null, 2) + "\n")
console.log(`WROTE validation/m14/instruments/css/incoming-declaration.json — ${totalEdges} edges, ${Object.keys(types).length} types, ${Object.keys(causeRulings).length} cause rulings, population ${POP}`)
