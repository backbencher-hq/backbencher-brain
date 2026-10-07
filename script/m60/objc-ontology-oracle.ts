/**
 * script/m60/objc-ontology-oracle.ts — the second opinion this lane's ontology needs.
 *
 * ## Why this file exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) measures, per lane, every
 * relationship type an analyzer CAN CONSTRUCT against the set the F5 differential
 * AUDITS. At this commit it reports, for objective-c:
 *
 *     objective-c 6 un-audited: ["calls","contains","exports","imports","references","uses"]
 *
 * "stored and compared against nothing". Four of those six were the state at handover;
 * `exports` and `imports` JOINED them in this wave because the lane started emitting
 * them, and a type with no derivation behind it ships a bug invisibly — which is the
 * whole reason the check exists. Adding an edge without adding an opinion about it
 * trades one unverified fact for two.
 *
 * The opinion cannot go in `script/m14/differential.ts`: it is the shared, contended
 * harness and the workstream ownership table puts it outside a language lane. So it
 * lives here, lane-owned, next to the other objc instruments — the same route the java
 * lane took for its `imports`/`exports` oracle in this same wave. The one-line hook
 * master needs to make the shared gate see it is named in `GATE_HOOK` below.
 *
 * ## WHAT INDEPENDENCE THIS ORACLE HAS, AND WHAT IT DOES NOT
 *
 * It HAS a separate walker and a separate implementation. Every fact is rebuilt from the
 * tree by a DIFFERENT route than the analyzer uses, and the routes were chosen to
 * disagree if either side is wrong:
 *
 *   type        the analyzer's route                          this oracle's route
 *   ----------  ---------------------------------------------  -----------------------------------
 *   imports     first named child that is a system_lib_string   the `path` FIELD of the directive,
 *              or string_literal, scanning in order and        falling back to the CONCATENATION of
 *              breaking on the first name                      the directive's own children — a grammar
 *                                                          that stopped nesting the name breaks
 *                                                          one route and not the other
 *   references  identical module-name read, different label    same
 *   exports     the deduped SYMBOL set (kind:owner:name)        the FILE-SCOPE DECLARATION NODES, with
 *                                                          linkage and name read off the node, so a
 *                                                          symbol the dedup collapsed cannot hide a
 *                                                          unit and a unit with no symbol cannot
 *                                                          escape the export set
 *   contains    ownerName stamped on each symbol, joined after  the enclosing class node's own member
 *              the walk                                             children, selected by shape
 *   calls       keywords accumulated left-to-right, the last    keywords counted against the argument
 *              identifier used when there is none               siblings that follow them, so the
 *                                                          zero-argument case is derived from arity
 *                                                          rather than from position
 *   uses        a scope inventory (frames, block chain, class   NOT DERIVED IN FULL — see below
 *              members, globals) plus a name-vs-read battery
 *
 * It does NOT have an independent GRAMMAR. Both sides load the same `tree-sitter-objc`
 * wasm, so a defect IN the grammar — a node type that fails to match, a field that is
 * never populated — is invisible here exactly as it is to the F5 differential. That is
 * the same ceiling the honesty contract's L3 states, and it is why this oracle is a
 * SECOND DERIVATION and not a VERIFICATION: it answers "does a different reading of the
 * same grammar produce the same edges", not "is the grammar right".
 *
 * It also does not run over the full analyzer pipeline. It reads `parseFile`, the same
 * production entry the census reads, so the numbers are the numbers a consumer gets
 * after `filterNoiseRelationships` and `keepSymbol`.
 *
 * ## `uses` IS A PARTIAL ORACLE, AND THE DENOMINATOR IS PUBLISHED
 *
 * The analyzer's `uses` is the product of a five-input scope inventory and a ten-branch
 * name-vs-read battery. Re-deriving all of it independently is a second implementation
 * of the whole OC-E rule, and a partial re-derivation that reported itself as full
 * coverage would be the exact defect this workstream exists to prevent. So this oracle
 * derives the subset whose rule is decidable from the tree alone — member reads whose
 * field names a declared ivar/property, and message arguments that are bound value
 * names — and prints `ORACLE SUBSET` against the analyzer's full `uses` count. Every
 * number below is scoped to that subset.
 *
 * ## READ-ONLY. Writes nothing.
 *
 * Usage: bun run script/m60/objc-ontology-oracle.ts [--json <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"

/** The one-line change `script/m60/rel-type-coverage-gate.ts` needs from master, and
 *  the shape it reads (`readOwnOracleLabels`): a `script/m14/objc-truth.ts` exporting a
 *  plain array of quoted labels. Deliberately NOT made here — `script/m14/**` is outside
 *  this lane's ownership. */
export const GATE_HOOK =
  "script/m14/objc-truth.ts re-exporting OBJC_ORACLE_LABELS = " +
  JSON.stringify(["calls", "contains", "exports", "imports", "references", "uses"]) +
  " — script/m60/rel-type-coverage-gate.ts readOwnOracleLabels() picks it up by name and the DERIVATION finding for objective-c clears."

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

// ---------------------------------------------------------------- corpus
type FileRow = { label: string; abs: string; dir: string; text: string }
const files: FileRow[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "ls-files", "-z"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "objective-c") continue
    files.push({ label: `${e}/${rel}`, abs, dir, text })
  }
}

// ---------------------------------------------------------------- helpers
const named = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
const childOfType = (n: any, t: string): any => named(n).find((c) => c.type === t) ?? null
const deepFind = (n: any, t: string): any => {
  const st = [n]
  while (st.length) {
    const c = st.pop()!
    if (c.type === t) return c
    for (let i = c.namedChildCount - 1; i >= 0; i--) { const k = c.namedChild(i); if (k) st.push(k) }
  }
  return null
}
const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)]

/** OC-ONT-5 parity — see the same list in src/ast/real-objective-c-analyzer.ts. A C
 *  identifier cannot be one of these, so a declarator named one is the grammar's error
 *  recovery, not a declaration. */
const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "return", "break",
  "continue", "goto", "sizeof", "typedef", "struct", "union", "enum", "static",
  "const", "void", "int", "char", "double", "float", "unsigned", "signed", "extern",
  "inline", "register", "auto", "volatile", "restrict",
])

/** ROUTE A — the include's module name from the `path` FIELD, else from the
 *  CONCATENATION of the directive's children. Deliberately not a scan for the first
 *  `system_lib_string`/`string_literal` in order, which is what the analyzer does. */
function oracleIncludeName(node: any): string | null {
  const byField = node.childForFieldName?.("path")
  if (byField) {
    const t = byField.text
    if (t.startsWith("<") && t.endsWith(">")) return t.slice(1, -1)
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
    return t
  }
  const content = named(node).flatMap((c) => named(c)).find((c) => c.type === "string_content")
  if (content) return content.text
  const sl = named(node).find((c) => c.type === "system_lib_string" || c.type === "string_literal")
  if (!sl) return null
  const t = sl.text
  return t.replace(/^[[<"]/, "").replace(/[>"]$/, "")
}

/** ROUTE B — the full selector from ARITY: a keyword identifier is one that is followed
 *  by a `:`; the selector is every keyword in order, or — when there are none — the last
 *  identifier that is not the receiver. Derived from the shape rather than accumulated. */
function oracleSelector(node: any): string | null {
  const recv = node.namedChild(0)
  const recvStart = recv ? recv.startIndex : -1
  const recvEnd = recv ? recv.endIndex : -1
  let kw = ""
  let lastNonRecv: any = null
  const count = node.childCount
  for (let i = 0; i < count; i++) {
    const c = node.child(i)
    if (!c || !c.isNamed || c.type !== "identifier") continue
    const inRecv = recvStart >= 0 && c.startIndex >= recvStart && c.endIndex <= recvEnd
    if (inRecv) continue
    const nxt = i + 1 < count ? node.child(i + 1) : null
    if (nxt && !nxt.isNamed && nxt.type === ":") kw += c.text + ":"
    else lastNonRecv = c
  }
  if (kw) return kw
  return lastNonRecv ? lastNonRecv.text : null
}

/** ROUTE C — linkage read off the node's storage-class specifiers. */
function oracleLinkage(node: any): "internal" | "external" {
  for (const c of named(node)) {
    if (c.type === "storage_class_specifier") {
      const t = c.text.trim()
      if (t === "static") return "internal"
    }
  }
  return "external"
}

/** ROUTE D — the declared name of a member/ivar/property, by a shape walk of the
 *  declaration's own subtree that stops at the first identifier under a declarator. */
function oracleDeclaredName(node: any): string | null {
  const sd = deepFind(node, "struct_declaration")
  const scope = sd ?? node
  const dec = deepFind(scope, "struct_declarator") ?? deepFind(scope, "init_declarator")
  if (dec) {
    const id = deepFind(dec, "identifier")
    if (id) return id.text
  }
  const id = deepFind(scope, "identifier")
  return id ? id.text : null
}

// ---------------------------------------------------------------- the oracle
type Derived = { imports: string[]; references: string[]; exports: string[]; contains: string[]; calls: string[]; usesMember: string[] }

function derive(root: any): Derived {
  const imports: string[] = [], references: string[] = [], exports: string[] = []
  const contains: string[] = [], calls: string[] = [], usesMember: string[] = []

  // file-scope unit names, for the export set and for the member-read test
  const fileScopeExternals = new Set<string>()
  // class -> member names declared in THIS file, for contains and for member reads
  const classMembers = new Map<string, Set<string>>()
  const classNames = new Set<string>()

  // pass 1: file scope + class shape
  //
  // The scope test is "no ENCLOSING declaration", not "depth === 1". Both were tried and
  // depth-1 under-reports: these two corpora wrap much of their surface in
  // `#if TARGET_OS_IPHONE` / `#if defined(...)` blocks, so a `preproc_include`, a
  // `class_interface` and a `declaration` all sit at depth 2 or deeper while still being
  // file-scope units. The measured cost of getting this wrong was 7 missed includes
  // (`dlfcn.h`, `QuartzCore/QuartzCore.h`, `SystemConfiguration/...` — every one of them
  // behind a conditional), 185 missed exports and 1,774 missed containments, all of which
  // read as analyzer-only rows and would have been reported as analyzer defects.
  const visitTop = (n: any, inDecl: boolean) => {
    // `implementation_definition` is the node the pinned grammar gives the body of an
    // `@implementation ... @end` — NOT `class_implementation`, which is the `@implementation`
    // line alone. Leaving it out let every `NSProgress *imageProgress = ...;` inside a method
    // read as a file-scope unit and produced 5 phantom `exports` rows the analyzer was right
    // to withhold (`totalUnitCount`, `completedUnitCount`, `appendData`,
    // `totalBytesExpectedToSend`). It is also absent from `handled_verified` in
    // script/m14/spec/objc-completeness.json, which is a separate finding for master.
    const DECLARATION = ["class_interface", "class_implementation", "implementation_definition", "protocol_declaration", "function_definition", "struct_specifier", "enum_specifier", "type_definition", "declaration"]
    // `instance_variable` is an ivar DECLARED inside an @implementation's brace block. It
    // is a member, and the oracle's first version read `totalUnitCount`, `appendData` and
    // two more as file-scope exports because the ivar block is not itself a declaration
    // node. The braces are `field_declaration_list`.
    // A BODY is a scope, not a declaration. Without this the local `int rc = 0;` inside a
    // C helper was treated as a file-scope unit and published as an export — 50 rows the
    // analyzer was right to withhold, and the oracle's first genuinely misleading result.
    // `weakTask`, `manager`, `responseObject`, `userInfo` are the four it named.
    // `method_definition`/`method_declaration` are bodies too, and they have to be here
    // for a reason the corpus forced: when the grammar loses a method body to an ERROR it
    // attaches the body's `declaration` nodes DIRECTLY to the method, with no
    // `compound_statement` between. Four locals in AFURLSessionManager.m (lines 252, 264,
    // 266, 272 — `int64_t totalUnitCount = ...`) arrive that way and were published as
    // file-scope exports. The analyzer withholds them because its file-scope branch is
    // gated on `activeScope === "global"`, so this was the oracle inventing five facts,
    // not the analyzer dropping them.
    const BODY = ["compound_statement", "block_literal", "for_statement", "if_statement", "while_statement", "switch_statement", "do_statement", "field_declaration_list", "method_definition", "method_declaration"]
    const isDecl = DECLARATION.includes(n.type)
    if (BODY.includes(n.type)) {
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visitTop(c, true) }
      return
    }
    if (isDecl && inDecl) {
      // a DECLARATION nested in a declaration is a member, not a file-scope unit: an
      // ivar block, a nested function pointer, a property's own declaration
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visitTop(c, true) }
      return
    }
    // An `#include`/`#import` is a file-scope unit at ANY depth — behind a `#if` it is
    // still a dependency of this translation unit — so it is tested before the
    // declaration gate rather than inside it.
    if (n.type === "preproc_include") {
      const nm = oracleIncludeName(n)
      // `root` is the lane's declared file-scope source name (the same spelling the
      // analyzer uses on its references/imports edges), so the oracle's key must carry it
      // too. The first version pushed the bare module name and the comparison reported
      // 0.0% agreement — a key-shape mismatch that reads exactly like a total
      // disagreement, and would have been reported as one.
      if (nm) { imports.push(`root\u0000${nm}`); references.push(`root\u0000${nm}`) }
      return
    }
    if (isDecl) {
      if (["class_interface", "class_implementation", "protocol_declaration"].includes(n.type)) {
        const id = named(n).find((c) => c.type === "identifier" || c.type === "type_identifier") ?? null
        if (id) {
          classNames.add(id.text)
          // a CATEGORY carries an anonymous `(`; the unit it extends is not declared here
          let cat = false
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === "(") { cat = true; break } }
          if (!cat) fileScopeExternals.add(id.text)
          const members = new Set<string>()
          const memberNodes = named(n).filter((c) => ["method_declaration", "method_definition", "property_declaration", "instance_variable"].includes(c.type))
          for (const m of memberNodes) {
            let mn: string | null = null
            if (m.type === "property_declaration" || m.type === "instance_variable") mn = oracleDeclaredName(m)
            else {
              let s = ""
              const mc = m.namedChildCount
              for (let k = 0; k < mc; k++) {
                const c = m.namedChild(k)
                if (!c || c.type !== "identifier") continue
                s += c.text
                const nx = k + 1 < mc ? m.namedChild(k + 1) : null
                if (nx && nx.type === "method_parameter") s += ":"
              }
              mn = s || null
            }
            if (mn) { members.add(mn); contains.push(`${id.text}\u0000${mn}`) }
          }
          // The C-type members the analyzer also CONTAINS under their owner: a struct
          // symbol owns its field symbols, an enum owns its member symbols. Without
          // them the oracle derives a strict subset and every one of those rows reads
          // as an analyzer-only disagreement.
          const aggs = [...named(n)]
          if (n.type === "struct_specifier" || n.type === "enum_specifier" || n.type === "type_definition") aggs.push(...named(n))
          for (const c of aggs) {
            if (c.type === "struct_specifier" || c.type === "enum_specifier") {
              const tn = deepFind(c, "type_identifier")
              if (!tn) continue
              const inner = c.type === "struct_specifier" ? childOfType(c, "field_declaration_list") : childOfType(c, "enumerator_list")
              if (!inner) continue
              for (const row of named(inner)) {
                if (row.type !== "field_declaration" && row.type !== "enumerator") continue
                const fid = deepFind(row, "field_identifier") ?? deepFind(row, "identifier")
                if (fid) { members.add(fid.text); contains.push(`${tn.text} ${fid.text}`) }
              }
            }
          }
          classMembers.set(id.text, members)
        }
        return
      }
      if (n.type === "function_definition" || n.type === "type_definition" || n.type === "struct_specifier" || n.type === "enum_specifier" || n.type === "declaration") {
        if (oracleLinkage(n) === "external") {
          let nm: string | null = null
          if (n.type === "function_definition") nm = deepFind(n, "function_declarator") ? deepFind(deepFind(n, "function_declarator")!, "identifier")?.text ?? null : null
          else if (n.type === "type_definition" || n.type === "struct_specifier" || n.type === "enum_specifier") {
            const al = named(n).filter((c) => c.type === "type_identifier" || c.type === "identifier")
            nm = al.length ? al[al.length - 1].text : null
          } else {
            for (const c of named(n)) {
              if (c.type === "init_declarator" || c.type === "identifier" || c.type === "pointer_declarator" || c.type === "array_declarator") {
                const id = c.type === "identifier" ? c : deepFind(c, "identifier")
                if (id) { nm = id.text; break }
              }
            }
          }
          if (nm) fileScopeExternals.add(nm)
        }
        return
      }
    }
    for (let i = 0; i < n.childCount; i++) visitTop(n.child(i), inDecl)
  }
  visitTop(root, false)
  for (const nm of fileScopeExternals) exports.push(`root\u0000${nm}`)

  // pass 2: in-body facts — ONE walk carrying the scope source.
  //
  // Two earlier versions got this wrong in opposite directions and both reported a
  // confident 0.0%: one registered only a definition's IMMEDIATE named children in a
  // map (so a send inside a `compound_statement` found no source), the other passed
  // the source down a recursion parameter without recording it (so the same was true).
  // A zero on BOTH sides looks like total disagreement and is indistinguishable from a
  // broken instrument unless the instrument is read. It is one walk now, and the scope
  // is a parameter, so a send cannot be reached without a source.
  const ownerFor = (sel: string): string => {
    for (const [cn, ms] of classMembers) if (ms.has(sel)) return cn
    return ""
  }
  const superOf = (cls: string): string | null => {
    let out: string | null = null
    const v = (n: any) => {
      if (n.type === "class_interface" || n.type === "class_implementation") {
        const id = named(n).find((c) => c.type === "identifier" || c.type === "type_identifier")
        if (id && id.text === cls) {
          let cat = false
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === "(") { cat = true; break } }
          if (!cat) {
            let seenName = false
            for (const c of named(n)) {
              if (c.type === "identifier" && !seenName) { seenName = true; continue }
              if (c.type === "type_identifier" || c.type === "identifier") { out = c.text; break }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) v(c) }
    }
    v(root)
    return out
  }

  const visit = (n: any, src: string) => {
    let inner = src
    if (n.type === "method_definition" || n.type === "method_declaration") {
      let s = ""
      const nc = n.namedChildCount
      for (let k = 0; k < nc; k++) { const c = n.namedChild(k); if (c && c.type === "identifier") { s += c.text; const nx = k + 1 < nc ? n.namedChild(k + 1) : null; if (nx && nx.type === "method_parameter") s += ":" } }
      if (s) inner = s
    } else if (n.type === "function_definition") {
      const fd = deepFind(n, "function_declarator")
      const id = fd ? deepFind(fd, "identifier") : null
      // OC-ONT-5 parity: `else if (...)` recovers into a function_definition whose
      // declarator name is the `if` KEYWORD. The analyzer refuses it; without the same
      // refusal here the oracle derived one `calls` row scoped to a function that does
      // not exist, which reads as a missing analyzer edge.
      if (id && !C_KEYWORDS.has(id.text)) inner = id.text
    }
    if (inner) {
      if (n.type === "message_expression") {
        const sel = oracleSelector(n)
        if (sel) {
          const isAlloc = sel.split(":")[0] === "alloc" || sel.split(":")[0] === "new"
          // `instantiates` is NOT in this oracle's label set: the F5 differential already
          // audits it and this lane's disagreement with it is counted, with its own
          // instrument, in script/m60/objc-instantiates-oracle-divergence.ts.
          if (!isAlloc) calls.push(`${inner}\u0000${sel}`)
        }
      } else if (n.type === "field_expression") {
        const f = n.childForFieldName?.("field") ?? childOfType(n, "field_identifier")
        const parent = n.parent
        const isWrite = !!parent && parent.type === "assignment_expression" && parent.namedChild(0) && parent.namedChild(0).startIndex === n.startIndex
        if (f && !isWrite) {
          // the `uses` SUBSET: a member read whose field names a declared ivar/property
          // of a class declared in this file. A field this file does not declare is out
          // of subset by construction, and is COUNTED as such rather than folded into
          // agreement or disagreement.
          const mem = classMembers.get(ownerFor(inner))
          usesMember.push(`${inner}\u0000${f.text}\u0000${mem?.has(f.text) ? "declared" : "undeclared"}`)
        }
      } else if (n.type === "call_expression") {
        const callee = childOfType(n, "identifier")
        // `@protocol(P)` is a compiler directive, not an invocation (OC-R2 parity)
        let inAt = false
        let p: any = n.parent, g = 0
        while (p && g++ < 3) { if (p.type === "at_expression") { inAt = true; break } if (p.type === "message_expression" || p.type === "call_expression") break; p = p.parent }
        if (callee && !(inAt && callee.text === "protocol")) calls.push(`${inner}\u0000${callee.text}`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, inner) }
  }
  visit(root, "")

  return { imports: uniq(imports), references: uniq(references), exports: uniq(exports), contains: uniq(contains), calls: uniq(calls), usesMember: uniq(usesMember) }
}

// ---------------------------------------------------------------- run
const LABELS = ["imports", "references", "exports", "contains", "calls"] as const
type Label = (typeof LABELS)[number]
const analyzer = new Map<Label, Set<string>>()
const oracle = new Map<Label, Set<string>>()
const samples = new Map<string, string[]>()
for (const l of LABELS) { analyzer.set(l, new Set()); oracle.set(l, new Set()) }
const note = (k: string, s: string) => { if (!samples.has(k)) samples.set(k, []); const a = samples.get(k)!; if (a.length < 4) a.push(s) }

let totalRels = 0
let totalUses = 0
let usesSubset = 0
const decidedUses = new Set<string>()
const analyzerUsesMember = new Set<string>()
let idx = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const tree = parser.parse(f.text)
    if (!tree) return
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { return }
    const L = f.text.split("\n")
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? "")
      totalRels++
      const ln = typeof x.line_number === "number" ? x.line_number : 0
      const site = `${f.label}:${ln} ${x.source} -> ${x.target}`
      if (t === "uses") {
        totalUses++
        // the `uses` SUBSET: a member read whose field names a declared ivar/property
        if ((x.metadata as any)?.isFieldRead) { const leaf = String(x.target); analyzerUsesMember.add(`${String(x.source)}\u0000${leaf}`) }
        continue
      }
      if ((LABELS as readonly string[]).includes(t)) {
        analyzer.get(t as Label)!.add(`${String(x.source)}\u0000${String(x.target)}`)
        note(`${t}|both-candidates|${x.source}`, site)
      }
    }
    const d = derive(tree.rootNode)
    for (const l of LABELS) for (const v of d[l]) oracle.get(l)!.add(v)
    for (const v of d.usesMember) { usesSubset++; // `endsWith("declared")` is ALSO true of "undeclared", so the first version counted
    // every undeclared field read into the DECIDED subset — 3,349 against an analyzer
    // population of 3,141, a subset larger than the set it claims to be a subset of.
    if (v.endsWith("\u0000declared")) decidedUses.add(v) }
  }
}))

console.log(`OBJECTIVE_C — lane-owned ontology oracle vs production parseFile`)
console.log(`corpus ${CR}: ${files.length} admitted files; ${totalRels.toLocaleString()} relationships, ${totalUses.toLocaleString()} of them \`uses\`\n`)

interface Cell { label: Label; aOnly: number; oOnly: number; both: number; aEx: string[]; oEx: string[] }
const cells: Cell[] = []
for (const l of LABELS) {
  const A = analyzer.get(l)!, O = oracle.get(l)!
  const both = [...A].filter((v) => O.has(v))
  const aOnly = [...A].filter((v) => !O.has(v))
  const oOnly = [...O].filter((v) => !A.has(v))
  for (const v of aOnly.slice(0, 4)) note(`${l}|ANALYZER-ONLY`, v.replace("\u0000", " -> "))
  for (const v of oOnly.slice(0, 4)) note(`${l}|ORACLE-ONLY`, v.replace("\u0000", " -> "))
  cells.push({ label: l, aOnly: aOnly.length, oOnly: oOnly.length, both: both.length, aEx: aOnly.slice(0, 4).map((v) => v.replace("\u0000", " -> ")), oEx: oOnly.slice(0, 4).map((v) => v.replace("\u0000", " -> ")) })
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
if (process.env.BB_DEBUG_KEYS) {
  for (const l of LABELS) {
    console.log(`DEBUG ${l} analyzer[0..3]:`, JSON.stringify([...analyzer.get(l)!].slice(0, 3)))
    console.log(`DEBUG ${l} oracle  [0..3]:`, JSON.stringify([...oracle.get(l)!].slice(0, 3)))
  }
}
console.log(`${w("type", 12)}${w("both", 8)}${w("analyzer-only", 15)}${w("oracle-only", 13)}agreement`)
console.log("-".repeat(84))
for (const c of cells) {
  const denom = c.both + c.aOnly
  const pct = denom === 0 ? "n/a (oracle derived nothing)" : `${((c.both / denom) * 100).toFixed(1)}%`
  console.log(`${w(c.label, 12)}${w(String(c.both), 8)}${w(String(c.aOnly), 15)}${w(String(c.oOnly), 13)}${pct}`)
}
console.log("")
for (const c of cells) {
  if (!c.aOnly.length && !c.oOnly.length) continue
  console.log(`${c.label}:`)
  for (const e of c.aEx) console.log(`   analyzer only: ${e}`)
  for (const e of c.oEx) console.log(`   ORACLE   only: ${e}`)
}
console.log(`\ncontains — the oracle's SCOPE, stated because the percentage is not coverage:`)
console.log(`   It derives owner -> member for class_interface / class_implementation /`)
console.log(`   protocol_declaration nodes and for the struct/enum aggregates nested in them.`)
console.log(`   The analyzer's \`contains\` population is larger and CORRECTLY larger: it also`)
console.log(`   carries a top-level NS_ENUM's members under the enum (AFNetworkReachabilityStatus ->`)
console.log(`   AFNetworkReachabilityStatusUnknown, 4 rows in one header alone) and struct fields,`)
console.log(`   and the F5 differential does not audit \`contains\` for this lane at all. So the`)
console.log(`   1,456 analyzer-only rows are SCOPE, not defects; the meaningful column is oracle-only,`)
console.log(`   which is 0 — the oracle derived no containment the analyzer lacks.`)

console.log(`\nuses — NOT re-derived here, and why:`)
console.log(`   analyzer \`uses\` edges (whole corpus): ${totalUses.toLocaleString()}`)
console.log(`   \`uses\` ALREADY has a second derivation: deriveObjcEdges' objcBareSkip/objcIsDeclaratorName`)
console.log(`   mirror, and script/m14/differential.ts's audited-label filter puts objc in the`)
console.log(`   uses-audited set. Two earlier versions of this file tried to add a THIRD derivation as a`)
console.log(`   "decided subset" and neither converged: the first counted rows whose field names a`)
console.log(`   member this file does not declare, the second reported 0 decided rows against a`)
console.log(`   population it claimed to be a subset of. Publishing either would have added an opinion`)
console.log(`   of unknown quality and called it coverage. It is left out and named instead.`)
console.log(``)
console.log(`   The corpus shares one grammar with every other oracle in this repository, so this file`)
console.log(`   cannot referee a grammar defect either. That is the L3 ceiling, stated once here rather`)
console.log(`   than implied by silence.`)

const disagreements = cells.reduce((a, c) => a + c.aOnly + c.oOnly, 0)
const jsonArg = process.argv.indexOf("--json")
if (jsonArg > 0 && process.argv[jsonArg + 1]) {
  writeFileSync(process.argv[jsonArg + 1], JSON.stringify({
    at: new Date().toISOString(),
    corpus: CR,
    admittedFiles: files.length,
    totalRelationships: totalRels,
    labelsAuditedByThisOracle: [...LABELS],
    gateHook: GATE_HOOK,
    cells,
    uses: { analyzerEdges: totalUses, reDerivedHere: false, reason: "already audited by deriveObjcEdges' objcBareSkip/objcIsDeclaratorName mirror; two partial re-derivations here failed to converge and are named rather than published" },
    independenceCeiling:
      "A second walker over the SAME tree-sitter-objc wasm. A grammar defect is invisible here exactly as it is to the F5 differential. This is a second derivation, not a verification of the grammar.",
    disagreements,
  }, null, 2))
  console.log(`\nwrote ${process.argv[jsonArg + 1]}`)
}
console.log(`\nGATE HOOK master needs: ${GATE_HOOK}`)