import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Pure-AST Makefile analyzer (tree-sitter-make grammar, wasm/tree-sitter-make.wasm).
 *
 * The grammar's root is `makefile`. All symbol and relationship facts are
 * derived exclusively from node types and fields — zero source-text regexes.
 *
 * Node-type map (observed via node-types census on fixtures + corpus):
 *   - variable_assignment  VAR := | = | ?= | += | ::= | != value   -> constant
 *   - shell_assignment     VAR != shell-command                    -> constant
 *   - define_directive     define VAR ... endef                    -> constant
 *   - rule                 targets [: prerequisites] [recipe]      -> function per target
 *   - include_directive    include | -include | sinclude paths     -> import
 *   - conditional          ifdef/ifeq/ifndef/ifneq + else/elsif    -> scope (walked)
 *   - variable_reference   $(VAR)                                  -> uses edge
 *   - automatic_variable   $@ $< $^ $* $(@D) etc.                  -> skipped (builtin)
 *   - function_call        $(call NAME, args)                      -> calls edge; other
 *                            builtin functions (wildcard/shell/strip/...) -> uses edge
 *
 * Grammar quirk handled: a rule WITH a recipe swallows a directly-following
 * conditional block into its recipe child (observed: `test: all` spans lines
 * 1-29 in the elixir Makefile). The walker therefore descends into recipe
 * nodes and picks up nested rules/conditionals instead of skipping them —
 * the old analyzer's `continue` after processing a rule silently dropped
 * every rule inside those swallowed conditionals.
 */
export class RealMakefileAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const patterns: string[] = []

    // O(1) identity dedupe: one symbol per (name, kind) — reassignments
    // (VAR += ..., rule re-declarations) are merged, not duplicated.
    const symbolIds = new Set<string>()
    // O(1) relationship dedupe: exact (source, type, target) triples.
    const relIds = new Set<string>()
    // Merged metadata: first value seen for a given variable name.
    const valuesByName = new Map<string, string>()

    const addRel = (source: string, type: string, target: string, metadata?: Record<string, unknown>) => {
      if (!source || !target || source === target) return
      const id = `${source}\u0000${type}\u0000${target}`
      if (relIds.has(id)) return
      relIds.add(id)
      relationships.push({ source, target, type: type as ASTEngine.RelationshipType, confidence: 1.0, metadata: metadata ?? {} })
    }

    const addSymbol = (name: string, kind: ASTEngine.SymbolKind, node: Node, metadata: Record<string, unknown>) => {
      if (!name) return
      const id = `${name}\u0000${kind}`
      if (symbolIds.has(id)) return
      symbolIds.add(id)
      symbols.push({
        name,
        kind,
        range: this.nodeToRange(node),
        visibility: "global",
        metadata,
      })
    }

    // Depth-first walk with an explicit stack (iterative — no recursion depth risk).
    // Each node is processed, then its named children are pushed (reverse order
    // preserves source order). We always descend into children, including into
    // recipe nodes, so swallowed conditionals still yield their nested rules.
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      const type = node.type

      // ---- variables -----------------------------------------------------
      if (type === "variable_assignment") {
        const nameNode = this.firstChildOfType(node, new Set(["word"]))
        const name = nameNode?.text?.trim() ?? ""
        if (name) {
          const valueNode = this.firstChildOfType(node, new Set(["text"]))
          const value = valueNode?.text?.trim() ?? ""
          const operator = this.assignmentOperator(node)
          if (!valuesByName.has(name)) valuesByName.set(name, value)
          addSymbol(name, ASTEngine.SymbolKind.Constant, node, {
            nodeType: type,
            isMakeVariable: true,
            operator,
            value: value || undefined,
          })
          patterns.push("Make variables")
          // Uses edges: every $(OTHER) referenced in this value.
          this.collectReferences(node, (refName, kind) => {
            addRel(name, kind === "call" ? ASTEngine.RelationshipType.Calls : ASTEngine.RelationshipType.Uses, refName, { role: "variable_value_reference" })
          })
        }
      } else if (type === "shell_assignment") {
        const nameNode = this.firstChildOfType(node, new Set(["word"]))
        const name = nameNode?.text?.trim() ?? ""
        if (name) {
          const cmdNode = this.firstChildOfType(node, new Set(["shell_command"]))
          if (!valuesByName.has(name)) valuesByName.set(name, cmdNode?.text?.trim() ?? "")
          addSymbol(name, ASTEngine.SymbolKind.Constant, node, {
            nodeType: type,
            isMakeVariable: true,
            operator: "!=",
            value: cmdNode?.text?.trim() ?? undefined,
          })
          patterns.push("Make variables")
        }
      } else if (type === "define_directive") {
        const nameNode = this.firstChildOfType(node, new Set(["word"]))
        const name = nameNode?.text?.trim() ?? ""
        if (name) {
          const bodyNode = this.firstChildOfType(node, new Set(["raw_text"]))
          if (!valuesByName.has(name)) valuesByName.set(name, bodyNode?.text?.trim() ?? "")
          addSymbol(name, ASTEngine.SymbolKind.Constant, node, {
            nodeType: type,
            isMakeVariable: true,
            operator: "define",
            value: bodyNode?.text?.trim() ?? undefined,
          })
          patterns.push("Make variables")
        }
      }

      // ---- rules ----------------------------------------------------------
      else if (type === "rule") {
        const targetsNode = this.firstChildOfType(node, new Set(["targets"]))
        const targets = targetsNode ? this.collectTargets(targetsNode) : []
        // Special targets (.PHONY, .DEFAULT, .SUFFIXES, .NOTPARALLEL, ...) are
        // meta-directives, not buildable objects — skipped (M11 contract).
        const realTargets = targets.filter((t) => !t.startsWith("."))
        for (const t of realTargets) {
          addSymbol(t, ASTEngine.SymbolKind.Function, node, {
            nodeType: type,
            isMakeTarget: true,
            targetName: t,
          })
          patterns.push("Make rules")
        }
        // Prerequisites: target -> prereq dependency edges. The grammar emits
        // one `prerequisites` node per `|`-separated group (order-only prereqs
        // get their own node), so collect from ALL of them.
        const prereqs: string[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "prerequisites") prereqs.push(...this.collectTargets(child))
        }
        for (const t of realTargets) {
          for (const p of prereqs) {
            addRel(t, ASTEngine.RelationshipType.Uses, p, { role: "target_dependency" })
          }
        }
        // References inside targets/prereqs/recipe: $(VAR) -> uses; $(call X) -> calls.
        for (const t of realTargets) {
          this.collectReferences(node, (refName, kind) => {
            addRel(t, kind === "call" ? ASTEngine.RelationshipType.Calls : ASTEngine.RelationshipType.Uses, refName, { role: "rule_reference" })
          })
        }
      }

      // ---- includes --------------------------------------------------------
      else if (type === "include_directive") {
        const listNode = this.firstChildOfType(node, new Set(["list"]))
        if (listNode) {
          for (let i = 0; i < listNode.namedChildCount; i++) {
            const child = listNode.namedChild(i)
            if (!child) continue
            const module = child.text.trim()
            if (!module) continue
            imports.push({
              module,
              items: [],
              importType: "make_include",
              lineNumber: node.startPosition.row + 1,
              line: node.startPosition.row + 1,
              range: this.nodeToRange(node),
              isExternal: false,
            })
            addRel("makefile", ASTEngine.RelationshipType.Imports, module, { isMakeInclude: true })
          }
        }
        patterns.push("Make includes")
      }

      // Descend — always, including through recipes (swallowed conditionals).
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }

    // Syntax errors: surface grammar ERROR/MISSING nodes the same way every
    // M12 analyzer does — through the engine's tree error collector. The
    // analyzer itself never scans source text, so nothing to add here beyond
    // the tree walk above.

    return {
      language: "make",
      symbols,
      relationships,
      imports,
      exports: [],
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns,
        framework: "Make",
        variableCount: valuesByName.size,
      },
    }
  }

  /** The assignment operator between name and value: := | = | ?= | += | ::= | !=. */
  private assignmentOperator(node: Node): string {
    // The operator token sits between the name word and the value text. Derive
    // it from AST positions (name.endIndex .. value.startIndex), never regex.
    const text = node.text ?? ""
    const nameNode = this.firstChildOfType(node, new Set(["word"]))
    const valueNode = this.firstChildOfType(node, new Set(["text"]))
    if (nameNode && valueNode) {
      const gap = text.slice(nameNode.endIndex - node.startIndex, valueNode.startIndex - node.startIndex)
      const op = gap.trim()
      if (op) return op
    }
    return "="
  }

  /**
   * Collect the target/prereq names under a `targets`/`prerequisites` node.
   * Children are `word` (literal), `concatenation` (path + $(VAR), e.g.
   * `$(TEST_EBIN)/%.beam`), `variable_reference` ($(ELIXIR)), or
   * `function_call` ($(wildcard ...)). Each child's full text is one target —
   * no whitespace splitting, no source-text scanning.
   */
  private collectTargets(node: Node): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      const t = child.text.trim()
      if (t && !seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
    return out
  }

  /** Find the first named child of one of the given types. */
  private firstChildOfType(node: Node, types: Set<string>): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && types.has(child.type)) return child
    }
    return null
  }

  /**
   * Walk a node subtree and report every variable reference ($(VAR) via
   * variable_reference) and user function call ($(call NAME, ...) via
   * function_call whose arguments start with the callee). Builtin function
   * calls (wildcard, shell, strip, subst, eval, ...) are reported as uses of
   * the function name, not calls. automatic_variable ($@ $< $^ ...) skipped.
   */
  private collectReferences(node: Node, emit: (name: string, kind: "use" | "call") => void): void {
    const stack: Node[] = [node]
    // Do not descend into nested rules/conditionals: the grammar swallows a
    // conditional directly following a rule-with-recipe INTO that rule's
    // recipe child, so references inside the swallowed block would otherwise
    // attach to the outer rule instead of the block's own rules. Nested
    // containers own their own reference edges.
    const BOUNDARY_TYPES = new Set([
      "rule", "conditional", "else_directive", "elsif_directive",
      "endif_directive", "ifdef_directive", "ifeq_directive",
      "ifndef_directive", "ifneq_directive",
    ])
    const BUILTIN_FUNCTIONS = new Set([
      "subst", "patsubst", "strip", "findstring", "filter", "filter-out",
      "sort", "word", "wordlist", "words", "firstword", "lastword", "dir",
      "notdir", "suffix", "basename", "addsuffix", "addprefix", "join",
      "wildcard", "realpath", "abspath", "if", "or", "and", "foreach",
      "file", "call", "value", "eval", "origin", "flavor", "shell",
      "error", "warning", "info",
    ])
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "variable_reference") {
        const nameNode = this.firstChildOfType(n, new Set(["word"]))
        const name = nameNode?.text?.trim() ?? ""
        // $(1), $(2), ... are positional arguments inside define bodies —
        // not declared variables; skip all-digit names.
        if (name && !this.isAllDigits(name)) emit(name, "use")
      } else if (n.type === "function_call") {
        // Function name = text between "$(" and the arguments node start
        // (or the first whitespace/close-paren). Derived from node positions,
        // not a regex over source text.
        const argsNode = this.firstChildOfType(n, new Set(["arguments"]))
        const nodeStart = n.startIndex
        const nameEnd = argsNode ? argsNode.startIndex - nodeStart : n.text.length - 1
        // Function name = the token immediately after "$(", derived from node
        // text positions (trimmed, no regex split).
        const rawName = n.text.slice(2, nameEnd).trim()
        const name = this.firstToken(rawName)
        if (name === "call") {
          // $(call NAME, args...) — the first argument is the callee.
          const callee = argsNode?.text?.split(",")[0]?.trim() ?? ""
          if (callee && !BUILTIN_FUNCTIONS.has(callee)) emit(callee, "call")
        } else if (name && !BUILTIN_FUNCTIONS.has(name)) {
          // Unknown function name — user variable/function expansion.
          emit(name, "use")
        }
      }
      // Descend into children, including nested function_call/arguments, so
      // $(eval $(call NAME,...)) and $(call $(OTHER),...) chains resolve.
      // Stop at rule/conditional boundaries so nested constructs own their
      // own reference edges.
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child && !BOUNDARY_TYPES.has(child.type)) stack.push(child)
      }
    }
  }

  private isAllDigits(name: string): boolean {
    if (name.length === 0) return false
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i)
      if (c < 48 || c > 57) return false
    }
    return true
  }

  /** First whitespace/comma/paren-delimited token of a string, no regex. */
  private firstToken(raw: string): string {
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c === " " || c === "\t" || c === "," || c === "(") {
        return raw.slice(0, i)
      }
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
