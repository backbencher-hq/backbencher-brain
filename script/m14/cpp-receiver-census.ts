/**
 * cpp-receiver-census — FEASIBILITY CENSUS for the CPP receiver-typing depth item (task-22's follow-up;
 * charter §18.15: a DIFFERENT mechanism from the project index — typing evidence, not index facts).
 *
 * THE QUESTION: the index moved 23,922 of the 614,081 W1-callable rows. The remaining W1 mass is
 * "bare/member-through-object" calls, which only a RECEIVER TYPE can resolve. Before any implementation,
 * this census asks: for the residual call rows, WHAT RECEIVER EVIDENCE DOES THE SYNTAX ALREADY CONTAIN?
 * Each row is classified into exactly one evidence class:
 *
 *   implicit-this        a bare callee inside a class method, and the enclosing class's members (in-file)
 *                        declare the leaf — the owner is lexically known (`this`), no type inference
 *   constructor-temp     the receiver is a constructor call / new-expression (`T(...).m`, `new T(...)->m`)
 *                        — the type is spelled at the call site
 *   typed-local          the receiver is a local/parameter whose WRITTEN declaration type is known in the
 *                        same function (`T x; x.m(...)`), including pointer/ref/reference wrappers
 *   smart-or-container   the receiver's written type is a wrapper that NAMES its element/pointee
 *                        (`std::unique_ptr<T> p; p->m`, `std::vector<T> v; v.push_back`) — the owner class
 *                        comes from the written template argument
 *   opaque               chained/unknown receivers (`f().m()`, macros, `auto`-typed from calls)
 *
 * AND, for each class, whether the in-file declaration actually declares the leaf (a separate fact from
 * the evidence existing): `declares` vs `does-not-declare`. A class whose evidence exists but whose owner
 * does not declare the leaf cannot move the row (and would be a false claim if emitted).
 *
 * THE INDEX IS NOT USED: this is the receiver-typing item's own feasibility, measured on the SYNTAX the
 * analyzer already parses (an index-assisted variant is a separate question and is not conflated here).
 *
 * SCOPE: `--dump` supplies the residual call rows to classify; `--sample=N` bounds the files parsed
 * (default 0 = every file the dump names — a whole-population census, memory-gated by the caller);
 * `--repos=a,b` restricts to repos. Every residual row must land in exactly one class (control).
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-receiver-census.ts \
 *     --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt [--sample=40] [--repos=fmt] [--json=<path>]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const DUMP = argOf("--dump")
const SAMPLE = Number(argOf("--sample") ?? "0")
const ONLY_REPOS = (argOf("--repos") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const JSON_OUT = argOf("--json")
/** `--rows-out=<path>`: the PER-ROW class of every residual call row, as a TSV
 *  (`file \t line \t target \t class-key`). It exists so the class counts can be JOINED with another
 *  instrument's rows — the W1 wall's bucket partition, for instance — without re-running the census.
 *  The class counts alone cannot answer "how many of BUCKET C are receiver-decidable", because a count
 *  over the whole population cannot be intersected with a subset that was defined elsewhere. */
const ROWS_OUT = argOf("--rows-out")
/** `--index`: evaluate the three declaration-bearing evidence classes against the per-repo index's
 *  inheritance-closed member view (the same rule the implementation applies). A MEASUREMENT only —
 *  it does not emit anything; the number decides whether a wider emission pass is worth it. */
const WITH_INDEX = process.argv.includes("--index")
if (!DUMP) { console.error("usage: bun run script/m14/cpp-receiver-census.ts --dump=<gate dump> [--sample=N] [--repos=a,b] [--json=<path>]"); process.exit(2) }
const MAX_FILES = 2000
if (SAMPLE > MAX_FILES) { console.error(`cpp-receiver-census: --sample caps at ${MAX_FILES} files`); process.exit(2) }
if (SAMPLE === 0) {
  const availGB = os.freemem() / (1024 ** 3)
  if (availGB < 3) { console.error(`cpp-receiver-census: whole-population census refuses at ${availGB.toFixed(2)} GB available (memory gate: >= 3 GB); use --sample=N for a bounded run.`); process.exit(2) }
}

const AMBIGUOUS = new Set(["ambDeclOnly", "ambBoth", "ambKindOnly"])
const extOf = (p: string): string => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(d + 1).toLowerCase() : "" }
const repoOf = (src: string): string => { const i = src.indexOf(`${path.sep}.corpus${path.sep}`); return (i >= 0 ? src.slice(i + `${path.sep}.corpus${path.sep}`.length) : src).split(path.sep)[0] }

type Row = { target: string; outcome: string; src: string; line: number }
const rowsByFile = new Map<string, Row[]>()
let residualCalls = 0
for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5 || p[1] !== "calls") continue
  if (p[2] !== "unresolved" && !AMBIGUOUS.has(p[2])) continue
  const m = p[4].match(/^(.*):(\d+)$/)
  if (!m) continue
  const src = m[1]
  const repo = repoOf(src)
  if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(repo)) continue
  residualCalls++
  const list = rowsByFile.get(src) ?? []
  list.push({ target: p[3], outcome: p[2], src, line: Number(m[2]) })
  rowsByFile.set(src, list)
}
let files = [...rowsByFile.keys()].sort()
if (SAMPLE > 0) {
  const stride = Math.max(1, Math.floor(files.length / SAMPLE))
  files = files.filter((_, i) => i % stride === 0).slice(0, SAMPLE)
}
if (files.length === 0) { console.error("cpp-receiver-census: no residual call rows selected — check --dump / --repos"); process.exit(2) }
// THE DENOMINATOR IS THE ROWS OF THE FILES ACTUALLY PARSED, not the whole dump: a sampled census
// classifies its sample's rows, and comparing against every row in the repo would report a shortfall
// that is the sample itself.
const selectedResidualCalls = files.reduce((a, f) => a + (rowsByFile.get(f)?.length ?? 0), 0)

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const parser: any = await getParser("cpp")

// ── the per-repo indexes (only with --index): shipped spec, complete=true ────────────────────────
type RepoIndex = { typeKinds: Map<string, unknown>; allMembers: Map<string, Set<string>>; files: number; buildMs: number }
const repoIndexes = new Map<string, RepoIndex>()
if (WITH_INDEX) {
  const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
  const spec: any = indexMod.CPP_DECLARATION_SPEC
  if (!spec) { console.error("cpp-receiver-census --index: project-index.ts does not export CPP_DECLARATION_SPEC (Lead wiring absent)"); process.exit(3) }
  const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
  for (const repo of [...new Set([...files].map((f) => repoOf(f)))]) {
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
    const admitted: string[] = []
    for (const rel of tracked) {
      if (!["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"].includes(extOf(rel))) continue
      const abs = path.join(CR, repo, rel)
      try { if (fs.statSync(abs).size <= 1024 * 1024) admitted.push(abs) } catch { /* absent */ }
    }
    const t0 = performance.now()
    const built: any = await indexMod.buildProjectIndexStreaming(wasm, admitted, spec)
    built.complete = true
    const tables: any = indexMod.buildResolutionTables(built)
    repoIndexes.set(repo, { typeKinds: built.typeKinds, allMembers: tables.allMembers, files: admitted.length, buildMs: performance.now() - t0 })
  }
}
const INDEX_CLASS_KINDS = new Set(["class", "struct", "union"])
const indexStateOf = (repo: string, owner: string, leaf: string): string => {
  if (!WITH_INDEX) return "not-evaluated"
  if (owner === "") return "no-owner-candidate"
  const idx = repoIndexes.get(repo)
  if (!idx) return "no-repo-index"
  const kind = idx.typeKinds.get(owner)
  if (typeof kind !== "string" || !INDEX_CLASS_KINDS.has(kind)) return "owner-not-class-like-in-index"
  return idx.allMembers.get(owner)?.has(leaf) === true ? "CLOSURE-VERIFIABLE" : "closure-does-not-declare"
}

// ── type-spelling helpers ────────────────────────────────────────────────────────────────────────
const stripType = (text: string): string => {
  // drop pointer/reference/const/volatile and leading storage words; keep the last name/template head.
  let s = text.trim()
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ")
  for (const kw of ["const", "volatile", "static", "inline", "constexpr", "mutable", "extern", "register", "thread_local", "typename", "struct", "class", "enum", "union"]) {
    s = s.split(kw).join(" ")
  }
  s = s.replace(/[*&\s]+/g, " ").trim()
  return s
}
const lastTypeName = (text: string): string => {
  let s = stripType(text)
  const lt = s.indexOf("<")
  if (lt > 0) s = s.slice(0, lt)
  const cut = Math.max(s.lastIndexOf("::"), s.lastIndexOf(" "))
  const leaf = (cut >= 0 ? s.slice(cut + 1) : s).trim()
  return /^[A-Za-z_$][\w$]*$/.test(leaf) ? leaf : ""
}
const templateArg = (text: string): string => {
  const lt = text.indexOf("<")
  const gt = text.lastIndexOf(">")
  if (lt < 0 || gt <= lt) return ""
  const inner = text.slice(lt + 1, gt)
  // first template argument's last type name (keys/values: use FIRST; for maps the method is on the
  // container itself, so this is only used for wrapper pointee/element forms)
  const first = inner.split(",")[0] ?? ""
  return lastTypeName(first)
}
const WRAPPER_POINTEE = new Set(["unique_ptr", "shared_ptr", "weak_ptr", "auto_ptr", "optional", "reference_wrapper", "atomic"])
const WRAPPER_ELEMENT = new Set(["vector", "deque", "list", "array", "set", "unordered_set", "span", "basic_string", "string", "queue", "stack"])

type Scope = {
  kind: "file" | "type" | "function" | "block"
  className?: string
  vars: Map<string, string>   // name -> written type text
  typeMembers?: Map<string, Set<string>>
}
type Classes = Record<string, number>
const classes: Classes = {}
/** `namespace-qualified` callee roots, counted for the NAMESPACE-CITATION item (a separate question from
 *  receiver typing: a `std::move(...)` call's problem is that the target leaf names no project symbol AND
 *  its owner is a platform namespace — the citation mechanism's territory, not a receiver type's). */
const namespaceRoots: Record<string, number> = {}
/** repo -> the NAMESPACE names it DECLARES (so a project's own namespace is never called a platform
 *  citation), and the per-row (root, repo) list the citation census is computed from after the walk. */
const declaredNamespaces = new Map<string, Set<string>>()
const namespaceRows: Array<{ root: string; repo: string; leaf: string }> = []
const note = (k: string) => { classes[k] = (classes[k] ?? 0) + 1 }
/** The per-row class of every classified row, for the join above. */
const rowClasses: string[] = []

type Residue = { file: string; line: number; target: string; cls: string; detail: string }
const samples: Residue[] = []
const classifyRow = (file: string, r: Row, cls: string, detail: string, declares: boolean) => {
  const key = `${cls}|${declares ? "declares" : "does-not-declare"}`
  note(key)
  if (samples.length < 12 && declares) samples.push({ file, line: r.line, target: r.target, cls, detail })
}
void classifyRow

for (const abs of files) {
  const repo = repoOf(abs)
  const repoDir = path.join(CR, repo)
  let content: string
  try { content = fs.readFileSync(abs, "utf8") } catch { continue }
  const fileRows = rowsByFile.get(abs) ?? []
  const rowByLine = new Map<number, Row[]>()
  const matched = new Set<Row>()
  for (const r of fileRows) {
    const l = rowByLine.get(r.line) ?? []
    l.push(r)
    rowByLine.set(r.line, l)
  }
  const tree: any = parser.parse(content, abs)
  if (!tree?.rootNode) continue
  const stack: Scope[] = [{ kind: "file", vars: new Map() }]
  const cur = () => stack[stack.length - 1]
  const allTypes = new Map<string, Map<string, Set<string>>>() // class -> members (collect first pass)
  const collectMembers = (n: any, cls: string | null) => {
    const t = String(n.type)
    if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
      const nameNode = n.childForFieldName?.("name")
      const name = nameNode?.text?.trim?.() ?? ""
      let body: any = null
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && (c.type === "field_declaration_list" || c.type === "class_body")) { body = c; break } }
      if (name !== "" && body) {
        const members = allTypes.get(name) ?? new Map<string, Set<string>>()
        for (let i = 0; i < body.namedChildCount; i++) {
          const c = body.namedChild(i)
          if (!c) continue
          const memberSet = members.get(name) ?? new Set<string>()
          void memberSet
          if (c.type === "field_declaration" || c.type === "declaration" || c.type === "function_definition") {
            const decl = c.childForFieldName?.("declarator")
            const id = decl ? (decl.type === "function_declarator" ? decl.childForFieldName?.("declarator") : decl) : null
            const leaf = id?.type === "qualified_identifier" ? id.text.split("::").pop().trim() : id?.text?.trim?.()
            if (leaf && /^[A-Za-z_$][\w$]*$/.test(leaf)) {
              const nm = leaf
              const set = members.get(name) ?? new Set<string>()
              set.add(nm)
              members.set(name, set)
            }
          }
        }
        allTypes.set(name, members)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) collectMembers(c, cls) }
  }
  collectMembers(tree.rootNode, null)
  const classMembers = new Map<string, Set<string>>()
  for (const [cls, m] of allTypes) { const s = new Set<string>(); for (const [owner, mm] of m) if (owner === cls) for (const x of mm) s.add(x); classMembers.set(cls, s) }
  const declaresLeaf = (className: string, leaf: string): boolean => classMembers.get(className)?.has(leaf) === true

  const visit = (n: any) => {
    const t = String(n.type)
    if (t === "namespace_definition") {
      const nameField = n.childForFieldName?.("name")
      const nsName = nameField ? (String(nameField.text ?? "").split("::")[0] || String(nameField.text ?? "")) : ""
      if (nsName !== "" && /^[A-Za-z_$][\w$]*$/.test(nsName)) {
        const set = declaredNamespaces.get(repo) ?? new Set<string>()
        set.add(nsName)
        declaredNamespaces.set(repo, set)
      }
    }
    if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
      const name = n.childForFieldName?.("name")?.text?.trim?.() ?? ""
      stack.push({ kind: "type", className: name, vars: new Map() })
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "field_declaration_list") for (let k = 0; k < c.namedChildCount; k++) { const d = c.namedChild(k); if (d) visit(d) } }
      stack.pop()
      return
    }
    if (t === "function_definition") {
      const vars = new Map<string, string>()
      // parameters: `parameter` nodes carry type + name fields
      const decl = n.childForFieldName?.("declarator")
      const params = decl ? (() => { const f: any[] = []; const rec = (x: any) => { if (!x) return; if (x.type === "parameter_list") { for (let i = 0; i < x.namedChildCount; i++) { const p = x.namedChild(i); if (p && p.type === "parameter") f.push(p) } return } for (let i = 0; i < x.namedChildCount; i++) rec(x.namedChild(i)) }; rec(decl); return f })() : []
      for (const p of params) {
        const tn = p.childForFieldName?.("type"); const id = p.childForFieldName?.("declarator")?.text?.trim?.() ?? ""
        if (tn && id && /^[A-Za-z_$][\w$]*$/.test(id)) vars.set(id, tn.text)
      }
      // body locals with a WRITTEN type
      const body = n.childForFieldName?.("body") ?? n.namedChild(n.namedChildCount - 1)
      const collectLocals = (x: any) => {
        if (!x) return
        if (x.type === "declaration") {
          const tn = x.childForFieldName?.("type"); const d = x.childForFieldName?.("declarator")
          const idNode = d ? (d.type === "init_declarator" ? d.childForFieldName?.("declarator") : d.type === "function_declarator" ? null : d) : null
          const id = idNode?.text?.trim?.() ?? ""
          if (tn && id && /^[A-Za-z_$][\w$]*$/.test(id)) vars.set(id, tn.text)
        }
        for (let i = 0; i < x.namedChildCount; i++) collectLocals(x.namedChild(i))
      }
      collectLocals(body)
      stack.push({ kind: "function", className: cur().className, vars })
      const task = body
      if (task) visit(task)
      stack.pop()
      return
    }
    if (t === "call_expression") {
      const fn = n.childForFieldName?.("function")
      // THE ROW'S LINE IS THE NODE THAT BEARS THE NAME (the analyzer's own rule): the callee leaf,
      // not the call_expression's `(`, and for a member call the FIELD node, not the object.
      const leafNode = (() => {
        if (!fn) return null
        if (fn.type === "field_expression") return fn.childForFieldName?.("field") ?? fn.namedChild(fn.namedChildCount - 1)
        if (fn.type === "template_function" || fn.type === "template_method") return fn.childForFieldName?.("name") ?? fn.namedChild(0)
        if (fn.type === "qualified_identifier") return fn.namedChild(fn.namedChildCount - 1)
        return fn
      })()
      const line = (leafNode ?? fn ?? n).startPosition.row + 1
      const rowList = rowByLine.get(line)
      if (fn && rowList && rowList.length > 0) {
        const leaf = (() => {
          const f = fn.type === "template_function" ? fn.childForFieldName?.("name") : fn
          if (!f) return ""
          if (f.type === "identifier") return f.text.trim()
          if (f.type === "field_expression") { const fl = f.childForFieldName?.("field"); return fl?.text?.trim?.() ?? "" }
          if (f.type === "qualified_identifier") return f.text.split("::").pop().trim()
          if (f.type === "template_method") return f.text.replace(/<[\s\S]*$/, "").split("::").pop()?.trim() ?? ""
          return ""
        })()
        for (const r of rowList) {
          if (r.target !== leaf) continue
          if (matched.has(r)) continue   // two identical calls on one line: the row is counted once
          matched.add(r)
          // ── classify the receiver evidence ──
          let cls = "opaque"
          let detail = ""
          let qualifiedOwnerHandled = false
          {
            // THE SPELLING'S ROOT, read from whatever the grammar made of the callee: a fully qualified
            // callee (`std::move`), a qualified OBJECT (`std::chrono::steady_clock::now()` — object type
            // field_expression!), or a qualified template. Any `::` in the callee/object path means the
            // owner is SPELLED (namespace or class), which is the citation census's unit — classifying
            // these as receiver evidence was the measured undercount (800-file sample: 1,062 std rows here
            // against 2,271 actual claims from the same files).
            let qtext = ""
            if (fn.type === "field_expression") {
              const qobj = fn.childForFieldName?.("argument") ?? fn.namedChild(0)
              qtext = String(qobj?.text ?? "")
            } else {
              qtext = String(fn.text ?? "")
            }
            if (qtext.includes("::")) {
              const qroot = qtext.replace(/^::/, "").split("::")[0].trim()
              cls = "namespace-qualified"
              detail = qroot
              if (qroot !== "") {
                namespaceRoots[qroot] = (namespaceRoots[qroot] ?? 0) + 1
                namespaceRows.push({ root: qroot, repo, leaf: r.target })
              }
              qualifiedOwnerHandled = true
            }
          }
          if (!qualifiedOwnerHandled && fn.type === "field_expression") {
            const obj = fn.childForFieldName?.("argument") ?? fn.namedChild(0)
            const op = fn.child(1)?.text ?? ""    // `.` or `->`
            if (obj && obj.type === "call_expression") {
              cls = "constructor-temp"
              const innerCallee = obj.childForFieldName?.("function") ?? obj.namedChild(0)
              let inner: any = innerCallee
              let g2 = 0
              while (inner && g2++ < 5) {
                const it = String(inner.type)
                if (it === "identifier" || it === "type_identifier") break
                if (it === "qualified_identifier") { const parts = String(inner.text).split("::"); detail = `callee:${parts[parts.length - 1].trim()}`; inner = null; break }
                if (it === "template_function" || it === "template_method") { inner = inner.namedChild(0); continue }
                inner = null
              }
              if (inner) detail = `callee:${String(inner.text).trim()}`
              else if (detail === "") detail = "callee:"
            }
            else if (obj && obj.type === "new_expression") {
              cls = "constructor-temp"
              const tn = obj.childForFieldName?.("type") ?? null
              detail = `callee:${tn ? String(tn.text).trim() : ""}`
            }
            else if (obj && (obj.type === "identifier")) {
              const vtype = cur().vars.get(obj.text.trim()) ?? ""
              if (vtype !== "") {
                const wrapper = lastTypeName(vtype)
                if (WRAPPER_POINTEE.has(wrapper) || WRAPPER_ELEMENT.has(wrapper)) { cls = "smart-or-container"; detail = `${wrapper}<...>` }
                else { cls = "typed-local"; detail = vtype.trim() }
              } else { cls = "opaque"; detail = "object name has no written type in this function" }
            } else { cls = "opaque"; detail = `object node ${obj?.type}` }
            void op
          } else if (!qualifiedOwnerHandled && (fn.type === "qualified_identifier" ||
            (fn.type === "template_function" && fn.namedChildCount > 0 && fn.namedChild(0)?.type === "qualified_identifier") ||
            (fn.type === "field_expression" && (() => { const o = fn.childForFieldName?.("argument") ?? fn.namedChild(0); return o && o.type === "qualified_identifier" })()))) {
            // A QUALIFIED callee/free function (`std::move`, `ns::detail::f`, `std::chrono::steady_clock::now`):
            // the owner is a NAMESPACE (or a class, checked elsewhere) spelled in the source. Record the ROOT
            // segment — the citation-census unit — and classify as namespace-qualified, not opaque.
            const qtext = fn.type === "field_expression"
              ? String((fn.childForFieldName?.("argument") ?? fn.namedChild(0))?.text ?? "")
              : String(fn.text ?? "")
            const root = qtext.replace(/^::/, "").split("::")[0].trim()
            cls = "namespace-qualified"
            detail = root
            if (root !== "") {
              namespaceRoots[root] = (namespaceRoots[root] ?? 0) + 1
              namespaceRows.push({ root, repo, leaf: r.target })
            }
          } else if (fn.type === "identifier") {
            // bare callee: implicit-this if the enclosing class declares the leaf
            const enclosing = cur().className ?? ""
            if (enclosing !== "" && declaresLeaf(enclosing, leaf)) { cls = "implicit-this"; detail = enclosing }
            else if (enclosing !== "") { cls = "implicit-this-evidence-no-declaration"; detail = enclosing }
            else { cls = "opaque"; detail = "bare callee at file scope" }
          }
          // owner CANDIDATE from the evidence class (spelled at the site / written in the declaration /
          // the enclosing class), then TWO facts: does the in-file owner declare the leaf, and (with
          // --index) does the index's inheritance-closed member view?
          let ownerCandidate = ""
          if (cls === "namespace-qualified") ownerCandidate = detail
          else if (cls === "implicit-this") ownerCandidate = detail
          else if (cls === "typed-local") {
            const holder = lastTypeName(detail)
            ownerCandidate = WRAPPER_POINTEE.has(holder) ? templateArg(detail) : holder
          } else if (cls === "smart-or-container") {
            ownerCandidate = templateArg(detail) || lastTypeName(detail)
          } else if (cls === "constructor-temp") {
            // the type spelled at the site: the receiver was a call/new-expression; the walker stored
            // the inner callee/type spelling in `detail` for this branch
            ownerCandidate = lastTypeName(detail.replace(/^callee:\s*/, "")) || detail.replace(/^callee:\s*/, "")
          }
          let declares = false
          if (cls === "implicit-this") declares = true
          else if (ownerCandidate !== "") declares = declaresLeaf(ownerCandidate, leaf)
          const indexState = cls === "opaque" || cls === "implicit-this-evidence-no-declaration" ? "not-evaluated" : indexStateOf(repoOf(abs), ownerCandidate, leaf)
          const key = `${cls}|${declares ? "declares" : "does-not-declare"}|${indexState}`
          note(key)
          rowClasses.push(`${path.relative(CR, abs)}\t${r.line}\t${r.target}\t${key}`)
          if (samples.length < 16 && declares) samples.push({ file: path.relative(CR, abs), line: r.line, target: r.target, cls, detail })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i))
  }
  visit(tree.rootNode)
  // EVERY row of a selected file lands in exactly one class: a row with no call_expression at its
  // line+target in the parsed tree is COUNTED as its own class, never dropped from the denominator.
  for (const r of fileRows) {
    if (matched.has(r)) continue
    note("unclassified|no-ast-match-at-line")
    rowClasses.push(`${path.relative(CR, abs)}\t${r.line}\t${r.target}\tunclassified|no-ast-match-at-line`)
    if (samples.length < 16) samples.push({ file: path.relative(CR, abs), line: r.line, target: r.target, cls: "unclassified", detail: "no call_expression at the row's line+target in the parsed tree" })
  }
  tree.delete?.()
}

const classSum = Object.values(classes).reduce((a, b) => a + b, 0)
const failures: string[] = []
if (classSum !== selectedResidualCalls) {
  failures.push(`class rows ${classSum} != residual calls rows of the SELECTED files ${selectedResidualCalls} (unmatched rows have no call_expression at the row's line+target in the parsed tree)`)
}
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-receiver-census.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  population: { residualCallsInDump: residualCalls, residualCallsInSelectedFiles: selectedResidualCalls, filesSelected: files.length, sample: SAMPLE, repos: ONLY_REPOS.length ? ONLY_REPOS : "all", machine: { loadAvg1: Number(os.loadavg()[0].toFixed(2)), availableGB: Number((os.freemem() / (1024 ** 3)).toFixed(2)) } },
  rule: "Each residual call row is classified by the receiver evidence the SYNTAX already provides: implicit-this (bare callee, enclosing class declares it in-file) · constructor-temp · typed-local (written local/param type) · smart-or-container (written wrapper type naming its pointee/element) · opaque. The |declares suffix is a SECOND fact: does the in-file owner actually declare the leaf. No project index is used.",
  classes,
  namespaceRoots,
  namespaceCitation: (() => {
    const projectDeclared: Record<string, number> = {}
    const undeclaredCandidates: Record<string, number> = {}
    // THE CITATION CANDIDATE IS A TRUE NAMESPACE, not a static-class call: exclude (a) roots the
    // repo DECLARES as a namespace (the project's own `fmt::`, `duckdb::`) and (b) roots the INDEX
    // says are CLASS-LIKE (`StringUtil::Format`, `LogicalType::X` — owner qualification, already the
    // qualified-owner emission's territory, NOT a citation). Without --index the class-like filter is
    // unavailable and the report says so.
    const candidateSymbols: Record<string, number> = {}
    const rootSymbols: Record<string, Record<string, number>> = {}
    const candidateRoots: Record<string, number> = {}
    const classLikeRoots: Record<string, number> = {}
    let candidateRows = 0
    let classLikeRows = 0
    for (const { root, repo, leaf } of namespaceRows) {
      if (declaredNamespaces.get(repo)?.has(root) === true) { projectDeclared[root] = (projectDeclared[root] ?? 0) + 1; continue }
      undeclaredCandidates[root] = (undeclaredCandidates[root] ?? 0) + 1
      const idx = repoIndexes.get(repo)
      const kind = idx?.typeKinds.get(root)
      if (typeof kind === "string" && INDEX_CLASS_KINDS.has(kind)) {
        classLikeRows++
        classLikeRoots[root] = (classLikeRoots[root] ?? 0) + 1
        continue
      }
      candidateRows++
      candidateRoots[root] = (candidateRoots[root] ?? 0) + 1
      candidateSymbols[leaf] = (candidateSymbols[leaf] ?? 0) + 1
      const rs = rootSymbols[root] ?? (rootSymbols[root] = {})
      rs[leaf] = (rs[leaf] ?? 0) + 1
    }
    const sortTop = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 60))
    return {
      rule: "namespace-qualified residual call roots, split by whether the ROOT is a namespace this repo DECLARES (project namespace — not a citation) or not (candidate platform namespace — the citation question). Roots are the unit the fleet's `languageNamespace` citation claim matches; a candidate still needs a committed vocabulary before a lane may claim it (citations.ts).",
      projectNamespaceRows: Object.values(projectDeclared).reduce((a, b) => a + b, 0),
      candidateRows,
      classLikeQualifiedRows: classLikeRows,
      projectDeclaredRoots: sortTop(projectDeclared),
      candidateRoots: sortTop(candidateRoots),
      classLikeRoots: sortTop(classLikeRoots),
      undeclaredRootsBeforeClassFilter: sortTop(undeclaredCandidates),
      // THE VOCABULARY'S UNIT: the LEAF spellings of candidate rows, so the Lead can curate a
      // symbol-level `iso-cpp-stdlib` list from measured spellings instead of a lane-invented one.
      candidateSymbols: sortTop(candidateSymbols),
      // Per-root symbol histogram for the roots with the volume to matter: the vocabulary a Lead
      // curates is SYMBOL-level, so the top spellings per ROOT are the actionable list.
      rootSymbols: Object.fromEntries(Object.entries(rootSymbols)
        .sort((a, b) => (candidateRoots[b[0]] ?? 0) - (candidateRoots[a[0]] ?? 0)).slice(0, 12)
        .map(([root, syms]) => [root, Object.fromEntries(Object.entries(syms).sort((a, b) => b[1] - a[1]).slice(0, 20))])),
    }
  })(),
  samples,
  control: { ok: failures.length === 0, failures },
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) { const t = path.resolve(ROOT, JSON_OUT); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, json) }
if (ROWS_OUT) {
  const t = path.resolve(ROOT, ROWS_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, rowClasses.join("\n") + "\n")
  console.log(`rows-out: ${rowClasses.length} row classes written to ${ROWS_OUT}`)
}
process.stdout.write(json)
if (failures.length > 0) process.exit(3)
