// JAVASCRIPT RESOLUTION CLASSIFIER — every NON-RESOLVED edge of this lane, bucketed by CAUSE.
//
// WHY THIS EXISTS. `script/m14/incoming-gate.ts` prints, per relationship type, how many edges are
// unresolved (`TABLE 1`) and can dump the rows (`--dump`), but a row carries only its TARGET — for a
// JavaScript `calls` edge that is the callee LEAF (`getElementById`), because the analyzer publishes the
// leaf. The RECEIVER (`document.`) is what decides whether the name is a host API (claimable), a typed
// local (receiver typing), or a project member (owner qualification), so the dump alone CANNOT answer
// "why is this edge unresolved". This instrument re-derives each edge WITH its metadata and classifies
// it into the cause buckets the fixes are ordered by.
//
// IT IS A CLASSIFIER, NOT AN ARBITER. It does not resolve, decide, or move any count the gate prints;
// the gate remains the only verdict. What it adds is the CAUSE census the gate deliberately does not
// carry (one arbiter per question), built on the SAME population rule and the SAME key space:
//
//   population   mirrors `discoverFiles` in incoming-gate.ts: sorted repository names, `git ls-files`,
//                the lane's admitted extensions, the engine's 1 MB full-AST cap, then the stride sample.
//                The header prints discovered/sampled/total/repos so a capped run can never be read as a
//                population.
//   key space    mirrors the gate: per PROJECT, `name` plus each symbol's genuine `qualifiedName`
//                (`qualifiedName !== name`), because production resolves per project and the gate's
//                verdict is per project. A target that is a key here would be `resolved`; anything else
//                is what this file explains.
//
// USAGE
//   bun run script/m14/js-resolution-classify.ts 50               # cap-50 triage population (gate-comparable)
//   bun run script/m14/js-resolution-classify.ts 0                # WHOLE admitted population (12k+ files)
//   bun run script/m14/js-resolution-classify.ts 50 --json x.json # machine-readable census
//
// Every count is printed with the population it was measured on and the command that ran it. No number
// leaves this file without its denominator.
import { execFileSync } from "node:child_process"
import { closeSync, createReadStream, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from "node:fs"
import { createInterface } from "node:readline"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"
import type { Node } from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../src/ast/real-javascript-analyzer"
import { hostGlobalCitation, isHostGlobal } from "../../src/ast/js-builtin-prototypes"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const CAP = Number(process.argv[2] ?? 50)
const JSON_OUT = (() => {
  const at = process.argv.indexOf("--json")
  return at >= 0 ? process.argv[at + 1] : ""
})()
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
/**
 * STREAM MODE — the whole-population (cap 0) cause census without holding 1.47M edge rows in
 * memory. Phase A walks the population ONCE, keeps the project tables + the per-file bindings,
 * and spills each edge as one compact JSON line to a temp file; phase B streams that file back and
 * classifies one edge at a time. The first single-pass version held tables + bindings + rows and
 * was killed at 1 GB available during the cap-0 attempt (2026-10-18) rather than risk an OOM for
 * the whole box — that is why this shape exists. Counts are identical to the non-stream mode by
 * construction: the same compaction, the same classifyEdge, the same ingestRow.
 */
const STREAM = process.argv.includes("--stream")
const EDGE_SPILL = path.join(process.cwd(), ".tmp-js", "edges-cap0.jsonl")
const SIZE_CAP = 1024 * 1024
/** The only metadata keys the cause rules read (see the compact collection in the main loop). */
const COMPACT_META_KEYS = [
  "calleeExpression", "owner", "ownerEvidence",
  "bareRead", "chainRoot", "callReceiver", "isFieldAccess", "isTemplateInterpolation",
  "isExternalTarget", "externalReason", "externalSpecifier",
] as const

/** Repository directories in the corpus (symlinked entries are directories; `find` without -L is not used). */
function repoNames(): string[] {
  try {
    return readdirSync(CR).filter((n) => {
      try { return statSync(path.join(CR, n)).isDirectory() } catch { return false }
    }).sort()
  } catch { return [] }
}

/** Mirrors `admitByExtension`: extension match, plus a basename equal to an admitted spelling. */
function admit(rel: string): boolean {
  const dot = rel.lastIndexOf(".")
  const ext = dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ""
  if (EXTENSIONS.includes(ext)) return true
  const base = path.basename(rel)
  return EXTENSIONS.includes(base)
}

function discover(): { files: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  for (const name of repoNames()) {
    const dir = path.join(CR, name)
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admit(rel)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (CAP > 0 && total > CAP) {
    const stride = Math.max(1, Math.floor(total / CAP))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < CAP; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size }
}

// ============================================================================
// KEY SPACES — per project, mirroring the gate's declaration model.
// ============================================================================

type Proj = {
  names: Map<string, number>
  quals: Map<string, number>
  kinds: Map<string, Set<string>>
  /** member leaf -> owner scopes that declare it (a `scope.member` qualified name was published) */
  memberOwners: Map<string, Set<string>>
  classes: Set<string>
  files: Set<string>
  moduleNames: Set<string>
}

function projOf(repo: string, map: Map<string, Proj>): Proj {
  let p = map.get(repo)
  if (!p) {
    p = { names: new Map(), quals: new Map(), kinds: new Map(), memberOwners: new Map(), classes: new Set(), files: new Set(), moduleNames: new Set() }
    map.set(repo, p)
  }
  return p
}

function inc(m: Map<string, number>, k: string): void { m.set(k, (m.get(k) ?? 0) + 1) }

function addSymbol(p: Proj, sym: any): void {
  const name = String(sym?.name ?? "")
  if (name.length === 0) return
  const kind = String(sym?.kind ?? "")
  inc(p.names, name)
  const ks = p.kinds.get(name) ?? new Set<string>()
  ks.add(kind)
  p.kinds.set(name, ks)
  const scope = String(sym?.scope ?? "")
  const qual = String(sym?.qualifiedName ?? (scope ? `${scope}.${name}` : name))
  if (qual.length > 0 && qual !== name) {
    inc(p.quals, qual)
    const lastDot = qual.lastIndexOf(".")
    if (lastDot > 0) {
      const leaf = qual.slice(lastDot + 1)
      const owner = qual.slice(0, lastDot)
      const owners = p.memberOwners.get(leaf) ?? new Set<string>()
      owners.add(owner)
      p.memberOwners.set(leaf, owners)
    }
  }
  if (kind === "class" || kind === "Class") p.classes.add(name)
}

// ============================================================================
// PER-FILE BINDING TABLE — what a bare name is, in the file that reads it.
// ============================================================================

type Bindings = {
  /** names bound by a variable declarator (ANY scope), a parameter, a catch clause or a for-in target */
  locals: Set<string>
  /** the subset bound as a FORMAL PARAMETER (an untyped receiver that is a parameter is its own class) */
  params: Set<string>
  /** the subset bound by a catch clause / for-in target */
  catches: Set<string>
  /** local binding -> module specifier, for every import form */
  imports: Map<string, string>
  /** namespace import bindings (`import * as ns`) */
  namespaces: Set<string>
  /** variable -> constructor leaf, for `const x = new Foo()` in this file */
  newTypes: Map<string, string>
  /** variable -> module specifier, for `const x = require('m')` in this file */
  requires: Map<string, string>
  classes: Set<string>
}

const EMPTY_BINDINGS: Bindings = {
  locals: new Set(), params: new Set(), catches: new Set(), imports: new Map(), namespaces: new Set(), newTypes: new Map(), requires: new Map(), classes: new Set(),
}

function collectPatternNames(node: any, out: Set<string>): void {
  if (!node) return
  const t = String(node.type ?? "")
  if (t === "identifier" || t === "shorthand_property_identifier_pattern") { out.add(node.text); return }
  if (t === "pair_pattern") {
    collectPatternNames(node.childForFieldName?.("value"), out)
    return
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) collectPatternNames(c, out)
  }
}

function collectFormalParams(node: any, out: Set<string>): void {
  if (!node) return
  // formal_parameters subtree: identifiers / assignment_pattern / rest_pattern / object + array patterns
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()!
    const t = String(n.type ?? "")
    if (t === "formal_parameters") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectPatternNames(c, out)
      }
      continue
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

function collectBindings(root: any): Bindings {
  const b: Bindings = {
    locals: new Set(), params: new Set(), catches: new Set(), imports: new Map(), namespaces: new Set(), newTypes: new Map(), requires: new Map(), classes: new Set(),
  }
  const visitParams = (n: any): void => {
    const params = n.childForFieldName?.("parameters")
    if (!params) return
    const found = new Set<string>()
    collectFormalParams({ namedChildCount: 1, namedChild: (i: number) => (i === 0 ? params : null), type: "formal_parameters" }, found)
    for (const name of found) { b.locals.add(name); b.params.add(name) }
  }
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    const t = String(n.type ?? "")
    if (t === "import_statement") {
      // import <clause> from <string>; clause shapes: identifier | namespace_import | named_imports
      let spec = ""
      const src = n.childForFieldName?.("source")
      if (src) spec = String(src.text ?? "").replace(/^['"`]|['"`]$/g, "")
      const walk = (m: any): void => {
        if (!m) return
        const mt = String(m.type ?? "")
        if (mt === "namespace_import") {
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (c && c.type === "identifier") { b.imports.set(c.text, spec); b.namespaces.add(c.text) }
          }
          return
        }
        if (mt === "import_specifier") {
          const alias = m.childForFieldName?.("alias")
          const nm = m.childForFieldName?.("name")
          const local = alias ?? nm
          if (local && local.type === "identifier") b.imports.set(local.text, spec)
          return
        }
        if (mt === "import_clause") {
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") b.imports.set(c.text, spec)
            else walk(c)
          }
          return
        }
        for (let i = 0; i < m.namedChildCount; i++) walk(m.namedChild(i))
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
      // fall through to descend (export_statement nesting imports is legal)
    } else if (t === "variable_declarator") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode) {
        if (nameNode.type === "identifier") b.locals.add(nameNode.text)
        else collectPatternNames(nameNode, b.locals)
      }
      const value = n.childForFieldName?.("value")
      if (nameNode && nameNode.type === "identifier" && value) {
        if (value.type === "new_expression") {
          const ctor = value.childForFieldName?.("constructor") ?? value.namedChild(0)
          let leaf = ""
          if (ctor?.type === "identifier") leaf = ctor.text
          else if (ctor?.type === "member_expression") {
            const prop = ctor.childForFieldName?.("property")
            leaf = prop ? prop.text : String(ctor.text ?? "")
          }
          if (leaf) b.newTypes.set(nameNode.text, leaf)
        } else if (value.type === "call_expression") {
          const fn = value.childForFieldName?.("function")
          if (fn && fn.type === "identifier" && fn.text === "require") {
            const args = value.childForFieldName?.("arguments")
            const arg0 = args?.namedChild?.(0) ?? args?.namedChild?.(args?.namedChildCount - 1)
            if (arg0 && arg0.type === "string") b.requires.set(nameNode.text, String(arg0.text ?? "").replace(/^['"`]|['"`]$/g, ""))
          }
        }
      }
    } else if (t === "function_declaration" || t === "function_expression" || t === "generator_function_declaration" ||
               t === "generator_function" || t === "arrow_function" || t === "method_definition") {
      visitParams(n)
    } else if (t === "catch_clause") {
      const p = n.childForFieldName?.("parameter")
      if (p) { const found = new Set<string>(); collectPatternNames(p, found); for (const name of found) { b.locals.add(name); b.catches.add(name) } }
    } else if (t === "arrow_function") {
      const single = n.childForFieldName?.("parameter")
      if (single && single.type === "identifier") { b.locals.add(single.text); b.params.add(single.text) }
      visitParams(n)
    } else if (t === "class_declaration") {
      const nm = n.childForFieldName?.("name")
      if (nm) b.classes.add(nm.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return b
}

// ============================================================================
// CAUSE CLASSIFICATION
// ============================================================================

/** Host/Node/test globals the analyzer's CITED list does NOT carry, kept in separate buckets so the
 *  difference between "claimable today" and "claimable only with a new citation" is visible. */
const NODE_GLOBALS = new Set([
  "process", "Buffer", "module", "exports", "require", "global", "__dirname", "__filename",
  "setImmediate", "clearImmediate", "TextDecoderStream", "performance",
])
const TEST_GLOBALS = new Set([
  "describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll", "jest", "vi",
  "assert", "should", "QUnit", "suite", "setup", "teardown", "mock", "spyOn", "fixture", "triggerEvent",
])

type Bucket = string

function bump(b: Map<string, number>, k: Bucket): void { b.set(k, (b.get(k) ?? 0) + 1) }

type EdgeRow = {
  label: string
  target: string
  source: string
  file: string
  repo: string
  line: number
  meta: any
}

/** the first identifier-ish token of a printed expression — the receiver ROOT of a callee chain */
function receiverRoot(expr: string): { root: string; ownerQualified: boolean } {
  let s = expr.trim()
  // strip wrapping parens
  while (s.startsWith("(")) s = s.slice(1).trim()
  if (s.startsWith("this")) return { root: "this", ownerQualified: false }
  if (s.startsWith("super")) return { root: "super", ownerQualified: false }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    const ok = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$" || ch === "#"
    if (!ok) break
    i++
  }
  return { root: s.slice(0, i), ownerQualified: s.slice(i).trimStart().startsWith(".") }
}

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || spec.startsWith(".")
}

function moduleOf(target: string): { module: string; item: string } {
  const at = target.lastIndexOf(":")
  if (at <= 0 || at === target.length - 1) return { module: target, item: "" }
  return { module: target.slice(0, at), item: target.slice(at + 1) }
}

/** candidate project-relative paths a relative specifier could name (the shapes the lane's seam resolves) */
function specifierCandidates(spec: string): string[] {
  const base = spec
  const out: string[] = [base]
  for (const ext of [".js", ".jsx", ".mjs", ".cjs"]) out.push(base + ext)
  for (const ext of ["/index.js", "/index.jsx", "/index.mjs", "/index.cjs"]) out.push(base + ext)
  return out
}

function classifyEdge(
  row: EdgeRow,
  proj: Proj,
  fileBindings: Bindings,
  fileRel: (abs: string) => string,
): Bucket {
  const { label, target, meta } = row
  // A CLAIM IS NOT A RESOLUTION (the gate's own rule): an edge the analyzer marked
  // `isExternalTarget` is counted in extOK, so this census reports it in its own bucket and
  // never inside a "needs work" class. The claim's stated reason travels with the count.
  if (meta?.isExternalTarget === true) {
    reconciled.claims++
    const reason = String(meta?.externalReason ?? "external")
    reconciled.claimsByReason.set(reason, (reconciled.claimsByReason.get(reason) ?? 0) + 1)
    if (label === "imports" && typeof meta?.externalSpecifier === "string") {
      // REPRODUCE THE ARBITER'S OWN CHECK for a module-namespace claim, so the census says which
      // claims verify (`extOK`) and which read "no check can reach" (`ext?`, which BLOCKS a pass):
      // the module ROOT is compared with the project's file stems and directory names.
      const spec = meta.externalSpecifier
      const root = spec.split(/[./\\]/)[0]
      const projectNames = new Set<string>()
      for (const f of proj.files) {
        const slash = f.lastIndexOf("/")
        const base = slash >= 0 ? f.slice(slash + 1) : f
        const dot = base.lastIndexOf(".")
        if (dot > 0) projectNames.add(base.slice(0, dot))
        if (slash > 0) {
          const dir = f.slice(0, slash)
          const d = dir.lastIndexOf("/")
          projectNames.add(d >= 0 ? dir.slice(d + 1) : dir)
        }
      }
      return projectNames.has(root)
        ? `CLAIMED-module-namespace PROJECT-ROOT (gate ext? — blocks pass)`
        : `CLAIMED-module-namespace (gate extOK)`
    }
    return `CLAIMED-${String(meta?.externalReason ?? "external")} (gate extOK)`
  }
  if (label === "calls") {
    const callee = typeof meta.calleeExpression === "string" ? meta.calleeExpression : target
    const bare = callee === target || !callee.includes(".")
    if (bare) {
      if (isHostGlobal(target)) return "CLAIM-HOST-BARE (cited list)"
      if (NODE_GLOBALS.has(target)) return "CLAIM-NODE-BARE (needs citation)"
      if (TEST_GLOBALS.has(target)) return "CLAIM-TEST-BARE (needs citation)"
      if (fileBindings.imports.has(target)) {
        const spec = fileBindings.imports.get(target)!
        return isRelativeSpecifier(spec) ? "IMPORT-BINDING-INTERNAL (seam)" : "IMPORT-BINDING-EXTERNAL (seam)"
      }
      if (fileBindings.locals.has(target) || fileBindings.requires.has(target)) return "BINDING-LOCAL"
      if (proj.memberOwners.has(target)) return "MEMBER-DECLARED-ELSEWHERE (receiver untyped)"
      return "NOTHING-ANYWHERE (out-of-corpus API)"
    }
    const { root } = receiverRoot(callee)
    const rootCitation = hostGlobalCitation(root)
    if (rootCitation) return "CLAIM-HOST-RECEIVER (memberChainClaim)"
    if (NODE_GLOBALS.has(root)) return "CLAIM-NODE-RECEIVER (needs citation)"
    if (TEST_GLOBALS.has(root)) return "CLAIM-TEST-RECEIVER (needs citation)"
    if (root === "this" || root === "super") {
      // A `this` INSIDE a class declaration is typed by position (the analyzer's owner channel
      // carries it, so such a row would have arrived with ownerEvidence "this"); a `this` in a
      // plain function is DYNAMIC, and no syntactic form states its type — that is the declared
      // wall, named separately so it is never read as a missing form.
      if (meta?.ownerEvidence === "this") {
        return proj.memberOwners.has(target)
          ? "THIS-RECEIVER-MEMBER-DECLARED (owner qualification)"
          : "THIS-RECEIVER-CLASS-MEMBER-UNDECLARED"
      }
      return "DYNAMIC-THIS-RECEIVER (declared wall: no stated type)"
    }
    const ctor = fileBindings.newTypes.get(root)
    if (ctor) {
      const owners = proj.memberOwners.get(target)
      if (owners && owners.size === 1) return "TYPED-RECEIVER-MEMBER-DECLARED (owner qualification)"
      if (owners && owners.size > 1) return "TYPED-RECEIVER-MEMBER-AMBIGUOUS-OWNER"
      return "TYPED-RECEIVER-MEMBER-UNDECLARED"
    }
    if (fileBindings.namespaces.has(root)) return "NAMESPACE-IMPORT-RECEIVER (import seam)"
    if (fileBindings.imports.has(root)) {
      const spec = fileBindings.imports.get(root)!
      return isRelativeSpecifier(spec) ? "IMPORT-RECEIVER-INTERNAL (seam)" : "IMPORT-RECEIVER-EXTERNAL (seam)"
    }
    if (fileBindings.requires.has(root)) return "REQUIRE-RECEIVER (external module unknown)"
    if (fileBindings.params.has(root)) return "UNTYPED-PARAMETER-RECEIVER (declared wall: no stated type)"
    if (fileBindings.catches.has(root)) return "CATCH-PARAM-RECEIVER (declared wall: no stated type)"
    if (fileBindings.locals.has(root)) return "UNTYPED-LOCAL-RECEIVER (declared wall: no stated type)"
    if (proj.classes.has(root)) {
      return proj.memberOwners.has(target)
        ? "STATIC-CLASS-RECEIVER-MEMBER-DECLARED (owner qualification)"
        : "STATIC-CLASS-RECEIVER-MEMBER-UNDECLARED"
    }
    if (isHostGlobal(root)) return "CLAIM-HOST-RECEIVER (cited list)"
    if (proj.names.has(root)) return "PROJECT-SYMBOL-RECEIVER (member not a declaration)"
    return callee.includes("(")
      ? "CALL-ROOTED-RECEIVER (receiver is a call result; declared wall)"
      : "UNKNOWN-RECEIVER-ROOT (out-of-corpus API)"
  }
  if (label === "uses") {
    const isBareRead = meta.bareRead === true
    const isCallReceiver = meta.callReceiver === true
    const isChainRoot = meta.chainRoot === true
    const isSegment = meta.isFieldAccess === true && !isBareRead && !isChainRoot
    if (isSegment) {
      if (isHostGlobal(target)) return "SEGMENT-HOST-NAME"
      if (proj.memberOwners.has(target)) return "SEGMENT-MEMBER-DECLARED (receiver untyped)"
      return "SEGMENT-NOTHING-ANYWHERE"
    }
    // bare reads, chain roots, call receivers, template interpolations all name an identifier
    if (isHostGlobal(target)) return "CLAIM-HOST-BARE (cited list)"
    if (NODE_GLOBALS.has(target)) return "CLAIM-NODE-BARE (needs citation)"
    if (TEST_GLOBALS.has(target)) return "CLAIM-TEST-BARE (needs citation)"
    if (fileBindings.imports.has(target)) {
      const spec = fileBindings.imports.get(target)!
      return isRelativeSpecifier(spec) ? "IMPORT-BINDING-INTERNAL (seam)" : "IMPORT-BINDING-EXTERNAL (seam)"
    }
    if (fileBindings.locals.has(target)) {
      return isCallReceiver ? "BINDING-LOCAL-CALL-RECEIVER" : "BINDING-LOCAL"
    }
    if (fileBindings.requires.has(target)) return "BINDING-REQUIRE"
    if (proj.memberOwners.has(target)) return "MEMBER-DECLARED-ELSEWHERE (receiver untyped)"
    return "NOTHING-ANYWHERE (out-of-corpus API)"
  }
  if (label === "imports") {
    const { module: mod, item } = moduleOf(target)
    if (isRelativeSpecifier(mod)) {
      // project file sets are REPO-relative; the row's rel path is CORPUS-relative, so the
      // repository prefix is removed before candidate resolution (a ../ join across the two
      // spaces produced false "missing" for every cross-directory relative import).
      const full = fileRel(row.file)
      const rel = full.startsWith(`${row.repo}/`) ? full.slice(row.repo.length + 1) : full
      const dir = path.posix.dirname(rel)
      const cands = specifierCandidates(mod)
      let found = false
      for (const c of cands) {
        const joined = path.posix.normalize(path.posix.join(dir, c))
        if (proj.files.has(joined)) { found = true; break }
      }
      return found
        ? `IMPORTS-INTERNAL-FILE-FOUND (${item === "*" ? "namespace" : "item"}; importProjectFile claim)`
        : "IMPORTS-INTERNAL-FILE-MISSING"
    }
    if (mod.includes("://")) return "IMPORTS-URL (needs citation)"
    if (mod.startsWith("@")) return "IMPORTS-SCOPED-PACKAGE (moduleNamespace claim)"
    if (mod.length > 0 && !mod.includes("/")) return "IMPORTS-PACKAGE (moduleNamespace claim)"
    if (mod.length > 0) return "IMPORTS-PACKAGE-SUBPATH (moduleNamespace claim, root decides)"
    return "IMPORTS-OTHER-SPECIFIER"
  }
  if (label === "exports") {
    if (target === "default") return "EXPORTS-DEFAULT-LITERAL"
    return "EXPORTS-UNRESOLVED-OTHER"
  }
  if (label === "extends") {
    if (isHostGlobal(target)) return "EXTENDS-HOST-CLASS (claimable)"
    if (fileBindings.imports.has(target)) return "EXTENDS-IMPORTED-BINDING (external module)"
    if (fileBindings.locals.has(target)) return "EXTENDS-LOCAL-BINDING"
    return "EXTENDS-NOTHING-ANYWHERE"
  }
  if (label === "references") {
    if (isHostGlobal(target)) return "REFS-HOST-CLASS (claimable)"
    if (fileBindings.imports.has(target)) return "REFS-IMPORTED-BINDING"
    if (fileBindings.locals.has(target)) return "REFS-LOCAL-BINDING"
    if (proj.memberOwners.has(target)) return "REFS-MEMBER-ELSEWHERE"
    return "REFS-NOTHING-ANYWHERE"
  }
  if (label === "instantiates") {
    if (fileBindings.imports.has(target)) return "NEW-IMPORTED-BINDING (external module)"
    if (fileBindings.locals.has(target)) return "NEW-LOCAL-BINDING"
    return "NEW-NOTHING-ANYWHERE"
  }
  if (label === "decorates") {
    if (fileBindings.imports.has(target)) {
      const spec = fileBindings.imports.get(target)!
      return isRelativeSpecifier(spec) ? "DECORATES-IMPORTED-INTERNAL (seam)" : "DECORATES-IMPORTED-EXTERNAL (seam)"
    }
    if (fileBindings.locals.has(target) || fileBindings.requires.has(target)) return "DECORATES-LOCAL-BINDING"
    if (proj.memberOwners.has(target)) return "DECORATES-MEMBER-ELSEWHERE"
    return "DECORATES-NOTHING-ANYWHERE (out-of-corpus API)"
  }
  if (label === "renders") {
    if (fileBindings.imports.has(target)) {
      const spec = fileBindings.imports.get(target)!
      return isRelativeSpecifier(spec) ? "RENDERS-IMPORTED-INTERNAL (seam)" : "RENDERS-IMPORTED-EXTERNAL (seam)"
    }
    if (fileBindings.locals.has(target) || fileBindings.requires.has(target)) return "RENDERS-LOCAL-BINDING"
    if (proj.memberOwners.has(target)) return "RENDERS-MEMBER-ELSEWHERE"
    return "RENDERS-NOTHING-ANYWHERE (out-of-corpus API)"
  }
  if (label === "overrides") {
    return "OVERRIDES-AMBIGUOUS-BASE"
  }
  return "UNCLASSIFIED"
}

// ============================================================================
// MAIN
// ============================================================================

const { files, total, repos } = discover()
// NO HELD PARSER: engine.getParser caches instances and its cleanup can dispose one mid-run; a
// held wasm Parser then returns "Out of bounds memory access" on its next parse (measured: 1,198
// of 2,000 files skipped in the first cap-0 stream attempt at ~499). Acquired per file below;
// the engine cache makes that cheap. Kept here only as a ready-guard so a missing grammar fails
// before the walk, not on file 1.
await getParser("javascript" as any)
const projects = new Map<string, Proj>()
const fileBindings = new Map<string, Bindings>()
const relByAbs = new Map<string, string>()
const repoByAbs = new Map<string, string>()
for (const abs of files) {
  const rel = abs.startsWith(CR) ? abs.slice(CR.length + 1) : abs
  relByAbs.set(abs, rel)
  const repo = rel.split(path.sep)[0]
  repoByAbs.set(abs, repo)
  // project file set = the WHOLE admitted project (discovery already knows the unsampled list only
  // for the file it returns; for the cap case a project's file set is a subset and the classifier says
  // so in its header — a file-found test under a sample is a LOWER bound, never an upper one).
}
// The admitted list is re-derived unsampled so relative-import file tests are about the PROJECT, not the
// sample. Cost is one git ls-files per repo already paid above; only paths are retained.
{
  const sampled = new Set(files)
  const sampledRepos = new Set([...sampled].map((f) => repoByAbs.get(f)!))
  for (const name of repoNames()) {
    if (!sampledRepos.has(name)) continue
    const dir = path.join(CR, name)
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    const p = projOf(name, projects)
    for (const rel of tracked) {
      if (!admit(rel)) continue
      const abs = path.join(dir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      p.files.add(rel.split(path.sep).join("/"))
      for (const ext of [".js", ".jsx", ".mjs", ".cjs"]) {
        if (rel.endsWith(ext)) { p.moduleNames.add(path.basename(rel, ext)); break }
      }
    }
  }
  void sampled
}

// ---- resolve, then classify the non-resolved ----
const totals: Record<string, { edges: number; resolved: number; unresolved: number; emptyTarget?: number; declsOne?: number; declsMany?: number }> = {}
// GATE-RECONCILED SPLIT. The gate's verdict has THREE declaration classes and this census must be
// comparable to it: decls===1 is the gate's `resolved`, decls>1 is its `amb(decl)`, decls===0 is its
// `unresolved`. The census's own `resolved` above deliberately counts decls>=1 (it is used to find
// the non-resolved population); the two extra counters are what reconcile the two instruments.
const reconciled = { resolvedUnique: 0, ambiguous: 0, unresolved: 0, claims: 0, claimsByReason: new Map<string, number>() }
// OWNER COVERAGE — the store channel `metadata.owner` + the evidence class in
// `metadata.ownerEvidence` ({new, assignment, this, jsdoc}). Counted here, and NEVER reported
// as resolved: the arbiter resolves targets, not owners; this is production-resolution metadata.
type Cov = {
  edges: number
  memberReceiverCalls: number
  withOwner: number
  byEvidence: Map<string, number>
  unresolvedWithOwner: number
  unresolvedByEvidence: Map<string, number>
  usesEdges: number
  usesWithOwner: number
  usesUnresolvedWithOwner: number
  usesByEvidence: Map<string, number>
}
const coverage = new Map<string, Cov>()
const buckets: Record<string, Map<Bucket, number>> = {}
/** decls>1 buckets, kept SEPARATE from the decls===0 buckets so the two classes never merge */
const ambBuckets: Record<string, Map<Bucket, number>> = {}
const examples: Record<string, Record<string, string[]>> = {}
let heldAmbiguous = 0
let edgeCount = 0

const rows: EdgeRow[] = []
let filesParsed = 0
let filesSkipped = 0
/** why files were skipped — a mass skip must say its cause, not just its count */
const skipReasons = new Map<string, number>()
const noteSkip = (e: unknown): void => {
  const msg = String((e as any)?.message ?? e ?? "unknown").slice(0, 120)
  skipReasons.set(msg, (skipReasons.get(msg) ?? 0) + 1)
}

function ingestRow(r: EdgeRow): void {
  edgeCount++

  const p = projOf(r.repo, projects)
  let cov = coverage.get(r.label)
  if (!cov) {
    cov = { edges: 0, memberReceiverCalls: 0, withOwner: 0, byEvidence: new Map(), unresolvedWithOwner: 0, unresolvedByEvidence: new Map(), usesEdges: 0, usesWithOwner: 0, usesUnresolvedWithOwner: 0, usesByEvidence: new Map() }
    coverage.set(r.label, cov)
  }
  const ownerValue = typeof r.meta?.owner === "string" ? r.meta.owner : ""
  const evidenceValue = typeof r.meta?.ownerEvidence === "string" ? r.meta.ownerEvidence : "(none)"
  if (!totals[r.label]) { totals[r.label] = { edges: 0, resolved: 0, unresolved: 0, emptyTarget: 0 }; buckets[r.label] = new Map() }
  totals[r.label].edges++
  if (r.label === "calls") {
    cov.edges++
    const callee = typeof r.meta?.calleeExpression === "string" ? r.meta.calleeExpression : ""
    if (callee.length > 0 && callee !== r.target) cov.memberReceiverCalls++
    if (ownerValue.length > 0) {
      cov.withOwner++
      cov.byEvidence.set(evidenceValue, (cov.byEvidence.get(evidenceValue) ?? 0) + 1)
    }
  } else if (r.label === "uses") {
    cov.usesEdges++
    if (ownerValue.length > 0) {
      cov.usesWithOwner++
      cov.usesByEvidence.set(evidenceValue, (cov.usesByEvidence.get(evidenceValue) ?? 0) + 1)
    }
  }
  if (r.target.length === 0) {
    totals[r.label].emptyTarget = (totals[r.label].emptyTarget ?? 0) + 1
    totals[r.label].unresolved++
    bump(buckets[r.label], "EMPTY-TARGET")
    return
  }
  const decls = (p.names.get(r.target) ?? 0) + (p.quals.get(r.target) ?? 0)
  if (decls === 1) { totals[r.label].declsOne = (totals[r.label].declsOne ?? 0) + 1; reconciled.resolvedUnique++ }
  else if (decls > 1) { totals[r.label].declsMany = (totals[r.label].declsMany ?? 0) + 1; reconciled.ambiguous++ }
  else reconciled.unresolved++
  if (decls >= 1) {
    totals[r.label].resolved++
    if (decls > 1) {
      heldAmbiguous++
      // A COLLISION IS NOT A RESOLUTION. Name its composition with the same cause rules, in its
      // own bucket map, so D3's "every edge in a declared class" covers the amb(decl) column too.
      const b = fileBindings.get(r.file) ?? EMPTY_BINDINGS
      if (!ambBuckets[r.label]) ambBuckets[r.label] = new Map()
      bump(ambBuckets[r.label], classifyEdge(r, p, b, (abs) => relByAbs.get(abs) ?? abs))
    }
    return
  }
  totals[r.label].unresolved++
  if (r.label === "calls" && ownerValue.length > 0) {
    cov.unresolvedWithOwner++
    cov.unresolvedByEvidence.set(evidenceValue, (cov.unresolvedByEvidence.get(evidenceValue) ?? 0) + 1)
  } else if (r.label === "uses" && ownerValue.length > 0) {
    cov.usesUnresolvedWithOwner++
  }
  const b = fileBindings.get(r.file) ?? EMPTY_BINDINGS
  const bucket = classifyEdge(r, p, b, (abs) => relByAbs.get(abs) ?? abs)
  bump(buckets[r.label], bucket)
  const ex = examples[r.label] ?? (examples[r.label] = {})
  const list = ex[bucket] ?? (ex[bucket] = [])
  if (list.length < 4) list.push(`${relByAbs.get(r.file) ?? r.file}:${r.line} ${r.source} -> ${r.target} ${r.meta?.calleeExpression ? `[callee=${r.meta.calleeExpression}]` : ""}`)

}

if (!STREAM) {
  for (const abs of files) {
    let content = ""
    try { content = readFileSync(abs, "utf8") } catch (e) { filesSkipped++; noteSkip(e); continue }
    let res: any
    let b: Bindings = EMPTY_BINDINGS
    try {
      res = await parseFile(abs, repoByAbs.get(abs)!.length > 0 ? path.join(CR, repoByAbs.get(abs)!) : CR, { projectRoot: path.join(CR, repoByAbs.get(abs)!) } as any)
      const fileParser: any = await getParser("javascript" as any)
      const tree = fileParser.parse(content)
      b = collectBindings(tree.rootNode)
      tree.delete?.()
    } catch (e) { filesSkipped++; noteSkip(e); continue }
    filesParsed++
    const repo = repoByAbs.get(abs)!
    const p = projOf(repo, projects)
    for (const s of res?.symbols ?? []) addSymbol(p, s)
    fileBindings.set(abs, b)
    for (const r of res?.relationships ?? []) {
      const label = String(r?.type ?? r?.relationshipType ?? "")
      if (!label) continue
      const md = (r?.metadata ?? {}) as any
      const compact: any = {}
      for (const k of COMPACT_META_KEYS) if (md[k] !== undefined) compact[k] = md[k]
      rows.push({
        label,
        target: String(r?.target ?? r?.to ?? r?.toSymbol ?? ""),
        source: String(r?.source ?? r?.from ?? ""),
        file: abs,
        repo,
        line: Number(r?.line_number ?? 0),
        meta: compact,
      })
    }
  }
  for (const r of rows) ingestRow(r)
} else {
  // PHASE A — one walk: tables + bindings in memory, edges spilled compact.
  const fd = openSync(EDGE_SPILL, "w")
  try {
    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const abs = files[fileIdx]
      let content = ""
      try { content = readFileSync(abs, "utf8") } catch (e) { filesSkipped++; noteSkip(e); continue }
      let res: any
      let b: Bindings = EMPTY_BINDINGS
      try {
        res = await parseFile(abs, repoByAbs.get(abs)!.length > 0 ? path.join(CR, repoByAbs.get(abs)!) : CR, { projectRoot: path.join(CR, repoByAbs.get(abs)!) } as any)
        const fileParser: any = await getParser("javascript" as any)
        const tree = fileParser.parse(content)
        b = collectBindings(tree.rootNode)
        tree.delete?.()
      } catch (e) { filesSkipped++; noteSkip(e); continue }
      filesParsed++
      const repo = repoByAbs.get(abs)!
      const p = projOf(repo, projects)
      for (const s of res?.symbols ?? []) addSymbol(p, s)
      fileBindings.set(abs, b)
      for (const r of res?.relationships ?? []) {
        const label = String(r?.type ?? r?.relationshipType ?? "")
        if (!label) continue
        const md = (r?.metadata ?? {}) as any
        const compact: any = {}
        for (const k of COMPACT_META_KEYS) if (md[k] !== undefined) compact[k] = md[k]
        writeSync(fd, JSON.stringify({
          f: fileIdx, l: label,
          t: String(r?.target ?? r?.to ?? r?.toSymbol ?? ""),
          s: String(r?.source ?? r?.from ?? ""),
          n: Number(r?.line_number ?? 0),
          m: compact,
        }) + "\n")
      }
    }
  } finally {
    closeSync(fd)
  }
  // PHASE B — stream the spill back, one edge at a time.
  const rl = createInterface({ input: createReadStream(EDGE_SPILL), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.length === 0) continue
    const e = JSON.parse(line) as { f: number; l: string; t: string; s: string; n: number; m: any }
    const abs = files[e.f]
    ingestRow({ label: e.l, target: e.t, source: e.s, file: abs, repo: repoByAbs.get(abs)!, line: e.n, meta: e.m })
  }
}

const report = {
  command: `bun run script/m14/js-resolution-classify.ts ${CAP}`,
  corpusRoot: CR,
  population: { cap: CAP, sampledFiles: files.length, totalAdmitted: total, repos, filesParsed, filesSkipped },
  note: "Same population rule and per-project key space (name + genuine qualifiedName) as incoming-gate.ts TABLE 1. Ambiguous edges (target names >1 declaration) are counted in `resolved` only for the unresolved census; the total ambiguous count is reported separately.",
  totals,
  ambiguousAmongResolved: heldAmbiguous,
  buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, [...v.entries()].sort((a, b) => b[1] - a[1])])),
  ambiguousBuckets: Object.fromEntries(Object.entries(ambBuckets).map(([k, v]) => [k, [...v.entries()].sort((a, b) => b[1] - a[1])])),
  examples,
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 1))

const labelOrder = Object.keys(totals).sort()
console.log(`js-resolution-classify — population: ${files.length} of ${total} admitted files across ${repos} repos (cap ${CAP})`)
console.log(`command: bun run script/m14/js-resolution-classify.ts ${CAP}${STREAM ? " --stream" : ""}`)
if (skipReasons.size > 0) console.log(`skip reasons: ${[...skipReasons.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}x ${m}`).join(" | ")}`)
console.log(`files parsed ${filesParsed} · skipped ${filesSkipped} · edges ${edgeCount} · ambiguous-among-resolved ${heldAmbiguous}${STREAM ? " · mode=stream" : ""}`)
for (const label of labelOrder) {
  const t = totals[label]
  const b = buckets[label]
  console.log(`\n=== ${label} — ${t.unresolved} unresolved of ${t.edges} edges (${t.resolved} resolved) ===`)
  for (const [k, n] of [...b.entries()].sort((a, c) => c[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${k}`)
    for (const e of examples[label]?.[k] ?? []) console.log(`             e.g. ${e}`)
  }
}
// reconciliation: the gate's columns, restored from this census's own buckets
for (const label of labelOrder) {
  const b = buckets[label]
  const claimed = [...b.entries()].filter(([k]) => k.startsWith("CLAIMED-")).reduce((a, [, n]) => a + n, 0)
  if (claimed > 0) console.log(`\n${label}: ${claimed} edge(s) carry an EXTERNAL CLAIM (gate extOK column) — not resolved, not merged`)
}
console.log("\n=== GATE-RECONCILED SPLIT (decls===1 · decls>1 · decls===0) ===")
console.log(`edges ${edgeCount} · resolved-unique ${reconciled.resolvedUnique} · ambiguous ${reconciled.ambiguous} · unresolved ${reconciled.unresolved}`)
console.log(`claims ${reconciled.claims} by reason: ${[...reconciled.claimsByReason.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" · ") || "(none)"}`)
console.log("NOTE: this census parses with RealJavaScriptAnalyzer via parseFile, so a pool-worker")
console.log("      identifier-sanitizer row is absent here and present in the gate; the difference is")
console.log("      printed above as the edge total and MUST be quoted beside the gate's 1,467,637.")
console.log("\n=== RECEIVER-TYPE COVERAGE (metadata.owner + ownerEvidence; METADATA, never a resolution claim) ===")
for (const [label, c] of [...coverage.entries()].sort()) {
  if (label === "calls") {
    console.log(`calls: ${c.edges} edges · ${c.memberReceiverCalls} member-receiver calls · ${c.withOwner} carry metadata.owner (${pct(c.withOwner, c.memberReceiverCalls)} of member-receiver calls)`)
    for (const [ev, n] of [...c.byEvidence.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ownerEvidence=${ev}: ${n}`)
    console.log(`   of the UNRESOLVED calls: ${c.unresolvedWithOwner} carry an owner (the store channel can act on them; the gate's resolved column does not move)`)
    for (const [ev, n] of [...c.unresolvedByEvidence.entries()].sort((a, b) => b[1] - a[1])) console.log(`      unresolved ownerEvidence=${ev}: ${n}`)
  } else if (label === "uses") {
    console.log(`uses: ${c.usesEdges} edges · ${c.usesWithOwner} carry metadata.owner (${pct(c.usesWithOwner, c.usesEdges)} of all uses); ${c.usesUnresolvedWithOwner} of them unresolved`)
    for (const [ev, n] of [...c.usesByEvidence.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ownerEvidence=${ev}: ${n}`)
  }
}
function pct(n: number, d: number): string {
  if (d === 0) return "n/a"
  return `${((n * 100) / d).toFixed(1)}%`
}

console.log("\n=== AMBIGUOUS-EDGE COMPOSITION (decls>1; a collision is not a resolution — D3 class) ===")
for (const label of Object.keys(ambBuckets).sort()) {
  const total = [...ambBuckets[label].values()].reduce((a, b) => a + b, 0)
  console.log(`\n--- ${label}: ${total} ambiguous edge(s) with a named composition`)
  for (const [k, n] of [...ambBuckets[label].entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${k}`)
  }
}
if (JSON_OUT) console.log(`\njson: ${JSON_OUT}`)
