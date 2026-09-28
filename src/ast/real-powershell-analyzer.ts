import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// Automatic / reserved variables that are never project declarations.
const AUTOMATIC_VARIABLES = new Set([
  "this", "_", "PSItem", "args", "input", "PSScriptRoot", "PSCommandPath",
  "PSModulePath", "PSVersionTable", "Host", "PID", "LASTEXITCODE", "Error",
  "HOME", "PWD", "MyInvocation", "Matches", "Null", "True", "False", "OFS",
  "ShellId", "StackTrace", "ExecutionContext", "foreach", "switch",
])

// Flow-control keywords that can appear as bare commands but are not
// project-level cmdlet calls.
const FLOW_KEYWORDS = new Set(["break", "continue", "return", "exit", "throw", "else", "finally", "trap"])

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
    const relKeys = new Set<string>()

    const frameworks = new Set<string>(["PowerShell"])
    const patterns = new Set<string>()

    let cyclomaticComplexity = 1
    const ownerStack: string[] = []
    const currentOwner = (): string => ownerStack[ownerStack.length - 1] ?? ""
    const relSource = (): string => currentOwner() || "global"

    const addRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, unknown> = {},
    ) => {
      const key = `${source}\u0000${type}\u0000${target}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      relationships.push({ source, target, type, confidence, metadata })
    }

    const stripDollar = (text: string): string =>
      text.length > 1 && text.charCodeAt(0) === 36 ? text.slice(1) : text

    const pushSymbol = (
      name: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      meta: Record<string, unknown> = {},
      parameters?: ASTEngine.Parameter[],
    ): void => {
      const raw = name.trim()
      if (raw === "") return
      // Scope-qualified automatic references ($global:, $script:) are never
      // local declarations.
      if (raw.startsWith("$global:") || raw.startsWith("$script:") || raw.startsWith("$env:")) return
      const owner = currentOwner()
      const clean = stripDollar(raw)
      if (AUTOMATIC_VARIABLES.has(clean)) return
      const key = `${owner || "global"}\u0000${clean}\u0000${kind}`
      if (symbolMap.has(key)) return
      const sym: ASTEngine.UniversalSymbol = {
        name: clean,
        kind,
        range: this.nodeToRange(node),
        scope: owner || undefined,
        ownerName: owner || undefined,
        visibility: "public",
        parameters,
        metadata: { powershellSpecific: true, ...meta },
      }
      symbols.push(sym)
      symbolMap.set(key, sym)
      // Real owners only — top-level declarations never emit contains edges,
      // and a constructor never contains itself.
      if (owner && owner !== clean) {
        addRel(owner, clean, ASTEngine.RelationshipType.Contains, 1.0, {})
      }
    }

    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()

    const isBranch = (type: string) =>
      type === "if_statement" ||
      type === "elseif_clause" ||
      type === "while_statement" ||
      type === "do_statement" ||
      type === "for_statement" ||
      type === "foreach_statement" ||
      type === "switch_statement" ||
      type === "try_statement" ||
      type === "catch_clause" ||
      type === "trap_statement"

    const findFirstChild = (node: Node, type: string): Node | null => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === type) return child
      }
      return null
    }

    const findDescendantVariable = (node: Node): Node | null => {
      const stack: Node[] = [node]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "variable") return n
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) stack.push(child)
        }
      }
      return null
    }

    const typeSpecText = (node: Node): string => {
      // type_literal may be a direct child (class members) or nested under
      // attribute_list → attribute (script parameters).
      const literal = this.findDescendant(node, "type_literal")
      if (literal) {
        const spec = findFirstChild(literal, "type_spec")
        if (spec) return spec.text
        return literal.text.slice(1, literal.text.length > 2 ? -1 : undefined)
      }
      return ""
    }

    const collectParameters = (list: Node | null): ASTEngine.Parameter[] => {
      const params: ASTEngine.Parameter[] = []
      if (!list) return params
      for (let i = 0; i < list.namedChildCount; i++) {
        const p = list.namedChild(i)
        if (!p) continue
        if (p.type !== "script_parameter" && p.type !== "class_method_parameter") continue
        const varNode = findFirstChild(p, "variable")
        if (!varNode) continue
        const pName = stripDollar(varNode.text)
        params.push({
          name: pName,
          type: typeSpecText(p) || "any",
          isOptional: findFirstChild(p, "script_parameter_default") !== null,
        })
      }
      return params
    }

    const commandNameOf = (node: Node): string => {
      const field = (node as any).childForFieldName?.("command_name")
      if (field) return field.text
      const nameNode = findFirstChild(node, "command_name")
      if (nameNode) return nameNode.text
      const expr = findFirstChild(node, "command_name_expr")
      if (expr) {
        const inner = findFirstChild(expr, "command_name")
        if (inner) return inner.text
        return expr.text
      }
      return ""
    }

    const argumentTokens = (node: Node): string[] => {
      const results: string[] = []
      const elements = findFirstChild(node, "command_elements")
      if (!elements) return results
      for (let i = 0; i < elements.namedChildCount; i++) {
        const c = elements.namedChild(i)
        if (!c) continue
        if (c.type === "command_parameter") continue // flag, not a value
        if (c.type === "generic_token" || c.type === "string_literal" || c.type === "expandable_string_literal") {
          results.push(this.stripQuotes(c.text))
        } else if (c.type === "array_literal_expression" || c.type === "unary_expression") {
          const v = findDescendantVariable(c)
          if (v) results.push(stripDollar(v.text))
          else {
            const lit = this.findQuoted(c)
            if (lit) results.push(this.stripQuotes(lit.text))
          }
        }
      }
      return results
    }

    const commandArgs = (node: Node): string[] => {
      const args = argumentTokens(node)
      // command_parameter values: `-Name Foo` → "Foo" follows the flag.
      const elements = findFirstChild(node, "command_elements")
      if (elements) {
        for (let i = 0; i < elements.namedChildCount; i++) {
          const c = elements.namedChild(i)
          if (!c || c.type !== "command_parameter") continue
          const next = elements.namedChild(i + 1)
          if (next && (next.type === "generic_token" || next.type === "string_literal" || next.type === "expandable_string_literal")) {
            args.push(this.stripQuotes(next.text))
          }
        }
      }
      return args
    }

    const detectFrameworks = (cmdName: string) => {
      const lower = cmdName.toLowerCase()
      if (
        lower.startsWith("get-az") || lower.startsWith("new-az") || lower.startsWith("set-az") ||
        lower.startsWith("remove-az") || lower.startsWith("connect-az") || lower === "az" || lower.startsWith("az_")
      ) frameworks.add("Azure Az Module")
      if (lower.startsWith("get-msol") || lower.startsWith("set-msol") || lower.startsWith("connect-msol"))
        frameworks.add("Azure AD / MSOnline")
      if (
        lower.startsWith("get-exo") || lower.startsWith("set-exo") || lower.startsWith("new-exo") ||
        lower.startsWith("get-mailbox") || lower.startsWith("set-mailbox") || lower.startsWith("enable-mailbox")
      ) frameworks.add("Exchange Online")
      if (
        lower.startsWith("get-sp") || lower.startsWith("set-sp") || lower.startsWith("new-sp") ||
        lower.startsWith("connect-pnp") || lower.startsWith("get-pnp")
      ) frameworks.add("SharePoint PnP")
      if (lower.startsWith("get-ad") || lower.startsWith("set-ad") || lower.startsWith("new-ad") || lower.startsWith("remove-ad"))
        frameworks.add("Active Directory")
      if (lower.startsWith("get-vm") || lower.startsWith("new-vm") || lower.startsWith("start-vm") || lower.startsWith("stop-vm"))
        frameworks.add("VMware / Hyper-V")
      if (lower.startsWith("invoke-rest") || lower.startsWith("invoke-web") || lower === "irm" || lower === "iwr")
        patterns.add("REST API Calls")
      if (lower.startsWith("write-") || lower.startsWith("read-")) patterns.add("I/O Operations")
      if (lower === "get-service" || lower === "stop-service" || lower === "start-service" || lower === "restart-service")
        patterns.add("Service Management")
    }

    // ------------------------------------------------------------- traversal
    const stack: { node: Node; exit: boolean }[] = [{ node: rootNode, exit: false }]
    while (stack.length > 0) {
      const { node, exit } = stack.pop()!
      if (!node) continue

      if (exit) {
        if (
          node.type === "function_statement" ||
          node.type === "class_statement" ||
          node.type === "enum_statement"
        ) {
          ownerStack.pop()
        }
        continue
      }
      stack.push({ node, exit: true })

      if (isBranch(node.type)) cyclomaticComplexity++

      switch (node.type) {
        case "function_statement": {
          const nameNode = findFirstChild(node, "function_name")
          if (!nameNode) break
          const fnName = nameNode.text
          const params = collectParameters(this.findParamList(node) ?? findFirstChild(node, "parameter_list"))
          const attrs = this.collectChildrenByType(node, "attribute")
          const annotations: string[] = []
          for (const attr of attrs) {
            annotations.push(attr.text)
            if (attr.text.includes("CmdletBinding")) patterns.add("Advanced Functions")
            if (attr.text.includes("Parameter")) patterns.add("Parameter Attributes")
            if (attr.text.includes("ValidateSet") || attr.text.includes("ValidateRange") || attr.text.includes("ValidatePattern"))
              patterns.add("Input Validation")
          }
          pushSymbol(fnName, ASTEngine.SymbolKind.Function, node, {
            annotations: annotations.length > 0 ? annotations : undefined,
          }, params)
          ownerStack.push(fnName)
          break
        }

        case "param_block": {
          // A top-level param(...) declares script parameters. Function
          // param blocks are consumed by function_statement.
          if (ownerStack.length === 0) {
            const list = findFirstChild(node, "parameter_list")
            if (list) {
              for (let i = 0; i < list.namedChildCount; i++) {
                const p = list.namedChild(i)
                if (!p || p.type !== "script_parameter") continue
                const varNode = findFirstChild(p, "variable")
                if (varNode) {
                  pushSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, {
                    isScriptParameter: true,
                    type: typeSpecText(p) || "any",
                  })
                }
              }
            }
          }
          break
        }

        case "class_statement": {
          let className = ""
          let baseClass = ""
          const interfaces: string[] = []
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (!child || child.type !== "simple_name") continue
            if (!className) className = child.text
            else if (!baseClass) baseClass = child.text
            else interfaces.push(child.text)
          }
          if (!className) break
          if (baseClass) {
            addRel(className, baseClass, ASTEngine.RelationshipType.Extends, 1.0, { powershellSpecific: true })
          }
          for (const iface of interfaces) {
            addRel(className, iface, ASTEngine.RelationshipType.Implements, 0.85, { powershellSpecific: true })
          }
          pushSymbol(className, ASTEngine.SymbolKind.Class, node)
          ownerStack.push(className)
          break
        }

        case "enum_statement": {
          const nameNode = findFirstChild(node, "simple_name")
          if (!nameNode) break
          pushSymbol(nameNode.text, ASTEngine.SymbolKind.Enum, node)
          ownerStack.push(nameNode.text)
          break
        }

        case "enum_member": {
          const nameNode = findFirstChild(node, "simple_name")
          if (nameNode) pushSymbol(nameNode.text, ASTEngine.SymbolKind.EnumMember, node)
          break
        }

        case "class_method_definition": {
          const nameNode = findFirstChild(node, "simple_name")
          if (!nameNode) break
          const className = currentOwner()
          const isCtor = nameNode.text === className
          const params = collectParameters(this.findMethodParamList(node))
          const isStatic = findFirstChild(node, "class_attribute")?.text === "static"
          pushSymbol(nameNode.text, isCtor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method, node, {
            isStatic,
          }, params)
          break
        }

        case "class_property_definition": {
          const varNode = findFirstChild(node, "variable")
          if (!varNode) break
          const isStatic = findFirstChild(node, "class_attribute")?.text === "static"
          const isHidden = findFirstChild(node, "class_attribute")?.text === "hidden"
          pushSymbol(varNode.text, ASTEngine.SymbolKind.Property, varNode, {
            type: typeSpecText(node) || "any",
            isStatic,
            isHidden,
          })
          break
        }

        case "assignment_expression": {
          const left = findFirstChild(node, "left_assignment_expression")
          if (!left) break
          const varNode = findDescendantVariable(left)
          if (varNode) {
            const raw = varNode.text
            if (!raw.startsWith("$global:") && !raw.startsWith("$script:") && !raw.startsWith("$env:")) {
              pushSymbol(raw, ASTEngine.SymbolKind.Variable, varNode, { isVariable: true })
            }
          }
          break
        }

        case "foreach_statement": {
          const varNode = findFirstChild(node, "variable")
          if (varNode) pushSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, { isLoopVariable: true })
          break
        }

        case "invokation_expression": {
          // [Type]::new() / [Type]::Static(...) — static member invocation.
          const typeLit = findFirstChild(node, "type_literal")
          const member = findFirstChild(node, "member_name")
          if (typeLit) {
            const typeName = typeSpecText(node) || typeLit.text.slice(1, typeLit.text.length > 2 ? -1 : undefined)
            if (!typeName) break
            const memberName = member?.text ?? ""
            if (memberName === "new") {
              addRel(relSource(), typeName, ASTEngine.RelationshipType.Instantiates, 0.9, {
                powershellSpecific: true,
                dotNetNew: true,
              })
            } else if (memberName) {
              addRel(relSource(), `${typeName}::${memberName}`, ASTEngine.RelationshipType.Calls, 0.8, {
                powershellSpecific: true,
                staticMemberCall: true,
              })
            }
            break
          }
          // $obj.Method(...) — object method invocation.
          const receiver = findFirstChild(node, "variable")
          if (member) {
            addRel(relSource(), member.text, ASTEngine.RelationshipType.Calls, 0.6, {
              powershellSpecific: true,
              methodCall: true,
              on: receiver ? stripDollar(receiver.text) : "",
            })
          }
          break
        }

        case "member_access": {
          // Property reads ($obj.Prop) are not declarations or calls — no edge.
          break
        }

        case "command": {
          const op = findFirstChild(node, "command_invokation_operator")
          if (op) {
            // . ./lib.ps1 and & ./run.ps1 — script invocation.
            const target = commandNameOf(node)
            if (target) {
              addRel(relSource(), target, ASTEngine.RelationshipType.Calls, 0.9, {
                powershellSpecific: true,
                invokationOperator: op.text,
              })
            }
            break
          }
          const cmdName = commandNameOf(node)
          if (!cmdName) break

          detectFrameworks(cmdName)

          if (cmdName === "Import-Module" || cmdName === "ipmo") {
            for (const arg of commandArgs(node)) {
              imports.push({
                module: arg,
                items: ["*"],
                isDefault: true,
                range: this.nodeToRange(node),
                metadata: { powershellSpecific: true, via: cmdName },
              })
              addRel("global", arg, ASTEngine.RelationshipType.References, 0.9, {
                powershellSpecific: true,
                import: true,
              })
            }
            break
          }

          if (cmdName === "using") {
            const args = argumentTokens(node)
            if (args.length >= 2) {
              const directive = args[0].toLowerCase()
              const target = args[1]
              const via = directive === "namespace" ? "using namespace" : "using module"
              imports.push({
                module: target,
                items: ["*"],
                isDefault: true,
                range: this.nodeToRange(node),
                metadata: { powershellSpecific: true, via },
              })
              addRel("global", target, ASTEngine.RelationshipType.References, 0.9, {
                powershellSpecific: true,
                import: true,
              })
            }
            break
          }

          if (FLOW_KEYWORDS.has(cmdName)) break

          addRel(relSource(), cmdName, ASTEngine.RelationshipType.Calls, cmdName.includes("-") ? 0.9 : 0.6, {
            powershellSpecific: true,
          })
          break
        }

        case "comment": {
          // #requires -Module Foo — a comment directive (grammar cannot
          // express it); char/index scanning only, no regex.
          const text = node.text
          if (text.startsWith("#requires") || text.startsWith("#Requires")) {
            const moduleName = this.extractRequiresModule(text)
            if (moduleName) {
              imports.push({
                module: moduleName,
                items: ["*"],
                isDefault: true,
                range: this.nodeToRange(node),
                metadata: { powershellSpecific: true, via: "#requires" },
              })
              addRel("global", moduleName, ASTEngine.RelationshipType.References, 0.9, {
                powershellSpecific: true,
                import: true,
              })
            }
          }
          break
        }
      }

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push({ node: child, exit: false })
      }
    }

    // ------------------------------------------------------------- imports
    for (const imp of imports) {
      addRel("global", imp.module || "", ASTEngine.RelationshipType.References, 0.9, {})
    }

    const detectedPatterns = [...patterns]
    const detectedFrameworks = [...frameworks]

    return {
      language: "powershell",
      symbols,
      relationships,
      imports,
      exports,
      errors: [], // engine-owned syntax errors (engine.ts merges treeErrors)
      metadata: {
        complexity: symbols.length + relationships.length,
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
        architecturalScore: Math.min(100, 60 + relationships.length),
        codeQuality: "Excellent",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.0-ps-pure-ast-no-regex",
      },
    }
  }

  // ------------------------------------------------------------- helpers

  private findDescendant(node: Node, type: string): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === type) return n
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return null
  }

  private findParamList(node: Node): Node | null {
    // function_statement → script_block → param_block → parameter_list
    const block = findChildByType(node, "script_block")
    if (block) {
      const paramBlock = findChildByType(block, "param_block")
      if (paramBlock) return findChildByType(paramBlock, "parameter_list")
    }
    return null
  }

  private findMethodParamList(node: Node): Node | null {
    const paramDecl = findChildByType(node, "class_method_parameter_list")
    if (!paramDecl) return null
    // class_method_parameter nodes may sit directly under the list or under a
    // parameter_list wrapper — handle both shapes.
    return findChildByType(paramDecl, "parameter_list") ?? paramDecl
  }

  private stripQuotes(text: string): string {
    if (text.length >= 2) {
      const first = text.charCodeAt(0)
      const last = text.charCodeAt(text.length - 1)
      if ((first === 34 || first === 39) && last === first) return text.slice(1, -1)
    }
    return text
  }

  private findQuoted(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "string_literal" || child.type === "expandable_string_literal") return child
      const nested = this.findQuoted(child)
      if (nested) return nested
    }
    return null
  }

  private extractRequiresModule(text: string): string {
    // char/index scan for `-Module` / `-Modules` followed by a token
    let i = 0
    const n = text.length
    while (i < n) {
      // find `-Module` / `-Modules` (case-insensitive prefix)
      if (text[i] === "-") {
        const rest = text.slice(i + 1).toLowerCase()
        const isModules = rest.startsWith("modules")
        const isModule = !isModules && rest.startsWith("module")
        if (isModules || isModule) {
          // skip the flag itself ("-Module" is 7 chars, "-Modules" is 8)
          let j = i + 1 + (isModules ? 8 : 7)
          while (j < n && (text[j] === " " || text[j] === "\t")) j++
          if (j >= n) return ""
          let end = j
          while (end < n && text[end] !== " " && text[end] !== "\t" && text[end] !== ",") end++
          return this.stripQuotes(text.slice(j, end))
        }
      }
      i++
    }
    return ""
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

// Module-level helper used by class methods above.
function findChildByType(node: Node, type: string): Node | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && child.type === type) return child
  }
  return null
}
