/**
 * CLOJURE LANE — THE MUTATION SUITE FOR THE SLASH-OPT-IN CLAIM (CLJ-EX4).
 *
 * ## WHY A MUTATION SUITE AND NOT A FIXTURE
 *
 * A fixture that cannot fail is a comment. The toml lane found its whole mutation suite had been
 * DEAD — a module-not-found that still printed a pass line — and a dead suite reads exactly like a
 * green one. So this file does not merely RUN the fixture: it REMOVES the rule under test, proves
 * the fixture goes RED, and RESTORES the analyzer. A mutation that leaves the suite green is
 * reported as a failure of this instrument, and the suite is only reported green when every
 * mutation was seen to fail it.
 *
 * ## THE THREE MUTATIONS, and what each one is supposed to break
 *
 *   M1  THE SPLIT — `rootOf` splits on `.`/`::`/`:` instead of on `/` as well.
 *       Expected: the `js/…` claim disappears, so every `meta.languageNamespaceSlash: true`
 *       expectation row fails.
 *   M2  THE MARKER — the claim is published but `languageNamespaceSlash` is not.
 *       Expected: the expectation rows fail on the missing marker — and, in the ARM, this is the
 *       mutation that would charge the lane 23 REFUTED claims, because the arbiter's matcher
 *       without the marker cannot see the root of `js/require`. A marker the analyzer does not
 *       publish is worse than no claim at all.
 *   M3  THE CLOSED LIST — `babashka` joins the language/runtime root set.
 *       Expected: the `forbidRelationships` rows fire, because a third-party root would then be
 *       CLAIMED — and a claim the project can refute is a charge against the lane.
 *
 * ## WHAT IT DOES NOT DO
 *
 * It does not touch a file outside the lane's write scope, it restores the analyzer from an
 * in-memory copy (and verifies the restore by digest), and it never leaves the tree in a mutated
 * state — including when a mutation throws.
 *
 * ## USAGE
 *
 *   bun run validation/m14/fixtures/clojure/mutation-slash-claim.ts
 *
 * Exit status 0 only when all three mutations were OBSERVED to break the fixture suite, and the
 * unmutated suite was observed green. Anything else exits 4.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const ANALYZER = path.join(ROOT, "src", "ast", "real-clojure-analyzer.ts")
const original = readFileSync(ANALYZER, "utf8")
const digest = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16)

function runFixtures(): { ok: boolean; out: string } {
  try {
    const out = execFileSync("bun", ["run", "script/m14/run-fixtures.ts", "--lang", "clojure"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    })
    return { ok: true, out }
  } catch (e: any) {
    return { ok: false, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` }
  }
}

interface Mutation { id: string; what: string; from: string; to: string; expect: RegExp }

/** Each mutation is a LITERAL text replacement, so a mutation that does not apply is itself a
 *  failure — it is reported as "the pattern was not found", not as a silent pass. */
const MUTATIONS: Mutation[] = [
  {
    id: "M1",
    what: "the split — rootOf splits on `.`/`::`/`:` only, so `js/require` has no reachable root",
    from: "const segs = target.split(/\\/|\\.|::|:/)",
    to: "const segs = target.split(/\\.|::|:/)",
    expect: /language-namespace-slash/,
  },
  {
    id: "M2",
    what: "the marker — the claim is published but `languageNamespaceSlash` is not",
    from: "        md.languageNamespaceSlash = true",
    to: "        // md.languageNamespaceSlash = true",
    expect: /language-namespace-slash/,
  },
  {
    id: "M3",
    what: "the closed list — `babashka` joins the language/runtime root set",
    from: 'const LANGUAGE_NAMESPACE_ROOTS = ["clojure", "cljs", "js", "goog", "java", "javax"]',
    to: 'const LANGUAGE_NAMESPACE_ROOTS = ["clojure", "cljs", "js", "goog", "java", "javax", "babashka"]',
    expect: /language-namespace-slash/,
  },
]

let broken = 0
const results: Array<{ id: string; applied: boolean; fixtureWentRed: boolean; detail: string }> = []

try {
  // ── THE UNMUTATED BASELINE: the suite must be GREEN, or nothing below means anything ────────
  const base = runFixtures()
  const baseGreen = base.ok && /"fail":0/.test(base.out)
  console.log(`BASE  (no mutation): ${baseGreen ? "GREEN" : "NOT GREEN"}  exit=${base.ok ? 0 : 1}`)
  if (!baseGreen) {
    console.error(base.out.split("\n").filter((l) => /FAIL|summary/.test(l)).join("\n"))
    broken++
  }
  results.push({ id: "BASE", applied: true, fixtureWentRed: !baseGreen, detail: baseGreen ? "green as required" : "the suite is not green before any mutation" })

  for (const m of MUTATIONS) {
    const idx = original.indexOf(m.from)
    if (idx < 0) {
      console.log(`MUT ${m.id}: NOT APPLIED — the pattern was not found in the analyzer: ${JSON.stringify(m.from)}`)
      broken++
      results.push({ id: m.id, applied: false, fixtureWentRed: false, detail: "pattern not found" })
      continue
    }
    const mutated = original.slice(0, idx) + m.to + original.slice(idx + m.from.length)
    writeFileSync(ANALYZER, mutated)
    const r = runFixtures()
    const red = !r.ok || /"fail":[1-9]/.test(r.out)
    const named = m.expect.test(r.out)
    console.log(
      `MUT ${m.id}: ${m.what}\n` +
        `        fixture ${red ? "went RED (as required)" : "DID NOT GO RED — THE FIXTURE CANNOT FAIL"}` +
        `${named ? "" : "  (the failing fixture was not the one this mutation targets)"}`,
    )
    if (!red) broken++
    else if (!named) broken++
    results.push({ id: m.id, applied: true, fixtureWentRed: red, detail: named ? "the targeted fixture failed" : "red, but not on the targeted fixture" })
  }
} finally {
  // ── THE RESTORE, AND A DIGEST CHECK THAT IT HAPPENED ───────────────────────────────────────
  writeFileSync(ANALYZER, original)
  const back = readFileSync(ANALYZER, "utf8")
  if (back !== original) {
    console.error("*** THE ANALYZER WAS NOT RESTORED — the tree is left mutated. ***")
    broken++
  } else {
    console.log(`\nRESTORE: the analyzer is byte-identical to the copy taken before the mutations (sha256[:16] ${digest(original)}).`)
  }
}

console.log("")
for (const r of results) {
  console.log(`  ${r.id.padEnd(5)} applied=${r.applied ? "yes" : "NO "}  fixture-went-red=${r.fixtureWentRed ? "yes" : "NO "}  ${r.detail}`)
}
if (broken > 0) {
  console.error(`\nFAIL — ${broken} problem(s). A mutation that leaves the suite green means the fixture cannot fail.`)
  process.exit(4)
}
console.log("\nPASS — the unmutated suite is green and EVERY mutation was observed to break it. The fixture is red-capable.")
