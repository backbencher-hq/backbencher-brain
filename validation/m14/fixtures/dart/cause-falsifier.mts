/**
 * DART'S CAUSE FALSIFIER — it MEASURES the opposite claim, and that is the whole point.
 *
 * THE CLAIM A `baseBeyondRunScope` CAUSE MAKES: "the base of this override target is a name THE RUN
 * COULD NOT REACH". ⇒⇒ FOR THE CLAIM TO BE TRUE, TWO THINGS MUST HOLD: the base is NOT REACHABLE in
 * the run's scope, AND the edge therefore stays unresolved. ⇒⇒ ⇒⇒ **⇒⇒ ⇒⇒ ⇒⇒**
 *
 * ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒**
 *
 * ⇒⇒ THIS FIXTURE MEASURES THE SECOND HALF DIRECTLY, IN A SCOPE WHERE THE BASE **IS** REACHABLE:
 * it runs the shared gate — THE INSTRUMENT THAT COUNTS — over a repository that declares the base,
 * and it FAILS if the cause is still named in that run's output.
 *
 * ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒** ⇒⇒ **⇒⇒ ⇒⇒**
 *
 * ⇒⇒ WHY IT IS NOT PERL'S SHAPE: perl's fixture scans the population for a declaration of the cause's
 * leaf and fails when it FINDS one. For dart that fixture would be refuted on contact — `Uri` IS
 * declared in the population (`.corpus/dart-sdk/sdk/lib/core/uri.dart` carries `class Uri`) — so
 * "the name is present" is NOT what makes dart's claim false, and a fixture that asserted it would
 * refute every dart ruling for the wrong reason.
 *
 * ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒** ⇒⇒ **⇒⇒**
 *
 * ⇒⇒ WHAT MAKES DART'S CLAIM FALSE IS DIFFERENT AND STRONGER: a run in which the base IS REACHABLE
 * and the override edge STILL does not resolve. ⇒⇒ ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒**
 *
 * USAGE: `bun run validation/m14/fixtures/dart/cause-falsifier.mts <CauseName> [repo]`
 * EXIT:  0 — the cause is GONE in a scope that reaches the base ⇒ the ruling SURVIVES its falsifier.
 *        5 — the cause is STILL named in a scope that reaches the base ⇒ the claim is FALSE and the
 *            ruling is refuted.
 *        2 — the run produced no verdict (the measurement could not be made ⇒ NOT a pass).
 */
import { spawnSync } from "node:child_process"

const cause = process.argv[2]
if (!cause) {
  console.error("usage: bun run validation/m14/fixtures/dart/cause-falsifier.mts <CauseName> [repo]")
  process.exit(2)
}
// The scope that REACHES the base: dart-sdk declares dart:core (sdk/lib/core/uri.dart) and
// dart:async, so a run over dart-sdk can reach the bases the smaller scopes could not.
const repo = process.argv[3] ?? "dart-sdk"
const corpusRoot = process.env.BB_CORPUS_ROOT ?? `${process.cwd()}/.corpus`

const proc = spawnSync(
  "bun",
  ["script/m14/incoming-gate.ts", "dart", "dart", "2000", "--index", `--repo=${repo}`, "--json"],
  {
    cwd: process.cwd(),
    env: { ...process.env, BB_CORPUS_ROOT: corpusRoot },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  },
)
const out = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`
const start = out.indexOf("\n{")
const jsonText = start >= 0 ? out.slice(start + 1) : out.slice(out.indexOf("{"))
let verdict: any
try {
  verdict = JSON.parse(jsonText.slice(jsonText.indexOf("{"), jsonText.lastIndexOf("}") + 1))
} catch {
  console.error("cause-falsifier: THE RUN PRODUCED NO VERDICT — this is NOT a pass (exit 2)")
  console.error(out.slice(-800))
  process.exit(2)
}
const reason = String(verdict.reason ?? "")
const named = new RegExp(`cause "${cause.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" \\((\\d+) edge`).exec(reason)
const population = verdict.population ?? {}
console.log(`cause-falsifier: cause "${cause}" over repo ${repo}`)
console.log(`  population: parsed=${population.parsed}/${population.sampled} admitted=${population.corpusTotal}`)
if (named) {
  console.log(`  *** THE CAUSE IS STILL NAMED (${named[1]} edge(s)) IN A SCOPE THAT REACHES THE BASE ***`)
  console.log("  *** ⇒ the claim \"base beyond this run's reach\" is FALSE and this ruling is REFUTED ***")
  process.exit(5)
}
console.log("  the cause is GONE in a scope that reaches the base ⇒ the ruling SURVIVES its falsifier")
process.exit(0)
