// ELIXIR_FIX2 emit-gap census — how much of a construct the analyzer publishes.
//
// WHAT QUESTION THIS ANSWERS
// The firing census says `uses` fires 2,117 edges / 180 files. The construct
// census says the LANGUAGE has 2,244 member-field-read sites / 182 files. Those
// two numbers disagree by 127 sites and, until this instrument existed, nothing
// in this lane's evidence accounted for the difference. A verdict that quotes
// both figures side by side and does not divide them is the shape the honesty
// contract's "an instrument must declare the population it covered" rule is
// aimed at, so this instrument closes the gap explicitly, per site.
//
//   construct sites   -- an INDEPENDENT probe: a `call` whose target is a `dot`,
//                        with no `arguments` child, whose root's first character
//                        is lowercase. No exclusions at all. This is the shape
//                        probe B2b, re-derived here from the grammar.
//   emitted edges     -- what RealElixirAnalyzer.analyze actually produced.
//   gap               -- construct site with no emitted edge on that line.
//
// The per-site REASON for a gap is derived from the analyzer's own documented
// exclusions (quote / def head / pattern position / declaration attribute /
// `->` pattern), so the breakdown EXPLAINS the recall number and does not
// independently verify the exclusions. Stated here so the breakdown is not read
// as an oracle. The recall number itself is independent of the analyzer: it is
// shape-probe sites against produced edges.
//
// Same for `exports`: every syntactically PUBLIC declaration form (the probe is
// the form's own keyword, with no visibility logic) against the `exports` edges
// produced.
//
// NO REGEX anywhere: node.type strings, `===`, charCodeAt, Set/Map lookups.
//
// Population is DERIVED by readdir over fixtures/repositories/{elixir,otp}.
// Override with BB_CORPUS_ROOT / ELIXIR_CORPUS_DIRS / NFILES.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

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

function collectFiles(root: string, dirs: string[], exts: string[]): Array<{ path: string; rel: string }> {
  const out: Array<{ path: string; rel: string }> = []
  for (const d of dirs) {
    const base = join(root, d)
    const walk = (dir: string, depth: number): void => {
      if (depth > 24) return
      let ents: any[]
      try { ents = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
      for (const e of ents) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          // Identical exclusion set to elixir-firing-census.ts. It matters: the
          // mix test fixtures carry a `deps/` and a `_build/` tree of generated
          // .ex files, so skipping them is the difference between a population
          // of 601 and 610. Three instruments that do not measure the same
          // population produce numbers that cannot be compared, so the rule is
          // duplicated verbatim rather than re-invented, and the count is
          // printed on every run.
          const skip = e.name === ".git" || e.name === "node_modules" || e.name === "_build" || e.name === "deps"
          if (!skip) walk(p, depth + 1)
        } else if (e.isFile()) {
          let want = false
          for (const x of exts) if (e.name.endsWith(x)) want = true
          if (!want) continue
          try {
            if (statSync(p).size < 8) continue
            out.push({ path: p, rel: relative(base, p) })
          } catch { /* unreadable: not part of the population */ }
        }
      }
    }
    walk(base, 0)
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

// ---- tree helpers (node API only) -----------------------------------------
function namedChildOfType(n: any, t: string): any {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === t) return c }
  return undefined
}
function isLowerStart(s: string): boolean {
  if (!s.length) return false
  const c = s.charCodeAt(0)
  return c >= 97 && c <= 122 // a-z
}
// The ROOT of a dot chain: `user.address.city` -> `user`. The elixir grammar
// names the dot fields `left` / `operator` / `right` (verified by dumping a
// parse tree, not assumed), and nests the chain through `left`. Walks by field
// name, never by splitting text on a delimiter.
function dotRoot(dot: any): any {
  let cur: any = dot
  for (;;) {
    const left = cur.childForFieldName("left")
    if (!left) break
    if (left.type === "call") { const t = left.childForFieldName("target"); if (t && t.type === "dot") { cur = t; continue } }
    return left
  }
  return undefined
}
// memberLeaf: the LAST segment of a dot chain, as a name. `user.address.city`
// yields two targets: `address` then `city`, because the grammar nests
// call(dot(call(dot(user,address)),city)).
function memberLeaf(dot: any): { leaf: string; receiver: string } {
  let cur: any = dot
  for (;;) {
    const left = cur.childForFieldName("left")
    if (!left) break
    // Descend a chained read ONLY when the inner call is itself argument-less.
    // `user.address.city` nests call(dot(call(dot(user,address)),city)) and the
    // two segments are two real reads, so the inner call must be visited. But
    // `module.f(w).message` nests call(dot(call(dot(module,f),w)),message): the
    // inner call is an INVOCATION, not a read, and descending into it reports
    // the leaf as `f` instead of `message`. The structural discriminator is the
    // presence of an `arguments` child, not the node type.
    if (left.type === "call" && !namedChildOfType(left, "arguments")) {
      const t = left.childForFieldName("target")
      if (t && t.type === "dot") { cur = t; continue }
    }
    return { leaf: dotProperty(cur), receiver: nodeName(left) }
  }
  return { leaf: dotProperty(cur), receiver: "" }
}
function dotProperty(dot: any): string {
  const p = dot.childForFieldName("right")
  return p ? p.text : ""
}
function nodeName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text
  return n.text || ""
}

// ---- the probe: one member-field-read construct site ------------------------
type Site = { line: number; leaf: string; receiver: string; ctx: string }

function collectSites(root: any): Site[] {
  const out: Site[] = []
  const walk = (n: any): void => {
    if (n.type === "call") {
      const target = n.childForFieldName("target")
      // The elixir grammar gives `arguments` NO field name (verified by dumping
      // `Mod.hello(u.name)`: the field row is `0:dot=target` and the arguments
      // child is unnamed). Asking childForFieldName("arguments") returns null
      // whether or not the call has arguments, so the FIRST version of this probe
      // counted every qualified call as a bare member read and reported 2,725
      // sites where the construct census reports 2,244. A type test is what the
      // analyzer itself uses (`findChild(c => c?.type === "arguments")`).
      const args = namedChildOfType(n, "arguments")
      if (target && target.type === "dot" && !args) {
        const rootNode = dotRoot(target)
        const rt = rootNode ? nodeName(rootNode) : ""
        if (isLowerStart(rt)) {
          const { leaf, receiver } = memberLeaf(target)
          if (leaf.length > 0) out.push({ line: target.startPosition.row + 1, leaf, receiver, ctx: "none" })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
  return out
}

// ---- the four exclusion predicates, re-derived from the analyzer ---------
// Mirrored from src/ast/real-elixir-analyzer.ts so the gap breakdown accounts
// for every missing site. This EXPLAINs the recall number; it is not an oracle,
// because it is the same predicate list the analyzer uses. If the analyzer
// excluded something this list does not name, the site lands in `unexplained`
// and is reported as a lead rather than quietly folded into a reason.
const DEF_CONSTRUCTS = new Set(["def", "defp", "defmacro", "defmacrop", "defguard", "defguardp", "defdelegate", "defprotocol", "defimpl"])
const DECLARATION_ATTRIBUTES = new Set(["doc", "moduledoc", "typedoc", "spec", "type", "typep", "opaque", "callback", "macrocallback", "behavior", "behaviour", "derive", "optional_callbacks", "deprecated"])

function callIdentifier(n: any): string {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "identifier") return c.text }
  return ""
}
function inQuotedCode(node: any): boolean {
  let cur = node.parent
  while (cur) {
    if (cur.type === "call") {
      const id = callIdentifier(cur)
      if (id === "quote") return true
      if (id === "unquote" || id === "unquote_splicing") return false
    }
    cur = cur.parent
  }
  return false
}
function inDeclarationAttributeValue(node: any): boolean {
  let cur = node.parent
  while (cur) {
    if (cur.type === "unary_operator" && cur.child(0)?.text === "@") {
      const v = cur.child(1)
      if (!v || v.type !== "call") return true
      return DECLARATION_ATTRIBUTES.has(callIdentifier(v))
    }
    cur = cur.parent
  }
  return false
}
function isDefHead(node: any): boolean {
  const startIndex = node.startIndex
  let cur = node.parent
  while (cur) {
    if (cur.type === "do_block") return false
    if (cur.type === "pair") {
      for (let i = 0; i < cur.namedChildCount; i++) { const c = cur.namedChild(i); if (c && c.type === "keyword" && (c.text === "do" || c.text.indexOf("do:") === 0)) return false }
    }
    if (cur.type === "binary_operator" && cur.childCount > 2 && cur.child(1)?.text === "\\\\") {
      const rhs = cur.child(2)
      if (rhs && startIndex >= rhs.startIndex) return false
    }
    if (cur.type === "call" && DEF_CONSTRUCTS.has(callIdentifier(cur))) return true
    cur = cur.parent
  }
  return false
}
function isPatternPosition(node: any): boolean {
  let cur = node
  while (cur && cur.parent) {
    const p = cur.parent
    if (p.type === "stab_clause") {
      for (let i = 0; i < p.childCount; i++) { const c = p.child(i); if (c && c.type === "->") return node.startIndex < c.startIndex }
      return false
    }
    cur = p
  }
  return false
}

// ---- classify a construct site the analyzer did NOT publish ---------------
// Priority order is the order the analyzer tests in: quote gate at the walk
// level, then memberReadLeaf, then the three site-level exclusions.
function classifyMiss(site: Site, root: any): string {
  const cands: any[] = []
  const walk = (n: any): void => {
    if (n.startPosition.row + 1 === site.line && n.type === "call") {
      const t = n.childForFieldName("target")
      if (t && t.type === "dot" && !namedChildOfType(n, "arguments")) {
        const rt = dotRoot(t)
        const nm = rt ? nodeName(rt) : ""
        if (isLowerStart(nm)) cands.push(n)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) walk(ch) }
  }
  walk(root)
  if (!cands.length) return "unexplained:no-node-on-line"
  const reasons = new Set<string>()
  for (const c of cands) {
    // walk up for a comment node: a member read inside a comment is not code
    let hasComment = false
    for (let p = c.parent; p; p = p.parent) { if (p.type === "comment") { hasComment = true; break } }
    if (hasComment) { reasons.add("comment"); continue }
    if (inQuotedCode(c)) { reasons.add("quoted-code"); continue }
    if (isDefHead(c)) { reasons.add("def-signature-head"); continue }
    if (inDeclarationAttributeValue(c)) { reasons.add("declaration-attribute-value"); continue }
    if (isPatternPosition(c)) { reasons.add("pattern-position"); continue }
    // Rule R7 as a STRING test: `memberReadLeaf` refuses a leaf equal to the
    // placeholder literal, so `users.unknown` publishes nothing. Measured: 6
    // sites. Recorded as a refusal, not a defect — see the doc's R7 note, where
    // the same string under `contains` was adjudicated a TRUE identifier and the
    // two treatments are reported to master as a rule-level inconsistency.
    if (site.leaf === "unknown") { reasons.add("r7-placeholder-literal"); continue }
    reasons.add("unexplained")
  }
  const arr = [...reasons].sort()
  return arr.length === 1 ? arr[0] : arr.join("+")
}

// ---- exports probe: syntactically PUBLIC declaration forms -----------------
// No visibility logic: the form keyword IS the probe. `defp` is not in the list,
// so the 7,959 private sites are outside the population by construction and are
// reported separately as the negative control.
const PUBLIC_EXPORT_FORMS = new Set([
  "def", "defmacro", "defguard", "defdelegate", "defprotocol", "defimpl", "defstruct", "defmodule",
])
function collectExportForms(root: any): Array<{ line: number; form: string; name: string }> {
  const out: Array<{ line: number; form: string; name: string }> = []
  const walk = (n: any): void => {
    if (n.type === "call") {
      const id = namedChildOfType(n, "identifier")
      const idt = id ? id.text : ""
      if (PUBLIC_EXPORT_FORMS.has(idt)) out.push({ line: n.startPosition.row + 1, form: idt, name: sigName(n) })
      else if (idt === "defp" || idt === "defmacrop" || idt === "defguardp") void 0
      else if (n.type === "unary_operator") { /* handled below */ }
    }
    if (n.type === "unary_operator" && n.child(0)?.text === "@") {
      const c = n.child(1)
      if (c && c.type === "call") {
        const id = namedChildOfType(c, "identifier")
        const idt = id ? id.text : ""
        if (idt === "type" || idt === "opaque" || idt === "callback" || idt === "macrocallback") {
          out.push({ line: n.startPosition.row + 1, form: "@" + idt, name: sigName(c) })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) walk(ch) }
  }
  walk(root)
  return out
}
// The DECLARED name of a form node — the identifier of the call nested in the
// form's own `arguments` (`def go(u)` -> `go`), NOT the form keyword. Reading
// the outer identifier made every sample print "def", which also meant the
// `no-name-in-head` reason below could never fire because the name was never
// empty.
function sigName(formNode: any): string {
  const args = namedChildOfType(formNode, "arguments")
  if (!args) return ""
  const head = args.namedChild(0)
  if (!head) return ""
  if (head.type === "call") {
    const id = namedChildOfType(head, "identifier")
    return id ? id.text : ""
  }
  if (head.type === "identifier" || head.type === "operator_identifier") return head.text
  // `defmodule Smoke.MixProject` — the argument is an alias, not a call.
  if (head.type === "alias") return head.text
  return ""
}

// ---- main -----------------------------------------------------------------
const all = collectFiles(CORPUS_ROOT, CORPUS_DIRS, EXTS)
const files = WANT > 0 && WANT < all.length ? all.filter((_, i) => i % Math.ceil(all.length / WANT) === 0) : all

const usesSiteTotal = { sites: 0, files: 0 }
let commentSites = 0
let nonQuotedExcluded = 0
const usesEmittedTotal = { edges: 0, files: 0 }
const missReasons = new Map<string, number>()
const missSamples = new Map<string, string[]>()
const emittedOnSiteLines = new Map<string, number>()

const exportFormTotal = new Map<string, { sites: number; files: number }>()
const exportFormFiles = new Map<string, Set<string>>()
const exportEmitted = { edges: 0, files: 0 }
const exportPrivateControl = { sites: 0, files: 0 }
const exportUnpublishedByForm = new Map<string, number>()
const exportGapReasons = new Map<string, number>()
const exportGapSamples = new Map<string, string[]>()

let parsed = 0, crashed = 0
const t0 = Date.now()

for (const f of files) {
  let content: string
  try { content = readFileSync(f.path, "utf8") } catch { continue }
  let root: any
  let res: any
  try {
    // The production entry. `getAnalyzer` is module-private, and going through
    // parseFile is what the firing census does, so the two instruments measure
    // the same seam.
    res = await ASTEngine.parseFile(f.path, content)
    parsed++
  } catch { crashed++; continue }
  // parseFile does not hand back the tree, so re-parse for the probe. Both walks
  // read the same bytes through the same grammar; only the analyzer's OUTPUT is
  // compared against the probe's sites.
  try {
    const parser = await ASTEngine.getParser("elixir")
    root = (await parser.parse(content, f.path)).rootNode
  } catch { crashed++; parsed--; continue }

  const rels: any[] = Array.isArray(res.relationships) ? res.relationships : []
  const syms: any[] = Array.isArray(res.symbols) ? res.symbols : []

  // ---------- uses ----------
  const sites = collectSites(root)
  if (sites.length) usesSiteTotal.sites += sites.length
  if (sites.length) usesSiteTotal.files++

  // A site counts as published if some `uses` edge carries its line AND its leaf
  // as target. Line+target, because a file can carry several member reads on one
  // line and the edge contract keys on name.
  const usesLines = new Set<string>()
  let fileUses = 0
  for (const r of rels) {
    if (r.type !== ASTEngine.RelationshipType.Uses) continue
    fileUses++
    usesLines.add(`${r.line_number}|${r.target}`)
  }
  usesEmittedTotal.edges += fileUses
  if (fileUses) usesEmittedTotal.files++

  for (const s of sites) {
    if (usesLines.has(`${s.line}|${s.leaf}`)) {
      emittedOnSiteLines.set(s.leaf, (emittedOnSiteLines.get(s.leaf) ?? 0) + 1)
      continue
    }
    const why = classifyMiss(s, root)
    if (why === "comment") missReasons.set("comment", (missReasons.get("comment") ?? 0) + 1)
    else if (why === "quoted-code" || why.indexOf("quoted-code") >= 0) nonQuotedExcluded++
    missReasons.set(why, (missReasons.get(why) ?? 0) + 1)
    const arr = missSamples.get(why) ?? []
    if (arr.length < 4) { arr.push(`${f.rel}:${s.line} ${s.receiver}.${s.leaf}`); missSamples.set(why, arr) }
  }

  // ---------- exports ----------
  const forms = collectExportForms(root)
  for (const fo of forms) {
    const cur = exportFormTotal.get(fo.form) ?? { sites: 0, files: 0 }
    cur.sites++
    exportFormTotal.set(fo.form, cur)
    const fs = exportFormFiles.get(fo.form) ?? new Set<string>()
    fs.add(f.rel)
    exportFormFiles.set(fo.form, fs)
  }

  let fileExports = 0
  for (const r of rels) if (r.type === ASTEngine.RelationshipType.Exports) fileExports++
  exportEmitted.edges += fileExports
  if (fileExports) exportEmitted.files++

  // How many export edges carry a line that is a public declaration form line?
  const exportLines = new Set<number>()
  for (const r of rels) if (r.type === ASTEngine.RelationshipType.Exports) exportLines.add(r.line_number)
  // Every public form site with no export edge on ITS OWN line, classified. The
  // dominant expected cause is the documented multi-clause merge: this lane
  // merges a multi-clause head into ONE symbol whose range starts at the FIRST
  // clause and ends at the LAST (EX-D16), and `exports` carries the symbol's
  // start line, so clauses 2..n sit on a line with no edge. That is counted, not
  // assumed: a site is "merged-clause" only if a symbol in this same file has
  // startLine <= line <= endLine and a DIFFERENT startLine.
  const fileSymbols = syms
  for (const fo of forms) {
    if (exportLines.has(fo.line)) continue
    exportUnpublishedByForm.set(fo.form, (exportUnpublishedByForm.get(fo.form) ?? 0) + 1)
    const covering = fileSymbols.find((sy: any) => sy.range && sy.range.startLine <= fo.line && sy.range.endLine >= fo.line && sy.range.startLine !== fo.line)
    let reason = "unexplained"
    if (covering) reason = "merged-multi-clause (EX-D16: one symbol, start line of the FIRST clause)"
    else if (fo.name === "unknown") reason = "r7-placeholder-literal"
    else if (fo.form === "defstruct") reason = "struct-symbol-is-its-own-module (EX-L3 self-loop, deliberately not published)"
    else {
      // A declaration symbol with NO owner cannot be published from: there is no
      // module to publish it under. `defprotocol JSON.Encoder do` is exactly
      // this (interface JSON.Encoder, ownerName undefined) — its @callback
      // members DO publish, under the protocol's own name. A top-level
      // `defmodule` is the same shape.
      const ownerless = fileSymbols.find((sy: any) => sy.range && sy.range.startLine <= fo.line && sy.range.endLine >= fo.line && !(sy.ownerName || sy.scope))
      if (ownerless) reason = "declaration-symbol-is-ownerless (nothing to publish it under)"
      else if (fo.form === "defimpl") reason = "impl-class-symbol-is-named-by-for-type (EX-D21), not by the module"
      else if (fo.name.length === 0) reason = "no-name-in-head (a declaration whose signature has no identifier)"
      else if (fo.form === "defmodule") reason = "module-declares-no-exportable-member (or every member is private)"
    }
    exportGapReasons.set(reason, (exportGapReasons.get(reason) ?? 0) + 1)
    const arr = exportGapSamples.get(reason) ?? []
    if (arr.length < 4) { arr.push(`${f.rel}:${fo.line} ${fo.form} ${fo.name}`); exportGapSamples.set(reason, arr) }
  }

  // negative control: the PRIVATE forms
  let privSites = 0
  const walkPriv = (n: any): void => {
    if (n.type === "call") {
      const id = namedChildOfType(n, "identifier")
      if (id && (id.text === "defp" || id.text === "defmacrop" || id.text === "defguardp")) privSites++
    }
    if (n.type === "unary_operator" && n.child(0)?.text === "@" && n.child(1)?.type === "call") {
      const id = namedChildOfType(n.child(1), "identifier")
      if (id && id.text === "typep") privSites++
    }
    for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) walkPriv(ch) }
  }
  walkPriv(root)
  exportPrivateControl.sites += privSites
  if (privSites) exportPrivateControl.files++
}

// per-form distinct-file counts, carried from the single pass above
for (const [form, fs] of exportFormFiles) { const t = exportFormTotal.get(form); if (t) t.files = fs.size }

const wallMs = Date.now() - t0
const totalSites = usesSiteTotal.sites
const published = totalSites - [...missReasons.values()].reduce((a, b) => a + b, 0)

const artifact = {
  tool: "validation/m14/elixir/elixir-emit-gap.ts",
  lane: "ELIXIR_FIX2",
  subject: "src/ast/real-elixir-analyzer.ts",
  subjectCommit: headCommit(),
  subjectSha256_16: subjectSha(),
  population: {
    corpusRoot: CORPUS_ROOT, corpusDirs: CORPUS_DIRS, extensions: EXTS, derived: true,
    allFilesFound: all.length, filesRun: files.length,
    sampling: WANT > 0 && WANT < all.length ? `stride of ${WANT} over ${all.length}` : "WHOLE corpus",
  },
  productionPath: "ASTEngine.parseFile -> getParser(elixir) -> parse -> getAnalyzer(elixir) -> analyze; the probe re-parses the same bytes for the tree",
  result: {
    filesParsed: parsed, filesCrashed: crashed, wallMs,
    uses: {
      constructSites: totalSites, constructFiles: usesSiteTotal.files,
      sitesInsideComments: commentSites,
      sitesInExecutablePosition: totalSites - commentSites,
      // The construct census's probe B2b excludes comments AND quoted code; this
      // is the number to reconcile against its 2,244.
      sitesExecutableNonQuoted: totalSites - commentSites - nonQuotedExcluded,
      emittedEdges: usesEmittedTotal.edges, emittedFiles: usesEmittedTotal.files,
      published: published,
      recallVsConstruct: totalSites ? Number((published / totalSites).toFixed(4)) : null,
      // edges > sites means the analyzer published MORE edges than the shape has
      // sites: a chained read emits one edge per segment (`user.address.city`
      // -> `address` and `city`), which is the documented behaviour.
      edgesMinusSites: usesEmittedTotal.edges - totalSites,
      gapByReason: [...missReasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count, samples: missSamples.get(reason) ?? [] })),
    },
    exports: {
      publicFormSitesByForm: [...exportFormTotal.entries()].map(([form, v]) => ({ form, sites: v.sites, files: v.files })).sort((a, b) => b.sites - a.sites),
      emittedEdges: exportEmitted.edges, emittedFiles: exportEmitted.files,
      edgesMinusSites: exportEmitted.edges - [...exportFormTotal.values()].reduce((a, v) => a + v.sites, 0),
      // a form site with no export edge on its line. Struct fields and
      // nested-module expansions shift this, so it is reported per form and
      // read as a lead list, not as a defect count.
      sitesWithNoExportEdgeOnLineByForm: [...exportUnpublishedByForm.entries()].sort((a, b) => b[1] - a[1]).map(([form, count]) => ({ form, count })),
      gapByReason: [...exportGapReasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count, samples: exportGapSamples.get(reason) ?? [] })),
      privateControl: { sites: exportPrivateControl.sites, files: exportPrivateControl.files, note: "defp/defmacrop/defguardp/@typep — the falsifier: an is-it-a-function rule would publish these" },
    },
  },
}

writeFileSync(join(import.meta.dir, "elixir-emit-gap.json"), JSON.stringify(artifact, null, 2))

const u = artifact.result.uses
const e = artifact.result.exports
console.log(`population: ${files.length} of ${all.length} derived .ex/.exs files`)
console.log(`parsed ${parsed} crashed ${crashed} wallMs ${wallMs}`)
console.log(`\nUSES   construct ${u.constructSites} sites / ${u.constructFiles} files   (comments ${u.sitesInsideComments}; executable ${u.sitesInExecutablePosition}; executable+non-quoted ${u.sitesExecutableNonQuoted} vs construct-census B2b 2244)`)
console.log(`       emitted   ${u.emittedEdges} edges / ${u.emittedFiles} files   (edges-sites ${u.edgesMinusSites > 0 ? "+" : ""}${u.edgesMinusSites})`)
console.log(`       published ${u.published} of ${u.constructSites} = ${(u.recallVsConstruct! * 100).toFixed(2)}%`)
for (const g of u.gapByReason) console.log(`       gap ${String(g.count).padStart(4)}  ${g.reason}${g.samples.length ? `  e.g. ${g.samples[0]}` : ""}`)
console.log(`\nEXPORTS public form sites: ${e.publicFormSitesByForm.map((x) => `${x.form} ${x.sites}/${x.files}f`).join(", ")}`)
console.log(`        emitted ${e.emittedEdges} edges / ${e.emittedFiles} files   (edges-sites ${e.edgesMinusSites > 0 ? "+" : ""}${e.edgesMinusSites})`)
console.log(`        private control ${e.privateControl.sites} sites / ${e.privateControl.files} files`)
console.log(`        sites with no export edge on their line: ${e.sitesWithNoExportEdgeOnLineByForm.map((x) => `${x.form} ${x.count}`).join(", ") || "none"}`)
for (const g of e.gapByReason) console.log(`        gap ${String(g.count).padStart(5)}  ${g.reason}${g.samples.length ? `  e.g. ${g.samples[0]}` : ""}`)
console.log(`\nartifact: validation/m14/elixir/elixir-emit-gap.json`)