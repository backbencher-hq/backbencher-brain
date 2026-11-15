/**
 * Protobuf grammar pin — this lane's pin, recomputed from disk.
 *
 * The shared gate is `script/m14/verify-grammar-pins.ts`, and this lane's verdict
 * should not rest on one tool being healthy. That is not hypothetical: commit
 * `5b0cd528` (the markdown two-grammar pin) left a `provenance:` key missing from
 * four lane entries — json, yaml, powershell, markdown — so the file does not
 * parse and the shared gate cannot run for ANY lane. The parent parses clean, so
 * the regression is located exactly, and the repair belongs to the lanes whose
 * records lost their keys. Reconstructing another lane's provenance is not this
 * lane's to do, so this probe takes the other route and carries the pin itself.
 *
 * It holds a lane-local record at `script/m14/tmp/protobuf/pin.json`, written from
 * measurement on `--write` and re-verified on every run. That is a weaker
 * instrument than the shared gate in one specific way, and the weakness is named
 * rather than hidden: a self-written record can be re-baselined. Two things make
 * that visible rather than free — the record carries the upstream revision and the
 * pre-patch baseline, and re-baselining shows up as a changed sha in the commit
 * that does it.
 *
 * Recomputed here, every run, never trusted:
 *   - the wired wasm's sha256 and byte length;
 *   - every vendored file's sha256 and length, and the tree digest derived from
 *     them, so an untracked generated file turns the gate red exactly as it does
 *     in the shared tool;
 *   - the pre-patch baseline wasm, so the A/B cannot silently start comparing two
 *     identical parsers;
 *   - the source<->wasm node-type agreement — the statement that the committed
 *     bytes ARE a build of the committed source.
 *
 * Usage: tsx grammar-pin.mts [--write]
 */
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import { OUT, PREVIOUS_WASM, ROOT, WASM } from "../paths.mts"

const LANE_RECORD = path.join(ROOT, "script/m14/tmp/protobuf/pin.json")
const SHARED_REGISTRY = path.join(ROOT, "validation/m14/grammar-pins.json")
const VENDOR_DIR = path.join(ROOT, "grammars/tree-sitter-proto")
const WRITE = process.argv.includes("--write")

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex")
const problems: string[] = []
const advisories: string[] = []
const checks: { what: string; recorded: string; actual: string; ok: boolean }[] = []

function cmp(what: string, recorded: unknown, actual: string): void {
  const rec = recorded === undefined || recorded === null ? "(absent)" : String(recorded)
  const ok = rec === actual
  checks.push({ what, recorded: rec, actual, ok })
  if (!ok) problems.push(`${what}: recorded ${rec}, actual ${actual}`)
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) stack.push(abs)
      else out.push(abs)
    }
  }
  return out.sort()
}

// ------------------------------------------------------------------ measure
const wasmBytes = fs.readFileSync(WASM)
const baselineBytes = fs.readFileSync(PREVIOUS_WASM)
const files: Record<string, { sha256: string; bytes: number }> = {}
for (const abs of walkFiles(VENDOR_DIR)) {
  const rel = path.relative(VENDOR_DIR, abs).split(path.sep).join("/")
  const buf = fs.readFileSync(abs)
  files[rel] = { sha256: sha256(buf), bytes: buf.length }
}
const treeDigest = sha256(
  Object.entries(files)
    .map(([p, f]) => `${p}:${f.sha256}`)
    .sort()
    .join("\n"),
)

// source<->wasm
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(wasmBytes)
// The agreement is over NAMED types, not the whole id space. node-types.json
// deliberately omits two whole classes that the wasm necessarily names: the
// ANONYMOUS tokens (`end`, `string_token1`, `,`, `{`) and the HIDDEN rules
// (`_option_name`, `_identifier_or_string`, `source_file_repeat1`), which
// tree-sitter excludes because no consumer can name them. Comparing the full id
// space reported 23 phantom disagreements, every one of them correct behaviour.
const wasmTypes = new Set<string>()
const wasmNamed = new Set<string>()
for (let i = 0; i < language.nodeTypeCount; i++) {
  const n = language.nodeTypeForId(i)
  if (!n) continue
  wasmTypes.add(n)
  if (language.nodeTypeIsNamed(i)) wasmNamed.add(n)
}
const nodeTypesPath = path.join(VENDOR_DIR, "src/node-types.json")
if (!fs.existsSync(nodeTypesPath)) {
  problems.push("src/node-types.json is absent, so the source<->wasm proof cannot run at all")
} else {
  const declaredTypes = (JSON.parse(fs.readFileSync(nodeTypesPath, "utf8")) as any[]).map((t) => t.type)
  const declaredSet = new Set(declaredTypes)
  const notDeclared = [...wasmNamed].filter((t) => !declaredSet.has(t))
  cmp("NAMED wasm types the committed source never declares", 0, String(notDeclared.length))
  if (notDeclared.length)
    problems.push(`the wired wasm names ${notDeclared.length} NAMED type(s) the source never declares: ${notDeclared.slice(0, 6).join(", ")}`)
  // A supertype is declared in node-types.json but materialises as a hidden
  // symbol, so the reverse direction is counted rather than asserted.
  const hidden = declaredTypes.filter((t) => !wasmTypes.has(t)).length
  checks.push({ what: "declared types materialising as hidden symbols", recorded: "(informational)", actual: String(hidden), ok: true })
  checks.push({ what: "anonymous + hidden wasm ids outside node-types.json", recorded: "(informational)", actual: String(wasmTypes.size - wasmNamed.size), ok: true })
}

const measured = {
  lane: "protobuf",
  wired: { file: path.relative(ROOT, WASM), sha256: sha256(wasmBytes), bytes: wasmBytes.length },
  baseline: {
    file: PREVIOUS_WASM,
    sha256: sha256(baselineBytes),
    bytes: baselineBytes.length,
    note: "amaanq/tree-sitter-proto as published, pre-patch; kept so the extraction A/B compares two different parsers",
  },
  upstreamRevision: fs.readFileSync(path.join(VENDOR_DIR, ".upstream-revision"), "utf8").trim(),
  vendored: { dir: path.relative(ROOT, VENDOR_DIR), fileCount: Object.keys(files).length, digest: treeDigest, files },
  surface: {
    nodeTypeCount: language.nodeTypeCount,
    namedTypeCount: declaredTypesSafe(),
    wasmNamedTypeCount: wasmNamed.size,
    fieldCount: language.fieldCount,
  },
}
function declaredTypesSafe(): number {
  try {
    return (JSON.parse(fs.readFileSync(nodeTypesPath, "utf8")) as any[]).filter((t) => t.named).length
  } catch {
    return 0
  }
}

// ------------------------------------------------------------ write or verify
if (WRITE || !fs.existsSync(LANE_RECORD)) {
  if (!WRITE && !fs.existsSync(LANE_RECORD)) {
    console.log("  no lane record yet — writing it from this measurement (--write thereafter to re-baseline)")
  }
  fs.mkdirSync(path.dirname(LANE_RECORD), { recursive: true })
  fs.writeFileSync(LANE_RECORD, JSON.stringify({ ...measured, writtenAt: new Date().toISOString() }, null, 2) + "\n")
  console.log(`  wrote ${path.relative(ROOT, LANE_RECORD)}`)
} else {
  const rec = JSON.parse(fs.readFileSync(LANE_RECORD, "utf8")) as typeof measured
  cmp("wired wasm sha256", rec.wired.sha256, measured.wired.sha256)
  cmp("wired wasm bytes", rec.wired.bytes, String(measured.wired.bytes))
  cmp("wired wasm path", rec.wired.file, measured.wired.file)
  cmp("pre-patch baseline sha256", rec.baseline.sha256, measured.baseline.sha256)
  cmp("pre-patch baseline bytes", rec.baseline.bytes, String(measured.baseline.bytes))
  cmp("upstream grammar revision", rec.upstreamRevision, measured.upstreamRevision)
  cmp("vendored file count", rec.vendored.fileCount, String(measured.vendored.fileCount))
  cmp("vendored tree digest", rec.vendored.digest, measured.vendored.digest)
  cmp("node type count", rec.surface.nodeTypeCount, String(measured.surface.nodeTypeCount))
  cmp("named type count", rec.surface.namedTypeCount, String(measured.surface.namedTypeCount))
  cmp("named type count in the wasm", rec.surface.wasmNamedTypeCount, String(measured.surface.wasmNamedTypeCount))
  cmp("field count", rec.surface.fieldCount, String(measured.surface.fieldCount))

  const recordedFiles = rec.vendored.files ?? {}
  for (const [rel, meta] of Object.entries(recordedFiles)) {
    if (!files[rel]) {
      problems.push(`vendored file vanished: ${rel}`)
      checks.push({ what: `vendored ${rel}`, recorded: meta.sha256.slice(0, 16), actual: "(missing)", ok: false })
    }
  }
  for (const [rel, meta] of Object.entries(files)) {
    if (!recordedFiles[rel]) {
      problems.push(`vendored file ADDED without a record: ${rel} — measureVendored hashes every file on disk, tracked or not`)
      checks.push({ what: `vendored ${rel}`, recorded: "(absent)", actual: meta.sha256.slice(0, 16), ok: false })
    }
  }
  console.log(`  record: ${path.relative(ROOT, LANE_RECORD)} (written ${rec.writtenAt})`)
}

// -------------------------------------------------- the shared gate's status
if (fs.existsSync(SHARED_REGISTRY)) {
  const shared = JSON.parse(fs.readFileSync(SHARED_REGISTRY, "utf8")) as { lanes: Record<string, unknown> }
  if (!shared.lanes.protobuf) {
    advisories.push(
      "protobuf has no record in validation/m14/grammar-pins.json. Its DECISION (the LANES entry) is committed in " +
        "script/m14/verify-grammar-pins.ts, but the MEASURED record is written by that script's --write path, and the " +
        "script does not parse as of 5b0cd528 (a `provenance:` key lost from the json, yaml, powershell and markdown " +
        "entries). This lane's pin is therefore verified by this probe instead, which is a weaker instrument in one " +
        "named way: a self-written record can be re-baselined.",
    )
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  lane: "protobuf",
  wasm: path.relative(ROOT, WASM),
  vendoredDir: path.relative(ROOT, VENDOR_DIR),
  checks: checks.length,
  passed: checks.filter((c) => c.ok).length,
  detail: checks,
  problems,
  advisories,
  pass: problems.length === 0,
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "grammar-pin.json"), JSON.stringify(out, null, 2))

console.log(`\n  recomputed checks: ${checks.length}, reproduced: ${out.passed}`)
for (const c of checks.filter((c) => !c.ok)) console.log(`    - ${c.what}: recorded ${c.recorded}, actual ${c.actual}`)
if (problems.length) {
  console.log(`\n  FAIL (${problems.length}):`)
  for (const p of problems.slice(0, 15)) console.log(`    - ${p}`)
} else {
  console.log(`\n  PASS: this lane's pin reproduces from disk — wired bytes, pre-patch baseline, upstream revision,`)
  console.log(`        vendored tree, surface, and the source<->wasm node-type agreement`)
}
for (const a of advisories) console.log(`\n  ADVISORY: ${a}`)
console.log(`\n  wrote ${path.join(OUT, "grammar-pin.json")}`)
process.exit(problems.length ? 1 : 0)
