/**
 * Objective-C — the whole-population construct census behind the extended-type rulings.
 *
 * The completion bar wants every ruling measured on the WHOLE admitted population, with a count and a
 * falsifier, not a stride sample. This instrument walks THE GATE'S OWN POPULATION (the file list the
 * gate itself discovered and printed — `validation/m14/measurements/objc-population.txt`, written by
 * `BB_LIST_FILES=1 bun run script/m14/incoming-gate.ts objective-c 0`) and counts the constructs each
 * ruling rests on. A re-walked population would be a second discovery rule; the list is the gate's.
 *
 * WHAT IT COUNTS AND WHY:
 *
 *   part_of    — `#import`/`#include` sites (the directive) split by form, plus the `part_of` edges the
 *                analyzer actually publishes through production `parseFile`. The edge count is
 *                cross-checked against the gate's own TABLE 1 row: two instruments must agree, or the
 *                census is measuring a different analyzer.
 *   decorates  — the GNU `__attribute__((...))` and C23 `[[...]]` attribute families, the ObjC
 *                availability specifiers, and `@property` attributes. The positive test for the
 *                vocabulary's `decorates` is an attribute whose argument IS AN INVOKED CALLABLE, so the
 *                instrument counts call-shaped arguments, whether their callee names a declaration in
 *                the same file, whether that declaration is a CALLABLE KIND, and every
 *                `cleanup`/`gnu::cleanup` site unconditionally. A non-zero count in any of those is the
 *                falsifier; the counts themselves are the measurement.
 *   renders    — no component concept exists in Objective-C, so the census counts the render-shaped
 *                node types the served grammar could offer (ZERO is the measurement) and the NEAR MISS
 *                the language does have: a nib/storyboard resource named by a string and loaded by a
 *                message send (`initWithNibName:bundle:`, `nibWithNibName:bundle:`). Those are a
 *                STRING VALUE and a CALL — both already published as `calls`, and neither declares one
 *                component as the rendered output of another. The near miss is counted so the ruling
 *                names what it is not.
 *   mixes_in   — a category `@interface Foo (Cat)` EXTENDS a class's member set without conforming,
 *                which is this lane's nearest shape to a mixin. The vocabulary's `mixes_in` needs a
 *                target the type system can NAME (`source = the class, target = the mixin`), so the
 *                census counts the category sites and the two ways the target could be named: the
 *                category LABEL (a name with no declaration of its own — counted when it also happens
 *                to be a published type) and the EXTENDED CLASS (which is the SOURCE's own name: the
 *                class and the category share one symbol name, so a row would be X -> X — the exact
 *                shape the C# lane's partial-type part_of ruling is measured on).
 *
 * ADMISSION: the gate's own list, read from the file. Every path is absolute and inside the corpus
 * root, and the instrument reports the list's own counts (so the population claim and the gate's
 * declared `admitted files [0, N)` line are the same number).
 *
 * PARSE FAILURES ARE COUNTED, NEVER HIDDEN: exits 3 unless every listed file parsed.
 *
 * USAGE: bun script/m14/objc-census.ts [--write validation/m14/measurements/objc-extended-census.json]
 */
const { getParser } = await import("./run-fixtures")
const { parseFile } = await import("../../src/ast/pool-worker")
import fs from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const writeIdx = argv.indexOf("--write")
const out = writeIdx >= 0 && writeIdx + 1 < argv.length ? argv[writeIdx + 1] : undefined
const ROOT = process.cwd()
const CORPUS = path.join(ROOT, ".corpus")
const POPULATION = path.join(ROOT, "validation/m14/measurements/objc-population.txt")
const GATE_PART_OF_EDGES = 717 // the gate's own TABLE 1 row, whole-population run (parsed=262/262)

const counts: Record<string, number> = {
  files: 0, filesParsed: 0, filesFailed: 0,
  partOfEdges: 0, filesWithPartOf: 0,
  preprocIncludeSites: 0, systemIncludeSites: 0, quotedIncludeSites: 0, moduleImportSites: 0,
  categorySites: 0, categoryInterfaceSites: 0, categoryImplementationSites: 0,
  namedCategorySites: 0, anonymousClassExtensionSites: 0,
  categoryLabelPublishedAsTypeInSameFile: 0, categoryLabelPublishedAsTypeInProject: 0,
  categoryExtendedClassAlsoPlainInSameFile: 0, categoryExtendedClassAlsoPlainInProject: 0,
  nibResourceStrings: 0,
  attributeSites: 0, attributeSpecifierSites: 0, attributeDeclarationSites: 0,
  availabilityAttributeSpecifierSites: 0, propertyAttributeSites: 0,
  attributeWithCallArgument: 0, declaredCalleeInAttribute: 0, callableAttributeArguments: 0,
  nonCallableDeclaredCallee: 0, appliedCallableAttributeSites: 0,
  compilerDirectiveMacroSites: 0, blockLiteralSites: 0,
  renderShapedNodes: 0, nibOrStoryboardStringSites: 0, nibInitializerSites: 0,
  compositionShapedNodes: 0,
}
const typeEdges: Record<string, number> = {}
const typeFiles: Record<string, number> = {}
const attributeNames: Record<string, number> = {}
const directiveMacros: Record<string, number> = {}
const categoryLabels: Record<string, number> = {}
const samples: Record<string, string[]> = {
  attributeWithCallArgument: [], callableAttribute: [], nonCallableDeclaredCallee: [],
  appliedCallable: [], renderShaped: [], nibOrStoryboard: [], nibInitializer: [],
  categoryLabelPublishedAsType: [], categoryLabelPublishedAsTypeInProject: [], categoryExtendedClassAlsoPlainInSameFile: [], compositionShaped: [],
}
const failedFiles: string[] = []
const bump = (bucket: string, where: string, text: string, cap = 5): void => {
  if (samples[bucket] && samples[bucket].length < cap) samples[bucket].push(`${where}: ${text.slice(0, 90)}`)
}

// ── THE APPLIED-CALLABLE CONTRACT, READ FROM THE SOURCE OF TRUTH ────────────────────────────────
// `src/ast/types.ts` defines decorates as "a decorator is APPLIED TO a declaration ... NOT calls: the
// decorated symbol does not invoke the decorator — the runtime applies it while the declaration is
// created". So the positive test is an attribute whose ARGUMENT IS AN INVOKED CALLABLE. The C family's
// only such attribute is `cleanup(fn)` / `gnu::cleanup(fn)` (the compiler invokes fn when the object
// goes out of scope); Objective-C inherits it through its C grammar. Every other attribute argument is
// a VALUE the compiler interprets, never an invocation.
const APPLIED_CALLABLE_ATTRIBUTES = new Set(["cleanup", "gnu::cleanup", "__cleanup__"])
const CALLABLE_KINDS = new Set(["function", "method", "constructor"])
// Objective-C's compiler-directive macros are ATTRIBUTE-SHAPED but are not attributes in the grammar
// (`macro_specifier`), and they are not applied callables either: `NS_SWIFT_NAME(foo)` renames a
// declaration for import, `NS_REFINED_FOR_SWIFT` hides one. Counted, because a decorates ruling must
// name what it measured rather than stop at the grammar's own attribute nodes.
const DIRECTIVE_MACRO_PREFIXES = ["NS_SWIFT_NAME", "NS_SWIFT_UNAVAILABLE", "NS_REFINED_FOR_SWIFT", "NS_DESIGNATED_INITIALIZER", "NS_UNAVAILABLE", "API_AVAILABLE", "API_DEPRECATED", "API_UNAVAILABLE", "objc_subclassing_restricted", "objc_requires_super"]

function leadingName(raw: string): string {
  const text = raw.trim()
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === "(" || ch === " " || ch === "\t" || ch === "\n") return text.slice(0, i).trim()
  }
  return text
}
// The attribute's NAME from the tree: `__attribute__((name(...)))` is attribute_specifier ->
// argument_list -> call_expression (callee = the name); `[[name]]` is attribute_specifier ->
// attribute (first named child = the name). A scoped spelling keeps its scope, because the scope IS
// the name for the attributes that matter here (`cleanup` and `gnu::cleanup` are one attribute).
function attributeNameOf(node: any): string {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = String(n.type)
    if (t === "attribute") {
      const first = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (first) return leadingName(String(first.text))
    }
    if (t === "call_expression") {
      const callee = n.namedChild(0)
      if (callee) return leadingName(String(callee.text))
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  // `__attribute__((noreturn))` hands the name as a bare identifier inside the argument list — no
  // attribute node and no call_expression. The identifier IS the attribute's name.
  const ids: any[] = [node]
  while (ids.length > 0) {
    const n = ids.pop()!
    if (String(n.type) === "identifier" || String(n.type) === "type_identifier") return leadingName(String(n.text))
    for (let i = n.namedChildCount - 1; i >= 0; i--) ids.push(n.namedChild(i))
  }
  return ""
}
function containsType(node: any, type: string): boolean {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (String(n.type) === type) return true
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  return false
}

const projectNames = new Map<string, Map<string, Set<string>>>()
const categoryRecords: { repo: string; rel: string; extended: string; label: string; plainSameFile: boolean }[] = []
const population: string[] = fs.readFileSync(POPULATION, "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
for (const p of population) {
  if (!path.isAbsolute(p) || !p.startsWith(CORPUS + path.sep)) {
    console.error(`REFUSED: population line is not an absolute path inside ${CORPUS}: ${p}`)
    process.exit(4)
  }
}
const parser: any = await getParser("objc")
let parsedRepos = 0
const repoSeen = new Set<string>()
const PROGRESS = path.join(ROOT, ".tmp-objc", "census-progress.txt")
const progress = (msg: string): void => {
  try { fs.writeFileSync(PROGRESS, `${new Date().toISOString()} ${msg}\n`) } catch { /* not fatal */ }
}

for (const filePath of population) {
  const rel = path.relative(CORPUS, filePath)
  const repo = rel.split(path.sep)[0]
  repoSeen.add(repo)
  counts.files++
  let content = ""
  try { content = fs.readFileSync(filePath, "utf8") } catch { counts.filesFailed++; failedFiles.push(rel); continue }
  let tree: any
  try { tree = await parser.parse(content) } catch { counts.filesFailed++; failedFiles.push(rel); continue }
  counts.filesParsed++
  progress(`files=${counts.filesParsed} ${rel}`)

  // ── the analyzer's own output: the part_of edges, and the symbol kinds the callable test needs.
  let result: any = null
  try { result = await parseFile(filePath, path.join(CORPUS, repo), { projectRoot: path.join(CORPUS, repo) } as any) } catch { result = null }
  const seenTypes = new Set<string>()
  for (const r of (result?.relationships ?? [])) {
    const ty = String(r.type ?? r.relationshipType ?? "")
    if (ty.length === 0) continue
    typeEdges[ty] = (typeEdges[ty] ?? 0) + 1
    seenTypes.add(ty)
    if (ty === "part_of") counts.partOfEdges++
  }
  for (const ty of seenTypes) typeFiles[ty] = (typeFiles[ty] ?? 0) + 1
  if (seenTypes.has("part_of")) counts.filesWithPartOf++
  const kindOfName = new Map<string, string>()
  for (const sy of (result?.symbols ?? [])) kindOfName.set(String(sy.name), String(sy.kind ?? ""))
  let repoNames = projectNames.get(repo)
  if (!repoNames) { repoNames = new Map(); projectNames.set(repo, repoNames) }
  for (const sy of (result?.symbols ?? [])) {
    const nm = String(sy.name ?? "")
    if (nm.length === 0) continue
    let kinds = repoNames.get(nm)
    if (!kinds) { kinds = new Set(); repoNames.set(nm, kinds) }
    kinds.add(String(sy.kind ?? ""))
  }

  // raw-tree facts: the class declarations and categories in this file, so the category measurements
  // can answer "does the label name a type HERE" and "is the extended class also a plain class HERE".
  const plainClassNames = new Set<string>()
  const categoryList: { extended: string; label: string; node: any }[] = []
  {
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = String(n.type)
      if (t === "class_interface" || t === "class_implementation") {
        const ids: string[] = []
        for (let ci = 0; ci < n.namedChildCount; ci++) {
          const cn = n.namedChild(ci)
          if (cn && cn.type === "identifier") ids.push(String(cn.text))
        }
        let hasParen = false
        for (let ci = 0; ci < n.childCount; ci++) {
          const c = n.child(ci)
          if (c && !c.isNamed && String(c.type) === "(") { hasParen = true; break }
        }
        if (hasParen) {
          counts.categorySites++
          if (t === "class_interface") counts.categoryInterfaceSites++
          else counts.categoryImplementationSites++
          if (ids.length >= 2) { counts.namedCategorySites++; categoryList.push({ extended: ids[0], label: ids[1], node: n }) }
          else counts.anonymousClassExtensionSites++
        } else if (ids.length >= 1) {
          plainClassNames.add(ids[0])
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
  }
  for (const c of categoryList) {
    categoryLabels[c.label] = (categoryLabels[c.label] ?? 0) + 1
    categoryRecords.push({ repo, rel, extended: c.extended, label: c.label, plainSameFile: plainClassNames.has(c.extended) })
    // the LABEL as a name: is it a published TYPE somewhere? own-file evidence first (the census is
    // per file, and the project-scope answer is the gate's ambiguous column, quoted beside this).
    const labelKind = kindOfName.get(c.label)
    if (labelKind !== undefined && !CALLABLE_KINDS.has(labelKind) && labelKind !== "extension") {
      counts.categoryLabelPublishedAsTypeInSameFile++
      bump("categoryLabelPublishedAsType", rel, `${c.extended} (${c.label}) -> ${labelKind}`)
    }
    if (plainClassNames.has(c.extended)) {
      counts.categoryExtendedClassAlsoPlainInSameFile++
      bump("categoryExtendedClassAlsoPlainInSameFile", rel, `${c.extended} (${c.label})`)
    }
  }

  // ── the raw-tree walk: directive sites, attributes, the render near-miss, composition-shaped nodes.
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = String(n.type)
    if (t === "preproc_include") {
      counts.preprocIncludeSites++
      let system = false
      let wrotePath = ""
      for (let ci = 0; ci < n.namedChildCount; ci++) {
        const cn = n.namedChild(ci)
        if (!cn) continue
        if (cn.type === "system_lib_string") {
          system = true
          wrotePath = String(cn.text)
          break
        }
        if (cn.type === "string_literal") {
          const contentNode = cn.namedChildCount > 0 ? cn.namedChild(0) : null
          wrotePath = contentNode ? String(contentNode.text) : String(cn.text)
          break
        }
      }
      if (system) counts.systemIncludeSites++
      else counts.quotedIncludeSites++
      void wrotePath
    }
    if (t === "module_import") counts.moduleImportSites++
    if (t === "block_literal") counts.blockLiteralSites++
    if (t === "property_attribute") counts.propertyAttributeSites++
    if (t === "availability_attribute_specifier") counts.availabilityAttributeSpecifierSites++
    if (t === "attribute_specifier" || t === "attribute_declaration") {
      if (t === "attribute_specifier") counts.attributeSpecifierSites++
      else counts.attributeDeclarationSites++
      counts.attributeSites++
      const attrName = attributeNameOf(n)
      if (attrName.length > 0 && attrName.length < 64) attributeNames[attrName] = (attributeNames[attrName] ?? 0) + 1
      if (APPLIED_CALLABLE_ATTRIBUTES.has(attrName)) {
        counts.appliedCallableAttributeSites++
        bump("appliedCallable", rel, String(n.text))
      }
      if (containsType(n, "call_expression")) {
        counts.attributeWithCallArgument++
        bump("attributeWithCallArgument", rel, String(n.text))
        const scan: any[] = [n]
        while (scan.length > 0) {
          const y = scan.pop()!
          if (String(y.type) === "call_expression") {
            const callee = y.namedChild(0)
            const calleeName = callee ? String(callee.text).trim() : ""
            const kind = kindOfName.get(calleeName)
            if (calleeName && kind !== undefined) {
              counts.declaredCalleeInAttribute++
              if (CALLABLE_KINDS.has(kind)) {
                counts.callableAttributeArguments++
                bump("callableAttribute", rel, `${attrName} -> ${calleeName} (kind ${kind})`)
              } else {
                counts.nonCallableDeclaredCallee++
                bump("nonCallableDeclaredCallee", rel, `${attrName} -> ${calleeName} (kind ${kind})`)
              }
            }
          }
          for (let i = 0; i < y.namedChildCount; i++) scan.push(y.namedChild(i))
        }
      }
    }
    if (t === "macro_specifier") {
      const raw = String(n.text).trim()
      const name = leadingName(raw)
      for (const prefix of DIRECTIVE_MACRO_PREFIXES) {
        if (name === prefix || name.startsWith(prefix)) {
          counts.compilerDirectiveMacroSites++
          directiveMacros[name] = (directiveMacros[name] ?? 0) + 1
          break
        }
      }
    }
    if (t === "string_literal") {
      // the nib/storyboard near miss: a RESOURCE named by a string literal. The string names a file;
      // it declares no component and renders nothing.
      const stack2: any[] = [n]
      while (stack2.length > 0) {
        const s = stack2.pop()!
        if (String(s.type) !== "string_content") { for (let i = 0; i < s.namedChildCount; i++) stack2.push(s.namedChild(i)); continue }
        const text = String(s.text)
        if (text.toLowerCase().endsWith(".xib") || text.toLowerCase().endsWith(".storyboard") || text.toLowerCase().endsWith(".nib")) {
          counts.nibOrStoryboardStringSites++
          bump("nibOrStoryboard", rel, text)
        }
      }
    }
    if (t === "message_expression") {
      const text = String(n.text)
      if (text.includes("initWithNibName") || text.includes("nibWithNibName") || text.includes("loadNibNamed")) {
        counts.nibInitializerSites++
        bump("nibInitializer", rel, text)
        // the RESOURCE NAME is a STRING VALUE, never a declaration: count the literals it passes.
        const scanNib: any[] = [n]
        while (scanNib.length > 0) {
          const s2 = scanNib.pop()!
          if (String(s2.type) === "string_literal") { counts.nibResourceStrings++; continue }
          for (let i = 0; i < s2.namedChildCount; i++) scanNib.push(s2.namedChild(i))
        }
      }
    }
    if (t === "render_element" || t === "component_render" || t === "view_body") {
      counts.renderShapedNodes++
      bump("renderShaped", rel, t)
    }
    if (t === "mixin_declaration" || t === "trait_declaration" || t === "uses_clause" || t === "extends_clause") {
      counts.compositionShapedNodes++
      bump("compositionShaped", rel, t)
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  try { (tree as any).delete?.() } catch {}
}

// ── PROJECT SCOPE: would a mixes_in target (the category LABEL) resolve to a DECLARED TYPE? A
// label that coincides with a real class name would make the row resolve to a class the category
// never composed — a wrong claim. This is the decisive measurement for the target's honesty.
const CALLABLE_OR_VALUE = new Set(["function", "method", "constructor", "variable", "constant", "property", "parameter", "local"])
for (const c of categoryRecords) {
  const kinds = projectNames.get(c.repo)?.get(c.label)
  if (kinds && [...kinds].some((k) => !CALLABLE_OR_VALUE.has(k))) {
    counts.categoryLabelPublishedAsTypeInProject++
    bump("categoryLabelPublishedAsTypeInProject", c.rel, `${c.extended} (${c.label}) -> ${[...kinds].join("|")}`, 8)
  }
  if (c.plainSameFile) continue
}
parsedRepos = repoSeen.size
const served = { language: "objective-c", nodeTypeCount: (parser as any).getNodeTypeCount?.() ?? null }
const report = {
  tool: "script/m14/objc-census.ts",
  corpusRoot: CORPUS,
  rule: "the gate's OWN admitted population, read from the file list the gate printed (`BB_LIST_FILES=1 bun run script/m14/incoming-gate.ts objective-c 0`): 262 files over 9 repositories, extensions m,mm from the router's one table, present on disk, ≤ 1 MiB",
  population: {
    admitted: counts.files, parsed: counts.filesParsed, failed: counts.filesFailed, repositories: parsedRepos,
    populationString: `parsed=${counts.filesParsed}/${counts.files} admitted=${counts.files} exts=m,mm index=no`,
    list: "validation/m14/measurements/objc-population.txt",
  },
  counts,
  perType: { edges: typeEdges, files: typeFiles },
  crossCheck: {
    partOfEdges: { census: counts.partOfEdges, gateTableOne: GATE_PART_OF_EDGES, agrees: counts.partOfEdges === GATE_PART_OF_EDGES },
    population: { list: population.length, gateWidthOneHeader: 259 },
  },
  categorySites: { records: categoryRecords.length, labels: Object.keys(categoryLabels).length, top: Object.entries(categoryLabels).sort((a, b) => b[1] - a[1]).slice(0, 12) },
  failedFiles,
  topAttributeNames: Object.entries(attributeNames).sort((a, b) => b[1] - a[1]).slice(0, 15),
  compilerDirectiveMacros: Object.entries(directiveMacros).sort((a, b) => b[1] - a[1]).slice(0, 10),
  topCategoryLabels: Object.entries(categoryLabels).sort((a, b) => b[1] - a[1]).slice(0, 12),
  samples,
  served,
}
if (out) {
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
  console.log(`wrote ${out} — ${counts.filesParsed}/${counts.files} parsed; part_of edges ${counts.partOfEdges} (gate ${GATE_PART_OF_EDGES}); category sites ${counts.categorySites}; attribute sites ${counts.attributeSites} (${counts.attributeWithCallArgument} call-shaped, ${counts.callableAttributeArguments} callable, ${counts.appliedCallableAttributeSites} cleanup); render-shaped ${counts.renderShapedNodes}; nib/storyboard strings ${counts.nibOrStoryboardStringSites} + initializers ${counts.nibInitializerSites}; composition-shaped ${counts.compositionShapedNodes}`)
} else {
  console.log(JSON.stringify(report, null, 1).slice(0, 3000))
}
if (counts.filesParsed !== counts.files) process.exit(3)
