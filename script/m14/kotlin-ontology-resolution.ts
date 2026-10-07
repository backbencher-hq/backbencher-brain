/**
 * KOTLIN ONTOLOGY RESOLUTION + CONSTRUCT PROBES — LANE-OWNED (`analyzer/DERIV_OVERRIDES`).
 *
 * Sibling of `script/m14/kotlin-ontology-census.ts` (which measures PRESENCE) and
 * of the shared `script/m14/differential.ts` (which measures AGREEMENT). This one
 * answers the two questions neither of those can:
 *
 *   Q5 RESOLVED — for each emitted edge, do BOTH endpoints bind to a symbol the
 *   analyzer itself published for that file? Measured, not asserted: the css
 *   `references` figure the workstream quotes (66.8% at both ends) is the shape
 *   of question this file asks of kotlin, and a lane that has never asked it
 *   cannot report it.
 *
 *   CONSTRUCT PROBES — an independent tree-sitter walk over the SAME grammar,
 *   counting the node/keyword shapes each ontology type would need. This is the
 *   gate's "instrument B: parse-tree count", applied to kotlin. Its purpose is
 *   falsifiability: a type ruled inapplicable here can be overturned by a
 *   non-zero probe count, which is precisely what the workstream says prose
 *   alone cannot do.
 *
 * NO REGEX (rule R2). String tests are `.startsWith`/`.endsWith`/`.includes`/
 * `.split`, which cannot match inside a comment or a string literal the way a
 * pattern over raw source text can.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"

/**
 * The ten ontology types in the SERIALISED spelling an analyzer emits, with the
 * two spellings of the import label folded onto one row. `src/ast/types.ts:69`
 * says `Imports = "brain_import"`; `src/ast/engine.ts:454` — the namespace every
 * analyzer imports as `ASTEngine.RelationshipType` — says `Imports = "imports"`,
 * and no analyzer emits the string "brain_import". Reading the stale duplicate
 * measures a permanent silent zero, which is the false absence this workstream
 * exists to catch. Same treatment as `script/m60/java-ontology-census.ts`.
 */
const ALL_TYPES: string[] = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const WIRE_ALIASES: Record<string, string> = { imports: "imports", brain_import: "imports" }
const wireOf = (v: string): string | null => {
  const t = WIRE_ALIASES[v] ?? v
  return ALL_TYPES.includes(t) ? t : null
}
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.argv[2] ?? "kotlin"
const LIMIT = Number(process.env.BB_KT_LIMIT ?? 200)

/**
 * The placeholder literals rule R7 forbids in a name-bearing field. Every entry
 * here is a string this analyzer can actually produce — a probe that convicts on
 * a word the lane never emits measures nothing.
 */
const PLACEHOLDERS = ["Global", "root", "unknown", "constructor", "super", "this", "object", "TODO", "None", "null", "undefined"]

const dir = path.join(CR, REPO)
const tracked: string[] = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
const files: string[] = []
for (const rel of tracked) {
  const abs = path.join(dir, rel)
  let text: string
  try {
    if (statSync(abs).size > 2 * 1024 * 1024) continue
    text = readFileSync(abs, "utf8")
  } catch { continue }
  if (detectLanguageFromPath(abs, text) !== REPO) continue
  files.push(abs)
}
files.sort()
const run = files.slice(0, LIMIT)
console.log(`kotlin ontology resolution + construct probes — ${REPO}`)
console.log(`corpus: ${run.length} files\n`)

// ---------------------------------------------------------------- Q5 resolution
type Res = {
  total: number
  srcInFile: number
  tgtInFile: number
  tgtBare: number
  tgtBareInFile: number
  tgtQualified: number
  qualified: number
  qualifiedSrcOwner: number
  qualifiedTgtOwner: number
  placeholders: number
  empty: number
  samples: string[]
}
const newRes = (): Res => ({ total: 0, srcInFile: 0, tgtInFile: 0, tgtBare: 0, tgtBareInFile: 0, tgtQualified: 0, qualified: 0, qualifiedSrcOwner: 0, qualifiedTgtOwner: 0, placeholders: 0, empty: 0, samples: [] })
const res = new Map<string, Res>()
const placeholderTally = new Map<string, number>()

let idx = 0
async function worker(): Promise<void> {
  const parser = await getParser(REPO as any)
  while (true) {
    const i = idx++
    if (i >= run.length) return
    const abs = run[i]
    let r: any
    try { r = await parseFile(abs, dir) } catch { continue }
    const names = new Set<string>()
    for (const s of r.symbols ?? []) names.add(String(s?.name ?? ""))
    for (const x of r.relationships ?? []) {
      const t = wireOf(String(x?.type ?? ""))
      if (!t) continue
      const row = res.get(t) ?? newRes()
      row.total++
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      // A QUALIFIED endpoint is `Owner.member` — the shape every override edge
      // uses. Testing it against the flat symbol-name set reads 0% for a type
      // whose resolution is 100%, which is how a correct edge gets convicted by
      // a broken probe. Split at the LAST dot and test the member half, which is
      // the half that must name a declared symbol.
      const srcMember = src.includes(".") ? src.slice(src.lastIndexOf(".") + 1) : src
      const tgtMember = tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
      if (names.has(src) || names.has(srcMember)) row.srcInFile++
      if (names.has(tgt) || names.has(tgtMember)) row.tgtInFile++
      const bare = !tgt.includes(".")
      if (bare) { row.tgtBare++; if (names.has(tgt)) row.tgtBareInFile++ } else row.tgtQualified++
      // For a QUALIFIED endpoint the honest question is TWO questions: does the
      // OWNER half name a type this file declared, and does the MEMBER half name
      // a member it declared? A `Parent.method` whose member matches but whose
      // owner is external is a real edge pointing outside the file, and reporting
      // it as resolved would be the same lie the workstream quotes for css.
      if (!bare) {
        row.qualified++
        if (names.has(tgt.slice(0, tgt.lastIndexOf(".")))) row.qualifiedTgtOwner++
        if (src.includes(".") && names.has(src.slice(0, src.lastIndexOf(".")))) row.qualifiedSrcOwner++
      }
      for (const v of [src, tgt]) {
        if (v === "") { row.empty++; continue }
        for (const p of PLACEHOLDERS) {
          if (v === p) {
            row.placeholders++
            placeholderTally.set(`${p} (${t})`, (placeholderTally.get(`${p} (${t})`) ?? 0) + 1)
          }
        }
      }
      if (row.samples.length < 2 && !names.has(tgt) && !names.has(tgtMember)) row.samples.push(`${src} -> ${tgt}`)
      res.set(t, row)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const pc = (n: number, d: number): string => (d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log("Q5 RESOLUTION — does each endpoint bind to a symbol this file published?")
console.log(`${w("type", 14)}${w("edges", 9)}${w("src→file", 10)}${w("tgt→file", 10)}${w("bare tgt", 10)}${w("qual tgt", 10)}${w("qual OWNER in-file", 17)}${w("R7 ph", 8)}empty`)
console.log("-".repeat(110))
for (const t of ALL_TYPES) {
  const r = res.get(t)
  if (!r) { console.log(`${w(t, 14)}0 emitted`); continue }
  console.log(`${w(t, 14)}${w(String(r.total), 9)}${w(`${pc(r.srcInFile, r.total)}`, 10)}${w(`${pc(r.tgtInFile, r.total)}`, 10)}${w(`${pc(r.tgtBare, r.total)}`, 10)}${w(`${r.tgtQualified} ${pc(r.tgtQualified, r.total)}`, 10)}${w(`${r.qualifiedTgtOwner}/${r.qualified} ${pc(r.qualifiedTgtOwner, Math.max(1, r.qualified))}`, 17)}${w(String(r.placeholders), 8)}${r.empty}`)
}
console.log(`\nR7 placeholder endpoints by literal and type:`)
for (const [k, n] of [...placeholderTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 30)}${n}`)
console.log(`\nunresolved-target examples:`)
for (const [t, r] of res) if (r.samples.length) console.log(`  ${t}: ${r.samples.join("  |  ")}`)

// ---------------------------------------------------------------- construct probes
/** Does this declaration carry a modifier whose keyword is exactly `word`? */
function hasModifierKeyword(decl: any, word: string): boolean {
  for (const c of decl.namedChildren) {
    if (c.type !== "modifiers") continue
    for (const m of c.namedChildren) {
      for (let i = 0; i < m.childCount; i++) {
        const tok = m.child(i)
        if (tok && !tok.isNamed && tok.text === word) return true
      }
    }
  }
  return false
}

const probe = { overridesFn: 0, overridesProp: 0, overridesFiles: new Set<string>(), importHeader: 0, importFiles: new Set<string>(), topLevelPublic: 0, topLevelNonPublic: 0, exportFiles: new Set<string>(), delegationSpecifier: 0, classDecl: 0, objectLiteral: 0, indexAccess: 0, callableRef: 0, interpolatedId: 0, typeAlias: 0, companionObject: 0, enumEntry: 0, anonInitializer: 0, nodeTypes: new Map<string, number>(), filesWithErrors: 0, filesParsed: 0, barePascalCall: 0, todoCall: 0, todoExamples: [] as string[] }

/** Count every node of `type` anywhere under `n`, and tally the whole vocabulary. */
function walkCount(n: any, type: string): number {
  let c = n.type === type ? 1 : 0
  for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) c += walkCount(ch, type) }
  return c
}

/** A top-level declaration: a direct named child of source_file. */
function isTopLevelDecl(n: any): boolean {
  return n.type === "function_declaration" || n.type === "class_declaration" || n.type === "property_declaration" || n.type === "type_alias" || n.type === "object_declaration"
}

/**
 * FULL-TREE walk. The first version of this probe read only source_file's direct
 * children and reported 0 `override fun` declarations over 200 real files while
 * the analyzer emitted 685 override edges from the same trees — because an
 * `override fun` is a member of a `class_body`, so it is never a direct child of
 * the file. A probe that counts the wrong subtree reports 0, and 0 is the number a
 * RULED verdict needs, so a narrow probe manufactures exactly the evidence the
 * workstream was written to distrust. Same for `import_header`, which the grammar
 * wraps in `import_list`.
 */
/**
 * The callee of a `call_expression`, read structurally: the FIRST named child.
 * A `simple_identifier` is a receiver-less (BARE) call; a `navigation_expression`
 * is a QUALIFIED one. The analyzer's construction rule keys off exactly this
 * distinction — bare PascalCase is `instantiates`, qualified PascalCase is `calls` —
 * so the probe below measures the rule's own input rather than a text pattern.
 */
function calleeIsBare(n: any): boolean {
  const first = n.namedChild(0)
  return !!first && first.type === "simple_identifier"
}
function calleeLeaf(n: any): string {
  const first = n.namedChild(0)
  if (!first) return ""
  if (first.type === "simple_identifier") return first.text
  if (first.type === "navigation_expression") {
    const sel = first.namedChild(first.namedChildCount - 1)
    const leaf = sel?.namedChild?.(sel.namedChildCount - 1)
    return leaf?.text ?? ""
  }
  return ""
}

function walkAll(n: any, perFile: { sawOverride: boolean; sawImport: boolean }): void {
  probe.nodeTypes.set(n.type, (probe.nodeTypes.get(n.type) ?? 0) + 1)
  if (n.type === "function_declaration" && hasModifierKeyword(n, "override")) { probe.overridesFn++; perFile.sawOverride = true }
  if (n.type === "property_declaration" && hasModifierKeyword(n, "override")) { probe.overridesProp++; perFile.sawOverride = true }
  if (n.type === "import_header") { probe.importHeader++; perFile.sawImport = true }
  if (n.type === "call_expression" && calleeIsBare(n)) {
    const leaf = calleeLeaf(n)
    const c0 = leaf.charCodeAt(0)
    if (Number.isFinite(c0) && c0 >= 65 && c0 <= 90) {
      probe.barePascalCall++
      // `TODO()` is kotlin.NotImplementedError's marker FUNCTION, written with a
      // capital letter. The construction rule reads the capital and publishes
      // `instantiates`, which is a mislabel: nothing is constructed.
      if (leaf === "TODO") {
        probe.todoCall++
        if (probe.todoExamples.length < 3) probe.todoExamples.push(n.text.replace(/\n/g, " ").slice(0, 70))
      }
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkAll(c, perFile) }
}

const parser = await getParser(REPO as any)
for (const abs of run) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = (await (parser as any).parse(text, abs)) as any } catch { continue }
  const root = tree?.rootNode
  if (!root) continue
  probe.filesParsed++
  if (root.hasError) probe.filesWithErrors++
  const perFile = { sawOverride: false, sawImport: false }
  walkAll(root, perFile)
  if (perFile.sawOverride) probe.overridesFiles.add(abs)
  if (perFile.sawImport) probe.importFiles.add(abs)
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (!c) continue
    if (c.type === "function_declaration" || c.type === "class_declaration" || c.type === "property_declaration" || c.type === "type_alias" || c.type === "object_declaration") {
      // Kotlin's module surface: a top-level declaration with neither `private`
      // nor `internal` is visible outside its file.
      if (hasModifierKeyword(c, "private") || hasModifierKeyword(c, "internal")) probe.topLevelNonPublic++
      else { probe.topLevelPublic++; probe.exportFiles.add(abs) }
    }
    probe.delegationSpecifier += walkCount(c, "delegation_specifier")
    probe.classDecl += walkCount(c, "class_declaration")
    probe.objectLiteral += walkCount(c, "object_literal")
    probe.indexAccess += walkCount(c, "indexing_expression")
    probe.callableRef += walkCount(c, "callable_reference")
    probe.interpolatedId += walkCount(c, "interpolated_identifier")
    probe.typeAlias += walkCount(c, "type_alias")
    probe.companionObject += walkCount(c, "companion_object")
    probe.enumEntry += walkCount(c, "enum_entry")
    probe.anonInitializer += walkCount(c, "anonymous_initializer")
  }
}

console.log(`\nCONSTRUCT PROBES (instrument B — parse-tree counts over the same grammar, independent walk)`)
console.log(`  files parsed / with ERROR     ${probe.filesParsed} / ${probe.filesWithErrors}`)
console.log(`  distinct node types observed  ${probe.nodeTypes.size}`)
console.log(`  override fun declarations           ${probe.overridesFn} in ${probe.overridesFiles.size} file(s)`)
console.log(`  override val/var properties         ${probe.overridesProp}  <-- the analyzer emits NO edge for these`)
console.log(`  bare receiver-less PascalCase calls ${probe.barePascalCall}   of which callee leaf TODO(): ${probe.todoCall}`)
if (probe.todoExamples.length) console.log(`    TODO() sites: ${probe.todoExamples.join(" | ")}`)
console.log(`  import_header nodes                 ${probe.importHeader} in ${probe.importFiles.size} file(s)`)
console.log(`  top-level PUBLIC declarations       ${probe.topLevelPublic} in ${probe.exportFiles.size} file(s)`)
console.log(`  top-level private/internal decls    ${probe.topLevelNonPublic}   (excluded from the exports surface)`)
console.log(`  delegation_specifier (heritage)     ${probe.delegationSpecifier}`)
console.log(`  class_declaration                   ${probe.classDecl}`)
console.log(`  object_literal (anonymous types)    ${probe.objectLiteral}`)
console.log(`  indexing_expression                 ${probe.indexAccess}`)
console.log(`  callable_reference                  ${probe.callableRef}`)
console.log(`  interpolated_identifier             ${probe.interpolatedId}`)
console.log(`  type_alias                          ${probe.typeAlias}`)
console.log(`  companion_object                    ${probe.companionObject}`)
console.log(`  enum_entry                          ${probe.enumEntry}`)
console.log(`  anonymous_initializer               ${probe.anonInitializer}`)
if (process.env.BB_KT_NODETYPES) {
  console.log(`\nnode-type vocabulary (top 60):`)
  console.log([...probe.nodeTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, v]) => `${k}:${v}`).join("  "))
}
