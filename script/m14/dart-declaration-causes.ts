/**
 * DART'S CAUSE RULINGS — regenerated from a MERGED POPULATION, never hand-carried.
 *
 * WHY THIS EXISTS: the cause set is a PROPERTY OF THE RUN'S SCOPE, not of the files. A
 * `baseBeyondRunScope` claim is emitted when an `@override` method's heritage base is a name THE RUN
 * COULD NOT REACH, so the population's cause set is whatever the population run NAMED — and a ruling
 * written against a different scope is a ruling against a different population.
 *
 * ⇒⇒ ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒** ⇒⇒ **⇒⇒**
 *
 * ⇒⇒ SO THE RULINGS ARE REBUILT FROM THE MERGE: every `cause "<base>" (<n> edge(s))` the merged
 * population named gets a ruling carrying THAT population's own string and a falsifier that MEASURES
 * the opposite claim — a run in which the base IS REACHABLE and the override edge STILL does not
 * resolve. A cause the population did not name gets NO ruling: a ruling over a population that never
 * named the cause is a claim about a run that did not happen.
 *
 * ⇒⇒ ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒** ⇒⇒ **⇒⇒**
 *
 * THE FALSIFIER IS A MEASURE, NOT A PERFORMANCE: validation/m14/fixtures/dart/cause-falsifier.mts
 * runs the shared gate over a repository that DECLARES the base and FAILS if the cause is still
 * named there. It exits 5 when the cause survives in a scope that reaches its base (the claim is
 * false), 0 when the cause is gone (the ruling survives), and 2 when the run produced no verdict —
 * so an unmeasurable run can never be read as a pass.
 */
import { readFileSync, writeFileSync } from "node:fs"

const mergedPath = process.argv[2]
const declPath = process.argv[3] ?? "validation/m14/instruments/dart/incoming-declaration.json"
if (!mergedPath) {
  console.error("usage: bun run script/m14/dart-declaration-causes.ts <merged-population.json> [declaration.json]")
  process.exit(2)
}

const raw = readFileSync(mergedPath, "utf8")
const start = raw.indexOf("\n{")
const text = start >= 0 ? raw.slice(start + 1) : raw
const merged = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))

const decl = JSON.parse(readFileSync(declPath, "utf8"))
const pop = decl.meta?.population
if (typeof pop !== "string" || !pop.length) {
  console.error("*** THE CAUSE RULINGS REFUSE THIS DECLARATION — it carries no population string ***")
  process.exit(4)
}

const reason = String(merged.reason ?? "")
const named = new Map<string, number>()
for (const m of reason.matchAll(/cause "([^"]+)" \((\d+) edge\(s\)\)/g)) {
  const name = m[1]
  named.set(name, (named.get(name) ?? 0) + Number(m[2]))
}

const RUN = "BB_CORPUS_ROOT=$PWD/.corpus bun run validation/m14/fixtures/dart/cause-falsifier.mts"
const rulings: Record<string, any> = {}
for (const [name, n] of named) {
  rulings[name] = {
    population: pop,
    falsifier: {
      run: `${RUN} ${name}`,
      wouldFail:
        `a run in which the base "${name}" IS REACHABLE in the scope and the ${n} edge(s) that declare ` +
        `"base beyond this run's reach" for base "${name}" STILL do not resolve — then the claim that the run ` +
        `could not reach the base is FALSE, the gate would have to publish those edges as unresolved, and this ` +
        `ruling is wrong. The falsifier measures exactly that: it runs the shared gate over a repository that ` +
        `declares the base and fails if the cause is still named there.`,
    },
  }
}
decl.causeRulings = rulings
decl.meta = decl.meta ?? {}
decl.meta.causeRulingsCount = Object.keys(rulings).length
decl.meta.causeRulingsSource = mergedPath
writeFileSync(declPath, `${JSON.stringify(decl, null, 2)}\n`)
console.log(
  `cause rulings: ${Object.keys(rulings).length} (from ${mergedPath}) · population ${pop}` +
    (Object.keys(rulings).length === 0
      ? " — ZERO causes named: the population run reached every base it named, so clause 3 is met VACUOUSLY"
      : ""),
)
