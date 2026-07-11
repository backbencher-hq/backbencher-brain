// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

function findTableAttr(attributes: string[]): string | undefined {
  for (let i = 0; i < attributes.length; i++) {
    if (attributes[i] === "Table" || attributes[i].startsWith("Table(")) {
      return attributes[i];
    }
  }
  return undefined;
}

import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealCSharpAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const frameworks: Record<string, boolean> = {}

    interface Scope {
      node: Node
      name: string
      rawName: string
      kind: SymbolKind
      visibility: "public" | "private" | "protected" | "internal"
      symbolRef?: UniversalSymbol
      isStatic: boolean
    }

    const scopeStack: Scope[] = []

    interface StackItem {
      node: Node
      parentContext?: Scope
      isExit?: boolean
    }

    const stack: StackItem[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    // Track namespace-level symbols for export population
    const namespaceScoped: UniversalSymbol[] = []

    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, parentContext, isExit } = item

      if (isExit) {
        if (parentContext && scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === parentContext) {
          scopeStack.pop()
        }
        continue
      }

      if (node.isMissing || node.hasError) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({
            message: `Syntax ${node.type} detected.`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let newContext = parentContext
      let pushedScope = false
      const type = node.type

      // Complexity metrics
      const complexityNodes = (function(){ const r: Record<string, boolean> = {}; const arr = [
        "if_statement", "for_statement", "foreach_statement", "while_statement", 
        "case_switch_label", "catch_declaration", "conditional_expression", 
        "logical_and_expression", "logical_or_expression"
      ]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })()
      if (!!complexityNodes[type]) {
        cyclomaticComplexity++
      }

      if (type === "using_directive" || type === "using_static_directive") {
        const isStatic = type === "using_static_directive"
        const nameNode =
          this.findChild(node, "identifier") || this.findChild(node, "qualified_name") || this.findChild(node, "name")
        if (nameNode) {
          const text = nameNode.text
          imports.push({
            module: text,
            source: text,
            imported: [],
            range: this.nodeToRange(node),
            isTypeOnly: false,
          })
          // depends: using directive = compile-time dependency
          relationships.push({
            source: "global",
            target: text,
            type: RelationshipType.References,
            confidence: 0.9,
            metadata: { isUsingDirective: true }
          })

          const lowerText = text.toLowerCase()
          if (lowerText.startsWith("system.linq")) patterns["LINQ"] = true
          if (lowerText.startsWith("system.threading.tasks")) patterns["Async/Await"] = true
          if (lowerText.startsWith("microsoft.aspnetcore") || lowerText.startsWith("microsoft.extensions"))
            frameworks["ASP.NET Core"] = true
          if (lowerText.startsWith("microsoft.entityframeworkcore")) frameworks["Entity Framework"] = true
          if (lowerText.startsWith("unityengine")) frameworks["Unity3D"] = true
          if (lowerText.startsWith("xunit") || lowerText.startsWith("nunit")) frameworks["Testing"] = true
          if (text === "Microsoft.AspNetCore.Mvc") patterns["MVC Pattern"] = true
        }
      }

      if (type === "invocation_expression") {
        const methodNode = this.findChild(node, "identifier") || this.findChild(node, "member_access_expression")
        if (methodNode) {
          let targetName = methodNode.text
          let qualifiedName = targetName

          if (methodNode.type === "member_access_expression") {
            // obj.Method() or Class.StaticMethod()
            const nameNode = methodNode.childForFieldName("name")
            const exprNode = methodNode.childForFieldName("expression")
            if (nameNode) {
              if (nameNode.type === "generic_name") {
                targetName = nameNode.childForFieldName("name")?.text || nameNode.text.split("<")[0]
              } else {
                targetName = nameNode.text
              }
              qualifiedName = exprNode ? `${exprNode.text}.${targetName}` : targetName
            }
          }

          const source = parentContext?.name || "global"

          // Skip simple property access disguised as invocation
          relationships.push({
            source,
            target: targetName,
            fromSymbol: source,
            toSymbol: qualifiedName,
            type: RelationshipType.Calls,
            metadata: { qualified: qualifiedName },
          })

          // Minimal API detection
          if (targetName === "MapGet" || targetName === "MapPost" || targetName === "MapPut" || targetName === "MapDelete" || targetName === "MapGroup") {
            patterns["Minimal API"] = true
            const argList = this.findChild(node, "argument_list")
            const firstArg = argList?.namedChild(0)
            let routeTarget = "Route"
            if (firstArg) {
              const stringLit = this.findChild(firstArg, "string_literal") || (firstArg.type === "string_literal" ? firstArg : null)
              if (stringLit) {
                routeTarget = stringLit.text.replace(/"/g, "")
              }
            }
            relationships.push({
              source,
              target: routeTarget,
              type: RelationshipType.Provides,
              metadata: { isMinimalApi: true, httpMethod: targetName.replace("Map", "").toUpperCase() },
            })
          }

          // Dependency Injection detection
          if (targetName === "AddScoped" || targetName === "AddSingleton" || targetName === "AddTransient") {
            const lifetime = targetName.replace("Add", "")
            relationships.push({
              source,
              target: "Service",
              type: RelationshipType.References,
              metadata: { isDependencyInjection: true, lifetime },
            })
          }

          // ASP.NET / Framework detection
          if (targetName === "UseRouting" || targetName === "UseEndpoints" || targetName === "UseAuthorization") {
            frameworks["ASP.NET Core"] = true
          }
          if (qualifiedName.includes("DbContext") || targetName === "SaveChanges") {
            frameworks["Entity Framework"] = true
          }
        }
      }

      if (type === "object_creation_expression") {
        const typeNode = this.extractTypeString(node)
        if (typeNode) {
          const source = parentContext?.name || "global"
          relationships.push({
            source,
            target: typeNode,
            fromSymbol: source,
            toSymbol: typeNode,
            type: RelationshipType.Instantiates,
            metadata: { isNew: true },
          })
        }
      }

      if (type === "lambda_expression") patterns["Lambda"] = true
      if (type === "record_declaration" || type === "record_struct_declaration") patterns["Records"] = true
      if (type === "yield_statement") patterns["Yield Iterators"] = true
      if (type === "await_expression") patterns["Async/Await"] = true
      if (type === "query_expression") patterns["LINQ"] = true

      let visibility: "public" | "private" | "protected" | "internal" =
        parentContext?.kind === SymbolKind.Interface ? "public" : "private"
      let isStatic = false
      let isAsync = false
      let isAbstract = false
      let isVirtual = false
      let isOverride = false
      let isReadOnly = false
      let isConst = false

      const attributes = this.extractAttributes(node)

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "modifier") {
          const text = child.text
          if (text === "public") visibility = "public"
          else if (text === "private") visibility = "private"
          else if (text === "protected") visibility = "protected"
          else if (text === "internal") visibility = "internal"
          else if (text === "static") isStatic = true
          else if (text === "async") isAsync = true
          else if (text === "abstract") isAbstract = true
          else if (text === "virtual") isVirtual = true
          else if (text === "override") isOverride = true
          else if (text === "readonly") isReadOnly = true
          else if (text === "const") isConst = true
        }
      }

      if (type === "namespace_declaration" || type === "file_scoped_namespace_declaration") {
        const rawName = node.childForFieldName("name")?.text || this.childText(node, "identifier") || this.childText(node, "qualified_name") || "anonymous"
        const fullName = this.buildFullName(scopeStack, rawName)

        symbols.push({
          name: rawName,
          kind: SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCSharpNamespace: true, fullName },
        })
        newContext = {
          node,
          name: fullName,
          rawName,
          kind: SymbolKind.Namespace,
          visibility: "public",
          isStatic: false,
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (
        type === "class_declaration" ||
        type === "struct_declaration" ||
        type === "interface_declaration" ||
        type === "record_declaration" ||
        type === "record_struct_declaration"
      ) {
        let rawName = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        
        if (rawName.endsWith("Controller")) {
            patterns["MVC Pattern"] = true
        }
        if (stringIncludes(rawName, "Repository")) {
            patterns["Repository Pattern"] = true
        }

        const fullName = this.buildFullName(scopeStack, rawName)
        const kind = stringIncludes(type, "interface")
          ? SymbolKind.Interface
          : stringIncludes(type, "struct")
            ? SymbolKind.Struct
            : SymbolKind.Class

        const baseClasses: string[] = []
        const baseList = this.findChild(node, "base_list")
        if (baseList) {
          for (let i = 0; i < baseList.namedChildCount; i++) {
            const baseType = baseList.namedChild(i)
            if (baseType) {
              baseClasses.push(baseType.text)
              const isInterfaceBase = baseType.text.startsWith("I") && baseType.text.length > 1 && baseType.text[1] === baseType.text[1].toUpperCase()
              relationships.push({
                source: fullName,
                target: baseType.text,
                type: isInterfaceBase
                  ? RelationshipType.Implements
                  : RelationshipType.Extends,
                metadata: {},
              })
            }
          }
        }
        
        let hasGenericConstraints = false
        const typeParamsNode = this.findChild(node, "type_parameter_list")
        const genericTypes: string[] = []
        if (typeParamsNode) {
            patterns["Generics"] = true
            for(let i = 0; i < typeParamsNode.namedChildCount; i++) {
                const child = typeParamsNode.namedChild(i)
                if (child) genericTypes.push(child.text)
            }
        }
        if (this.findChild(node, "type_parameter_constraints_clause")) {
             hasGenericConstraints = true
             const cc = this.findChild(node, "type_parameter_constraints_clause"); if (cc) { for (let ci = 0; ci < cc.namedChildCount; ci++) { const cn = cc.namedChild(ci); if (cn && cn.type === "type_parameter_constraint") { const ti = this.findChild(cn, "identifier") || this.findChild(cn, "qualified_name"); if (ti && genericTypes.length > 0) { relationships.push({ source: fullName + "." + (genericTypes[0] || "T"), target: ti.text, type: RelationshipType.References, metadata: { isGenericConstraint: true } }) } } } }
             // Extract constraint types as references
             const constraintsClause = this.findChild(node, "type_parameter_constraints_clause")
             if (constraintsClause) {
               for (let ci = 0; ci < constraintsClause.namedChildCount; ci++) {
                 const cn = constraintsClause.namedChild(ci)
                 if (cn && cn.type === "type_parameter_constraint") {
                   const typeId = this.findChild(cn, "identifier") || this.findChild(cn, "qualified_name")
                   if (typeId && genericTypes.length > 0) {
                     relationships.push({
                       source: fullName + "." + (genericTypes[0] || "T"),
                       target: typeId.text,
                       type: RelationshipType.References,
                       metadata: { isGenericConstraint: true },
                     })
                   }
                 }
               }
             }
        }
        
        // Check for Entity Framework Table attribute
        const tableAttr = findTableAttr(attributes)
        if (tableAttr) {
            frameworks["Entity Framework"] = true
            // Extract table name from [Table("name")] — pure string ops
            let tableName = rawName
            const tableIdx = tableAttr.indexOf("Table(")
            if (tableIdx !== -1) {
              const afterTable = tableAttr.substring(tableIdx + 6)
              const quoteIdx = afterTable.indexOf('"')
              if (quoteIdx !== -1) {
                const endQuoteIdx = afterTable.indexOf('"', quoteIdx + 1)
                if (endQuoteIdx !== -1) {
                  tableName = afterTable.substring(quoteIdx + 1, endQuoteIdx)
                }
              }
            }
            relationships.push({
                source: fullName,
                target: tableName,
                type: RelationshipType.References,
                metadata: { isDatabase: true, relationshipType: "mapped_table" }
            })
        }

        const isRecord = stringIncludes(type, "record")
        const paramList = this.findChild(node, "parameter_list")
        if (isRecord && paramList) {
          for (let i = 0; i < paramList.namedChildCount; i++) {
            const p = paramList.namedChild(i)
            if (p && p.type === "parameter") {
              const pName = p.childForFieldName("name")?.text || this.childText(p, "identifier") || "anonymous"
              const pType = this.extractTypeString(p)
              symbols.push({
                name: pName,
                kind: SymbolKind.Property,
                range: this.nodeToRange(p),
                visibility: "public",
                isStatic: false,
                ownerName: rawName,
                ownerKind: kind,
                metadata: { hasGet: true, hasInit: true, dataType: pType, isRecordProperty: true },
              })
            }
          }
        }

        const sym: UniversalSymbol = {
          name: rawName,
          kind,
          range: this.nodeToRange(node),
          visibility,
          isStatic,
          isAbstract,
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          decorators: attributes.length > 0 ? attributes : undefined,
          metadata: {
            isCSharpType: true,
            isStruct: kind === SymbolKind.Struct,
            isValueType: kind === SymbolKind.Struct,
            isRecord,
            baseTypes: baseClasses,
            genericTypes: genericTypes.length > 0 ? genericTypes : undefined,
            hasGenericConstraints,
            fullName
          },
        }
        symbols.push(sym)
        if (!parentContext || parentContext.kind === SymbolKind.Namespace) namespaceScoped.push(sym)
        newContext = { node, name: fullName, rawName, kind, visibility, symbolRef: sym, isStatic }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "enum_declaration") {
        const rawName = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const fullName = this.buildFullName(scopeStack, rawName)
        
        let baseType = undefined
        const baseList = this.findChild(node, "base_list")
        if (baseList) {
           baseType = baseList.namedChild(0)?.text
        }

        const values: string[] = []
        const enumBody = this.findChild(node, "enum_member_declaration_list")
        if (enumBody) {
            for (let i = 0; i < enumBody.namedChildCount; i++) {
                const member = enumBody.namedChild(i)
                if (member && member.type === "enum_member_declaration") {
                    values.push(this.childText(member, "identifier") || member.text)
                }
            }
        }
        
        let hasFlags = false; for(let i=0; i<attributes.length; i++) { if (attributes[i] === "Flags" || attributes[i] === "System.Flags") { hasFlags = true; break; } }

        symbols.push({
          name: rawName,
          kind: SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          decorators: attributes.length > 0 ? attributes : undefined,
          metadata: { isEnum: true, values, baseType, hasFlags, fullName },
        })
        newContext = { node, name: fullName, rawName, kind: SymbolKind.Enum, visibility, isStatic: false }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "enum_member_declaration") {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        symbols.push({
          name,
          kind: SymbolKind.EnumMember,
          range: this.nodeToRange(node),
          visibility: "public",
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          decorators: attributes.length > 0 ? attributes : undefined,
          metadata: {},
        })
      } else if (type === "delegate_declaration") {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const returnType = this.extractTypeString(node) || "void"
        symbols.push({
          name,
          kind: SymbolKind.Function, // or Class? Usually represented as a type or function
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          decorators: attributes.length > 0 ? attributes : undefined,
          metadata: { isDelegate: true, returnType },
        })
      } else if (type === "operator_declaration" || type === "conversion_operator_declaration") {
        symbols.push({
          name: "operator",
          kind: SymbolKind.Method,
          range: this.nodeToRange(node),
          visibility: "public",
          isStatic: true,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          metadata: { isOperatorOverload: true },
        })
      } else if (
        type === "method_declaration" ||
        type === "constructor_declaration" ||
        type === "destructor_declaration"
      ) {
        let name =
          node.childForFieldName("name")?.text ||
          this.childText(node, "identifier") ||
          (type === "constructor_declaration" ? parentContext?.rawName : "anonymous") ||
          "anonymous"

        const returnType =
          type === "constructor_declaration" || type === "destructor_declaration"
            ? "void"
            : this.extractTypeString(node) || "void"

        const parameters: Parameter[] = []
        let isExtensionMethod = false
        const paramList = this.findChild(node, "parameter_list")
        if (paramList) {
          for (let i = 0; i < paramList.namedChildCount; i++) {
            const p = paramList.namedChild(i)
            if (p && p.type === "parameter") {
              const pName = p.childForFieldName("name")?.text || this.childText(p, "identifier") || "anonymous"
              const pType = p.childForFieldName("type")?.text || this.extractTypeString(p)
              if (p.text.startsWith("this ")) {
                  isExtensionMethod = true
                  patterns["Extension Methods"] = true
              }
              parameters.push({
                name: pName,
                type: pType,
              })
            }
          }
        }

        const typeParamsNode = this.findChild(node, "type_parameter_list")
        const genericTypes: string[] = []
        if (typeParamsNode) {
            patterns["Generics"] = true
            for(let i = 0; i < typeParamsNode.namedChildCount; i++) {
                const child = typeParamsNode.namedChild(i)
                if (child) genericTypes.push(child.text)
            }
        }

        symbols.push({
          name,
          kind: type === "constructor_declaration" ? SymbolKind.Constructor : SymbolKind.Method,
          range: this.nodeToRange(node),
          visibility,
          isStatic,
          isAsync,
          isAbstract,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          parameters,
          decorators: attributes.length > 0 ? attributes : undefined,
          metadata: {
            isVirtual,
            isOverride,
            returnType,
            isAsync,
            isExtensionMethod,
            genericTypes: genericTypes.length > 0 ? genericTypes : undefined
          },
        })
        // Push override relationship
        if (isOverride && parentContext?.name) {
          relationships.push({
            source: `${parentContext.name}.${name}`,
            target: name,
            type: RelationshipType.Overrides,
            confidence: 0.9,
            metadata: { isOverride: true }
          })
        }
        newContext = { node, name, rawName: name, kind: SymbolKind.Method, visibility, isStatic }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "member_access_expression" && !parentContext?.node?.type?.includes("invocation")) {
        // Field/member access outside invocation: obj.Field or obj.Property
        const exprNode = node.childForFieldName("expression")
        const nameNode = node.childForFieldName("name")
        if (exprNode && nameNode && parentContext?.name) {
          relationships.push({
            source: parentContext.name,
            target: `${exprNode.text}.${nameNode.text}`,
            type: RelationshipType.Uses,
            confidence: 0.7,
            metadata: { isFieldAccess: true, field: nameNode.text, object: exprNode.text }
          })
        }
      } else if (type === "identifier" && parentContext?.name && !node.text.startsWith("_")) {
        // Simple variable reference (not field access, not invocation function position)
        if (node.parent?.type !== "invocation_expression" && node.parent?.type !== "member_access_expression" && node.parent?.type !== "variable_declarator") {
          relationships.push({
            source: parentContext.name,
            target: node.text,
            type: RelationshipType.References,
            confidence: 0.6,
            metadata: { isVariableRef: true }
          })
        }
      } else if (type === "accessor_declaration") {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || node.text.split(" ")[0] || "accessor"
        newContext = {
          node,
          name,
          rawName: name,
          kind: SymbolKind.Function,
          visibility: "private",
          isStatic: false,
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "property_declaration" || type === "indexer_declaration") {
        const name = type === "indexer_declaration" ? "this" : node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const dataType = this.extractTypeString(node)

        let hasGet = false
        let hasSet = false
        let hasInit = false
        let isAutoProperty = false
        const accessorList = this.findChild(node, "accessor_list")
        if (accessorList) {
          isAutoProperty = true // assume true, verify below
          for (let i = 0; i < accessorList.namedChildCount; i++) {
            const acc = accessorList.namedChild(i)
            if (acc && acc.type === "accessor_declaration") {
              const accText = acc.text
              if (stringIncludes(accText, "get")) hasGet = true
              if (stringIncludes(accText, "set")) hasSet = true
              if (stringIncludes(accText, "init")) hasInit = true
              if (this.findChild(acc, "block") || this.findChild(acc, "arrow_expression_clause")) {
                  isAutoProperty = false
              }
            }
          }
        } else if (this.findChild(node, "arrow_expression_clause")) {
          hasGet = true
        }

        symbols.push({
          name,
          kind: SymbolKind.Property,
          range: this.nodeToRange(node),
          visibility,
          isStatic,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          decorators: attributes.length > 0 ? attributes : undefined,
          metadata: { hasGet, hasSet, hasInit, isAutoProperty, dataType },
        })
      } else if (type === "field_declaration" || type === "event_field_declaration") {
        const dataType = this.extractTypeString(node)
        const varDecl = this.findChild(node, "variable_declaration")
        if (varDecl) {
          for (let i = 0; i < varDecl.namedChildCount; i++) {
            const child = varDecl.namedChild(i)
            if (child && child.type === "variable_declarator") {
              const name = node.childForFieldName("name")?.text || this.childText(child, "identifier") || "anonymous"
              symbols.push({
                name,
                kind: stringIncludes(type, "event") ? SymbolKind.Event : SymbolKind.Property,
                range: this.nodeToRange(node),
                visibility,
                isStatic,
                ownerName: parentContext?.rawName,
                ownerKind: parentContext?.kind,
                decorators: attributes.length > 0 ? attributes : undefined,
                metadata: { isReadonly: isReadOnly, isReadOnly, isConst, dataType, isField: true, isEvent: stringIncludes(type, "event") },
              })
            }
          }
        }
      } else if (
        type === "parameter" &&
        parentContext?.node?.type !== "record_declaration" &&
        parentContext?.node?.type !== "record_struct_declaration" &&
        parentContext?.node?.type !== "method_declaration" &&
        parentContext?.node?.type !== "constructor_declaration" &&
        parentContext?.node?.type !== "destructor_declaration" &&
        parentContext?.node?.type !== "delegate_declaration" &&
        parentContext?.node?.type !== "indexer_declaration"
      ) {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const dataType = node.childForFieldName("type")?.text || this.extractTypeString(node)
        symbols.push({
          name,
          kind: SymbolKind.Variable,
          range: this.nodeToRange(node),
          visibility: "private",
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          metadata: { isParameter: true, dataType },
        })
      } else if (type === "local_declaration_statement") {
        const varDecl = this.findChild(node, "variable_declaration")
        if (varDecl) {
          const dataType = this.extractTypeString(varDecl)
          for (let i = 0; i < varDecl.namedChildCount; i++) {
            const child = varDecl.namedChild(i)
            if (child && child.type === "variable_declarator") {
              const name = node.childForFieldName("name")?.text || this.childText(child, "identifier") || "anonymous"
              symbols.push({
                name,
                kind: SymbolKind.Variable,
                range: this.nodeToRange(node),
                visibility: "private",
                ownerName: parentContext?.rawName,
                ownerKind: parentContext?.kind,
                metadata: { isLocal: true, dataType },
              })
            }
          }
        }
      }

      if (pushedScope) {
        stack.push({ node, parentContext: newContext, isExit: true })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parentContext: newContext })
        }
      }
    }

    for (const s of namespaceScoped) { if (s.visibility !== "private") exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" }) }

    // Post-loop: add contains for owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        cyclomaticComplexity,
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        patterns: (() => { const arr: string[] = []; for (const p in patterns) arr.push(p); return arr; })(),
        detectedFrameworks: (() => { const arr: string[] = []; for (const f in frameworks) arr.push(f); return arr; })(),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "4.0.2-stateless-dfs-final",
      },
    }
  }

  private buildFullName(scopeStack: { rawName: string }[], name: string): string {
    if (scopeStack.length === 0) return name
    let res = ""; for (let i = 0; i < scopeStack.length; i++) { res += scopeStack[i].rawName + "."; } return res + name;
  }

  private extractTypeString(node: Node): string | undefined {
    const typeNodes = [
      "predefined_type",
      "type_identifier",
      "identifier",
      "generic_name",
      "array_type",
      "nullable_type",
      "tuple_type",
      "implicit_type",
    ]
    for (let idx = 0; idx < typeNodes.length; idx++) {
      const t = typeNodes[idx];
      const found = this.findChild(node, t)
      if (found) return found.text
    }
    return undefined
  }

  private extractAttributes(node: Node): string[] {
    const attrs: string[] = []
    const attrLists = this.findAllChildren(node, "attribute_list")
    for (let idx = 0; idx < attrLists.length; idx++) {
      const list = attrLists[idx];
      for (let i = 0; i < list.namedChildCount; i++) {
        const attr = list.namedChild(i)
        if (attr && attr.type === "attribute") {
          const nameNode = this.findChild(attr, "identifier") || this.findChild(attr, "qualified_name") || this.findChild(attr, "name")
          let attrText = nameNode?.text || attr.text
          if (stringIncludes(attr.text, "(")) {
             attrText = attr.text
          }
          if (attrText) attrs.push(attrText)
        }
      }
    }
    return attrs
  }

  private nodeToRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private findChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private findAllChildren(node: Node, type: string): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) res.push(child)
    }
    return res
  }

  private childText(node: Node, type: string): string | null {
    const child = this.findChild(node, type)
    return child ? child.text : null
  }
}
