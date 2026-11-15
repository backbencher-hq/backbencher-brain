/**
 * PAIRED RUNNER for `script/m14/incoming-check.ts` — measures what that shared
 * instrument's TYPE KEY hides, without editing it.
 *
 * ## The defect this exists to quantify
 *
 * `script/m14/incoming-check.ts` keys its per-type table on the literal
 * `"brain_import"`:
 *
 *     const TYPES = [ "calls", "uses", "contains", "brain_import", "references",
 *                     "exports", "extends", "implements", "overrides",
 *                     "instantiates" ] as const
 *
 * and line ~161 drops any label not in it:
 *
 *     const row = perType[label]; if (!row) continue
 *
 * This lane's analyzer emits the label `"imports"` — and `"imports"` is the
 * STORE's own spelling: `RelationshipType.Imports = "imports"`
 * (`src/ast/engine.ts:454`), `Imports = "imports"` (`src/ast/graph.ts:38`), and
 * the DB column values are `relationship_type IN ('imports','exports')`.
 * `brain_import` is a TABLE name, not a relationship label. So the row reads
 * `fired: false` with 0 edges for a class that fires.
 *
 * `script/m14/firing-check.ts:96-107` bridges both spellings through a
 * `LABEL_ALIASES` map; `incoming-check.ts` has no such bridge, so it drops
 * every import edge in every language that emits the store's own label.
 *
 * ## Why a paired run and not just a patch
 *
 * A patched run that prints 256 edges proves the patch works. It does NOT prove
 * the unpatched run was measuring the same thing — the two could differ in
 * something else, and a reader would have no way to tell which number is the
 * artifact of which. So this runner:
 *
 *   1. runs the SHARED instrument unmodified, and keeps its JSON;
 *   2. copies it to /tmp, applies EXACTLY the one token the fix needs, rewrites
 *      the copy's relative imports to absolute, runs it, and keeps its JSON;
 *   3. diffs the two per-type tables field by field and requires the delta to
 *      be confined to the imports row;
 *   4. re-measures the edge count itself, through production `parseFile`, over
 *      the same files, so the number the shared instrument would have reported
 *      is corroborated by a third path rather than by the patch alone.
 *
 * Step 4 matters: it is the difference between "the patch changed 0 to 256" and
 * "production emits 256 imports edges over these files, and the shared
 * instrument reported 0 of them." The first is a patch statistic.
 *
 * ## What this does NOT establish
 *
 * Both runs are the same script over the same 120 files, so they share every
 * other limitation pass 5 measured and did not fix: `projectPath` is
 * `path.dirname(files[0])` for every file (`incoming-check.ts:102`), and a path
 * containing a space is split into separate arguments by the shell, so zig's
 * `zig/test/cases/safety/@intFromFloat cannot fit/…` paths contribute ENOENT
 * fragments and those files are absent from both counts. The delta this runner
 * reports is therefore a LOWER bound on the class, measured on the files both
 * runs actually parsed.
 *
 * The shared file on disk is never modified. The patched copy lives outside the
 * repository and is never committed.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const SHARED = path.join(ROOT, "script/m14/incoming-check.ts")
const OUT_DIR = "/tmp/opencode/zig-lane/incoming-paired"
const PATCHED = path.join(OUT_DIR, "incoming-check.paired.ts")

const argv = process.argv.slice(2)

/**
 * `--files-from <manifest>` reads the population from a file, one path per line,
 * instead of from argv.
 *
 * This exists because the published 253-edge figure was produced by passing the
 * draw through a SHELL, and Zig's corpus contains paths with spaces in them
 * (`zig/test/cases/safety/@intFromFloat cannot fit/…`). The shell split those
 * into two argv entries, each of which is ENOENT, so the run received 134
 * arguments for a 120-file manifest and silently dropped the space-bearing
 * files. Both arms dropped the same ones, so the PAIRED COMPARISON stayed valid
 * and the delta stayed correct — but the ABSOLUTE count was a lower bound over an
 * unstated subset, and the population was not re-derivable from the repository,
 * because the manifest was never committed.
 *
 * `execFileSync` does not go through a shell, so reading the manifest here and
 * handing the paths over as argv elements makes the split structurally
 * impossible. The manifest itself is committed next to this file, so the number
 * is re-derivable from the command line alone.
 */
let lang = "zig"
let files: string[] = []
let fromManifest = false
{
  const rest = argv[0] === "--files-from" ? argv.slice(1) : [argv[0] ?? "zig", ...argv.slice(1)]
  lang = rest[1] ?? "zig"
  if (argv[0] === "--files-from") {
    const manifest = rest[0]
    if (!manifest) {
      console.error("--files-from needs a manifest path")
      process.exit(2)
    }
    fromManifest = true
    files = readFileSync(manifest, "utf8")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith("#"))
      .map(l =>
        path.isAbsolute(l)
          ? l
          : path.join(process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories", l),
      )
  } else {
    files = rest.slice(1)
  }
}

if (files.length === 0) {
  console.error(
    "usage: npx tsx validation/m14/fixtures/zig/incoming-check-paired.ts <lang> <file> [<file> ...]\n" +
      "       npx tsx validation/m14/fixtures/zig/incoming-check-paired.ts --files-from <manifest> [<lang>]",
  )
  process.exit(2)
}

function runScript(scriptPath: string, label: string): any {
  const args = [scriptPath, "--json", lang, ...files]
  const out = execFileSync("npx", ["tsx", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const parsed = JSON.parse(out)
  console.log(
    `  ${label}: symbols ${parsed.symbols}, degraded ${parsed.degraded}, ` +
      `parseFailures ${parsed.parseFailures.length}, ` +
      `distinctIncomingTargets ${parsed.distinctIncomingTargets}, ` +
      `orphanDeclarations ${parsed.orphanDeclarations} of ${parsed.symbols} ` +
      `(${(parsed.orphanRate * 100).toFixed(2)}%)`,
  )
  return parsed
}

console.log(`incoming-check-paired: ${lang}, ${files.length} files`)
{
  // The number that decides whether an ABSOLUTE figure is a total or a lower
  // bound. `execFileSync` hands these to the child as argv elements and never
  // goes through a shell, so a space-bearing path arrives intact either way —
  // the risk is only in how THIS list was built. A manifest is safe by
  // construction; an argv list is safe only if the caller's shell did not
  // re-split it, which is exactly what silently truncated the published 253.
  const spaced = files.filter(f => /\s/.test(f))
  const total = spaced.length === 0 || fromManifest
  console.log(
    `  population: ${files.length} files (${fromManifest ? "from a manifest, no shell in the path" : "from argv"}), ` +
      `${spaced.length} carrying a space in the path — absolute counts below are ${total ? "TOTALS" : "LOWER BOUNDS"}`,
  )
  if (!total) {
    console.log(`  WARNING: ${spaced.length} space-bearing path(s) came through a shell argv and may have split.`)
    for (const f of spaced.slice(0, 3)) console.log(`    ${f}`)
  }
}
console.log("")

// ---------------------------------------------------------------- 1. SHARED
console.log("== A. the SHARED instrument, unmodified ==")
const shared = runScript(SHARED, "shared  ")

// ------------------------------------------------------------- 2. THE PATCH
mkdirSync(OUT_DIR, { recursive: true })
let patched = readFileSync(SHARED, "utf8")

const typeArray = `const TYPES = [
  "calls",
  "uses",
  "contains",
  "brain_import",`
const typeArrayFixed = `const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",`
if (!patched.includes(typeArray)) {
  console.error(
    "incoming-check-paired: PATCH DID NOT APPLY — `script/m14/incoming-check.ts`'s `TYPES` literal is gone or has moved.",
  )
  process.exit(2)
}
patched = patched.replace(typeArray, typeArrayFixed)

patched = patched
  .replace(
    'from "../../src/ast/pool-worker"',
    `from ${JSON.stringify(path.join(ROOT, "src/ast/pool-worker"))}`,
  )
  .replace(
    'await import("web-tree-sitter")',
    `await import(${JSON.stringify(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.cjs"))})`,
  )

writeFileSync(path.join(OUT_DIR, "package.json"), JSON.stringify({ type: "module" }))
writeFileSync(PATCHED, patched)
console.log("")
console.log("== B. the same file, with the one token the fix needs ==")
console.log(`  shared file on disk: UNTOUCHED — ${path.relative(ROOT, SHARED)}`)
console.log(`  patched copy:        ${PATCHED}`)
console.log(`  the only edit:       "brain_import" -> "imports" in the TYPES literal`)
console.log("")
const fixed = runScript(PATCHED, "patched ")

// --------------------------------------------------- 3. THE FIELD-BY-FIELD DIFF
console.log("")
console.log("== C. field-by-field diff, per type ==")
const KEYS = ["fired", "edges", "targetsDistinct", "ambiguousTargets", "unresolvedTargets", "selfLoops"]
const sharedOnly = Object.keys(shared.perType).filter((t) => !(t in fixed.perType))
const fixedOnly = Object.keys(fixed.perType).filter((t) => !(t in shared.perType))
const diffs: string[] = []

for (const t of Object.keys(shared.perType)) {
  if (!(t in fixed.perType)) continue
  for (const k of KEYS) {
    const a = (shared.perType[t] as any)[k]
    const b = (fixed.perType[t] as any)[k]
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push(`DIFF: ${t}.${k}: shared ${JSON.stringify(a)} vs patched ${JSON.stringify(b)}`)
      console.log(`  DIFF ${t}.${k}: shared ${JSON.stringify(a)} -> patched ${JSON.stringify(b)}`)
    }
  }
}
console.log("")
console.log(
  `  rows only in shared:  ${sharedOnly.length ? sharedOnly.join(", ") : "(none)"}`,
)
console.log(
  `  rows only in patched: ${fixedOnly.length ? fixedOnly.join(", ") : "(none)"}`,
)

// The whole point: the delta must be CONFINED to the two rows that spell the
// import class, or this runner is measuring something other than the key.
const EXPECTED_DELTA_ROWS = new Set(["imports", "brain_import"])
const unexpected = [...diffs]
  .map((d) => d.split(".")[0].replace("DIFF: ", ""))
  .filter((t) => !EXPECTED_DELTA_ROWS.has(t))
console.log("")
console.log(
  `  ${diffs.length} differing fields, confined to the import rows: ${unexpected.length === 0 ? "YES" : "NO — " + [...new Set(unexpected)].join(", ")}`,
)

const sharedImports = shared.perType["brain_import"]
const fixedImports = fixed.perType["imports"]
console.log(
  `  imports row: shared reports ${JSON.stringify(sharedImports)}; patched reports ${JSON.stringify(fixedImports)}`,
)

// ------------------------------------------------ 4. INDEPENDENT CORROBORATION
console.log("")
console.log("== D. the number production emits, through parseFile, third path ==")
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
let prodImports = 0
let prodTotal = 0
let degraded = 0
let parsed = 0
for (const f of files) {
  let res: any
  try {
    res = await parseFile(f)
  } catch {
    continue
  }
  if (res?.fallback) {
    degraded++
    continue
  }
  parsed++
  for (const r of res?.relationships ?? []) {
    prodTotal++
    if (r.type === "imports") prodImports++
  }
}
console.log(
  `  parseFile over the same ${files.length} arguments: ${parsed} parsed, ${degraded} degraded, ${prodTotal} relationships, ${prodImports} of type "imports"`,
)
console.log(
  `  shared instrument reported ${(sharedImports?.edges ?? 0)}; patched reported ${(fixedImports?.edges ?? 0)}; production emits ${prodImports}`,
)

// A file can degrade, so equality with the patched count is the right claim and
// equality with the raw production count is not: the instrument drops degraded
// files and so do I above.
const agree = prodImports === (fixedImports?.edges ?? 0)
console.log(
  `  patched == production: ${agree ? "YES" : "NO"}`,
)

console.log("")
console.log("== VERDICT ==")
if (unexpected.length > 0) {
  console.log("  -> FAIL: the patch changed rows beyond the import class, so it is not a key-only change.")
  process.exit(2)
}
if (!agree) {
  console.log("  -> FAIL: the patched instrument and production `parseFile` disagree on the imports count.")
  process.exit(2)
}
if (!(sharedImports?.edges === 0)) {
  console.log(
    `  -> FAIL: the shared instrument reports ${sharedImports?.edges} edges for the import row, so this runner is not measuring the defect it documents.`,
  )
  process.exit(2)
}
console.log(
  `  -> PASS: the shared instrument reports 0 imports edges and production emits ${prodImports} over the same files.`,
)
console.log(
  `     The patch is one token, confined to the import rows, and reproduces the production count.`,
)
process.exit(0)