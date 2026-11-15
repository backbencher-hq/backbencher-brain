/**
 * PROOF RUNNER for `script/m14/php-ruled.ts` — runs the shared arbiter against this
 * lane's ruling table WITHOUT editing the shared file.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned (lane brief §8) and its
 * `RULED_BY_LANG` is a literal, so the table in `script/m14/php-ruled.ts` cannot be
 * exercised by running the gate. A table that has never been run is a claim. This
 * runner copies the gate to /tmp, applies EXACTLY the two lines the supervisor's
 * permanent change needs, and runs the copy. Both patches are printed, so the change
 * can be applied by hand without re-deriving it.
 *
 * ## WHY THERE IS NO PATCH 3 HERE, WHEN THE TOML LANE NEEDED ONE
 *
 * The toml runner has to repoint `specPath` at a temp spec, because `rulingFor()`
 * reads `dec.resolution` and toml's spec writes `ruling` and carries no ontology
 * decision — so the gate would report toml's ruled rows as RULED-UNJUSTIFIED, a
 * verdict about the SPEC rather than about the table.
 *
 * PHP does not need it, and the reason is a property of `rulingFor()` worth having
 * written down: the function checks `RULED.find(r => r.type === t)` FIRST and returns
 * from the table, and only falls through to the spec when the table has no row. With
 * `exports` in `PHP_RULED` — the only type php does not emit — the spec is never
 * consulted for a ruled row.
 *
 * That is not a lucky accident, and the lane checked it rather than assuming it:
 * simulating the gate's own predicate against PHP's REAL spec returns `null` for
 * `exports`, because PHPD33's body mentions the type but matches neither half of the
 * gate's second test (`/ontology|emits|excluded|type/i`). So without this table the
 * row would read RULED-UNJUSTIFIED. The finding is exported from the table as
 * `PHP_RULING_FOR_SPEC_GAP` and printed below, and it is a REPORT item for the owner
 * (amend PHPD33's `resolution` in `script/m14/spec/php-completeness.json` and
 * regenerate `validation/m14/results/M14.0.SPEC*.json`) — not a lane edit.
 *
 * ## What it prints
 *
 * The gate's own output and exit code, plus `PHP_EXPORTS_EXAMINED` so the `exports`
 * row can be seen to have swept the corpus rather than to be a probe that cannot
 * fire. The counters are cumulative across every corpus file the gate parses, so they
 * are a census in their own right: the unqualified/qualified `use function` split and
 * the alias/define counts are the same populations `exports-probe.mts` measures.
 *
 *   npx tsx validation/m14/fixtures/php/ruled-gate.ts
 *
 *   BB_PHP_RULED_WORKERS=2   narrow the corpus fan-out (the gate hardcodes 8, and
 *                            this box runs lanes concurrently)
 *   BB_PHP_RULED_SKIP_GATE=1 write the patched copy and stop, so the run can be
 *                            repeated directly against the copy
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { PHP_FALSIFIED_RULINGS, PHP_RULED, PHP_RULING_FOR_SPEC_GAP } from "../../../../script/m14/php-ruled"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const TABLE = path.join(ROOT, "script/m14/php-ruled.ts")
const OUT_DIR = "/tmp/opencode/php-ruled-proof"

{
  // The copy runs from /tmp, where there is no package.json saying `type: module`, so
  // tsx would compile it as CommonJS and reject the gate's top-level await.
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path.join(OUT_DIR, "package.json"), JSON.stringify({ type: "module" }))
}

// ---------------------------------------------------------------- patch the COPY

const original = readFileSync(GATE, "utf8")
const patches: { find: string; replace: string; note: string }[] = [
  {
    find: 'import { LANGS } from "./differential"',
    replace: `import { LANGS } from "${path.join(ROOT, "script/m14/differential")}"\nimport { PHP_RULED } from "${TABLE}"`,
    note: "patch 1 — the table",
  },
  {
    // ANCHOR REPAIRED 2026-10-07, and the repair is the second half of a lesson this repo keeps
    // relearning. The old `find` was the inline prefix `... = { bash: BASH_RULED, json:
    // JSON_RULED`, justified in this very comment as surviving "the supervisor adding a lane
    // between this commit and the wiring landing". It survives THAT and nothing else: the object
    // was later reformatted to ONE KEY PER LINE, so the inline form exists in neither the working
    // tree nor HEAD, this runner exited 2 with `PATCH DID NOT APPLY — patch 2`, and the php ruling
    // table has never been proof-run by its own gate. A patch anchored to a FORMATTING choice is
    // the same defect as a fixture anchored to a name that stops matching — the failure the
    // swift lane recorded when a hardcoded mutant string silently stopped hitting. The anchor is
    // now the DECLARATION LINE alone, which no lane addition, key reorder or reformat can break;
    // the inserted line is the same one the old patch inserted, php FIRST for the reason stated.
    find: "const RULED_BY_LANG: Record<string, Ruled[]> = {",
    replace: "const RULED_BY_LANG: Record<string, Ruled[]> = {\n  php: PHP_RULED,",
    note: "patch 2 — the map entry (php inserted FIRST so a future `php` key cannot shadow it; the rest of the object is left as-is)",
  },
]

let patched = original
for (const p of patches) {
  if (!patched.includes(p.find)) {
    console.error(`ruled-gate: PATCH DID NOT APPLY — ${p.note}\n  looking for: ${p.find}`)
    process.exit(2)
  }
  patched = patched.replace(p.find, p.replace)
}

// The copy lives outside the repo, so its relative imports must become absolute, and
// its dynamic `import("web-tree-sitter")` has to name the package's own resolved entry
// (a bare specifier would look for /tmp's node_modules). Those are mechanical
// consequences of running from /tmp and change nothing about what the gate measures.
//
// GENERALISED, because the hand-listed version was stale: it rewrote exactly two `src/`
// imports, and when the gate gained `./lua-ruled` and `./toml-ruled` the copy stopped
// resolving them and died with ERR_MODULE_NOT_FOUND on the first run. A patch list that
// must be updated when an unrelated lane lands is a patch list that will be wrong again, so
// every relative specifier in the copy is rewritten to an absolute path by shape instead:
// `./x` inside the gate always means a sibling of script/m14/, and `../../src/x` always the
// repo's src/.
const absSibling = (name: string): string => path.join(ROOT, "script/m14", name)
patched = patched
  // `path.resolve(dirname(GATE), p)`, NOT `path.join(ROOT, p)`: the specifier is relative
  // to the GATE's directory, and joining it onto the repo root walks two levels ABOVE the
  // worktree — which resolved to /home/ishaq2321/mcp/src/... and failed to load.
  .replace(/from "(\.\.\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(path.resolve(path.dirname(GATE), p))}`)
  .replace(/from "\.\/([^"]+)"/g, (_m, name: string) => `from ${JSON.stringify(absSibling(name))}`)
  .replace(/await import\("web-tree-sitter"\)/g, `await import(${JSON.stringify(path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.cjs"))})`)

// Optional patch 3, applied ONLY when BB_PHP_RULED_WORKERS is set. The gate admits the
// corpus through 8 concurrent `parseFile` calls; this box runs lanes concurrently, so
// the patch narrows the fan-out and changes nothing else — same admitted set, same
// instrument, same verdicts, same exit code.
const WORKERS = process.env.BB_PHP_RULED_WORKERS
if (WORKERS) {
  const find = "Array.from({ length: 8 }, () => worker())"
  if (!patched.includes(find)) {
    console.error("ruled-gate: worker patch did not apply")
    process.exit(2)
  }
  patched = patched.replace(find, `Array.from({ length: ${Number(WORKERS)} }, () => worker())`)
  patches.push({ find, replace: `Array.from({ length: ${Number(WORKERS)} }, () => worker())`, note: "patch 3 — corpus fan-out (BB_PHP_RULED_WORKERS)" })
  console.log("")
  console.log("ruled-gate: fan-out patch applied (BB_PHP_RULED_WORKERS)")
}

// ---------------------------------------------------------------- patch 4: trap the stale self-destruct
//
// This is the patch that makes the gate RUN AT ALL for php, and it applies to the COPY.
//
// `src/ast/engine.ts:1441-1447` arms a 120s wall-clock self-destruct around the
// SYNCHRONOUS `parser.parse()` and clears it on the next line — but NOT in a `finally`. So
// when `parser.parse()` THROWS, the timer stays armed and fires 120 seconds later, calling
// `process.exit(1)` on a run that has long since moved on. Measured on this lane's corpus: a
// file whose parse throws a wasm "memory access out of bounds" is served by pool-worker's
// catch (`extractFallback`, a REGEX extractor), and its stale timer then kills the process at
// an arbitrary later moment. The file differs on every run —
// phpunit/src/Event/Events/TestSuite/Loaded.php, phpunit/tools/.phpstan/vendor/webmozart/
// assert/src/Assert.php, phpunit/tests/unit/Framework/Constraint/Math/IsNanTest.php,
// phpunit/tools/.phpstan/vendor/tomasvotruba/type-coverage/src/Formatter/
// TypeCoverageFormatter.php — so it is a heap/timing-dependent wasm fault, not one bad file.
//
// A copy of the GATE cannot fix it: the timer lives in `src/ast/engine.ts`, which the copy
// only imports. So the copy traps `process.exit` instead and says so, loudly, once per trap.
// WITHOUT this patch the copy died at ~636s with
// `[BB-HANG] parser stuck 120s on .../TestSuite/Loaded.php - exiting` and printed NO verdict
// rows at all.
//
// WHAT THIS DOES NOT DO: it does not make the real gate work. On the real gate php still
// cannot complete a corpus walk, and the copy's exit code is not evidence about the real
// gate's. The fix belongs in engine.ts — `try { tree = parser.parse(content) } finally {
// clearTimeout(parseBomb) }` — and is REPORTED (workstream §8), not applied here. A
// recommended patch that has never been executed is a guess; this is the same change,
// executed, in the only place this lane is allowed to execute it.
//
// Disable with BB_PHP_RULED_NO_TIMER_PATCH=1 to reproduce the unpatched failure.
const TIMER_PATCH = process.env.BB_PHP_RULED_NO_TIMER_PATCH !== "1"
if (TIMER_PATCH) {
  const trap = [
    "const __bbRealExit = process.exit.bind(process)",
    "let __bbTrappedExits = 0",
    "process.exit = ((code?: number) => {",
    "  __bbTrappedExits++",
    "  process.stderr.write(`[ruled-gate] TRAPPED process.exit(${code}) — a stale 120s parseBomb timer, armed by a file whose parse THREW and never cleared (src/ast/engine.ts:1441-1447, no finally). The walk CONTINUES. The real gate exits here and prints no rows.\\n`)",
    "  return undefined as never",
    "}) as any",
    "process.on('exit', () => { if (__bbTrappedExits) process.stderr.write(`[ruled-gate] ${__bbTrappedExits} process.exit call(s) trapped during this run\\n`) })",
  ].join("\n")
  patched = `${trap}\n${patched}`
  patches.push({ find: "(top of file)", replace: "process.exit trapped, with a count printed on exit", note: "patch 4 — trap the stale-parseBomb process.exit so the copy survives; the copy cannot fix engine.ts" })
  console.log("")
  console.log("ruled-gate: process.exit trap applied to the COPY (see the note above)")
}

const GATE_COPY = path.join(OUT_DIR, "ontology-coverage-gate.php-proof.ts")
writeFileSync(GATE_COPY, patched)

console.log("ruled-gate: patches applied to a COPY of script/m14/ontology-coverage-gate.ts")
for (const p of patches) {
  console.log(`  ${p.note}`)
  console.log(`    - ${p.find.length > 96 ? `${p.find.slice(0, 96)}…` : p.find}`)
  console.log(`    + ${p.replace.length > 96 ? `${p.replace.slice(0, 96)}…` : p.replace}`)
}
console.log("  (plus: EVERY relative specifier in the copy rewritten to an absolute path — src/ imports, sibling imports, and the dynamic web-tree-sitter import — because the copy runs from /tmp)")
console.log("  NO specPath patch is needed — rulingFor() checks the table first, and `exports` is php's only un-emitted type. See the header.")
console.log(`  shared file on disk: UNTOUCHED — ${path.relative(ROOT, GATE)}`)
console.log("")
console.log(`  table rows: ${PHP_RULED.length}${PHP_RULED.length ? ` (${PHP_RULED.map((r) => r.type).join(", ")})` : " — EMPTY, and that is the finding: the one row it held was falsified, and a row for an EMITTED type is a false claim"}`)
console.log("")

// ---------------------------------------------------------------- run it

const SKIP_GATE = process.env.BB_PHP_RULED_SKIP_GATE === "1"
if (SKIP_GATE) {
  console.log(`BB_PHP_RULED_SKIP_GATE=1 — patched copy written, gate NOT run.`)
  console.log(`  run it with: npx tsx ${GATE_COPY} php`)
  console.log("")
} else {
  const started = Date.now()
  let out = ""
  let code = 0
  try {
    out = execFileSync("npx", ["tsx", GATE_COPY, "php"], { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  } catch (err: any) {
    out = String(err.stdout ?? "") + String(err.stderr ?? "")
    code = typeof err.status === "number" ? err.status : 1
  }
  process.stdout.write(out)
  console.log("")
  console.log(`exit code ${code}  (${((Date.now() - started) / 1000).toFixed(0)}s)`)
}

console.log("")
console.log("== PHP_FALSIFIED_RULINGS — the ruling this lane withdrew, with its numbers ==")
for (const f of PHP_FALSIFIED_RULINGS) {
  console.log(`  ${f.type}  (${f.instrument})`)
  console.log(`    ruled on        ${f.ruledOn}`)
  console.log(`    falsified by    ${f.falsifiedBy}`)
  console.log(`    outcome         ${f.outcome}`)
  console.log(`    measured after  ${JSON.stringify(f.measuredAfterFix)}`)
  console.log(`    artifacts       ${f.artifact.join(", ")}`)
}
console.log("")
console.log("== PHP_RULING_FOR_SPEC_GAP — reported to the owner, not edited here ==")
console.log(`  spec     ${PHP_RULING_FOR_SPEC_GAP.spec}`)
console.log(`  decision ${PHP_RULING_FOR_SPEC_GAP.decision}   rulingFor("exports") returns ${PHP_RULING_FOR_SPEC_GAP.rulingForReturns}`)
console.log(`  why      ${PHP_RULING_FOR_SPEC_GAP.reason}`)