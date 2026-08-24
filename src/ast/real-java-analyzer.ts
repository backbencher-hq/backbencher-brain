function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

/** Split on a single delimiter character by walk (no regex). */
function splitByChar(text: string, delim: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === delim) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out
}

/** Split into whitespace-delimited tokens by walk (no regex). */
function tokenizeWhitespace(text: string): string[] {
  const out: string[] = []
  let cur = ""
  const flush = () => {
    if (cur) {
      out.push(cur)
      cur = ""
    }
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      flush()
    } else {
      cur += ch
    }
  }
  flush()
  return out
}

/** Strip leading @Annotation prefixes (and trailing spaces) by walk. */
function stripJavaAnnotations(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === "@") {
      // Skip the annotation name (word chars and dots), then any whitespace.
      i++
      while (i < text.length) {
        const c = text[i]
        const isWord = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "."
        if (!isWord) break
        i++
      }
      // Also consume a balanced (...) argument list — @NotNull(message = "x")
      // must not leave its arguments behind as phantom type text.
      while (i < text.length && text[i] === " ") i++
      if (text[i] === "(") {
        let depth = 0
        while (i < text.length) {
          if (text[i] === "(") depth++
          else if (text[i] === ")") { depth--; if (depth === 0) { i++; break } }
          i++
        }
      }
      while (i < text.length && (text[i] === " " || text[i] === "\t")) i++
      continue
    }
    out += ch
    i++
  }
  return out
}

function inArray(arr: any[], val: any): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === val) return true
  }
  return false
}

// Real Java Intelligence Engine
// AST analysis for Java language (Mathematically Perfect O(N) Iterative State Machine)

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

export class RealJavaAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const frameworks: Record<string, boolean> = {}
    const patterns: Record<string, boolean> = {}
    let currentPackage = ""
    let cyclomaticComplexity = 0

    // O(1) Quick Lookups
    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    const classHierarchy = new Map<string, string[]>()
    const overrideTasks: { fqn: string; methodName: string; signature: string; ownerFqn: string }[] = []

    interface Scope {
      node: Node
      name: string
      kind: ASTEngine.SymbolKind
      fqn: string
      symbolRef?: ASTEngine.UniversalSymbol
      visibility: "public" | "private" | "protected" | undefined
      isAbstract: boolean
      isInterface: boolean
      isRecord: boolean
      annotations: string[]
      fields: ASTEngine.UniversalSymbol[]
      parents: string[]
    }

    const scopeStack: Scope[] = []

    interface StackItem {
      node: Node
      parentContext?: Scope
      isExit?: boolean
    }

    const stack: StackItem[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, parentContext, isExit } = item

      if (isExit) {
        if (parentContext) {
          this.processPhantomSymbols(parentContext, symbols, symbolMap, frameworks)
          if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === parentContext) {
            scopeStack.pop()
          }
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
      const type = node.type
      let pushedScope = false

      if (
        type === "if_statement" ||
        type === "for_statement" ||
        type === "while_statement" ||
        type === "catch_clause" ||
        type === "switch_block_statement_group" ||
        type === "ternary_expression"
      ) {
        cyclomaticComplexity++
      }

      if (type === "package_declaration") {
        const pkgName = this.childText(node, "scoped_identifier") || this.childText(node, "identifier")
        if (pkgName) currentPackage = pkgName
      } else if (type === "import_declaration") {
        const importText = node.text
        const isStatic = importText.indexOf("static ") !== -1
        const isAsterisk = importText.indexOf(".*") !== -1
        
        let moduleName = this.childText(node, "scoped_identifier") || this.childText(node, "identifier")
        if (moduleName) {
          imports.push({
            module: moduleName,
            items: [],
            isDefault: false,
            range: this.nodeToRange(node),
            isNamespace: isAsterisk,
            metadata: { isWildcard: isAsterisk, isStatic }
          })
          this.detectFrameworksFromImport(moduleName, frameworks)
          // DependsOn for imports. The source is resolved to the file's primary
          // type at the end of analysis (imports precede the type declaration,
          // so the type name is not known yet at this point).
          relationships.push({
            source: currentPackage || "root",
            target: moduleName,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            metadata: { isJavaImport: true, isWildcard: isAsterisk },
          })
        }
      }

      else if (
        type === "class_declaration" ||
        type === "record_declaration" ||
        type === "interface_declaration" ||
        type === "enum_declaration"
      ) {
        const name = this.childText(node, "identifier")
        if (name) {
          const kind = this.mapTypeToSymbolKind(type)
          const modifiers = this.getJavaModifiers(node)
          const annotations = this.getJavaAnnotations(node)
          const visibility = this.getJavaVisibility(modifiers)
          const fqn = this.buildFqn(currentPackage, scopeStack, name)

          const inheritance = this.extractJavaInheritance(node)
          const parents: string[] = []
          if (inheritance.extendsClass) parents.push(inheritance.extendsClass)
          for (let i = 0; i < inheritance.extendsInterfaces.length; i++) {
            parents.push(inheritance.extendsInterfaces[i])
          }
          for (let i = 0; i < inheritance.implementsInterfaces.length; i++) {
            parents.push(inheritance.implementsInterfaces[i])
          }
          classHierarchy.set(fqn, parents)

          // Sealed hierarchy: sealed class → permitted subtype. Direction is
          // parent→child (opposite of inheritance edges) and the subtypes are
          // deliberately NOT added to classHierarchy.parents.
          for (let k = 0; k < inheritance.permitsSubtypes.length; k++) {
            relationships.push({
              source: name,
              target: inheritance.permitsSubtypes[k],
              type: ASTEngine.RelationshipType.References,
              confidence: 1.0,
              metadata: { relationshipType: "permits" },
            })
          }

          if (inheritance.extendsClass) {
            relationships.push({
              source: name,
              target: inheritance.extendsClass,
              type: ASTEngine.RelationshipType.Inheritance,
              confidence: 1.0,
              metadata: { relationshipType: type === "interface_declaration" ? "extends_interface" : "extends" },
            })
          }
          // JLS 9.1.3: every interface in an interface's extends clause is inheritance
          for (let k = 0; k < inheritance.extendsInterfaces.length; k++) { const iface = inheritance.extendsInterfaces[k]
            relationships.push({
              source: name,
              target: iface,
              type: ASTEngine.RelationshipType.Inheritance,
              confidence: 1.0,
              metadata: { relationshipType: "extends_interface" },
            })
          }
          for (let k = 0; k < inheritance.implementsInterfaces.length; k++) { const iface = inheritance.implementsInterfaces[k]
            relationships.push({
              source: name,
              target: iface,
              type: ASTEngine.RelationshipType.Implementation,
              confidence: 1.0,
              metadata: { relationshipType: "implements" },
            })
          }

          const annNames = this.getJavaAnnotationNames(node)
          let isSpringBean = false
          let isEntity = false
          for (let i = 0; i < annNames.length; i++) {
            const n = annNames[i]
            if (n === "Service" || n === "Repository" || n === "RestController" || n === "Component") isSpringBean = true
            if (n === "Entity" || n === "Table") isEntity = true
          }
          let tableName = name.toLowerCase()
          
          if (isEntity) {
            frameworks["jpa"] = true
            patterns["entity_pattern"] = true
            // Table presence is decided by annotation NAME (AST-resolved, works
            // for fully-qualified annotations), never by raw-text prefix match.
            if (inArray(annNames, "Table")) {
              const n = this.getAnnotationValue(node, "Table", "name")
              if (n) tableName = n
            }
            relationships.push({
              source: name,
              target: tableName,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              metadata: { isDatabase: true, relationshipType: "mapped_table", table: tableName },
            })
          }

          if (isSpringBean) {
             frameworks["spring"] = true;
             for (let i = 0; i < annNames.length; i++) {
                const a = annNames[i]
                if (a === "Service") { patterns["service_layer"] = true; break; }
                if (a === "Repository") { patterns["repository_pattern"] = true; break; }
                if (a === "RestController" || a === "Controller") { patterns["mvc_pattern"] = true; break; }
             }
          }

          // FeignClient presence by AST-resolved name; value read via the
          // same name-matched path.
          if (inArray(annNames, "FeignClient")) {
            const targetService = this.getAnnotationValue(node, "FeignClient", "name") || this.getAnnotationValue(node, "FeignClient", "value")
            if (targetService) {
              relationships.push({
                source: name,
                target: targetService,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 1.0,
                metadata: { isFeignClient: true, microservice: targetService },
              })
            }
          }

          const javadoc = this.extractJavadocComment(node)
          const sym: ASTEngine.UniversalSymbol = {
            name,
            kind,
            range: this.nodeToRange(node),
            visibility,
            comments: javadoc ? [javadoc] : [],
            decorators: annotations,
            genericParameters: this.getJavaGenericParameters(node),
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: {
              nodeType: type,
              modifiers,
              annotations,
              isPublic: visibility === "public",
              isAbstract: modifiers.indexOf("abstract") !== -1 || type === "interface_declaration",
              ...(isSpringBean ? { spring_bean: true } : {})
            },
          }

          if (type === "record_declaration") {
            sym.parameters = this.extractJavaParameters(node, relationships, name)
            // Record components are constructor-backed members (JLS 8.10.3): emit
            // each as a Property symbol so they are first-class like fields.
            const formalParams = this.findChildByType(node, "formal_parameters")
            if (formalParams) {
              for (let i = 0; i < formalParams.namedChildCount; i++) {
                const comp = formalParams.namedChild(i)
                if (!comp) continue
                // Varargs record components (record Foo(int... xs)) are
                // spread_parameter nodes; their name lives in the trailing
                // variable_declarator, not a "name" field.
                if (comp.type !== "formal_parameter" && comp.type !== "spread_parameter") continue
                const compName =
                  comp.type === "spread_parameter"
                    ? (() => {
                        const decl = this.findChildByType(comp, "variable_declarator")
                        return decl ? this.findChildByType(decl, "identifier") : null
                      })()
                    : comp.childForFieldName("name")
                if (!compName) continue
                let compReturnType: string | undefined = undefined
                if (comp.type === "spread_parameter") {
                  for (let cIdx = 0; cIdx < comp.namedChildCount; cIdx++) {
                    const c = comp.namedChild(cIdx)
                    if (c && c.type !== "modifiers" && !stringIncludes(c.type, "annotation") && c.type !== "variable_declarator") {
                      compReturnType = c.text + "[]"
                      break
                    }
                  }
                } else {
                  compReturnType = this.extractJavaParameterType(comp)
                }
                const compSym: ASTEngine.UniversalSymbol = {
                  name: compName.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(comp),
                  returnType: compReturnType,
                  visibility: "public",
                  ownerName: name,
                  ownerKind: kind,
                  metadata: { nodeType: "record_component" },
                }
                symbols.push(compSym)
              }
            }
          }

          symbols.push(sym)
          symbolMap.set(fqn, sym)
          symbolMap.set(name, sym)

          newContext = {
            node,
            name,
            kind,
            fqn,
            symbolRef: sym,
            visibility,
            isAbstract: inArray(modifiers, "abstract"),
            isInterface: type === "interface_declaration",
            isRecord: type === "record_declaration",
            annotations,
            fields: [],
            parents
          }
          scopeStack.push(newContext)
          pushedScope = true
        }
      }

      else if (type === "method_declaration" || type === "constructor_declaration" || type === "compact_constructor_declaration") {
        const nameNode = this.findChildByType(node, "identifier")
        const name = nameNode ? nameNode.text : null

        if (name) {
          const isConstructor = type !== "method_declaration"
          // Compact record constructors (E { ... }) declare no parameter list;
          // their parameters are implicitly the record components.
          const isCompactCtor = type === "compact_constructor_declaration"
          const modifiers = this.getJavaModifiers(node)
          const annotations = this.getJavaAnnotations(node)
          const visibility = this.getJavaVisibility(modifiers)

          const parameters = isCompactCtor && parentContext
            ? this.extractJavaParameters(parentContext.node, relationships, parentContext.name)
            : this.extractJavaParameters(node, relationships, parentContext ? parentContext.name : undefined)
                    let sigParams = ""
          for (let i = 0; i < parameters.length; i++) {
             if (i > 0) sigParams += ","
             sigParams += parameters[i].type || "unknown"
          }
          const signature = `(${sigParams})`

          const fqn = parentContext ? `${parentContext.fqn}.${name}${signature}` : `${name}${signature}`
          const localOwnerPrefix = parentContext ? `${parentContext.name}.${name}${signature}` : `${name}${signature}`
          const returnType = isConstructor ? undefined : this.extractJavaReturnType(node)
          
          let isApiEndpoint = false
          let fullRoute = ""
          
          let mappingAnnotation = ""
          const methodAnnNames = this.getJavaAnnotationNames(node)
          for (let i = 0; i < methodAnnNames.length; i++) {
             const n = methodAnnNames[i]
             if (n === "GetMapping" || n === "PostMapping" || n === "PutMapping" || n === "DeleteMapping" || n === "PatchMapping" || n === "RequestMapping" || n === "Path") {
                mappingAnnotation = n
                break
             }
          }
          
          if (mappingAnnotation) {
            isApiEndpoint = true
            let httpMethod = "GET"
            if (mappingAnnotation === "PostMapping") httpMethod = "POST"
            else if (mappingAnnotation === "PutMapping") httpMethod = "PUT"
            else if (mappingAnnotation === "DeleteMapping") httpMethod = "DELETE"
            else if (mappingAnnotation === "PatchMapping") httpMethod = "PATCH"
            else if (mappingAnnotation === "RequestMapping" || mappingAnnotation === "Path") httpMethod = "ANY"

            const methodRoute = this.getAnnotationValue(node, mappingAnnotation, "value") || this.getAnnotationValue(node, mappingAnnotation, "path") || ""

            let basePath = ""
            if (parentContext) {
              const classAnnNames = this.getJavaAnnotationNames(parentContext.node)
              let classMapping = ""
              for (let i = 0; i < classAnnNames.length; i++) {
                 if (classAnnNames[i] === "RequestMapping" || classAnnNames[i] === "Path") {
                    classMapping = classAnnNames[i]
                    break
                 }
              }
              if (classMapping) {
                basePath = this.getAnnotationValue(parentContext.node, classMapping, "value") || this.getAnnotationValue(parentContext.node, classMapping, "path") || ""
              }
            }
            // Collapse repeated slashes in the composed route (pure string normalization).
            // Assigns to the method-scoped fullRoute declared above — redeclaring
            // here shadowed it and left apiContractPath permanently "".
            fullRoute = ""
            for (let i = 0; i < basePath.length + methodRoute.length; i++) {
              const ch = i < basePath.length ? basePath[i] : methodRoute[i - basePath.length]
              if (ch === "/" && fullRoute.length > 0 && fullRoute[fullRoute.length - 1] === "/") continue
              fullRoute += ch
            }
            if (!fullRoute.startsWith("/")) fullRoute = "/" + fullRoute

            relationships.push({
              source: localOwnerPrefix,
              target: fullRoute,
              type: ASTEngine.RelationshipType.Exports,
              confidence: 1.0,
              metadata: { isApiEndpoint: true, httpMethod, route: fullRoute },
            })
            frameworks["spring_mvc"] = true
          }

          let dbMapping = ""
          const methodDbAnnNames = this.getJavaAnnotationNames(node)
          for (let idx = 0; idx < methodDbAnnNames.length; idx++) {
             const n = methodDbAnnNames[idx]
             if (n === "Column" || n === "OneToMany" || n === "ManyToOne" || n === "OneToOne" || n === "ManyToMany") { dbMapping = n; break; }
          }
          if (dbMapping && parentContext) {
            let target = name.startsWith("get") ? name.charAt(3).toLowerCase() + name.slice(4) : name
            const explicit = this.getAnnotationValue(node, dbMapping, "name")
            if (explicit) target = explicit
            
            relationships.push({
              source: localOwnerPrefix,
              target,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              metadata: { isDatabase: true, relationshipType: "mapped_column" },
            })
          }

          const hasBody = !!this.findChildByType(node, "block")
          const isAbstract = modifiers.indexOf("abstract") !== -1 || !!(parentContext?.isInterface && !hasBody && modifiers.indexOf("default") === -1)

          if (annotations.indexOf("@Override") !== -1 && parentContext) {
             overrideTasks.push({
               fqn,
               methodName: name,
               signature,
               ownerFqn: parentContext.fqn
             })
          }

          const methodDoc = this.extractJavadocComment(node)
          const sym: ASTEngine.UniversalSymbol = {
            name: isConstructor ? "constructor" : name,
            kind: isConstructor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            comments: methodDoc ? [methodDoc] : [],
            visibility,
            parameters,
            returnType,
            qualified_calls: [],
            apiContractPath: isApiEndpoint ? fullRoute : undefined,
            isStatic: modifiers.indexOf("static") !== -1,
            isAbstract,
            decorators: annotations,
            genericParameters: this.getJavaGenericParameters(node),
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { nodeType: type, modifiers, annotations },
          }

          symbols.push(sym)
          symbolMap.set(fqn, sym)
          symbolMap.set(localOwnerPrefix, sym)

          newContext = {
            node,
            name,
            kind: ASTEngine.SymbolKind.Method,
            fqn,
            symbolRef: sym,
            visibility,
            isAbstract,
            isInterface: false,
            isRecord: false,
            annotations,
            fields: [],
            parents: []
          }
          scopeStack.push(newContext as Scope)
          pushedScope = true
        }
      }

      else if (type === "field_declaration") {
        const modifiers = this.getJavaModifiers(node)
        const annotations = this.getJavaAnnotations(node)
        const visibility = this.getJavaVisibility(modifiers)
        const isStatic = inArray(modifiers, "static")
        const isConstant = modifiers.indexOf("final") !== -1 && isStatic
        const fieldType = this.extractJavaFieldType(node)

        const declarators = this.findAllChildrenByType(node, "variable_declarator")
        for (let decIdx = 0; decIdx < declarators.length; decIdx++) { const declarator = declarators[decIdx]
          const nameNode = this.findChildByType(declarator, "identifier")
          if (nameNode && parentContext) {
            const fieldName = nameNode.text
            const localOwnerPrefix = `${parentContext.name}.${fieldName}`

            const fieldDbAnnNames = this.getJavaAnnotationNames(node)
            let dbMapping = ""
            for (let idx = 0; idx < fieldDbAnnNames.length; idx++) {
               const n = fieldDbAnnNames[idx]
               if (n === "Column" || n === "OneToMany" || n === "ManyToOne" || n === "OneToOne" || n === "ManyToMany") { dbMapping = n; break; }
            }
            if (dbMapping) {
              let target = fieldName
              const explicit = this.getAnnotationValue(node, dbMapping, "name")
              if (explicit) target = explicit
              
              relationships.push({
                source: localOwnerPrefix,
                target,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 1.0,
                metadata: { isDatabase: true, relationshipType: "mapped_column" },
              })
            }

            if (inArray(this.getJavaAnnotationNames(node), "Value")) {
              const valMatch = this.getAnnotationValue(node, "Value", "value")
              if (valMatch && valMatch.startsWith("${") && valMatch.endsWith("}")) {
                let configKey = valMatch.substring(2, valMatch.length - 1)
                if (stringIncludes(configKey, ":")) configKey = configKey.split(":")[0]
                relationships.push({
                  source: localOwnerPrefix,
                  target: configKey,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 1.0,
                  metadata: { isConfiguration: true, relationshipType: "config_property" }
                })
              }
            }

            const fieldDoc = this.extractJavadocComment(node)
            const sym: ASTEngine.UniversalSymbol = {
              name: fieldName,
              kind: isConstant ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(declarator),
              comments: fieldDoc ? [fieldDoc] : [],
              returnType: fieldType,
              visibility,
              isStatic,
              decorators: annotations,
            genericParameters: this.getJavaGenericParameters(node),
              ownerName: parentContext.name,
              ownerKind: parentContext.kind,
              metadata: { nodeType: type, modifiers, annotations, isConstant },
            }

            symbols.push(sym)
            parentContext.fields.push(sym)
          }
        }
      }

      else if (type === "enum_constant") {
        const nameNode = this.findChildByType(node, "identifier")
        if (nameNode && parentContext) {
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: parentContext.name,
            ownerKind: parentContext.kind,
            metadata: { nodeType: type }
          })
        }
      }

      else if (type === "method_invocation") {
         if (parentContext && parentContext.kind === ASTEngine.SymbolKind.Method && parentContext.symbolRef) {
            const callExpression = this.buildJavaCallExpression(node)
            if (callExpression && !this.isJavaBuiltin(callExpression)) {
              if (!parentContext.symbolRef.qualified_calls) parentContext.symbolRef.qualified_calls = []
              parentContext.symbolRef.qualified_calls.push(callExpression)
              relationships.push({
                source: parentContext.name || parentContext.symbolRef.name,
                target: callExpression.split(".").pop() || callExpression,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.7,
                metadata: { javaCallExpression: callExpression },
              })
              // JLS 4.12.5/15.9: Java objects are created ONLY by `new`
              // (object_creation_expression, handled separately). A
              // method_invocation is never an instantiation — PascalCase method
              // names are idiomatic (JsonObject(), DateUtils.now()), so a
              // name-shape heuristic here fabricated edges on real code
              // (measured: 4.2% of instantiation edges in the grails-core
              // sample were fabrications). Deliberately removed, M14.1.
            }
         }
      }

      else if (type === "object_creation_expression") {
        // new Foo() → Instantiates relationship. The type node is a
        // type_identifier for plain types, a generic_type for diamond
        // constructions (new HashMap<>()), and a scoped_type_identifier for
        // qualified or inner-class constructions (new java.util.ArrayList(),
        // new Outer.Builder()) — all must be handled or those instantiations
        // are silently dropped.
        const typeNode = this.findChildByType(node, "type_identifier") || this.findChildByType(node, "generic_type") || this.findChildByType(node, "scoped_type_identifier") || this.findChildByType(node, "identifier")
        if (typeNode) {
          const source = parentContext?.name || parentContext?.symbolRef?.name || "global"
          const typeName = typeNode.type === "identifier" ? typeNode.text : this.extractJavaTypeBaseName(typeNode)
          relationships.push({
            source,
            target: typeName,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { relationshipType: "instantiates", isNew: true },
          })
        }
      }

      if (type === "identifier") {
         if (node.text === "Singleton" || node.text.endsWith("Factory") || node.text.endsWith("Builder")) {
            const pat = node.text.endsWith("Factory") ? "factory" : node.text === "Singleton" ? "singleton" : "builder"
            patterns[pat] = true
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

    this.resolveOverrides(overrideTasks, classHierarchy, symbolMap, relationships, context?.overrideCompanion)

    // Rewrite import-reference sources from the package name to the file's
    // primary type (the first top-level type declared). Imports precede the
    // type declaration in source order, so this post-pass is required to give
    // references a symbol identity instead of a package identity.
    const primaryType = symbols.find((s) => {
      if (s.ownerName || s.scope) return false
      return s.kind === ASTEngine.SymbolKind.Class ||
             s.kind === ASTEngine.SymbolKind.Interface ||
             s.kind === ASTEngine.SymbolKind.Enum
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && (rel.source === currentPackage || rel.source === "root")) {
          rel.source = primaryType.name
        }
      }
    }

    const finalFrameworks: string[] = []
    for (const k in frameworks) finalFrameworks.push(k)
    const finalPatterns: string[] = []
    for (const k in patterns) finalPatterns.push(k)
    
    let hasSpring = false
    for (let i = 0; i < finalFrameworks.length; i++) {
       if (finalFrameworks[i] === "spring") { hasSpring = true; break; }
    }
    
    if (hasSpring) {
      let hasSpringCore = false
      for (let i = 0; i < symbols.length; i++) {
         if (this.hasJavaAnnotation(symbols[i], "Service") || this.hasJavaAnnotation(symbols[i], "Repository") || this.hasJavaAnnotation(symbols[i], "Component")) {
             hasSpringCore = true; break;
         }
      }
      if (hasSpringCore) finalFrameworks.push("spring_core")
    }

    // Add Contains relationships: owner → owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: { isContained: true },
        })
      }
    }

    // Add Uses relationships for field accesses (this.name, obj.method)
    this.collectFieldAccessUses(rootNode, relationships, symbols)

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (!s.metadata?.isPhantom && s.visibility === "public" && (!s.ownerName || s.ownerKind === ASTEngine.SymbolKind.Class)) {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility })
      }
    }
    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: finalFrameworks[0],
        patterns: finalPatterns,
        currentPackage,
        detectedFrameworks: finalFrameworks,
        frameworkPatterns: this.getJavaFrameworkPatterns(finalFrameworks, symbols),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "4.0.0-java-perfect-stateless",
      },
    }
  }

  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && predicate(child)) return child;
      }
      return null;
    }
  
    private filterChildren(node: Node, predicate: (child: Node) => boolean): Node[] {
      const res: Node[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && predicate(child)) res.push(child);
      }
      return res;
    }



  private resolveOverrides(
    tasks: { fqn: string; methodName: string; signature: string; ownerFqn: string }[],
    classHierarchy: Map<string, string[]>,
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    relationships: ASTEngine.UniversalRelationship[],
    companion?: Map<string, Set<string>>
  ) {
    for (let taskIdx = 0; taskIdx < tasks.length; taskIdx++) { const task = tasks[taskIdx]
      let targetFqn: string | null = null
      // Confidence reflects EVIDENCE TIER, and it is consumed downstream
      // (patterns.ts filters relationships at >= 0.7): pass 1 is an exact
      // in-file signature match, pass 2 uses project-level companion
      // evidence, pass 3 is a guess — the first hierarchy parent, which may
      // not even declare the method. Guesses at confidence 1.0 were
      // indistinguishable from verified overrides in pattern analysis.
      let confidence = 1.0

      // Pass 1: exact-signature BFS over the hierarchy (in-file declarations;
      // works without any project context).
      const queue: string[] = []
      const ownerH = classHierarchy.get(task.ownerFqn)
      if (ownerH) {
         for (let i = 0; i < ownerH.length; i++) queue.push(ownerH[i])
      }
      const seen: Set<string> = new Set()

      while (queue.length > 0) {
        const parent = queue.shift()!
        if (seen.has(parent)) continue
        seen.add(parent)

        const potentialTargetFqn = `${parent}.${task.methodName}${task.signature}`
        if (symbolMap.has(potentialTargetFqn)) {
           targetFqn = potentialTargetFqn
           break
        }
        
        const pH = classHierarchy.get(parent)
        if (pH) {
           for (let i = 0; i < pH.length; i++) queue.push(pH[i])
        }
      }

      // Pass 2: declaring-parent resolution via the project companion index
      // (cross-file parents, and generic-signature mismatches like save(T) vs
      // save(User)). Matches Java semantics: the first ancestor in declaration
      // order that actually declares the method — interface-over-superclass
      // when the interface is the declaring parent.
      if (!targetFqn && companion && ownerH && ownerH.length > 0) {
        const declaring = findDeclaringParent(
          task.methodName,
          ownerH,
          companion,
          (t) => classHierarchy.get(t) ?? [],
        )
        if (declaring) {
          targetFqn = `${declaring}.${task.methodName}${task.signature}`
          confidence = 0.85
        }
      }

      // Pass 3: deterministic per-file fallback — first hierarchy parent. Only
      // reached when no context was provided or no ancestor declares the
      // method (the true declaring parent is unknowable from this file alone).
      if (!targetFqn && ownerH && ownerH.length > 0) {
        targetFqn = `${ownerH[0]}.${task.methodName}${task.signature}`
        // Below the patterns.ts default confidenceThreshold (0.7): visible in
        // raw output, but never contaminating thresholded analysis.
        confidence = 0.5
      }

      if (targetFqn) {
        const localSource = task.fqn.split('(')[0].split('.').slice(-2).join('.')
        const localTarget = targetFqn.split('(')[0].split('.').slice(-2).join('.')

        relationships.push({
          source: localSource,
          target: localTarget,
          type: ASTEngine.RelationshipType.Overrides,
          confidence,
          metadata: { relationshipType: "method_override", isJavaOverride: true },
        })
      }
    }
  }

  private processPhantomSymbols(
    scope: any, 
    symbols: ASTEngine.UniversalSymbol[], 
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    frameworks: Record<string, boolean>
  ) {
    const isSpringData = frameworks["spring_data"] || frameworks["spring"]

    if (isSpringData && scope.isInterface) {
      let isRepo = false
      for (let i = 0; i < scope.parents.length; i++) {
         if (scope.parents[i].indexOf("JpaRepository") !== -1 || scope.parents[i].indexOf("CrudRepository") !== -1) {
            isRepo = true; break;
         }
      }
      if (isRepo) {
        const defaultMethods = ["save", "findById", "findAll", "deleteById", "delete", "count"]
        for (let j = 0; j < defaultMethods.length; j++) {
          const method = defaultMethods[j]
          const sym = {
            name: method,
            kind: ASTEngine.SymbolKind.Method,
            scope: scope.name,
            ownerName: scope.name,
            ownerKind: ASTEngine.SymbolKind.Interface,
            modifiers: ["phantom", "framework_generated", "spring-data"],
            range: scope.node ? this.nodeToRange(scope.node) : { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            parameters: [],
            returnType: "Object",
            metadata: { isPhantom: true },
          }
          symbols.push(sym)
                    let phantomSig = "()"
          if (method === "findById" || method === "deleteById" || method === "save" || method === "delete") {
             phantomSig = "(Object)"
          }
          symbolMap.set(`${scope.fqn}.${method}${phantomSig}`, sym)
        }
      }
    }

    if (!scope.isInterface && !scope.isEnum) {
      let isDataOrGetter = false
      let isDataOrSetter = false
      for (let i = 0; i < scope.annotations.length; i++) {
         const d = scope.annotations[i]
         if (d.indexOf("Data") !== -1 || d.indexOf("Getter") !== -1) isDataOrGetter = true
         if (d.indexOf("Data") !== -1 || d.indexOf("Setter") !== -1) isDataOrSetter = true
      }

      if (isDataOrGetter || isDataOrSetter) {
        for (let idx = 0; idx < scope.fields.length; idx++) {
          const prop = scope.fields[idx]
          const capitalizedName = prop.name.charAt(0).toUpperCase() + prop.name.slice(1)
          
          if (isDataOrGetter) {
            const sym = {
              name: `get${capitalizedName}`,
              kind: ASTEngine.SymbolKind.Method,
              scope: scope.name,
              ownerName: scope.name,
              ownerKind: ASTEngine.SymbolKind.Class,
              modifiers: ["phantom", "lombok_generated"],
              range: prop.range,
              parameters: [],
              returnType: prop.returnType || "Object",
              metadata: { isPhantom: true },
            }
            symbols.push(sym)
            symbolMap.set(`${scope.fqn}.get${capitalizedName}()`, sym)
          }

          if (isDataOrSetter) {
             const sym = {
              name: `set${capitalizedName}`,
              kind: ASTEngine.SymbolKind.Method,
              scope: scope.name,
              ownerName: scope.name,
              ownerKind: ASTEngine.SymbolKind.Class,
              modifiers: ["phantom", "lombok_generated"],
              range: prop.range,
              parameters: [{ name: "value", type: prop.returnType || "Object" }],
              returnType: "void",
              metadata: { isPhantom: true },
            }
            symbols.push(sym)
            symbolMap.set(`${scope.fqn}.set${capitalizedName}(${prop.returnType || "Object"})`, sym)
          }
        }
      }
    }
  }

  private detectFrameworksFromImport(mod: string, frameworks: Record<string, boolean>) {
    if (mod.startsWith("org.springframework")) frameworks["spring"] = true
    if (mod.startsWith("org.springframework.web")) frameworks["spring_mvc"] = true
    if (mod.startsWith("org.springframework.data")) frameworks["spring_data"] = true
    if (mod.startsWith("javax.persistence") || mod.startsWith("jakarta.persistence")) frameworks["jpa"] = true
    if (mod.startsWith("org.hibernate")) frameworks["hibernate"] = true
    if (mod.startsWith("org.mybatis")) frameworks["mybatis"] = true
    if (mod.startsWith("io.quarkus")) frameworks["quarkus"] = true
    if (mod.startsWith("io.micronaut")) frameworks["micronaut"] = true
    if (mod.startsWith("org.junit")) frameworks["junit"] = true
    if (mod.startsWith("org.mockito")) frameworks["mockito"] = true
    if (mod.startsWith("javax.servlet") || mod.startsWith("jakarta.servlet")) frameworks["servlet"] = true
    if (mod.startsWith("javax.ws.rs") || mod.startsWith("jakarta.ws.rs")) frameworks["jax_rs"] = true
  }

  private mapTypeToSymbolKind(type: string): ASTEngine.SymbolKind {
    if (type === "class_declaration" || type === "record_declaration") return ASTEngine.SymbolKind.Class
    if (type === "interface_declaration") return ASTEngine.SymbolKind.Interface
    if (type === "enum_declaration") return ASTEngine.SymbolKind.Enum
    return ASTEngine.SymbolKind.Class
  }

  private buildFqn(pkg: string, scopeStack: any[], name: string): string {
    const parts = []
    if (pkg) parts.push(pkg)
    for (let idx = 0; idx < scopeStack.length; idx++) { const scope = scopeStack[idx]
      if (scope.kind !== ASTEngine.SymbolKind.Method) {
        parts.push(scope.name)
      }
    }
    parts.push(name)
    return parts.join(".")
  }

  /**
   * Javadoc extraction: block_comment starting with '/**' immediately
   * preceding the declaration (previous sibling). Previously java symbols
   * carried NO comments - docstrings were silently lost (M14 #383).
   */
  private extractJavadocComment(node: Node): string | undefined {
    const parent = node.parent
    if (!parent) return undefined
    for (let i = 0; i < parent.namedChildCount; i++) {
      const sibling = parent.namedChild(i)
      if (sibling === node) break
      if ((sibling?.type === "block_comment" || sibling?.type === "line_comment") && sibling.text.startsWith("/**")) {
        return sibling.text
      }
    }
    return undefined
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

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private findAllChildrenByType(node: Node, type: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) results.push(child)
    }
    return results
  }

  /**
   * Collect Uses relationships from field_access expressions (this.name, obj.method)
   */
  private collectFieldAccessUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    // Walk with an enclosing-type scope so `this`/`super` receivers resolve to
    // the containing class/interface/enum instead of the literal keyword.
    const stack: { node: Node; owner: string | null }[] = [{ node: rootNode, owner: null }]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, owner } = item

      if (
        node.type === "class_declaration" ||
        node.type === "interface_declaration" ||
        node.type === "enum_declaration" ||
        node.type === "record_declaration"
      ) {
        const nameNode = this.findChildByType(node, "identifier")
        const nextOwner = nameNode ? nameNode.text : owner
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: nextOwner })
        }
        continue
      }

      if (node.type === "field_access") {
        const parts = node.text.split(".")
        if (parts.length >= 2) {
          const first = parts[0]
          const source = first === "this" || first === "super" ? (owner ?? first) : first
          const key = `${source}.${parts[parts.length - 1]}`
          if (!seen.has(key)) {
            seen.add(key)
            relationships.push({
              source,
              target: parts[parts.length - 1],
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.6,
              metadata: { isFieldAccess: true },
            })
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner })
      }
    }
  }

  private childText(node: Node, type: string): string | null {
    const child = this.findChildByType(node, type)
    return child ? child.text : null
  }

  private getJavaModifiers(node: Node): string[] {
    const modifiers: string[] = []
    const modifiersNode = this.findChildByType(node, "modifiers")
    if (modifiersNode) {
      for (let i = 0; i < modifiersNode.childCount; i++) {
        const modifier = modifiersNode.child(i)
        // Accept unnamed modifiers (like 'public', 'static') and ignore annotations
        if (modifier && !stringIncludes(modifier.type, "annotation")) {
          modifiers.push(modifier.text)
        }
      }
    }
    return modifiers
  }

  private getJavaAnnotations(node: Node): string[] {
    const annotations: string[] = []
    const modifiersNode = this.findChildByType(node, "modifiers")
    if (modifiersNode) {
      for (let i = 0; i < modifiersNode.namedChildCount; i++) {
        const child = modifiersNode.namedChild(i)
        if (child && (child.type === "annotation" || child.type === "marker_annotation")) {
          annotations.push(child.text)
        }
      }
    }
    return annotations
  }

  /**
   * Short annotation name from an annotation/marker_annotation node's name
   * child. The grammar serializes the name as $._name = choice(identifier,
   * _reserved_identifier, scoped_identifier) — fully-qualified annotations
   * (@org.springframework.stereotype.Service) have a scoped_identifier, NOT a
   * direct identifier. The short name is the last dotted segment; bare names
   * pass through unchanged.
   */
  private getJavaAnnotationShortName(ann: Node): string | null {
    const nameNode = this.findChildByType(ann, "identifier") || this.findChildByType(ann, "scoped_identifier")
    if (!nameNode) return null
    const text = nameNode.text
    const lastDot = text.lastIndexOf(".")
    return lastDot === -1 ? text : text.slice(lastDot + 1)
  }

  /**
   * Bare annotation names extracted from the AST (@Service → Service), read
   * from the identifier field of each annotation node — never from text.
   */
  private getJavaAnnotationNames(node: Node): string[] {
    const names: string[] = []
    const modifiersNode = this.findChildByType(node, "modifiers")
    const target = modifiersNode || node
    for (let i = 0; i < target.namedChildCount; i++) {
      const child = target.namedChild(i)
      if (child && (child.type === "annotation" || child.type === "marker_annotation")) {
        const name = this.getJavaAnnotationShortName(child)
        if (name) names.push(name)
      }
    }
    return names
  }

  /**
   * Semantic text of a value node: for string_literal nodes the concatenated
   * string_fragment children (unquoted) instead of raw quoted text; for all
   * other node types the raw text.
   */
  private extractStringValue(node: Node | null | undefined): string | undefined {
    if (!node) return undefined
    if (node.type === "string_literal") {
      let fragmentText = ""
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "string_fragment") fragmentText += c.text
      }
      if (fragmentText) return fragmentText
    }
    return node.text
  }

  private getJavaVisibility(modifiers: string[]): "public" | "private" | "protected" | undefined {
    if (modifiers.indexOf("public") !== -1) return "public"
    if (modifiers.indexOf("private") !== -1) return "private"
    if (modifiers.indexOf("protected") !== -1) return "protected"
    return undefined
  }

  /**
   * Extract the base type name from a type node, stripping type arguments so
   * inheritance targets are clean symbol names (Repository<T> → Repository).
   * A scoped type (BaseService.Entity) keeps its full dotted name.
   */
  private extractJavaTypeBaseName(typeNode: Node): string {
    if (typeNode.type === "generic_type") {
      const idNode = this.findChildByType(typeNode, "type_identifier") || this.findChildByType(typeNode, "scoped_type_identifier")
      if (idNode) return idNode.text
      const lt = typeNode.text.indexOf("<")
      return lt === -1 ? typeNode.text : typeNode.text.slice(0, lt).trim()
    }
    if (typeNode.type === "scoped_type_identifier") return typeNode.text
    return typeNode.text
  }

  private extractJavaInheritance(classNode: Node) {
    const inheritance = {
      extendsClass: null as string | null,
      // interface_declaration > extends_interfaces > type_list: EVERY parent is an extends (JLS 9.1.3)
      extendsInterfaces: [] as string[],
      implementsInterfaces: [] as string[],
      // sealed class permits clause (JLS 8.1.1.2): permitted subtypes are
      // CHILDREN of the sealed class, not ancestors — kept out of parents[]
      // and surfaced separately so callers can emit directional edges.
      permitsSubtypes: [] as string[]
    }
    const superclass = this.findChildByType(classNode, "superclass")
    if (superclass) {
      const typeIdentifier = this.findChildByType(superclass, "scoped_type_identifier") ||
                             this.findChildByType(superclass, "generic_type") ||
                             this.findChildByType(superclass, "type_identifier")
      if (typeIdentifier) inheritance.extendsClass = this.extractJavaTypeBaseName(typeIdentifier)
    }
    const superInterfaces = this.findChildByType(classNode, "super_interfaces") || this.findChildByType(classNode, "extends_interfaces")
    if (superInterfaces) {
      const targetList = this.findChildByType(superInterfaces, "type_list") || superInterfaces
      const isInterfaceExtends = superInterfaces.type === "extends_interfaces"
      const bucket = isInterfaceExtends ? inheritance.extendsInterfaces : inheritance.implementsInterfaces
      for (let i = 0; i < targetList.namedChildCount; i++) {
        const interfaceType = targetList.namedChild(i)
        if (interfaceType && (interfaceType.type === "type_identifier" || interfaceType.type === "generic_type" || interfaceType.type === "scoped_type_identifier")) {
          bucket.push(this.extractJavaTypeBaseName(interfaceType))
        }
      }
    }
    const permitsNode = this.findChildByType(classNode, "permits")
    if (permitsNode) {
      const permitsList = this.findChildByType(permitsNode, "type_list") || permitsNode
      for (let i = 0; i < permitsList.namedChildCount; i++) {
        const subtype = permitsList.namedChild(i)
        if (subtype && (subtype.type === "type_identifier" || subtype.type === "generic_type" || subtype.type === "scoped_type_identifier")) {
          inheritance.permitsSubtypes.push(this.extractJavaTypeBaseName(subtype))
        }
      }
    }
    return inheritance
  }

  private extractJavaParameters(node: Node, relationships?: ASTEngine.UniversalRelationship[], ownerPrefix?: string): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []
    const formalParams = this.findChildByType(node, "formal_parameters")
    const targetNode = formalParams ? formalParams : node

    for (let i = 0; i < targetNode.namedChildCount; i++) {
      const param = targetNode.namedChild(i)
      if (param && param.type === "formal_parameter") {
        const nameNode = param.childForFieldName("name") || this.findChildByType(param, "identifier")
        if (nameNode) {
          const paramType = this.extractJavaParameterType(param)
          parameters.push({ name: nameNode.text, type: paramType, isOptional: false })
          
          if (relationships && ownerPrefix) {
            const valueAnn = inArray(this.getJavaAnnotationNames(param), "Value")
            if (valueAnn) {
              // Read the key from the PARAMETER's own annotation: constructor
              // injection (@Value on a ctor param) never has the annotation on
              // the enclosing method node, so looking up there silently found
              // nothing and dropped every config_property edge.
              const valMatch = this.getAnnotationValue(param, "Value", "value")
              if (valMatch && valMatch.startsWith("${") && valMatch.endsWith("}")) {
                relationships.push({
                  source: ownerPrefix + "." + nameNode.text,
                  target: valMatch.substring(2, valMatch.length - 1).split(":")[0],
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 1.0,
                  metadata: { isConfiguration: true, relationshipType: "config_property" }
                })
              }
            }
          }
        }
      } else if (param && param.type === "spread_parameter") {
        // Varargs (JLS 8.4.1): grammar has no named fields; the name lives
        // inside the trailing variable_declarator, the type is the remaining
        // child. Modeled as an array type ("T[]"), matching the ERROR-node
        // recovery convention and JVM erasure shape.
        const decl = this.findChildByType(param, "variable_declarator")
        const nameNode = decl ? this.findChildByType(decl, "identifier") : null
        if (nameNode) {
          let spreadType: string | undefined = undefined
          for (let cIdx = 0; cIdx < param.namedChildCount; cIdx++) {
            const c = param.namedChild(cIdx)
            if (c && c.type !== "modifiers" && !stringIncludes(c.type, "annotation") && c.type !== "variable_declarator") {
              spreadType = c.text
              break
            }
          }
          parameters.push({ name: nameNode.text, type: (spreadType || "unknown") + "[]", isOptional: false })
        }
      } else if (param && param.type === "ERROR") {
        // ERROR-node recovery: tree-sitter exposes no structure for malformed
        // parameter text, so this block is best-effort text processing — but
        // every tokenization/stripping step is done by character walk, never
        // regex (the M12 census must stay green: zero unclassified usages).
        let rawText = param.text
        if (rawText.startsWith(",")) rawText = rawText.slice(1)
        rawText = rawText.trim()
        if (rawText) {
          const parts = splitByChar(rawText, ",")
          for (const p of parts) {
            const pt = p.trim()
            if (!pt) continue
            const tokens = tokenizeWhitespace(pt)
            let name = tokens[tokens.length - 1]
            let cleanName = ""
            for (let ci = 0; ci < name.length; ci++) {
              const ch = name[ci]
              if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_") cleanName += ch
            }
            name = cleanName
            if (name) {
              const lastToken = tokens[tokens.length - 1]
              let typeGuess = pt.length > lastToken.length ? pt.slice(0, pt.length - lastToken.length).trim() : ""
              // Strip @Annotation prefixes and ellipsis varargs by char walk.
              typeGuess = stripJavaAnnotations(typeGuess).split("...").join("[]").trim() || "unknown"
              parameters.push({ name, type: typeGuess, isOptional: false })
            }
          }
        }
      }
    }
    return parameters
  }

  private extractJavaParameterType(paramNode: Node): string | undefined {
    const typeNode = paramNode.childForFieldName("type")
    if (typeNode) return typeNode.text
    for (let i = 0; i < paramNode.namedChildCount; i++) {
      const child = paramNode.namedChild(i)
      if (child && child.type !== "identifier" && child.type !== "modifiers") return child.text
    }
    return undefined
  }

  private extractJavaReturnType(node: Node): string | undefined {
    const typeNode = node.childForFieldName("type")
    if (typeNode) return typeNode.text
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && (child.type === "type_identifier" || child.type === "generic_type" || child.type === "array_type" || child.type === "scoped_type_identifier" || child.type === "void_type" || child.type === "integral_type" || child.type === "floating_point_type" || child.type === "boolean_type")) {
        return child.text
      }
    }
    return undefined
  }

  private extractJavaFieldType(fieldNode: Node): string | undefined {
    return this.extractJavaReturnType(fieldNode)
  }

  private buildJavaCallExpression(invocationNode: Node): string {
    const objectNode = invocationNode.childForFieldName("object")
    const nameNode = invocationNode.childForFieldName("name")
    if (!nameNode) return invocationNode.text
    if (objectNode) {
      const objectText = objectNode.type === "method_invocation" ? this.buildJavaCallExpression(objectNode) : objectNode.text
      return `${objectText}.${nameNode.text}`
    }
    return nameNode.text
  }

  private isJavaBuiltin(call: string): boolean {
    // Exact builtin patterns (common JDK calls with known full paths)
    const builtins = [
      "System.out.println", "System.out.print", "System.out.printf",
      "System.err.println", "System.err.print",
      "System.exit", "System.gc", "System.currentTimeMillis",
      "System.nanoTime", "System.getProperty", "System.getenv",
      "System.identityHashCode", "System.arraycopy",
      "toString", "hashCode", "equals", "getClass", "notify", "notifyAll", "wait",
      "clone", "finalize",
    ]
    for (let i = 0; i < builtins.length; i++) {
      if (builtins[i] === call) return true
    }
    // Prefix-based stdlib filtering: first segment identifies the class/package.
    // These are unambiguous — java.*, javax.*, kotlin.*, and common JDK classes.
    const firstDot = call.indexOf(".")
    const root = firstDot > 0 ? call.slice(0, firstDot) : call
    const STDLIB_ROOTS = new Set([
      // java.lang
      "System", "String", "Integer", "Long", "Double", "Float", "Boolean",
      "Byte", "Short", "Character", "Math", "StrictMath", "Object", "Class",
      "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder",
      "Throwable", "Error", "Exception", "StackTraceElement",
      "Enum", "Void", "Compiler", "Package",
      // java.util
      "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet",
      "LinkedHashMap", "LinkedHashSet", "WeakHashMap", "IdentityHashMap",
      "Collections", "Arrays", "Objects", "Optional", "OptionalInt",
      "OptionalLong", "OptionalDouble", "Stream", "Collectors", "Comparator",
      "Iterator", "ListIterator", "Spliterator", "Random", "UUID",
      "Date", "Calendar", "TimeZone", "Locale", "Currency",
      "Base64", "Scanner", "Formatter", "StringJoiner",
      "AbstractList", "AbstractMap", "AbstractSet", "AbstractCollection",
      "EnumMap", "EnumSet", "Queue", "Deque", "Stack", "Vector",
      "Hashtable", "Properties", "BitSet", "Dictionary",
      "List", "Map", "Set", "Collection", "Iterable",
      // java.io / java.nio
      "File", "Files", "Path", "Paths", "InputStream", "OutputStream",
      "Reader", "Writer", "BufferedReader", "BufferedWriter",
      "FileInputStream", "FileOutputStream", "FileReader", "FileWriter",
      "ByteArrayInputStream", "ByteArrayOutputStream",
      "StringReader", "StringWriter", "PrintWriter", "PrintStream",
      "IOException", "FileNotFoundException", "EOFException",
      // java.net / java.sql / javax
      "URL", "URI", "HttpURLConnection", "URLEncoder", "URLDecoder",
      "Connection", "DriverManager", "ResultSet", "Statement",
      "PreparedStatement", "SQLException", "DataSource",
      "javax", "jakarta", "org", "com",
      // kotlin stdlib
      "kotlin", "Unit", "Nothing", "Any", "Int", "String",
      // Common JDK prefixes
      "java", "jdk", "sun",
      // Logger frameworks (always stdlib when called by these names)
      "Logger", "LoggerFactory", "LogManager", "Level", "LogRecord",
      "Marker", "MDC", "NDC",
      // Common annotations (never architectural)
      "Override", "Deprecated", "SuppressWarnings", "SafeVarargs",
      "FunctionalInterface", "Nullable", "NotNull", "NonNls",
      "Test", "Before", "After", "BeforeClass", "AfterClass", "Ignore",
      "RunWith", "Suite", "Parameterized",
      // org.slf4j / logging
      "slf4j", "log4j", "logback",
    ])
    // Split dotted call and check every segment prefix
    const segments = call.split(".")
    for (const seg of segments) {
      if (STDLIB_ROOTS.has(seg)) return true
    }
    // If the entire call itself (no dots) matches a stdlib root
    if (STDLIB_ROOTS.has(call)) return true
    return false
  }

  private getAnnotationValue(node: any, annotationName: string, key: string): string | undefined {
    const findAllAnnotations = (n: Node) => {
      const results = [];
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child && (child.type === "annotation" || child.type === "marker_annotation")) results.push(child);
      }
      return results;
    };
    
    let annotations = findAllAnnotations(node);
    const modifiersNode = (() => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i); if (child && child.type === "modifiers") return child;
      }
      return null;
    })();
    
    if (modifiersNode) {
      annotations = annotations.concat(findAllAnnotations(modifiersNode));
    }
    
    for (let j = 0; j < annotations.length; j++) { const ann = annotations[j]
      const name = this.getJavaAnnotationShortName(ann)
      if (name && name === annotationName) {
        const argsNode = this.findChildByType(ann, "annotation_argument_list")
        if (!argsNode) return undefined
        
        for (let i = 0; i < argsNode.namedChildCount; i++) {
          const arg = argsNode.namedChild(i)
          if (!arg) continue
          if (arg.type === "element_value_pair") {
             const keyNode = this.findChildByType(arg, "identifier")
             if (keyNode && keyNode.text === key) {
                const valNode = arg.namedChild(arg.namedChildCount - 1)
                return this.extractStringValue(valNode)
             }
          } else if (key === "value" && arg.type !== "element_value_pair") {
             return this.extractStringValue(arg)
          }
        }
      }
    }
    return undefined
  }

  private getJavaGenericParameters(node: any): string[] | undefined {
    const typeParamsNode = this.findChildByType(node, "type_parameters");
    if (!typeParamsNode) return undefined;
    const params: string[] = [];
    for (let i = 0; i < typeParamsNode.namedChildCount; i++) {
      const child = typeParamsNode.namedChild(i);
      if (child && child.type === "type_parameter") {
        params.push(child.text);
      }
    }
    return params.length > 0 ? params : undefined;
  }

  /**
   * Exact short-name annotation test on a symbol's decorators. Decorator text
   * is raw source ("@Service", "@org.x.Service", "@Service(...)") — normalize
   * to the short name before comparing so fully-qualified and parameterized
   * annotations match exactly like bare ones.
   */
  private hasJavaAnnotation(symbol: ASTEngine.UniversalSymbol, annotationName: string): boolean {
    if (!symbol.decorators) return false
    for (let i = 0; i < symbol.decorators.length; i++) {
      let t = symbol.decorators[i]
      if (t.startsWith("@")) t = t.slice(1)
      const paren = t.indexOf("(")
      if (paren !== -1) t = t.slice(0, paren)
      const dot = t.lastIndexOf(".")
      if (dot !== -1) t = t.slice(dot + 1)
      if (t === annotationName) return true
    }
    return false
  }

  private getJavaFrameworkPatterns(frameworks: string[], symbols: ASTEngine.UniversalSymbol[]): any[] {
     const patterns: any[] = []
     if (inArray(frameworks, "spring")) {
         const springPatterns: string[] = []
         let hasService = false, hasRepo = false, hasController = false
         for (let i = 0; i < symbols.length; i++) {
            if (!hasService && this.hasJavaAnnotation(symbols[i], "Service")) hasService = true
            if (!hasRepo && this.hasJavaAnnotation(symbols[i], "Repository")) hasRepo = true
            if (!hasController && (this.hasJavaAnnotation(symbols[i], "Controller") || this.hasJavaAnnotation(symbols[i], "RestController"))) hasController = true
         }
         if (hasService) springPatterns.push("service_layer")
         if (hasRepo) springPatterns.push("repository_pattern")
         if (hasController) { springPatterns.push("mvc_pattern"); springPatterns.push("api_endpoints"); }
         if (springPatterns.length > 0) patterns.push({ framework: "Spring Framework", patterns: springPatterns })
     }
     return patterns
  }
}
