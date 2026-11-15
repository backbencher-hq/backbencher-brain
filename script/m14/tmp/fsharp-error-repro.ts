// fsharp grammar-gap minimizer (2026-09-25).
//
// The census triage clustered ERROR nodes by the shape around them; a cluster is
// not a diagnosis. This script parses MINIMAL, hand-written snippets — one per
// suspect construct — so each named gap in the triage report is a construct the
// pinned grammar provably rejects (and a control snippet proves its neighbourhood
// parses). Every snippet carries the `src` line it was reduced from.
//
// Usage: bun script/m14/tmp/fsharp-error-repro.ts
import { Parser, Language } from "web-tree-sitter"
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const OUT = "validation/m14/results/fsharp-error-repro.json"

const CASES: { id: string; from: string; note: string; src: string }[] = [
  {
    id: "inline-il-let",
    from: "src/FSharp.Core/array2.fs:26",
    note: "inline IL literal as a definition body",
    src: `module M\nlet length1 (array: 'T[,]) = (# "ldlen.multi 2 0" array : int #)\n`,
  },
  {
    id: "inline-il-type-body",
    from: "src/FSharp.Core/prim-types-prelude.fs:110",
    note: "inline IL literal as a type definition body",
    src: "module M\ntype ``[,]``<'T> =\n    (# \"!0[0 ...,0 ...]\" #)\n",
  },
  {
    id: "nullable-annotation",
    from: "src/FSharp.Build/Fsc.fs:97",
    note: "`T | null` nullable reference type annotation",
    src: `module M\nlet mutable vslcid: string | null = null\n`,
  },
  {
    id: "nullable-annotation-param",
    from: "src/FSharp.Build/Fsc.fs:93",
    note: "`T | null` in a signature/param position",
    src: `module M\nlet f (s: string | null) = ignore s\n`,
  },
  {
    id: "union-case-named-fields-multiline",
    from: "src/Compiler/Service/FSharpProjectSnapshot.fs:526",
    note: "union case payload with labelled fields, one per line",
    src: `module M\ntype R =\n    | FSharpReference of\n        projectOutputFile: string *\n        getStamp: (unit -> System.DateTime) *\n        getReader: (unit -> int)\n`,
  },
  {
    id: "union-case-named-fields-singleline",
    from: "src/Compiler/Service/FSharpProjectSnapshot.fs:526",
    note: "same shape on one line (control for the multiline variant)",
    src: `module M\ntype R =\n    | FSharpReference of projectOutputFile: string * getStamp: (unit -> int)\n`,
  },
  {
    id: "named-field-pattern-multiline",
    from: "src/Compiler/Checking/Expressions/CheckComputationExpressions.fs:1960",
    note: "record/union-case pattern with named fields, multiline, nested in a list",
    src: `module M\nlet f x =\n    match x with\n    | LetOrUse({\n                   Bindings = [ SynBinding(\n                                    kind = SynBindingKind.Normal\n                                    headPat = pat\n                                    expr = rhsExpr\n                                    range = mBind\n                                    trivia = { LeadingKeyword = leadingKeyword }) ]\n                   Body = innerComp\n               },\n               false,\n               m) -> 1\n`,
  },
  {
    id: "named-field-pattern-singleline",
    from: "src/Compiler/Checking/Expressions/CheckComputationExpressions.fs:1960",
    note: "same shape on one line (control)",
    src: `module M\nlet f x =\n    match x with\n    | LetOrUse({ Bindings = [ SynBinding(kind = k) ] }, false, m) -> 1\n`,
  },
  {
    id: "interface-in-signature-type",
    from: "src/Compiler/AbstractIL/il.fsi:1703",
    note: "`type X = interface IY` (signature-file interface implementation)",
    src: `module M\ntype T =\n    interface System.IDisposable\n`,
  },
  {
    id: "interface-block-in-signature",
    from: "src/Compiler/AbstractIL/il.fsi:1703",
    note: "`interface ... end` block form",
    src: `module M\ntype T =\n    interface\n        abstract GetTypeDef: unit -> int\n    end\n`,
  },
  {
    id: "nested-block-comment",
    from: "src/Compiler/CodeGen/IlxGen.fs:9455",
    note: "nested (* block (* comment *) comment *)",
    src: `module M\nlet f =\n    (* outer (* inner *) still comment *)\n    1\n`,
  },
  {
    id: "preproc-in-match-arms",
    from: "src/Compiler/Checking/Expressions/CheckExpressions.fs:9470",
    note: "#if/#endif around match arms",
    src: `module M\nlet f x =\n    match x with\n    | 1 -> 1\n#if DEBUG\n    | 2 -> 2\n#endif\n    | _ -> 0\n`,
  },
  {
    id: "preproc-in-type-body",
    from: "src/Compiler/Checking/import.fs:874",
    note: "#if/#endif inside a type body",
    src: `module M\ntype T =\n    { a: int }\n#if DEBUG\n    member x.B = 1\n#endif\n`,
  },
  {
    id: "bom-module-header",
    from: "root cluster `(root) :: //` (6 src files, e.g. CheckIncrementalClasses.fs:1)",
    note: "UTF-8 BOM before a leading comment + module header",
    src: "\uFEFF// Copyright (c) Microsoft Corporation. All Rights Reserved.\n\nmodule internal M\n\nlet x = 1\n",
  },
  {
    id: "no-bom-module-header",
    from: "control for the BOM case (same file without the BOM)",
    note: "leading comment + module header, no BOM",
    src: "// Copyright (c) Microsoft Corporation. All Rights Reserved.\n\nmodule internal M\n\nlet x = 1\n",
  },
  {
    id: "not-null-constraint",
    from: "root cluster `type_arguments :: when` (9 src files, e.g. ilwrite.fs:365 `'T:not null`)",
    note: "`not null` constraint on a type parameter",
    src: `module M
type MetadataTable<'T when 'T:not null> =
    { name: string }
`,
  },
  {
    id: "and-joined-constraints",
    from: "root cluster `type_arguments :: and` (9 src files, e.g. il.fs:172)",
    note: "two constraints joined by `and` inside one type parameter list",
    src: `module M
type LazyOrderedMultiMap<'Key, 'Data when 'Key: equality and 'Key: not null>(keyf: 'Data -> 'Key) =
    member x.P = keyf
`,
  },
  {
    id: "and-joined-constraints-no-nullness",
    from: "disambiguation for the `and` cluster: same shape WITHOUT `not null`",
    note: "two ordinary constraints joined by `and` inside one parameter list",
    src: `module M
type M2<'K, 'D when 'K: equality and 'K: comparison>(f: 'D -> 'K) =
    member x.P = f
`,
  },
  {
    id: "preproc-in-record-fields",
    from: "root cluster `record_fields :: #` (6 src files, e.g. CompilerConfig.fs:338)",
    note: "#if/#endif inside a record field list",
    src: `module M
type R =
    {
        A: int
#if DEBUG
        B: string
#endif
        C: int
    }
`,
  },
  {
    id: "type-param-constraint-inline",
    from: "root cluster `type_arguments :: when` (9 src files)",
    note: "inline constraint on a type parameter",
    src: `module M
type A<'T when 'T : comparison> =
    | A of 'T
`,
  },
  {
    id: "type-param-constraint-and-chain",
    from: "root cluster `type_arguments :: and` (9 src files)",
    note: "constraint + `and` chain in one type group",
    src: `module M
type A<'T when 'T : comparison> = { a: 'T }
and B = { b: int }
`,
  },
  {
    id: "type-and-chain-no-params",
    from: "control for the `and` chain itself",
    note: "`and` chain without type parameters",
    src: `module M
type A = { a: int }
and B = { b: int }
`,
  },
  {
    id: "preproc-else-in-match",
    from: "root cluster `preproc_if :: else` (2 src files)",
    note: "#else/#endif around match arms",
    src: `module M
let f x =
    match x with
    | 1 -> 1
#if DEBUG
    | 2 -> 2
#else
    | 3 -> 3
#endif
    | _ -> 0
`,
  },
  {
    id: "control-simple",
    from: "(control)",
    note: "the neighbourhood these shapes live in must parse",
    src: `module M\ntype C<'T1,'T2> =\n    | C1 of 'T1\n    | C2 of 'T2\nlet g (x: int) = x + 1\n`,
  },
]

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-fsharp.wasm", import.meta.url).pathname))

  const rows: any[] = []
  for (const c of CASES) {
    const tree = parser.parse(c.src)
    const root = tree?.rootNode
    const hasError = !!root?.hasError
    let firstError: any = null
    let missing: any = null
    const walk = (node: any) => {
      if (!firstError && node.type === "ERROR") {
        firstError = {
          line: node.startPosition.row + 1,
          text: node.text.replace(/\s+/g, " ").trim().slice(0, 70),
          parent: node.parent?.type ?? null,
        }
      }
      if (!missing && node.isMissing) missing = { line: node.startPosition.row + 1, type: node.type }
      for (let i = 0; i < node.childCount; i++) {
        const ch = node.child(i)
        if (ch) walk(ch)
      }
    }
    if (root) walk(root)
    rows.push({ ...c, hasError, firstError, missing })
    console.log(`${hasError ? "BREAKS " : "parses "}  ${c.id.padEnd(38)} ${c.from}`)
    if (hasError && firstError) console.log(`          first ERROR @L${firstError.line} parent=${firstError.parent} :: ${firstError.text}`)
    tree?.delete()
  }

  const broken = rows.filter((r) => r.hasError)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "m60-fsharp-grammar-gap-repro",
        generatedAt: new Date().toISOString(),
        wasm: "wasm/tree-sitter-fsharp.wasm",
        note: "Minimal reproducers for the constructs the pinned fsharp grammar rejects. A cluster in validation/m14/results/archive/fsharp-error-triage.json is NOT a diagnosis; a snippet here that breaks while its control parses is. Both directions are recorded: the cases that BREAK and the controls that parse, because the controls are what rule out the neighbouring hypotheses (e.g. ordinary `and`-joined constraints parse — the 18-file `type_arguments` clusters are one `not null` gap, not two).",
        totals: { cases: rows.length, breaking: broken.length, parsing: rows.length - broken.length },
        breaking: broken.map((b) => b.id),
        cases: rows.map((r) => ({
          id: r.id,
          reducedFrom: r.from,
          note: r.note,
          breaks: r.hasError,
          firstError: r.firstError,
          firstMissing: r.missing,
          source: r.src,
        })),
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`wrote ${OUT}`)
  console.log(`\n${broken.length}/${rows.length} snippets break the pinned grammar`)
  console.log(`broken: ${broken.map((b) => b.id).join(", ")}`)
  console.log(`parse-clean: ${rows.filter((r) => !r.hasError).map((r) => r.id).join(", ")}`)
  parser.delete()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
