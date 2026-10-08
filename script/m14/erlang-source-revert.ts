/**
 * ERLANG SOURCE REVERTS — the mutation class a result-transform cannot express.
 *
 *   bun script/m14/erlang-source-revert.ts              run every registered revert
 *   bun script/m14/erlang-source-revert.ts --self-test  prove the runner can report a MISS
 *
 * ## Why this file exists
 *
 * `script/m14/erlang-ontology-mutants.ts` mutates the analyzer's OUTPUT. That is the
 * right instrument for a rule that filters or relabels rows, and it is the wrong
 * instrument the moment the DEFECT is that a row was never produced — because a result
 * transform can only remove what is there.
 *
 * `symbols/local-call-gated-on-bare-name` is that case, and it is the one this file was
 * written for. ER-D45 changed a local call's RESOLUTION GATE from the bare callee name
 * to the file's declared (name, arity) pairs. The pre-fix analyzer therefore emitted
 * MORE edges — `get(D)` beside a local `get/2` published `calls -> get` — so a faithful
 * reproduction has to ADD an edge the post-fix analyzer correctly withholds. No result
 * transform can see a site that produced nothing.
 *
 * What the registered transform actually did was the opposite: it FILTERED OUT local
 * call edges whose `metadata.callArity` matched no declared arity. On the post-fix
 * analyzer that filter is a no-op for every correctly-emitted edge, and the only edges
 * it removed were the valid ones — `fold(fun(X,Y) -> X + Y end, 0)` in
 * `erlang/arity-distinct-calls`, whose arity 2 IS declared, because the file also
 * declares `fold/3`. The harness dutifully reported
 *
 *     CAUGHT  symbols/local-call-gated-on-bare-name
 *             caught by: erlang/arity-distinct-calls
 *
 * which is a green tick on a mutant that reproduces neither the defect nor its
 * consequences. It was caught by a DIFFERENT bug: it drops a good edge. Measured
 * directly, by hand-reverting the gate in the analyzer source:
 *
 *     bare-name gate:  erlang/arity-local-resolution FAIL, erlang/arity-distinct-calls PASS
 *
 * so the fixture that actually pins ER-D45 is one the mutant never touched, and the
 * fixture it did touch pins something else entirely.
 *
 * That is the honesty contract's §7 red-team case — the check that is green for a reason
 * nobody stated — and it survived because a "CAUGHT" line looks identical whether the
 * mutant is faithful or not. A mutation harness that cannot tell those apart is not
 * measuring the code.
 *
 * ## What this does instead
 *
 * A SOURCE revert: rewrite the analyzer's own gate, run the fixtures in a CHILD PROCESS
 * (module caching means an in-process re-import would keep the old analyzer), restore
 * the bytes, and require a NAMED fixture to fail. Three properties make the result a
 * measurement rather than a demonstration:
 *
 *   1 the needle must be PRESENT. `find` absent means the revert no longer describes the
 *     code, and that is a failure — not a skip. A revert that silently matches nothing is
 *     a revert that asserts nothing.
 *   2 the fixture must fail BY NAME. `expectFailure` names the fixture whose assertion is
 *     supposed to catch this, so "the run went red somewhere" cannot pass for it.
 *   3 the bytes are restored and COMPARED. The restore is re-read and checked against the
 *     original, and a backup sibling path is printed before the swap so an interrupted
 *     run is recoverable. `process.on("exit")` restores too.
 *
 * `--self-test` inverts one expectation and requires the runner to report it as a MISS,
 * so a passing run of this file is evidence the loop works and not evidence the reverts
 * bite.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : process.cwd()
const ANALYZER = path.join(ROOT, "src", "ast", "real-erlang-analyzer.ts")
const FIXTURE_RUNNER = path.join(ROOT, "script", "m14", "run-fixtures.ts")
const ARTIFACT = path.join(ROOT, "validation", "m14", "tmp", "erlang-source-revert.json")

interface Revert {
  id: string
  /** The reading this reproduces, in one sentence. */
  reads: string
  /** The measurement that says the reading is wrong. */
  measured: string
  /** The exact pre-fix text. Its ABSENCE is a failure — see property 1 above. */
  find: string
  /** The post-fix text, i.e. what the code says now. */
  replace: string
  /** The fixture whose assertion must go red. */
  expectFailure: string
}

const REVERTS: Revert[] = [
  {
    id: "symbols/local-call-gated-on-bare-name",
    reads: "A local call resolves when the file declares the callee's NAME, whatever its arity: `get(D)` in a file that declares `get/2` is a call to the local `get`, and the arity in `metadata.callArity` describes the site rather than taking part in resolution.",
    measured:
      "Erlang's identity is (name, arity) — ER-D2, and `erlc` itself: `get/1` beside a local `get/2` is the auto-imported process-dictionary BIF, not the file's own function. Measured over the 3,939-file corpus at the bare-name gate: 618 published `calls` edges in 40 files named a (name, arity) the file does not declare — `get/1` at 100 sites, then `projection/2` 45, `setelement/3` 43, `drestriction/3` 40, `restriction/3` 39, `sort/1` 36. At the arity-exact gate the class measures 0. The shared oracle already gated on name/arity, which is why those rows sat in `unexplained` with no available explanation.",
    find: "    if (!ctx.declaredFnKeys.has(this.fnKey(callee.text, arity))) return",
    // The pre-fix gate tested a `Set<string>` of bare NAMES, and that set no longer
    // exists (it was dead state — populated on every function declaration and read by
    // nothing — and was removed by this wave's line-by-line read). So the revert is
    // written against today's state and reproduces the RULE rather than the old line:
    // "does this file declare the callee's name at ANY arity" is exactly the reading
    // being disputed, and it needs no state the analyzer does not already keep. A revert
    // that reintroduced the deleted field would fail to typecheck rather than to
    // reproduce the defect, which is a red harness measuring nothing.
    replace:
      "    if (![...ctx.declaredFnKeys].some((k) => k.slice(0, k.lastIndexOf('/')) === callee.text)) return",
    expectFailure: "erlang/arity-local-resolution",
  },
  {
    id: "symbols/function-range-initial-from-clause",
    reads: "A function symbol's range should start from the `function_clause`, since that is the clause: `nodeToRange` publishes tree-sitter's EXCLUSIVE end, so a clause's end index excludes the clause-terminating `.`.",
    measured:
      "On the pinned grammar `fun_decl` and `function_clause` differ by exactly the `.` — measured for `erlang/arity-distinct-calls.erl`, `pick/1` is fun_decl [685,698) against function_clause [685,697) — and `source.slice(startIndex, endIndex)` reproduces whichever node was passed, so a symbol's own text came back with its final character missing. `nodeToRange` is a verbatim pass-through (`startIndex: node.startIndex, endIndex: node.endIndex`), so EXCLUSIVITY says nothing about WHICH node was chosen; the explanation the previous wave recorded named the wrong mechanism. Corpus reach: one character off the end of every function symbol in 3,939 files. This is the symbol's CONSTRUCTION path, which is what a single-clause function uses, and it is the half `erlang/arity-distinct-calls` pins.",
    find: "      range: this.nodeToRange(declNode),\n",
    replace: "      range: this.nodeToRange(clause ?? declNode),\n",
    expectFailure: "erlang/arity-distinct-calls",
  },
  {
    id: "symbols/function-range-merge-from-clause",
    reads: "When a later clause of the same (name, arity) folds into an existing symbol, the range should be extended to that clause rather than to the `fun_decl` that contains it.",
    measured:
      "On this grammar every `;`-separated clause opens its OWN `fun_decl` and the `;` is a child of the EARLIER one — `pick(0) -> zero;` is fun_decl [32,48) and `pick(X) -> X.` is fun_decl [49,62), against function_clause [32,47) and [49,61) — so every multi-clause function IS the merge path, and extending to the clause ends the merged symbol one character before its final `.`. The lane's own `script/m14/verify-erlang-identity.ts` asserts `source.slice(startIndex, endIndex) === 'pick(0) -> zero;\npick(X) -> X.'` and failed before the fix. This half had NO fixture until `erlang/clause-merge-range` was written for it: `erlang/arity-distinct-calls` declares only single-clause functions, so reverting the merge left it green — measured, and it is why this revert is registered separately from the construction one.",
    find: "      this.extendRange(symbol, node)\n",
    replace: "      this.extendRange(symbol, clause ?? node)\n",
    expectFailure: "erlang/clause-merge-range",
  },
]

interface Row {
  id: string
  verdict: "CAUGHT" | "MISS"
  needleFound: boolean
  failingFixtures: string[]
  expectedFixtureFailed: boolean
  bytesRestoredIdentical: boolean
  reads: string
  measured: string
}

function runFixturesInChild(): { out: string; code: number } {
  // A child process, because ESM caches the analyzer module by URL: re-importing the
  // file in this process would keep the pre-patch analyzer and the check would measure
  // nothing while reporting a pass.
  const bin = existsSync("/usr/bin/bun") ? "bun" : "bun"
  try {
    const out = execFileSync(bin, [FIXTURE_RUNNER, "--lang", "erlang"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    })
    return { out, code: 0 }
  } catch (e: any) {
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: typeof e.status === "number" ? e.status : 1 }
  }
}

/** `FAIL <fixture>` lines from the fixture runner's own output. */
function failingFixtures(out: string): string[] {
  const rows: string[] = []
  for (const line of out.split("\n")) {
    const m = /^FAIL\s+(\S+)/.exec(line.trim())
    if (m && m[1]) rows.push(m[1])
  }
  return rows
}

function main(): void {
  const selfTest = process.argv.includes("--self-test")
  const INVERT = selfTest ? 0 : -1
  console.log(
    `erlang source reverts — ${REVERTS.length} revert(s)${selfTest ? " (SELF-TEST: revert 0's expectation deliberately inverted)" : ""}\n`,
  )

  const original = readFileSync(ANALYZER, "utf8")
  const rows: Row[] = []
  let restore: (() => void) | null = null
  process.on("exit", () => {
    try {
      restore?.()
    } catch {
      /* the printed backup path is the recovery */
    }
  })

  for (let i = 0; i < REVERTS.length; i++) {
    const r = REVERTS[i]!
    if (!original.includes(r.find)) {
      // Property 1: a needle that is not there cannot be reverted, and a revert that
      // cannot be applied asserts nothing. This is a MISS, not a skip.
      rows.push({
        id: r.id,
        verdict: "MISS",
        needleFound: false,
        failingFixtures: [],
        expectedFixtureFailed: false,
        bytesRestoredIdentical: true,
        reads: r.reads,
        measured: r.measured,
      })
      console.log(`  MISS     ${r.id}`)
      console.log(`      reads:    ${r.reads}`)
      console.log(`      NEEDLE ABSENT — the code no longer contains the text this revert reverts, so the`)
      console.log(`      revert reproduces nothing and would report a pass while measuring nothing.`)
      continue
    }

    const backup = `${ANALYZER}.revertbak-${process.pid}-${i}`
    writeFileSync(backup, original)
    console.log(`            (backup at ${backup})`)
    restore = () => {
      writeFileSync(ANALYZER, original)
      rmSync(backup, { force: true })
    }
    try {
      writeFileSync(ANALYZER, original.replace(r.find, r.replace))
      const { out } = runFixturesInChild()
      const fails = failingFixtures(out)
      const expectedFailed = fails.includes(r.expectFailure)
      const expected = i === INVERT ? !expectedFailed : expectedFailed
      rows.push({
        id: r.id,
        verdict: expected ? "CAUGHT" : "MISS",
        needleFound: true,
        failingFixtures: fails.sort(),
        expectedFixtureFailed: expectedFailed,
        bytesRestoredIdentical: false,
        reads: r.reads,
        measured: r.measured,
      })
      console.log(`  ${expected ? "CAUGHT " : "MISS    "} ${r.id}`)
      console.log(`      reads:    ${r.reads}`)
      console.log(`      reverted: ${r.find.trim()}  ->  ${r.replace.trim()}`)
      console.log(`      fixtures that went red: ${fails.length ? fails.join(", ") : "(none)"}`)
      console.log(`      named fixture ${r.expectFailure}: ${expectedFailed ? "FAILED as required" : "DID NOT FAIL"}`)
      if (!expected) {
        console.log(`      a revert that does not turn its named fixture red is a MISS, and a MISS fails this script.`)
      }
    } finally {
      restore()
      restore = null
    }
    // Property 3: the restore is re-read, not assumed.
    const back = readFileSync(ANALYZER, "utf8")
    const identical = back === original
    const row = rows[rows.length - 1]
    if (row) row.bytesRestoredIdentical = identical
    if (!identical) {
      console.error(`      RESTORE FAILED for ${r.id}: ${ANALYZER} does not match its pre-run bytes.`)
      process.exitCode = 2
    }
  }

  const misses = rows.filter((x) => x.verdict === "MISS")
  console.log(`\n${rows.length - misses.length}/${rows.length} CAUGHT, ${misses.length} missed`)
  mkdirSync(path.dirname(ARTIFACT), { recursive: true })
  writeFileSync(
    ARTIFACT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        script: "erlang-source-revert",
        method:
          "the analyzer's own source is reverted, the fixture battery runs in a CHILD PROCESS (ESM caches the module by URL), the bytes are restored and re-read, and a NAMED fixture must fail",
        why:
          "a result-transform mutant can only remove rows, so it cannot reproduce a defect whose symptom is a row that was never produced — ER-D45 emitted MORE edges before the fix. The transform that claimed to reproduce it removed valid edges instead and was caught by a fixture pinning a different bug",
        selfTest,
        rows,
      },
      null,
      2,
    ),
  )
  console.log(`artifact: ${ARTIFACT}`)
  if (misses.length > 0) {
    console.log(`\n>>> ${misses.length} MISS(ES): ${misses.map((m) => m.id).join(", ")}`)
    console.log(`>>> A missed revert is a failure of this script, not a skipped check.`)
    process.exitCode = 1
  }
}

main()
