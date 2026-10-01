// script/m65/verify-rules-gate-selftest.ts
// M65.P2 — the m65 gate has to be able to go red.
//
// THE REASON, STATED ONCE. This repository has now produced three separate
// results that were green and meant nothing:
//
//   * a verifier that counted its own regex literals;
//   * a harness comparing TARGETS ONLY, so a mutant that mislabelled every
//     construction came back CLEAN (60eb13ef);
//   * m64's own mutation self-test, which reported 7/7 mutations caught while
//     the mirror was missing wasm/, so every mutation died on
//     `Aborted(ENOENT: tree-sitter.wasm)` before the gate evaluated a single
//     check. A crash exits non-zero, and that was read as "caught".
//
// So this file takes each decision m65 guards, reverts it to the shape the code
// had before, and requires the gate to go red — and it requires a REAL assertion
// to fire, not merely a non-zero exit. A mutation that only crashes is reported
// INCONCLUSIVE unless it declares that it expects to.
//
// The mutations are the four defects the comments in rules.ts record as fixed,
// plus the two this lane found by instrumenting it:
//
//   N1  `maxResults` read nowhere            -> R1/R2
//   N2  complexity gate on complexity/threshold, which can never fire -> R3
//   N3  god-class gate on members/20, which drops a stronger finding -> R3d
//   N4  the god-class member count as a LEFT JOIN the planner declines to
//       index, identical output, 240x slower                                -> R8
//   N5  the framework branch ignoring `confidenceThreshold` entirely        -> R3c/R10d
//   N6  the non-code language clause dropped                                 -> R4
//   N7  the `json_valid` guard dropped, so json_each throws                 -> R5
//
// Each mutation is applied to a copy of the tree in a tmpdir and the gate is run
// against the copy, so the real tree is never modified and a failure cannot
// leave the working tree dirty. `wasm/` is symlinked into the copy: omitting it
// is what made the m64 self-test vacuous.

import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

// `process.cwd()`, not `process.resolve` — there is no such function on the
// process object, and the first run of the m64 twin died on that line before
// executing a single check, which reads like a crash of something else.
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
  file: string
  find: string
  replace: string
  undoes: string
  expectCrash?: boolean
}

const GATE = "script/m65/verify-rules-budget-and-gates.ts"

const MUTATIONS: Mutation[] = [
  {
    id: "N1",
    file: "src/intelligence/patterns/rules.ts",
    undoes: "the `maxResults` budget — a caller asking for 1 result gets every match again",
    find: "const budget = Math.max(0, options.maxResults)",
    replace: "const budget = Number.MAX_SAFE_INTEGER",
  },
  {
    id: "N2",
    file: "src/intelligence/patterns/rules.ts",
    undoes: "the complexity gate being on the EMITTED confidence — the old form divided complexity by the threshold, giving a ratio always >= 1.0, so it could never fire for any legal threshold",
    find: "      const confidence = Math.min(0.9, 0.5 + row.complexity / 100)\n      if (confidence < options.confidenceThreshold) continue",
    replace: "      const confidence = Math.min(0.9, 0.5 + row.complexity / 100)\n      if (row.complexity / COMPLEXITY_THRESHOLD < options.confidenceThreshold) continue",
  },
  {
    id: "N3",
    file: "src/intelligence/patterns/rules.ts",
    undoes: "the god-class gate being on the emitted confidence — the old form was `members / 20`, which at the default 0.6 dropped an 11-member class while KEEPING a 0.65-confidence complexity finding",
    find: "      const confidence = Math.min(0.9, 0.5 + row.members / 40)\n      if (confidence < options.confidenceThreshold) continue",
    replace: "      const confidence = Math.min(0.9, 0.5 + row.members / 40)\n      if (row.members / 20 < options.confidenceThreshold) continue",
  },
  {
    id: "N4",
    file: "src/intelligence/patterns/rules.ts",
    undoes: "the god-class member count resolving through the owner index — the LEFT JOIN form returns an IDENTICAL row set, so no behavioural gate can see it; it is the 104ms-versus-25,000ms difference",
    // The TRUE historical form, not a hybrid. The first version of this mutation
    // left the correlated subquery in the SELECT list and merely ADDED a LEFT
    // JOIN and a GROUP BY, so the correlated form was still present, the gate's
    // R8b pattern still matched it, and the mutation came back GREEN. A mutation
    // that does not actually remove the thing it claims to remove is worse than
    // no mutation at all: it reports coverage of a decision it never reverted.
    find: "        \"(SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) AS members \" +\n        \"FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id \" +\n        \"WHERE s.project_id = ? AND s.symbol_type IN ('class','interface','struct','trait','enum') \" +\n        \"AND (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) > ?\"",
    replace: "        \"COUNT(m.id) AS members \" +\n        \"FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id \" +\n        \"LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id \" +\n        \"WHERE s.project_id = ? AND s.symbol_type IN ('class','interface','struct','trait','enum') \" +\n        \"GROUP BY s.id HAVING COUNT(m.id) > ?\"",
  },
  {
    id: "N5",
    file: "src/intelligence/patterns/rules.ts",
    undoes: "the framework branch honouring `confidenceThreshold` at all — it carried a hardcoded 0.6 and no check, so asking for 0.9 returned every framework finding",
    find: "      const confidence = 0.6\n      if (confidence < options.confidenceThreshold) continue\n      // One finding per framework TYPE",
    replace: "      const confidence = 0.6\n      // One finding per framework TYPE",
  },
  {
    id: "N6",
    file: "src/intelligence/patterns/rules.ts",
    undoes: "the non-code language exclusion — a JSON file's structural keys get reported as a god class, which is what docs/data/m10-baseline.json did on a 45,018-symbol index",
    // BOTH halves, and the replacement is a TAUTOLOGY rather than an empty
    // string. Two earlier versions of this mutation never exercised anything:
    // the first emptied only `nonCodeClause`, leaving `nonCode.params`
    // populated, so the queries had fewer `?` than bound arguments and
    // better-sqlite3 threw; the second emptied `nonCode.sql`, which left the
    // clause as a bare ` AND ` and made every rule query a syntax error. Both
    // times the self-test reported INCONCLUSIVE and the exclusion it was meant
    // to cover went untested. `1=1` keeps the SQL valid, keeps the placeholder
    // count right, and excludes nothing — which is what "no exclusion" means.
    find: "  const nonCode = nonCodeLanguageSQL(\"f\")",
    replace: "  const nonCode = { sql: \"1=1\", params: [] as string[] }",
  },
  {
    id: "N7",
    file: "src/intelligence/patterns/rules.ts",
    undoes: "the `json_valid` guard — json_each THROWS on a malformed parameters value, taking the whole scan with it",
    find: "        \"AND json_valid(s.parameters) AND length(s.parameters) >= 17 \" +",
    replace: "        \"AND length(s.parameters) >= 17 \" +",
    // Without the guard the query throws rather than answering, so the gate dies
    // instead of disagreeing. That IS the defect, so it is declared rather than
    // being allowed to pass as an ordinary failing assertion.
    expectCrash: true,
  },
]

console.log("M65.P2 — each mutation must turn script/m65/verify-rules-budget-and-gates.ts red\n")

// Baseline first. A gate that is already red makes every "the mutation was
// caught" result vacuous, which is the target-only harness's failure mode.
{
  let green = false
  let out = ""
  try {
    out = execFileSync(process.execPath, ["--import", "tsx", path.join(REPO, GATE)], {
      cwd: REPO, encoding: "utf8", stdio: "pipe", timeout: 900_000,
    })
    green = true
  } catch (e: any) {
    out = (e.stdout ?? "") + (e.stderr ?? "")
  }
  // Not just "exited 0": the gate must actually have evaluated its checks. A gate
  // that skips its body and returns 0 is green and silent.
  const evaluated = (out.match(/^  (ok|FAIL):/gm) ?? []).length
  check(`baseline: the gate is GREEN and evaluated its checks (otherwise every mutation result is vacuous)`,
    green && evaluated >= 25, `exit ok=${green}, checks evaluated=${evaluated}`)
  if (!green) console.log(out.split("\n").filter((l) => /FAIL|M65/.test(l)).join("\n"))
}

for (const m of MUTATIONS) {
  const target = path.join(REPO, m.file)
  if (!existsSync(target)) { check(`${m.id} the file it mutates exists`, false, target); continue }
  const original = readFileSync(target, "utf8")
  if (!original.includes(m.find)) {
    check(`${m.id} the anchor text is present in ${m.file}`, false,
      `the source has moved since the mutation table was written, so the gate can no longer be tested against this decision. Anchor: ${JSON.stringify(m.find.slice(0, 70))}`)
    continue
  }

  const mirror = mkdtempSync(path.join(tmpdir(), "bb-m65-mut-"))
  try {
    for (const dir of ["src", "script", "package.json", "tsconfig.json"]) {
      const from = path.join(REPO, dir)
      if (!existsSync(from)) continue
      const to = path.join(mirror, dir)
      mkdirSync(path.dirname(to), { recursive: true })
      cpSync(from, to, { recursive: true })
    }
    // Without this the engine aborts on a missing tree-sitter.wasm and every
    // mutation "passes" by crashing. That is exactly how m64's self-test came to
    // report 7/7 for seven mutations that proved nothing.
    if (existsSync(path.join(REPO, "wasm"))) {
      try { symlinkSync(path.join(REPO, "wasm"), path.join(mirror, "wasm"), "dir") } catch {}
    }
    writeFileSync(path.join(mirror, m.file), original.replace(m.find, m.replace))
    const link = path.join(mirror, "node_modules")
    if (!existsSync(link)) {
      try { execFileSync("ln", ["-s", path.join(REPO, "node_modules"), link]) } catch {}
    }

    let exitCode = 0
    let out = ""
    try {
      out = execFileSync(process.execPath, ["--import", "tsx", path.join(mirror, GATE)], {
        cwd: mirror, encoding: "utf8", stdio: "pipe", timeout: 900_000,
      })
    } catch (e: any) {
      exitCode = e.status ?? 1
      out = (e.stdout ?? "") + (e.stderr ?? "")
    }
    // "M65.P1 session" is the gate's own catch-all: the body is wrapped in a
    // try/catch that turns ANY exception into one failing check. A mutation that
    // merely crashes is therefore indistinguishable from a real disagreement
    // unless it is told apart here.
    const red = out.split("\n").filter((l) => l.includes("FAIL:"))
      .map((l) => l.trim().replace(/^FAIL:\s*/, "").split(" — ")[0])
    const real = red.filter((c) => c !== "M65.P1 session")
    const onlySession = red.length === 1 && red[0] === "M65.P1 session"
    const how = real.length > 0
      ? `${real.length} real assertion(s): ${real.slice(0, 2).join("; ")}`
      : onlySession
        ? (m.expectCrash ? "the gate refused to run, as this mutation expects" : "INCONCLUSIVE — the gate crashed before judging anything")
        : `exit=${exitCode} with no failing assertion`
    console.log(`       -> ${how}`)
    const caught = m.expectCrash
      ? exitCode !== 0 && (real.length > 0 || onlySession)
      : exitCode !== 0 && real.length > 0
    check(`${m.id} the gate goes RED when this is undone — ${m.undoes}`, caught,
      `exit=${exitCode} failing=${JSON.stringify(red.slice(0, 3))}`)
  } finally {
    rmSync(mirror, { recursive: true, force: true })
  }
}

console.log(`\nM65.P2: ${failures === 0 ? `PASS (${checks}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
