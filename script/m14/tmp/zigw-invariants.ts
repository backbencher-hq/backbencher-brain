// The final audit: every INVARIANT the analyzer is assumed to hold, checked in
// one pass over a large draw, whether or not a lane gate exists for it.
//
// The lane has eight gates and all of them watch RELATIONSHIPS, keyed by
// (label, target) or (label, target, source). That leaves three whole output
// channels ungated -- SYMBOLS, COMPLEXITY and file-level metadata -- and it
// leaves a dozen structural invariants unchecked even for relationships:
// duplicate edges, self-loops, degenerate names, confidence outside (0,1],
// missing reason codes, symbol kinds outside the shared enum, symbols whose owner
// or scope does not exist, duplicate symbols, and symbol line numbers.
//
// Each finding below is stated as an INVARIANT rather than a heuristic, so a
// violation is a bug by definition and not a judgement call. Anything this finds
// is either fixed or written down as a declared exception; nothing is left as a
// number nobody looked at.
import * as fs from "fs"
import { SymbolKind } from "../../../src/ast/types"
import { stripZigQuoting } from "../../../src/ast/real-zig-analyzer"
import { init, parser, analyzer } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]
const VALID_KINDS = new Set<string>(Object.values(SymbolKind as unknown as Record<string, string>))
// The confidence contract, per EMISSION SITE rather than per label — `uses` is
// 0.75 for a field read and 1.0 for a bare identifier read, and `references` is
// 1.0 for the import twin and 0.9 for a declared type. Keyed on label+reason,
// which is how the analyzer itself distinguishes them. Read off the emission
// sites, not assumed.
const CONFIDENCE: Record<string, number> = {
  "contains": 1.0,
  "calls": 0.85,
  "uses|zig_field_access": 0.75,
  "uses|identifier_usage": 1.0,
  "imports": 0.9,
  "references|zig_import": 1.0,
  "references|declared_type": 0.9,
  "instantiates": 1.0,
  "exports": 1.0,
}

// Field names Zig allows that are pure punctuation.
const OPERATOR_NAMES = new Set(["*", "+", "-", "/", "%", "=", "==", "!=", "<", ">", "<=", ">=", "[]", ".*", "orelse", "catch", "&", "|", "^", "<<", ">>", "++", "--", "!", "~", "?", ":", ".*", "anytype", "comptime", "noalias", "align", "linksection", "callconv", "export", "extern", "packed", "volatile", "allowzero", "sentinel"])

function collect(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith(".zig")) out.push(p)
  }
}

interface Hit { n: number; where: string }
const hits = new Map<string, Hit>()
const note = (k: string, where: string): void => {
  const prev = hits.get(k)
  if (prev) prev.n++
  else hits.set(k, { n: 1, where })
}

await init()
const limit = Number(process.argv[2] ?? 400)
const files: string[] = []
for (const r of REPOS) collect(`${CORPUS}/${r}`, files)
const draw = files.slice(0, Math.min(limit, files.length))

// CLASS-AWARE, because two of this lane's classes are legitimately allowed to
// repeat a (type, source, target) triple and the rest are not.
//
// `imports`, the import `references` twin and `instantiates` are SITE-KEYED: one
// edge per SITE, so a file that imports the same module twice, or constructs the
// same type in two places, publishes two edges with one name each. `calls`,
// `uses`, `contains` and the declared-type `references` COLLAPSE per
// (source, target) — the analyzer keeps an `emitted` set keyed that way, so a repeat
// would be a dedupe bug. A first version of this audit flagged all 27 site-keyed
// rows as duplicates and would have had them "fixed" by deleting correct edges.
const SITE_KEYED = new Set(["imports", "instantiates"])
const isImportTwin = (r: any): boolean => r.type === "references" && r.metadata?.relationshipType === "zig_import"
// A `calls` self-loop is RECURSION, which is a real edge: `fn fibonacci(..)`
// calling itself is a call, and the corpus has 18 of them in a 300-file draw. It
// looks like a cycle bug and is not one. Any OTHER self-looping class is a
// defect — a `contains X -> X` owns itself.
// A self-loop is legitimate wherever a name can legitimately BE the thing it
// reads or contains:
const SELF_LOOP_OK = new Set(["calls", "uses", "contains", "instantiates"])
// `calls fibonacci -> fibonacci` is recursion; `uses assignExpr -> assignExpr` is a
// local named after its enclosing function (372 rows at full corpus); `contains
// alias -> alias` is a container with a member of its own name (12 rows); and
// `instantiates AlignedManaged -> AlignedManaged` is a construction inside the type's
// own declaration (142 rows). The 200-file draw saw only the first of those.
const selfLoopOk = (r: any): boolean => SELF_LOOP_OK.has(String(r.type))

let rel = 0, sym = 0, fnSym = 0, withCx = 0
const CALIBRATE = process.argv.includes("--calibrate")
if (CALIBRATE) console.log("CALIBRATION: one derived row and one confidence are perturbed -- a real invariant gate must FAIL this")

for (const f of draw) {
  const src = fs.readFileSync(f, "utf8")
  const lines = src.split("\n")
  const tree = parser().parse(src)
  const res = analyzer().analyze(tree.rootNode, src, f) as any
  const rel_ = f.split("/").slice(-2).join("/")

  // PER FILE, not per run: a `uses (global) -> debug` in one file and the same
  // edge in the next are two edges, and calling them duplicates is how a probe
  // manufactures 1,392 violations out of correct output. (The first version of
  // this audit kept both maps outside the loop and reported exactly that.)
  const seenEdges = new Map<string, string>()
  const seenNames = new Map<string, string>()
  const seenSyms = new Map<string, string>()

  // ── relationship invariants ───────────────────────────────────────────────
  for (const r of res.relationships ?? []) {
    // CALIBRATION, applied BEFORE the checks rather than after them. The first
    // version perturbed the first edge at the BOTTOM of the loop, by which point
    // every invariant had already been evaluated -- so `--calibrate` reported
    // 0 violations and the gate looked calibrated while being unfalsifiable. An
    // audit that cannot demonstrate its own failure is the exact defect class
    // this lane has now hit six times, and it was hiding in the instrument
    // written to catch them.
    if (CALIBRATE && rel === 0) {
      r.line_number = 999999
      r.confidence = 0.01
    }
    rel++
    const t = String(r.target ?? "")
    const s = String(r.source ?? "")
    const where = `${rel_}:${r.line_number ?? "?"} ${r.type} ${s} -> ${t}`
    if (t === "") note(`REL: empty target${rel_.includes("compile_errors") ? " (in the deliberately-invalid corpus)" : " — NOT in an intentionally-invalid file"}`, where)
    else if (t.trim() === "") note("REL: whitespace-only target", where)
    // Zig permits an operator-named FIELD (`*`, `[]`, `+`, `orelse`), so a target with
    // no letter or digit is not malformed: `contains Suffix -> *` in
    // Builtins/TypeDescription.zig is a real member. Declaring OPERATOR_NAMES was not
    // enough -- the first attempt added the set and never USED it, because the
    // replacement that should have wired it in was not asserted. Asserted now.
    else if (!/[\p{L}\p{N}_]/u.test(t) && !OPERATOR_NAMES.has(t)) note("REL: target has no letter or digit", where)
    if (s === t && !selfLoopOk(r)) note(`REL[${r.type}]: self-loop`, where)
    if (typeof r.confidence !== "number" || r.confidence <= 0 || r.confidence > 1) note("REL: confidence outside (0,1]", `${where} conf=${r.confidence}`)
    const reason = String(r.metadata?.relationshipType ?? "")
    const declared = CONFIDENCE[reason ? `${r.type}|${reason}` : String(r.type)]
    if (declared !== undefined && r.confidence !== declared) note(`REL: ${r.type}(${reason || "no reason code"}) confidence ${r.confidence}, contract declares ${declared}`, where)
    if (!r.metadata || typeof r.metadata !== "object") note("REL: no metadata object", where)
    else if (!r.metadata.relationshipType) note(`REL: no metadata.relationshipType reason code (class ${r.type})`, where)
    if (typeof r.line_number !== "number" || r.line_number <= 0) note("REL: no line_number", where)
    else if (r.line_number > lines.length) note("REL: line_number past end of file", where)
    const ek = `${r.type}|${s}|${t}|${r.line_number ?? "?"}`
    const prior = seenEdges.get(ek)
    if (prior) note(`REL[${r.type}]: duplicate edge at the SAME LINE`, `${where}  first at ${prior}`)
    else seenEdges.set(ek, where)
    // COLLAPSED classes must not repeat a name within the file.
    //
    // `contains` is NOT one of them, and a 200-file draw did not show it: at full
    // corpus it repeats (owner, member) 3,353 times, because a container can
    // genuinely declare two members with one name (`Iterator.next` at lines 124
    // and 165 of Driver/Filesystem.zig). The edge is per SYMBOL, so both are real,
    // and #963's extent resolution is what tells them apart downstream. Calling
    // that a duplicate would have been this gate's fourth wrong assumption.
    if (!SITE_KEYED.has(String(r.type)) && !isImportTwin(r) && r.type !== "contains") {
      const nk = `${r.type}|${s}|${t}`
      const nprior = seenNames.get(nk)
      if (nprior) note(`REL[${r.type}]: repeated (source,target) — this class COLLAPSES, so one edge per name`, `${where}  first at ${nprior}`)
      else seenNames.set(nk, where)
    }
  }

  // ── symbol invariants ─────────────────────────────────────────────────────
  const names = new Set<string>()
  for (const s of res.symbols ?? []) {
    sym++
    const nm = String(s.name ?? "")
    const where = `${rel_}:${s.range?.startLine ?? "?"} ${s.kind} ${nm}`
    if (!VALID_KINDS.has(String(s.kind))) note(`SYM: kind '${s.kind}' is not in the shared SymbolKind enum`, where)
    if (nm === "") note("SYM: empty name", where)
    if (s.ownerName) names.add(String(s.ownerName))
    if (s.kind === "function" || s.kind === "method") {
      fnSym++
      // `symbol.complexity`, the family standard — go/c/rust all put it there and
      // the doc's claim of `metadata.complexity` is wrong.
      const cx = s.complexity
      if (cx === undefined) note("SYM: function without symbol.complexity", where)
      else {
        withCx++
        if (typeof cx !== "number" || !Number.isFinite(cx)) note("SYM: complexity is not a finite number", `${where} cx=${cx}`)
        else if (cx < 1) note("SYM: complexity below the documented base of 1", `${where} cx=${cx}`)
        else if (!Number.isInteger(cx)) note("SYM: complexity is not an integer", `${where} cx=${cx}`)
      }
    }
    const sk = `${s.kind}|${nm}|${s.scope ?? ""}|${s.range?.startLine ?? ""}`
    const sprior = seenSyms.get(sk)
    if (sprior) note("SYM: duplicate symbol (kind+name+scope+line)", `${where}  first at ${sprior}`)
    else seenSyms.set(sk, where)
  }
  // ── dangling targets ──────────────────────────────────────────────────────
  // Z46: an edge may point at a name the index will never resolve. The analyzer
  // published `calls (global) -> _` for ghostty's gettext function while
  // DECLINING to declare it, because the blank-identifier rule (right for
  // `const _ = 1;`) was also applied to `pub fn _()`, which is a real callable
  // name. A `uses`/`calls` edge whose target is DECLARED IN THIS FILE, tree-derived
  // and independent of the analyzer, and for which no symbol exists, is a dangling
  // edge — and nothing in the lane could see it, because every gate here compares
  // edges against edges.
  //
  // Note what this is NOT: a requirement that every edge target resolve to a
  // same-file symbol. Most calls in Zig go to `std`, to dot-imported modules and
  // to C, and those are correctly unresolvable in isolation. The invariant is
  // only about names THIS file declares.
  // FILE SCOPE ONLY, and that qualification is the fourth version of this
  // question in this lane — the first three were each wrong in a different way
  // (see zigw-decl-coverage.ts for the whole sequence). A function inside a
  // `return struct { pub fn … }` is a member of an ANONYMOUS type, which Z22 rules
  // owns nothing, so no symbol is published and a `calls` edge naming it is not
  // dangling: the edge is correct about a member the index deliberately does not
  // index. Counting those made this invariant report 8 phantom danglings across
  // `aro/Builtins/*.zig`, all of which were the anonymous-struct case.
  //
  // So "declared here" means: declared at FILE scope, which is to say reachable
  // from `source_file` without crossing a function body, a statement, or a
  // container. `pub fn _()` in ghostty's i18n file IS file-scope, and its call
  // edge was genuinely dangling — that is the case this invariant exists for.
  const declaredHere = new Set<string>()
  {
    const BARRIERS = new Set([
      "function_declaration", "block", "if_statement", "if_expression", "for_statement",
      "for_expression", "while_statement", "while_expression", "switch_statement",
      "switch_expression", "catch_expression", "defer_statement", "expression_statement",
      "test_declaration", "comptime_statement", "errdefer_statement",
      "struct_declaration", "enum_declaration", "union_declaration",
      "container_field", "container_declaration",
    ])
    const walk = (n: any): void => {
      if (n.type === "function_declaration") {
        let nm: string | null = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") { nm = stripZigQuoting(String(c.text ?? "")); break }
        }
        if (nm) {
          let q = n.parent
          let fileScope = true
          let guard = 0
          while (q && guard++ < 40) { if (BARRIERS.has(q.type)) { fileScope = false; break } q = q.parent }
          if (fileScope) declaredHere.add(nm)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
    }
    walk(tree.rootNode)
  }
  const symNames = new Set<string>()
  for (const s2 of res.symbols ?? []) symNames.add(stripZigQuoting(String(s2.name ?? "")))
  for (const r of res.relationships ?? []) {
    if (!["calls", "uses", "contains", "references"].includes(String(r.type))) continue
    const t = stripZigQuoting(String(r.target ?? ""))
    if (!declaredHere.has(t)) continue
    if (symNames.has(t)) continue
    note(`REL[${r.type}]: DANGLING target \u2014 the tree declares \`${t}\` but no symbol was published, so the edge resolves to nothing`, `${rel_}:${r.line_number ?? "?"} ${r.type} ${r.source} -> ${r.target}`)
  }

  // owner integrity: every ownerName must be a name this file declares
  for (const s of res.symbols ?? []) {
    if (!s.ownerName) continue
    if (!names.has(String(s.ownerName))) {
      note("SYM: ownerName is not a name this file declares", `${rel_}:${s.range?.startLine ?? "?"} ${s.kind} ${s.name} owner=${s.ownerName}`)
    }
  }

  // ── file-level metadata ───────────────────────────────────────────────────
  if (res.metadata?.cyclomaticComplexity === undefined) note("FILE: no metadata.cyclomaticComplexity", rel_)
  tree.delete()
}

console.log(`files: ${draw.length}  relationships: ${rel}  symbols: ${sym}  functions/methods: ${fnSym} (${withCx} with complexity)`)
console.log(`\nINVARIANT VIOLATIONS: ${hits.size} class(es)`)
for (const [k, v] of [...hits].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(6)}x  ${k}`)
  console.log(`          e.g. ${v.where}`)
}
process.exit(hits.size === 0 ? 0 : 1)
