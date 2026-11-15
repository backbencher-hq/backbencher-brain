/**
 * The Holy C lane's own gate: property invariants + executable regression mutants
 * + a measured-cost check.
 *
 * WHY THIS FILE EXISTS. The C lane's canonical gates live in shared files
 * (`script/m14/mutate-analyzer.ts`, `script/m14/run-fixtures.ts`), and editing
 * those from a language lane is a merge hazard -- the perl lane staged its mutants
 * as a patch for exactly that reason. A defect class with no gate is the disease
 * this repository keeps finding, so the C lane owns its gate instead:
 *
 *   PART 1 -- PROPERTIES. Invariants that hold for EVERY file and that no
 *     expectation file can express, because a fixture pins what the analyzer DID
 *     emit and says nothing about what it must NOT emit twice, must not be
 *     unnamed, must not carry two truths for one fact, or must not point a
 *     containment edge at itself. These run over the C fixtures and over a
 *     corpus slice.
 *
 *   PART 2 -- MUTANTS. Each historical defect class and each class this wave
 *     found, as a FAITHFUL REVERT applied to the analyzer's own SOURCE TEXT and
 *     then run through the real analyzer against a real fixture. A revert that
 *     changes nothing is an ERROR, not a pass; a fact that does not hold on the
 *     clean analyzer is a BAD-FACT, not a CAUGHT; a class whose input the grammar
 *     can no longer produce is RETIRED with a stated reason, and a retirement
 *     without one is itself a BAD-FACT. Each of those is a separate outcome
 *     because conflating them is how a lane ends up reporting credit it never
 *     earned.
 *
 *   PART 3 -- MEASURED COST. Some defect classes have no output signature at all:
 *     the pre-fix and post-fix results are byte-identical and only the COST
 *     differs. Fixtures cannot see those, because fixtures assert on output.
 *
 * A mutant is a SOURCE revert rather than an output rewrite, so it exercises the
 * real extraction path instead of a post-hoc filter.
 *
 *   bun run script/m14/tmp/c-audit/verify-c-lane.ts [--corpus <dir>] [--quick]
 *                                          [--max-files N] [--quick]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")
const FIXTURES = path.join(ROOT, "validation/m14/fixtures/c")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const QUICK = argv.includes("--quick")
const CORPUS = arg("corpus", "")

/**
 * Where the mutated analyzer copies go. `BB_C_LANE_TMP` overrides it. Every file
 * this gate writes is removed on exit, because a run that leaves one full
 * analyzer copy per mutant behind will eventually fill a shared box's disk --
 * which it did once during this wave, and the write that hit the full disk
 * truncated this very file to zero.
 */
const TMP_DIR = process.env.BB_C_LANE_TMP ?? path.join("/tmp/opencode", "c-lane")
fs.mkdirSync(TMP_DIR, { recursive: true })
const TEMP_VARIANTS: string[] = []
function cleanupVariants(): void {
  for (const f of TEMP_VARIANTS) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* already gone */
    }
  }
  TEMP_VARIANTS.length = 0
}
process.on("exit", cleanupVariants)

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const cparser = new P()
cparser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const Engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
const KNOWN_KINDS = new Set<string>(Object.values(Engine.ASTEngine.SymbolKind as Record<string, string>))
const KNOWN_REL = new Set<string>(Object.values(Engine.ASTEngine.RelationshipType as Record<string, string>))
const MEMBER_KINDS = new Set(["property", "enum_member"])

// ---------------------------------------------------------------------------
// analyzer loading, with faithful source-text reverts
// ---------------------------------------------------------------------------
const BASE_SRC = fs.readFileSync(ANALYZER, "utf8")
let variantSeq = 0

async function loadAnalyzer(revert?: (s: string) => string): Promise<any> {
  if (!revert) return (await import(ANALYZER)).RealCAnalyzer
  const raw = revert(BASE_SRC)
  if (raw === BASE_SRC) {
    throw new Error("the revert changed nothing -- its anchor moved, so the mutant would silently never apply")
  }
  const next = raw.replace(`from "./engine"`, `from ${JSON.stringify(path.join(ROOT, "src/ast/engine.ts"))}`)
  const tmp = path.join(TMP_DIR, `c-lane-analyzer.${variantSeq++}.ts`)
  fs.writeFileSync(tmp, next)
  TEMP_VARIANTS.push(tmp)
  return (await import(tmp)).RealCAnalyzer
}

function analyzeWith(Cls: any, src: string, name: string): any {
  return new Cls().analyze(cparser.parse(src).rootNode, src, name) as any
}

// ---------------------------------------------------------------------------
// PART 1 -- PROPERTIES
// ---------------------------------------------------------------------------
interface Violation {
  property: string
  file: string
  detail: string
}

function ownerNames(syms: any[]): Array<[string, Map<string, any[]>]> {
  const m = new Map<string, Map<string, any[]>>()
  for (const s of syms) {
    if (!MEMBER_KINDS.has(String(s?.kind)) || !s?.ownerName) continue
    const g = m.get(s.ownerName) ?? new Map<string, any[]>()
    const rows = g.get(String(s.name)) ?? []
    rows.push(s)
    g.set(String(s.name), rows)
    m.set(s.ownerName, g)
  }
  return [...m]
}

/**
 * Remove comments and string/template literals from TypeScript source, so a scan
 * for syntax can ignore prose. A hand-rolled scanner rather than a pattern,
 * because the rule being enforced here is that this lane's own code carries no
 * regex literal -- a scanner written with one would be self-refuting.
 */
function stripCommentsAndStrings(src: string): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2)
      i = end === -1 ? src.length : end + 2
      out += " "
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c
      i++
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2
          continue
        }
        if (src[i] === quote) {
          i++
          break
        }
        i++
      }
      out += '""'
      continue
    }
    out += c
    i++
  }
  return out
}

function checkProperties(Cls: any, files: Array<{ name: string; src: string }>): Violation[] {
  const out: Violation[] = []
  for (const f of files) {
    let res: any
    try {
      res = analyzeWith(Cls, f.src, f.name)
    } catch (e: any) {
      // The crash guarantee: a damaged file must still yield its recoverable
      // content. A THROW is the loudest possible violation of it.
      out.push({
        property: "P10-crash-guard",
        file: f.name,
        detail: `analyze() threw: ${String(e?.message ?? e).slice(0, 160)}`,
      })
      continue
    }
    const syms: any[] = res.symbols ?? []
    const rels: any[] = res.relationships ?? []
    // OBJECT-LIKE macros only, for the reason the #931 rule records: a
    // function-like macro is replaced only where `(` follows the name, so a
    // member may legitimately share one (redis: `double min, max;` declared
    // 3,700 lines after `#define min(a, b) ...`). The first version of this
    // property had the same false class as the first version of the rule, and
    // the gate caught it on the fixture control authored to catch it.
    const objectMacroNames = new Set<string>(
      syms.filter((s) => (s.metadata as any)?.isMacro && !(s.metadata as any)?.isFunctionLikeMacro).map((s) => s.name),
    )
    const declared = new Set<string>(syms.map((s) => s?.name).filter((n) => typeof n === "string" && n !== ""))

    for (const s of syms) {
      if (typeof s?.kind !== "string" || !KNOWN_KINDS.has(s.kind))
        out.push({ property: "P9-known-kind", file: f.name, detail: `kind=${String(s?.kind)} name=${String(s?.name)}` })
      if (typeof s?.name !== "string" || s.name.trim() === "")
        out.push({ property: "P6-named-symbol", file: f.name, detail: `kind=${String(s?.kind)} range=${JSON.stringify(s?.range)}` })
      if (s?.name === "unknown")
        out.push({ property: "P6-named-symbol", file: f.name, detail: `placeholder name on kind=${String(s?.kind)}` })
      if (MEMBER_KINDS.has(String(s?.kind))) {
        if (!s?.ownerName)
          out.push({ property: "P5-member-owner", file: f.name, detail: `${s.kind} ${s.name}@L${s?.range?.startLine}` })
        if (objectMacroNames.has(String(s?.name)))
          out.push({
            property: "P7-no-macro-named-member",
            file: f.name,
            detail: `${s.ownerName}.${s.name}@L${s?.range?.startLine} is named after an object-like macro, not a declarator`,
          })
      }
    }

    // P8, and the record of narrowing it THREE times -- each time C was right and
    // the property was wrong, which is the honest history of this finding.
    //   v1 "no owner may hold two members of the same name": broken 41x in curl,
    //      41x in libgit2, 19x in redis, all legitimate C.
    //   v2 "a repeated member name must differ in isConditional": still wrong --
    //      curl/lib/curlx/multibyte.h's xcharp_u.tchar_ptr x2 and
    //      ftplistparser.c's anonymous_struct.main x2 are in MUTUALLY EXCLUSIVE
    //      `#ifdef UNICODE` / `#else` arms, and isConditional is true for BOTH
    //      (it records "inside some conditional", not WHICH arm).
    //   v3 (this one) "a repeated member name requires conditional compilation":
    //      sound, and still useful -- two members of one tag sharing a name in
    //      UNCONDITIONAL code is not legal C at all, so an unconditional
    //      duplicate is a defect whatever produced it. Which arm is not
    //      expressible in the payload and is not asserted.
    for (const [owner, names] of ownerNames(syms)) {
      for (const [n, rows] of names) {
        if (rows.length <= 1) continue
        const unconditional = rows.filter((r) => (r.metadata as any)?.isConditional !== true)
        if (unconditional.length > 0) {
          out.push({
            property: "P8-conditional-member-redeclaration",
            file: f.name,
            detail:
              `${owner}.${n} emitted ${rows.length}x and ${unconditional.length} of them are UNCONDITIONAL -- ` +
              "mutually exclusive preprocessor arms are the only legal source of a repeated member name",
          })
        }
      }
    }

    const sites = new Map<string, Set<string>>()
    for (const r of rels) {
      const t = String(r?.type ?? "")
      if (!KNOWN_REL.has(t)) out.push({ property: "P3-ontology", file: f.name, detail: `untyped edge ${t} -> ${r?.target}` })
      const ln = (r as any).line_number
      if (typeof ln !== "number" || ln < 1)
        out.push({ property: "P2-edge-line", file: f.name, detail: `${t} ${r?.source} -> ${r?.target} has no line` })
      if (t === "contains" && !declared.has(String(r?.source)))
        out.push({ property: "P4-contains-source", file: f.name, detail: `contains source ${r?.source} is not a symbol` })
      // P12 -- a container cannot be its own member. Added because a shadowed
      // local in the enum extractor (`const enumName` shadowing the method's
      // `enumName`) made every enum member carry `ownerName: <its own name>`,
      // producing `contains X -> X`. P5 could not see it: the ownerName was
      // present, just wrong -- and neither could the fixtures, because the
      // member's NAME was right. Only the edge's direction was not.
      if (t === "contains" && String(r?.source) === String(r?.target))
        out.push({ property: "P12-no-self-containment", file: f.name, detail: `contains ${r?.source} -> itself @L${ln}` })
      // P1 -- two truths for one fact. The analyzer emits one edge per NAME
      // OCCURRENCE, so two edges sharing (source, type, target, line) that carry
      // different `relationshipType` values came from two branches disagreeing
      // about the same occurrence. A repeat with the SAME relationshipType is
      // not provable from the payload (a line is not a site) and is not claimed.
      const key = `${r?.source}|${t}|${r?.target}|${typeof ln === "number" ? ln : "none"}`
      const set = sites.get(key) ?? new Set<string>()
      set.add(String((r?.metadata as any)?.relationshipType ?? "-"))
      sites.set(key, set)
    }
    for (const [key, kinds] of sites) {
      if (kinds.size > 1) out.push({ property: "P1-one-truth-per-fact", file: f.name, detail: `${key} via ${[...kinds].join(" + ")}` })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// PART 2 -- MUTANTS
// ---------------------------------------------------------------------------
interface Mutant {
  id: string
  defectClass: string
  defect: string
  /** Faithful revert of the analyzer's own source. Must change the text. */
  revert: (s: string) => string
  /** The fixture the fact is checked against. */
  fixture: string
  /** The fact that must hold for the ANALYZER and must BREAK for the mutant. */
  fact: (res: any, src: string) => boolean
  /** Optional: a fact that needs its own two-file inputs instead of one fixture. */
  twoFile?: {
    a: { name: string; src: string }
    b: { name: string; src: string }
    check: (Cls: any) => boolean
  }
  /**
   * A class whose defect input can NO LONGER BE PRODUCED by the pinned grammar, so
   * no revert of the guard can make a fixture change. The guard stays as defence;
   * what is missing is a reachable input, and that is a completeness-ledger row
   * rather than something a permanently-passing mutant may paper over.
   */
  retired?: boolean
  retiredBecause?: string
}

const sym = (r: any, name: string, kind?: string) =>
  (r.symbols ?? []).find((s: any) => s.name === name && (kind ? s.kind === kind : true))
const hasEdge = (r: any, type: string, source: string, target: string) =>
  (r.relationships ?? []).some((x: any) => String(x.type) === type && x.source === source && x.target === target)
/** #991's facts need two predicates the file did not have: a name present AT ALL, and a
 *  name present AS A MACRO (constant or macro kind), because the defect was a fabricated
 *  macro whose name resolved to a property -- so `sym(name)` alone would be satisfied by
 *  the real member and the fact would pass on the broken analyzer. */
const hasSymbol = (r: any, name: string) => (r.symbols ?? []).some((s: any) => s.name === name)
const hasMacroNamed = (r: any, name: string) =>
  (r.symbols ?? []).some((s: any) => s.name === name && (s.kind === "macro" || s.kind === "constant"))
const edgesOf = (r: any, type: string, source: string, target: string) =>
  (r.relationships ?? []).filter((x: any) => String(x.type) === type && x.source === source && x.target === target)

/** `size/align` of a struct or type symbol, as the fixture records it. */
const symOf = (r: any, name: string) => (r.symbols ?? []).find((s: any) => s.name === name && (s.kind === "struct" || s.kind === "type"))
const layoutOf = (r: any, name: string): string => {
  const s: any = symOf(r, name)
  return s ? `${s.metadata?.memorySize}/${s.metadata?.alignment}` : "absent"
}
/** #940: how many members of this type the analyzer had to guess. */
const unknownMembers = (r: any, name: string): number => {
  const s: any = symOf(r, name)
  return typeof s?.metadata?.layoutUnknownMembers === "number" ? s.metadata.layoutUnknownMembers : -1
}

/**
 * The HC5 pair, taken verbatim from the deepest-review probe
 * (`script/m14/tmp/c-review3-probe5.ts`) rather than invented: file A glues a
 * function header into a leading ERROR span, file B has a CLEAN declaration
 * behind an ERROR span at the same offsets, and the two agree only while the
 * per-file memo is cleared. A first draft of this fact used a synthetic pair (a
 * prototype plus a clean file) which the gate correctly reported as SURVIVED --
 * it never reached `isCgd19SuppressedVarDecl` at all, because the clean file has
 * no ERROR ancestor to ask about. A test that cannot fail is not a test.
 */
const MUT_HC5_A = "int broken( {\nint okfn(int a) { return a; }\nint tailvar = 1;\n"
const MUT_HC5_B = "{ {\n/*123456789012345*/\nint clean = 1;\n"

const MUTANTS: Mutant[] = [
  {
    id: "c-lane/field-leaf-double-emission",
    defectClass: "relationship-duplication",
    defect:
      "this wave: a field read `a->x` published TWO `uses` edges for one occurrence -- the field_expression's `field_access`@0.9 and its own field_identifier leaf re-read as `identifier_usage`@1.0 -- because the two branches keyed the shared dedup set differently (`::uses::` against `::use::`). One fact, two confidences, two metadata vocabularies. Measured 2,369 provable occurrences over 80 redis files (35,200 edges, 6.7%).",
    revert: (s) =>
      s.replace(
        'const relKey = `${sourceScope}::${isTypeNode ? "ref" : "uses"}::${text}`',
        'const relKey = `${sourceScope}::${isTypeNode ? "ref" : "use"}::${text}`',
      ),
    fixture: "field-read-single-edge",
    fact: (r) => edgesOf(r, "uses", "read_field", "value").length === 1,
  },
  {
    id: "c-lane/struct-size-cycle-guard",
    defectClass: "crash",
    defect:
      "this wave: calculateMemorySize/calculateAlignment resolved a member's type by BARE NAME against the struct/union maps, so a name shared by an enum typedef and a struct tag (curl's cf-h1-proxy.c: `typedef enum {...} h1_tunnel_state;` plus `struct h1_tunnel_state { ... h1_tunnel_state tunnel_state; ... }`) resolved to the struct and recursed until the stack blew. A real corpus file, a hard crash, against a lane documenting a crash guarantee of 0. The mutant re-enters the cycle, so it CRASHES -- which the runner counts as caught, because a crash breaks the fact too.",
    revert: (s) =>
      s.replace(
        "          if (active.has(key)) {\n            // A by-value cycle: C forbids the construct, so no size exists. Bounded, not followed.\n            fieldSize = 0",
        "          if (false) {\n            fieldSize = 0",
      ),
    fixture: "self-referential-struct-927",
    fact: (r) => !!sym(r, "tunnel_state", "struct") && !!sym(r, "tunnel_phase", "enum"),
  },
  {
    id: "c-lane/macro-generated-field-name",
    defectClass: "symbol-fabrication",
    defect:
      "this wave: a macro-generated member (`BIT(closing);`, `MEMBER(int *, payload);`) published a `property` named after the MACRO -- a name that is not a field of the struct -- and dropped the real declarator (`payload`) entirely, while the struct's memorySize was computed from a field that does not exist. Measured `cf_h2_proxy_ctx.BIT` x5 in curl.",
    // The #932 rule was later appended to the SAME condition, so this anchor is
    // the declarator test alone rather than the whole `if` line -- matching the
    // whole line made the revert stop applying after #932, and the gate reported
    // ERROR rather than a false CAUGHT, which is what the "a revert that changes
    // nothing is an ERROR" rule is for.
    //
    // #985 ADDED A SECOND GUARD, and this revert has to remove both. `BIT(closing);`
    // parses as `macro_type_specifier` alone, and #985 put the macro type nodes on
    // the extractor's skip list -- so with the skip list in place, deleting the
    // declarator test changes NOTHING: measured over the four declared corpora
    // (3,997 files), 0 symbols and 0 relationships differ. The two guards overlap
    // on this shape and each covers the other, so the mutant SURVIVED its own
    // fixture until both were reverted.
    //
    // The overlap is measured, not assumed. The predicate is NOT dead: instrumented
    // over 1,499 files it is called 12,461 times and refuses 540 of them. It has
    // simply become unobservable on the corpus -- every field it refuses is one
    // #985's skip list also refuses. So both are kept, and this revert removes both
    // so the class stays convicted; `c-lane/macro-type-member-name` below convicts
    // the #985 half on its own.
    revert: (s) => {
      const from = "fieldDeclarationHasDeclarator(field) &&"
      const hits = s.split(from).length - 1
      if (hits !== 2) throw new Error(`C-D12 anchor found ${hits}x, expected 2 (struct and union loops)`)
      return s
        .replaceAll(from, "true &&")
        .replace(
          'const MACRO_TYPE_NODES = ["macro_type_specifier", "macro_prefixed_type_specifier"]',
          "const MACRO_TYPE_NODES: string[] = []",
        )
    },
    fixture: "macro-generated-field",
    fact: (r) => !sym(r, "BIT", "property") && !sym(r, "MEMBER", "property") && !!sym(r, "real_bit", "property"),
  },
  {
    id: "c-lane/macro-type-member-name",
    defectClass: "symbol-fabrication",
    defect:
      "#985: the ADJACENT shape to the one above, and the one its rule cannot see. `c-lane/macro-generated-field` reinstates the defect for `BIT(closing);`, where the macro OWNS the name and the declaration has no declarator at all -- `fieldDeclarationHasDeclarator` refuses it. #985 is when the macro is the TYPE and a SEPARATE declarator names the member:\n\n    git_array_t(size_t) line_index;\n      field_declaration\n        macro_type_specifier    <- the TYPE, whose first identifier is the MACRO\n        field_identifier        <- the real member\n\nA declarator IS present here, so the #928 refusal does not fire, and the extractor's per-child loop treats every child that is not a type node as a DECLARATOR -- and a `macro_type_specifier` was in neither the type list nor the skip list. So the macro was descended for its identifier and published BESIDE the real member: `contains git_blame -> git_array_t` (a member clang reports as PHANTOM) next to the correct `contains git_blame -> line_index`. Measured over the four declared corpora (3,997 files): 60 phantom `contains` edges, 48 beside the correct member, across 19 macro names -- git_array_t x13, ql_elm x11, ql_head x5, rb_node x5, STACK_OF, HRESULT, ULONG, GIT_ALIGN, plus C++-header debris.\n\nThis mutant removes the macro-type nodes from the skip list, restoring the pre-#985 behaviour in both the struct and the union loop.",
    // The skip list is the ONLY thing #985 changed, so that is what is anchored --
    // and the anchor is the CONSTANT, not the expanded `...MACRO_TYPE_NODES`, so the
    // revert does not depend on how the spread is written at each site.
    revert: (s) => {
      const from = "const MACRO_TYPE_NODES = [\"macro_type_specifier\", \"macro_prefixed_type_specifier\"]"
      const hits = s.split(from).length - 1
      if (hits !== 1) throw new Error(`#985 anchor found ${hits}x, expected 1 (the constant)`)
      return s.replace(from, "const MACRO_TYPE_NODES: string[] = []")
    },
    fixture: "macro-type-member-985",
    fact: (r) =>
      // the phantoms are gone
      !sym(r, "git_array_t", "property") &&
      !sym(r, "ALIGN8", "property") &&
      !hasEdge(r, "contains", "array_field", "git_array_t") &&
      !hasEdge(r, "contains", "aligned_field", "ALIGN8") &&
      // CONTROLS: the real members beside them are still published, so this cannot
      // be satisfied by refusing the whole shape -- which is what a `continue` here
      // would do, and would cost 48 correct edges to fix 12 wrong ones
      hasEdge(r, "contains", "array_field", "payload") &&
      hasEdge(r, "contains", "array_field_ptr", "entries") &&
      hasEdge(r, "contains", "two_macros", "index") &&
      hasEdge(r, "contains", "two_macros", "counts") &&
      hasEdge(r, "contains", "aligned_field", "slot") &&
      // CONTROLS: the object-like-macro type and the ordinary readings are untouched
      hasEdge(r, "contains", "controls", "plain") &&
      hasEdge(r, "contains", "controls", "real_bit") &&
      hasEdge(r, "contains", "controls", "callback") &&
      // CONTROL: #928's own shape stays silent, so the two rules do not merge
      !sym(r, "BIT", "property") &&
      !sym(r, "closing", "property"),
  },
  {
    id: "c-lane/inline-enum-member-path",
    defectClass: "symbol-fabrication",
    defect:
      "#986: an ANONYMOUS enum used as a MEMBER's type collapsed onto the CONTAINER's name, so the enumerators were published as members of the containing type instead of of the member. `typedef union { enum { A_ONE, A_TWO } first; int n; } U;` published `contains U -> A_ONE` beside `contains U -> first`, and a consumer reading `U` cannot learn that `first` is a type of its own.\n\nThe two adjacent shapes were already correct, which is what makes this a defect and not a design choice: a TAGGED inline enum keeps its own tag as the owner (`enum E { B_ONE } first;` -> `contains E -> B_ONE`), and an inline STRUCT composes the member path via `inlineAggregateOwnerName` (#950/#951). Only the untagged enum took neither path -- #961's `if (scope && scope !== 'global' && enumName === 'anonymous_enum') enumName = scope` fires on the same placeholder, and for this shape `scope` IS the container's name.\n\nMeasured over the four declared corpora (3,997 files): 17 members across 6 files. curl's `pl_unix_substate` carries SEVEN inline enums in one union, so that one file accounts for 35 `contains` edges published under the wrong owner; also `pl_winNT_substate` (3), `ftp_parselist_data` (1) in ftplistparser.c, `stub_gss_ctx_id_t_desc` in curl_gssapi.c, `OperationConfig` in tool_cfgable.h, and libgit2's `reftable_ref_record`, `reftable_log_record` and `refdb_reftable_stack_iterator`.\n\nThis mutant removes the `inlineAggregateOwnerName` call from `extractEnum`.",
    revert: (s) => {
      const from = "      const memberPath = this.inlineAggregateOwnerName(node)\n      if (memberPath) enumName = memberPath"
      if (s.split(from).length - 1 !== 1) throw new Error("#986 anchor not found or not unique")
      return s.replace(from, "      // reverted")
    },
    fixture: "inline-enum-member-path-986",
    fact: (r) =>
      // the phantoms are gone: the enumerators belong to the member, not the container
      !hasEdge(r, "contains", "U", "A_ONE") &&
      !hasEdge(r, "contains", "U", "A_TWO") &&
      !hasEdge(r, "contains", "X", "C_ONE") &&
      // the real owner is the member path
      hasEdge(r, "contains", "U.first", "A_ONE") &&
      hasEdge(r, "contains", "U.first", "A_TWO") &&
      hasEdge(r, "contains", "X.mode", "C_ONE") &&
      // CONTROLS: the three shapes that were already right must stay right, and each
      // fails differently if the fix is over-applied --
      //   the TAGGED enum must keep its tag, so a fix that preferred the member path
      //     unconditionally would move B_ONE under V.first
      hasEdge(r, "contains", "E", "B_ONE") && !hasEdge(r, "contains", "V", "B_ONE") && !hasEdge(r, "contains", "V.first", "B_ONE") &&
      //   the inline struct keeps #950/#958's path
      hasEdge(r, "contains", "W.pt", "x") && !hasEdge(r, "contains", "W", "x") &&
      //   #961's function-local case is untouched: a function has no fields, so a fix
      //     that fired before the member path existed would publish `f.first`, which
      //     resolves to nothing. This is the control the ordering comment is about.
      hasEdge(r, "contains", "f", "L_ONE") && !hasEdge(r, "contains", "f.first", "L_ONE") &&
      hasEdge(r, "contains", "g", "M_ONE") &&
      //   a two-level path must not flatten
      hasEdge(r, "contains", "Nested.mid", "inner") && hasEdge(r, "contains", "Nested.mid.inner", "deep") && !hasEdge(r, "contains", "Nested", "deep"),
  },
  {
    id: "c-lane/macro-in-field-position",
    defectClass: "symbol-fabrication",
    defect:
      "this wave: a bare macro token in FIELD position makes the grammar promote it to a type_identifier, so the parse is `field_declaration { type_identifier(MACRO) field_identifier(TYPE) ';' MISSING }` and the extractor published the TYPE as a member of the struct -- a symbol that resolves to nothing. Measured 1 occurrence over 2,498 files (jemalloc tsd.h:255). The rule requires BOTH the MISSING semicolon and a name slot holding a declared type, because `struct S { struct T T; }` is legal C and only the MISSING token separates it from the defect; this mutant drops the whole rule.",
    // Anchor the PREDICATE CALL, not the whole `if` line: #933 and #934 both
    // touched that line, and a whole-line anchor is what made this revert stop
    // applying -- reported as ERROR rather than as a false CAUGHT, which is
    // exactly what the "a revert that changes nothing is an ERROR" rule is for.
    revert: (s) => {
      const from = "!fieldDeclarationNamesANonDeclarator(field, declaredTypes, allMacroNames)"
      const hits = s.split(from).length - 1
      if (hits !== 2) throw new Error(`#932 anchor found ${hits}x, expected 2 (struct and union loops)`)
      return s.replaceAll(from, "true")
    },
    fixture: "macro-in-field-position-932",
    fact: (r) =>
      !sym(r, "tsd_state_t", "property") &&
      // The control that makes the rule sound: a member may legally share a
      // spelling with a type in the same file.
      !!sym(r, "S", "property") &&
      !!sym(r, "kept", "property"),
  },
  {
    id: "c-lane/macro-generated-enumerator",
    defectClass: "symbol-fabrication",
    defect:
      "this wave: a macro invocation in ENUMERATOR position (`CURLOPT(CURLOPT_WRITEDATA, CURLOPTTYPE_CBPOINT, 1)` in curl/include/curl/curl.h) is parsed as ERROR fragments around bare `enumerator(identifier)` pieces, and every piece was published as a member -- the macro's ARGUMENTS as enum members, with a contains edge each. Measured 21x `CURLOPTTYPE_CBPOINT` under `CURLoption` in one file.",
    revert: (s) =>
      s.replace(
        'if (enumerator && enumerator.type === "enumerator" && !macroArgumentEnumerators.has(enumerator.startIndex)) {',
        'if (enumerator && enumerator.type === "enumerator") {',
      ),
    fixture: "macro-generated-enumerator",
    fact: (r) =>
      // The controls are the point: a blunt "this list is damaged" rejection would
      // delete PLAIN_MEMBER and REAL_AFTER, so the fact pins BOTH the absence of
      // the phantoms and the presence of the real enumerators beside them.
      !sym(r, "CURLOPT_WRITEDATA", "enum_member") &&
      !sym(r, "CURLOPTTYPE_CBPOINT", "enum_member") &&
      !!sym(r, "PLAIN_MEMBER", "enum_member") &&
      !!sym(r, "REAL_AFTER", "enum_member"),
  },
  {
    id: "c-lane/enumerator-macro-span-close",
    defectClass: "symbol-fabrication",
    defect:
      "this wave, second half: the positional rule has to treat an ERROR that BOTH closes one invocation and opens the next (curl's `ERROR(number_literal \")\" \",\" identifier \"(\")` separator). The first draft used `else if`, so a closing ERROR that also opened the next one left the state closed and published that invocation's arguments too -- the fixture caught it on the SECOND invocation while the first was already clean.",
    revert: (s) =>
      s.replace(
        '      if (text.indexOf(")") !== -1) inInvocation = false\n      if (text.indexOf("(") !== -1) inInvocation = true',
        '      if (text.indexOf(")") !== -1) inInvocation = false\n      else if (text.indexOf("(") !== -1) inInvocation = true',
      ),
    fixture: "macro-generated-enumerator",
    fact: (r) => !sym(r, "CURLOPT_URL", "enum_member") && !!sym(r, "PLAIN_MEMBER", "enum_member"),
  },
  {
    id: "c-lane/object-like-macro-enumerator",
    defectClass: "symbol-loss",
    defect:
      "this wave, the object-like half of #931: an enumerator whose name is an OBJECT-LIKE macro defined at or before it is a macro use, not a declaration -- the preprocessor replaces the identifier. Measured `CURLOPTDEPRECATED` (x3) and `CURLINFO_DOUBLE` (x6) in curl.h, `REG_OK` in tre.h, `XXH_OK` in xxhash.h, `tsd_state_t` in jemalloc's tsd.h. The mutant removes the rule entirely.",
    revert: (s) =>
      s.replace(
        'macroDef !== undefined && macroDef.kind === "object" && macroDef.at <= enumerator.startIndex',
        "false",
      ),
    fixture: "macro-generated-enumerator",
    fact: (r) => !!sym(r, "FN_LIKE_MACRO", "enum_member") && !sym(r, "OBJ_LIKE_MACRO", "enum_member"),
  },
  {
    id: "c-lane/function-like-macro-enumerator",
    defectClass: "symbol-loss",
    defect:
      "this wave, the second half of #931: an enumerator named after a FUNCTION-LIKE macro is REAL, because a function-like macro is replaced only where `(` follows the name and an enumerator is followed by `,`, `=` or `}`. The mutant widens the rule to every macro, which fabricates a loss -- redis's `double min, max;` 3,700 lines after its own `#define min(a, b)` is the measured case. The rule existing at all, and the fixture control that pins it, are what keep the first corpus run's false positive from becoming a permanent omission.",
    revert: (s) =>
      s.replace(
        'macroDef !== undefined && macroDef.kind === "object" && macroDef.at <= enumerator.startIndex',
        "macroDef !== undefined && macroDef.at <= enumerator.startIndex",
      ),
    fixture: "macro-generated-enumerator",
    fact: (r) => !!sym(r, "FN_LIKE_MACRO", "enum_member") && !sym(r, "OBJ_LIKE_MACRO", "enum_member"),
  },
  {
    id: "c-lane/936-primitive-width-from-spelling",
    defectClass: "wrong-payload",
    defect:
      "this wave: the layout maths matched a member's type SPELLING against a curated whitelist, so every legal C primitive the author had not enumerated fell through to a 4/4 default -- measured over the redis corpus, 1027 of 2056 member-type spellings, 50 percent, led by `long long` (130x, 8 bytes, computed as 4) and `unsigned char` (45x, 1 byte, computed as 4). Found by asking clang for the real sizeof/_Alignof, which had never been done: the payload sat at 46.9 percent agreement while the member SETS were 97.1 percent identical, and that split is what located the defect in the arithmetic rather than in extraction. The mutant restores the whitelist and the fact pins both the widths it missed and the one that was already right (NarrowUC is 1-aligned, so a fix that assumed 4-alignment everywhere would fail here too).",
    revert: (s) => {
      // Anchor on the BRANCH HEAD only. A first attempt anchored on the branch head
      // plus the assignment two lines below, and a comment sits between them, so the
      // revert never fired and the gate reported an anchor error rather than a
      // result -- which is the correct failure, but only because the gate refuses
      // to silently pass a mutant whose revert it could not apply.
      const from = "      } else if (primitive) {"
      if (!s.includes(from)) throw new Error("#936 anchor not found")
      return s.replace(from, "      } else if (false) {")
    },
    fixture: "layout-widths-from-ast-936",
    fact: (r) => layoutOf(r, "WideLL") === "16/8" && layoutOf(r, "NarrowUC") === "2/1" && layoutOf(r, "MixedSI") === "8/4",
  },
  {
    id: "c-lane/937-file-local-typedef-alias",
    defectClass: "wrong-payload",
    defect:
      "this wave: `typedef uint16_t fingerprint_t;` sat two lines above the `fingerprint_t fp;` member that needed it, and `uint16_t` was ALREADY in the layout tables -- so this was never a cross-file problem and C-D2 does not excuse it. redis's chkLobbyEntry published 8 bytes at alignment 1 where clang says 4 at alignment 2, i.e. it sized its members as 4 bytes while its own alignment claimed 1. The mutant stops the resolver following any alias, and the fact pins a CHAIN as well as a single hop, because a fix that resolves only the direct case would pass a one-level fixture.",
    revert: (s) => {
      const from = "    if (field.primitive) return field.primitive"
      if (!s.includes(from)) throw new Error("#937 anchor not found")
      return s.replace(from, "    if (field.primitive) return field.primitive\n    if (true) return null")
    },
    fixture: "layout-widths-from-ast-936",
    fact: (r) => layoutOf(r, "AliasPair") === "4/2" && unknownMembers(r, "AliasPair") === 0,
  },
  {
    id: "c-lane/938-size-and-align-one-fallback",
    defectClass: "self-contradictory-payload",
    defect:
      "this wave: the size pass and the alignment pass each had their own spelling table AND their own unknown-type fallback -- 4 bytes at alignment 4 in one, alignment 1 in the other. A struct could therefore be published sizing its members as 4-byte quantities while claiming an alignment of 1, which is not a wrong number so much as a self-contradictory one. Two functions must not hold two opinions about the same unknown, so the fallback is now one shared constant. The mutant restores the alignment pass's own answer; the fact pins that a REFUSED width (long double) takes the shared fallback in BOTH passes rather than one of them.",
    revert: (s) => {
      const from = "          align = Math.max(align, RealCAnalyzer.UNKNOWN_MEMBER.align)"
      if (!s.includes(from)) throw new Error("#938 anchor not found")
      return s.replace(from, "          align = Math.max(align, 1)")
    },
    fixture: "layout-widths-from-ast-936",
    fact: (r) => {
      const n = symOf(r, "LongDoubleRefused")
      // 4/4: the refused width takes the shared fallback on BOTH sides. With the
      // old split this reads 4/1, which is the contradiction itself.
      return layoutOf(r, "LongDoubleRefused") === "4/4" && n?.metadata?.memorySize === 4
    },
  },
  {
    id: "c-lane/941-flexible-array-zero",
    defectClass: "wrong-payload",
    defect:
      "this wave: a FLEXIBLE ARRAY MEMBER, `T name[]` with no dimension, was charged ONE byte, because the count defaulted to 1. C99 6.7.2.1p16 says it is ignored when the containing struct's size is computed, so zero is the DEFINED answer rather than a guess. redis's intset published 12 bytes where clang says 8. The mutant restores the default, and the fact also pins that the member is still CONTAINED -- contributing no bytes must not unpublish the member, which is the failure mode a naive fix invites.",
    revert: (s) => {
      const from = "                    arraySize = 0"
      if (!s.includes(from)) throw new Error("#941 anchor not found")
      return s.replace(from, "                    arraySize = 1")
    },
    fixture: "layout-widths-from-ast-936",
    fact: (r) => layoutOf(r, "FlexTail") === "4/4" && hasEdge(r, "contains", "FlexTail", "data"),
  },
  {
    id: "c-lane/944-bitfield-unmeasured",
    defectClass: "wrong-payload",
    defect:
      "this wave: a BITFIELD was charged its declared type's full width. redis's raxNode declares three 1-bit flags and a 29-bit counter on uint32_t; clang packs all four into ONE 4-byte unit where the model computed 16. Bitfield packing is a real algorithm this model does not implement, so the width is unknown -- but a wrong width is worse than a MARKED lower bound, and a type containing bitfields must not be published as measured. The mutant removes the marking (not the arithmetic), and the fact pins that the marking is what changed: the size is the same lower bound either way, which is exactly why only the flag can hold this line.",
    revert: (s) => {
      // RE-AIMED THREE times, and the third is where the guard stopped existing in
      // its own right. #944 had a dedicated `field.isBitfield && !primitive` guard;
      // #945 packed the bitfields that CAN be packed; #949 then made the accounting
      // an exclusive partition, in which a bitfield with an unknown declared type is
      // simply an `unresolvableType`. So the mutant reverts the unresolvable-type
      // count, and its FACT pins the bitfield instance of that class -- the case
      // that motivated #944 -- because a general revert still needs a fact that
      // names the specific input. Each of the three re-aims was reported by the
      // gate rather than absorbed: an anchor error, then a SURVIVE, then a BAD-FACT.
      const from = "        if (unresolvableType) {"
      if (!s.includes(from)) throw new Error("#944 anchor not found")
      return s.replace(from, "        if (false && unresolvableType) {")
    },
    fixture: "layout-bitfields-unions-945",
    // RE-AIMED TWICE, and the second time is the instructive one. This fact
    // originally asserted `BitPacked` carried 2 unmeasured members, true while every
    // bitfield was charged its declared type's width. #945 packs them, so the gate
    // reported a BAD-FACT -- the fact was wrong, not the analyzer. Re-aiming it at
    // "BitPacked is now 0" then made it SURVIVE, because a bitfield with a KNOWN
    // declared type never reaches this guard at all. The class is real and
    // reachable, it just needs its own input: a bitfield whose declared TYPE is a
    // cross-file typedef, where the storage-unit size is unknown and packing is
    // impossible. That is what `UnknownTypeBitfield` is, and it is distinct from
    // #944b's case (known type, unknown width).
    fact: (r) => unknownMembers(r, "UnknownTypeBitfield") === 1 && unknownMembers(r, "Flags") === 0,
  },
  {
    id: "c-lane/944b-unresolvable-width-marked",
    defectClass: "unverifiable-payload",
    defect:
      "this wave: a bitfield whose declared TYPE is known but whose WIDTH cannot be resolved -- the width macro is defined in another header (C-D2) -- cannot be packed, because the storage unit size is the declared type's size and the bit COUNT is unknown. It is charged the declared type's width, which is a lower bound, so the type must be marked. The mutant removes the marking. Note `clang -std=c11` REJECTS this declaration, which is the finding rather than an inconvenience: the only reachable input for an unresolvable bitfield width is a cross-file macro, so this case can never be verified against clang and the marker is the only thing standing between a consumer and a wrong number.",
    revert: (s) => {
      // This mutant first re-aimed at the `!primitive` check and SURVIVED, because
      // that is not where the count comes from: `unsigned int a : EXTERNAL_BITS;`
      // has a KNOWN declared type, so it enters the packing branch, fails to
      // resolve the WIDTH, and is counted by the branch's own fallback. A mutant
      // that removes the wrong line and survives is a fact about the mutant, not
      // about the code -- and the suite said so rather than passing quietly.
      const from = "        if (unknown) unknown.count++"
      if (!s.includes(from)) throw new Error("#944b anchor not found")
      return s.replace(from, "        if (false && unknown) unknown.count++")
    },
    fixture: "layout-bitfields-unions-945",
    fact: (r) => unknownMembers(r, "UnresolvedWidth") === 1 && unknownMembers(r, "MacroWidth") === 0,
  },
  {
    id: "c-lane/945-bitfield-straddle-packing",
    defectClass: "wrong-payload",
    defect:
      "this wave: a bitfield was charged its declared type's FULL width, so redis's raxNode -- three 1-bit flags and a 29-bit counter on uint32_t, which clang packs into ONE 4-byte unit -- published 16, and quicklist published 56 against clang's 48. The rule implemented is the Itanium psABI one, and the part that matters is the STRADDLE test: a field that would cross a boundary of its declared type moves up to the next such boundary, which is why the cursor is kept in BITS. The mutant restores the whole-member charge. The fact pins BOTH sides of the straddle rule -- a:1 b:31 c:1 needs 8 bytes and a:1 b:30 c:1 needs 4 -- because a bit-sum implementation plus alignment padding gets the first right by accident and only the pair distinguishes a real implementation.",
    revert: (s) => {
      const from = "      if (field.isBitfield && primitive && !isUnion) {"
      if (!s.includes(from)) throw new Error("#945 anchor not found")
      return s.replace(from, "      if (false && field.isBitfield && primitive && !isUnion) {")
    },
    fixture: "layout-bitfields-unions-945",
    fact: (r) =>
      layoutOf(r, "Flags") === "4/4" &&
      layoutOf(r, "Straddle") === "8/4" &&
      layoutOf(r, "StraddleTight") === "4/4" &&
      layoutOf(r, "MacroWidth") === "4/4" &&
      layoutOf(r, "ZeroWidth") === "4/4" &&
      layoutOf(r, "BitThenByte") === "4/4",
  },
  {
    id: "c-lane/946-union-layout-published",
    defectClass: "missing-payload",
    defect:
      "this wave: a UNION published no layout at all. `{ isUnion: true, cSpecific, isConditional }` was the whole metadata object, so every fix from #936 to #945 landed on the struct path only -- and the clang probe filters on `typeof memorySize === \"number\"`, so it silently skipped every union in the corpus. An unmeasured payload is not a payload. The mutant restores the empty metadata. The fact pins that a union's members are MAXED, not summed: a mutant that published the right number by summing would pass UniU32 only by luck, so UniMix (24 summed against clang's 8) is in the fact too.",
    revert: (s) => {
      // The first anchor guessed the STRUCT call site's argument list and so never
      // matched: the union site passes `true` for isUnion and has no
      // hasUnnamedBitfield / declinedCount, because it has no unnamed-bitfield scan.
      const from = "        ...this.layoutPayload(fields, false, structs, unions, is64Bit, isLLP64, bodyIsConditional, true),"
      if (!s.includes(from)) throw new Error("#946 anchor not found")
      return s.replace(from, "")
    },
    fixture: "layout-bitfields-unions-945",
    fact: (r) =>
      layoutOf(r, "UniU32") === "8/8" &&
      layoutOf(r, "UniArr") === "7/1" &&
      layoutOf(r, "UniMix") === "8/8" &&
      // the struct path, which already worked, must be untouched
      layoutOf(r, "StructMix") === "16/8",
  },
  {
    id: "c-lane/947-macro-mediated-member-refused",
    defectClass: "phantom-symbol",
    defect:
      "this wave: `int GIT_CALLBACK(read)(git_odb_stream *, char *, size_t);` with `#define GIT_CALLBACK(name) (*name)` resolves to a single field_identifier reading GIT_CALLBACK -- the real name is consumed by the macro and is NOT a node in the parse -- so four members named GIT_CALLBACK were published in libgit2's git_odb_stream and three in git_odb_writepack, where the real members are read, write, finalize_write, free, append and commit. A member named after a macro is a symbol that does not exist in the program. The mutant restores the publication. Two controls keep the refusal from becoming a deletion: a REAL function-pointer member in the same struct must still be published, and the macro itself must still mint its macro symbol. The test is per-file and syntactic because C requires a function-pointer declarator to be parenthesised and dereferenced -- a chain with a function_declarator and no pointer_declarator cannot be one -- which matters here because GIT_CALLBACK is defined in common.h, a different file, so the analyzer's own macro inventory cannot see it and the first, name-keyed attempt at this fix failed and was withdrawn as unsound.",
    revert: (s) => {
      const from = "              if (declNode && this.isMacroMediatedFunctionPointer(rawDecl)) {"
      if (!s.includes(from)) throw new Error("#947 anchor not found")
      return s.replace(from, "              if (false && declNode && this.isMacroMediatedFunctionPointer(rawDecl)) {")
    },
    fixture: "layout-bitfields-unions-945",
    fact: (r) => {
      const members = (r.symbols ?? []).filter((s: any) => s.ownerName === "MacroFunctionPointer" && s.kind === "property")
      const names = members.map((s: any) => String(s.name))
      // neither the macro's name nor the macro's argument may appear as a member
      if (names.includes("CALLBACK") || names.includes("real_name")) return false
      // and the real function-pointer member must survive
      if (!names.includes("plain")) return false
      // the macro is still a macro
      if (!sym(r, "CALLBACK", "macro")) return false
      // and the struct is marked as a member short
      return unknownMembers(r, "MacroFunctionPointer") === 1
    },
  },
  {
    id: "c-lane/954-callee-must-be-a-name",
    defectClass: "phantom-symbol",
    defect:
      "this wave: `#if PCRE2_CODE_UNIT_WIDTH == 8` in libgit2/deps/pcre2/pcre2_dfa_match.c:3605 published `calls pcre2_dfa_match -> \"8\"`. A number is not callable. Every earlier guard on the call branch listed the shapes it RECOGNISED -- field_expression, subscript_expression, call_expression, parenthesized_expression -- and let everything ELSE fall through to `fnNode.text`, so a callee that was none of the known shapes became a call target by default, which is the wrong default for a field meant to hold a name. The mutant restores that fall-through; the fact pins the three shapes the guard must NOT take with it: a plain call, a function-pointer MEMBER call (whose callee is a field_expression), and a name that is both a macro and a real function.",
    revert: (s) => {
      // The first version of this revert deleted the whole branch by slicing between
      // two offsets, which is how a revert ends up building invalid TypeScript and
      // reporting "2 errors building" instead of a result. Disabling the CONDITION is
      // the faithful revert: the branch stops firing, the fall-through returns, and
      // the source stays parseable.
      const from = "          } else if (fnNode.type !== \"identifier\" && fnNode.type !== \"field_identifier\") {"
      if (!s.includes(from)) throw new Error("#954 anchor not found")
      return s.replace(from, "          } else if (false) {")
    },
    fixture: "call-callee-must-be-a-name-954",
    fact: (r) =>
      // the defect
      !hasEdge(r, "calls", "damaged_while", "8") &&
      // the shapes the guard must not take with it
      hasEdge(r, "calls", "helper", "UNUSED") &&
      hasEdge(r, "calls", "genuine", "real_call") &&
      hasEdge(r, "calls", "via_pointer", "handler"),
    retired: true,
    retiredBecause:
      "SUPERSEDED by c/call-in-directive-condition, and NOT by anything weakening this " +
      "lane. The defect was a call published from a preprocessor DIRECTIVE LINE, and #956 " +
      "established the general rule for that: a call_expression whose physical line starts " +
      "with '#' is directive text, not code. pcre2_dfa_match.c:3605 IS such a line, so the " +
      "directive guard now fires BEFORE the callee-type ladder is reached, and restoring the " +
      "fall-through no longer changes the emitted payload. The fixture cannot see a " +
      "difference that is not there, which is a fact about the two fixes overlapping on one " +
      "input, not about the guard being wrong. The callee-type guard is still present and " +
      "still load-bearing for a directive-FREE non-name callee. As with the other three " +
      "retired mutants, the FACT above still runs on the clean analyzer every gate " +
      "invocation, so the #954 behaviour stays asserted even though the mutation is no " +
      "longer observable.",
  },
  {
    id: "c-lane/950-inline-aggregate-width",
    defectClass: "wrong-payload",
    defect:
      "this wave: an INLINE AGGREGATE MEMBER -- C11's `struct { int a; int b; } inner;` and its union counterpart -- had no computable width. `extractStruct` registers a struct's fields under its NAME, and an anonymous one has none, so the guard `if (structName !== ANON_NAME)` dropped them and the member fell through to the 4-byte unknown fallback. Measured over the three declared corpora: 141 such members across 59 files, and `struct { struct { int a; int b; } inner; char c; }` published 8 bytes where clang says 12. The mutant restores the guard, i.e. the fields are registered but the member cannot find them. The fact pins a nested inline struct and an inline ARRAY of one, because a fix that handled only the flat case would pass AnonStructMember and leave the other two wrong -- and the nested case is the one that needs the recursion to be right rather than merely present.",
    revert: (s) => {
      // The synthetic-key registration is the whole mechanism, so the revert drops
      // the LOOKUP rather than the registration: with the key written but not read,
      // the fields are computed and thrown away, which is the closest analogue to
      // the original defect (present in the tree, absent from the arithmetic).
      const from = "    if (field.anonymousKey && structs[field.anonymousKey]) return field.anonymousKey"
      if (!s.includes(from)) throw new Error("#950 anchor not found")
      return s.replace(from, "    if (false && field.anonymousKey && structs[field.anonymousKey]) return field.anonymousKey")
    },
    fixture: "layout-bitfields-unions-945",
    fact: (r) =>
      layoutOf(r, "AnonStructMember") === "12/4" &&
      layoutOf(r, "NestedAnon") === "12/4" &&
      layoutOf(r, "AnonArrayMember") === "28/4" &&
      layoutOf(r, "AnonUnionMember") === "8/4" &&
      layoutOf(r, "AnonInUnion") === "8/8" &&
      // and the type is no longer marked as a guess, which is the half that matters
      // for the published accuracy figure
      unknownMembers(r, "AnonStructMember") === 0,
  },
  {
    id: "c-lane/948-unnamed-bitfield-marked",
    defectClass: "unverifiable-payload",
    defect:
      "this wave: an UNNAMED bitfield (`unsigned int :0;`) is a layout fact with no name, so the member extractor correctly declines to publish a member for it under the #928/#932 rules -- and the layout consequently never learns it exists. Measured: `struct { unsigned before:3; unsigned :0; unsigned after:3; }` is 8 bytes to clang, because the zero-width field forces `after` into a new 32-bit unit; the model published 4. It is NOT guessed, because packing it needs to know where the marker sits in the bit cursor, and rounding the struct up wherever the marker appears would be right for the common trailing case and confidently wrong everywhere else. The mutant removes the marking. The detector also has a trap worth pinning: tree-sitter parses the absent name as `declarator: (MISSING field_identifier)`, so a presence test passes the very shape over, and the first version of this detector reported nothing.",
    revert: (s) => {
      const from = "    const unknown = { count: (bodyIsConditional || hasUnnamedBitfield ? 1 : 0) + declinedCount }"
      if (!s.includes(from)) throw new Error("#948 anchor not found")
      return s.replace(from, "    const unknown = { count: 0 }")
    },
    fixture: "layout-bitfields-unions-945",
    fact: (r) => unknownMembers(r, "ZeroWidth") === 1 && unknownMembers(r, "Flags") === 0,
  },
  {
    id: "c-lane/940-guess-marked",
    defectClass: "unverifiable-payload",
    defect:
      "this wave: a width the model REFUSES -- a named type declared in another file (C-D2), or `long double` -- was still published as a number, indistinguishable from a computed one. So one rate conflated 'our arithmetic is wrong' with 'we refused and guessed', and a consumer could not tell a measurement from an invention. `layoutUnknownMembers` now marks every member whose width, or whose array COUNT, was not computed, and propagates through the recursive descent and covers bitfields and #ifdef-hidden members -- an earlier version of the flag did none of those and flattered the analyzer by 8 redis types. The mutant removes the marker, and the fact pins that a fully-known type is marked ZERO, so the flag cannot be satisfied by always saying yes.",
    revert: (s) => {
      // The first attempt at this revert swapped the INITIAL count, which is
      // equivalent to the original for every type in the fixture -- none of them
      throw new Error(
        "#940 is retired: this revert's guard no longer exists in its own right. " +
          "#949 reorganised the unmeasured-member accounting into an exclusive " +
          "partition, so the general unresolvable-type count is now `unresolvableType` " +
          "and its consumers are c-lane/944 (that count) and c-lane/948 (the flag's " +
          "initialiser, which covers every source at once). The behaviour #940 " +
          "introduced is still asserted, in two places, and a second mutant reverting " +
          "the same line would be a duplicate rather than a check.",
      )
    },
    fixture: "layout-widths-from-ast-936",
    fact: (r) => unknownMembers(r, "LongDoubleRefused") === 1 && unknownMembers(r, "Plain") === 0 && unknownMembers(r, "WideLL") === 0,
    retired: true,
    retiredBecause:
      "RETIRED 2026-09-29, not because the class is gone but because its guard was " +
      "reorganised out from under it. #940's revert removed the general " +
      "unresolvable-type count; #949 replaced that whole region with an exclusive " +
      "partition in which the same count is the `unresolvableType` branch. The " +
      "marking #940 introduced is still live and still asserted -- c-lane/944 " +
      "reverts that exact count (pinning the bitfield-with-unknown-type instance " +
      "that motivated #944), and c-lane/948 reverts the flag's initialiser, which " +
      "covers every source at once. A retired mutant here means the line is pinned " +
      "elsewhere, NOT that the behaviour is unverified: the FACT below still runs on " +
      "the clean analyzer every gate invocation, so a regression that un-marked a " +
      "refused width would fail the suite through #944 or #948 even with this entry " +
      "retired.",
  },
  {
    id: "c-lane/typedef-return-type-suppressed",
    defectClass: "relationship-loss",
    defect:
      "this wave: CGD34's gate is 'a bare identifier DIRECTLY under a function_definition is the NAME of a phantom function recovered from a macro-mangled declaration', but the predicate tested only the PARENT -- so it suppressed every direct child, and a function_definition's direct children include its RETURN TYPE. A return type spelled with a TYPEDEF name is a type_identifier in exactly that position, so every function declared with a typedef return type lost its references edge: 2,903 return types pass through the gate over 326 corpus files and 37 of them name a type the analyzer can resolve, so 37 real edges were missing. The mutant restores the over-broad predicate, and the fact pins BOTH the recovered edge and the CGD34 subject it must not cost.",
    revert: (s) => {
      const from =
        '(node.parent?.type !== "function_definition" ||\n            (node.type !== "identifier" && node.type !== "field_identifier")) &&'
      if (!s.includes(from)) throw new Error("#935 anchor not found")
      return s.replace(from, 'node.parent?.type !== "function_definition" &&')
    },
    fixture: "typedef-return-type-935",
    fact: (r) =>
      hasEdge(r, "references", "pick_color", "Color") &&
      hasEdge(r, "references", "next_counter", "counter_t") &&
      // CGD34's own subject, which the narrowing must not cost: the macro that
      // decorates the struct definition, and the struct tag itself.
      !hasEdge(r, "uses", "global", "SQLITE_WSD") &&
      !hasEdge(r, "uses", "touch_mem3", "Mem3Like") &&
      // the readings that were always right
      hasEdge(r, "references", "origin", "Point") &&
      hasEdge(r, "references", "pick_shade", "Shade"),
  },
  {
    id: "c/hc6-prototype-parameter-names",
    defectClass: "relationship-fabrication",
    defect:
      "HC6: a prototype's parameter names re-admitted to file-scope resolution fabricate a dangling `uses` (no such symbol exists).",
    revert: (s) => s.replace(" && !this.isInsideParameterList(n)) {", " && true) {"),
    fixture: "declaration-identity",
    fact: (r) => !hasEdge(r, "uses", "main", "count"),
  },
  {
    id: "c/hc1-static-prototype-visibility",
    defectClass: "payload",
    defect:
      "HC1: the function-prototype branch hardcoded `visibility: public`, so `static int hidden(int);` surfaced as public API and in the export list.",
    revert: (s) =>
      s.replace(
        '              visibility: isStatic ? "private" : "public",\n              metadata: { isDeclaration: true, cSpecific: true, isConditional },',
        '              visibility: "public",\n              metadata: { isDeclaration: true, cSpecific: true, isConditional },',
      ),
    fixture: "declaration-identity",
    fact: (r) => sym(r, "hidden", "function")?.visibility === "private",
  },
  {
    id: "c/hc2-redeclaration-merge",
    defectClass: "symbol-duplication",
    defect:
      "HC2: tentative definitions, extern+definition and prototype+definition pairs each emitted one symbol per occurrence (and the prototype case double-exported one function).",
    revert: (s) => s.replace("      if (drop.size > 0) {", "      if (false && drop.size > 0) {"),
    fixture: "declaration-identity",
    fact: (r) => (r.symbols ?? []).filter((s: any) => s.name === "tally" && s.kind === "variable").length === 1,
  },
  {
    id: "c/hc3-knr-parameters",
    defectClass: "payload-loss",
    defect:
      "HC3: K&R / untyped parameter names parse as bare `identifier` children of the parameter_list; a scan that accepts only parameter_declaration/variadic drops them from the payload.",
    revert: (s) =>
      s.replace('        if (paramNode && paramNode.type === "identifier") {', '        if (false && paramNode && paramNode.type === "identifier") {'),
    fixture: "declaration-identity",
    fact: (r) => (sym(r, "add", "function")?.parameters ?? []).length === 2,
  },
  {
    id: "c/hc5-cross-file-memo",
    defectClass: "state-leak",
    defect:
      "HC5: the CGD19 per-ERROR-span memo was instance state keyed by span startIndex and never reset between analyze() calls, so any consumer that REUSES an instance (differential lanes, F4 runs, batch indexing, long-lived processes) applied file A's verdict to file B's same-offset ERROR span. The engine path builds a fresh instance per file, which is why only the shared-instance consumers ever saw it. The fact needs TWO files and ONE shared instance, so it carries its own inputs.",
    revert: (s) => s.replace("    this.cgd19HeaderIdx.clear()\n", ""),
    fixture: "declaration-identity",
    fact: () => true,
    twoFile: {
      a: { name: "hc5-file-a.c", src: MUT_HC5_A },
      b: { name: "hc5-file-b.c", src: MUT_HC5_B },
      check: (Cls: any) => {
        const inst = new Cls()
        inst.analyze(cparser.parse(MUT_HC5_A).rootNode, MUT_HC5_A, "hc5-file-a.c")
        const b: any = inst.analyze(cparser.parse(MUT_HC5_B).rootNode, MUT_HC5_B, "hc5-file-b.c")
        return (b.symbols ?? []).some((s: any) => s.name === "clean")
      },
    },
  },
  {
    id: "c/907-glue-recovery",
    defectClass: "symbol-loss",
    defect:
      "#907: a top-level definition that parse recovery absorbs into a preceding function's body survived only as an ERROR holding a type node plus a bare function_declarator; without the recovery the public API function vanishes from the catalog.",
    revert: (s) => s.replace("      this.recoverGluedDefinitionHeader(node, content, symbols)", "      void node"),
    fixture: "swallowed-definitions-907",
    fact: (r) => !!sym(r, "jv_dumpf", "function"),
  },
  {
    id: "c/917-macro-wrapped-heading",
    defectClass: "symbol-loss",
    defect:
      "#917: `MACRO(ret, name)(params){ body }` is CALL-shaped, so the body arrives as an orphan compound_statement with no Function scope and the definition was never a symbol (235 such definitions across sqlite's libcmpp.c/sqlite3-jni.c).",
    revert: (s) => s.replace("          const wrapped = this.macroWrappedHeaders.get(node.startIndex)", "          const wrapped = undefined as any"),
    fixture: "macro-wrapped-heading-917",
    fact: (r) => !!sym(r, "cmpp_stream", "function"),
  },
  {
    id: "c/918-pointer-return-wrapped-heading",
    defectClass: "symbol-loss",
    defect:
      "#918: the POINTER-RETURN spelling parses as a function_definition whose `declarator` is the PARAMETER LIST, so the declarator route finds no callable and the definition was never a symbol. The fact names `cmpp_b_borrow` (the function_definition spelling) rather than `cmpp_mrealloc` (the declaration spelling, which the `declaration` branch recovers independently) -- a first draft of this mutant checked the wrong one and SURVIVED, which is why the runner reports BAD-FACT and SURVIVED as different outcomes.",
    revert: (s) => s.replace("            const typed = macroWrappedTypedHeadingShape(node)", "            const typed = null as any"),
    fixture: "macro-wrapped-pointer-heading-918",
    fact: (r) => !!sym(r, "cmpp_b_borrow", "function") && !!sym(r, "cmpp_mrealloc", "function"),
  },
  {
    id: "c/901-valueless-macro-symbol",
    defectClass: "symbol-loss",
    defect:
      "#901: a `#define NAME` with no value body was skipped, so a later read of that name was unresolvable and the edge was lost (the only 100%-coverage lane in the sweep with MISSING=2 was both edges of this shape).",
    revert: (s) =>
      s.replace(
        '    const isFunctionLikeMacro = node.type === "preproc_function_def"',
        '    if (!node.childForFieldName("value")) return\n    const isFunctionLikeMacro = node.type === "preproc_function_def"',
      ),
    fixture: "macro-forward-read",
    fact: (r) => !!sym(r, "M60_TRACE_FLAG") && hasEdge(r, "uses", "global", "M60_TRACE_FLAG"),
  },
  {
    id: "c/m59-callsite-line",
    defectClass: "line-contract",
    defect:
      "M59.A7: the call edge took the line of the construct that CONTAINS the name (`obj->method()`'s call_expression starts at the receiver), so a newline-continued member call pointed at the receiver's line -- the scala/java/groovy defect class, in C's node shape. The fixture writes `return c` on 44 and `->record(c, n);` on 46.",
    revert: (s) =>
      s.replace(
        '              line_number: this.nodeLine(targetNode),\n              metadata: { relationshipType: "c_function_call", isFunctionPointer: isFuncPtr },',
        '              line_number: this.nodeLine(node),\n              metadata: { relationshipType: "c_function_call", isFunctionPointer: isFuncPtr },',
      ),
    fixture: "callsite-lines-825",
    fact: (r) => edgesOf(r, "calls", "run", "record")[0]?.line_number === 46,
  },
  {
    id: "c/m59-contains-name-line",
    retired: true,
    retiredBecause:
      "In C the two candidate lines COINCIDE: the member extractor ranges a field at its DECLARATOR (rawDecl), not at the whole field_declaration, so range.startLine already IS the name's line and the revert is byte-identical on the fixture (measured 16/16, 17/17, 23/23, 25/25, 32/32, 33/33, 31/31). The rule is enforced in the analyzer; no C test of it can fail. Same measurement that retired cpp/metadata-only-line-second-base.",
    defectClass: "line-contract",
    defect:
      "M59.A7 + #921: the contains edge took the enclosing declaration's line instead of the line that NAMES the member. The fixture writes `unsigned long long` on 15 and `counter;` on 16.",
    revert: (s) => s,
    fixture: "contains-name-line-921",
    fact: () => true,
  },
  {
    id: "c/cgd33-type-only-uses",
    retired: true,
    retiredBecause:
      "The shape the guards were written for is no longer produced: the #743 grammar wave added macro_prefixed_type_specifier, so `static WSD_MACRO struct Mem3Like {...}` parses as a REAL struct with no bare identifier under a phantom function_definition, and there is nothing left to suppress. Reverting both guards changes no fixture output. What is missing is a REACHABLE INPUT for the class, which is a completeness-ledger row rather than a permanently-passing mutant.",
    defectClass: "relationship-fabrication",
    defect:
      "CGD33 + CGD34: a plain identifier that resolves ONLY as a type is a parse artifact, not a value read. The two gates COOPERATE and are individually redundant -- a first draft reverted only CGD33 and SURVIVED, because CGD34 (a bare identifier directly under a function_definition) still blocked the site. Reverting both still leaves the fixture unchanged, because the shape is unreachable.",
    revert: (s) => s,
    fixture: "cgd31-37-regressions",
    fact: () => true,
  },
  {
    id: "c/cgd1-write-as-read",
    defectClass: "relationship-fabrication",
    defect:
      "SCD1 + CGD1 + CGD37 held that an assignment LHS is a WRITE, never a read, enforced by three cooperating gates: the field_expression branch's isWrite span test, the identifier branch's LHS span test, and CGD37 for the field leaf. #960 WITHDREW THE RULE, so the defect this mutant reintroduces is now the CORRECT behaviour and the fact's polarity is inverted.",
    revert: (s) =>
      s,
    fixture: "c-completeness",
    fact: (r) => hasEdge(r, "uses", "set_value", "value") && hasEdge(r, "uses", "compute", "value"),
    retired: true,
    retiredBecause:
      "SUPERSEDED by #960, which reversed the rule this mutant enforces. The mutant reverted " +
      "all three write-suppression gates to prove they cooperate, and its fact asserted " +
      "`!hasEdge(set_value -> value)`. #960 removed those gates because (a) the analyzer was " +
      "ALREADY inconsistent with itself -- `p->f++` published a `uses` while the " +
      "semantically identical `p->f += 1` did not, purely because the grammar folds " +
      "compound-assign into `assignment_expression` while `++` is an `update_expression`, so " +
      "there was no reading under which the two differed; and (b) the pinned M12 truth " +
      "requires the edge (`uses:buffer_create:capacity` for `buf->capacity = clamp(...)`), " +
      "and with both branches fixed the truth's not-produced count is 0. With the gates gone, " +
      "reverting them is a no-op and the negated fact reports BAD-FACT on a clean analyzer -- " +
      "the harness correctly refusing to convict an analyzer for being correct. The FACT " +
      "above still runs every gate invocation and now asserts the INCLUSIVE behaviour, so " +
      "the property stays pinned in the direction that is now correct. A fifth retired " +
      "mutant with a stated reason.",
  },
  {
    id: "c/cgd36-function-value-before-def",
    defectClass: "relationship-loss",
    defect:
      "CGD36: a function DEFINITION name is a file-scope declaration even though the pre-pass is inside the function subtree, so a VALUE read of a function before its definition resolved only through the order-dependent symbol and dropped the edge. The mutant SURVIVED the first time and the reason was a FIXTURE defect, not a gate defect: cgd31-37-regressions.c DEFINES `later_defined` on line 21 and reads it on 25 and 28, while its own comment claims to pin the read-BEFORE-definition order (vdbeaux.c L2220 read / L2258 def). With the definition first the edge resolves through the ordinary symbol walk and the declaredNames pre-pass is never exercised, so the fixture never tested the property it names. The fixture now carries a genuine read-before-definition pair. A second draft then survived for a subtler reason: the clause it reverted is not what carries CGD36, because `isProto` already returns TRUE for a definition name (it walks up to `function_definition` and returns true there) -- the class needs the pre-pass ENTRY removed, not one of its guards.",
    revert: (s) => {
      const from =
        "if (isProto || isMacroName || !(isInsideCompoundStatement || isGlueFdName || this.isCgd19SuppressedVarDecl(n))) {"
      if (!s.includes(from)) throw new Error("CGD36 anchor not found")
      return s.replace(from, "if (isMacroName) {")
    },
    fixture: "cgd31-37-regressions",
    fact: (r) =>
      // The read-BEFORE-definition row is the one only the pre-pass can produce;
      // the read-AFTER rows come from the ordinary symbol walk and must survive
      // the mutant, so pinning all three says "the pre-pass is load-bearing for
      // the forward read and for nothing else".
      hasEdge(r, "uses", "read_defined_later", "defined_far_below") &&
      hasEdge(r, "uses", "use_later", "later_defined") &&
      hasEdge(r, "uses", "global", "later_defined"),
  },
  {
    id: "c/cgd31-callee-field-leaf",
    defectClass: "relationship-duplication",
    defect:
      "CGD31: a `field_identifier` leaf under a CALLEE-position field_expression (`t->hook(t)`) re-emitted a `uses` the `calls` edge already carries. An earlier draft of this mutant prefixed the condition with `!false && `, which changed the source text (so the harness believed the mutant applied) while disabling nothing; the anchor is matched on the WHOLE condition here.",
    revert: (s) => {
      const anchor =
        /          !\(node\.parent\?\.type === "field_expression" &&\n            node\.parent\.parent\?\.type === "call_expression" &&[\s\S]*?node\.parent\.childForFieldName\("field"\)\?\.startIndex === node\.startIndex\n          \) &&/
      if (!anchor.test(s)) throw new Error("CGD31 anchor not found")
      return s.replace(anchor, "          true &&")
    },
    fixture: "field-read-single-edge",
    fact: (r) => !hasEdge(r, "uses", "call_hook", "hook") && hasEdge(r, "calls", "call_hook", "hook"),
  },
  {
    id: "c/field-name-in-macro-argument",
    defectClass: "relationship-underproduction",
    defect:
      "A field named as a MACRO ARGUMENT publishes a `uses` edge from file scope: `offsetof(clusterMsg, sig)` is `uses global -> sig` with relationshipType `identifier_usage` and nodeType `field_identifier`. redis/src/cluster_legacy.h:268-284 is seventeen of these in a row -- the static assertions a C project uses to pin its wire-format struct layout. A field-access adjudicator that modelled only `field_expression` on its parse side reported all 17 as phantom over-emissions (74 across redis/src), and 'a field name at file scope is not a use of anything' is a plausible-looking fix that deletes the only record those fields are load-bearing. This is #908's failure one relationship type over: there macro-named CALLEES were nearly suppressed, here macro-argument FIELD NAMES were. The M12 truth cannot catch it -- it pins `uses` only for `a->x` and is silent on a field named in a macro argument -- which is why the fixture had to be written.",
    revert: (s) => {
      const anchor =
        /          \(this\.isResolvableUseTarget\(text, node\.type, symbols, globalVars, structs, unions, enums, declaredTypes, declaredNames\) \|\| resolvesAsType\) &&/
      if (!anchor.test(s)) throw new Error("field-name-in-macro-argument anchor not found")
      // Narrow on purpose: keyed on the node TYPE as well as the scope, because a
      // bare `global -> <identifier>` use is pinned elsewhere (the macro
      // forward-read mutant requires `uses global -> later_defined`), and a
      // blanket scope suppression would take that row with it and make this
      // mutant convict the wrong regression.
      // No `$1`: the regex has no capture group, and `String.replace` leaves a
      // `$1` with nothing to substitute as the LITERAL text "$1", which is
      // invalid TypeScript and made the revert fail to build. An earlier draft
      // carried the group marker out of habit from the CGD31 mutant above, whose
      // regex does capture.
      return s.replace(
        anchor,
        `$&\n          !(sourceScope === "global" && node.type === "field_identifier") &&`,
      )
    },
    fixture: "field-access-offsetof-955",
    // Asserts the edge IS present on the clean analyzer. This mutant is
    // UNDERproduction -- it removes the edge -- so the fact is the positive
    // form, unlike cgd31 above whose defect is a duplicate and whose fact is
    // therefore negative. Getting that polarity backwards reports BAD-FACT on a
    // clean analyzer, which is the harness correctly refusing to convict itself.
    fact: (r) => hasEdge(r, "uses", "global", "sig") && hasEdge(r, "uses", "header_length", "totlen"),
  },
  {
    id: "c/call-in-directive-condition",
    defectClass: "relationship-fabrication",
    defect:
      "A `call_expression` inside a preprocessor DIRECTIVE published a `calls` edge: `#if !defined(A) && !defined(B)` produced `calls global -> defined`, twice per condition. `defined` is a preprocessor OPERATOR, not a callable name, and a directive condition never executes -- the preprocessor is line-anchored text (C-D2), so the edge is fabricated from file scope. call-edge-fidelity.ts measured 61 over-emitted call sites over 200 files per corpus, all of this shape: curl_trc.c:554/575/590/598, protocol.c:92/120/147, http.c:690-692/735-739/822, openldap.c:936-937, cf-ip-happy.c:76/79, curl_sha512_256.c:303, plus 7 in redis. The class survived because the `uses` path has refused it since CGD40 with two guards and the `calls` path had NEITHER -- the guard existed on the sibling path and nobody asked why the two branches differed. THIS MUTANT REMOVES ONLY THE LINE-ANCHORED GUARD (`isHashLineMention`), leaving the structural one. It is the more interesting of the two because the structural guard is the one that looks sufficient: a cleanly parsed directive keeps its preproc_* ancestor, so the walk finds it. What the structural guard cannot see is an initializer list left OPEN across interleaved #ifdefs (curl_trc.c:530-556, guarded entries with the closing `};` eight lines later), which puts the `#if` line inside an ERROR with no preproc_* ancestor at all. A fixture built from a tidy `#if defined(X)` reproduces nothing, because a clean directive emits no call_expression in the first place -- so this mutant is aimed at the damaged form on purpose.",
    revert: (s) => {
      // Disable the line-anchored test entirely.
      //
      // This mutant's target MOVED during the fix, which is worth recording. The
      // first version applied BOTH guards -- `isDirectiveConditionText(node) ||
      // isHashLineMention(node)` -- and the structural half turned out to suppress
      // 15 REAL calls (curl_sasl.c:531-545, cfilters.c, strerr.c), because a
      // `preproc_ifdef` owns both its condition AND its guarded body, so walking
      // up from a call in the body reaches the preproc node. Measuring the
      // under-emission direction is what caught it: agreement fell 99.97% ->
      // 99.89%. The surviving guard is the line-anchored one, which is also the
      // only one that fires on the defect -- in the swallowed initializer the
      // ERROR node has removed the preproc_* ancestor entirely.
      const anchor = "        const inDirectiveCondition = this.isHashLineMention(node)"
      if (!s.includes(anchor)) throw new Error("call-in-directive-condition anchor not found")
      return s.replace(anchor, "        const inDirectiveCondition = false")
    },
    fixture: "call-in-directive-condition-956",
    fact: (r) => !hasEdge(r, "calls", "global", "defined") && hasEdge(r, "calls", "live_calls", "real_helper"),
  },
  {
    id: "c/conditional-member-not-published",
    defectClass: "relationship-underproduction",
    defect:
      "#957: a member declared inside a preprocessor CONDITION was never published. `typedef struct eventNotifier { #ifdef HAVE_EVENT_FD int efd; #else int pipefd[2]; #endif }` (redis/src/eventnotifier.h:19-25) parses with the `preproc_ifdef` as a DIRECT child of the `field_declaration_list` and NO `field_declaration` at that level, so iterating named children found nothing and the struct was published with a symbol and ZERO `contains` edges. Found by contains-vs-clang.ts -- the first oracle in this lane to judge `contains` against a parser that is not the one the analyzer uses. Every tree-sitter-based counter reported the file CLEAN, because the payload and the grammar agree, and that agreement is not evidence about the grammar: a member the grammar never emits as a `field_declaration` cannot be found by a probe that looks for `field_declaration`. The fix descends into BOTH arms -- the preprocessor is textual (C-D2) so the analyzer cannot know which arm a project compiles with, and the honest superset is both. The fact pins an unconditional member and a bitfield alongside, so a fix that over-reached into ordinary members would fail here rather than pass.",
    revert: (s) => {
      const anchor = "          if (child.type === \"preproc_ifdef\" || child.type === \"preproc_if\") {"
      if (!s.includes(anchor)) throw new Error("#957 anchor not found")
      return s.replace(anchor, "          if (false) {")
    },
    fixture: "contains-conditional-and-nested-958",
    fact: (r) =>
      // the defect: a member under #ifdef and one under #else
      hasEdge(r, "contains", "guarded", "primary") &&
      hasEdge(r, "contains", "guarded", "fallback") &&
      // the shapes the fix must not take with it
      hasEdge(r, "contains", "guarded", "always") &&
      hasEdge(r, "contains", "controls", "bits") &&
      hasEdge(r, "calls", "uses_controls", "helper"),
  },
  {
    id: "c/nested-member-placeholder-owner",
    defectClass: "dangling-edge",
    defect:
      "#958: a member of a nested anonymous aggregate was published under a PLACEHOLDER owner. `struct R { union { const char *str; struct { const char *str; const char *format; } verbatim_str; } val; }` produced `anonymous_union.verbatim_str -> str` (redis/src/call_reply.c:30-38) instead of `CallReply.val.verbatim_str -> str`, because `inlineAggregateOwnerName` asked the ENCLOSING aggregate for its own name and an anonymous union has only the placeholder. `anonymous_union` names no symbol, so the edge dangles for any consumer resolving a contains source -- the same shape as the ruled-out `global contains X`. The correct path composes from the member that CARRIES the outer aggregate, which the outer aggregate's own (already correct) answer supplies. The fact pins the right path AND the wrong one, so both halves of the mis-attribution are covered: a fix that moved the path to the right key while leaving the placeholder edge in place would still fail.",
    revert: (s) => {
      const anchor =
        /    const carried = this\.inlineAggregateOwnerName\(ownerSpecifier\)\n    return carried \? `\$\{carried\}\.\$\{memberName\.text\.trim\(\)\}` : `\$\{ownerName\}\.\$\{memberName\.text\.trim\(\)\}`/
      if (!anchor.test(s)) throw new Error("#958 anchor not found")
      return s.replace(anchor, "    return `${ownerName}.${memberName.text.trim()}`")
    },
    fixture: "contains-conditional-and-nested-958",
    fact: (r) =>
      hasEdge(r, "contains", "envelope.body.verbatim", "text") &&
      hasEdge(r, "contains", "envelope.body.verbatim", "format") &&
      // a NAMED nested struct keeps its own member name, not the enclosing tag
      hasEdge(r, "contains", "named_outer.group", "inner_a") &&
      // the placeholder edge is gone
      !hasEdge(r, "contains", "anonymous_union.verbatim", "text"),
  },
  {
    id: "c/function-local-type-dropped",
    defectClass: "relationship-underproduction",
    defect:
      "#961: CGD20 dropped every function-local type as an 'execution artifact (C-D1)' -- no scope, no symbol, no field registration. A struct definition EMITS NO CODE: the local VARIABLE is the execution artifact, and the type is a compile-time fact whose VISIBILITY the block merely limits. Measured: 20 function-local named types carrying 65 members across 15 files, NONE published, and the ones that exist are used -- deps/jemalloc/test/unit/malloc_io.c:14 `struct test_s`, src/ebuckets.c:2230 `struct TestParams` (the benchmark's parameter table), src/listpack.c:1920 `struct pick`. The decisive evidence was in this lane's OWN output: the payload already published `uses local_type_in_use -> index`, a use of a member of a type it refused to declare, unresolvable because the only declaration was the suppressed one. The mutant restores the exclusion on all THREE spellings, because a ruling covering two of three is half a ruling -- and the fixture caught exactly that when the union arm was missed. The fact pins the QUALIFIED owner path (`local_type_in_use.pick`), because the bare name is not the fix: 3 of the corpus's 20 local type names collide with a file-scope type (`transfer`, `entry`, `clar_counter`), and a looser fact would pass a mutant that publishes the bare `pick` and produces two symbols with one name.",
    revert: (s) => {
      // Each anchor is replaced with an INACTIVE form that still parses. A braced
      // `if` cannot simply be prefixed with `false &&` -- the body would then be
      // unconditional -- so the union's block is replaced whole, which is why a
      // prefix-only revert reported "2 errors building" rather than a result.
      const pairs: Array<[string, string]> = [
        [
          '    if (scope && scope !== "global" && this.inlineAggregateOwnerName(node) === null) structName = scope',
          "    // #961 reverted: the function-local qualification is off.",
        ],
        [
          '    if (scope && scope !== "global" && enumName === "anonymous_enum") enumName = scope',
          "    // #961 reverted: the function-local qualification is off.",
        ],
        [
          '    if (scope && scope !== "global" && unionName === "anonymous_union" && this.inlineAggregateOwnerName(node) === null) {\n      unionName = scope\n    }',
          "    // #961 reverted: the function-local qualification is off.",
        ],
      ]
      for (const [from, to] of pairs) {
        if (!s.includes(from)) throw new Error("#961 anchor not found: " + from.slice(0, 60))
        s = s.replace(from, to)
      }
      return s
    },
    fixture: "function-local-type-959",
    // The fact asserts the edges ARE PRESENT: this mutant is UNDERPRODUCTION, so the
    // clean analyzer must satisfy the positive form and the mutant must break it. Writing
    // the negations here reports BAD-FACT on a clean analyzer, which is the harness
    // correctly refusing to convict itself -- the same polarity mistake as #960's
    // c/cgd1-write-as-read.
    fact: (r) =>
      // the defect: a function-local struct, union and enum all published
      hasEdge(r, "contains", "local_type_in_use.pick", "index") &&
      hasEdge(r, "contains", "local_union_and_enum.anonymous_union", "as_int") &&
      hasEdge(r, "contains", "local_union_and_enum", "LOCAL_A") &&
      // the shapes the fix must not take with it
      hasEdge(r, "contains", "file_scope", "width") &&
      hasEdge(r, "contains", "alias_anon", "x") &&
      hasEdge(r, "uses", "local_variable_is_not_a_symbol", "width") &&
      // a function-local VARIABLE is still not a symbol -- the part of C-D1 that was
      // always right
      !hasEdge(r, "uses", "global", "counter"),
  },
  {
    id: "c/instantiates-target-is-the-allocator",
    defectClass: "wrong-payload",
    defect:
      "#962: `instantiates` names the TYPE an allocation produces, not the allocator. The M12 C truth defines the relationship C-specifically ('instantiates = allocator calls -- C-specific allocation semantic') and pins `buffer_create -> malloc`; the analyzer had removed it entirely with the note 'malloc allocates BYTES, not a named type - an Instantiates edge to the literal malloc could never resolve to a type symbol and was pure noise'. That reasoning is right about the TARGET and wrong about the consequence: across all 25 M12 truths that pin an `instantiates` edge the target is always a TYPE -- `Point`, `HashMap`, `List`, `Dictionary`, `User`, `MemoryStorage` -- and C's `-> malloc` was the only non-type target in the family. So the relationship is restored and the target read from the CAST and from `sizeof`, which disagree in practice about which carries the type. The mutant replaces the type with the allocator name. Its fact pins the four PUBLISHING shapes (cast+sizeof, sizeof-only, cast-only, and an allocation in a function that also frees) and the two NON-publishing ones (an untyped allocation, and a cast to a type the file does not declare), because a fix that published `-> malloc` would satisfy the original truth row while breaking the family's meaning.",
    revert: (s) => {
      const from = "              if (qcFn) {\n                const instantiated = this.allocatedTypeName(node, declaredTypes, structs, unions, enums)"
      if (!s.includes(from)) throw new Error("#962 anchor not found")
      return s.replace(from, "              if (qcFn) {\n                const instantiated = target")
    },
    fixture: "instantiates-allocated-type-962",
    fact: (r) =>
      // the defect: the target is the allocator, not the type
      hasEdge(r, "instantiates", "buf_alloc", "Buf") &&
      hasEdge(r, "instantiates", "node_alloc", "Node") &&
      hasEdge(r, "instantiates", "buf_grow", "Buf") &&
      hasEdge(r, "instantiates", "buf_copy", "Buf") &&
      // the shapes the fix must not take with it
      !hasEdge(r, "instantiates", "untyped_alloc", "malloc") &&
      !hasEdge(r, "instantiates", "dup", "malloc") &&
      // and the `calls` edge the truth says is the intentional PAIR
      hasEdge(r, "calls", "buf_alloc", "malloc"),
  },
  {
    id: "c/parenthesized-declarator-is-not-a-function-pointer",
    defectClass: "wrong-symbol-kind",
    defect:
      "#971: a `parenthesized_declarator` under a `function_declarator` was treated as a function POINTER on the strength of the parentheses alone. Parentheses around a declarator are GROUPING and mean nothing (C 6.7.6.3), so the two constructs below are opposites that differ only by what the parens CONTAIN, and the old test got BOTH wrong:\n\n  int (grouped)(int n);     function_declarator > parenthesized_declarator > identifier\n                                    -> a FUNCTION, published as a `variable`\n  int (*fnptr)(int n);      function_declarator > parenthesized_declarator > pointer_declarator\n                                    -> a VARIABLE, which is a real function pointer\n\nSo this is a wrong symbol KIND, not a missing symbol: consumers resolve calls and references against it, so a grouped-prototype function was invisible to call resolution while looking like data. Measured at redis/deps/lua/src/lauxlib.c:229 `LUALIB_API void (luaL_register) (...)`, where paren_proto/paren_void/paren_ptr were all published as variables.\n\nDEFINITIONS were never affected -- `paren_defn:function` -- because they take the function_definition path at CGD38, which descends the declarator chain properly. The defect was therefore specific to PROTOTYPES and invisible to any test that only defined its functions, which is why it survived.\n\nThe mutant restores the parentheses-only test. Its fact asserts the three grouped prototypes are FUNCTIONS and that the genuine function pointer is still a VARIABLE, because a fix that simply dropped the special case would publish `fnptr` as a function and pass the first three.",
    revert: (s) => {
      const from = "              if (descendsToPointer(innerDecl)) isFuncType = false // a genuine function POINTER"
      if (!s.includes(from)) throw new Error("#971 anchor not found")
      return s.replace(from, "              if (innerDecl && innerDecl.type === \"parenthesized_declarator\") isFuncType = false")
    },
    fixture: "parenthesized-declarator-name-971",
    fact: (r) =>
      // grouped declarators are FUNCTIONS
      !!sym(r, "grouped_scalar", "function") &&
      !!sym(r, "grouped_void_return", "function") &&
      !!sym(r, "prototyped", "function") &&
      // the genuine function POINTER is still a variable -- the distinction, not
      // the absence of the old test
      !!sym(r, "grouped_pointer", "variable") &&
      // and the declaring occurrence is not a read of itself
      !hasEdge(r, "uses", "global", "grouped_scalar") &&
      !hasEdge(r, "uses", "global", "prototyped"),
  },
  {
    id: "c/name-maps-must-not-inherit-object-prototype",
    defectClass: "relationship-fabrication",
    defect:
      "#972: the four name maps keyed by arbitrary C identifiers -- structs, globalVars, unions, enums -- were plain `{}`, so a lookup of any Object.prototype member name returned a truthy INHERITED value: `structs['constructor']` is Object, `structs['toString']` is a function. isResolvableUseTarget ends in `if (globalVars[name] || structs[name] || unions[name] || enums[name]) return true`, so such a name passed the resolvability gate and was published as a `uses` edge whether or not anything in the file declared it.\n\nMeasured at zig/lib/libc/mingw/winpthreads/thread.c:92, where `static void __attribute__((constructor))` -- `constructor` is a gcc attribute token, declared NOWHERE -- produced `uses ctor -> constructor`, a dangling edge to a name with no symbol. The diagnostic that found it: all four maps claimed the name simultaneously (globalVars=true structs=true unions=true enums=true), the signature of an inherited lookup rather than a declaration.\n\n`constructor` is the rare name. `toString`, `valueOf`, `hasOwnProperty`, `propertyIsEnumerable` and `isPrototypeOf` are ORDINARY C identifiers, so this is a live class.\n\nThe mutant restores `{}`. Its fact asserts the reads of the prototype-member names are silent AND that an ordinary global read still resolves, because a fix that made the maps refuse to answer would pass the first set by answering nothing -- the controls in the fixture exist for exactly that reason.",
    revert: (s) => {
      const from = "    const structs: Record<string, any[]> = Object.create(null)\n    const globalVars: Record<string, boolean> = Object.create(null)\n    const unions: Record<string, any[]> = Object.create(null)\n    const enums: Record<string, boolean> = Object.create(null)"
      if (!s.includes(from)) throw new Error("#972 anchor not found")
      return s.replace(from, "    const structs: Record<string, any[]> = {}\n    const globalVars: Record<string, boolean> = {}\n    const unions: Record<string, any[]> = {}\n    const enums: Record<string, boolean> = {}")
    },
    fixture: "prototype-member-names-972",
    fact: (r) =>
      // the inherited members resolve to nothing
      !hasEdge(r, "uses", "attributed_init", "constructor") &&
      !hasEdge(r, "uses", "controls", "toString") &&
      !hasEdge(r, "uses", "controls", "valueOf") &&
      !hasEdge(r, "uses", "controls", "hasOwnProperty") &&
      // CONTROLS: the maps still answer truthfully, so this cannot be satisfied by a
      // map that refuses every lookup
      hasEdge(r, "uses", "controls", "real_global") &&
      hasEdge(r, "uses", "attributed_init", "real_global") &&
      hasEdge(r, "calls", "controls", "real_function"),
  },
  {
    id: "c/exports-name-is-the-macro-argument",
    defectClass: "wrong-payload",
    defect:
      "#963: `exports` had THREE independent defects, and this mutant reinstates all three at once because each alone is enough to make the relation wrong. (1) The marker list held only kernel macros, so three userspace codebases -- curl's CURL_EXTERN, libgit2's GIT_EXTERN, redis's REDISMODULE_API -- had no listed marker at all. (2) Only the CALL spelling was handled; the userspace PREFIX spelling (`CURL_EXTERN int curl_strequal(...)`) reaches no export branch, because the marker is a prefix on an ordinary declaration rather than a call. Together (1) and (2) are why the relation fired ZERO times across 2,798 corpus files while the M12 truth family expects a populated `exports`. (3) The target was a synthesised constant `KERNEL_EXPORT` that appears in no source file anywhere -- a fabricated target of the same class #962 removed from `instantiates` (-> malloc), pinned as if it were ground truth by c-completeness. The mutant disables the declaration path and restores the fabricated target. Its fact pins all four conventions that survive the C parse AND the two phantoms the fix must not produce, because a fix that only added the macro names would satisfy the positive form while still publishing a type or a marker as an exported name.",
    revert: (s) => {
      const pairs: [string, string][] = [
        [
          // #989 rewrapped this condition over five lines, so the anchor follows it.
          // The revert still disables the WHOLE marker test (fixed list AND the
          // structural rule), which is the pre-#989 behaviour and the strongest form
          // of this defect; #989's own mutant disables only the structural half.
          '              if (\n                marker &&\n                (inArray(EXPORT_MACROS, marker) || linkageMarkerNames.has(marker)) &&\n                node.childForFieldName("declarator")\n              ) {',
          "              if (false && marker && inArray(EXPORT_MACROS, marker) && node.childForFieldName(\"declarator\")) {",
        ],
        [
          '                  line_number: this.nodeLine(nameNode),\n                  metadata: { relationshipType: "module_export", exportMacro: target },',
          '                  line_number: this.nodeLine(nameNode),\n                  target: "KERNEL_EXPORT",\n                  metadata: { relationshipType: "module_export", exportMacro: target },',
        ],
      ]
      for (const [from, to] of pairs) {
        if (!s.includes(from)) throw new Error("#963 anchor not found: " + from.slice(0, 60))
        s = s.replace(from, to)
      }
      return s
    },
    fixture: "exports-marker-conventions-963",
    // Polarity: the fabricated-target half of the defect makes this an OVER-production
    // mutant in one respect (it adds a `-> KERNEL_EXPORT` edge that resolves to nothing)
    // and an UNDER-production one in another (it deletes every prefixed form). The fact
    // therefore asserts the positive form for all four conventions and the NEGATIVE form
    // for the fabricated target, so it convicts whichever half survives.
    fact: (r) =>
      // all four conventions, each to the marker macro AS WRITTEN
      hasEdge(r, "exports", "kernel_exported_symbol", "EXPORT_SYMBOL") &&
      hasEdge(r, "exports", "curl_strequal", "CURL_EXTERN") &&
      hasEdge(r, "exports", "git_libgit2_version", "GIT_EXTERN") &&
      hasEdge(r, "exports", "RedisModule_Alloc", "REDISMODULE_API") &&
      // the phantoms the fix must NOT publish
      !hasEdge(r, "exports", "int", "GIT_EXTERN") &&
      !hasEdge(r, "exports", "CURL_EXTERN", "CURL_EXTERN") &&
      // the fabricated target is gone for good: nothing exports to a name that is
      // written in no source file
      !hasEdge(r, "exports", "kernel_exported_symbol", "KERNEL_EXPORT") &&
      // and the source is a real declared name, not the recovered typedef
      !hasEdge(r, "exports", "CURLcode", "CURL_EXTERN"),
  },
  {
    id: "c-lane/989-overrides-arm-exclusivity",
    defectClass: "relationship-omission",
    defect:
      "#989: `overrides` was absent from the C lane on the PROSE 'C-D1: no class hierarchy', which is the reasoning `script/m14/ontology-coverage-gate.ts` was written to distrust -- `overrides` was missing from bash for a whole wave on prose while the differential stayed green, because the oracle omitted the type too and two implementations that both say nothing agree perfectly. C has strictly MORE redefinitions than bash. Measured over 359 sqlite C/H files (`script/m14/tmp/c-audit/c-ontology-verdicts.ts`): 50 mutually-exclusive redefinition pairs in 23 files.\n\nThis mutant removes the ARM-EXCLUSIVITY requirement, which is what makes the rule C's rule rather than bash's. C 6.9p5 makes an unconditional second definition of an external identifier a CONSTRAINT VIOLATION, so an unconditional redefinition is not an override -- it is a compile error, or parse damage. sqlite's `src/printf.c:76-90` is a Tcl script inside `#if 0` that recovery reads as a function named `c`, and 25 such pairs exist in 7 files. Publishing them would be a fabrication.",
    revert: (s) => {
      const from = "          if (!sharesConditionalWithDifferentArm(arms, preprocConditionalsOf(defs[i].node))) continue"
      if (s.split(from).length - 1 !== 1) throw new Error("#989 anchor not found or not unique")
      return s.replace(from, "          if (false && !sharesConditionalWithDifferentArm(arms, preprocConditionalsOf(defs[i].node))) continue")
    },
    fixture: "overrides-conditional-redefinition-989",
    fact: (r) =>
      // the pinned rows survive
      hasEdge(r, "overrides", "c989_pick", "c989_pick") &&
      hasEdge(r, "overrides", "c989_ifdef_pick", "c989_ifdef_pick") &&
      hasEdge(r, "overrides", "REDEFINED_MACRO", "REDEFINED_MACRO") &&
      // CONTROLS: the readings the arm test exists to refuse
      !hasEdge(r, "overrides", "c989_debug_build_pick", "c989_debug_build_pick") &&
      !hasEdge(r, "overrides", "c989_not_exclusive_a", "c989_not_exclusive_a") &&
      !hasEdge(r, "overrides", "c989_single", "c989_single") &&
      !hasEdge(r, "overrides", "c989_prototyped", "c989_prototyped") &&
      !hasEdge(r, "overrides", "REDEFINED_TWICE", "REDEFINED_TWICE"),
  },
  {
    id: "c-lane/989-overrides-undef-guard",
    defectClass: "relationship-fabrication",
    defect:
      "#989, SECOND SHAPE: `#define X 1` twice with no `#undef` is a CONSTRAINT VIOLATION in C (6.10.3p2) unless the replacement lists are identical, and it is not the sanctioned redefinition. Measured on the same 359 sqlite files: 353 duplicate object-like `#define`s, every one of them a config-header re-arm (`src/os_setup.h:45-87` alone carries several per macro). A rule that counted plain repeated `#define`s would publish an override for every configuration constant in the corpus, and the fact would be false: nothing replaced anything, the preprocessor rejects the second definition.\n\nThis mutant drops the `#undef` requirement and keeps only 'a prior definition exists'.",
    revert: (s) => {
      const from = "        if (prior !== undefined && undefed.has(entry.name)) {"
      if (s.split(from).length - 1 !== 1) throw new Error("#989 macro anchor not found or not unique")
      return s.replace(from, "        if (prior !== undefined) {")
    },
    fixture: "overrides-conditional-redefinition-989",
    fact: (r) =>
      hasEdge(r, "overrides", "REDEFINED_MACRO", "REDEFINED_MACRO") &&
      // the constraint-violation shape must not fire
      !hasEdge(r, "overrides", "REDEFINED_TWICE", "REDEFINED_TWICE"),
  },
  {
    id: "c-lane/989-exports-marker-from-replacement-list",
    defectClass: "relationship-omission",
    defect:
      "#989: `exports` was pinned to five macro NAMES (#963). C has no export construct, so the edge can only describe a convention -- and a name list is right about the codebases it was written from and silent about the next one. Measured over 359 sqlite C/H files: the corpus defines SEVEN marker names and the five-name list matches NONE of them, so `exports` fired 0 times on that corpus. Two of the seven are `extern` markers the analyzer had never heard of -- `autosetup/jimsh0.c:723 #define JIM_EXPORT extern` and `ext/wasm/libcmpp.c:104,111 #define CMPP_EXPORT extern` / `... extern __declspec(dllexport)` -- carrying 274 declarations.\n\nThis mutant drops the structural half of the marker test and keeps only the five-name list, which is the pre-#989 behaviour.\n\nWhat it must NOT do is accept an EMPTY replacement list, which is the other obvious rule and the one the corpus convicts: on the same 359 files the empty branch accepts 58 declarations and at least 52 of them are NOT exports -- `ext/wasm/libcmpp.c:5256 #define CMPP_PRIVATE static` (52 uses, INTERNAL linkage), `src/mutex_unix.c:39,41 #define ALIGN128` (an alignment attribute), `src/sqliteInt.h:1329,1335 #define SQLITE_WSD` (thread-local). An empty macro contributes no tokens, so structure cannot tell an export marker from an alignment attribute; only its NAME can, and the name is the list this change removes. The fact asserts both directions, so a fix that over-applied the empty rule fails here too.",
    revert: (s) => {
      const from = "                (inArray(EXPORT_MACROS, marker) || linkageMarkerNames.has(marker)) &&"
      if (s.split(from).length - 1 !== 1) throw new Error("#989 exports anchor not found or not unique")
      return s.replace(from, "                (inArray(EXPORT_MACROS, marker)) &&")
    },
    fixture: "exports-linkage-marker-989",
    fact: (r) =>
      // markers this file defines to `extern` -- the rows the fixed list cannot reach
      hasEdge(r, "exports", "c989_plain_export", "PUBLIC_API") &&
      hasEdge(r, "exports", "c989_pointer_export", "PUBLIC_API") &&
      hasEdge(r, "exports", "c989_ms_export", "PUBLIC_API_MS") &&
      hasEdge(r, "exports", "c989_platform_export", "C989_PLATFORM_API") &&
      // CONTROLS: #963's five conventions are still published, so the generalization
      // did not regress the codebases the list was written for
      hasEdge(r, "exports", "c989_curl_extern", "CURL_EXTERN") &&
      hasEdge(r, "exports", "c989_git_extern", "GIT_EXTERN") &&
      hasEdge(r, "exports", "c989_redis_api", "REDISMODULE_API") &&
      hasEdge(r, "exports", "kernel_exported_symbol", "EXPORT_SYMBOL") &&
      // and the three refusions the corpus convicts
      !hasEdge(r, "exports", "c989_private_api", "PRIVATE_API") &&
      !hasEdge(r, "exports", "c989_attribute_only", "ATTRIBUTE_ONLY") &&
      !hasEdge(r, "exports", "c989_not_linkage", "C989_NOT_LINKAGE") &&
      !hasEdge(r, "exports", "c989_ordinary", "c989_ordinary"),
  },
  {
    id: "c-lane/990-member-name-skips-error",
    defectClass: "relationship-mislabel",
    defect:
      "#990: the member-name walk for struct and union fields fell back to `namedChild(0)` at a `parenthesized_declarator`, which carries no `declarator` FIELD, and that first named child is the ERROR node the preprocessor macro left behind. The walk then descended INTO the ERROR and returned the macro's `field_identifier`.\n\nThe shape is a function-pointer member whose calling convention is a macro -- sqlite `src/sqlite3ext.h:112 char *(SQLITE_CDECL*mprintf)(const char*,...);` -- which is not legal C without expansion, so tree-sitter recovers it as `parenthesized_declarator( ERROR(field_identifier SQLITE_CDECL), pointer_declarator( declarator: field_identifier mprintf ) )`.\n\nMeasured against clang 14 (`contains-vs-clang.ts --dir <sqlite>/src --max-files 120`: 33 records / 421 members judged, 414 agreed = 98.34%), BOTH halves of the defect sat in one struct: 7 PHANTOM members named `SQLITE_CDECL` and the 7 REAL members MISSED -- `mprintf`, `xsnprintf`, `test_control`, `db_config`, `log`, `vtab_config`, `str_appendf`. Reporting only the phantom count would have understated the defect by half, which is why the fact below asserts both directions.\n\nThis is the defect `getIdentifierFromDeclarator` has guarded against since #916-C, and #990 is that guard applied to the two INLINE copies of the same walk in the struct and union extractors. A revert that changes only ONE of them must fail too, so the fact asserts the union edge as well as the struct edge.\n\nThe controls are #928 and #985, which must survive: a walk that reads past the ERROR to the macro ARGUMENT would invent `contains c990_macro_generated -> closing`, and one that let a `macro_type_specifier` back in would republish `C990_ARRAY_T` beside `lines`.\n\nThis mutant reverts both call sites to `namedChild(0)` -- the pre-#990 code exactly.",
    revert: (s) => {
      const from = "this.firstCleanNamedChild(declNode)"
      if (s.split(from).length - 1 !== 2) throw new Error("#990 anchor not found, or not present at BOTH call sites")
      return s.split(from).join("declNode.namedChild(0)")
    },
    fixture: "macro-cdecl-member-990",
    fact: (r) =>
      // POSITIVE: the real member the walk missed
      hasEdge(r, "contains", "c990_routines", "mprintf") &&
      // and on the UNION copy of the walk -- this is what makes a half-revert fail
      hasEdge(r, "contains", "c990_u", "ufn") &&
      // CONTROLS: #947's four genuine function-pointer shapes are still published
      hasEdge(r, "contains", "c990_routines", "plain_cb") &&
      hasEdge(r, "contains", "c990_routines", "returns_int") &&
      hasEdge(r, "contains", "c990_routines", "void_cb") &&
      hasEdge(r, "contains", "c990_routines", "array_of_cb") &&
      hasEdge(r, "contains", "c990_routines", "cb_returning_cb") &&
      // CONTROLS: #985 and #928 survive
      hasEdge(r, "contains", "c990_macro_typed", "lines") &&
      hasEdge(r, "contains", "c990_macro_generated", "a") &&
      hasEdge(r, "contains", "c990_macro_generated", "b") &&
      // NEGATIVE: the phantom on BOTH walks
      !hasEdge(r, "contains", "c990_routines", "C990_CDECL") &&
      !hasEdge(r, "contains", "c990_u", "C990_CDECL") &&
      !hasEdge(r, "contains", "c990_macro_typed", "C990_ARRAY_T") &&
      !hasEdge(r, "contains", "c990_macro_generated", "C990_CALLBACK") &&
      // NEGATIVE: the #928 refusal must not become a recovery
      !hasEdge(r, "contains", "c990_macro_generated", "closing") &&
      // CONTROLS: ordinary members, so an over-reaching fix fails as a MISSING row
      hasEdge(r, "contains", "c990_plain", "plain_member") &&
      hasEdge(r, "contains", "c990_plain", "named_member") &&
      hasEdge(r, "contains", "c990_plain", "arr"),
  },
  {
    id: "c-lane/991-macro-name-not-after-an-error",
    defectClass: "symbol-fabrication",
    defect:
      "#991: `childForFieldName(\"name\")` on a `preproc_def` is not the same question as \"which macro does this `#define` declare\". When the replacement list is a brace-enclosed, comment-bearing initializer the grammar loses the macro name and the `name:` field binds to whatever identifier comes next -- sqlite `ext/wasm/libcmpp.c:5520 #define CmppLvl_empty_m {/* .flags=0U, .lineNo=0U */}` yields `name: (identifier)` reading `.flags`. The analyzer published a macro named `flags`, and `flags` is a real struct member 900 lines earlier (`cmpp_flag32_t flags;`, :448), so the fabricated name RESOLVED to a member. The lane gate's own P7-no-macro-named-member convicted it with 9 rows in that one file. This is the fabrication class #963 removed from `exports` (-> KERNEL_EXPORT) and #962 removed from `instantiates` (-> malloc): the published name has to be a name the source declares.\n\nMeasured (script/m14/tmp/c-audit/c-macro-name.ts, 348 C-routed sqlite files, 4,472 `#define` nodes): the `name` field matches what the line spells in 4,466 and is fabricated in 6 -- `flags` (libcmpp.c:5520, the line spells `CmppLvl_empty_m`), `cmpp_size_t` (:5362), `cmpp__ListType_decl` (:5823), and `c` three times (rtree.c:1224, :1230, :1250, the `#if 0` Tcl-script shape). In ALL SIX an ERROR child of the same node sits BEFORE the name field, so the structural test and the fabrication coincide exactly on this corpus.\n\nThe rule is a REFUSAL, not a rename: the macro's name is in the source TEXT but not in the PARSE, and reading it back out of text is the #934 line-anchored inventory's separate job. A refusal is the direction this lane ranks acceptable over publishing a name that resolves to something else (#983).\n\nCONTROLS: the test must not become 'refuse every brace-bodied `#define`' -- `#define C991_brace_ok { 1, 2 }` parses clean and keeps its symbol. And it must not become 'no member may share a macro's name': redis's `double min, max;` 3,700 lines after its own `#define min(a, b)` is real C and #931 pins it.\n\nThis mutant reverts `declaredMacroNameNode` to the raw field read -- the pre-#991 code exactly.",
    revert: (s) => {
      const from = `  private declaredMacroNameNode(node: Node): Node | null {
    const nm = node.childForFieldName("name")
    if (!nm) return null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.id === nm.id) return nm
      if (c.isError || c.isMissing) return null
    }
    return nm
  }`
      if (s.split(from).length - 1 !== 1) throw new Error("#991 anchor not found or not unique")
      return s.replace(from, `  private declaredMacroNameNode(node: Node): Node | null {
    return node.childForFieldName("name")
  }`)
    },
    fixture: "fabricated-macro-name-991",
    fact: (r) =>
      // CONTROLS: the four everyday shapes keep their symbols
      hasSymbol(r, "C991_brace_ok") &&
      hasSymbol(r, "C991_object_like") &&
      hasSymbol(r, "C991_function_like") &&
      hasSymbol(r, "C991_indirect_empty_m") &&
      hasSymbol(r, "C991_fn_misnomer_m") &&
      // CONTROLS: a MEMBER may share a FUNCTION-LIKE macro's name, because such a macro
      // is replaced only where `(` follows the name and a member declarator is followed
      // by `;`. redis's `double min, max;` 3,700 lines after `#define min(a, b)` is real
      // C and #931 pins it. The first version of this control used an OBJECT-like macro
      // and P7-no-macro-named-member caught it on the FIXTURE -- the property being right
      // and the fixture being wrong, since `unsigned X;` after `#define X 0` expands to
      // `unsigned 0;`.
      hasEdge(r, "contains", "c991_member_named_after_macro", "C991_fn_misnomer_m") &&
      hasEdge(r, "contains", "c991_member_named_after_macro", "C991_fn_misnomer_m2") &&
      // the ordinary member the phantom used to shadow
      hasEdge(r, "contains", "c991_S", "flags") &&
      // NEGATIVE: the fabricated macro, both directions
      !hasMacroNamed(r, "flags") &&
      !hasMacroNamed(r, "lineNo") &&
      !hasSymbol(r, "C991_S_empty_m"),
  },
  {
    id: "c-lane/992-export-attribute-marker",
    defectClass: "dropped-construct",
    defect:
      "#992: `exports` in C was reading the marker only when it was a MACRO -- the five #963 names, plus #989's structural rule over a macro this file defines to a replacement list opening with `extern`. Both readings assume the marker is a `#define`, and sqlite writes it as a bare KEYWORD ATTRIBUTE on 69 declarations in 65 files with no macro in sight: `#ifdef _WIN32 / __declspec(dllexport) / #endif / int sqlite3_fts3_init(...)`, which is the loadable-extension entry-point idiom and is exactly what `extern` was standing in for. The fixture that settled `exports` asserted the opposite in writing -- \"C has no export construct -- no keyword, no module, no visibility attribute\" -- and only measuring the corpus found it. Measured by `script/m14/tmp/c-audit/v9-export-attribute.ts` over the 348 C-routed sqlite files: 69 `ms_declspec_modifier` nodes in 65 files and EVERY one names `dllexport`; 59 sit on a declaration or definition whose DECLARATOR FIELD names a symbol and 10 sit inside an ERROR span with no recoverable declarator; the whole population's `attribute_specifier` count is 1 and it names `aligned`.\n\nThe mutant restores the pre-#992 marker test: an `ms_declspec_modifier` or `attribute_specifier` child is never an export marker, and a macro's replacement list is only read for a leading `extern`. That kills all seven positive rows of the fixture. The negative half is the more interesting half, because it is where a plausible over-correction lives: the naive \"any declspec/attribute child is an export\" reading publishes `__declspec(dllimport)` (the OPPOSITE marker -- the symbol comes IN from a DLL) and `visibility(\"hidden\")` (the OPPOSITE visibility -- kept OUT of the export table), which assert the inverse of what the source says. `__declspec( align(128) )` is the shape that convicts a text-reading implementation, because the grammar puts `(128` inside an ERROR and the marker's own text then reads `__declspec( align(128)`. And the macro-mediated half must not become 'read the value of every marker macro': `C992_PRIVATE` is defined to `static`, which is INTERNAL linkage, and sqlite `ext/wasm/libcmpp.c:5256 #define CMPP_PRIVATE static` prefixes 52 such declarations.\n\nCONTROLS: #989's structural rule (`C992_PUBLIC` = `extern`) must still publish, or the fix regresses every codebase #989 was written for.",
    revert: (s) => {
      const pairs: [string, string][] = [
        [
          '        } else if (n.type === "ms_declspec_modifier" || n.type === "attribute_specifier") {',
          '        } else if (false && (n.type === "ms_declspec_modifier" || n.type === "attribute_specifier")) {',
        ],
        [
          '              if (val && (firstWordOf(val.text) === "extern" || assertsExternalVisibility(val.text))) {',
          '              if (val && firstWordOf(val.text) === "extern") {',
        ],
      ]
      for (const [from, to] of pairs) {
        if (!s.includes(from)) throw new Error("#992 anchor not found: " + from.slice(0, 60))
        s = s.replace(from, to)
      }
      return s
    },
    fixture: "exports-visibility-attribute-992",
    fact: (r) =>
      // POSITIVE, all five attribute spellings plus both marker positions
      hasEdge(r, "exports", "c992_declspec_decl", "__declspec(dllexport)") &&
      hasEdge(r, "exports", "c992_declspec_def", "__declspec(dllexport)") &&
      hasEdge(r, "exports", "c992_declspec_after_type", "__declspec(dllexport)") &&
      hasEdge(r, "exports", "c992_visibility_default", '__attribute__((visibility("default")))') &&
      hasEdge(r, "exports", "c992_attr_dllexport", "__attribute__((dllexport))") &&
      // POSITIVE, the macro-mediated half: no linkage keyword at all for #989 to find
      hasEdge(r, "exports", "c992_macro_visibility", "C992_VIS_EXPORT") &&
      // CONTROL: #989's structural rule must survive
      hasEdge(r, "exports", "c992_still_works", "C992_PUBLIC") &&
      // NEGATIVE, the OPPOSITE markers -- the inverse of what the source says
      !hasEdge(r, "exports", "c992_imported", "__declspec(dllimport)") &&
      !hasEdge(r, "exports", "c992_visibility_hidden", '__attribute__((visibility("hidden")))') &&
      // NEGATIVE, attributes that say nothing about linkage
      !hasEdge(r, "exports", "c992_attr_noinline", "__attribute__((noinline))") &&
      !hasEdge(r, "exports", "c992_noinline", "__declspec(noinline)") &&
      !hasEdge(r, "exports", "c992_used_only", "__attribute__((used))") &&
      // NEGATIVE, the ERROR-inside-the-marker shape
      !hasEdge(r, "exports", "c992_aligned_var", "__declspec(align(128))") &&
      // NEGATIVE, `static` is INTERNAL linkage -- sqlite CMPP_PRIVATE, 52 declarations
      !hasEdge(r, "exports", "c992_private", "C992_PRIVATE"),
  },
]

// ---------------------------------------------------------------------------
// PART 3 -- MEASURED COST
// ---------------------------------------------------------------------------
let perfVerdict = "pass"

/**
 * P13's recorded floor, keyed by the corpus slice the run covered. A single global
 * number was the first attempt and it is wrong: the same property scores 28 over a
 * jemalloc slice and 44 over a curl/lib slice, so one constant would have been a
 * floor for neither. The file carries the reason, the class, and the update rule.
 */
const P13_BASELINE_PATH = path.join((import.meta as any).dirname, "p13-baseline.json")
type P13Baseline = { schemaVersion: number; property: string; purpose: string; why_a_floor_and_not_a_zero: string; how_to_update: string; notChecked: Record<string, number> }
const p13Baseline: P13Baseline = JSON.parse(fs.readFileSync(P13_BASELINE_PATH, "utf8"))
const P13_UPDATE = argv.includes("--update-p13-baseline")
const P13_SLICE = CORPUS ? path.resolve(CORPUS) : "(fixtures only)"

const cpuMs = (fn: () => void): number => {
  const before = process.cpuUsage()
  fn()
  const after = process.cpuUsage(before)
  return (after.user + after.system) / 1000
}

async function measuredCost(): Promise<void> {
  console.log(`\n## PART 3 -- measured cost (the #929 line index)`)
  const file = process.env.C_LANE_PERF_FILE ?? "/home/sano/ishaq/bb_tests/repositories/redis/src/server.c"
  if (!fs.existsSync(file)) {
    console.log(`  SKIPPED  ${file} is not present; the measured-cost check needs a real corpus file`)
    perfVerdict = "skipped"
    return
  }
  const content = fs.readFileSync(file, "utf8")
  const tree = cparser.parse(content)
  const text = fs.readFileSync(ANALYZER, "utf8")
  // Revert the WHOLE method, not a fragment of it: splicing a walk in front of
  // the memoised read collided with the clamp line that follows it, which is the
  // same class of mistake the CGD31 and CGD36 mutant drafts made.
  const methodRe =
    /  private indexToLineColumn\(content: string, index: number\): \{ line: number; column: number \} \{[\s\S]*?\n  \}\n/
  if (!methodRe.test(text)) {
    console.log("  ERROR    the #929 method shape moved -- the measured-cost check cannot apply its revert")
    perfVerdict = "error"
    return
  }
  const preFixMethod =
    "  private indexToLineColumn(content: string, index: number): { line: number; column: number } {\n" +
    "    let line = 1\n" +
    "    let column = 1\n" +
    "    const max = Math.min(index, content.length)\n" +
    "    for (let i = 0; i < max; i++) {\n" +
    '      if (content[i] === "\\n") {\n' +
    "        line++\n" +
    "        column = 1\n" +
    "      } else {\n" +
    "        column++\n" +
    "      }\n" +
    "    }\n" +
    "    return { line, column }\n" +
    "  }\n"
  const tmp = path.join(TMP_DIR, `c-lane-perf-mutant.${variantSeq++}.ts`)
  fs.writeFileSync(
    tmp,
    text
      .replace(methodRe, preFixMethod)
      .replace(`from "./engine"`, `from ${JSON.stringify(path.join(ROOT, "src/ast/engine.ts"))}`),
  )
  TEMP_VARIANTS.push(tmp)
  const Reverted = (await import(tmp)).RealCAnalyzer
  const Fixed = (await import(ANALYZER)).RealCAnalyzer
  // CPU time, not wall time, and the reason is the box: this lane's runs recorded
  // load1 between 22 and 49, and a wall-clock series at that load swung 3x WITHIN
  // one series (3362-17039 ms for identical work), which is wider than the effect
  // being measured. `process.cpuUsage` excludes time the process spent
  // descheduled. Two wall attempts are on the record as UNSCORED rather than
  // deleted -- a wall row under that load is not evidence (lane formula section 9).
  //
  // MINIMUM, not median, as the estimator within the CPU measurement:
  // contention can only ADD time, never remove it, so the least-loaded run is the
  // closest observation of intrinsic cost. The full series is printed anyway,
  // because a reader who distrusts the estimator can read the distribution.
  const fixed: number[] = []
  const reverted: number[] = []
  cpuMs(() => new Fixed().analyze(tree.rootNode, content, file)) // warm-up, discarded
  cpuMs(() => new Reverted().analyze(tree.rootNode, content, file))
  // Nine rounds, not five. The statistic below is the MEDIAN OF THE PAIRED RATIOS,
  // and both halves of that change are load-bearing on a shared machine.
  //
  // This check was FLAKY and was found flaky by disagreeing with itself: three
  // consecutive invocations on unchanged code reported 1.25x, 0.70x and 1.45x for
  // the same file, and it FAILED two of the three. `/proc/loadavg` read 30-34
  // throughout, because other agents are running on this host, and the per-round
  // samples swung 744-3072 ms. min-of-5 was the wrong estimator: with a 4x spread
  // the two minima are drawn from different points of the noise, so the ratio is
  // whatever the machine happened to be doing.
  //
  // Pairing is what fixes it. Each round runs Fixed and then Reverted back to back,
  // so a slow patch of machine time inflates both members of that pair and cancels
  // in the ratio; the median of nine such ratios is stable where the ratio of two
  // independent minima is not. The min-of-minima is still printed, because a reader
  // who distrusts the estimator should be able to see the spread rather than take
  // one number on faith.
  for (let round = 0; round < 9; round++) {
    fixed.push(cpuMs(() => new Fixed().analyze(tree.rootNode, content, file)))
    reverted.push(cpuMs(() => new Reverted().analyze(tree.rootNode, content, file)))
  }
  const min = (xs: number[]) => Math.min(...xs)
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  const mf = min(fixed)
  const mr = min(reverted)
  const minRatio = mr / Math.max(1, mf)
  const paired = fixed.map((f, i) => reverted[i] / Math.max(1, f)).sort((a, b) => a - b)
  const ratio = paired[Math.floor(paired.length / 2)]
  const load1 = fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]
  console.log(`  file: ${path.basename(file)} (${Buffer.byteLength(content)} bytes), load1 ${load1}`)
  console.log(`  metric: CPU ms, minimum of ${fixed.length} after a discarded warm-up`)
  console.log(`  line index built once (fixed) : min ${mf.toFixed(0)} ms  median ${med(fixed).toFixed(0)}  ${JSON.stringify(fixed.map((x) => +x.toFixed(0)))}`)
  console.log(`  whole-content walk (reverted) : min ${mr.toFixed(0)} ms  median ${med(reverted).toFixed(0)}  ${JSON.stringify(reverted.map((x) => +x.toFixed(0)))}`)
  console.log(`  paired per-round ratios (sorted): ${JSON.stringify(paired.map((x) => +x.toFixed(2)))}`)
  console.log(`  reverted/fixed: ${ratio.toFixed(2)}x median-of-paired  (${minRatio.toFixed(2)}x min-of-minima) -- the cost the fix removes`)
  if (!(ratio > 1.15)) {
    console.log("  FAILED   the reverted scan is not measurably slower, so the change buys nothing on this file")
    perfVerdict = "fail"
  } else {
    console.log("  CAUGHT   the revert is measurably slower, so the #929 change is load-bearing")
    perfVerdict = "pass"
  }
}

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------
const fixtureFiles = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".c"))
  .sort()
  .map((f) => ({ name: f, src: fs.readFileSync(path.join(FIXTURES, f), "utf8") }))

let corpusFiles: Array<{ name: string; src: string }> = []
if (CORPUS) {
  const cap = QUICK ? 25 : Number(arg("max-files", "200"))
  const walk = (d: string) => {
    if (corpusFiles.length >= cap) return
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === ".git") continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if ((e.name.endsWith(".c") || e.name.endsWith(".h")) && corpusFiles.length < cap) {
        try {
          if (fs.statSync(full).size >= 512) corpusFiles.push({ name: full, src: fs.readFileSync(full, "utf8") })
        } catch {
          /* unreadable file: not silently counted as clean */
        }
      }
    }
  }
  walk(CORPUS)
}

const base = (await import(ANALYZER)).RealCAnalyzer
const propertyTargets = [...fixtureFiles, ...corpusFiles]
const violations = checkProperties(base, propertyTargets)

// P13 -- the analyzer's macro inventory must COVER the file. Measured on
// redis/deps/jemalloc/include/jemalloc/internal/tsd.h: a long brace-enclosed
// macro body makes the grammar absorb the directives that follow it, the region
// is covered by an enclosing node's SPAN while no child represents it (a
// whole-tree scan finds no node with a start row anywhere in 120..146), and the
// walk saw 24 preproc nodes for 29 `#define` lines. The five unseen macros
// produced no symbol, their reads were unresolvable, and the member and enumerator
// rules that key on macro names were blind to them -- which is how a property
// named TSD_DATA_SLOWER reached tsd_s's member list.
//
// The property is checked against the FILE'S OWN TEXT, which is the only place
// the missing directives still exist, and it needs no synthetic reproduction: the
// corpus file IS the reproduction. A synthetic brace-body macro was tried first
// and does NOT reproduce the absorption at any body length from 4 to 50 lines, so
// a fixture built from it would have been an INERT fixture that looked like
// evidence -- the failure #884 was filed for.
{
  const macroInventoryGaps: string[] = []
  const isWord = (ch: string) =>
    (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_"
  for (const f of propertyTargets) {
    if (!f.src.includes("#define")) continue
    let res: any
    try {
      res = analyzeWith(base, f.src, f.name)
    } catch {
      continue // already reported as P10
    }
    const declaredMacros = new Set<string>(
      (res.symbols ?? []).filter((s: any) => (s.metadata as any)?.isMacro).map((s: any) => s.name),
    )
    const srcLines = f.src.split("\n")
    const missing: string[] = []
    for (let i = 0; i < srcLines.length; i++) {
      const line = srcLines[i]
      if (!line.startsWith("#define")) continue
      let k = 7
      while (k < line.length && (line[k] === " " || line[k] === "\t")) k++
      const start = k
      while (k < line.length && isWord(line[k])) k++
      const name = line.slice(start, k)
      if (name !== "" && !declaredMacros.has(name)) missing.push(`${name}@L${i + 1}`)
    }
    for (const m of missing) macroInventoryGaps.push(`${f.name}: ${m}`)
  }
  // P13 is a REGRESSION gate on a known residual, not a zero gate. The class is
  // real and measured (the grammar drops or absorbs `#define` nodes in several
  // regions, and one of the lane's own fixtures hits it twice), and the fix
  // #934 shipped in this wave did NOT close it: #934 made the macro NAMES
  // available to the member and enumerator rules, it did not mint a symbol for a
  // directive the walk never reaches. Minting one from the raw text was
  // considered and refused -- a `#define` line inside a `/* */` block reads the
  // same, and that false-positive class was not measured, so publishing a symbol
  // for it would be exactly the fabrication the contract forbids.
  //
  // So the honest shape is a floor: the count is REPORTED every run and the gate
  // fails only when it GROWS. A count that only moves when something regressed is
  // the same discipline the C-D4 differential floor uses, and it is the difference
  // between a gate and a number nobody looks at.
  const measured = macroInventoryGaps.length
  const floor = p13Baseline.notChecked[P13_SLICE]
  if (P13_UPDATE) {
    if (!CORPUS) {
      console.log("  P13 --update-p13-baseline refused without --corpus: a floor recorded from one slice is not a floor for another")
    } else {
      const before = floor
      p13Baseline.notChecked[P13_SLICE] = measured
      fs.writeFileSync(P13_BASELINE_PATH, JSON.stringify(p13Baseline, null, 2) + "\n")
      console.log(`  P13 floor ${P13_SLICE}: ${before ?? "(none)"} -> ${measured} (recorded)`)
    }
  } else if (floor === undefined) {
    console.log(
      `  P13 UNRECORDED SLICE ${P13_SLICE}: ${measured} #define directives carry no macro symbol and there is no ` +
        `recorded floor for this slice, so the count is REPORTED and not scored. Record it with ` +
        `--update-p13-baseline --corpus ${P13_SLICE} (the numbers are in the file's own "purpose")`,
    )
  } else if (measured > floor) {
    violations.push({
      property: "P13-macro-inventory-coverage",
      file: "(aggregate)",
      detail: `${measured} #define directives carry no macro symbol, against a recorded floor of ${floor} for this slice. First: ${macroInventoryGaps.slice(0, 4).join("; ")}`,
    })
  } else {
    console.log(`  P13 macro-inventory: ${measured} #define directives carry no macro symbol (recorded floor ${floor} for this slice)`)
  }
}

// P11 -- the analyzer's own source, read as text. The regex census classifies
// every regex whose receiver ends in `.text` as `normalization`, so a regex that
// PARSES a node's text (reads an identifier out of it, decides a delimiter,
// classifies a token) is invisible to it. That is how this lane's documentation
// could claim "0 regex usages" while the census artifact it cites carried 2. The
// census's classification is a shared file's business, so the lane states the rule
// it can enforce on itself: NO regex literal at all.
{
  const code = stripCommentsAndStrings(fs.readFileSync(ANALYZER, "utf8"))
  for (const m of code.matchAll(/\/(?:[^/\\\n\[]|\\.)+\/[gimsuy]*/g)) {
    violations.push({
      property: "P11-no-regex-literal",
      file: "src/ast/real-c-analyzer.ts",
      detail: `${m[0].slice(0, 60)} at offset ${m.index}`,
    })
  }
}

const byProperty = new Map<string, Violation[]>()
for (const v of violations) {
  const g = byProperty.get(v.property) ?? []
  g.push(v)
  byProperty.set(v.property, g)
}

console.log(`# Holy C lane gate`)
console.log(`commit: ${execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()}`)
console.log(`\n## PART 1 -- properties`)
console.log(`files checked: ${propertyTargets.length} (${fixtureFiles.length} fixtures + ${corpusFiles.length} corpus)`)
if (violations.length === 0) console.log("all properties hold")
for (const [prop, list] of [...byProperty].sort()) {
  console.log(`  VIOLATION ${prop}: ${list.length}`)
  for (const v of list.slice(0, 6)) console.log(`      ${v.file}: ${v.detail}`)
  if (list.length > 6) console.log(`      ... ${list.length - 6} more`)
}

await measuredCost()

console.log(`\n## PART 2 -- mutants`)
let caught = 0
let survived = 0
let skipped = 0
const retired: string[] = []
for (const m of MUTANTS) {
  if (m.retired) {
    if (!m.retiredBecause || m.retiredBecause.trim().length < 40) {
      console.log(`  BAD-FACT ${m.id}  (retired without a stated reason -- a bare retirement is a silent pass)`)
      survived++
      continue
    }
    console.log(`  RETIRED  ${m.id}  -- ${m.retiredBecause.slice(0, 160)}${m.retiredBecause.length > 160 ? "..." : ""}`)
    retired.push(m.id)
    continue
  }
  const fx = fixtureFiles.find((f) => f.name === `${m.fixture}.c`)
  if (!fx && !m.twoFile) {
    console.log(`  SKIPPED  ${m.id}  (fixture ${m.fixture}.c not found -- the fixture pair is the gate's other half)`)
    skipped++
    continue
  }
  // A two-file fact and a one-fixture fact are checked the same way: does the
  // declared fact hold on the CLEAN analyzer, and does the MUTANT break it?
  const runFact = (Cls: any): boolean => {
    if (m.twoFile) return m.twoFile.check(Cls)
    return m.fact(analyzeWith(Cls, fx!.src, fx!.name), fx!.src)
  }
  let baseOk = false
  try {
    baseOk = runFact(base)
  } catch (e: any) {
    console.log(`  ERROR    ${m.id}  (fact threw on the CLEAN analyzer: ${String(e?.message ?? e).slice(0, 120)})`)
    survived++
    continue
  }
  if (!baseOk) {
    // A fact that does not hold on the clean analyzer is a gate defect, not a
    // mutant result. Reporting it as CAUGHT would be a lie; reporting it as
    // SURVIVED would blame the mutant. It is its own outcome.
    console.log(`  BAD-FACT ${m.id}  (the declared fact does not hold on the CLEAN analyzer -- the FACT is wrong, not the analyzer)`)
    survived++
    continue
  }
  let Cls: any
  try {
    Cls = await loadAnalyzer(m.revert)
  } catch (e: any) {
    console.log(`  ERROR    ${m.id}  (revert failed: ${String(e?.message ?? e).slice(0, 140)})`)
    survived++
    continue
  }
  let factAfter = true
  let threw = ""
  try {
    factAfter = runFact(Cls)
  } catch (e: any) {
    factAfter = true // a mutant that CRASHES has broken the fact too
    threw = String(e?.message ?? e).slice(0, 100)
  }
  if (!factAfter || threw) {
    console.log(`  CAUGHT   ${m.id}${threw ? `  (mutant threw: ${threw})` : ""}`)
    caught++
  } else {
    console.log(`  SURVIVED ${m.id}  -- ${m.defectClass}: the suite cannot see this defect`)
    survived++
  }
}

const total = caught + survived
console.log(
  `\nsummary: ${caught}/${total} live mutants caught` +
    `${retired.length ? `, ${retired.length} retired with a stated reason (${retired.join(", ")})` : ""}` +
    `${skipped ? `, ${skipped} skipped` : ""}; ${violations.length} property violations`,
)
console.log(`measured-cost verdict: ${perfVerdict}`)
if (violations.length > 0 || survived > 0 || perfVerdict === "fail" || perfVerdict === "error") {
  console.log("\nC LANE GATE FAILED")
  process.exit(1)
}
console.log("\nC LANE GATE PASSED")
cleanupVariants()
