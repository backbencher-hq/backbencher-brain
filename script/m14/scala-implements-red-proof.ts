#!/usr/bin/env bun
/**
 * THE RED PROOF FOR SCALA'S EMISSION BLOCKS — the lane's own instrument.
 *
 * ★ WHAT A RED PROOF IS FOR. The groovy lane's rationale is the doctrine in one sentence: "Each
 *   assertion below is a same-file causal edge that only exists when the construct is reaching the
 *   analyzer as a real node rather than recovery text." A fixture proves the analyzer publishes the
 *   edge; a RED PROOF proves the fixture would FAIL WITHOUT the change. Without the second half, a
 *   fixture can pass for a reason that has nothing to do with the construct.
 *
 * ★ WHY IT DOES NOT USE GIT. This checkout is SHARED — other lanes are working in it, and
 *   `git checkout` / `reset` / `restore` are BANNED here. A proof that needs a git round-trip is a
 *   proof nobody can re-run while the fleet is busy. So this file takes the analyzer's SOURCE,
 *   removes the marked emission block(s) BETWEEN THE ANALYZER'S OWN MARKERS, writes the result to a
 *   TEMPORARY module INSIDE `src/ast/` (so its relative imports `./engine` and `./override-context`
 *   still resolve), runs BOTH analyzers over the SAME fixture file, EVALUATES THE FIXTURE'S OWN
 *   VERDICT under the fixture runner's own matcher, and DELETES the temporary module. The working
 *   tree is left exactly as it was found.
 *
 * ★ IT EVALUATES THE FIXTURE, NOT A PROXY. The proof imports `matchConstraints` from
 *   `script/m14/run-fixtures.ts` — the runner's OWN matcher — and applies the fixture's
 *   `expectRelationships` and `forbidRelationships` to the analyzer's rows. So the printed verdict
 *   IS the fixture's verdict, not an approximation of it. (The first version compared only the
 *   `implements` rows by a hand-rolled key, which is a proxy; it also printed `undefined -> Logging`
 *   because it read `r.source` off a row whose key is `from` — the kind of silent shape mismatch
 *   that makes a proof print something that is not there.)
 *
 * ★ THE PROOF HAS A POSITIVE CONTROL ON ITSELF, or it proves nothing. For every feature: the
 *   markers must be present, the removal must actually change the source, the BEFORE analyzer must
 *   FAIL the fixture and the AFTER analyzer must PASS it. If any of that fails, the proof EXITS 5
 *   rather than reporting a RED that it did not earn.
 *
 * ★ A FEATURE MAY SPAN SEVERAL BLOCKS. The `annotated supertype` fix has three parts (the
 *   direct-child branch, the compound branch's branch, and the helper method) and the FEATURE is
 *   the fix — so all three are removed together and the fixture must go RED.
 *
 * Usage: bun run script/m14/scala-implements-red-proof.ts
 * EXIT: 0 when every feature's BEFORE analyzer FAILS its fixture and its AFTER analyzer PASSES it;
 *       5 otherwise.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dirname, "..", "..")
const ANALYZER = join(ROOT, "src", "ast", "real-scala-analyzer.ts")
/**
 * ★ THE TEMP MODULE PATH IS PER-FEATURE, AND IT MUST BE.
 *
 *   A module cache is a cache of PATHS. The first version of this proof wrote every feature's
 *   stripped source to the SAME path — `.scala-analyzer-prefix-<pid>.ts` — so the SECOND feature's
 *   `import()` returned the FIRST feature's CACHED module, annotated fix and all. The second
 *   feature's "BEFORE" was therefore the AFTER, and it reported "the fixture PASSES without the
 *   change". The proof's own control caught it — the feature's fixture passed without its change,
 *   which is exactly the shape the control exists to refuse — but a proof that cannot trust its
 *   own harness is not a proof, so the path is now per-feature.
 */
const tmpFor = (i: number): string =>
  join(ROOT, "src", "ast", `.scala-analyzer-prefix-${process.pid}-${i}.ts`)

/** ★ THE FEATURES — each a set of marked blocks plus the fixture that pins it. */
const FEATURES: Array<{
  name: string
  blocks: Array<[string, string]>
  fixture: string
}> = [
  {
    name: "`implements` — the self-type's conformance row",
    blocks: [["// SCALA-IMPL-EMIT-BLOCK:BEGIN", "// SCALA-IMPL-EMIT-BLOCK:END"]],
    fixture: "self-type-implements",
  },
  {
    name: "`extends`/`mixes_in` — the supertype UNDER AN ANNOTATION",
    blocks: [
      ["// SCALA-ANN-SUPERTYPE-BLOCK-A:BEGIN", "// SCALA-ANN-SUPERTYPE-BLOCK-A:END"],
      ["// SCALA-ANN-SUPERTYPE-BLOCK-B:BEGIN", "// SCALA-ANN-SUPERTYPE-BLOCK-B:END"],
      ["// SCALA-ANN-SUPERTYPE-BLOCK-C:BEGIN", "// SCALA-ANN-SUPERTYPE-BLOCK-C:END"],
    ],
    fixture: "annotated-supertype",
  },
]

/** ★ THE FIXTURE RUNNER'S OWN MATCHER — so the proof evaluates the FIXTURE'S SEMANTICS, not a proxy. */
const { matchConstraints } = await import(resolve(ROOT, "script", "m14", "run-fixtures"))

const src = readFileSync(ANALYZER, "utf8")

/** THE FIXTURE'S VERDICT for a set of relationship rows — the runner's own rules, applied here. */
function fixtureVerdict(rels: any[], expected: any[], forbidden: any[]): { problems: string[]; satisfied: number } {
  const problems: string[] = []
  let satisfied = 0
  for (const want of expected) {
    if (rels.some((r) => matchConstraints(r, want))) satisfied++
    else problems.push(`expected relationship not found: ${JSON.stringify(want)}`)
  }
  for (const want of forbidden) {
    const hit = rels.find((r) => matchConstraints(r, want))
    if (hit) problems.push(`forbidden relationship present: ${JSON.stringify(want)}`)
  }
  return { problems, satisfied }
}

async function relsOf(modulePath: string, fixturePath: string, fixture: string): Promise<any[]> {
  const mod: any = await import(modulePath)
  const Analyzer = mod.RealScalaAnalyzer
  const analyzer = new Analyzer()
  // ★ THE CALL IS THE FIXTURE RUNNER'S CALL, verbatim: `analyze(rootNode, content, path)`.
  //   The analyzer's signature takes a PARSED TREE, not a file name — the first version of this
  //   proof passed a file name and measured 0 rows on BOTH sides, which is the "a measure that
  //   measures nothing" failure the whole campaign is about.
  const { getParser } = await import(resolve(ROOT, "src", "ast", "engine"))
  const parser = await getParser("scala" as any)
  const ctor: any = analyzer?.constructor
  if (typeof ctor?.setGrammar === "function") {
    try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* no grammar */ }
  }
  const tree: any = parser.parse(fixture)
  const res: any = await analyzer.analyze(tree.rootNode, fixture, `fixtures/scala/${fixturePath}.scala`)
  return res?.relationships ?? []
}

let anyFailed = false
console.log(`SCALA RED PROOF — ${FEATURES.length} feature(s), the FIXTURE'S OWN VERDICT under the fixture runner's matcher`)
console.log(`  analyzer  ${ANALYZER.replace(ROOT + "/", "")}`)
console.log("")

for (const [featureIndex, f] of FEATURES.entries()) {
  const TMP = tmpFor(featureIndex)
  const FIXTURE = join(ROOT, "validation", "m14", "fixtures", "scala", `${f.fixture}.scala`)
  const EXPECT = join(ROOT, "validation", "m14", "fixtures", "scala", `${f.fixture}.expectation.json`)
  const fixture = readFileSync(FIXTURE, "utf8")
  const exp = JSON.parse(readFileSync(EXPECT, "utf8"))
  const expected: any[] = exp.expectRelationships ?? []
  const forbidden: any[] = exp.forbidRelationships ?? []

  // ★ THE REMOVAL — every block of this feature, between the analyzer's OWN markers.
  let before = src
  const removedCounts: number[] = []
  for (const [begin, end] of f.blocks) {
    const b = before.indexOf(begin)
    const e = before.indexOf(end)
    if (b < 0 || e < 0 || e < b) {
      console.error(`FAIL: the markers ${begin} / ${end} are not both present in the analyzer — the proof cannot run for ${f.name}`)
      process.exit(5)
    }
    removedCounts.push(before.slice(b, e + end.length).split("\n").length)
    before = before.slice(0, b) + before.slice(e + end.length)
  }
  if (before === src) {
    console.error(`FAIL: removing the marked block(s) of ${f.name} did not change the source — the proof proves nothing`)
    process.exit(5)
  }

  writeFileSync(TMP, before, "utf8")
  let beforeRels: any[] = []
  let afterRels: any[] = []
  try {
    beforeRels = await relsOf(TMP, f.fixture, fixture)
    afterRels = await relsOf(ANALYZER.replace(/\.ts$/, ""), f.fixture, fixture)
  } finally {
    try { if (existsSync(TMP)) unlinkSync(TMP) } catch { /* the proof's own temp file */ }
  }

  const beforeVerdict = fixtureVerdict(beforeRels, expected, forbidden)
  const afterVerdict = fixtureVerdict(afterRels, expected, forbidden)
  const beforeRows = beforeRels.filter((r) => r.type === "extends" || r.type === "mixes_in" || r.type === "implements")
  const afterRows = afterRels.filter((r) => r.type === "extends" || r.type === "mixes_in" || r.type === "implements")

  // ★ THE CONTROL SETS — the two sides must publish DIFFERENT row sets: a feature whose removal
  //   changes nothing has not been proved to do anything, whatever the fixture says.
  const beforeSet = new Set(beforeRels.map((r: any) => JSON.stringify([r.type, r.from ?? r.source, r.target ?? r.to])))
  const afterSet = new Set(afterRels.map((r: any) => JSON.stringify([r.type, r.from ?? r.source, r.target ?? r.to])))
  const setsDiffer = beforeSet.size !== afterSet.size || [...afterSet].some((k) => !beforeSet.has(k))

  console.log(`★ ${f.name}`)
  console.log(`  fixture         validation/m14/fixtures/scala/${f.fixture}.scala`)
  console.log(`  removed         ${f.blocks.length} block(s), ${removedCounts.reduce((a, b) => a + b, 0)} lines, between the analyzer's own markers`)
  console.log(`  temp module     written, used, DELETED`)
  console.log(`  BEFORE (the block(s) removed): ${beforeVerdict.problems.length === 0 ? "PASS" : "FAIL"} — ` +
    `${beforeVerdict.satisfied}/${expected.length} asserted rows satisfied, ${beforeVerdict.problems.length} problem(s)`)
  for (const p of beforeVerdict.problems.slice(0, 12)) console.log(`        ${p}`)
  console.log(`  AFTER  (the analyzer as it stands): ${afterVerdict.problems.length === 0 ? "PASS" : "FAIL"} — ` +
    `${afterVerdict.satisfied}/${expected.length} asserted rows satisfied, ${afterVerdict.problems.length} problem(s)`)
  for (const p of afterVerdict.problems.slice(0, 12)) console.log(`        ${p}`)
  console.log(`  the heritage/conformance rows it publishes — BEFORE ${beforeRows.length} · AFTER ${afterRows.length}`)
  console.log(`  the two sides publish DIFFERENT row sets: ${setsDiffer ? "YES" : "NO"} (${beforeSet.size} before · ${afterSet.size} after)`)
  console.log("")

  // ★ THE CONTROLS, or the proof proves nothing.
  const ok = beforeVerdict.problems.length > 0 && afterVerdict.problems.length === 0 && setsDiffer
  if (!ok) {
    anyFailed = true
    if (beforeVerdict.problems.length === 0) {
      console.error(`FAIL: ${f.name} — the fixture PASSES without the change; it does not pin the construct, so it proves nothing`)
    }
    if (afterVerdict.problems.length !== 0) {
      console.error(`FAIL: ${f.name} — the fixture FAILS with the change: ${afterVerdict.problems.join(" | ")}`)
    }
    if (!setsDiffer) {
      console.error(`FAIL: ${f.name} — removing the block(s) changed NOTHING in the published rows (${beforeSet.size} before, ${afterSet.size} after); the two sides are the same module`)
    }
  } else {
    console.log(`  ⇒ ${f.name}: the fixture is RED without the change (${beforeVerdict.satisfied}/${expected.length}) and GREEN with it (${afterVerdict.satisfied}/${expected.length}).`)
    console.log("")
  }
}

if (anyFailed) {
  console.error("the RED PROOF FAILED — exit 5")
  process.exit(5)
}
console.log(`⇒ ALL ${FEATURES.length} FEATURES HOLD: every fixture is RED without its change and GREEN with it.`)
process.exit(0)
