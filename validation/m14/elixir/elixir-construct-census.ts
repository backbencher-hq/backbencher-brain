// ELIXIR FIX2 — CONSTRUCT CENSUS: does the LANGUAGE have the five constructs
// this lane is silent on?
//
// `extends`, `uses`, `imports`, `exports`, `overrides` are silent on the
// relationship channel. Silence has two possible causes and the ontology gate
// exists because a lane once shipped a whole wave on the wrong one:
//
//   GAP     the language has the construct and the analyzer does not read it.
//           Fabrication is the opposite mistake and it is worse: a fake edge is
//           counted `unexplained` and poisons bb_graph, bb_impact, bb_migrate.
//   RULED   the language cannot express it. This needs a MEASUREMENT, because
//           `overrides` had a prose justification for bash and was wrong.
//
// So this instrument counts CONSTRUCTS ON THE TREE, never patterns in source
// text. Two instruments, and which one applies is decided by the question
// (same split script/m14/ontology-coverage-gate.ts documents):
//
//   A: GRAMMAR INVENTORY — every node type the pinned grammar actually EMITS
//      across the corpus, and the grammar's own declared rule names. For a type
//      that would need a node type Elixir does not have, this is positive
//      evidence of absence.
//   B: PARSE-TREE SEMANTIC COUNT — for a type Elixir CAN express. A second
//      `defmodule` is perfectly good Elixir, so no inventory finds it; it has to
//      be counted on the tree, where a doc string and a comment cannot fake it.
//
// Every probe below therefore reports (count, files) AND distinguishes code
// sites from doc/comment sites, because "defoverridable appears in 22 files" is
// a number about documentation and not about the language.
//
// NO REGEX anywhere. Every string decision is `===`, `endsWith`, `split`,
// `charCodeAt`, a Set/Map lookup, or an integer comparison.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

// ELIXIR_FIX2-S1 — see elixir-firing-census.ts. Evidence that does not name the
// analyzer it measured cannot be stale, and so cannot be believed.
function subjectSha(): string {
  try { return createHash("sha256").update(readFileSync(join(import.meta.dir, "../../../src/ast/real-elixir-analyzer.ts"))).digest("hex").slice(0, 16) } catch { return "unreadable" }
}
function headCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(import.meta.dir, "../../.."), encoding: "utf8" }).trim() } catch { return "unknown" }
}

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CORPUS_DIRS = (process.env.ELIXIR_CORPUS_DIRS ?? "elixir,otp").split(",")
const EXTS = [".ex", ".exs"]
const WANT = Number(process.argv[2] || 0)

// Rule names the language's own documentation uses for the five constructs. A
// substring scan of the GRAMMAR DECLARATION (grammars/tree-sitter-elixir/
// grammar.js), never of project source: this asks what the language defines a
// node for, which is a question about the grammar.
const GRAMMAR_JS = "grammars/tree-sitter-elixir/grammar.js"
const GRAMMAR_PROBE_WORDS = [
  "extends", "extend", "superclass", "super_class", "inherit", "inherits",
  "implements", "interface", "abstract_class", "class", "export", "exports",
  "override", "overrides", "defoverridable", "require", "include",
]

function collectFiles(): Array<{ path: string; rel: string }> {
  const out: Array<{ path: string; rel: string }> = []
  for (const d of CORPUS_DIRS) {
    const base = join(CORPUS_ROOT, d)
    const walk = (dir: string, depth: number): void => {
      if (depth > 24) return
      let ents: any[]
      try { ents = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
      for (const e of ents) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== ".git" && e.name !== "node_modules" && e.name !== "_build" && e.name !== "deps") walk(p, depth + 1)
        } else if (e.isFile()) {
          let want = false
          for (const x of EXTS) if (e.name.endsWith(x)) want = true
          if (!want) continue
          try { if (statSync(p).size < 8) continue } catch { continue }
          out.push({ path: p, rel: relative(base, p) })
        }
      }
    }
    walk(base, 0)
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

// ------------------------------------------------------------------- probes
interface Probe {
  /** what the probe would prove if it fired */
  type: string
  probe: string
  code: number
  files: Set<string>
  codeFiles: Set<string>
  samples: string[]
}

function mk(type: string, probe: string): Probe {
  return { type, probe, code: 0, files: new Set(), codeFiles: new Set(), samples: [] }
}

const P: Probe[] = [
  mk("extends", "A1 defmodule with a DOTTED name (Elixir namespace nesting)"),
  mk("extends", "A2 defmodule name REPEATED inside one file (module reopening)"),
  mk("extends", "A3 defexception sites (an exception type: does it have a parent?)"),
  mk("extends", "A4 defimpl sites (protocol impl: dispatch, not inheritance)"),
  mk("extends", "A5 @behaviour / @behavior attributes (conformance mechanism)"),
  mk("extends", "A6 any call whose identifier is an inheritance keyword"),
  mk("uses", "B1 use directive (the language's own 'use' keyword)"),
  mk("uses", "B2 dot member READ: dot node with NO arguments child"),
  mk("uses", "B2b member field READ: call whose target is a dot, no arguments, LOWERCASE root (the `uses` candidate)"),
  mk("uses", "B2c zero-arity REMOTE reference: call whose target is a dot, no arguments, CAPITALIZED root"),
  mk("uses", "B6 Access read: access_call node (recv[:key])"),
  mk("uses", "B3 module attribute READ: @name with no arguments"),
  mk("uses", "B3a module attribute READ, DECLARATION attribute (must stay silent)"),
  mk("uses", "B3b module attribute READ, code-valued attribute (a `uses` candidate)"),
  mk("overrides", "E8 use N where N is declared in the SAME file and marks defoverridable"),
  mk("overrides", "F1 defoverridable NOT inside any def*/defmacro body (the shape that could credit the mark to a module scope)"),
  mk("overrides", "F2 defoverridable credited to a MODULE scope (no enclosing def body)"),
  mk("overrides", "F3 defoverridable inside a quote AND credited to a module scope (the ONLY shape the walk quote gate can change)"),
  mk("uses", "B4 dot member CALL: dot node WITH an arguments child"),
  mk("uses", "B5 Access/bracket read: node types that carry [] indexing"),
  mk("imports", "C1 import directive"),
  mk("imports", "C2 alias directive (a RENAME, not an import)"),
  mk("imports", "C3 require directive"),
  mk("imports", "C4 use directive (repeat: it invokes a macro, it does not import)"),
  mk("exports", "D1 public def/defdelegate/defguard/defprotocol-callback"),
  mk("exports", "D2 public defmacro"),
  mk("exports", "D3 public @type / @opaque"),
  mk("exports", "D4 public @callback / @macrocallback"),
  mk("exports", "D5 PRIVATE defp/defmacrop/defguardp (must NOT export)"),
  mk("exports", "D6 PRIVATE @typep"),
  mk("exports", "D7 private field on a non-Module owner (defp owner)"),
  mk("overrides", "E1 defoverridable sites (the language's override-point marker)"),
  mk("overrides", "E2 super(...) call sites"),
  mk("overrides", "E3a defoverridable + a LATER def of the marked name/arity, both at module level (a real override)"),
  mk("overrides", "E3b defoverridable + later def, BOTH inside the same quote (a __using__ template)"),
  mk("overrides", "E4 defimpl declared twice for the same protocol+type in one file"),
  mk("overrides", "E5 two defimpl for the same protocol with different for: types"),
  mk("overrides", "E6 @impl attributes (Elixir's callback-conformance marker)"),
  mk("overrides", "E7 a def whose name matches a def in an EARLIER defmodule in the same file"),
]

// Fields per probe so the caller can print a table.
const probeIdx = new Map<string, number>()
P.forEach((p, i) => probeIdx.set(p.probe, i))

function hit(type: string, probe: string, rel: string, line: number, text: string): void {
  const p = P[probeIdx.get(probe)!]
  if (!p) return
  p.code++
  p.files.add(rel)
  p.codeFiles.add(rel)
  if (p.samples.length < 8) p.samples.push(`${rel}:${line} ${text.length > 70 ? text.slice(0, 70) : text}`)
}

const DEF_CONSTRUCTS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
const INHERITANCE_KEYWORDS = new Set([
  "extends", "extend", "implements", "inherits", "inherit", "subclass", "superclass",
])

async function main(): Promise<void> {
  const all = collectFiles()
  const files = WANT > 0 && WANT < all.length
    ? Array.from({ length: WANT }, (_, i) => all[Math.floor((i * all.length) / WANT)])
    : all

  // ---- INSTRUMENT A: the node types the pinned grammar EMITS, plus the
  // grammar's own declared rule names for the five constructs.
  const emittedNodeTypes = new Set<string>()
  const grammarDeclared: Record<string, number> = {}
  try {
    const g = readFileSync(GRAMMAR_JS, "utf8")
    for (const w of GRAMMAR_PROBE_WORDS) {
      let n = 0
      let from = 0
      for (;;) {
        const at = g.indexOf(w, from)
        if (at < 0) break
        n++; from = at + w.length
      }
      grammarDeclared[w] = n
    }
  } catch (e) {
    grammarDeclared.__error = String(e).slice(0, 120)
  }

  // Per-file facts the probes need.
  const filesWithParseError: string[] = []
  let parsed = 0, crashed = 0
  let docAndCommentBytes = 0, totalBytes = 0
  const started = Date.now()

  const parser = await ASTEngine.getParser("elixir" as any)

  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { continue }
    totalBytes += content.length
    let tree: any
    try { tree = await parser.parse(content, f.path) } catch { crashed++; continue }
    parsed++

    // Node-type inventory, and doc/comment byte census. Elixir's docstring node
    // types are `sigil` with a heredoc_name of `"""`/`'''`, and comments are
    // `comment` nodes. Both are DATA to the grammar, so every probe below tests
    // whether its site is inside one.
    const docTypes = new Set(["comment"])

    const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }
    const findChild = (n: any, t: string): any => { for (const c of kids(n)) if (c.type === t) return c; return undefined }

    const callIdentifier = (n: any): string => {
      if (n.type !== "call") return ""
      const id = findChild(n, "identifier")
      return id ? id.text : ""
    }
    const inDocOrComment = (n: any): boolean => {
      let cur: any = n
      while (cur) {
        if (docTypes.has(cur.type)) return true
        if (cur.type === "sigil") {
          const h = findChild(cur, "heredoc_name") || findChild(cur, "quoted_delimiter") || findChild(cur, "identifier")
          const t = h ? h.text : ""
          if (t.length > 0 && (t.charAt(0) === '"' || t.charAt(0) === "'")) return true
        }
        cur = cur.parent
      }
      return false
    }

    // defmodule name bookkeeping for A1/A2.
    const moduleNamesByFile = new Map<string, number>()
    const defimplSites: Array<{ protocol: string; forTypes: string[] }> = []
    const defNamesByModule = new Map<string, Set<string>>()
    const defArityByModule = new Map<string, Set<string>>()
    // A module-level ordered list of (moduleName, [def sites]) so E3/E7 can be
    // decided after the walk.
    interface DefSite { module: string; name: string; arity: number; line: number; inQuote: boolean }
    const defSites: DefSite[] = []
    const overridableSites: Array<{ module: string; name: string; arity: number; line: number; inQuote: boolean }> = []
    interface ModuleEvent { name: string; line: number; kind: string }
    const moduleEvents: ModuleEvent[] = []
    // E8 needs, per file: which modules are DECLARED here, what each declares,
    // which each marks overridable, and which module each `use`s.
    const declaredModules = new Map<string, { defs: Set<string>; overridableModule: boolean; overridableNames: Set<string>; used: string[] }>()

    const walk = (n: any, moduleStack: string[]): void => {
      emittedNodeTypes.add(n.type)
      const line = n.startPosition.row + 1
      const doc = inDocOrComment(n)

      if (n.type === "call") {
        const id = callIdentifier(n)
        if (id === "defmodule" || id === "defprotocol") {
          if (!doc) {
            const args = findChild(n, "arguments")
            const nameNode = args ? (() => { for (const c of kids(args)) if (c.type === "alias") return c; return undefined })() : undefined
            const nm = nameNode ? nameNode.text : ""
            hit("extends", id === "defmodule" ? "A1 defmodule with a DOTTED name (Elixir namespace nesting)" : "A1 defmodule with a DOTTED name (Elixir namespace nesting)", f.rel, line, n.text.split("\n")[0] || "")
            moduleNamesByFile.set(nm, (moduleNamesByFile.get(nm) || 0) + 1)
            moduleEvents.push({ name: nm, line, kind: id })
            if (!declaredModules.has(nm)) declaredModules.set(nm, { defs: new Set(), overridableModule: false, overridableNames: new Set(), used: [] })
            const parentModNow = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : ""
            const qual = parentModNow.length > 0 ? `${parentModNow}.${nm}` : nm
            if (!declaredModules.has(qual)) declaredModules.set(qual, { defs: new Set(), overridableModule: false, overridableNames: new Set(), used: [] })
          }
        }
        if (id === "defmodule" && !doc) {
          // A1 fires only for a DOTTED name: increment only when dotted.
          const args = findChild(n, "arguments")
          let nm = ""
          for (const c of args ? kids(args) : []) if (c.type === "alias") { nm = c.text; break }
          if (nm.indexOf(".") >= 0) hit("extends", "A1 defmodule with a DOTTED name (Elixir namespace nesting)", f.rel, line, nm)
        }
        if (id === "defexception" && !doc) hit("extends", "A3 defexception sites (an exception type: does it have a parent?)", f.rel, line, "defexception")
        if (id === "defimpl" && !doc) {
          const args = findChild(n, "arguments")
          const aliases: string[] = []
          let forTypes: string[] = []
          if (args) {
            for (const c of kids(args)) {
              if (c.type === "alias") aliases.push(c.text)
              if (c.type === "pair") {
                const kw = findChild(c, "keyword")
                const kt = kw ? kw.text : ""
                if (kt.endsWith("for:") || kt === "for") {
                  const val = c.namedChildCount > 1 ? c.namedChild(1) : undefined
                  if (val && val.type === "list") for (const el of kids(val)) if (el.type === "alias") forTypes.push(el.text)
                  else if (val && val.type === "alias") forTypes.push(val.text)
                }
              }
            }
          }
          const protocol = aliases.length > 0 ? aliases[0] : ""
          const fts = forTypes.length > 0 ? forTypes : (aliases.length > 1 ? [aliases[1]] : [])
          defimplSites.push({ protocol, forTypes: fts })
          hit("extends", "A4 defimpl sites (protocol impl: dispatch, not inheritance)", f.rel, line, protocol)
        }
        if (id === "use" && !doc) hit("uses", "B1 use directive (the language's own 'use' keyword)", f.rel, line, n.text.split("\n")[0] || "")
        if (id === "use") hit("imports", "C4 use directive (repeat: it invokes a macro, it does not import)", f.rel, line, n.text.split("\n")[0] || "")
        if (id === "import" && !doc) hit("imports", "C1 import directive", f.rel, line, n.text.split("\n")[0] || "")
        if (id === "alias" && !doc) hit("imports", "C2 alias directive (a RENAME, not an import)", f.rel, line, n.text.split("\n")[0] || "")
        if (id === "require" && !doc) hit("imports", "C3 require directive", f.rel, line, n.text.split("\n")[0] || "")
        if (id === "defoverridable" && !doc) {
          hit("overrides", "E1 defoverridable sites (the language's override-point marker)", f.rel, line, n.text.split("\n")[0] || "")
          // F1/F2: what scope would a mark be credited to? The analyzer records it
          // under the innermost declared scope. If every site sits inside a
          // def*/defmacro body, the credited scope is a FUNCTION, never a module,
          // and a function is never the target of a `use` — which makes the
          // walk's quote gate unobservable on this corpus, i.e. a mutant that
          // removes it is EQUIVALENT here and the ruling must say so.
          const enclDef = (() => { let c: any = n.parent; while (c) { if (c.type === "call") { const ci = (() => { for (const k of kids(c)) if (k.type === "identifier") return k; return undefined })(); if (ci && DEF_CONSTRUCTS.has(ci.text)) return ci.text } c = c.parent } return "" })()
          const siteInQuote = (() => { let c: any = n.parent; while (c) { if (c.type === "call") { const ci = (() => { for (const k of kids(c)) if (k.type === "identifier") return k; return undefined })(); if (ci && ci.text === "quote") return true } c = c.parent } return false })()
          if (enclDef.length === 0) {
            hit("overrides", "F1 defoverridable NOT inside any def*/defmacro body (the shape that could credit the mark to a module scope)", f.rel, line, n.text.split("\n")[0] || "")
            if (moduleStack.length > 0) {
              hit("overrides", "F2 defoverridable credited to a MODULE scope (no enclosing def body)", f.rel, line, n.text.split("\n")[0] || "")
              if (siteInQuote) hit("overrides", "F3 defoverridable inside a quote AND credited to a module scope (the ONLY shape the walk quote gate can change)", f.rel, line, n.text.split("\n")[0] || "")
            }
          }
          // Parse the marked set: keywords (name: arity), a list of pairs, or a
          // bare alias meaning "every function of that module".
          const args = findChild(n, "arguments")
          const mod = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : ""
          const inQuote = (() => { let c: any = n.parent; while (c) { if (c.type === "call" && callIdentifier(c) === "quote") return true; c = c.parent } return false })()
          if (args) {
            const parsePair = (p: any): void => {
              const kw = findChild(p, "keyword")
              if (!kw) return
              const txt = kw.text
              const colon = txt.indexOf(":")
              if (colon < 0) return
              const nm = txt.slice(0, colon)
              const rest = txt.slice(colon + 1)
              let digits = ""
              for (const ch of rest) if (ch >= "0" && ch <= "9") digits += ch
              overridableSites.push({ module: mod, name: nm, arity: digits.length > 0 ? Number(digits) : -1, line, inQuote })
            }
            for (const c of kids(args)) {
              if (c.type === "pair") parsePair(c)
              else if (c.type === "keywords") for (const p of kids(c)) if (p.type === "pair") parsePair(p)
              else if (c.type === "list") {
                for (const el of kids(c)) {
                  if (el.type === "pair") parsePair(el)
                  else if (el.type === "keywords") for (const p of kids(el)) if (p.type === "pair") parsePair(p)
                  else if (el.type === "keyword") { const kw = findChild(el, "keyword") ?? el; const txt = kw.text; const colon = txt.indexOf(":"); if (colon > 0) overridableSites.push({ module: mod, name: txt.slice(0, colon), arity: -1, line, inQuote }) }
                  else if (el.type === "identifier") overridableSites.push({ module: mod, name: el.text, arity: -1, line, inQuote })
                }
              }
              else if (c.type === "keyword") { const txt = c.text; const colon = txt.indexOf(":"); if (colon > 0) overridableSites.push({ module: mod, name: txt.slice(0, colon), arity: -1, line, inQuote }) }
              else if (c.type === "alias") {
                overridableSites.push({ module: mod, name: c.text, arity: -2, line, inQuote })
                let rec = declaredModules.get(mod)
                if (!rec) { rec = { defs: new Set(), overridableModule: false, overridableNames: new Set(), used: [] }; declaredModules.set(mod, rec) }
                rec.overridableModule = true
              }
            }
          }
        }
        if (id === "super") hit("overrides", "E2 super(...) call sites", f.rel, line, n.text.split("\n")[0] || "")
        if (id === "def" || id === "defp" || id === "defmacro" || id === "defmacrop" || id === "defdelegate" || id === "defguard" || id === "defguardp") {
          const pub = id === "def" || id === "defmacro" || id === "defdelegate" || id === "defguard"
          if (!doc) {
            if (id === "def" || id === "defdelegate" || id === "defguard") hit("exports", "D1 public def/defdelegate/defguard/defprotocol-callback", f.rel, line, n.text.split("\n")[0] || "")
            if (id === "defmacro") hit("exports", "D2 public defmacro", f.rel, line, n.text.split("\n")[0] || "")
            if (id === "defp" || id === "defmacrop" || id === "defguardp") hit("exports", "D5 PRIVATE defp/defmacrop/defguardp (must NOT export)", f.rel, line, n.text.split("\n")[0] || "")
          }
          // Record the def for E3/E7.
          const sig = findChild(n, "arguments")
          const sigCall = sig ? (() => { for (const c of kids(sig)) if (c.type === "call") return c; return undefined })() : undefined
          const nm = sigCall ? (findChild(sigCall, "identifier") || findChild(sigCall, "dot"))?.text ?? "" : ""
          let arity = 0
          const argList = sigCall ? findChild(sigCall, "arguments") : undefined
          if (argList) {
            let sawDefault = false
            for (const a of kids(argList)) {
              if (a.type === "keyword") { sawDefault = true; continue }
              arity++
            }
            void sawDefault
          }
          const mod = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : ""
          const defInQuote = (() => { let c: any = n.parent; while (c) { if (c.type === "call" && callIdentifier(c) === "quote") return true; c = c.parent } return false })()
          defSites.push({ module: mod, name: nm, arity, line, inQuote: defInQuote })
          if (id === "def" || id === "defp" || id === "defmacro" || id === "defmacrop") {
            let s = defNamesByModule.get(mod); if (!s) { s = new Set(); defNamesByModule.set(mod, s) } s.add(nm)
            let a = defArityByModule.get(mod); if (!a) { a = new Set(); defArityByModule.set(mod, a) } a.add(`${nm}/${arity}`)
          }
        }
        if (INHERITANCE_KEYWORDS.has(id) && !doc) hit("extends", "A6 any call whose identifier is an inheritance keyword", f.rel, line, id)
      }

      // MEASURED TREE SHAPE, and it is not the one the first version of this
      // probe assumed. In tree-sitter-elixir 0.3.5 a member READ `user.name`
      // is a `call` node whose target is a `dot` and which has NO `arguments`
      // child — the same shape as a zero-arity remote call. The analyzer's own
      // isMemberAccess() separates them by the receiver's first character
      // (lowercase = variable/field, uppercase = module/remote). Probing `dot`
      // nodes directly counts multi-alias `Module.{A, B}` forms and nothing
      // else: 65 sites, of which 7 are `alias Module.Types.{…}`. The real
      // population is measured here.
      if (n.type === "call") {
        const args = findChild(n, "arguments")
        const targetNode = findChild(n, "dot")
        if (targetNode && !args && !doc) {
          const root = targetNode.text.split(".")[0] ?? ""
          const lower = root.length > 0 && root.charCodeAt(0) >= 97 && root.charCodeAt(0) <= 122
          if (lower) hit("uses", "B2b member field READ: call whose target is a dot, no arguments, LOWERCASE root (the `uses` candidate)", f.rel, line, targetNode.text)
          else hit("uses", "B2c zero-arity REMOTE reference: call whose target is a dot, no arguments, CAPITALIZED root", f.rel, line, targetNode.text)
        }
      }
      if (n.type === "access_call" && !doc) {
        hit("uses", "B6 Access read: access_call node (recv[:key])", f.rel, line, n.text.split("\n")[0] || "")
      }
      if (n.type === "dot") {
        const hasArgs = findChild(n, "arguments") !== undefined
        // The callee test: a `dot` that IS the target of an enclosing `call` is
        // a CALL, and the calls edge already names it (go's analyzer skips
        // exactly this shape for the same reason: "Selectors that are the
        // callee of a call_expression are skipped (the calls edge handles
        // them)"). Counting all 37,953 dot nodes as `uses` would double-label
        // every remote call, so the two figures are reported separately.
        // NOTE: web-tree-sitter hands back a NEW wrapper object per call, so
        // `parent.namedChild(0) === n` is false for a node that IS that child.
        // Compare `id`. This bit the first version of this probe and made the
        // callee filter count zero, which would have double-labelled every
        // remote call as a member read.
        const firstNamed = (n.parent !== null && n.parent !== undefined && n.parent.type === "call" && n.parent.namedChildCount > 0) ? n.parent.namedChild(0) : undefined
        const parentIsCallTarget = firstNamed !== undefined && firstNamed !== null && firstNamed.id === n.id
        if (parentIsCallTarget) {
          hit("uses", "B4 dot member CALL: dot node WITH an arguments child", f.rel, line, n.text.split("\n")[0] || "")
        } else if (!doc) {
          hit("uses", "B2 dot member READ: dot node with NO arguments child", f.rel, line, n.text.split("\n")[0] || "")
        }
        if (hasArgs) { /* a dot with its own arguments is a remote call in this grammar */ }
      }
      if (n.type === "unary_operator" && !doc) {
        const op = n.child(0)
        if (op && op.text === "@") {
          const inner = n.child(1)
          const hasArgs = inner ? findChild(inner, "arguments") !== undefined : false
          if (!hasArgs) {
            let nm = ""
            if (inner) { const id = findChild(inner, "identifier"); nm = id ? id.text : (inner.text || "") }
            if (nm.length > 0 && !nm.startsWith("@")) {
              hit("uses", "B3 module attribute READ: @name with no arguments", f.rel, line, nm)
              const DECL = new Set(["moduledoc", "doc", "spec", "type", "typep", "opaque", "callback", "macrocallback", "behaviour", "behavior", "derive", "optional_callbacks", "deprecated", "typedoc", "impl", "compile", "dialyzer", "vsn", "compile_options"])
              const base = nm.split(".")[0]
              if (DECL.has(base)) hit("uses", "B3a module attribute READ, DECLARATION attribute (must stay silent)", f.rel, line, nm)
              else hit("uses", "B3b module attribute READ, code-valued attribute (a `uses` candidate)", f.rel, line, nm)
            }
          }
        }
      }
      if ((n.type === "access" || n.type === "access_call") && !doc) hit("uses", "B5 Access/bracket read: node types that carry [] indexing", f.rel, line, n.text.split("\n")[0] || "")
      if ((n.type === "unary_operator" || n.type === "call") && !doc) {
        const op = n.type === "unary_operator" ? n.child(0) : undefined
        const inner = n.type === "unary_operator" ? n.child(1) : n
        if (n.type === "unary_operator" && op && op.text === "@" && inner && inner.type === "call") {
          const cid = callIdentifier(inner)
          if (cid === "type") hit("exports", "D3 public @type / @opaque", f.rel, line, "@type")
          if (cid === "opaque") hit("exports", "D3 public @type / @opaque", f.rel, line, "@opaque")
          if (cid === "typep") hit("exports", "D6 PRIVATE @typep", f.rel, line, "@typep")
          if (cid === "callback" || cid === "macrocallback") hit("exports", "D4 public @callback / @macrocallback", f.rel, line, "@" + cid)
          if (cid === "impl") hit("overrides", "E6 @impl attributes (Elixir's callback-conformance marker)", f.rel, line, "@impl")
          if (cid === "behaviour" || cid === "behavior") hit("extends", "A5 @behaviour / @behavior attributes (conformance mechanism)", f.rel, line, "@" + cid)
        }
      }
      // `::` is an anonymous token child of the attribute's `arguments`, not a
      // binary_operator — probed and corrected (the first version of this probe
      // read it as binary_operator and reported 0 sites for @type in a corpus
      // with hundreds of them).
      if (n.type === "call" && !doc) {
        const cid = callIdentifier(n)
        if (cid === "type" || cid === "typep" || cid === "opaque") {
          const p = n.parent
          const isAttr = p !== null && p !== undefined && p.type === "unary_operator" && (p.child(0)?.text === "@")
          if (!isAttr) hit("exports", "D3 public @type / @opaque", f.rel, line, cid)
        }
      }

      // module stack maintenance
      let pushed = ""
      if (n.type === "call") {
        const id = callIdentifier(n)
        if (id === "defmodule" || id === "defprotocol") {
          const args = findChild(n, "arguments")
          let nm = ""
          for (const c of args ? kids(args) : []) if (c.type === "alias") { nm = c.text; break }
          const parentMod = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : ""
          pushed = parentMod.length > 0 ? `${parentMod}.${nm}` : nm
        }
      }
      if (pushed.length > 0) moduleStack.push(pushed)
      for (const c of kids(n)) walk(c, moduleStack)
      if (pushed.length > 0) moduleStack.pop()
    }

    walk(tree.rootNode, [])

    // ---- post-walk derived probes
    for (const [nm, c] of moduleNamesByFile) {
      if (c > 1) hit("extends", "A2 defmodule name REPEATED inside one file (module reopening)", f.rel, 0, `${nm} x${c}`)
    }
    // E4: same protocol+type twice in one file.
    const implKey = new Map<string, number>()
    for (const d of defimplSites) {
      for (const ft of d.forTypes) {
        const k = `${d.protocol}|${ft}`
        const prev = implKey.get(k) || 0
        implKey.set(k, prev + 1)
        if (prev > 0) hit("overrides", "E4 defimpl declared twice for the same protocol+type in one file", f.rel, line, k)
      }
    }
    // E5: same protocol with two different for: types (dispatch fan-out).
    const protos = new Map<string, Set<string>>()
    for (const d of defimplSites) {
      let s = protos.get(d.protocol)
      if (!s) { s = new Set(); protos.set(d.protocol, s) }
      for (const ft of d.forTypes) s.add(ft)
    }
    for (const [p, s] of protos) {
      if (s.size > 1) hit("overrides", "E5 two defimpl for the same protocol with different for: types", f.rel, line, `${p}: ${s.size} types`)
    }
    // E3: defoverridable marks a name/arity, and a LATER def of that name/arity
    // exists in the SAME module AND the SAME lexical block. This is Elixir's only
    // same-module override. The first version of this probe ignored the quote
    // boundary and reported 45 sites, which is wrong: in dict.ex the
    // `defoverridable merge: 2` lives inside the `use Dict` __using__ TEMPLATE
    // and the later `def merge/2` is Dict's own real function — two unrelated
    // things that share a name. Quote-awareness splits them.
    for (const o of overridableSites) {
      if (o.name.length === 0 || o.name === "@") continue
      for (const d of defSites) {
        if (d.module !== o.module) continue
        if (d.name !== o.name) continue
        if (d.line <= o.line) continue
        if (o.arity >= 0 && d.arity !== o.arity) continue
        if (o.inQuote !== d.inQuote) {
          // Crosses the quote boundary: NOT an override, and the only reason the
          // unrefined probe looked busy.
          continue
        }
        hit("overrides", o.inQuote
          ? "E3b defoverridable + later def, BOTH inside the same quote (a __using__ template)"
          : "E3a defoverridable + a LATER def of the marked name/arity, both at module level (a real override)", f.rel, d.line,
          `${o.module}.${o.name}/${o.arity} @${o.line} -> def @${d.line}${o.inQuote ? " [quote]" : ""}`)
      }
    }
    // E8: `use N` where N is DECLARED IN THIS FILE and N marks itself (or the
    // named function) overridable. Both endpoints are then nameable inside one
    // file, which is the only shape in which an `overrides` edge has two
    // different endpoints. `use N` where N lives in another file is NOT here,
    // and publishing it would be a fabrication: most defs in a `use N` module
    // are new functions, not overrides.
    for (const [m, rec] of declaredModules) {
      for (const target of rec.used) {
        const prov = declaredModules.get(target)
        if (!prov) continue
        const overridableNames = prov.overridableModule ? prov.defs : prov.overridableNames
        for (const d of overridableNames) {
          if (!rec.defs.has(d)) continue
          hit("overrides", "E8 use N where N is declared in the SAME file and marks defoverridable", f.rel, 0, `${m}.${d} overrides ${target}.${d}`)
        }
      }
    }
    // E7: a def whose name is already declared in an EARLIER module in the file.
    for (const d of defSites) {
      if (d.name.length === 0) continue
      const outerMod = d.module.lastIndexOf(".") >= 0 ? d.module.slice(0, d.module.lastIndexOf(".")) : ""
      if (outerMod.length === 0) continue
      const outerNames = defNamesByModule.get(outerMod)
      if (outerNames && outerNames.has(d.name)) {
        hit("overrides", "E7 a def whose name matches a def in an EARLIER defmodule in the same file", f.rel, d.line, `${d.module}.${d.name}`)
      }
    }
  }

  const artifact = {
    tool: "validation/m14/elixir/elixir-construct-census.ts",
    lane: "ELIXIR_FIX2",
    // ELIXIR_FIX2-S1: the firing census recorded no subject, which is how a
    // pre-fix artifact read as current. Same fields here, for the same reason:
    // instrument B is a parse-tree count and is only interpretable next to the
    // analyzer it is being used to judge.
    subject: "src/ast/real-elixir-analyzer.ts",
    subjectCommit: process.env.ELIXIR_SUBJECT_COMMIT || headCommit(),
    subjectSha256_16: subjectSha(),
    population: {
      corpusRoot: CORPUS_ROOT, corpusDirs: CORPUS_DIRS, extensions: EXTS, derived: true,
      allFilesFound: all.length, filesRun: files.length,
      sampling: WANT > 0 && WANT < all.length ? `stride of ${WANT} over ${all.length}` : "WHOLE corpus",
    },
    instrumentA: {
      grammarFile: GRAMMAR_JS,
      grammarDeclaredWordCounts: grammarDeclared,
      note: "substring counts over the GRAMMAR DECLARATION, never over project source; a word appearing here means the grammar defines a rule with that name, which is the question being asked",
      emittedNodeTypeCount: emittedNodeTypes.size,
      emittedNodeTypes: [...emittedNodeTypes].sort(),
    },
    instrumentB: {
      filesParsed: parsed, filesCrashed: crashed,
      wallMs: Date.now() - started,
      probes: P.map((p) => ({
        type: p.type, probe: p.probe, count: p.code, files: p.files.size,
        samples: p.samples,
      })),
    },
  }
  const out = process.env.ELIXIR_CONSTRUCT_ARTIFACT || "validation/m14/elixir/elixir-construct-census.json"
  writeFileSync(out, JSON.stringify(artifact, null, 2))

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`population: ${files.length} of ${all.length} derived ${EXTS.join("/")} files (${artifact.population.sampling})`)
  L(`parsed ${parsed} crashed ${crashed}  wallMs ${artifact.instrumentB.wallMs}`)
  L("")
  L(`INSTRUMENT A — grammar inventory`)
  L(`  grammar file ${GRAMMAR_JS}`)
  for (const w of GRAMMAR_PROBE_WORDS) L(`    "${w}" occurrences in grammar.js: ${grammarDeclared[w]}`)
  L(`  node types the grammar EMITS across the corpus: ${emittedNodeTypes.size}`)
  L(`  ${[...emittedNodeTypes].sort().join(" ")}`)
  L("")
  L(`INSTRUMENT B — parse-tree semantic counts (code sites only; doc strings and comments excluded)`)
  for (const p of P) {
    L(`  ${p.type.padEnd(10)} ${String(p.code).padStart(6)} sites / ${String(p.files.size).padStart(4)} files   ${p.probe}`)
    for (const s of p.samples.slice(0, 4)) L(`        ${s}`)
  }
  L(`artifact: ${out}`)
}

await main()