/**
 * FSHARP MUTANTS — the lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY THIS IS A SEPARATE FILE. `script/m14/mutate-analyzer.ts` is a shared registry that
 * several lanes edit concurrently. A 259-line block written into it was overwritten within
 * the hour by another lane's edit, and the overwrite was SILENT — the file stayed
 * syntactically valid and the gate kept reporting numbers, with the fsharp lane's
 * mutants simply absent from them. A two-line import is the whole footprint this lane
 * keeps in the shared file, and the work itself lives somewhere the lane owns.
 *
 * WHAT EACH MUTANT IS. M14.0.F4's rule is that a deliberately injected defect MUST make
 * the suite red: a surviving mutant fails THE SUITE, not the mutant, because a suite that
 * stays green whatever you do to the code is decoration. Each entry below is a revert of
 * one defect class this lane's own round measured on real F#, and each names the fixture
 * that catches it and the measurement that found it.
 *
 * SIX of the eleven are a revert of a class the round FIXED. One (the forward-declaration
 * guard) is a REGRESSION guard for a bug the round itself introduced and then removed —
 * without it, a rule that was wrong once is free to be wrong again. One (the export
 * surface) was caught by the fixture runner's own invariant rather than by this lane, and
 * is here so the export contract is pinned from the analyzer's side too. Two
 * (`recursive-call-as-a-self-edge`, `property-getter-contract-absent`) revert defects the
 * lane's own TRUTH ORACLE had, which is the other half of what a differential is for: it
 * found bugs on both sides.
 *
 * The `defectClass` values are the harness's own vocabulary; `regression-guard` and
 * `wrong-payload` are the two added by this lane, and the reasons are in the descriptions.
 */
import type { Mutant } from "./mutate-analyzer"

/**
 * ENDPOINT MATCHING IN THE FIXED SPELLING — FS-P4-1/FS-P4-2.
 *
 * Four of the mutants below identify the edges they re-break by the SPELLING of an
 * endpoint: `source === target` (the blanket self-edge refusal), `source === Probe`
 * (the setter's parameter), `source === Describe` (the `default` implementation), and
 * `anon.has(source)` (an object expression's members). Every one of those spellings was
 * a BARE name, and pass 4 made every edge endpoint that names a symbol this file
 * publishes carry that symbol's published identity instead (`Owner.member`). The
 * mutants kept compiling, kept running, and silently matched NOTHING — four greens that
 * meant nothing, which is the failure mode this file's own header calls out.
 *
 * The fix is not to re-spell the four literals: it is to match the endpoint in a way
 * that does not depend on the spelling at all, because the DEFECT these mutants revert
 * is about identity, not about text. An endpoint matches a name when it IS that name or
 * when it ENDS with `.` + that name — which is exactly the relation the pre-fix spelling
 * expressed, and which stays true under any future re-spelling.
 */
const matchesEndpoint = (names: Set<string>, value: unknown): boolean => {
  const v = String(value ?? "")
  if (names.has(v)) return true
  for (const n of names) if (n && v.endsWith(`.${n}`)) return true
  return false
}

/** Does this `calls` edge name the same declaration on both ends? */
const isSelfCallEdge = (x: any): boolean =>
  String(x?.type) === "calls" &&
  (String(x.source) === String(x.target) || String(x.source).endsWith(`.${String(x.target)}`))

export const FSHARP_MUTANTS: Mutant[] = [
  {
    id: "fsharp/type-extension-redeclares-the-type",
    language: "fsharp",
    defectClass: "duplicate-symbol",
    description:
      "PRE-FIX (FS-D2): a `type X with …` is F#'s only way to add members to a type declared elsewhere, so it is not a declaration of X. The grammar wraps every extension in a `type_definition`, and the branch minted a second Class symbol named after the extended type. Measured: 54 duplicate type symbols per 400 real files, every one a `type_definition` + `type_extension` pair at the same line. Reverted by re-publishing a symbol for each the analyzer itself marked `isTypeExtension` — read off the result's own metadata, so the mutant cannot silently stop matching if a fixture changes. The pre-fix extension ALSO produced `contains X -> X` (the containment pass emitted an edge for every symbol with an owner), so a faithful revert re-adds both: a first draft re-published the symbol alone and SURVIVED, because the fixture's forbid rows pin the EDGE. Caught by fsharp/type-extension-and-containment, which pins ONE `Foo` with both the declaration's and the extension's members owned by it, and forbids the six self-edges naming all three sources of the FS-D3 class.",
    transform: (r: any) => {
      const exts = (r.symbols ?? []).filter((s: any) => s.metadata?.isTypeExtension === true)
      if (exts.length === 0) return r
      return {
        ...r,
        symbols: [
          ...(r.symbols ?? []),
          ...exts.map((s: any) => ({ ...s, kind: "class", metadata: { nodeType: "type_extension" } })),
        ],
        relationships: [
          ...(r.relationships ?? []),
          ...exts.map((s: any) => ({
            type: "contains",
            source: String(s.name),
            target: String(s.name),
            confidence: 1,
            line_number: s.range?.startLine,
            metadata: { nodeType: "type_extension", isContained: true },
          })),
        ],
      }
    },
  },
  {
    id: "fsharp/self-containing-edge",
    language: "fsharp",
    defectClass: "wrong-relationship",
    description:
      "PRE-FIX (FS-D3): `contains` was emitted for every symbol with an owner, so a name could contain itself. Measured: 368 self-edges per 400 real files from three distinct sources — a DU case named after its own type (305; `type TypeProviderDesignation = TypeProviderDesignation of string` is a real, common F# spelling), a member named after its own type (3: `E.E`, `MatchClause.Pattern`, `Map.Map`), and the type_extension of FS-D2. The refusal belongs at COMPOSITION, where the labels are composed, because the DU case genuinely IS contained by its union — suppressing the label instead would lose a real fact. Reverted by re-adding every dropped self-edge. Caught by fsharp/type-extension-and-containment, whose six forbid rows name all three sources.",
    transform: (r: any) => {
      const selfNamed = (r.symbols ?? []).filter((s: any) => s.ownerName && String(s.ownerName) === String(s.name))
      if (selfNamed.length === 0) return r
      return {
        ...r,
        relationships: [
          ...(r.relationships ?? []),
          ...selfNamed.map((s: any) => ({
            type: "contains",
            source: String(s.ownerName),
            target: String(s.name),
            confidence: 1,
            line_number: s.range?.startLine,
            metadata: { nodeType: s.metadata?.nodeType || "symbol", isContained: true },
          })),
        ],
      }
    },
  },
  {
    id: "fsharp/declared-type-graph-absent",
    language: "fsharp",
    defectClass: "missing-whole-class",
    description:
      "PRE-FIX (FS-D4): the R9 declared-type reference graph was absent from this lane entirely. script/m60/declared-type-refs-census.ts measured `absent` WITH THE CONTROL PRESENT — the snippet parses, the holder symbol is walked, and the lane emitted no type reference of any kind. Thirteen lanes emit it; rust's own R13 header calls it a family standard. An absent capability emits nothing, so no per-edge oracle can adjudicate it, which is why it survived: every gate the lane had asked whether an edge that EXISTS is right. Reverted by dropping every `references` edge marked `declared_type`. Caught by fsharp/declared-type-graph (all seven positions) and fsharp/call-ownership (the class-field, parameter, local and return positions).",
    transform: (r: any) => {
      const declared = (r.relationships ?? []).filter((x: any) => x.metadata?.relationshipType === "declared_type")
      if (declared.length === 0) return r
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => x.metadata?.relationshipType !== "declared_type") }
    },
  },
  {
    id: "fsharp/whole-signature-as-symbol-name",
    language: "fsharp",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (FS-D6): an `identifier_pattern` in this grammar spans the ENTIRE left-hand side of a binding, so `let f (a: string) : string = …` published the symbol `f (a: string) : string`. Measured: 60 such symbols per 400 real files — 37 with a curried argument list, 23 with a generic argument in the return type — none joinable by a consumer; script/m14/tmp/fs019-adjudicate-loss.ts counts the removed names by the character that disqualifies them (57 by a parameter list, 16 by a generic argument, 9 by a space, 8 otherwise). Reverted by renaming every function/variable/method symbol to the whole text of its binding's left-hand side, which is what the identifier_pattern's own text is. A first draft guarded the revert with 'only if a signature-shaped name is already present' — which made the mutant PERMANENTLY VACUOUS, since the fixed analyzer never produces one; a vacuous mutant is a green that means nothing, and the probe that found it is script/m14/tmp/fs023-mutant-probe.ts (whose own first version called four LIVE mutants vacuous, because it compared counts on a map-shaped transform). Caught by fsharp/name-surface, whose forbids name the four exact pre-fix strings and whose control bindings (`plain`, `curried`, `lambdaArg`, `counter`) exist because a first draft of the FIX that also redirected the plain-identifier case regressed them and the A/B reported them as dropped symbols.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const lines = source.split("\n")
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => {
          if (s.kind === "method" || s.kind === "function" || s.kind === "variable") {
            const text = lines[(s.range?.startLine ?? 0) - 1] ?? ""
            const m = text.match(/^\s*let\s+(?:mutable\s+|rec\s+|inline\s+)*(.*?)(?:\s*=\s*.*)?$/)
            if (m && m[1] && m[1] !== String(s.name)) return { ...s, name: m[1].trim() }
          }
          return s
        }),
      }
    },
  },
  {
    id: "fsharp/object-expression-drops-its-members",
    language: "fsharp",
    defectClass: "orphan-symbol",
    description:
      "PRE-FIX (FS-D7): an `object_expression` published a Class symbol and never opened a scope for it, so in an F# SCRIPT — no namespace, no module, an empty enclosing scope — every member of every object expression came out with NO owner. Measured on the second corpora: elmish docs/docs/subscription.fsx lines 71/144/803/833, suave examples/WebSocket/Program.fs:181, fsharp-data HtmlNode.fs:123 and 206. Reverted by removing the owner AND its containment edge from every member of an object expression — the edge is derived from ownerName, so a revert that cleared only the owner is not a state the pre-fix analyzer could produce; the first draft did exactly that and SURVIVED, because the fixture pins the edge. Caught by fsharp/name-surface, which expects `contains new System.IDisposable -> Dispose` and forbids the scope from outliving the object expression (`contains Fixture.Names -> after` is the live risk: a scope that does not pop captures the next binding).",
    transform: (r: any) => {
      const anon = new Set<string>(
        (r.symbols ?? []).filter((s: any) => s.metadata?.nodeType === "object_expression").map((s: any) => String(s.name)),
      )
      if (anon.size === 0) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) =>
          s.ownerName && matchesEndpoint(anon, s.ownerName) ? { ...s, ownerName: undefined } : s,
        ),
        relationships: (r.relationships ?? []).filter(
          (x: any) => !(String(x.type) === "contains" && matchesEndpoint(anon, x.source)),
        ),
      }
    },
  },
  {
    id: "fsharp/forward-declaration-collapses-into-its-definition",
    language: "fsharp",
    defectClass: "regression-guard",
    description:
      "FS-D2 REGRESSION GUARD, and the only mutant whose job is to fail if a bug this round once shipped returns. An F# SIGNATURE file forward-declares a type and then defines it — `type Surface` / `type Surface = member this.Real = 1` — and the definition is the one carrying the members. A first draft of the publication rule applied one-symbol-per-name to every type, kept the forward declaration and dropped the definition: script/m14/tmp/fs018-compare-dumps.ts reported 30 dropped `type_definition` symbols across 15 corpus files (fsiaux.fs, TypedTree.fsi, TaggedCollections.fsi, sformat.fsi) before the rule shipped, and the fix was to scope the dedupe to EXTENSIONS — the one place the duplication is a defect. Reverted by dropping every symbol marked `isForwardDeclaration` and the containment edge into it, which is what the draft did. Caught by fsharp/type-extension-and-containment, which expects `contains Fixture.Extensions -> Surface` at BOTH line 72 and line 74 and expects the member `Real` owned by Surface.",
    transform: (r: any) => {
      const fwd = (r.symbols ?? []).filter((s: any) => s.metadata?.isForwardDeclaration === true)
      if (fwd.length === 0) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).filter((s: any) => s.metadata?.isForwardDeclaration !== true),
        relationships: (r.relationships ?? []).filter(
          (x: any) =>
            !(String(x.type) === "contains" &&
              fwd.some((s: any) => String(s.name) === String(x.target) && (s.range?.startLine ?? -1) === (x.line_number ?? -2))),
        ),
      }
    },
  },
  {
    id: "fsharp/export-surface-includes-type-members",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "PRE-FIX (FS-D8): the export list was 'every non-variable symbol', so a record field, a method and an object expression's member were published as importable units no F# `open` can bind, and an `internal` or `private` declaration was published with `visibility: public`. Two independent facts, and the fixture runner's own export invariant is what caught them — `export(s) […] do not resolve to a top-level symbol (membership rides Contains)` and `duplicate export name(s) [\"Surface\"]`. Reverted by re-running the pre-fix rule verbatim, because a first draft rewrote only `visibility` and could not change the invariant's verdicts, so the mutant was VACUOUS. Caught by fsharp/declared-type-graph (whose `Bad<'T>` carries `val mutable` members and an `inherit Object()`) and fsharp/name-surface (whose object-expression members are type-owned).",
    transform: (r: any) => {
      const preFixExports = (r.symbols ?? [])
        .filter((s: any) => String(s.kind) !== "variable")
        .map((s: any) => ({ name: s.name, kind: s.kind, range: s.range, visibility: "public" as any }))
      if (preFixExports.length === 0) return r
      return { ...r, exports: preFixExports }
    },
  },
  {
    id: "fsharp/property-setter-calls-dropped",
    language: "fsharp",
    defectClass: "missing-relationship",
    description:
      "PRE-FIX (FS-D13): the 'a computed property getter emits no calls' contract was applied to the WHOLE member. It is inherited from the C# family and is about an EXPRESSION-bodied property, which in C# has no second body for code to live in. F#'s `with get, set` does: the accessor is a `property_accessor` node carrying its own `set` token, and the setter body executes. Reverted by dropping every `calls` edge whose source publishes a `declared_type` on its own PARAMETER — which is the shape a setter's parameter produces, read off the result rather than from a name list, so the mutant cannot silently stop matching if the fixture changes. Caught by fsharp/call-ownership, which expects `calls Probe -> reset` AND forbids `calls Computed -> Length`; the forbid is what stops the fix being read as 'properties emit calls'.",
    transform: (r: any) => {
      const setters = new Set<string>(
        (r.relationships ?? [])
          .filter((x: any) => x.metadata?.relationshipType === "declared_type" && x.metadata?.declaredOn === "parameter")
          .map((x: any) => String(x.source)),
      )
      if (setters.size === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).filter(
          (x: any) => !(String(x.type) === "calls" && matchesEndpoint(setters, x.source)),
        ),
      }
    },
  },
  {
    id: "fsharp/default-impl-body-calls-dropped",
    language: "fsharp",
    defectClass: "missing-relationship",
    description:
      "PRE-FIX (FS-D12): a `default` implementation of an abstract member publishes no SYMBOL — that dedup is correct and is exactly why the abstract signature is the canonical one — but its BODY belongs to that member, and the arm passed the enclosing owner through unchanged. Inside a class the enclosing owner is undefined, so every call in every `default` implementation was dropped: 731 of 817 MISSING `calls` rows per 120 real files, found by the lane's own truth oracle. Reverted by re-attributing every call whose source also has a `member_signature` of the same name in the file — the exact set of `default` implementations, derived from the result rather than from a name list. Caught by fsharp/call-ownership, which expects `calls Describe -> describeWith` and `calls Area -> computeArea`.",
    transform: (r: any) => {
      const sigNames = new Set<string>(
        (r.symbols ?? []).filter((s: any) => s.metadata?.nodeType === "member_signature").map((s: any) => String(s.name)),
      )
      if (sigNames.size === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).filter(
          (x: any) => !(String(x.type) === "calls" && matchesEndpoint(sigNames, x.source)),
        ),
      }
    },
  },
  {
    id: "fsharp/type-query-read-as-a-declared-type",
    language: "fsharp",
    defectClass: "fabricated-relationship",
    description:
      "PRE-FIX (FS-D11): `typeof<T>` and `unbox<T>` are EXPRESSIONS that carry a type argument, not positions where a type is WRITTEN. `typeof<TypeInThisAssembly>.Assembly.Location` depends on a runtime value, and a `declared_type` edge claims the opposite. It first appeared as an UNEXPLAINED row in the lane's own differential — the two sides agreed to emit the edge and disagreed on its SOURCE, which is the tell that both were reading a position neither should have taken. Two attempts at the discriminator measured nothing before the differential forced a third: the grammar spells the query as a `typed_expression` whose `long_identifier_or_op` child reads `typeof` — a SIBLING of the type, not its parent. Reverted by re-adding a `declared_type` edge for every declared type attributed to an ARGUMENTLESS binding, which is the shape a top-level `let x = typeof<T>.…` produces. Caught by fsharp/call-ownership, whose forbids name `quoted -> Foo` and `unboxed -> int`, with `annotated : Bar` as the control that a real written type in the same position still emits.",
    //
    // WHY THIS MUTANT NEEDS THE SOURCE, and why its first version was VACUOUS. The fix is a
    // guard at the one call site that emits a declared type, and it is a REFUSAL — so the
    // fixed result contains no trace of the rows it suppresses, and duplicating the rows that
    // remain (a first attempt: every declared_type on an argumentless binding) re-adds
    // `annotated -> Bar`, which is already present and which no verdict can distinguish. That
    // mutant reported 0 -> 0 failures and proved nothing. A defect class whose pre-fix output
    // the post-fix result no longer records has to be rebuilt from the source text, which is
    // what the harness's second `transform` argument is for. The reversion is derived from the
    // SHAPE (`let <name> = typeof<T>` / `unbox<T>`) rather than from a hardcoded symbol name,
    // so it stays live as long as the fixture keeps the shape — a hardcoded name would silently
    // stop matching the moment the fixture is renamed, and a mutant that quietly stops
    // matching is worse than no mutant, because it keeps reporting.
    transform: (r: any, source?: string) => {
      if (!source) return r
      const all: Array<{ name: string; type: string; line: number }> = []
      source.split("\n").forEach((text: string, i: number) => {
        const m = /^\s*let\s+([A-Za-z_][A-Za-z0-9_']*)[^=\n]*=\s*(?:typeof|unbox)\s*<\s*([^>,;\n]+?)\s*>/.exec(text)
        if (m) all.push({ name: m[1]!, type: m[2]!, line: i + 1 })
      })
      if (all.length === 0) return r
      return {
        ...r,
        relationships: [
          ...(r.relationships ?? []),
          ...all.map((q) => ({
            type: "references",
            source: q.name,
            target: q.type,
            confidence: 1,
            line_number: q.line,
            metadata: { nodeType: "simple_type", relationshipType: "declared_type", declaredType: q.type, isTypeQuery: true },
          })),
        ],
      }
    },
  },
  {
    id: "fsharp/qualified-target-spelling",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "PRE-FIX (FS-D9): the R10 SPELLING rule — 'a qualified type USE is published under the name the lane would publish for that type as a symbol' — was not implemented, so `implements` and `extends` targets carried the full dotted path (`System.IDisposable`), which joins to no symbol. R10 is the family rule, applied to ten lanes; fsharp was never asked. Measured: 13 dotted `implements` and 3 dotted `extends` targets per 400 real files, found because the lane's own truth oracle applies the rule independently and the differential reported the disagreement. Reverted by re-expanding every `implements`/`extends` target through its own `metadata.qualifiedType`. The `open X` `references` rows are deliberately NOT touched: a module PATH is legitimately dotted and its leaf is not the module, so R10 does not apply to it. Caught by fsharp/name-surface, which expects the leaf targets `IDisposable` and `IComparable`.",
    transform: (r: any) => {
      const touched = (r.relationships ?? []).filter(
        (x: any) => (x.type === "implements" || x.type === "extends") && typeof x.metadata?.qualifiedType === "string",
      )
      if (touched.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "implements" || x.type === "extends"
            ? typeof x.metadata?.qualifiedType === "string"
              ? { ...x, target: x.metadata.qualifiedType }
              : x
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/object-expression-first-name-segment",
    language: "fsharp",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (FS-D14): an object expression's interface name was read as the FIRST `long_identifier` descendant. That is correct exactly when the name is unqualified; a qualified name is NESTED in this grammar — `object_expression > typed_expression > dot_expression > long_identifier_or_op > long_identifier` — so the first such node is the first SEGMENT. `{ new System.Collections.Generic.IEqualityComparer<T> with … }` published `new System` and `implements -> System`, a target that resolves to no symbol. Found by the differential in the most useful way available: the lane's truth side read the SECOND segment (`Collections`), so two implementations independently picked different segments of one name. Reverted by re-expanding the published name and the `implements` target to the first segment of the qualified form, using the result's own `metadata.qualifiedType` rather than a name list — which also makes the mutant fail if the qualified form is ever absent, rather than silently matching nothing. Caught by fsharp/name-surface, which forbids `implements -> System` and `implements -> Collections` alongside the correct leaf row.",
    transform: (r: any) => {
      const objs = (r.symbols ?? []).filter((s: any) => s.metadata?.nodeType === "object_expression")
      if (objs.length === 0) return r
      const firstOf = (q: string) => q.split(".")[0]!
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) =>
          s.metadata?.nodeType === "object_expression" && String(s.name).startsWith("new ")
            ? { ...s, name: "new " + firstOf(String(s.name).slice(4)) }
            : s,
        ),
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "implements" && typeof x.metadata?.qualifiedType === "string"
            ? { ...x, target: firstOf(x.metadata.qualifiedType) }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/open-sourced-to-global",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "PRE-FIX (FS-D17): the source of an `open` was `wherever the walk happened to be`, and in this grammar an `open` is a SIBLING of the file's `module` declaration rather than a child of it — so a scope stack maintained by walking down the tree is empty when the walk reaches one. The rule that produced the answers was position, and position is not a property of the program: `AssemblyCheck.fs` (`open` at line 3, `module` at 10) was sourced to the module because the walk had entered it, and `docs/fcs/project.fsx` (same shape) was sourced to `Global` because the walk had not. Two files, one rule, two answers. Reverted by re-sourcing every open-path `references` edge to `Global`. The fix is a pre-pass over the file's declared scope, gated on there being exactly ONE top-level module/namespace and on nothing EXECUTING above it — the second condition is what keeps a script's top-level imports out of its first module, and the extra `module M` / `module N` in project.fsx are inside triple-quoted strings, so counting module nodes alone is not enough (script/m14/tmp/fs036-top-level.ts). Caught by the oracle, which is where both of the disagreeing files were adjudicated.",
    transform: (r: any) => {
      const imports = (r.relationships ?? []).filter(
        (x: any) => x.type === "references" && (x.metadata ?? {}).isImport === true,
      )
      if (imports.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "references" && (x.metadata ?? {}).isImport === true ? { ...x, source: "Global" } : x,
        ),
      }
    },
  },
  {
    id: "fsharp/mutual-group-named-after-its-and-clause",
    language: "fsharp",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (FS-D29): `let rec f … and g …` is ONE `function_or_value_defn` holding both clauses, and two things read the FIRST left-hand side. The symbol publication minted only `f` — so `g` did not exist at all — and the declared-type attribution named the group by its first clause, so `g`'s parameter and return types were published as `f -> …`. Measured on TypedTreeOps.Attributes.fs: `visitEntity -> Entity`, `-> Val` and `-> TypedTreeNode` all published as `visitVal -> …`, in a corpus written almost entirely in this shape; and 24 rows in Symbols.fs for the same reason. Nothing downstream could tell, because `visitVal` IS a published symbol and the edges resolved. Reverted by attributing every declared-type row to the LAST function-or-variable symbol in the result — the pre-fix shape, where one name carries a whole group. Caught by fsharp/declared-type-graph, whose mutual group at lines 73-77 pins four rows that split by OWNER: `groupFirst -> GroupDep`, `-> GroupSecond` and `groupSecond -> GroupSecondDep`, `-> GroupFirst`.",
    transform: (r: any) => {
      const names = new Set(
        (r.symbols ?? [])
          .filter((s: any) => ["function", "variable", "method"].includes(String(s.kind)))
          .map((s: any) => String(s.name)),
      )
      if (names.size < 2) return r
      const last = [...names].pop()!
      const first = [...names][0]!
      if (last === first) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => (s.name === last ? { ...s, name: first } : s)),
        relationships: (r.relationships ?? []).map((x: any) => ({
          ...x,
          source: x.source === last ? first : x.source,
        })),
      }
    },
  },
  {
    id: "fsharp/recursive-call-refused-as-a-self-edge",
    language: "fsharp",
    defectClass: "wrong-relationship",
    description:
      "A defect in the lane's own TRUTH ORACLE, reverted here because a differential finds bugs on both sides and a mutant is the only way a truth-side bug stays fixed. The oracle refused EVERY label's self-edge, on the reasoning that a self-edge is a statement about the graph rather than the code. That is true for `contains` and FALSE for `calls`: `let rec f x = … f (x-1) …` really does call itself, and refusing the edge deletes a true fact about the program. Measured: 668 UNEXPLAINED rows per 200 real files, every one of them a recursive call the analyzer was RIGHT to emit. The analyzer's own refusal is already per-label (see the composition site); this mutant restores the blanket version on the ANALYZER's output so the fixture that pins `calls loop -> loop` — a true recursive call that must survive — goes red. Caught by fsharp/call-ownership, whose last forbid row states the two rules are per-label on purpose.",
    transform: (r: any) => {
      const recursive = (r.relationships ?? []).filter(isSelfCallEdge)
      if (recursive.length === 0) return r
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !isSelfCallEdge(x)) }
    },
  },
  {
    id: "fsharp/open-recorded-only-as-a-mention",
    language: "fsharp",
    defectClass: "wrong-relationship",
    description:
      "M60 ontology lane: ER-D41's shape in F#. `src/intelligence/analysis/dependencies.ts` reads `imports` relationship edges for file->file module dependencies, relying on them precisely because `brain_import.resolved_symbol_id` is routinely null — 19 analyzers emit `imports`, and F# recorded `open X` under `references` alone, so an `open FSharp.Compiler.Diagnostic` was stored under a label that reader never looks at. Reverted here by dropping every `imports` edge the analyzer emits, which is the honest pre-fix state: the mention survives and the dependency does not. Caught by fsharp/import-and-use, whose five `imports` rows (two `open`, one `open type`, `#r`, `#I`, `#load`) go missing while its two `references` rows stay green — so the mutant is caught by the ABSENCE of the dependency and not by any change to the mention.",
    transform: (r: any) => {
      const imports = (r.relationships ?? []).filter((x: any) => String(x.type) === "imports")
      if (imports.length === 0) return r
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type) !== "imports") }
    },
  },
  {
    id: "fsharp/repl-control-directive-imports-a-resource",
    language: "fsharp",
    defectClass: "wrong-relationship",
    description:
      "M60 ontology lane: the `#r`/`#load`/`#I` rule reads the directive's keyword off the tree and accepts three of the six keywords `fsi_directive_decl` covers. Accepting the NODE TYPE instead emits an import for `#time \"on\"`, `#help` and `#quit`, which are REPL controls touching no resource outside the file — a fabricated dependency, the most expensive mistake available, because a fake dependency is counted as a fabrication by the oracle and poisons bb_graph, bb_impact and bb_migrate, where it becomes wrong refactoring advice. `#time` is the load-bearing case and not a contrived one: it CARRIES a string (`#time \"on\"`), so a rule that keyed on 'has a string argument' would emit the edge too, and only the keyword test refuses it. The two targets are F#'s two documented `#time` arguments. THIS IS AN INJECTION, NOT A BYTE-FAITHFUL REVERT, and the reason is stated rather than papered over: the pre-fix rule's extra edges leave NO trace in a result the analyzer refused to produce — no symbol, no relationship, no ImportInfo row — so a transform over the result cannot recover them, and a revert written against the source would be a text match, which is the instrument this project has twice measured to be wrong. What it asserts is exactly the defect: does the suite go red when an `imports` edge exists that names no resource? Caught by fsharp/import-and-use, whose forbid row for target `on` exists for this and nothing else.",
    transform: (r: any) => {
      const res = (r.relationships ?? []).filter(
        (x: any) => String(x.type) === "imports" && String(x.metadata?.relationshipType ?? "") === "resource_directive",
      )
      if (res.length === 0) return r
      const fabricated = ["on", "off"].map((v) => ({
        type: "imports",
        source: String(res[0].source),
        target: v,
        confidence: 1,
        metadata: { nodeType: "fsi_directive_decl", relationshipType: "resource_directive", directive: "#time" },
      }))
      return { ...r, relationships: [...(r.relationships ?? []), ...fabricated] }
    },
  },
  {
    id: "fsharp/attribute-variance-target-read-as-the-dependency",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "M60 ontology lane, and a REGRESSION guard for a bug this lane's own round introduced and then removed. `[<return: Struct>]` and `[<assembly: CompilationRepresentation(…)>]` carry an attribute `target` field; the rule skips it by asking the tree for the field name at each child index. The pre-fix version skipped it by OBJECT IDENTITY (`c === attrTarget`), which does not hold — web-tree-sitter rebuilds the Node wrapper on each accessor call, so the comparison was false for the very child it meant to skip, and the variance keyword became the dependency. Measured: 11 `uses` edges in a 200-file draw whose target was the literal string `return`. Without this mutant, a rule that was wrong once is free to be wrong again, and the failure is invisible downstream because a fabricated target resolves to nothing while a real one resolves to a symbol. Caught by fsharp/import-and-use, whose forbid rows for `return` and `assembly` exist for this and nothing else.",
    transform: (r: any) => {
      const uses = (r.relationships ?? []).filter((x: any) => String(x.type) === "uses")
      if (uses.length === 0) return r
      const extra = uses
        .filter((x: any) => x.metadata?.attributeTarget != null)
        .map((x: any) => ({
          ...x,
          target: String(x.metadata.attributeTarget),
          metadata: { ...x.metadata, attributeTarget: undefined, relationshipType: "attribute_application_PRE_FIELD_NAME_SKIP" },
        }))
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "fsharp/interface-member-override-resolved-from-the-base-list",
    language: "fsharp",
    defectClass: "wrong-relationship",
    description:
      "M60 ontology lane pass 2, and a REGRESSION guard for the defect this lane's own pass 1 shipped. `override` is not a statement about a BASE CLASS: F# has no separate keyword for an interface member, so `interface I with override this.M() = …` implements `I.M` and the pre-fix rule — which read the `override` TOKEN alone — emitted `overrides Owner.M -> M` when the type had no `inherit` at all (a member that overrides itself, a target binding to nothing) and `overrides Owner.M -> Base.M` when it also inherited (an interface implementation attributed to a base-class member). Measured over the whole 6,619-file corpus by validation/m14/fixtures/fsharp/ontology-probe.ts, probes A1 (the population) and A2 (the subset with no base type to resolve). The mutant reverts the TARGET RESOLUTION rather than the edge: it rewrites each `interface_member_implementation` edge's target to the member's bare name, which is the pre-fix answer for the no-`inherit` case and the sharpest possible fabrication for the rest. Caught by fsharp/override-target, whose three forbid rows pin each of the three wrong answers — including `Guarded.Speak -> Animal.Speak`, where the wrong target names a member that REALLY EXISTS in the base class, which is why the defect survived a corpus census: a fabricated edge that resolves is indistinguishable from a correct one by name alone.",
    transform: (r: any) => {
      const ifaceOverrides = (r.relationships ?? []).filter(
        (x: any) => String(x.type) === "overrides" && x.metadata?.isInterfaceMemberImplementation === true,
      )
      if (ifaceOverrides.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (String(x.type) !== "overrides" || x.metadata?.isInterfaceMemberImplementation !== true) return x
          const src = String(x.source)
          const member = src.includes(".") ? (src.split(".").pop() as string) : src
          return { ...x, target: member, metadata: { ...x.metadata, relationshipType: "override_PRE_INTERFACE_TARGET" } }
        }),
      }
    },
  },
  {
    id: "fsharp/one-character-callee-refused",
    language: "fsharp",
    defectClass: "missing-relationship",
    description:
      "M60 ontology lane pass 2. `calls` was gated on `fnName.length > 1`, which no property of the program justifies: by the time the branch runs, the grammar has already said the callee is a NAME node. The gate removed every call to a ONE-LETTER function, of which instrument B counts 5,313 over the 6,619-file corpus in 735 files — 2.2% of the label against its 246,327 full-extent edges — and the dropped population is better connected than the emitted one (32.4% in-file resolution on a 120-file draw against 22.2%). The mutant drops the edges a one-character target carries, which is the honest pre-fix state: the application is in the tree and nothing is published about it. Caught by fsharp/one-char-calls, whose `composed -> f` row exists for this and nothing else. It is a REGRESSION guard in the strict sense — the gate was in the lane since M12 and no fixture asserted its absence, which is why 5,313 real calls could sit unread behind a green suite.",
    transform: (r: any) => {
      // ★ REPAIRED 2026-10-22 — THE OLD TRANSFORM WAS A MEASURED NO-OP, NOT A DEFECT MODEL.
      // It dropped `calls` edges whose WHOLE TARGET was one character long. The lane publishes
      // a LOCAL callee as the BINDING SPELLING `<callable>\u0000<binding>` (BINDING_SEP,
      // src/ast/types.ts), so the one-character callee's published target is `composed\0f` —
      // NINE characters — and the old filter removed nothing. The mutant therefore could not
      // fail, and it was reported as a survivor rather than as a defect it never modelled.
      // THE DEFECT IS ABOUT THE CALLEE'S NAME: the pre-fix analyzer refused a callee whose
      // NAME was one character long. The edge that carries such a callee is the one whose
      // BINDING (the part after the last BINDING_SEP) is one character, or whose target has
      // no separator at all and is itself one character.
      const SEP = "\u0000"
      const shortCallee = (x: any): boolean => {
        if (String(x.type) !== "calls") return false
        const t = String(x.target)
        const i = t.lastIndexOf(SEP)
        const binding = i >= 0 ? t.slice(i + 1) : t
        return binding.length === 1
      }
      const short = (r.relationships ?? []).filter(shortCallee)
      if (short.length === 0) return r
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !shortCallee(x)) }
    },
  },
  {
    id: "fsharp/bare-pipeline-not-read",
    language: "fsharp",
    defectClass: "missing-relationship",
    description:
      "M60 ontology lane pass 2, and the largest single `calls` gap this lane ever shipped. The lane's doc claimed pipe `a |> List.map` reads as a call, and it read one only when the pipeline sat in CALLEE position (`f (x |> g)`); a `let` whose BODY is the pipeline — the shape F# is actually written in — produced no edge at all. Measured on a 300-file corpus draw: 1,043 bare `|>` infix nodes with a NAME on the right, against 580 read in callee position, so ~11% of the corpus's calls were missing from the label. `script/m14/fsharp-truth-oracle.ts` has no `infix_expression` branch either, which is why the differential never reported it: both sides said nothing, so nothing disagreed. The mutant drops the pipeline edges the analyzer now emits. Caught by fsharp/one-char-calls, whose `applyBoth -> triple` row (metadata `isPipelineCall`) exists for this and nothing else, and whose three forbid rows — composition `>>`, a lambda on the right of a pipe, and `x = y` — are what stop a from-scratch implementation of the rule from passing by emitting far more than it should.",
    transform: (r: any) => {
      const pipes = (r.relationships ?? []).filter(
        (x: any) => String(x.type) === "calls" && x.metadata?.isPipelineCall === true,
      )
      if (pipes.length === 0) return r
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "calls" && x.metadata?.isPipelineCall === true)) }
    },
  },
  {
    id: "fsharp/drop-owner-qualified-name",
    language: "fsharp",
    defectClass: "unresolvable-endpoint",
    description:
      "M60 ontology lane pass 3, FS-P3-1. `overrides` is the only relationship this analyzer emits whose SOURCE it qualifies, because a bare member name is ambiguous: `type Resource() = interface System.IDisposable with override this.Dispose() = ()` writes `overrides Resource.Dispose -> IDisposable.Dispose`. The analyzer published every OWNED symbol under its BARE name, so that endpoint matched the store at 0 of 63 `overrides` edges on a 400-file stride draw of the 11,809-file population — confirmed on Grace/src/Grace.Actors/AccessControl.Actor.fs, where the stored symbol read `qualifiedName=\"OnActivateAsync\"` while the edge read `source=\"AccessControlActor.OnActivateAsync\"`. `pool-worker.ts:870` derives the stored value as `s.qualifiedName || s.metadata?.fqn || (s.scope ? … : name)`, and this analyzer set none of the three, so `brain_symbol.qualified_name` held a bare name while `brain_relationship.source_external` held a dotted one — and those are the two columns `src/ast/parallel-indexer.ts` JOINs. The mutant strips `metadata.fqn` from every symbol, which is the pre-fix state exactly, and it is written off the RESULT's own symbol table rather than off a name so it cannot silently stop matching when a fixture is renamed. Caught by fsharp/qualified-name-seam, whose two forbid rows forbid an owned member carrying NO fqn — a presence-ONLY row could not fail here, because the pre-fix symbol has no field to be absent from, which is why that fixture asserts the absence and not the value. The corpus-wide, owner-agnostic form of the same invariant is validation/m14/fixtures/fsharp/store-seam-check.ts.",
    transform: (r: any) => {
      const owned = (r.symbols ?? []).filter((s: any) => String(s?.ownerName ?? "").length > 0)
      if (owned.length === 0) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => {
          if (String(s?.ownerName ?? "").length === 0 || !s?.metadata || s.metadata.fqn === undefined) return s
          const metadata = { ...s.metadata }
          delete metadata.fqn
          return { ...s, metadata }
        }),
      }
    },
  },
  {
    id: "fsharp/edge-source-spelled-bare",
    language: "fsharp",
    defectClass: "unresolvable-endpoint",
    description:
      "M60 ontology lane pass 4, FS-P4-1. FS-P3-1 above fixed the `overrides` SOURCE and left every other label bare, so `calls`/`instantiates` sources were the member's own name while the store registers each symbol under `${scope}.${name}` (parallel-indexer.ts:3247) — an exact map hit for the qualified spelling and a first-wins pick among same-named symbols for the bare one. Measured on a 3,000-file draw of the 11,809-file population, scored against the full-corpus pool with the store's own strategy 1/2/3 model (.tmp-probe/fs-verdict-state/rows-pass4.ndjson vs rows.ndjson): source-determinate edges 187,370 (52.5%) -> 255,415 (71.6%), +68,045, and it is strictly additive because when the qualified spelling is absent the store's leaf fallback returns exactly what the bare spelling gave. Reverted by dropping every `calls`/`instantiates` source to its last segment, which is the pre-fix spelling and nothing else. Caught by fsharp/call-ownership (7 rows), fsharp/one-char-calls (7) and fsharp/declared-type-graph, whose expect rows now carry the published spelling.",
    transform: (r: any) => {
      const QUALIFIED = new Set(["calls", "instantiates"])
      const hit = (r.relationships ?? []).filter(
        (x: any) => QUALIFIED.has(String(x.type)) && String(x.source).includes("."),
      )
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          QUALIFIED.has(String(x.type))
            ? { ...x, source: String(x.source).split(".").pop() }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/containment-endpoints-spelled-bare",
    language: "fsharp",
    defectClass: "unresolvable-endpoint",
    description:
      "M60 ontology lane pass 4, FS-P4-2. A `contains` edge names two symbols the file PUBLISHED, and it named both of them as bare strings: the parent by `ownerName` and the child by `name`, while `publish` had already minted `${ownerName}.${name}` into `metadata.fqn` and the store already derives `qualified_name` from that field. So a containment edge was determinate only while exactly one symbol in the project carried the child's name. Measured on the same 3,000-file draw: `contains` target-determinate 34.2% -> 70.3% (+36.2 points) and source-determinate 42.4% -> 64.8%, with the edge COUNT unchanged at 58,298. Reverted by dropping both endpoints to their last segment. Caught by fsharp/name-surface (16 rows), fsharp/type-extension-and-containment (18), fsharp/override-target, fsharp/open-scope and fsharp/declared-type-graph. NOTE the parent half is deliberately NOT symmetrical with the child half in one case: where the parent's name is ambiguous within the file the composition keeps the PARENT bare, and that is the state this revert produces, so the fixture rows that pin a bare parent (`Setup`, `Integration.Probe`, `Fixture.OneCharCalls.Counter.Types`) keep passing under it — which is why they are written bare and must stay that way.",
    transform: (r: any) => {
      const hit = (r.relationships ?? []).filter((x: any) => String(x.type) === "contains")
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          String(x.type) === "contains"
            ? {
                ...x,
                source: String(x.source).split(".").pop(),
                target: String(x.target).split(".").pop(),
              }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/qualified-callee-reduced-to-leaf",
    language: "fsharp",
    defectClass: "unresolvable-endpoint",
    description:
      "M60 ontology lane pass 6, FS-P6-3, and the largest single target-side defect this lane has shipped. The analyzer READ the qualifier the source wrote and threw it away: `Array.fold` was emitted as `fold`, `Microsoft.FSharp.Collections.Seq.map` as `map`, `DotNet.exec` as `exec`. Measured on a 3,000-file draw of the 11,809-file corpus scored against the full-corpus pool with the store's own S1/S2/S3 (.tmp-probe/fs-p6-price.py, rows-pass5-meta.ndjson): of the 68,453 `calls` edges in the `external-type-or-module` class, respelling the discarded qualifier into `${qualifierLeaf}.${leaf}` moves 11,709 targets to DETERMINATE and 1,821 the other way, and every one of the 11,709 is a `q_cnt == 1` identity — an identity exactly one symbol in the corpus holds. Whole-draw: `calls` target-determinacy 19.1% -> 29.1%, all labels 22.4% -> 34.2%. The revert is read off the RESULT's own `metadata.targetResolution`, not off a name list, so it cannot silently stop matching when the rule or a fixture is renamed: a `calls` edge the analyzer itself marked `module-member`, `external-type-or-module` or `opened-module` gets its target cut to the last segment, which is exactly the pre-fix spelling. Caught by fsharp/call-target-spelling, whose three expect rows pin `Array.fold`, `FSharpPlus.map` and `Seq.map` and whose forbid row pins the leaf `fold`. NOTE the class it must NOT touch: `receiver-value` (a lowercase qualifier, i.e. a value's member) is a leaf on purpose, because no symbol is ever stored as `value.member` — measured, respelling that class loses 510 edges against the 109 it gains.",
    transform: (r: any) => {
      const QUALIFIED_RES = new Set(["module-member", "external-type-or-module", "opened-module"])
      const hit = (r.relationships ?? []).filter(
        (x: any) => String(x.type) === "calls" && QUALIFIED_RES.has(String(x.metadata?.targetResolution)),
      )
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          String(x.type) === "calls" && QUALIFIED_RES.has(String(x.metadata?.targetResolution))
            ? { ...x, target: String(x.target).split(".").pop() }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/call-chain-spelled-as-a-path",
    language: "fsharp",
    defectClass: "unresolvable-endpoint",
    description:
      "M60 ontology lane pass 6, FS-P6-1. F# writes a fluent call as one `dot_get` node whose TEXT is the whole chain, and the walk read that text as a callee PATH: because the chain's first segment happened to be a name the file published, the identity branch returned the entire chain as the edge target. Measured on the 3,000-file draw: 514 `calls` targets are not names at all — `ArgumentParser.Create<'Template'>().ToParseResults`, `parser.PrintUsage().Contains`, `router.GetRoute(model).TrimStart`, `Existential.FromType(t).Accept` — and a target carrying a parameter list can never be a store identity, so every one of those edges was unresolvable by construction while looking like a resolved name in the graph. The member actually called is the LAST name in the chain, on a receiver whose type the file cannot know. The revert rebuilds the pre-fix string from the edge's own `targetQualifier` plus its target, so it is faithful by construction and self-checking: the qualifier is the chain text the analyzer itself preserved. Caught by fsharp/call-target-spelling, whose forbid row names the chain, and whose expect row pins the same edge with its `call-chain-receiver` reason.",
    transform: (r: any) => {
      const chains = (r.relationships ?? []).filter(
        (x: any) => String(x.type) === "calls" && x.metadata?.targetResolution === "call-chain-receiver",
      )
      if (chains.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (String(x.type) !== "calls" || x.metadata?.targetResolution !== "call-chain-receiver") return x
          const qual = String(x.metadata?.targetQualifier ?? "")
          if (!qual) return x
          return { ...x, target: `${qual}.${String(x.target)}`, metadata: { ...x.metadata, targetResolution: "in-file-qualified" } }
        }),
      }
    },
  },
  {
    id: "fsharp/target-resolution-reason-dropped",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "M60 ontology lane pass 6, FS-P5-2's contract half. The spelling rule's whole justification is that a target the analyzer CANNOT prove carries the reason it cannot: `local-binding`, `bare-external`, `receiver-value`, `call-chain-receiver`, `base-member-external`, each with the discarded qualifier beside it. That is what makes the residual auditable instead of unexplained, and until this round NOTHING PINNED IT — the audit that found this (.tmp-probe/fs-target-audit.py, which keys on the same strings) grepped the 11 expectation files for `targetResolution` and matched zero, so every reason could have been deleted in a one-line edit and the whole suite would have stayed green. The mutant deletes both keys from every relationship: same edges, same endpoints, same confidences, one payload field gone. Caught by fsharp/call-target-spelling, whose eleven expect rows each pin `meta.targetResolution` (and four pin `meta.targetQualifier`), which is why that fixture exists as a target-side fixture rather than as more rows in a call-ownership one.",
    transform: (r: any) => {
      const hit = (r.relationships ?? []).filter((x: any) => x.metadata?.targetResolution !== undefined)
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (!x.metadata || x.metadata.targetResolution === undefined) return x
          const metadata = { ...x.metadata }
          delete metadata.targetResolution
          delete metadata.targetQualifier
          return { ...x, metadata }
        }),
      }
    },
  },
  {
    id: "fsharp/derived-endpoint-spelled-bare",
    language: "fsharp",
    defectClass: "unresolvable-endpoint",
    description:
      "M60 ontology lane pass 5/6, the DERIVED half of the spelling rule — the two spellings the analyzer COMPUTES rather than reads. `this.M` is spelled `${enclosingType}.${M}` and `base.M` is spelled `${baseLeaf}.${M}` when the base is a type this file declared, because both are identities the file published (`publish` mints `${ownerName}.${name}`, and the enclosing type IS the ownerName of the member being called). The pre-fix answer was the bare leaf, which the store resolves by name uniqueness if it is lucky and by nothing at all if it is not — the same defect FS-P3-1 fixed on the `overrides` label one pass earlier. Reverted by cutting every edge the analyzer itself marked `self-member` or `base-member` back to its last segment, read off the result's own metadata so the revert cannot go vacuous. Caught by fsharp/call-target-spelling, which pins `Widget.RenderTo` and `Base.Speak` with those two reasons, and by fsharp/override-target on the `overrides` side of the same rule.",
    transform: (r: any) => {
      const DERIVED = new Set(["self-member", "base-member"])
      const hit = (r.relationships ?? []).filter((x: any) => DERIVED.has(String(x.metadata?.targetResolution)))
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          DERIVED.has(String(x.metadata?.targetResolution))
            ? { ...x, target: String(x.target).split(".").pop() }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/in-file-type-spelled-as-its-leaf",
    language: "fsharp",
    defectClass: "unresolvable-endpoint",
    description:
      "M60 ontology lane pass 7, FS-P7-2 — the declared-type arm published the bare LEAF (`Dep`) even when the file was the one that declared `Dep`, while `calls`, `instantiates` and `uses` have spelled a name this file published as its identity since FS-P5: the same file, two rules for one question. The leaf is not wrong so much as ambiguous — the store resolves it through strategy 2 only while the NAME is unique in the corpus — and the identity is exact. Measured on the population that runs it (rows-pass10-meta.ndjson, keyed on the arm's own `relationshipType`): of `references`' 35,102 `declared_type` rows, 7,076 are `in-file-declaration`, 6,907 of those are respelled to the identity, and the class moves from 2,613 determinate to 4,865 — **+2,252, zero the other way**, `references` target-determinacy 25.8% -> 30.3%. The first price read +4,205/-110 on 9,555 rows and was wrong twice, both recorded in the analyzer's own comment: it pooled `open` rows the rule never touches, and it took the identity of whatever symbol the file published first under that name — ANY KIND. The unfiltered draft reached 35.3% of the draw against this rule's 34.8%, and the 1,536 determinate edges that difference is made of were attached to 2,467 identities held by a module, a member (`FieldParserInfo.Type`, `ParquetColumnKind.DateTimeOffset`) or a namespace — determinate edges naming a declaration that is NOT the type the source wrote. On the shipped arm, 6,907 of 6,907 dotted declared-type targets are held by a type-kind symbol. Reverted by cutting every `references` edge the analyzer itself marked `declared_type` + `in-file-declaration` back to its last segment, read off the result's own metadata so the revert cannot go vacuous. Caught by fsharp/declared-type-graph, whose rows name the identity (`Fixture.Types.Dep`, `Fixture.Types.Other`) while the two GROUP rows in the same file keep the leaf because those types are declared elsewhere — one file, both halves of the rule.",
    transform: (r: any) => {
      const hit = (r.relationships ?? []).filter(
        (x: any) =>
          String(x.type) === "references" &&
          String(x.metadata?.relationshipType) === "declared_type" &&
          String(x.metadata?.targetResolution) === "in-file-declaration",
      )
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          String(x.type) === "references" &&
          String(x.metadata?.relationshipType) === "declared_type" &&
          String(x.metadata?.targetResolution) === "in-file-declaration"
            ? { ...x, target: String(x.target).split(".").pop() }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/unresolved-marker-shipped",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "M60 ontology lane pass 7, FS-P7-1's decision half. The reason a target carries is decided AFTER the walk, from the COMPLETE published set, because the two halves of the question are answered at different times: the KIND of name is known when the edge is emitted, whether THIS FILE declares it is not — a type declared further down the file is still this file's declaration, and a mid-walk membership test would call it external. So the walk records a MARKER (`unresolved-type-name`, `unresolved-namespace`, `unresolved-base-name`, `unresolved-interface-name`) and a final pass rewrites it into the class (`in-file-declaration` / `external-type` / `external-namespace` / `base-member(-external)` / `interface-member(-external)`). The mutant reverts the final pass: every class the finalizer can produce goes back to its marker, per label, exactly as the shipped code would have emitted it if the loop were deleted. A marker reaching the result is a defect by definition — the file says so — and six labels' worth of reason rows go red at once. Caught by fsharp/declared-type-graph (extends/references), fsharp/import-and-use (imports/references), fsharp/override-target (extends/implements/overrides) and fsharp/type-extension-and-containment (contains, through the source reason).",
    transform: (r: any) => {
      const TYPE_LABELS = new Set(["extends", "implements"])
      const marker = (x: any): string | null => {
        const t = String(x.type)
        const md = x.metadata ?? {}
        const res = String(md.targetResolution ?? "")
        if (res === "external-type") return "unresolved-type-name"
        if (res === "external-namespace") return "unresolved-namespace"
        if (res === "base-member" || res === "base-member-external") return "unresolved-base-name"
        if (res === "interface-member" || res === "interface-member-external") return "unresolved-interface-name"
        if (res !== "in-file-declaration") return null
        // `in-file-declaration` is produced by the finalizer AND by `calls`/`uses`/`instantiates`
        // (FS-P5), so only the labels the finalizer owns are reverted — otherwise the mutant
        // would re-break a rule this pass did not touch and could be caught by the wrong fixture.
        if (TYPE_LABELS.has(t)) return "unresolved-type-name"
        if (String(md.relationshipType) === "declared_type") return "unresolved-type-name"
        if (String(md.relationshipType) === "open_directive" || md.isImport === true) return "unresolved-namespace"
        return null
      }
      const hit = (r.relationships ?? []).filter((x: any) => marker(x) !== null)
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          const m = marker(x)
          return m ? { ...x, metadata: { ...(x.metadata ?? {}), targetResolution: m } } : x
        }),
      }
    },
  },
  {
    id: "fsharp/external-claim-dropped",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "M60 ontology lane pass 8, FS-P8. `incoming-gate.ts fsharp fs` asked this lane's incoming question for the first time and the answer was 42,116 edges, 12,208 resolving to exactly one declaration in the file's own PROJECT, 28,862 unresolved and **zero external claims** — so a genuinely-external target and a broken edge were indistinguishable, which is the one thing the workstream's standard forbids. The marker is `metadata.isExternalTarget`, a key the gate already recognises, and the gate verifies it: the target's OWNER (everything before the last dot) must be absent from the project, or the claim is REFUTED and counted against the lane. On a 400-file draw the marker converts 705 unresolved edges to verified claims and is refuted 6 times. The mutant deletes the key from every relationship — same edges, same endpoints, one payload field gone — which is the only way a deleted claim can be caught, since the unmarked edge is exactly what the lane shipped for its whole life.",
    transform: (r: any) => {
      // ★ REPAIRED 2026-10-22 — THE OLD TRANSFORM WAS A MEASURED NO-OP, NOT A DEFECT MODEL.
      // It deleted `metadata.isExternalTarget`, a key THIS LANE NEVER EMITS: the lane's external
      // claim is carried by `metadata.targetResolution`, whose external values are
      // `external-type`, `external-namespace`, `external-type-or-module`, `bare-external`,
      // `base-member-external` and `interface-member-external`. The old transform therefore
      // changed NOTHING and the mutant was reported as a survivor. The defect it means to
      // model is real and the fixtures already pin it: fsharp/call-ownership and
      // fsharp/call-target-spelling assert `meta.targetResolution: "external-type"` and
      // `"external-type-or-module"` rows, and a lane that stopped saying "this target is
      // EXTERNAL" would make a genuinely-external target and a broken edge indistinguishable —
      // the one thing the workstream's standard forbids. The repaired transform deletes the
      // claim from the EXTERNAL rows only, which is the narrow, honest pre-fix state.
      const EXTERNAL_RESOLUTIONS = new Set([
        "external-type", "external-namespace", "external-type-or-module",
        "bare-external", "base-member-external", "interface-member-external",
      ])
      const isExternal = (x: any): boolean => EXTERNAL_RESOLUTIONS.has(String(x.metadata?.targetResolution ?? ""))
      const hit = (r.relationships ?? []).filter(isExternal)
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (!isExternal(x)) return x
          const metadata = { ...x.metadata }
          delete metadata.targetResolution
          return { ...x, metadata }
        }),
      }
    },
  },
  {
    id: "fsharp/external-claim-blanket",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "M60 ontology lane pass 8, the OTHER half of FS-P8 — a claim that is present and WRONG, which no dropped-claim mutant can reach. The marker's value is exactly the lookup that follows it, and the price table is what decided the shipped rule: a marker on ANY dotted target converts 26,795 verified against 35,839 REFUTED (42.8%), because a one-segment owner is a module NAME a project very often declares itself (`Seq` 4,447, `List` 4,035, `Expect` 2,540, `System` 2,118, `Array` 1,943, `String` 1,604 refutations). Restricting to owners of two or more segments whose ROOT this file does not declare moves the same population to 6,893 edges at 93.0% verified — the residue being the cross-file case the analyzer cannot see. The mutant is the deleted restriction: it marks every relationship with a dotted target, so `open System` and the `Seq.map`/`Array.fold`/`FSharpPlus.map` shapes are all claimed. Caught by the three forbid rows in fsharp/import-and-use and fsharp/call-target-spelling that assert the one-segment shapes are NOT claimed.",
    transform: (r: any) => {
      const hit = (r.relationships ?? []).filter(
        (x: any) => String(x.target ?? "").includes(".") && x.metadata?.targetResolution !== undefined,
      )
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          String(x.target ?? "").includes(".") && x.metadata?.targetResolution !== undefined
            ? { ...x, metadata: { ...x.metadata, isExternalTarget: true } }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/override-reason-ignores-whether-the-base-is-local",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "M60 ontology lane pass 7, the half of FS-P7-1 that a DROPPED reason cannot catch. `unresolved-marker-shipped` and `containment-source-reason-dropped` both revert a payload to nothing, so both are blind to a class that is present and WRONG — and the override classes are exactly where a present-and-wrong value is cheapest to write: the finalizer asks ONE question (`publishedTypeNames.has(writtenBase)`) and answers with two pairs of class names, so deleting the question and keeping the `-external` arm of each pair is a one-line edit that renames nothing, drops nothing, and turns every `overrides` row into a claim about a declaration the file does not contain. On the shipped draw (rows-pass10-meta.ndjson) that is 188 rows: 114 `overrides` `base-member`, 72 `overrides` `interface-member` and 2 `calls` `base-member` (the `base.M` call arm shares the `base-member` class with the declaration arm). Caught by fsharp/override-target, which pins BOTH halves of the split one field apart — `Dog.Speak -> Animal.Speak` is `base-member` because `Animal` is this file's type while `Buffer.Flush -> System.IO.MemoryStream.Flush` is `base-member-external`, and `Tagged.Tag -> ITagged.Tag` is `interface-member` while `Resource.Dispose -> IDisposable.Dispose` is `interface-member-external` — rows added in the same pass for this exactly: before them, swapping the two class names passed all 12 fixtures. Caught on the call side by fsharp/call-target-spelling's `Base.Speak`.",
    transform: (r: any) => {
      const LOCAL = new Set(["base-member", "interface-member"])
      const hit = (r.relationships ?? []).filter((x: any) => LOCAL.has(String(x.metadata?.targetResolution)))
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          LOCAL.has(String(x.metadata?.targetResolution))
            ? { ...x, metadata: { ...(x.metadata ?? {}), targetResolution: `${String(x.metadata.targetResolution)}-external` } }
            : x,
        ),
      }
    },
  },
  {
    id: "fsharp/containment-source-reason-dropped",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "M60 ontology lane pass 7, FS-P7-1's SOURCE half. A `contains` edge names its parent by IDENTITY when the file has exactly one symbol of that name, by its own name when the parent is a top-level unit (which IS its own name), and by the bare name when two declarations share it with different identities — the last case is 30.4% of the draw's 58,298 `contains` edges, and the first draft of the classification called EVERY module-scoped edge `ambiguous-owner-name` because `publish` mints no fqn for an unowned symbol, which is a claim about the corpus that is false. Two facts were therefore added to every containment edge: `targetResolution` (`published-identity`, because the child IS a symbol this file minted) and `sourceResolution` (`in-file-declaration` / `ownerless-unit` / `ambiguous-owner-name`). The mutant deletes `sourceResolution` — same edges, same endpoints, one payload field gone — which is the only way a deleted reason can be caught. Caught by fsharp/override-target (`ownerless-unit` and `in-file-declaration`) and fsharp/type-extension-and-containment (`ambiguous-owner-name`, on `First.Same`/`Second.Same`).",
    transform: (r: any) => {
      const hit = (r.relationships ?? []).filter(
        (x: any) => String(x.type) === "contains" && x.metadata?.sourceResolution !== undefined,
      )
      if (hit.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (String(x.type) !== "contains" || x.metadata?.sourceResolution === undefined) return x
          const metadata = { ...x.metadata }
          delete metadata.sourceResolution
          return { ...x, metadata }
        }),
      }
    },
  },
  {
    id: "fsharp/mutual-type-group-read-as-one-type",
    language: "fsharp",
    defectClass: "wrong-owner",
    description:
      "PRE-FIX (FS-P9): `type A = … and B = …` is ONE `type_definition` node holding a clause body per type, and the analyzer read the declaration from the NODE — so the group was named after its FIRST clause, every later clause was published nowhere, and every later clause's members were published under the first name. Measured on the 3,000-file draw (.tmp-probe/fs-p10-groups.mts, arm rows-pass13-meta.ndjson): 79 groups in 67 files, 182 clauses after a first, 161 of those names published nowhere — while the members were not missing at all but ATTACHED WRONGLY, which is the half a missing-name count cannot see: `ConcatBuilder.GroupOwn` is a published symbol, so a containment edge or a call landing on it RESOLVED and nothing downstream could tell it named the wrong type. The fix re-dispatches each clause through the same type branch as a marked walk frame (`asTypeUnit`), so the kind classifier, record fields, DU/enum cases, interface implementations, `extends` edges, member scoping and containment composition are one implementation for both shapes. Reverted here by collapsing each mutual group to its first clause: the later clause's symbol is DROPPED, its members keep their spans but take the first clause's owner and fqn, and every edge endpoint that named the group's later clause is rewritten to the first — which is exactly the pre-fix shape (a resolved edge naming a declaration the source did not mean). The group is identified in the OUTPUT by the only signal the output has: two type-kind symbols with the SAME owner whose declaration lines are adjacent, which is what an `and` clause is once the `and` token is gone. Caught by fsharp/mutual-type-group, whose four shapes pin an OWNER each and whose two `expectRelationshipCount` rows pin the totals a per-row expect cannot state.",
    transform: (r: any) => {
      const TYPE_KINDS = new Set(["class", "interface", "enum", "type", "struct", "delegate"])
      const syms = (r.symbols ?? []) as any[]
      const isType = (s: any) => !!s?.range && !!s?.name && TYPE_KINDS.has(String(s.kind))
      const byOwner = new Map<string, any[]>()
      for (const s of syms) {
        if (!isType(s)) continue
        const key = String(s.ownerName ?? "")
        const list = byOwner.get(key) ?? []
        list.push(s)
        byOwner.set(key, list)
      }
      const merges: [any, any][] = []
      for (const list of byOwner.values()) {
        list.sort((a: any, b: any) => a.range.startLine - b.range.startLine)
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1]!
          const cur = list[i]!
          if (cur.range.startLine - prev.range.startLine <= 4) merges.push([prev, cur])
        }
      }
      if (merges.length === 0) return r
      const dropped = new Set(merges.map((m) => m[1]))
      const fqnOf = (s: any) => String(s?.metadata?.fqn ?? s?.name ?? "")
      const rename = new Map<string, string>()
      for (const [a, b] of merges) {
        rename.set(fqnOf(b), fqnOf(a))
        rename.set(String(b.name), fqnOf(a))
      }
      const respell = (endpoint: string): string => {
        if (rename.has(endpoint)) return rename.get(endpoint)!
        for (const [from, to] of rename) {
          if (from && endpoint.startsWith(from + ".")) return to + endpoint.slice(from.length)
        }
        return endpoint
      }
      return {
        ...r,
        symbols: syms
          .filter((s) => !dropped.has(s))
          .map((s) => {
            let out = s
            for (const [a, b] of merges) {
              const owner = String(out.ownerName ?? "")
              const fqn = String(out.metadata?.fqn ?? "")
              const ownerHit = owner === String(b.name)
              const fqnHit = fqn.startsWith(fqnOf(b) + ".")
              if (!ownerHit && !fqnHit) continue
              out = {
                ...out,
                ownerName: ownerHit ? String(a.name) : out.ownerName,
                metadata: {
                  ...(out.metadata ?? {}),
                  fqn: fqnHit ? fqnOf(a) + fqn.slice(fqnOf(b).length) : out.metadata?.fqn,
                },
              }
            }
            return out
          }),
        relationships: (r.relationships ?? []).map((x: any) => ({
          ...x,
          source: respell(String(x.source)),
          target: respell(String(x.target)),
        })),
      }
    },
  },
  {
    id: "fsharp/project-index-refinement-ignored",
    language: "fsharp",
    defectClass: "wrong-payload",
    description:
      "FS-P16/17 — the PROJECT-INDEX refinement, reverted. The analyzer reads `context.projectIndex` (built once per run, shipped with every batch) and turns the classes that mean 'not this file' into classes that say WHICH 'not this file': `bare-external` -> `in-project-name`, `external-type` -> `in-project-type`, `external-type-or-module` -> `in-project-type-or-module`, `external-namespace` -> `in-project-namespace`, `base-member-external` -> `base-member-in-project`, `interface-member-external` -> `interface-member-in-project`. The last two classes added are the FS-P17 channels (a module owner and a namespace path), and they are in this one map because the defect they revert is the same defect: an analyzer that never reads the index. The pre-fix state is exactly an analyzer that never reads the index, which is what this transform restores — the classes go back, and the markers the refinement writes (`projectIndexRefined`, `baseInProjectLacksMember`) go with them, because a run that never refined cannot have written them. Measured price of the rule it reverts: 32,778 of the 179,481 edges whose class said 'not this file' get a sharper reason on the lane's 3,000-file draw, and the population is named per class in `docs/analyzers/real-fsharp-analyzer.md` pass 16. Caught by fsharp/fs-p10-project/fs-p10-client, whose positive rows assert the refined classes and whose FORBID rows name the pre-fix ones — a fixture that asserted only the positives would be satisfied by a run that emitted both, which is why both halves exist. The index is not a guess: with no index the analyzer is byte-for-byte its old self, so this mutant is also the pin on that property.",
    transform: (r: any) => {
      const PRE: Record<string, string> = {
        "in-project-name": "bare-external",
        "in-project-type": "external-type",
        "in-project-type-or-module": "external-type-or-module",
        "in-project-namespace": "external-namespace",
        "base-member-in-project": "base-member-external",
        "interface-member-in-project": "interface-member-external",
      }
      let touched = 0
      const relationships = (r.relationships ?? []).map((x: any) => {
        const md = x.metadata
        if (!md || typeof md.targetResolution !== "string") return x
        const back = PRE[md.targetResolution]
        if (back === undefined) return x
        touched++
        const next: Record<string, any> = { ...md, targetResolution: back }
        delete next.projectIndexRefined
        delete next.baseInProjectLacksMember
        return { ...x, metadata: next }
      })
      if (touched === 0) return r
      return { ...r, relationships }
    },
  },
  {
    id: "fsharp/load-directive-published-as-an-import",
    language: "fsharp",
    defectClass: "wrong-relationship",
    description:
      "THE R3 REMEDY (2026-10-22), REVERTED: a `#load` directive is a TEXTUAL INCLUDE — the named file is compiled as part of THIS compilation unit, shares this file's single scope, imports nothing, and cannot be resolved as a separate module — so it is a `part_of` row, not an `imports` row. Before the remedy the analyzer read the directive's keyword and published ALL THREE of `#r`/`#load`/`#I` as `imports` (measured over the whole admitted population: 838 `#r` sites, 99 `#I` sites, 236 `#load` sites in 135 files), and `#r` and `#I` are still `imports` — they name an assembly and an include path. The defect this mutant injects is EXACTLY that: the `#load` row is published under the old label, so ONE CONSTRUCT CARRIES TWO LABELS, and a dependency graph that reads both sees a file coupling twice and cannot tell which of the two is the file coupling. THE MUTANT REVERTS THE LABEL AND NOT THE TARGET SPELLING, and the reason is stated rather than papered over: the pre-fix row's target was the RAW SPECIFIER (`Other.fsx`), a string the post-fix row does not contain (it carries the PROJECT-RELATIVE PATH the directive resolves to), so a transform over the result cannot recover it — the same reason the `repl-control-directive-imports-a-resource` mutant is an injection rather than a byte-faithful revert. What it asserts is the defect itself: does the suite go red when a `#load` also reads as an import? Caught by fsharp/part-of-load/host, whose forbid row for the `imports` shape exists for this and nothing else, and by fsharp/import-and-use, whose `part_of` row for `#load` cannot be satisfied by an `imports` row.",
    transform: (r: any) => {
      let touched = 0
      const relationships = (r.relationships ?? []).map((x: any) => {
        if (String(x?.type) !== "part_of") return x
        if (String(x?.metadata?.relationshipType ?? "") !== "part_directive") return x
        touched++
        return {
          ...x,
          type: "imports",
          metadata: {
            ...x.metadata,
            relationshipType: "resource_directive",
            directive: "#load",
            targetResolution: "resource-path",
          },
        }
      })
      if (touched === 0) return r
      return { ...r, relationships }
    },
  },
  {
    id: "fsharp/load-directive-direction-reversed",
    language: "fsharp",
    defectClass: "wrong-relationship",
    description:
      "THE R3 REMEDY'S DIRECTION, REVERTED: the `part_of` contract says the DIRECTION IS THE DIRECTIVE'S OWN — the source is the file carrying the directive, the target is what it names, and every row carries `metadata.partRole` (src/ast/types.ts:170-190). F# has only ONE of DART's TWO FORMS: there is no `part of` in F#, so EVERY F# row is the host that INCLUDES the part and the role is `library`. A rule that could not tell the two ends apart would publish the included part as the source and the host as the target, and `partRole: \"part\"` on a host file is the same fact with the sign flipped. The mutant injects EXACTLY that: the role is flipped to `part`, which is the whole of the claim. Caught by fsharp/part-of-load/host, whose forbid row for `partRole: \"part\"` exists for this and nothing else.",
    transform: (r: any) => {
      let touched = 0
      const relationships = (r.relationships ?? []).map((x: any) => {
        if (String(x?.type) !== "part_of") return x
        if (String(x?.metadata?.partRole ?? "") !== "library") return x
        touched++
        return { ...x, metadata: { ...x.metadata, partRole: "part" } }
      })
      if (touched === 0) return r
      return { ...r, relationships }
    },
  },
]
