/**
 * PROVE THE PROTOBUF DOC-TRUTH EMISSION TABLE — by running the shared gate, not a
 * re-implementation of it.
 *
 * ## Why this exists
 *
 * Pass 14 of `docs/analyzers/real-protobuf-analyzer.md` ended with this sentence:
 *
 *   "Until it runs, the 'Emitted?' column in §Verdict per type above is
 *    hand-verified and not machine-checked"
 *
 * The reason given was that `script/m14/verify-doc-truth-emissions.ts` cannot
 * start, because it uses a top-level `__dirname` and the package is
 * `"type": "module"`. That reason was measured under `npx tsx` and
 * `node --import tsx`. The gate's own USAGE block invokes it as `bun run`, and
 * `protobuf-runner-probe.mts` measures all 15 files in the repository that hold a
 * `__dirname` identifier node: **15 of 15 start under `bun run`, 8 of 15 crash
 * under `npx tsx`.** So the gate runs, and the sentence above was wrong.
 *
 * ## Why this is not a re-implementation
 *
 * `verify-doc-truth-emissions.ts` is shared machinery and this lane does not edit
 * it. Nothing here reimplements its claim parser, its alias table, or its emission
 * derivation. This script does three mechanical things:
 *
 *   1. Builds a `--root` containing this lane's analyzer and this lane's doc, at
 *      the relative paths the gate reads them from, by COPYING the two files. The
 *      gate scans `src/ast/` for `real-*-analyzer.ts`, so a root holding one
 *      analyzer makes its own summary print `1 analyzers` and its own findings
 *      name `protobuf`. Scoping is the gate's own `--root` flag, read from its own
 *      USAGE block.
 *   2. Runs the gate three times: once against that root, once against the whole
 *      tree filtered for protobuf rows, and once as its own `--selftest`.
 *   3. Proves the gate CAN fail before its silence is read as agreement — a gate
 *      that cannot fail and reports nothing is indistinguishable from a gate that
 *      passes.
 *
 * Then it deletes the root. `--no-write` is passed so the shared register
 * `docs/DOC-TRUTH-EMISSIONS.md` is never touched by a lane-scoped run.
 *
 * ## What a pass here does and does not mean
 *
 * A pass means: every checkable claim in this lane's ontology table agrees with
 * what the gate reads off this lane's analyzer source. It does NOT mean the table's
 * COUNTS are right — the gate never looks at a count. It compares the emitted
 * surface, derived from `RelationshipType.*` references in code and from the
 * import-site/export-site payload channels, against the yes/no cells. Pass 2 of
 * this lane found a defect in that gate (it skips the first body row of a claim
 * table), which is why this lane's table still leads with a `no` row: a dropped
 * `no` costs nothing, a dropped `yes` would hide an emitted type.
 *
 * CLI: npx tsx script/m14/protobuf-doc-truth-proof.mts [--keep]
 */
import { execFileSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const GATE = "script/m14/verify-doc-truth-emissions.ts"
const ANALYZER = "src/ast/real-protobuf-analyzer.ts"
const DOC = "docs/analyzers/real-protobuf-analyzer.md"
const SCOPED = path.join(ROOT, "script/m14/tmp/protobuf/doctruth-root")
const KEEP = process.argv.includes("--keep")

for (const rel of [GATE, ANALYZER, DOC]) {
  if (!existsSync(path.join(ROOT, rel))) {
    console.error(`missing required input: ${rel}`)
    process.exit(2)
  }
}

/**
 * Run the gate and return BOTH streams.
 *
 * The gate prints its verdict line with `console.error`, and `execFileSync` only
 * hands back stderr when the child exits non-zero. Reading the summary off stdout
 * alone therefore prints "(no summary line)" on exactly the runs that PASSED — the
 * failure mode where a working gate looks mute. So stderr goes to a real file
 * descriptor and is read back either way.
 */
function run(label: string, args: string[]): { code: number; out: string } {
  const errPath = path.join(SCOPED + ".stderr")
  const errFd = openSync(errPath, "w")
  let out = ""
  let code = 0
  try {
    out = execFileSync("bun", ["run", GATE, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", errFd],
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 900_000,
    })
  } catch (e) {
    const err = e as { status?: number; stdout?: string }
    code = typeof err.status === "number" ? err.status : 1
    out = `${err.stdout ?? ""}`
  } finally {
    closeSync(errFd)
  }
  let err = ""
  try {
    err = readFileSync(errPath, "utf8")
  } catch {
    err = ""
  }
  rmSync(errPath, { force: true })
  const both = `${out}\n${err}`
  const summary = both
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("doc-truth-emissions:") || l.startsWith("doc-truth-emissions selftest:"))
  console.log(`${label.padEnd(34)} exit ${code}   ${summary ?? "(no summary line)"}`)
  return { code, out: both }
}

// ------------------------------------------------------------------ 0. selftest
// Run first. A gate that cannot fail cannot be cited as agreeing.
console.log("=== A. the gate's own selftest — can it still fail? ===")
const self = run("A  --selftest", ["--selftest"])
const selfCases = self.out
  .split("\n")
  .filter((l) => l.trim().startsWith("ok ")).length
console.log(`   cases reporting ok: ${selfCases}`)
console.log("")

// ------------------------------------------------- 1. this lane, scoped by --root
console.log("=== B. this lane alone, via the gate's own --root flag ===")
rmSync(SCOPED, { recursive: true, force: true })
mkdirSync(path.join(SCOPED, "src/ast"), { recursive: true })
mkdirSync(path.join(SCOPED, "docs/analyzers"), { recursive: true })
cpSync(path.join(ROOT, ANALYZER), path.join(SCOPED, ANALYZER))
cpSync(path.join(ROOT, DOC), path.join(SCOPED, DOC))
const scopedFiles = readdirSync(path.join(SCOPED, "src/ast"))
console.log(`   derived root holds ${scopedFiles.length} analyzer file(s): ${scopedFiles.join(", ")}`)
const b = run("B  --root <lane> --no-write", ["--root", SCOPED, "--no-write"])
const bFindings = b.out.split("\n").filter((l) => /^(FALSE_NEGATIVE|FALSE_POSITIVE|UNDOCUMENTED|NO_CLAIM_TABLE|MISSING_DOC)/.test(l.trim()))
console.log(`   findings naming any lane: ${bFindings.length}`)
for (const f of bFindings.slice(0, 20)) console.log(`     ${f.trim().slice(0, 160)}`)
console.log("")

// --------------------------------------- 2. whole tree, and the protobuf rows in it
console.log("=== C. whole tree, protobuf's rows among everyone else's ===")
const c = run("C  whole tree --no-write", ["--no-write"])
const pbRows = c.out.split("\n").filter((l) => l.includes("protobuf"))
console.log(`   lines mentioning protobuf: ${pbRows.length}`)
for (const l of pbRows.slice(0, 20)) console.log(`     ${l.trim().slice(0, 160)}`)
console.log("")

// ------------------------------------------------------------------- verdict
console.log("=== what this establishes ===")
const verdict: string[] = []
if (self.code !== 0) verdict.push(`the gate's selftest FAILED (exit ${self.code}) — its silence would mean nothing`)
else verdict.push(`the gate's selftest passed: ${selfCases} cases, so it can report a disagreement`)
if (b.code === 0 && bFindings.length === 0) {
  verdict.push(`scoped to this lane the gate reports 1 analyzer and 0 findings of any kind`)
} else {
  verdict.push(`scoped to this lane the gate reports ${bFindings.length} finding(s) — see above`)
}
if (c.code !== 0) {
  verdict.push(`whole-tree exit ${c.code}: FALSE_NEGATIVE/FALSE_POSITIVE in OTHER lanes, which this lane does not own`)
}
if (pbRows.length === 0) verdict.push(`the whole-tree run printed no protobuf row, consistent with the scoped run`)
console.log(verdict.map((v) => `  - ${v}`).join("\n"))

if (!KEEP) rmSync(SCOPED, { recursive: true, force: true })
else console.log(`\nkept ${path.relative(ROOT, SCOPED)}`)
console.log("")
process.exit(b.code === 0 && self.code === 0 ? 0 : 1)
