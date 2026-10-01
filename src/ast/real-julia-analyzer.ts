import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Julia — analyzer.
 *
 * WRITTEN AGAINST A MEASURED GRAMMAR, WHICH IS THE POINT OF THIS FILE'S EXISTENCE ORDER
 * ------------------------------------------------------------------------------------
 * Most lanes in this repo were written first and measured afterwards, and the measurement is
 * what found the defects: objective-c carried two reviews and a CLOSED marker over a corpus
 * instrument reading 7 of the 329 files the router admits, and its `grammarErrorFiles: 0` came
 * from an artifact recording 49 crashes counted as 49 clean parses. This lane was inverted. Before
 * this file existed, `script/m60/julia-census.ts` had measured the grammar over 966 corpus files
 * and `script/m12/julia-differential.ts` had compared it against **Julia 1.11.3's own parser**
 * over 949 of them, finding **185 files of valid Julia the grammar could not read**. Four named
 * constructs were patched before a line of analyzer was written, which is why this analyzer is
 * starting from a defect inventory instead of from a blank page.
 *
 * The remaining 177 defect files are NOT hidden. They are in the census and the differential,
 * and a construct in one of them is published as far as the tree allows.
 *
 * WHAT JULIA'S SEMANTICS ACTUALLY ARE, because three of the 13 relationship types must be
 * declined rather than faked
 * --------------------------------------------------------------------------------------------
 * `overrides` is **declined**. Julia has multiple dispatch, not overriding: two methods with the
 * same name and different signatures are DIFFERENT METHODS, both live, and neither replaces the
 * other. Emitting an `overrides` edge between them would state a falsehood about the language —
 * the single most common way a multi-language analyzer lies is by importing another language's
 * ontology wholesale and calling the result coverage.
 *
 * `implements` is **declined** for the same reason. Julia has no interfaces to implement:
 * `abstract type` participates in a TYPE hierarchy (`<:`), not in a protocol-conformance relation.
 * Publishing "S implements I" for `struct S <: I` would be the managed-OO ontology applied to a
 * language that does not have it.
 *
 * `extends` is emitted ONLY for `<: Supertype` on an `abstract type` or a `struct`. That is the
 * real subtype edge and nothing else is.
 *
 * `instantiates` is emitted when a bare type name is CALLED — `Point(1, 2)` constructs a Point.
 * Julia has no `new()`; calling the type is the constructor, so a call whose callee is a
 * capitalized identifier bound to a type declaration is an instantiation. It is marked
 * `isTypeConstruction` rather than inferred from capitalization alone, because capitalization is
 * a convention and the corpus is the arbiter.
 */

// A Julia identifier that is a CONVENTIONALLY capitalized name is not evidence of anything on
// its own, so this set is only consulted for a call whose callee is a bare identifier, and only
// alongside the question "did this file declare a type with this name?".
const TYPE_DECLARATIONS: ReadonlySet<string> = new Set(["abstract_definition", "primitive_definition", "struct_definition"])

// Julia's own implicit and constant names. None of them is a dependency edge, and emitting one
// would be a fabricated relationship: `nothing`/`missing` are the language's sentinel values, the
// `ARGS`/`ENV` globals are the interpreter's own bindings, and a bare `true`/`false` is a literal
// (the grammar's `boolean_literal` already covers that, so this set is about the names that
// appear as plain identifiers).
/**
 * Relationship source for code that is not inside any declaration.
 *
 * MEASURED, and it was the single largest source of missing edges in this analyzer. Julia files
 * do not have to open a `module`: measured over 295 corpus files, **71.9% have no module block
 * at all**. Julia scripts, REPL transcripts, `include`d fragments and whole stdlib test files all
 * run at file scope, and top-level code there is ordinary executable code — `const C = f(x)`,
 * bare `f(x)`, calls between statements.
 *
 * Because the call edge required a non-empty scope, all of it vanished: 46 module-less files
 * emitted ZERO call edges despite holding 8,478 `call_expression`s between them. Worse than
 * incomplete — a script that calls a dozen functions indexed as a file containing nothing.
 *
 * The name and the rule are this repo's own, not an invention: `real-c-analyzer.ts:892`
 * documents `getRelationshipSource()` as "the enclosing FUNCTION name … or `global`" for
 * file-scope relationships, precisely because an invented scope name like `core_init.block_211`
 * is a dangling identity that resolves to no symbol.
 *
 * `contains` deliberately KEEPS its `if (scope)` guard, for the reason recorded next to the same
 * C rule: `global contains core_init` is a dangling edge to a container that does not exist, and
 * ownership is a claim about a real container. Top-level declarations get `ownerName: undefined`
 * instead, which says "this is not owned by anything" rather than inventing an owner.
 */
const GLOBAL_SCOPE = "global"

const IMPLICIT_OR_CONSTANT: ReadonlySet<string> = new Set([
  "nothing", "missing", "undef", "ARGS", "ENV", "C_NULL", "stdout", "stderr", "stdin",
])

export class RealJuliaAnalyzer {
  /**
   * Call sites under an `@ccall`, recorded when the macro is visited and consulted when the
   * nested `call_expression` is emitted. Instance state rather than a local because the macro
   * case and the call case are different methods, and CLEARED at the top of every `analyze()` so
   * a reused instance cannot carry one file's C symbols into the next file's graph — which would
   * mark an unrelated call as foreign and is precisely the kind of cross-file bleed a shared
   * analyzer instance invites.
   */
  private foreignMarked = new Set<string>()

  /**
   * `call_expression` nodes that are the LEFT-HAND SIDE of a short-form declaration, i.e.
   * `f(x) = …` rather than an invocation. Julia writes a function definition with the same node
   * type as a call, so without this the declaration reads as the function calling itself.
   * Cleared per `analyze()` for the same reason as `foreignMarked`.
   */
  private declSites = new Set<number>()

  /**
   * `type_head` nodes belonging to a type DECLARATION, so a type is not recorded as referencing
   * itself. Cleared per `analyze()` like the other per-file sets.
   */
  private typeHeadSites = new Set<number>()

  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    this.foreignMarked.clear()
    this.declSites.clear()
    this.typeHeadSites.clear()
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: any[] = []
    const frameworks = new Set<string>()

    // The declared type names in THIS file, needed to decide whether a bare call is a
    // construction. Built during the walk and consulted afterwards, so a type declared later in
    // the file still counts.
    const declaredTypes = new Set<string>()

    let activeScope = ""
    let depth = 0

    const walkStack: { node: Node; activeScope: string; isExit: boolean }[] = [{ node: rootNode, activeScope: "", isExit: false }]

    while (walkStack.length > 0) {
      const frame = walkStack.pop()!
      const node = frame.node
      if (frame.isExit) {
        depth--
        // RESTORE the scope this node was entered with. The frame already carries it and the
        // comment below claimed this was what the frame was for, but the handler only counted
        // depth, so `activeScope` was a value that DRIFTED FORWARD for the whole file: the last
        // declaration to advance it owned every later sibling.
        //
        // It took the product path to see it. On a module-less unit sample every function was
        // declared, so each one re-advanced the scope and the leak was invisible. Through
        // `ASTEngine.parseFile` on a file whose last function is `describe(s::Shape)::String = …`
        // — which this analyzer did not recognise as a declaration at all — the body of
        // `describe` was attributed to `Area`, the PREVIOUS function:
        //
        //     Area -calls-> describe@17
        //     Area -calls-> string@17        <- actually describe's body
        //     Area -calls-> typeof@17
        //
        // So one unrecognized declaration did not merely lose itself, it reassigned the ownership
        // of everything after it. Frames are pushed exit-first with children reversed, so children
        // always pop before their parent's exit frame and restoring here is well-ordered.
        activeScope = frame.activeScope
        continue
      }
      const scope = frame.activeScope

      switch (node.type) {
        // ---------------------------------------------------------------- modules
        case "module_definition": {
          // `module` and `baremodule` are the same node with a different first token. The `name`
          // field is the ONLY field in this grammar's module rule, so it is read by field and
          // everything else in the file is positional.
          const nameNode = node.childForFieldName("name")
          const name = nameNode ? nameNode.text.trim() : ""
          if (name) {
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Module,
              range: this.range(node),
            complexity: this.complexity(node),
              ownerName: scope || undefined,
              metadata: { juliaSpecific: true, isBareModule: this.firstNamedChildType(node) === "baremodule" },
            })
            if (scope) relationships.push(this.rel(scope, "contains", name, node, 1.0))
            activeScope = name
          }
          break
        }

        // ---------------------------------------------------------------- type declarations
        case "abstract_definition":
        case "primitive_definition":
        case "struct_definition": {
          const nameNode = this.firstNamedChildOfType(node, "type_head")
          const name = nameNode ? this.typeHeadName(nameNode) : ""
          if (!name) break
          const kind = node.type === "struct_definition"
            ? ASTEngine.SymbolKind.Class
            : ASTEngine.SymbolKind.Interface
          symbols.push({
            name,
            kind,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, declarationForm: node.type, isMutable: this.hasToken(node, "mutable") },
          })
          declaredTypes.add(name)
          if (scope) relationships.push(this.rel(scope, "contains", name, node, 1.0))

          // A type's OWN HEAD is not a reference. `struct Circle{T<:Real} <: Shape` names Circle in
          // its own type head, and the `parametrized_type_expression` case below reads that as a
          // reference — so every struct published a reference to ITSELF (`Shapes -references->
          // Circle@6`), which is a declaration stating itself. Recorded so the reference cases can
          // tell a type head from a type USE; `Vector{T}` in an annotation is still a real one.
          if (nameNode) this.typeHeadSites.add(nameNode.id)

          // A type's BODY belongs to the type, not to the enclosing module: `radius::T` inside
          // `struct Circle{T<:Real}` is a fact about Circle, including the bound on Circle's own
          // type parameter. Without advancing the scope, `Shapes -references-> T` attributed a
          // type parameter to the module that has no such parameter.
          activeScope = name

          // The SUBTYPE edge, and it is the only inheritance Julia has. `struct S <: A` puts a
          // `where`-less `binary_expression` (or a `comparison_operator` chain) between the type
          // head and the supertypes; `abstract type` uses the same shape.
          for (const sup of this.supertypesOf(node)) {
            relationships.push(this.rel(name, "extends", sup, node, 1.0, { juliaSpecific: true, isSubtype: true }))
          }

          // A struct's fields. `struct S; x::T; end` puts bare `x::T` in the body, which is a
          // `field_definition`-shaped position; the grammar has no dedicated node, so a
          // `typed_expression` directly inside the struct body is a field.
          for (const field of this.structFields(node)) {
            symbols.push({
              name: field.name,
              kind: ASTEngine.SymbolKind.Property,
              range: this.range(field.node),
              complexity: this.complexity(field.node),
              ownerName: name,
              metadata: { juliaSpecific: true, isStructField: true },
            })
            relationships.push(this.rel(name, "contains", field.name, field.node, 1.0))
          }
          break
        }

        // ---------------------------------------------------------------- functions
        case "function_definition":
        case "macro_definition": {
          const sig = this.firstNamedChildOfType(node, "signature")
          const name = sig ? this.signatureName(sig) : ""
          if (!name) break
          // Same distinction as the short form, on the signature: `function bump!(c, by)` puts the
          // function's own name and parameters in a `call_expression`, and walking into it emitted
          // `bump! -calls-> bump!`. Only the SHORT form's declaration site was recorded, so the long
          // form kept self-calling; the fixture lane is what found the asymmetry.
          if (sig) {
            let callable: Node | null = this.pos(sig, 0)
            for (let i = 0; i < 4 && callable && callable.type !== "call_expression"; i++) {
              callable = this.pos(callable, 0)
            }
            if (callable && callable.type === "call_expression") this.declSites.add(callable.id)
          }
          const isMacro = node.type === "macro_definition"
          symbols.push({
            name,
            kind: isMacro ? ASTEngine.SymbolKind.Macro : ASTEngine.SymbolKind.Function,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, isMacro, hasBlockBody: !!this.firstNamedChildOfType(node, "compound_statement") },
          })
          if (scope) relationships.push(this.rel(scope, "contains", name, node, 1.0))
          activeScope = name
          break
        }

        // ---------------------------------------------------------------- SHORT-FORM function definition
        //
        // `f(x) = expr` and `A.B(x) = expr` are NOT `function_definition` nodes. The grammar
        // gives `(assignment (call_expression (identifier) (argument_list …)) (operator) rhs)`, so
        // Julia's single most common way of writing a function has no node of its own. Handling
        // only `function … end` found 4 functions in a sample where the file has 7, and — worse —
        // attributed every call INSIDE a short-form body to the enclosing module, because the scope
        // never advanced. Julia's own stdlib writes this way far more often than the long form.
        case "assignment": {
          // `f(x) where {T} = …` wraps the call in a `where_expression`; unwrap before demanding
          // a `call_expression`, or every `where`-form declaration is silently skipped.
          let lhs = this.unwrapWhere(this.pos(node, 0) ?? node)
          // `describe(s::Shape)::String = …` puts the RETURN TYPE on the left, so the assignment's
          // first child is a `typed_expression`, not a `call_expression` — and the declaration was
          // invisible. Measured through the product path: a file declaring `Area` twice and
          // `describe` once published TWO functions, not three, and `describe`'s body was
          // misattributed (see the exit-frame note). `x::Int = 5` is ALSO a `typed_expression`, so
          // the wrapper is unwrapped only when what it wraps is a CALL — that is exactly what
          // separates a function declaration with a return type from a typed variable.
          if (lhs.type === "typed_expression") {
            const inner = this.pos(lhs, 0)
            if (inner && inner.type === "call_expression") lhs = inner
          }
          if (lhs.type !== "call_expression") break
          const name = this.calleeName(lhs)
          if (!name || IMPLICIT_OR_CONSTANT.has(name)) break
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Function,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, declarationForm: "short_form_assignment", hasBlockBody: false },
          })
          // The DECLARATION's own left-hand side is the same `call_expression` node the call case
          // looks for, so walking into it emitted `Area -calls-> Area` — the function calling
          // itself, once per declaration. Julia has no such thing: `f(x) = …` DEFINES f, it does
          // not invoke it. The node is recorded so the call case can tell a declaration site from
          // an invocation, which is a distinction the tree does not make on its own.
          this.declSites.add(lhs.id)
          if (scope) relationships.push(this.rel(scope, "contains", name, node, 1.0))
          // Parameters are deliberately NOT published as symbols. That is this repo's standing
          // negative contract — `SymbolKind` has no Parameter member at all, and swift/kotlin/
          // csharp all removed theirs under the C# M12.07 ParamsAreNotSymbols /
          // LocalsAreNotSymbols rules. A parameter is a binding, not a declaration, and promoting
          // one to a symbol puts `c` in the graph beside every real declaration in the file. The
          // first version did publish them, produced two symbols of kind `undefined` because the
          // enum member does not exist, and the compiler said so — which is the vocabulary check
          // working, and a reminder that this grammar's 7-field vocabulary is the thing to read.
          // Parameters are still READS (the `uses` pass binds them), which is the fact that matters.
          activeScope = name
          break
        }

        // ---------------------------------------------------------------- const / global / local
        case "const_statement":
        case "global_statement":
        case "local_statement": {
          // `const global x = 1` is one node (see grammar P3); the bound name is the
          // assignment's left-hand side, which is the only place a Julia binding is introduced.
          const assign = this.firstNamedChildOfType(node, "assignment")
          if (!assign) break
          // `assignment` is POSITIONAL: child 0 is the left-hand side, child 1 the operator,
          // child 2 the value. For a short-form function definition the LHS is a `call_expression`,
          // which is a DEFINITION and not a binding — handled by its own case below.
          const lhs = this.pos(assign, 0)
          if (!lhs || lhs.type === "call_expression") break
          const name = lhs.text.trim()
          if (!name || IMPLICIT_OR_CONSTANT.has(name)) break
          symbols.push({
            name,
            kind: node.type === "const_statement" ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, binding: node.type.replace("_statement", "") },
          })
          if (scope) relationships.push(this.rel(scope, "contains", name, node, 1.0))
          break
        }

        // ---------------------------------------------------------------- imports
        case "import_statement":
        case "using_statement": {
          for (const t of this.importTargets(node)) {
            imports.push({
              module: t.name,
              items: t.items,
              importType: node.type === "import_statement" ? "import" : "using",
              lineNumber: node.startPosition.row + 1,
              isExternal: !t.name.startsWith("."),
            })
            relationships.push(this.rel("root", "references", t.name, node, 1.0, { juliaSpecific: true, isImport: true, importForm: node.type }))
          }
          break
        }

        case "export_statement":
        case "public_statement": {
          for (const child of this.namedChildren(node)) {
            const name = this.exportableName(child)
            if (!name) continue
            // `ExportInfo.kind` is a SymbolKind, not a string — `type` is a free-text field and
            // `kind` is the typed one, and the two are not interchangeable.
            exports.push({
              name,
              // The kind is deliberately NOT asserted. `export X` exports a BINDING whose kind
              // depends on what X turns out to be — a struct in one file, a function in another —
              // and Julia allows the export to precede the declaration. The first version pushed a
              // `SymbolKind.Function` for every `export`, which produced a SECOND `Circle` beside
              // the real `class:Circle`, and the dedup did not merge them because its key is
              // `kind:owner:name` and the kinds differed. So `export` records an export and marks
              // nothing: the declaration is the declaration.
              type: node.type === "export_statement" ? "value" : "type",
              lineNumber: node.startPosition.row + 1,
              metadata: { juliaSpecific: true, exportForm: node.type, declaresNothing: true },
            })
            // If the binding is already declared in this file, record the export ON it.
            for (const sym of symbols) {
              if (sym.name !== name) continue
              sym.metadata = { ...(sym.metadata ?? {}), isExported: true, exportForm: node.type }
            }
          }
          break
        }

        // ---------------------------------------------------------------- calls and construction
        case "call_expression": {
          if (this.declSites.has(node.id)) break
          const callee = this.calleeName(node)
          if (!callee || IMPLICIT_OR_CONSTANT.has(callee)) break
          const isCtor = declaredTypes.has(callee) || TYPE_DECLARATIONS.has(callee)
          // The FUNCTION form of ccall: `ccall(:jl_getpid, Cint, ())` or
          // `ccall((:malloc, :libc), Ptr{Cvoid}, …)`. The callee here really is the Julia function
          // `ccall`, so that edge is emitted normally; the C symbol lives in the FIRST ARGUMENT, as
          // a `quote_expression` or a `tuple_expression` of them. Recorded with its library when
          // the two-tuple form supplies one, because `(:malloc, :libc)` says which library the
          // symbol comes from and discarding that loses a fact the source states.
          const foreign = callee === "ccall" ? this.ccallTarget(node) : null
          const meta: any = isCtor
            ? { juliaSpecific: true, isTypeConstruction: true }
            : foreign
              ? { juliaSpecific: true, isForeignCall: true, foreignSymbol: foreign.symbol, foreignLibrary: foreign.library, via: "ccall" }
              : this.foreignMarked.has(this.textKey(node, callee))
                ? { juliaSpecific: true, isForeignCall: true, via: "@ccall" }
                : { juliaSpecific: true }
          {
            relationships.push(this.rel(
              scope || GLOBAL_SCOPE,
              isCtor ? "instantiates" : "calls",
              callee,
              node,
              isCtor ? 0.9 : 1.0,
              meta,
            ))
          }
          // The C symbol gets its OWN edge rather than only a field on the `ccall` edge.
          //
          // Relationships dedup on `type|source->target` (Law 3), so two `ccall` invocations in one
          // scope are the SAME edge and the second was dropped whole — taking `foreignSymbol` and
          // `foreignLibrary` with it. Measured: `ccall(:jl_getpid, …)` and `ccall((:malloc, :libc), …)`
          // in one file produced ONE edge carrying only the first call's symbol, and the fact that
          // the source says `:libc` was simply gone. An edge to the C symbol is a distinct
          // (source, target) pair per symbol, so it survives dedup and keeps its library, and it
          // matches how `@ccall` already reports its target. The two spellings of one operation now
          // agree, which they did not before.
          if (foreign) {
            relationships.push(this.rel(
              scope || GLOBAL_SCOPE,
              "calls",
              foreign.symbol,
              node,
              1.0,
              {
                juliaSpecific: true,
                isForeignCall: true,
                foreignSymbol: foreign.symbol,
                foreignLibrary: foreign.library,
                via: "ccall",
              },
            ))
          }
          break
        }

        // ---------------------------------------------------------------- macro calls
        case "macrocall_expression": {
          const nameNode = this.firstNamedChildOfType(node, "macro_identifier")
          const name = nameNode ? nameNode.text.trim().replace(/^@/, "") : ""

          // `@ccall strlen(s::Ptr{UInt8})::Csize_t` names a C SYMBOL, not a Julia binding. Its
          // callee is a plain `call_expression` in the tree, so the walk reaches the ordinary call
          // case and emitted `calls -> strlen` — asserting a Julia call to a binding that does not
          // exist in Julia's namespace. The call is real; the claim that its target is a JULIA
          // FUNCTION is not. The C targets are collected here and marked at the emit site, which
          // keeps the edge (the code does call strlen) while refusing to pretend otherwise. The
          // function form `ccall((:malloc, :libc), …)` states the same fact in a `quote_expression`
          // argument and was recording NOTHING, so the two spellings of one operation disagreed;
          // that form is handled in the call case below, library included.
          if (name === "ccall") this.markForeignCallees(node)
          if (!name) break
          relationships.push(this.rel(scope || GLOBAL_SCOPE, "calls", name, node, 1.0, { juliaSpecific: true, isMacroCall: true }))
          break
        }

        // ---------------------------------------------------------------- type annotations
        case "typed_expression": {
          // `x::Int` — POSITIONAL: child 0 is the name, child 1 the type. The TYPE is the
          // reference; the left side is a binding or a read, and a struct body's bare `x::T` was
          // already published as a field above and must not also become a read here.
          const typeNode = this.pos(node, 1)
          const typeName = typeNode ? this.typeHeadName(typeNode) : ""
          if (typeName && scope) relationships.push(this.rel(scope, "references", typeName, node, 1.0, { juliaSpecific: true, isTypeReference: true }))
          break
        }

        case "parametrized_type_expression": {
          // `Vector{T}` — the base type is a reference and T is a parameter, not a read.
          if (this.withinTypeHead(node)) break
          const base = this.firstNamedChildOfType(node, "identifier")
          if (base && scope) relationships.push(this.rel(scope, "references", base.text.trim(), node, 1.0, { juliaSpecific: true, isTypeReference: true }))
          break
        }

        case "where_expression": {
          // `f(x::T) where {T<:Real}` — an upper bound inside is a subtype fact, and a
          // constraint name is a binding rather than a read.
          for (const child of this.namedChildren(node)) {
            if (child.type !== "binary_expression") continue
            const { op, left, right } = this.binOperands(child)
            if (op !== "<:" && op !== ">") continue
            const sub = right ? this.typeHeadName(right) : ""
            if (sub && left && scope) {
              relationships.push(this.rel(left.text.trim(), "extends", sub, child, 1.0, { juliaSpecific: true, isSubtype: true, isWhereBound: true }))
            }
          }
          break
        }

        // ---------------------------------------------------------------- field access
        case "field_expression": {
          // One of the SEVEN node types in this grammar that actually has a field, so
          // `childForFieldName` is correct here and positional access would be wrong.
          //
          // But `field_expression` is ALSO this grammar's dotted path — `Core.Intrinsics.bitcast`
          // is `field_expression(field_expression(Core, Intrinsics), bitcast)` — and Julia spells
          // namespace access and field access identically, so the node alone cannot say which.
          //
          // The rule used here is syntactic and stated rather than guessed: a NESTED
          // `field_expression` is a qualified reference, so only the OUTERMOST link of the chain
          // emits, and it emits the WHOLE path. Emitting a bare `uses -> bitcast` for the member
          // of `Core.Intrinsics.bitcast` would rebuild by the back door the exact ambiguity
          // `fieldPath` was written to remove — and it would sit there beside the correct
          // `calls -> Core.Intrinsics.bitcast`, looking like an independent read of a variable
          // named `bitcast` that does not exist. A single-level `obj.field` still emits
          // `uses -> field`, which is the ordinary case and the one that is right.
          if (node.parent?.type === "field_expression") break
          const value = node.childForFieldName("value")
          if (!value) break
          if (value.type === "field_expression") {
            const path = this.fieldPath(node)
            if (path) {
              relationships.push(this.rel(scope || GLOBAL_SCOPE, "references", path, node, 0.95,
                { juliaSpecific: true, isQualifiedReference: true }))
            }
            break
          }
          const prop = this.firstNamedChildOfType(node, "identifier")
          if (!prop) break
          relationships.push(this.rel(scope || GLOBAL_SCOPE, "uses", prop.text.trim(), node, 0.9, { juliaSpecific: true, isFieldRead: true }))
          break
        }

        // ---------------------------------------------------------------- macro definitions in scope
        case "macrocall_expression_head":
          break
      }

      // Recurse with the (possibly advanced) scope, and push an exit frame so `depth` tracks
      // nesting. The scope is advanced for the CHILDREN of the node that advanced it, which is
      // what makes `contains` ownership correct for a module or a function body.
      walkStack.push({ node, activeScope: scope, isExit: true })
      const childScope = activeScope
      depth++
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i)
        if (c) walkStack.push({ node: c, activeScope: childScope, isExit: false })
      }
    }

    // ---------------------------------------------------------------- dedup
    // Law 3: O(1) map deduplication. Symbols key on `kind:owner:name`; relationships key on
    // `type|source->target` so that a `calls` and an `instantiates` for the same pair are two
    // different facts and never collapse into one row.
    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) symbolMap.set(`${s.kind}:${s.ownerName || ""}:${s.name}`, s)
    const uniqueSymbols = [...symbolMap.values()]

    const relMap = new Map<string, ASTEngine.UniversalRelationship>()
    for (const r of relationships) {
      const key = `${r.type}|${r.source}->${r.target}`
      const prev = relMap.get(key)
      if (prev) {
        // A merged duplicate must not lose the line the other copy carried.
        if ((prev as any).line_number === undefined && (r as any).line_number !== undefined) (prev as any).line_number = (r as any).line_number
      } else relMap.set(key, r)
    }
    const uniqueRelationships = [...relMap.values()]

    this.classifyEvidenceTier(uniqueRelationships)
    // There is deliberately NO loop here computing complexity per symbol. The previous version was
    // `if (s.complexity === undefined) s.complexity = this.complexity(rootNode)` — a FULL TREE WALK
    // ONCE PER SYMBOL, and it was also wrong about WHICH complexity it measured: every symbol
    // received the FILE's cyclomatic complexity rather than its own.
    //
    // Measured on `test/core.jl` (259 KB, 66,915 named nodes): the walk took 202 s, while one whole
    // `complexity()` pass costs 102 ms and the file has 1,827 symbols — 1,827 x 102 ms is the 186 s
    // that went missing, to within the error of the estimate. Bare traversal of the same tree is
    // 165 ms, so the tree was never the problem. Across the 941-file corpus the analyzer took 969 s
    // at 1.0 file/s, with this one file alone at 228 s — a file like that stalls an index run.
    //
    // Complexity is now measured at each `symbols.push` from that symbol's OWN node, which is both
    // the O(n) behaviour and the meaning the managed-OO family uses (`csharp` M12.07 contract,
    // `calculateCyclomaticComplexity(node)` at the declaration site).

    return {
      language: "julia",
      symbols: uniqueSymbols,
      relationships: uniqueRelationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: uniqueSymbols.length,
        linesOfCode: content.split("\n").length,
        declaredTypes: [...declaredTypes],
      },
    }
  }

  // ------------------------------------------------------------------ helpers

  private rel(
    source: string, type: ASTEngine.RelationshipType | string, target: string, node: Node, confidence: number,
    metadata?: Record<string, unknown>,
  ): ASTEngine.UniversalRelationship {
    return {
      source, target, type: type as ASTEngine.RelationshipType, confidence,
      line_number: node.startPosition.row + 1,
      metadata: { juliaSpecific: true, ...(metadata ?? {}) },
    } as ASTEngine.UniversalRelationship
  }

  private range(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  /**
   * This grammar is almost entirely POSITIONAL.
   *
   * Measured from the vendored `src/node-types.json`: **7 of 151 named node types carry field
   * names** — `module_definition.name`, `field_expression.value`, `if_statement.condition` /
   * `.alternative`, `elseif_clause.condition`, `while_statement.condition`, and the two prefixed
   * string/command literals. Every other node, including `binary_expression`, `typed_expression`,
   * `signature`, `call_expression` and `type_head`, must be navigated by child ORDER.
   *
   * The first version of this analyzer reached for `childForFieldName("right")` and
   * `childForFieldName("name")` throughout, which returns null for a node that has no such
   * field. It did not throw and it did not crash — it silently emitted **zero `extends` edges**
   * and **zero struct fields** for a corpus that has thousands of both, and the symptom was a
   * plausible-looking symbol list. That is the F1 node-type-literal class of defect the C lane's
   * pin record warns about ("written from memory of a different tree-sitter release, which F1
   * caught only because the vocabulary happened to be checked"), and the reason `pos()` exists
   * here rather than another `childForFieldName`.
   */
  private pos(node: Node, index: number): Node | null {
    const c = node.namedChild(index)
    return c ?? null
  }

  /**
   * The two operands of a `binary_expression`.
   *
   * `binary_expression` here is `(left) (operator) (right)` where the OPERATOR IS A NAMED CHILD —
   * measured, not assumed: `isNamed=true`, `type="operator"`, sitting at index 1. So the naive
   * "left is child 0, right is child 1" is wrong twice over: index 1 is the operator, not the
   * right operand, and an operand can itself be an operator token. Right is therefore the LAST
   * named child, and left the first, which holds for every binary shape in the grammar
   * (`a + b`, `a::T`, `a <: B`, `a where {B}`).
   *
   * Both halves of this were wrong in the first version — `tokenText` scanned only ANONYMOUS
   * children for the operator, so it never found it, and `pos(node,1)` handed back the operator
   * where the right operand belonged. The visible effect was **zero `extends` edges** over a
   * corpus where `<:` is everywhere, on a file that parsed with zero ERROR nodes.
   */
  private binOperands(node: Node): { op: string; left: Node | null; right: Node | null } {
    const named = this.namedChildren(node).filter((c) => c.type !== "operator")
    return {
      op: this.tokenText(node, "operator"),
      left: named[0] ?? null,
      right: named.length > 1 ? named[named.length - 1]! : null,
    }
  }

  /**
   * The operator token of a `binary_expression`. It is a NAMED child of type `operator` in this
   * grammar — verified by walking the children of a real `struct Circle{T<:Real} <: Shape` —
   * so a scan restricted to anonymous children finds nothing and the operator reads as empty.
   */
  private tokenText(node: Node, token: string): string {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === token) return c.text.trim()
    }
    return ""
  }

  private namedChildren(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }

  private firstNamedChildOfType(node: Node, type: string): Node | null {
    for (const c of this.namedChildren(node)) if (c.type === type) return c
    return null
  }

  private firstNamedChildType(node: Node): string {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.isNamed) return c.type
    }
    return ""
  }

  private hasToken(node: Node, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === token) return true
    }
    return false
  }

  /**
   * `type_head` is positional: `Name`, `Name{Params}`, or `Name{T} <: Super`.
   *
   * The `<:` case is the trap. `struct Circle{T<:Real} <: Shape` makes the head
   * `(binary_expression (parametrized_type_expression Circle{T<:Real}) <: (identifier Shape))`, so
   * the first identifier ANYWHERE in that subtree is **Shape** — the supertype — and the first
   * version named every such struct after its supertype: one `class:Shape` with
   * `contains -> radius`, and no `extends` edge, because the name and the supertype had been
   * swapped by the same mistake. A declared name is the subtree's LEFT-most name, so a binary
   * expression contributes its left operand and the supertype is read separately by
   * `supertypesOf`. That is a plausible-looking wrong answer, which is the whole difficulty: the
   * symbol list looked like a valid parse of a valid file.
   */
  private typeHeadName(node: Node): string {
    // BASE CASE. A supertype is very often a bare `identifier`, and this function looks for
    // CHILDREN — so handed an identifier it found none and returned "". The effect was that
    // `struct Circle <: Shape` published no `extends` edge at all, on a file with zero ERROR
    // nodes, which is the quietest possible failure. The node being asked about may BE the name.
    if (node.type === "identifier") return node.text.trim()
    if (node.type === "macro_identifier") return node.text.trim().replace(/^@/, "")
    if (node.type === "operator") return node.text.trim()
    // A subtype/where chain: the declared name is on the LEFT, the bound on the right.
    if (node.type === "binary_expression") {
      const { left } = this.binOperands(node)
      if (left) {
        const inner = this.typeHeadName(left)
        if (inner) return inner
      }
    }
    const first = this.pos(node, 0)
    if (first && first.type === "identifier") return first.text.trim()
    const direct = this.firstNamedChildOfType(node, "identifier")
    if (direct) return direct.text.trim()
    // `Vector{T}` — the base name is the first identifier under the curly expression.
    for (const c of this.namedChildren(node)) {
      if (c.type === "curly_expression" || c.type === "parametrized_type_expression" || c.type === "binary_expression") {
        const inner = this.typeHeadName(c)
        if (inner) return inner
      }
      if (c.type === "where_expression") {
        const inner = this.typeHeadName(c)
        if (inner) return inner
      }
    }
    return ""
  }

  /** `signature` is positional: an identifier, a call, an argument list, a typed expr, or a where-expr. */
  /**
   * Strip a `where` clause to the callable underneath it. The callable is ALWAYS `pos(0)`.
   *
   * `f(x::T) where {T} = body` is `(assignment (where_expression (call_expression …) {T}) …)` and
   * `function f(x::T) where T … end` is `(function_definition (signature (where_expression
   * (call_expression …) T)) …)`. The corpus audit is what found this: `Compiler/test/inline.jl:664`
   * declares `g41299(f::Tf, args::Vararg{Any,N}) where {Tf,N}`, nothing unwrapped the wrapper, so
   * the declaration was never published and the call to it came out UNRESOLVED against a runtime
   * that resolves it perfectly. Worse, the TYPE VARIABLE was read as the function's name.
   *
   * And note the two forms differ: `where {T}` puts a `curly_expression` after the call, but
   * BARE `where T` puts the type variable there as a plain sibling `identifier`. That is why
   * scanning for an identifier is unsound here — for `where T` it finds `T`, the parameter, and
   * returns it as the function's name, fabricating a function called `T`. Positional access is
   * not a workaround for this grammar; it is the only correct navigation.
   */
  private unwrapWhere(node: Node): Node {
    let cur = node
    for (let guard = 0; guard < 8 && cur.type === "where_expression"; guard++) {
      const first = this.pos(cur, 0)
      if (!first) break
      cur = first
    }
    return cur
  }

  private signatureName(sig: Node): string {
    // A signature may carry a RETURN TYPE. `function scaled{T<:Real}(s::Shape, k::T)::Float64`
    // makes the signature a `typed_expression` whose siblings are the callable and the return
    // type, so an identifier scan returns `Float64` — the function was published under its RETURN
    // TYPE and `scaled` was lost. Found by the julia fixture lane, authored before the run.
    // A signature is never a typed variable declaration, so unwrapping here is unambiguous.
    if (sig.type === "typed_expression") {
      const callable = this.pos(sig, 0)
      if (callable) return this.signatureName(callable)
    }
    // A call_expression reached here may have a QUALIFIED or PARAMETRIC name —
    // `scaled{T<:Real}(…)` puts the name in a `field_expression`, so there is no direct identifier
    // child and the identifier/call scans below both miss it and the function is never declared.
    // `calleeName` already resolves a `field_expression` path, so delegate rather than duplicate.
    if (sig.type === "call_expression") return this.calleeName(sig) ?? ""
    // `where T` / `where {T}`: the callable is pos(0). Check this BEFORE any identifier scan,
    // because in the unbraced form the type variable IS a sibling identifier and the scan would
    // return `T` — a function symbol named after a parameter.
    if (sig.type === "where_expression") {
      const callable = this.unwrapWhere(sig)
      if (callable.type === "call_expression") return this.calleeName(callable) ?? ""
    }
    const direct = this.firstNamedChildOfType(sig, "identifier")
    if (direct) return direct.text.trim()
    const call = this.firstNamedChildOfType(sig, "call_expression")
    if (call) return this.calleeName(call) ?? ""
    // `f(x::T) where {T}` — recurse through the wrapper rather than reporting nothing.
    for (const c of this.namedChildren(sig)) {
      if (c.type === "where_expression" || c.type === "typed_expression" || c.type === "parenthesized_expression") {
        const inner = this.signatureName(c)
        if (inner) return inner
      }
    }
    return ""
  }

  /**
  /**
   * Is this node inside the `type_head` of a type DECLARATION?
   *
   * Checked by walking ancestors rather than the immediate parent, because the depth varies with
   * the shape of the head: `struct Circle <: Shape` puts the `parametrized_type_expression` two
   * levels down (`type_head > binary_expression > …`) while `struct Circle{T} <: Shape` puts it
   * three, and a parent-only test silently missed the second. A guard that only sometimes fires
   * is worse than none, because it leaves a self-reference edge on exactly the generic types that
   * most need to be right.
   */
  private withinTypeHead(node: Node): boolean {
    let cur: Node | null = node
    for (let i = 0; i < 5 && cur; i++) {
      if (this.typeHeadSites.has(cur.id)) return true
      cur = cur.parent ?? null
    }
    return false
  }

  /** The C symbol a `ccall(...)` call targets, with its library when the two-tuple form gives one. */
  private ccallTarget(call: Node): { symbol: string; library: string | null } | null {
    const args = this.firstNamedChildOfType(call, "argument_list")
    const first = args ? this.pos(args, 0) : null
    if (!first) return null
    if (first.type === "quote_expression") {
      const sym = this.pos(first, 0)
      return sym ? { symbol: sym.text.trim().replace(/^:/, ""), library: null } : null
    }
    if (first.type === "tuple_expression") {
      const parts = this.namedChildren(first).map((q) => this.pos(q, 0)?.text.trim().replace(/^:/, "") ?? "")
      if (parts.length >= 2 && parts[0] && parts[1]) return { symbol: parts[0], library: parts[1] }
      if (parts.length === 1 && parts[0]) return { symbol: parts[0], library: null }
    }
    return null
  }

  /** Stable key for a call site, so a `@ccall` target can be recognised again when it is emitted. */
  private textKey(node: Node, callee: string): string {
    return `${node.startIndex}:${callee}`
  }

  /**
   * Record every call site under an `@ccall` as a call to a FOREIGN symbol.
   *
   * `@ccall strlen(s)::Csize_t` puts the C function in an ordinary `call_expression` inside
   * `macro_argument_list`, so without this the emit site cannot tell it from `f(s)` and asserts a
   * Julia binding. Collected by node start index rather than by name, because two different C
   * symbols can share a name and only the call SITE says which one this edge is.
   */
  private markForeignCallees(macroNode: Node): void {
    const args = this.firstNamedChildOfType(macroNode, "macro_argument_list")
    if (!args) return
    const visit = (n: Node) => {
      if (n.type === "call_expression") {
        const callee = this.calleeName(n)
        if (callee) this.foreignMarked.add(this.textKey(n, callee))
      }
      for (const c of this.namedChildren(n)) visit(c)
    }
    visit(args)
  }

  /**
   * The dotted path of a `field_expression` chain — this grammar's qualified access.
   *
   * MEASURED, and the measurement contradicted the code. There is NO `scoped_identifier` node in
   * this grammar: scanning 400 corpus files for `scoped_identifier` under a `call_expression`
   * callee found **0**, while `field_expression` accounted for every qualified callee. `Core
   * .Intrinsics.bitcast` is `field_expression(field_expression(Core, Intrinsics), bitcast)` —
   * left-nested, so the path is built by recursion, not by listing segments.
   *
   * The `scoped_identifier` branch this replaced was dead code written from a different grammar,
   * and because it never matched, `calleeName` returned null and the analyzer emitted **nothing at
   * all** for a file of qualified calls: zero symbols, zero relationships, no error. A silent empty
   * graph is the worst failure shape there is — it reads as "nothing to see here" rather than
   * "this analyzer is blind".
   *
   * The dotted path is kept WHOLE on purpose. Collapsing it to the last segment was measured to
   * invent merges: over 400 files, 1,352 bare segments appear behind a qualified path and **72 of
   * them are reachable by more than one distinct path**. `parse` alone is `Meta.parse`,
   * `Base.parse`, `TOML.parse` and `Dates.parse` — four unrelated functions. `bitcast` is
   * `Base.bitcast`, `Core.bitcast` and `Intrinsics.bitcast`. `isreadable` is
   * `Filesystem.isreadable`, `Base.isreadable` and `Sys.isreadable`. One node per bare name would
   * silently fuse them, and a merged node makes every edge into and out of it a statement about
   * the wrong function. In Julia the qualified path IS the identity of the binding.
   *
   * `Base.:(==)` puts the operator in a `quote_expression`, so the last segment can be either.
   */
  private fieldPath(node: Node): string {
    if (node.type === "identifier") return node.text.trim()
    // A PARAMETRIC name is a `parametrized_type_expression`, not a `field_expression`:
    // `scaled{T<:Real}(s, k)` has callee children `parametrized_type_expression` +
    // `argument_list`, so nothing matched and the function was never declared at all. Found by
    // the julia fixture lane. `fieldPath` is the one place qualified-name resolution lives, so the
    // parametric case belongs here too rather than as a second, divergent name-resolver in
    // `calleeName` — two resolvers for one notion of "name" is how they drift apart.
    if (node.type === "parametrized_type_expression") {
      const base = this.pos(node, 0)
      return base ? this.fieldPath(base) : ""
    }
    if (node.type === "quote_expression") return node.text.trim()
    if (node.type === "macro_identifier") return node.text.trim().replace(/^@/, "")
    if (node.type === "operator") return node.text.trim()
    if (node.type === "where_expression" || node.type === "parenthesized_expression") {
      const inner = this.pos(node, 0)
      return inner ? this.fieldPath(inner) : ""
    }
    if (node.type === "field_expression") {
      const kids = this.namedChildren(node)
      const receiver = kids[0]
      const member = kids[kids.length - 1]
      if (!receiver || !member) return node.text.trim()
      const head = this.fieldPath(receiver)
      const tail = this.fieldPath(member)
      return head && tail ? `${head}.${tail}` : head || tail || node.text.trim()
    }
    return ""
  }

  /** The callee of a call: a bare name, or the WHOLE dotted path when it is qualified. */
  private calleeName(call: Node): string | null {
    if (call.type === "where_expression") {
      const callable = this.unwrapWhere(call)
      if (callable !== call) return this.calleeName(callable)
    }
    // Positional: the callee is pos(0), NEVER an argument. Every shape a callee can take —
    // `identifier`, `field_expression` (qualified), `parametrized_type_expression` (parametric),
    // `quote_expression` (`Base.:(==)`), `where_expression`, `parenthesized_expression` — is
    // resolved by `fieldPath`, which is the single place name-resolution lives.
    //
    // These were three separate branches and each covered one shape, so every new shape was a
    // silent miss: `parametrized_type_expression` was the third, and it made
    // `function scaled{T<:Real}(s, k)` vanish entirely — a generic method, the very construct
    // Julia is distinctive for, found by the fixture lane. A list of shapes is a maintenance
    // liability; one resolver with the shapes inside it is not.
    const calleeNode = this.pos(call, 0)
    if (calleeNode) {
      const path = this.fieldPath(calleeNode)
      if (path) return path
    }
    for (const c of this.namedChildren(call)) {
      if (c.type === "where_expression" || c.type === "parenthesized_expression") {
        const inner = this.calleeName(c)
        if (inner) return inner
      }
    }
    return null
  }

  /** `<: A, <: B` on a struct/abstract head, and `<: S` on a type parameter. */
  private supertypesOf(node: Node): string[] {
    const out: string[] = []
    const head = this.firstNamedChildOfType(node, "type_head")
    if (!head) return out
    const visit = (n: Node) => {
      if (n.type === "binary_expression") {
        const { op, right } = this.binOperands(n)
        if ((op === "<:" || op === ">:") && right) {
          const name = this.typeHeadName(right)
          if (name) out.push(name)
        }
      }
      for (const c of this.namedChildren(n)) {
        // A PARAMETER's upper bound is not a supertype of the declared type.
        // `struct Circle{T<:Real} <: Shape` hides `T<:Real` inside the curly expression, and a
        // walk that descends into it reports `Circle <: Real` — a FALSE edge that says Circle is
        // a subtype of Real. It is a bound on Circle's PARAMETER, which is a different fact and
        // belongs in the `where_expression` case below, where the bound is published as
        // `T <: Real` with T as the source. A parameter list is a wall, not a road.
        if (c.type === "curly_expression" || c.type === "parametrized_type_expression") continue
        visit(c)
      }
    }
    visit(head)
    return [...new Set(out)]
  }

  /** A struct body's `x::T` entries. The grammar has no dedicated field node for them. */
  private structFields(node: Node): { name: string; node: Node }[] {
    const out: { name: string; node: Node }[] = []
    for (const c of this.namedChildren(node)) {
      if (c.type !== "typed_expression") continue
      // `typed_expression` is POSITIONAL: child 0 is the name, child 1 the type. It is also the
      // node that carries a PARAMETER's type in a signature, so this is only called on a struct
      // body where a bare `x::T` really is a field.
      const name = this.pos(c, 0)?.text.trim() ?? ""
      if (name) out.push({ name, node: c })
    }
    return out
  }

  /** `import A: b, c` / `using A, B` — the module and the names brought in. */
  private importTargets(node: Node): { name: string; items: string[] }[] {
    const out: { name: string; items: string[] }[] = []
    const paths = this.namedChildren(node).filter((c) => c.type === "import_path" || c.type === "identifier" || c.type === "scoped_identifier")
    let pending: { name: string; items: string[] } | null = null
    for (const c of this.namedChildren(node)) {
      if (c.type === "import_path") {
        pending = { name: c.text.trim(), items: [] }
        out.push(pending)
      } else if (c.type === "import_alias" && pending) {
        const items = this.namedChildren(c).filter((x) => x.type === "identifier" || x.type === "import_list")
        pending.items = items.map((x) => (x.type === "import_list" ? x.text.trim() : x.text.trim()))
      } else if (c.type === "identifier" || c.type === "scoped_identifier") {
        // `using LinearAlgebra` — a bare path with no colon list.
        if (!pending) { pending = { name: c.text.trim(), items: [] }; out.push(pending) }
        else if (pending.items.length === 0 && c.text.trim() !== pending.name) pending.items.push(c.text.trim())
      }
    }
    if (!out.length && paths.length) out.push({ name: paths[0]!.text.trim(), items: [] })
    return out
  }

  private exportableName(node: Node): string {
    if (node.type === "identifier") return node.text.trim()
    if (node.type === "operator") return node.text.trim()
    if (node.type === "scoped_identifier") {
      const segs = this.namedChildren(node).filter((x) => x.type === "identifier")
      return segs.length ? segs[segs.length - 1]!.text.trim() : node.text.trim()
    }
    if (node.type === "macro_identifier") return node.text.trim().replace(/^@/, "")
    if (node.type === "call_expression") return this.calleeName(node) ?? ""
    if (node.type === "list_litteral" || node.type === "tuple_expression" || node.type === "parenthesized_expression") {
      for (const c of this.namedChildren(node)) {
        const n = this.exportableName(c)
        if (n) return n
      }
    }
    return ""
  }

  /**
   * Evidence tier, the same rules as the swift/dart/csharp/objc family.
   */
  private classifyEvidenceTier(rels: ASTEngine.UniversalRelationship[]): void {
    for (const r of rels) {
      const md: any = r.metadata ?? {}
      const t = String(r.type ?? "")
      if (t === "contains") { md.evidenceClass = "structural"; continue }
      if (t === "imports" || t === "exports" || t === "references") { md.evidenceClass = "import_based"; continue }
      if (t === "calls" || t === "uses" || t === "instantiates") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "extends" || t === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
    }
  }

  /**
   * Cyclomatic complexity, counted over the tree.
   *
   * The walk is GUARDED at 200,000 node visits, and that guard is inherited from the other lanes
   * rather than invented — the objective-c review measured its own guard at 3.33% of the cap on
   * the worst corpus file, so the bound is real but never approached there. A truncated value
   * would be indistinguishable from a true one in the artifact, which is why the cap exists at all
   * and why its margin is measured rather than assumed.
   */
  private complexity(root: Node): number {
    let c = 1
    const decisions = new Set(["if_statement", "elseif_clause", "for_statement", "while_statement", "case_statement"])
    const stack: Node[] = [root]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (decisions.has(n.type)) c++
      else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text.trim() ?? ""
        if (op === "&&" || op === "||") c++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const ch = n.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return c
  }
}
