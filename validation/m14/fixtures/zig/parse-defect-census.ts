/**
 * ZIG PINNED-GRAMMAR DEFECT CENSUS.
 *
 * ## The question
 *
 * The pinned `wasm/tree-sitter-zig.wasm` rejects shapes that valid Zig uses. The
 * first one was found by a control that had to read 0 and did not
 * (`construct-probe.ts`, control "A4 NEGATIVE"), and the shape was then pinned on
 * synthetics before anything was counted — a corpus count of a defect whose
 * trigger is not known measures the wrong population.
 *
 * The detector is TREE-based throughout. A shape is named by what the tree
 * actually holds:
 *
 *   ERROR_CHILD_COMMA  a container declaration node (`struct`/`enum`/`union`/
 *                      `opaque`/`error`) carrying an ERROR child whose text is
 *                      `,` — the grammar failing on a separator between two
 *                      members. Valid Zig; zig fmt produces both forms.
 *   MISSING_BRACE      a container whose closing `}` is a MISSING node — the
 *                      grammar failing to close a body it opened.
 *   BASELINE           every ERROR and every MISSING node in the draw, bucketed
 *                      by the node type and by the parent's type, each with a
 *                      source snippet, so the classes are named from evidence
 *                      rather than from a guess about which shapes are fragile.
 *
 * ## Why the baseline is the honest headline
 *
 * The two named shapes are the ones the controls pin. The baseline is what they
 * are a sample of, and it is reported at full extent because a defect class
 * nobody bounded is a defect class nobody fixed. A snippet is kept per bucket so
 * a reader can see the trigger rather than take the label on trust.
 *
 * ## Does it cost the analyzer anything
 *
 * A parser defect that costs no symbol and no edge is a defect in a parser; one
 * that silently drops a declaration is a defect in the graph. This script does
 * NOT answer that — the analyzer owns that question and `ontology-census.ts` is
 * the instrument that can answer it, by comparing the same draw's symbol counts
 * against the declaration counts a tree walk finds. What this script reports is
 * the extent, with the trigger, so the question has a denominator.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/parse-defect-census.ts [--sample 400] [--seed s] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "parse-defect-census-v1")
const OUT = arg("out", "")

await Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

const CONTAINERS = new Set([
  "struct_declaration", "union_declaration", "enum_declaration",
  "error_set_declaration", "opaque_declaration",
])

type FileRec = { repo: string; rel: string; abs: string; text: string }
const all: FileRec[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    all.push({ repo: e, rel, abs, text: "" })
  }
}
for (const f of all) {
  try { f.text = readFileSync(f.abs, "utf8") } catch { f.text = "" }
}
const key = (f: FileRec) => `${f.repo}/${f.rel}`
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  .map((x) => x.f)
const draw = SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

/** The two named classes, and the baseline, counted together. `countTree` is the
 *  ONE detector: the corpus run and every control call it, so a control
 *  certifies the code that produced the number. */
function countTree(text: string): { errorChildComma: number; missingBrace: number; errorNodes: number; missingNodes: number; buckets: Map<string, number>; snippets: Map<string, string> } {
  const out = { errorChildComma: 0, missingBrace: 0, errorNodes: 0, missingNodes: 0, buckets: new Map<string, number>(), snippets: new Map<string, string>() }
  const tree = parser.parse(text)
  if (!tree) return out
  const add = (k: string, s: string): void => {
    out.buckets.set(k, (out.buckets.get(k) ?? 0) + 1)
    if (!out.snippets.has(k)) out.snippets.set(k, s)
  }
  const visit = (n: any): void => {
    if (n.type === "ERROR") {
      out.errorNodes++
      const pk = `ERROR in ${n.parent?.type ?? "?"}`
      add(pk, JSON.stringify(String(n.text).replace(/\s+/g, " ").slice(0, 70)))
      if (CONTAINERS.has(n.parent?.type) && String(n.text).trim() === ",") out.errorChildComma++
    }
    if (n.isMissing) {
      out.missingNodes++
      const pk = `MISSING ${n.type} in ${n.parent?.type ?? "?"}`
      add(pk, JSON.stringify(String(n.parent?.text ?? "").replace(/\s+/g, " ").slice(0, 70)))
      if (n.type === "}" && CONTAINERS.has(n.parent?.type)) out.missingBrace++
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) visit(c)
    }
  }
  visit(tree.rootNode)
  tree.delete?.()
  return out
}

const classes: Record<string, { occurrences: number; files: Set<string>; examples: string[] }> = {
  ERROR_CHILD_COMMA: { occurrences: 0, files: new Set(), examples: [] },
  MISSING_BRACE: { occurrences: 0, files: new Set(), examples: [] },
  ANY_ERROR_FILE: { occurrences: 0, files: new Set(), examples: [] },
  ANY_MISSING_FILE: { occurrences: 0, files: new Set(), examples: [] },
}
let errNodes = 0
let missNodes = 0
const bucketTotals = new Map<string, number>()
const bucketSnippets = new Map<string, string>()
let parsed = 0
for (const f of draw) {
  const r = countTree(f.text)
  parsed++
  errNodes += r.errorNodes
  missNodes += r.missingNodes
  for (const [k, v] of r.buckets) {
    bucketTotals.set(k, (bucketTotals.get(k) ?? 0) + v)
    if (!bucketSnippets.has(k)) bucketSnippets.set(k, `${key(f)}: ${r.snippets.get(k) ?? ""}`)
  }
  if (r.errorChildComma) {
    classes.ERROR_CHILD_COMMA.occurrences += r.errorChildComma
    classes.ERROR_CHILD_COMMA.files.add(key(f))
    if (classes.ERROR_CHILD_COMMA.examples.length < 8) classes.ERROR_CHILD_COMMA.examples.push(key(f))
  }
  if (r.missingBrace) {
    classes.MISSING_BRACE.occurrences += r.missingBrace
    classes.MISSING_BRACE.files.add(key(f))
    if (classes.MISSING_BRACE.examples.length < 8) classes.MISSING_BRACE.examples.push(key(f))
  }
  if (r.errorNodes) {
    classes.ANY_ERROR_FILE.occurrences++
    classes.ANY_ERROR_FILE.files.add(key(f))
    if (classes.ANY_ERROR_FILE.examples.length < 8) classes.ANY_ERROR_FILE.examples.push(key(f))
  }
  if (r.missingNodes) {
    classes.ANY_MISSING_FILE.occurrences++
    classes.ANY_MISSING_FILE.files.add(key(f))
    if (classes.ANY_MISSING_FILE.examples.length < 8) classes.ANY_MISSING_FILE.examples.push(key(f))
  }
}

// ───────────────────────────────────────────── controls
const controls: Record<string, { source: string; found: number; mustBe: number }> = {}
const control = (name: string, src: string, key2: "errorChildComma" | "missingBrace", mustBe: number): void => {
  const r = countTree(src)
  controls[name] = { source: src.replace(/\n/g, " | "), found: r[key2], mustBe }
}
control("POSITIVE ERROR_CHILD_COMMA: a comma between two container members", "const S = struct {\n    fn f() void {},\n    g: u8,\n};\n", "errorChildComma", 1)
control("NEGATIVE ERROR_CHILD_COMMA: no comma between members", "const S = struct {\n    fn f() void {}\n    g: u8,\n};\n", "errorChildComma", 0)
control("NEGATIVE ERROR_CHILD_COMMA: a comma inside an argument list", "fn g(a: u8, b: u8) void { _ = a; _ = b; }\n", "errorChildComma", 0)
control("POSITIVE MISSING_BRACE: a container-level declaration the grammar cannot terminate", "const S = struct {\n    var total: u32 = 0,\n};\n", "missingBrace", 1)
control("NEGATIVE MISSING_BRACE: an ordinary struct of fields", "const S = struct {\n    a: u8,\n};\n", "missingBrace", 0)
control("NEGATIVE MISSING_BRACE: a struct of methods", "const S = struct {\n    fn f() void {}\n};\n", "missingBrace", 0)

const report = {
  instrument: "validation/m14/fixtures/zig/parse-defect-census.ts",
  corpusRoot: CR,
  seed: SEED,
  samplingMethod: "git ls-files -- '*.zig' per corpus repo, ordered by sha256(seed|<repo>/<rel>), first N taken.",
  corpusFilesAdmitted: all.length,
  sampledFiles: draw.length,
  drawHash: `sha256:${drawHash}`,
  filesParsed: parsed,
  errorNodes: errNodes,
  missingNodes: missNodes,
  classes: Object.fromEntries(
    Object.entries(classes).map(([k, v]) => [k, { occurrences: v.occurrences, files: v.files.size, examples: v.examples }]),
  ),
  buckets: Object.fromEntries(
    [...bucketTotals].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { count: v, example: bucketSnippets.get(k) ?? "" }]),
  ),
  controls,
}

const text = JSON.stringify(report, null, 2)
if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), text + "\n")
  console.log(`wrote ${OUT}`)
}
console.log(`zig parse-defect census — ${parsed} files parsed of ${draw.length} sampled (${all.length} admitted), draw ${report.drawHash}`)
console.log(`  ERROR nodes ${errNodes}   MISSING nodes ${missNodes}`)
console.log("")
for (const [k, v] of Object.entries(report.classes)) {
  console.log(`  ${k.padEnd(30)} ${String(v.occurrences).padStart(5)} files/occurrences in ${String(v.files).padStart(4)} file(s)`)
  for (const e of v.examples.slice(0, 5)) console.log(`      ${e}`)
}
console.log("")
console.log("BUCKETS (node count, with a snippet of the offending text)")
for (const [k, v] of Object.entries(report.buckets) as [string, any][]) {
  console.log(`  ${String(v.count).padStart(6)}  ${k}`)
  console.log(`          ${v.example}`)
}
console.log("")
console.log("CONTROLS")
for (const [k, v] of Object.entries(controls)) {
  const ok = v.mustBe === 0 ? v.found === 0 : v.found >= v.mustBe
  console.log(`  ${ok ? "ok  " : "FAIL"} ${k.padEnd(64)} found ${String(v.found).padStart(3)} (must be ${v.mustBe})`)
}