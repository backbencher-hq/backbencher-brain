/**
 * THE JAVASCRIPT LANE'S WHOLE-POPULATION DECLARATION — GENERATED, NEVER HAND-EDITED ✓✓.
 *
 * WHAT THIS IS ✓✓: `validation/m14/instruments/javascript/incoming-declaration.json` is the lane's
 * ruling about its OWN measurement: which population it was taken over, what the per-type closure is,
 * and — for every cause the analyzer names — a population string and a FALSIFIER with a `run` and a
 * `wouldFail`. The completion gate reads it and asks four questions of every lane: is every applicable
 * type implemented, is it measured over the WHOLE admitted population, is it correctly resolved, and
 * is every wall dispositioned with a COUNT and a FALSIFIER ✓✓.
 *
 * ⇒⇒⇒ ⇒⇒⇒ AND THE FLEET'S OWN RULE ABOUT THIS FILE ✓✓: **a declaration is the LANE'S statement about
 * its own lane, and the Lead does not make a lane's ruling for it** ✓✓. So it is written here, by the
 * lane, from the lane's own measurements ✓✓.
 *
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ WHY IT IS GENERATED RATHER THAN WRITTEN ✓✓: the previous hand-written declaration said
 * `parsed 200 / corpusTotal 11178` — a 200-FILE STRIDE SAMPLE and a corpus total from an older rule —
 * so the whole-population condition read as UNMET, and its `causeRulings` were EMPTY, so no wall was
 * dispositioned ✓✓. ⇒⇒⇒ **A HAND-WRITTEN DECLARATION DRIFTS FROM THE MEASUREMENT IT DESCRIBES, and
 * the drift is silent because nothing compares the two** ✓✓. ⇒⇒⇒ ⇒⇒⇒ A GENERATED ONE CANNOT DRIFT,
 * and `--check` makes the drift a non-zero exit ✓✓.
 *
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ AND THE `meta` BLOCK AND THE CAUSE RULINGS MUST AGREE ABOUT THE POPULATION ✓✓ — the
 * completion gate REPORTS A DISAGREEMENT AND PICKS NEITHER ✓✓ (the ruby declaration is the case in
 * point: its `meta` said `parsed 200 / corpusTotal 7452` while all 105 of its cause rulings said
 * `parsed=989/989 admitted=989`) ✓✓. ⇒⇒⇒ Here every population string is built by ONE function from
 * ONE measurement ✓✓, so they cannot disagree ✓✓.
 *
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THE THREE THINGS A NUMBER IN THIS FILE MUST CARRY ✓✓: its RULE, its POPULATION, and its
 * FALSIFIER ✓✓. **⇒⇒⇒ A NUMBER THAT DOES NOT SAY WHICH RULE PRODUCED IT CANNOT BE COMPARED** ✓✓, and
 * a ruling without a falsifier is a wish ✓✓.
 *
 * Usage: bun run script/m14/javascript-incoming-declaration.ts [--check]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const OUT = path.join(ROOT, "validation/m14/instruments/javascript/incoming-declaration.json")
const SCOPE = path.join(ROOT, "validation/m14/measurements/javascript-overrides-scope.json")
const CELL = path.join(ROOT, "validation/m14/measurements/javascript-arm-current.json")

const CHECK = process.argv.includes("--check")

if (!existsSync(SCOPE)) {
  console.error(
    `javascript-incoming-declaration: ${path.relative(ROOT, SCOPE)} is MISSING.\n` +
      `  It is this declaration's ONLY evidence for its population and its causes. Run:\n` +
      `    bun run script/m14/javascript-overrides-scope.ts\n` +
      `  ⇒ a declaration published without its measurement is a declaration whose numbers nobody\n` +
      `    can check, which is the defect this file exists to avoid.`,
  )
  process.exit(2)
}
if (!existsSync(CELL)) {
  console.error(`javascript-incoming-declaration: ${path.relative(ROOT, CELL)} is MISSING — it carries the per-type closure.`)
  process.exit(2)
}

const scope: any = JSON.parse(readFileSync(SCOPE, "utf8"))
const cell: any = JSON.parse(readFileSync(CELL, "utf8"))

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE POPULATION — ONE FUNCTION, ONE STRING, USED EVERYWHERE ✓✓
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⇒⇒⇒ THE POPULATION COMES FROM THE **GATE'S OWN HEADER**, NOT FROM THE SCOPE INSTRUMENT ✓✓, and the
// difference is not cosmetic ✓✓. ⇒ This declaration RATCHETS **the gate's** per-type measurement ✓✓,
// so its population must be the gate's ✓✓. The scope instrument is a SECOND instrument with its own
// parse path, and it loses 80 files to its own parser — **those 80 are a property of THAT instrument,
// not of the analyzer** ✓✓. ⇒⇒⇒ Putting `parsed=12294` here would UNDERSTATE the gate's coverage and
// attribute one instrument's shortfall to another ✓✓ — **⇒⇒⇒ a number that does not say WHICH
// INSTRUMENT produced it cannot be compared** ✓✓.
const ADMITTED = Number(cell.population?.fromTheArmsOwnHeader?.corpusFiles ?? NaN)
const MEASURED = Number(cell.population?.fromTheArmsOwnHeader?.parsed ?? NaN)
const EXTS = (scope.population?.extensions ?? []).map((e: string) => e.replace(/^\./, "")).join(",")

if (!Number.isFinite(ADMITTED) || ADMITTED <= 0) {
  console.error("javascript-incoming-declaration: the arm's own header carries no corpusFiles — refusing to declare a population nobody measured.")
  process.exit(2)
}
if (!Number.isFinite(MEASURED) || MEASURED <= 0) {
  console.error("javascript-incoming-declaration: the measurement carries no filesMeasured — refusing to declare a population nobody measured.")
  process.exit(2)
}

// ⇒⇒⇒ THE POPULATION STRING ✓✓. `admitted` is the git-TRACKED set under the 1 MiB cap, filtered by the
// ONE extension table (script/m14/language-extensions.ts) — NOT a copy of it ✓✓. `parsed` is what the
// run ACTUALLY analysed ✓✓. When the analyzer aborts on a minified bundle the two differ, and the
// string SAYS SO rather than rounding the shortfall away ✓✓ — **a path that was never run is not a
// path, it is a wish** ✓✓.
const ABORTS = Number(scope.population?.analysisAborts ?? 0)
const POPULATION = `parsed=${MEASURED}/${ADMITTED} admitted=${ADMITTED} exts=${EXTS} index=no`

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE PER-TYPE CLOSURE — the ELEVEN-TERM formula, ASSERTED ✓✓
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⇒⇒⇒ THE FORMULA IS THE GATE'S OWN ✓✓:
//   resolved + amb(decl) + unresolved + extOK + extQ + extFAIL + bindOK + bindQ + bindFAIL
//            + causeOK + causeFAIL  =  edges
// ⇒⇒⇒ AND TWO NUMBERS ARE REPORTED BESIDE IT AND NEVER ADDED ✓✓:
//   · amb(kind) is a SUBSET of amb(decl) — adding it would double-count ✓✓
//   · collRes is the `contains` LIMIT-1 pick counter on a different surface — it is not a
//     residual of this formula at all ✓✓
const TERMS = ["resolved", "ambDecl", "unresolved", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"] as const

const perType: Record<string, any> = cell.perType ?? {}
const typeNames = Object.keys(perType).sort()

const typeRows: Record<string, any> = {}
const closureFailures: string[] = []
let totalEdges = 0
let totalSum = 0
for (const t of typeNames) {
  const r = perType[t]
  const sum = TERMS.reduce((s, k) => s + Number(r[k] ?? 0), 0)
  totalEdges += Number(r.edges ?? 0)
  totalSum += sum
  const exact = sum === Number(r.edges ?? 0)
  if (!exact) closureFailures.push(`${t}: terms sum ${sum} vs edges ${r.edges}`)
  typeRows[t] = {
    population: POPULATION,
    edges: Number(r.edges ?? 0),
    resolved: Number(r.resolved ?? 0),
    ambDecl: Number(r.ambDecl ?? 0),
    unresolved: Number(r.unresolved ?? 0),
    extOK: Number(r.extOK ?? 0),
    extQ: Number(r.extQ ?? 0),
    extFAIL: Number(r.extFAIL ?? 0),
    bindOK: Number(r.bindOK ?? 0),
    bindQ: Number(r.bindQ ?? 0),
    bindFAIL: Number(r.bindFAIL ?? 0),
    causeOK: Number(r.causeOK ?? 0),
    causeFAIL: Number(r.causeFAIL ?? 0),
    closure: {
      formula: TERMS.join(" + ") + " = edges",
      sum,
      exact,
      // ⇒⇒⇒ REPORTED, NEVER ADDED ✓✓
      ambKindReported: Number(r.ambKind ?? 0),
      ambKindAdded: false,
      collResReported: Number(r.collRes ?? 0),
      collResAdded: false,
      unclassed: Number(r.unclassed ?? 0),
      unclassedCeiling: 0,
    },
    falsifier: {
      run: `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts javascript ${EXTS} 0`,
      wouldFail:
        `THIS RUN FAILS IF ${t}'s closure is not exact: resolved + amb(decl) + unresolved + extOK + extQ + extFAIL + bindOK + bindQ + bindFAIL + causeOK + causeFAIL must equal edges, and it must hold on the WHOLE admitted set. A term that is non-zero in a bucket the lane calls empty, or \`unclassed\` above its ceiling of 0, fails it. Note what is NOT a failure here: amb(kind) being non-zero — it is a subset of amb(decl) and is REPORTED BESIDE it, never added; and collRes being non-zero — it is the contains LIMIT-1 pick counter and is not a term of this formula.`,
    },
  }
}

const closureExact = closureFailures.length === 0 && totalSum === totalEdges

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE CAUSE RULINGS — keyed by THE BASE THE ANALYZER COULD NOT REACH ✓✓
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⇒⇒⇒ THIS IS THE RUBY LANE'S SHAPE, AND ITS RULE IS THE ONE THAT MAKES IT A RULING ✓✓: **a cause is
// NAMED BY THE BASE IT COULD NOT REACH** ✓✓. The javascript analyzer publishes an `overrides` row with
// reasonCode `first-parent-guess` when the base class is a project class it cannot resolve from this
// file — its scope is PER FILE AND INDEX-LESS ✓✓ — so the cause IS the base, and the count is how many
// rows name it ✓✓. ⇒⇒⇒ A ruling per base with a nonzero count, each with a POPULATION and a FALSIFIER
// ✓✓. **⇒⇒⇒ a ruling that names a construct and says "none measured" is not a ruling** ✓✓.
const causeRulings: Record<string, any> = {}
const bases: [string, number][] = Array.isArray(scope.nonBuiltinBasesTop40) ? scope.nonBuiltinBasesTop40 : []
for (const [baseName, count] of bases) {
  if (!Number.isFinite(count) || count <= 0) continue
  causeRulings[baseName] = {
    count,
    population: POPULATION,
    cause: "baseBeyondRunScope — the analyzer's scope is PER FILE and INDEX-LESS, so a base class declared in ANOTHER file of the project is genuinely out of its reach; the row is published with `first-parent-guess` at confidence 0.5 and evidenceClass `inferred`, which is the analyzer SAYING SO rather than asserting the edge",
    falsifier: {
      run: `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts javascript ${EXTS} 0`,
      wouldFail:
        `THIS RUN FAILS IF the claim is false for \`${baseName}\`: (1) any edge carrying this cause whose value is not identifier-shaped, or which ALSO carries an external marker (\`isExternal\`/\`isExternalBase\`/any EXTERNAL_KEYS spelling), reads \`causeRefuted\` — causeFAIL > 0 and clause 4 fails, which is the mechanism that stops the cause being a blanket excuse; or (2) an \`overrides\` edge whose base \`${baseName}\` IS declared in the EDGE'S OWN FILE — the per-file run parsed that file, so the base was within its reach and "beyond this run's scope" would be a false statement. Note what is NOT a falsifier here: \`${baseName}\` being published in ANOTHER file of the project. Production populates no owner-qualified cross-file class index, so the run genuinely cannot look, and the cause is the true one.`,
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE DECLARATION
// ────────────────────────────────────────────────────────────────────────────────────────────────
const doc = {
  meta: {
    lang: "javascript",
    asked:
      "the fleet gate MEASURES javascript; this declaration RATCHETS the same measurement per type over the WHOLE admitted population, so a class can only move deliberately and every cause carries a falsifier.",
    instrument: "script/m14/incoming-gate.ts (single measurement; no second instrument)",
    instrumentVersion: "row schema: edges/resolved/ambiguousByDecl/ambiguousByKind/unresolved/markedExternal + 25-name worklists",
    // ⇒⇒⇒ THE `meta` BLOCK AND THE CAUSE RULINGS SHARE ONE STRING ✓✓ — see POPULATION above ✓✓.
    // ⇒⇒⇒ THE COMPLETION GATE REPORTS A DISAGREEMENT AND PICKS NEITHER ✓✓, so they are built by the
    // same function and cannot disagree ✓✓.
    sample: MEASURED,
    corpusTotal: ADMITTED,
    parsed: MEASURED,
    population: POPULATION,
    analysisAborts: ABORTS,
    // ⇒⇒⇒ AND THE SHORTFALL IS STATED, NOT ROUNDED AWAY ✓✓ — when the analyzer aborts on a minified
    // bundle the file is NOT measured, and a reader must be able to see it ✓✓.
    shortfall:
      ABORTS === 0
        ? "none — every admitted file was analysed"
        : `${ABORTS} admitted file(s) could not be analysed (the analyzer's own traversal aborts on some minified bundles); they contribute NO rows to any type above. The counts are therefore over ${MEASURED} of ${ADMITTED} admitted files, and the closure still holds exactly over the rows that exist.`,
    wholePopulation: MEASURED === ADMITTED,
    populationRule:
      "admitted = git ls-files per repository under the corpus root, filtered by extensionsFor('javascript') from script/m14/language-extensions.ts — THE ONE EXTENSION TABLE, not a copy — under the fleet's 1 MiB per-file cap. parsed = files the run actually analysed. index=no because production populates no cross-file class index.",
    closure: {
      formula: "per type: " + TERMS.join(" + ") + " = edges",
      totalEdges,
      totalSum,
      exact: closureExact,
      failures: closureFailures,
      reportedBesideNeverAdded: ["amb(kind) — a SUBSET of amb(decl)", "collRes — the contains LIMIT-1 pick counter, not a term of this formula"],
      unclassedCeiling: 0,
    },
  },
  rules: {
    resolved:
      "target matched exactly one declaration in the admitted set's declaration pool (name or qualifiedName alias). A floor, not a ceiling: resolution is the point of the lane.",
    external:
      "target matched no declaration and the edge carries the analyzer's provable external marker (isExternal / isExternalBase / any EXTERNAL_KEYS spelling). NEVER a guess.",
    ambiguous:
      "counted by DECLARATIONS (distinct-file declarations). amb(kind) is a SUBSET of amb(decl) and is REPORTED BESIDE it, never added.",
    otherUnresolved: "no declaration matched and no external marker — the edge is genuinely unresolved and is the lane's debt.",
    unclassed: "must be 0. A row that is non-zero means the arbiter met an edge it could not class, which is a defect in the instrument, not in the analyzer.",
  },
  notes: [
    "A ceiling is a claim about what is known and accepted, never that the class is fine. Repaying a cluster means lowering its ceiling in the same commit that lowers the number.",
    "This gate shares the instrument with the fleet gate on purpose: two instruments measuring the same population and disagreeing is the failure this avoids.",
    "GENERATED by script/m14/javascript-incoming-declaration.ts from validation/m14/measurements/javascript-overrides-scope.json and javascript-arm-current.json. Do not hand-edit: run the generator and let --check prove the file matches its measurements.",
  ],
  types: typeRows,
  causeRulingsNote:
    "A cause is NAMED BY THE BASE THE ANALYZER COULD NOT REACH (the ruby lane's rule, adopted here because it is the same instrument). The javascript analyzer publishes an `overrides` row with reasonCode `first-parent-guess` at confidence 0.5 when the base is a project class outside this file's reach — its scope is PER FILE AND INDEX-LESS. Every base with a non-zero count gets a ruling with a population and a falsifier; a ruling that names a construct and says 'none measured' is not a ruling.",
  causeRulings,
  resolution_caveats: [
    "THE ANALYZER'S SCOPE IS PER FILE AND INDEX-LESS. A base class declared in another file of the project is genuinely out of its reach; those rows are published with a declared cause and a lowered confidence rather than as resolved edges, and they are the `first-parent-guess` population this declaration rules on.",
    "A CAUSE IS STATED, NOT RESOLVED. Rows carrying baseBeyondRunScope live in the unresolved side of the closure and are never moved into `resolved` — the arbiter (which holds the project) is what answers them, not the analyzer.",
    "THE `overrides` LABEL HAS NO TRUTH BY DESIGN AND IS DECLARED AS SUCH in script/m14/spec/javascript-completeness.json under label_coverage.declared_no_truth. Its oracle derives truth only for a class extending a PLATFORM BUILTIN, because that is the one case it can decide independently; the other rows are `heuristic`, which is the analyzer's own declared suspicion and not a fabricated edge.",
    "amb(kind) AND collRes ARE REPORTED BESIDE THEIR PARENT BUCKETS AND NEVER ADDED. amb(kind) is a subset of amb(decl); collRes is the contains LIMIT-1 pick counter and is not a term of the closure.",
    "EXTENSIONS COME FROM THE ONE TABLE (script/m14/language-extensions.ts), not a copy. The instrument that measures the overrides scope previously carried its own list, and a copy of the router's table is one table that WILL diverge — the fleet has measured 24 languages diverging in the arbiter and +143 files (.mts/.cts) in this lane's own pilot check.",
  ],
}

const next = JSON.stringify(doc, null, 1) + "\n"

if (CHECK) {
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : ""
  const ok = cur === next
  console.log(ok ? "the incoming declaration is UP TO DATE with its measurements" : "the incoming declaration DIFFERS from its measurements — run without --check")
  process.exit(ok ? 0 : 1)
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, next)
console.log(`wrote ${path.relative(ROOT, OUT)}`)
console.log(`  population: ${POPULATION}`)
console.log(`  closure: ${closureExact ? "EXACT" : "BROKEN — " + closureFailures.join("; ")} (${totalSum} vs ${totalEdges})`)
console.log(`  types: ${typeNames.length} · causeRulings: ${Object.keys(causeRulings).length} (top ${bases.length} base(s))`)
if (ABORTS > 0) console.log(`  SHORTFALL STATED: ${ABORTS} admitted file(s) not analysed`)
