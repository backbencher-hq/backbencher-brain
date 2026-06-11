// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
// Real JSON Intelligence Engine
// AST analysis for JSON with schema validation, API specification, and configuration intelligence

import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export interface JsonContext {
  currentFile: string
  content: string
  objectStack: string[]
  schemas: Record<string, boolean>
  apiEndpoints: Record<string, boolean>
  configSections: Record<string, boolean>
  symbols: UniversalSymbol[]
  symbolMap: Map<string, UniversalSymbol>
  dependencySymbols: UniversalSymbol[]
  referenceSymbols: UniversalSymbol[]
  schemaSymbols: UniversalSymbol[]
  apiEndpointSymbols: UniversalSymbol[]
  objectCount: number
  propertyCount: number
  hasNullValues: boolean
  hasBooleanValues: boolean
  hasArrays: boolean
  arrayCount: number
  docName?: string
  docVersion?: string
  docDescription?: string
  docAuthor?: string
  docSchema?: string
  maxDepth: number
  relationships: UniversalRelationship[]
  imports: ImportInfo[]
  exports: ExportInfo[]
  errors: ParseError[]
}

export class RealJsonAnalyzer implements LanguageAnalyzer {
  private addSymbol(ctx: JsonContext, symbol: UniversalSymbol) {
    ctx.symbols.push(symbol);
    ctx.symbolMap.set(symbol.name, symbol);
    if (symbol.metadata?.fullPath) {
      ctx.symbolMap.set(symbol.metadata.fullPath, symbol);
    }

    if (symbol.kind === SymbolKind.Class) ctx.objectCount++;
    if (symbol.kind === SymbolKind.Property) ctx.propertyCount++;
    if (symbol.returnType === "null") ctx.hasNullValues = true;
    if (symbol.returnType === "boolean") ctx.hasBooleanValues = true;
    if (symbol.metadata?.isArray) {
      ctx.hasArrays = true;
      ctx.arrayCount++;
    }
    if (symbol.metadata?.depth > ctx.maxDepth) ctx.maxDepth = symbol.metadata.depth;

    if (symbol.metadata?.isReference) ctx.referenceSymbols.push(symbol);
    if (symbol.metadata?.hasValidation) ctx.schemaSymbols.push(symbol);
    if (symbol.metadata?.isApiEndpoint) ctx.apiEndpointSymbols.push(symbol);

    if (symbol.metadata?.fullPath) {
      const path = symbol.metadata.fullPath;
      if (path.indexOf(".dependencies.") !== -1 || path.indexOf(".devDependencies.") !== -1 || path.indexOf(".require.") !== -1 || path.startsWith("dependencies.") || path.startsWith("devDependencies.")) {
        ctx.dependencySymbols.push(symbol);
      }
    }
  }

  private stripQuotes(str: string | undefined): string {
    if (!str) return ""
    let s = str.trim()
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
      return s.substring(1, s.length - 1)
    }
    return s
  }
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const ctx: JsonContext = {
      currentFile: filePath,
      content,
      objectStack: [],
      schemas: {},
      apiEndpoints: {},
      configSections: {},
      symbols: [],
      symbolMap: new Map(),
      dependencySymbols: [],
      referenceSymbols: [],
      schemaSymbols: [],
      apiEndpointSymbols: [],
      objectCount: 0,
      propertyCount: 0,
      hasNullValues: false,
      hasBooleanValues: false,
      hasArrays: false,
      arrayCount: 0,
      maxDepth: 0,
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
    }

    // ========================================================================
    // STAGE 3: RESILIENT PARSING & ERROR NODE BYPASS
    // ========================================================================
    if (rootNode.hasError) {
      const stack = [rootNode];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.type === "ERROR" || node.type === "MISSING") {
          ctx.errors.push({
            message: `Syntax ${node.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: node.startPosition.row,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row,
              endColumn: node.endPosition.column,
            },
            severity: "warning",
          })
        }
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) stack.push(child)
        }
      }
    }

    // PHASE 1: Extract all JSON symbols with proper object scoping
    this.extractSymbolsWithScoping(ctx, rootNode)

    // PHASE 2: Analyze JSON relationships (object references, schema dependencies)
    this.analyzeRelationships(ctx, rootNode)

    // PHASE 3: Process references and imports
    this.processImportsExports(ctx, rootNode)

    // PHASE 4: Detect JSON frameworks and configuration types
    const frameworks = this.detectJsonFrameworks(ctx)
    const patterns = this.detectJsonPatterns(ctx)

    // PHASE 5: JSON-specific analysis (schema validation, API design, data modeling)
    const structuralAnalysis = this.performStructuralAnalysis(ctx)

    const rootSymbol: UniversalSymbol = {
      name: "root",
      kind: SymbolKind.Module,
      range: this.nodeToRange(ctx, rootNode),
      scope: "",
      visibility: "public",
      metadata: {
        documentType: this.detectDocumentType(ctx),
        hasSchema: this.hasJsonSchema(ctx),
        isApiSpec: this.isApiSpecification(ctx),
        metadata: {
          name: ctx.docName,
          version: ctx.docVersion,
          description: ctx.docDescription,
          author: ctx.docAuthor,
          schema: ctx.docSchema,
          objectCount: ctx.objectCount,
          arrayCount: ctx.arrayCount,
          maxDepth: ctx.maxDepth,
          hasNullValues: ctx.hasNullValues,
          hasBooleanValues: ctx.hasBooleanValues,
          hasNestedObjects: ctx.maxDepth > 2
        },
        fileSize: ctx.content.length,
        objectCount: ctx.objectCount,
        arrayCount: ctx.arrayCount,
        jsonSpecific: true,
      }
    };
    this.addSymbol(ctx, rootSymbol);

    for (var _ji = 0; _ji < ctx.symbols.length; _ji++) { var js = ctx.symbols[_ji]; if (js.kind !== SymbolKind.Constant || js.name.startsWith("$")) { ctx.exports.push({ name: js.name, kind: js.kind, range: js.range, visibility: "public" }); } }
    return {
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: this.calculateRealComplexity(ctx),
        linesOfCode: ctx.content.split("\n").length,
        cyclomaticComplexity: ctx.objectCount + ctx.arrayCount + 1,
        framework: frameworks[0], // Primary framework
        patterns,

        // JSON intelligence metadata
        detectedFrameworks: frameworks,
        frameworkPatterns: this.getJsonFrameworkPatterns(ctx, frameworks),
        architecturalInsights: this.generateArchitecturalInsights(ctx),
        architecturalScore: this.calculateArchitecturalScore(ctx, patterns),
        codeQuality: this.assessJsonCodeQuality(ctx, patterns),
        hasTypeInference: false, // JSON is schema-less by default
        hasFrameworkIntelligence: true,
        dataModelingScore: structuralAnalysis.dataModelingScore,
        schemaValidationScore: structuralAnalysis.schemaValidationScore,
        apiDesignScore: this.calculateApiDesignScore(ctx, patterns),
        analysisVersion: "3.0.0-infallible-brain",
      },
    }
  }

  private extractSymbolsWithScoping(ctx: JsonContext, rootNode: Node, rootParentPath?: string) {
    const stack: { node: Node; parentPath?: string; isPop?: boolean }[] = [
      { node: rootNode, parentPath: rootParentPath, isPop: false },
    ]

    while (stack.length > 0) {
      const { node, parentPath, isPop } = stack.pop()!

      if (isPop) {
        if (node.type === "object") {
          ctx.objectStack.pop()
        }
        continue
      }

      switch (node.type) {
        case "document": {
          // extracted at the end of analyze
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentPath, isPop: false })
          }
          break
        }

        case "object": {
          const objectName = this.generateObjectName(ctx, parentPath)
          const currentPath = parentPath || "root";

          this.extractObject(ctx, node, parentPath)

          stack.push({ node, parentPath, isPop: true })

          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentPath: currentPath, isPop: false })
          }
          break
        }

        case "pair": {
          const keyNode = node.childForFieldName("key")
          const valueNode = node.childForFieldName("value")
          if (!keyNode) break

          const propertyName = this.stripQuotes(keyNode.text)
          const currentPath = this.buildPath(ctx, propertyName, parentPath)

          this.extractProperty(ctx, node, parentPath)

          if (valueNode) {
            stack.push({ node: valueNode, parentPath: currentPath, isPop: false })
          }
          break
        }

        case "array": {
          const arrayName = this.generateArrayName(ctx, parentPath)
          const currentPath = parentPath || "root";

          this.extractArray(ctx, node, parentPath)

          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentPath: currentPath, isPop: false })
          }
          break
        }

        case "string":
        case "number":
        case "true":
        case "false":
        case "null": {
          this.extractValue(ctx, node, parentPath)
          break
        }
      }
    }
  }

  

  private extractObject(ctx: JsonContext, node: Node, parentPath?: string) {
    const objectName = this.generateObjectName(ctx, parentPath)
          const currentPath = parentPath || "root";

    const properties = this.extractObjectProperties(ctx, node)
    const isNested = !!parentPath
    const depth = this.calculateDepth(ctx, currentPath)
    const hasRequiredFields = this.hasRequiredFields(ctx, properties)
    const isSchemaObject = this.isSchemaObject(ctx, properties)

    if (isSchemaObject) {
      ctx.schemas[objectName] = true
    }

    const symbol: UniversalSymbol = {
      name: objectName,
      kind: SymbolKind.Class,
      range: this.nodeToRange(ctx, node),
      scope: parentPath || "",
      visibility: "public",
      metadata: {
        fullPath: currentPath,
        properties,
        isNested,
        depth,
        hasRequiredFields,
        isSchemaObject,
        propertyCount: properties.length,
        jsonSpecific: true,
      },
    }

    this.addSymbol(ctx, symbol)
    ctx.objectStack.push(objectName)
  }

  private extractProperty(ctx: JsonContext, node: Node, parentPath?: string) {
    const keyNode = node.childForFieldName("key")
    const valueNode = node.childForFieldName("value")

    if (!keyNode) return

    const propertyName = this.stripQuotes(keyNode?.text)
    const currentPath = this.buildPath(ctx, propertyName, parentPath)

    const valueType = this.analyzeValueType(ctx, valueNode)
    const isRequired = this.isRequiredProperty(ctx, propertyName, parentPath)
    const isApiEndpoint = this.isApiEndpoint(ctx, propertyName, valueNode)
    const hasValidation = this.hasValidationRules(ctx, propertyName, valueNode)
    const isReference = this.isReference(ctx, keyNode, valueNode)

    let refPath: string | undefined = undefined;
    if (isReference && valueNode?.type === "string") {
      refPath = this.stripQuotes(valueNode.text)
    }

    if (!parentPath) {
      if (propertyName === "name") ctx.docName = this.stripQuotes(valueNode?.text);
      else if (propertyName === "version") ctx.docVersion = this.stripQuotes(valueNode?.text);
      else if (propertyName === "description") ctx.docDescription = this.stripQuotes(valueNode?.text);
      else if (propertyName === "author") ctx.docAuthor = this.stripQuotes(valueNode?.text);
      else if (propertyName === "$schema") ctx.docSchema = this.stripQuotes(valueNode?.text);
    }
    if (isApiEndpoint) ctx.apiEndpoints[propertyName] = true
    ctx.configSections[propertyName] = true

    const symbol: UniversalSymbol = {
      name: propertyName,
      kind: this.determinePropertySymbolKind(ctx, propertyName, valueType),
      range: this.nodeToRange(ctx, node),
      scope: parentPath || "",
      visibility: "public",
      metadata: {
        fullPath: currentPath,
        valueType,
        isRequired,
        isApiEndpoint,
        hasValidation,
        isReference,
        refPath,
        jsonSpecific: true,
      },
    }

    this.addSymbol(ctx, symbol)

    // The value node is now pushed into the iterative stack by extractSymbolsWithScoping
  }

  private extractArray(ctx: JsonContext, node: Node, parentPath?: string) {
    const arrayName = this.generateArrayName(ctx, parentPath)
          const currentPath = parentPath || "root";

    const itemCount = node.namedChildCount
    const itemTypes = this.analyzeArrayItemTypes(ctx, node)
    const isHomogeneous = this.isHomogeneousArray(ctx, itemTypes)
    const hasSchemaValidation = this.hasArraySchemaValidation(ctx, parentPath)

    const symbol: UniversalSymbol = {
      name: arrayName,
      kind: SymbolKind.Variable,
      range: this.nodeToRange(ctx, node),
      scope: parentPath || "",
      visibility: "public",
      metadata: {
        fullPath: currentPath,
        itemCount,
        itemTypes,
        isHomogeneous,
        hasSchemaValidation,
        isArray: true,
        jsonSpecific: true,
      },
    }

    this.addSymbol(ctx, symbol)
  }

  private detectJsonFrameworks(ctx: JsonContext): string[] {
    const frameworks: string[] = []
    const fileName = ctx.currentFile.toLowerCase()

    // Package managers based on filename mapping
    if (fileName.endsWith("package.json")) frameworks.push("npm/Node.js")
    if (fileName.endsWith("composer.json")) frameworks.push("Composer/PHP")
    if (fileName.endsWith("bower.json")) frameworks.push("Bower")

    // Real AST-based framework detection (No raw content.includes shortcuts)
    const hasSymbol = (name: string) => ctx.symbolMap.has(name)
    const hasDependency = (pkg: string) => {
      for (let i = 0; i < ctx.dependencySymbols.length; i++) {
        if (ctx.dependencySymbols[i].name === pkg) return true;
      }
      return false;
    }

    if (fileName.endsWith("tsconfig.json") || hasSymbol("compilerOptions")) frameworks.push("TypeScript")
    if (fileName.endsWith("eslint") || (hasSymbol("rules") && hasSymbol("env"))) frameworks.push("ESLint")
    if (fileName.endsWith("prettier") || hasSymbol("printWidth")) frameworks.push("Prettier")
    if (fileName.endsWith("webpack") || (hasSymbol("entry") && hasSymbol("output"))) frameworks.push("Webpack")
    if (fileName.endsWith("rollup") || (hasSymbol("format") && hasSymbol("file"))) frameworks.push("Rollup")
    if (fileName.endsWith("jest") || hasSymbol("testMatch")) frameworks.push("Jest")

    if (hasSymbol("openapi") || hasSymbol("swagger")) frameworks.push("OpenAPI/Swagger")
    if (hasSymbol("$schema") || (hasSymbol("type") && hasSymbol("properties") && hasSymbol("required")))
      frameworks.push("JSON Schema")

    if (hasSymbol("$oid") || hasSymbol("$date")) frameworks.push("MongoDB")
    if (hasSymbol("Version") && hasSymbol("Resources")) frameworks.push("AWS CloudFormation")

    if (fileName.endsWith("serverless") || (hasSymbol("service") && hasSymbol("provider"))) {
      frameworks.push("Serverless Framework")
    }

    // Precise JS library detection via AST dependency objects
    if (hasDependency("react") || hasDependency("@types/react")) frameworks.push("React")
    if (hasDependency("vue") || hasDependency("@vue/core")) frameworks.push("Vue.js")
    if (hasDependency("@angular/core") || hasDependency("@angular/cli")) frameworks.push("Angular")
    if (hasDependency("next")) frameworks.push("Next.js")
    if (hasDependency("nuxt")) frameworks.push("Nuxt.js")
    if (hasDependency("svelte")) frameworks.push("Svelte")

    const unique: Record<string, boolean> = {};
    const result: string[] = [];
    for (let i = 0; i < frameworks.length; i++) {
      if (!unique[frameworks[i]]) {
        unique[frameworks[i]] = true;
        result.push(frameworks[i]);
      }
    }
    return result;
  }

  private detectJsonPatterns(ctx: JsonContext): string[] {
    const patterns: string[] = []
    const hasSymbol = (name: string) => ctx.symbolMap.has(name)

    if (hasSymbol("$schema") || (hasSymbol("type") && hasSymbol("properties"))) {
      patterns.push("JSON Schema Validation")
    }
    if ((() => { for(const _ in ctx.apiEndpoints) return true; return false; })()) patterns.push("RESTful API Design")
    if (hasSymbol("env") || hasSymbol("config")) patterns.push("Configuration Management")
    if (((() => { for(const _ in ctx.schemas) return true; return false; })())) patterns.push("Structured Data Modeling")
    if ((ctx.maxDepth > 3)) patterns.push("Deep Nested Structures")
    if (ctx.hasArrays) patterns.push("Collection Data Types")
    if (hasSymbol("$ref") || hasSymbol("id")) patterns.push("Reference-based Relationships")
    if (hasSymbol("en") || hasSymbol("locale") || hasSymbol("i18n")) patterns.push("Internationalization Support")
    if (hasSymbol("version") || hasSymbol("apiVersion")) patterns.push("Version Management")

    return patterns
  }

  private performStructuralAnalysis(ctx: JsonContext): any {
    const analysis = {
      dataModelingScore: 75,
      schemaValidationScore: 60,
    }

    const objectCount = ctx.objectCount;
    const propertyCount = ctx.propertyCount;

    if (objectCount > 0) {
      const avgPropertiesPerObject = propertyCount / objectCount
      if (avgPropertiesPerObject > 5) analysis.dataModelingScore += 10
    }

    const hasSymbol = (name: string) => ctx.symbolMap.has(name)
    if (hasSymbol("$schema")) analysis.schemaValidationScore += 20
    if (hasSymbol("required")) analysis.schemaValidationScore += 15
    if (hasSymbol("type") && hasSymbol("properties")) analysis.schemaValidationScore += 10

    return analysis
  }

  private buildPath(ctx: JsonContext, key: string, parentPath?: string): string {
    if (!parentPath || parentPath === "root") return key;
    return `${parentPath}.${key}`;
  }

  private nodeToRange(ctx: JsonContext, node: Node): UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private generateObjectName(ctx: JsonContext, parentPath?: string): string {
    return `object_${ctx.objectStack.length}`
  }

  private generateArrayName(ctx: JsonContext, parentPath?: string): string {
    return "array"
  }

  private determinePropertySymbolKind(ctx: JsonContext, propertyName: string, valueType: string): SymbolKind {
    if (valueType === "object") return SymbolKind.Class
    if (valueType === "array") return SymbolKind.Variable
    if (propertyName.toUpperCase() === propertyName) return SymbolKind.Constant
    return SymbolKind.Property
  }

  private extractValue(ctx: JsonContext, node: Node, parentPath?: string): void {
    const valueType = this.analyzeValueType(ctx, node)
    const isReference = this.isReference(ctx, null, node)

    let refPath: string | undefined = undefined;
    if (isReference && node.type === "string") {
      refPath = this.stripQuotes(node.text)
    }

    if (this.shouldCreateSymbolForValue(ctx, node, parentPath)) {
      const valueName = parentPath
        ? `${parentPath}_value`
        : `value_${node.startPosition.row}_${node.startPosition.column}`

      this.addSymbol(ctx, {
        name: valueName,
        kind: SymbolKind.Constant,
        range: this.nodeToRange(ctx, node),
        returnType: valueType,
        metadata: {
          nodeType: node.type,
          isJsonValue: true,
          path: parentPath || "root",
          valueType,
          isComplex: false,
          isReference,
          refPath,
          hasValidation: this.hasValidationRules(ctx, valueName, node),
        },
      })
    }
  }

  private detectDocumentType(ctx: JsonContext): string {
    const fileName = ctx.currentFile.toLowerCase()
    if (fileName.endsWith("package.json")) return "npm_package"
    if (fileName.endsWith("composer.json")) return "composer_package"

    const hasSymbol = (name: string) => ctx.symbolMap.has(name)
    if (hasSymbol("openapi") || hasSymbol("swagger")) return "openapi_spec"
    if (hasSymbol("$schema") && hasSymbol("type")) return "json_schema"
    if (fileName.endsWith("config") || fileName.endsWith("settings")) return "configuration"
    if (fileName.endsWith("manifest.json")) return "manifest"
    if (hasSymbol("tables") || hasSymbol("schema")) return "database_schema"
    if (hasSymbol("data") && (hasSymbol("status") || hasSymbol("message"))) return "api_response"
    if (fileName.endsWith("test") || fileName.endsWith("fixture") || fileName.endsWith("mock")) return "test_data"
    if (fileName.endsWith("i18n") || fileName.endsWith("locale") || fileName.endsWith("lang")) return "translation"

    return "generic_json"
  }

  private hasJsonSchema(ctx: JsonContext): boolean {
    return ctx.symbolMap.has("$schema")
  }

  private isApiSpecification(ctx: JsonContext): boolean {
    const hasSymbol = (name: string) => ctx.symbolMap.has(name)
    return (
      (hasSymbol("openapi") && hasSymbol("paths")) ||
      (hasSymbol("swagger") && hasSymbol("paths")) ||
      (hasSymbol("info") && hasSymbol("version") && hasSymbol("paths"))
    )
  }

  

  

  

  private extractObjectProperties(ctx: JsonContext, node: Node): any[] {
    const properties: any[] = []
    if (node.type === "object") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child?.type === "pair") {
          const keyNode = child.childForFieldName("key")
          const valueNode = child.childForFieldName("value")

          if (keyNode) {
            const cleanKey = this.stripQuotes(keyNode.text)
            properties.push({
              name: cleanKey,
              type: valueNode ? this.analyzeValueType(ctx, valueNode) : "unknown",
              required: this.isRequiredProperty(ctx, cleanKey, ""),
              hasValidation: this.hasValidationRules(ctx, cleanKey, valueNode),
              isApiEndpoint: this.isApiEndpoint(ctx, cleanKey, valueNode),
              isReference: this.isReference(ctx, keyNode, valueNode),
              isComplex: valueNode ? this.isComplexValue(ctx, valueNode) : false,
            })
          }
        }
      }
    }
    return properties
  }

  private calculateDepth(ctx: JsonContext, path: string): number {
    if (!path) return 0;
    const parts = path.split(".");
    let count = 0;
    for (let i = 0; i < parts.length; i++) {
       if (parts[i].length > 0) count++;
    }
    return count;
  }

  private hasRequiredFields(ctx: JsonContext, properties: any[]): boolean {
    for (let i = 0; i < properties.length; i++) {
      if (properties[i].required) return true;
    }
    return false;
  }

  private isSchemaObject(ctx: JsonContext, properties: any[]): boolean {
    const schemaKeywords = ["type", "properties", "required", "additionalProperties", "items", "enum"];
    let matchCount = 0;
    for (let i = 0; i < properties.length; i++) {
      for (let j = 0; j < schemaKeywords.length; j++) {
         if (schemaKeywords[j] === properties[i].name) {
            matchCount++;
            break;
         }
      }
    }
    return matchCount >= 2;
  }

  private analyzeValueType(ctx: JsonContext, node?: Node | null): string {
    if (!node) return "null"
    switch (node.type) {
      case "object":
        return "object"
      case "array":
        return "array"
      case "string":
        return "string"
      case "number":
        return /^-?d+$/.test(node.text.trim()) ? "integer" : "number"
      case "true":
      case "false":
        return "boolean"
      case "null":
        return "null"
      default:
        const text = node.text.trim()
        if (text === "null") return "null"
        if (text === "true" || text === "false") return "boolean"
        if (/^-?d+$/.test(text)) return "integer"
        if (/^-?d*.d+$/.test(text)) return "number"
        if (text.startsWith('"') && text.endsWith('"')) return "string"
        return "unknown"
    }
  }

  private isRequiredProperty(ctx: JsonContext, propertyName: string, parentPath?: string): boolean {
    const requiredPatterns = ["id", "name", "type", "version", "required", "apiVersion", "kind", "metadata"]
    const cleanName = this.stripQuotes(propertyName)
    let isMatched = false;
    for (let i = 0; i < requiredPatterns.length; i++) {
       if (requiredPatterns[i] === cleanName) { isMatched = true; break; }
    }
    return (
      isMatched ||
      cleanName.endsWith("Id") ||
      cleanName.endsWith("Name") ||
      cleanName === "required" ||
      cleanName === "isRequired"
    )
  }

  private isApiEndpoint(ctx: JsonContext, propertyName: string, valueNode?: Node | null): boolean {
    const cleanName = this.stripQuotes(propertyName)
    const pathPatterns = [/^\/api/, /^\/v\d/, /^\/\w+\/\{/, /\{.*\}/, /\/.*\/.*/]

    for (let i = 0; i < pathPatterns.length; i++) {
      if (pathPatterns[i].test(cleanName)) return true;
    }

    if (valueNode && valueNode.type === "object") {
      let hasApiProps = false
      for (let i = 0; i < valueNode.namedChildCount; i++) {
        const pair = valueNode.namedChild(i)
        if (pair?.type === "pair") {
          const k = this.stripQuotes(pair.childForFieldName("key")?.text)
          const verbs = ["get", "post", "put", "delete", "parameters", "responses"];
          let match = false;
          for (let m = 0; m < verbs.length; m++) {
             if (verbs[m] === (k || "")) { match = true; break; }
          }
          if (match) {
            hasApiProps = true
          }
        }
      }
      return hasApiProps
    }
    return false
  }

  private hasValidationRules(ctx: JsonContext, propertyName: string, valueNode?: Node | null): boolean {
    const validationKeywords = [
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "pattern",
      "format",
      "enum",
      "const",
      "multipleOf",
      "minItems",
      "maxItems",
      "uniqueItems",
    ]
    const cleanName = this.stripQuotes(propertyName)

    for (let i = 0; i < validationKeywords.length; i++) {
      if (validationKeywords[i] === cleanName) return true;
    }

    if (valueNode && valueNode.type === "object") {
      for (let i = 0; i < valueNode.namedChildCount; i++) {
        const pair = valueNode.namedChild(i)
        if (pair?.type === "pair") {
          const k = this.stripQuotes(pair.childForFieldName("key")?.text)
          if (k) {
            for (let m = 0; m < validationKeywords.length; m++) {
              if (validationKeywords[m] === k) return true;
            }
          }
        }
      }
    }
    return false
  }

  private isReference(ctx: JsonContext, keyNode?: Node | null, valueNode?: Node | null): boolean {
    if (keyNode && keyNode.text === '"$ref"') return true
    if (valueNode && valueNode.type === "string") {
      const text = valueNode.text
      return text.indexOf("#/") !== -1 || text.indexOf("definitions/") !== -1 || text.indexOf("components/") !== -1
    }
    return false
  }

  private isComplexValue(ctx: JsonContext, node: Node): boolean {
    return node.type === "object" || node.type === "array"
  }

  private analyzeArrayItemTypes(ctx: JsonContext, node: Node): string[] {
    const itemTypes: string[] = []
    if (node.type === "array") {
      const limit = Math.min(node.namedChildCount, 100);
      for (let i = 0; i < limit; i++) {
        const item = node.namedChild(i)
        if (item) {
          const t = this.analyzeValueType(ctx, item);
          if (itemTypes.indexOf(t) === -1) itemTypes.push(t);
        }
      }
    }
    return itemTypes
  }

  private isHomogeneousArray(ctx: JsonContext, itemTypes: string[]): boolean {
    if (itemTypes.length <= 1) return true;
    const first = itemTypes[0];
    for (let i = 1; i < itemTypes.length; i++) {
       if (itemTypes[i] !== first) return false;
    }
    return true;
  }

  private hasArraySchemaValidation(ctx: JsonContext, parentPath?: string): boolean {
    if (!parentPath) return false;
    const parts = parentPath.split(".");
    for (let i = 0; i < parts.length; i++) {
       const p = parts[i];
       if (p === "items" || p === "properties" || p === "definitions" || p === "components") return true;
    }
    return false;
  }

  private calculateApiDesignScore(ctx: JsonContext, patterns: string[]): number {
    let score = 80
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "openapi_spec") score += 10;
      if (patterns[i] === "json_schema") score += 8;
      if (patterns[i] === "rest_api") score += 6;
    }

    let hasVersioning = false;
    for (let i = 0; i < ctx.symbols.length; i++) {
       const n = ctx.symbols[i].name;
       if (n === "version" || n === "apiVersion" || n === "v1" || n === "v2") { hasVersioning = true; break; }
    }
    if (hasVersioning) score += 5

    const hasDocumentation = (ctx.symbolMap.has("description") || ctx.symbolMap.has("summary"))
    if (hasDocumentation) score += 5

    const hasErrorHandling = (ctx.symbolMap.has("error") || ctx.symbolMap.has("status"))
    if (hasErrorHandling) score += 3

    return Math.min(100, score)
  }

  private calculateRealComplexity(ctx: JsonContext): number {
    let complexity = ctx.symbols.length;
    for (const s of ctx.symbols) {
      if (s.metadata?.isComplex) complexity += 1.5;
      if (s.metadata?.isArray) complexity += 1;
      if (s.metadata?.isReference) complexity += 2;
    }
    return Math.round(complexity);
  }

  

  private analyzeRelationships(ctx: JsonContext, node: Node): void {
    this.findReferenceRelationships(ctx, node)
    this.findSchemaRelationships(ctx, node)
    this.findApiRelationships(ctx, node)
  }

  private processImportsExports(ctx: JsonContext, node: Node): void {
    const fileName = ctx.currentFile.toLowerCase()

    // Extract Dependencies from Package.json
    if (fileName.endsWith("package.json") || fileName.endsWith("composer.json")) {
      const depSymbols = ctx.dependencySymbols

      for (const dep of depSymbols) {
        // dep.name is the package name (e.g. "react" or "lodash")
        // we add it to the imports pool so the Universal Brain links them
        let versionNode: UniversalSymbol | undefined = undefined;
        for (let i = 0; i < ctx.symbols.length; i++) {
           if (ctx.symbols[i].metadata?.fullPath === dep.metadata?.fullPath + "." + dep.name) {
              versionNode = ctx.symbols[i];
              break;
           }
        }
        ctx.imports.push({
          module: dep.name,
          symbols: [],
          range: dep.range,
          type: "dependency",
          resolvedPath: "package-manager",
        })

        ctx.relationships.push({
          source: "package_manifest",
          target: dep.name,
          type: RelationshipType.Uses,
          confidence: 1.0,
          metadata: {
            relationshipType: "package_dependency",
            version: versionNode?.returnType || "unknown",
          },
        })
      }
    }
  }
  private getJsonFrameworkPatterns(ctx: JsonContext, frameworks: string[]): any[] {
    const patterns: any[] = []
    for (const framework of frameworks) {
      switch (framework) {
        case "OpenAPI/Swagger":
          patterns.push({
            framework: "OpenAPI Specification",
            type: "api_specification",
            patterns: this.detectOpenApiPatterns(ctx),
            confidence: 0.9,
            characteristics: {
              hasInfo: ctx.symbolMap.has("info"),
              hasPaths: ctx.symbolMap.has("paths"),
              hasComponents: ctx.symbolMap.has("components"),
              hasSchemas: ctx.symbolMap.has("schemas"),
              hasOperations: (ctx.apiEndpointSymbols.length > 0),
            },
          })
          break
        case "JSON Schema":
          patterns.push({
            framework: "JSON Schema",
            type: "data_validation",
            patterns: this.detectJsonSchemaPatterns(ctx),
            confidence: 0.9,
            characteristics: {
              hasType: ctx.symbolMap.has("type"),
              hasProperties: ctx.symbolMap.has("properties"),
              hasRequired: ctx.symbolMap.has("required"),
              hasValidation: (ctx.schemaSymbols.length > 0),
            },
          })
          break
        case "npm/Node.js":
          patterns.push({
            framework: "NPM Package",
            type: "package_management",
            patterns: this.detectPackageJsonPatterns(ctx),
            confidence: 0.8,
            characteristics: {
              hasName: ctx.symbolMap.has("name"),
              hasVersion: ctx.symbolMap.has("version"),
              hasDependencies: ctx.symbolMap.has("dependencies"),
              hasScripts: ctx.symbolMap.has("scripts"),
            },
          })
          break
      }
    }
    return patterns
  }

  private generateArchitecturalInsights(ctx: JsonContext): any[] {
    const insights: any[] = []
    let complexCount = 0;
    for (const s of ctx.symbols) if (s.metadata?.isComplex) complexCount++;
    if (complexCount > 10) {
      insights.push({
        type: "complexity",
        severity: "info",
        message: `High structural complexity with ${complexCount} complex objects`,
        recommendation: "Consider breaking down large objects into smaller, focused schemas",
      })
    }

    const referenceSymbols = ctx.referenceSymbols
    if (referenceSymbols.length > 0) {
      insights.push({
        type: "reusability",
        severity: "info",
        message: `Good use of references (${referenceSymbols.length} found) for schema reusability`,
        recommendation: "Ensure all references are properly resolvable",
      })
    }

    const apiSymbols = ctx.apiEndpointSymbols
    if (apiSymbols.length > 0) {
      insights.push({
        type: "api_design",
        severity: "info",
        message: `API specification detected with ${apiSymbols.length} endpoints`,
        recommendation: "Follow REST conventions and provide comprehensive documentation",
      })
    }

    const validationSymbols = ctx.schemaSymbols
    if (validationSymbols.length === 0 && ctx.symbols.length > 5) {
      insights.push({
        type: "data_validation",
        severity: "warning",
        message: "No validation rules detected in schema",
        recommendation: "Add validation constraints to improve data quality",
      })
    }
    return insights
  }

  private calculateArchitecturalScore(ctx: JsonContext, patterns: string[]): number {
    let score = 75
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "json_schema") score += 10;
      if (patterns[i] === "openapi_spec") score += 8;
      if (patterns[i] === "rest_api") score += 6;
    }

    if ((ctx.schemaSymbols.length > 0)) score += 5
    if ((ctx.referenceSymbols.length > 0)) score += 3

    let sum = 0;
    for (let i = 0; i < ctx.symbols.length; i++) {
       sum += ctx.symbols[i].metadata?.depth || 1;
    }
    const avgDepth = sum / (ctx.symbols.length || 1);
    if (avgDepth > 4) score -= 5
    return Math.max(40, Math.min(100, score))
  }

  private shouldCreateSymbolForValue(ctx: JsonContext, node: Node, parentPath?: string): boolean {
    return (
      node.type === "object" ||
      node.type === "array" ||
      (!!parentPath &&
        (() => {
          const parts = parentPath.split(".");
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (p === "schema" || p === "definition" || p === "component" || p === "properties") return true;
          }
          return false;
        })())
    )
  }

  private determineValueSymbolKind(ctx: JsonContext, node: Node): SymbolKind {
    switch (node.type) {
      case "object":
        return SymbolKind.Class
      case "array":
        return SymbolKind.Variable
      default:
        return SymbolKind.Constant
    }
  }

  

  private findReferenceRelationships(ctx: JsonContext, node: Node): void {
    const referenceSymbols = ctx.referenceSymbols
    for (const ref of referenceSymbols) {
      const refPath = ref.metadata?.refPath
      if (refPath) {
        let targetName = refPath;
        let externalFile = "";
        if (targetName.includes("#/")) {
          const split = targetName.split("#/");
          externalFile = split[0];
          targetName = split[1].replace(/\//g, "."); // "definitions/User" -> "definitions.User"
        } else if (targetName.startsWith("#")) {
          targetName = targetName.substring(1);
        }
        
        const referencedSymbol = ctx.symbolMap.get(targetName)
        if (referencedSymbol) {
          ctx.relationships.push({
            source: ref.name,
            target: referencedSymbol.name,
            type: RelationshipType.References,
            confidence: 1.0,
            metadata: { relationshipType: "json_reference", isReference: true, refPath },
          })
        } else {
          // Cross-file reference! Emitted with external target so the global linker can resolve it.
          ctx.relationships.push({
            source: ref.name,
            target: targetName, 
            type: RelationshipType.References,
            confidence: 0.8,
            metadata: { relationshipType: "json_reference", isReference: true, refPath, isExternal: true, targetExternalFile: externalFile },
          })
        }
      }
    }
  }

  private findSchemaRelationships(ctx: JsonContext, node: Node): void {
    const schemaSymbols = ctx.schemaSymbols
    for (const schema of schemaSymbols) {
      if (schema.metadata?.isComplex) {
        ctx.relationships.push({
          source: schema.name,
          target: "json_schema_root",
          type: RelationshipType.Uses,
          confidence: 0.8,
          metadata: { relationshipType: "json_schema_composition" },
        })
      }
    }
  }

  private findApiRelationships(ctx: JsonContext, node: Node): void {
    const apiSymbols = ctx.apiEndpointSymbols
    for (const endpoint of apiSymbols) {
      ctx.relationships.push({
        source: endpoint.name,
        target: "api_specification",
        type: RelationshipType.Uses,
        confidence: 0.9,
        metadata: { relationshipType: "json_api_endpoint", isApiEndpoint: true },
      })
    }
  }

  private detectOpenApiPatterns(ctx: JsonContext): string[] {
    const patterns: string[] = []
    if ((ctx.symbolMap.has("openapi") || ctx.symbolMap.has("swagger"))) patterns.push("openapi_specification")
    if (ctx.symbolMap.has("paths")) patterns.push("rest_endpoints")
    if (ctx.symbolMap.has("components")) patterns.push("component_reuse")
    if (ctx.symbolMap.has("security")) patterns.push("security_schemes")
    return patterns
  }

  private detectJsonSchemaPatterns(ctx: JsonContext): string[] {
    const patterns: string[] = []
    if (ctx.symbolMap.has("properties")) patterns.push("object_schema")
    if (ctx.symbolMap.has("items")) patterns.push("array_schema")
    if ((ctx.schemaSymbols.length > 0)) patterns.push("validation_rules")
    if ((ctx.referenceSymbols.length > 0)) patterns.push("schema_references")
    return patterns
  }

  private detectPackageJsonPatterns(ctx: JsonContext): string[] {
    const patterns: string[] = []
    if (ctx.symbolMap.has("scripts")) patterns.push("npm_scripts")
    if (ctx.symbolMap.has("dependencies")) patterns.push("dependency_management")
    if (ctx.symbolMap.has("devDependencies")) patterns.push("dev_dependencies")
    if (ctx.symbolMap.has("engines")) patterns.push("engine_constraints")
    return patterns
  }

  private assessJsonCodeQuality(ctx: JsonContext, patterns: string[]): string {
    const score = this.calculateArchitecturalScore(ctx, patterns)
    return score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "Poor"
  }
}
