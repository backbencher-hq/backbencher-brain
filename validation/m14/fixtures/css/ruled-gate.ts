/**
 * PROOF RUNNER for `script/m14/css-ruled.ts` — runs the shared arbiter against this
 * lane's ruling table WITHOUT editing the shared file.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned (lane brief §8) and its
 * `RULED_BY_LANG` is a literal, so the table in `script/m14/css-ruled.ts` cannot be
 * exercised by running the gate. A table that has never been run is a claim, and this
 * runner is the difference between the two: it copies the gate to /tmp, applies
 * EXACTLY the two lines the supervisor's permanent change needs, and runs the copy.
 * Every patch is PRINTED and a patch that does not apply is a hard exit 2 — so the
 * change can be applied by hand without re-deriving it, and a drifted gate cannot
 * quietly leave this runner testing a two-week-old copy of itself.
 *
 * ## What changed when the registration landed
 *
 * The two lines are now in `script/m14/ontology-coverage-gate.ts`. This runner still
 * exists and still has a job, but the job is no longer "substitute the wiring so the
 * table can be tested at all" — it is "keep testing the wiring", because a patch list
 * that has been applied once and then quietly stopped matching is how a two-week-old
 * copy of a gate survives as a green check.
 *
 * So each patch is now satisfied by either shape (see the `alreadyApplied` field), and
 * the run header states which shape the shared gate was in. When all patches are
 * already present this runner measures the shared gate's OWN text: same corpus
 * admission, same `observed` loop, same verdict logic, plus the mechanical /tmp
 * rewrites that running from outside the repo requires and that are listed by name.
 * That is a stronger run than the original, and it is now the default one.
 *
 * ## Why there is no third patch here, when toml's runner needs one
 *
 * toml's runner redirects `specPath` at a temp spec, because toml's own completeness
 * spec writes its rulings in a `ruling` field while the gate reads `resolution`. CSS
 * does not need it: `rulingFor()` checks the TABLE FIRST (that is the branch the gate's
 * own comment added for exactly this case), so a `CSS_RULED` entry is returned before
 * the spec is ever opened. Two fewer patches is a fact about the gate's control flow,
 * not a simplification, and it is recorded because "we did not need patch 3" reads as
 * an omission until you know which branch answers first.
 *
 * ## What it prints
 *
 * The gate's own output and exit code, plus `CSS_TABLE_EXAMINED` so each ruled row can
 * be seen to have examined the corpus rather than to be a probe that cannot fire. A
 * probe that returns 0 because it cannot return non-zero is the failure this whole
 * instrument exists to catch: `css-ontology-probe.ts`'s own header records the first
 * version of an earlier probe hitting exactly that, where every "files" column read 1
 * regardless of the truth because a `Set` was given the literal `1`.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/css/ruled-gate.ts
 *   BB_CSS_RULED_WORKERS=2 npx tsx validation/m14/fixtures/css/ruled-gate.ts   # lighter
 *
 * ## READ-ONLY
 *
 * Writes only under `/tmp/opencode/css-ruled-proof`. The shared gate is never touched.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as path from "node:path"
import { CSS_OVERRIDES_EXAMINED, CSS_RULED } from "../../../../script/m14/css-ruled"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const TABLE = path.join(ROOT, "script/m14/css-ruled.ts")
const OUT_DIR = "/tmp/opencode/css-ruled-proof"

{
  // The copy runs from /tmp, where there is no package.json saying `type: module`, so
  // tsx would compile it as CommonJS and reject the gate's top-level await.
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path.join(OUT_DIR, "package.json"), JSON.stringify({ type: "module" }))
}

// ---------------------------------------------------------------- patch the COPY

const original = readFileSync(GATE, "utf8")
//
// Each patch carries THREE strings, and the third is the one that was added when the
// registration landed in the shared gate.
//
// Originally this runner had two: a `find` and a `replace`, and it exited 2 when
// `find` was absent. That was correct while the gate did NOT register css — the
// absence was the thing being tested. It stops being correct the moment the gate DOES
// register css, because then `find` is legitimately gone and the runner fails on a
// success, which is the worst way for a checker to be wrong: it reports a defect and
// the defect is that the repair happened.
//
// So a patch is now satisfied by EITHER shape: `alreadyApplied` means the shared gate
// already carries the wiring in its own relative form, and `replace` means it does not
// and the copy needs it. Both print. Neither is silent, and neither is inferred — the
// strings are literal and are printed on the way out, so a reader can see which shape
// the shared gate is currently in without opening it.
//
const patches: { find: string; replace: string; alreadyApplied: string; note: string }[] = [
  {
    // Both forms are RELATIVE, deliberately. The first version of patch 1 rewrote the
    // `differential` import to an absolute path in the same breath as adding the table,
    // which coupled two unrelated concerns and then broke on the `alreadyApplied` path:
    // that path skips patch 1, so the `differential` import was never rewritten and the
    // copy died with ERR_MODULE_NOT_FOUND on `/differential` — after doing nothing else.
    // Every import the copy needs is now handled in ONE place, the `mechanical` list
    // below, and a patch only ever adds the wiring.
    find: 'import { LANGS } from "./differential"',
    replace: 'import { LANGS } from "./differential"\nimport { CSS_RULED } from "./css-ruled"',
    alreadyApplied: 'import { CSS_RULED } from "./css-ruled"',
    note: "patch 1 — the table",
  },
  {
    find: "const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED, fsharp: FSHARP_RULED }",
    replace: "const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED, fsharp: FSHARP_RULED, css: CSS_RULED }",
    alreadyApplied: "fsharp: FSHARP_RULED, css: CSS_RULED }",
    note: "patch 2 — the map entry",
  },
]

let patched = original
const appliedNow: string[] = []
const alreadyThere: string[] = []
for (const p of patches) {
  if (patched.includes(p.alreadyApplied)) {
    alreadyThere.push(p.note)
    continue
  }
  if (!patched.includes(p.find)) {
    console.error(`css ruled-gate: PATCH DID NOT APPLY — ${p.note}\n  looking for: ${p.find}`)
    console.error("  The shared gate has changed shape in a way this runner does not recognise, and it does")
    console.error("  NOT already carry: " + p.alreadyApplied)
    console.error("  Re-derive the wiring from the gate's current text; do not relax either match, because a")
    console.error("  relaxed match is a runner that stops testing it.")
    process.exit(2)
  }
  patched = patched.replace(p.find, p.replace)
  appliedNow.push(p.note)
}

// The copy lives outside the repo, so its relative imports must become absolute. That
// is a mechanical consequence of running from /tmp and not a change in what the gate
// measures; each rewrite is listed so a reader can see none of them touches the corpus
// admission, the `observed` loop, or the verdict logic.
const mechanical: [string, string, string][] = [
  ['from "../../src/ast/language-detection"', `from "${path.join(ROOT, "src/ast/language-detection")}"`, "language-detection"],
  ['from "../../src/ast/pool-worker"', `from "${path.join(ROOT, "src/ast/pool-worker")}"`, "pool-worker"],
  // `differential` is here rather than in patch 1 so that it is rewritten on BOTH paths.
  // It is 1.3 MB and the gate takes `LANGS` from it, so there is no way to run the copy
  // without resolving it.
  ['from "./differential"', `from "${path.join(ROOT, "script/m14/differential")}"`, "differential"],
  ['from "./lua-ruled"', `from "${path.join(ROOT, "script/m14/lua-ruled")}"`, "lua-ruled"],
  ['from "./toml-ruled"', `from "${path.join(ROOT, "script/m14/toml-ruled")}"`, "toml-ruled"],
  ['from "./fsharp-ruled"', `from "${path.join(ROOT, "script/m14/fsharp-ruled")}"`, "fsharp-ruled"],
  // Both patches write RELATIVE specifiers now, so this rewrite applies on the applied
  // path AND the alreadyApplied path alike. It is unconditional on purpose: a rewrite
  // list that changed shape with the branch would be a list that could skip a file on
  // one branch and look fine on the other.
  ['from "./css-ruled"', `from "${path.join(ROOT, "script/m14/css-ruled")}"`, "css-ruled"],
  // `web-tree-sitter` is loaded by a DYNAMIC import, which resolves from the importing
  // FILE. The copy is in /tmp, where there is no node_modules, so the run would die with
  // ERR_MODULE_NOT_FOUND — after the corpus admit and the whole `observed` phase, which
  // is where a first attempt at this ended. A DIRECTORY specifier is not a legal ES
  // module import, so the package's own resolved entry is named.
  ['await import("web-tree-sitter")', `await import(${JSON.stringify(path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.cjs"))})`, "web-tree-sitter"],
  // `process.cwd()` is the wasm root for both the core and the language wasm; the
  // runner is invoked from the repo root, so this needs no rewrite. It is asserted
  // rather than assumed, because a run from anywhere else would fail in a way that
  // reads like a parse failure.
]
for (const [find, replace, note] of mechanical) {
  if (!patched.includes(find)) {
    console.error(`css ruled-gate: MECHANICAL REWRITE DID NOT APPLY — ${note}\n  looking for: ${find}`)
    process.exit(2)
  }
  patched = patched.replace(find, replace)
}

const gateCopy = path.join(OUT_DIR, "ontology-coverage-gate.css.ts")
writeFileSync(gateCopy, patched)

// ---------------------------------------------------------------- what the table says

console.log(`css ruled-gate — the shared arbiter, run against this lane's table`)
console.log(`gate copy:   ${gateCopy}`)
console.log(`table:       ${TABLE}`)
console.log(`repo root:   ${ROOT}`)
console.log(``)
console.log(`WIRING OF THE SHARED GATE — what this run found, and what it did about it:`)
for (const p of patches) {
  const state = alreadyThere.includes(p.note) ? "ALREADY PRESENT in the shared gate" : "applied to this copy"
  console.log(`  // ${p.note} — ${state}`)
  console.log(`  ${p.replace.split("\n").join("\n  ")}`)
}
console.log(``)
console.log(`  applied by this runner: ${appliedNow.length}   already in the shared gate: ${alreadyThere.length}   of ${patches.length}`)
if (appliedNow.length === 0) {
  console.log(`  All ${patches.length} patches are already in script/m14/ontology-coverage-gate.ts, so this run measured the`)
  console.log(`  shared gate's OWN copy rather than a reconstruction of it. That is the stronger of the two runs.`)
}
console.log(``)
console.log(`MECHANICAL REWRITES APPLIED ONLY BECAUSE THE COPY LIVES IN /tmp (none touches the corpus admission,`)
console.log(`the observed loop, or the verdict logic): ${mechanical.map((m) => m[2]).join(", ")}`)
console.log(``)
console.log(`CSS_TABLE_EXAMINED — what each row can reach, so a row whose probe cannot fire is visible as such:`)
for (const r of CSS_RULED) {
  console.log(
    `  ${r.type.padEnd(13)} ${r.instrument.padEnd(22)} ${
      r.instrument === "A:grammar-inventory"
        ? `probes ${r.nodeTypesThatWouldMeanIt?.length ?? 0} node types`
        : `probes the tree${r.countOnTree ? "" : " — NO countOnTree, which would be an unjustified ruling"}`
    }`,
  )
}
console.log(`  overrides     EMITTED (no table entry — the gate takes the EMITTED branch): ${JSON.stringify(CSS_OVERRIDES_EXAMINED)}`)
console.log(``)

// ---------------------------------------------------------------- run it

const workers = process.env.BB_CSS_RULED_WORKERS ?? ""
let cmd = `npx tsx ${JSON.stringify(gateCopy)} css`
if (workers) cmd = `BB_PARSE_WORKERS=${workers} ${cmd}`
console.log(`$ ${cmd}`)
console.log(``)

let code = 0
let killedBy: string | null = null
let hangGuard = false
// `src/ast/engine.ts` arms a per-file 120 s self-destruct timer and calls
// `process.exit(1)` when it fires, because `parser.parse()` is synchronous WASM that a
// timer cannot interrupt. A corpus file that hangs therefore kills the whole census
// process — AFTER the verdict table has already printed — and the exit code says 1,
// which reads as a failed gate beside a table that says `FALSIFIED 0`. Observed on
// `hasura-engine/scripts/ekg/monitor.css`, which intermittently reports
// `memory access out of bounds` and then hangs. So stderr is captured rather than
// inherited, purely so this cause can be named instead of guessed at.
const emit = (e: any): void => {
  const errText = String(e?.stderr ?? "")
  process.stdout.write(String(e?.stdout ?? ""))
  if (errText) process.stderr.write(errText)
  hangGuard = errText.includes("[BB-HANG]")
}
try {
  const out = execFileSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
  process.stdout.write(out)
} catch (e: any) {
  // `status` is NULL when the child was killed by a SIGNAL, and null is not a
  // number, so the previous `typeof e?.status === "number" ? e.status : 1` reported a
  // signal death as `1` — indistinguishable from the gate genuinely exiting 1. Under
  // this project's documented ten-lane load that is not hypothetical. A signal death is
  // not a verdict at all, so it is named separately.
  if (typeof e?.status === "number") code = e.status
  else {
    killedBy = String(e?.signal ?? "unknown")
    code = 1
  }
  emit(e)
}
console.log(``)
if (hangGuard) {
  console.log(
    `gate exit code: ${code}  BUT NOT A VERDICT — the gate process was killed by parseFile's 120 s [BB-HANG] guard ` +
      `(src/ast/engine.ts), so the run was truncated. The table above is whatever had printed when the process died. Re-run it.`,
  )
} else if (killedBy) {
  console.log(
    `gate exit code: ${code}  BUT NOT A VERDICT — the gate process was killed by SIG${killedBy} before it could exit, ` +
      `so no verdict was reached. Re-run it; do not read the table above as a result.`,
  )
} else {
  console.log(`gate exit code: ${code}  (0 = no FALSIFIED and no RULED-UNJUSTIFIED row)`)
}
process.exit(code === 0 ? 0 : 1)
