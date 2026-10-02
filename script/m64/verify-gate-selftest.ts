// script/m64/verify-gate-selftest.ts
//
// M64.P2 — the gate has to be able to go red.
//
// script/m64/verify-patterns-evidence-gate.ts asserts 36 properties of the
// bb_patterns evidence gate, and it passes. That is exactly the situation this
// repository has been in before, more than once: a verifier that counts its own
// regex literals, a harness that compared TARGETS ONLY so a mutant that
// mislabels every construction came back CLEAN (60eb13ef), and three m20 receipts
// that declared "negativeCases": 1 while containing no negative assertion at all.
//
// So the gate is itself tested by MUTATING the code it guards and requiring each
// mutation to turn it red. A gate that survives every mutation is not a gate.
//
// The mutations are the four decisions the lane's corpus work produced, each
// reverted to the shape the code had before:
//   M1  the evidence gate removed      -> refusals accepted as consumers
//   M2  constant confidence restored   -> the page degenerates to alphabetical
//   M3  the census replaced by the page-> counts report the page as the census
//   M4  the coverage indicator removed -> asymmetry goes undisclosed
//
// Each mutation is applied to a COPY of the repository's own source in a tmpdir
// and the gate is run against it, so the real tree is never modified and a
// failure cannot leave the working tree dirty. The runner is a child process
// because the gate imports the modules under test by absolute path.

import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

// `process.cwd()`, not `process.resolve` — there is no such function on the
// process object, and the first run died on that line before executing a single
// check, which is a worse failure than a red gate because it looks like a crash
// of something else.
const REPO = process.cwd()

let failures = 0
let checks = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

interface Mutation {
  id: string
  /** file, relative to the repo root */
  file: string
  /** exact text to find */
  find: string
  /** replacement */
  replace: string
  /** what this mutation undoes, and therefore what the gate must catch */
  undoes: string
  /**
   * True when the mutation is EXPECTED to break the engine badly enough that the
   * gate cannot run at all, rather than to make it disagree. Only a mutation that
   * is known to do that may be counted as caught by a crash; every other mutation
   * that merely crashes has told us nothing about the gate.
   */
  expectCrash?: boolean
}

const MUTATIONS: Mutation[] = [
  {
    id: "M1",
    file: "src/intelligence/patterns/orphans.ts",
    undoes: "the evidence quality gate — a self-loop / inferred / low-confidence row is accepted as a consumer again",
    // The gate now lives in one SQL CASE expression, because six statements share
    // it. The anchor follows it there: all three WHEN branches are replaced by a
    // condition that is never true, so every row reads as clean.
    find: "    `(CASE WHEN r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NOT NULL ` +\n    `AND r.source_symbol_id = r.target_symbol_id THEN '${SELF_LOOP_EXCLUDED}' ` +\n    `WHEN json_extract(r.metadata, '$.evidenceClass') = 'inferred' THEN '${INFERRED_EXCLUDED}' ` +\n    `WHEN r.confidence < @minConf THEN '${LOW_CONFIDENCE_EXCLUDED}' ELSE NULL END)`",
    replace: "    `(CASE WHEN 1 = 0 THEN '${SELF_LOOP_EXCLUDED}' ELSE NULL END)`",
  },
  {
    id: "M7",
    file: "src/intelligence/patterns/orphans.ts",
    undoes: "named parameter binding in the relationship statements — a `?` inside the SELECT-list CASE binds BEFORE the WHERE clause's placeholders, so 0.7 lands on `r.project_id = ?`, the query matches nothing, and every refused-evidence disclosure silently disappears with the finding counts unchanged",
    // This one goes red by REFUSING TO RUN rather than by asserting: a named
    // placeholder with no bound value is a SqliteError. That is still a red gate
    // and a good outcome, but it is a different outcome, so the report says which.
    find: "const usageFilter = `r.project_id = @projectId AND r.relationship_type IN (${typeList})`",
    replace: "const usageFilter = `r.project_id = ? AND r.relationship_type IN (${typeList})`",
    // An unbound named placeholder is a SqliteError, so the gate cannot run at
    // all. That is the correct outcome for this mutation and is declared as such
    // rather than being allowed to masquerade as a disagreement.
    expectCrash: true,
  },
  {
    id: "M2",
    file: "src/intelligence/patterns/orphans.ts",
    undoes: "evidence-derived confidence — every candidate goes back to a constant, which collapses the comparator to alphabetical",
    find: `    confidence += nameAmbiguous ? -0.15 : 0.15
    confidence += fileReferenced ? -0.05 : 0.05`,
    replace: `    confidence = 0.6`,
  },
  {
    id: "M3",
    file: "src/ast/tools.ts",
    undoes: "totalFound as the census — it goes back to being the page length while byType describes the census",
    find: `        totalFound: censusTotal,`,
    replace: `        totalFound: displayedPatterns.length,`,
  },
  {
    id: "M4",
    file: "src/intelligence/patterns/orphans.ts",
    undoes: "the coverage-gap disclosure — a symbol whose file is reached but which is not goes back to reading as confident dead code",
    find: `    const fileUsage = symbolsWithAnyIncoming.has(sym.id) ? undefined : fileIncomingUsage.get(sym.fileId)`,
    replace: `    const fileUsage = undefined`,
  },
  {
    id: "M5",
    file: "src/intelligence/patterns/orphans.ts",
    undoes: "the per-symbol coverage test's ANCHORED-ONLY semantics — unanchored name matches count as recorded consumers again, which silences the coverage-gap indicator across whole corpora",
    // The explicit `IS NOT NULL` is the current shape. The version before the
    // SQL reduction wrote `source_symbol_id <> target_symbol_id`, which in SQL is
    // NULL rather than true for an unanchored row and so excluded them — correct
    // behaviour from what reads like a mistake. This mutation reinstates that
    // exclusion being absent, so what is undone is unambiguous.
    find: "`WHERE ${usageFilter} AND r.source_symbol_id IS NOT NULL ` +\n        `AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id <> r.target_symbol_id`,",
    replace: "`WHERE ${usageFilter} AND r.target_symbol_id IS NOT NULL ` +\n        `AND (r.source_symbol_id IS NULL OR r.source_symbol_id <> r.target_symbol_id)`,",
  },
  {
    id: "M6",
    file: "src/intelligence/patterns/orphans.ts",
    undoes: "the row count in the refused-evidence disclosure — it goes back to counting deduplicated REASONS, so a symbol with three refused self-loop rows reports one",
    find: "REFUSED EVIDENCE: ${rejected.rows} row(s) about this symbol",
    replace: "REFUSED EVIDENCE: ${rejected.reasons.length} row(s) about this symbol",
  },
]

console.log("M64.P2 — each mutation must turn script/m64/verify-patterns-evidence-gate.ts red\n")

// Baseline first: the gate must be GREEN before a mutation means anything. A
// gate that is already red makes every "the mutation was caught" result
// vacuous, which is the same failure mode as the target-only harness above.
{
  let green = false
  try {
    execFileSync(process.execPath, ["--import", "tsx", path.join(REPO, "script/m64/verify-patterns-evidence-gate.ts")], {
      cwd: REPO, encoding: "utf8", stdio: "pipe", timeout: 600_000,
    })
    green = true
  } catch (e: any) {
    console.log((e.stdout ?? "") + (e.stderr ?? "").split("\n").filter((l: string) => /FAIL|M64/.test(l)).join("\n"))
  }
  check("baseline: the gate is GREEN on the unmodified tree (otherwise every mutation result is vacuous)", green)
}

for (const m of MUTATIONS) {
  const target = path.join(REPO, m.file)
  if (!existsSync(target)) { check(`${m.id} the file it mutates exists`, false, target); continue }
  const original = readFileSync(target, "utf8")
  if (!original.includes(m.find)) {
    check(`${m.id} the anchor text is present in ${m.file}`, false,
      `the source has moved since the mutation table was written; the gate can no longer be tested against this decision. Anchor: ${JSON.stringify(m.find.slice(0, 60))}`)
    continue
  }

  // Mutate a copy of the repo. Copying the whole tree is expensive; copying only
  // what the gate imports is enough, because the gate reaches the engine through
  // src/ and the config through package.json.
  const mirror = mkdtempSync(path.join(tmpdir(), "bb-m64-mut-"))
  try {
    for (const dir of ["src", "script", "package.json", "tsconfig.json"]) {
      const from = path.join(REPO, dir)
      if (!existsSync(from)) continue
      const to = path.join(mirror, dir)
      mkdirSync(path.dirname(to), { recursive: true })
      cpSync(from, to, { recursive: true })
    }
    // `wasm/` holds the tree-sitter core and every grammar, and the engine
    // resolves them relative to its own source directory. The mirror did not
    // copy it, so every mutation run died with
    //   Aborted(ENOENT: tree-sitter.wasm)
    // before the gate evaluated a single check — and the self-test reported all
    // seven mutations as CAUGHT, because a crash exits non-zero. That is the
    // worst kind of green: seven mutations proved nothing, and the run looked
    // like the strongest evidence in the file.
    //
    // Symlinked rather than copied: it is ~220 MB of grammars and the mutations
    // never modify it.
    for (const asset of ["wasm"]) {
      const from = path.join(REPO, asset)
      if (existsSync(from)) {
        try { symlinkSync(from, path.join(mirror, asset), "dir") } catch {}
      }
    }
    writeFileSync(path.join(mirror, m.file), original.replace(m.find, m.replace))
    // The mirror has no node_modules, so resolve tsx from the real repo.
    const link = path.join(mirror, "node_modules")
    if (!existsSync(link)) {
      try { execFileSync("ln", ["-s", path.join(REPO, "node_modules"), link]) } catch {}
    }

    let exitCode = 0
    let out = ""
    try {
      out = execFileSync(process.execPath, ["--import", "tsx", path.join(mirror, "script/m64/verify-patterns-evidence-gate.ts")], {
        cwd: mirror, encoding: "utf8", stdio: "pipe", timeout: 600_000,
      })
    } catch (e: any) {
      exitCode = e.status ?? 1
      out = (e.stdout ?? "") + (e.stderr ?? "")
    }
    const redChecks = out.split("\n").filter((l) => l.includes("FAIL:")).map((l) => l.trim().replace(/^FAIL:\s*/, "").split(" — ")[0])
    // "M64.P1 session" is the gate's own catch-all: the whole body is wrapped in a
    // try/catch that turns ANY exception into one failing check. So a mutation
    // that merely crashes reports exactly one red check, named "M64.P1 session",
    // and is indistinguishable from a real disagreement unless it is told apart
    // here.
    //
    // That distinction is the whole point. A crash is a red gate but it is not
    // EVIDENCE that this gate covers this decision — the run may have died before
    // evaluating anything, which is precisely what happened when the mirror was
    // missing wasm/ and all seven mutations "passed".
    const realAssertions = redChecks.filter((c) => c !== "M64.P1 session")
    const crashed = redChecks.length > 0 && realAssertions.length === 0
    const onlySession = redChecks.length === 1 && redChecks[0] === "M64.P1 session"
    const how = realAssertions.length > 0
      ? `${realAssertions.length} real assertion(s) fired: ${realAssertions.slice(0, 2).join("; ")}`
      : onlySession
        ? (m.expectCrash ? "the gate refused to run, as expected for this mutation" : "INCONCLUSIVE — the gate crashed before judging anything")
        : `exit=${exitCode} with no failing assertion and no recognisable error`
    console.log(`       -> ${how}`)
    const caught = m.expectCrash
      ? exitCode !== 0 && (realAssertions.length > 0 || onlySession)
      : exitCode !== 0 && realAssertions.length > 0
    check(`${m.id} the gate goes RED when this is undone — ${m.undoes}`, caught,
      `exit=${exitCode} failing=${JSON.stringify(redChecks.slice(0, 3))}`)
  } finally {
    rmSync(mirror, { recursive: true, force: true })
  }
}

console.log(`\nM64.P2: ${failures === 0 ? `PASS (${checks}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
