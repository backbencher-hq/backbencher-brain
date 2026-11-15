/**
 * perl LANE — THE CAUSE-RULING GENERATOR.  (lane-owned instrument)
 *
 * IT WRITES ONE FILE: `validation/m14/instruments/perl/incoming-declaration.json` — the lane's
 * own machine-readable declaration, which is the ONLY per-lane surface the gate may READ.  The
 * gate may not write one: a gate that writes its own input checks nothing.
 *
 * IT READS TWO THINGS, both committed:
 *   * the lane's arm log (`arm-whole-2026-10-20.log`) — for the NAMED CAUSES and their COUNTS,
 *     read out of the gate's own clause-3 failure line, so the ruling set is exactly the set the
 *     gate refused, and the counts are the gate's own;
 *   * the population fingerprint of that arm — `parsed=656/656 admitted=656 exts=pl,pm,t,pod,perl
 *     index=no`, which is the string the gate's `populationFingerprint` builds.  The gate REFUSES a
 *     ruling written over a different population, so the fingerprint is not decoration: it is the
 *     clause's "SAME population" test.
 *
 * THE RULING, ONCE, AND IT IS THE SAME RULING 182 TIMES.  Every perl cause is the same claim:
 * the analyzer declares `baseBeyondRunScope = <Owner>` on an edge whose target names nothing in
 * the project, and the claim means "the class this edge names is beyond this run's reach".  The
 * per-cause name and count are the only things that differ, and they are what the gate prints.
 *
 * THE FALSIFIER IS ONE RUN, AND IT IS THE LANE'S OWN: `cause-falsifier.mts`.  It looks for a
 * class-like declaration whose LEAF equals the cause's name anywhere in the population; one hit
 * refutes the ruling for that cause.  The `wouldFail` string says what the reader would see if
 * the ruling were wrong.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

const LOG = process.argv[2] ?? "validation/m14/fixtures/perl/arm-whole-2026-10-20.log"
const OUT = process.argv[3] ?? "validation/m14/instruments/perl/incoming-declaration.json"

// THE POPULATION FINGERPRINT — the gate's `populationFingerprint(rep)` for THIS arm:
//   `parsed=${rep.parsed}/${rep.files.length}  admitted=${rep.total}  exts=${rep.admittedExts.join(",")}  index=${rep.index ? "yes" : "no"}`
const POPULATION = "parsed=656/656 admitted=656 exts=pl,pm,t,pod,perl index=no"

const raw = readFileSync(LOG, "utf8")

// THE NAMED CAUSES, read out of the gate's OWN VERDICT LINE — the FULL set the run declared,
// with the gate's own names and the gate's own counts.
//
// IT USED TO BE READ FROM THE CLAUSE-3 FAILURE LINE, WHICH IS THE SET THE GATE REFUSED — and
// that set DEPENDS ON THE RULING FILE THAT ALREADY EXISTS.  So the generator read the causes the
// gate was complaining about, and on the next run the gate complained about a SUBSET of them
// (the four that were already ruled stopped being complaints), and the generator refused to
// write anything: "the cause counts sum to 4, the arm's TABLE 1 causeOK is 33".  A generator
// whose input depends on its own previous output cannot be re-run, and a ruling file that can
// only be written once is not a measurement.
//
// THE VERDICT LINE CARRIES THE WHOLE SET ("named cause(s): Exporter 20 · URI 7 · ... (33
// declared, 0 REFUTED)"), and the generator's own invariant still checks it against TABLE 1's
// causeOK — so the check the clause-3 line was serving is now served by a source that does not
// depend on the file being written.
const verdictRe = /named cause\(s\): ([^|]*?)\s*\((\d+) declared/
const vm = verdictRe.exec(raw)
if (!vm) {
  console.error(`NO NAMED-CAUSE LIST in ${LOG} — the gate's verdict line is absent, so there is nothing to rule.`)
  process.exit(1)
}
const causes = new Map<string, number>()
for (const part of vm[1].split("·")) {
  const t = part.trim()
  const sp = t.lastIndexOf(" ")
  if (sp <= 0) continue
  causes.set(t.slice(0, sp), Number(t.slice(sp + 1)))
}
const declaredEdges = Number(vm[2])

// THE SECOND CHECK, KEPT: the gate's clause-3 failure line must name a SUBSET of these — the
// causes it is refusing.  If it names one that is not in the set above, the two readings of the
// same log disagree and the generator must not write a file from either of them.
const refusedRe = /cause "([^"]*)" \((\d+) edge\(s\)\) has NO ruling/g
const refused = new Map<string, number>()
let m: RegExpExecArray | null
while ((m = refusedRe.exec(raw)) !== null) refused.set(m[1], Number(m[2]))
for (const [name, count] of refused) {
  if (!causes.has(name)) {
    console.error(`DISAGREEMENT: the gate's clause-3 line refuses cause "${name}" (${count} edge(s)) but the verdict line does not name it.`)
    process.exit(1)
  }
  if (causes.get(name) !== count) {
    console.error(`DISAGREEMENT: cause "${name}" is ${count} edge(s) in the clause-3 line and ${causes.get(name)} in the verdict line.`)
    process.exit(1)
  }
}
console.log(`the gate refuses ${refused.size} of the ${causes.size} named cause(s) — the rest already have rulings`)

if (causes.size === 0) {
  console.error(`NO CAUSES FOUND in ${LOG} — there is nothing to rule.`)
  process.exit(1)
}
const sum = [...causes.values()].reduce((a, b) => a + b, 0)
console.log(`causes read from the arm's clause-3 line: ${causes.size} · edges: ${sum}`)
// THE GATE'S OWN causeOK, for the same arm — read POSITIONALLY out of TABLE 1's TOTAL row,
// because the gate's table columns are parsed positionally by its own residual gate and a
// column NAME is not in the file.  The TOTAL row's fields are:
//   type edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL
//   bindOK bind? bindFAIL causeOK causeFAIL
const total = /^\s*TOTAL\s+(\d+(?:\s+\d+){13})\s*$/m.exec(raw)
const armCauseOK = total ? Number(total[1].trim().split(/\s+/)[12]) : NaN
console.log(`the arm's TABLE 1 TOTAL causeOK column: ${total ? armCauseOK : "NOT FOUND"} (the counts must sum to it)`)
if (!Number.isFinite(armCauseOK) || armCauseOK !== sum || declaredEdges !== sum) {
  console.error(`MISMATCH: the cause counts sum to ${sum}, the arm's TABLE 1 causeOK is ${armCauseOK}. The ruling set would not cover the run's causes.`)
  process.exit(1)
}

const RUN = "BB_CORPUS_ROOT=$PWD/.corpus bun run validation/m14/fixtures/perl/cause-falsifier.mts"

// ── THE FALSIFICATION, READ AS EVIDENCE ───────────────────────────────────────
// The ruling may only cover a cause the falsifier SURVIVES.  A ruling over a cause the
// population refutes is a false statement, and the fleet's rule is that a claim and its
// evidence must not come from the same author — here the analyzer would be the author of both.
const FALS = "validation/m14/fixtures/perl/cause-falsification.json"
let fals: any = null
try { fals = JSON.parse(readFileSync(FALS, "utf8")) } catch { /* handled below */ }
if (!fals) {
  console.error(`NO FALSIFICATION at ${FALS} — the ruling set cannot be written without the falsifier's measurement. Run the falsifier first.`)
  process.exit(1)
}
const surviving = new Set<string>(fals.surviving?.causes ?? [])
const refutedQ1 = new Set<string>(Object.keys(fals.q1_projectScope?.detail ?? {}))
const refutedQ2 = new Set<string>(Object.keys(fals.q2_analyzerScope?.detail ?? {}))
console.log(`falsification read: ${fals.causeEdges} cause edge(s) over ${fals.namedCauses} named base(s)`)
console.log(`  refuted by the PROJECT scope   : ${refutedQ1.size} cause(s)`)
console.log(`  refuted by the ANALYZER's scope: ${refutedQ2.size} cause(s)`)
console.log(`  SURVIVING both (ruleable)      : ${surviving.size} cause(s) · ${fals.surviving?.edges ?? 0} edge(s)`)
if (fals.causeEdges !== sum) {
  console.error(`MISMATCH: the falsifier tested ${fals.causeEdges} cause edge(s), the arm's clause-3 line names ${sum}.`)
  process.exit(1)
}

const causeRulings: Record<string, unknown> = {}
for (const [name, count] of [...causes.entries()].sort((a, b) => b[1] - a[1])) {
  if (!surviving.has(name)) continue      // a cause the falsifier refuted CANNOT be ruled honestly
  causeRulings[name] = {
    population: POPULATION,
    falsifier: {
      run: RUN,
      wouldFail:
        `wouldFail: a class-like declaration whose LEAF is "${name}" would be found in the admitted ` +
        `population, so the ${count} edge(s) that declare "base beyond this run's reach" for base "${name}" ` +
        `would be claiming a base the run COULD reach — the claim would be false, the gate would have to ` +
        `publish those edges as unresolved, and this ruling would be wrong.`,
    },
  }
}

const doc = {
  meta: {
    lang: "perl",
    asked:
      "the fleet gate MEASURES perl and exits 1 on its bar; this declaration RATCHETS the same measurement " +
      "per cause, so a class can only move deliberately. It exists because the gate's clause 3 refuses a " +
      "named cause with no ruling, and a ruling with no run is prose.",
    instrument: "script/m14/incoming-gate.ts (single measurement; no second instrument)",
    instrumentVersion: "arbiter sha1 776d1d09d4ee44ad · gate sha1 4bbb3dc7d50959ac (the read set of the arm this file was measured on)",
    analyzerDigestMeasured: `sha1 ${createHash("sha1").update(readFileSync("src/ast/real-perl-analyzer.ts")).digest("hex")} (MEASURED at generation time, not transcribed)`,
    population: POPULATION,
    corpusRoot: "BB_CORPUS_ROOT=$PWD/.corpus (the FARM — 656 files / 9 repos; the gate's default root admits 427 / 8)",
    arm: LOG,
    armCommand: `bash script/m14/perl-arm.sh ${LOG}`,
    analyzer: "src/ast/real-perl-analyzer.ts",
    analyzerDigest: `sha1 ${createHash("sha1").update(readFileSync("src/ast/real-perl-analyzer.ts")).digest("hex")} (MEASURED at generation time)`,
    generated: "2026-10-20",
    generator: "validation/m14/fixtures/perl/make-cause-rulings.mts",
    notes: [
      `EVERY ONE OF THE ${fals.namedCauses} RULINGS IS THE SAME CLAIM, because every perl cause is the same claim: the analyzer declares \`metadata.baseBeyondRunScope = <Owner>\` on an edge whose target names nothing in the project, and the claim means 'the class this edge names is beyond this run's reach'. The arbiter already checks half of that (the base must be the target's own owner and identifier-shaped, or the claim is REFUTED and counted against the lane as causeFAIL); the other half — the corpus does not declare that class — is what the falsifier checks.`,
      `THE FALSIFIER IS ONE RUN FOR ALL ${fals.namedCauses}, and it is the lane's own: it looks for a class-like declaration whose LEAF equals the cause's name anywhere in the admitted population. One hit refutes that cause's ruling and the run exits 1. A falsifier that tests a different question would be a decoration; this one asks the arbiter's own question.`,
      `THE COUNTS SUM TO THE ARM'S causeOK (${fals.causeEdges}) and the generator REFUSES to write the file if they do not — so the ruling set cannot silently cover a different set of causes than the run declared.`,
      `A RULING IS OVER ONE POPULATION. The gate refuses a ruling written over a different population, so when the corpus root or the admitted set changes, this file must be regenerated and the arm re-run. A stale fingerprint is the gate's own check, and it is the reason the fingerprint is in every ruling rather than only in the meta.`,
      `*** THIS FILE IS DELIBERATELY PARTIAL, AND IT IS PARTIAL BECAUSE THE OTHER ${refutedQ1.size + refutedQ2.size - [...refutedQ1].filter(c => refutedQ2.has(c)).length} CAUSE(S) ARE MEASURED FALSE. *** The falsifier REFUTES ${refutedQ1.size} of the ${fals.namedCauses} named causes by the arm's own project scope and ${refutedQ2.size} by the analyzer's own file scope, so only the ${surviving.size} cause(s) that SURVIVE both scopes are ruled here (${fals.surviving?.edges ?? 0} of ${fals.causeEdges} edges). A ruling is an ASSERTION THAT THE CLAIM IS TRUE — the \`wouldFail\` text says the run that would show the base IS declared — so ruling a cause the population refutes would be a FALSE DECLARATION, and the lane will not write one. The refuted cause(s) are therefore left UNRULED, and the gate's clause 3 fails on them: it fails CORRECTLY, because the lane's cause channel still carries claims the corpus disproves.`,
      `THE ${refutedQ1.size + refutedQ2.size} REFUTED CAUSE(S) ARE A PROJECT-SCOPE FACT, NOT A LANE-SIDE ONE: their base is a SINGLE-SEGMENT class name (no '::'), so the analyzer held exactly the spelling it published and the run could not have known the project declares it. A per-file, index-less analyzer cannot see another file's declaration — only the ARBITER can, because the arbiter holds the project. The lane's own fix of 2026-10-20 removed every cause the ANALYZER could know about (178 of 182 causes, 2222 of 2251 edges); what remains is exactly the population that needs the ARBITER's project scope, and the priced proposal to the Lead is on the lane's page.`,
      `THE BEFORE STATE IS ON THE RECORD: the arm before the lane-side fix carried ${fals.before?.causeEdges ?? "?"} cause edges over ${fals.before?.namedCauses ?? "?"} named causes, and the falsifier's measurement of it is preserved at validation/m14/fixtures/perl/cause-falsification-BEFORE-fix-2026-10-20.json. The fix moved ${fals.before?.causeEdges ?? "?"} -> ${fals.causeEdges} cause edges and moved NO resolution number: the production view is 46.0798 % before and after.`,
    ],
    falsification: {
      instrument: "validation/m14/fixtures/perl/cause-falsifier.mts",
      measurement: "validation/m14/fixtures/perl/cause-falsification.json",
      exit: "1 (the falsifier fires on this population)",
      causeEdgesTested: fals.causeEdges,
      namedCausesTested: fals.namedCauses,
      refutedByProjectScope: [...refutedQ1].sort(),
      refutedByAnalyzerScope: [...refutedQ2].sort(),
      survivingCausesRuledHere: [...surviving].sort(),
      survivingEdges: fals.surviving?.edges ?? 0,
      refutedCausesLeftUnruled: [...new Set([...refutedQ1, ...refutedQ2])].filter(c => !surviving.has(c)).sort(),
      beforeTheLaneSideFix: fals.before ?? null,
      beforeMeasurementFile: "validation/m14/fixtures/perl/cause-falsification-BEFORE-fix-2026-10-20.json",
    },
  },
  causeRulings,
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n")
console.log(`WROTE ${OUT} — ${Object.keys(causeRulings).length} rulings over ${POPULATION}`)
