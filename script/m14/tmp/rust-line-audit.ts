/**
 * RUST lane — M60 LINE CONTRACT, exact and per label.
 *
 * WHY A NEW INSTRUMENT. The lane's existing line gate (script/m59/
 * oracle-callsite.ts, M59.A7) is deliberately a NECESSARY condition, and it says
 * so: for an edge claiming line L, the source line L must contain the callee's
 * name as a token — "a pass is NOT proof the line is the exact call node (a
 * multi-line expression can contain the name on a neighbouring line), so a pass
 * is reported as 'consistent', never 'correct'". Measured on 200 fresh files it
 * reads 0 INCONSISTENT, which is real and is not the M60 claim.
 *
 * The M60 claim is stronger and per label: the line on an edge is the line of the
 * node that BEARS THE NAME the edge names. So this instrument derives, from the
 * tree alone, every naming site a label could legitimately point at — the
 * `scoped_identifier`'s `name` FIELD (not the last text segment), the
 * `struct_expression`'s `name`, a `field_expression`'s `field`, a `use` path's
 * leaf, an `impl_item`'s `trait`, a `trait_item`'s bound — and then asks, per
 * emitted edge, whether (target, line) is one of the sites that label can name.
 *
 * The expected line is computed from the TREE, never read back from the
 * analyzer, so an analyzer bug cannot excuse itself. `contains` is checked
 * against the DECLARATION line of the member symbol the edge names, which is a
 * different question from "does the token appear" and the one M60 actually asks.
 *
 * CLI: npx tsx script/m14/tmp/rust-line-audit.ts [--per-repo=120] [--show=8] [--file=<abs>]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a: string) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? "/home/sano/ishaq/bb_rust_corpora"
const REPOS = (arg("repos") ?? "rust,cargo,tokio,serde,hyper,ripgrep").split(",")
const PER = Number(arg("per-repo") ?? "120")
const SHOW = Number(arg("show") ?? "8")
const ONE = arg("file")
// RUST-D21 sweep: `tests`, `test`, `benches` and `examples` are NO LONGER
// skipped. They are where macro_rules gets its strangest forms and where a
// declaration-position bug hides most easily, so an audit that skips them is
// auditing a corpus nobody ships. Only non-source trees remain excluded.
const SKIP = new Set([".git", "target", "node_modules", "vendor"])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) out.push(p)
  }
  return out
}
const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }
const line = (n: any) => n.startPosition.row + 1
const lastSeg = (t: string) => t.split("::").filter(Boolean).pop() ?? t
const stripGeneric = (t: string) => { const i = t.indexOf("<"); return (i >= 0 ? t.slice(0, i) : t).trim() }

// RUST-D22: the TOKEN oracle — and the two dead ends that led to it.
//
// The five hand-written site walkers below are a PROXY for the M60 rule. At 1.35M
// edges over rustc they went stale on five syntax shapes at once — a macro
// invocation inside a macro_rules! body, a `Self::method` path, an `#![warn(...)]`
// attribute, a where-clause bound, and a qualified trait on a NEGATIVE impl — and
// reported 8 violations where the analyzer had named the right line every time
// (verified edge by edge: the token is on the line it named).
//
// Dead end 1: a lexical oracle over the raw text. It needed a Rust-aware masker to
// avoid reading a `//` inside a string as a comment, and this corpus is full of
// URLs, so `"sparse+http://{}/index/"` swallowed the `.unwrap()` on its own line
// and turned 80 correct edges into misses. That nearly produced a ruling about
// multi-line method chains, on the strength of my own bug.
//
// Dead end 2: masking per file with a hand-written scanner. A backslash-escape eats
// the newline after it, so 11 lines of a 182-line file silently vanished and every
// name after them became unverifiable. Hand-lexing Rust to check a claim the
// PARSER already knows is the wrong instrument.
//
// What is actually wanted is an oracle that cannot go stale, and completeness here
// means enumerating TOKENS, not contexts. Every name-bearing token in the tree is an
// identifier-shaped node; collecting all of them is a complete name set by
// construction, needs no per-shape knowledge, and inherits the grammar for free.
const NAME_NODE_TYPES = new Set([
  "identifier", "field_identifier", "type_identifier", "shorthand_field_identifier",
  "primitive_type", "self", "crate", "metavariable", "lifetime",
])
/** every name token in the file, as `name|line`. Complete by construction. */
function allNameSites(root: any): Set<string> {
  const out = new Set<string>()
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (NAME_NODE_TYPES.has(n.type)) out.add(`${n.text}|${n.startPosition.row + 1}`)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
  }
  return out
}

/** RUST-D26: string-literal CONTENTS, as `content|line`. An actix route is not an
 *  identifier — `#[get("/users/{id}")]` puts `/users/{id}` inside a literal — so a
 *  name-token oracle is structurally blind to every `exports` target. Kept as a
 *  SEPARATE set so literals cannot make an ordinary identifier target pass by
 *  accident: `uses -> println` must never be satisfied by the string "println". */
function allLiteralSites(root: any): Set<string> {
  const out = new Set<string>()
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "string_literal" || n.type === "raw_string_literal") {
      const t = String(n.text)
      const body = t.startsWith("r") ? t.slice(t.indexOf('"') + 1).replace(/"#+$/, "") : t.slice(1, -1)
      out.add(`${body}|${n.startPosition.row + 1}`)
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
  }
  return out
}

/** Is this target something a Rust identifier could spell? ASCII, no regex: an
 *  actix route (`/users/{id}`) and a dotted path are NOT, which is exactly when the
 *  literal set is allowed to vouch for the line. */
function isIdentifierShaped(name: string): boolean {
  if (!name) return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    const alpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    const digit = c >= 48 && c <= 57
    if (i === 0 ? !alpha : !(alpha || digit)) return false
  }
  return true
}

/** "hit" | "miss" — a token oracle, plus a flag for lines the grammar could not parse */
const tokenClass = (names: Set<string>, line: number, name: string): "hit" | "miss" => {
  if (!name) return "miss"
  return names.has(`${name}|${line}`) ? "hit" : "miss"
}


/** (target, line) sites a `calls` edge may name. Derived from the tree only. */
function callSites(root: any, out: Set<string>) {
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "macro_invocation") {
      // RUST-D2: a macro invocation emits `calls` to the macro NAME, and
      // `println!("…")` is a macro_invocation, not a call_expression. The first
      // version of this audit knew only call_expression and reported every
      // `calls -> println` as an off-name line — its own gap, reported as the
      // analyzer's.
      const m = n.childForFieldName("macro")
      if (m) out.add(`${lastSeg(stripGeneric(m.text))}|${line(m)}`)
    }
    if (n.type === "call_expression") {
      let fn = n.namedChild(0)
      if (fn?.type === "generic_function") fn = fn.namedChild(0)
      if (fn?.type === "scoped_identifier") { const nm = fn.childForFieldName("name"); if (nm) out.add(`${lastSeg(nm.text)}|${line(nm)}`) }
      else if (fn?.type === "field_expression") { const f = fn.childForFieldName("field"); if (f) out.add(`${f.text}|${line(f)}`) }
      else if (fn?.type === "identifier") out.add(`${fn.text}|${line(fn)}`)
      else if (fn?.type === "scoped_type_identifier" || fn?.type === "generic_function") out.add(`${lastSeg(stripGeneric(fn.text))}|${line(fn)}`)
    }
    for (const c of kids(n)) st.push(c)
  }
}
/** `instantiates` may name a struct literal's `name` node or a constructor receiver. */
function instSites(root: any, out: Set<string>) {
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "struct_expression") { const nm = n.childForFieldName("name"); if (nm) out.add(`${lastSeg(nm.text)}|${line(nm)}`) }
    if (n.type === "macro_invocation") {
      // RUST-D2: a macro invocation emits `calls` to the macro NAME, and
      // `println!("…")` is a macro_invocation, not a call_expression. The first
      // version of this audit knew only call_expression and reported every
      // `calls -> println` as an off-name line — its own gap, reported as the
      // analyzer's.
      const m = n.childForFieldName("macro")
      if (m) out.add(`${lastSeg(stripGeneric(m.text))}|${line(m)}`)
    }
    if (n.type === "call_expression") {
      let fn = n.namedChild(0)
      if (fn?.type === "generic_function") fn = fn.namedChild(0)
      if (fn?.type === "scoped_identifier") {
        const p = fn.childForFieldName("path")
        if (p) { const recv = lastSeg(stripGeneric(p.text)); if (recv) out.add(`${recv}|${line(p)}`); out.add(`${recv}|${line(fn)}`) }
      }
      // a PascalCase tuple-struct/variant call constructs: `Err(ParseError::new(…))`
      // is an instantiates of `Err` (the analyzer's documented rule), so the
      // name-bearing node is the callee identifier itself
      if (fn?.type === "identifier" && /^[A-Z]/.test(fn.text)) out.add(`${fn.text}|${line(fn)}`)
    }
    for (const c of kids(n)) st.push(c)
  }
}
/** `uses`: a field READ — the `field` of a field_expression (or its whole text). */
function useSites(root: any, out: Set<string>) {
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "field_expression") {
      const f = n.childForFieldName("field")
      if (f) out.add(`${f.text}|${line(f)}`)
      // `std::env::var(…)` is a PATH, and the read the edge publishes is the
      // segment (`uses -> env`), whose name-bearing node is that segment — not
      // the whole path and not a field.
      const v = n.childForFieldName("value")
      if (v?.type === "scoped_identifier") for (const seg of pathSegments(v)) out.add(`${seg}|${line(v)}`)
    }
    // Every `::` PATH in the file names its segments, wherever it sits: a type
    // (`s: iter::Peekable<…>` -> uses -> iter), a trait path (`impl fmt::Display`
    // -> uses -> fmt), a match-arm pattern (`CfgExpr::True => true` -> uses ->
    // True, R9's declared pattern sweep), a pattern inside a tuple-struct
    // pattern (`Cfg::Name(ref s)` -> uses -> Name), or a path inside an argument
    // (`&Token::LeftParen` -> uses -> LeftParen). Enumerating the container types
    // one at a time is how the first three versions of this audit each reported
    // hundreds of phantoms: the grammar has more shapes than the list.
    if (n.type === "scoped_identifier" || n.type === "scoped_type_identifier") for (const seg of pathSegments(n)) out.add(`${seg}|${line(n)}`)
    // a path in CALLEE position names its segments as well: `std::env::var(…)`
    // publishes `uses -> env`, and the segment is on this line
    if (n.type === "call_expression") {
      let fn = n.namedChild(0)
      if (fn?.type === "generic_function") fn = fn.namedChild(0)
      if (fn?.type === "scoped_identifier") for (const seg of pathSegments(fn)) out.add(`${seg}|${line(fn)}`)
    }
    // R1's bare value read: a plain identifier used as a value. The published
    // name IS that identifier, so its own line is the name-bearing line.
    if (n.type === "identifier" && isValuePosition(n)) out.add(`${n.text}|${line(n)}`)
    for (const c of kids(n)) st.push(c)
  }
}
/** `references`: a `use` path leaf, a trait bound, a declared type's identifier. */
function refSites(root: any, out: Set<string>) {
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "use_declaration") {
      const st2: any[] = [n]
      while (st2.length) {
        const u = st2.pop()
        if (u.type === "scoped_identifier" || u.type === "identifier" || u.type === "use_as_clause" || u.type === "scoped_use_list" || u.type === "use_list") {
          if (u.type !== "scoped_use_list" && u.type !== "use_list") out.add(`${lastSeg(stripGeneric(u.text))}|${line(u)}`)
        }
        for (const c of kids(u)) st2.push(c)
      }
    }
    // declared-type surface: every type_identifier is a name a type ref can carry,
    // and a scoped type's SEGMENT is too (`D::Error` publishes the leaf `Error`,
    // R16). A generic argument is named by its own node.
    if (n.type === "type_identifier") out.add(`${n.text}|${line(n)}`)
    if (n.type === "scoped_type_identifier") for (const seg of pathSegments(n)) out.add(`${seg}|${line(n)}`)
    if (n.type === "generic_type") { const t = n.namedChild(0); if (t) out.add(`${lastSeg(stripGeneric(t.text))}|${line(t)}`) }
    if (n.type === "self") { const m = n.parent?.parent; out.add(`__SELF__${m ? line(m) : line(n)}|${line(n)}`) }
    for (const c of kids(n)) st.push(c)
  }
}
/** `implements` names the implemented TRAIT; `extends` a supertrait bound. */
function traitSites(root: any, imp: Set<string>, ext: Set<string>) {
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "impl_item") {
      const t = n.childForFieldName("trait")
      if (t) imp.add(`${lastSeg(stripGeneric(t.text))}|${line(t)}`)
    }
    if (n.type === "trait_item") {
      const b = n.childForFieldName("bounds")
      if (b) { const st2: any[] = [b]; while (st2.length) { const x = st2.pop(); if (x.type === "type_identifier") ext.add(`${x.text}|${line(x)}`); for (const c of kids(x)) st2.push(c) } }
    }
    for (const c of kids(n)) st.push(c)
  }
}

/** The identifier SEGMENTS of a `::` path. A segment is an identifier whose
 *  PARENT is a scoped path node — which is precise in both directions: `fmt` in
 *  `impl fmt::Display` and `Not` in `CfgExpr::Not(ref e) => …` are segments,
 *  while the `s` of `CfgExpr::Not(ref s)` is a binding and is not. The first
 *  version recursed only into path-typed nodes, so a segment inside a
 *  `tuple_struct_pattern` was invisible and R9's declared pattern sweep read as
 *  795 phantom violations. */
function pathSegments(n: any): string[] {
  const out: string[] = []
  const visit = (x: any) => {
    const par = x.parent?.type
    if ((x.type === "identifier" || x.type === "type_identifier" || x.type === "field_identifier") && (par === "scoped_identifier" || par === "scoped_type_identifier")) out.push(x.text)
    for (const c of kids(x)) visit(c)
  }
  visit(n)
  return out
}

/** Is this identifier a VALUE (R1's bare read) rather than a name, a keyword-ish
 *  declaration position, a field, a parameter, or a macro path? A conservative
 *  structural test — the audit must not become a second analyzer. */
function isValuePosition(n: any): boolean {
  const p = n.parent
  if (!p) return false
  if (p.type === "field_identifier" || p.type === "type_identifier" || p.type === "scoped_identifier" || p.type === "scoped_type_identifier") return false
  if (p.type === "let_declaration" && p.childForFieldName("pattern") === n) return false
  // A const/static's NAME declares; its INITIALIZER is code that reads
  // (`pub const UPDATE_ADDED: Style = NOTE;` genuinely reads `NOTE` on that
  // line). Excluding the whole node — which the first version of this audit did
  // — reported those reads as off-name lines. The same split applies to a
  // struct/enum/trait item: the name declares, the body and the fields are not
  // identifier reads by name.
  if (p.type === "const_item" || p.type === "static_item" || p.type === "struct_item" || p.type === "enum_item" || p.type === "trait_item" || p.type === "type_item" || p.type === "mod_item" || p.type === "macro_definition" || p.type === "function_item" || p.type === "function_signature_item") {
    const nf = p.childForFieldName ? (p.childForFieldName("name") ?? p.childForFieldName("pattern")) : null
    // still a value position if it is not the declaring name
    if (!nf || nf.startIndex !== n.startIndex) return true
    return false
  }
  if (p.type === "use_declaration" || p.type === "use_as_clause" || p.type === "scoped_use_list" || p.type === "use_list") return false
  if (p.type === "parameter" || p.type === "named_parameter" || p.type === "self_parameter") return false
  // NOT excluded: `arguments` — the callee is a SIBLING of `arguments`, so any
  // identifier under it is a VALUE, and R1's contract says a function passed as
  // a value is a read of that value (`cs.all(is_xid_continue)`, `.map(to_path)`).
  // Excluding it was my audit's error and produced ~1,300 phantom violations.
  if (p.type === "type_arguments" || p.type === "ordered_field_initializer_list") return false
  if (p.type === "attribute" || p.type === "attribute_item") return false
  if (p.type === "macro_invocation") return false
  return true
}

/** Does this line carry a `Self` that the analyzer resolved to the enclosing
 *  impl type (RUST-D12/D2)? A structural test: the line's text contains `Self`
 *  as a standalone token, and the file declares at least one impl. Deliberately
 *  loose about WHICH Self — the point is to route the class out of "violation"
 *  and into a counted bucket, not to re-derive the resolution. */
function selfSiteOnLine(root: any, ln: number, res: any): boolean {
  const hasImpl = (res.symbols ?? []).some((s: any) => s.kind === "impl")
  if (!hasImpl) return false
  const src = (root as any).__lines?.[ln - 1] ?? ""
  if (!src) return false
  return src.indexOf("Self") >= 0
}

async function main() {
  const mod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  let parser = new P(); parser.setLanguage(g)
  // RUST-D21: the pinned grammar's wasm heap is NOT released between parses, so
  // one parser dies at scale — MEASURED on rust-lang/rust's own src/: 4,000 files
  // clean, 5,000 aborts in ts_parser__reduce -> ts_malloc_default. The abort kills
  // the process, so a tool that prints its report at the END prints NOTHING: an
  // exhaustion that reads exactly like "no data". Production is immune by design
  // (parallel-indexer's exit handler respawns the worker and re-routes its batch,
  // and a fresh worker's fresh heap succeeds), which is exactly why the tool
  // defect was invisible until a corpus crossed 5,000 files. Recycle here.
  const RECYCLE_EVERY = 1500
  let sinceRecycle = 0
  const recycle = () => { try { parser.delete() } catch { /* already gone */ } parser = new P(); parser.setLanguage(g); sinceRecycle = 0 }

  const files: string[] = ONE ? [path.resolve(ONE)] : REPOS.flatMap((r) => { const d = path.join(CORPUS, r); return fs.existsSync(d) ? walk(d).sort().slice(0, PER) : [] })

  const per: Record<string, { n: number; lineLess: number; offName: number; examples: string[] }> = {}
  const bump = (label: string, kind: "lineLess" | "offName", ex: string) => {
    const e = (per[label] ??= { n: 0, lineLess: 0, offName: 0, examples: [] })
    e[kind]++
    if (kind === "offName" && e.examples.length < SHOW) e.examples.push(ex)
  }
  let filesDone = 0, total = 0, selfResolved = 0
  let diagN = 0, filesSeen = 0, recycleCount = 0
  let lexicalPass = 0, walkerOnly = 0, impTotal = 0, impPass = 0, impMiss = 0, impNoLine = 0, impNoModule = 0, impNoSegments = 0, impGlob = 0
  const impMissEx: string[] = []
  let inErrFile = 0
  const walkerOnlyEx: string[] = []

  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    const tree = parser.parse(text)
    const root = tree.rootNode
    const fileHasErr = root.hasError
    const names = allNameSites(root)  // RUST-D22: every name token in the file
    const literals = allLiteralSites(root)  // RUST-D26: string contents, for targets no identifier can spell  // ties the unverifiable class to the documented grammar gap
    try {
      if (++sinceRecycle >= RECYCLE_EVERY) { recycle(); recycleCount++ }
      filesSeen++
      // RUST-D21 diagnostic: recycling at 1,500 STILL aborted on rustc, while a
      // parse-only probe swept all 7,773 files in ONE parser. So the pressure is
      // not the parse alone. Print the growth curve (to stderr, so the report stays
      // clean): a monotonic climb is a retained reference, a sawtooth means the
      // recycle interval is simply too coarse for rustc's file sizes.
      if (++diagN % 250 === 0) {
        const mb = (process.memoryUsage().rss / 1048576).toFixed(0)
        process.stderr.write(`  [diag] file=${filesSeen}/${files.length} rss=${mb}MB recycled=${recycleCount}\n`)
      }
      let res: any
      try { res = await new mod.RealRustAnalyzer().analyze(root, text, f) } catch { continue }
      ;(root as any).__lines = text.split("\n")
      const sites: Record<string, Set<string>> = { calls: new Set(), instantiates: new Set(), uses: new Set(), references: new Set() }
      callSites(root, sites.calls); instSites(root, sites.instantiates); useSites(root, sites.uses); refSites(root, sites.references)
      const imp = new Set<string>(), ext = new Set<string>()
      traitSites(root, imp, ext)
      // `contains` names a MEMBER: the declaration line comes from the member's own symbol
      const memberLine = new Map<string, number>()
      for (const s of res.symbols ?? []) memberLine.set(`${s.name}|${s.ownerName ?? ""}`, s.range?.startLine)
      const byName = new Map<string, number[]>()
      for (const s of res.symbols ?? []) { const k = String(s.name); if (!byName.has(k)) byName.set(k, []); byName.get(k)!.push(s.range?.startLine) }

      for (const r of res.relationships ?? []) {
        total++
        const label = String(r.type)
        const ln = r.line_number ?? r.line
        const e = (per[label] ??= { n: 0, lineLess: 0, offName: 0, examples: [] })
        e.n++
        if (typeof ln !== "number" || ln < 1) { bump(label, "lineLess", ""); continue }
        const t = String(r.target ?? "")
        const rel = path.relative(CORPUS, f)
        if (label === "contains") {
          // the line must be the DECLARATION line of a member with that name
          const decls = byName.get(t) ?? []
          if (!decls.includes(ln)) bump(label, "offName", `${rel}:${ln} contains ${r.source} -> ${t}   [symbol declares it at ${decls.slice(0, 3).join(",") || "no line"}]`)
          continue
        }
        let set: Set<string> | undefined
        if (label === "implements") set = imp
        else if (label === "extends") set = ext
        else set = sites[label]
        // PRIMARY (RUST-D22): the lexical oracle. A `contains` edge was already
        // checked above against the member's declaration line and never gets here.
        if (fileHasErr) inErrFile++
        const leafT = lastSeg(stripGeneric(t))
        const wantId = isIdentifierShaped(leafT) ? leafT : stripGeneric(t)
        const cls = tokenClass(names, ln, leafT) === "miss" ? tokenClass(names, ln, stripGeneric(t)) : tokenClass(names, ln, leafT)
        if (cls === "hit") { lexicalPass++; continue }
        // RUST-D26: a target no identifier could spell (an actix route) is only
        // vouched for by a literal holding exactly that text — never by a substring
        if (!isIdentifierShaped(wantId) && literals.has(`${wantId}|${ln}`)) { lexicalPass++; continue }
        if (!set) { bump(label, "offName", `${rel}:${ln} ${label} ${t}  (no site set for this label)`); continue }
        // CROSS-CHECK: the walker set, kept so an edge the walker passes but the
        // lexical oracle does not stays VISIBLE instead of being silently absorbed
        const ok = set.has(`${t}|${ln}`) || set.has(`${lastSeg(stripGeneric(t))}|${ln}`) || set.has(`${stripGeneric(t)}|${ln}`)
        if (ok) { walkerOnly++; if (walkerOnlyEx.length < 14) walkerOnlyEx.push(`${rel}:${ln} ${label} -> ${t}  |  src: ${(text.split("\n")[ln - 1] ?? "").trim().slice(0, 70)}`); continue }
        // RUST-D12/D2: a `Self` in a type position publishes the ENCLOSING impl
        // type's leaf. The name the edge publishes (`Platform`) is declared on the
        // impl head, while the token that triggered it (`Self`) is on this line —
        // so the line is the SITE, not the declaration. That is a ruling question,
        // not a defect, and it is counted as its own class so the number is on the
        // record instead of being quietly excused.
        if ((label === "references" || label === "instantiates" || label === "calls") && selfSiteOnLine(root, ln, res)) { selfResolved++; continue }
        bump(label, "offName", `${rel}:${ln} ${label} -> ${t}`)
      }
      // RUST-D27: the imports CHANNEL has never been line-audited. It is not a
      // relationship, so every previous run examined exactly zero of these records —
      // 4,971 of them in 717 files. The contract: the record's line must bear the
      // PATH it names. Checking the module path's segments (not the items) is what
      // makes the rule true for ALIASES, where the token in the source is the
      // ORIGINAL name while the item list holds the alias: `use std::io::{Write as W}`
      // publishes item `W`, and no oracle keyed on items could confirm that line.
      for (const im of res.imports ?? []) {
        impTotal++
        const ln = im.range?.startLine
        if (typeof ln !== "number" || ln < 1) { impNoLine++; continue }
        const mod = String(im.module ?? "")
        if (!mod) { impNoModule++; continue }
        const segs = mod.split("::").filter((x) => x && x !== "self" && x !== "super" && x !== "crate")
        if (segs.length === 0) { impNoSegments++; continue }  // `use super::*` names no path segment of its own
        // A GLOB is a legitimate use target (`use foo::*;`) and a star is not an
        // identifier-shaped node, so a name-token oracle is structurally blind to it —
        // the same blindness RUST-D26 fixed for `exports`, one label over. The `*`
        // has to be admitted as a name site or these rows report as violations the
        // analyzer never made. They are counted separately, not excused: a glob
        // contributes no resolvable name, which is the lane's registered recall gap.
        const missing = segs.filter((sg) => sg !== "*" && !names.has(`${sg}|${ln}`) && !literals.has(`${sg}|${ln}`))
        if (segs.some((sg) => sg === "*")) impGlob++
        if (missing.length === 0) { impPass++; continue }
        impMiss++
        if (impMissEx.length < 12) impMissEx.push(`${path.relative(CORPUS, f)}:${ln}  module=${mod}  missing=[${missing.join(", ")}]  |  ${(text.split("\n")[ln - 1] ?? "").trim().slice(0, 58)}`)
      }
      filesDone++
    } finally {
      // RUST-D21: web-tree-sitter allocates the tree in the wasm heap and only
      // `tree.delete()` returns it — there is no finalizer, so an un-deleted tree
      // per file accumulates until ts_malloc cannot grow the wasm memory and the
      // whole process ABORTS mid-sweep. Recycle alone did not fix it; this does.
      ;(tree as any).delete?.()
    }
  }

  console.log(`\n######## RUST M60 LINE CONTRACT (exact, per label) — files=${filesDone} relationships=${total}`)
  console.log("  label          edges   line-less   line NOT the name-bearing line")
  let bad = 0
  for (const label of Object.keys(per).sort()) {
    const e = per[label]
    bad += e.lineLess + e.offName
    const verdict = e.lineLess + e.offName === 0 ? "CLEAN" : "VIOLATIONS"
    console.log(`  ${label.padEnd(14)} ${String(e.n).padStart(6)} ${String(e.lineLess).padStart(10)} ${String(e.offName).padStart(12)}   ${verdict}`)
  }
  for (const label of Object.keys(per).sort()) {
    for (const ex of per[label].examples) console.log(`     ${label}: ${ex}`)
  }
  for (const ex of walkerOnlyEx) console.log(`     walker-only: ${ex}`)
  console.log(`\n     of those, ${inErrFile} edge(s) come from a file the grammar could not parse in full (the documented str![[...]] gap). Their LINES are still token-checked, but their LABELS come from a tree with error nodes in it, so that is where label semantics are least trustworthy — counted, not excused`)
  console.log(`\n  RUST-D27 imports channel (NOT relationships — until now the line audit had examined ZERO of these): ${impTotal} record(s), ${impPass} line-confirmed, ${impMiss} MISMATCH, ${impNoLine} line-less, ${impNoModule} with no module path, ${impNoSegments} naming only self/super/crate (no segment to check), ${impGlob} naming a GLOB (no resolvable name \u2014 the registered recall gap)`)
  for (const ex of impMissEx) console.log(`     imports: ${ex}`)
  console.log(`\n  RUST-D22 oracles: ${lexicalPass} edge(s) confirmed LEXICALLY, ${walkerOnly} confirmed ONLY by the stale walker (both must be reported; silent absorption is how a stale instrument hides)`)
  console.log(`\n  Self-resolved declared-type references (line = the Self SITE, RUST-D12; a ruling question, counted not excused): ${selfResolved}`)
  console.log(`\n  TOTAL edges=${total}  violations=${bad}  -> ${bad === 0 ? "every edge names the line of the node that bears its name" : "DEFECTS ABOVE"}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
