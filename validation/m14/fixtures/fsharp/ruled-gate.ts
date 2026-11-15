/**
 * PROOF RUNNER for `script/m14/fsharp-ruled.ts` — runs the SHARED arbiter against this
 * lane's ruling table, without editing the shared file.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned (lane brief §8) and its
 * `RULED_BY_LANG` is a literal with no extension point, so run against `fsharp` it
 * refuses to report at all:
 *
 *   ontology coverage gate — no RULING TABLE for fsharp.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   exit 2
 *
 * That refusal is correct behaviour and it is also why this lane's one RULED verdict has
 * never been adjudicated. A table that has never been run is a claim. This runner is the
 * difference between the two: it copies the gate to /tmp, applies EXACTLY the lines the
 * supervisor's permanent change needs, prints them so the change can be applied by hand
 * without re-deriving it, and runs the copy. The arbiter on disk is never modified and the
 * patched copy is never committed.
 *
 * ## IT ALSO CHECKS THE TABLE'S SHAPE AGAINST THE GATE'S OWN
 *
 * `script/m14/fsharp-ruled.ts` restates the gate's `Ruled` type rather than importing it,
 * because the gate is a top-level-await SCRIPT that exports nothing to import from. A type
 * restated from another file can drift, and a table typed against a stale copy is a table
 * the gate cannot use — the failure would surface as a gate run that prints nothing useful,
 * long after the mistake was made. So this runner RE-READS the gate's own `type Ruled`
 * block, extracts its field names and optionality, and EXITS 2 on any divergence. That
 * check runs whether or not the gate run is skipped.
 *
 * ## WHAT THE RUN IS EXPECTED TO PRINT, AND WHY
 *
 * Nine of the ten types are EMITTED by production `parseFile` on this corpus, and the
 * gate's verdict loop checks EMITTED FIRST — so those nine rows are reported EMITTED with
 * the gate's own counts, over the WHOLE admitted population and not this lane's 400-file
 * draw. The tenth row, `exports`, is the only one the table speaks for, and the gate
 * re-measures it two ways before accepting the ruling:
 *
 *   instrument A — it builds the grammar's own node-type inventory across every admitted
 *                  file and checks whether any of the six node types the table names is
 *                  PRESENT. A hit prints FALSIFIED and fails the gate.
 *   rulingFor()  — the table's `describe` is read as the written reason.
 *
 * So a RULED-SOUND row here is the arbiter's verdict, reached over the full population,
 * and not this lane restating its own note.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/fsharp/ruled-gate.ts
 *   BB_FSHARP_RULED_SKIP_GATE=1 npx tsx …   # write the patched copy, do not run it
 *   BB_FSHARP_RULED_WORKERS=2 npx tsx …      # corpus fan-out; see the OOM note below
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { FSHARP_EXPORT_NODE_TYPES_THAT_WOULD_MEAN_IT, FSHARP_RULED } from "../../../../script/m14/fsharp-ruled"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const TABLE = path.join(ROOT, "script/m14/fsharp-ruled.ts")
const OUT_DIR = "/tmp/opencode/fsharp-ruled-proof"

// ---------------------------------------------------------------- shape check
//
// The gate's `type Ruled` block, read as source text and walked by brace depth. No
// pattern-matching over the corpus anywhere in this file; this is code introspection of a
// TypeScript declaration, and it is deliberately a LINE walk rather than a regex so a
// reformatted field cannot silently stop being compared.

/** `true` when a token is the identifier a field declaration starts with. */
function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$"
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9")
}

/** The `{ … }` block that follows `header`, by brace depth, ignoring braces in strings. */
function blockAfter(src: string, header: string): string {
  const at = src.indexOf(header)
  if (at < 0) return ""
  let depth = 0
  let started = false
  let quote: string | null = null
  for (let i = at + header.length - 1; i < src.length; i++) {
    const ch = src[i]!
    if (quote) {
      if (ch === "\\") {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "{") {
      depth++
      started = true
      continue
    }
    if (ch === "}") {
      depth--
      if (started && depth === 0) return src.slice(at + header.length, i)
    }
  }
  return ""
}

/** Field names of an interface/type body, with `?` marking the optional ones. */
function fieldsOf(body: string): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const rawLine of body.split("\n")) {
    // Strip a trailing line comment, then a doc-comment-only line, then trim. A field
    // declaration is an identifier, an optional `?`, then a `:`.
    let line = rawLine
    const slash = line.indexOf("//")
    if (slash >= 0) line = line.slice(0, slash)
    line = line.trim()
    if (line.length === 0 || line.startsWith("*") || line.startsWith("/*")) continue
    let i = 0
    if (!isIdentStart(line[0]!)) continue
    while (i < line.length && isIdentPart(line[i]!)) i++
    const name = line.slice(0, i)
    let j = i
    while (j < line.length && line[j] === " ") j++
    const optional = line[j] === "?"
    if (optional) j++
    while (j < line.length && line[j] === " ") j++
    if (line[j] !== ":") continue
    out.set(name, optional)
  }
  return out
}

const gateSrc = readFileSync(GATE, "utf8")
const gateFields = fieldsOf(blockAfter(gateSrc, "type Ruled = {"))

/** The fields this lane's table declares, mirroring the same walk over its own file. */
const tableSrc = readFileSync(TABLE, "utf8")
const tableFields = fieldsOf(blockAfter(tableSrc, "export type Ruled = {"))

/** The rows' own keys, read off the table's data rather than off its declared type. */
const rowKeys = new Set<string>()
for (const row of FSHARP_RULED as any[]) for (const k of Object.keys(row)) rowKeys.add(k)

const shapeProblems: string[] = []
if (gateFields.size === 0) {
  shapeProblems.push("could not read the gate's own `type Ruled` block — the anchor `type Ruled = {` is gone, so nothing is being compared")
}
if (tableFields.size === 0) {
  shapeProblems.push("could not read `script/m14/fsharp-ruled.ts`'s own `Ruled` block")
}
for (const [name, optional] of gateFields) {
  if (!tableFields.has(name)) {
    shapeProblems.push(`the gate's Ruled has field \`${name}\` and the lane's restatement does not`)
    continue
  }
  if (tableFields.get(name) !== optional) {
    shapeProblems.push(`field \`${name}\` is ${optional ? "optional" : "required"} in the gate and ${tableFields.get(name) ? "optional" : "required"} in the lane's restatement`)
  }
}
for (const name of tableFields.keys()) {
  if (!gateFields.has(name)) shapeProblems.push(`the lane's restatement declares \`${name}\`, which the gate's Ruled does not have`)
}
for (const name of rowKeys) {
  if (!gateFields.has(name)) shapeProblems.push(`a table ROW carries the key \`${name}\`, which the gate's Ruled does not declare`)
}

console.log(`ruled-gate: shape check — the gate's Ruled vs the lane's restatement`)
console.log(`  gate   : ${[...gateFields].map(([n, o]) => n + (o ? "?" : "")).join(", ")}`)
console.log(`  lane   : ${[...tableFields].map(([n, o]) => n + (o ? "?" : "")).join(", ")}`)
console.log(`  row keys: ${[...rowKeys].sort().join(", ")}`)
if (shapeProblems.length > 0) {
  console.error("")
  for (const p of shapeProblems) console.error(`  SHAPE DIVERGENCE: ${p}`)
  console.error("")
  console.error("A table typed against a stale copy of the gate is a table the gate cannot use.")
  console.error("This is a report-to-supervisor item, not something to work around here.")
  process.exit(2)
}
console.log(`  -> identical (${gateFields.size} fields)\n`)

// ---------------------------------------------------------------- patch the COPY

const alreadyWired = /RULED_BY_LANG: Record<string, Ruled\[\]> = \{[^}]*\bfsharp:/.test(gateSrc)
if (alreadyWired) {
  console.log("the arbiter already carries a `fsharp` entry — running it directly, no copy needed:")
  console.log(`  npx tsx ${path.relative(ROOT, GATE)} fsharp\n`)
}

let patched = gateSrc
const patches: { find: string; replace: string; note: string }[] = []
if (!alreadyWired) {
  // One anchor, two edits: the supervisor's change is to this very line, so anchoring on
  // it means the proof cannot silently stop proving anything if the map gains a lane.
  const anchor = "const RULED_BY_LANG: Record<string, Ruled[]> = {"
  const at = patched.indexOf(anchor)
  if (at < 0) {
    console.error("ruled-gate: PATCH DID NOT APPLY — the arbiter's `RULED_BY_LANG` declaration is gone.")
    console.error("That is a report-to-supervisor item, not something to work around silently.")
    process.exit(2)
  }
  const importLine = `import { FSHARP_RULED } from ${JSON.stringify(TABLE)}`
  patches.push({ find: anchor, replace: `${importLine}\n${anchor} fsharp: FSHARP_RULED,`, note: "the table's import + the map entry" })
  patched = patched.replace(anchor, `${importLine}\n${anchor} fsharp: FSHARP_RULED,`)
}

// The copy lives outside the repo, so every relative import becomes absolute, and the
// gate's own dynamic `import("web-tree-sitter")` becomes the package's resolved entry —
// a directory specifier is not a legal ES module import, and /tmp has no node_modules
// above it. Without this the run dies with ERR_MODULE_NOT_FOUND after the corpus admit,
// which is where a first attempt at this proof ended.
patched = patched
  .replace('from "../../src/ast/language-detection"', `from ${JSON.stringify(path.join(ROOT, "src/ast/language-detection"))}`)
  .replace('from "../../src/ast/pool-worker"', `from ${JSON.stringify(path.join(ROOT, "src/ast/pool-worker"))}`)
  .replace('from "./differential"', `from ${JSON.stringify(path.join(ROOT, "script/m14/differential"))}`)
  .replace('from "./lua-ruled"', `from ${JSON.stringify(path.join(ROOT, "script/m14/lua-ruled"))}`)
  .replace('from "./toml-ruled"', `from ${JSON.stringify(path.join(ROOT, "script/m14/toml-ruled"))}`)
  .replace('await import("web-tree-sitter")', `await import(${JSON.stringify(path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.cjs"))})`)

// Optional: corpus fan-out. The gate admits the corpus through 8 concurrent `parseFile`
// calls and this repo's lanes run concurrently on one machine; at 8 workers a proof run
// was OOM-killed with its output lost. The patch changes the fan-out and NOTHING else —
// the admitted file list, the instruments, the verdicts and the exit code are the gate's.
const WORKERS = process.env.BB_FSHARP_RULED_WORKERS
if (WORKERS) {
  const find = "Array.from({ length: 8 }, () => worker())"
  if (!patched.includes(find)) {
    console.error("ruled-gate: worker patch did not apply")
    process.exit(2)
  }
  patched = patched.replace(find, `Array.from({ length: ${Number(WORKERS)} }, () => worker())`)
  patches.push({ find, replace: `Array.from({ length: ${Number(WORKERS)} }, () => worker())`, note: "corpus fan-out (BB_FSHARP_RULED_WORKERS)" })
}

{
  // The copy runs from /tmp, where there is no package.json saying `type: module`, so
  // tsx would compile it as CommonJS and reject the gate's top-level await.
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path.join(OUT_DIR, "package.json"), JSON.stringify({ type: "module" }))
}
const GATE_COPY = path.join(OUT_DIR, "ontology-coverage-gate.fsharp-proof.ts")
writeFileSync(GATE_COPY, patched)

console.log(`ruled-gate: ${patches.length} patch(es) applied to a COPY of ${path.relative(ROOT, GATE)}`)
for (const p of patches) {
  console.log(`  ${p.note}`)
  console.log(`    - ${p.find.length > 88 ? `${p.find.slice(0, 88)}…` : p.find}`)
  console.log(`    + ${p.replace.length > 88 ? `${p.replace.slice(0, 88)}…` : p.replace}`)
}
console.log(`  (plus: the copy's relative imports rewritten to absolute paths, because the copy runs from ${OUT_DIR})`)
console.log(`  shared file on disk: UNTOUCHED — ${path.relative(ROOT, GATE)}`)
console.log(`  patched copy: ${GATE_COPY}\n`)

// ---------------------------------------------------------------- run it

const SKIP_GATE = process.env.BB_FSHARP_RULED_SKIP_GATE === "1"
if (SKIP_GATE) {
  console.log("BB_FSHARP_RULED_SKIP_GATE=1 — patched copy written, gate NOT run.")
  console.log(`  run it with: npx tsx ${GATE_COPY} fsharp\n`)
} else {
  const started = Date.now()
  let out = ""
  let code = 0
  try {
    out = execFileSync("npx", ["tsx", alreadyWired ? GATE : GATE_COPY, "fsharp"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (err: any) {
    out = String(err.stdout ?? "") + String(err.stderr ?? "")
    code = typeof err.status === "number" ? err.status : 1
  }
  process.stdout.write(out)
  console.log("")
  console.log(`exit code ${code}  (${((Date.now() - started) / 1000).toFixed(0)}s)`)
}

console.log("")
console.log("== the six node types the arbiter re-measures for `exports` (instrument A) ==")
for (const n of FSHARP_EXPORT_NODE_TYPES_THAT_WOULD_MEAN_IT) console.log(`  ${n}`)
console.log("  A non-zero count for ANY of these prints FALSIFIED and fails the gate.")
console.log(`  Rows in FSHARP_RULED: ${FSHARP_RULED.map((r) => r.type).join(", ")}`)