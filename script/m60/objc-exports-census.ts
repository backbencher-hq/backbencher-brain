// script/m60/objc-exports-census.ts — does Objective-C HAVE an export construct?
//
// DERIV_EXPORTS_OBJC's ruling instrument for the `exports` relationship type.
//
// WHY A CENSUS AND NOT A PROSE ARGUMENT. The workstream's gate exists because
// `overrides` had a prose justification for a whole wave and it was wrong. So the
// question "does this language have an exports construct" is answered by walking
// every admitted file's tree and counting the node shapes that COULD carry it.
// Five candidates are enumerated, each with the grammar node that expresses it,
// and each is counted:
//
//   A. storage_class_specifier on a file-scope declaration — the marker slot C
//      uses for `extern`-like prefixes. FOUNDATION_EXPORT lands here.
//   B. attribute_specifier / visibility_specifier carrying a visibility —
//      `__attribute__((visibility("default")))`.
//   C. a `preproc_def` — an `#define` macro named like an export marker.
//      A macro is a CONVENTION (a consumer must expand it); it is measured so
//      the ruling can say how much of the surface is convention-backed.
//   D. class_interface / protocol_declaration in a header — the umbrella-header
//      convention: "a header's declarations are public". Measured, and NOT
//      converted into edges unless the grammar states it.
//   E. `extern` as a keyword specifier (C's own spelling of external linkage).
//
// The count is over the AST, never over source text: `storage_class_specifier`
// is a NAMED node type the grammar emits, and reading `node.text` of a node is
// reading the grammar's output rather than matching a pattern in bytes. NO
// REGEXP (lane rule 1). Admission is the router's own
// `detectLanguageFromPath(filePath, content)`.
//
// Usage: bun script/m60/objc-exports-census.ts
// Writes: validation/m60/results/objc-exports-census.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories/objc"
const OUT = path.join(ROOT, "validation/m60/results/objc-exports-census.json")

/** Marker texts a declaration can carry in the specifier slot. Compared as exact
 *  strings against `node.text` of a node the grammar emitted — no pattern. */
const MARKERS: ReadonlySet<string> = new Set([
  "FOUNDATION_EXPORT", "FOUNDATION_EXTERN", "UIKIT_EXTERN", "APPKIT_EXTERN",
  "CF_EXPORT", "CORE_EXPORT", "OBJC_EXPORT", "EXPORT", "EXTERN", "extern",
  "PUBLIC", "API", "API_AVAILABLE",
])

/**
 * The declarator SHAPE of a declaration that carries an export marker, or `null`
 * when the declaration has no declarator at all and therefore declares no name.
 *
 * Structural, no text tests: the shape is read from the declarator node's own
 * `type` and the name from the deepest `identifier` under it. A `declaration`
 * with no declarator is the wreckage shape the selector/census work already
 * characterised (`isUnterminatedDeclaration`) — it publishes nothing, and an
 * `exports` edge built on it would name nothing.
 */
function declaredNameShape(decl: any): string | null {
  for (let i = 0; i < decl.namedChildCount; i++) {
    const c = decl.namedChild(i)
    if (!c) continue
    if (c.type === "init_declarator") {
      const head = c.namedChild(0)
      return head ? `init_declarator->${head.type}` : "init_declarator"
    }
    if (c.type === "function_declarator") return "function_declarator"
    if (c.type === "pointer_declarator" || c.type === "array_declarator" ||
        c.type === "parenthesized_declarator" || c.type === "attributed_declarator") {
      return `${c.type}`
    }
    if (c.type === "identifier") return "bare_identifier"
    if (c.type === "type_definition") return "type_definition"
  }
  return null
}

async function main(): Promise<void> {
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (ext !== ".m" && ext !== ".mm" && ext !== ".h") continue
      if (statSync(p).size > 1024 * 1024) continue
      let src = ""
      try { src = readFileSync(p, "utf8") } catch { continue }
      if (detectLanguageFromPath(p, src) === "objective-c") files.push(p)
    }
  }
  walk(CORPUS_ROOT)
  files.sort()

  const parser = await getParser("objective-c")

  let nodes = 0
  let errorNodes = 0
  const nodeTypeCounts = new Map<string, number>()
  const markerFiles = new Map<string, Set<string>>()
  /** The FILE LIST behind each marker, so "which files" is answerable from the
   *  artifact and not only from the count. The workstream's EMITTED verdict asks
   *  for the files, and a census that cannot name them makes the reader re-run it. */
  const markerFileList = new Map<string, string[]>()
  const markerOccurrences = new Map<string, number>()
  /** One occurrence in one file: counted AND attributed. Two numbers, because a
   *  census that reports only the file count cannot tell one header exporting 40
   *  names from 40 headers exporting one each, and those are different surfaces. */
  const bump = (k: string, f: string): void => {
    if (!markerFiles.has(k)) markerFiles.set(k, new Set<string>())
    markerFiles.get(k)!.add(f)
    if (!markerFileList.has(k)) markerFileList.set(k, [])
    markerFileList.get(k)!.push(f)
    markerOccurrences.set(k, (markerOccurrences.get(k) ?? 0) + 1)
  }
  // shape census
  let declNodes = 0
  let declWithSpecifierMarker = 0
  let declWithSpecifierMarkerNameable = 0
  let declWithSpecifierMarkerUnterminated = 0
  let attributeNodes = 0
  let visibilityNodes = 0
  let preprocDefNodes = 0
  let preprocDefMarkers = 0
  let externSpecifierNodes = 0
  let headerClassInterfaces = 0
  let headerProtocols = 0
  let implementationOnlyFiles = 0
  let headerFiles = 0
  let implementationFiles = 0
  const declaratorNameShaped = new Map<string, number>()
  const samples: Array<Record<string, unknown>> = []
  const unnameable: Array<Record<string, unknown>> = []

  for (const f of files) {
    const label = f.slice(CORPUS_ROOT.length + 1)
    const isHeader = f.endsWith(".h")
    const src = readFileSync(f, "utf8")
    const tree: any = (parser as any).parse(src, f)
    let sawInterface = false
    let sawImplementation = false
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      nodes++
      nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
      if (n.type === "ERROR" || n.isMissing) errorNodes++
      if (n.type === "class_interface") sawInterface = true
      if (n.type === "class_implementation") sawImplementation = true
      if (n.type === "attribute_specifier" || n.type === "attribute") attributeNodes++
      if (n.type === "visibility_specification") visibilityNodes++
      if (n.type === "preproc_def") {
        preprocDefNodes++
        const nm = n.childForFieldName("name")
        const text = (nm ?? n.namedChild(0))?.text?.trim() ?? ""
        if (MARKERS.has(text)) { preprocDefMarkers++; bump(`preproc_def:${text}`, label) }
      }
      if (n.type === "storage_class_specifier") {
        const t = n.text.trim()
        if (MARKERS.has(t)) {
          bump(`storage_class_specifier:${t}`, label)
          if (t === "extern") externSpecifierNodes++
        }
      }
      if (n.type === "declaration") {
        declNodes++
        let hasMarker = false
        let markerText = ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "storage_class_specifier" && MARKERS.has(c.text.trim())) {
            hasMarker = true
            markerText = c.text.trim()
          }
        }
        if (hasMarker) {
          declWithSpecifierMarker++
          bump(`declaration-with-marker:${markerText}`, label)
          // Is the DECLARED NAME recoverable? The route is structural: a declarator
          // subtree carries the declared name, so the deepest identifier under one
          // is the name. Recorded as a SHAPE so the census says which declarator
          // forms actually occur rather than asserting "nameable".
          const shape = declaredNameShape(n)
          const hasDeclarator = shape !== null
          if (shape) declaratorNameShaped.set(shape, (declaratorNameShaped.get(shape) ?? 0) + 1)
          // An UNTERMINATED declaration declares nothing. The grammar closes a
          // declaration whose `;` it could not find with a MISSING token, and this
          // corpus contains the shape: `NS_ASSUME_NONNULL_BEGIN` above
          // `FOUNDATION_EXPORT NSString * AFPercentEscapedStringFromString(...)`
          // splits into a declaration holding the marker, a phantom `identifier`
          // and a MISSING `;`, with the function's pointer half recovered as an
          // `expression_statement` — so the declarator below is a PHANTOM name, not
          // the export's name. `declaratorShapes` records the shape, and this
          // counter records how many of them are wreckage. The analyzer refuses
          // this shape (`isUnterminatedDeclaration`), and an `exports` edge must
          // refuse it for the same reason.
          let missingSemi = false
          for (let ci = 0; ci < n.childCount; ci++) {
            const c = n.child(ci)
            if (c && c.isMissing && c.type === ";") missingSemi = true
          }
          if (missingSemi) { declWithSpecifierMarkerUnterminated++; bump("declaration-with-marker:UNTERMINATED", label) }
          if (hasDeclarator && !missingSemi) {
            declWithSpecifierMarkerNameable++
            if (samples.length < 20) {
              samples.push({ file: label, line: n.startPosition.row + 1, marker: markerText, text: (n.text ?? "").split("\n")[0].slice(0, 120) })
            }
          } else if (!missingSemi && unnameable.length < 20) {
            unnameable.push({ file: label, line: n.startPosition.row + 1, marker: markerText, text: (n.text ?? "").split("\n")[0].slice(0, 120) })
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (isHeader) {
      headerFiles++
      if (sawInterface) headerClassInterfaces++
      if (sawInterface) bump("header-with-class_interface", label)
    } else {
      implementationFiles++
      if (sawImplementation) implementationOnlyFiles++
    }
    }

  const payload = {
    instrument: "script/m60/objc-exports-census.ts",
    corpus: CORPUS_ROOT,
    admission: "detectLanguageFromPath(filePath, content) === objective-c",
    files: files.length,
    nodes,
    errorNodes,
    grammarNodeTypes: nodeTypeCounts.size,
    candidateA_storage_class_specifier_on_declaration: {
      declarationsScanned: declNodes,
      declarationsCarryingAMarker: declWithSpecifierMarker,
      ofWhichTerminatedAndNameable: declWithSpecifierMarkerNameable,
      ofWhichUnterminatedDeclaresNothing: declWithSpecifierMarkerUnterminated,
      byMarker: Object.fromEntries([...markerFiles.entries()]
        .filter(([k]) => k.startsWith("declaration-with-marker:"))
        .map(([k, v]) => [k.slice("declaration-with-marker:".length), { occurrences: markerOccurrences.get(k) ?? 0, files: v.size }])),
      declaratorShapes: Object.fromEntries(declaratorNameShaped),
    },
    candidateB_visibility_attributes: { attribute_specifier_or_attribute: attributeNodes, visibility_specification: visibilityNodes },
    candidateC_preproc_def_markers: { preproc_def_nodes: preprocDefNodes, export_named: preprocDefMarkers, markers: Object.fromEntries([...markerFiles.entries()].filter(([k]) => k.startsWith("preproc_def:"))) },
    candidateD_header_convention: { headerFiles, implementationFiles, headersDeclaringAClass: headerClassInterfaces },
    candidateE_extern_keyword: { storage_class_specifier_text_extern: externSpecifierNodes },
    markerFileLists: Object.fromEntries([...markerFileList.entries()].sort()),
  byExtension: (() => {
    const out: Record<string, number> = {}
    for (const f of markerFiles.get("declaration-with-marker:FOUNDATION_EXPORT") ?? []) {
      const e = f.slice(f.lastIndexOf("."))
      out[e] = (out[e] ?? 0) + 1
    }
    return out
  })(),
  markerOccurrences: Object.fromEntries([...markerFiles.entries()]
      .sort((a, b) => (markerOccurrences.get(b[0]) ?? 0) - (markerOccurrences.get(a[0]) ?? 0))
      .map(([k, v]) => [k, { occurrences: markerOccurrences.get(k) ?? 0, files: v.size }])),
    samples,
    unnameableSamples: unnameable,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(`objc exports census  files ${files.length}  nodes ${nodes}  distinct node types ${nodeTypeCounts.size}`)
  console.log(`  A declarations ${declNodes} · with an export marker ${declWithSpecifierMarker} · terminated+nameable ${declWithSpecifierMarkerNameable} · unterminated (declares nothing) ${declWithSpecifierMarkerUnterminated}`)
  console.log(`     declarator shapes present: ${JSON.stringify(payload.candidateA_storage_class_specifier_on_declaration.declaratorShapes)}`)
  console.log(`  B attribute/visibility nodes: ${attributeNodes} / ${visibilityNodes}`)
  console.log(`  C preproc_def nodes ${preprocDefNodes} · of which export-named ${preprocDefMarkers}`)
  console.log(`  D headers ${headerFiles} declaring a class ${headerClassInterfaces} · implementations ${implementationFiles}`)
  console.log(`  E storage_class_specifier 'extern' ${externSpecifierNodes}`)
  console.log(`\n  markers seen anywhere: ${JSON.stringify(payload.markerOccurrences)}`)
  console.log(`wrote ${OUT}`)
}


await main()