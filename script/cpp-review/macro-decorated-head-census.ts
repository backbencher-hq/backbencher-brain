/**
 * MACRO-DECORATED HEAD CENSUS — the three shapes a shared-library export marker
 * (and a lot of real C++) is written in, counted on the tree, and what the
 * analyzer currently publishes for each.
 *
 * The fork's `macro_specifier` / `macro_prefixed_type_specifier` rules were added
 * for shape B. Shapes A1 and A2 are the grammar's RECOVERY, and A2 is where the
 * analyzer and this lane's ontology disagree with each other:
 *
 *   A1  class BENCHMARK_EXPORT Benchmark { … };
 *       function_definition[ class_specifier("BENCHMARK_EXPORT"), identifier("Benchmark"),
 *                             compound_statement ]
 *       -> the bare sibling IS the name. Handled (D15). Correct.
 *
 *   A2  class BENCHMARK_EXPORT ConsoleReporter : public BENCHMARK_EXPORT BenchmarkReporter { … };
 *       function_definition[ class_specifier("BENCHMARK_EXPORT"),
 *                             ERROR("ConsoleReporter : public"),        <- the NAME is in here
 *                             identifier("BenchmarkReporter"),           <- this is the BASE
 *                             compound_statement ]
 *       -> D15 reads the bare sibling as the name, so the class is published
 *          under its BASE's name. With a QUALIFIED base (`benchmark::Benchmark`)
 *          there is no bare `identifier` at all and the class is not published.
 *
 *   B   BENCHMARK_EXPORT void Shutdown();
 *       declaration[ type=macro_prefixed_type_specifier[macro_specifier, primitive_type],
 *                    declarator=function_declarator[identifier] ]
 *       -> the marker is read as the declaration's TYPE, so `returnType` is
 *          published as the macro, and the export fact is not recorded anywhere.
 *
 * Every probe here runs on the parse tree. A text regex cannot tell shape A2's
 * `ERROR("ConsoleReporter : public")` from a comment, and it cannot tell an
 * export marker from `BENCHMARK_ALWAYS_INLINE` — which is why this file reads
 * nodes.
 *
 *   BB_CORPUS_ROOT=... CPP_REPOS=sqlite,cpp-sample \
 *     bun run script/cpp-review/macro-decorated-head-census.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++", ".h", ".ipp", ".tpp"])
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug", "bazel-bin", "CMakeFiles"])

/** Components that mark a macro as a LINKAGE/EXPORT marker rather than a
 *  decoration. `BENCHMARK_ALWAYS_INLINE` decorates and is excluded; `HANDLE`,
 *  `DWORD`, `WORD` and `T` are real all-caps TYPES and are excluded. Stated as
 *  components, not a substring, so `EXPORTABLE_X` and `MY_API_KEY` do not match
 *  by accident — a substring test is how a census manufactures a population. */
const EXPORT_COMPONENTS = new Set(["EXPORT", "EXPORTS", "EXPORTABLE", "API", "DLLEXPORT", "VISIBILITY", "PUBLIC_API", "EXPORT_ATTR"])
function isMacroSpelling(s: string): boolean {
  if (!s.length) return false
  if (s.charCodeAt(0) < 65 || s.charCodeAt(0) > 90) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}
function exportComponentsOf(macro: string): string[] {
  const parts = macro.split("_").filter(Boolean)
  return parts.filter((p) => EXPORT_COMPONENTS.has(p))
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (EXTS.has(path.extname(e.name))) out.push(full)
    }
  }
  return out.sort()
}

const arg = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

interface Site {
  shape: string
  macro: string
  isExportMarker: boolean
  exportComponents: string[]
  declaredName: string | null
  bases: string[]
  ownerAtWalk: string | null
  file: string
  line: number
  text: string
}

async function main() {
  const rootsRaw = (process.env.CPP_REPOS ?? "").split(",").filter(Boolean)
  const roots = rootsRaw.length ? rootsRaw.map((r) => path.join(CORPUS, r)) : readdirSync(CORPUS).map((d) => path.join(CORPUS, d))
  let candidates: string[] = []
  for (const r of roots) candidates = candidates.concat(walkFiles(r))
  candidates = [...new Set(candidates)].sort().slice(0, Number(arg("--limit") ?? Number.POSITIVE_INFINITY))

  const files: string[] = []
  for (const f of candidates) {
    let c = ""
    try { c = readFileSync(f, "utf8") } catch { continue }
    if (detectLanguageFromPath(f, c) === "cpp") files.push(f)
  }

  const sites: Site[] = []
  const shapes: Record<string, { count: number; files: number; exportMarkers: number }> = {}
  const shapeFiles: Record<string, Set<string>> = {}
  const publishedClassesByFile = new Map<string, Map<string, string[]>>()

  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let tree: any
    try { tree = await ASTEngine.parseTree(f, content) } catch { continue }
    const label = `${path.basename(path.dirname(f))}/${path.basename(f)}`
    const bump = (shape: string, isExport: boolean) => {
      shapes[shape] ??= { count: 0, files: 0, exportMarkers: 0 }
      shapes[shape].count++
      if (isExport) shapes[shape].exportMarkers++
      shapeFiles[shape] ??= new Set()
      shapeFiles[shape].add(label)
    }

    const st: any[] = [tree.tree.rootNode]
    while (st.length) {
      const n = st.pop()
      const t = n.type
      const line = n.startPosition.row + 1

      // ---------------- shapes A1 / A2: a macro-decorated class/struct head
      if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
        let hasBody = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "class_body" || c.type === "field_declaration_list")) hasBody = true
        }
        const macro = n.childForFieldName?.("name")?.text?.trim()
        const parent = n.parent
        if (!hasBody && macro && isMacroSpelling(macro) && parent?.type === "function_definition") {
          let body: any = null
          for (let i = 0; i < parent.namedChildCount; i++) {
            const c = parent.namedChild(i)
            if (c && c.type === "compound_statement") { body = c; break }
          }
          let declared: string | null = null
          const bases: string[] = []
          let shape = "A1"
          if (body) {
            // Three sibling orderings were MEASURED on this corpus and each is
            // keyed on the evidence the grammar left, not on position:
            //   A2  ERROR("Name : access") then identifier(Base)   — base clause
            //   A3  identifier(Name) then ERROR("final")            — trailing keyword
            //   A4  identifier(MACRO2) then ERROR("Name")           — second head marker
            // The first cut of this probe used only the ERROR's first named child,
            // which mis-read A3 (`final` is a keyword, and the name is the sibling
            // before it) and reported 3 phantom defects.
            const errs: Array<{ name: string | null; colon: boolean }> = []
            const names: Array<{ text: string; prevWasMacro: boolean; beforeErr: number }> = []
            for (let i = 0; i < parent.namedChildCount; i++) {
              const c = parent.namedChild(i)
              if (!c || c === n || c === body) continue
              if (c.endIndex > body.startIndex) continue
              const prevMacro = names.length ? isMacroSpelling(names[names.length - 1].text) : false
              if (c.type === "ERROR") {
                let named = 0
                let nm: string | null = null
                for (let k = 0; k < c.namedChildCount; k++) {
                  const kc = c.namedChild(k)
                  if (!kc || !kc.isNamed) continue
                  named++
                  if (kc.type === "identifier") nm = kc.text.trim()
                }
                let colon = false
                for (let k = 0; k < c.childCount; k++) { const kc = c.child(k); if (kc && kc.type === ":") { colon = true; break } }
                errs.push({ name: named === 1 ? nm : null, colon })
                if (named === 1 && nm && prevMacro) { declared = nm; shape = "A4" }
              } else if (c.type === "identifier" || c.type === "qualified_identifier" || c.type === "template_type") {
                names.push({ text: c.text.trim(), prevWasMacro: prevMacro, beforeErr: errs.length })
              }
            }
            const colonArm = errs.find((e) => e.name && e.colon)
            if (colonArm && !declared) {
              shape = "A2"
              declared = colonArm.name
              for (const nm of names) if (nm.beforeErr > 0) bases.push(nm.text)
            } else if (!declared) {
              const nonMacro = names.find((x) => !isMacroSpelling(x.text))
              declared = (nonMacro ?? names[0])?.text ?? null
            }
          }
          const comps = exportComponentsOf(macro)
          bump(shape, comps.length > 0)
          sites.push({
            shape, macro, isExportMarker: comps.length > 0, exportComponents: comps,
            declaredName: declared, bases, ownerAtWalk: null, file: label, line,
            text: n.parent.text.replace(/\s+/g, " ").slice(0, 90),
          })
        }
      }

      // ---------------- shape B: a macro in the declaration-specifier position
      if (t === "macro_prefixed_type_specifier") {
        let macro = ""
        const rest: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "macro_specifier") macro = c.text.trim()
          else rest.push(c.text.replace(/\s+/g, " "))
        }
        // a class specifier inside is fork-patch-4's shape (D11's guard territory)
        let carriesClass = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "class_specifier" || c.type === "struct_specifier" || c.type === "union_specifier")) carriesClass = true
        }
        if (macro && !carriesClass) {
          const owner = n.parent
          let declared: string | null = null
          const decl = owner?.childForFieldName?.("declarator")
          let cur: any = decl
          for (let d = 0; d < 8 && cur; d++) {
            if (cur.type === "identifier" || cur.type === "field_identifier") { declared = cur.text.trim(); break }
            const next = cur.childForFieldName?.("declarator") ?? cur.namedChild(0)
            if (!next || next === cur) break
            cur = next
          }
          const comps = exportComponentsOf(macro)
          bump("B:specifier", comps.length > 0)
          sites.push({
            shape: "B:specifier", macro, isExportMarker: comps.length > 0, exportComponents: comps,
            declaredName: declared, bases: [], ownerAtWalk: null, file: label, line,
            text: `${owner?.type ?? "?"} ${owner?.text.replace(/\s+/g, " ").slice(0, 70)} | declaredType=${rest.join(" ").slice(0, 40)}`,
          })
        }
      }

      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
    }
  }
  for (const k of Object.keys(shapes)) shapes[k].files = shapeFiles[k].size

  // ---- what the analyzer PUBLISHED for the same files, so the two halves can be
  // compared rather than argued about.
  const publishedWrongName: Site[] = []
  const publishedLost: Site[] = []
  const publishedOwnerLost: Site[] = []
  const payloadMacroType: Array<{ file: string; name: string; returnType: string }> = []
  const exportsEdges: Array<Record<string, unknown>> = []
  const fileLabel = new Map<string, string>()
  for (const f of files) fileLabel.set(f, `${path.basename(path.dirname(f))}/${path.basename(f)}`)
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    const label = fileLabel.get(f)!
    const classes = new Map<string, any[]>()
    for (const s of r.symbols ?? []) {
      if (s.kind !== "class" && s.kind !== "struct") continue
      const arr = classes.get(s.name) ?? []
      arr.push(s)
      classes.set(s.name, arr)
    }
    for (const site of sites.filter((x) => x.file === label)) {
      if (site.shape === "B:specifier") {
        for (const s of r.symbols ?? []) {
          if (s.name === site.declaredName && typeof s.returnType === "string" && site.isExportMarker && s.returnType.includes(site.macro)) {
            payloadMacroType.push({ file: label, name: s.name, returnType: s.returnType })
          }
        }
        continue
      }
      if (!site.declaredName) { publishedLost.push(site); continue }
      const same = classes.get(site.declaredName) ?? []
      // a class published at this exact line, carrying the macro in its head metadata
      const at = same.filter((s) => s.range?.startLine === site.line)
      if (at.length) {
        if (!at[0].ownerName) publishedOwnerLost.push(site)
      } else {
        // published under a DIFFERENT name at this line?
        const byLine = [...classes.entries()].flatMap(([n, arr]) => arr.filter((s) => s.range?.startLine === site.line).map((s) => n))
        if (byLine.length) publishedWrongName.push({ ...site, declaredName: `${site.declaredName} -> published as ${byLine.join(",")}` })
        else publishedLost.push(site)
      }
    }
    for (const x of r.relationships ?? []) {
      if (x.type === "exports") exportsEdges.push({ file: label, source: x.source, target: x.target, line: x.line_number, confidence: x.confidence })
      if (x.type === "contains" && x.source === "global" && String(x.target).length > 0) {
        // recorded below via the global-contains tally
      }
    }
  }

  // ---- every `contains global -> X` row, which the lane's ontology forbids
  const globalContains: Array<{ file: string; target: string; line: number | null }> = []
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    for (const x of r.relationships ?? []) {
      if (x.type === "contains" && x.source === "global") globalContains.push({ file: fileLabel.get(f)!, target: String(x.target), line: x.line_number ?? null })
    }
  }

  const outPath = arg("--out") ?? path.join(OUT, "macro-decorated-head-census.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({
    at: new Date().toISOString(), corpus: CORPUS, repos: rootsRaw, cppFiles: files.length,
    exportComponents: [...EXPORT_COMPONENTS],
    shapes, sites,
    defects: {
      publishedUnderWrongName: publishedWrongName.length,
      publishedLost: publishedLost.length,
      publishedWithNoOwner: publishedOwnerLost.length,
      returnTypeIsTheMacro: payloadMacroType.length,
      containsGlobalTo: globalContains.length,
    },
    detail: { publishedWrongName, publishedLost, publishedOwnerLost, payloadMacroType: payloadMacroType.slice(0, 60), globalContains: globalContains.slice(0, 200), exportsEdges: exportsEdges.slice(0, 40) },
  }, null, 2))

  console.log(`cpp files ${files.length} | macro-decorated sites ${sites.length}`)
  console.log(`EXPORT_COMPONENTS = ${[...EXPORT_COMPONENTS].join(", ")}\n`)
  console.log("shape".padEnd(18), "count".padStart(7), "files".padStart(7), "exportMarkers".padStart(15))
  for (const [k, v] of Object.entries(shapes)) console.log(k.padEnd(18), String(v.count).padStart(7), String(v.files).padStart(7), String(v.exportMarkers).padStart(15))
  console.log("\nA2 sites (name inside ERROR, sibling is the BASE):")
  for (const s of sites.filter((x) => x.shape === "A2")) console.log(`  ${s.file}:${s.line}  macro=${s.macro}  name=${s.declaredName}  bases=[${s.bases.join(", ")}]`)
  console.log("\nDEFEECTS measured against production parseFile output:")
  console.log(`  class published under the BASE's name : ${publishedWrongName.length}`)
  for (const s of publishedWrongName.slice(0, 12)) console.log(`      ${s.file}:${s.line} ${s.declaredName}  [real name ${s.declaredName.split(" -> ")[0]}]`)
  console.log(`  class not published at all            : ${publishedLost.length}`)
  for (const s of publishedLost.slice(0, 12)) console.log(`      ${s.file}:${s.line} ${s.shape} declared=${s.declaredName} macro=${s.macro}`)
  console.log(`  class published with NO owner         : ${publishedOwnerLost.length}`)
  for (const s of publishedOwnerLost.slice(0, 12)) console.log(`      ${s.file}:${s.line} ${s.shape} name=${s.declaredName} macro=${s.macro}`)
  console.log(`  returnType published as the MACRO     : ${payloadMacroType.length}`)
  for (const s of payloadMacroType.slice(0, 12)) console.log(`      ${s.file} ${s.name} returnType=${JSON.stringify(s.returnType)}`)
  console.log(`  contains global -> X rows             : ${globalContains.length}`)
  for (const s of globalContains.slice(0, 12)) console.log(`      ${s.file} -> ${s.target} line=${s.line}`)
  console.log(`  exports edges emitted                 : ${exportsEdges.length}`)
  console.log(`\nevidence: ${outPath}`)
}

await main()