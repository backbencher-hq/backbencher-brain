// REAL MAKE ANALYZER — the production AST analyzer for GNU Make files (.mk / .mak / literal `Makefile`).
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS. tree-sitter-make in, UniversalSymbols + UniversalRelationships out, pure AST extraction,
// no regex fallback. It covers six relationship types by name: contains, references, uses, imports, exports
// and calls.
// WHERE ITS CONTRACT LIVES: docs/analyzers/real-make-analyzer.md (the doc is named for the LANGUAGE, not for
// this module — see the lane-name note below); machine-readable classification in
// script/m14/spec/make-completeness.json; fixtures in validation/m14/fixtures/make/; measured records under
// validation/m14/verification/.
// GRAMMAR: tree-sitter-make (wasm/tree-sitter-make.wasm).
// WHY THIS MODULE IS `real-makefile-analyzer.ts` WHILE THE LANE IS `make`: the router's lane definition is
// `make: "mk,mak,makefile"` (script/m14/incoming-gate.ts), and `admitByExtension` matches a bare BASENAME equal
// to an admitted extension for exactly this reason — so a file literally named `Makefile` (no dot, no
// extension) is admitted to this lane. It looks like a bug and is not. The analyzer MODULE keeps the
// `makefile` spelling while the LANE is `make`; script/m14/completeness-inventory.ts derives
// `real-${cfg.id}-analyzer.ts` = `real-make-analyzer.ts` from the lane id, so section G's head-comment check
// reports "analyzer file absent" for this lane — a filename-mapping defect in the gate, not a missing header.
// CO-EDIT WHEN THIS FILE CHANGES: script/m14/spec/make-completeness.json (new node types/kinds must be
// classified), validation/m14/fixtures/make/ (expectation files pin the target spellings), and
// docs/analyzers/real-make-analyzer.md. The router's lane map in script/m14/incoming-gate.ts is Lead-owned:
// propose, never edit it from a lane.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Pure-AST GNU Make analyzer (tree-sitter-make grammar, wasm/tree-sitter-make.wasm).
 *
 * Every symbol and relationship fact below is derived from node types, fields and
 * node positions. There is no source-text regular expression anywhere in this
 * file, and `script/m14/tmp/make/` re-checks that on every run.
 *
 * ## The shape of the language, and why the graph is shaped this way
 *
 * GNU Make has exactly ONE declaration level. A target, a variable, a macro and
 * an include are siblings at file scope; `ifdef`/`ifeq` SELECT between
 * alternatives, they do not nest declarations. So a makefile is not a tree of
 * blocks (as HCL is) but a flat set of declarations joined by references, and
 * the honest graph is:
 *
 *   - ONE module symbol for the file, which `contains` each declaration and
 *     `exports` what the file provides. Make targets are the file's real public
 *     surface — an including makefile invokes them by name — so without a
 *     module node `exports` has no source and "what does this Makefile offer?"
 *     is unanswerable.
 *   - `references` for an edge whose target THIS file declares, and `uses` for
 *     everything else. That split is the whole point: a Make prerequisite is
 *     usually a FILE, and a Make variable is often set by the command line, the
 *     environment, or another makefile. Publishing those as project-internal
 *     references asserts a declaration that does not exist — measured over the
 *     corpus, 464 of 577 unresolved edge ends were exactly that, and
 *     `fixtures/make/out/dangle-adjudication.json` classifies every one.
 *
 * ## Facts this file gets from node positions rather than from text
 *
 *   - An assignment's NAME can arrive with its OPERATOR attached. The grammar's
 *     `word` node for `CGO_ENABLED?=1` spans `CGO_ENABLED?`, while for
 *     `CC:=1` it spans `CC`. Capturing that node verbatim produced 55 symbols
 *     named `CGO_ENABLED?` / `BUILD_TAGS+` and therefore 112 edge ends that
 *     dangled by construction, because every reference names the clean
 *     identifier. The tail is trimmed by character code, never by regex.
 *   - `$(call NAME, args)` names its callee in the `arguments` node's first
 *     comma-separated field, not in a child of its own.
 *   - `$(VAR:.c=.o)` is a `substitution_reference`, a DIFFERENT node type from
 *     `variable_reference`. It was never read, so 11 corpus references were
 *     invisible.
 *   - `export NAME` with no `=` is an `export_directive` over a `list`, with no
 *     assignment node at all — the name is a real export that no other branch
 *     of this walk would ever see.
 *
 * ## The external claims, and why they are metadata rather than edge types
 *
 * The `uses` pool is by design the pool of names NO declaration in this file answers
 * to — a Make prerequisite is usually a FILE and a Make variable is often set by the
 * command line, the environment or another makefile — and the analyzer has always
 * LABELLED that reason (`evidenceClass`: `external`, `builtin`, `automatic`, …).
 * The incoming gate reads none of those spellings: its external channel is a closed
 * list of keys (`script/m14/incoming-rule.ts` `EXTERNAL_KEYS`) plus the claim kinds,
 * and its marker-signature builder drops `evidenceClass` outright. MEASURED over the
 * gate's own 400-of-683 stride draw before this change: `extOK 0 · ext? 0 ·
 * causeOK 0` on 3,936 unresolved edges, i.e. every computed reason was invisible to
 * the only instrument that scores it.
 *
 * So the two claims below are published on the keys that instrument READS. They are
 * additive metadata: no symbol, no edge type, no target, no line and no pre-existing
 * metadata value changes. NEITHER CLAIM CAN RAISE A RESOLUTION — the arbiter reads
 * both only where the target names nothing — so neither can move an edge into a
 * tie-break (`collRes`), which is the one outcome this round forbids.
 */
/**
 * GNU MAKE'S OWN NAME SPACE — the closed list a `languageNamespace` claim certifies.
 *
 * WHAT IT IS: the names GNU Make itself defines, which no makefile declares and no
 * key space can therefore answer. Two halves, both documented:
 *
 *   * the builtin/implicit variables (`BUILTIN_VARIABLES` inside `analyze()` is a
 *     SUBSET of this list, deliberately: the attach test below is membership HERE,
 *     so a name that ever leaves the inner list can only cost this lane a claim it
 *     could have made, never manufacture one the list does not contain), and
 *   * the automatic variables, spelled as this analyzer emits them (`$@`, `$*`, …).
 *     A spelling the grammar TRUNCATED (`$(@)`, `$(@:/`, `$(@:bin/%=%`) is
 *     deliberately absent: covering it would mean writing a malformed member into a
 *     closed list, which is how a "declared namespace" stops being declarable.
 *
 * THE LIST IS THE CLAIM (`incoming-rule.ts` `NAMESPACE_CLAIM_KEY`, property 2): it
 * travels on every edge that carries the claim, so widening it is one reviewable
 * array in one file, and the arbiter checks the target's root against THIS list and
 * never against the symbol table. Property 1 — refutability — holds by construction
 * here: the attach test and the verification are the same membership test, so a
 * claimed edge whose target is NOT in the list cannot be produced by this file.
 */
const GNU_MAKE_NAMESPACE: ReadonlySet<string> = new Set([
  // builtin and implicit variables (the same spellings the analyzer's inner list uses)
  "MAKE", "MAKEFILE_LIST", "MAKEFILES", "MAKEFLAGS", "MAKECMDGOALS", "MAKELEVEL",
  "CURDIR", "SUFFIXES", ".DEFAULT_GOAL", "VPATH", "SHELL", "MFLAGS",
  "CC", "CXX", "CPP", "AR", "ARFLAGS", "AS", "ASFLAGS", "LD", "LDFLAGS", "LDLIBS",
  "RM", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "YFLAGS", "LEX", "YACC", "AWK", "FC",
  "GET", "PC", "TEX", "TEXI2DVI", "WEAVE", "CWEAVE", "CTANGLE",
  // automatic variables, as emitted
  "$@", "$%", "$<", "$?", "$^", "$+", "$*", "$|",
  "$(@D)", "$(@F)", "$(%D)", "$(%F)", "$(<D)", "$(<F)", "$(?D)", "$(?F)",
  "$(^D)", "$(^F)", "$(+D)", "$(+F)", "$(*D)", "$(*F)", "$(|D)", "$(|F)",
])
const GNU_MAKE_NAMESPACE_ROOTS: readonly string[] = [...GNU_MAKE_NAMESPACE]

/**
 * A bare Make identifier — `[A-Za-z_][A-Za-z0-9_]*`, by CHARACTER CODE.
 *
 * Not a regex literal, and that is a lane rule rather than a preference:
 * `script/m12/make-contract-probe.ts` asserts this file carries none, a check that
 * found the pattern `split` that used to end `moduleName()`. The test is also the
 * scope of the claim it guards: a dotted or path-shaped target is looked up through
 * its OWNER by the arbiter, and an owner this population declares REFUTES the claim
 * (measured: 15 such refutations on the unscoped version of this rule), so those
 * targets are left alone rather than claimed.
 */
function isBareMakeName(s: string): boolean {
  if (s.length === 0) return false
  const first = s.charCodeAt(0)
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95)) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}

/**
 * THE CLAIM AN EDGE'S OWN, ALREADY-COMPUTED REASON EARNS — or `{}` when it earns none.
 *
 *   1. the target is in GNU MAKE'S OWN NAME SPACE  -> `languageNamespace`
 *      A `languageNamespace` claim says the target's root is a language namespace
 *      rather than a declaration of this project. It is checked against the list on
 *      the edge and NEVER against the symbol table, which is what makes it the right
 *      claim for `MAKE`, `CC`, `CURDIR` and `$@`: a project that declares `CC = gcc`
 *      does not make `CC` cease to be a GNU Make implicit variable.
 *   2. the edge's reason is `external` and the target is a bare identifier -> `isExternal`
 *      The gate reads `isExternal` as an `owner` claim: it looks the name up in the
 *      PROJECT's own key space and REFUTES a claim the project answers. Where the
 *      target is a bare identifier the claim is exactly "no declaration in this
 *      population answers this name" — the same statement the analyzer already made
 *      as `evidenceClass: "external"`, and the arbiter now verifies it instead of
 *      trusting it.
 *
 * EVERYTHING ELSE IS LEFT UNCLAIMED, and the omissions are decisions, not gaps:
 *   * `external_prerequisite` — its target names a FILE, and the only claim kind that
 *     can verify a file (`importProjectFile`) is checked against the lane's ADMITTED
 *     file list, which for this lane holds make files only. Attaching it would refute
 *     every build product and every source file. Measured, not feared: see
 *     `validation/m14/verification/MAKE-FIX.md` §3.
 *   * `local_binding` — `$(foreach mod,…)`'s binder IS bound here. "Not published"
 *     would be true and "external" would be false, and the second is what the claim says.
 *   * `include_literal` — a computed include published as the variable it expands; the
 *     missing fact is the PATH, which no symbol lookup can supply.
 *   * every `references`/`contains`/`exports` edge — a `references` edge means THIS
 *     file declares the name, which is the one case both claims would be false.
 */
function makeExternalClaim(
  kind: ASTEngine.RelationshipType,
  target: string,
  evidenceClass: string,
): Record<string, unknown> {
  if (kind !== ASTEngine.RelationshipType.Uses) return {}
  if (GNU_MAKE_NAMESPACE.has(target)) return { languageNamespace: GNU_MAKE_NAMESPACE_ROOTS }
  if (evidenceClass === "external" && isBareMakeName(target)) return { isExternal: true }
  return {}
}
export class RealMakefileAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const patterns: string[] = []

    const moduleName = this.moduleName(filePath)

    // ---- identity -------------------------------------------------------
    // Symbols are deduped by (name, kind) as before, but a re-declared name is
    // MERGED rather than dropped: Make legitimately assigns one variable in
    // several conditional branches, and the last assignment's operator and value
    // are recorded on the one symbol instead of forking its identity.
    const byKey = new Map<string, ASTEngine.UniversalSymbol>()
    // Relationships are deduped per (source, type, target, line) so two
    // references on DIFFERENT lines both survive — a target that reads $(CC) on
    // three lines is three facts, and collapsing them loses the address surface.
    const relSeen = new Set<string>()

    const declared = new Set<string>()          // every name this file declares
    // `$(foreach VAR,list,body)` introduces a LOCAL name. A reference to it
    // resolves to nothing in project scope — consul/Makefile has six
    // `$(mod)` references that are all this one binder — so calling it an
    // external variable is a category error. The binder is recorded and those
    // edges are labelled for what they are.
    const localBinders = new Set<string>()
    const declaredTargets = new Set<string>()   // names that are buildable targets
    const valuesByName = new Map<string, string>()
    const edgeCount: Record<string, number> = { references: 0, uses: 0, calls: 0, contains: 0, exports: 0, imports: 0 }
    let conditionals = 0

    const declareSymbol = (
      name: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      metadata: Record<string, unknown>,
    ): ASTEngine.UniversalSymbol | null => {
      if (!name) return null
      declared.add(name)
      const key = `${name}\u0000${kind}`
      const existing = byKey.get(key)
      if (existing) {
        // Merge: keep the first declaration's identity, adopt the later value so
        // `?=` then `=` in two branches does not read as a contradiction.
        const m = existing.metadata as Record<string, unknown>
        if (metadata.value !== undefined) m.value = metadata.value
        if (metadata.operator !== undefined) m.operator = metadata.operator
        if (metadata.redeclared) m.redeclared = true
        return existing
      }
      const sym: ASTEngine.UniversalSymbol = {
        name,
        kind,
        range: this.nodeToRange(node),
        visibility: "global",
        metadata,
      }
      byKey.set(key, sym)
      symbols.push(sym)
      return sym
    }

    const addRel = (
      source: string,
      type: ASTEngine.RelationshipType,
      target: string,
      line: number,
      metadata?: Record<string, unknown>,
    ) => {
      if (!source || !target || source === target) return
      const key = `${source}\u0000${type}\u0000${target}\u0000${line}`
      if (relSeen.has(key)) return
      relSeen.add(key)
      edgeCount[type] = (edgeCount[type] ?? 0) + 1
      // `line_number` is a PRODUCT field: the indexer stores it and the address
      // surfaces (src/intelligence/graph/line-address.ts) serve call-site
      // positions from it. An edge without one cannot be navigated TO, which is
      // why this is set on every edge rather than only the interesting ones.
      relationships.push({
        source, target, type, confidence: 1.0,
        metadata: metadata ?? {},
        line_number: line,
        line: line,
      } as ASTEngine.UniversalRelationship)
    }

    // ---- the module node ------------------------------------------------
    // One per file. It owns `contains` for every declaration and `exports` for
    // every target, and it is the SOURCE of every include edge, so two
    // makefiles that include the same file are distinguishable in the graph
    // instead of collapsing onto one hardcoded "makefile" node.
    const moduleSymbol = declareSymbol(moduleName, ASTEngine.SymbolKind.Module, rootNode, {
      nodeType: "makefile",
      isMakeModule: true,
      filePath,
    })
    const module = moduleName

    // ---- reference classification ---------------------------------------
    // Resolved AFTER the walk, because whether an edge is `references` or
    // `uses` depends on what the WHOLE file declares, not on what was seen so
    // far. Edges are staged with their intended kind and re-labelled here.
    const staged: { source: string; target: string; line: number; intent: "ref" | "call"; role: string; node: Node }[] = []

    const BUILTIN_VARIABLES = new Set([
      "MAKE", "MAKEFILE_LIST", "MAKEFILES", "MAKEFLAGS", "MAKECMDGOALS", "MAKELEVEL",
      "CURDIR", "SUFFIXES", ".DEFAULT_GOAL", "VPATH", "SHELL", "MFLAGS",
      "CC", "CXX", "CPP", "AR", "ARFLAGS", "AS", "ASFLAGS", "LD", "LDFLAGS", "LDLIBS",
      "RM", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "YFLAGS", "LEX", "YACC", "AWK", "FC",
      "GET", "PC", "TEX", "TEXI2DVI", "WEAVE", "CWEAVE", "CTANGLE",
    ])
    const BUILTIN_FUNCTIONS = new Set([
      "subst", "patsubst", "strip", "findstring", "filter", "filter-out", "sort",
      "word", "wordlist", "words", "firstword", "lastword", "dir", "notdir",
      "suffix", "basename", "addsuffix", "addprefix", "join", "wildcard",
      "realpath", "abspath", "if", "or", "and", "foreach", "file", "call",
      "value", "eval", "origin", "flavor", "shell", "error", "warning", "info",
    ])
    // Keywords the grammar hands back inside `word`/`list` nodes. Capturing one
    // as a name put `export` at the end of six edges in boundary/Makefile.
    const KEYWORDS = new Set([
      "export", "unexport", "override", "private", "define", "endef", "include",
      "-include", "sinclude", "vpath", "undefine", "ifeq", "ifneq", "ifdef",
      "ifndef", "else", "endif", "silent", "quiet",
    ])

    // ---- the walk -------------------------------------------------------
    // Explicit stack, no recursion: `$(foreach … $(eval $(call …)))` nests, and
    // a deeply nested expansion must not be able to blow the JS stack. Each
    // frame carries the OWNER the references beneath it belong to, which is how
    // a reference inside a rule that the grammar swallowed into another rule's
    // recipe is still attributed to its own rule rather than the outer one.
    type Frame = { node: Node; owner: string }
    const stack: Frame[] = [{ node: rootNode, owner: module }]

    /** Strip a trailing assignment operator from a captured name. */
    const trimOperator = (raw: string): string => {
      let end = raw.length
      while (end > 0) {
        const c = raw.charCodeAt(end - 1)
        // ? + = !  and the `:` of `:=` / `::=`
        if (c === 63 || c === 43 || c === 61 || c === 33 || c === 58) end--
        else break
      }
      return raw.slice(0, end).trim()
    }

    /**
     * `$(NAME)` or `${NAME}` -> NAME when NAME is a plain identifier; otherwise
     * the expression text.
     *
     * BOTH spellings matter. `${VAR}` is GNU Make's second expansion form and it
     * is common — 68 occurrences across 14 of the 99 corpus files — but handling
     * only `$(` left every one of those prerequisites carrying their raw wrapper
     * (`uses docker-build -> ${docker-buildxs}`) while the variable they name was
     * declared three lines earlier. The same fact was then published twice under
     * two spellings, and the wrapper form dangled.
     */
    const normaliseExpression = (raw: string): { name: string; isExpression: boolean } => {
      const t = raw.trim()
      const braced = t.length > 3 && t.startsWith("$(") && t.endsWith(")")
      const curly = t.length > 3 && t.startsWith("${") && t.endsWith("}")
      if (braced || curly) {
        const inner = t.slice(2, -1).trim()
        if (inner.length > 0 && this.isPlainIdentifier(inner)) return { name: inner, isExpression: false }
        return { name: inner, isExpression: true }
      }
      return { name: t, isExpression: false }
    }

    /** The word child of an assignment-ish node, operator trimmed. */
    const declaredName = (node: Node): string => {
      const w = this.firstChildOfType(node, new Set(["word"]))
      if (!w) return ""
      const raw = w.text.trim()
      if (!raw) return ""
      const trimmed = trimOperator(raw)
      if (!trimmed || KEYWORDS.has(trimmed)) return ""
      return trimmed
    }

    const markExported = (name: string, node: Node, via: string) => {
      if (!name) return
      const existing = symbols.find((s) => s.name === name)
      if (existing) (existing.metadata as Record<string, unknown>).isExported = true
      exports.push({
        name,
        kind: existing?.kind ?? ASTEngine.SymbolKind.Constant,
        range: this.nodeToRange(node),
        metadata: { via },
      })
      addRel(module, ASTEngine.RelationshipType.Exports, name, node.startPosition.row + 1, { via, evidenceClass: "export_directive" })
    }

    /**
     * Directive flags that must be applied AFTER the walk, because the
     * declaration they annotate does not exist yet when the directive is read.
     *
     * `private VAR = v` and `override VAR := v` carry the keyword and the
     * assignment on one line, and the walker reaches the directive first. Every
     * other flag in this analyzer is set at the point of declaration; these
     * cannot be, and setting them at the point of the directive silently dropped
     * them in the spelling people actually write.
     */
    const deferred: { name: string; key: string; line: number }[] = []
    /** Every declaration line of a variable name, for the `overrides` block after the walk. */
    const declaredAtLines = new Map<string, number[]>()
    /** Every `override VAR = v` site, with the line the directive sits on. */
    const overrideSites: { name: string; line: number }[] = []

    while (stack.length > 0) {
      const frame = stack.pop()!
      const node = frame.node
      const owner = frame.owner
      const type = node.type
      const line = node.startPosition.row + 1
      let childOwner = owner

      switch (type) {
        // ---- variables --------------------------------------------------
        case "variable_assignment":
        case "shell_assignment": {
          const name = declaredName(node)
          if (name) {
            const valueNode = this.firstChildOfType(node, new Set(["text", "shell_command"]))
            const value = valueNode?.text?.trim() ?? ""
            if (!valuesByName.has(name)) valuesByName.set(name, value)
            declareSymbol(name, ASTEngine.SymbolKind.Constant, node, {
              nodeType: type,
              isMakeVariable: true,
              operator: this.assignmentOperator(node),
              value: value || undefined,
            })
            patterns.push("Make variables")
            addRel(module, ASTEngine.RelationshipType.Contains, name, line, { role: "declaration", evidenceClass: "declared_in_file" })
            // EVERY declaration line of this name, because `override VAR = v` is a
            // REDEFINITION only when the file (or the project) already holds a base — see the
            // `overrides` block after the walk, which is the only consumer.
            declaredAtLines.set(name, [...(declaredAtLines.get(name) ?? []), line])
            childOwner = name
          }
          break
        }

        // A macro is a FUNCTION, not a constant: `$(call NAME)` is a call, and a
        // call that resolves to a Constant is a callee that cannot be called.
        case "define_directive": {
          const name = declaredName(node)
          if (name) {
            const body = this.firstChildOfType(node, new Set(["raw_text"]))
            if (!valuesByName.has(name)) valuesByName.set(name, body?.text ?? "")
            declareSymbol(name, ASTEngine.SymbolKind.Function, node, {
              nodeType: type,
              isMakeMacro: true,
              operator: "define",
              value: body?.text?.trim() || undefined,
            })
            patterns.push("Make macros")
            addRel(module, ASTEngine.RelationshipType.Contains, name, line, { role: "declaration", evidenceClass: "declared_in_file" })
            childOwner = name
          }
          break
        }

        // ---- rules ------------------------------------------------------
        case "rule": {
          const targetsNode = this.firstChildOfType(node, new Set(["targets"]))
          const literalTargets: string[] = []
          if (targetsNode) {
            for (let i = 0; i < targetsNode.namedChildCount; i++) {
              const child = targetsNode.namedChild(i)
              if (!child) continue
              const raw = child.text.trim()
              if (!raw) continue
              if (child.type === "word") {
                if (KEYWORDS.has(raw)) continue
                // `.PHONY` and friends are meta-targets, not buildable output.
                if (raw.startsWith(".")) continue
                literalTargets.push(raw)
                declaredTargets.add(raw)
                declareSymbol(raw, ASTEngine.SymbolKind.Function, node, {
                  nodeType: "rule",
                  isMakeTarget: true,
                  targetName: raw,
                })
                addRel(module, ASTEngine.RelationshipType.Contains, raw, line, { role: "declaration", evidenceClass: "declared_in_file" })
                patterns.push("Make rules")
              } else {
                // A computed target (`$(UI_TARGETS):`) declares nothing; the
                // expansion is a reference, and making a Function symbol out of
                // the literal text `$(UI_TARGETS)` would invent a buildable.
                this.collectFrom(
                  child,
                  (refName, intent, refLine) => {
                    // Normalise exactly as a prerequisite is normalised, so a
                    // computed target names the VARIABLE it expands rather than
                    // the wrapper text. Without this the same fact is published
                    // twice under two spellings — `${docker-buildxs}` as a `uses`
                    // edge and `docker-buildxs` as a `references` edge — and the
                    // first of those dangles.
                    const { name: norm } = normaliseExpression(refName)
                    staged.push({ source: module, target: norm || refName, line: refLine, intent, role: "computed_target", node: child })
                  },
                  (binder) => localBinders.add(binder),
                )
              }
            }
          }
          // Prerequisites. The grammar emits one `prerequisites` node per
          // `|`-separated group, so an order-only list is a second node and
          // must be collected too — 172 order-only prerequisites in this corpus
          // are invisible if only the first group is read.
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child?.type !== "prerequisites") continue
            for (let j = 0; j < child.namedChildCount; j++) {
              const prereq = child.namedChild(j)
              if (!prereq) continue
              const raw = prereq.text.trim()
              if (!raw) continue
              const { name } = normaliseExpression(raw)
              if (!name || KEYWORDS.has(name)) continue
              // A rule whose target is an EXPRESSION declares no literal name, so
              // there is no target to hang the dependency on — and the pre-fix
              // code iterated `literalTargets`, which is EMPTY for
              // `$(BIN): $(OBJS) | builddir`, so such a rule published NO
              // prerequisite edges at all. Found by the M12 contract probe, which
              // had never been run for this lane. The module is the best owner
              // available: the dependency is real information and dropping it
              // loses it, while attributing it to the file that declares the rule
              // is not a claim the tree contradicts.
              for (const t of (literalTargets.length ? literalTargets : [module])) {
                staged.push({ source: t, target: name, line: prereq.startPosition.row + 1, intent: "ref", role: "prerequisite", node: prereq })
              }
            }
          }
          if (literalTargets.length > 0) childOwner = literalTargets[0]
          break
        }

        // ---- includes ---------------------------------------------------
        case "include_directive": {
          const isOptional = node.text.trim().startsWith("-") || node.text.trim().startsWith("s")
          const listNode = this.firstChildOfType(node, new Set(["list"]))
          if (listNode) {
            for (let i = 0; i < listNode.namedChildCount; i++) {
              const child = listNode.namedChild(i)
              if (!child) continue
              // A literal include path is a `word`, which is not a reference
              // node — reading only references here silently dropped every
              // `include hooks` and left the import list empty.
              if (child.type === "word") {
                const lit = child.text.trim()
                if (lit && !KEYWORDS.has(lit)) {
                  const litLine = child.startPosition.row + 1
                  imports.push({ module: lit, items: [], importType: "make_include", lineNumber: litLine, line: litLine, range: this.nodeToRange(node), isExternal: false, isOptional })
                  addRel(module, ASTEngine.RelationshipType.Imports, lit, litLine, { isMakeInclude: true, isOptional })
                }
                continue
              }
              // `shell_function` is what `include $(shell …)` actually produces —
              // checked by measurement, not by guessing at the node type.
              if (child.type === "function_call" || child.type === "variable_reference" || child.type === "shell_function") {
                // computed: `include $(shell …)` / `include $(RULES)`. The name is
                // not knowable at parse time, so the EXPRESSION is recorded and
                // flagged — an unresolved import is a fact, a dropped one is not.
                const expr = child.text.trim()
                const eLine = child.startPosition.row + 1
                if (expr) {
                  imports.push({ module: expr, items: [], importType: "make_include", lineNumber: eLine, line: eLine, range: this.nodeToRange(node), isExternal: false, isOptional, isComputed: true })
                  addRel(module, ASTEngine.RelationshipType.Imports, expr, eLine, { isMakeInclude: true, isOptional, isComputed: true, evidenceClass: "include_computed" })
                }
                continue
              }
              this.collectFrom(child, (refName, _intent, refLine) => {
                const mod = refName.trim()
                if (!mod || KEYWORDS.has(mod)) return
                imports.push({
                  module: mod,
                  items: [],
                  importType: "make_include",
                  lineNumber: refLine,
                  line: refLine,
                  range: this.nodeToRange(node),
                  isExternal: false,
                  isOptional,
                })
                // The SOURCE is this file's module node, not a hardcoded
                // "makefile": with a constant source every makefile that
                // includes `hooks` produced the same edge and two files could
                // not be told apart in the graph.
                addRel(module, ASTEngine.RelationshipType.Imports, mod, refLine, { isMakeInclude: true, isOptional, evidenceClass: "include_literal" })
              })
            }
          } else {
            // A computed include (`include $(shell curl …)`) names no file this
            // parse can know. Dropping it would make the include invisible, so
            // the expression is recorded and flagged: an unresolved import is a
            // fact, a silently absent one is not.
            this.collectFrom(node, () => {})
            const expr = (listNode ? "" : node.text.trim())
            if (expr) {
              const eLine = node.startPosition.row + 1
              imports.push({ module: expr, items: [], importType: "make_include", lineNumber: eLine, line: eLine, range: this.nodeToRange(node), isExternal: false, isOptional, isComputed: true })
              addRel(module, ASTEngine.RelationshipType.Imports, expr, eLine, { isMakeInclude: true, isOptional, isComputed: true })
            }
            this.collectFrom(node, (refName, _intent, refLine) => {
              const mod = refName.trim()
              if (!mod || KEYWORDS.has(mod)) return
              imports.push({ module: mod, items: [], importType: "make_include", lineNumber: refLine, line: refLine, range: this.nodeToRange(node), isExternal: false, isOptional })
              addRel(module, ASTEngine.RelationshipType.Imports, mod, refLine, { isMakeInclude: true, isOptional })
            })
          }
          patterns.push("Make includes")
          break
        }

        // ---- export -----------------------------------------------------
        // `export FOO = 1` wraps an assignment (the generic walk already reaches
        // it); `export FOO` wraps a `list` and is the ONLY place that name
        // appears, so without this branch the export is invisible entirely.
        case "export_directive": {
          const listNode = this.firstChildOfType(node, new Set(["list"]))
          if (listNode) {
            for (let i = 0; i < listNode.namedChildCount; i++) {
              const w = listNode.namedChild(i)
              if (!w) continue
              const name = trimOperator(w.text.trim())
              if (!name || KEYWORDS.has(name)) continue
              if (!declared.has(name)) {
                declareSymbol(name, ASTEngine.SymbolKind.Constant, w, { nodeType: "export_directive", isMakeVariable: true, declaredBy: "export" })
                patterns.push("Make variables")
                addRel(module, ASTEngine.RelationshipType.Contains, name, w.startPosition.row + 1, { role: "declaration", evidenceClass: "declared_in_file" })
              }
              markExported(name, w, "export_directive")
            }
          } else {
            const inner = this.firstChildOfType(node, new Set(["variable_assignment", "shell_assignment"]))
            const name = inner ? declaredName(inner) : ""
            if (name) markExported(name, node, "export_directive")
          }
          break
        }
        case "unexport_directive": {
          const listNode = this.firstChildOfType(node, new Set(["list"]))
          for (let i = 0; listNode && i < listNode.namedChildCount; i++) {
            const w = listNode.namedChild(i)
            if (!w) continue
            const name = trimOperator(w.text.trim())
            if (!name) continue
            const s = symbols.find((x) => x.name === name)
            if (s) (s.metadata as Record<string, unknown>).isExported = false
            // Clearing only the metadata flag left the graph contradicting itself:
            // the symbol said `isExported: false` while an `exports` edge still
            // said the file exports it. An unexport must retract the EDGE, not
            // just the flag, or a consumer reading relationships gets the opposite
            // answer from a consumer reading symbols.
            for (let k = exports.length - 1; k >= 0; k--) {
              if (exports[k]!.name === name) exports.splice(k, 1)
            }
            for (let k = relationships.length - 1; k >= 0; k--) {
              const r = relationships[k]!
              if (r.type === ASTEngine.RelationshipType.Exports && r.target === name) {
                relationships.splice(k, 1)
                edgeCount[ASTEngine.RelationshipType.Exports] =
                  (edgeCount[ASTEngine.RelationshipType.Exports] ?? 1) - 1
                relSeen.delete(`${r.source}\u0000${r.type}\u0000${r.target}\u0000${r.line_number}`)
              }
            }
          }
          break
        }
        case "vpath_directive": {
          patterns.push("Make vpath")
          break
        }

        // MAKE-G1, closed. `VPATH = src:include` is the ASSIGNMENT spelling of the
        // search path; the sibling `vpath %.c src` DIRECTIVE has been recorded all
        // along, so the two spellings of one feature were deliberately asymmetric
        // pending corpus evidence, and the corpus had none (0 occurrences in the
        // 100 pinned files).
        //
        // What was actually lost is not a "coverage" gap in the abstract: because
        // `VPATH` was never declared, a reference to it fell to `uses` — the class
        // this lane reserves for names nothing can declare — even though THIS file
        // is the thing that declares it. `exports := $(VPATH)` in a file that sets
        // `VPATH = src` was published as a read of something undeclared.
        //
        // So it is declared, as a `constant`: `VPATH` is a GNU Make builtin whose
        // value a makefile may set, exactly like `CURDIR` or `MAKEFILE_LIST`, and
        // recording it as an ordinary assignment is what makes the reference to it
        // a `references` edge. The search directories are kept in metadata as a
        // list, because the value text is colon-separated and a consumer asking
        // "where does this makefile look for `foo.o`?" wants the list, not the
        // string it was written as.
        case "VPATH_assignment": {
          const pathsNode = this.firstChildOfType(node, new Set(["paths"]))
          const dirs: string[] = []
          if (pathsNode) {
            for (let i = 0; i < pathsNode.namedChildCount; i++) {
              const w = pathsNode.namedChild(i)
              if (w?.type === "word") {
                const d = w.text.trim()
                if (d) dirs.push(d)
              }
            }
          }
          const value = dirs.join(":")
          if (!declared.has("VPATH")) {
            declareSymbol("VPATH", ASTEngine.SymbolKind.Constant, node, {
              nodeType: "VPATH_assignment",
              isMakeVariable: true,
              isMakeSearchPath: true,
              operator: this.assignmentOperator(node),
              value: value || undefined,
              searchPaths: dirs.length ? dirs : undefined,
            })
            patterns.push("Make vpath")
            addRel(module, ASTEngine.RelationshipType.Contains, "VPATH", node.startPosition.row + 1, {
              role: "declaration",
              evidenceClass: "declared_in_file",
            })
          }
          break
        }

        // ---- control flow ------------------------------------------------
        case "conditional":
        case "ifeq_directive":
        case "ifneq_directive":
        case "ifdef_directive":
        case "ifndef_directive":
        case "else_directive":
        case "elsif_directive": {
          // `endif_directive` was a case here until
          // `script/m12/make-node-types-compare.ts` flagged it: the grammar does
          // NOT declare that node type, so the branch could never run. A branch
          // for a type that cannot exist reads as coverage and is not, which is
          // the precise thing that gate exists to catch. `endif` is not a node at
          // all in tree-sitter-make 1.1.1 — the conditional simply ends.
          conditionals++
          break
        }
        case "override_directive":
        case "private_directive":
        case "undefine_directive": {
          // `private VAR = v` and `override VAR := v` put the keyword and the
          // assignment on ONE line, and the walker reaches this directive BEFORE
          // the `variable_assignment` nested inside it. Looking the symbol up
          // here therefore found nothing, and the flag was dropped in exactly the
          // spelling people actually write — the two-line form
          // (`VAR = v` then `private VAR = w`) worked, which is why nothing
          // caught it. The flag is now DEFERRED and applied after the walk, by
          // which time the nested declaration has run.
          //
          // `undefine` needed a different fix as well: its operand is not a
          // `variable_assignment` at all. `undefine VAR` parses as
          // `undefine_directive` with a `variable` FIELD holding a bare word and
          // no named children, so searching for a nested assignment could never
          // find one and the branch was a phantom — the same failure mode as the
          // dead `endif_directive` branch, reachable only because nothing
          // exercised it.
          let name = ""
          if (type === "undefine_directive") {
            const operand = node.childForFieldName("variable")
            name = operand ? trimOperator(operand.text.trim()) : ""
          } else {
            const inner = this.firstChildOfType(node, new Set(["variable_assignment", "shell_assignment"]))
            name = inner ? declaredName(inner) : ""
          }
          if (name) {
            // The key is named per directive rather than interpolated as
            // `is${type.replace("_directive","")}`, which produced `isprivate` /
            // `isoverride` / `isundefine` — snake-ish keys in a file where every
            // other metadata flag is camelCase (`isMakeVariable`, `isExported`,
            // `isBuiltin`), and which did not match the names the completeness
            // spec claimed the analyzer wrote.
            const key = type === "private_directive" ? "isPrivate"
              : type === "override_directive" ? "isOverride"
              : "isUndefine"
            deferred.push({ name, key, line: node.startPosition.row + 1 })
            // `override VAR = v` — recorded as a SITE, not yet as an edge: whether it is a
            // redefinition depends on a base declaration the walk has not finished collecting.
            if (type === "override_directive") overrideSites.push({ name, line: node.startPosition.row + 1 })
            const s = symbols.find((x) => x.name === name)
            if (s) (s.metadata as Record<string, unknown>)[key] = true
          }
          childOwner = name || owner
          break
        }

        // ---- references --------------------------------------------------
        // Handled wherever they appear, not only beneath an assignment or a
        // rule. A bare top-level `$(foreach t,… $(eval $(call mk,$(t))))` — the
        // idiom nomad/GNUmakefile uses to reify its package targets — is a
        // `function_call` directly under `makefile`, and because the old walk
        // only asked for references from two branches, that line contributed
        // nothing at all.
        case "variable_reference":
        case "substitution_reference":
        case "automatic_variable":
        case "function_call": {
          const parentType = this.parentType(node)
          // A reference that IS a prerequisite or a target was already recorded
          // as a dependency edge; recording it again as a use would double-count
          // the same fact.
          if (parentType !== "prerequisites" && parentType !== "targets") {
            this.collectFrom(
              node,
              (refName, intent, refLine) => {
                staged.push({ source: owner, target: refName, line: refLine, intent, role: type, node })
              },
              (binder) => localBinders.add(binder),
            )
          }
          break
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: childOwner })
        }
      }

      // ---- apply the deferred directive flags -----------------------------
      // By now every declaration in the file exists, including the one nested
      // inside the `private` / `override` directive that triggered the flag.
      // Applied by name, and a name that was never declared is recorded rather
      // than ignored: `private` on an undeclared variable is a Makefile that
      // means something (`make private FOO=1` on the command line), and silently
      // dropping the annotation is what made this invisible in the first place.
      for (const d of deferred) {
        const s = symbols.find((x) => x.name === d.name)
        if (s) (s.metadata as Record<string, unknown>)[d.key] = true
      }

      // ---- `overrides`: the ONE construct among the four silent kinds that exists ----------
      //
      // The lane's ruling said `overrides` is "deliberately NOT emitted, because what an
      // `override` overrides is a command-line or environment binding, which is not a symbol in
      // the graph, so the edge would dangle by construction". RE-MEASURED over the whole
      // ROUTER-admitted population (697 make files across 65 repos — every path
      // `detectLanguageFromPath` sends to `make`, NOT the 129 `.mk`-shaped files the incoming
      // gate can admit): 5 `override_directive` SITES in 4 files, of which 3 sites in 2 files
      // carry a base declaration in the same file and are emitted, and 2 do not:
      //
      //   otp/make/target.mk:48  override TARGET := $(OVERRIDE_TARGET)   TARGET declared at line 29   EDGE
      //   otp/make/target.mk:60  override TARGET := $(shell … config.sub …)   same base               EDGE
      //   redis/deps/xxhash/Makefile:66  override DISPATCH := 0          DISPATCH declared at 61      EDGE
      //   boundary/Makefile:91   override LINT_DIFF_BRANCH = main        the only declaration — base is the command line   refused
      //   tree-sitter-clean/Makefile:24  override CFLAGS += …            the only declaration — base is the environment    refused
      //
      // (`validation/m14/fixtures/make/tools/construct-census.mts` -> `construct-census.current.json`,
      // run `bun`; the earlier version of this comment cited `mk-override-probe.mts` and
      // `…-base.mts`, NEITHER OF WHICH WAS EVER COMMITTED — a citation to a missing file reads like
      // evidence and was itself the defect.) So the edge is emitted where the base IS a declaration
      // this file holds, and NOT where it is not — which is the same distinction the json lane
      // ruled on for a re-declared key ("a parser that keeps the last one has performed a
      // redefinition", 21 named duplicates across 11 files), and it keeps the lane's own reason
      // intact for the two sites it was true of.
      // BOTH lines ride the edge, so a reader can see which binding is replaced and where.
      for (const site of overrideSites) {
        const base = (declaredAtLines.get(site.name) ?? []).filter((l) => l !== site.line)
        if (base.length === 0) continue
        addRel(module, ASTEngine.RelationshipType.Overrides, site.name, site.line, {
          role: "redefinition",
          via: "override_directive",
          overrideLine: site.line,
          baseLine: Math.min(...base),
          evidenceClass: "redefinition",
        })
      }


    // ---- classify every staged edge -------------------------------------
    // `references` iff THIS file declares the target. That is the whole
    // distinction: a Make prerequisite is usually a file and a Make variable is
    // often external, and calling either of them a project-internal reference
    // asserts a declaration that does not exist.
    for (const e of staged) {
      if (!e.target) continue
      const isBuiltinVar = BUILTIN_VARIABLES.has(e.target)
      let kind: ASTEngine.RelationshipType
      let label: string
      if (e.intent === "call") {
        kind = ASTEngine.RelationshipType.Calls
        label = "call"
      } else if (declared.has(e.target)) {
        kind = ASTEngine.RelationshipType.References
        label = "reference"
      } else {
        kind = ASTEngine.RelationshipType.Uses
        // `$$X` is Make's ESCAPED dollar — the shell's variable, not a Make
        // automatic one. The edge is real information, but calling it a Make
        // builtin would be a category error, so it is labelled for what it is.
        label = e.target.startsWith("$$") ? "shell_variable"
          : e.role === "automatic_variable" ? "automatic"
          : localBinders.has(e.target) ? "local_binding"
          : isBuiltinVar ? "builtin"
          : e.role === "prerequisite" ? "external_prerequisite"
          : "external"
      }
      // `evidenceClass` is the field the product's fixture convention reads to
      // prove an edge's evidence TIER is pinned (completeness section D), and
      // these values are genuinely different strengths of evidence rather than
      // restatements of the label: a declaration this file makes is STRONGEST,
      // a builtin is a named fact about the language, and a file path or an
      // external variable is an INFERENCE that the name is not declared here.
      //
      // AND THE TIER IS NOW PUBLISHED WHERE THE ARBITER READS IT — see
      // `makeExternalClaim`: the same reason, on the claim keys the incoming gate's
      // closed channel accepts. Additive: `role`, `evidenceClass` and `isBuiltin`
      // are byte-identical to what this lane published before, and the spread adds
      // a key only where the reason above was already computed.
      addRel(e.source, kind, e.target, e.line, {
        role: e.role,
        evidenceClass: label,
        isBuiltin: isBuiltinVar,
        ...makeExternalClaim(kind, e.target, label),
      })
    }

    // ---- exports: every buildable target is public -----------------------
    // An including makefile invokes a target by name, so a target IS an export.
    // Without this the file's public surface is invisible and `exports` has
    // exactly one source (an `export VAR` line), which is not what Make means.
    for (const t of declaredTargets) {
      if (symbols.some((s) => s.name === t && (s.metadata as any)?.isExported === true)) continue
      const sym = symbols.find((s) => s.name === t)
      exports.push({ name: t, kind: ASTEngine.SymbolKind.Function, range: sym?.range, metadata: { via: "target" } })
      addRel(module, ASTEngine.RelationshipType.Exports, t, sym?.range?.startLine ?? 1, { via: "target", evidenceClass: "export_target" })
    }

    return {
      language: "make",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // A Make-specific, RELATIVE complexity: buildable targets plus decision
        // points. Absolute timings are meaningless across 99 files of very
        // different sizes, and this is only ever compared within the analyzer
        // family, so it is documented as a count and not as a cost.
        complexity: declaredTargets.size + conditionals,
        linesOfCode: content.split("\n").length,
        patterns: [...new Set(patterns)],
        framework: "Make",
        variableCount: valuesByName.size,
        targetCount: declaredTargets.size,
        conditionalCount: conditionals,
        moduleName,
        edgeCount,
      },
    }
  }

  /** The assignment operator between name and value, from node positions. */
  private assignmentOperator(node: Node): string {
    const nameNode = this.firstChildOfType(node, new Set(["word"]))
    const valueNode = this.firstChildOfType(node, new Set(["text", "shell_command"]))
    if (nameNode && valueNode) {
      const text = node.text ?? ""
      const gap = text.slice(nameNode.endIndex - node.startIndex, valueNode.startIndex - node.startIndex).trim()
      if (gap) return gap
    }
    return "="
  }

  /**
   * Every reference inside `node`, as (name, intent, line).
   *
   * Handles the four reference-bearing node types the grammar produces and
   * nothing else. `substitution_reference` is a sibling of `variable_reference`,
   * not a child of it, so reading only the latter loses `$(VAR:.c=.o)`.
   */
  private collectFrom(
    node: Node,
    emit: (name: string, intent: "ref" | "call", line: number) => void,
    onForeachBinder: (name: string) => void = () => {},
  ): void {
    const BUILTIN_FUNCTIONS = new Set([
      "subst", "patsubst", "strip", "findstring", "filter", "filter-out", "sort",
      "word", "wordlist", "words", "firstword", "lastword", "dir", "notdir",
      "suffix", "basename", "addsuffix", "addprefix", "join", "wildcard",
      "realpath", "abspath", "if", "or", "and", "foreach", "file", "call",
      "value", "eval", "origin", "flavor", "shell", "error", "warning", "info",
    ])
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      const line = n.startPosition.row + 1
      if (n.type === "variable_reference" || n.type === "substitution_reference") {
        // `$$` is Make's ESCAPED dollar, so `$$'` (as in `-run '^$$'`) is a
        // literal `$'` handed to the shell and is NOT an expansion. The grammar
        // still hands back a variable_reference for it whose `word` is `'`, so
        // without this the analyzer publishes an edge to a bare apostrophe — a
        // name no file can declare and Make never expands.
        if (n.text.startsWith("$$")) {
          for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
          continue
        }
        const w = this.firstChildOfType(n, new Set(["word"]))
        const name = w?.text?.trim() ?? ""
        if (name) {
          // `$(1)`, `$(2)` are positional parameters inside a macro body, not
          // declarations; an all-digit name is never a symbol.
          if (!this.isAllDigits(name)) emit(name, "ref", line)
        } else {
          // A `variable_reference` with NO `word` of its own is a CONCATENATED
          // name — `$(PAPEROPT_$(PAPER))` parses as
          //   variable_reference -> concatenation -> word `PAPEROPT_` + variable_reference `$(PAPER)`
          // and there is no declaration to find, because the name is built at
          // expand time and no file can declare it. Emitting nothing here lost a
          // real read: phpmyadmin/docs/Makefile declares `PAPEROPT_a4` and
          // `PAPEROPT_letter` and then reads `$(PAPEROPT_$(PAPER))`, so this
          // edge is the ONLY thing in the graph connecting those two
          // declarations to the read that selects between them. The corpus
          // differential reported it MISSING (2 edges, lines 18 and 20) when the
          // 100th file entered the corpus, and the oracle derived it without
          // consulting the analyzer.
          //
          // Emitted with the same `ref` intent as every other read, so the label
          // still follows the one rule -- `references` iff this file declares the
          // name -- and lands on `uses` here, which is correct: a computed name
          // has no referent to point at.
          const cat = this.firstChildOfType(n, new Set(["concatenation"]))
          const catName = cat?.text?.trim() ?? ""
          if (catName && !this.isAllDigits(catName)) emit(catName, "ref", line)
        }
      } else if (n.type === "automatic_variable") {
        const w = this.firstChildOfType(n, new Set(["word"]))
        emit(w?.text?.trim() || n.text.trim(), "ref", line)
      } else if (n.type === "function_call") {
        const argsNode = this.firstChildOfType(n, new Set(["arguments"]))
        const nameEnd = argsNode ? argsNode.startIndex - n.startIndex : Math.max(0, n.text.length - 1)
        const name = this.firstToken(n.text.slice(2, nameEnd).trim())
        if (name === "foreach" && argsNode) {
          const binder = (argsNode.text ?? "").split(",")[0]?.trim() ?? ""
          if (binder) onForeachBinder(binder)
        }
        if (name === "call") {
          // The callee is the first comma-separated field of `arguments`; the
          // grammar gives a `$(call …)` node no child of its own for the name.
          const callee = (argsNode?.text ?? "").split(",")[0]?.trim() ?? ""
          if (callee && !BUILTIN_FUNCTIONS.has(callee) && !this.isAllDigits(callee)) emit(callee, "call", line)
        } else if (name && !BUILTIN_FUNCTIONS.has(name)) {
          emit(name, "ref", line)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private parentType(node: Node): string {
    const p = node.parent
    return p ? String(p.type) : ""
  }

  /**
   * The module symbol's name: the file's own name.
   *
   * The path is split by CHARACTER CODE, not by a pattern. This function used
   * to end in a `String.prototype.split` on a two-character regular expression,
   * which was the only regex literal in the file, and
   * `script/m12/make-contract-probe.ts`'s "analyzer source has no regex
   * literals" check found it — a gate that existed, ran, and had simply never
   * been executed for this lane. A rule that is never run is not a rule.
   *
   * (The comment above used to quote the old expression verbatim, which made the
   * detector fire on the COMMENT. The detector only exempts `//` line comments,
   * and that strictness is correct: a regex quoted in a doc comment reads to the
   * next maintainer as a regex in the file.)
   */
  private moduleName(filePath: string): string {
    if (!filePath) return "makefile"
    let end = filePath.length
    while (end > 0) {
      const c = filePath.charCodeAt(end - 1)
      // 47 '/' and 92 '\\'
      if (c === 47 || c === 92) break
      end--
    }
    return filePath.slice(end) || "makefile"
  }

  private isPlainIdentifier(s: string): boolean {
    if (s.length === 0) return false
    const first = s.charCodeAt(0)
    const okFirst = (c: number) =>
      (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (!okFirst(first)) return false
    for (let i = 1; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (!okFirst(c) && !(c >= 48 && c <= 57) && c !== 46 && c !== 45 && c !== 47) return false
    }
    return true
  }

  private firstChildOfType(node: Node, types: Set<string>): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && types.has(child.type)) return child
    }
    return null
  }

  private isAllDigits(name: string): boolean {
    if (name.length === 0) return false
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i)
      if (c < 48 || c > 57) return false
    }
    return true
  }

  private firstToken(raw: string): string {
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c === " " || c === "\t" || c === "," || c === "(") return raw.slice(0, i)
    }
    return raw
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
