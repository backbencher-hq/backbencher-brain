#!/usr/bin/env bun
/**
 * THE RED PROOF FOR SCALA'S `implements` — the lane's own instrument.
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
 *   removes the emission block BETWEEN ITS OWN MARKERS, writes the result to a TEMPORARY module
 *   INSIDE `src/ast/` (so its relative imports `./engine` and `./override-context` still resolve),
 *   runs BOTH analyzers over the SAME fixture file, prints the `implements` rows each publishes,
 *   and DELETES the temporary module. The working tree is left exactly as it was found.
 *
 * ★ THE PROOF HAS A POSITIVE CONTROL ON ITSELF, or it proves nothing. The removal must (a) find
 *   the markers, (b) actually change the source, and (c) leave the AFTER analyzer publishing the
 *   rows. If any of the three fails, the proof EXITS 5 rather than reporting a RED that it did
 *   not earn.
 *
 * Usage: bun run script/m14/scala-implements-red-proof.ts
 * EXIT: 0 when the BEFORE analyzer publishes 0 `implements` rows and the AFTER publishes the
 *       fixture's expected rows; 5 otherwise.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dirname, "..", "..")
const ANALYZER = join(ROOT, "src", "ast", "real-scala-analyzer.ts")
const FIXTURE = join(ROOT, "validation", "m14", "fixtures", "scala", "self-type-implements.scala")
const EXPECT = join(ROOT, "validation", "m14", "fixtures", "scala", "self-type-implements.expectation.json")
const TMP = join(ROOT, "src", "ast", `.scala-analyzer-prefix-${process.pid}.ts`)

const BEGIN = "// SCALA-IMPL-EMIT-BLOCK:BEGIN"
const END = "// SCALA-IMPL-EMIT-BLOCK:END"

const src = readFileSync(ANALYZER, "utf8")
const b = src.indexOf(BEGIN)
const e = src.indexOf(END)
if (b < 0 || e < 0 || e < b) {
  console.error(`FAIL: the emission markers are not both present in ${ANALYZER} — the proof cannot run`)
  process.exit(5)
}
const removed = src.slice(b, e + END.length)
// The BEFORE source is the AFTER source MINUS the marked block.
const before = src.slice(0, b) + src.slice(e + END.length)
if (before === src) {
  console.error(`FAIL: removing the marked block did not change the source — the proof proves nothing`)
  process.exit(5)
}

writeFileSync(TMP, before, "utf8")

const expected: Array<{ type: string; from: string; target: string }> =
  JSON.parse(readFileSync(EXPECT, "utf8")).expectRelationships ?? []
const fixture = readFileSync(FIXTURE, "utf8")

async function rowsOf(modulePath: string): Promise<Array<{ type: string; from: string; target: string }>> {
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
  const res: any = await analyzer.analyze(tree.rootNode, fixture, "fixtures/scala/self-type-implements.scala")
  const rels: any[] = res?.relationships ?? []
  return rels
    .filter((r) => r.type === "implements")
    .map((r) => ({ type: r.type, from: r.source, target: r.target }))
}

let beforeRows: Array<{ type: string; from: string; target: string }> = []
let afterRows: Array<{ type: string; from: string; target: string }> = []
try {
  beforeRows = await rowsOf(TMP)
  afterRows = await rowsOf(ANALYZER.replace(/\.ts$/, ""))
} finally {
  try { if (existsSync(TMP)) unlinkSync(TMP) } catch { /* the proof's own temp file */ }
}

const key = (r: { from: string; target: string }): string => `${r.from}->${r.target}`
const beforeKeys = new Set(beforeRows.map(key))
const afterKeys = new Set(afterRows.map(key))
const missing = expected.filter((e) => !afterKeys.has(key(e)))
const leaked = expected.filter((e) => beforeKeys.has(key(e)))

console.log(`SCALA \`implements\` RED PROOF`)
console.log(`  analyzer        ${ANALYZER.replace(ROOT + "/", "")}`)
console.log(`  fixture         ${FIXTURE.replace(ROOT + "/", "")}`)
console.log(`  removed block   ${removed.split("\n").length} lines, between the file's own markers`)
console.log(`  temp module     ${TMP.replace(ROOT + "/", "")} (written, used, DELETED)`)
console.log("")
console.log(`  BEFORE (the emission block removed) — \`implements\` rows: ${beforeRows.length}`)
for (const r of beforeRows) console.log(`      ${r.from} -> ${r.target}`)
console.log(`  AFTER  (the analyzer as it stands) — \`implements\` rows: ${afterRows.length}`)
for (const r of afterRows) console.log(`      ${r.from} -> ${r.target}`)
console.log("")
console.log(`  the fixture expects ${expected.length} rows: ${expected.map((e) => `${e.from}->${e.target}`).join(" · ")}`)
console.log(`  BEFORE publishes ${beforeRows.length} of them (the fixture is RED without the change)`)
console.log(`  AFTER  publishes ${afterRows.length - missing.length} of them`)

// THE THREE POSITIVE CONTROLS, or the proof proves nothing.
const ok = beforeRows.length === 0 && missing.length === 0 && leaked.length === 0
if (!ok) {
  console.error("")
  if (beforeRows.length !== 0) console.error(`FAIL: the BEFORE analyzer published ${beforeRows.length} \`implements\` rows — the removal did not take effect`)
  if (missing.length !== 0) console.error(`FAIL: the AFTER analyzer is MISSING ${missing.map((e) => `${e.from}->${e.target}`).join(", ")}`)
  console.error("the RED PROOF FAILED — exit 5")
  process.exit(5)
}
console.log("")
console.log(`⇒ THE PROOF HOLDS: the fixture is RED without the emission block (0 rows) and GREEN with it (${afterRows.length} rows).`)
process.exit(0)
