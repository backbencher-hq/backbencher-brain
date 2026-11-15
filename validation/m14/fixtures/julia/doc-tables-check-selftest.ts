/**
 * DOC-TABLES-CHECK SELF-TEST — does the doc gate still REFUSE a degraded census?
 *
 * ## Why this file exists
 *
 * On 2026-10-04 `doc-tables-check.ts` printed `FAIL — 41 mismatch(es)` against
 * `docs/analyzers/julia.md`, a doc whose every one of those cells is correct. The
 * census it had read, `/tmp/census.json`, was left by an earlier run of the day in which ONE file
 * degraded (`StaticArrays.jl/test/matrix_multiply_add.jl`, `wasmParseThrew`, `analysedFiles` 1,984
 * of 1,985). A degraded file is absent from every total while `admittedFiles` still counts it, so its
 * shortfall reached the comparison as doc drift. The gate now refuses such a census by name and
 * cause and exits 2 (`REFUSED`), naming the file.
 *
 * That guard is the whole value of this file, and a guard nobody exercises is the inert-pin class
 * this lane has already paid for once: `script/m60/julia-mutants.ts` carried 28 mutants with zero
 * importers. So the refusal is asserted here, on SYNTHETIC censuses — no corpus walk, a few hundred
 * milliseconds — because the thing being tested is the DECISION, not the arithmetic.
 *
 * ## What it asserts
 *
 * Four cases, each a census JSON written to a temp file and passed to `doc-tables-check.ts --json`:
 *
 *   A. degraded (1 degraded file, analysed < admitted)  -> exit 2, banner REFUSED, the degraded file
 *      NAMED, and neither `FAIL —` nor a bare `PASS —` printed.
 *   B. incomplete but not flagged (analysed < admitted, degradedFiles empty) -> exit 2. This is the
 *      second half of the guard: a census whose walk was truncated leaves no `degradedFiles` entry,
 *      and `analysedFiles !== admittedFiles` is the only witness.
 *   C. clean (0 degraded, analysed == admitted)          -> SCORED: it reaches the comparison and
 *      reports mismatches. The synthetic census does not carry the doc's values, so a scored run exits
 *      1 with `FAIL —`; the assertion is that it was scored at all, not that it passed.
 *   D. clean, but with one degraded file PRESENT          -> exit 2, i.e. case A is not passing for
 *      an unrelated reason such as the checker failing to start at all.
 *
 * Case D is the control. Without it, A/B/C could all be satisfied by a `doc-tables-check.ts` that
 * exits 0 on everything, which would make this file a green light on a broken gate.
 *
 * ## What it deliberately does NOT do
 *
 * It does not run the corpus census. Reproducing the real thing is `census.ts`'s job and takes
 * minutes; this file is fast enough to run on every edit, which is the point of a regression test.
 * It writes only under the OS temp dir and removes what it made.
 *
 * ## USAGE
 *   npx tsx validation/m14/fixtures/julia/doc-tables-check-selftest.ts
 *
 * Exit 0 when all four cases hold, 1 otherwise, naming the case and what differed.
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..", "..")
const GATE = path.join(ROOT, "validation/m14/fixtures/julia/doc-tables-check.ts")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "julia-doc-tables-selftest-"))

const ADMITTED = 1985

/**
 * A census the gate can read. Only the fields `doc-tables-check.ts` touches are populated, and each
 * is populated with a shape it can compare — `perType` rows with `emitted`/`files`, `symbolKinds`
 * with kind counts. The VALUES are deliberately not the doc's: this file tests the decision the gate
 * makes about a population, and if the arithmetic matched the doc the degraded case could not fail
 * for the reason it is here to catch.
 */
function census(over: { degraded?: unknown[]; analysed?: number } = {}): string {
  const perType: Record<string, unknown> = {}
  for (const t of ["calls", "references", "uses", "contains", "instantiates", "imports", "exports", "extends", "overrides"]) {
    perType[t] = { emitted: 1, files: ["a.jl"] }
  }
  perType.implements = { emitted: 0 }
  const json = {
    generatedFor: "julia",
    admittedFiles: ADMITTED,
    production: {
      symbols: 1,
      analysedFiles: over.analysed ?? ADMITTED,
      degradedFiles: over.degraded ?? [],
      symbolKinds: { function: 1 },
      syntheticSources: {},
      perType,
    },
    incoming: { perType: {} },
  }
  const p = path.join(TMP, `census-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(p, JSON.stringify(json))
  return p
}

interface Run {
  code: number
  out: string
}
function runGate(censusPath: string): Run {
  try {
    const out = execFileSync("npx", ["tsx", GATE, "--json", censusPath], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    })
    return { code: 0, out }
  } catch (e: any) {
    // tsx surfaces a non-zero exit as a throw; the output is still the gate's.
    return { code: typeof e?.status === "number" ? e.status : -1, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` }
  }
}

const results: { name: string; ok: boolean; why: string }[] = []
function check(name: string, ok: boolean, why: string) {
  results.push({ name, ok, why })
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `\n          ${why}`}`)
}

/** A refusal must not print a verdict. `FAIL —` and a bare `PASS —` are both wrong here. */
function isRefusal(r: Run): { ok: boolean; why: string } {
  if (r.code !== 2) return { ok: false, why: `exit ${r.code}, expected 2` }
  if (!r.out.includes("REFUSED")) return { ok: false, why: "exit 2 but no REFUSED banner" }
  if (r.out.includes("FAIL —")) return { ok: false, why: "printed FAIL — on a census it must not score" }
  if (/PASS — every table cell/.test(r.out)) return { ok: false, why: "printed a full PASS on a refused census" }
  return { ok: true, why: "" }
}

console.log(`doc-tables-check self-test — the degraded-census refusal`)
console.log(`gate: ${path.relative(ROOT, GATE)}`)
console.log(`tmp:  ${TMP}\n`)

// ---- A. degraded: 1 degraded file, analysed < admitted
{
  const c = census({
    degraded: [{ file: "StaticArrays.jl/test/matrix_multiply_add.jl", bytes: 7844, cause: "wasmParseThrew" }],
    analysed: ADMITTED - 1,
  })
  const r = runGate(c)
  const v = isRefusal(r)
  check("A degraded census is REFUSED, not scored", v.ok, v.why)
  check(
    "A the degraded file is NAMED with its cause",
    r.out.includes("matrix_multiply_add.jl") && r.out.includes("wasmParseThrew"),
    "the banner did not name the file and cause",
  )
  check("A the shortfall is explained, not just reported", r.out.includes("admittedFiles"), "no admitted/analysed line")
  check("A a re-run command is offered", r.out.includes("BB_JULIA_WORKERS=1"), "no width-1 re-run instruction")
}

// ---- B. incomplete but NOT flagged — the witness is analysedFiles, not degradedFiles
{
  const c = census({ degraded: [], analysed: ADMITTED - 1 })
  const r = runGate(c)
  const v = isRefusal(r)
  check("B an incomplete walk is REFUSED even with 0 degradedFiles", v.ok, v.why)
}

// ---- C. clean: 0 degraded, analysed == admitted. Must be SCORED, not refused.
{
  const c = census()
  const r = runGate(c)
  // The synthetic census deliberately does not carry the doc's values, so a scored run REPORTS
  // mismatches and exits 1. That is the correct outcome and it is the thing being asserted: the
  // point of case C is that a clean census reaches the COMPARISON. Asserting exit 0 here would be
  // asserting that synthetic numbers equal the doc's, which is a different (and wrong) claim — the
  // first run of this file made exactly that mistake and case C caught it.
  check(
    "C a clean census is SCORED, not refused",
    !r.out.includes("REFUSED") && r.code !== 2,
    `exit ${r.code} with a REFUSED banner — the guard is refusing clean censuses too`,
  )
  check(
    "C the comparison actually ran and reported mismatches",
    r.out.includes("FAIL —") && r.out.includes("mismatch"),
    "a clean census reached neither the refusal nor the comparison",
  )
  check("C the census line marks it clean", /clean: 0 degraded/.test(r.out), "no clean marker on the census line")
}

// ---- D. control: clean EXCEPT one degraded file. Must refuse, proving A is not passing by accident.
{
  const c = census({ degraded: [{ file: "X.jl", bytes: 10, cause: "someCause" }], analysed: ADMITTED })
  const r = runGate(c)
  const v = isRefusal(r)
  check("D control: a lone degraded file is refused with analysed == admitted", v.ok, v.why)
}

const failed = results.filter((r) => !r.ok)
console.log(`\ncases: ${results.length}, failed: ${failed.length}`)
try {
  fs.rmSync(TMP, { recursive: true, force: true })
} catch {
  /* the temp dir is disposable; failing to remove it must not fail the test */
}
if (failed.length > 0) {
  console.log(`\nFAIL — the degraded-census refusal is not holding:`)
  for (const f of failed) console.log(`  ${f.name}: ${f.why}`)
  process.exit(1)
}
console.log(`\nPASS — a degraded or incomplete census is refused by name, and a clean one is scored.`)
process.exit(0)