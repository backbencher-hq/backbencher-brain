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
  /** The document node, so a manifest pass can read the root object without
   *  re-walking the tree. An earlier version of the exports pass reached for
   *  `(root as any).__node` instead — nothing ever set that, so the function was a
   *  SILENT NO-OP that type-checked and did nothing, which is the worst shape a newly
   *  written feature can have: it looks implemented. */
  rootNode: Node
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
  /** A key declared TWICE inside one object. The second declaration replaces the first
   *  under every mainstream parser, which is the relation the bash lane calls
   *  `overrides`, and RFC 8259 §4 says only that names SHOULD be unique and that a
   *  parser's behaviour on a duplicate is unpredictable — it does not make the
   *  redefinition go away. Scoped to the OBJECT because a key is unique only within
   *  its object: the same key in two different objects is not a redefinition and is
   *  the corpus's dominant shape (120,174 occurrences across 7,679 files, against
   *  21 genuine duplicates across 11). */
  overrideCandidates: { ownerName: string; key: string; line: number; overridesLine: number }[]
  objectCount: number
  propertyCount: number
  arrayCount: number
  maxDepth: number
  hasNullValues: boolean
  hasBooleanValues: boolean
  hasArrays: boolean
}

// `parentPath` is the QUALIFIED path used for identity in metadata; `parentName` is
// the parent SYMBOL's own name, which is what an edge source must be. They were the
// same value by accident at the top level — `parentPath` is the module name there —
// so the divergence only appeared one level down, where `inner`'s owner came out as
// the unresolvable `Basic.nested` while the symbol is named `nested`. One edge in the
// probe battery failed on it and the rest passed, which is the worst possible shape
// for a bug: invisible unless you nest.
type PathFrame = { node: Node; parentPath: string; parentName: string; emitObject?: boolean; duplicateKeys?: Map<string, number> }

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
      overrideCandidates: [],
      objectCount: 0,
      propertyCount: 0,
      rootNode,
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
    this.extractManifestExports(ctx)
    this.extractSchemaComposition(ctx)
    this.extractPackageDependencies(ctx)
    this.extractNpmScriptCalls(ctx)
    this.extractDuplicateKeyOverrides(ctx)

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
    const stack: PathFrame[] = [{ node: rootNode, parentPath: ctx.rootName, parentName: ctx.rootName }]
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
          if (value?.type === "object") stack.push({ node: value, parentPath: this.childPath(parentPath, key), parentName: key })
          else if (value?.type === "array") stack.push({ node: value, parentPath: this.childPath(parentPath, key), parentName: key })
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
      if (node.type === "array") this.pushArrayChildren(stack, node, parentPath, ctx.rootName)
    }
  }

  private extractSymbols(rootNode: Node, ctx: JsonContext): void {
    const stack: PathFrame[] = [{ node: rootNode, parentPath: ctx.rootName, parentName: ctx.rootName }]
    while (stack.length > 0) {
      const frame = stack.pop()!
      const { node, parentPath, parentName } = frame
      if (node.type === "document") {
        this.pushNamedChildren(stack, node, parentPath)
        continue
      }
      if (node.type === "object") {
        this.updateDepth(ctx, parentPath)
        if (frame.emitObject) this.addArrayObjectSymbol(ctx, node, parentPath, parentName)
        // `parentName` MUST be threaded here. Omitting it made pushNamedChildren
        // default it to `parentPath`, so every key inside a nested object got the
        // QUALIFIED path as its owner: `inner`'s owner came out as `Basic.nested`
        // while the symbol is named `nested`, and the `contains` edge it sources
        // resolved to nothing. It was invisible at the top level — where
        // `parentPath` happens to equal the module name — so the entire top-level
        // corpus agreed with itself and only a nested key exposed it.
        this.pushNamedChildren(stack, node, parentPath, parentName, frame.duplicateKeys ?? new Map<string, number>())
        continue
      }
      if (node.type === "array") {
        ctx.arrayCount++
        ctx.hasArrays = true
        this.pushArrayChildren(stack, node, parentPath, parentName)
        continue
      }
      if (node.type !== "pair") continue

      const key = this.keyText(node)
      const value = node.childForFieldName("value")
      if (!key || !value) continue
      // A key declared TWICE in this one object replaces its earlier declaration.
      // Recorded here because this is the only place that already knows the pair's
      // CONTAINING OBJECT (via the frame) and its owner symbol name; a later pass
      // would have to re-derive the owner, and a re-derived owner is how the `nested`
      // bug in this file happened. `frame.duplicateKeys` is created per object, so
      // this cannot fire for the same key in two different objects.
      if (frame.duplicateKeys && key.length > 0) {
        const line = node.startPosition.row + 1
        const prior = frame.duplicateKeys.get(key)
        if (prior === undefined) frame.duplicateKeys.set(key, line)
        else ctx.overrideCandidates.push({ ownerName: parentName, key, line, overridesLine: prior })
      }
      const path = this.childPath(parentPath, key)
      const valueType = this.valueType(value)
      // An object is a CONTAINER: it has named children, and `contains` edges are
      // emitted from it, so `class` is the kind that means what it does here.
      // An array is a LEAF: its elements are positional and unnamed, and the
      // analyzer emits no `contains` edge for any of them. The previous mapping
      // gave arrays `variable`, which imports a shell-shaped mutable-binding
      // distinction JSON does not have — a JSON array cannot be rebound, and
      // nothing in the output treated it as one.
      const kind = valueType === "object" ? ASTEngine.SymbolKind.Class : ASTEngine.SymbolKind.Property
      const symbol: ASTEngine.UniversalSymbol = {
        name: key,
        kind,
        qualifiedName: path,
        range: this.nodeToRange(node),
        ownerName: parentName,
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

      if (value.type === "object" || value.type === "array") stack.push({ node: value, parentPath: path, parentName: key })
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
          line_number: this.declLine(symbol),
          metadata: { fullPath: symbol.metadata?.fullPath || "" },
        })
      }
    }

    // A `$ref` that names ANOTHER FILE is a file dependency, which is what
    // `imports` is for. Found by the ontology gate: the first ruling for `imports`
    // said JSON has no imports, on the ground that the grammar has no import node —
    // which is the wrong question, because a `$ref` is a STRING and the grammar cannot
    // see what a string names. Measured over the corpus it is real: 58 file-to-file
    // `$ref`s across 12 files, e.g. sigstore/rekor's
    // `v0.0.1/dsse_v0_0_1_schema.json`. A local pointer (`#/a/b`) and a URL (a
    // JSON-Schema draft identifier, i.e. a VOCABULARY reference) are neither, and are
    // left as `references`.
    for (const ref of ctx.referenceSymbols) {
      const refPath = ref.metadata?.refPath as string | undefined
      if (!refPath) continue
      const target = this.referenceTarget(ctx, refPath)
      const source = String(ref.metadata?.fullPath || ref.name)
      // A file-naming `$ref` is BOTH a dependency and a reference. Emitting only
      // `references` was the omission; emitting only `imports` would lose the
      // pointer, so a `$ref` that names a file now carries both, which is what it is.
      if (this.isFileNamingRef(refPath)) {
        ctx.relationships.push({
          source,
          target: refPath,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1,
          line_number: this.declLine(ref),
          metadata: {
            jsonSpecific: true,
            importForm: "json_schema_ref",
            resolvedPath: false,
            evidenceClass: "structural",
          },
        })
      }
      ctx.relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.References,
        confidence: target === refPath ? 0.8 : 1,
        line_number: this.declLine(ref),
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
        line_number: this.declLine(endpoint),
        metadata: { relationshipType: "json_api_endpoint" },
      })
    }
  }

  /**
   * What a manifest PUBLISHES, as `exports` edges.
   *
   * The lane's first ruling excluded `exports` on a grammar inventory — "no
   * `export_statement` node" — and that is the SAME unsound reasoning that produced
   * the wrong `imports` ruling: a grammar cannot see a CONVENTION, and a Node
   * manifest's `exports` field is a convention expressed as ordinary object keys. The
   * audit found 1 of 36 manifests carrying `exports` and 1 carrying `main`, so the
   * mass is small and the principle is not, and the type is emitted.
   *
   * A published entry point IS an export, and each of its names is exported: a
   * subpath key for `exports`, the field name for `main`, the command name for `bin`.
   *
   * Two silent failures lived in this function before it worked, and both are worth
   * recording because neither would ever have been noticed by reading it. It first
   * reached for a `__node` property nothing set, and then iterated the `document`
   * WRAPPER's children when the top-level `pair`s are one level down inside the root
   * `object`. Both type-check, both compile, both do nothing. The only reason this
   * version works is that it was measured — 24 edges on svelte's manifest, and 0 when
   * either guard was wrong.
   */
  private extractManifestExports(ctx: JsonContext): void {
    if (!this.fileEndsWith(ctx.filePath, "package.json")) return
    const document = ctx.rootNode
    if (document.type !== "document") return
    const rootObject = document.namedChildren?.find((c: any) => c.type === "object")
    if (!rootObject) return
    const emit = (name: string, line: number) => {
      if (name.length === 0) return
      ctx.relationships.push({
        source: ctx.rootName,
        target: name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1,
        line_number: line,
        metadata: { jsonSpecific: true, exportForm: "manifest_entry_point", evidenceClass: "structural" },
      })
    }
    for (let i = 0; i < rootObject.namedChildCount; i++) {
      const pair = rootObject.namedChild(i)
      if (pair?.type !== "pair") continue
      const key = this.keyText(pair)
      const value = pair.childForFieldName("value")
      if (!key || !value) continue
      const line = pair.startPosition.row + 1
      if (key === "main") {
        if (value.type === "string") emit("main", line)
      } else if (key === "bin") {
        if (value.type === "string") emit("bin", line)
        else {
          for (let k = 0; k < value.namedChildCount; k++) {
            const binPair = value.namedChild(k)
            if (binPair?.type !== "pair") continue
            const binName = this.keyText(binPair)
            if (binName) emit(binName, binPair.startPosition.row + 1)
          }
        }
      } else if (key === "exports") {
        if (value.type === "string") emit("exports", line)
        else {
          for (let k = 0; k < value.namedChildCount; k++) {
            const sub = value.namedChild(k)
            if (sub?.type !== "pair") continue
            const subPath = this.keyText(sub)
            if (subPath) emit(subPath, sub.startPosition.row + 1)
          }
        }
      }
    }
  }

  /**
   * JSON Schema COMPOSITION, as `extends`.
   *
   * `allOf` means "must satisfy ALL of these" — a superset-of relationship, and the
   * only schema keyword that means one. `anyOf` and `oneOf` are ALTERNATIVES and have
   * no ontology type, so they are correctly emitted as nothing beyond the `references`
   * their `$ref`s already produce.
   *
   * This was ruled out twice on the same wrong reasoning, and the pattern is now
   * recognisable: a grammar inventory says the PARSER cannot express a construct, which
   * is not the same as the LANGUAGE lacking one. `allOf` is a keyword, and a grammar
   * has no node type for a keyword any more than it has one for a manifest's `exports`
   * field. Measured over the corpus: **1,226 `allOf` `$ref`s** against 88 `anyOf` and
   * 89 `oneOf`, which is the shape the reading predicts — composition is the common
   * case and alternatives are rare.
   */
  private extractSchemaComposition(ctx: JsonContext): void {
    for (const ref of ctx.referenceSymbols) {
      const fullPath = ref.metadata?.fullPath as string | undefined
      if (!fullPath) continue
      // `…$ref` whose ENCLOSING object is the member of an `allOf` array.
      let parent = fullPath.slice(0, fullPath.lastIndexOf("."))
      // `allOf` is normally an ARRAY, and the path writes the index with BRACKETS
      // appended to the keyword — `…allOf[0].$ref` — not as a separate dot segment.
      // Two attempts missed this: the first matched only the object form and found 1
      // edge where the corpus has 1,226, and the second stripped a trailing `.0` and
      // still found 1. Both looked like working checks. The shape was read off a real
      // relationship's source rather than assumed, which is the only reason it was
      // caught before it was committed.
      const bracket = parent.lastIndexOf("[")
      if (bracket > 0 && parent.endsWith("]")) parent = parent.slice(0, bracket)
      if (!parent.endsWith(".allOf")) continue
      const refPath = ref.metadata?.refPath as string | undefined
      if (!refPath) continue
      // A `$ref` inside `allOf` may point INSIDE the document (`#/…`) or at a SIBLING
      // FILE (`dataTypeBase.json#` — a relative file ref with a fragment, which
      // isFileNamingRef already recognises and which `imports` already emits). The
      // file form is still composition: "inherits from the schema in that file".
      // Requiring `#/` silently dropped it, which is the same class of error as the
      // bracketed-index bug — a predicate written against the shape assumed rather
      // than the shape observed, quietly covering a subset and reporting success.
      const isLocal = refPath.startsWith("#/")
      const isSiblingFile = !isLocal && this.isFileNamingRef(refPath)
      if (!isLocal && !isSiblingFile) continue
      const target = isLocal ? this.referenceTarget(ctx, refPath) : refPath
      ctx.relationships.push({
        source: parent,
        target,
        type: ASTEngine.RelationshipType.Extends,
        confidence: 1,
        line_number: this.declLine(ref),
        metadata: {
          jsonSpecific: true,
          composition: "allOf",
          refForm: isLocal ? "intra_document" : "sibling_file",
          resolvedPath: isLocal,
          note: "allOf is a superset-of relationship; anyOf/oneOf are alternatives and emit only `references`",
          evidenceClass: "structural",
        },
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
        line_number: dependency.range?.startLine ?? 0,
        metadata: { relationshipType: "package_dependency", version: this.dependencyVersion(ctx, dependency) },
      })
    }
  }

  /**
   * An npm script that runs a SIBLING script, as `calls`.
   *
   * `calls` was ruled out for this lane twice, on a grammar inventory: the JSON
   * grammar has no node type for a function, so it has none for an invocation either.
   * That is the same unsound question that produced the wrong `imports`, `exports` and
   * `extends` rulings, and the corpus settles it. A `package.json` `scripts` object
   * declares its entries as ordinary keys, so both endpoints of the relation are
   * symbols IN THE SAME FILE, and a command string naming one of them is an
   * invocation of it:
   *
   *   "scripts": { "pretest": "npm run compile", "compile": "tsc -p ." }
   *
   * `pretest` calls `compile`, and both names resolve. This is not a name-match guess
   * across files — the callee must be a key of the SAME `scripts` object, which is the
   * only condition under which the edge can be checked at all.
   *
   * Three things are declined rather than left silent, each because emitting them would
   * be a fabricated edge:
   *
   *   - `npm run <name>` where `<name>` is NOT a key of this `scripts` object. The
   *     callee is then a binary, a workspace script in another package, or nothing;
   *     `package.json` does not say, so the edge would name a symbol that is not there.
   *     Measured separately by `validation/m14/fixtures/json/probes.ts` so the
   *     undercount is visible instead of assumed.
   *   - a script invoking ITSELF. npm rejects it, and a self-edge carries no order.
   *   - npm's IMPLICIT lifecycle hooks (`pre<script>` / `post<script>` around any
   *     script). npm runs them without the command naming them, which is real
   *     behaviour and is NOT an explicit invocation, so emitting it would attribute an
   *     edge to a name the file never wrote in that position.
   *
   * Confidence is 0.8, not 1, and the reason is carried in `reasonCode`: the two
   * endpoints are structural facts but the LINK is read out of a string value by a
   * known-CLI convention, which is exactly the class the honesty contract §4 requires
   * to be below the deterministic threshold and countable.
   */
  /**
   * A key declared twice in one object, as `overrides`.
   *
   * `overrides` was ruled out for this lane on a grammar inventory — the JSON grammar
   * has no node type for a redefinition — which is the unsound question this lane has
   * now had to retract three times (`imports`, `exports`, `extends`, and `calls` on the
   * same corpus evidence). The construct is measurable and it occurs: 21 NAMED
   * duplicate keys across 11 of 11,713 admitted files, e.g.
   * dart-sdk/pkg/front_end/test/language_versioning/data/
   * package_default_version_is_wrong_2/.dart_tool/package_config.json:8 declaring
   * `languageVersion` twice, and duckdb/data/json/11152.json.
   *
   * The edge shape is the BASH lane's, deliberately, because it is the only shape that
   * works when both declarations share one name: source is the OWNER symbol, target is
   * the repeated key, and `overridesLine` carries the PRIOR declaration's line so the
   * replacement is readable without re-deriving it. Both endpoints resolve — `contains`
   * already emits a row for each declaration, so the pair exists independently.
   *
   * Three things are declined, each because the edge would assert something the file
   * does not say:
   *
   *   - The same key in two DIFFERENT objects of one file. A key is unique only within
   *     its object, so this is not a redefinition, and it is the corpus's dominant shape
   *     (120,174 occurrences across 7,679 files against 21 real duplicates). Emitting
   *     it would have been ~5,700 false positives.
   *   - An EMPTY key. 10 occurrences across 5 files, every one a document the grammar
   *     already recovered with ERROR nodes; an empty key is not a named member.
   *   - Any attempt to name the two declarations apart. They share a name AND a
   *     qualified path, so distinguishing them would mean minting a symbol the document
   *     does not declare. The line metadata carries the distinction instead.
   *
   * Confidence is 1: two `pair` nodes with one key inside one `object` is a fact about
   * the parse tree, read at the same place the symbol is created.
   */
  private extractDuplicateKeyOverrides(ctx: JsonContext): void {
    for (const c of ctx.overrideCandidates) {
      ctx.relationships.push({
        source: c.ownerName,
        target: c.key,
        type: ASTEngine.RelationshipType.Overrides,
        confidence: 1,
        line_number: c.line,
        metadata: {
          jsonSpecific: true,
          redefinition: true,
          overridesLine: c.overridesLine,
          evidenceClass: "structural",
        },
      })
    }
  }

  private extractNpmScriptCalls(ctx: JsonContext): void {
    if (!this.fileEndsWith(ctx.filePath, "package.json")) return
    const document = ctx.rootNode
    if (document.type !== "document") return
    const rootObject = document.namedChildren?.find((c: any) => c.type === "object")
    if (!rootObject) return
    const scriptsObject = this.topLevelObjectValue(rootObject, "scripts")
    if (!scriptsObject) return

    const declared = new Map<string, Node>()
    for (let i = 0; i < scriptsObject.namedChildCount; i++) {
      const pair = scriptsObject.namedChild(i)
      if (pair?.type !== "pair") continue
      const key = this.keyText(pair)
      if (key) declared.set(key, pair)
    }
    if (declared.size === 0) return

    for (const [name, pair] of declared) {
      const value = pair.childForFieldName("value")
      if (value?.type !== "string") continue
      for (const callee of this.npmRunTargets(this.stripQuotes(value.text))) {
        if (callee === name) continue
        if (!declared.has(callee)) continue
        ctx.relationships.push({
          source: name,
          target: callee,
          type: ASTEngine.RelationshipType.Calls,
          confidence: 0.8,
          line_number: pair.startPosition.row + 1,
          metadata: {
            jsonSpecific: true,
            callForm: "npm_run_sibling_script",
            evidenceClass: "usage_contextual",
            reasonCode: "npm_run_sibling_script",
          },
        })
      }
    }
  }

  /**
   * The script names a command string invokes through a package runner.
   *
   * Tokenised with a character scan and no regex, because the lane's contract is zero
   * regex literals in this file (`script/m12/json-contract-probe.ts` enforces it) and
   * because a runner name is only meaningful as a whole token: `npm` inside `npx` or
   * a path like `./scripts/npm` is not a runner. A QUOTED target is declined, because
   * the quoting means the shell rewrote the argument and the file no longer states
   * the name plainly.
   */
  private npmRunTargets(command: string): string[] {
    const RUNNERS = ["npm", "pnpm", "yarn", "bun"]
    const VERBS = ["run", "run-script", "run-s"]
    const SEPARATORS = [" ", "\t", "\n", "\r", ";", "&", "|", "(", ")", "<", ">"]
    const tokens: { text: string; quoted: boolean }[] = []
    let current = ""
    let quoted = false
    let inQuotes = false
    for (const ch of command) {
      if (ch === '"') {
        inQuotes = !inQuotes
        quoted = true
        continue
      }
      if (!inQuotes && SEPARATORS.includes(ch)) {
        if (current.length > 0) tokens.push({ text: current, quoted })
        current = ""
        quoted = false
        continue
      }
      current += ch
    }
    if (current.length > 0) tokens.push({ text: current, quoted })

    const out: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      if (!RUNNERS.includes(tokens[i].text)) continue
      const verb = tokens[i + 1]
      if (!verb || verb.quoted || !VERBS.includes(verb.text)) continue
      const target = tokens[i + 2]
      if (!target || target.quoted) continue
      out.push(target.text)
      i += 2
    }
    return out
  }

  /** The object value of a named top-level key, or undefined. */
  private topLevelObjectValue(rootObject: any, name: string): any {
    for (let i = 0; i < rootObject.namedChildCount; i++) {
      const pair = rootObject.namedChild(i)
      if (pair?.type !== "pair") continue
      if (this.keyText(pair) !== name) continue
      const value = pair.childForFieldName("value")
      if (value?.type === "object") return value
    }
    return undefined
  }

  private dependencyVersion(ctx: JsonContext, dependency: ASTEngine.UniversalSymbol): string {
    const fullPath = String(dependency.metadata?.fullPath || "")
    const parts = fullPath.split(".")
    const parent = parts.slice(0, -1).join(".")
    const version = ctx.symbolMap.get(`${parent}.${dependency.name}`)
    return version?.returnType || "unknown"
  }

  /**
   * Does this `$ref` value name ANOTHER FILE rather than something inside this one?
   *
   * Three shapes, and they are genuinely different things: a local pointer (`#/a/b`)
   * names a location in THIS document; a URL names a vocabulary (a JSON-Schema draft
   * identifier); a relative path with a document extension names a FILE, and that is a
   * dependency. Decided structurally — an extension and a path separator or a leading
   * `./` — with no regex, so the lane's zero-regex contract holds.
   */
  private isFileNamingRef(refPath: string): boolean {
    if (refPath.length === 0) return false
    if (refPath.startsWith("#/")) return false
    if (refPath.startsWith("http://") || refPath.startsWith("https://")) return false
    const DOCUMENT_EXTENSIONS = ["json", "jsonc", "json5", "yaml", "yml", "avsc", "avdl", "proto"]
    const withoutFragment = refPath.split("#")[0]
    const dot = withoutFragment.lastIndexOf(".")
    if (dot < 0) return false
    const ext = withoutFragment.slice(dot + 1)
    if (!DOCUMENT_EXTENSIONS.includes(ext)) return false
    // No further shape test. An earlier version also demanded a `/` or a leading `.`,
    // on the theory that a bare word ending in `.json` might not be a path — and that
    // rejected `other.schema.json`, which plainly is one. The extension IS the test:
    // a `$ref` whose value is a document name is naming a document. The cost of the
    // over-strict version was an UNDERCOUNT, and it was invisible until a fixture
    // asked for the shape the corpus happened not to contain.
    return true
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

  /**
   * An array item's SYMBOL name and the SYMBOL name of the array that holds it.
   *
   * Derived from the array's own NAME plus the index, never from the item's path.
   * The previous version took the last dot-segment of the path, which is correct
   * only while the module name has no dot in it — and a JSON file whose name does
   * contain one is entirely ordinary: `index.svelte.warnings.json` gave the module
   * `index.svelte.warnings` and the item owner came out as `warnings`, so every
   * `contains` edge from it named no symbol at all. The same file is a snapshot
   * fixture, and 14 such edges were the largest genuinely-unresolvable class in the
   * corpus. `tsconfig.build.json` and every `*.svelte.*.json` have the same shape.
   *
   * The array's own name is already on the frame: `parentName` when an array frame
   * is popped IS the name of the array, because the frame is pushed with the key it
   * was written under, and a document's top-level array arrives with the module name.
   */
  private arrayItemName(arrayName: string, index: number): { item: string; holder: string } {
    return { item: `${arrayName}[${index}]`, holder: arrayName }
  }

  private addArrayObjectSymbol(ctx: JsonContext, node: Node, path: string, itemName: string): void {
    // The item's name is on the frame; the holder is that name up to its bracket, so
    // a dotted module name survives intact.
    const bracket = itemName.lastIndexOf("[")
    const name = itemName
    const ownerName = bracket > 0 ? itemName.slice(0, bracket) : ctx.rootName
    this.addSymbol(ctx, {
      name,
      kind: ASTEngine.SymbolKind.Class,
      qualifiedName: path,
      range: this.nodeToRange(node),
      ownerName,
      ownerKind: ASTEngine.SymbolKind.Class,
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

  private pushArrayChildren(stack: PathFrame[], node: Node, parentPath: string, parentName: string): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (!child) continue
      const itemPath = `${parentPath}[${i}]`
      // The frame's parentName is the ITEM's symbol name, so the keys inside an
      // array element are owned by that element. Passing the array's name here is
      // what made `a` a child of `objs` instead of `objs[0]`.
      // `parentName` here is the ARRAY's own name, so the item is named from it
      // rather than from a path segment.
      const { item } = this.arrayItemName(parentName, i)
      stack.push({
        node: child,
        parentPath: itemPath,
        parentName: child.type === "object" ? item : parentName,
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

  private pushNamedChildren(stack: PathFrame[], node: Node, parentPath: string, parentName: string = parentPath, duplicateKeys?: Map<string, number>): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push({ node: child, parentPath, parentName, duplicateKeys })
    }
  }

  private documentName(filePath: string): string {
    const slash = filePath.lastIndexOf("/")
    const base = slash >= 0 ? filePath.slice(slash + 1) : filePath
    const lower = base.toLowerCase()
    // All THREE spellings this lane is routed, not just `.json`. The contract is
    // "the basename WITHOUT its extension" and `detectLanguageFromPath` sends
    // `.jsonc` and `.json5` here too, so stripping only `.json` left those module
    // symbols carrying their extension while `.json` ones did not. The lane-owned
    // oracle strips any extension, and the disagreement showed up in the differential
    // as 24 MISSING and 207 UNEXPLAINED `contains` edges — every sampled example a
    // DOT-PREFIXED name like `.markdownlint-cli2.jsonc`, where the leading dot makes
    // the basename and the stem look like different strings. Small (4 `.jsonc` and 6
    // `.json5` files are tracked corpus-wide) and wrong in the direction that makes
    // the module symbol disagree with the documented identity.
    for (const suffix of [".json", ".jsonc", ".json5"]) {
      if (lower.endsWith(suffix)) return base.slice(0, base.length - suffix.length) || "document"
    }
    return base || "document"
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

  /**
   * The 1-based line a symbol was DECLARED on, for the `line_number` every
   * relationship must carry. M60 requires a site line on every edge, and this
   * analyzer emitted NONE: the string `line_number` did not occur in the file, so
   * every JSON edge in the index was stored with a NULL line and no consumer —
   * the graph panel included — could point at where an edge came from. Symbols
   * carried `range` all along, so the position was known and simply not published.
   */
  private declLine(symbol: ASTEngine.UniversalSymbol | undefined): number {
    return symbol?.range?.startLine ?? 0
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
