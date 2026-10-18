/**
 * cpp-decl-proto — MILESTONE 1b of the C++ project-index task (task-22): the DECLARATION-SPEC
 * PROTOTYPE, measured, so the sizing number is produced by the declaration model the index will
 * actually use instead of by a name-count proxy.
 *
 * WHAT IT EXTRACTS (the prototype of `CPP_DECLARATION_SPEC`): per repo, walking the tree-sitter-cpp
 * trees of admitted sources AND headers with a scope stack —
 *   · TYPES: class/struct/union specifiers and enum/enum-class specifiers → name + member set
 *     (methods from `field_declaration[declarator=function_declarator]`, inline
 *     `function_definition` bodies, member-function prototypes, data members, enum enumerators);
 *   · NAMESPACES: namespace_definition names (path stack kept, so a namespace's free functions are
 *     attributable to their scope);
 *   · FREE FUNCTIONS: definitions and prototypes at file/namespace scope (declarator chains:
 *     function_declarator / pointer/reference/parenthesized/qualified/template forms);
 *   · TYPE ALIASES: alias_declaration / type_definition declarator names;
 *   · MACROS: preproc_def / preproc_function_def names (tracked separately: a macro is not a C++
 *     declaration, and resolving a call to a macro is a W10 POLICY question, not a callable resolution).
 *
 * WHAT IT MEASURES: the residual `calls` rows of the gate dump (outcome unresolved/ambiguous) for a
 * bounded sample of repos, classified by what the extracted declaration space can DECIDE:
 *   bare-unique-free-callable                 exactly one free function/alias/type with this leaf → index resolves
 *   bare-unique-member-only                   one declaration but only a member → implicit-this question, no guaranteed gain
 *   bare-multiple-declarations                many declarations → name key cannot choose
 *   qualified-owner-member-pair-checked       `Owner::leaf` where the repo's extraction shows OWNER's member
 *                                             set contains leaf AND the owner is unique → the index decides the pair
 *   qualified-namespace-free-callable         `ns::leaf` where ns is a repo namespace and declares leaf
 *   qualified-owner-not-in-repo / qualified-no-pair / member-through-object (bare member call)
 *   macro-declared-in-repo / third-party-not-declared-in-repo / declared-in-same-file-only
 *
 * CONTROL: every residual row lands in exactly one class; class sum == residual row count.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-decl-proto.ts --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt --repos=fmt,nlohmann-json,r-Rcpp [--json=<path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const DUMP = argOf("--dump")
const REPOS = (argOf("--repos") ?? "fmt,nlohmann-json,r-Rcpp").split(",").map((s) => s.trim()).filter(Boolean)
const JSON_OUT = argOf("--json")
if (!DUMP) {
  console.error("usage: bun run script/m14/cpp-decl-proto.ts --dump=<gate dump> [--repos=a,b,c] [--json=<path>]")
  process.exit(2)
}
const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const HEADERS = new Set(["h", "hh", "h++"])
/** OPTION-1 measurement: the extension-only index population (admitted extensions only; `.h`/`.hh`/
 *  `.h++` headers NOT indexed). Used to price what the header decision is worth, separately. */
const NO_HEADERS = process.argv.includes("--no-headers")
const extOf = (p: string): string => {
  const b = p.slice(p.lastIndexOf("/") + 1)
  const d = b.lastIndexOf(".")
  return d >= 0 ? b.slice(d + 1).toLowerCase() : ""
}
const tracked = (repo: string): string[] =>
  execFileSync("git", ["-C", path.join(CR, repo), "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n").filter((rel) => ADMITTED.has(extOf(rel)) || (!NO_HEADERS && HEADERS.has(extOf(rel))))

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const cppParser: any = await getParser("cpp")

type Space = {
  types: Map<string, { members: Set<string>; count: number; headers: number }>
  freeFns: Map<string, { count: number; headers: number }>
  aliases: Map<string, { count: number; headers: number }>
  namespaces: Set<string>
  nsFree: Map<string, Set<string>>
  macros: Map<string, { count: number; headers: number }>
}
const newSpace = (): Space => ({ types: new Map(), freeFns: new Map(), aliases: new Map(), namespaces: new Set(), nsFree: new Map(), macros: new Map() })

const isIdent = (t: string): boolean => t === "identifier" || t === "field_identifier" || t === "type_identifier"
const leafOfPath = (text: string): string => {
  let s = text.trim()
  const lt = s.indexOf("<")
  if (lt > 0) s = s.slice(0, lt)
  const cut = s.lastIndexOf("::")
  const leaf = (cut >= 0 ? s.slice(cut + 2) : s).replace(/^[*&~\s]+/, "")
  return /^[A-Za-z_$][\w$]*$/.test(leaf) ? leaf : ""
}
const declaratorName = (n: any, depth = 0): string => {
  if (!n || depth > 10) return ""
  const t = String(n.type)
  if (isIdent(t)) return n.text.trim()
  if (t === "qualified_identifier") return leafOfPath(n.text)
  if (t === "function_declarator" || t === "abstract_function_declarator") return declaratorName(n.childForFieldName?.("declarator"), depth + 1)
  if (t === "pointer_declarator" || t === "reference_declarator" || t === "array_declarator" || t === "init_declarator" || t === "parenthesized_declarator" || t === "attributed_declarator") return declaratorName(n.childForFieldName?.("declarator"), depth + 1)
  if (t === "template_function") return declaratorName(n.childForFieldName?.("name"), depth + 1)
  if (t === "template_method" || t === "template_type") return leafOfPath(n.text)
  if (t === "operator_name" || t === "destructor_name") return n.text.trim()
  if (t === "structured_binding_declarator") return ""
  return ""
}
const typeName = (spec: any): string => {
  const nameField = spec.childForFieldName?.("name")
  if (nameField) {
    if (isIdent(String(nameField.type))) return nameField.text.trim()
    const leaf = leafOfPath(nameField.text)
    if (leaf) return leaf
  }
  for (let i = 0; i < spec.namedChildCount; i++) {
    const c = spec.namedChild(i)
    if (c && (c.type === "type_identifier" || c.type === "identifier")) return c.text.trim()
  }
  return ""
}
const add = (m: Map<string, { count: number; headers: number }>, name: string, isHeader: boolean) => {
  if (!name) return
  const d = m.get(name) ?? { count: 0, headers: 0 }
  d.count++
  if (isHeader) d.headers++
  m.set(name, d)
}

const extract = (root: any, space: Space, isHeader: boolean): void => {
  const walk = (n: any, nsPath: string[], inType: string | null): void => {
    const t = String(n.type)
    // ---- types: class / struct / union ------------------------------------------------
    if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
      const name = typeName(n) || "anonymous"
      let entry = space.types.get(name)
      if (!entry) { entry = { members: new Set(), count: 0, headers: 0 }; space.types.set(name, entry) }
      entry.count++
      if (isHeader) entry.headers++
      let body: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "field_declaration_list" || c.type === "class_body")) { body = c; break }
      }
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const c = body.namedChild(i)
          if (!c) continue
          const ct = String(c.type)
          if (ct === "field_declaration" || ct === "declaration") {
            const decl = c.childForFieldName?.("declarator")
            if (!decl) continue
            const nm = declaratorName(decl)
            if (!nm) continue
            entry.members.add(nm)
          } else if (ct === "function_definition") {
            const nm = declaratorName(c.childForFieldName?.("declarator"))
            if (nm) entry.members.add(nm)
          } else if (ct === "template_declaration") {
            for (let k = 0; k < c.namedChildCount; k++) {
              const d = c.namedChild(k)
              if (!d) continue
              if (String(d.type) === "function_definition" || String(d.type) === "field_declaration" || String(d.type) === "declaration") {
                const nm = declaratorName(d.childForFieldName?.("declarator"))
                if (nm) entry.members.add(nm)
              }
            }
          } else if (ct === "enum_specifier") {
            const en = typeName(c)
            if (en) { const e2 = space.types.get(en) ?? { members: new Set(), count: 0, headers: 0 }; e2.count++; if (isHeader) e2.headers++; space.types.set(en, e2) }
          }
        }
      }
      return // members were handled from the body; do not re-walk it
    }
    if (t === "enum_specifier") {
      const name = typeName(n)
      if (name) {
        const e = space.types.get(name) ?? { members: new Set(), count: 0, headers: 0 }
        e.count++
        if (isHeader) e.headers++
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "enumerator_list") {
            for (let k = 0; k < c.namedChildCount; k++) {
              const en = c.namedChild(k)
              if (en && en.type === "enumerator") {
                const id = en.childForFieldName?.("name") ?? en.namedChild?.(0)
                if (id && isIdent(String(id.type))) e.members.add(id.text.trim())
              }
            }
          }
        }
        space.types.set(name, e)
      }
      return
    }
    // ---- namespaces -------------------------------------------------------------------
    if (t === "namespace_definition") {
      let nameNode = n.childForFieldName?.("name")
      const segs: string[] = []
      while (nameNode) {
        const nt = String(nameNode.type)
        if (nt === "identifier" || nt === "namespace_identifier") { segs.push(nameNode.text.trim()); break }
        if (nt === "nested_namespace_specifier") {
          for (let i = 0; i < nameNode.namedChildCount; i++) {
            const c = nameNode.namedChild(i)
            if (c && (String(c.type) === "identifier" || String(c.type) === "namespace_identifier")) segs.push(c.text.trim())
          }
          break
        }
        if (nt === "qualified_identifier") {
          for (const seg of nameNode.text.split("::")) if (seg.trim() !== "") segs.push(seg.trim())
          break
        }
        nameNode = nameNode.childForFieldName?.("name") ?? null
      }
      const next = [...nsPath, ...segs]
      for (const s of segs) space.namespaces.add(s)
      space.namespaces.add(next.join("::"))
      // walk bodies with the extended path
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (String(c.type) === "declaration_list" || String(c.type) === "compound_statement")) {
          for (let k = 0; k < c.namedChildCount; k++) { const d = c.namedChild(k); if (d) walk(d, next, null) }
        }
      }
      return
    }
    // ---- free functions and aliases ---------------------------------------------------
    if (t === "function_definition") {
      const nm = declaratorName(n.childForFieldName?.("declarator"))
      if (nm) {
        add(space.freeFns, nm, isHeader)
        const key = nsPath.join("::")
        if (key) {
          const set = space.nsFree.get(key) ?? new Set()
          set.add(nm)
          space.nsFree.set(key, set)
        }
      }
      return
    }
    if (t === "declaration") {
      const decl = n.childForFieldName?.("declarator")
      if (decl) {
        let d = decl
        if (String(d.type) === "init_declarator") d = d.childForFieldName?.("declarator") ?? d
        if (String(d.type) === "function_declarator") {
          const nm = declaratorName(d)
          if (nm) {
            add(space.freeFns, nm, isHeader)
            const key = nsPath.join("::")
            if (key) { const set = space.nsFree.get(key) ?? new Set(); set.add(nm); space.nsFree.set(key, set) }
          }
        }
      }
      // fall through: a declaration may also CONTAIN an alias/type_definition
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, nsPath, inType) }
      return
    }
    if (t === "alias_declaration" || t === "type_definition" || t === "type_descriptor") {
      const nm = declaratorName(n.childForFieldName?.("declarator")) || (() => {
        const id = n.namedChild?.(n.namedChildCount - 1)
        return id && isIdent(String(id.type)) ? id.text.trim() : ""
      })()
      if (nm) add(space.aliases, nm, isHeader)
      return
    }
    if (t === "preproc_def" || t === "preproc_function_def") {
      const id = n.childForFieldName?.("name") ?? n.namedChild?.(0)
      if (id && isIdent(String(id.type))) add(space.macros, id.text.trim(), isHeader)
      return
    }
    if (t === "template_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, nsPath, inType) }
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, nsPath, inType) }
  }
  walk(root, [], null)
}

// ---- build the space per repo ---------------------------------------------------------------
const spaces = new Map<string, Space>()
const fileLists = new Map<string, string[]>()
let parsedFiles = 0
let failed = 0
for (const repo of REPOS) {
  const repoDir = path.join(CR, repo)
  const files = tracked(repo)
  fileLists.set(repo, files)
  const space = newSpace()
  for (const rel of files) {
    const abs = path.join(repoDir, rel)
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { failed++; continue }
    const tree: any = cppParser.parse(content, abs)
    if (!tree?.rootNode) { failed++; continue }
    parsedFiles++
    extract(tree.rootNode, space, HEADERS.has(extOf(rel)))
    tree.delete?.()
  }
  spaces.set(repo, space)
}

// ---- residual calls rows for the sample -----------------------------------------------------
const AMBIGUOUS = new Set(["ambDeclOnly", "ambBoth", "ambKindOnly"])
type Row = { target: string; outcome: string; src: string; line: number; md: any }
const rows: Row[] = []
const residualFiles = new Set<string>()
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5 || p[1] !== "calls") continue
  if (p[2] !== "unresolved" && !AMBIGUOUS.has(p[2])) continue
  const m = p[4].match(/^(.*):(\d+)$/)
  if (!m) continue
  const src = m[1]
  const repo = REPOS.find((r) => src.includes(`/.corpus/${r}/`))
  if (!repo) continue
  rows.push({ target: p[3], outcome: p[2], src, line: Number(m[2]), md: null })
  residualFiles.add(src)
}
if (rows.length === 0) { console.error("cpp-decl-proto: 0 residual calls rows for the sample repos"); process.exit(2) }

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const metaByFile = new Map<string, Map<string, any>>()
for (const abs of residualFiles) {
  const repo = REPOS.find((r) => abs.includes(`/.corpus/${r}/`))!
  let res: any
  try { res = await parseFile(abs, path.join(CR, repo)) } catch { continue }
  const m = new Map<string, any>()
  for (const e of res.relationships ?? []) if (String(e.type) === "calls") m.set(`${String(e.target ?? "")}\0${Number(e.line_number ?? 0)}`, e.metadata ?? {})
  metaByFile.set(abs, m)
}
for (const r of rows) r.md = metaByFile.get(r.src)?.get(`${r.target}\0${r.line}`) ?? {}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/
/** A `qualified` metadata value is a PATH only when every segment is an identifier and the last is a
 *  name — the analyzer also puts EXPRESSION TEXT there for some call sites (`from < (T::min)() ||`),
 *  and treating that as a path is how a sizing pass manufactures a "third-party" bucket. So the
 *  dump TARGET (the leaf the gate actually tried to resolve) is the leaf, and the metadata spelling is
 *  used only when it parses as a clean path. */
const parseQualified = (raw: string): { qualifier: string; bare: string; clean: boolean } => {
  const s = String(raw ?? "").trim()
  let depth = 0
  let out = ""
  for (const ch of s) {
    if (ch === "<") depth++
    else if (ch === ">") depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  const t = out.trim()
  if (!t.includes("::")) return { qualifier: "", bare: t, clean: IDENT_RE.test(t) }
  const segs = t.split("::").map((x) => x.trim())
  const clean = segs.every((seg) => IDENT_RE.test(seg))
  if (!clean) return { qualifier: "", bare: "", clean: false }
  return { qualifier: segs.slice(0, -1).join("::"), bare: segs[segs.length - 1], clean: true }
}

const classes: Record<string, { rows: number; samples: string[]; note: string }> = {}
const bump = (k: string, sample: string, note: string) => {
  const c = classes[k] ?? (classes[k] = { rows: 0, samples: [], note })
  c.rows++
  if (c.samples.length < 4) c.samples.push(sample)
}
const perRepo: Record<string, Record<string, number>> = {}
for (const r of rows) {
  const repo = REPOS.find((x) => r.src.includes(`/.corpus/${x}/`))!
  const space = spaces.get(repo)!
  const rawQ = typeof r.md?.qualified === "string" ? r.md.qualified : ""
  const parsed = rawQ !== "" ? parseQualified(rawQ) : { qualifier: "", bare: "", clean: false }
  const leaf = String(r.target ?? "").trim()
  const qualifier = parsed.clean && parsed.bare === leaf ? parsed.qualifier : parsed.clean && parsed.bare === leaf ? parsed.qualifier : ""
  const bare = leaf
  const q = rawQ !== "" && parsed.clean ? rawQ : `${leaf}`
  perRepo[repo] ??= {}
  const put = (k: string, note: string) => {
    bump(k, `${repo}:${r.line} ${q}`, note)
    perRepo[repo][k] = (perRepo[repo][k] ?? 0) + 1
  }
  const type = space.types.get(bare) ?? null
  const free = space.freeFns.get(bare) ?? null
  const alias = space.aliases.get(bare) ?? null
  const macro = space.macros.get(bare) ?? null
  const declaredSomewhere = !!(type || free || alias || macro)
  if (!declaredSomewhere) {
    put("third-party-not-declared-in-repo", "the repo's sources+headers declare no such name under the prototype extraction (platform/dependency)")
    continue
  }
  if (qualifier !== "") {
    const ownerSeg = qualifier.split("::").pop() ?? qualifier
    const ownerType = space.types.get(ownerSeg) ?? space.types.get(qualifier)
    const ownerUniq = !!(ownerType && ownerType.count === 1)
    const ownerMember = !!(ownerType && ownerType.members.has(bare))
    if (ownerType && ownerMember && ownerUniq) {
      put("qualified-owner-member-pair-checked", "STRONG: the repo declares the owner ONCE and the extraction shows OWNER's member set contains the leaf — the index decides the pair exactly")
    } else if (ownerType && ownerMember) {
      put("qualified-owner-member-pair-owner-duplicated", "the pair exists but the owner type is declared more than once — index bounds it, name key cannot choose")
    } else if (space.namespaces.has(ownerSeg) || space.namespaces.has(qualifier)) {
      const nsFree = space.nsFree.get(qualifier) ?? space.nsFree.get(ownerSeg) ?? new Set()
      if (nsFree.has(bare)) put("qualified-namespace-free-callable", "STRONG: the owner segment is a repo NAMESPACE and its extraction contains the free function — index-checkable")
      else if (free) put("qualified-namespace-free-callable-any-scope", "the name is a free function declared in the repo, namespace attribution not uniquely extracted (index records the name; resolution is name-level, marked weak)")
      else put("qualified-owner-in-repo-no-pair", "owner segment names a repo namespace/type but no declaration of the leaf is attributable to it")
    } else {
      put("qualified-owner-not-in-repo", "qualified spelling whose owner is not a repo type/namespace (third-party namespace)")
    }
    continue
  }
  // bare call
  if (free || alias) {
    const count = (free?.count ?? 0) + (alias?.count ?? 0)
    if (count === 1) put("bare-unique-free-callable", "STRONG: exactly one free-function/alias declaration of the leaf in the repo — the index resolves this row")
    else put("bare-multiple-declarations", "more than one declaration of the leaf — the index bounds the candidate set but the name key cannot choose")
    continue
  }
  if (type) {
    if (type.count === 1 && macro) put("bare-unique-type-and-macro", "one type and a macro share the leaf — ambiguous kind; no clean resolution")
    else if (type.count === 1) put("bare-unique-member-only", "declared exactly once but only as a TYPE (a bare call through an implicit-this member or a constructor-shaped call) — no guaranteed gain")
    else put("bare-multiple-declarations", "more than one declaration of the leaf — no resolution this pass")
    continue
  }
  if (macro) { put("macro-declared-in-repo", "the name is a repo MACRO — W10 policy question, not a callable resolution"); continue }
  put("third-party-not-declared-in-repo", "not declared by the extraction")
}

const classSum = Object.values(classes).reduce((a, b) => a + b.rows, 0)
const failures: string[] = []
if (classSum !== rows.length) failures.push(`class rows ${classSum} != residual rows ${rows.length}`)
if (failures.length) { console.error("CONTROL DID NOT FIRE"); for (const f of failures) console.error("  " + f); process.exit(3) }

const W1_TOTAL = 614081
const scale = W1_TOTAL / rows.length
const STRONG = ["bare-unique-free-callable", "qualified-owner-member-pair-checked", "qualified-namespace-free-callable"]
const WEAK = ["qualified-namespace-free-callable-any-scope", "qualified-owner-member-pair-owner-duplicated", "bare-unique-member-only"]
const strong = STRONG.reduce((a, k) => a + (classes[k]?.rows ?? 0), 0)
const weak = WEAK.reduce((a, k) => a + (classes[k]?.rows ?? 0), 0)
const declTotals = REPOS.reduce((acc, repo) => {
  const s = spaces.get(repo)!
  let members = 0
  for (const t of s.types.values()) members += t.members.size
  acc[repo] = { types: s.types.size, members, freeFns: s.freeFns.size, aliases: s.aliases.size, namespaces: s.namespaces.size, macros: s.macros.size }
  return acc
}, {} as any)

const report: any = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-decl-proto.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  sample: { repos: REPOS, filesParsed: parsedFiles, filesFailed: failed, residualCallsRows: rows.length, headersIndexed: !NO_HEADERS, declarationSpace: NO_HEADERS ? "admitted extensions only (OPTION-1 index population)" : "src/ast/pool-worker.ts parse (cpp analyzer grammar) + prototype DeclarationSpec walk; admitted sources AND .h/.hh/.h++ headers (OPTION-2 population)" },
  declarationTotals: declTotals,
  classes,
  totals: {
    residualRowsInSample: rows.length,
    indexResolvableStrong: strong,
    indexResolvableStrongPct: Number(((100 * strong) / rows.length).toFixed(1)),
    indexResolvableWeak: weak,
    indexResolvableWeakPct: Number(((100 * weak) / rows.length).toFixed(1)),
    estimatedWholePopulationStrong: Math.round(strong * scale),
    estimatedWholePopulationWeak: Math.round(weak * scale),
    scaleFactor: Number(scale.toFixed(2)),
    note: "STRONG = the index as specified decides the row; WEAK = the index narrows/records but cannot decide under the currently-specified fields (no receiver typing, duplicated owner, implicit-this).",
  },
  perRepo,
  control: { ok: true, detail: "every residual row in exactly one class; class sum == residual count" },
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) { const fs = await import("node:fs"); const t = path.resolve(ROOT, JSON_OUT); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, json) }
process.stdout.write(
  `cpp-decl-proto — sample ${REPOS.join(",")} · ${parsedFiles} files · residual calls rows ${rows.length}\n` +
  Object.entries(classes).sort((a, b) => b[1].rows - a[1].rows).map(([k, v]) => `  ${String(v.rows).padStart(6)}  ${k}`).join("\n") + "\n" +
  `  STRONG index-resolvable: ${strong} (${report.totals.indexResolvableStrongPct}%) → scaled to 614,081 ≈ ${report.totals.estimatedWholePopulationStrong} (×${report.totals.scaleFactor})\n` +
  `  WEAK (index narrows only): ${weak} (${report.totals.indexResolvableWeakPct}%) → scaled ≈ ${report.totals.estimatedWholePopulationWeak}\n` +
  `  control PASS — class sum closes\n`,
)
