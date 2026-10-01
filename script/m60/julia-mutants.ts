/**
 * M60 — the Julia mutant set.
 *
 * Every entry is a faithful REVERT of a shape this lane was MEASURED to emit while it was being
 * built, written GENERICALLY off the result's own fields — never a name filter, because a name
 * filter silently stops matching the moment a fixture is renamed, and a mutant that cannot fail is
 * decoration.
 *
 * WHY THE SET IS BUILT FROM THIS LANE'S OWN DEFECTS. Each mutant reverts a defect that was actually
 * observed and fixed here, so a revert of a shape that never existed would test nothing and a
 * revert of a shape the lane shipped tests exactly the thing that would have shipped again.
 *
 * THE DEFECTS, for reference (the corpus numbers in each description are measured, not estimated):
 *   JUL-1  a qualified callee collapsed to its last segment — 72 measured collisions
 *   JUL-2  file-scope code emitted nothing; 71.9% of files have no module, 8,478 calls dropped
 *   JUL-3  the exit frame never restored the scope, so ownership drifted forward
 *   JUL-4  a short-form declaration is an invocation: 2,502 false self-calls
 *   JUL-5  `export X` fabricated a second symbol for X
 *   JUL-6  a type's own head is not a reference to itself
 *   JUL-7  a parameter's upper bound read as a supertype: `Circle <: Real`
 *   JUL-8  `binary_expression`'s operator is a NAMED child, so `<:` was invisible
 *   JUL-9  a struct was named after its SUPERTYPE by an identifier scan
 *   JUL-10 a C symbol from ccall/@ccall asserted as a Julia binding
 *   JUL-11 a generic method was invisible: the callee is a `parametrized_type_expression`
 *   JUL-12 a return-type annotation made the function publish under its RETURN TYPE
 *   JUL-13 `f(x)::T = …` is not the same tree shape as `f(x) = …`
 */
import type { Mutant } from "../m14/mutate-analyzer"

const rels = (r: any) => (r.relationships ?? []) as any[]
const syms = (r: any) => (r.symbols ?? []) as any[]

/** The last segment of a dotted path. */
const lastSeg = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t)

export const JULIA_MUTANTS: Mutant[] = [
  {
    id: "julia/qualified-path-to-last-segment",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-1 REVERT: a qualified callee collapses to its LAST SEGMENT, which is what the analyzer did " +
      "before `fieldPath` kept the whole path. Measured over 400 corpus files: 1,352 bare segments appear " +
      "behind a qualified path and 72 of them are reachable by MORE THAN ONE distinct path — `parse` alone " +
      "is `Meta.parse`, `Base.parse`, `TOML.parse` and `Dates.parse`, and `bitcast` is `Base.bitcast`, " +
      "`Core.bitcast` and `Intrinsics.bitcast`. Collapsing fuses unrelated functions into one node, and a " +
      "fused node makes every edge into and out of it a statement about the wrong function. Caught by the " +
      "`Base.show` symbol and by modules-and-scope.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => ({ ...x, target: lastSeg(String(x.target)) })),
      symbols: syms(r).map((s: any) => ({ ...s, name: lastSeg(String(s.name)) })),
    }),
  },
  {
    id: "julia/drop-file-scope-calls",
    language: "julia",
    defectClass: "omission",
    description:
      "JUL-2 REVERT: relationships sourced from the file scope are dropped, which is the pre-" +
      "`GLOBAL_SCOPE` shape (`if (scope)` guarding every emit). Measured over 295 corpus files: 71.9% of " +
      "Julia files have NO module block, and 46 of those emitted ZERO call edges while holding 8,478 " +
      "`call_expression`s between them — a script calling a dozen functions indexed as a file containing " +
      "nothing. Caught by the `global -calls-> println` assertion in modules-and-scope.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x: any) => x.source !== "global"),
    }),
  },
  {
    id: "julia/scope-drifts-forward",
    language: "julia",
    defectClass: "misattribution",
    description:
      "JUL-3 REVERT: `activeScope` is never restored on an exit frame, so it DRIFTS FORWARD and the last " +
      "declaration to advance it owns every later sibling. Reverted here by re-attributing every " +
      "relationship to the last symbol declared at or before its line — which is precisely the behaviour " +
      "the missing restore produced. On the fixture it moves `describe`'s body onto `Area`, the previous " +
      "function: `Area -calls-> string@17`, `Area -calls-> typeof@17`. Caught by dispatch-and-hierarchy's " +
      "`Geom -contains-> describe` and by the `describe` symbol's ownership.",
    transform: (r: any) => {
      const declared = syms(r)
        .filter((s: any) => typeof s.startLine === "number")
        .map((s: any) => ({ name: s.name, line: s.startLine as number }))
        .sort((a: any, b: any) => a.line - b.line)
      const ownerAt = (line: number) => {
        let owner = "global"
        for (const d of declared) { if (d.line <= line) owner = d.name; else break }
        return owner
      }
      return {
        ...r,
        relationships: rels(r).map((x: any) => {
          const line = Number(x.line_number ?? 0)
          if (!line) return x
          // Only re-attribute the usage edges; `contains` is ownership and was emitted correctly.
          if (x.type === "contains" || x.type === "extends") return x
          return { ...x, source: ownerAt(line) }
        }),
      }
    },
  },
  {
    id: "julia/self-call-restored",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-4 REVERT: a declaration's own left-hand side is walked as an invocation, so every short-form " +
      "function calls itself — `f(x) = …` DEFINES f and Julia does not invoke it there. Measured across " +
      "the 200-file corpus: 2,502 such false self-calls, the largest single source of wrong edges in the " +
      "lane. Caught by the `calls` forbids on Area, scaled and perimeter in dispatch-and-hierarchy.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...rels(r),
        ...syms(r)
          .filter((s: any) => s.kind === "function")
          .map((s: any) => ({
            type: "calls", source: s.name, target: s.name,
            confidence: 1, line_number: s.startLine,
            metadata: { juliaSpecific: true },
          })),
      ],
    }),
  },
  {
    id: "julia/export-fabricates-symbol",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-5 REVERT: `export X` fabricates a `function` symbol for X. An export MARKS a binding, it does " +
      "not declare one, and Julia allows the export to precede the declaration. Dedup could not merge it " +
      "because its key is `kind:owner:name` and the kinds differed, so a real `class:Circle` sat beside a " +
      "second, wrongly-kinded `Circle`. Caught by the `Circle`/`Square` symbol kinds in " +
      "dispatch-and-hierarchy.",
    transform: (r: any) => ({
      ...r,
      symbols: [
        ...syms(r),
        ...(r.exports ?? []).map((e: any) => ({
          name: e.name, kind: "function",
          ownerName: undefined, complexity: 1,
          metadata: { juliaSpecific: true, isExported: true, exportForm: "export_statement" },
        })),
      ],
    }),
  },
  {
    id: "julia/type-head-self-reference",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-6 REVERT: a type's OWN `type_head` is read as a reference, so every struct published a " +
      "reference to itself — `Shapes -references-> Circle`, a declaration stating itself. The head names " +
      "the type being declared. Caught by nothing in isolation (a self-reference is a weak signal), which " +
      "is why this mutant is kept: it is the shape the ancestor-aware guard in `withinTypeHead` exists to " +
      "prevent, and the guard's parent-only version passed the non-generic fixture case while missing " +
      "`Circle{T} <: Shape`.",
    transform: (r: any) => {
      // FIRST DRAFT WAS A NO-OP: it rewrote a `contains` edge whose SOURCE AND TARGET were both
      // declared types, and no such edge exists — a type contains its FIELDS, not another type. It
      // therefore mutated nothing and "survived".
      // The pre-fix shape is simpler than a rewrite: the type head NAMES the type, the
      // `parametrized_type_expression` case read it as a reference, and the type referenced ITSELF.
      // So the faithful revert is that edge, added per declared type.
      const typeNames = syms(r)
        .filter((s: any) => s.kind === "class" || s.kind === "interface")
        .map((s: any) => s.name)
      if (typeNames.length === 0) return r
      return {
        ...r,
        relationships: [
          ...rels(r),
          ...typeNames.map((name: string) => ({
            type: "references", source: name, target: name, confidence: 1,
            line_number: 0, metadata: { juliaSpecific: true, isTypeReference: true },
          })),
        ],
      }
    },
  },
  {
    id: "julia/parameter-bound-as-supertype",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-7 REVERT: the walk descends into a struct's type parameters, so `struct Circle{T<:Real} <: Shape` " +
      "published `Circle <: Real`. `T<:Real` bounds a PARAMETER; it says nothing about Circle's " +
      "supertype. A parameter list is a wall, not a road. Caught by the `Circle -extends-> Shape` and " +
      "`Square -extends-> Shape` assertions — a fabricated `extends Real` leaves those intact, so the " +
      "defect is visible as an EXTRA edge rather than a missing one.",
    transform: (r: any) => {
      // FIRST DRAFT WAS A NO-OP: it looked for a class literally named `T`, and no class is named
      // `T`, so it mutated nothing and was reported SURVIVING — which reads as "the suite cannot
      // catch this defect" when the truth is "the mutant cannot express it". A mutant that cannot
      // fail is decoration wearing a mutant's clothes.
      //
      // A GENERIC class is detected from the result instead: a class with a `references` edge to a
      // name that is not itself a declared type. `Circle -references-> T` is Circle's type
      // PARAMETER, and that is precisely the fact the pre-fix walk turned into a supertype edge.
      const declaredTypes = new Set(
        syms(r).filter((s: any) => s.kind === "class" || s.kind === "interface").map((s: any) => s.name),
      )
      const generic = new Set(
        rels(r)
          .filter((x: any) => x.type === "references" && !declaredTypes.has(String(x.target)))
          .map((x: any) => String(x.source)),
      )
      if (generic.size === 0) return r
      return {
        ...r,
        relationships: [
          ...rels(r),
          ...[...generic].map((name: string) => ({
            type: "extends", source: name, target: "Real", confidence: 1,
            line_number: 0, metadata: { juliaSpecific: true, isSubtype: true },
          })),
        ],
      }
    },
  },
  {
    id: "julia/drop-all-extends",
    language: "julia",
    defectClass: "omission",
    description:
      "JUL-8 REVERT: every `extends` edge is dropped, reproducing the state where `<:` was invisible " +
      "because `binary_expression`'s operator is a NAMED child at index 1 — so `pos(node,1)` returned the " +
      "operator instead of the right operand and an anonymous-child scan found nothing. Zero `extends` over " +
      "a corpus with thousands, on files that parse with zero ERROR nodes. Caught by both `extends` " +
      "assertions in dispatch-and-hierarchy.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x: any) => x.type !== "extends"),
    }),
  },
  {
    id: "julia/struct-named-after-supertype",
    language: "julia",
    defectClass: "misnaming",
    description:
      "JUL-9 REVERT: a type is published under its SUPERTYPE's name. `struct Circle{T<:Real} <: Shape` " +
      "makes the head a `binary_expression` whose first identifier anywhere in the subtree is `Shape`, so " +
      "one `class:Shape` carried `contains -> radius` and the real `Circle` was absent — name and " +
      "supertype swapped by the same mistake. Caught by the `Circle` and `Square` class symbols in " +
      "dispatch-and-hierarchy.",
    transform: (r: any) => {
      // FIRST DRAFT WAS A NO-OP: it renamed a class only when the class was ALREADY named like an
      // interface, which the fixed result never is, so it renamed nothing and "survived".
      // The pre-fix shape is the opposite: EVERY generic struct collapsed onto its SUPERTYPE's name,
      // because the identifier scan returned the first identifier in the type head, which on a
      // `<:` binary expression is the supertype. So each class is renamed onto the interface it
      // extends — `class:Circle` becomes `class:Shape` and `Circle` disappears entirely.
      const ifaces = new Set(syms(r).filter((s: any) => s.kind === "interface").map((s: any) => s.name))
      if (ifaces.size === 0) return r
      const supFor = new Map<string, string>()
      for (const x of rels(r)) if (x.type === "extends" && ifaces.has(x.target)) supFor.set(x.source, x.target)
      const collapse = (n: string) => supFor.get(n) ?? n
      return {
        ...r,
        symbols: syms(r).map((s: any) => (s.kind === "class" ? { ...s, name: collapse(String(s.name)) } : s)),
        relationships: rels(r).map((x: any) => ({ ...x, source: collapse(String(x.source)) })),
      }
    },
  },
  {
    id: "julia/foreign-call-unmarked",
    language: "julia",
    defectClass: "misattribution",
    description:
      "JUL-10 REVERT: a call reached through `ccall`/`@ccall` is marked as a Julia binding call. The call " +
      "is real; the claim that its target is a JULIA FUNCTION is not — `strlen` and `jl_issorted` are C " +
      "symbols that do not exist in Julia's namespace. Caught by all three `meta.isForeignCall` assertions " +
      "in macros-and-foreign.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        const md = { ...(x.metadata ?? {}) }
        delete md.isForeignCall
        delete md.foreignSymbol
        delete md.foreignLibrary
        delete md.via
        return { ...x, metadata: md }
      }),
    }),
  },
  {
    id: "julia/generic-methods-invisible",
    language: "julia",
    defectClass: "omission",
    description:
      "JUL-11 REVERT: a generic method's declaration is dropped. `function scaled{T<:Real}(s, k)` has callee " +
      "children `parametrized_type_expression` + `argument_list`, which `calleeName` did not handle, so " +
      "Julia's most characteristic construct — a parametric method — was invisible to the lane whose job " +
      "is to notice that. Caught by the `scaled` symbol in dispatch-and-hierarchy.",
    transform: (r: any) => {
      // A generic method is the one whose declared name also appears as a `where`/parameter target;
      // drop function symbols that some relationship references only through a type-parameter name.
      // FIRST DRAFT KEYED ON A SELF-REFERENCE, and then the self-reference it keyed on was FIXED —
      // so the mutant went from CAUGHT to SURVIVED by being made obsolete by a real bug fix. That is
      // worth recording: a mutant can stop testing anything without anyone touching it, and "SURVIVED"
      // would have been read as a fixture weakness when it was a stale key.
      //
      // A GENERIC function is detected the same way a generic class is: a `references` edge to a name
      // that is not a declared type. `scaled -references-> T` is a type parameter, and `scaled` is the
      // method whose declaration was invisible while `calleeName` could not read a
      // `parametrized_type_expression`.
      const declaredTypes = new Set(
        syms(r).filter((s: any) => s.kind === "class" || s.kind === "interface" || s.kind === "module").map((s: any) => s.name),
      )
      const fnNames = new Set(syms(r).filter((s: any) => s.kind === "function").map((s: any) => s.name))
      const generic = new Set(
        rels(r)
          .filter((x: any) => x.type === "references" && !declaredTypes.has(String(x.target)) && !fnNames.has(x.target))
          .map((x: any) => String(x.source)),
      )
      if (generic.size === 0) return r
      return { ...r, symbols: syms(r).filter((s: any) => !(s.kind === "function" && generic.has(String(s.name)))) }
    },
  },
  {
    id: "julia/return-type-becomes-function-name",
    language: "julia",
    defectClass: "misnaming",
    description:
      "JUL-12 REVERT: a function carrying a RETURN-TYPE annotation publishes under the return type. " +
      "`function scaled{T<:Real}(s::Shape, k::T)::Float64` makes the signature a `typed_expression` whose " +
      "siblings are the callable and the return type, so an identifier scan found `Float64` first and " +
      "`scaled` was lost. Third instance of the same class in this lane: scan for a name before unwrapping " +
      "the wrapper around it. Caught by the `scaled` symbol and `Geom -contains-> scaled`.",
    transform: (r: any) => {
      // FIRST DRAFT WAS A NO-OP: it looked for a function symbol ALREADY named `Float64`, which the
      // fixed analyzer never produces, so it mutated nothing and "survived".
      // The pre-fix shape: the identifier scan returned the RETURN TYPE, so the function published
      // under it and vanished. Detected from the result instead — a function whose `references` edges
      // include a type name is a function that DECLARED a return type, and that is the scan's victim.
      const declaredTypes = new Set(
        syms(r).filter((s: any) => s.kind === "class" || s.kind === "interface" || s.kind === "module").map((s: any) => s.name),
      )
      const fnNames = new Set(syms(r).filter((s: any) => s.kind === "function").map((s: any) => s.name))
      const victim = new Map<string, string>()
      for (const s of syms(r).filter((x: any) => x.kind === "function")) {
        const retType = rels(r).find(
          (x: any) => x.type === "references" && x.source === s.name &&
            !declaredTypes.has(String(x.target)) && !fnNames.has(x.target),
        )
        if (retType) victim.set(String(s.name), String(retType.target))
      }
      if (victim.size === 0) return r
      const rename = (n: string) => victim.get(n) ?? n
      return {
        ...r,
        symbols: syms(r).map((s: any) =>
          s.kind === "function" ? { ...s, name: rename(String(s.name)) } : s),
        relationships: rels(r).map((x: any) => ({ ...x, source: rename(String(x.source)) })),
      }
    },
  },
  {
    id: "julia/return-type-form-invisible",
    language: "julia",
    defectClass: "omission",
    description:
      "JUL-13 REVERT: `f(x)::T = …` is not recognised as a declaration. A return-type annotation puts a " +
      "`typed_expression` on the assignment's left, so the short-form handler's `call_expression` test " +
      "failed. `x::Int = 5` is also a `typed_expression`, so the wrapper is unwrapped only when it wraps a " +
      "CALL. Caught by the `perimeter` symbol in dispatch-and-hierarchy.",
    transform: (r: any) => ({
      ...r,
      symbols: syms(r).filter((s: any) => {
        if (s.kind !== "function") return true
        // Revert: a function whose only relationship evidence is a return-type reference is dropped.
        const hasTypedRef = rels(r).some(
          (x: any) => x.type === "references" && x.source === s.name && String(x.target).length > 0,
        )
        return !(hasTypedRef && s.metadata?.declarationForm === "short_form_assignment")
      }),
    }),
  },
  {
    id: "julia/construction-before-declaration",
    language: "julia",
    defectClass: "misclassification",
    description:
      "REVERT: `declaredTypes` is filled DURING the walk, so a call to a type declared LATER in the " +
      "file is a plain `calls` instead of `instantiates`. The pre-fix code consulted the set mid-walk; " +
      "the comment on the variable already claimed the opposite ('consulted afterwards, so a type " +
      "declared later in the file still counts'), which is why it survived review — the code said one " +
      "thing and the comment the other, and the comment was believed. Found by the F5 `instantiates` " +
      "oracle: `Compiler/test/EAUtils.jl` calls `GetEscapeCache()` on line 52 and declares it on line " +
      "90. Reverted generically by demoting every `instantiates` edge whose line precedes the type's " +
      "own declaration.",
    transform: (r: any) => {
      const firstDecl = new Map<string, number>()
      for (const s of syms(r)) {
        if (s.kind !== "class" && s.kind !== "interface") continue
        // Symbols carry their line at `range.startLine`, NOT `startLine`. A first version read
        // `s.startLine`, got undefined, skipped every symbol, and the transform quietly did nothing
        // — reported as SURVIVING, which is indistinguishable from a fixture the suite cannot catch.
        const line = Number(s.range?.startLine ?? s.startLine ?? 0)
        if (line && (!firstDecl.has(s.name) || line < firstDecl.get(s.name)!)) firstDecl.set(s.name, line)
      }
      if (firstDecl.size === 0) return r
      return {
        ...r,
        relationships: rels(r).map((x: any) =>
          x.type === "instantiates" && firstDecl.has(x.target) && Number(x.line_number ?? 0) < firstDecl.get(x.target)!
            ? { ...x, type: "calls" }
            : x),
      }
    },
  },
  {
    id: "julia/where-bound-extends-scope-guarded",
    language: "julia",
    defectClass: "omission",
    description:
      "REVERT: a `where` clause's upper bound is a subtype edge from the type PARAMETER, and the emit " +
      "was guarded by `scope` even though `scope` is not that edge's source. Copy-pasted from the " +
      "`contains` cases, where the scope IS the source and the guard is the point — so it suppressed a " +
      "valid edge wherever the bound appeared at FILE SCOPE, which is 71.9% of Julia files. Found by " +
      "the F5 `extends` oracle: `base/rational.jl` publishes `T extends AbstractFloat` and " +
      "`base/hashing.jl` `UTF8Units extends AbstractString`, neither of which the analyzer had. Reverted " +
      "by dropping the `isWhereBound` edges, which is the pre-fix observable.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x: any) => !(x.type === "extends" && x.metadata?.isWhereBound === true)),
    }),
  },
  {
    id: "julia/braced-where-bound-invisible",
    language: "julia",
    defectClass: "omission",
    description:
      "REVERT: the `where`-bound scan looks only at the where_expression's DIRECT children, so the " +
      "braced spelling `where {T<:Real}` is missed while the bare `where T<:Real` is found. Julia " +
      "people write the braced form, so the common shape produced no `T extends Real` at all. Found " +
      "because this mutant SURVIVED its first form: a fixture whose `where` bound was invisible to " +
      "the analyzer could not catch the defect that hid it, and a fixture and an analyzer agreeing " +
      "on nothing is not a test. Caught by the `T extends Real` assertion in dispatch-and-hierarchy.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x: any) => !(x.type === "extends" && x.metadata?.isWhereBound === true)),
    }),
  },
]
