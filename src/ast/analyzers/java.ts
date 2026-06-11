// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
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
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealJavaAnalyzer implements LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ParseResult, "language" | "metadata"> & { metadata: Partial<FileMetadata> } {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    const frameworks: Record<string, boolean> = {}
    const patterns: Record<string, boolean> = {}
    let currentPackage = ""
    let cyclomaticComplexity = 0

    // O(1) Quick Lookups
    const symbolMap = new Map<string, UniversalSymbol>()
    const classHierarchy = new Map<string, string[]>()
    const overrideTasks: { fqn: string; methodName: string; signature: string; ownerFqn: string }[] = []

    interface Scope {
      node: Node
      name: string
      kind: SymbolKind
      fqn: string
      symbolRef?: UniversalSymbol
      visibility: "public" | "private" | "protected" | undefined
      isAbstract: boolean
      isInterface: boolean
      isRecord: boolean
      annotations: string[]
      fields: UniversalSymbol[]
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
          for (let i = 0; i < inheritance.implementsInterfaces.length; i++) {
            parents.push(inheritance.implementsInterfaces[i])
          }
          classHierarchy.set(fqn, parents)

          if (type === "interface_declaration" && inheritance.implementsInterfaces.length > 0) {
            inheritance.extendsClass = inheritance.implementsInterfaces[0];
            inheritance.implementsInterfaces = inheritance.implementsInterfaces.slice(1);
          }

          if (inheritance.extendsClass) {
            relationships.push({
              source: name,
              target: inheritance.extendsClass,
              type: RelationshipType.Inheritance,
              confidence: 1.0,
              metadata: { relationshipType: type === "interface_declaration" ? "extends_interface" : "extends" },
            })
          }
          for (let k = 0; k < inheritance.implementsInterfaces.length; k++) { const iface = inheritance.implementsInterfaces[k]
            relationships.push({
              source: name,
              target: iface,
              type: RelationshipType.Implementation,
              confidence: 1.0,
              metadata: { relationshipType: "implements" },
            })
          }

          let isSpringBean = false
          let isEntity = false
          for (let i = 0; i < annotations.length; i++) {
            const a = annotations[i]
            if (/^@(Service|Repository|RestController|Component)(\(|$)/.test(a)) isSpringBean = true
            if (/^@(Entity|Table)(\(|$)/.test(a)) isEntity = true
          }
          let tableName = name.toLowerCase()
          
          if (isEntity) {
            frameworks["jpa"] = true
            patterns["entity_pattern"] = true
            let tableAnn: string | undefined = undefined
            for (let i = 0; i < annotations.length; i++) {
              if (annotations[i].startsWith("@Table(")) {
                tableAnn = annotations[i]
                break
              }
            }
            if (tableAnn) {
              const n = this.getAnnotationValue(node, "Table", "name")
              if (n) tableName = n
            }
            relationships.push({
              source: name,
              target: tableName,
              type: RelationshipType.Uses,
              confidence: 1.0,
              metadata: { isDatabase: true, relationshipType: "mapped_table", table: tableName },
            })
          }

          if (isSpringBean) {
             frameworks["spring"] = true;
             for (let i = 0; i < annotations.length; i++) {
                const a = annotations[i]
                if (a.startsWith("@Service")) { patterns["service_layer"] = true; break; }
                if (a.startsWith("@Repository")) { patterns["repository_pattern"] = true; break; }
                if (a.startsWith("@RestController") || a.startsWith("@Controller")) { patterns["mvc_pattern"] = true; break; }
             }
          }

          let feignAnn: string | undefined = undefined
          for (let i = 0; i < annotations.length; i++) {
             if (annotations[i].startsWith("@FeignClient")) { feignAnn = annotations[i]; break; }
          }
          if (feignAnn) {
            const targetService = this.getAnnotationValue(node, "FeignClient", "name") || this.getAnnotationValue(node, "FeignClient", "value")
            if (targetService) {
              relationships.push({
                source: name,
                target: targetService,
                type: RelationshipType.Calls,
                confidence: 1.0,
                metadata: { isFeignClient: true, microservice: targetService },
              })
            }
          }

          const sym: UniversalSymbol = {
            name,
            kind,
            range: this.nodeToRange(node),
            visibility,
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
            const recordParamsNode = this.findChildByType(node, "record_parameters")
            sym.parameters = this.extractJavaParameters(recordParamsNode || node, relationships, name)
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

      else if (type === "method_declaration" || type === "constructor_declaration") {
        const nameNode = type === "method_declaration" ? this.findChildByType(node, "identifier") : this.findChildByType(node, "identifier")
        const name = nameNode ? nameNode.text : null
        
        if (name) {
          const isConstructor = type === "constructor_declaration"
          const modifiers = this.getJavaModifiers(node)
          const annotations = this.getJavaAnnotations(node)
          const visibility = this.getJavaVisibility(modifiers)

          const parameters = this.extractJavaParameters(node, relationships, parentContext ? parentContext.name : undefined)
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
          
          let mappingAnnotation: string | undefined = undefined
          for (let i = 0; i < annotations.length; i++) {
             if (/^@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping|Path)(\(|$)/.test(annotations[i])) {
                mappingAnnotation = annotations[i]
                break
             }
          }
          
          if (mappingAnnotation) {
            isApiEndpoint = true
            let httpMethod = "GET"
            if (mappingAnnotation.startsWith("@Post")) httpMethod = "POST"
            else if (mappingAnnotation.startsWith("@Put")) httpMethod = "PUT"
            else if (mappingAnnotation.startsWith("@Delete")) httpMethod = "DELETE"
            else if (mappingAnnotation.startsWith("@Patch")) httpMethod = "PATCH"
            else if (mappingAnnotation.startsWith("@Request") || mappingAnnotation.startsWith("@Path")) httpMethod = "ANY"

            const annName = mappingAnnotation.match(/^@([A-Za-z0-9_]+)/)?.[1] || "";
            const methodRoute = this.getAnnotationValue(node, annName, "value") || this.getAnnotationValue(node, annName, "path") || ""

            let basePath = ""
            if (parentContext) {
              let classMapping: string | undefined = undefined
              for (let i = 0; i < parentContext.annotations.length; i++) {
                 if (parentContext.annotations[i].startsWith("@RequestMapping") || parentContext.annotations[i].startsWith("@Path")) {
                    classMapping = parentContext.annotations[i]
                    break
                 }
              }
              if (classMapping) {
                const match = classMapping.match(/"([^"]+)"/) || classMapping.match(/value\s*=\s*"([^"]+)"/)
                if (match) basePath = match[1]
              }
            }
            fullRoute = `${basePath}${methodRoute}`.replace(/\/\/+/g, "/")
            if (!fullRoute.startsWith("/")) fullRoute = "/" + fullRoute

            relationships.push({
              source: localOwnerPrefix,
              target: fullRoute,
              type: RelationshipType.Exports,
              confidence: 1.0,
              metadata: { isApiEndpoint: true, httpMethod, route: fullRoute },
            })
            frameworks["spring_mvc"] = true
          }

          let dbMapping: string | undefined = undefined
          for (let idx = 0; idx < annotations.length; idx++) {
             if (/^@(Column|OneToMany|ManyToOne|OneToOne|ManyToMany)(\(|$)/.test(annotations[idx])) { dbMapping = annotations[idx]; break; }
          }
          if (dbMapping && parentContext) {
            const annName = dbMapping.match(/^@([A-Za-z0-9_]+)/)?.[1] || "";
            let target = name.startsWith("get") ? name.charAt(3).toLowerCase() + name.slice(4) : name
            const explicit = this.getAnnotationValue(node, annName, "name")
            if (explicit) target = explicit
            
            relationships.push({
              source: localOwnerPrefix,
              target,
              type: RelationshipType.Uses,
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

          const sym: UniversalSymbol = {
            name,
            kind: isConstructor ? SymbolKind.Constructor : SymbolKind.Method,
            range: this.nodeToRange(node),
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
            kind: SymbolKind.Method,
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

            let dbMapping: string | undefined = undefined
          for (let idx = 0; idx < annotations.length; idx++) {
             if (/^@(Column|OneToMany|ManyToOne|OneToOne|ManyToMany)(\(|$)/.test(annotations[idx])) { dbMapping = annotations[idx]; break; }
          }
            if (dbMapping) {
              const annName = dbMapping.match(/^@([A-Za-z0-9_]+)/)?.[1] || "";
              let target = fieldName
              const explicit = this.getAnnotationValue(node, annName, "name")
              if (explicit) target = explicit
              
              relationships.push({
                source: localOwnerPrefix,
                target,
                type: RelationshipType.Uses,
                confidence: 1.0,
                metadata: { isDatabase: true, relationshipType: "mapped_column" },
              })
            }

            let valAnn: string | undefined = undefined
            for (let j = 0; j < annotations.length; j++) {
               if (annotations[j].startsWith("@Value(")) { valAnn = annotations[j]; break; }
            }
            if (valAnn) {
              const valMatch = this.getAnnotationValue(node, "Value", "value")
              if (valMatch && valMatch.startsWith("${") && valMatch.endsWith("}")) {
                let configKey = valMatch.substring(2, valMatch.length - 1)
                if (stringIncludes(configKey, ":")) configKey = configKey.split(":")[0]
                relationships.push({
                  source: localOwnerPrefix,
                  target: configKey,
                  type: RelationshipType.Uses,
                  confidence: 1.0,
                  metadata: { isConfiguration: true, relationshipType: "config_property" }
                })
              }
            }

            const sym: UniversalSymbol = {
              name: fieldName,
              kind: isConstant ? SymbolKind.Constant : SymbolKind.Property,
              range: this.nodeToRange(declarator),
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
            kind: SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: parentContext.name,
            ownerKind: parentContext.kind,
            metadata: { nodeType: type }
          })
        }
      }

      else if (type === "method_invocation") {
         if (parentContext && parentContext.kind === SymbolKind.Method && parentContext.symbolRef) {
            const callExpression = this.buildJavaCallExpression(node)
            if (callExpression && !this.isJavaBuiltin(callExpression)) {
              if (!parentContext.symbolRef.qualified_calls) parentContext.symbolRef.qualified_calls = []
              parentContext.symbolRef.qualified_calls.push(callExpression)
              relationships.push({
                source: parentContext.name || parentContext.symbolRef.name,
                target: callExpression.split(".").pop() || callExpression,
                type: RelationshipType.Calls,
                confidence: 0.7,
                metadata: { javaCallExpression: callExpression },
              })
              // PascalCase calls → likely instantiation
              const methodName = callExpression.split(".").pop() || callExpression
              if (methodName && methodName[0] === methodName[0].toUpperCase() && methodName[0] !== methodName[0].toLowerCase()) {
                relationships.push({
                  source: parentContext.name || parentContext.symbolRef.name,
                  target: methodName,
                  type: RelationshipType.Instantiates,
                  confidence: 0.6,
                  metadata: { isPossibleConstructor: true },
                })
              }
            }
         }
      }

      else if (type === "object_creation_expression") {
        // new Foo() → Instantiates relationship
        const typeNode = this.findChildByType(node, "type_identifier") || this.findChildByType(node, "identifier")
        if (typeNode) {
          const source = parentContext?.name || parentContext?.symbolRef?.name || "global"
          const typeName = typeNode.text
          relationships.push({
            source,
            target: typeName,
            type: RelationshipType.Instantiates,
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

    this.resolveOverrides(overrideTasks, classHierarchy, symbolMap, relationships)

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
         if (this.hasJavaAnnotation(symbols[i], "@Service") || this.hasJavaAnnotation(symbols[i], "@Repository") || this.hasJavaAnnotation(symbols[i], "@Component")) {
             hasSpringCore = true; break;
         }
      }
      if (hasSpringCore) finalFrameworks.push("spring_core")
    }

    for (var _ji = 0; _ji < symbols.length; _ji++) { var js = symbols[_ji]; if (!js.metadata?.isPhantom && js.visibility === "public" && (!js.ownerName || js.ownerKind === SymbolKind.Class)) { exports.push({ name: js.name, kind: js.kind, range: js.range, visibility: js.visibility }); } }
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
    symbolMap: Map<string, UniversalSymbol>,
    relationships: UniversalRelationship[]
  ) {
    for (let taskIdx = 0; taskIdx < tasks.length; taskIdx++) { const task = tasks[taskIdx]
      let targetFqn: string | null = null

      const queue: string[] = []
      const ownerH = classHierarchy.get(task.ownerFqn)
      if (ownerH) {
         for (let i = 0; i < ownerH.length; i++) queue.push(ownerH[i])
      }
      const seen: Record<string, boolean> = {}

      while (queue.length > 0) {
        const parent = queue.shift()!
        if (seen[parent]) continue
        seen[parent] = true

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

      const ownerH2 = classHierarchy.get(task.ownerFqn)
      if (!targetFqn && ownerH2 && ownerH2.length > 0) {
        let deepest = "";
        const q2: string[] = [];
        for (let i = 0; i < ownerH2.length; i++) q2.push(ownerH2[i])
        let found = false;
        while(q2.length > 0) {
           const p = q2.shift()!;
           if (symbolMap.has(p + "." + task.methodName + task.signature)) {
               deepest = p + "." + task.methodName + task.signature;
               found = true; break;
           }
           const pH2 = classHierarchy.get(p)
           if (pH2) {
              for (let i = 0; i < pH2.length; i++) q2.push(pH2[i])
           }
        }
        if (found) targetFqn = deepest;
        else targetFqn = `${ownerH2[0]}.${task.methodName}${task.signature}`
      }

      if (targetFqn) {
        const localSource = task.fqn.split('(')[0].split('.').slice(-2).join('.')
        const localTarget = targetFqn.split('(')[0].split('.').slice(-2).join('.')

        relationships.push({
          source: localSource,
          target: localTarget,
          type: RelationshipType.Overrides,
          confidence: 1.0,
          metadata: { relationshipType: "method_override", isJavaOverride: true },
        })
      }
    }
  }

  private processPhantomSymbols(
    scope: any, 
    symbols: UniversalSymbol[], 
    symbolMap: Map<string, UniversalSymbol>,
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
            kind: SymbolKind.Method,
            scope: scope.name,
            ownerName: scope.name,
            ownerKind: SymbolKind.Interface,
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
              kind: SymbolKind.Method,
              scope: scope.name,
              ownerName: scope.name,
              ownerKind: SymbolKind.Class,
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
              kind: SymbolKind.Method,
              scope: scope.name,
              ownerName: scope.name,
              ownerKind: SymbolKind.Class,
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

  private mapTypeToSymbolKind(type: string): SymbolKind {
    if (type === "class_declaration" || type === "record_declaration") return SymbolKind.Class
    if (type === "interface_declaration") return SymbolKind.Interface
    if (type === "enum_declaration") return SymbolKind.Enum
    return SymbolKind.Class
  }

  private buildFqn(pkg: string, scopeStack: any[], name: string): string {
    const parts = []
    if (pkg) parts.push(pkg)
    for (let idx = 0; idx < scopeStack.length; idx++) { const scope = scopeStack[idx]
      if (scope.kind !== SymbolKind.Method) {
        parts.push(scope.name)
      }
    }
    parts.push(name)
    return parts.join(".")
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

  private getJavaVisibility(modifiers: string[]): "public" | "private" | "protected" | undefined {
    if (modifiers.indexOf("public") !== -1) return "public"
    if (modifiers.indexOf("private") !== -1) return "private"
    if (modifiers.indexOf("protected") !== -1) return "protected"
    return undefined
  }

  private extractJavaInheritance(classNode: Node) {
    const inheritance = {
      extendsClass: null as string | null,
      implementsInterfaces: [] as string[]
    }
    const superclass = this.findChildByType(classNode, "superclass")
    if (superclass) {
      const typeIdentifier = this.findChildByType(superclass, "scoped_type_identifier") ||
                             this.findChildByType(superclass, "generic_type") ||
                             this.findChildByType(superclass, "type_identifier")
      if (typeIdentifier) inheritance.extendsClass = typeIdentifier.text
    }
    const superInterfaces = this.findChildByType(classNode, "super_interfaces") || this.findChildByType(classNode, "extends_interfaces")
    if (superInterfaces) {
      const typeList = this.findChildByType(superInterfaces, "interface_type_list") || this.findChildByType(superInterfaces, "type_list")
      const targetList = typeList ? typeList : superInterfaces
      for (let i = 0; i < targetList.namedChildCount; i++) {
        const interfaceType = targetList.namedChild(i)
        if (interfaceType && (interfaceType.type === "type_identifier" || interfaceType.type === "generic_type" || interfaceType.type === "scoped_type_identifier")) {
          inheritance.implementsInterfaces.push(interfaceType.text)
        }
      }
    }
    return inheritance
  }

  private extractJavaParameters(node: Node, relationships?: UniversalRelationship[], ownerPrefix?: string): Parameter[] {
    const parameters: Parameter[] = []
    const formalParams = this.findChildByType(node, "formal_parameters") || this.findChildByType(node, "record_declaration_body")
    const targetNode = formalParams ? formalParams : node

    for (let i = 0; i < targetNode.namedChildCount; i++) {
      const param = targetNode.namedChild(i)
      if (param && (param.type === "formal_parameter" || param.type === "record_component")) {
        const nameNode = param.childForFieldName("name") || this.findChildByType(param, "identifier")
        if (nameNode) {
          const paramType = this.extractJavaParameterType(param)
          parameters.push({ name: nameNode.text, type: paramType, isOptional: false })
          
          if (relationships && ownerPrefix) {
            const annotations = this.getJavaAnnotations(param)
            let valueAnn = false
            for (let j = 0; j < annotations.length; j++) {
               if (annotations[j].startsWith("@Value(")) { valueAnn = true; break; }
            }
            if (valueAnn) {
              const valMatch = this.getAnnotationValue(node, "Value", "value")
              if (valMatch && valMatch.startsWith("${") && valMatch.endsWith("}")) {
                relationships.push({
                  source: ownerPrefix + "." + nameNode.text,
                  target: valMatch.substring(2, valMatch.length - 1).split(":")[0],
                  type: RelationshipType.Uses,
                  confidence: 1.0,
                  metadata: { isConfiguration: true, relationshipType: "config_property" }
                })
              }
            }
          }
        }
      } else if (param && param.type === "ERROR") {
        const rawText = param.text.replace(/^,\s*/, "").trim();
        if (rawText) {
           const parts = rawText.split(",");
           for (const p of parts) {
             const pt = p.trim();
             if (!pt) continue;
             const tokens = pt.split(/\s+/);
             let name = tokens[tokens.length - 1];
             name = name.replace(/[^a-zA-Z0-9_]/g, "");
             if (name) {
               let typeGuess = pt.replace(tokens[tokens.length - 1], "").trim();
               typeGuess = typeGuess.replace(/@[\w\.]+\s*/g, "").replace(/\.\.\./g, "[]").trim() || "unknown";
               parameters.push({ name, type: typeGuess, isOptional: false });
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
    const builtins = ["System.out.println", "System.out.print", "System.err.println", "toString", "hashCode", "equals", "getClass", "notify", "notifyAll", "wait"]
    for (let i = 0; i < builtins.length; i++) {
       if (builtins[i] === call) return true
    }
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
      const nameNode = this.findChildByType(ann, "identifier") || ann.child(1)
      if (nameNode && nameNode.text === annotationName) {
        const argsNode = this.findChildByType(ann, "annotation_argument_list")
        if (!argsNode) return undefined
        
        for (let i = 0; i < argsNode.namedChildCount; i++) {
          const arg = argsNode.namedChild(i)
          if (!arg) continue
          if (arg.type === "element_value_pair") {
             const keyNode = this.findChildByType(arg, "identifier")
             if (keyNode && keyNode.text === key) {
                const valNode = arg.namedChild(arg.namedChildCount - 1)
                return valNode ? valNode.text.replace(/^"|"$/g, "") : undefined
             }
          } else if (key === "value" && arg.type !== "element_value_pair") {
             return arg.text.replace(/^"|"$/g, "")
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

  private hasJavaAnnotation(symbol: UniversalSymbol, annotationName: string): boolean {
    if (!symbol.decorators) return false
    for (let i = 0; i < symbol.decorators.length; i++) {
       if (symbol.decorators[i].startsWith(annotationName)) return true
    }
    return false
  }

  private getJavaFrameworkPatterns(frameworks: string[], symbols: UniversalSymbol[]): any[] {
     const patterns: any[] = []
     if (inArray(frameworks, "spring")) {
         const springPatterns: string[] = []
         let hasService = false, hasRepo = false, hasController = false
         for (let i = 0; i < symbols.length; i++) {
            if (!hasService && this.hasJavaAnnotation(symbols[i], "@Service")) hasService = true
            if (!hasRepo && this.hasJavaAnnotation(symbols[i], "@Repository")) hasRepo = true
            if (!hasController && (this.hasJavaAnnotation(symbols[i], "@Controller") || this.hasJavaAnnotation(symbols[i], "@RestController"))) hasController = true
         }
         if (hasService) springPatterns.push("service_layer")
         if (hasRepo) springPatterns.push("repository_pattern")
         if (hasController) { springPatterns.push("mvc_pattern"); springPatterns.push("api_endpoints"); }
         if (springPatterns.length > 0) patterns.push({ framework: "Spring Framework", patterns: springPatterns })
     }
     return patterns
  }
}
