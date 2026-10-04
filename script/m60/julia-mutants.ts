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
 *   JUL-14 the whole `overrides` TYPE was absent — the header's ruling was prose, and the
 *           differential could not convict it because the julia oracle region omits the type too
 *   JUL-15 `overrides` was published for a REPLACEMENT THAT NEVER HAPPENS: `isUnconditionalPosition`
 *           read `&&`'s right operand at named-child index 1 while the operator is a NAMED child,
 *           so the guard never matched and the corpus's one version-guarded method definition
 *           produced an edge
 */
import type { Mutant } from "../m14/mutate-analyzer"

const rels = (r: any) => (r.relationships ?? []) as any[]
const syms = (r: any) => (r.symbols ?? []) as any[]

/** The last segment of a dotted path. */
const lastSeg = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t)

export const JULIA_MUTANTS: Mutant[] = [
  {
    id: "julia/drop-overrides-edges",
    language: "julia",
    defectClass: "omission",
    description:
      "JUL-14 REVERT: every `overrides` relationship is dropped, which is the pre-M60 state of this lane " +
      "in its entirety. The analyzer's file header DECLINED the type on the grounds that julia has multiple " +
      "dispatch rather than overriding, and nothing measured that claim: julia's method table holds one " +
      "entry per (name, signature) pair, so a second declaration of the SAME pair REPLACES the first — julia " +
      "prints `WARNING: Method definition f(Int) … overwritten at line 40` under `--warn-overwrite=yes`. " +
      "Measured over the 971 admitted corpus files: 417 redefinition declarations across 109 files, of which " +
      "130 across 51 files are unconditional and therefore publishable. `script/m14/ontology-coverage-gate.ts`'s " +
      "header records the bash instance of this same failure (BD8b). Caught by the two `overrides` rows in " +
      "`method-redefinition-overrides` — a fixture authored from the measurement, not from the code.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x: any) => String(x.type ?? x.relationshipType ?? "").toLowerCase() !== "overrides"),
    }),
  },
  {
    id: "julia/overrides-without-position-guard",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-15 REVERT: `isUnconditionalPosition`'s short-circuit test is disabled, so a redeclaration inside " +
      "`if`/`else`, `try`/`catch`, a ternary, a `&&`/`||` right operand, or generated code publishes an " +
      "`overrides` edge for a replacement that never happens. This is not hypothetical — it is what the lane " +
      "shipped for one measurement round, because the operator of a `binary_expression` is a NAMED child in " +
      "this grammar, so the operand list is [left, operator, right] and the first version compared index 1 " +
      "against the declaration's node id and never matched. Measured over 971 admitted files: 11,549 `&&` " +
      "binary_expressions, exactly 1 with a declaration node on the right " +
      "(`julia/JuliaSyntax/src/core/parse_stream.jl:316`, `VERSION < v\"1.11.0-DEV.753\" && function " +
      "ParseStream(io::IOBuffer; version=VERSION)`), plus 287 of the 417 corpus redefinition declarations " +
      "sitting in a conditional or generated position — 287 edges that would be counted `unexplained` by the " +
      "oracle and would make a real method's absence look like a caller. " +
      "Written off the SOURCE TEXT because the pre-fix output cannot be reconstructed from the post-fix " +
      "result: the result carries no record of which declaration was refused, which is the whole content of " +
      "this mutation. Caught by the `guarded` and `toplevel_only` forbid rows in `method-redefinition-overrides`.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      // The pre-guard rule, restated over the source: two declarations of the same name with the same
      // argument list, wherever they sit. `f(x) = …` and `function f(x) … end` are both declarations in
      // this grammar, so both spellings are read — reading only one would produce a mutant that cannot
      // express half the defect it names.
      const seen = new Map<string, number>()
      const re = /^(\s*)(?:function\s+([A-Za-z_][\w!]*)\s*\(|([A-Za-z_][\w!]*)\s*\()/gm
      let m: RegExpExecArray | null
      const added: any[] = []
      while ((m = re.exec(source))) {
        const name = m[2] ?? m[3] ?? ""
        if (!name) continue
        // The argument list is the balanced paren run after the name — enough to separate `f(x)` from
        // `f(x, y)` without reproducing the analyzer's normaliser.
        let i = re.lastIndex - 1
        let depth = 0
        let args = ""
        for (; i < source.length; i++) {
          const c = source[i]
          if (c === "(") { depth++; if (depth === 1) continue }
          if (c === ")") { depth--; if (depth === 0) { args += c; i++; break } }
          args += c
        }
        re.lastIndex = i
        const key = `${name}|${args.replace(/\s+/g, " ")}`
        const prior = seen.get(key)
        if (prior !== undefined && !added.some((x) => x.target === name)) {
          added.push({
            type: "overrides", source: name, target: name, confidence: 1,
            line_number: source.slice(0, m.index).split("\n").length,
            metadata: { juliaSpecific: true, redefinition: true, mutant: "JUL-15" },
          })
        } else if (prior === undefined) {
          seen.set(key, source.slice(0, m.index).split("\n").length)
        }
      }
      if (added.length === 0) return r
      return { ...r, relationships: [...rels(r), ...added] }
    },
  },
  {
    id: "julia/overrides-ignores-local-scope",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-16 REVERT: the `overrides` pre-pass stops refusing LOCAL BINDINGS and stops carrying the " +
      "enclosing scope in its key, so two closures in different function bodies collide into one " +
      "\"method\". This is not a hypothetical: an earlier revision of this lane published 14 fabricated " +
      "edges of exactly this shape before the fix. `julia/JuliaLowering/src/desugaring.jl` declares " +
      "`wrap(asgn) = …` at line 153 inside `tuple_to_assignments` and again at line 324 inside a " +
      "different function; `julia/base/range.jl` declares `throwbool(r) = …` at lines 488 and 496, " +
      "inside two different inner constructors of `OneTo`. Inside a function body a short-form " +
      "definition binds a LOCAL variable holding a closure — it adds no method and displaces nothing — " +
      "so each of those 14 edges asserted a replacement between functions with no relationship. Two of " +
      "them also named a `property` and a `constant` as the overridden method " +
      "(`julia/test/core.jl:4441` -> `foo`, `:5489` -> `bar`), which is the tell: a field and a " +
      "binding are not methods. " +
      "Written off the SOURCE TEXT because the post-fix result cannot express this revert — it carries " +
      "no record of the declarations the guard refused, which is the entire content of the mutation. " +
      "Caught by the `wrap` forbid row in `method-redefinition-overrides`.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      // The pre-fix key: `name|signature`, no scope, no local check. Same balanced-paren argument
      // scan as JUL-15 so the two mutants differ in exactly the one rule each names.
      const seen = new Map<string, number>()
      const re = /(?:function\s+([A-Za-z_][\w!]*)\s*\(|([A-Za-z_][\w!]*)\s*\()/g
      let m: RegExpExecArray | null
      const added: any[] = []
      const touched = new Set<string>()
      while ((m = re.exec(source))) {
        const name = m[1] ?? m[2] ?? ""
        if (!name) continue
        let i = re.lastIndex - 1
        let depth = 0
        let args = ""
        for (; i < source.length; i++) {
          const c = source[i]
          if (c === "(") { depth++; if (depth === 1) continue }
          if (c === ")") { depth--; if (depth === 0) { args += c; i++; break } }
          args += c
        }
        re.lastIndex = i
        const key = `${name}|${args.replace(/\s+/g, " ")}`
        const prior = seen.get(key)
        if (prior !== undefined && !touched.has(name)) {
          touched.add(name)
          added.push({
            type: "overrides", source: name, target: name, confidence: 1,
            line_number: source.slice(0, m.index).split("\n").length,
            metadata: { juliaSpecific: true, redefinition: true, mutant: "JUL-16" },
          })
        } else if (prior === undefined) {
          seen.set(key, source.slice(0, m.index).split("\n").length)
        }
      }
      if (added.length === 0) return r
      return { ...r, relationships: [...rels(r), ...added] }
    },
  },
  {
    id: "julia/overrides-drops-where-clause",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-17 REVERT: the `overrides` signature key drops the `where` clause, so two methods of the same " +
      "generic function whose ARGUMENT LISTS agree but whose type-variable BOUNDS differ collide. " +
      "Julia keys the method table on the fully-specialised signature, so `f(x) where {T<:SignedInt}` and " +
      "`f(x) where {T<:UnsignedInt}` are two live methods and neither replaces the other; publishing a " +
      "replacement between them is the same falsehood the lane's own file header declined to tell about " +
      "this type. Three corpus pairs were publishing exactly that edge: " +
      "`julia/base/checked.jl:138-139` (`add_with_overflow`, `{T<:SignedInt}` vs `{T<:UnsignedInt}`), " +
      "`julia/base/math.jl:834` and `:838` (`min`, `{T<:AbstractFloat}` vs `{T<:IEEEFloat}`), and " +
      "`julia/test/testhelpers/Furlongs.jl:21-22` (`Furlong{p}`, `where {p,q}` vs `where {T,p,q}`). " +
      "The cause is positional: the clause hangs off the assignment's LEFT-HAND SIDE, and the key was " +
      "taken from the callable after `unwrapWhere` had descended past it. " +
      "Written off the SOURCE TEXT, because the post-fix result records the clause and the revert is its " +
      "removal — a transform that cannot see the source would have to re-derive the whole key. Caught by " +
      "the `bounded` rows in `method-redefinition-overrides`: the `{T<:UnsignedInt}` declaration must " +
      "produce no edge, and without the clause it does.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const rows = rels(r).filter((x: any) => String(x.type ?? "") === "overrides")
      if (rows.length === 0 || !source.includes("where")) return r
      // The pre-fix key verbatim: `name|args`, with the `where` clause DISCARDED. Scanned off the
      // source because the pre-fix output cannot be reconstructed from the post-fix result — the
      // result records the clause, so the revert is its absence.
      const scopeOf = new Map<string, string>()
      for (const x of rows) scopeOf.set(String(x.target), String(x.source))
      const firstLine = new Map<string, number>()
      const added: any[] = []
      const re = /^[ \t]*([A-Za-z_][\w!]*)\s*\(([^)]*)\)[^\n=]*\bwhere\b[^\n=]*=/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(source))) {
        const name = m[1] ?? ""
        if (!scopeOf.has(name)) continue
        // The pre-fix key's args portion is the `argument_list` NODE's text, so the PARENS are part
        // of it: `(x)`, not `x`. Dropping them here made the row's `signature` `"x"` and the
        // fixture's forbid row could not name it — which is itself the lesson the repo already has
        // about mutants that cannot express the defect they describe.
        const argsText = `(${(m[2] ?? "").replace(/\s+/g, " ").trim()})`
        const key = `${name}|${argsText}`
        const line = source.slice(0, m.index).split("\n").length
        const prior = firstLine.get(key)
        if (prior !== undefined) {
          added.push({
            type: "overrides", source: scopeOf.get(name)!, target: name, confidence: 1,
            line_number: line,
            // The pre-fix `methodSignatureKey` returned the argument list alone for a `where`-form
            // short declaration, and that string is what landed in `metadata.signature`. Carrying it
            // is what makes the row distinguishable from the correct one, whose signature keeps the
            // clause — so the fixture's forbid row can name the defect instead of the fixture simply
            // having to accept "any `overrides` edge on this name".
            metadata: { juliaSpecific: true, redefinition: true, replacesLine: prior, signature: argsText, mutant: "JUL-17" },
          })
        } else {
          firstLine.set(key, line)
        }
      }
      if (added.length === 0) return r
      return { ...r, relationships: [...rels(r), ...added] }
    },
  },
  {
    id: "julia/overrides-ignores-scope-line",
    language: "julia",
    defectClass: "fabrication",
    description:
      "JUL-18 REVERT: the `overrides` pre-pass key drops the scope's DECLARATION LINE, so two modules " +
      "that share a name are one scope and a declaration in the second reads as replacing one in the " +
      "first. Julia treats them as two modules with two method tables. Corpus shape: " +
      "`julia/test/deprecation_exec.jl` declares `module Src` at line 325 inside " +
      "`DeprecatedReexportTest` and again at line 358 inside `DeprecatedShadowTest`, each holding a " +
      "`newg() = 1` at lines 329 and 364. Keyed on the name alone the edge is a fabricated replacement " +
      "between two unrelated bindings. " +
      "This mutant exists because the FIX for it did not work at first and the fixtures could not see " +
      "that: the scope NAME was threaded down the pre-pass while its line reset to 0 at every frame, so " +
      "every key came out `name@0` and the change was indistinguishable from no change. A lane with one " +
      "module in its fixture has no way to catch that; the census caught it by reading the source of " +
      "every edge the lane published. Caught by the `same` forbid row in " +
      "`method-redefinition-overrides`.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const rows = rels(r).filter((x: any) => String(x.type ?? "") === "overrides")
      if (rows.length === 0) return r
      // Two same-named scopes, each with a zero-argument method of the same name. Emitted from the
      // SOURCE rather than from the result because the post-fix result carries no record of the
      // rejected declaration, which is the entire content of this revert.
      const re = /^\s*module\s+(\w+)\s*$(.*?)^\s*end\s*$/gms
      let m: RegExpExecArray | null
      const added: any[] = []
const firstByScope = new Map<string, { scope: string; line: number }>()
      // ANY argument list, not an empty one — a first version matched `\(\)` and therefore matched
      // nothing in the fixture, which has `same(x) = 1`. That is the third time in this file's history
      // that a mutant written to describe a defect could not express it.
      const scopeRe = /^\s*([A-Za-z_][\w!]*)\s*\([^)]*\)\s*=/gm
      while ((m = re.exec(source))) {
        const scope = m[1] ?? ""
        const body = m[2] ?? ""
        const bodyStart = source.slice(0, m.index).split("\n").length
        scopeRe.lastIndex = 0
        let d: RegExpExecArray | null
        while ((d = scopeRe.exec(body))) {
          const name = d[1] ?? ""
          if (!name) continue
          const line = bodyStart + body.slice(0, d.index).split("\n").length - 1
          const prior = firstByScope.get(name)
          // The map is keyed on the NAME and is deliberately NOT cleared between modules — that is
          // the defect. Keyed on the name alone, two same-named modules are one scope, and the flag
          // fires when the same method name turns up under a scope NAME that differs from the first
          // sighting's. Within one scope the redefinition is real and the fixture already pins it, so
          // only the cross-scope case is emitted here.
          if (prior && prior.scope !== scope) {
            added.push({
              type: "overrides", source: scope, target: name, confidence: 1, line_number: line,
              metadata: { juliaSpecific: true, redefinition: true, replacesLine: prior.line, mutant: "JUL-18" },
            })
          } else if (!prior) {
            firstByScope.set(name, { scope, line })
          }
        }
      }
      if (added.length === 0) return r
      return { ...r, relationships: [...rels(r), ...added] }
    },
  },
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
  {
    id: "julia/imports-source-collapses-to-root",
    language: "julia",
    defectClass: "mislabel",
    description:
      "REVERT: an `imports` edge's source is the declaration doing the importing, not the file root. " +
      "This mutant rewrites every `imports` source to `root` and is the REVERT of the exact distinction " +
      "this lane's own `imports` RULED on: the ruling's overturn condition was 'a julia `imports` " +
      "relationship row that is not an import-site artifact — a row whose source is the importing " +
      "declaration rather than the literal `root`'. Emitting `imports` at all was therefore read as " +
      "refuting the ruling, and the fix that satisfied the condition was mistaken for a violation of " +
      "it. Measured over the 971 admitted corpus files, 446 of 1,502 `imports` edges carry a real " +
      "module symbol as their source and 595 carry the file scope; collapsing the two asserts that " +
      "`module M` depends on packages it never named. Caught by the four `imports` assertions and two " +
      "`forbidRelationships` in `imports-and-exports`.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => (x.type === "imports" ? { ...x, source: "root" } : x)),
    }),
  },
  {
    id: "julia/drop-imports-relationships",
    language: "julia",
    defectClass: "omission",
    description:
      "REVERT: every `imports` relationship is dropped while the `ImportInfo[]` channel keeps filling, " +
      "which is the pre-M60 state of this lane. The lane recorded the construct on the payload and " +
      "declined to publish it as an edge, then RULED it non-applicable on the grounds that " +
      "`RelationshipType.Imports` serializes to `brain_import` and the repo treats `ImportInfo[]` as " +
      "the import surface — a convention read as a constraint, since `real-python-analyzer.ts:979`, " +
      "`real-lua-analyzer.ts:569`, `real-yaml-analyzer.ts:1017`, `real-nim-analyzer.ts:1064` and " +
      "`real-typescript-analyzer.ts:5509` all emit the relationship through the same string. The " +
      "construct is not rare in julia: 1,675 `import_statement`/`using_statement` nodes across 504 of " +
      "the 971 admitted files. Caught by the `imports` assertions in `imports-and-exports`.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x: any) => x.type !== "imports"),
    }),
  },
  {
    id: "julia/drop-exports-relationships",
    language: "julia",
    defectClass: "omission",
    description:
      "REVERT: every `exports` relationship is dropped while the `ExportInfo[]` channel keeps filling. " +
      "The ruling this reverts demanded 'an `exports` relationship count above the `ExportInfo` count " +
      "for the same corpus' — a threshold that emitting one row per `ExportInfo` entry cannot exceed, so " +
      "the only way to satisfy it was an edge that was WRONG. `real-python-analyzer.ts:1166` emits " +
      "both channels from one `__all__` walk. Measured: 308 `export_statement`/`public_statement` " +
      "nodes across 152 of the 971 admitted files, publishing 1,770 export names. Caught by the " +
      "`exports` assertions in `imports-and-exports`.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x: any) => x.type !== "exports"),
    }),
  },
  {
    id: "julia/exports-source-collapses-to-root",
    language: "julia",
    defectClass: "mislabel",
    description:
      "REVERT: an `exports` edge's source is the module doing the exporting. This mutant rewrites every " +
      "`exports` source to `root`, which is the collapse the `imports` source mutant performs in the " +
      "other direction: it makes a module's published surface indistinguishable from a file's, so " +
      "`bb_impact` on a module reports every re-export of every module in the corpus as its own " +
      "dependents. Measured: 962 of 1,770 `exports` edges carry a real module symbol as their source " +
      "and 783 carry the file scope, because 71.9% of julia corpus files open no module at all and " +
      "julia's `public`/`export` are legal at file scope in `Main`. Caught by the `exports` " +
      "assertions and the two `exports` `forbidRelationships` in `imports-and-exports`.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => (x.type === "exports" ? { ...x, source: "root" } : x)),
    }),
  },
]
