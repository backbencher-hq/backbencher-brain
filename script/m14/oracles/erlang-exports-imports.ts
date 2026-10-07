/**
 * The Erlang `exports` / `imports` oracle — LANE-OWNED.
 *
 * ## Why this oracle exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) reports, at HEAD:
 *
 *   erlang  2 un-audited: ["exports","imports"]
 *
 * both labels EMITTED by `real-erlang-analyzer.ts` (ER-D40, ER-D41) and compared
 * against NOTHING. "Stored and compared against nothing" is the gate's own phrase
 * for the state where a defect in the class is invisible, and 2,548-symbol
 * behaviour work does not make an unaudited class safe — it makes it larger.
 *
 * It also exists because a claim in the lane's own spec is false at HEAD.
 * `script/m14/spec/erlang-completeness.json` ER-D40 says of `exports`:
 *
 *   "the oracle derives the same set from the same declaration, so the two sides
 *    agree without either one having to guess."
 *
 * No such derivation existed. `deriveErlangEdges` in `differential.ts` (line ~16048)
 * reads `import_attribute` and pushes `references`; there is no `export_attribute`
 * case anywhere in it. So the comment described a resolution the code did not
 * perform, and the comment is what a reader would have checked instead of the code.
 *
 * ## Why this file is not wired into differential.ts
 *
 * `differential.ts` is master-owned and edited by several lanes at once. Wiring is
 * two edits there (the `lang === "erlang" ? [...]` term in the audited-label filter
 * at ~line 23238, and an import + call beside the existing
 * `deriveErlangContainsTruth(root)` at ~line 55), and both are reported rather than
 * made. Everything this lane can own — the derivation, its measurement, and a fixture
 * that fails if it is wrong — is here.
 *
 * ## The rule, from Erlang's own declarations
 *
 *   `-export([f/1, g/2]).`     one `exports` row per `fa`: the module PUBLISHES
 *                              that identity. `-export_type([t/0]).` is the same
 *                              label with `exportForm: "export_type"`, because a
 *                              published TYPE is a different declaration form and
 *                              OTP keeps two lists for it.
 *   `-import(Mod, [f/1]).`     one `imports` row naming the MODULE. The imported
 *                              NAMES are metadata, not endpoints: `-import(lists,
 *                              [map/2])` makes `lists:map/2` callable unqualified,
 *                              but the dependency a file graph needs is the file
 *                              dependency, and `map/2` alone would be every module's
 *                              `map`.
 *
 * Two forms are deliberately NOT rows, and the reasons are the interesting part:
 *
 *   `-include("x.hrl").` / `-include_lib("kernel/include/file.hrl").`
 *     A textual inclusion, which the analyzer already publishes as `references`
 *     (ER-D41's sibling). It is a file dependency, not an import statement: the
 *     included file's declarations are spliced into this module rather than
 *     brought into an unqualified namespace. Publishing it under `imports` as well
 *     would double-count one declaration in two classes, and `brain_import`
 *     (the table the module-dependency pass reads,
 *     src/intelligence/analysis/dependencies.ts:27-28) would then carry a row whose
 *     `importedNames` is empty.
 *   `-compile({parse_transform, Mod}).` / `-include_lib` side effects
 *     A transform that rewrites this module's abstract format. Real, and not an
 *     import: nothing is brought into scope by name.
 *
 * ## What is mirrored and what is not
 *
 * Mirrored: the `fa` reading (a `binary_op_expr` of `atom / integer`, or a bare
 * `atom` on the vendor-attribute error path), the `?MODULE` expansion inside an
 * `export` list, and the "first `-module` wins" rule.
 *
 * NOT mirrored: the SOURCE end. A module-less file attributes its edges to the file
 * path (ER-D32), which is an analyzer ownership decision; the harness matches a
 * relationship on `(label, target)` and does not read `from`. The oracle therefore
 * publishes a declared placeholder owner and never invents a module name — an
 * `.hrl` header is not a module.
 */

export interface ErlangOntologyEdge {
  label: "exports" | "imports"
  from: string
  target: string
  /** The `fa` identity the row was read from, `name/arity`. Metadata for a reader. */
  identity?: string
  /** The imported NAMES, in source order. An `-import(lists, [map/2, filter/2])` brings
   *  `map/2` and `filter/2` into unqualified scope; the DEPENDENCY is `lists`, and the
   *  names are what makes two `-import`s of one module distinguishable. */
  importedNames?: string[]
  /** `export_type` for a `-export_type([t/0])` row. */
  form?: "export" | "export_type" | "import"
  line?: number
}

/**
 * The owner a module-less file's rows are attributed to. A DECLARED placeholder,
 * never a module name synthesised from the filename: `-module` can be absent for a
 * real reason (OTP's merl/basic_test.erl has its `-module` line commented out
 * because the file is textually included elsewhere), and a filename is not a name
 * any compile can produce.
 */
export const NO_MODULE = "<no-module>"

/**
 * The `fa` node, as the pinned grammar spells `f/a`.
 *
 *     -export([f/1]).       fa -> atom("f")                       -> arity -> integer("1")
 *     -export([?MODULE/0]). fa -> macro_call_expr -> var("MODULE") -> arity -> integer("0")
 *
 * Two things the obvious reader gets wrong, both measured rather than reasoned:
 *
 *  1. The arity is inside an `arity` NODE. Reading `integer` as a direct child of `fa`
 *     finds none, so every identity comes out `/0` — and a target-only comparison cannot
 *     see it, because the target is the bare name either way. The first version of this
 *     oracle did exactly that and reported `logger/2` as `logger/0` on every row.
 *  2. A `?NAME` identity is a `macro_call_expr`, not an `atom`. `?MODULE` is the case
 *     that matters: `-export([?MODULE/0])` is how a module publishes a function whose name
 *     IS its own module name, three live corpus files write it that way
 *     (`edge_cases_er3.erl`, `otp/.../live_var.erl`, `otp/.../bsdes.erl`), and the
 *     compiler accepts it. Any reader that requires an `atom` silently drops those rows.
 *
 * `?MODULE` resolves to this file's module name (ER-D34/ER-D25). Any OTHER macro in that
 * position is a preprocessor constant this derivation does not expand, so its value is not
 * knowable here and the row is DROPPED rather than named after the macro — naming it after
 * the macro would publish an interface member no compile can produce, which is the defect
 * ER-D35 records for the call graph.
 */
function readFa(fa: any, moduleName: string): { name: string; arity: number } | null {
  const kids = fa?.namedChildren ?? []
  const atom = kids.find((c: any) => c?.type === "atom")
  const arityNode = kids.find((c: any) => c?.type === "arity")
  const digits = arityNode?.namedChildren?.find((c: any) => c?.type === "integer")?.text
  const arity = digits === undefined ? 0 : Number(String(digits))
  if (atom?.text) return { name: String(atom.text), arity }
  const varName = kids.find((c: any) => c?.type === "var")
  if (varName?.text) return { name: String(varName.text), arity }
  const macro = kids.find((c: any) => c?.type === "macro_call_expr" || c?.type === "macro_expr")
  const macroName = macro?.namedChildren?.find((c: any) => c?.type === "var" || c?.type === "atom")?.text
  if (macroName === "MODULE") return moduleName ? { name: moduleName, arity } : null
  return null
}

function firstAtom(n: any): any | null {
  for (const c of n?.namedChildren ?? []) if (c?.type === "atom") return c
  return null
}

function collectFas(n: any): any[] {
  return (n?.namedChildren ?? []).filter((c: any) => c?.type === "fa")
}

export function deriveErlangExportsTruth(root: any): ErlangOntologyEdge[] {
  const out: ErlangOntologyEdge[] = []
  const seen = new Set<string>()
  const named = (n: any): any[] => n?.namedChildren ?? []

  // FIRST `-module` wins (ER-D15), and it must be found before the lists are read
  // because `?MODULE` inside an export list resolves against it.
  let moduleName = ""
  const findModule = (n: any): boolean => {
    if (n?.type === "module_attribute") {
      const a = firstAtom(n)
      if (a?.text) { moduleName = a.text; return true }
    }
    for (const c of named(n)) if (findModule(c)) return true
    return false
  }
  findModule(root)
  const owner = moduleName || NO_MODULE

  const walk = (n: any): void => {
    if (n?.type === "export_attribute" || n?.type === "export_type_attribute") {
      const form = n.type === "export_type_attribute" ? "export_type" : "export"
      for (const fa of collectFas(n)) {
        const read = readFa(fa, moduleName)
        if (!read) continue
        const name = read.name
        if (!name) continue
        // The identity is name AND arity. `-export([check_named_bitstring/3,
        // check_named_bitstring/4])` on two adjacent lines is ordinary Erlang
        // (otp/lib/asn1/src/asn1rtt_check.erl:29-30 does exactly that), so a dedupe key
        // of `form|name` drops the second row. That is the whole class: the first version
        // of this oracle keyed on the name and the verifier reported 84 identity
        // mismatches on the corpus sample, every one of them a silently dropped
        // publication on both sides of the comparison.
        const key = `${form}|${name}|${read.arity}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          label: "exports",
          from: owner,
          target: name,
          identity: `${name}/${read.arity}`,
          form,
          line: fa.startPosition?.row != null ? fa.startPosition.row + 1 : undefined,
        })
      }
      return
    }
    if (n?.type === "import_attribute") {
      const mod = firstAtom(n)
      if (mod?.text) {
        const key = `import|${mod.text}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({
            label: "imports",
            from: owner,
            target: mod.text,
            form: "import",
            identity: collectFas(n).map((fa: any) => {
              const r = readFa(fa, moduleName)
              return r ? `${r.name}/${r.arity}` : ""
            }).filter(Boolean).join(","),
            importedNames: collectFas(n).map((fa: any) => readFa(fa, moduleName)?.name ?? "").filter(Boolean),
            line: mod.startPosition?.row != null ? mod.startPosition.row + 1 : undefined,
          })
        }
      }
      return
    }
    for (const c of named(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * The audited label set this lane's oracle actually derives, exported so a
 * consumer reads it from the emitter rather than restating it. It is the gate's
 * `ORACLE_LABELS` shape (`rel-type-coverage-gate.ts:187`), scoped to the labels
 * THIS module derives — `contains`, `calls`, `references`, `uses`, `implements` and
 * `instantiates` come from `oracles/erlang-contains.ts` and from
 * `differential.ts`'s `deriveErlangEdges`, and are listed here only so a reader of
 * this module sees the whole audited set in one place.
 */
export const ERLANG_ORACLE_LABELS = [
  "calls",
  "contains",
  "exports",
  "implements",
  "imports",
  "instantiates",
  "references",
  "uses",
] as const
