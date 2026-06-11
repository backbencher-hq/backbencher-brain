// WASM Loading Infrastructure — Tree-sitter parser management
// Three-tier loading: bundled wasm/ → node_modules → download (future)
// LRU cache with memory-conscious eviction

import { existsSync, readFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"

// Dynamic import — web-tree-sitter is the only WASM dependency
let wtsModule: any = null

async function getWts(): Promise<{ Parser: any; Language: any }> {
  if (!wtsModule) {
    wtsModule = await import("web-tree-sitter")
    // web-tree-sitter 0.24.x: init() registers Language on the module
    // The module itself is the Parser constructor
    await wtsModule.default.init()
  }
  // After init, wts.Language is available; wts itself is Parser
  const mod: any = wtsModule
  return {
    Parser: mod.Parser ?? mod.default ?? mod,
    Language: mod.Language ?? mod.default?.Language,
  }
}

// ============================================================================
// PARSER CACHE
// ============================================================================

const MAX_CACHED_PARSERS = 8

interface CachedParser {
  parser: any
  language: any
  lastUsed: number
}

const parserCache = new Map<string, CachedParser>()

function evictLRU(): void {
  let oldestLang: string | null = null
  let oldestTime = Infinity

  for (const [lang, cached] of parserCache) {
    if (cached.lastUsed < oldestTime) {
      oldestTime = cached.lastUsed
      oldestLang = lang
    }
  }

  if (oldestLang) {
    const cached = parserCache.get(oldestLang)!
    try { cached.parser.delete() } catch {}
    parserCache.delete(oldestLang)
  }
}

// ============================================================================
// WASM RESOLUTION — Three tiers
// ============================================================================

function getWasmDir(): string {
  // In development: wasm/ directory at project root
  const devPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "wasm")
  if (existsSync(devPath)) return devPath

  // In production (npm global install): wasm/ alongside dist/
  try {
    const { resolve } = require("path") as typeof import("path")
    const prodPath = resolve(__dirname, "..", "wasm")
    if (existsSync(prodPath)) return prodPath
  } catch {}

  return join(homedir(), ".bb", "wasm")
}

// npm package name → wasm filename mapping
const WASM_PACKAGES: Record<string, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  java: "tree-sitter-java/tree-sitter-java.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
  c: "tree-sitter-c/tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp/tree-sitter-cpp.wasm",
  ruby: "tree-sitter-ruby/tree-sitter-ruby.wasm",
  php: "tree-sitter-php/tree-sitter-php.wasm",
  csharp: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
  css: "tree-sitter-css/tree-sitter-css.wasm",
  html: "tree-sitter-html/tree-sitter-html.wasm",
  json: "tree-sitter-json/tree-sitter-json.wasm",
  yaml: "tree-sitter-yaml/tree-sitter-yaml.wasm",
  bash: "tree-sitter-bash/tree-sitter-bash.wasm",
  dart: "tree-sitter-dart/tree-sitter-dart.wasm",
  elixir: "tree-sitter-elixir/tree-sitter-elixir.wasm",
  haskell: "tree-sitter-haskell/tree-sitter-haskell.wasm",
  scala: "tree-sitter-scala/tree-sitter-scala.wasm",
  svelte: "tree-sitter-svelte/tree-sitter-svelte.wasm",
  vue: "tree-sitter-vue/tree-sitter-vue.wasm",
  graphql: "tree-sitter-graphql/tree-sitter-graphql.wasm",
  sql: "tree-sitter-sql/tree-sitter-sql.wasm",
  kotlin: "tree-sitter-kotlin/tree-sitter-kotlin.wasm",
  swift: "tree-sitter-swift/tree-sitter-swift.wasm",
  lua: "tree-sitter-lua/tree-sitter-lua.wasm",
  erlang: "tree-sitter-erlang/tree-sitter-erlang.wasm",
  clojure: "tree-sitter-clojure/tree-sitter-clojure.wasm",
  groovy: "tree-sitter-groovy/tree-sitter-groovy.wasm",
  hcl: "tree-sitter-hcl/tree-sitter-hcl.wasm",
  perl: "tree-sitter-perl/tree-sitter-perl.wasm",
  powershell: "tree-sitter-powershell/tree-sitter-powershell.wasm",
  r: "tree-sitter-r/tree-sitter-r.wasm",
  zig: "tree-sitter-zig/tree-sitter-zig.wasm",
  fsharp: "tree-sitter-fsharp/tree-sitter-fsharp.wasm",
  "objective-c": "tree-sitter-objc/tree-sitter-objc.wasm",
  clean: "tree-sitter-clean/tree-sitter-clean.wasm",
}

/**
 * Load WASM bytes for a language.
 * Tries: bundled wasm/ dir → node_modules → error
 */
async function loadWasmBytes(language: string): Promise<Uint8Array> {
  // Tier 1: Bundled WASM (ships with npm package)
  const bundledName = `${language}.wasm`
  const bundledPath = join(getWasmDir(), bundledName)
  if (existsSync(bundledPath)) {
    return new Uint8Array(readFileSync(bundledPath))
  }

  // Tier 2: node_modules (for development or extra languages)
  const npmPath = WASM_PACKAGES[language]
  if (npmPath) {
    try {
      const resolved = require.resolve(npmPath)
      return new Uint8Array(readFileSync(resolved))
    } catch {
      // Will try tier 3
    }
  }

  // Tier 3: Not available
  throw new Error(
    `WASM not found for language: ${language}. ` +
    `Bundled path: ${bundledPath} (exists: ${existsSync(bundledPath)}). ` +
    `Run 'npm install tree-sitter-${language.replace(/-/g, "")}' or download the WASM file to ${getWasmDir()}/.`
  )
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get a Tree-sitter parser for a language.
 * Caches parsers with LRU eviction to manage WASM memory (~10-50MB each).
 */
export async function getParser(language: string): Promise<any> {
  // Check cache
  const cached = parserCache.get(language)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.parser
  }

  // Evict if cache is full
  if (parserCache.size >= MAX_CACHED_PARSERS) {
    evictLRU()
  }

  // Load WASM
  const wasmBytes = await loadWasmBytes(language)
  const { Parser, Language } = await getWts()

  // Load grammar (3 second timeout)
  const grammar = await Promise.race([
    Language.load(wasmBytes),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Language.load timeout for ${language}`)), 3000)
    ),
  ])

  // Create parser
  const parser = new Parser()
  parser.setLanguage(grammar)

  // Cache
  parserCache.set(language, { parser, language: grammar, lastUsed: Date.now() })

  return parser
}

/**
 * Get cache statistics for health monitoring.
 */
export function getParserCacheStats(): {
  size: number
  maxSize: number
  languages: string[]
} {
  return {
    size: parserCache.size,
    maxSize: MAX_CACHED_PARSERS,
    languages: Array.from(parserCache.keys()),
  }
}

/**
 * Clear the parser cache and free WASM memory.
 */
export function clearParserCache(): void {
  for (const [, cached] of parserCache) {
    try { cached.parser.delete() } catch {}
  }
  parserCache.clear()
}

/**
 * Check if a WASM grammar is available for a language.
 */
export function isLanguageSupported(language: string): boolean {
  // Check bundled
  const bundledPath = join(getWasmDir(), `${language}.wasm`)
  if (existsSync(bundledPath)) return true

  // Check node_modules
  if (language in WASM_PACKAGES) {
    try {
      require.resolve(WASM_PACKAGES[language]!)
      return true
    } catch {
      // Not available
    }
  }

  return false
}

/**
 * List all languages that have WASM grammars available.
 */
export function listAvailableLanguages(): string[] {
  const available: string[] = []
  const wasmDir = getWasmDir()

  for (const lang of Object.keys(WASM_PACKAGES)) {
    if (existsSync(join(wasmDir, `${lang}.wasm`))) {
      available.push(lang)
    } else if (lang in WASM_PACKAGES) {
      try {
        require.resolve(WASM_PACKAGES[lang]!)
        available.push(lang)
      } catch {}
    }
  }

  return available.sort()
}
