// @ts-nocheck — ported; verified by tests. Restored incrementally in Phase 3.
import type { Language, Parser, Node } from "web-tree-sitter"
import * as Log from "../tool/brain-log"
import { lazy } from "../util/lazy"
import { fileURLToPath } from "url"
import { createRequire } from "node:module"
import { resolveWasmAsset, loadWebTreeSitter, hasWasmInRegistry, ensureWasmRegistry, isWasmRegistryLoaded } from "../util/wasm"
import { detectLanguageFromPath } from "./language-detection"

const require = createRequire(import.meta.url)


// Import all comprehensive language analyzers (temporarily disabled for integration)

// 🔧 @backbencher: Removed circular imports. All *Analyzer/Intelligence modules are lazily loaded.
// This prevents a deadlock cycle: engine → 38 analyzers → engine (each analyzer imports ASTEngine)
// TypeInference and FrameworkIntelligence are lazily loaded at the call site

const log = Log.create({ service: "ast-engine" })

// Universal AST Engine - Core intelligence for ANY programming language
// Based on ProxiCall Brain architecture but designed for universal code understanding

export namespace ASTEngine {
  // Language registry for multi-language support with limits
  const languages = new Map<string, Language>()
  const parsers = new Map<string, Parser>()

  // Memory and performance limits
  // FIX: Reduced from 5/10 to 2/3 to force frequent WASM cleanup and prevent memory accumulation
  // Each parser holds ~10-50MB WASM memory - too many cached parsers causes performance degradation
  const MAX_CONCURRENT_PARSERS = 20
  const MAX_PARSER_CACHE_SIZE = 30
  const PARSER_TIMEOUT_MS = 10000 // 10 second timeout for parser operations

  // Track total parsed files for memory monitoring
  let totalFilesParsed = 0
  let lastMemoryReport = 0

  // Track parser usage for LRU eviction
  const parserUsage = new Map<string, number>()
  
  // Track parse operations per language to recreate parsers and prevent WASM memory leaks
  const parseCount = new Map<string, number>()

  // Initialize Tree-sitter core (shared across all languages)
  const treeSitterCore = lazy(async () => {
    const WebTreeSitter: any = await loadWebTreeSitter()

    // web-tree-sitter 0.25.x: named exports { Parser, Language }
    // web-tree-sitter 0.24.x: default export { default: ParserClass, init: fn }
    const Parser = WebTreeSitter.Parser ?? WebTreeSitter.default ?? WebTreeSitter
    const Language = WebTreeSitter.Language ?? WebTreeSitter.default?.Language

    const treePath = resolveWasmCore("tree-sitter.wasm")
    const coreWasm = hasWasmInRegistry("tree-sitter.wasm")

    // Write registry WASM to temp file if available (compiled binary)
    let wasmFile = treePath
    if (coreWasm) {
      const os = require("os")
      const p = require("path")
      const fsModule = require("fs")
      for (const tmpDir of [os.tmpdir(), "/tmp", process.cwd()]) {
        try {
          const tmp = p.join(tmpDir, "bb-ts-core.wasm")
          fsModule.writeFileSync(tmp, coreWasm)
          wasmFile = tmp
          break
            } catch (e) {
      log.debug("resolveWasm: temp file fallback failed", { error: (e as Error)?.message })
    }
      }
    }

    const initFn = WebTreeSitter.init ?? Parser.init ?? (Parser as any).init
    if (initFn) {
      try {
        await initFn({ locateFile() { return wasmFile } })
        log.info("tree-sitter core initialized", { wasmFile })
      } catch (e1) {
        log.warn("core init via locateFile failed, trying default", { wasmFile, error: e1 })
        try {
          if (wasmFile !== treePath) await initFn({ locateFile() { return treePath } })
          else await initFn()
          log.info("tree-sitter core initialized via fallback")
        } catch (e2) {
          log.error("tree-sitter core init failed", { error: e2 })
        }
      }
    }

    // Language is always available after init() on both 0.24.x and 0.25.x
    const lang = Language ?? WebTreeSitter.default?.Language ?? Parser.Language

    return { Parser, Language: lang }
  })

  /**
   * Cleanup least recently used parsers if cache is full
   */
  function cleanupParsers(): void {
    // Evict the least recently used parser(s) until we are strictly under the cache limit.
    // This avoids O(N log N) sorting and array allocations in the hot path.
    while (parsers.size >= MAX_PARSER_CACHE_SIZE) {
      let oldestLang: string | null = null
      let oldestTime = Infinity

      // O(N) linear scan without allocating any garbage
      parserUsage.forEach((time, language) => {
        if (time < oldestTime) {
          oldestTime = time
          oldestLang = language
        }
      })

      if (!oldestLang) break // Should not occur unless cache is corrupted

      const parser = parsers.get(oldestLang)
      if (parser && typeof parser.delete === "function") {
        parser.delete()
      }

      parsers.delete(oldestLang)
      languages.delete(oldestLang)
      parserUsage.delete(oldestLang)

      // FIX: Log parser eviction for memory debugging
      log.debug("evicted parser from cache, freed WASM memory", {
        language: oldestLang,
        remainingParsers: parsers.size,
        totalFilesParsed,
      })
    }
  }

  // Resolve WASM file paths for core tree-sitter WASM - delegates to shared utility
  function resolveWasmCore(asset: string): string {
    return resolveWasmAsset(asset)
  }

  // Language definitions with Tree-sitter grammar paths. Generic entries are
  // explicit fallback classifications and must not be treated as dedicated
  // Tree-sitter parser support.
  const SUPPORTED_LANGUAGES = {
    // === CORE WEB TECHNOLOGIES ===
    typescript: "tree-sitter-typescript/typescript",
    tsx: "tree-sitter-typescript/tsx",
    javascript: "tree-sitter-javascript",
    html: "tree-sitter-html",
    css: "tree-sitter-css",
    scss: "tree-sitter-css",
    sass: "tree-sitter-css",
    svelte: "tree-sitter-svelte",
    json: "tree-sitter-json",
    perl: "tree-sitter-perl",
    yaml: "tree-sitter-yaml",

    // === SYSTEMS PROGRAMMING ===
    c: "tree-sitter-c",
    cpp: "tree-sitter-cpp",
    rust: "tree-sitter-rust",
    go: "tree-sitter-go",

    // === ENTERPRISE & JVM ===
    java: "tree-sitter-java",
    kotlin: "tree-sitter-kotlin",
    scala: "tree-sitter-scala",

    // === SCRIPTING & DYNAMIC ===
    python: "tree-sitter-python",
    ruby: "tree-sitter-ruby",
    php: "tree-sitter-php",
    lua: "tree-sitter-lua",
    elixir: "tree-sitter-elixir",

    // === FUNCTIONAL PROGRAMMING ===
    erlang: "tree-sitter-erlang",
    haskell: "tree-sitter-haskell",
    clean: "tree-sitter-clean",
    clojure: "tree-sitter-clojure",

    // === MOBILE & MODERN ===
    swift: "tree-sitter-swift",
    dart: "tree-sitter-dart",

    // === MICROSOFT ECOSYSTEM ===
    csharp: "tree-sitter-c-sharp",

    // === DATA SCIENCE & STATS ===
    r: "tree-sitter-r",
    sql: "tree-sitter-sql",

    // === SHELL & SYSTEM ===
    bash: "tree-sitter-bash",
    powershell: "tree-sitter-powershell",
    "objective-c": "tree-sitter-objc",
    groovy: "tree-sitter-groovy",
    vue: "tree-sitter-vue",
    hcl: "tree-sitter-hcl",
    terraform: "tree-sitter-hcl",
    graphql: "tree-sitter-graphql",
    zig: "tree-sitter-zig",
    fsharp: "tree-sitter-fsharp",
    markdown: "tree-sitter-markdown",
    toml: "tree-sitter-toml",
    xml: "tree-sitter-xml",
    make: "tree-sitter-make",
    // === SYSTEMS & COMPILING LANGUAGES (a real parser each) ===
    nim: "tree-sitter-nim",

    // M60 VB wave. `vb` was `__generic__` until 2026-09-27: `.vb` was a routed
    // extension and `vb` a declared DetectedLanguage, but there was no VB.NET
    // grammar on npm at all (`tree-sitter-vb` and `tree-sitter-visual-basic` are
    // both 404, and the `tree-sitter-wasms` bundle that supplies 39 of this
    // repo's grammars ships no VB), so the file was "analysed" by a regex generic
    // pass that cannot see a Class, a Function, an Implements clause or a call
    // site -- and reported as covered rather than refused.
    //
    // The grammar is a vendored and repaired tree-sitter-vbnet; its pin, its 18
    // patches, its source<->wasm proof and its measured parse success are in
    // grammars/tree-sitter-vbnet/PIN.md and validation/m14/grammar-pins.json.
    // Measured: 90.89 % clean over 1185 files on four independent corpora with
    // 0 crash files, up from 38.67 % on Microsoft's own VisualBasic.Core when
    // the upstream grammar was first wired.
    vb: "tree-sitter-vbnet",

    // === LANGUAGES WITHOUT DEDICATED PARSER (fallback to GenericAnalyzer) ===
    nim: "__generic__",
    // Protobuf: the vendored, patched tree-sitter-proto. See
    // grammars/tree-sitter-proto/README.md — the node surface is snake_case and
    // is a contract, and this is the ONE routed language whose grammar had to
    // be cloned and patched because no protobuf grammar is published on npm.
    protobuf: "tree-sitter-protobuf",
  } as const

  type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES

  // Universal symbol types for ANY programming language
  export interface UniversalSymbol {
    name: string
    kind: SymbolKind
    range: {
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      /**
       * Start of the range as reported by the parser. For web-tree-sitter this is a UTF-16
       * CODE-UNIT offset, NOT a byte offset -- the two coincide for ASCII and diverge by
       * the surplus UTF-8 bytes before the position otherwise, and upstream tree-sitter
       * reports bytes. Passed through unchanged so existing consumers do not move; use
       * `byteStart` when a byte offset is what is needed.
       *
       * NOTE: a second, near-identical `UniversalSymbol` exists in src/ast/types.ts and is
       * imported by nothing. This declaration is the live one.
       */
      startIndex?: number
      /** End of the range, in the same unit as `startIndex`. */
      endIndex?: number
      /** Start of the range in BYTES. Optional: populated per analyzer. */
      byteStart?: number
      /** End of the range in BYTES. Optional: populated per analyzer. */
      byteEnd?: number
    }
    scope?: string // Class/namespace/module scope
    visibility?: "public" | "private" | "protected" | "internal" | "global" | "local" | string
    isStatic?: boolean
    gravityScore?: number
    layer?: string
    isAsync?: boolean
    isAbstract?: boolean
    parameters?: Parameter[]
    returnType?: string
    decorators?: string[]
    genericParameters?: string[]
    comments?: string[]
    /**
     * M60 (powershell, 2026-09-26): the declaration's own documentation, as one
     * string. The field is emitted by java, python, ruby and now powershell, and
     * `brain_symbol.docstring` has a column and a store binding
     * (parallel-indexer.ts, the M35 pre-work) — but it was NOT declared here, so
     * every consumer typing against `UniversalSymbol` saw it only through the
     * index signature. That is how a field four producers write and the store
     * reads can stay invisible to the type system: nothing errors, and nothing
     * checks. Declared now; the index signature still carries the rest.
     */
    docstring?: string
    qualified_calls?: string[] // ProxiCall-style: raw calls extracted as-is ["service.createUser", "_auth.validate"]
    apiContractPath?: string // Deterministic mapping: Exact Route URL or Fetch URL for 100% accurate cross-language links
    ownerName?: string // Parent class/namespace name for nested symbols
    ownerKind?: SymbolKind // Parent symbol kind
    taintSources?: { type: string; snippet: string }[] // Taint analysis sources (e.g. user_input)
    taintSinks?: { type: string; snippet: string; vulnerability_type: string }[] // Taint analysis sinks (e.g. sql_injection)
    metadata: Record<string, any>
    [key: string]: any
  }

  export enum SymbolKind {
    Function = "function",
    Class = "class",
    Variable = "variable",
    Constant = "constant",
    Interface = "interface",
    Enum = "enum",
    EnumMember = "enum_member",
    Type = "type",
    Import = "import",
    Export = "export",
    Method = "method",
    Property = "property",
    Constructor = "constructor",
    Namespace = "namespace",
    Module = "module",
    Table = "class", // Legacy alias
    Service = "class", // Legacy alias
    Resource = "class", // Legacy alias
    TypeAlias = "type", // Legacy alias
    Event = "event",
    Delegate = "delegate",
    Object = "class", // Legacy alias
    Record = "type", // Legacy alias
    Macro = "macro", // Rust macro_rules!
    Trait = "trait", // Rust trait
    Struct = "struct", // Rust struct
    Impl = "impl", // Rust impl block
    Actor = "actor", // Swift actor
    Union = "union", // Zig/C union types
    Mixin = "mixin", // Dart mixin declaration
    Extension = "extension", // Dart extension declaration
  }

  export interface Parameter {
    name: string
    type?: string
    defaultValue?: string
    isOptional?: boolean
    [key: string]: any
  }

  // Universal relationship types for cross-language analysis
  export interface UniversalRelationship {
    source?: string // Symbol ID
    target?: string // Symbol ID
    from?: string // Legacy alias
    to?: string // Legacy alias
    fromSymbol?: string // Legacy alias
    toSymbol?: string // Legacy alias
    type?: RelationshipType
    relationshipType?: RelationshipType // Legacy alias
    confidence?: number // 0.0 to 1.0
    metadata: Record<string, any>
    [key: string]: any
  }

  export enum RelationshipType {
    Calls = "calls",
    Call = "calls", // Legacy alias
    Extends = "extends",
    Inheritance = "extends", // Legacy alias
    Implements = "implements",
    Implementation = "implements", // Legacy alias
    Uses = "uses",
    Dependency = "uses", // Legacy alias
    Imports = "imports",
    Exports = "exports",
    Contains = "contains",
    DependsOn = "references", // Legacy alias
    Override = "overrides", // Legacy alias
    Composition = "contains", // Legacy alias
    Provides = "exports", // Legacy alias
    Related = "references", // Legacy alias
    PartOf = "contains", // Legacy alias
    References = "references",
    Overrides = "overrides",
    Instantiates = "instantiates",
  }

  // Parse result with extracted intelligence
  export interface ParseResult {
    language?: string
    symbols: UniversalSymbol[]
    relationships: UniversalRelationship[]
    imports: ImportInfo[]
    exports?: ExportInfo[]
    errors?: ParseError[]
    rawContent?: string
    metadata: FileMetadata
    [key: string]: any
  }

  export interface ImportInfo {
    module?: string
    items?: string[]
    isDefault?: boolean
    isDefaultImport?: boolean // Legacy analyzer field
    isNamespaceImport?: boolean // Legacy analyzer field
    alias?: string
    range?: UniversalSymbol["range"]
    localName?: string // Legacy analyzer field
    importType?: string // Legacy analyzer field
    path?: string // Legacy analyzer field
    isNamespace?: boolean // Legacy analyzer field
    importedNames?: string[] // Legacy analyzer field
    metadata?: Record<string, any> // Legacy analyzer field
    [key: string]: any
  }

  export interface ExportInfo {
    name: string
    isDefault?: boolean
    type?: string
    range?: UniversalSymbol["range"]
    kind?: SymbolKind
    metadata?: Record<string, any>
    [key: string]: any
  }

  export interface ParseError {
    message: string
    range: UniversalSymbol["range"]
    severity: "error" | "warning" | "info"
  }

  export interface FileMetadata {
    complexity: number
    linesOfCode: number
    cyclomaticComplexity?: number
    statisticalComplexity?: number
    framework?: string // react, vue, flutter, express, etc.
    architecture?: string // mvc, mvvm, clean, etc.
    patterns?: string[] // singleton, factory, observer, etc.

    // Intelligence enhancement properties
    detectedFrameworks?: string[]
    frameworkPatterns?: any[]
    architecturalInsights?: any[]
    architecturalScore?: number
    codeQuality?: string
    crossFileRelationshipCount?: number
    hasOrphanedSymbols?: boolean
    hasTypeInference?: boolean
    hasFrameworkIntelligence?: boolean
    analysisVersion?: string
    [key: string]: any
  }

  // Resolve WASM file paths (enhanced version)
  function resolveWasm(relativePath: string): string {
    const fs = require("fs")
    const path = require("path")

    // @backbencher: in compiled binary, always prefer embedded WASM from registry.
    // Return the original registry key — the loading code at call site looks up
    // hasWasmInRegistry() with the returned path, so it must match registry keys.
    const isCompiled = typeof (BB_POOL_WORKER_PATH as any) !== "undefined"
    if (isCompiled) {
      const data = hasWasmInRegistry(relativePath)
      if (data) {
        return relativePath
      }
      // No WASM in registry → don't search filesystem in compiled mode.
      // The virtual filesystem has no node_modules. Throw immediately so
      // pool-worker falls back to regex parsing (fast) instead of grinding
      // through 15K+ fs.existsSync calls for Kotlin/Swift/Lua etc.
      throw new Error(`WASM not in compiled registry: ${relativePath}`)
    }

    // === COMPILED BINARY FALLBACK ===
    // Use process.argv[0] first (actual binary path), fallback to execPath
    // On Windows/Bun, process.execPath returns Bun's runtime path (B:\~BUN\root\...)
    const argv0 = process.argv?.[0]
    let execDir = argv0 && fs.existsSync(argv0) ? path.dirname(argv0) : path.dirname(process.execPath)

    // Also check import.meta.dir for ES module contexts
    try {
      const metaDir = path.dirname(require("url").fileURLToPath(import.meta.url))
      const metaCheck = path.join(metaDir, "tree-sitter.wasm")
      if (fs.existsSync(metaCheck)) {
        execDir = metaDir
      }
        } catch (e) {
      log.debug("resolveWasm: temp file fallback failed", { error: (e as Error)?.message })
    }

    const flatWasmName = relativePath.split("/").pop() || ""
    const siblingPath = `${execDir}/${flatWasmName}`
    if (fs.existsSync(siblingPath)) {
      return siblingPath
    }

    // For node_modules packages, resolve relative to this package
    try {
      const resolved = require.resolve(relativePath)
      return resolved
    } catch {
      // Fallback to manual path construction
      const packageName = relativePath.split("/")[0]
      const wasmFile = relativePath.split("/")[1] || relativePath.split("/").pop()!

      // Try different node_modules locations
      const _dirname = typeof __dirname !== 'undefined' ? __dirname : (fileURLToPath(import.meta.url) ? require('path').dirname(fileURLToPath(import.meta.url)) : process.cwd())
      const possiblePaths = [
        `${process.cwd()}/node_modules/${packageName}/${wasmFile}`,
        `${process.cwd()}/node_modules/.bun/${packageName}@*/node_modules/${packageName}/${wasmFile}`,
        `${_dirname}/../../../../node_modules/${packageName}/${wasmFile}`,
      ]

      for (const path of possiblePaths) {
        try {
          // For glob patterns, find the first match
          if (path.includes("*")) {
            const globPart = path.substring(0, path.indexOf("*"))
            const afterGlob = path.substring(path.indexOf("*") + 1)

            try {
              const dirs = fs.readdirSync(globPart.substring(0, globPart.lastIndexOf("/")))
              for (const dir of dirs) {
                const fullPath = `${globPart}${dir}${afterGlob}`
                if (fs.existsSync(fullPath)) {
                  return fullPath
                }
              }
            } catch (e) {
              continue
            }
          } else {
            if (fs.existsSync(path)) {
              return path
            }
          }
        } catch (e) {
          continue
        }
      }

      const fallback = {
        "tree-sitter-clean/tree-sitter-clean.wasm": [
          "tree-sitter-clean/tree-sitter-clean.wasm",
        ],
        "tree-sitter-kotlin/tree-sitter-kotlin.wasm": ["tree-sitter-wasms/out/tree-sitter-kotlin.wasm"],
        "tree-sitter-swift/tree-sitter-swift.wasm": ["tree-sitter-wasms/out/tree-sitter-swift.wasm"],
        "tree-sitter-r/tree-sitter-r.wasm": ["@eagleoutice/tree-sitter-r/tree-sitter-r.wasm"],
        "tree-sitter-dart/tree-sitter-dart.wasm": [
          "tree-sitter-dart/tree-sitter-dart.wasm",
        ],
        "tree-sitter-yaml/tree-sitter-yaml.wasm": [
          "@tree-sitter-grammars/tree-sitter-yaml/tree-sitter-yaml.wasm",
          "tree-sitter-wasms/out/tree-sitter-yaml.wasm",
          "tree-sitter-wasm-prebuilt/lib/tree-sitter-yaml.wasm",
        ],
        "tree-sitter-sql/tree-sitter-sql.wasm": ["@derekstride/tree-sitter-sql/src/parser"],
        "tree-sitter-zig/tree-sitter-zig.wasm": [
          "tree-sitter-wasms/out/tree-sitter-zig.wasm",
          "@opentui/core/assets/zig/tree-sitter-zig.wasm",
        ],
        "tree-sitter-hcl/tree-sitter-hcl.wasm": [
          "@tree-sitter-grammars/tree-sitter-hcl/tree-sitter-hcl.wasm",
          "tree-sitter-hcl/tree-sitter-hcl.wasm",
        ],
        "tree-sitter-lua/tree-sitter-lua.wasm": ["tree-sitter-lua/tree-sitter-lua.wasm", "tree-sitter-wasms/out/tree-sitter-lua.wasm"],
        // The nim grammar has no published npm tarball wasm (see
        // grammars/tree-sitter-nim/PIN.md), so the only alternative that can
        // resolve is a sibling checkout of the vendored source.
        "tree-sitter-nim/tree-sitter-nim.wasm": ["tree-sitter-nim/tree-sitter-nim.wasm"],
        "tree-sitter-erlang/tree-sitter-erlang.wasm": ["tree-sitter-erlang/tree-sitter-erlang.wasm"],
        "tree-sitter-clojure/tree-sitter-clojure.wasm": ["tree-sitter-clojure/tree-sitter-clojure.wasm"],
        "tree-sitter-groovy/tree-sitter-groovy.wasm": ["tree-sitter-groovy/tree-sitter-groovy.wasm"],
        "tree-sitter-perl/tree-sitter-perl.wasm": ["tree-sitter-perl/tree-sitter-perl.wasm"],
        "tree-sitter-scala/tree-sitter-scala.wasm": ["tree-sitter-scala/tree-sitter-scala.wasm"],
        "tree-sitter-elixir/tree-sitter-elixir.wasm": ["tree-sitter-elixir/tree-sitter-elixir.wasm"],
        "tree-sitter-haskell/tree-sitter-haskell.wasm": ["tree-sitter-haskell/tree-sitter-haskell.wasm"],
        "tree-sitter-fsharp/tree-sitter-fsharp.wasm": ["tree-sitter-fsharp/tree-sitter-fsharp.wasm"],
      } as Record<string, string[]>

      const extra = fallback[relativePath] ?? []
      for (const item of extra) {
        try {
          const resolved = require.resolve(item)
          if (fs.existsSync(resolved)) return resolved
        } catch (e) {
          continue
        }
      }

      // Compiled binary fallback: write WASM from registry to a temp file so fs.readFileSync works
      const data = hasWasmInRegistry(relativePath)
      if (data) {
        try {
          const os = require("os")
          const tmp = path.join(os.tmpdir(), "bb-wasm_" + relativePath.replace(/\//g, "_").replace(/\\/g, "_"))
          fs.writeFileSync(tmp, data)
          return tmp
            } catch (e) {
      log.debug("resolveWasm: temp file fallback failed", { error: (e as Error)?.message })
    }
      }

      return relativePath
    }
  }

  // Get parser for a specific language
  export async function getParser(language: SupportedLanguage): Promise<Parser> {
    await ensureWasmRegistry()
    // FIX: Track parsed files for memory monitoring
    totalFilesParsed++
    const MEMORY_REPORT_INTERVAL = 100
    if (totalFilesParsed - lastMemoryReport >= MEMORY_REPORT_INTERVAL) {
      log.debug("parser memory report", {
        totalFilesParsed,
        cachedParsers: parsers.size,
        maxParsers: MAX_PARSER_CACHE_SIZE,
      })
      lastMemoryReport = totalFilesParsed
    }

    // Check if we have too many concurrent operations
    if (parsers.size >= MAX_CONCURRENT_PARSERS) {
      cleanupParsers()
    }

    const currentCount = parseCount.get(language) || 0
    // Recreate parser every 500 files — prevents WASM memory accumulation
    // that causes hangs after ~9,000 parses on large projects (e.g. IntelliJ).
    // Deleting and reloading forces Bun's WASM runtime to GC the old module.
    if (currentCount >= 500 && parsers.has(language)) {
      const p = parsers.get(language)!
      try { if (typeof p.delete === "function") p.delete() } catch {}
      parsers.delete(language)
      languages.delete(language)
      parserUsage.delete(language)
      parseCount.set(language, 0)
    }

    if (parsers.has(language)) {
      // Update usage timestamp
      parserUsage.set(language, Date.now())
      parseCount.set(language, currentCount + 1)
      return parsers.get(language)!
    }

    // Initialize Tree-sitter core if not done
    const { Parser, Language } = await treeSitterCore()

    // Load language grammar WASM file dynamically based on language
    let languageWasmPath: string

    try {
      switch (language) {
        // === WEB TECHNOLOGIES ===
        case "typescript": {
          languageWasmPath = resolveWasm("tree-sitter-typescript/tree-sitter-typescript.wasm")
          break
        }
        case "tsx": {
          languageWasmPath = resolveWasm("tree-sitter-typescript/tree-sitter-tsx.wasm")
          break
        }
        case "javascript": {
          languageWasmPath = resolveWasm("tree-sitter-javascript/tree-sitter-javascript.wasm")
          break
        }
        case "html": {
          languageWasmPath = resolveWasm("tree-sitter-html/tree-sitter-html.wasm")
          break
        }
        case "css": {
          languageWasmPath = resolveWasm("tree-sitter-css/tree-sitter-css.wasm")
          break
        }
        // scss is its OWN grammar and its own lane, not a dialect flag on the CSS one.
        // The two were conflated until this change and the conflation was measurable:
        // 254 `.scss` files were routed to a grammar with no `$variables`, no
        // `@mixin`/`@include` and no interpolation, and 43 of the 244 non-empty ones
        // parsed clean. `.sass` (indented syntax, a genuinely different grammar) and
        // `.less` stay on the CSS wasm and stay DECLARED — measured 0 files of each in
        // 13 corpora, so neither is a claim this repo can support or refute.
        case "scss": {
          languageWasmPath = resolveWasm("tree-sitter-scss.wasm")
          break
        }
        case "sass": {
          languageWasmPath = resolveWasm("tree-sitter-css/tree-sitter-css.wasm")
          break
        }
        case "json": {
          languageWasmPath = resolveWasm("tree-sitter-json/tree-sitter-json.wasm")
          break
        }
        case "perl": {
          languageWasmPath = resolveWasm("tree-sitter-perl/tree-sitter-perl.wasm")
          break
        }
        case "yaml": {
          languageWasmPath = resolveWasm("tree-sitter-yaml/tree-sitter-yaml.wasm")
          break
        }

        // === SYSTEMS PROGRAMMING ===
        case "c": {
          languageWasmPath = resolveWasm("tree-sitter-c/tree-sitter-c.wasm")
          break
        }
        case "cpp": {
          languageWasmPath = resolveWasm("tree-sitter-cpp/tree-sitter-cpp.wasm")
          break
        }
        case "rust": {
          languageWasmPath = resolveWasm("tree-sitter-rust/tree-sitter-rust.wasm")
          break
        }
        case "go": {
          languageWasmPath = resolveWasm("tree-sitter-go/tree-sitter-go.wasm")
          break
        }

        // === ENTERPRISE & JVM ===
        case "java": {
          languageWasmPath = resolveWasm("tree-sitter-java/tree-sitter-java.wasm")
          break
        }
        case "kotlin": {
          languageWasmPath = resolveWasm("tree-sitter-kotlin/tree-sitter-kotlin.wasm")
          break
        }
        case "scala": {
          languageWasmPath = resolveWasm("tree-sitter-scala/tree-sitter-scala.wasm")
          break
        }

        // === SCRIPTING & DYNAMIC ===
        case "python": {
          languageWasmPath = resolveWasm("tree-sitter-python/tree-sitter-python.wasm")
          break
        }
        case "ruby": {
          languageWasmPath = resolveWasm("tree-sitter-ruby/tree-sitter-ruby.wasm")
          break
        }
        case "php": {
          languageWasmPath = resolveWasm("tree-sitter-php/tree-sitter-php.wasm")
          break
        }
        case "lua": {
          try {
            languageWasmPath = resolveWasm("tree-sitter-lua/tree-sitter-lua.wasm")
          } catch {
            languageWasmPath = resolveWasm("@tree-sitter-grammars/tree-sitter-lua/tree-sitter-lua.wasm")
          }
          break
        }
        case "elixir": {
          languageWasmPath = resolveWasm("tree-sitter-elixir/tree-sitter-elixir.wasm")
          break
        }
        case "erlang": {
          // Try primary path (tree-sitter-erlang npm), fall back to @lumis-sh/wasm-erlang.
          // Using try/catch because in compiled mode resolveWasm throws immediately
          // when WASM is not in registry — fs.existsSync never executes.
          try {
            languageWasmPath = resolveWasm("tree-sitter-erlang/tree-sitter-erlang.wasm")
          } catch {
            languageWasmPath = resolveWasm("@lumis-sh/wasm-erlang/tree-sitter-erlang.wasm")
          }
          break
        }

        // === FUNCTIONAL PROGRAMMING ===
        case "haskell": {
          // Try primary path, fall back to @tree-sitter-grammars community package.
          // Using try/catch — fs.existsSync doesn't work in compiled mode.
          try {
            languageWasmPath = resolveWasm("tree-sitter-haskell/tree-sitter-haskell.wasm")
          } catch {
            languageWasmPath = resolveWasm("@tree-sitter-grammars/tree-sitter-haskell/tree-sitter-haskell.wasm")
          }
          break
        }
        case "clean": {
          languageWasmPath = resolveWasm("tree-sitter-clean/tree-sitter-clean.wasm")
          break
        }
        case "clojure": {
          languageWasmPath = resolveWasm("tree-sitter-clojure/tree-sitter-clojure.wasm")
          break
        }

        // === MOBILE & MODERN ===
        case "swift": {
          languageWasmPath = resolveWasm("tree-sitter-swift/tree-sitter-swift.wasm")
          break
        }
        case "dart": {
          languageWasmPath = resolveWasm("tree-sitter-dart/tree-sitter-dart.wasm")
          break
        }

        // === MICROSOFT ECOSYSTEM ===
        case "csharp": {
          languageWasmPath = resolveWasm("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm")
          break
        }

        // === DATA SCIENCE & STATS ===
        case "r": {
          languageWasmPath = resolveWasm("tree-sitter-r/tree-sitter-r.wasm")
          break
        }
        case "sql": {
          languageWasmPath = resolveWasm("tree-sitter-sql/tree-sitter-sql.wasm")
          break
        }

        // === SHELL & SYSTEM ===
        case "bash": {
          languageWasmPath = resolveWasm("tree-sitter-bash/tree-sitter-bash.wasm")
          break
        }
        case "objective-c": {
          languageWasmPath = resolveWasm("tree-sitter-objc/tree-sitter-objc.wasm")
          break
        }
        case "groovy": {
          languageWasmPath = resolveWasm("tree-sitter-groovy/tree-sitter-groovy.wasm")
          break
        }
        case "vue": {
          languageWasmPath = resolveWasm("tree-sitter-vue/tree-sitter-vue.wasm")
          break
        }
        case "svelte": {
          languageWasmPath = resolveWasm("tree-sitter-svelte/tree-sitter-svelte.wasm")
          break
        }
        case "hcl":
        case "terraform": {
          languageWasmPath = resolveWasm("tree-sitter-hcl/tree-sitter-hcl.wasm")
          break
        }
        case "graphql": {
          languageWasmPath = resolveWasm("tree-sitter-graphql/tree-sitter-graphql.wasm")
          break
        }
        case "zig": {
          languageWasmPath = resolveWasm("tree-sitter-zig/tree-sitter-zig.wasm")
          break
        }
        case "nim": {
          languageWasmPath = resolveWasm("tree-sitter-nim/tree-sitter-nim.wasm")
          break
        }
        case "fsharp": {
          languageWasmPath = resolveWasm("tree-sitter-fsharp/tree-sitter-fsharp.wasm")
          break
        }
        case "powershell": {
          languageWasmPath = resolveWasm("tree-sitter-powershell/tree-sitter-powershell.wasm")
          break
        }
        // The Solidity pin names the wired bytes at `wasm/tree-sitter-solidity.wasm`
        // (script/m14/verify-grammar-pins.ts, LANES.solidity), byte-identical to the
        // npm tarball tree-sitter-solidity@1.2.13. The resolver keys on the basename,
        // so this spelling and the pin's `wired` field name the same file — a swap
        // here is a swap the pin gate catches.
        case "solidity": {
          languageWasmPath = resolveWasm("tree-sitter-solidity.wasm")
          break
        }
        // M60 VB wave. The wasm name is the GRAMMAR's name, not the language's:
        // the lane reads `tree-sitter-vbnet`, and the pin's `wired` field names
        // the same file, so a swap of the wasm here is a swap the pin catches.
        // See grammars/tree-sitter-vbnet/PIN.md.
        case "vb": {
          languageWasmPath = resolveWasm("tree-sitter-vbnet/tree-sitter-vbnet.wasm")
          break
        }

        // === MARKUP & DATA ===
        case "markdown": {
          languageWasmPath = resolveWasm("tree-sitter-markdown/tree-sitter-markdown.wasm")
          break
        }
        case "toml": {
          languageWasmPath = resolveWasm("tree-sitter-toml/tree-sitter-toml.wasm")
          break
        }
        case "xml": {
          languageWasmPath = resolveWasm("tree-sitter-xml/tree-sitter-xml.wasm")
          break
        }
        case "make": {
          languageWasmPath = resolveWasm("tree-sitter-make/tree-sitter-make.wasm")
          break
        }
        case "protobuf": {
          languageWasmPath = resolveWasm("tree-sitter-protobuf/tree-sitter-protobuf.wasm")
          break
        }

        default:
          throw new Error(`Language ${language} parser not yet implemented. Add the WASM loading case.`)
      }
    } catch (error) {
      throw new Error(
        `Failed to determine WASM path for ${language}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Load the language from WASM file or in-memory registry (compiled binary)
    let wasmBuffer: Uint8Array | undefined
    const registryData = hasWasmInRegistry(languageWasmPath)
    if (registryData) {
      wasmBuffer = registryData
    } else if (isWasmRegistryLoaded()) {
      // Compiled binary: registry loaded but WASM entry not found — fatal
      throw new Error(`WASM not found in registry for ${language} (${languageWasmPath})`)
    } else {
      const fs = require("fs")
      wasmBuffer = new Uint8Array(fs.readFileSync(languageWasmPath))
    }
    let languageGrammar: any
    try {
      if (!wasmBuffer) throw new Error(`WASM buffer is undefined for ${language}`)
      languageGrammar = await Promise.race([
        new Promise<any>((resolve, reject) => {
          try { resolve(Language.load(wasmBuffer)) }
          catch (e) { reject(e) }
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("load timeout")), 10000)),
      ])
    } catch (e: any) {
      throw new Error(`Language.load failed for ${language}: ${e?.message || String(e)}`)
    }

    const parser = new Parser()
    parser.setLanguage(languageGrammar)

    languages.set(language, languageGrammar)
    parsers.set(language, parser)
    parserUsage.set(language, Date.now())
    parseCount.set(language, 1)

    log.info("language parser loaded", { language, wasmPath: languageWasmPath })
    return parser
  }

  // Detect language from the shared filename policy used by the worker path.
  export function detectLanguage(filePath: string, content?: string): SupportedLanguage | null {
    return detectLanguageFromPath(filePath, content) as SupportedLanguage | null
  }

  // Parse file and extract universal symbols and relationships with INTELLIGENCE
  /**
   * Find the `<script>` blocks of a Vue/Svelte SFC and return their raw body
   * text (the grammar exposes each as a `raw_text` node with exact byte
   * offsets) plus each block's language (`js`/`ts`) and body start position.
   * Pure AST — no source-text scanning of the file.
   */
  /**
   * M14 (#288 / HTML-G1): the inline `<script>` / `<style>` bodies of a plain
   * HTML document, with exact byte offsets.
   *
   * A SEPARATE function rather than a flag on `extractSfcScriptBlocks`, because
   * that one feeds vue/svelte and they must not suddenly receive CSS blocks they
   * have no contract for. The grammar shape is the same for both languages — a
   * `script_element` / `style_element` whose body is a single `raw_text` leaf —
   * so this is the same walk with the style arm added and the lang dispatch
   * widened.
   *
   * Why it exists at all: the polyglot path below (the `embeddedScriptContent`
   * branch) keys on a metadata field NO analyzer in `src/ast/` has ever set, so it
   * has never fired for anything; and the SFC sub-parse seam is gated
   * `vue || svelte`. Measured across the html-bearing corpus repos, 5,389 of
   * 6,094 files (88.4%) carry an inline block that produces zero symbols today.
   */
  export function extractHtmlEmbeddedBlocks(
    rootNode: Node,
    content: string
  ): { body: string; lang: "js" | "ts" | "tsx" | "css"; startLine: number; startColumn: number; startIndex: number }[] {
    const out: { body: string; lang: "js" | "ts" | "tsx" | "css"; startLine: number; startColumn: number; startIndex: number }[] = []
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "script_element" || n.type === "style_element") {
        const isStyle = n.type === "style_element"
        let rawText: Node | null = null
        let lang: "js" | "ts" | "tsx" | "css" = isStyle ? "css" : "js"
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "raw_text") rawText = c
          if (c.type === "start_tag") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const a = c.namedChild(j)
              if (a && a.type === "attribute") {
                // `type="module"`/`type="text/typescript"`/`lang="ts"` are the
                // three ways a document says which grammar its script is; an
                // UNRECOGNISED type stays `js`, because the javascript grammar
                // recovers from a type annotation and the typescript grammar
                // rejects plain JS in ways that lose more than it gains.
                const attrName = findAttributeName(a)
                if (isStyle) {
                  if (attrName === "lang") {
                    const v = findAttributeValue(a)
                    if (v === "css" || v === "text/css") lang = "css"
                    else lang = "js" // a <style lang=…> that is not CSS is script
                  }
                } else if (attrName === "lang") {
                  const v = findAttributeValue(a)
                  if (v === "ts" || v === "typescript") lang = "ts"
                  else if (v === "tsx") lang = "tsx"
                } else if (attrName === "type") {
                  const v = findAttributeValue(a)
                  const lowered = v.toLowerCase()
                  if (lowered === "module" || lowered === "text/javascript" || lowered === "application/javascript" || lowered === "text/ecmascript" || lowered === "module/javascript") lang = "js"
                  else if (lowered === "text/typescript" || lowered === "application/typescript" || lowered === "ts") lang = "ts"
                  else if (lowered === "text/tsx" || lowered === "tsx") lang = "tsx"
                }
              }
            }
          }
        }
        if (rawText) {
          const body = content.substring(rawText.startIndex, rawText.endIndex)
          // A body that is only whitespace carries no program, and handing it to
          // a sub-parser would manufacture an empty symbol set and a per-file
          // parse cost for nothing.
          if (body.trim().length > 0) {
            out.push({
              body,
              lang,
              startLine: rawText.startPosition.row + 1,
              startColumn: rawText.startPosition.column,
              startIndex: rawText.startIndex,
            })
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  export function extractSfcScriptBlocks(
    rootNode: Node,
    content: string
  ): { body: string; lang: string; startLine: number; startColumn: number; startIndex: number }[] {
    const out: { body: string; lang: string; startLine: number; startColumn: number; startIndex: number }[] = []
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "script_element") {
        let rawText: Node | null = null
        let lang = "js"
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "raw_text") rawText = c
          if (c.type === "start_tag") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const a = c.namedChild(j)
              if (a && a.type === "attribute") {
                const attrName = findAttributeName(a)
                if (attrName === "lang") {
                  // #903: `tsx` must SURVIVE normalization. There is a separate
                  // grammar for it (tree-sitter-tsx.wasm) because the plain
                  // typescript grammar carries no JSX; collapsing tsx onto ts
                  // parsed every JSX-bearing block with ERROR nodes — measured on
                  // element-plus docs/examples/table-v2/cell-templating.vue
                  // (<script lang="tsx" setup>), where the nested `dayjs(date)`
                  // call disappeared and the surviving edge's callee span came
                  // out as a slab of raw source. `jsx` stays on `js`: the
                  // javascript grammar parses JSX itself.
                  let v = findAttributeValue(a)
                  if (v === "ts") lang = "ts"
                  else if (v === "tsx") lang = "tsx"
                }
              }
            }
          }
        }
        if (rawText) {
          const body = content.substring(rawText.startIndex, rawText.endIndex)
          if (body.trim().length > 0) {
            out.push({
              body,
              lang,
              startLine: rawText.startPosition.row + 1,
              startColumn: rawText.startPosition.column,
              // H3 (vue review wave): script-relative symbol indices need
              // this SFC base to become file-coherent (lines/cols alone
              // leave index-based consumers misaligned).
              startIndex: rawText.startIndex,
            })
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  /**
   * Collect every `inline` node (paragraph/heading inline content) in byte
   * order. The tree-sitter-markdown block grammar leaves inline content as
   * an opaque text node; links/images/autolinks are only resolved by the
   * companion inline grammar, which the engine pre-parses per block.
   */
  function extractMarkdownInlineBlocks(
    rootNode: Node,
  ): { startIndex: number; endIndex: number; startPosition: { row: number; column: number } }[] {
    const out: { startIndex: number; endIndex: number; startPosition: { row: number; column: number } }[] = []
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "inline") {
        out.push({
          startIndex: n.startIndex,
          endIndex: n.endIndex,
          startPosition: { row: n.startPosition.row, column: n.startPosition.column },
        })
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    // Restore source order (stack pops in reverse).
    return out.sort((a, b) => a.startIndex - b.startIndex)
  }

  // Companion grammar: tree-sitter-markdown-inline, cached like getParser.
  // Used to resolve links/images/autolinks inside markdown inline nodes.
  async function getMarkdownInlineParser(): Promise<Parser> {
    const key = "__markdown_inline__"
    await ensureWasmRegistry()
    if (parsers.has(key)) {
      parserUsage.set(key, Date.now())
      return parsers.get(key)!
    }
    const { Parser, Language } = await treeSitterCore()
    const wasmPath = resolveWasm("tree-sitter-markdown_inline/tree-sitter-markdown_inline.wasm")
    let wasmBuffer: Uint8Array | undefined
    const registryData = hasWasmInRegistry(wasmPath)
    if (registryData) {
      wasmBuffer = registryData
    } else if (isWasmRegistryLoaded()) {
      throw new Error(`WASM not found in registry for markdown_inline (${wasmPath})`)
    } else {
      const fs = require("fs")
      wasmBuffer = new Uint8Array(fs.readFileSync(wasmPath))
    }
    const languageGrammar = await Language.load(wasmBuffer)
    const parser = new Parser()
    parser.setLanguage(languageGrammar)
    languages.set(key, languageGrammar)
    parsers.set(key, parser)
    parserUsage.set(key, Date.now())
    parseCount.set(key, 1)
    log.debug("language parser loaded", { language: "markdown_inline", wasmPath })
    return parser
  }

  function findAttributeName(attr: Node): string {
    for (let i = 0; i < attr.namedChildCount; i++) {
      const c = attr.namedChild(i)
      if (c && c.type === "attribute_name") return c.text
    }
    return ""
  }

  // Attribute value text with quotes stripped: handles both the vue shape
  // (`attribute_value` child) and the svelte shape
  // (`quoted_attribute_value > attribute_value`). Pure string ops — no regex.
  function findAttributeValue(attr: Node): string {
    const stack: Node[] = []
    for (let i = 0; i < attr.namedChildCount; i++) {
      const c = attr.namedChild(i)
      if (c) stack.push(c)
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "attribute_value") return n.text
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return ""
  }

  // Parse a file's raw content with a language-specific tree-sitter grammar and
  // return the parser + tree WITHOUT running analyzers or deleting the tree.
  // Shared by parseFile (symbols/relationships) and parseTree (safety primitives
  // that need the raw syntax tree: comment/string masking and reference-occurrence
  // extraction). Mirrors parseFile's Lua/C++/truncation preprocessing exactly so
  // byte offsets always agree between the symbol index and the safety primitives.
  async function parseRaw(
    filePath: string,
    content: string,
    language: SupportedLanguage,
  ): Promise<{ parser: any; tree: any; transientLuaGrammar: any }> {
    let parser: any
    let transientLuaGrammar: any = null

    // Lua's WASM binding is only reliable when each parse is isolated from
    // the engine parser cache: a private Parser + Language instance loaded
    // from fresh bytes keeps one file's external-scanner state out of the
    // next file. Other languages retain the normal cached-parser path.
    if (language === "lua") {
      const fs = require("fs")
      const WebTreeSitter: any = await loadWebTreeSitter()
      const ParserCtor: any = WebTreeSitter.Parser ?? WebTreeSitter.default ?? WebTreeSitter
      const LanguageCtor: any = WebTreeSitter.Language ?? WebTreeSitter.default?.Language
      const initFn = WebTreeSitter.init ?? ParserCtor.init ?? (ParserCtor as any).init
      if (initFn) await initFn({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
      transientLuaGrammar = await LanguageCtor.load(
        new Uint8Array(fs.readFileSync(resolveWasmAsset("tree-sitter-lua.wasm"))),
      )
      parser = new ParserCtor()
      parser.setLanguage(transientLuaGrammar)
    } else {
      parser = await getParser(language)
    }

    // Protect against very large files that might hang the parser
    if (content.length > 1024 * 1024) {
      // 1MB limit for parsing
      log.warn("large file detected, using truncated content", {
        filePath,
        originalSize: content.length,
        truncatedSize: 1024 * 1024,
      })
      content = content.substring(0, 1024 * 1024)
    }

    // === UNIVERSAL C/C++ AST ILLUSION FIX ===
    // Strip compiler extensions & common macro keywords by replacing them with exact spaces.
    // This preserves exact byte bounds and line numbers for Tree-sitter across ANY C/C++ codebase (Linux, Redis, etc.)
    //
    // #920 (M60-C, found by the M59 Tier A oracle on the zig corpus): the two
    // MULTI-LINE patterns below are the only ones that can span a newline, and
    // blanking them with `" ".repeat(len)` kept the BYTE count while DESTROYING
    // every newline inside the match — so each `__attribute__(( … ))` written
    // across lines removed one (or more) rows from the text the parser sees, and
    // every node AFTER it was stamped one (or more) lines too small. Measured, and
    // it is not a rounding error: `zig/lib/libc/wasi/libc-bottom-half/sources/
    // __wasilibc_real.c` lost 138 rows, 76 of zig's 14,032 C/C++ files lose at
    // least one, and on the M59 120-file c/cpp sample 783 landed relationships
    // carried a line that does not even contain the name they claim (98 in c,
    // 682 in cpp — 1.28% / 3.52%, the whole of the oracle's INCONSISTENT column).
    // Blanking to spaces EXCEPT newlines keeps the byte offsets identical (the
    // safety primitives' masking contract) AND keeps `startPosition.row` honest.
    const blankKeepingNewlines = (match: string): string => match.replace(/[^\n]/g, " ")
    if (language === "c" || language === "cpp") {
      content = content
        // Match __attribute__((...)) across multiple lines
        .replace(/__attribute__\s*\(\([\s\S]*?\)\)/g, blankKeepingNewlines)
        // Match MSVC __declspec(...)
        .replace(/__declspec\s*\([\s\S]*?\)/g, blankKeepingNewlines)
        // Standard universal compiler directives
        .replace(/__restrict__/g, "            ")
        .replace(/__restrict/g, "          ")
        .replace(/__volatile__/g, "            ")
        .replace(/__inline__/g, "          ")
        .replace(/__forceinline/g, "             ")
        .replace(/__cdecl/g, "       ")
        .replace(/__stdcall/g, "         ")
        .replace(/__fastcall/g, "          ")
        // Custom common storage qualifiers (Redis uses __stored_key)
        .replace(/__stored_key/g, "            ")
    }

    // Per-file self-destruct timer — parser.parse() is synchronous C/WASM
    // code that can loop forever on pathological inputs. setTimeout can't
    // interrupt it (event loop is blocked), so we kill the whole process.
    // The indexer is incremental — re-running resumes from where it left off.
    const parseBomb = setTimeout(() => {
      process.stderr.write(`[BB-HANG] parser stuck 120s on ${filePath} — exiting\n`)
      process.exit(1)
    }, 120000)

    const tree = parser.parse(content)
    clearTimeout(parseBomb)
    if (!tree) {
      throw new Error(`Failed to parse file: ${filePath}`)
    }

    // The SQL analyzer's declaration-resync pass re-parses a badly damaged file
    // one statement at a time (a single unterminated dollar-quote otherwise
    // swallows the rest of the file — measured at 33% of corpus declarations
    // unreachable). `analyze` is synchronous and `Language.load` is not, so it
    // cannot build that parser itself on the first file; hand it the grammar
    // this function has already loaded rather than making it load a second copy.
    // `parser.language` is the Language the parser was set to (web-tree-sitter
    // 0.25 exposes no getLanguage()). Harnesses that drive the analyzer directly
    // call `setGrammar` themselves, so the pass is exercised by the fixture lane
    // and not only in production.
    if (language === "sql") {
      try {
        const mod: any = await import("./real-sql-analyzer")
        const grammar = (parser as any).language
        if (grammar) (mod.RealSqlAnalyzer as any).setGrammar?.(grammar, (parser as any).constructor)
      } catch {
        // No grammar handed over: the analyzer keeps the main pass only and
        // records resyncSkipped in its ambiguity counters.
      }
    }

    return { parser, tree, transientLuaGrammar }
  }

  // Wrap parseRaw with a timeout so a stuck grammar cannot hang the process.
  async function parseWithTimeout(
    filePath: string,
    content: string,
    language: SupportedLanguage,
  ): Promise<{ parser: any; tree: any; transientLuaGrammar: any }> {
    const parsePromise = parseRaw(filePath, content, language)
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        log.error("parser timeout - forcefully aborting", { filePath })
        reject(new Error(`Parser timeout for ${filePath}`))
      }, 120000) // Reduced to 120 seconds
    })
    try {
      const result = await Promise.race([parsePromise, timeoutPromise])
      clearTimeout(timeoutId!)
      return result
    } catch (error) {
      clearTimeout(timeoutId!)
      throw error
    }
  }

  /**
   * Parse a file and return the raw tree-sitter tree WITHOUT deleting it. The
   * caller owns tree.delete() (and, for Lua, parser/grammar cleanup). Used by
   * the safety primitives (comment/string masking, reference-occurrence
   * extraction) which need the syntax tree, not just symbols.
   */
  export async function parseTree(
    filePath: string,
    content: string,
  ): Promise<{ language: SupportedLanguage; tree: any; parser: any; transientLuaGrammar: any }> {
    const language = detectLanguage(filePath, content)
    if (!language) {
      throw new Error(`Unsupported file type: ${filePath}`)
    }
    const { parser, tree, transientLuaGrammar } = await parseWithTimeout(filePath, content, language)
    return { language, tree, parser, transientLuaGrammar }
  }

  export async function parseFile(filePath: string, content: string, context?: AnalyzeContext): Promise<ParseResult> {
    const language = detectLanguage(filePath, content)
    if (!language) {
      throw new Error(`Unsupported file type: ${filePath}`)
    }

    // Add timeout protection for parser operations
    const { parser, tree, transientLuaGrammar } = await parseWithTimeout(filePath, content, language)

    // Detect Syntax Errors
    const treeErrors: ParseError[] = []
    if (tree.rootNode.hasError) {
      const traverse = (node: any) => {
        if (node.type === "ERROR" || node.isMissing) {
          treeErrors.push({
            message: `Syntax error (${node.isMissing ? "missing" : "unexpected"} node)`,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column + 1,
            },
            severity: `warning`,
          })
        }
        const children = node.children
        for (let i = 0; i < children.length; i++) {
          if (treeErrors.length < 50) traverse(children[i])
        }
      }
      traverse(tree.rootNode)
      // Some MISSING nodes (e.g. hidden `_alpha_identifier` recovery tokens in
      // tree-sitter-kotlin `when` entries) are not iterable via child(i)/children
      // in the web-tree-sitter binding, so the walk above can surface nothing
      // even though rootNode.hasError is true. Emit a generic warning so the
      // file is still reported as having a syntax error (never silently clean).
      if (treeErrors.length === 0) {
        treeErrors.push({
          message: `Syntax error present in file (hidden MISSING node)`,
          range: {
            startLine: tree.rootNode.startPosition.row + 1,
            startColumn: tree.rootNode.startPosition.column + 1,
            endLine: tree.rootNode.endPosition.row + 1,
            endColumn: tree.rootNode.endPosition.column + 1,
          },
          severity: `warning`,
        })
      }
    }

    log.debug("parsed file", {
      filePath,
      language,
      nodeCount: tree.rootNode.namedChildCount,
    })

    // STEP 1: Extract symbols and relationships using comprehensive language-specific analyzers
    // Wrap analyzer steps with their own timeout protection
    const analyzePromise = (async () => {
      const analyzer = await getAnalyzer(language)
      let analysisResult

      // VUE/SVELTE SFC: pre-parse each <script> block body with the JS/TS
      // grammar and hand the parsed trees to the analyzer via context (these
      // grammars expose the script body as a raw_text node; the analyzer is
      // sync and cannot load parsers itself). This replaces the old regex-based
      // POLYGLOT INJECTION for vue/svelte — the new analyzers do NOT set
      // embeddedScriptContent, so the polyglot path below is skipped.
      if ((language === "vue" || language === "svelte") && tree?.rootNode) {
        try {
          const scriptBlocks = extractSfcScriptBlocks(tree.rootNode, content)
          if (scriptBlocks.length > 0) {
            const sfcScriptTrees: Tree[] = []
            const sfcScriptLines: number[] = []
            const sfcScriptCols: number[] = []
            const sfcScriptStartIndex: number[] = []
            for (const block of scriptBlocks) {
              // #903: three-way dispatch — a tsx block needs the JSX-capable
              // typescript grammar, not the plain one (see extractSfcScriptBlocks).
              const subLang = block.lang === "ts" ? "typescript" : block.lang === "tsx" ? "tsx" : "javascript"
              const subParser = await getParser(subLang)
              const subTree = subParser.parse(block.body)
              sfcScriptTrees.push(subTree)
              sfcScriptLines.push(block.startLine)
              sfcScriptCols.push(block.startColumn)
              sfcScriptStartIndex.push(block.startIndex)
            }
            context = {
              ...context,
              sfcScriptTrees,
              sfcScriptLines,
              sfcScriptCols,
              sfcScriptStartIndex,
              sfcScriptLangs: scriptBlocks.map((b) => b.lang),
            }
          }
        } catch (e) {
          log.debug("sfc script sub-parse failed", { error: (e as Error)?.message })
        }
      }

      // M14 (#288 / HTML-G1): pre-parse each inline <script>/<style> body of a
      // plain HTML document and hand the trees to the analyzer via context. Same
      // shape as the SFC seam above, and the same REASON it uses `getParser`
      // rather than constructing one: a fresh Parser per file exhausted the
      // fixed-size wasm heap mid-sweep at --sample 400 (M49 W12), so the parsers
      // are the cached ones and this is a lookup, not an allocation.
      if (language === "html" && tree?.rootNode) {
        try {
          const blocks = extractHtmlEmbeddedBlocks(tree.rootNode, content)
          if (blocks.length > 0) {
            const trees: Tree[] = []
            for (const block of blocks) {
              const subParser = await getParser(block.lang === "ts" ? "typescript" : block.lang === "tsx" ? "tsx" : block.lang === "css" ? "css" : "javascript")
              trees.push(subParser.parse(block.body))
            }
            context = {
              ...context,
              htmlEmbeddedTrees: trees,
              htmlEmbeddedLangs: blocks.map((b) => b.lang),
              htmlEmbeddedStartLines: blocks.map((b) => b.startLine),
              htmlEmbeddedStartColumns: blocks.map((b) => b.startColumn),
              htmlEmbeddedStartIndices: blocks.map((b) => b.startIndex),
            }
          }
        } catch (e) {
          // A sub-parse failure must not lose the document: the html analyzer
          // still runs, and HTML-G1's own accounting sees the shorter block list.
          log.debug("html embedded sub-parse failed", { error: (e as Error)?.message })
        }
      }

      // MARKDOWN: pre-parse each inline node with the companion
      // tree-sitter-markdown-inline grammar and hand the trees to the
      // analyzer via context (the block grammar leaves `inline` opaque; the
      // analyzer is sync and cannot load parsers itself). The analyzer
      // matches inline trees back to their source byte offsets, so links,
      // images, and autolinks resolve as AST nodes instead of regex scans.
      if (language === "markdown" && tree?.rootNode) {
        try {
          const inlineBlocks = extractMarkdownInlineBlocks(tree.rootNode)
          if (inlineBlocks.length > 0) {
            const inlineParser = await getMarkdownInlineParser()
            const mdInlineTrees: Tree[] = []
            const mdInlineStarts: number[] = []
            const mdInlineLines: number[] = []
            for (const block of inlineBlocks) {
              const inlineText = content.substring(block.startIndex, block.endIndex)
              if (inlineText.trim().length === 0) continue
              const subTree = inlineParser.parse(inlineText)
              mdInlineTrees.push(subTree)
              mdInlineStarts.push(block.startIndex)
              mdInlineLines.push(block.startPosition.row + 1)
            }
            context = {
              ...context,
              mdInlineTrees,
              mdInlineStarts,
              mdInlineLines,
            }
          }
        } catch (e) {
          log.debug("markdown inline sub-parse failed", { error: (e as Error)?.message })
        }
      }

      // STEP 2: 🧠 ENHANCE WITH ADVANCED TYPE INFERENCE
      const TypeInference = (await import("./type-inference")).TypeInference
      const enhancedAnalyzer = TypeInference.enhanceAnalyzerWithTypeInference(analyzer, language)
      analysisResult = enhancedAnalyzer.analyze(tree.rootNode, content, filePath, context)

      // STEP 3: 🚀 ENHANCE WITH FRAMEWORK-SPECIFIC INTELLIGENCE
      const FrameworkIntelligence = (await import("./framework-intelligence")).FrameworkIntelligence
      analysisResult = FrameworkIntelligence.enhanceWithFrameworkIntelligence(analysisResult, content, language)

      return analysisResult
    })()

    let timeoutId2: NodeJS.Timeout
    const analyzeTimeoutPromise = new Promise<never>((_, reject) => {
      timeoutId2 = setTimeout(() => {
        log.error("analyzer timeout - forcefully aborting", { filePath })
        reject(new Error(`Analyzer timeout for ${filePath}`))
      }, 120000) // 120 second timeout for analysis
    })

    let result
    try {
      try {
        result = await Promise.race([analyzePromise, analyzeTimeoutPromise])
        clearTimeout(timeoutId2!)
      } catch (error) {
        clearTimeout(timeoutId2!)
        log.warn("analyzer timeout, returning basic parse result", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })

        // Return minimal parse result if analysis fails
        return {
          language,
          symbols: [],
          relationships: [],
          imports: [],
          exports: [],
          errors: [
            {
              message: error instanceof Error ? error.message : String(error),
              range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
              severity: "error" as const,
            },
          ],
          rawContent: content,
          metadata: {
            complexity: 0,
            linesOfCode: content.split("\n").length,
            cyclomaticComplexity: 0,
            framework: "unknown",
            architecture: "unknown",
            patterns: [],
            detectedFrameworks: [],
            frameworkPatterns: [],
            architecturalInsights: [],
            architecturalScore: 0,
            codeQuality: "unknown",
            hasTypeInference: false,
            hasFrameworkIntelligence: false,
            analysisVersion: "2.0-basic-fallback",
          },
        }
      }
      const meta = result.metadata || {}

      // POLYGLOT INJECTION
      if (language === "html" || language === "vue" || language === "svelte") {
        const polyglotSymbols = []
        const polyglotRels = []
        const polyglotImports = []
        for (const sym of result.symbols) {
          if (sym.metadata?.embeddedScriptContent || sym.metadata?.embeddedStyleContent) {
            const langName = sym.metadata?.embeddedScriptContent ? "inline.js" : "inline.css"
            const snip = content.substring(sym.range.startIndex, sym.range.endIndex)

            // Strip open and close tags
            let match = null
            if (langName === "inline.js") match = snip.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
            else match = snip.match(/<style[^>]*>([\s\S]*?)<\/style>/i)

            if (match && match[1] && match[1].trim().length > 0) {
              const innerCode = match[1]
              const offsetIndex = sym.range.startIndex + match.index + match[0].indexOf(innerCode)
              const preCode = content.substring(0, offsetIndex)
              const offsetLine = preCode.split("\n").length - 1
              const offsetCol = preCode.length - preCode.lastIndexOf("\n") - 1

              try {
                if (filePath.includes("UltimateSvelteTest.svelte")) {
                  require("fs").writeFileSync("/tmp/svelte_inner_" + langName + ".txt", innerCode)
                }
                const subParse = await ASTEngine.parseFile(filePath + "." + langName, innerCode)

                // Offset and add
                for (const jsSym of subParse.symbols) {
                  jsSym.range.startIndex += offsetIndex
                  jsSym.range.endIndex += offsetIndex
                  jsSym.range.startLine += offsetLine
                  jsSym.range.endLine += offsetLine

                  // Associate with parent HTML element
                  jsSym.ownerName = jsSym.ownerName || sym.name
                  jsSym.metadata = { ...jsSym.metadata, polyglotHost: sym.name, embeddedIn: filePath }

                  polyglotSymbols.push(jsSym)
                }

                for (const jsRel of subParse.relationships) {
                  polyglotRels.push(jsRel)
                }

                for (const jsImp of subParse.imports) {
                  if (jsImp.range) {
                    if (jsImp.range.startIndex !== undefined) jsImp.range.startIndex += offsetIndex
                    if (jsImp.range.endIndex !== undefined) jsImp.range.endIndex += offsetIndex
                    jsImp.range.startLine += offsetLine
                    jsImp.range.endLine += offsetLine
                  }
                  polyglotImports.push(jsImp)
                }
              } catch (e: any) {
                // Polyglot parse error suppressed
              }
            }
          }
        }

        result.symbols.push(...polyglotSymbols)
        result.relationships.push(...polyglotRels)
        result.imports.push(...polyglotImports)
      }

      // STEP 4: Return complete intelligent analysis

      return {
        language,
        symbols: result.symbols || [],
        relationships: result.relationships || [],
        imports: result.imports || [],
        exports: result.exports || [],
        errors: [...(result.errors || []), ...treeErrors],
        rawContent: result.rawContent,
        metadata: {
          // The analyzer's OWN metadata is spread FIRST, so a lane's own keys
          // survive the trip to the production entry. This object used to be a
          // fixed allowlist of thirteen fields, and every key outside that list
          // was silently dropped — which is how the VB lane's `vbGaps` (its
          // disclosed gaps, the thing the lane exists to report) never reached
          // `parseFile`, and how `analysisVersion` read `m10.06-cut` for a lane
          // whose analyzer stamps `m60-vb-1`. A disclosure that is computed and
          // then thrown away is not a disclosure.
          ...meta,
          complexity: meta.complexity || 0,
          linesOfCode: content.split("\n").length,
          cyclomaticComplexity: meta.cyclomaticComplexity,
          framework: meta.framework,
          architecture: meta.architecture,
          patterns: meta.patterns || [],
          // NEW: Enhanced intelligence metadata
          detectedFrameworks: meta.detectedFrameworks || [],
          frameworkPatterns: meta.frameworkPatterns || [],
          architecturalInsights: meta.architecturalInsights || [],
          architecturalScore: meta.architecturalScore || 0,
          codeQuality: meta.codeQuality || "unknown",
          // NOT hardcoded `true`. These two are CLAIMS a lane makes about
          // itself, and lanes make them honestly in both directions: the VB
          // analyzer reports `false` for both, because it does no type inference
          // and has no framework intelligence, and the hardcode overwrote that
          // with `true` on the way out — the product asserting a capability the
          // lane has explicitly said it lacks. The `?? true` default keeps every
          // lane that says nothing behaving exactly as it did before, so the only
          // behaviour that changes is a lane that made the claim and was
          // overwritten. (kotlin's spec already records this field as real:
          // "metadata.hasTypeInference stays — declared-type extraction IS real
          // inference input.")
          hasTypeInference: meta.hasTypeInference ?? true,
          hasFrameworkIntelligence: meta.hasFrameworkIntelligence ?? true,
          // M14 (#888): FORWARD the analyzer's own scored metrics. This object is
          // a fresh literal listing fifteen keys, so anything an analyzer computes
          // and this list omits is computed and DISCARDED — silently, because
          // `FileMetadata` carries an index signature and the extra key
          // typechecks. The html analyzer measured exactly that: it computed
          // accessibility / semantic / performance scores, a `score` breakdown and
          // a `documentMetrics` census, none of which appeared in the parse result
          // (verified `"accessibilityScore" in metadata === false`), and the three
          // scores have no consumer anywhere in `src/` or `script/` besides this
          // line. Each key below reads `undefined` for every other language, which
          // is identical to the key being absent — so this is additive by
          // construction, not a change to any other lane's payload.
          accessibilityScore: (meta as any).accessibilityScore,
          semanticScore: (meta as any).semanticScore,
          performanceScore: (meta as any).performanceScore,
          score: (meta as any).score,
          documentMetrics: (meta as any).documentMetrics,
          elementCount: (meta as any).elementCount,
          addressableNodeCount: (meta as any).addressableNodeCount,
          maxElementDepth: (meta as any).maxElementDepth,
          analysisVersion: meta.analysisVersion || "m10.06-cut",
        },
      }
    } finally {
      // 🚨 CRITICAL MEMORY FIX: Clean up WASM memory tree to prevent OOM
      if (tree && typeof tree.delete === "function") {
        tree.delete()
      }
      if (language === "lua" && transientLuaGrammar) {
        try { if (parser && typeof parser.delete === "function") parser.delete() } catch {}
        try { if (typeof transientLuaGrammar.delete === "function") transientLuaGrammar.delete() } catch {}
      }
    }
  }

  // Get language-specific analyzer
  // @backbencher: lazy imports to break circular dependency: engine ↔ 38 analyzers
  async function getAnalyzer(language: SupportedLanguage): Promise<LanguageAnalyzer> {
    switch (language) {
      case "typescript":
      case "tsx":
        return new (await import("./real-typescript-analyzer")).RealTypeScriptAnalyzer()
      case "javascript":
        return new (await import("./real-javascript-analyzer")).RealJavaScriptAnalyzer()
      case "html":
        return new (await import("./real-html-analyzer")).RealHtmlAnalyzer()
      case "css":
      case "sass":
        return new (await import("./real-css-analyzer")).RealCssAnalyzer()
      case "scss":
        return new (await import("./real-scss-analyzer")).RealScssAnalyzer()
      case "json":
        return new (await import("./real-json-analyzer")).RealJsonAnalyzer()
      case "yaml":
        return new (await import("./real-yaml-analyzer")).RealYamlAnalyzer()
      case "perl":
        return new (await import("./real-perl-analyzer")).RealPerlAnalyzer()
      case "c":
        return new (await import("./real-c-analyzer")).RealCAnalyzer()
      case "cpp":
        return new (await import("./real-cpp-analyzer")).RealCppAnalyzer()
      case "rust":
        return new (await import("./real-rust-analyzer")).RealRustAnalyzer()
      case "go":
        return new (await import("./real-go-analyzer")).RealGoAnalyzer()
      case "java":
        return new (await import("./real-java-analyzer")).RealJavaAnalyzer()
      case "kotlin":
        return new (await import("./real-kotlin-analyzer")).RealKotlinAnalyzer()
      case "scala":
        return new (await import("./real-scala-analyzer")).RealScalaAnalyzer()
      case "python":
        return new (await import("./real-python-analyzer")).RealPythonAnalyzer()
      case "ruby":
        return new (await import("./real-ruby-analyzer")).RealRubyAnalyzer()
      case "php":
        return new (await import("./real-php-analyzer")).RealPhpAnalyzer()
      case "lua":
        return new (await import("./real-lua-analyzer")).RealLuaAnalyzer()
      case "elixir":
        return new (await import("./real-elixir-analyzer")).RealElixirAnalyzer()
      case "erlang":
        return new (await import("./real-erlang-analyzer")).RealErlangAnalyzer()
      case "haskell":
        return new (await import("./real-haskell-analyzer")).RealHaskellAnalyzer()
      case "clean":
        return new (await import("./real-clean-analyzer")).RealCleanAnalyzer()
      case "clojure":
        return new (await import("./real-clojure-analyzer")).RealClojureAnalyzer()
      case "swift":
        return new (await import("./real-swift-analyzer")).RealSwiftAnalyzer()
      case "dart":
        return new (await import("./real-dart-analyzer")).RealDartAnalyzer()
      case "csharp":
        return new (await import("./real-csharp-analyzer")).RealCSharpAnalyzer()
      case "r":
        return new (await import("./real-r-analyzer")).RealRAnalyzer()
      case "sql":
        return new (await import("./real-sql-analyzer")).RealSqlAnalyzer()
      case "bash":
        return new (await import("./real-bash-analyzer")).RealBashAnalyzer()
      case "objective-c":
        return new (await import("./real-objective-c-analyzer")).RealObjectiveCAnalyzer()
      case "groovy":
        return new (await import("./real-groovy-analyzer")).RealGroovyAnalyzer()
      case "vue":
        return new (await import("./real-vue-analyzer")).RealVueAnalyzer()
      case "svelte":
        return new (await import("./real-svelte-analyzer")).RealSvelteAnalyzer()
      case "hcl":
      case "terraform":
        return new (await import("./real-hcl-analyzer")).RealHclAnalyzer()
      case "graphql":
        return new (await import("./real-graphql-analyzer")).RealGraphqlAnalyzer()
      // Protobuf: the vendored, patched tree-sitter-proto (see the name map
      // above and grammars/tree-sitter-proto/README.md).
      case "protobuf":
        return new (await import("./real-protobuf-analyzer")).RealProtobufAnalyzer()
      case "zig":
        return new (await import("./real-zig-analyzer")).RealZigAnalyzer()
      case "nim":
        return new (await import("./real-nim-analyzer")).RealNimAnalyzer()
      case "fsharp":
        return new (await import("./real-fsharp-analyzer")).RealFsharpAnalyzer()
      case "powershell":
        return new (await import("./real-powershell-analyzer")).RealPowershellAnalyzer()
      case "solidity":
        return new (await import("./real-solidity-analyzer")).RealSolidityAnalyzer()
      case "make":
        return new (await import("./real-makefile-analyzer")).RealMakefileAnalyzer()
      case "xml":
        return new (await import("./real-xml-analyzer")).RealXmlAnalyzer()
      case "markdown":
        return new (await import("./real-markdown-analyzer")).RealMarkdownAnalyzer()
      case "vb":
        return new (await import("./real-vb-analyzer")).RealVbAnalyzer()
      case "toml":
        return new (await import("./real-toml-analyzer")).RealTomlAnalyzer()
      default:
        return new GenericAnalyzer()
    }
  }

  // Project-level context passed to analyzers for cross-file resolution
  // (e.g. the override companion index). Optional: per-file-only callers
  // omit it and analyzers keep their deterministic per-file defaults.
  export interface AnalyzeContext {
    /** Owner type name → declared method names, built from previously parsed
     *  files. Used for cross-file override-target resolution. */
    overrideCompanion?: Map<string, Set<string>>
    [key: string]: any
  }

  // Base analyzer interface
  export interface LanguageAnalyzer {
    analyze(
      rootNode: Node,
      content: string,
      filePath: string,
      context?: AnalyzeContext,
    ): Omit<ParseResult, "language" | "metadata"> & { metadata?: Partial<FileMetadata> }
  }

  // Cross-language stdlib type recognition — prevents "unknown" classification
  // for common standard library types that appear as plain identifiers in AST.
  const JAVA_STDLIB_TYPES = new Set([
    "String", "Integer", "Boolean", "Long", "Double", "Float", "Byte", "Short",
    "Character", "Object", "Class", "Number", "Void", "BigDecimal", "BigInteger",
    "List", "Map", "Set", "Collection", "ArrayList", "HashMap", "HashSet",
    "Optional", "Stream", "File", "Path", "IOException", "Exception", "RuntimeException",
    "Thread", "Runnable", "Callable", "Future", "CompletableFuture",
    "StringBuilder", "StringBuffer", "Pattern", "Matcher",
  ])
  const PYTHON_STDLIB_TYPES = new Set([
    "str", "int", "float", "bool", "list", "dict", "set", "tuple", "bytes",
    "bytearray", "memoryview", "complex", "frozenset", "range", "slice",
    "type", "object", "Exception", "ValueError", "TypeError", "KeyError",
    "os", "sys", "json", "re", "datetime", "collections", "itertools",
    "functools", "pathlib", "Path", "IO", "TextIO",
  ])
  const JS_BUILTIN_TYPES = new Set([
    "String", "Number", "Boolean", "Array", "Object", "Function", "Symbol",
    "Map", "Set", "WeakMap", "WeakSet", "Promise", "RegExp", "Date", "Error",
    "JSON", "Math", "Intl", "console", "Buffer", "process",
    "BigInt", "ArrayBuffer", "DataView", "Float32Array", "Float64Array",
    "Int8Array", "Int16Array", "Int32Array", "Uint8Array", "Uint16Array", "Uint32Array",
  ])
  const GO_STDLIB_TYPES = new Set([
    "string", "int", "int8", "int16", "int32", "int64",
    "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
    "float32", "float64", "complex64", "complex128",
    "bool", "byte", "rune", "error",
    "Context", "Reader", "Writer", "Closer", "Seeker",
    "Scanner", "Builder", "File", "ResponseWriter", "Request",
    "http", "os", "io", "fmt", "strings", "strconv", "time",
    "sync", "json", "net", "url", "crypto", "encoding",
  ])
  const RUST_STDLIB_TYPES = new Set([
    "String", "str", "Vec", "Option", "Result", "Box", "Rc", "Arc",
    "HashMap", "HashSet", "BTreeMap", "BTreeSet", "LinkedList", "VecDeque",
    "i8", "i16", "i32", "i64", "i128", "isize",
    "u8", "u16", "u32", "u64", "u128", "usize",
    "f32", "f64", "bool", "char", "Path", "PathBuf",
    "File", "Error", "Iterator", "Clone", "Copy", "Debug", "Display",
    "std", "core", "alloc", "collections",
  ])
  const SWIFT_STDLIB_TYPES = new Set([
    "String", "Int", "Double", "Float", "Bool", "Character",
    "Array", "Dictionary", "Set", "Optional", "Result",
    "Data", "URL", "Date", "UUID", "Error",
    "AnyObject", "AnyClass", "UIView", "UIViewController",
  ])
  // Combine all stdlib sets for GenericAnalyzer upgrade
  const ALL_STDLIB_TYPES = new Set([
    ...JAVA_STDLIB_TYPES, ...PYTHON_STDLIB_TYPES, ...JS_BUILTIN_TYPES,
    ...GO_STDLIB_TYPES, ...RUST_STDLIB_TYPES, ...SWIFT_STDLIB_TYPES,
  ])

  // Generic analyzer for unsupported languages (basic symbol extraction)
  class GenericAnalyzer implements LanguageAnalyzer {
    analyze(rootNode: Node, content: string, filePath: string, _context?: AnalyzeContext) {
      const symbols: UniversalSymbol[] = []
      const relationships: UniversalRelationship[] = []
      const imports: ImportInfo[] = []
      const exports: ExportInfo[] = []
      const errors: ParseError[] = []

      // Basic traversal to extract any named nodes
      this.traverseNode(rootNode, symbols, content)

      return {
        symbols,
        relationships,
        imports,
        exports,
        errors,
        metadata: {
          complexity: this.calculateComplexity(rootNode),
          patterns: [],
        },
      }
    }

    private traverseNode(rootNode: Node, symbols: UniversalSymbol[], content: string) {
      // Iterative DFS to prevent recursion depth issues and OOMs
      const walkStack: Node[] = [rootNode]

      while (walkStack.length > 0) {
        const node = walkStack.pop()!

        // Basic symbol extraction
        if (node.isNamed) {
          // Avoid node.text on huge nodes unless it's a leaf or small
          const isReasonablySmall = node.endIndex - node.startIndex < 100
          if (isReasonablySmall) {
            const text = node.text
            if (text) {
              let kind = this.mapNodeTypeToSymbolKind(node.type)
              // Upgrade stdlib types (Boolean, Integer, File, etc.) from Variable→Class
              const upgraded = this.upgradeStdlibKind(text, kind)
              if (upgraded) kind = upgraded
              symbols.push({
                name: text,
                kind,
                range: {
                  startLine: node.startPosition.row + 1,
                  startColumn: node.startPosition.column + 1,
                  endLine: node.endPosition.row + 1,
                  endColumn: node.endPosition.column + 1,
                  startIndex: node.startIndex,
                  endIndex: node.endIndex,
                },
                metadata: {
                  nodeType: node.type,
                  raw: true,
                },
              })
            }
          }
        }

        const childCount = node.namedChildCount
        for (let i = childCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) {
            walkStack.push(child)
          }
        }
      }
    }

    private mapNodeTypeToSymbolKind(nodeType: string): SymbolKind {
      // Tree-sitter node type → SymbolKind classification.
      // Must handle all common tree-sitter node type naming conventions
      // across 36 languages. Missing cases default to Variable, producing
      // 160K+ "unknown" symbols in the DB.
      if (nodeType.includes("function")) return SymbolKind.Function
      if (nodeType.includes("method")) return SymbolKind.Method
      if (nodeType.includes("class")) return SymbolKind.Class
      if (nodeType.includes("interface")) return SymbolKind.Interface
      if (nodeType.includes("enum")) return SymbolKind.Enum
      if (nodeType.includes("struct")) return SymbolKind.Struct
      if (nodeType.includes("trait")) return SymbolKind.Trait
      if (nodeType.includes("impl")) return SymbolKind.Impl
    if (nodeType.includes("mixin")) return SymbolKind.Mixin
    if (nodeType.includes("extension")) return SymbolKind.Extension
      if (nodeType.includes("namespace") || nodeType.includes("module")) return SymbolKind.Namespace
      if (nodeType.includes("constructor")) return SymbolKind.Constructor
      if (nodeType.includes("property") || nodeType.includes("field")) return SymbolKind.Property
      if (nodeType.includes("variable") || nodeType.includes("identifier") || nodeType.includes("parameter")) return SymbolKind.Variable
      if (nodeType.includes("constant")) return SymbolKind.Constant
      if (nodeType.includes("import")) return SymbolKind.Import
      if (nodeType.includes("export")) return SymbolKind.Export
      if (nodeType.includes("type_alias") || nodeType.includes("type_annotation")) return SymbolKind.Type
      return SymbolKind.Variable // Default fallback
    }

    // Recognizes common stdlib type names across all 40 languages.
    // Tree-sitter sees these as plain identifiers (not class_declarations),
    // so the GenericAnalyzer defaults them to Variable. This upgrades them.
    // The import-only filter in parallel-indexer catches the rest at storage level.
    private upgradeStdlibKind(name: string, currentKind: SymbolKind): SymbolKind | null {
      if (currentKind !== SymbolKind.Variable && currentKind !== ("unknown" as any)) return null
      if (ALL_STDLIB_TYPES.has(name)) return SymbolKind.Class
      // Capitalized names are likely class/type references in most languages
      if (name.length > 1 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
        return SymbolKind.Class
      }
      return null
    }

    private calculateComplexity(rootNode: Node): number {
      let complexity = 1
      const walkStack: Node[] = [rootNode]

      while (walkStack.length > 0) {
        const node = walkStack.pop()!
        complexity++

        const childCount = node.namedChildCount
        for (let i = childCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) {
            walkStack.push(child)
          }
        }
      }
      return Math.min(complexity, 100)
    }
  }

  // Helper for tools to find symbols perfectly from the database
  export async function findSymbol(projectId: string, symbolName: string, filePath?: string, lineStart?: number) {
    const { BrainDatabase } = await import("../brain/database")
    const db = await BrainDatabase.getInstance(projectId as any)
    const { BrainSymbolTable, BrainFileTable } = await import("../brain/brain.sql")
    const { eq, and, like } = await import("drizzle-orm")

    const conditions = [eq(BrainSymbolTable.project_id, projectId as any), eq(BrainSymbolTable.name, symbolName)]

    if (filePath) {
      const fp = filePath.replace(/\\/g, "/")
      if (fp.includes("/")) {
        // Exact path match first (precise), then LIKE as fallback
        conditions.push(eq(BrainFileTable.path, fp))
      } else {
        conditions.push(like(BrainFileTable.path, `%/${fp}`))
      }
    }

    let results = await db
      .select({
        id: BrainSymbolTable.id,
        fileId: BrainFileTable.path,
        name: BrainSymbolTable.name,
        symbolType: BrainSymbolTable.symbol_type,
        lineStart: BrainSymbolTable.line_start,
        byteStart: BrainSymbolTable.byte_start,
        byteEnd: BrainSymbolTable.byte_end,
      })
      .from(BrainSymbolTable)
      .innerJoin(BrainFileTable, eq(BrainSymbolTable.file_id, BrainFileTable.id))
      .where(and(...conditions))
      .all()

    // If exact path match returned nothing but we have a full path, retry with LIKE
    if (results.length === 0 && filePath && filePath.includes("/")) {
      const fp = filePath.replace(/\\/g, "/")
      results = await db
        .select({
          id: BrainSymbolTable.id,
          fileId: BrainFileTable.path,
          name: BrainSymbolTable.name,
          symbolType: BrainSymbolTable.symbol_type,
          lineStart: BrainSymbolTable.line_start,
          byteStart: BrainSymbolTable.byte_start,
          byteEnd: BrainSymbolTable.byte_end,
        })
        .from(BrainSymbolTable)
        .innerJoin(BrainFileTable, eq(BrainSymbolTable.file_id, BrainFileTable.id))
        .where(and(
          eq(BrainSymbolTable.project_id, projectId as any),
          eq(BrainSymbolTable.name, symbolName),
          like(BrainFileTable.path, `%${fp}`),
        ))
        .all()
    }

    // Auto-fill missing byte offsets from file content
    for (const r of results) {
      if ((r.byteStart == null || r.byteEnd == null || r.byteEnd <= r.byteStart) && r.fileId && r.lineStart != null) {
        try {
          const fs = require("fs")
          // Decoded the same way the indexer decodes, or the offsets computed here
          // are offsets into a DIFFERENT string than the one that was parsed — a
          // UTF-16 file's offsets would be measured against NUL-interleaved text
          // while the tree was built from the transcoded text, and every symbol in
          // the file would be misplaced. See src/util/source-text.ts.
          const content = decodeSourceText(fs.readFileSync(r.fileId)).text
          const lines = content.split("\n")
          let offset = 0
          for (let i = 0; i < Math.min(r.lineStart, lines.length); i++) {
            offset += lines[i].length + 1 // +1 for newline
          }
          r.byteStart = offset
          // End offset: start of next line, or end of content
          const lineEnd = (r as any).lineEnd as number | null
          if (lineEnd != null && lineEnd >= r.lineStart!) {
            let endOffset = offset
            for (let i = r.lineStart!; i < Math.min(lineEnd + 1, lines.length); i++) {
              endOffset += lines[i].length + 1
            }
            r.byteEnd = endOffset
          } else {
            // Default to end of the start line
            r.byteEnd = offset + (lines[Math.min(r.lineStart, lines.length - 1)]?.length || 0)
          }
            } catch (e) {
      log.debug("resolveWasm: temp file fallback failed", { error: (e as Error)?.message })
    }
      }
    }
    let matches = results

    // Consistency with search: symbols in hard-noise files (JSON configs,
    // minified/d.ts/map assets) are excluded from every read surface.
    const { isHardNoisePath } = await import("./analysis-exclusions")
    matches = matches.filter((m: any) => !isHardNoisePath(m.fileId ?? ""))

    // If multiple matches at the exact same file, prefer class/interface over constructor/function
    if (matches.length > 1 && filePath) {
      const classSymbols = matches.filter(m => m.symbolType === "class" || m.symbolType === "interface")
      if (classSymbols.length === 1) {
        matches = classSymbols
      }
    }

    if (lineStart !== undefined) {
      matches = matches.filter((m) => m.lineStart === lineStart)
    }

    return { matches }
  }

  export function isLanguageSupported(language: string): boolean {
    return language in SUPPORTED_LANGUAGES
  }
}

export const parseFile = ASTEngine.parseFile
export const getParser = ASTEngine.getParser
