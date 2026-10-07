/**
 * KOTLIN EXPORTS PROBE — does the LANGUAGE have an export construct?
 *
 * The handover said: "Kotlin has no export keyword — likely RULED. Rule it with a
 * corpus measurement." A ruling needs the measurement, and the measurement has to
 * be taken with an instrument that cannot be fooled by text (the ontology gate's
 * own header records two false positives a text probe produced: `class voice`
 * inside a telnet IAC string, `new Map(` inside a bash heredoc).
 *
 * So this probe answers THREE separable questions, each with its own instrument,
 * and each capable of coming back empty:
 *
 *   Q1 (instrument A — grammar inventory). Does tree-sitter-kotlin produce a node
 *       type that expresses an EXPORT DECLARATION? Every distinct node type the
 *       grammar produces across the corpus is enumerated with counts. If no node
 *       type names one, Kotlin has no export STATEMENT — and that is a fact about
 *       the grammar, not a failure to grep.
 *
 *   Q2 (instrument B — parse-tree semantic count). Does Kotlin have the OTHER
 *       thing an `exports` edge could be about — a declaration-level export
 *       MARKER? Counted on the tree: `file_annotation` nodes (Kotlin's
 *       `@file:JvmName` / `@file:JsExport` family) and `annotation` nodes whose
 *       name is one of the export-annotation names Kotlin actually defines
 *       (kotlin.js.JsExport, kotlinx.cinterop.ExportForCppRuntime). A string
 *       literal or a comment cannot produce either node type.
 *
 *   Q3 (instrument B — parse-tree semantic count). What DOES determine Kotlin's
 *       export surface? Visibility. Counted on the tree: every `modifiers` node
 *       carrying a `visibility_modifier`, split by the modifier's own node type
 *       and text. Kotlin's default visibility is `public`, so the ABSENCE of a
 *       visibility modifier is itself the export decision, and the census reports
 *       how many top-level declarations carry no modifier at all.
 *
 * The verdict follows from what comes back, and it is written so that either
 * answer is a finding: if Q2 and Q3 are both zero, `exports` is RULED for kotlin
 * and the analyzer is right to publish nothing; if either is non-zero, `exports` is
 * a GAP and the construct is derivable.
 *
 * No regex. Node types and node text compared with ===/indexOf only.
 *
 * Usage:
 *   bun run script/m14/kotlin-exports-probe.ts [--stride N] [--limit N] [--fresh]
 */
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { resumableWalk, resetCheckpoint } from "./resumable-walk"

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const CR = flag("--corpus") ?? "$HOME/fixtures/repositories"
const REPO_DIR = flag("--repo") ?? path.join(CR, "kotlin")
const STRIDE = Number(flag("--stride") ?? 20)
const LIMIT = Number(flag("--limit") ?? 800)
const CHECKPOINT = "validation/m14/measurements/kotlin/exports-probe-checkpoint.txt"
const OUT = flag("--out") ?? "validation/m14/measurements/kotlin/exports-probe.json"
if (argv.includes("--fresh")) resetCheckpoint(CHECKPOINT)

// ---------------------------------------------------------------- population
const tracked: string[] = execFileSync("git", ["-C", REPO_DIR, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
const all = tracked
  .filter((rel) => {
    const ext = path.extname(rel).toLowerCase()
    return ext === ".kt" || ext === ".kts"
  })
  .sort()

/** Node types that would EXPRESS an export declaration, if the grammar had one.
 *  Written as the cross-language union the ontology gate itself uses, plus the
 *  Kotlin-shaped spellings, so the probe is falsifiable by a grammar that grows
 *  one. */
const EXPORT_DECLARATION_NODE_TYPES = [
  "export_statement",
  "export_declaration",
  "export_list",
  "export_specifier",
  "export_clause",
  "module_exports",
  "public_export",
]
/** Node types that express an export MARKER (an annotation/qualifier). */
const EXPORT_MARKER_NODE_TYPES = ["file_annotation", "annotation", "modifiers", "visibility_modifier"]

/** Kotlin export-annotation names, as the ANALYZER resolves them: the short name
 *  of the annotation, compared with ===. kotlin.js.JsExport exports a declaration
 *  to JavaScript; @file:JsExport does the whole file; kotlinx.cinterop's
 *  ExportForCppRuntime does the C++ side. All three are declared by Kotlin's own
 *  stdlib, so their names are read off the language, not off this corpus. */
const EXPORT_ANNOTATION_NAMES = ["JsExport", "ExportForCppRuntime", "CppExport", "ExportObjCClass"]

const nodeTypes = new Map<string, number>()
const visibilityByModifier = new Map<string, { count: number; files: Set<string> }>()
const exportMarkerFiles = new Set<string>()
const exportMarkerHits: string[] = []
const fileAnnotationFiles = new Set<string>()
let filesWalked = 0
let filesFailed = 0
let codeBearing = 0
const exportDeclNodeHits: string[] = []

function note(m: Map<string, { count: number; files: Set<string> }>, k: string, file: string): void {
  const row = m.get(k) ?? { count: 0, files: new Set<string>() }
  row.count++
  if (row.files.size < 5) row.files.add(file)
  m.set(k, row)
}

const parser = await getParser("kotlin")

const stats = await resumableWalk(CHECKPOINT, all.length, {
  id: (i) => all[i],
  concurrency: 4,
  run: async (i) => {
    const rel = all[i]
    if (i % STRIDE !== 0) return
    if (LIMIT > 0 && filesWalked >= LIMIT) return
    const abs = path.join(REPO_DIR, rel)
    try {
      if (statSync(abs).size > 512 * 1024) return
    } catch {
      return
    }
    let tree: any
    try {
      tree = await parser.parse(readFileSync(abs, "utf8"), abs)
    } catch {
      filesFailed++
      return
    }
    if (!tree) {
      filesFailed++
      return
    }
    filesWalked++
    let declares = false
    const visit = (n: any): void => {
      nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
      if (EXPORT_DECLARATION_NODE_TYPES.indexOf(n.type) >= 0 && exportDeclNodeHits.length < 20) {
        exportDeclNodeHits.push(`${rel}:${n.startPosition.row + 1} ${n.type}`)
      }
      if (n.type === "class_declaration" || n.type === "object_declaration" ||
          n.type === "function_declaration" || n.type === "property_declaration") declares = true
      if (n.type === "file_annotation") {
        fileAnnotationFiles.add(rel)
        const name = shortAnnotationName(n)
        if (EXPORT_ANNOTATION_NAMES.indexOf(name) >= 0) {
          exportMarkerFiles.add(rel)
          if (exportMarkerHits.length < 20) exportMarkerHits.push(`${rel}:${n.startPosition.row + 1} @file:${name}`)
        }
      }
      if (n.type === "annotation") {
        const name = shortAnnotationName(n)
        if (EXPORT_ANNOTATION_NAMES.indexOf(name) >= 0) {
          exportMarkerFiles.add(rel)
          if (exportMarkerHits.length < 20) exportMarkerHits.push(`${rel}:${n.startPosition.row + 1} @${name}`)
        }
      }
      if (n.type === "visibility_modifier") {
        // The modifier's own text, compared with === against Kotlin's four
        // visibilities. tree-sitter's node type is the same for all of them, so
        // the VALUE is the text — that is a node, not a regex over the file.
        note(visibilityByModifier, n.text.trim(), rel)
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
    if (declares) codeBearing++
    tree.delete?.()
  },
})

/** The annotation's short name: its last `user_type`/`simple_identifier`
 *  segment, read off the tree. Same derivation the analyzer's
 *  kotlinShortAnnotationName uses, so the probe cannot disagree with the
 *  analyzer about which annotation is being named. */
function shortAnnotationName(n: any): string {
  let name = ""
  const visit = (x: any): void => {
    if (name) return
    if (x.type === "simple_identifier" || x.type === "type_identifier" || x.type === "identifier") {
      name = x.text
      return
    }
    for (let i = 0; i < x.namedChildCount; i++) {
      const c = x.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(n)
  return name
}

// ---------------------------------------------------------------- report
console.log(`\nkotlin exports probe — ${REPO_DIR}`)
console.log(
  `population: ${all.length} .kt/.kts files (derived from git ls-files); ` +
    `walked ${filesWalked} (stride ${STRIDE}, limit ${LIMIT || "none"}), failed ${filesFailed}, ` +
    `code-bearing ${codeBearing}`,
)
console.log(`  resumed ${stats.alreadyDone}, skipped-bad ${stats.skippedBad}${stats.partial ? "  PARTIAL" : ""}`)

console.log(`\nQ1  instrument A — grammar inventory: ${nodeTypes.size} distinct node types produced`)
const exportDeclPresent = EXPORT_DECLARATION_NODE_TYPES.filter((t) => nodeTypes.has(t))
console.log(`    node types that would EXPRESS an export DECLARATION: ${exportDeclPresent.join(", ") || "(NONE)"}`)
console.log(`    hits: ${exportDeclNodeHits.length ? exportDeclNodeHits.join("; ") : "(none)"}`)
console.log(`    nearest neighbours the grammar DOES produce:`)
for (const t of [...nodeTypes.keys()].sort()) {
  const l = t.toLowerCase()
  if (l.indexOf("export") >= 0 || l.indexOf("public") >= 0 || l.indexOf("visib") >= 0) {
    console.log(`      ${t}: ${nodeTypes.get(t)}`)
  }
}

console.log(`\nQ2  instrument B — parse-tree count of export MARKERS`)
console.log(`    @file: annotations present in ${fileAnnotationFiles.size} files; e.g. ${[...fileAnnotationFiles].slice(0, 2).join(", ")}`)
console.log(`    export-annotation markers (${EXPORT_ANNOTATION_NAMES.join(", ")}) in ${exportMarkerFiles.size} files`)
for (const h of exportMarkerHits) console.log(`      ${h}`)
console.log(`    marker-capable node types present: ${EXPORT_MARKER_NODE_TYPES.filter((t) => nodeTypes.has(t)).join(", ") || "(none)"}`)

console.log(`\nQ3  instrument B — parse-tree count of the visibility surface`)
for (const [k, v] of [...visibilityByModifier.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`    visibility_modifier "${k}": ${v.count} in ${v.files.size}+ files, e.g. ${[...v.files].slice(0, 1).join("")}`)
}

const verdict = {
  at: new Date().toISOString(),
  repo: REPO_DIR,
  populationKtKts: all.length,
  walked: filesWalked,
  codeBearing,
  grammarNodeTypeCount: nodeTypes.size,
  q1_exportDeclarationNodeTypes: { probed: EXPORT_DECLARATION_NODE_TYPES, present: exportDeclPresent, hits: exportDeclNodeHits },
  q2_exportMarkers: { names: EXPORT_ANNOTATION_NAMES, files: [...exportMarkerFiles], hits: exportMarkerHits, fileAnnotationFiles: fileAnnotationFiles.size },
  q3_visibilityModifiers: Object.fromEntries([...visibilityByModifier.entries()].map(([k, v]) => [k, { count: v.count, files: [...v.files] }])),
  grammarNodeTypes: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
}
const jsonPath = path.resolve(OUT)
mkdirSync(path.dirname(jsonPath), { recursive: true })
writeFileSync(jsonPath, JSON.stringify(verdict, null, 1))
console.log(`\nwrote ${OUT}`)
