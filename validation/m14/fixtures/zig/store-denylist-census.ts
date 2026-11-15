/**
 * ZIG STORE-DENYLIST CENSUS — how many real Zig declarations the production
 * store drops on name alone.
 *
 * ## The question
 *
 * `parseFile` is the production entry, and its `keepSymbol` gate applies a
 * UNIVERSAL denylist "language keywords / conventions and synthetic tree-sitter
 * artifact names — never legitimate declarations in any language". The first
 * half of that claim is a judgement and the second half is a measurement, and
 * only one of them is true for zig: `root`, `Self` and `program` are ordinary
 * identifiers in zig and the corpus declares all three. The gate lives in
 * shared machinery (`src/ast/pool-worker.ts`), so this lane measures and
 * reports rather than editing it.
 *
 * ## Why it belongs in this lane's census
 *
 * The ontology census measures the TARGET resolution rate per type, and a
 * denylisted name lands in the same bucket as every other unresolved target
 * without saying why. This script separates the two, because "the store
 * refused to keep a symbol it should have kept" and "the analyzer never found a
 * declaration" are different defects with different owners.
 *
 * ## The list is READ, NOT COPIED
 *
 * `UNIVERSAL` is parsed out of `src/ast/pool-worker.ts` at run time. A hand
 * copy is a list that keeps reporting the old answer after the source changes,
 * which is the failure mode the M60 coverage gate was written to stop.
 *
 * ## Instrument
 *
 * A declaration is counted when the tree bears the denylisted name in a DECLARING
 * position: a `container_field` `name` field, an `identifier` that is the name of
 * a `function_declaration` / `test_declaration` / `comptime_declaration`, an
 * `identifier` that is a `variable_declaration`'s binding name, or an
 * `identifier` that is a direct member of an `error_set_declaration`. Those are
 * the four declaring positions the analyzer itself enumerates (its
 * `isDeclaringOccurrence`), so a hit here is a declaration a tree walk can see.
 *
 * Controls run through the same walk: one positive per denylisted name that zig
 * plausibly uses, and negatives that must read 0.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/store-denylist-census.ts [--sample 0] [--seed s] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "store-denylist-census-v1")
const OUT = arg("out", "")

// ───────────────────────────────────────────── READ the denylist from its owner
const poolWorker = readFileSync(path.join(ROOT, "src", "ast", "pool-worker.ts"), "utf8")
const blockMatch = /const UNIVERSAL = new Set\(\[([\s\S]*?)\]\)/.exec(poolWorker)
if (!blockMatch) {
  console.error("could not read the UNIVERSAL denylist out of src/ast/pool-worker.ts — refusing to hardcode a copy")
  process.exit(2)
}
const UNIVERSAL: string[] = [...blockMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
const denySet = new Set(UNIVERSAL)

// ───────────────────────────────────────────── grammar
await Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
type FileRec = { repo: string; rel: string; abs: string; text: string }
const all: FileRec[] = []
const repoFileCounts: Record<string, number> = {}
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
  repoFileCounts[e] = tracked.length
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

// ───────────────────────────────────────────── the walk
/** Does the analyzer PUBLISH this declaration?
 *
 * A declaration is published when it is at FILE scope, or is a member of a
 * container bound to an identifier at file scope. A function-local `const self`
 * or a method-body `const Self = @This()` is never published by the analyzer, so
 * the store refusing to keep it costs nothing — and counting those would inflate
 * the finding with rows whose loss is invisible. This is the same boundary the
 * Z59 fix uses on the analyzer side, so the two agree by construction rather than
 * by two similar-looking copies. */
const CONTAINER_NODES = new Set([
  "struct_declaration", "union_declaration", "enum_declaration",
  "error_set_declaration", "opaque_declaration",
])
function isPublishedDeclaration(n: any): boolean {
  const name = n.type === "identifier" && n.parent?.type === "error_set_declaration" ? n.parent : n
  let cur: any = name.parent
  // A container member / error member is published when its container is.
  while (cur && !CONTAINER_NODES.has(cur.type)) {
    if (cur.type === "function_declaration" || cur.type === "test_declaration" || cur.type === "comptime_declaration") return false
    cur = cur.parent
  }
  if (!cur) return true
  const binding = cur.parent
  if (!binding || binding.type !== "variable_declaration") return false
  let named = false
  for (let i = 0; i < binding.namedChildCount; i++) {
    const c = binding.namedChild(i)
    if (c && c.type === "identifier") { named = true; break }
  }
  if (!named) return false
  let up: any = binding.parent
  while (up) {
    if (up.type === "function_declaration" || up.type === "test_declaration" || up.type === "comptime_declaration") return false
    if (CONTAINER_NODES.has(up.type)) return false
    up = up.parent
  }
  return true
}

type Hit = { file: string; line: number; kind: string; declaringForm: string; published: boolean }
/** Two recorders. The corpus run and the controls must not share one, because a
 *  key-diff over a shared map cannot tell a control's hit from a corpus hit that
 *  happens to bear the same name — and `Self` and `root` both do, so the first
 *  version of the controls read 0 against an expectation of 3 while the corpus
 *  hits underneath them were real. */
type Rec = { hits: Map<string, Hit[]>; files: Map<string, Set<string>> }
const makeRec = (): Rec => ({ hits: new Map<string, Hit[]>(), files: new Map<string, Set<string>>() })
let rec: Rec = makeRec()

/** The four declaring positions, plus the node type they come from. An
 *  `identifier` inside a `field_expression` or a call is a USE, and counting
 *  those would turn every `self.index` into a hit. */
function declaringNameOf(n: any): { name: string; form: string } | null {
  if (n.type === "container_field") {
    const f = n.childForFieldName?.("name")
    return f && f.type === "identifier" ? { name: String(f.text), form: "container_field.name" } : null
  }
  if (n.type === "variable_declaration") {
    const c = n.namedChildCount > 0 ? n.namedChild(0) : null
    if (!c || c.type !== "identifier") return null
    return { name: String(c.text), form: "variable_declaration binding" }
  }
  if (
    n.type === "function_declaration" || n.type === "test_declaration" || n.type === "comptime_declaration"
  ) {
    const c = n.namedChildren?.find((x: any) => x.type === "identifier")
    return c ? { name: String(c.text), form: n.type } : null
  }
  if (n.type === "identifier" && n.parent?.type === "error_set_declaration") {
    return { name: String(n.text), form: "error_set_declaration member" }
  }
  return null
}

function walk(text: string, label: string): void {
  const t = parser.parse(text)
  if (!t) return
  const visit = (n: any): void => {
    const d = declaringNameOf(n)
    if (d && denySet.has(d.name)) {
      let arr = rec.hits.get(d.name)
      if (!arr) { arr = []; rec.hits.set(d.name, arr) }
      let files = rec.files.get(d.name)
      if (!files) { files = new Set(); rec.files.set(d.name, files) }
      arr.push({ file: label, line: (n.startPosition?.row ?? 0) + 1, kind: n.type, declaringForm: d.form, published: isPublishedDeclaration(n) })
      files.add(label)
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) visit(c)
    }
  }
  visit(t.rootNode)
  t.delete?.()
}

for (const f of draw) walk(f.text, key(f))
const corpusRec = rec
const corpusDropped = [...corpusRec.hits.values()].reduce((a, arr) => a + arr.length, 0)

// ───────────────────────────────────────────── controls, through the SAME walk
type Ctl = { name: string; src: string; expect: string[] }
const controls: { name: string; source: string; found: string[]; expected: string[]; ok: boolean }[] = []
const runCtl = (name: string, src: string, expect: string[]): void => {
  rec = makeRec()
  walk(src, "<control>")
  const found = [...rec.hits.keys()].sort()
  controls.push({
    name, source: src.replace(/\n/g, " | "), found,
    expected: [...expect].sort(),
    ok: JSON.stringify(found) === JSON.stringify([...expect].sort()),
  })
}
runCtl("POSITIVE: a container named Self, a type alias named root, an enum member named unknown",
  "const Self = u8;\nconst root = 1;\nconst E = enum { unknown };\n", ["Self", "root", "unknown"])
runCtl("POSITIVE: a field and a function carrying denylisted names",
  "pub const T = struct {\n    Self: u8,\n    pub fn root() void {}\n};\n", ["Self", "root"])
runCtl("NEGATIVE: an ordinary declaration set the denylist does not name",
  "const Ordinary = 1;\npub fn named() void {}\n", [])
runCtl("NEGATIVE: a USE of a denylisted spelling is not a declaration",
  "const Holder = struct { item: u8 };\nfn f(h: Holder) void { _ = h.item; _ = root; }\n", [])

const corpusUncontaminated = [...corpusRec.hits.values()].reduce((a, arr) => a + arr.length, 0) === corpusDropped

const perName = Object.fromEntries(
  [...corpusRec.hits].sort((a, b) => b[1].length - a[1].length).map(([n, arr]) => [n, {
    declarations: arr.length,
    publishedByTheAnalyzer: arr.filter((h) => h.published).length,
    neverPublished: arr.filter((h) => !h.published).length,
    files: corpusRec.files.get(n)?.size ?? 0,
    forms: Object.fromEntries([...new Set(arr.map((h) => h.declaringForm))].sort().map((f) => [f, arr.filter((h) => h.declaringForm === f).length])),
    publishedExamples: arr.filter((h) => h.published).slice(0, 8).map((h) => `${h.file}:${h.line} ${h.kind} (${h.declaringForm})`),
    examples: arr.slice(0, 6).map((h) => `${h.file}:${h.line} ${h.kind} (${h.declaringForm})`),
  }]),
)
const totalDropped = corpusDropped
const totalFiles = new Set([...corpusRec.files.values()].flatMap((s) => [...s])).size
const totalPublishedDropped = [...corpusRec.hits.values()].reduce((a, arr) => a + arr.filter((h) => h.published).length, 0)
const publishedDropFiles = new Set([...corpusRec.hits.values()].flatMap((arr) => arr.filter((h) => h.published).map((h) => h.file))).size

const report = {
  instrument: "validation/m14/fixtures/zig/store-denylist-census.ts",
  denylistSource: "src/ast/pool-worker.ts — the UNIVERSAL set is PARSED from the source at run time, not copied",
  corpusRoot: CR,
  seed: SEED,
  samplingMethod: "git ls-files -- '*.zig' per corpus repo, ordered by sha256(seed|<repo>/<rel>), first N taken.",
  corpusFilesAdmitted: all.length,
  sampledFiles: draw.length,
  drawHash: `sha256:${drawHash}`,
  denylist: UNIVERSAL,
  denylistSize: UNIVERSAL.length,
  declarationsDroppedByName: totalDropped,
  publishedDeclarationsDroppedByName: totalPublishedDropped,
  filesWithAPublishedDeclarationDropped: publishedDropFiles,
  filesWithADroppedDeclaration: totalFiles,
  perName,
  calibration: {
    corpusCountsUncontaminatedByControls: corpusUncontaminated,
    corpusDeclarationsDropped: corpusDropped,
    note: "the corpus and the controls are recorded by SEPARATE recorders; a shared map cannot separate a control's hit from a corpus hit that bears the same name, and Self and root both do",
  },
  controls,
}

const text = JSON.stringify(report, null, 2)
if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), text + "\n")
  console.log(`wrote ${OUT}`)
}
console.log(`zig store-denylist census — ${draw.length} files sampled (${all.length} admitted), draw ${report.drawHash}`)
console.log(`  denylist read from src/ast/pool-worker.ts: ${UNIVERSAL.length} names — ${UNIVERSAL.join(", ")}`)
console.log(`  real zig declarations carrying a denylisted name: ${totalDropped} across ${totalFiles} file(s)`)
console.log(`  of those, PUBLISHED by the analyzer and so genuinely lost from the index: ${totalPublishedDropped} across ${publishedDropFiles} file(s)`)
for (const [n, v] of Object.entries(perName)) {
  console.log(`      ${String((v as any).declarations).padStart(5)} decl, ${String((v as any).publishedByTheAnalyzer).padStart(4)} PUBLISHED  ${n.padEnd(14)} in ${String((v as any).files).padStart(4)} file(s)  forms ${JSON.stringify((v as any).forms)}`)
  for (const e of (v as any).publishedExamples) console.log(`             PUBLISHED  ${e}`)
  if (!(v as any).publishedExamples.length) for (const e of (v as any).examples) console.log(`             local-only ${e}`)
}
console.log("")
console.log("CONTROLS")
for (const c of controls) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name.padEnd(66)} found [${c.found.join(",")}] (expected [${c.expected.join(",")}])`)
if (controls.some((c) => !c.ok)) process.exitCode = 1