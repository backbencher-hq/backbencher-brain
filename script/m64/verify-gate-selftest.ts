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

import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
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
}

const MUTATIONS: Mutation[] = [
  {
    id: "M1",
    file: "src/intelligence/patterns/orphans.ts",
    undoes: "the evidence quality gate — a self-loop / inferred / low-confidence row is accepted as a consumer again",
    // The gate's three-part condition, reduced to "no condition".
    find: `        row.src !== null && row.id !== null && row.src === row.id ? SELF_LOOP_EXCLUDED
        : row.ev === "inferred" ? INFERRED_EXCLUDED
        : typeof row.conf === "number" && row.conf < MIN_EDGE_CONFIDENCE ? LOW_CONFIDENCE_EXCLUDED
        : null`,
    replace: `        null`,
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
    check(`${m.id} the gate goes RED when this is undone — ${m.undoes}`,
      exitCode !== 0 && redChecks.length > 0,
      `exit=${exitCode} failingChecks=${redChecks.length} ${JSON.stringify(redChecks.slice(0, 3))}`)
  } finally {
    rmSync(mirror, { recursive: true, force: true })
  }
}

console.log(`\nM64.P2: ${failures === 0 ? `PASS (${checks}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
