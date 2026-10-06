/**
 * A SOURCE mutant for the unnamed-`CREATE INDEX` guard, run the way a source change is
 * actually reverted: edit the file, run the fixtures, restore it md5-verified.
 *
 * ## WHY THIS NEEDS ITS OWN RUNNER
 *
 * Every other SQL ontology mutant is a transform over a parse RESULT, applied by
 * `run-sql-ontology-mutants.ts` through `runLang("sql", { analyze })`. This one cannot
 * be, and the reason is the point rather than an inconvenience: the defect is a name
 * the analyzer DERIVES, so reproducing it as a post-hoc transform means re-deriving the
 * analyzer's own symbol-naming rule inside the mutant. A mutant that reimplements the
 * thing under test proves nothing about it — it would encode this pass's reading, and a
 * fixture that agrees with this pass's reading would pass against it.
 *
 * So the mutation is applied to `src/ast/real-sql-analyzer.ts` itself: the guard's
 * `if (!hasOwnName) { … return }` becomes the pre-fix fall-through, and the fixture lane
 * runs against real code.
 *
 * ## THE DEFECT IT REVERTS
 *
 * `CREATE INDEX ON hdb_catalog.event_log (trigger_name)` — legal PostgreSQL, and
 * hasura-engine ships it in `server/src-rsr/init_pg_source.sql` and four migrations. The
 * grammar marks it structurally: a `create_index` with no own-name field has no
 * identifier child before its `ON` clause. The name lookup therefore fell through to
 * `firstIdentifier`, which walked into the `object_reference` and returned the SCHEMA
 * QUALIFIER, so the analyzer published a symbol named `hdb_catalog` and a `contains` edge
 * saying `event_log` contains it.
 *
 * Measured over the 1,962-file corpus: 1,486 `create_index` nodes, 8 unnamed (0.54%),
 * 6 published under the schema's name. `hdb_catalog` is a schema, so the edge asserts a
 * declaration that does not exist while pointing at something that does — the failure
 * mode a name-resolving consumer cannot distinguish from a correct edge.
 *
 * ## THE TWO HALVES, AND WHY THE COUNTER IS PINNED AS A RELATIONSHIP
 *
 * The fixture `sqld17-unnamed-index` asserts the negatives (no `ignored_schema` symbol,
 * no `contains`/`references` edge naming it) and the positives (the NAMED index over the
 * same table in the same schema survives). The guard also increments
 * `ambiguity.unnamedIndexSkipped`, and `runLang` does not surface `metadata.ambiguity` to
 * an expectation, so a mutant that counted the skip and then emitted anyway would pass.
 * That residue is stated here rather than papered over: the counter is currently pinned
 * by no fixture, and closing it needs an `expectAmbiguity` section in the shared runner,
 * which is §8-owned.
 *
 * Run: npx tsx script/m60/run-sql-source-mutants.ts
 * Exit 2 on a surviving mutant.
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ANALYZER = "src/ast/real-sql-analyzer.ts"
const REPO = path.resolve(".")

/** The guard, verbatim as it stands at HEAD. Its ABSENCE is the mutant. */
const GUARD = `    let hasOwnName = false
    for (let i = 0; i < node.childCount; i++) {
      if (node.fieldNameForChild(i) === "column") {
        hasOwnName = true
        break
      }
    }
    if (!hasOwnName) {
      state.ambiguity.unnamedIndexSkipped++
      return
    }

`

interface SourceMutant {
  id: string
  description: string
  /** The exact text whose removal reproduces the defect. */
  remove: string
}

const MUTANTS: SourceMutant[] = [
  {
    id: "sql/unnamed-index-is-named-after-its-schema-qualifier",
    description:
      "removes the unnamed-`CREATE INDEX` guard, so the name lookup falls through to firstIdentifier and returns the object_reference's schema qualifier. 6 corpus sites published a schema as a declaration.",
    remove: GUARD,
  },
]

function md5(p: string): string {
  return execFileSync("md5sum", [p], { encoding: "utf8" }).split(" ")[0]
}

function runFixtures(): { pass: number; fail: number; failing: string[] } {
  let out = ""
  try {
    out = execFileSync("npx", ["tsx", "script/m14/run-fixtures.ts", "--lang", "sql"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    // A non-zero exit is how the harness reports a red lane, so the output is the result
    // rather than an error to be thrown away.
    out = String(e?.stdout ?? "") + String(e?.stderr ?? "")
  }
  const failing = [...out.matchAll(/^FAIL\s+(\S+)/gm)].map((m) => m[1])
  const passing = [...out.matchAll(/^PASS\s+(\S+)/gm)].map((m) => m[1])
  const summary = out.match(/summary:\s*(\{[\s\S]*?\})\s*$/)
  let pass = passing.length
  let fail = failing.length
  if (summary) {
    try {
      const parsed = JSON.parse(summary[1])
      pass = parsed?.sql?.pass ?? pass
      fail = parsed?.sql?.fail ?? fail
    } catch {
      /* the PASS/FAIL lines above are the fallback and they are the same facts */
    }
  }
  return { pass, fail, failing }
}

const baseline = runFixtures()
console.log(`sql fixture lane, clean: ${baseline.pass} pass / ${baseline.fail} fail`)
if (baseline.fail > 0) {
  console.error("the lane is already red: a mutant result here would be meaningless")
  process.exit(3)
}

const stash = path.join("/tmp/opencode", `source-mutant.${process.pid}.stash.ts`)
copyFileSync(ANALYZER, stash)
const headMd5 = md5(ANALYZER)
console.log(`analyzer md5 at HEAD ${headMd5}`)

let survivors = 0
try {
  for (const m of MUTANTS) {
    const src = readFileSync(ANALYZER, "utf8")
    const occurrences = src.split(m.remove).length - 1
    if (occurrences !== 1) {
      console.log(`SKIPPED  ${m.id} — the guard text appears ${occurrences} time(s); expected exactly 1, and a mutant matched 0 or many is not a measurement`)
      survivors++
      continue
    }
    writeFileSync(ANALYZER, src.replace(m.remove, ""))
    const mutatedMd5 = md5(ANALYZER)
    if (mutatedMd5 === headMd5) {
      console.log(`SKIPPED  ${m.id} — the edit did not change the file`)
      survivors++
      continue
    }
    let result: { pass: number; fail: number; failing: string[] }
    try {
      result = runFixtures()
    } finally {
      writeFileSync(ANALYZER, src)
      const restored = md5(ANALYZER)
      if (restored !== headMd5) {
        console.error(`RESTORE FAILED: md5 ${restored} != ${headMd5}. Restore from ${stash} before doing anything else.`)
        process.exit(4)
      }
    }
    const caught = result.fail > baseline.fail
    if (!caught) survivors++
    console.log(
      `${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${baseline.fail} -> ${result.fail} failures${result.failing.length ? "; " + result.failing.join(", ") : ""})`,
    )
    console.log(`         md5 ${headMd5} -> ${mutatedMd5} -> restored ${md5(ANALYZER)}`)
  }
} finally {
  if (existsSync(stash)) {
    copyFileSync(stash, ANALYZER)
    unlinkSync(stash)
  }
  const finalMd5 = md5(ANALYZER)
  console.log(`\nanalyzer md5 after the run: ${finalMd5} ${finalMd5 === headMd5 ? "IDENTICAL to HEAD" : "MISMATCH"}`)
}

console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} caught`)
if (survivors > 0) {
  console.error(`${survivors} SURVIVING SOURCE MUTANT(S) — the fixture suite cannot detect these defects`)
  process.exit(2)
}