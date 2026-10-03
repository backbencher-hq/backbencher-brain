/**
 * The index-path files that carried `@ts-nocheck` now do not, and the typing
 * that replaced it is real rather than cosmetic.
 *
 * The bug this exists for
 * ----------------------
 * Ten files in the index path suppressed the whole typechecker — 17,083 lines
 * removed from checking. One directive had already been found hiding a live
 * crash (`ReferenceError: stats is not defined`, parallel-indexer.ts, fixed in
 * `eeccf954c`). Six of those ten still hid 59 real errors; four were STALE —
 * 0 errors, so the directive suppressed nothing and was pure debt.
 *
 * Two of the 59 were not typing nits:
 *
 *   1. `setup-wizard.ts` narrowed a thrown value to read `.message` off it with
 *      no guard. `validate()` is injectable, so a double throwing `null`
 *      reached `null.message` and CRASHED the wizard mid-flow instead of
 *      reporting the failed validation and returning.
 *   2. `cross-language-intelligence-persister.ts` imported
 *      `SQLiteBunDatabase` from `drizzle-orm/bun-sqlite`, which DOES NOT EXIST
 *      (the export is `BunSQLiteDatabase`). The broken import resolved to `any`,
 *      so all 11 `db:` parameters were `any` and every one of those function
 *      bodies was unchecked. Correcting the name gave them a real type — proved
 *      below by planting an error in one and watching tsc catch it.
 *
 * A third, `cross-language-intelligence.ts` reconstructing taint `flowPath` as
 * `string[]` while `TaintFlow.flowPath` declares `DataFlowStep[]`, is a real
 * mismatch in the DECLARED type. It is documented rather than reshaped (there is
 * no structure in the stored value to build a DataFlowStep from) and recorded in
 * the evidence's limitations so it is not forgotten.
 *
 * How this proves it
 * ------------------
 * A. Source: no file in the ten carries a `@ts-nocheck` directive, and tsconfig
 *    includes every `.ts` file under `src`, so they are genuinely checked
 *    rather than merely un-suppressed.
 * B. Teeth: a type error planted inside one of the eleven previously-unchecked
 *    persister bodies must be reported. This is what separates "the directive is
 *    gone" from "the types are real".
 * C. Behaviour, through public APIs: `validateKey` must produce the SAME message
 *    for every shape a thrown value can take, and must reject a malformed 2xx
 *    body. Both are the narrowing this change introduced, checked against the
 *    exact outputs the pre-fix code produced — including for a thrown `null`
 *    and a thrown primitive, where "unchanged" means an unhelpful `null` /
 *    `boom` in the text rather than a crash.
 *
 * What this gate does NOT do, and why
 * -----------------------------------
 * It does not drive `runSetupWizard`'s key-entry path, which is where defect 1
 * lives. That path needs a real TTY: `readline.createInterface` puts a
 * non-terminal stream into flowing mode and drains it before `hiddenQuestion`
 * can attach its keypress listener, so a scripted Readable never delivers a
 * keystroke. This environment's `script` is BSD's, which has no `-qec` to
 * allocate a pty (the pre-existing failure in
 * script/m30/verify-first-run-hook.ts, which fails identically at the base
 * commit). So defect 1 is covered by the type system and by review, not by a
 * behavioural assertion here — stated rather than papered over.
 *
 * Run: npx tsx script/verify-untyped-index-path.ts
 * Evidence: validation/typing/results/UNTYPED.json (machine-emitted)
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const RESULTS_DIR = path.join(ROOT, "validation/typing/results")
const EVIDENCE_PATH = path.join(RESULTS_DIR, "UNTYPED.json")

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []
function check(label: string, cond: boolean, detail = ""): void {
  checks++
  if (cond) { passed++; return }
  failed++
  failures.push(label + (detail ? ` — ${detail}` : ""))
  console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")

/** The ten files this round owns. */
const FILES = [
  "src/setup/setup-wizard.ts",
  "src/ast/project-health.ts",
  "src/ast/cross-language-intelligence.ts",
  "src/brain/brain-relationship-enrichment.ts",
  "src/brain/semantic/local-embed.ts",
  "src/ast/cross-language-intelligence-persister.ts",
  "src/ast/cross-language-migration-assistant.ts",
  "src/ast/framework-detectors.ts",
  "src/ast/graph.ts",
  "src/brain/semantic/engine.ts",
]

console.log("UNTYPED index-path directive removal + the typing that replaced it")

// ── A. no directive, and genuinely inside the checked set ──────────────────
for (const rel of FILES) {
  const src = read(rel)
  // A directive, not prose about one. setup-wizard's header explains what the
  // directive used to hide, and that sentence must not read as the directive.
  const directive = src.split("\n").find((l) => /^\s*\/\/\s*@ts-nocheck\s*$/.test(l))
  check(`A: ${rel} carries no @ts-nocheck directive`, directive === undefined, directive ?? "")
}
{
  const tsconfig = read("tsconfig.json")
  check("A: tsconfig includes src/**/*.ts (the ten are really checked)",
    /"include"\s*:\s*\[\s*"src\/\*\*\/\*\.ts"/.test(tsconfig), "include did not match src/**/*.ts")
  check("A: tsconfig does not exclude any of the ten",
    !/"exclude"\s*:\s*\[[^\]]*(project-health|cross-language-intelligence|framework-detectors|graph|setup-wizard|local-embed|semantic\/engine|brain-relationship-enrichment)/.test(tsconfig))
}

// ── B. the restored types have teeth ────────────────────────────────────────
const PERSISTER = "src/ast/cross-language-intelligence-persister.ts"
{
  const src = read(PERSISTER)
  check("B: the persister imports the drizzle type that actually exists",
    src.includes("BunSQLiteDatabase") && !src.includes("SQLiteBunDatabase"),
    "expected BunSQLiteDatabase, not SQLiteBunDatabase")
  check("B: the non-existent SQLiteBunDatabase is not imported from drizzle",
    !/import type \{ SQLiteBunDatabase \}/.test(src) &&
    !/from\s+"drizzle-orm\/bun-sqlite"[\s\S]{0,200}?SQLiteBunDatabase/.test(src))
}
/** Run tsc and return its combined output, exit code ignored by design. */
function tscOutput(): string {
  try {
    return execFileSync("node", [path.join(ROOT, "node_modules/typescript/bin/tsc"), "--noEmit"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
    })
  } catch (e: any) {
    return `${e?.stdout ?? ""}${e?.stderr ?? ""}`
  }
}
{
  const abs = path.join(ROOT, PERSISTER)
  const original = readFileSync(abs, "utf8")
  const anchor = "    for (const symbol of symbols) {\n      try {"
  check("B: the teeth anchor line is present in the persister", original.includes(anchor), "anchor not found")
  try {
    // A type error inside one of the 11 bodies the broken import had silenced.
    writeFileSync(abs, original.replace(anchor,
      `${anchor}\n        const teethProbe: number = (symbol.definitions as unknown as { length: string }).length`))
    const out = tscOutput()
    // tsc prints the diagnostic, not the identifier, so match on the file.
    const reported = /cross-language-intelligence-persister\.ts\(\d+,\d+\): error TS/.test(out)
    check("B: tsc reports an error planted inside a formerly-unchecked persister body", reported,
      reported ? "" : "the body is still unchecked — the type is not real")
  } finally {
    writeFileSync(abs, original)
  }
  // The tree must be back to clean after the teeth probe.
  check("B: the teeth probe restored the file exactly", readFileSync(abs, "utf8") === original)
}

// ── C. behaviour of the narrowing, through the public API ───────────────────
// A child process per shape, because `validateKey` mutates process.env for
// loopback hosts and each shape must be observed in isolation.
const WIZARD_ABS = path.join(ROOT, "src/setup/setup-wizard.ts")

type CaseResult = { ok?: boolean; name?: string; message?: string }

function runValidatorCase(fixtureBody: string): CaseResult {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-untyped-c-"))
  try {
    const fixture = path.join(dir, "fixture.ts")
    writeFileSync(fixture, `
import { validateKey } from ${JSON.stringify(WIZARD_ABS)}
const thrower = ${fixtureBody}
async function main() {
  try {
    const r = await validateKey("http://127.0.0.1:1", "test-key-123456", "m", thrower as never)
    console.log("JSON:" + JSON.stringify({ ok: true, name: "result", message: String(r.status) }))
  } catch (e) {
    console.log("JSON:" + JSON.stringify({ ok: false, name: "error", message: String((e as {message?:unknown})?.message ?? e) }))
  }
}
main()
`)
    const out = execFileSync(
      process.execPath,
      ["--import", path.join(ROOT, "node_modules/tsx/dist/loader.mjs"), fixture],
      { cwd: ROOT, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
    )
    const line = out.split("\n").find((l) => l.startsWith("JSON:"))
    return line ? (JSON.parse(line.slice(5)) as CaseResult) : { name: "no-output" }
  } catch (e: any) {
    return { name: "fixture-crashed", message: `${e?.stdout ?? ""}${e?.stderr ?? ""}`.slice(0, 240) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Each expected string is what the PRE-FIX code produced. Asserting equality
// with the old output is the point: the narrowing must not change behaviour, and
// for a thrown primitive the old output was the unhelpful value itself.
{
  const errorCase = runValidatorCase(`async () => { throw new Error("boom-error") }`)
  check("C: a thrown Error yields its own message",
    errorCase.ok === false && errorCase.message === "Could not reach the provider: boom-error. Check the base URL.",
    JSON.stringify(errorCase))

  const nullCase = runValidatorCase(`async () => { throw null }`)
  check("C: a thrown null is reported, not crashed on (pre-fix text preserved)",
    nullCase.ok === false && nullCase.message === "Could not reach the provider: null. Check the base URL.",
    JSON.stringify(nullCase))

  const stringCase = runValidatorCase(`async () => { throw "boom-string" }`)
  check("C: a thrown primitive is reported, not crashed on",
    stringCase.ok === false && stringCase.message === "Could not reach the provider: boom-string. Check the base URL.",
    JSON.stringify(stringCase))

  const objectCase = runValidatorCase(`async () => { throw { message: "obj-message" } }`)
  check("C: a thrown plain object with a message reports that message",
    objectCase.ok === false && objectCase.message === "Could not reach the provider: obj-message. Check the base URL.",
    JSON.stringify(objectCase))

  const objectNoMessage = runValidatorCase(`async () => { throw { code: 7 } }`)
  check("C: a thrown object with no message reports the object, as before",
    objectNoMessage.ok === false && /Could not reach the provider: \[object Object\]/.test(objectNoMessage.message ?? ""),
    JSON.stringify(objectNoMessage))
}

// The timeout branch is the one the pre-fix code reached via `e.name`, and the
// pin the m30 gate mutates. A thrown Error NAMED TimeoutError must still map to
// the timeout message — proving the narrowing did not swallow the `e.name` read.
{
  const timeoutCase = runValidatorCase(`async () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e }`)
  check("C: a TimeoutError still maps to the timeout message (the e.name read survives)",
    timeoutCase.ok === false && timeoutCase.message === "Provider did not respond (timeout). Check your internet connection and the base URL.",
    JSON.stringify(timeoutCase))
}

// A malformed 2xx body: the shape guard that replaced `data?.data?.[0]?.embedding`
// must report "no embedding" for every wrong shape, exactly as the old optional
// chain did.
{
  const badShapes: Array<[string, string]> = [
    ["not an object", `"nope"`],
    ["object with no data", `({})`],
    ["data is not an array", `({ data: "abc" })`],
    ["data is an empty array", `({ data: [] })`],
    ["first entry is not an object", `({ data: [1] })`],
    ["first entry has no embedding", `({ data: [{ nope: 1 }] })`],
    ["embedding is not an array", `({ data: [{ embedding: "x" }] })`],
  ]
  for (const [label, json] of badShapes) {
    const res = runValidatorCase(`async () => ({ status: 200, json: async () => ${json}, text: async () => "" })`)
    check(`C: a 2xx body that is ${label} reports "no embedding"`,
      res.ok === false && res.message === "Provider returned no embedding. Check the base URL and model name.",
      JSON.stringify(res))
  }
  const good = runValidatorCase(`async () => ({ status: 200, json: async () => ({ data: [{ embedding: [1,2,3] }] }), text: async () => "" })`)
  check("C: a well-formed body still returns the vector dimension",
    good.ok === true && good.message === "200", JSON.stringify(good))
}

// The soft-pass branch, which the m30 gate also pins on source text.
{
  const soft = runValidatorCase(`async () => ({ status: 429, json: async () => ({}), text: async () => "" })`)
  check("C: a 429 still soft-passes (index-time backoff owns it)", soft.ok === true && soft.name === "result", JSON.stringify(soft))
  const server5xx = runValidatorCase(`async () => ({ status: 503, json: async () => ({}), text: async () => "" })`)
  check("C: a 5xx still soft-passes", server5xx.ok === true && server5xx.name === "result", JSON.stringify(server5xx))
}

// The skip path of the wizard needs no TTY and must still complete, with the
// save seam honoured under the key the source actually reads (`saveImpl`).
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-untyped-w-"))
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  try {
    const fixture = path.join(dir, "fixture.ts")
    writeFileSync(fixture, `
import { Readable } from "node:stream"
import { runSetupWizard } from ${JSON.stringify(WIZARD_ABS)}
async function main() {
  let captured: Record<string, unknown> | null = null
  try {
    const r = await runSetupWizard(
      { input: Readable.from(["4\\n"]), output: { write() {} } },
      { dataDir: ${JSON.stringify(dataDir)}, saveImpl: (partial) => { captured = partial; return "captured" } },
    )
    console.log("JSON:" + JSON.stringify({ resolved: r, captured }))
  } catch (e) {
    console.log("JSON:" + JSON.stringify({ threw: String((e as {message?:unknown})?.message ?? e) }))
  }
}
main()
`)
    const out = execFileSync(
      process.execPath,
      ["--import", path.join(ROOT, "node_modules/tsx/dist/loader.mjs"), fixture],
      { cwd: ROOT, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
    )
    const line = out.split("\n").find((l) => l.startsWith("JSON:"))
    const j = line ? JSON.parse(line.slice(5)) as Record<string, any> : {}
    check("C: the wizard's skip path resolves with reason=user-skipped",
      j?.resolved?.reason === "user-skipped" && j?.resolved?.saved === false, JSON.stringify(j).slice(0, 200))
    check("C: the saveImpl seam is honoured (skip marker captured)",
      j?.captured?.setup_skipped === true, JSON.stringify(j?.captured))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── verdict + evidence ─────────────────────────────────────────────────────
const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
if (!ok) console.log("VERDICT: FAIL")
else console.log("VERDICT: PASS")

let currentCommit = "unknown"
try {
  currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}
mkdirSync(RESULTS_DIR, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify({
  issue: "UNTYPED",
  code: "UNTYPED",
  status: ok ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  negativeCases: 0,
  files: FILES,
  currentCommit,
  verifierCommand: "npx tsx script/verify-untyped-index-path.ts",
  evidenceFile: "UNTYPED.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "The key-entry path of runSetupWizard needs a real TTY and is NOT covered behaviourally here: readline puts a non-terminal stream into flowing mode and drains it before hiddenQuestion can attach its keypress listener, so a scripted stream never delivers a keystroke. This environment's `script` is BSD's and has no -qec to allocate a pty — the same reason script/m30/verify-first-run-hook.ts fails at the base commit. The null-guard added to that path is therefore covered by the type system and by review, not by an assertion in this gate.",
    "cross-language-intelligence.ts reconstructs taint `flowPath` as string[] while TaintFlow.flowPath declares DataFlowStep[]. The declared type does not match the stored shape; nothing reads the field, so it is documented rather than fixed. Correcting it means changing either the stored format or the interface.",
    "The drizzle type on the persister's 11 internal `db` parameters is the bun flavour (BunSQLiteDatabase) while the process may run the node build on better-sqlite3. The value arrives from BrainDatabase.getInstance(), typed Promise<any>, so nothing is rejected either way. Exporting the real drizzle instance type from the #db module would make it exact; that file is out of scope.",
    "No mutant is planted here. The two defects this gate guards are a type-level absence (proved by the teeth check, which self-demonstrates) and behaviour-preservation of the catch narrowing (proved by asserting the exact pre-fix output for every thrown shape). A mutation that the C checks could catch would have to change behaviour that was already correct.",
    "This gate proves the directive is gone and that the restored types catch errors. It does not re-run tsc over the whole project; `tsc --noEmit` is the authoritative whole-tree check.",
  ],
}, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
process.exit(ok ? 0 : 1)