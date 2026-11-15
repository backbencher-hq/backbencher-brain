/**
 * ZIG FILE-CONTAINER CENSUS — how many declarations does this grammar express at
 * the TOP LEVEL of a file that the analyzer publishes nothing for?
 *
 * Zig lets a file BE a struct. `const OpenURI = @This();` followed by bare
 * fields makes the file's top level the body of that struct, and the grammar
 * says so structurally: the fields arrive as `container_field` whose DIRECT
 * parent is `source_file`. tree-sitter-zig probe, pinned wasm:
 *
 *   container_field < source_file      "app: *App"   OpenURI.zig:20
 *
 * `real-zig-analyzer.ts:704` skips every `container_field` whose enclosing
 * container is absent or anonymous, on the stated negative contract that an
 * anonymous container must not become a file-scope symbol. That contract is
 * about a field inside an anonymous struct returned from a generic function,
 * where the field has no stable owner. A file-level field's owner is the FILE:
 * it has a path, and when the file binds `@This()` it has a name too. So the
 * contract does not obviously reach this shape, and the shape is measurable —
 * which is what this file measures, BEFORE anything is changed.
 *
 * Four questions, each with a number:
 *   Q1 how many files carry at least one `container_field < source_file`
 *   Q2 of those, how many bind `const X = @This()`, and what X is
 *   Q3 of the fields, how many are TYPED (a struct field) and how many are not
 *      (an enum member — same node type, distinguished only by the absence of a
 *      `type` field, which is the analyzer's own discriminator at :2180)
 *   Q4 how many of these names is the analyzer ALREADY publishing, from some
 *      other declaration in the same file — the collision case, where adding
 *      them would create a second symbol with a name that already resolves
 *
 * Q4 is the one that decides whether this is a safe addition: a name already
 * published in the file is a name an edge may already bind to, and a second
 * symbol under it turns one declaration into two.
 *
 * CONTROLS, non-zero exit on failure:
 *   C1 a named struct's field must NOT be counted — `container_field` whose
 *      parent is `container_declaration` is the shape that already works, and an
 *      instrument that cannot tell the two shapes apart is counting the wrong
 *      thing. Asserted positively AND negatively on synthetic sources.
 *   C2 the typed/untyped split must agree with the presence of a `type` field on
 *      a synthetic `a: u8` (typed) and `north` (untyped).
 *
 * Usage: npx tsx validation/m14/fixtures/zig/filecontainer-census.ts [--out f]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/**
 * The artifact name carries the day it was measured, so the default is derived from
 * the clock rather than hardcoded. Four of this lane's instruments hardcoded a date
 * literal, and the consequence was measured on pass 19: re-running `incoming-resolve.ts`
 * on a LATER day overwrote `incoming-resolution-full-2026-10-03.json` in place, leaving a
 * file whose name claims 2026-10-03 and whose content is from a later date — and a
 * `git status` that reads as an edit to an existing measurement rather than as a
 * clobber. Three of the four named 2026-10-04 and one named 2026-10-03, so no two agreed.
 *
 * This is the same shape as §8 items 15 and 18 (an instrument that writes a register it
 * does not own, or under a name that misstates what is in it), with the target being this
 * lane's own artifacts rather than a shared one. `--out` still overrides, so a
 * reproducible re-run can still be written to an explicit name.
 */
const MEASURED_ON = new Date().toISOString().slice(0, 10)
const OUT = arg0("out", path.join(HERE, "measurements", `filecontainer-census-${MEASURED_ON}.json`))
function arg0(n: string, d: string): string {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

/** A field is at FILE level iff its direct parent is the root. Not "an ancestor
 *  is the root" — that would sweep in every field of the file, which is the
 *  shape that already works and the thing C1 exists to keep out. */
function isFileLevelField(n: Node): boolean {
  return n.type === "container_field" && n.parent?.type === "source_file"
}
const hasTypeField = (n: Node): boolean => {
  const f = typeof (n as any).childForFieldName === "function" ? (n as any).childForFieldName("type") : null
  return !!f
}
const fieldName = (n: Node): string => {
  const f = typeof (n as any).childForFieldName === "function" ? (n as any).childForFieldName("name") : null
  const node = f && f.type === "identifier" ? f : anyIdentifier(n)
  return node ? node.text : ""
}
function anyIdentifier(n: Node): Node | null {
  if (n.type === "identifier") return n
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    const r = anyIdentifier(c)
    if (r) return r
  }
  return null
}
/** The `const X = @This();` binding, read off node types: a
 *  `variable_declaration` whose value is a `builtin_function` whose
 *  `builtin_identifier` is `@This`. No text matching.
 *
 *  The NAME is `namedChild(0)` when that is an `identifier`, NOT
 *  `childForFieldName("name")`. This grammar declares no `name` field on
 *  `variable_declaration` — the analyzer reads it the same way at :81 and
 *  :1435 — so the field lookup returns null and this function's first version
 *  reported 0 bindings on a source that has one. C1 caught it. `container_field`
 *  DOES carry a `name` field, which is why `fieldName` below can use it. */
function thisBindingName(root: Node): string | null {
  for (let i = 0; i < root.namedChildCount; i++) {
    const d = root.namedChild(i)
    if (!d || d.type !== "variable_declaration") continue
    for (let j = 0; j < d.namedChildCount; j++) {
      const v = d.namedChild(j)
      if (!v || v.type !== "builtin_function") continue
      for (let k = 0; k < v.namedChildCount; k++) {
        const b = v.namedChild(k)
        if (b?.type === "builtin_identifier" && b.text === "@This") {
          const nm = d.namedChildCount > 0 ? d.namedChild(0) : null
          if (nm && nm.type === "identifier") return nm.text
        }
      }
    }
  }
  return null
}

// ── CONTROLS
{
  const src = [
    "const Named = struct { inner: u8, other: u16 };",
    "const FileLevel = @This();",
    "top: u8,",
    "north,",
  ].join("\n")
  const t = parser.parse(src)
  if (!t) { console.error("CONTROL FAILING: synthetic source did not parse"); process.exit(2) }
  let fileLevel = 0
  let named = 0
  let typed = 0
  let untyped = 0
  ;(function walk(n: Node) {
    if (n.type === "container_field") {
      if (isFileLevelField(n)) {
        fileLevel++
        if (hasTypeField(n)) typed++
        else untyped++
      } else named++
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  })(t.rootNode)
  const binding = thisBindingName(t.rootNode)
  const c1 = fileLevel === 2 && named === 2 && binding === "FileLevel"
  const c2 = typed === 1 && untyped === 1
  if (!c1 || !c2) {
    console.error(`CONTROL FAILING: C1=${c1} C2=${c2} (fileLevel=${fileLevel} named=${named} typed=${typed} untyped=${untyped} binding=${binding})`)
    process.exit(2)
  }
  console.log("controls: 2 ok, 0 FAILING (C1 file-level vs named field, C2 typed vs untyped, @This binding)")
}

// ── the corpus walk, byte-identical admission to ontology-census.ts
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
{
  const LIMIT = 512 * 1024
  const repos: string[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    repos.push(e)
  }
  for (const e of repos) {
    const dir = path.join(CR, e)
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".zig")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > LIMIT) continue } catch { continue }
      all.push({ repo: e, dir, rel, abs })
    }
  }
}
const key = (f: FileRec): string => `${f.repo}/${f.rel}`
const popHash = createHash("sha256").update(all.map(key).slice().sort().join("\n")).digest("hex")
console.log(`population ${popHash} · ${all.length} files`)

let idx = 0
let filesWithFields = 0
let fields = 0
let typedFields = 0
let untypedFields = 0
let filesWithBinding = 0
let filesNoBinding = 0
let nameAlreadyPublished = 0
let nameNew = 0
let parseFailures = 0
let fallbackFiles = 0
let filesParsed = 0
const bindingNames = new Map<string, number>()
const newNames = new Map<string, number>()
const perRepo = new Map<string, number>()
const examples: { file: string; binding: string | null; typed: number; untyped: number; newNames: string[] }[] = []

async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= all.length) return
    const f = all[i]
    let t: Node | null = null
    try {
      const src = readFileSync(f.abs, "utf8")
      t = parser.parse(src)?.rootNode ?? null
      t && t.delete?.()
    } catch { parseFailures++; continue }
    if (!t) { parseFailures++; continue }
    filesParsed++
    const fileFields: Node[] = []
    for (let i2 = 0; i2 < t.namedChildCount; i2++) {
      const c = t.namedChild(i2)
      if (c && isFileLevelField(c)) fileFields.push(c)
    }
    if (!fileFields.length) continue
    filesWithFields++
    perRepo.set(f.repo, (perRepo.get(f.repo) ?? 0) + 1)
    const binding = thisBindingName(t)
    if (binding) { filesWithBinding++; bindingNames.set(binding, (bindingNames.get(binding) ?? 0) + 1) }
    else filesNoBinding++
    let typed = 0
    let untyped = 0
    const names: string[] = []
    for (const fld of fileFields) {
      fields++
      if (hasTypeField(fld)) { typed++; typedFields++ } else { untyped++; untypedFields++ }
      const n = fieldName(fld)
      if (n) names.push(n)
    }
    // Q4 — does the analyzer already publish this name from somewhere in the file?
    let already: string[] = []
    let fresh: string[] = []
    try {
      const r: any = await parseFile(f.abs, f.dir)
      if (r?.fallback === true) fallbackFiles++
      const pub = new Set<string>()
      for (const s of r.symbols ?? []) { const nm = typeof s.name === "string" ? s.name : ""; if (nm) pub.add(nm) }
      for (const n of names) {
        if (pub.has(n)) { nameAlreadyPublished++; already.push(n) } else { nameNew++; fresh.push(n); newNames.set(n, (newNames.get(n) ?? 0) + 1) }
      }
    } catch { /* counted in parseFailures by the tree pass above */ }
    if (examples.length < 12) examples.push({ file: key(f), binding, typed, untyped, newNames: fresh.slice(0, 8) })
  }
}
const NW = 8
await Promise.all(Array.from({ length: NW }, () => worker()))

console.log(`\nQ1 files carrying at least one \`container_field < source_file\`: ${filesWithFields} of ${filesParsed}`)
console.log(`Q2 \`const X = @This()\`: ${filesWithBinding} with a binding · ${filesNoBinding} WITHOUT one`)
console.log(`Q3 fields: ${fields} total · ${typedFields} typed (a struct field) · ${untypedFields} untyped (an enum member)`)
console.log(`Q4 names: ${nameNew} NOT published anywhere in their file · ${nameAlreadyPublished} already published`)
if (fallbackFiles) console.log(`  NOTE: ${fallbackFiles} file(s) came back from parseFile with fallback:true`)
if (parseFailures) console.log(`  NOTE: ${parseFailures} tree-parse failure(s)`)

console.log(`\nFiles by repo`)
for (const [r, c] of [...perRepo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(24)} ${c}`)
console.log(`\nTop @This() binding names`)
for (const [n, c] of [...bindingNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n.padEnd(28)} ${c} file(s)`)
console.log(`\nTop field names that are NOT already published`)
for (const [n, c] of [...newNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${n.padEnd(28)} ${c}`)
console.log(`\nExamples`)
for (const e of examples) console.log(`  ${e.file}  @This->${e.binding ?? "(none)"}  typed ${e.typed} untyped ${e.untyped}  new: ${e.newNames.join(", ")}`)

writeFileSync(OUT, JSON.stringify({
  populationHash: popHash,
  filesInDraw: all.length,
  filesParsed,
  filesWithFileLevelFields: filesWithFields,
  filesWithThisBinding: filesWithBinding,
  filesWithoutThisBinding: filesNoBinding,
  fields, typedFields, untypedFields,
  nameNew, nameAlreadyPublished,
  perRepo: Object.fromEntries(perRepo),
  bindingNames: Object.fromEntries([...bindingNames.entries()].sort((a, b) => b[1] - a[1])),
  newNames: Object.fromEntries([...newNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300)),
  examples,
  parseFailures, fallbackFiles,
}, null, 2))
console.log(`\nwrote ${OUT}`)
