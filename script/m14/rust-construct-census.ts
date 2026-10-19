/**
 * rust-construct-census — the LIGHT census limb of the rust lane's fleet-phase D1/D2 work.
 *
 * WHY THIS FILE EXISTS (and why not `rust-ontology-census.ts`): that instrument drives the PRODUCTION
 * entry (`parseFile` from pool-worker), which re-initialises the engine per file/batch. A whole-corpus
 * run of it was started as a "light census" and had to be STOPPED — it is a heavy instrument on this
 * corpus (parser engine reloads visible in its log, box at 0 GB available). No number is cited from that
 * aborted run. This file is genuinely light: ONE in-process tree-sitter parser + the real analyzer class,
 * no engine spawn, no database, no resolution — it answers the two D1 questions and nothing else:
 *
 *   1. WHICH relationship types does the analyzer EMIT over the whole admitted population (counts by
 *      type, distinct files, confidence/metadata shapes, top targets)?
 *   2. WHAT CONSTRUCTS does the pinned grammar actually contain (per node type / shape), so the
 *      APPLICABLE SET is ruled from evidence in the corpus rather than from intuition — including the
 *      four extended values (decorates/renders/mixes_in/part_of) whose cell must be either an E count
 *      or a RULED <basis> with a measured falsifier.
 *
 * Population = the gate's own admission rule: tracked files (`git ls-files` per corpus repo, statSync
 * through the symlinked checkouts — never a recursive grep), language detection == rust, ≤1 MB.
 *
 * CLI: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/rust-construct-census.ts [--json=path] [--text]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => { const j = process.argv.find((a) => a.startsWith(`${f}=`)); return j ? j.slice(f.length + 1) : null }
const JSON_OUT = argOf("--json")
const TEXT = process.argv.includes("--text")
const MAX_BYTES = 1024 * 1024

// ── population (statSync walk over the symlinked corpus; no grep -r) ────────────────────────────────
type F = { repo: string; rel: string; abs: string; bytes: number }
const files: F[] = []
const repos = fs.readdirSync(CR).filter((e) => { try { return fs.statSync(path.join(CR, e)).isDirectory() } catch { return false } })
const repoStats: Record<string, { tracked: number; admitted: number; absent: number; oversize: number }> = {}
for (const repo of repos.sort()) {
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  const st = { tracked: 0, admitted: 0, absent: 0, oversize: 0 }
  for (const rel of tracked) {
    const abs = path.join(CR, repo, rel)
    let size = 0
    try { size = fs.statSync(abs).size } catch { st.absent++; continue }
    if (detectLanguageFromPath(abs) !== "rust") continue
    st.tracked++
    if (size > MAX_BYTES) { st.oversize++; continue }
    st.admitted++
    files.push({ repo, rel, abs, bytes: size })
  }
  if (st.tracked > 0 || st.absent > 0) repoStats[repo] = st
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))

// ── light in-process parse + analyzer ───────────────────────────────────────────────────────────────
const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const rustMod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
const parser: any = await getParser("rust")

const n = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
const top = (m: Record<string, number>, k = 20) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, k))

const nodeTypes: Record<string, number> = {}
const constructs: Record<string, number> = {}
const deriveNames: Record<string, number> = {}
const macroNames: Record<string, number> = {}
const operatorImpls: Record<string, number> = {}
const traitNames: Record<string, number> = {}
const implTraitNames: Record<string, number> = {}
const useShapes: Record<string, number> = {}
let parsed = 0, bytes = 0, parseErrors = 0
const mismatchSamples: Array<Record<string, unknown>> = []

const emitted: Record<string, { rows: number; files: Set<string>; conf: Record<string, number>; mdKeys: Record<string, number>; targets: Record<string, number> }> = {}
let symbolTotal = 0, symbolOwned = 0
const symbolKinds: Record<string, number> = {}
const bumped = (t: string) => (emitted[t] ??= { rows: 0, files: new Set(), conf: {}, mdKeys: {}, targets: {} })

const walk = (root: any, onNode: (x: any) => void) => {
  const stack = [root]
  while (stack.length > 0) {
    const x = stack.pop()!
    onNode(x)
    for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) stack.push(c) }
  }
}
const leafText = (node: any): string => {
  let t = String(node?.text ?? "")
  const lt = t.indexOf("<"); if (lt > 0) t = t.slice(0, lt)
  return t.split("::").filter(Boolean).pop()?.trim() ?? ""
}

for (const f of files) {
  let src = ""
  try { src = fs.readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  parsed++; bytes += f.bytes
  if (tree.rootNode.hasError) parseErrors++
  walk(tree.rootNode, (x: any) => {
    const t = String(x.type)
    n(nodeTypes, t)
    if (t === "attribute_item" || t === "inner_attribute_item") {
      n(constructs, "attribute")
      const text = String(x.text ?? "")
      if (text.includes("derive(")) {
        n(constructs, "attribute.derive")
        const i = text.indexOf("derive(") + 7, j = text.indexOf(")", i)
        if (j > i) for (const part of text.slice(i, j).split(",")) { const leaf = part.trim().split("::").filter(Boolean).pop() ?? ""; if (leaf) n(deriveNames, leaf) }
      }
      if (text.startsWith("#[cfg") || text.startsWith("#![cfg")) n(constructs, "attribute.cfg")
      if (text.startsWith("#[doc") || text.startsWith("#![")) { if (text.startsWith("#[doc")) n(constructs, "attribute.doc") }
      if (text.startsWith("#[test]") || text.startsWith("#[tokio::test")) n(constructs, "attribute.test")
      if (text.includes("::") && !text.includes("derive(")) n(constructs, "attribute.path_qualified")
      // actix-style route attributes (the analyzer publishes an `exports` row for these)
      if (t === "attribute_item") {
        const body = text.slice(text.startsWith("#![") ? 3 : 2).trim()
        for (const verb of ["get","post","put","delete","patch","head","options","trace","route"]) {
          if (body.startsWith(verb) && (body[verb.length] === "(" || body[verb.length] === " " || body[verb.length] === "\t")) { n(constructs, "attribute.route"); break }
        }
      }
      if (t === "inner_attribute_item") n(constructs, "attribute.inner")
    } else if (t === "impl_item") {
      n(constructs, "impl")
      const traitN = x.childForFieldName?.("trait")
      const typeN = x.childForFieldName?.("type")
      if (traitN && typeN) {
        n(constructs, "impl.trait_for_type")
        const tl = leafText(traitN); if (tl) n(implTraitNames, tl)
        // OVERRIDES CONSTRUCT SITES: every method declared inside `impl Trait for Type`
        // (the analyzer publishes each as an overrides row; local-trait non-members are refused later)
        for (let i = 0; i < x.namedChildCount; i++) {
          const c = x.namedChild(i)
          if (c && c.type === "declaration_list") walk(c, (m: any) => { if (m.type === "function_item") n(constructs, "impl.trait_method_site") })
        }
        if (["Add","Sub","Mul","Div","Rem","Neg","Not","Index","Deref","DerefMut","Drop","Clone","Default","PartialEq","Eq","PartialOrd","Ord","Hash","Iterator","IntoIterator","From","Into","TryFrom","TryInto","Display","Debug","Serialize","Deserialize"].includes(tl)) n(operatorImpls, tl)
      } else n(constructs, "impl.inherent")
      if (String(x.text ?? "").includes(" for ")) n(constructs, "impl.for_spelling")
    } else if (t === "trait_item") {
      n(constructs, "trait")
      const name = x.childForFieldName?.("name")?.text ?? ""
      if (name) n(traitNames, name)
      let bounded = false
      for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c && String(c.type).includes("bounds")) { bounded = true } }
      if (bounded) n(constructs, "trait.supertraits")
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        if (c && String(c.type).includes("bounds")) {
          // the analyzer's EXTENDS site: each direct type child of the bounds node
          for (let j = 0; j < c.namedChildCount; j++) {
            const b = c.namedChild(j)
            const bt = String(b?.type ?? "")
            if (bt === "type_identifier" || bt === "scoped_type_identifier" || bt === "generic_type" || bt === "higher_ranked_trait_bound") n(constructs, "trait.bound_site")
          }
        }
      }
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        if (c && c.type === "declaration_list") walk(c, (m: any) => {
          if (m.type === "function_item" && m.childForFieldName?.("body")) n(constructs, "trait.method_with_default")
          if (m.type === "function_signature_item") n(constructs, "trait.method_required")
          if (m.type === "associated_type") n(constructs, "trait.associated_type")
          if (m.type === "const_item") n(constructs, "trait.associated_const")
        })
      }
    } else if (t === "struct_item") n(constructs, "struct")
    // (EXPORT CONSTRUCT SITES + OVERRIDE REFUSALS are computed in dedicated passes below:
    //  the walk cannot know top-level/parent context reliably from the node alone.)
    else if (t === "enum_item") n(constructs, "enum")
    else if (t === "union_item") n(constructs, "union")
    else if (t === "type_item") n(constructs, "type_alias")
    else if (t === "const_item") n(constructs, "const")
    else if (t === "static_item") n(constructs, "static")
    else if (t === "macro_invocation") {
      n(constructs, "macro.invocation")
      const mn = x.childForFieldName?.("macro") ?? x.namedChild(0)
      const nm = leafText(mn); if (nm) n(macroNames, nm)
      if (nm === "include" || nm === "include_str" || nm === "include_bytes") n(constructs, `macro.${nm}`)
    } else if (t === "macro_definition") n(constructs, "macro.definition")
    else if (t === "struct_expression") n(constructs, "struct.literal")
    else if (t === "call_expression") {
      const fn = x.childForFieldName?.("function")
      const ft = String(fn?.type ?? "")
      if (ft === "identifier" || ft === "scoped_type_identifier") {
        // tuple-struct constructor-ish: uppercase callee identifier/scoped path
        const txt = String(fn?.text ?? "")
        const leaf = txt.split("::").filter(Boolean).pop() ?? ""
        if (/^[A-Z]/.test(leaf)) n(constructs, "tuple_struct_or_enum_ctor")
      }
      if (ft === "field_expression") n(constructs, "call.method")
      else n(constructs, "call.free_or_ctor")
    } else if (t === "use_declaration") {
      n(constructs, "use")
      walk(x, (m: any) => { if (["use_wildcard","use_as_clause","scoped_use_list","use_list"].includes(String(m.type))) n(useShapes, String(m.type)) })
    } else if (t === "extern_crate_declaration") n(constructs, "extern_crate")
    else if (t === "mod_item") {
      let inline = false
      for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c && c.type === "declaration_list") inline = true }
      n(constructs, inline ? "mod.inline" : "mod.file_decl")
    } else if (t === "function_item") n(constructs, "fn")
    else if (t === "closure_expression") n(constructs, "closure")
    else if (t === "await_expression") n(constructs, "await")
    else if (t === "async_block") n(constructs, "async_block")
    else if (t === "unsafe_block") n(constructs, "unsafe_block")
    else if (t === "where_clause") n(constructs, "where_clause")
    else if (t === "dyn_trait_type" || t === "trait_object") n(constructs, "dyn_trait")
    else if (t === "impl_trait_type") n(constructs, "impl_trait_type")
    else if (t === "reference_type") n(constructs, "reference_type")
    else if (t === "type_identifier") n(constructs, "type_identifier")
    else if (t === "scoped_identifier") n(constructs, "scoped_identifier")
    else if (t === "field_expression") n(constructs, "field_expression")
    else if (t === "if_expression") n(constructs, "if")
  })
  // ── dedicated construct passes (top-level visibility, overrides refusals) ─────────────────────────
  {
    const root = tree.rootNode
    const isPub = (x: any): boolean => {
      for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c && c.type === "visibility_modifier") return true }
      return false
    }
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (!c) continue
      const ct = String(c.type)
      if (["struct_item","enum_item","trait_item","function_item","mod_item","type_item","const_item","static_item","union_item"].includes(ct) && isPub(c)) n(constructs, "export.pub_item")
      if (ct === "use_declaration" && isPub(c)) n(constructs, "export.pub_use")
      if (ct === "extern_crate_declaration" && isPub(c)) n(constructs, "export.pub_extern_crate")
      if (ct === "impl_item") {
        const traitN = c.childForFieldName?.("trait")
        if (traitN) for (let j = 0; j < c.namedChildCount; j++) {
          const d = c.namedChild(j)
          if (d && d.type === "declaration_list") walk(d, (m: any) => { if (m.type === "function_item") n(constructs, "export.pub_impl_method") })
        }
      }
    }
    // local traits = trait declarations in this file, and their declared method names (overrides refusal)
    const localTraitMethods: Record<string, Set<string>> = {}
    walk(root, (x: any) => {
      if (x.type !== "trait_item") return
      const tn = x.childForFieldName?.("name")?.text ?? ""
      if (!tn) return
      const set = localTraitMethods[tn] ?? (localTraitMethods[tn] = new Set())
      for (let j = 0; j < x.namedChildCount; j++) {
        const d = x.namedChild(j)
        if (d && d.type === "declaration_list") walk(d, (m: any) => { const mn = m.childForFieldName?.("name")?.text ?? (m.type === "function_item" || m.type === "function_signature_item" ? m.childForFieldName?.("name")?.text : ""); if (mn) set.add(mn) })
      }
    })
    let refused = 0, emittedSite = 0
    walk(root, (x: any) => {
      if (x.type !== "impl_item") return
      const traitN = x.childForFieldName?.("trait"); const typeN = x.childForFieldName?.("type")
      if (!traitN || !typeN) return
      const tl = String(traitN.text ?? "").split("::").filter(Boolean).pop()?.replace(/<.*$/, "").trim() ?? ""
      const declared = localTraitMethods[tl]
      for (let j = 0; j < x.namedChildCount; j++) {
        const d = x.namedChild(j)
        if (!d || d.type !== "declaration_list") continue
        walk(d, (m: any) => {
          if (m.type !== "function_item") return
          const mn = m.childForFieldName?.("name")?.text ?? ""
          if (!mn) return
          if (declared && !declared.has(mn)) refused++
          else emittedSite++
        })
      }
    })
    if (refused > 0) { n(constructs, "overrides.refused_local_trait_nonmember"); constructs["overrides.refused_local_trait_nonmember"] += refused - 1 }
    if (emittedSite > 0) { n(constructs, "overrides.site_candidates"); constructs["overrides.site_candidates"] += emittedSite - 1 }
    // reconciliation counts: exports = distinct file-scope published NAMES (top-level pub items ∪
    // re-exported items of publishable pub uses, deduped by name — the analyzer's own unit), imports =
    // distinct module paths per file, overrides = the implementation-MEMBERS the analyzer should see.
    const exportNames = new Set<string>()
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (!c) continue
      const ct = String(c.type)
      if (["struct_item","enum_item","trait_item","function_item","mod_item","type_item","const_item","static_item","union_item"].includes(ct) && isPub(c)) {
        const nm = c.childForFieldName?.("name")?.text ?? ""
        if (nm) exportNames.add(nm)
      }
      if (ct === "use_declaration" && isPub(c)) {
        walk(c, (m: any) => {
          if (m.type === "identifier" || m.type === "type_identifier") {
            const txt = String(m.text ?? "")
            if (txt && txt !== "crate" && txt !== "self" && txt !== "super" && txt !== "std" && txt !== "core" && txt !== "alloc" && txt !== "*") exportNames.add(txt)
          }
        })
      }
    }
    if (exportNames.size > 0) { n(constructs, "exports.expected_distinct_names"); constructs["exports.expected_distinct_names"] += exportNames.size - 1 }
    if (refused >= 0 && emittedSite >= 0) { (globalThis as any).__fileExpect = { exportsExpected: exportNames.size, overridesSite: emittedSite } }
  }
  try {
    const r: any = await new rustMod.RealRustAnalyzer().analyze(tree.rootNode, src, `${f.repo}/${f.rel}`)
    symbolTotal += (r.symbols ?? []).length
    for (const sym of r.symbols ?? []) {
      if (sym.ownerName || (sym.scope && sym.scope !== "global")) symbolOwned++
      n(symbolKinds, String(sym.kind))
    }
    const exp: any = (globalThis as any).__fileExpect ?? {}
    const emitCount = (t: string) => (r.relationships ?? []).filter((x: any) => String(x.type) === t).length
    if (emitCount("overrides") !== (exp.overridesSite ?? 0)) {
      n(constructs, "overrides.files_mismatch")
      if (mismatchSamples.length < 20) mismatchSamples.push({ kind: "overrides", file: `${f.repo}/${f.rel}`, sites: exp.overridesSite, emitted: emitCount("overrides") })
    }
    if (emitCount("exports") > (exp.exportsExpected ?? 0)) {
      n(constructs, "exports.files_exceed_distinct_names")
      if (mismatchSamples.length < 20) mismatchSamples.push({ kind: "exports", file: `${f.repo}/${f.rel}`, expected: exp.exportsExpected, emitted: emitCount("exports") })
    }
    for (const row of r.relationships ?? []) {
      const e = bumped(String(row.type))
      e.rows++
      e.files.add(`${f.repo}/${f.rel}`)
      n(e.conf, String(row.confidence))
      for (const k of Object.keys(row.metadata ?? {})) n(e.mdKeys, k)
      n(e.targets, String(row.target))
    }
  } finally { tree.delete?.() }
}

const labelCensus = Object.fromEntries(Object.entries(emitted).sort((a, b) => b[1].rows - a[1].rows).map(([t, e]) => [t, {
  rows: e.rows, files: e.files.size, topConfidence: top(e.conf, 5), topMetadataKeys: top(e.mdKeys, 12), topTargets: top(e.targets, 15),
}]))
const jsxNodeTypes = Object.keys(nodeTypes).filter((t) => t.startsWith("jsx"))
const report = {
  schemaVersion: 1,
  instrument: "script/m14/rust-construct-census.ts",
  note: "LIGHT census: one in-process parser + the real analyzer class per file; no engine spawn, no database, no resolution. Emitted-relationship counts are what the ANALYZER publishes per file (no project context: import claims require projectRoot and are therefore absent here — D1 counts are unaffected).",
  population: {
    repos: Object.fromEntries(Object.entries(repoStats).filter(([, s]) => s.tracked > 0)),
    reposWithRust: Object.values(repoStats).filter((s) => s.admitted > 0).length,
    admittedFiles: files.length, parsedFiles: parsed, bytes, mib: +(bytes / 1048576).toFixed(1), parseErrorFiles: parseErrors,
  },
  emittedLabels: labelCensus,
  emittedTotals: Object.fromEntries(Object.entries(labelCensus).map(([t, e]) => [t, e.rows])),
  grammar: { nodeTypesSeen: Object.keys(nodeTypes).length, jsxNodeTypes, topNodeTypes: top(nodeTypes, 25) },
  symbols: { total: symbolTotal, owned: symbolOwned, kinds: top(symbolKinds, 20) },
  constructs: {
    totals: top(constructs, 60),
    reconciliationSamples: mismatchSamples,
    deriveNames: top(deriveNames, 25),
    macroNames: top(macroNames, 20),
    operatorImpls: top(operatorImpls, 30),
    traitNames: top(traitNames, 25),
    implTraitNames: top(implTraitNames, 40),
    useShapes: top(useShapes, 8),
  },
  applicableSet: {
    rule: "A value is EMITTED with a measured corpus count; a value not emitted is RULED with a measured falsifier (construct counts + grammar inventory), never by intuition.",
    extendedFalsifiers: {
      renders: { basis: "grammar inventory: the pinned rust grammar produces no jsx_* node type", measured: { jsxNodeTypes } },
      part_of: { basis: "rust has no `part`/`part of` source-composition directive; module composition is `mod` (ownership) and textual inclusion is the `include!` family — measured", measured: { modFileDecls: constructs["mod.file_decl"] ?? 0, modInline: constructs["mod.inline"] ?? 0, includeMacros: (constructs["macro.include"] ?? 0) + (constructs["macro.include_str"] ?? 0) + (constructs["macro.include_bytes"] ?? 0) } },
      decorates: { basis: "CPP precedent in the extended matrix: attributes adjudicated as METADATA/EXPORTS (framework detection, route exports), not a decorator relationship; measured attribute population below", measured: { attributes: constructs["attribute"] ?? 0, deriveAttributes: constructs["attribute.derive"] ?? 0, cfg: constructs["attribute.cfg"] ?? 0, qualifiedPathAttributes: constructs["attribute.path_qualified"] ?? 0, actixRouteExports: emitted["exports"]?.rows ?? 0 } },
      mixes_in: { basis: "rust has no `with`-clause mixin construct; the trait composition construct is `impl Trait for Type`, already EMITTED as `implements` with a fixture", measured: { traitForTypeImpls: constructs["impl.trait_for_type"] ?? 0, implementsRows: emitted["implements"]?.rows ?? 0 } },
    },
  },
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1) + "\n")
if (TEXT || !JSON_OUT) {
  console.log(`rust construct census — ${files.length} admitted .rs, ${parsed} parsed, ${report.population.mib} MiB, parse-error files ${parseErrors}`)
  console.log(`EMITTED LABELS (${Object.keys(labelCensus).length}): ${JSON.stringify(report.emittedTotals)}`)
  console.log(`constructs: ${JSON.stringify(top(constructs, 30))}`)
  console.log(`derives: ${JSON.stringify(top(deriveNames, 15))}`)
  console.log(`macros: ${JSON.stringify(top(macroNames, 10))}`)
  console.log(`jsx node types: ${JSON.stringify(jsxNodeTypes)}`)
}
