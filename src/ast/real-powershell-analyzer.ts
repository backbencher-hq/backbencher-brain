import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealPowershellAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()

    const frameworks: Record<string, boolean> = { PowerShell: true }
    const patterns: Record<string, boolean> = {}

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
    let currentFunction = ""

    const pushSymbol = (name: string, kind: ASTEngine.SymbolKind, range: Node, meta: Record<string, unknown> = {}) => {
      // Top-level declarations (function/class/enum) are owned by the script,
      // not by the previously visited function. Nested members (methods,
      // properties, parameters) are owned by their enclosing class/function.
      const isTopLevel = kind === ASTEngine.SymbolKind.Function || kind === ASTEngine.SymbolKind.Class || kind === ASTEngine.SymbolKind.Enum
      const scope = isTopLevel ? "global" : currentFunction || "global"
      const key = `${scope}:${name}`
      if (symbolMap.has(key) || name.startsWith("$global:") || name.startsWith("$script:")) return null
      const sym: ASTEngine.UniversalSymbol = {
        name: name.replace(/^\$/, ""),
        kind,
        range: this.nodeToRange(range),
        scope,
        ownerName: isTopLevel ? undefined : (meta.ownerClass as string) || currentFunction || undefined,
        visibility: "public",
        metadata: { powershellSpecific: true, ...meta },
      }
      symbols.push(sym)
      symbolMap.set(key, sym)
      return sym
    }

    const isBranch = (type: string) =>
      type === "if_statement" ||
      type === "elseif_clause" ||
      type === "else_clause" ||
      type === "while_statement" ||
      type === "do_statement" ||
      type === "for_statement" ||
      type === "foreach_statement" ||
      type === "switch_statement" ||
      type === "switch_clause" ||
      type === "try_statement" ||
      type === "catch_clause" ||
      type === "trap_statement"

    const traverse = (node: Node) => {
      if (isBranch(node.type)) cyclomaticComplexity++

      switch (node.type) {
        case "function_definition":
        case "function_statement": {
          const nameNode =
            this.findChildByType(node, "simple_name") ||
            this.findChildByType(node, "identifier") ||
            this.findChildByType(node, "function_name")
          if (nameNode) {
            const fnName = nameNode.text

            const params: ASTEngine.Parameter[] = []
            const paramDecl = this.findChildByType(node, "function_parameter_declaration")
            const paramList = paramDecl
              ? this.findChildByType(paramDecl, "parameter_list")
              : this.findChildByType(node, "parameter_list")
            if (paramList) {
              for (let i = 0; i < paramList.namedChildCount; i++) {
                const p = paramList.namedChild(i)
                if (p && (p.type === "script_parameter" || p.type === "parameter")) {
                  const pName = this.findChildByType(p, "variable_expression") || this.findChildByType(p, "identifier")
                  const pType = this.findChildByType(p, "type_literal") || this.findChildByType(p, "type_spec")
                  if (pName) {
                    params.push({
                      name: pName.text.replace(/^\$/, ""),
                      type: pType ? pType.text.replace(/[\[\]]/g, "") : "any",
                      isOptional: p.text.includes("="),
                    })
                  }
                }
              }
            }

            const attrs = this.collectChildrenByType(node, "attribute").concat(
              this.collectChildrenByType(node, "attribute_list"),
            )
            const annotations: string[] = []
            for (const attr of attrs) {
              const attrText = attr.text
              annotations.push(attrText)
              if (attrText.includes("CmdletBinding")) patterns["Advanced Functions"] = true
              if (attrText.includes("Parameter")) patterns["Parameter Attributes"] = true
              if (
                attrText.includes("ValidateSet") ||
                attrText.includes("ValidateRange") ||
                attrText.includes("ValidatePattern")
              )
                patterns["Input Validation"] = true
            }

            // Push the function symbol BEFORE setting currentFunction so it
            // doesn't own itself (scope must be "global", not its own name).
            pushSymbol(fnName, ASTEngine.SymbolKind.Function, node, {
              parameters: params.length > 0 ? params : undefined,
              annotations: annotations.length > 0 ? annotations : undefined,
            })
            currentFunction = fnName
          }
          break
        }

        case "class_statement": {
          let className = ""
          let baseClass = ""
          const interfaces: string[] = []
          let inHeader = true

          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (!child) continue
            if (
              child.type === "class_method_definition" ||
              child.type === "class_property_definition" ||
              child.type === "class_attribute"
            ) {
              inHeader = false
            }
            if (child.type === "simple_name" || child.type === "identifier") {
              if (!className) {
                className = child.text
              } else if (inHeader) {
                if (!baseClass) baseClass = child.text
                else interfaces.push(child.text)
              }
            }
          }

          if (!className) break

          if (baseClass) {
            relationships.push({
              source: className,
              target: baseClass,
              type: ASTEngine.RelationshipType.Extends,
              confidence: 1.0,
              metadata: { powershellSpecific: true },
            })
          }
          // Powershell: second+ types after : are interfaces (all share same parent list)
          for (const iface of interfaces) {
            relationships.push({
              source: className,
              target: iface,
              type: ASTEngine.RelationshipType.Implements,
              confidence: 0.85,
              metadata: { powershellSpecific: true },
            })
          }

          // Push class BEFORE setting currentFunction so it doesn't own itself
          pushSymbol(className, ASTEngine.SymbolKind.Class, node)
          currentFunction = className

          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (
              child &&
              (child.type === "class_method_definition" ||
                child.type === "class_property_definition" ||
                child.type === "class_attribute")
            )
              traverse(child)
          }
          currentFunction = ""
          return
        }

        case "enum_statement": {
          let enumName = ""
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child && (child.type === "simple_name" || child.type === "identifier")) {
              enumName = child.text
              break
            }
          }
          if (!enumName) break
          currentFunction = enumName
          pushSymbol(enumName, ASTEngine.SymbolKind.Enum, node)

          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child && child.type === "enum_member") traverse(child)
          }
          currentFunction = ""
          return
        }

        case "enum_member": {
          const nameNode = this.findChildByType(node, "simple_name") || this.findChildByType(node, "identifier")
          if (nameNode && currentFunction) {
            pushSymbol(nameNode.text, ASTEngine.SymbolKind.EnumMember, node)
          }
          break
        }

        case "class_method_definition": {
          const nameNode = this.findChildByType(node, "simple_name") || this.findChildByType(node, "identifier")
          if (nameNode) {
            const params: ASTEngine.Parameter[] = []
            const paramDecl = this.findChildByType(node, "class_method_parameter_list")
            if (paramDecl) {
              const paramList = this.findChildByType(paramDecl, "parameter_list")
              if (paramList) {
                for (let i = 0; i < paramList.namedChildCount; i++) {
                  const p = paramList.namedChild(i)
                  if (p && p.type === "class_method_parameter") {
                    const pName =
                      this.findChildByType(p, "variable_expression") || this.findChildByType(p, "identifier")
                    const pType = this.findChildByType(p, "type_literal") || this.findChildByType(p, "type_spec")
                    if (pName) {
                      params.push({
                        name: pName.text.replace(/^\$/, ""),
                        type: pType ? pType.text.replace(/[\[\]]/g, "") : "any",
                        isOptional: p.text.includes("="),
                      })
                    }
                  }
                }
              }
            }
            // A class method whose name matches the enclosing class is a
            // constructor in PowerShell (e.g. Deployment([string]$name)).
            const isCtor = nameNode.text === currentFunction
            pushSymbol(nameNode.text, isCtor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method, node, {
              ownerClass: currentFunction,
              parameters: params.length > 0 ? params : undefined,
            })
          }
          break
        }

        case "class_property_definition": {
          const nameNode =
            this.findChildByType(node, "variable_expression") || this.findChildByType(node, "simple_name")
          if (nameNode) {
            const modifiers = this.extractPsModifiers(node)
            pushSymbol(nameNode.text, ASTEngine.SymbolKind.Property, node, {
              ownerClass: currentFunction,
              isStatic: modifiers.includes("static"),
            })
          }
          break
        }

        case "class_attribute": {
          if (node.text.includes("DscResource")) frameworks["DSC Resources"] = true
          if (node.text.includes("DscProperty")) patterns["DSC Configuration"] = true
          break
        }

        case "script_block":
        case "script_block_expression": {
          // Script blocks are anonymous inline closures — emitting synthetic
          // scriptblock_N_N symbols pollutes the symbol table. Skip.
          break
        }

        case "member_access": {
          const memberName = this.findChildByType(node, "member_name") || this.findChildByType(node, "simple_name")
          const object = node.namedChild(0)
          if (memberName && object) {
            relationships.push({
              source: currentFunction || "global",
              target: memberName.text,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.5,
              metadata: { powershellSpecific: true, memberAccess: true, on: object.text },
            })
          }
          break
        }

        case "assignment_expression": {
          let varName = ""
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (!child) continue
            if (child.type === "variable_expression") {
              varName = child.text
              pushSymbol(varName, ASTEngine.SymbolKind.Variable, child, { isVariable: true })
            }
            if (child.type === "command_invocation" || child.type === "command") {
              const cmdName = this.getCommandName(child)
              if (cmdName) {
                relationships.push({
                  source: varName || currentFunction || "global",
                  target: cmdName,
                  type: ASTEngine.RelationshipType.Calls,
                  confidence: 0.7,
                  metadata: { powershellSpecific: true, assignedFrom: !!varName },
                })
                this.detectPsFrameworks(cmdName, frameworks, patterns)
              }
            }
          }
          break
        }

        case "command_invocation":
        case "command": {
          const cmdName = this.getCommandName(node)
          if (!cmdName) break

          this.detectPsFrameworks(cmdName, frameworks, patterns)

          if (cmdName === "." || cmdName === "&") {
            const firstArg = this.getFirstArgument(node)
            if (firstArg) {
              relationships.push({
                source: currentFunction || "global",
                target: firstArg,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                metadata: { powershellSpecific: true, dotSource: true },
              })
            }
            break
          }

          if (cmdName === "Import-Module" || cmdName === "ipmo") {
            const args = this.getCommandArguments(node)
            for (const arg of args) {
              imports.push({
                module: arg,
                items: ["*"],
                isDefault: true,
                range: this.nodeToRange(node),
                metadata: { powershellSpecific: true, via: cmdName },
              })
            }
            break
          }

          if (cmdName === "using") {
            const args = this.getCommandArguments(node)
            const isNamespace = node.text.includes("namespace")
            const via = isNamespace ? "using namespace" : "using module"
            for (const arg of args) {
              imports.push({
                module: arg,
                items: ["*"],
                isDefault: true,
                range: this.nodeToRange(node),
                metadata: { powershellSpecific: true, via },
              })
            }
          }

          if (cmdName.includes("::new") || (cmdName.startsWith("[") && cmdName.includes("]::new"))) {
            const cleanType = cmdName.replace(/^\[|\]$/g, "").split("::")[0]
            relationships.push({
              source: currentFunction || "global",
              target: cleanType,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.9,
              metadata: { powershellSpecific: true, dotNetNew: true },
            })
            break
          }

          if (cmdName.startsWith("#requires") || cmdName.startsWith("#Requires")) {
            const modMatch = node.text.match(/-Modules?\s+([^\s"']+|"[^"]+"|'[^']+')/i)
            if (modMatch) {
              imports.push({
                module: modMatch[1].replace(/["']/g, ""),
                items: ["*"],
                isDefault: true,
                range: this.nodeToRange(node),
                metadata: { powershellSpecific: true, via: "#requires" },
              })
            }
            break
          }

          relationships.push({
            source: currentFunction || "global",
            target: cmdName,
            type: ASTEngine.RelationshipType.Calls,
            confidence: cmdName.includes("-") ? 0.9 : 0.6,
            metadata: { powershellSpecific: true },
          })
          break
        }

        case "pipeline":
        case "pipeline_chain": {
          const commands: string[] = []
          const collect = (n: Node) => {
            if (n.type === "command_invocation" || n.type === "command") {
              const name = this.getCommandName(n)
              if (name) commands.push(name)
            }
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) collect(c)
            }
          }
          collect(node)
          for (let i = 0; i < commands.length - 1; i++) {
            relationships.push({
              source: commands[i],
              target: commands[i + 1],
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.5,
              metadata: { powershellSpecific: true, pipelineStage: i + 1 },
            })
          }
          if (commands.length > 0) patterns["Pipelines"] = true
          break
        }

        case "throw": {
          const thrown = node.namedChild(0)
          if (thrown && thrown.type === "command_invocation") {
            const cmdName = this.getCommandName(thrown)
            if (cmdName) {
              relationships.push({
                source: currentFunction || "global",
                target: cmdName,
                type: ASTEngine.RelationshipType.References,
                confidence: 0.8,
                metadata: { powershellSpecific: true, isThrow: true },
              })
            }
          }
          break
        }

        case "return": {
          const returned = node.namedChild(0)
          if (returned && (returned.type === "command_invocation" || returned.type === "command")) {
            const cmdName = this.getCommandName(returned)
            if (cmdName) {
              relationships.push({
                source: currentFunction || "global",
                target: cmdName,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.6,
                metadata: { powershellSpecific: true, returned: true },
              })
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

    const allSymbols = symbols.filter((s, i, arr) => arr.findIndex((x) => x.name === s.name && x.kind === s.kind && x.ownerName === s.ownerName) === i)
    const uniqueRels = relationships.filter(
      (r, i, arr) => arr.findIndex((x) => x.source === r.source && x.target === r.target && x.type === r.type) === i,
    )

    const detectedPatterns = Object.keys(patterns).filter((k) => Object.prototype.hasOwnProperty.call(patterns, k))
    const detectedFrameworks = Object.keys(frameworks).filter((k) =>
      Object.prototype.hasOwnProperty.call(frameworks, k),
    )

    // Add Contains for owned symbols + References for imports
    for (const s of allSymbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        uniqueRels.push({ source: _owner, target: s.name, type: ASTEngine.RelationshipType.Contains, confidence: 1.0, metadata: {} })
      }
    }
    for (const imp of imports) {
      uniqueRels.push({ source: "global", target: imp.module || "", type: ASTEngine.RelationshipType.References, confidence: 0.9, metadata: {} })
    }

    return {
      language: "powershell",
      symbols: allSymbols,
      relationships: uniqueRels,
      imports,
      exports,
      errors,
      metadata: {
        complexity: allSymbols.length + uniqueRels.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns: detectedPatterns.map((p) => ({
          framework: "PowerShell",
          patterns: [{ type: "usage", detected: true, description: p }],
        })),
        architecturalInsights: [],
        architecturalScore: Math.min(100, 60 + uniqueRels.length),
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "2.0.0-ps-full",
      },
    }
  }

  private getCommandName(node: Node): string | null {
    const viaField = (node as any).childForFieldName?.("command_name")
    if (viaField) return viaField.text
    const nameNode =
      this.findChildByType(node, "command_name") ||
      this.findChildByType(node, "command_name_expr") ||
      this.findChildByType(node, "path_command_name") ||
      this.findChildByType(node, "simple_name") ||
      this.findChildByType(node, "identifier")
    if (nameNode) return nameNode.text
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (
        c &&
        (c.type === "command_name" ||
          c.type === "command_name_expr" ||
          c.type === "path_command_name" ||
          c.type === "simple_name")
      )
        return c.text
    }
    return null
  }

  private getFirstArgument(node: Node): string | null {
    const args = this.findChildByType(node, "command_elements") || this.findChildByType(node, "argument_list")
    const target = args || node
    for (let i = 0; i < target.namedChildCount; i++) {
      const c = target.namedChild(i)
      if (
        c &&
        (c.type === "command_argument" ||
          c.type === "string_literal" ||
          c.type === "expandable_string_literal" ||
          c.type === "word" ||
          c.type === "variable_expression")
      ) {
        return c.text.replace(/['"]/g, "")
      }
    }
    return null
  }

  private getCommandArguments(node: Node): string[] {
    const results: string[] = []
    const collect = (n: Node) => {
      if (n.type === "command_argument" || n.type === "string_literal" || n.type === "expandable_string_literal") {
        results.push(n.text.replace(/['"]/g, ""))
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

  private detectPsFrameworks(cmdName: string, frameworks: Record<string, boolean>, patterns: Record<string, boolean>) {
    const lower = cmdName.toLowerCase()
    if (
      lower.startsWith("get-az") ||
      lower.startsWith("new-az") ||
      lower.startsWith("set-az") ||
      lower.startsWith("remove-az") ||
      lower.startsWith("connect-az") ||
      lower === "az" ||
      lower.startsWith("az_")
    )
      frameworks["Azure Az Module"] = true
    if (lower.startsWith("get-msol") || lower.startsWith("set-msol") || lower.startsWith("connect-msol"))
      frameworks["Azure AD / MSOnline"] = true
    if (
      lower.startsWith("get-exo") ||
      lower.startsWith("set-exo") ||
      lower.startsWith("new-exo") ||
      lower.startsWith("get-mailbox") ||
      lower.startsWith("set-mailbox") ||
      lower.startsWith("enable-mailbox")
    )
      frameworks["Exchange Online"] = true
    if (
      lower.startsWith("get-sp") ||
      lower.startsWith("set-sp") ||
      lower.startsWith("new-sp") ||
      lower.startsWith("connect-pnp") ||
      lower.startsWith("get-pnp")
    )
      frameworks["SharePoint PnP"] = true
    if (
      lower.startsWith("get-ad") ||
      lower.startsWith("set-ad") ||
      lower.startsWith("new-ad") ||
      lower.startsWith("remove-ad")
    )
      frameworks["Active Directory"] = true
    if (
      lower.startsWith("get-vm") ||
      lower.startsWith("new-vm") ||
      lower.startsWith("start-vm") ||
      lower.startsWith("stop-vm")
    )
      frameworks["VMware / Hyper-V"] = true
    if (lower.startsWith("get-azurer") || lower.startsWith("new-azurer"))
      // Azure Resource Manager
      frameworks["Azure Az Module"] = true
    if (lower.startsWith("invoke-rest") || lower.startsWith("invoke-web") || lower === "irm" || lower === "iwr")
      patterns["REST API Calls"] = true
    if (lower.startsWith("write-") || lower.startsWith("read-")) patterns["I/O Operations"] = true
    if (lower === "get-service" || lower === "stop-service" || lower === "start-service" || lower === "restart-service")
      patterns["Service Management"] = true
  }

  private extractPsModifiers(node: Node): string[] {
    const mods: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && (child.type === "static" || child.type === "hidden" || child.type === "modifier")) {
        mods.push(child.text.toLowerCase())
      }
    }
    return mods
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private collectChildrenByType(node: Node, type: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) results.push(child)
    }
    return results
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
