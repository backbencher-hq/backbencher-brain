// Pure AST JSON analyzer.
//
// JSON has no declarations beyond object keys and values. The contract used by
// this analyzer is therefore deliberately structural:
//   - the file is a module;
//   - object-valued keys are class-like structural objects;
//   - array-valued keys are variables;
//   - scalar-valued keys are properties;
//   - nested keys are owned by their qualified JSON path;
//   - required fields, $ref edges, and package dependencies come from JSON AST
//     nodes, never from source-text scanning.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface JsonContext {
  filePath: string
  content: string
  rootName: string
  symbols: ASTEngine.UniversalSymbol[]
  symbolMap: Map<string, ASTEngine.UniversalSymbol>
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  requiredByObject: Map<string, Set<string>>
  schemaObjects: Set<string>
  referenceSymbols: ASTEngine.UniversalSymbol[]
  validationSymbols: ASTEngine.UniversalSymbol[]
  apiEndpointSymbols: ASTEngine.UniversalSymbol[]
  dependencySymbols: ASTEngine.UniversalSymbol[]
  objectCount: number
  propertyCount: number
  arrayCount: number
  maxDepth: number
  hasNullValues: boolean
  hasBooleanValues: boolean
  hasArrays: boolean
}

type PathFrame = { node: Node; parentPath: string; emitObject?: boolean }

const VALIDATION_KEYS = new Set([
  "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum",
  "exclusiveMaximum", "pattern", "format", "enum", "const", "multipleOf",
  "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties",
  "additionalProperties",
])

const API_METHOD_KEYS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"])

function isDependencyContainerPath(path: string): boolean {
  const dot = path.lastIndexOf(".")
  const segment = dot >= 0 ? path.slice(dot + 1) : path
  return segment === "dependencies" || segment === "devDependencies" || segment === "peerDependencies" || segment === "optionalDependencies"
}

function isPathReference(value: string): boolean {
  return value.startsWith("#/") || value.startsWith("#/definitions/") || value.startsWith("#/components/")
}

export class RealJsonAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const rootName = this.documentName(filePath)
    const ctx: JsonContext = {
      filePath,
      content,
      rootName,
      symbols: [],
      symbolMap: new Map(),
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      requiredByObject: new Map(),
      schemaObjects: new Set(),
      referenceSymbols: [],
      validationSymbols: [],
      apiEndpointSymbols: [],
      dependencySymbols: [],
      objectCount: 0,
      propertyCount: 0,
      arrayCount: 0,
      maxDepth: 0,
      hasNullValues: false,
      hasBooleanValues: false,
      hasArrays: false,
    }

    this.collectErrors(rootNode, ctx)
    this.collectSchemaFacts(rootNode, ctx)
    this.extractSymbols(rootNode, ctx)
    this.extractRelationships(ctx)
    this.extractPackageDependencies(ctx)

    const rootSymbol: ASTEngine.UniversalSymbol = {
      name: rootName,
      kind: ASTEngine.SymbolKind.Module,
      qualifiedName: rootName,
      range: this.nodeToRange(rootNode),
      scope: "",
      visibility: "public",
      metadata: {
        jsonSpecific: true,
        documentType: this.documentType(ctx),
        hasSchema: ctx.schemaObjects.size > 0 || ctx.symbolMap.has("$schema"),
        isApiSpec: this.isApiSpec(ctx),
        objectCount: ctx.objectCount,
        propertyCount: ctx.propertyCount,
        arrayCount: ctx.arrayCount,
        maxDepth: ctx.maxDepth,
        hasNullValues: ctx.hasNullValues,
        hasBooleanValues: ctx.hasBooleanValues,
      },
    }
    ctx.symbols.push(rootSymbol)

    ctx.exports.push({
      name: rootName,
      kind: ASTEngine.SymbolKind.Module,
      range: rootSymbol.range,
      visibility: "public",
    })

    const frameworks = this.detectFrameworks(ctx)
    const patterns = this.detectPatterns(ctx)
    const structural = this.structuralScores(ctx)

    return {
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: ctx.symbols.length + ctx.relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1,
        framework: frameworks[0],
        patterns,
        detectedFrameworks: frameworks,
        frameworkPatterns: [],
        architecturalInsights: this.insights(ctx),
        architecturalScore: structural.dataModelingScore,
        codeQuality: structural.dataModelingScore >= 90 ? "Excellent" : structural.dataModelingScore >= 70 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        dataModelingScore: structural.dataModelingScore,
        schemaValidationScore: structural.schemaValidationScore,
        apiDesignScore: this.isApiSpec(ctx) ? 100 : 80,
        analysisVersion: "4.0.0-pure-json-ast",
      },
    }
  }

  private collectErrors(rootNode: Node, ctx: JsonContext): void {
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "ERROR" || node.isMissing) {
        ctx.errors.push({
          message: `Syntax ${node.type} detected in JSON AST.`,
          range: this.nodeToRange(node),
          severity: "warning",
        })
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Collect schema metadata before symbol extraction so `required` is based on
   * the actual sibling array, not on a key-name convention. Each object is
   * visited once, so this pass is O(number of AST nodes).
   */
  private collectSchemaFacts(rootNode: Node, ctx: JsonContext): void {
    const stack: PathFrame[] = [{ node: rootNode, parentPath: ctx.rootName }]
    while (stack.length > 0) {
      const { node, parentPath } = stack.pop()!
      if (node.type === "document") {
        this.pushNamedChildren(stack, node, parentPath)
        continue
      }
      if (node.type === "object") {
        const schemaKeys = new Set<string>()
        let requiredNames: Set<string> | undefined
        for (let i = 0; i < node.namedChildCount; i++) {
          const pair = node.namedChild(i)
          if (pair?.type !== "pair") continue
          const key = this.keyText(pair)
          const value = pair.childForFieldName("value")
          if (!key) continue
          schemaKeys.add(key)
          if (key === "required" && value?.type === "array") {
            const required = new Set<string>()
            for (let j = 0; j < value.namedChildCount; j++) {
              const item = value.namedChild(j)
              if (item?.type === "string") required.add(this.stripQuotes(item.text))
            }
            if (required.size > 0) requiredNames = required
          }
          if (value?.type === "object") stack.push({ node: value, parentPath: this.childPath(parentPath, key) })
          else if (value?.type === "array") stack.push({ node: value, parentPath: this.childPath(parentPath, key) })
        }
        let schemaMatches = 0
        for (const key of schemaKeys) {
          if (key === "$schema" || key === "type" || key === "properties" || key === "required" || key === "items" || key === "definitions" || key === "$defs" || key === "additionalProperties") schemaMatches++
        }
        if (requiredNames) {
          const requiredOwner = schemaKeys.has("properties") ? this.childPath(parentPath, "properties") : parentPath
          ctx.requiredByObject.set(requiredOwner, requiredNames)
        }
        if (schemaMatches >= 2) ctx.schemaObjects.add(parentPath)
        continue
      }
      if (node.type === "array") this.pushArrayChildren(stack, node, parentPath)
    }
  }

  private extractSymbols(rootNode: Node, ctx: JsonContext): void {
    const stack: PathFrame[] = [{ node: rootNode, parentPath: ctx.rootName }]
    while (stack.length > 0) {
      const frame = stack.pop()!
      const { node, parentPath } = frame
      if (node.type === "document") {
        this.pushNamedChildren(stack, node, parentPath)
        continue
      }
      if (node.type === "object") {
        this.updateDepth(ctx, parentPath)
        if (frame.emitObject) this.addArrayObjectSymbol(ctx, node, parentPath)
        this.pushNamedChildren(stack, node, parentPath)
        continue
      }
      if (node.type === "array") {
        ctx.arrayCount++
        ctx.hasArrays = true
        this.pushArrayChildren(stack, node, parentPath)
        continue
      }
      if (node.type !== "pair") continue

      const key = this.keyText(node)
      const value = node.childForFieldName("value")
      if (!key || !value) continue
      const path = this.childPath(parentPath, key)
      const valueType = this.valueType(value)
      const kind = valueType === "object"
        ? ASTEngine.SymbolKind.Class
        : valueType === "array"
          ? ASTEngine.SymbolKind.Variable
          : ASTEngine.SymbolKind.Property
      const symbol: ASTEngine.UniversalSymbol = {
        name: key,
        kind,
        qualifiedName: path,
        range: this.nodeToRange(node),
        ownerName: parentPath,
        ownerKind: parentPath === ctx.rootName ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Class,
        scope: parentPath,
        visibility: "public",
        returnType: valueType,
        metadata: {
          jsonSpecific: true,
          nodeType: node.type,
          valueType,
          fullPath: path,
          isArray: valueType === "array",
          isObject: valueType === "object",
          isRequired: this.isRequired(ctx, parentPath, key),
          hasValidation: this.hasValidation(ctx, key, value),
          isReference: this.isReference(key, value),
          refPath: this.referencePath(key, value),
          isApiEndpoint: this.isApiEndpoint(key, value),
          depth: this.pathDepth(path, ctx.rootName),
        },
      }
      this.addSymbol(ctx, symbol)

      if (valueType === "null") ctx.hasNullValues = true
      if (valueType === "boolean") ctx.hasBooleanValues = true
      if (symbol.metadata.isReference) ctx.referenceSymbols.push(symbol)
      if (symbol.metadata.hasValidation) ctx.validationSymbols.push(symbol)
      if (symbol.metadata.isApiEndpoint) ctx.apiEndpointSymbols.push(symbol)
      if (isDependencyContainerPath(parentPath)) ctx.dependencySymbols.push(symbol)

      if (value.type === "object" || value.type === "array") stack.push({ node: value, parentPath: path })
    }
  }

  private addSymbol(ctx: JsonContext, symbol: ASTEngine.UniversalSymbol): void {
    ctx.symbols.push(symbol)
    ctx.symbolMap.set(symbol.name, symbol)
    const fullPath = symbol.metadata?.fullPath
    if (fullPath) ctx.symbolMap.set(fullPath, symbol)
    if (symbol.kind === ASTEngine.SymbolKind.Class) ctx.objectCount++
    if (symbol.kind === ASTEngine.SymbolKind.Property) ctx.propertyCount++
  }

  private extractRelationships(ctx: JsonContext): void {
    for (const symbol of ctx.symbols) {
      if (symbol.ownerName) {
        ctx.relationships.push({
          source: symbol.ownerName,
          target: symbol.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1,
          metadata: { fullPath: symbol.metadata?.fullPath || "" },
        })
      }
    }

    for (const ref of ctx.referenceSymbols) {
      const refPath = ref.metadata?.refPath as string | undefined
      if (!refPath) continue
      const target = this.referenceTarget(ctx, refPath)
      ctx.relationships.push({
        source: String(ref.metadata?.fullPath || ref.name),
        target,
        type: ASTEngine.RelationshipType.References,
        confidence: target === refPath ? 0.8 : 1,
        metadata: {
          relationshipType: "json_reference",
          refPath,
          isExternal: !refPath.startsWith("#/") || !ctx.symbolMap.has(target),
        },
      })
    }

    for (const endpoint of ctx.apiEndpointSymbols) {
      ctx.relationships.push({
        source: endpoint.ownerName || ctx.rootName,
        target: endpoint.name,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.8,
        metadata: { relationshipType: "json_api_endpoint" },
      })
    }
  }

  private extractPackageDependencies(ctx: JsonContext): void {
    if (!this.fileEndsWith(ctx.filePath, "package.json") && !this.fileEndsWith(ctx.filePath, "composer.json")) return
    for (const dependency of ctx.dependencySymbols) {
      ctx.imports.push({
        module: dependency.name,
        symbols: [],
        range: dependency.range,
        type: "dependency",
        resolvedPath: "package-manager",
      })
      ctx.relationships.push({
        source: ctx.rootName,
        target: dependency.name,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 1,
        metadata: { relationshipType: "package_dependency", version: this.dependencyVersion(ctx, dependency) },
      })
    }
  }

  private dependencyVersion(ctx: JsonContext, dependency: ASTEngine.UniversalSymbol): string {
    const fullPath = String(dependency.metadata?.fullPath || "")
    const parts = fullPath.split(".")
    const parent = parts.slice(0, -1).join(".")
    const version = ctx.symbolMap.get(`${parent}.${dependency.name}`)
    return version?.returnType || "unknown"
  }

  private referenceTarget(ctx: JsonContext, refPath: string): string {
    if (!refPath.startsWith("#/")) return refPath
    const fragment = refPath.slice(2).replaceAll("/", ".")
    const local = `${ctx.rootName}.${fragment}`
    return ctx.symbolMap.has(local) ? local : refPath
  }

  private isReference(key: string, value: Node): boolean {
    if (key === "$ref") return true
    return value.type === "string" && isPathReference(this.stripQuotes(value.text))
  }

  private referencePath(key: string, value: Node): string | undefined {
    if (!this.isReference(key, value) || value.type !== "string") return undefined
    return this.stripQuotes(value.text)
  }

  private isRequired(ctx: JsonContext, parentPath: string, key: string): boolean {
    return ctx.requiredByObject.get(parentPath)?.has(key) ?? false
  }

  private hasValidation(ctx: JsonContext, key: string, value: Node): boolean {
    if (VALIDATION_KEYS.has(key)) return true
    if (value.type !== "object") return false
    for (let i = 0; i < value.namedChildCount; i++) {
      const pair = value.namedChild(i)
      if (pair?.type === "pair" && VALIDATION_KEYS.has(this.keyText(pair))) return true
    }
    return false
  }

  private isApiEndpoint(key: string, value: Node): boolean {
    if (key.length === 0 || key[0] !== "/") return false
    if (value.type !== "object") return false
    for (let i = 0; i < value.namedChildCount; i++) {
      const pair = value.namedChild(i)
      if (pair?.type === "pair" && API_METHOD_KEYS.has(this.keyText(pair))) return true
    }
    return false
  }

  private detectFrameworks(ctx: JsonContext): string[] {
    const frameworks: string[] = []
    const file = ctx.filePath.toLowerCase()
    const has = (name: string) => ctx.symbolMap.has(name)
    const dependency = (name: string) => {
      for (const symbol of ctx.dependencySymbols) if (symbol.name === name) return true
      return false
    }
    if (this.fileEndsWith(file, "package.json")) frameworks.push("npm/Node.js")
    if (this.fileEndsWith(file, "composer.json")) frameworks.push("Composer/PHP")
    if (this.fileEndsWith(file, "tsconfig.json") || has("compilerOptions")) frameworks.push("TypeScript")
    if (has("openapi") || has("swagger")) frameworks.push("OpenAPI/Swagger")
    if (has("$schema") || ctx.schemaObjects.size > 0) frameworks.push("JSON Schema")
    if (has("Version") && has("Resources")) frameworks.push("AWS CloudFormation")
    if (dependency("react") || dependency("@types/react")) frameworks.push("React")
    if (dependency("vue") || dependency("@vue/core")) frameworks.push("Vue.js")
    if (dependency("next")) frameworks.push("Next.js")
    return frameworks
  }

  private detectPatterns(ctx: JsonContext): string[] {
    const patterns: string[] = []
    if (ctx.schemaObjects.size > 0 || ctx.symbolMap.has("$schema")) patterns.push("JSON Schema Validation")
    if (ctx.referenceSymbols.length > 0) patterns.push("Reference-based Relationships")
    if (ctx.apiEndpointSymbols.length > 0) patterns.push("RESTful API Design")
    if (ctx.hasArrays) patterns.push("Collection Data Types")
    if (ctx.maxDepth > 3) patterns.push("Deep Nested Structures")
    if (ctx.symbolMap.has("dependencies") || ctx.symbolMap.has("devDependencies")) patterns.push("Dependency Management")
    return patterns
  }

  private structuralScores(ctx: JsonContext): { dataModelingScore: number; schemaValidationScore: number } {
    let dataModelingScore = 70
    if (ctx.objectCount > 0 && ctx.propertyCount / ctx.objectCount >= 2) dataModelingScore += 10
    if (ctx.maxDepth <= 4) dataModelingScore += 10
    let schemaValidationScore = 50
    if (ctx.schemaObjects.size > 0) schemaValidationScore += 25
    if (ctx.validationSymbols.length > 0) schemaValidationScore += 15
    if (ctx.referenceSymbols.length > 0) schemaValidationScore += 10
    return { dataModelingScore: Math.min(100, dataModelingScore), schemaValidationScore: Math.min(100, schemaValidationScore) }
  }

  private insights(ctx: JsonContext): string[] {
    const out: string[] = []
    if (ctx.referenceSymbols.length > 0) out.push(`JSON references detected (${ctx.referenceSymbols.length})`)
    if (ctx.validationSymbols.length > 0) out.push(`Schema validation keywords detected (${ctx.validationSymbols.length})`)
    if (ctx.hasArrays) out.push(`Arrays detected (${ctx.arrayCount})`)
    return out
  }

  private valueType(node: Node): string {
    switch (node.type) {
      case "object": return "object"
      case "array": return "array"
      case "string": return "string"
      case "number": return "number"
      case "true":
      case "false": return "boolean"
      case "null": return "null"
      default: return "unknown"
    }
  }

  private keyText(pair: Node): string {
    const key = pair.type === "pair" ? pair.childForFieldName("key") : pair
    return key ? this.stripQuotes(key.text) : ""
  }

  private stripQuotes(text: string): string {
    const value = text.trim()
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') return value.slice(1, -1)
    return value
  }

  private addArrayObjectSymbol(ctx: JsonContext, node: Node, path: string): void {
    const bracket = path.lastIndexOf("[")
    const ownerName = bracket > 0 ? path.slice(0, bracket) : ctx.rootName
    const dot = path.lastIndexOf(".")
    const name = dot >= 0 ? path.slice(dot + 1) : path
    this.addSymbol(ctx, {
      name,
      kind: ASTEngine.SymbolKind.Class,
      qualifiedName: path,
      range: this.nodeToRange(node),
      ownerName,
      ownerKind: ASTEngine.SymbolKind.Variable,
      scope: ownerName,
      visibility: "public",
      returnType: "object",
      metadata: {
        jsonSpecific: true,
        nodeType: "object",
        valueType: "object",
        fullPath: path,
        isObject: true,
        isArrayItem: true,
        depth: this.pathDepth(path, ctx.rootName),
      },
    })
  }

  private childPath(parentPath: string, key: string): string {
    return parentPath ? `${parentPath}.${key}` : key
  }

  private pushArrayChildren(stack: PathFrame[], node: Node, parentPath: string): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (!child) continue
      const itemPath = `${parentPath}[${i}]`
      stack.push({
        node: child,
        parentPath: itemPath,
        emitObject: child.type === "object",
      })
    }
  }

  private pathDepth(path: string, rootName: string): number {
    if (path === rootName) return 0
    return path.slice(rootName.length + 1).split(".").length
  }

  private updateDepth(ctx: JsonContext, path: string): void {
    const depth = this.pathDepth(path, ctx.rootName)
    if (depth > ctx.maxDepth) ctx.maxDepth = depth
  }

  private pushNamedChildren(stack: PathFrame[], node: Node, parentPath: string): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push({ node: child, parentPath })
    }
  }

  private documentName(filePath: string): string {
    const slash = filePath.lastIndexOf("/")
    const base = slash >= 0 ? filePath.slice(slash + 1) : filePath
    const lower = base.toLowerCase()
    const suffix = ".json"
    const stem = lower.endsWith(suffix) ? base.slice(0, -suffix.length) : base
    return stem || "document"
  }

  private fileEndsWith(filePath: string, suffix: string): boolean {
    return filePath.toLowerCase().endsWith(suffix.toLowerCase())
  }

  private documentType(ctx: JsonContext): string {
    if (this.fileEndsWith(ctx.filePath, "package.json")) return "npm_package"
    if (this.fileEndsWith(ctx.filePath, "composer.json")) return "composer_package"
    if (this.isApiSpec(ctx)) return "openapi_spec"
    if (ctx.schemaObjects.size > 0 || ctx.symbolMap.has("$schema")) return "json_schema"
    return "generic_json"
  }

  private isApiSpec(ctx: JsonContext): boolean {
    return (ctx.symbolMap.has("openapi") || ctx.symbolMap.has("swagger")) && ctx.symbolMap.has("paths")
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
