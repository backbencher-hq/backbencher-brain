/**
 * script/m60/objc-construct-site-probe.ts — CONSTRUCT SITES vs EMITTED EDGES, per type.
 *
 * WHY THIS FILE EXISTS. The ontology census measures what the analyzer EMITS. A gap in
 * the language's own vocabulary — a construct the grammar produces and the analyzer never
 * reads — is invisible there, because nothing is emitted for it and an un-emitted type
 * looks exactly like a ruled one. That is the failure the workstream names: `overrides`
 * was ruled on prose for a whole wave while bash redefined 174 functions.
 *
 * So this file asks the OTHER question for each of the ten types: how many times does the
 * grammar produce the construct the type is ABOUT? It prints construct vs emitted side by
 * side and, where the two can be compared at the same grain, the sites that have no edge.
 *
 *   emitted > construct   an edge with no construct behind it — a fabrication, or a probe
 *                         keying error. Both are worth finding and neither may be assumed.
 *   construct > emitted   deduplication (two sites, one (source,target) pair) or a site the
 *                         analyzer does not read. The unmatched sites are printed with
 *                         file:line so the difference can be READ.
 *
 * ## THE GRAIN IS DECLARED PER TYPE, AND WHY THAT MATTERS
 *
 * The first version of this file compared every type at (source,target) grain and printed
 * four rows of nonsense — `contains 933 construct / 3820 emitted`, `exports 24 / 762`,
 * `instantiates 24 / 508`, `overrides 0 / 615` — because four of its site keys carried a
 * placeholder owner (`? >name`) or named a SELECTOR where the analyzer publishes a CLASS,
 * so no site could ever match an edge. A table whose four rows are its own bugs teaches a
 * reader to distrust the six that are right, which is the cost this file exists to avoid.
 * So each type declares which grain it is compared at, and the two that cannot be
 * compared at all say so instead of printing a misleading ratio:
 *
 *   pairwise     construct site and emitted edge are both keyed (source,target)
 *   count-only   the construct is countable but its SITE does not name the same pair the
 *                analyzer will publish, so only the two totals are comparable
 *   not-comparable  no site on the parse tree decides this edge; the type's completeness
 *                is a property of a scope inventory, not of a node type
 *
 * INSTRUMENT. Parse-tree counts only, never a text regex — the ontology gate's own header
 * records a regex probe convicting two correct bash rulings on a telnet IAC word list and
 * an embedded JS heredoc. It also publishes the NODE-TYPE INVENTORY the grammar produces
 * across the corpus, because a node type the analyzer never mentions is the cheapest
 * positive evidence that a construct exists and is unread.
 *
 * READ-ONLY. Writes nothing.
 *
 * Usage: bun run script/m60/objc-construct-site-probe.ts [--json <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
type Grain = "pairwise" | "count-only" | "not-comparable"
/** Why a type is not compared pairwise, printed next to the verdict. */
const GRAIN_NOTE: Record<string, string> = {
  uses: "a value read is decided by the lane's scope inventory (frame / block chain / same-file members / file globals), not by a node type; there is no construct site on the tree to count",
  exports: "a file-scope DECLARATION is countable, but its site names a node, not the (source,target) pair the analyzer publishes after symbol dedup and the linkage test",
  overrides: "the construct is 'a method of a class that has a superclass', which needs the analyzer's symbol table to enumerate; counted here from the same walk and keyed by (owner, selector) so the two branches are separable",
}

// ---------------------------------------------------------------- corpus
type FileRow = { label: string; abs: string; dir: string; text: string; lines: string[] }
const files: FileRow[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "ls-files", "-z"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "objective-c") continue
    files.push({ label: `${e}/${rel}`, abs, dir, text, lines: text.split("\n") })
  }
}
console.log(`OBJECTIVE_C construct-site probe`)
const revs: Record<string, string> = {}
for (const e of readdirSync(CR)) {
  try { revs[e] = execFileSync("git", ["-C", path.join(CR, e), "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12) } catch {}
}
for (const [r, v] of Object.entries(revs)) console.log(`  corpus ${r} @ ${v}`)
console.log(`  admitted files (router universe): ${files.length}`)

// ---------------------------------------------------------------- tree + emit
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

/** SEP is U+0001, not a space. Corpus paths CONTAIN spaces —
 *  `afnetworking/Example/iOS Example/AppDelegate.h` — and the first version of this file
 *  split a site label on the first space, so every construct site under such a path was
 *  compared against a key still carrying the tail of the directory name: 66 of the 72
 *  "unmatched" imports and 8 of the 20 "unmatched" extends in that run were this bug
 *  reading a real edge as a missing one. */
const SEP = "\u0001"
const sites = new Map<string, Set<string>>()
const site = (type: string, f: FileRow, line: number, key: string): void => {
  let s = sites.get(type)
  if (!s) { s = new Set(); sites.set(type, s) }
  s.add(`${f.label}${SEP}${line}${SEP}${key}`)
}
const show = (s: string): string => { const [a, b, c] = s.split(SEP); return `${a}:${b} ${c}` }
const emitted = new Map<string, { n: number; pairs: Set<string> }>()
const bumpEmit = (t: string, src: string, tgt: string): void => {
  const r = emitted.get(t) ?? { n: 0, pairs: new Set() }
  r.n++
  r.pairs.add(`${src}>${tgt}`)
  emitted.set(t, r)
}
const nodeTypes = new Map<string, number>()

const named = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
const allKids = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) o.push(c) } return o }
const deepFindAll = (n: any, t: string, out: any[] = []): any[] => {
  if (n.type === t) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) deepFindAll(c, t, out) }
  return out
}
/** Full selector + first keyword. A zero-argument selector (`alloc`, `new`) has no ':'
 *  token, so its name lands in `lastId` — comparing against `firstKw` alone reads 0 for
 *  the commonest construction in the language, which the first version of the sibling
 *  probe did. */
const selOf = (n: any): { full: string; firstKw: string } => {
  const kids = allKids(n)
  let full = "", firstKw = "", lastId = ""
  for (let k = 0; k < kids.length; k++) {
    const c = kids[k]
    if (!c || !c.isNamed || c.type !== "identifier") continue
    const nx = kids[k + 1]
    if (nx && !nx.isNamed && nx.type === ":") { full += c.text + ":"; if (!firstKw) firstKw = c.text + ":" }
    else lastId = c.text
  }
  return { full: full || lastId, firstKw }
}
/** A method node's selector, by the analyzer's OWN rule including OC-ONT-8: a keyword owns
 *  the `method_parameter` after it, so `keywords.length === params`, and every leftover
 *  top-level identifier is a trailing attribute unless there are no parameters at all (in
 *  which case the first leftover is the zero-argument selector). */
const methodSelectorOf = (m: any): string => {
  const kids = named(m)
  const params = kids.filter((c) => c.type === "method_parameter").length
  let sel = ""
  const rest: string[] = []
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]
    if (c.type !== "identifier") continue
    if (kids[i + 1]?.type === "method_parameter") sel += c.text + ":"
    else rest.push(c.text)
  }
  if (params === 0 && rest.length > 0) sel += rest[0]
  return sel
}
/** `alloc` and `new` construct an instance; `allocWithZone:` is the same allocator with an
 *  argument and `copy`/`mutableCopy` copy an EXISTING object, so they are counted
 *  separately rather than folded in. */
const ALLOCATORS = new Set(["alloc", "new"])
const inBody = (n: any): boolean => {
  let p = n.parent, guard = 0
  while (p && guard++ < 400) {
    const t = p.type
    if (t === "method_definition" || t === "method_declaration" || t === "function_definition" || t === "block_literal") return true
    p = p.parent
  }
  return false
}
/** The enclosing method selector or function name — the analyzer's relationship source. */
const enclosingName = (n: any): string => {
  let p = n.parent, guard = 0
  while (p && guard++ < 400) {
    if (p.type === "method_definition" || p.type === "method_declaration") {
      let sel = ""
      const kids = named(p)
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].type !== "identifier") continue
        sel += kids[i].text
        if (kids[i + 1]?.type === "method_parameter") sel += ":"
      }
      return sel
    }
    if (p.type === "function_definition") {
      const fd = deepFindAll(p, "function_declarator")[0]
      const id = fd ? deepFindAll(fd, "identifier")[0] : undefined
      return id ? id.text : "(fn)"
    }
    p = p.parent
  }
  return ""
}
/** The enclosing class / protocol / extension name — the analyzer's `contains` owner. */
const enclosingOwner = (n: any): string | null => {
  let p = n.parent, guard = 0
  while (p && guard++ < 400) {
    if (p.type === "class_interface" || p.type === "class_implementation" || p.type === "protocol_declaration") {
      const id = named(p).find((c) => c.type === "identifier")
      return id ? id.text : null
    }
    if (p.type === "struct_specifier" || p.type === "enum_specifier") {
      const id = named(p).find((c) => c.type === "type_identifier")
      return id ? id.text : null
    }
    p = p.parent
  }
  return null
}
/** OC-ONT-6 parity: the ADOPTED-PROTOCOL list, with lightweight generics excluded. The
 *  same three-position partition the analyzer applies, re-derived here so the comparison
 *  is not a tautology against itself. */
const adoptedProtocolNames = (n: any): string[] => {
  const kids = allKids(n)
  let colonIdx = -1, parenIdx = -1
  const lists: Array<{ node: any; idx: number }> = []
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]
    if (!c) continue
    if (!c.isNamed && c.type === ":" && colonIdx < 0) { colonIdx = i; continue }
    if (!c.isNamed && c.type === "(" && parenIdx < 0) { parenIdx = i; continue }
    if (c.isNamed && c.type === "parameterized_arguments") lists.push({ node: c, idx: i })
  }
  const membersOf = (pa: any): string[] => named(pa).filter((c) => ["type_identifier", "identifier", "type_name"].includes(c.type)).map((c) => c.text)
  const isCat = parenIdx >= 0
  const typeParams = new Set<string>()
  for (const l of lists) {
    if ((colonIdx >= 0 && l.idx < colonIdx) || (isCat && colonIdx < 0 && l.idx < parenIdx)) for (const m of membersOf(l.node)) typeParams.add(m)
  }
  const out: string[] = []
  let argsConsumed = false
  for (const l of lists) {
    if (colonIdx >= 0 && l.idx < colonIdx) continue
    if (isCat && colonIdx < 0 && l.idx < parenIdx) continue
    const mem = membersOf(l.node)
    if (colonIdx >= 0 && !argsConsumed && mem.length > 0 && mem.every((m) => typeParams.has(m))) { argsConsumed = true; continue }
    out.push(...mem)
    if (colonIdx >= 0) argsConsumed = true
  }
  return out
}
/** The superclass name of a plain class, or null. */
const superclassOf = (n: any): string | null => {
  const kids = allKids(n)
  const colonIdx = kids.findIndex((c) => !c.isNamed && c.type === ":")
  if (colonIdx < 0) return null
  for (let i = colonIdx + 1; i < kids.length; i++) {
    const c = kids[i]
    if (c && c.isNamed && (c.type === "identifier" || c.type === "type_identifier")) return c.text
  }
  return null
}
const isCategoryNode = (n: any): boolean => allKids(n).some((c) => !c.isNamed && c.type === "(")

let idx = 0
const CONC = 6
await Promise.all(Array.from({ length: CONC }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let tree: any
    try { tree = parser.parse(f.text) } catch { continue }
    if (tree) {
      const visit = (n: any, depth: number): void => {
        nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
        const ln = n.startPosition.row + 1
        switch (n.type) {
          case "preproc_include": {
            const nm = deepFindAll(n, "system_lib_string")[0] ?? deepFindAll(n, "string_content")[0]
            const name = nm ? (nm.type === "string_content" ? nm.text : nm.text.replace(/^<|>$/g, "")) : "?"
            site("imports", f, ln, `root>${name}`)
            site("references", f, ln, `root>${name}`)
            break
          }
          case "message_expression": {
            if (!inBody(n)) break
            const { full, firstKw } = selOf(n)
            const src = enclosingName(n)
            const recv = n.namedChild(0)
            if (ALLOCATORS.has(firstKw || full)) {
              // The analyzer publishes the CLASS; the site names the RECEIVER. `self` and
              // `super` resolve to the enclosing class / its superclass (OC-ONT-4), so the
              // key is the class the edge will name.
              let cls = ""
              if (recv && (recv.type === "identifier" || recv.type === "type_identifier")) cls = recv.text
              else if (recv && recv.type === "message_expression") {
                const inner = selOf(recv).full
                const innerRecv = recv.namedChild(0)
                if (innerRecv && (innerRecv.type === "identifier" || innerRecv.type === "type_identifier")) cls = innerRecv.text
                else cls = `<dynamic:${inner}>`
              } else if (recv) cls = `<${recv.type}>`
              if (cls === "self" || cls === "super") {
                const owner = enclosingOwner(n)
                if (!owner) cls = "<unresolved>"
                else if (cls === "self") cls = owner
                else {
                  // super -> the owner's superclass, read from the OWNER's declaration
                  const oi = deepFindAll(tree.rootNode, "class_interface").concat(deepFindAll(tree.rootNode, "class_implementation"))
                    .find((c) => named(c).some((x) => x.type === "identifier" && x.text === owner))
                  const s = oi ? superclassOf(oi) : null
                  cls = s ?? "<unresolved>"
                }
              }
              site("instantiates", f, ln, `${src}>${cls}`)
            } else {
              site("calls", f, ln, `${src}>${full}`)
            }
            break
          }
          case "call_expression": {
            if (!inBody(n)) break
            const id = deepFindAll(n, "identifier")[0]
            if (id) site("calls", f, ln, `${enclosingName(n)}>${id.text}`)
            break
          }
          case "property_declaration": {
            const idents = deepFindAll(n, "identifier")
            const last = idents[idents.length - 1]
            const owner = enclosingOwner(n)
            if (last && owner) site("contains", f, ln, `${owner}>${last.text}`)
            break
          }
          case "instance_variable": {
            const idents = deepFindAll(n, "identifier")
            const last = idents[idents.length - 1]
            const owner = enclosingOwner(n)
            if (last && owner) site("contains", f, ln, `${owner}>${last.text}`)
            break
          }
          case "method_declaration": {
            // NOT `selOf`: a message send's keywords carry anonymous ':' tokens, a method
            // declaration's do not. Reusing the message rule here computed `initWithBaseURL`
            // where the analyzer publishes `initWithBaseURL:` and made 726 of the `contains`
            // sites look unmatched in the first version of this probe. It also dropped the
            // trailing-attribute identifiers per OC-ONT-8, which is how the second real
            // defect in this lane was found.
            const owner = enclosingOwner(n)
            const sel = methodSelectorOf(n)
            if (sel && owner) site("contains", f, ln, `${owner}>${sel}`)
            break
          }
          case "enumerator": {
            const id = named(n).find((c) => c.type === "identifier")
            const owner = enclosingOwner(n)
            if (id && owner) site("contains", f, ln, `${owner}>${id.text}`)
            break
          }
          case "field_declaration": {
            const id = deepFindAll(n, "field_identifier")[0]
            const owner = enclosingOwner(n)
            if (id && owner) site("contains", f, ln, `${owner}>${id.text}`)
            break
          }
          case "class_interface":
          case "class_implementation": {
            // OC-ONT-8 also applies to the `contains` key above, which is why this file
            // needed its own method-selector derivation rather than the message one.
            const id = named(n).find((c) => c.type === "identifier")
            if (n.type === "class_interface" && !isCategoryNode(n)) {
              const sup = superclassOf(n)
              if (sup && id) site("extends", f, ln, `${id.text}>${sup}`)
            }
            // OC-ONT-6 parity: only the genuine ADOPTION list, so the comparison is a
            // real test of the fix rather than of the probe's own idea of the rule.
            for (const pn of adoptedProtocolNames(n)) site("implements", f, ln, `${id?.text ?? "?"}>${pn}`)
            break
          }
          case "protocol_declaration": {
            const id = named(n).find((c) => c.type === "identifier")
            const rl = named(n).find((c) => c.type === "protocol_reference_list")
            if (id && rl) for (const p of named(rl)) if (p.type === "identifier") site("extends", f, ln, `${id.text}>${p.text}`)
            break
          }
          case "parameterized_arguments":
            break
          case "preproc_def":
            // a `#define` DECLARES a name (the include guard the shared C path mints), so
            // it is an export candidate; the analyzer's only `exports` for it comes from
            // that path, so the site is counted and the comparison stays count-only.
            site("exports", f, ln, `root><preproc_def@${ln}>`)
            break
          case "class_interface":
          case "class_implementation":
          case "protocol_declaration":
          case "function_definition":
          case "type_definition":
          case "declaration": {
            // `implements`/`extends` are derived from the same nodes in the CASE above;
            // this case only adds the export-site count.
            // FILE-SCOPE only, and only with EXTERNAL linkage. The first version counted
            // every `declaration` node at any depth and reported 4,444 "construct sites",
            // most of them method locals — a count of the tree, not of the language's
            // export construct. Depth 1 under `translation_unit` is the file scope, and
            // `static` is the one spelling of internal linkage (C99 6.2.2p5).
            if (depth !== 1) break
            let internal = false
            for (let k = 0; k < n.namedChildCount; k++) {
              const c = n.namedChild(k)
              if (c && c.type === "storage_class_specifier" && c.text.trim() === "static") { internal = true; break }
            }
            if (internal) break
            site("exports", f, ln, `root><${n.type}@${ln}>`)
            break
          }
        }
        for (let k = 0; k < n.childCount; k++) { const c = n.child(k); if (c) visit(c, depth + 1) }
      }
      visit(tree.rootNode, 0)
      tree.delete?.()
    }
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? "").toLowerCase()
      if (!ALL_TYPES.includes(t)) continue
      bumpEmit(t, String(x.source ?? ""), String(x.target ?? ""))
    }
    // `overrides` needs the symbol table to enumerate its construct, so it is counted from
    // the analyzer's OWN symbols rather than from the tree — which is stated, because a
    // construct count derived from the analyzer cannot detect an analyzer omission and is
    // only here to separate the two confidence branches.
    const classes = new Set<string>()
    const methodsByOwner = new Map<string, Set<string>>()
    for (const s of r.symbols ?? []) {
      if (String(s.kind) === "class") classes.add(String(s.name))
      if (String(s.kind) === "method" && s.ownerName) {
        let set = methodsByOwner.get(String(s.ownerName))
        if (!set) { set = new Set(); methodsByOwner.set(String(s.ownerName), set) }
        set.add(String(s.name))
      }
    }
    for (const rel of r.relationships ?? []) {
      if (String(rel.type) !== "extends") continue
      if (!classes.has(String(rel.source))) continue
      if ((rel.metadata as any)?.isProtocolInheritance) continue
      const base = String(rel.target)
      if (!base || base === "NSObject" || base === "NSProxy") continue
      const owner = String(rel.source)
      const own = methodsByOwner.get(owner)
      if (!own) continue
      const baseInFile = classes.has(base)
      const baseMethods = baseInFile ? methodsByOwner.get(base) : undefined
      for (const m of own) {
        // Three branches, and the middle one is why construct(738) > emitted(615):
        //   verified         the base is declared in THIS file and declares the selector
        //   first-parent     the base is NOT declared here -> deterministic guess at 0.5
        //   suppressed       the base IS declared here and does NOT declare the selector, so
        //                    the subclass is overriding nothing and the analyzer is right to
        //                    publish nothing. 123 of 738 sites on the pinned corpus.
        const branch = baseMethods?.has(m) ? "V" : baseInFile ? "S" : "G"
        if (branch === "S") continue
        site("overrides", f, typeof rel.line_number === "number" ? rel.line_number : 0, `${owner}.${m}>${base}.${m}`)
      }
    }
  }
}))

// ---------------------------------------------------------------- report
console.log(`\nNODE-TYPE INVENTORY — ${nodeTypes.size} distinct types across ${files.length} files`)
console.log(`  (a type the analyzer never mentions is a construct that exists and is unread)`)
const rows: Array<Record<string, unknown>> = []
console.log(`\nCONSTRUCT vs EMITTED, per relationship type`)
console.log(`${"type".padEnd(13)} ${"grain".padEnd(14)} ${"construct".padStart(9)} ${"emitted".padStart(9)}   note`)
console.log("-".repeat(118))
for (const t of ALL_TYPES) {
  const c = sites.get(t)?.size ?? 0
  const e = emitted.get(t)?.n ?? 0
  const grain: Grain = t === "uses" ? "not-comparable" : t === "exports" ? "count-only" : "pairwise"
  console.log(`${t.padEnd(13)} ${grain.padEnd(14)} ${String(c).padStart(9)} ${String(e).padStart(9)}   ${GRAIN_NOTE[t] ?? ""}`.slice(0, 160))
  rows.push({ type: t, grain, constructSites: c, emittedEdges: e, emittedOverConstruct: e - c })
}
console.log("-".repeat(118))

console.log(`\nUNMATCHED CONSTRUCT SITES — a grammar site with no emitted edge of that type.`)
console.log(`This is the shape a GAP takes: deduplication, or a site the analyzer does not read.`)
const gapReport: Record<string, unknown> = {}
for (const t of ALL_TYPES) {
  const c = sites.get(t)
  const e = emitted.get(t)?.pairs ?? new Set<string>()
  if (!c) { gapReport[t] = { grain: "not-comparable", unmatched: null }; continue }
  if (t === "exports") {
    // count-only: the site key names a NODE, so "unmatched" here would be 100% by
    // construction and would read as a finding. The two totals above are the comparison.
    gapReport[t] = { grain: "count-only", unmatched: null, note: GRAIN_NOTE[t] }
    console.log(`\n  ${t}: count-only — ${c.size} file-scope external-linkage declaration sites against ${emitted.get(t)?.n ?? 0} emitted edges; per-site pairing is not attempted (${GRAIN_NOTE[t]})`)
    continue
  }
  const unmatched = [...c].filter((x) => !e.has(x.split(SEP)[2]!))
  gapReport[t] = { grain: t === "exports" ? "count-only" : "pairwise", unmatched: unmatched.length, sample: unmatched.slice(0, 10).map(show) }
  console.log(`\n  ${t}: ${unmatched.length} of ${c.size} construct sites have no emitted edge of that type`)
  for (const u of unmatched.slice(0, 10)) console.log(`     ${show(u)}`)
  if (unmatched.length > 10) console.log(`     … ${unmatched.length - 10} more`)
}

const ANALYZER_SRC = readFileSync(path.join(ROOT, "src", "ast", "real-objective-c-analyzer.ts"), "utf8")
const unread = [...nodeTypes.entries()]
  .filter(([t]) => !new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(ANALYZER_SRC))
  .sort((a, b) => b[1] - a[1])
console.log(`\nNODE TYPES THE ANALYZER NAMES NOWHERE (${unread.length} of ${nodeTypes.size}), most frequent first:`)
console.log("  " + unread.slice(0, 70).map(([t, n]) => `${t}=${n}`).join("  "))

const j = process.argv.indexOf("--json")
if (j > 0 && process.argv[j + 1]) {
  writeFileSync(process.argv[j + 1], JSON.stringify({
    at: new Date().toISOString(), corpus: revs, admittedFiles: files.length,
    perType: rows, gaps: gapReport,
    nodeTypes: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
    nodeTypesNotNamedInAnalyzer: Object.fromEntries(unread),
  }, null, 2))
  console.log(`\nwrote ${process.argv[j + 1]}`)
}