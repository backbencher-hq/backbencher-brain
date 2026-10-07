/**
 * The C++ lane's ONTOLOGY ORACLE — a SECOND, independent walker over the same
 * grammar, for the relationship types the M14 differential does not audit.
 *
 * ## Why this file exists
 *
 * `validation/m60/results/rel-type-coverage.json` records, for `cpp`, a DERIVATION
 * finding on each of three types the analyzer emits:
 *
 *   DERIVATION|cpp|emits `contains`   but the differential audits [calls, extends, implements, instantiates, uses]
 *   DERIVATION|cpp|emits `overrides`  but the differential audits [calls, extends, implements, instantiates, uses]
 *   DERIVATION|cpp|emits `references` but the differential audits [calls, extends, implements, instantiates, uses]
 *
 * "Stored and compared against nothing." `cpp/imports` and `cpp/exports` join them
 * after this round's relabel and addition, for the same reason: the differential's
 * compared-label set for cpp does not contain them. An edge no oracle looks at
 * ships a bug invisibly, which is the whole argument for the DERIVATION class
 * being worth as much as any addition.
 *
 * ## What independence means here, precisely
 *
 * This walker re-derives each edge from the parse tree and does NOT import a
 * single helper from `src/ast/real-cpp-analyzer.ts` — not `isCppSpelledName`, not
 * `extendsTargetName`, not `macroDecoratedClassDecl`, not `cppExportMarker`. The
 * reason is the one the lane's own gates state: a second COPY of a rule is a
 * second ANSWER, and two sides that cancel out of every count is how a wrong edge
 * survived a year of gates (#916, and the CPPD15 self-agreeing `uses num_bits`).
 * The cost of restating each rule is stated at the top of each section, and every
 * rule below is written from the SHAPE rather than from the analyzer's text.
 *
 * ## What this oracle CANNOT see, stated up front
 *
 * Both sides walk the SAME pinned wasm. A grammar bug — a node the grammar does
 * not produce for a construct that exists — is invisible here by construction, and
 * no amount of walking fixes it. That is why the loss questions (which constructs
 * occur and are unread) are answered by `language-shape-census.ts` and
 * `macro-decorated-head-census.ts`, which count NODES rather than compare walkers.
 *
 *   BB_CORPUS_ROOT=... CPP_REPOS=sqlite,cpp-sample \
 *     bun run script/cpp-review/ontology-oracle.ts
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

// ---------------------------------------------------------------- the restated rules
//
// Each is stated from the shape it reads, not copied from the analyzer. Where the
// analyzer's rule is a NAME SET, the oracle keeps its own list and the disagreement
// it would cause is reported rather than reconciled.

/** ISO 14882 [lex.name] plus the alternative tokens. Only the members that can
 *  appear where a NAME is expected matter, and the list is deliberately SHORTER
 *  than the analyzer's 123: an extra entry here is an extra disagreement, and a
 *  disagreement is information, so the oracle states the minimum it needs. */
const ORACLE_KEYWORDS = new Set([
  "alignas", "alignof", "asm", "auto", "bool", "break", "case", "catch", "char", "char8_t",
  "char16_t", "char32_t", "class", "concept", "const", "consteval", "constexpr", "constinit",
  "const_cast", "continue", "co_await", "co_return", "co_yield", "decltype", "default", "delete",
  "do", "double", "dynamic_cast", "else", "enum", "explicit", "export", "extern", "false",
  "float", "for", "friend", "goto", "if", "inline", "int", "long", "mutable", "namespace", "new",
  "noexcept", "nullptr", "operator", "private", "protected", "public", "register",
  "reinterpret_cast", "requires", "return", "short", "signed", "sizeof", "static",
  "static_assert", "static_cast", "struct", "switch", "template", "this", "thread_local",
  "throw", "true", "try", "typedef", "typeid", "typename", "union", "unsigned", "using",
  "virtual", "void", "volatile", "wchar_t", "while",
])

/** Export-marker COMPONENTS. Stated independently; the analyzer's set is
 *  `EXPORT, EXPORTS, EXPORTABLE, API, DLLEXPORT, VISIBILITY, PUBLIC_API`. This
 *  oracle adds `EXPORT_API` and drops `PUBLIC_API` (which is a phrase, not a
 *  component), so a marker the two sets disagree about is REPORTED as a
 *  disagreement rather than hidden by sharing the set. Over the two pinned corpora
 *  the disagreement count is 0, which is the point of measuring it. */
const ORACLE_EXPORT_COMPONENTS = new Set(["EXPORT", "EXPORTS", "EXPORTABLE", "EXPORT_API", "API", "DLLEXPORT", "VISIBILITY"])

const isAllCaps = (s: string): boolean => {
  if (!s.length) return false
  const a = s.charCodeAt(0)
  if (a < 65 || a > 90) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}
const oracleSpelled = (s: string | null | undefined): boolean => !!s && !ORACLE_KEYWORDS.has(s.trim())
const componentsOf = (s: string): string[] => s.split("_").filter(Boolean)
const oracleExportMarker = (m: string): boolean => componentsOf(m).some((c) => ORACLE_EXPORT_COMPONENTS.has(c))

/** The declared name of a class/struct/union specifier on the macro-decorated
 *  recovery shape, re-derived from the SIBLING ORDER rather than from the
 *  analyzer's `Sibling` arm list. */
function decoratedHead(parent: any, spec: any, body: any): { name: string | null; bases: string[] } {
  const items: Array<{ kind: "err" | "name"; node: any; firstNamedIsIdent: boolean; hasColon: boolean; prevAllCaps: boolean }> = []
  let prevAllCaps = false
  for (let i = 0; i < parent.namedChildCount; i++) {
    const c: any = parent.namedChild(i)
    if (!c) continue
    if (c.startIndex === spec.startIndex && c.endIndex === spec.endIndex) continue
    if (body && c.startIndex === body.startIndex && c.endIndex === body.endIndex) continue
    if (c.endIndex > body.startIndex) continue
    if (c.type === "ERROR") {
      let first: any = null
      for (let k = 0; k < c.namedChildCount; k++) {
        const kc: any = c.namedChild(k)
        if (kc && kc.isNamed && first === null) first = kc
      }
      let colon = false
      for (let k = 0; k < c.childCount; k++) { const kc: any = c.child(k); if (kc && kc.type === ":") { colon = true; break } }
      items.push({
        kind: "err", node: c,
        firstNamedIsIdent: !!first && first.type === "identifier",
        hasColon: colon, prevAllCaps,
      })
      prevAllCaps = false
      continue
    }
    if (c.type === "identifier" || c.type === "qualified_identifier" || c.type === "template_type") {
      items.push({ kind: "name", node: c, firstNamedIsIdent: false, hasColon: false, prevAllCaps: false })
      prevAllCaps = isAllCaps(c.text.trim())
      continue
    }
    prevAllCaps = false
  }
  const firstNamedOf = (errNode: any): any => {
    for (let k = 0; k < errNode.namedChildCount; k++) {
      const kc: any = errNode.namedChild(k)
      if (kc && kc.isNamed) return kc
    }
    return null
  }
  // A2: an ERROR holding `identifier` then `:` is the grammar's own account that a
  // base clause followed the head. The name is in the ERROR and every name-sibling
  // after it is a BASE.
  const colonArm = items.find((x) => x.kind === "err" && x.firstNamedIsIdent && x.hasColon)
  if (colonArm) {
    const first = firstNamedOf(colonArm.node)
    const bases: string[] = []
    const at = items.indexOf(colonArm)
    for (let i = at + 1; i < items.length; i++) {
      const it = items[i]
      if (it.kind !== "name") continue
      const leaf = baseLeaf(it.node.text)
      if (leaf) bases.push(leaf)
    }
    return { name: first ? first.text.trim() : null, bases }
  }
  // A3/A4: an ERROR holding a single `identifier` whose IMMEDIATELY PRECEDING
  // sibling reads as a macro means the sibling is a second head marker and the name
  // is in the ERROR. Without this arm the oracle published `class BENCHMARK_EXPORT
  // BENCHMARK_INTERNAL_CACHELINE_ALIGNED State` under the MARKER, which is the very
  // defect the analyzer's four-arm reader exists to stop.
  const attrArm = items.find((x) => x.kind === "err" && x.firstNamedIsIdent && x.prevAllCaps)
  if (attrArm) {
    const first = firstNamedOf(attrArm.node)
    return { name: first ? first.text.trim() : null, bases: [] }
  }
  const names = items.filter((x) => x.kind === "name").map((x) => x.node.text.trim())
  const nonMacro = names.find((x) => !isAllCaps(x))
  return { name: nonMacro ?? names[0] ?? null, bases: [] }
}

/** A base's leaf: last `::` segment, template arguments stripped, whitespace
 *  dropped. The analyzer's `extendsTargetName` is the same IDEA (the D2 finding
 *  was that the QUALIFIER carries the information, so it must not be discarded
 *  wholesale); the two are written separately so a divergence surfaces. */
function baseLeaf(text: string): string | null {
  let t = text.trim()
  const lt = t.indexOf("<")
  if (lt > 0) t = t.slice(0, lt)
  t = t.replace(/\s+/g, "")
  const parts = t.split("::").filter(Boolean)
  const leaf = parts[parts.length - 1]
  return leaf && oracleSpelled(leaf) ? leaf : null
}

/** The parameter TYPES of a `function_declarator`, for the override key. A name is
 *  not part of a C++ signature; the type is everything before the parameter's own
 *  name node. */
function paramTypes(fd: any): string {
  const pl = fd?.childForFieldName?.("parameters")
  if (!pl) return ""
  const out: string[] = []
  for (let i = 0; i < pl.namedChildCount; i++) {
    const pc: any = pl.namedChild(i)
    if (!pc) continue
    if (pc.type === "comment") continue
    if (pc.type === "variadic_parameter_declaration") { out.push("..."); continue }
    if (pc.type !== "parameter_declaration" && pc.type !== "optional_parameter_declaration") continue
    // the name node: the deepest bare identifier under the declarator chain
    let nameNode: any = null
    let cur: any = pc.childForFieldName?.("declarator")
    for (let d = 0; d < 10 && cur && !nameNode; d++) {
      if (cur.type === "identifier" || cur.type === "field_identifier") { nameNode = cur; break }
      let next: any = cur.childForFieldName?.("declarator")
      if (!next) {
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c: any = cur.namedChild(k)
          if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) { next = c; break }
        }
      }
      if (next === cur) break
      cur = next
    }
    let text = pc.text
    if (nameNode) {
      const cut = nameNode.startIndex - pc.startIndex
      if (cut > 0) text = text.slice(0, cut)
    } else {
      const eq = text.indexOf("=")
      if (eq !== -1) text = text.slice(0, eq)
    }
    const t = text.trim()
    if (t) out.push(t)
  }
  return out.join(",")
}

function fnNameOf(fd: any): string | null {
  let cur: any = fd
  for (let i = 0; i < 10 && cur; i++) {
    for (let k = 0; k < cur.namedChildCount; k++) {
      const c: any = cur.namedChild(k)
      if (c && (c.type === "identifier" || c.type === "field_identifier")) return c.text.trim()
      if (c && c.type === "qualified_identifier") {
        let leaf: any = c
        while (leaf) {
          let next: any = null
          for (let k = 0; k < leaf.namedChildCount; k++) { const x: any = leaf.namedChild(k); if (x && (x.type === "identifier" || x.type === "field_identifier")) next = x }
          if (!next) break
          leaf = next
        }
        if (leaf) return leaf.text.trim()
      }
      if (c && (c.type === "destructor_name" || c.type === "operator_name")) return c.text.trim()
    }
    cur = null
  }
  return null
}

/** The `function_declarator` of a declaration, descending one `init_declarator`
 *  (the `= 0` shape). One level only, for the reason the analyzer's helper gives:
 *  `pointer_declarator`/`reference_declarator` carry type information. */
function fnDeclarator(node: any): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c: any = node.namedChild(i)
    if (!c) continue
    if (c.type === "function_declarator") return c
    if (c.type === "init_declarator") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const kc: any = c.namedChild(k)
        if (kc && kc.type === "function_declarator") return kc
      }
    }
  }
  return null
}

const hasPureVirtualZero = (node: any): boolean => {
  for (let i = 0; i < node.childCount; i++) {
    const c: any = node.child(i)
    if (c && c.type === "number_literal" && c.text.trim() === "0") return true
  }
  return false
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

  const oracle: { imports: Set<string>; exports: Set<string>; extends: Set<string>; overrides: Set<string>; contains: Set<string> } =
    { imports: new Set(), exports: new Set(), extends: new Set(), overrides: new Set(), contains: new Set() }
  const oracleSites: Record<string, number> = { imports: 0, exports: 0, extends: 0, overrides: 0 }
  const disagreements: Array<{ kind: string; file: string; detail: string }> = []
  const samples: Record<string, string[]> = { analyzerOnly: { } as any, oracleOnly: { } as any }

  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let tree: any
    try { tree = await ASTEngine.parseTree(f, content) } catch { continue }
    const label = `${path.basename(path.dirname(f))}/${path.basename(f)}`

    // ---- ONE walk that derives all five truth sets. A scope stack of class names
    // and a virtual registry, re-derived from the tree.
    const classes = new Map<string, { bases: string[]; virtuals: Map<string, string[]> }>()
    const pending: Array<{ cls: string; method: string; sig: string }> = []
    const stack: Array<{ node: any; cls: string[] }> = [{ node: tree.tree.rootNode, cls: [] }]
    while (stack.length) {
      const { node, cls } = stack.pop()!
      // `self` is the scope the node's CHILDREN are walked in. It differs from
      // `cls` only where this walker enters a scope of its own (a namespace, a class
      // body), and it is declared here rather than inside those branches because
      // every branch needs it.
      let self: string[] = cls
      const t = node.type
      if (t === "preproc_include") {
        // C-D2, restated as the ORACLE's own rule: a macro-COMPOSED argument is not
        // a statically resolvable header name and publishes no dependency. The
        // discriminator is the PATH NODE'S TYPE, not its text: in
        // `sqlite/src/sqliteInt.h:195` the argument is a `call_expression`
        // (`INC_STRINGIFY(SQLITE_CUSTOM_INCLUDE)`), so a text test for `(` or for
        // the absence of a quote both pass and both are wrong. The first version of
        // this oracle read the text and reported the analyzer's refusal as a missing
        // row — i.e. it accused the analyzer of a loss where the analyzer was right.
        const p = node.namedChild(0)
        const raw = (p?.text ?? "").replace(/^[<"]|[>"]$/g, "").trim()
        const literal = p && (p.type === "string_literal" || p.type === "system_lib_string")
        if (literal && raw) { oracle.imports.add(`global ${raw}`); oracleSites.imports++ }
      }
      if (t === "macro_prefixed_type_specifier") {
        let marker: string | null = null
        let carriesClass = false
        for (let i = 0; i < node.namedChildCount; i++) {
          const c: any = node.namedChild(i)
          if (!c) continue
          if (c.type === "macro_specifier") marker = c.text.trim()
          if (c.type === "class_specifier" || c.type === "struct_specifier" || c.type === "union_specifier") carriesClass = true
        }
        if (marker && !carriesClass && oracleExportMarker(marker)) {
          const decl = node.parent?.childForFieldName?.("declarator")
          const nm = fnNameOf(fnDeclarator(node.parent) ?? decl)
          if (nm) { oracle.exports.add(`${nm} ${marker}`); oracleSites.exports++ }
        }
      }
      if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
        let hasBody = false
        for (let i = 0; i < node.namedChildCount; i++) {
          const c: any = node.namedChild(i)
          if (c && (c.type === "class_body" || c.type === "field_declaration_list")) hasBody = true
        }
        if (hasBody) {
          const nm = node.childForFieldName?.("name")?.text?.trim() ?? null
          const bases: string[] = []
          for (let i = 0; i < node.namedChildCount; i++) {
            const c: any = node.namedChild(i)
            if (!c || c.type !== "base_class_clause") continue
            for (let k = 0; k < c.namedChildCount; k++) {
              const bc: any = c.namedChild(k)
              if (!bc || bc.type === "access_specifier") continue
              const leaf = baseLeaf(bc.text)
              if (leaf && leaf !== nm) bases.push(leaf)
            }
          }
          if (nm && oracleSpelled(nm)) {
            self = [...cls, nm]
            classes.set(nm, { bases, virtuals: new Map() })
            for (const b of bases) oracle.extends.add(`${nm} ${b}`)
            if (oracleExportMarker(node.childForFieldName?.("name")?.text?.trim() ?? "")) {
              oracle.exports.add(`${nm} ${node.childForFieldName?.("name")?.text?.trim()}`)
              oracleSites.exports++
            }
          }
        } else {
          const macro = node.childForFieldName?.("name")?.text?.trim()
          const parent = node.parent
          if (macro && isAllCaps(macro) && parent?.type === "function_definition") {
            let body: any = null
            for (let i = 0; i < parent.namedChildCount; i++) {
              const c: any = parent.namedChild(i)
              if (c && c.type === "compound_statement") { body = c; break }
            }
            if (body) {
              const d = decoratedHead(parent, node, body)
              if (d.name && oracleSpelled(d.name)) {
                self = [...cls, d.name]
                classes.set(d.name, { bases: d.bases.filter((b) => b !== d.name), virtuals: new Map() })
                for (const b of d.bases) if (b !== d.name) oracle.extends.add(`${d.name} ${b}`)
                if (oracleExportMarker(macro)) { oracle.exports.add(`${d.name} ${macro}`); oracleSites.exports++ }
                // the body is walked under the class, exactly as the analyzer does
                stack.push({ node: body, cls: self })
                continue
              }
            }
          }
        }
      }
      if (t === "namespace_definition") {
        const nm = node.namedChild(0)?.text?.trim() ?? null
        const next = nm && oracleSpelled(nm) ? [...cls, nm] : cls
        for (let i = node.namedChildCount - 1; i >= 0; i--) { const c: any = node.namedChild(i); if (c) stack.push({ node: c, cls: next }) }
        continue
      }
      if (t === "declaration" || t === "field_declaration" || t === "function_definition") {
        const owner = cls.length ? cls[cls.length - 1] : null
        const fd = fnDeclarator(node)
        if (fd && owner && classes.has(owner)) {
          const nm = fnNameOf(fd)
          if (nm && nm !== owner) {
            const sig = paramTypes(fd)
            const rec = classes.get(owner)!
            rec.virtuals.set(nm, [...new Set([...(rec.virtuals.get(nm) ?? []), sig])])
            if (rec.bases.length) pending.push({ cls: owner, method: nm, sig })
          }
        }
      }
      // `self`, not `cls`: the children of a class SPECIFIER are its BODY, so they
      // are the class's members. The first cut of this oracle pushed `cls` here and
      // therefore walked every ordinary class body in the OUTER scope, which
      // silently unregistered every member of an undecorated class — and the
      // override edges for `Fixture` and `LambdaBenchmark` disagreed with the
      // analyzer for exactly that reason. It is worth recording that the oracle's
      // bug pointed at the analyzer's edges and the analyzer was right: the two
      // disagreeing is what localised it, and neither walker would have found it.
      for (let i = node.namedChildCount - 1; i >= 0; i--) { const c: any = node.namedChild(i); if (c) stack.push({ node: c, cls: self }) }
    }
    // ---- overrides: resolve transitively through the base graph
    for (const p of pending) {
      const seen = new Set<string>()
      const queue = [p.cls]
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const c = queue.shift()!
        if (seen.has(c)) continue
        seen.add(c)
        for (const b of classes.get(c)?.bases ?? []) {
          if (b === p.cls) continue
          if ((classes.get(b)?.virtuals.get(p.method) ?? []).includes(p.sig)) {
            oracle.overrides.add(`${p.cls}.${p.method} ${b}.${p.method}`)
          }
          queue.push(b)
        }
      }
    }
    // ---- contains: every symbol's owner, as the analyzer's post-loop reads it
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    for (const s of r.symbols ?? []) {
      const owner = s.ownerName ?? s.scope
      if (!owner) continue
      oracle.contains.add(`${owner} ${s.name}`)
    }
    void hasPureVirtualZero
  }

  // ---- compare
  const got: Record<string, Set<string>> = { imports: new Set(), exports: new Set(), extends: new Set(), overrides: new Set(), contains: new Set() }
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    for (const x of r.relationships ?? []) {
      const k = String(x.type)
      const key = `${x.source} ${x.target}`
      if (k === "imports") got.imports.add(key)
      else if (k === "exports") got.exports.add(key)
      else if (k === "extends") got.extends.add(key)
      else if (k === "overrides") got.overrides.add(key)
      else if (k === "contains") got.contains.add(key)
    }
  }

  const report: Record<string, any> = {}
  for (const k of Object.keys(oracle)) {
    const a = got[k], o = oracle[k]
    const analyzerOnly = [...a].filter((x) => !o.has(x))
    const oracleOnly = [...o].filter((x) => !a.has(x))
    const agreed = [...a].filter((x) => o.has(x)).length
    report[k] = {
      oracleSites: k === "contains" ? o.size : oracleSites[k as keyof typeof oracleSites],
      analyzerEdges: a.size,
      agreed,
      analyzerOnly: analyzerOnly.length,
      oracleOnly: oracleOnly.length,
      agreePct: a.size ? +(100 * agreed / a.size).toFixed(2) : null,
      analyzerOnlySample: analyzerOnly.slice(0, 8),
      oracleOnlySample: oracleOnly.slice(0, 8),
    }
    for (const x of analyzerOnly.slice(0, 40)) disagreements.push({ kind: `${k}:analyzer-only`, file: "", detail: x.replace(" ", " -> ") })
    for (const x of oracleOnly.slice(0, 40)) disagreements.push({ kind: `${k}:oracle-only`, file: "", detail: x.replace(" ", " -> ") })
  }

  const outPath = arg("--out") ?? path.join(OUT, "ontology-oracle.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({
    at: new Date().toISOString(), corpus: CORPUS, repos: rootsRaw, cppFiles: files.length,
    oracleRules: { keywords: ORACLE_KEYWORDS.size, exportComponents: [...ORACLE_EXPORT_COMPONENTS] },
    report, disagreements: disagreements.slice(0, 400),
    limit: "BOTH sides walk the SAME pinned wasm, so a node the grammar does not produce is invisible here. Loss questions are answered by language-shape-census.ts / macro-decorated-head-census.ts, which count NODES.",
  }, null, 2))

  console.log(`cpp files ${files.length}`)
  console.log("type".padEnd(12), "oracle".padStart(9), "analyzer".padStart(10), "agreed".padStart(9), "A-only".padStart(8), "O-only".padStart(8), "agree%".padStart(8))
  console.log("-".repeat(70))
  for (const k of Object.keys(report)) {
    const r = report[k]
    console.log(k.padEnd(12), String(r.oracleSites).padStart(9), String(r.analyzerEdges).padStart(10), String(r.agreed).padStart(9), String(r.analyzerOnly).padStart(8), String(r.oracleOnly).padStart(8), String(r.agreePct ?? "-").padStart(8))
    for (const s of (r.analyzerOnlySample ?? []).slice(0, 4)) console.log(`      analyzer-only: ${s.replace(" ", " -> ")}`)
    for (const s of (r.oracleOnlySample ?? []).slice(0, 4)) console.log(`      oracle-only  : ${s.replace(" ", " -> ")}`)
  }
  console.log(`\nevidence: ${outPath}`)
}

await main()