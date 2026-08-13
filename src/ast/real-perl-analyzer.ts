import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

export class RealPerlAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const frameworks: Record<string, boolean> = { Perl: true }
    const patterns: Record<string, boolean> = {}
    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    const deferredInheritance: (() => void)[] = []

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    let cyclomaticComplexity = 1
    let currentPackage = ""
    const packageStack: string[] = []

    const pushPackage = (name: string) => {
      packageStack.push(currentPackage)
      currentPackage = name
    }

    const popPackage = () => {
      currentPackage = packageStack.pop() || ""
    }

    const pushSymbol = (name: string, kind: ASTEngine.SymbolKind, range: Node, meta: Record<string, unknown> = {}) => {
      const fqn = currentPackage ? `${currentPackage}::${name}` : name
      const sym: ASTEngine.UniversalSymbol = {
        name,
        kind,
        range: this.nodeToRange(range),
        scope: currentPackage,
        visibility: "public",
        metadata: { perlSpecific: true, ...meta },
      }
      symbols.push(sym)
      symbolMap.set(fqn, sym)
      return sym
    }

    const pushCall = (target: string, sourceOverride?: string) => {
      if (!target || target === "has" || target === "use" || target === "require" || target === "no") return
      const source = sourceOverride || currentPackage || "global"
      relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.Calls,
        confidence: 0.7,
        metadata: { perlSpecific: true },
      })
    }

    const isBranch = (type: string) =>
      type === "if_statement" || type === "unless_statement" ||
      type === "while_statement" || type === "until_statement" ||
      type === "for_statement" || type === "foreach_statement" ||
      type === "ternary_expression" || type === "conditional_statement" ||
      type === "loop_statement" || type === "cstyle_for_statement"

    const traverse = (node: Node) => {
      if (isBranch(node.type)) cyclomaticComplexity++

      switch (node.type) {
        case "package_statement":
        case "class_statement":
        case "role_statement": {
          const kind = node.type === "package_statement" ? ASTEngine.SymbolKind.Class
            : node.type === "role_statement" ? ASTEngine.SymbolKind.Interface
            : ASTEngine.SymbolKind.Class
          const nameNode = this.findChildByType(node, "package")
          if (nameNode) {
            const name = nameNode.text
            const block = this.findChildByType(node, "block")
            pushPackage(name)
            const packageSym = pushSymbol(name, kind, node, {
              isPackage: node.type === "package_statement",
              isClass: node.type === "class_statement",
              isRole: node.type === "role_statement",
            })
            // The package itself is top-level — it must not own itself.
            // pushSymbol assigns scope = currentPackage (= its own name), so
            // reset it to keep the package a root-level symbol.
            packageSym.scope = ""
            packageSym.ownerName = undefined
            // pushSymbol keyed the package under "Orders::Orders" (currentPackage
            // was already pushed). Re-key by the bare name so a sub literally
            // named like the package is not wrongly deduped via symbolMap.
            symbolMap.set(name, packageSym)
            if (node.type === "package_statement") {
              if (name.includes("::Schema::Result::") || name.includes("::Schema::ResultSet::"))
                frameworks["DBIx::Class"] = true
            }
            if (node.type === "role_statement") frameworks["Modern Perl Roles"] = true
            if (block) {
              traverse(block)
              popPackage()
              for (let i = 0; i < node.namedChildCount; i++) {
                const c = node.namedChild(i)
                if (c && c !== block) traverse(c)
              }
              return
            }
          }
          break
        }

        case "subroutine_declaration_statement":
        case "method_declaration_statement": {
          const nameNode = this.findChildByType(node, "bareword")
          if (nameNode) {
            const name = nameNode.text
            const fqn = currentPackage ? `${currentPackage}::${name}` : name
            if (symbolMap.has(fqn)) break
            const kind = node.type === "method_declaration_statement" ? ASTEngine.SymbolKind.Method
              : currentPackage ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function
            pushSymbol(name, kind, node, { isMethod: node.type === "method_declaration_statement" })
          }
          break
        }

        // NOTE: anonymous subroutine/method expressions (closures used as
        // values, e.g. default => sub { [] }) are deliberately NOT emitted as
        // symbols — they are expressions, not named declarations.
        case "anonymous_subroutine_expression":
        case "anonymous_method_expression": {
          break
        }

        case "variable_declaration": {
          patterns["Variable Declarations"] = true
          const declType = this.getDeclarationType(node)
          const allDeclVars = this.collectChildrenByType(node, "scalar")
            .concat(this.collectChildrenByType(node, "array"), this.collectChildrenByType(node, "hash"))
          for (const v of allDeclVars) {
            const varnameNode = this.findChildByType(v, "varname")
            if (varnameNode) {
              const bareName = varnameNode.text.replace(/^[\$@%#]/, "")
              // All-caps declarations like our $VERSION are constants.
              const kind = this.isAllCapsName(bareName) ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable
              pushSymbol(bareName, kind, v, { perlDeclType: declType, sigil: v.type })
            }
          }
          break
        }

        case "ambiguous_function_call_expression":
        case "function_call_expression": {
          const funcNode = this.findChildByType(node, "function")
          if (!funcNode) break
          const callName = funcNode.text

          if (callName === "has") {
            const firstArg = this.getFirstArgument(node)
            if (firstArg) {
              pushSymbol(firstArg, ASTEngine.SymbolKind.Property, node, { isMooseProperty: true })
              frameworks["Moose/Moo OOP"] = true
            }
            break
          }

          if (callName === "extends" || callName === "with") {
            frameworks["Moose/Moo OOP"] = true
            const relType = callName === "extends" ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements
            const args = this.getArgumentStrings(node)
            for (const arg of args) {
              relationships.push({
                source: currentPackage || "global",
                target: arg,
                type: relType,
                confidence: 0.85,
                metadata: { perlSpecific: true, mooseKeyword: callName },
              })
            }
            break
          }

          if (callName === "new") {
            relationships.push({
              source: currentPackage || "global",
              target: "new",
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.7,
              metadata: { perlSpecific: true, isConstructor: true },
            })
            break
          }

          pushCall(callName)
          break
        }

        case "method_call_expression": {
          const methodNode = this.findChildByType(node, "method")
          if (!methodNode) break
          const methodName = methodNode.text

          if (methodName === "new") {
            const invocantName = this.extractInvocantName(node)
            if (invocantName) {
              relationships.push({
                source: currentPackage || "global",
                target: invocantName,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.9,
                metadata: { perlSpecific: true, isConstructor: true, methodCallNew: true },
              })
            }
            break
          }

          pushCall(methodName)
          break
        }

        case "use_statement": {
          const moduleNode = this.findChildByType(node, "package")
          if (moduleNode) {
            const name = moduleNode.text
            imports.push({
              module: name,
              items: ["*"],
              isDefault: true,
              range: this.nodeToRange(node),
              metadata: { perlSpecific: true, type: "use" },
            })
            patterns["Module Includes"] = true
            // DependsOn for use imports
            relationships.push({
              source: currentPackage || "global",
              target: name,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              metadata: { perlSpecific: true, isUseImport: true },
            })

            if (name === "parent" || name === "base") {
              const capturedPackage = currentPackage // Capture value, not reference
              deferredInheritance.push(() => {
                const args = this.getUseStatementArguments(node)
                for (const arg of args) {
                  const cleanArg = arg.replace(/-norequire\s*/g, "").trim()
                  if (!cleanArg) continue
                  relationships.push({
                    source: capturedPackage || "global",
                    target: cleanArg,
                    type: ASTEngine.RelationshipType.Extends,
                    confidence: 0.9,
                    metadata: { perlSpecific: true, via: `use ${name}` },
                  })
                }
              })
            }

            if (name === "Moose" || name === "Moo") frameworks["Moose/Moo OOP"] = true
            if (name.startsWith("Koha::")) {
              relationships.push({
                source: currentPackage || "unknown",
                target: name,
                type: ASTEngine.RelationshipType.Imports,
                confidence: 1.0,
                targetExternal: false,
                metadata: { perlSpecific: true, modulePath: name.replace(/::/g, "/") + ".pm" },
              })
            }
          }
          break
        }

        case "assignment_expression": {
          const left = this.findNodeByFieldName(node, "left")
          if (left) {
            const leftText = left.text
            if (leftText.includes("ISA")) {
              const capturedPackage = currentPackage // Capture value
              deferredInheritance.push(() => {
                const right = this.findNodeByFieldName(node, "right")
                if (right) {
                  const parentNames = this.extractNamesFromQwOrList(right)
                  for (const pn of parentNames) {
                    relationships.push({
                      source: capturedPackage || "global",
                      target: pn,
                      type: ASTEngine.RelationshipType.Extends,
                      confidence: 0.85,
                      metadata: { perlSpecific: true, via: "@ISA" },
                    })
                  }
                }
              })
            }
            if (leftText.includes("EXPORT")) {
              const right = this.findNodeByFieldName(node, "right")
              if (right) {
                const exportNames = this.extractNamesFromQwOrList(right)
                for (const en of exportNames) {
                  exports.push({
                    name: en,
                    kind: ASTEngine.SymbolKind.Function,
                    range: this.nodeToRange(node),
                    metadata: { perlSpecific: true, exportArray: leftText },
                  })
                }
                patterns["Exports"] = true
              }
            }
          }
          break
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
    for (const fn of deferredInheritance) fn()

    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns).filter(k => Object.prototype.hasOwnProperty.call(patterns, k))
    // Post-loop: add contains for owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    const detectedFrameworks = Object.keys(frameworks).filter(k => Object.prototype.hasOwnProperty.call(frameworks, k))

    return {
      language: "perl",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns: detectedPatterns.map(p => ({ framework: "Perl", patterns: [{ type: "usage", detected: true, description: p }] })),
        architecturalInsights: [],
        architecturalScore,
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "2.0.0-perl-full",
      },
    }
  }

  private isAllCapsName(name: string): boolean {
    if (!name || name.length < 2) return false
    let hasLetter = false
    for (let i = 0; i < name.length; i++) {
      const c = name[i]
      if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) {
        hasLetter = true
        if (c >= "a" && c <= "z") return false
      }
    }
    return hasLetter
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private findNodeByFieldName(node: Node, field: string): Node | null {
    return (node as any).childForFieldName?.(field) ?? null
  }

  private collectChildrenByType(node: Node, type: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) results.push(child)
    }
    return results
  }

  private getDeclarationType(node: Node): string {
    const text = node.text
    if (text.startsWith("my ")) return "my"
    if (text.startsWith("our ")) return "our"
    if (text.startsWith("state ")) return "state"
    if (text.startsWith("field ")) return "field"
    return "unknown"
  }

  private getFirstArgument(callNode: Node): string | null {
    const listNode = this.findChildByType(callNode, "list_expression") || callNode
    if (!listNode) return null
    const strNode = this.findChildByType(listNode, "string_literal") ||
      this.findChildByType(listNode, "autoquoted_bareword") ||
      this.findChildByType(listNode, "bareword")
    if (!strNode && listNode !== callNode) {
      const fc = this.findChildByType(listNode, "bareword") || this.findChildByType(listNode, "autoquoted_bareword")
      if (fc) return fc.text
    }
    if (strNode) {
      if (strNode.type === "autoquoted_bareword" || strNode.type === "bareword") return strNode.text
      const content = this.findChildByType(strNode, "string_content")
      return content ? content.text : strNode.text.replace(/['"]/g, "")
    }
    return null
  }

  private getArgumentStrings(callNode: Node): string[] {
    const results: string[] = []
    const args = this.findChildByType(callNode, "list_expression")
    if (!args) {
      const first = this.getFirstArgument(callNode)
      return first ? [first] : []
    }
    const collect = (n: Node) => {
      if (n.type === "string_literal" || n.type === "autoquoted_bareword" || n.type === "bareword") {
        const content = this.findChildByType(n, "string_content")
        results.push(content ? content.text : n.text.replace(/['"]/g, ""))
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collect(c)
      }
    }
    collect(args)
    return results
  }

  private getUseStatementArguments(node: Node): string[] {
    const listNode = this.findChildByType(node, "list_expression")
    if (!listNode) return []
    const results: string[] = []
    const collect = (n: Node) => {
      if (n.type === "string_literal" || n.type === "autoquoted_bareword" || n.type === "bareword" || n.type === "quoted_word_list") {
        const content = this.findChildByType(n, "string_content")
        results.push(content ? content.text : n.text.replace(/['"()]|qw\s*/g, "").trim())
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collect(c)
      }
    }
    collect(listNode)
    return results
  }

  private extractNamesFromQwOrList(node: Node): string[] {
    const results: string[] = []
    const collect = (n: Node) => {
      if (n.type === "string_literal" || n.type === "autoquoted_bareword" || n.type === "bareword" || n.type === "quoted_word_list") {
        let text = n.text.replace(/['"()]|qw\s*/g, "").trim()
        if (n.type === "quoted_word_list" || text.includes(" ")) {
          for (const part of text.split(/\s+/)) if (part.length > 1) results.push(part)
        } else if (text.length > 0) {
          results.push(text)
        }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collect(c)
      }
    }
    collect(node)
    return results
  }

  private extractInvocantName(node: Node): string | null {
    let foundInvocant = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "->") continue
      if (!foundInvocant && (child.type === "bareword" || child.type === "package" || child.type === "scalar" || child.type === "array" || child.type === "function_call_expression" || child.type === "ambiguous_function_call_expression")) {
        foundInvocant = true
        if (child.type.includes("function_call")) {
          const funcNode = this.findChildByType(child, "function")
          return funcNode ? funcNode.text : null
        }
        return child.text
      }
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
