// FS010 — the ALIAS / ONE-CASE-DU ambiguity space, measured case by case.
//
// THE QUESTION. `type X = SomeType` is an ALIAS in F#. `type X = A` is a legal ONE-CASE
// discriminated union. tree-sitter reads BOTH as
//     (type_definition (union_type_defn (type_name …) block: (union_type_cases (union_type_case (identifier)))))
// — byte-identical subtrees. The F# compiler itself decides by RESOLUTION (does the RHS
// name a type in scope?), which a single-file analyzer cannot do.
//
// SO THIS PROBE MEASURES HOW FAR THE TREE ALONE GOES: which RHS spellings the grammar
// sends to `type_abbrev_defn` (unambiguous, an ALIAS) and which land in the ambiguous
// union shape. The boundary of the ambiguous region is the finding — it decides whether
// the fix is a grammar patch, an analyzer rule, or a ruled limitation.
//
// Run: bun script/m14/tmp/fs010-alias-ambiguity.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")

const CASES: Array<[string, string, string]> = [
  ["alias: bare ident",                 "type X = Original",                   "ambiguous — indistinguishable from a one-case DU"],
  ["alias: qualified ident",            "type X = System.IComparable",          "?"],
  ["alias: builtin type",               "type X = int",                         "?"],
  ["alias: list type",                  "type X = string list",                 "?"],
  ["alias: generic",                    "type X = Map<string,int>",             "?"],
  ["alias: tuple",                      "type X = (int * string)",              "?"],
  ["alias: function type",              "type X = int -> int",                  "?"],
  ["alias: SRTP",                       "type X = ^T",                          "?"],
  ["alias: unit",                       "type X = unit",                        "?"],
  ["DU: one case inline",               "type X = A",                           "control — the ambiguous twin of row 1"],
  ["DU: one case, leading pipe",        "type X =\n  | A",                      "control"],
  ["DU: two cases",                     "type X =\n  | A\n  | B",              "control"],
  ["DU: case with payload",             "type X =\n  | A of int",               "control"],
  ["DU: case with type annotation",     "type X =\n  | A : int",                "control"],
  ["DU: case with named fields",        "type X =\n  | A of B = 1",             "control"],
  ["DU: two cases same line",           "type X = A | B",                       "control"],
  ["DU: case then members",             "type X =\n  | A\n      member this.M = 1", "control"],
  ["type abbrev with SRTP constraint",  "type X = ^T when ^T : (static member (+) : ^T) when ^T : not null", "constraint + abbrev"],
  ["measure abbrev",                    "type X = int with [<Measure>]",        "measure"],
  ["measure abbrev, long form",         "[<Measure>]\ntype X = int with [<Measure>]", "measure"],
  ["record",                            "type X = { A: int }",                  "control — record_type_defn"],
  ["enum",                              "type X = A = 0 | B = 1",              "control — enum_type_defn"],
  ["struct abbrev",                     "type X = struct (int * int)",          "struct"],
  ["struct abbrev, named",              "type X = struct end",                  "struct"],
  ["interface",                         "type X = interface end",               "control — interface_type_defn"],
  ["type abbreviation of an anon",      "type X = int with get,set",            "property abbrev"],
  ["lowercase alias target",            "type x = original",                    "lowercase"],
  ["alias of a generic type app",       "type X = IObservable<int>",            "?"],
  ["alias with two args tuple",         "type X = int * int",                   "?"],
  ["alias with nullable",               "type X = int option",                  "?"],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

  const rows: any[] = []
  for (const [label, body, note] of CASES) {
    const src = `module M\n${body}\n`
    const tree = parser.parse(src)
    const td = (() => { let f: any = null; const st: any[] = [tree.rootNode]; while (st.length) { const n = st.pop(); if (n.type === "type_definition" && !f) f = n; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } } return f })()
    const shape = (() => { const st: any[] = td ? [td] : []; const seen: string[] = []; while (st.length) { const n = st.pop(); if (seen.length < 12 && ["union_type_defn", "type_abbrev_defn", "record_type_defn", "enum_type_defn", "interface_type_defn", "anon_type_defn", "struct_type", "delegate_type_defn", "type_declaration"].includes(n.type)) seen.push(n.type); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } } return [...new Set(seen)] })()
    const errs = (() => { let n = 0; const st: any[] = [tree.rootNode]; while (st.length) { const x = st.pop(); if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) st.push(c) } } return n })()
    const verdict = shape.includes("type_abbrev_defn") ? "ABBREV (unambiguous)"
      : shape.includes("union_type_defn") ? "UNION shape (ambiguous with a one-case DU)"
      : shape.length ? shape.join("+") : "NO type_definition"
    rows.push({ label, body: body.replace(/\n/g, "\\n"), shape, verdict, errs, note })
  }

  console.log("FS010 — the alias / one-case-DU ambiguity space\n")
  for (const r of rows) {
    const mark = r.verdict.startsWith("UNION") ? "AMBIG" : r.verdict.startsWith("ABBREV") ? "  ok " : "  -- "
    console.log(`  ${mark}  ${r.label.padEnd(34)} ${r.verdict}${r.errs ? `  [${r.errs} err]` : ""}`)
    console.log(`        src: ${r.body}`)
  }
  const ambig = rows.filter((r) => r.verdict.startsWith("UNION")).length
  console.log(`\n${ambig} of ${rows.length} spellings land in the ambiguous union shape.`)
  console.log(`The grammar sends a bare / qualified / lowercase identifier to the union shape;`)
  console.log(`anything with type structure (list, generic, tuple, function, SRTP) to type_abbrev_defn.`)
  console.log(`\nConsequence for the lane: the ALIAS can only be recognised by RESOLVING the RHS`)
  console.log(`name to a type — single-file analysis cannot separate it from a legal one-case DU.`)
}
void main()
