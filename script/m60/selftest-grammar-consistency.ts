// script/m60/selftest-grammar-consistency.ts — prove the consistency gate can
// FAIL, and restore the tree exactly.
//
// WHY THIS FILE EXISTS. A gate that cannot be proven to fail is a decoration.
// H5 was written, reported "0 failures", and was WRONG: the first version
// compared only the two lanes that happened to record a `declared.sha256`, so
// appending one byte to wasm/tree-sitter-c.wasm left it green. Nothing in the
// 312-step `verify` chain would ever have caught that. The defect was found by
// hand, once — which means it can be reintroduced by any future edit to H5 and
// nothing would say so.
//
// So the failure is manufactured here, on purpose, and asserted. Five scenarios,
// each perturbing one real file, running the real verifier, and checking the
// gate went red for the RIGHT reason — a check that goes red for the wrong
// reason is not a passing test either.
//
// SAFETY. This mutates real files. Each perturbation is applied to a file whose
// exact bytes are captured first, and restored in a `finally`. After the last
// scenario every touched file's sha256 is compared against the value captured
// before the run, and a mismatch is a hard failure of THIS script. If the
// process is killed mid-run the file is left perturbed, which `git status` will
// show — the restore is best-effort under SIGKILL by definition, and this script
// is therefore run by hand and on a clean tree, not as part of `npm run verify`.
//
// Usage:
//   bun run script/m60/selftest-grammar-registry.ts
//   bun run script/m60/selftest-grammar-registry.ts --keep-going
//
// Writes: nothing. Exit 0 = the gate provably fails when it should.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const VERIFIER = path.join(ROOT, "script", "m60", "verify-grammar-consistency.ts")

type Scenario = {
  id: string
  why: string
  file: string
  mutate: (bytes: Buffer) => Buffer
  /** Unlink instead of rewriting, to exercise the missing-artifact branch. */
  remove?: boolean
  expectCheck: string
  expectMessage: RegExp
}

const scenarios: Scenario[] = [
  {
    id: "silent-wasm-swap",
    why:
      "THE defect this gate exists for. One byte appended to a grammar wasm, with no other change anywhere. This is what a grammar swap looks like to the rest of the build, and the first version of this check was blind to it while it compared only lanes carrying a declared pin.",
    file: "wasm/tree-sitter-c.wasm",
    mutate: (b) => Buffer.concat([b, Buffer.from([0x0a])]),
    expectCheck: "C3",
    expectMessage: /C3 c: tree-sitter-c\.wasm no longer matches the survey/,
  },
  {
    id: "prose-version-drift",
    why:
      "The owner's requirement by name: one version in the docs, another in the file that owns the lane. A doc edited to a version no record carries must be red, not merely inconsistent.",
    file: "docs/analyzers/real-python-analyzer.md",
    mutate: (b) => Buffer.from(b.toString("utf8").replace("`tree-sitter-python` **0.25.0**", "`tree-sitter-python` **0.26.0**")),
    expectCheck: "C4",
    expectMessage: /C4 python: docs\/analyzers\/real-python-analyzer\.md says 0\.26\.0 but the survey says 0\.25\.0/,
  },
  {
    id: "artifact-deleted",
    why:
      "A wasm both files name but the tree no longer has is a broken product, not a bookkeeping detail. This DELETES the file rather than truncating it: the first attempt truncated to zero bytes, which is a different branch (the file still exists, so C3 reports a hash mismatch) and the test asserted the wrong message. A test that passes for the wrong reason is not a test.",
    file: "wasm/tree-sitter-clean.wasm",
    mutate: (b) => b,
    remove: true,
    expectCheck: "C3",
    expectMessage: /C3 clean: the survey names tree-sitter-clean\.wasm but it is not in wasm\//,
  },
  {
    id: "the-two-records-disagree",
    why:
      "The case ONLY a cross-check can catch, and the reason this gate exists alongside the pin record rather than replacing it. The pin record and the survey both describe `clojure`; here the survey is made to claim a different build. Neither file is internally inconsistent — the pin record's own gate stays green — so without C2 the repo would be shipping two files that each look authoritative and contradict each other. The pin record is perturbed rather than the survey because the survey is regenerated from the network and would simply be overwritten.",
    file: "validation/m14/grammar-pins.json",
    mutate: (b) => {
      const j = JSON.parse(b.toString("utf8"))
      j.lanes.clojure.wired.sha256 = "0".repeat(64)
      return Buffer.from(JSON.stringify(j, null, 2) + "\n")
    },
    expectCheck: "C2",
    expectMessage: /C2 clojure: the pin record ships 0000000000000000… but the survey records [0-9a-f]{16}…/,
  },
  {
    id: "stale-survey",
    why:
      "An upstream landscape that silently went stale is how a lane drifts a year without anyone looking. C7 fails on the survey's own age, and the threshold is settable so the check is testable rather than decorative.",
    file: "validation/m60/grammar-survey.json",
    mutate: (b) => {
      const j = JSON.parse(b.toString("utf8"))
      j.generatedAt = "2020-01-01T00:00:00.000Z"
      return Buffer.from(JSON.stringify(j, null, 2) + "\n")
    },
    expectCheck: "C7",
    expectMessage: /C7: the upstream survey is \d+ days old/,
  },
]

const sha = (p: string) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "ABSENT")

// SAFETY GATE — added after a co-agent race was nearly caused.
//
// This script mutates real files, including files ANOTHER AGENT MAY BE EDITING.
// Two agents working the same tree is the normal condition here, not an
// exception, and a capture-then-restore over a file someone else is writing
// silently discards their change: the restore is byte-exact against the bytes
// captured at the START, so anything written in between is gone.
//
// So the run ABORTS if any file it intends to touch is uncommitted. `git status
// --porcelain` is the test. A clean tree means the committed content is what we
// captured, so a restore is always correct even if the other agent commits
// something unrelated meanwhile. `--force` overrides, for the case where the
// dirty state IS the thing under test and the operator knows it.
const FORCE = process.argv.includes("--force")
const dirty: string[] = []
for (const sc of scenarios) {
  const rel = sc.file
  let out = ""
  try {
    out = execFileSync("git", ["status", "--porcelain", "--", rel], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    out = "" // untracked is reported by ?? and handled below
  }
  // `??` (untracked) is exempt: those are this milestone's own artifacts, they
  // have no committed content to lose, and a byte-exact restore of a file the
  // same process created is trivially correct. Only a MODIFIED or STAGED tracked
  // file can carry someone else's uncommitted work.
  if (out && !/^\?\?/.test(out)) dirty.push(rel)
}
if (dirty.length && !FORCE) {
  console.error(
    `selftest-grammar-consistency: REFUSING to run.\n` +
      `  These files this script would perturb have UNCOMMITTED changes:\n` +
      dirty.map((f) => `    ${f}`).join("\n") +
      `\n  A co-agent is very likely mid-edit on one of them, and this script's\n` +
      `  restore is byte-exact against the bytes captured at the start — so anything\n` +
      `  written in between would be silently discarded.\n` +
      `  Commit or stash first, or pass --force if you know the state is safe.`,
  )
  process.exit(2)
}

let failures = 0
const touched = new Map<string, string>()

for (const sc of scenarios) {
  const abs = path.join(ROOT, sc.file)
  const before = existsSync(abs) ? readFileSync(abs) : null
  if (before === null) {
    console.log(`  SKIP  ${sc.id}  ${sc.file} does not exist`)
    continue
  }
  if (!touched.has(sc.file)) touched.set(sc.file, sha(abs))
  try {
    if (sc.remove) unlinkSync(abs)
    else writeFileSync(abs, sc.mutate(before))
    let out = ""
    let exit = 0
    try {
      out = execFileSync("bun", ["run", VERIFIER], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    } catch (e) {
      out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`
      exit = (e as { status?: number }).status ?? 1
    }
    const wentRed = exit !== 0
    const rightReason = sc.expectMessage.test(out)
    const named = out.includes(sc.expectCheck)
    if (wentRed && rightReason && named) {
      console.log(`  PASS  ${sc.id.padEnd(24)} gate went red on ${sc.expectCheck} for the right reason`)
    } else {
      failures++
      console.log(`  FAIL  ${sc.id.padEnd(24)} exit=${exit} rightReason=${rightReason} namedCheck=${named}`)
      console.log(`        expected /${sc.expectMessage.source}/`)
      const hit = out.split("\n").filter((l) => l.includes("HARD") || l.trim().startsWith("H"))
      for (const l of hit.slice(0, 6)) console.log(`        got: ${l.trim()}`)
    }
  } finally {
    writeFileSync(abs, before)
  }
}

// The restore is the part that must not be taken on trust.
let restoreFailures = 0
for (const [file, expected] of touched) {
  const now = sha(path.join(ROOT, file))
  if (now !== expected) {
    restoreFailures++
    console.log(`  FAIL  restore  ${file}  expected ${expected.slice(0, 16)}… now ${now.slice(0, 16)}…`)
  } else {
    console.log(`  PASS  restore  ${file.padEnd(38)} byte-identical`)
  }
}

console.log(
  `\nselftest-grammar-consistency: ${scenarios.length - failures}/${scenarios.length} scenario(s) convicted the gate, ${touched.size - restoreFailures}/${touched.size} file(s) restored`,
)
process.exit(failures || restoreFailures ? 1 : 0)
