/**
 * NIM EXTENDED-TYPES CENSUS — the four EXTENDED vocabulary values, counted against the PINNED
 * grammar and the WHOLE admitted population.
 *
 * ## Why this instrument exists
 *
 * The coverage-block gate reads this lane at **10/14** with `decorates`, `mixes_in`, `part_of` and
 * `renders` all in the denominator (`script/m14/coverage-block-gate.ts --json`, 2026-10-23). A type
 * leaves that denominator ONLY on a cited ruling, and a ruling is a number with a falsifier — not a
 * sentence. This census produces the numbers.
 *
 * ## THE LEAD'S DECISIONS THIS INSTRUMENT SERVES (2026-10-23)
 *
 *   decorates  **RULED ONTOLOGICAL — DO NOT IMPLEMENT.** A Nim pragma is a compiler directive; an
 *              annotation is passive metadata and a decorator is an applied callable
 *              (`src/ast/types.ts:131-144`; VOCABULARY-EXTENSION-PROPOSAL §3). The census produces
 *              BOTH halves anyway, because a ruling its own instrument cannot refute is prose:
 *              the ruling's COUNT is the pragma census below, and its FALSIFIER is the
 *              applied-callable-in-a-pragma-position class (`pragma-template` names) — counted.
 *   part_of    1:1 RELABEL of the existing `include` → `imports` rows, KEEPING the analyzer's
 *              normalized module-name target with `targetResolution:"module-name"`. The divergence
 *              from fsharp/php (which emit paths) is to be RECORDED, never flattened. So this census
 *              counts the include population the relabel moves.
 *   mixes_in   the ruling shape: Nim's `mixin` statement names SYMBOLS open for overload
 *              resolution, not a type composed into a supertype chain. Counted: mixin sites and
 *              their operand classes, plus EVERY construct the ruling names (include, `object of`
 *              inheritance, concept refinement) so the falsifier is a thing this instrument counts.
 *   renders    the ruling shape: no component can be named at a rendering site. Counted: the
 *              render-host-shaped calls over the whole population, their argument shapes, and
 *              whether ANY argument names a declared COMPONENT TYPE. R2 is not applicable because
 *              Nim rendering is a macro DSL over ordinary `call` nodes — a grammar patch would have
 *              to INVENT SYNTAX — so a call-node name filter cannot separate the construct from its
 *              impostors (the dart lane's filter lesson).
 *
 * ## THE POPULATION
 *
 * The admitted file list is READ FROM `validation/m14/measurements/nim-population.json`, which
 * carries the gate's own walk (`script/m14/nim-population.ts`): per-checkout `git ls-files -z`, the
 * router's extension list, present, <= 1 MiB. ⇒ ONE RULE, ONE WALK, TWO INSTRUMENTS: the census
 * refuses to run when the artifact's `admitted` and its `admittedFiles.length` disagree (exit 5),
 * because a second walker with a second copy of the admission rule is the fleet's duplicated-table
 * defect — one table, two populations, one name.
 *
 * ## THE LEAK GUARD (the cpp lane's 15,223 lost files, 2026-10-23)
 *
 * A tree-sitter WASM module ABORTS at ~7,600 parses in one process, and this lane's population is
 * 6,063 — UNDER the abort point, so a leaked tree would be INVISIBLE to this lane: the run would
 * complete over a silently truncated set. ⇒ EVERY tree is `delete()`d in a `finally`, `filesRead`
 * is printed BESIDE `filesAdmitted`, and the run FAILS (exit 6) when they differ or a file failed
 * to parse. A run that exits 0 over a truncated population is the worst output shape the fleet
 * knows.
 *
 * ## THE GRAMMAR IDENTITY
 *
 * The sha256 of the BYTES THE REGISTRY SERVES (L-20) — read through `src/util/wasm`, never a path
 * and never an engine log line.
 *
 * ## THE CROSS-CHECK (a measurement that cannot call the thing it measures must be compared to it)
 *
 * The pragma-name extraction below MIRRORS the analyzer's own `readPragmaNames`
 * (`src/ast/real-nim-analyzer.ts:1367-1385`) and the include reading MIRRORS
 * `readIncludeStatement` (`:1438-1477`). On a DETERMINISTIC 1-in-43 stride of the population this
 * instrument then runs the REAL `RealNimAnalyzer` and compares:
 *   · every NAME the analyzer publishes as a symbol `decorators` payload is a name this census read
 *     from a declaration-owned pragma list of the SAME file (analyzer ⊆ census; a census miss here
 *     means the owner classification is wrong, and the cross-check FAILS);
 *   · the analyzer's `imports` rows carrying `metadata.relationshipType:"nim_include"` equal this
 *     census's include-operand count for the SAME file (the relabel's own population, checked
 *     before the relabel is written).
 *
 * Usage:
 *   NIM_CENSUS_BEAT=1 bun run script/m14/nim-extended-census.ts [--json <out.json>]
 *   (NIM_CENSUS_BEAT spawns `script/m14/arm-token.sh beat nim` every 250 files: the token's age is
 *    the arm's age because the beat comes from INSIDE the loop that is doing the work.)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const POP_PATH = path.join(ROOT, "validation/m14/measurements/nim-population.json")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")
/** DEV-ONLY smoke mode: walk only the first N admitted files, print a SMOKE banner, write NOTHING.
 *  It exists so the instrument can be exercised before it takes the fleet's heavy arm token; a
 *  smoke run is NEVER evidence and the population guard below refuses it as a population. */
const SMOKE = argOf("--smoke") ? Number(argOf("--smoke")) : 0
const BEAT = process.env.NIM_CENSUS_BEAT === "1"
const SAMPLE_EVERY = 43
const SIZE_CAP = 1024 * 1024

const L: string[] = []
const say = (s = "") => {
  L.push(s)
  console.log(s)
}

// ───────────────────────────────────────────────────────────── the population, from the ONE walk
if (!existsSync(POP_PATH)) {
  console.error(`FATAL: no population artifact at ${POP_PATH} — run script/m14/nim-population.ts first`)
  process.exit(5)
}
const pop = JSON.parse(readFileSync(POP_PATH, "utf8")) as {
  admitted: number
  admittedFiles: { repo: string; abs: string; rel: string }[]
  populationString: string
  rule: string
  root: string
  command: string
  admittedExtensions: string[]
  repos: number
}
if (!Array.isArray(pop.admittedFiles) || pop.admitted !== pop.admittedFiles.length) {
  console.error(
    `FATAL: the population artifact disagrees with itself — admitted=${pop.admitted} but ` +
      `admittedFiles=${Array.isArray(pop.admittedFiles) ? pop.admittedFiles.length : "MISSING"}. ` +
      `A census over a second population is not a census of this one. Re-run script/m14/nim-population.ts.`,
  )
  process.exit(5)
}
const FILES = pop.admittedFiles
const WALK = SMOKE > 0 ? FILES.slice(0, SMOKE) : FILES
const FILES_ADMITTED = WALK.length

// ───────────────────────────────────────────────────────────── the grammar, by the served bytes
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

let wasmBytes: Uint8Array
let wasmSource: string
try {
  const { hasWasmInRegistry, resolveWasmAsset } = await import(path.join(ROOT, "src/util/wasm"))
  const b = hasWasmInRegistry("tree-sitter-nim.wasm")
  if (!b) throw new Error("registry has no tree-sitter-nim.wasm")
  wasmBytes = b as Uint8Array
  wasmSource = `registry:${resolveWasmAsset("tree-sitter-nim.wasm")}`
} catch (e: any) {
  console.error(`FATAL: cannot read the nim grammar from the production registry: ${String(e?.message ?? e)}`)
  process.exit(5)
}
const GRAMMAR_SHA = createHash("sha256").update(wasmBytes).digest("hex")
const parser = new WSP()
parser.setLanguage(await WSL.load(wasmBytes))

// ───────────────────────────────────────────────────────────── counters
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
const topN = (m: Map<string, number>, n = 25) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
const fmt = (m: Map<string, number>, n = 25) => topN(m, n).map(([k, v]) => `${k} ${v}`).join(" · ") || "-"

const counts = {
  filesAdmitted: FILES_ADMITTED,
  filesRead: 0,
  parseFailed: 0,
  readFailed: 0,
  errorFiles: 0,
  missingFiles: 0,
  nodes: 0,
  emptyResults: 0,
}
/** whole-population node-type census — every node type occurrence and file count */
const nodeTypes = new Map<string, number>()
const nodeTypeFiles = new Map<string, Set<string>>()

// ── decorates: the pragma census
const pragma = {
  lists: 0,
  entries: 0,
  declarationOwnedLists: 0,
  declarationOwnedEntries: 0,
  /** owner node type of every pragma_list (the parent node's type) */
  ownerTypes: new Map<string, number>(),
  /** element root node type inside a pragma_list: identifier / colon_expression / equal_expression / other */
  entryShapes: new Map<string, number>(),
  /** pragma NAME -> occurrences, for the analyzer's own extraction rule */
  names: new Map<string, number>(),
  /** pragma entries the ANALYZER drops because the name-bearing node is not an `identifier` */
  analyzerDrops: new Map<string, number>(),
  /** the discriminator classes, resolved after the pass */
  classDeclaredPragmaTemplate: 0,
  classDeclaredOther: 0,
  classUndeclared: 0,
  classSites: [] as { file: string; line: number; owner: string; name: string; cls: string }[],
  /** pragma names declared as `template/macro X() {.pragma.}` anywhere in the corpus */
  declaredPragmaTemplates: new Map<string, { kind: string; file: string; line: number }>(),
  /** sample of concrete sites per class, for the evidence page */
  examples: new Map<string, string[]>(),
}

// ── the corpus-wide declaration indexes (built in the SAME pass, resolved AFTER it)
const declaredRoutineNames = new Set<string>()
const declaredTypeNames = new Set<string>()
const declaredRoutineFiles = new Map<string, string>()
// ★ PER-REPOSITORY SETS: the cause census needs to split a wall row's target into
//   "declared elsewhere in THIS project", "declared in ANOTHER repository" and "declared
//   nowhere" — three different causes with three different repairs (php's partition is the
//   precedent). A global set cannot make that split, and a second parse of the population just
//   to answer it would be a second instrument measuring a different moment.
const repoOfLabel = (label: string): string => label.slice(0, label.indexOf("/"))
const declaredByRepo = new Map<string, { routines: Set<string>; types: Set<string> }>()
function repoDeclIndex(repo: string): { routines: Set<string>; types: Set<string> } {
  let e = declaredByRepo.get(repo)
  if (!e) { e = { routines: new Set(), types: new Set() }; declaredByRepo.set(repo, e) }
  return e
}

// ── part_of: the include population the 1:1 relabel moves
const partOf = {
  includeSites: 0,
  includeOperands: 0,
  operandShapes: new Map<string, number>(),
  operandLastSegmentShapes: new Map<string, number>(),
  /** include operands whose last segment names an admitted file (the analyzer's 98 % claim) */
  operandsNamingAnAdmittedFile: 0,
  operandsNamingAnAdmittedNims: 0,
  operandsNamingAnAdmittedNimble: 0,
  writtenExtensions: new Map<string, number>(),
  examples: [] as string[],
  importSites: 0,
  importFromSites: 0,
  exportSites: 0,
  moduleSymbols: 0,
}

// ── mixes_in: the composition constructs the ruling names, all counted
const mixesIn = {
  mixinSites: 0,
  mixinOperands: 0,
  operandShapes: new Map<string, number>(),
  operandsNamingADeclaredType: 0,
  operandsNamingADeclaredRoutine: 0,
  operandsNamingNeither: 0,
  examples: [] as string[],
  objectDeclarations: 0,
  objectDeclarationsWithInherits: 0,
  objectTypeKeywords: 0,
  conceptDeclarations: 0,
  refinementLists: 0,
  ofBranches: 0,
}

// ── renders: the render-host census
const RENDER_RE = /render|html|component|vnode|jsx|view/i
const renders = {
  callSites: 0,
  calleeNames: new Map<string, number>(),
  renderHostCalls: 0,
  renderHostByName: new Map<string, number>(),
  renderHostByFunctionShape: new Map<string, number>(),
  argumentShapes: new Map<string, number>(),
  /** the falsifier class: a render host argument that names a DECLARED TYPE (the component predicate) */
  argsNamingADeclaredType: 0,
  argsCapitalizedIdentifier: 0,
  argsDeclaredTypeExamples: [] as string[],
  argsStringLiteral: 0,
  argsLowercaseIdentifier: 0,
  examples: [] as string[],
  /** htmlgen-style element calls: a plain call whose callee name IS an HTML element name — the
   *  near miss for "an element is rendered". Counted by the HTML element vocabulary, NOT by "any
   *  lowercase identifier" (that would count every call in the corpus and measure nothing). */
  htmlElementCalls: new Map<string, number>(),
  htmlElementCallsTotal: 0,
  /** all plain-identifier lowercase calls, for context only — never read as an element census */
  plainLowercaseIdentifierCalls: 0,
}

// ── the sample kept for the REAL-ANALYZER cross-check
type SampleFile = { label: string; text: string; declaredPragmaNames: string[]; includeOperands: number }
const sample: SampleFile[] = []

// ───────────────────────────────────────────────────────────── helpers (the analyzer's own rules)
/** last segment of a dotted name: `Foo.Bar` -> `Bar` */
function lastSegment(text: string): string {
  const t = String(text ?? "").trim()
  const i = t.lastIndexOf(".")
  return i >= 0 ? t.slice(i + 1) : t
}
/** strip quotes and a written extension from a module-path segment: `"ccgstmts.nim"` -> ccgstmts */
function stemOf(text: string): string {
  const cleaned = String(text ?? "").trim().replace(/^["']|["']$/g, "")
  const seg = lastSegment(cleaned)
  return seg.replace(/\.(nim|nims|nimble)$/i, "")
}
/**
 * THE ANALYZER'S OWN `readPragmaNames`, re-implemented from
 * `src/ast/real-nim-analyzer.ts:1367-1385`: iterate the pragma_list's NAMED children; unwrap a
 * `colon_expression`/`equal_expression` to its `left` field; keep it only when its type is
 * `identifier`. The re-implementation is on purpose — the analyzer's method is private — and the
 * sample cross-check is what stops the copy drifting from the thing it copies.
 */
function readPragmaNames(list: any, out: { names: string[]; shapes: Map<string, number>; drops: Map<string, number> }): void {
  for (let i = 0; i < list.namedChildCount; i++) {
    const raw = list.namedChild(i)
    if (!raw) continue
    bump(out.shapes, raw.type)
    let c = raw
    if (c.type === "colon_expression" || c.type === "equal_expression") c = c.childForFieldName("left") ?? c
    if (c && c.type === "identifier") out.names.push(c.text)
    else bump(out.drops, c ? c.type : "null")
  }
}
/** the declaration's own pragma list: the analyzer's `childForFieldName("pragmas") ?? pragma_list` */
function declarationPragmaList(node: any): any | null {
  const f = node.childForFieldName("pragmas")
  if (f) return f
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "pragma_list") return c
  }
  return null
}
/** the DECL_TYPES a pragma_list parent can be, i.e. an annotation ON a declaration */
const DECL_TYPES = new Set([
  "proc_declaration", "func_declaration", "method_declaration", "iterator_declaration",
  "template_declaration", "macro_declaration", "converter_declaration", "type_declaration",
  "type_symbol_declaration", "variable_declaration", "concept_declaration", "enum_declaration",
  "object_declaration", "field_declaration", "enum_field_declaration", "parameter_declaration",
  "symbol_declaration", "var_section", "let_section", "const_section", "using_section",
  "type_section", "type_expression", "proc_type", "object_type",
])
const CALLABLE_DECLS = new Set([
  "proc_declaration", "func_declaration", "method_declaration", "iterator_declaration",
  "template_declaration", "macro_declaration", "converter_declaration", "proc_type",
])
/** read a declaration's name: field `name`, unwrapping `exported_symbol` (`proc foo*()`) */
function declName(node: any): string | null {
  const nn = node.childForFieldName("name")
  if (!nn) return null
  if (nn.type === "exported_symbol") {
    const c = nn.namedChild(0)
    return c ? c.text : nn.text.replace(/\*$/, "")
  }
  if (nn.type === "identifier" || nn.type === "accent_quoted" || nn.type === "symbol") return nn.text
  return nn.text || null
}
/** first direct child of a type */
function firstChildOfType(node: any, type: string): any | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
/** expression_list operands, one per named child (include / mixin share this shape in the grammar) */
function operandsOf(node: any): any[] {
  const list = firstChildOfType(node, "expression_list")
  if (!list) return []
  const out: any[] = []
  for (let i = 0; i < list.namedChildCount; i++) {
    const c = list.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

// THE HTML ELEMENT VOCABULARY — the near-miss class for `renders`. Deliberately a fixed list, and
// the ruling states the filter: an htmlgen element macro is written as a lowercase element name,
// which is NOT a component reference (the vocabulary's contract excludes lowercase intrinsics).
const HTML_ELEMENTS = new Set([
  "div", "span", "p", "a", "ul", "ol", "li", "table", "tr", "td", "th", "h1", "h2", "h3", "h4",
  "h5", "h6", "form", "input", "button", "head", "body", "html", "script", "style", "br", "img",
  "section", "article", "nav", "header", "footer", "label", "select", "option", "textarea", "pre",
  "code", "em", "strong", "b", "i", "small", "hr", "meta", "link", "title", "canvas", "svg",
  "video", "audio", "iframe", "tbody", "thead", "tfoot", "caption", "blockquote", "dl", "dt", "dd",
])

// ───────────────────────────────────────────────────────────── the walk (one pass, indexes deferred)
const indexBasenames = new Map<string, { exts: Set<string> }>()
const moduleBasenamesByRepo = new Map<string, Set<string>>()
for (const f of WALK) {
  const base = path.basename(f.abs).toLowerCase()
  const stem = base.replace(/\.(nim|nims|nimble)$/, "")
  const ext = base.slice(base.lastIndexOf("."))
  let e = indexBasenames.get(stem)
  if (!e) { e = { exts: new Set() }; indexBasenames.set(stem, e) }
  e.exts.add(ext)
  let rs = moduleBasenamesByRepo.get(f.repo)
  if (!rs) { rs = new Set(); moduleBasenamesByRepo.set(f.repo, rs) }
  rs.add(stem)
}

say("NIM EXTENDED-TYPES CENSUS — the four extended vocabulary values, counted over the WHOLE admitted population")
if (SMOKE > 0) say(`  ★★ SMOKE RUN — first ${SMOKE} admitted file(s) only. THIS IS NOT EVIDENCE and it writes no artifact. ★★`)
say()
say(`  population artifact   ${POP_PATH}`)
say(`  population rule       ${pop.rule}`)
say(`  population root       ${pop.root}`)
say(`  population string     ${pop.populationString}`)
say(`  admitted extensions   ${pop.admittedExtensions.map((e) => `.${e}`).join(" ")} · repos carrying an admitted file ${pop.repos}`)
say(`  filesAdmitted         ${FILES_ADMITTED.toLocaleString()}`)
say(`  grammar (bytes the REGISTRY SERVES): sha256 ${GRAMMAR_SHA}`)
say(`  grammar source        ${wasmSource}`)
say()

function walkTree(root: any, label: string): { declaredPragmaNames: string[]; includeOperands: number } {
  const declaredPragmaNames: string[] = []
  let includeOperands = 0
  let hasError = false
  let hasMissing = false
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    counts.nodes++
    bump(nodeTypes, n.type)
    let fs = nodeTypeFiles.get(n.type)
    if (!fs) { fs = new Set(); nodeTypeFiles.set(n.type, fs) }
    fs.add(label)
    if (n.type === "ERROR") hasError = true
    if (n.type === "MISSING") hasMissing = true

    // ── DECORATES: every pragma_list, classified by OWNER (the parent node's type)
    if (n.type === "pragma_list") {
      pragma.lists++
      const owner = n.parent?.type ?? "null"
      bump(pragma.ownerTypes, owner)
      const got = { names: [] as string[], shapes: new Map<string, number>(), drops: new Map<string, number>() }
      readPragmaNames(n, got)
      pragma.entries += got.names.length + [...got.drops.values()].reduce((a, b) => a + b, 0)
      for (const [k, v] of got.shapes) bump(pragma.entryShapes, k, v)
      for (const [k, v] of got.drops) bump(pragma.analyzerDrops, k, v)
      for (const name of got.names) bump(pragma.names, name)
      if (DECL_TYPES.has(owner)) {
        pragma.declarationOwnedLists++
        pragma.declarationOwnedEntries += got.names.length
        for (const name of got.names) declaredPragmaNames.push(name)
      }
    }

    // ── the declaration indexes (resolved after the pass; never against a partial index)
    if (CALLABLE_DECLS.has(n.type)) {
      const name = declName(n)
      if (name) {
        declaredRoutineNames.add(name)
        repoDeclIndex(repoOfLabel(label)).routines.add(name)
        if (!declaredRoutineFiles.has(name)) declaredRoutineFiles.set(name, label)
        // a candidate PRAGMA TEMPLATE: `template X(...) {.pragma.}` — the applied-callable class
        if (n.type === "template_declaration" || n.type === "macro_declaration") {
          const list = declarationPragmaList(n)
          if (list) {
            const probe = { names: [] as string[], shapes: new Map<string, number>(), drops: new Map<string, number>() }
            readPragmaNames(list, probe)
            if (probe.names.includes("pragma")) {
              if (!pragma.declaredPragmaTemplates.has(name)) {
                pragma.declaredPragmaTemplates.set(name, { kind: n.type, file: label, line: n.startPosition.row + 1 })
              }
            }
          }
        }
      }
    }
    if (n.type === "type_symbol_declaration" || n.type === "type_declaration") {
      const name = declName(n)
      if (name) {
        declaredTypeNames.add(name)
        repoDeclIndex(repoOfLabel(label)).types.add(name)
      }
    }
    if (n.type === "symbol_declaration") {
      const name = declName(n)
      if (name && !declaredTypeNames.has(name)) {
        declaredRoutineNames.add(name)
        repoDeclIndex(repoOfLabel(label)).routines.add(name)
      }
    }

    // ── PART_OF: the include population (the analyzer's readIncludeStatement shape)
    if (n.type === "include_statement") {
      partOf.includeSites++
      for (const op of operandsOf(n)) {
        partOf.includeOperands++
        includeOperands++
        bump(partOf.operandShapes, op.type)
        const text = String(op.text ?? "").trim()
        const seg = stemOf(text)
        let ext = ""
        const m = /\.(nim|nims|nimble)$/i.exec(text)
        if (m) ext = `.${m[1].toLowerCase()}`
        if (ext) bump(partOf.writtenExtensions, ext)
        const hit = indexBasenames.get(lastSegment(text).toLowerCase())
        if (hit) {
          partOf.operandsNamingAnAdmittedFile++
          if (hit.exts.has(".nims")) partOf.operandsNamingAnAdmittedNims++
          if (hit.exts.has(".nimble")) partOf.operandsNamingAnAdmittedNimble++
        }
        if (partOf.examples.length < 30) partOf.examples.push(`${label}:${n.startPosition.row + 1} include ${text.slice(0, 100)} [${op.type}] → ${seg}${ext}`)
      }
    }
    if (n.type === "import_statement") partOf.importSites++
    if (n.type === "import_from_statement") partOf.importFromSites++
    if (n.type === "export_statement") partOf.exportSites++

    // ── MIXES_IN: every construct the ruling names, counted
    if (n.type === "mixin_statement") {
      mixesIn.mixinSites++
      for (const op of operandsOf(n)) {
        mixesIn.mixinOperands++
        bump(mixesIn.operandShapes, op.type)
        const name = lastSegment(String(op.text ?? ""))
        const isType = declaredTypeNames.has(name)
        const isRoutine = declaredRoutineNames.has(name)
        if (isType) mixesIn.operandsNamingADeclaredType++
        else if (isRoutine) mixesIn.operandsNamingADeclaredRoutine++
        else mixesIn.operandsNamingNeither++
        if (mixesIn.examples.length < 30) mixesIn.examples.push(`${label}:${n.startPosition.row + 1} mixin ${String(op.text).slice(0, 80)} [${op.type}]${isType ? " → DECLARED TYPE" : ""}`)
      }
    }
    if (n.type === "object_declaration") {
      mixesIn.objectDeclarations++
      if (n.childForFieldName("inherits")) mixesIn.objectDeclarationsWithInherits++
    }
    if (n.type === "object_type") mixesIn.objectTypeKeywords++
    if (n.type === "concept_declaration") mixesIn.conceptDeclarations++
    if (n.type === "refinement_list") mixesIn.refinementLists++
    if (n.type === "of_branch") mixesIn.ofBranches++

    // ── RENDERS: render-host-shaped calls and their argument shapes
    if (n.type === "call") {
      renders.callSites++
      const fn = n.childForFieldName("function")
      const fnText = String(fn?.text ?? "")
      const name = lastSegment(fnText)
      bump(renders.calleeNames, name)
      if (fn?.type === "identifier" && /^[a-z]/.test(name)) renders.plainLowercaseIdentifierCalls++
      if (fn?.type === "identifier" && HTML_ELEMENTS.has(name.toLowerCase())) {
        bump(renders.htmlElementCalls, name)
        renders.htmlElementCallsTotal++
      }
      if (RENDER_RE.test(name)) {
        renders.renderHostCalls++
        bump(renders.renderHostByName, name)
        bump(renders.renderHostByFunctionShape, fn?.type ?? "null")
        const argsNode = n.childForFieldName("arguments")
        const args: any[] = []
        if (argsNode) for (let i = 0; i < argsNode.namedChildCount; i++) { const a = argsNode.namedChild(i); if (a) args.push(a) }
        let anyComponent = false
        for (const a of args) {
          bump(renders.argumentShapes, a.type)
          const t = String(a.text ?? "").trim()
          if (a.type === "interpreted_string_literal" || a.type === "raw_string_literal" || a.type === "long_string_literal" || a.type === "generalized_string") {
            renders.argsStringLiteral++
          } else if (/^[A-Z][A-Za-z0-9_]*$/.test(t)) {
            renders.argsCapitalizedIdentifier++
            if (declaredTypeNames.has(t)) {
              renders.argsNamingADeclaredType++
              anyComponent = true
              if (renders.argsDeclaredTypeExamples.length < 20) renders.argsDeclaredTypeExamples.push(`${label}:${n.startPosition.row + 1} ${name}(${t}) — names a DECLARED TYPE`)
            }
          } else if (/^[a-z_][A-Za-z0-9_]*$/.test(t)) {
            renders.argsLowercaseIdentifier++
          }
        }
        if (renders.examples.length < 30) renders.examples.push(`${label}:${n.startPosition.row + 1} ${fnText.slice(0, 60)}(${args.map((a) => String(a.text).slice(0, 40)).join(", ")})${anyComponent ? " ★COMPONENT" : ""}`)
      }
    }

    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (hasError) counts.errorFiles++
  if (hasMissing) counts.missingFiles++
  return { declaredPragmaNames, includeOperands }
}

for (let i = 0; i < WALK.length; i++) {
  const f = WALK[i]!
  const label = `${f.repo}/${f.rel}`
  counts.filesRead++
  let text: string
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    counts.readFailed++
    continue
  }
  if (text.trim().length === 0) counts.emptyResults++
  let tree: any
  try {
    tree = parser.parse(text)
  } catch {
    counts.parseFailed++
    continue
  }
  if (!tree) { counts.parseFailed++; continue }
  try {
    const got = walkTree(tree.rootNode, label)
    if (i % SAMPLE_EVERY === 0) {
      sample.push({ label, text, declaredPragmaNames: got.declaredPragmaNames, includeOperands: got.includeOperands })
    }
  } finally {
    // ★ THE LEAK GUARD. 6,063 parses is UNDER the ~7,600 WASM abort point, so a leaked tree would
    //   be INVISIBLE here: the module would survive and the run would complete over a truncated
    //   population. Every tree is freed in a finally, and the count is checked after the loop.
    tree.delete()
    tree = null
  }
  if (counts.filesRead % 250 === 0) {
    process.stderr.write(`  … ${counts.filesRead}/${FILES_ADMITTED} files walked\r`)
    if (BEAT) {
      try {
        execFileSync("bash", [path.join(ROOT, "script/m14/arm-token.sh"), "beat", "nim"], { stdio: "ignore" })
      } catch { /* the beat is best-effort; a refused beat is not a failed census */ }
    }
  }
}
process.stderr.write("\n")

// ───────────────────────────────────────────────────────────── the leak guard, checked
say()
say("== THE POPULATION, READ AND WALKED ==")
say(`  filesAdmitted        ${FILES_ADMITTED.toLocaleString()}`)
say(`  filesRead            ${counts.filesRead.toLocaleString()}`)
say(`  parseFailed          ${counts.parseFailed}`)
say(`  readFailed           ${counts.readFailed}`)
say(`  files with ERROR     ${counts.errorFiles}`)
say(`  files with MISSING   ${counts.missingFiles}`)
say(`  nodes walked         ${counts.nodes.toLocaleString()}`)
say(`  empty files (0 content, not a defect) ${counts.emptyResults}`)
const populationOk =
  counts.filesAdmitted === counts.filesRead && counts.parseFailed === 0 && counts.readFailed === 0
if (!populationOk && SMOKE === 0) {
  console.error(
    `FATAL: filesAdmitted=${counts.filesAdmitted} filesRead=${counts.filesRead} parseFailed=${counts.parseFailed} readFailed=${counts.readFailed} — ` +
      `THE WALK DID NOT COVER THE POPULATION. A census over a truncated set is not a census of this population.`,
  )
  process.exit(6)
}

// ───────────────────────────────────────────────────────────── resolve + classify (after the pass)
/** pragma name -> class. The indexes are complete only HERE, which is why nothing is classified in
 *  the tree walk: a file can USE a pragma its template declares LATER, or in ANOTHER file. */
function classifyPragmaName(name: string): string {
  if (pragma.declaredPragmaTemplates.has(name)) return "declared-pragma-template"
  if (declaredRoutineNames.has(name) || declaredTypeNames.has(name)) return "declared-other"
  return "undeclared"
}
const pragmaClassCounts = new Map<string, number>()
const pragmaClassFiles = new Map<string, Set<string>>()
for (const [name, n] of pragma.names) {
  const cls = classifyPragmaName(name)
  bump(pragmaClassCounts, cls, n)
  // per-class FILE counts need a site list; count distinct owner files by re-reading the census
  // through the node index is heavier than useful, so this reports sites per class and names.
  if (cls === "declared-pragma-template") pragma.classDeclaredPragmaTemplate += n
  else if (cls === "declared-other") pragma.classDeclaredOther += n
  else pragma.classUndeclared += n
}
const PRAGMA_TEMPLATE_NAMES = [...pragma.declaredPragmaTemplates.keys()].sort()
const pragmaAppliedCallableSites = pragma.classDeclaredPragmaTemplate
const pragmaTemplateNamesUsed = PRAGMA_TEMPLATE_NAMES.filter((n) => pragma.names.has(n))

// render falsifier resolves after the type index is complete
// (the argument walk already ran, so re-resolve counts of capitalized identifiers that became
// declared types only AFTER the file that mentions them — the walk recorded ONLY declared-at-time
// matches. ⇒ REPORTED SEPARATELY, and the declaration must read the conservative (walk-time) one.)
const rendersComponentPredicateResolvedAfter = renders.argsNamingADeclaredType

// ───────────────────────────────────────────────────────────── the four sections
say()
say("== GRAMMAR NODE TYPES THIS CENSUS IS ABOUT (whole-population occurrence / file counts) ==")
for (const t of [
  "pragma_list", "pragma_expression", "pragma_statement",
  "include_statement", "import_statement", "import_from_statement", "export_statement",
  "mixin_statement", "concept_declaration", "refinement_list",
  "object_declaration", "object_type", "of_branch",
  "template_declaration", "macro_declaration",
  "call", "identifier", "dot_expression", "string_literal", "interpreted_string_literal",
]) {
  const n = nodeTypes.get(t) ?? 0
  const files = nodeTypeFiles.get(t)?.size ?? 0
  say(`  ${t.padEnd(26)} ${String(n).padStart(9)}  in ${String(files).padStart(6)} files`)
}
say()
say("== 1 · decorates — RULED ONTOLOGICAL (compiler directive, not applied callable) ==")
say(`  pragma_lists (all contexts)                  ${pragma.lists.toLocaleString()}`)
say(`  pragma entries (names + args)                ${pragma.entries.toLocaleString()}`)
say(`  pragma names read by the analyzer's rule     ${[...pragma.names.values()].reduce((a, b) => a + b, 0).toLocaleString()} over ${pragma.names.size} distinct names`)
say(`  declaration-OWNED pragma lists               ${pragma.declarationOwnedLists.toLocaleString()}`)
say(`  declaration-OWNED pragma names               ${pragma.declarationOwnedEntries.toLocaleString()}`)
say(`  pragma_list OWNER node types                 ${fmt(pragma.ownerTypes)}`)
say(`  pragma entry shapes                          ${fmt(pragma.entryShapes)}`)
say(`  entries the analyzer DROPS (not an identifier) ${[...pragma.analyzerDrops.values()].reduce((a, b) => a + b, 0)} ${fmt(pragma.analyzerDrops)}`)
say(`  THE NECESSARY HALF: pragma templates DECLARED in the corpus (template/macro with {.pragma.}) — the APPLIED-CALLABLE discriminator`)
say(`    declared pragma templates                  ${pragma.declaredPragmaTemplates.size} distinct: ${PRAGMA_TEMPLATE_NAMES.slice(0, 20).join(" · ")}${PRAGMA_TEMPLATE_NAMES.length > 20 ? " · …" : ""}`)
say(`    of those, USED in a pragma position        ${pragmaTemplateNamesUsed.length} distinct · ${pragmaAppliedCallableSites.toLocaleString()} sites`)
say(`    pragma SITES by class                      declared-pragma-template ${pragmaClassCounts.get("declared-pragma-template") ?? 0} · declared-other ${pragmaClassCounts.get("declared-other") ?? 0} · undeclared/directive ${pragmaClassCounts.get("undeclared") ?? 0}`)
say(`  TOP pragma names                             ${fmt(pragma.names, 30)}`)
say(`  THE FALSIFIER: an applied callable in a pragma position. Counted above: ${pragmaAppliedCallableSites} site(s) name a declared pragma template.`)
say()
say("== 2 · part_of — 1:1 RELABEL of `include` (module-name target kept; targetResolution=module-name) ==")
say(`  include statements                           ${partOf.includeSites.toLocaleString()}`)
say(`  include OPERANDS (= the rows the relabel moves) ${partOf.includeOperands.toLocaleString()}`)
say(`  include operand shapes                       ${fmt(partOf.operandShapes)}`)
say(`  operands whose LAST SEGMENT names an admitted file ${partOf.operandsNamingAnAdmittedFile.toLocaleString()}`)
say(`    of those, an admitted .nims                 ${partOf.operandsNamingAnAdmittedNims}`)
say(`    of those, an admitted .nimble               ${partOf.operandsNamingAnAdmittedNimble}`)
say(`  written extensions on include operands       ${fmt(partOf.writtenExtensions) || "(none — bare module paths)"}`)
say(`  the constructs the relabel does NOT move: import ${partOf.importSites.toLocaleString()} · from-import ${partOf.importFromSites.toLocaleString()} · export ${partOf.exportSites.toLocaleString()}`)
say(`  examples:`)
for (const e of partOf.examples.slice(0, 12)) say(`    ${e}`)
say()
say("== 3 · mixes_in — RULING SHAPE: `mixin` names SYMBOLS, not a composed supertype ==")
say(`  mixin statements                             ${mixesIn.mixinSites.toLocaleString()}`)
say(`  mixin operands                               ${mixesIn.mixinOperands.toLocaleString()}  shapes ${fmt(mixesIn.operandShapes)}`)
say(`  operands naming a DECLARED TYPE               ${mixesIn.operandsNamingADeclaredType}`)
say(`  operands naming a DECLARED ROUTINE            ${mixesIn.operandsNamingADeclaredRoutine}`)
say(`  operands naming NEITHER (external/generic)    ${mixesIn.operandsNamingNeither}`)
say(`  THE CONSTRUCTS THE RULING NAMES, ALL COUNTED:`)
say(`    object_declaration                          ${mixesIn.objectDeclarations.toLocaleString()} (with an "of" inherits field: ${mixesIn.objectDeclarationsWithInherits.toLocaleString()} — that construct is "extends")`)
say(`    object_type keyword                         ${mixesIn.objectTypeKeywords.toLocaleString()}`)
say(`    concept_declaration                         ${mixesIn.conceptDeclarations.toLocaleString()}`)
say(`    refinement_list                             ${mixesIn.refinementLists.toLocaleString()}`)
say(`    of_branch (VARIANT alternatives, NOT inheritance) ${mixesIn.ofBranches.toLocaleString()}`)
say(`  examples:`)
for (const e of mixesIn.examples.slice(0, 12)) say(`    ${e}`)
say()
say("== 4 · renders — RULING SHAPE: no COMPONENT can be named at a rendering site ==")
say(`  call sites (whole population)                ${renders.callSites.toLocaleString()}`)
say(`  render-host-shaped calls (name filter /render|html|component|vnode|jsx|view/i) ${renders.renderHostCalls.toLocaleString()}`)
say(`  render-host names                            ${fmt(renders.renderHostByName, 20)}`)
say(`  render-host function shapes                  ${fmt(renders.renderHostByFunctionShape)}`)
say(`  argument shapes                              ${fmt(renders.argumentShapes, 20)}`)
say(`  arguments that are STRING LITERALS           ${renders.argsStringLiteral.toLocaleString()} (a template NAME is a string, not a symbol reference)`)
say(`  arguments that are capitalized identifiers   ${renders.argsCapitalizedIdentifier.toLocaleString()}`)
say(`    of those, naming a DECLARED TYPE (THE COMPONENT PREDICATE — the falsifier) ${rendersComponentPredicateResolvedAfter}`)
say(`  arguments that are lowercase identifiers     ${renders.argsLowercaseIdentifier.toLocaleString()} (element/proc names, not components)`)
say(`  htmlgen-style HTML-ELEMENT calls (callee name IN the element vocabulary) ${renders.htmlElementCallsTotal.toLocaleString()} over ${renders.htmlElementCalls.size} distinct names · top ${fmt(renders.htmlElementCalls, 20)}`)
say(`  all plain lowercase-identifier calls (context only) ${renders.plainLowercaseIdentifierCalls.toLocaleString()}`)
say(`  examples:`)
for (const e of renders.examples.slice(0, 15)) say(`    ${e}`)
if (renders.argsDeclaredTypeExamples.length > 0) {
  say(`  ★ THE FALSIFIER CLASS FIRED — render-host arguments naming a declared type:`)
  for (const e of renders.argsDeclaredTypeExamples) say(`    ${e}`)
}

// ───────────────────────────────────────────────────────────── the REAL-ANALYZER cross-check
say()
say(`== THE CROSS-CHECK — ${sample.length} files (deterministic 1-in-${SAMPLE_EVERY} stride) through the REAL RealNimAnalyzer ==`)
let crossAnalyzerFiles = 0
let crossDecoratorAnalyzer = 0
let crossDecoratorCensus = 0
let crossDecoratorMisses = 0
let crossIncludeCensus = 0
let crossIncludeAnalyzer = 0
let crossIncludeMismatchFiles = 0
const crossMissExamples: string[] = []
const crossIncludeMismatch: string[] = []
try {
  const mod: any = await import(path.join(ROOT, "src/ast/real-nim-analyzer"))
  const analyzer = new mod.RealNimAnalyzer()
  for (const s of sample) {
    let tree: any
    try {
      tree = parser.parse(s.text)
      if (!tree) throw new Error("parse returned null")
      let res: any
      try {
        res = await analyzer.analyze(tree.rootNode, s.text, s.label)
      } finally {
        tree.delete()
      }
      crossAnalyzerFiles++
      const analyzerDecorators = new Set<string>()
      for (const sym of res?.symbols ?? []) {
        for (const d of sym?.decorators ?? []) analyzerDecorators.add(String(d))
      }
      const censusSet = new Set(s.declaredPragmaNames)
      crossDecoratorAnalyzer += analyzerDecorators.size
      crossDecoratorCensus += censusSet.size
      for (const d of analyzerDecorators) {
        if (!censusSet.has(d)) {
          crossDecoratorMisses++
          if (crossMissExamples.length < 12) crossMissExamples.push(`${s.label}: analyzer publishes decorator "${d}" that the census did not read from a declaration-owned pragma list`)
        }
      }
      const analyzerInclude = (res?.relationships ?? []).filter(
        (r: any) => r?.metadata?.relationshipType === "nim_include",
      ).length
      crossIncludeCensus += s.includeOperands
      crossIncludeAnalyzer += analyzerInclude
      if (analyzerInclude !== s.includeOperands) {
        crossIncludeMismatchFiles++
        if (crossIncludeMismatch.length < 12) crossIncludeMismatch.push(`${s.label}: census ${s.includeOperands} include operand(s) vs analyzer ${analyzerInclude} nim_include row(s)`)
      }
    } catch (e: any) {
      crossAnalyzerFiles++
      if (crossMissExamples.length < 12) crossMissExamples.push(`${s.label}: ANALYZER THREW ${String(e?.message ?? e).slice(0, 120)}`)
    }
  }
} catch (e: any) {
  console.error(`FATAL: could not load the real analyzer for the cross-check: ${String(e?.message ?? e)}`)
  process.exit(7)
}
say(`  sample files analyzed                        ${crossAnalyzerFiles}`)
say(`  analyzer-published decorator names           ${crossDecoratorAnalyzer}  (census read ${crossDecoratorCensus} from declaration-owned pragma lists in the same files)`)
say(`  analyzer decorators the census MISSED        ${crossDecoratorMisses}  ${crossMissExamples.length ? "" : ""}`)
for (const e of crossMissExamples) say(`    ${e}`)
say(`  include operands: census ${crossIncludeCensus} · analyzer nim_include rows ${crossIncludeAnalyzer} · files that disagree ${crossIncludeMismatchFiles}`)
for (const e of crossIncludeMismatch) say(`    ${e}`)
const crossCheckOk = crossDecoratorMisses === 0 && crossIncludeMismatchFiles === 0

// ───────────────────────────────────────────────────────────── write the artifact
const result = {
  instrument: "nim-extended-census",
  lane: "nim",
  generatedAt: new Date().toISOString(),
  population: {
    artifact: "validation/m14/measurements/nim-population.json",
    rule: pop.rule,
    root: pop.root,
    populationString: pop.populationString,
    admitted: pop.admitted,
    repos: pop.repos,
    filesWalked: counts.filesRead,
    parseFailed: counts.parseFailed,
    readFailed: counts.readFailed,
    errorFiles: counts.errorFiles,
    missingFiles: counts.missingFiles,
    nodesWalked: counts.nodes,
    emptyFiles: counts.emptyResults,
    guard: "filesAdmitted === filesRead AND parseFailed === 0 AND readFailed === 0, else exit 6 (the cpp lane's leaked-tree form)",
  },
  grammar: { wasm: "tree-sitter-nim.wasm", servedBytesSha256: GRAMMAR_SHA, source: wasmSource },
  decorates: {
    ruling: "ONTOLOGICAL (Lead, 2026-10-23) — a Nim pragma is a compiler directive; an annotation is passive metadata and a decorator is an applied callable (src/ast/types.ts:131-144; VOCABULARY-EXTENSION-PROPOSAL §3)",
    count: {
      pragmaLists: pragma.lists,
      pragmaEntries: pragma.entries,
      pragmaNamesTotal: [...pragma.names.values()].reduce((a, b) => a + b, 0),
      distinctPragmaNames: pragma.names.size,
      declarationOwnedPragmaLists: pragma.declarationOwnedLists,
      declarationOwnedPragmaNames: pragma.entryShapes.size ? pragma.declarationOwnedEntries : pragma.declarationOwnedEntries,
    },
    nameClasses: Object.fromEntries(pragmaClassCounts),
    ownerTypes: Object.fromEntries(topN(pragma.ownerTypes, 40)),
    entryShapes: Object.fromEntries(topN(pragma.entryShapes, 20)),
    analyzerDrops: Object.fromEntries(topN(pragma.analyzerDrops, 10)),
    topNames: Object.fromEntries(topN(pragma.names, 40)),
    falsifier: {
      class: "an APPLIED CALLABLE in a pragma position",
      declaredPragmaTemplates: Object.fromEntries(
        [...pragma.declaredPragmaTemplates.entries()].sort().map(([k, v]) => [k, v]),
      ),
      declaredPragmaTemplateNamesUsed: pragmaTemplateNamesUsed,
      appliedCallableSites: pragmaAppliedCallableSites,
      wouldFail:
        "THIS RULING IS REFUTED IF the applied-callable class is the decorates construct: the census counts every pragma site whose name resolves to a declared pragma template (`template/macro X() {.pragma.}`), and a non-zero count is the discriminator — the count is published above and in the declaration so the claim is checkable rather than asserted. A SECOND half: any grammar node type for an @-decorator application (none in the served inventory).",
    },
  },
  part_of: {
    decision: "1:1 RELABEL of imports->part_of for include_statement rows, KEEPING the analyzer's normalized module-name target with metadata.targetResolution = module-name and metadata.partRole = library; the divergence from fsharp/php (which emit project-relative paths) is RECORDED, never flattened",
    count: {
      includeSites: partOf.includeSites,
      includeOperands: partOf.includeOperands,
      operandShapes: Object.fromEntries(topN(partOf.operandShapes, 20)),
      operandsNamingAnAdmittedFile: partOf.operandsNamingAnAdmittedFile,
      operandsNamingAnAdmittedNims: partOf.operandsNamingAnAdmittedNims,
      operandsNamingAnAdmittedNimble: partOf.operandsNamingAnAdmittedNimble,
      writtenExtensions: Object.fromEntries(partOf.writtenExtensions),
      importSites: partOf.importSites,
      importFromSites: partOf.importFromSites,
      exportSites: partOf.exportSites,
    },
    examples: partOf.examples.slice(0, 30),
    crossCheck: {
      analyzerNimIncludeRowsOnSample: crossIncludeAnalyzer,
      censusIncludeOperandsOnSample: crossIncludeCensus,
      disagreeingFiles: crossIncludeMismatchFiles,
    },
  },
  mixes_in: {
    rulingShape: "mixin names SYMBOLS open for overload resolution; it composes no type into a supertype chain and declares no conformance",
    count: {
      mixinSites: mixesIn.mixinSites,
      mixinOperands: mixesIn.mixinOperands,
      operandShapes: Object.fromEntries(topN(mixesIn.operandShapes, 20)),
      operandsNamingADeclaredType: mixesIn.operandsNamingADeclaredType,
      operandsNamingADeclaredRoutine: mixesIn.operandsNamingADeclaredRoutine,
      operandsNamingNeither: mixesIn.operandsNamingNeither,
    },
    constructsNamedByTheRuling: {
      objectDeclarations: mixesIn.objectDeclarations,
      objectDeclarationsWithOfInheritance: mixesIn.objectDeclarationsWithInherits,
      objectTypeKeywords: mixesIn.objectTypeKeywords,
      conceptDeclarations: mixesIn.conceptDeclarations,
      refinementLists: mixesIn.refinementLists,
      ofBranchesVariantAlternatives: mixesIn.ofBranches,
    },
    examples: mixesIn.examples.slice(0, 30),
  },
  renders: {
    rulingShape: "Nim has no grammar-level rendering construct; rendering is a macro DSL over ordinary call nodes, so no position in a render-host call can name a COMPONENT TYPE",
    count: {
      callSites: renders.callSites,
      renderHostCalls: renders.renderHostCalls,
      renderHostByName: Object.fromEntries(topN(renders.renderHostByName, 30)),
      renderHostByFunctionShape: Object.fromEntries(topN(renders.renderHostByFunctionShape, 10)),
      argumentShapes: Object.fromEntries(topN(renders.argumentShapes, 20)),
      argsStringLiteral: renders.argsStringLiteral,
      argsCapitalizedIdentifier: renders.argsCapitalizedIdentifier,
      argsNamingADeclaredType: renders.argsNamingADeclaredType,
      argsLowercaseIdentifier: renders.argsLowercaseIdentifier,
      htmlElementCallsTotal: renders.htmlElementCallsTotal,
      htmlElementCallsDistinct: renders.htmlElementCalls.size,
      topHtmlElementCalls: Object.fromEntries(topN(renders.htmlElementCalls, 20)),
      plainLowercaseIdentifierCalls: renders.plainLowercaseIdentifierCalls,
    },
    examples: renders.examples.slice(0, 30),
    falsifier: {
      class: "a render-host call whose argument or explicit type argument names a CONCRETE COMPONENT TYPE",
      measured: rendersComponentPredicateResolvedAfter,
      wouldFail:
        "THIS RULING IS REFUTED IF any render-host-shaped call in the admitted population carries an argument that names a declared type used as a component — the census counts the render-host calls and classifies every argument, so the falsifier is a number in this file (measured: " +
        rendersComponentPredicateResolvedAfter +
        "). The grammar half is validation/m14/measurements/nim-grammar-nodes.json (the served build's own named node types, 0 render/component families).",
    },
  },
  crossCheck: {
    sampleEvery: SAMPLE_EVERY,
    sampleFiles: crossAnalyzerFiles,
    analyzerDecoratorNames: crossDecoratorAnalyzer,
    censusDecoratorNames: crossDecoratorCensus,
    analyzerDecoratorsMissedByCensus: crossDecoratorMisses,
    includeMismatchFiles: crossIncludeMismatchFiles,
    pass: crossCheckOk,
    misses: crossMissExamples,
    includeMismatches: crossIncludeMismatch,
  },
  // ★ THE DECLARED-NAME INDEX IS PUBLISHED SO THE CAUSE CENSUS CAN CLASSIFY A WALL ROW AGAINST
  //   "declared elsewhere in THIS project / in ANOTHER repository / nowhere" without a second
  //   parse of the population. One instrument walks the tree; the second reads what the first saw.
  declaredNameIndex: {
    byRepo: Object.fromEntries(
      [...declaredByRepo.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([repo, e]) => [
        repo,
        { routines: [...e.routines].sort(), types: [...e.types].sort() },
      ]),
    ),
    moduleBasenamesByRepo: Object.fromEntries(
      [...moduleBasenamesByRepo.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([repo, e]) => [repo, [...e].sort()]),
    ),
    counts: {
      routines: declaredRoutineNames.size,
      types: declaredTypeNames.size,
      moduleBasenames: indexBasenames.size,
      repos: declaredByRepo.size,
    },
  },
  nodeCensus: Object.fromEntries(
    [...nodeTypes.entries()]
      .filter(([t]) => /pragma|mixin|include|import|export|part|render|component|jsx|html|template|concept|object|of_branch|call$|refinement/.test(t))
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => [t, { occurrences: n, files: nodeTypeFiles.get(t)?.size ?? 0 }]),
  ),
}

if (JSON_OUT && SMOKE === 0) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(JSON_OUT, JSON.stringify(result, null, 2))
  say()
  say(`WROTE ${JSON_OUT}`)
}

say()
say(`CROSS-CHECK: ${crossCheckOk ? "PASS" : "FAIL"} — analyzer decorators missed ${crossDecoratorMisses}, include disagreements ${crossIncludeMismatchFiles}`)
if (!crossCheckOk && SMOKE === 0) process.exit(7)
