// AST Engine — Core intelligence for ANY programming language
// Parses source files using Tree-sitter WASM grammars
// Extracts symbols, relationships, imports, exports, taint flows
// Ported from backbencher's engine.ts with opencode deps removed

import { readFileSync } from "fs"
import { getParser as loadWasmParser, clearParserCache } from "./wasm.js"
import type { ParseResult, UniversalSymbol, LanguageAnalyzer } from "./types.js"
import { getAnalyzer } from "./analyzers/index.js"
import { createLogger } from "../util/log.js"

// Re-export types
export * from "./types.js"

const log = createLogger("ast-engine")

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

export function detectLanguage(filePath: string, _content?: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase()

  const extensionMap: Record<string, string> = {
    ts: "typescript", tsx: "tsx",
    js: "javascript", cjs: "javascript", mjs: "javascript", jsx: "javascript",
    html: "html", htm: "html",
    vue: "vue", svelte: "svelte",
    css: "css", scss: "css", sass: "css",
    json: "json", yml: "yaml", yaml: "yaml",
    graphql: "graphql", gql: "graphql",
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp",
    rs: "rust", go: "go", zig: "zig",
    java: "java", kt: "kotlin", kts: "kotlin",
    scala: "scala", sc: "scala",
    groovy: "groovy", gsp: "groovy",
    py: "python", pyw: "python",
    rb: "ruby", php: "php", lua: "lua",
    pl: "perl", pm: "perl", t: "perl",
    ex: "elixir", exs: "elixir",
    erl: "erlang", hrl: "erlang",
    hs: "haskell", lhs: "haskell",
    clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
    icl: "clean", dcl: "clean",
    swift: "swift", dart: "dart",
    cs: "csharp", csx: "csharp",
    fs: "fsharp", fsi: "fsharp", fsx: "fsharp",
    r: "r",
    sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash",
    ps1: "powershell", psm1: "powershell", psd1: "powershell",
    tf: "hcl", tfvars: "hcl", tofu: "hcl", hcl: "hcl",
    m: "objective-c", mm: "objective-c",
  }

  if (ext && ext in extensionMap) return extensionMap[ext]!
  if (filePath.endsWith(".R")) return "r"
  if (filePath.endsWith("source")) return "html"
  return null
}

// ============================================================================
// PARSER LOADING — Delegates to wasm module
// ============================================================================

export { getParser as loadParser } from "./wasm.js"

export async function getParser(language: string): Promise<any> {
  return loadWasmParser(language)
}

// ============================================================================
// PARSE FILE — Full analysis pipeline
// ============================================================================

export async function parseFile(filePath: string, content: string): Promise<ParseResult> {
  const language = detectLanguage(filePath)
  if (!language) {
    throw new Error(`Unsupported file type: ${filePath}`)
  }

  log.debug("parsing file", { filePath, language, size: content.length })

  // Get parser with 30s timeout
  let parser: any
  try {
    parser = await Promise.race([
      getParser(language),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Parser load timeout for ${language}`)), 30000)
      ),
    ])
  } catch (err) {
    log.warn("parser load failed", { language, error: String(err) })
    throw err
  }

  // Truncate very large files to prevent parser hangs
  if (content.length > 1024 * 1024) {
    log.warn("large file, truncating", { filePath, originalSize: content.length })
    content = content.substring(0, 1024 * 1024)
  }

  // C/C++ illusion fix — strip compiler extensions with spaces to preserve byte offsets
  if (language === "c" || language === "cpp") {
    content = content
      .replace(/__attribute__\s*\(\([\s\S]*?\)\)/g, (match) => " ".repeat(match.length))
      .replace(/__declspec\s*\([\s\S]*?\)/g, (match) => " ".repeat(match.length))
      .replace(/__restrict__/g, "            ")
      .replace(/__restrict/g, "          ")
      .replace(/__volatile__/g, "            ")
      .replace(/__inline__/g, "          ")
      .replace(/__forceinline/g, "             ")
      .replace(/__cdecl/g, "       ")
      .replace(/__stdcall/g, "         ")
      .replace(/__fastcall/g, "          ")
  }

  // SQL illusion fix — normalize MySQL-specific syntax
  if (language === "sql") {
    content = content
      .replace(/\/\*_\*\//g, "     ")
      .replace(/\/\*\$wgDBTableOptions\*\//g, "                   ")
      .replace(/\bAUTO_INCREMENT\b/gi, "              ")
      .replace(/\bUNSIGNED\b/gi, "        ")
      .replace(/\bBINARY\b/gi, "      ")
      .replace(/\bIF NOT EXISTS\b/gi, "             ")
      .replace(/\bON UPDATE CASCADE\b/gi, "                ")
      .replace(/\bENGINE=[a-zA-Z0-9_]+/gi, (match) => " ".repeat(match.length))
      .replace(/\bDEFAULT CHARSET=[a-zA-Z0-9_]+/gi, (match) => " ".repeat(match.length))
      .replace(/\(\s*\d+(?:\s*,\s*\d+)?\s*\)/g, (match) => " ".repeat(match.length))
      .replace(/\b(?:ENUM|SET)\b\s*\([^)]+\)/gi, (match) => " ".repeat(match.length))
      .replace(/\bTINYBLOB\b/gi, "BLOB    ")
      .replace(/\bMEDIUMBLOB\b/gi, "BLOB      ")
      .replace(/\bLONGBLOB\b/gi, "BLOB    ")
      .replace(/\bTINYTEXT\b/gi, "TEXT    ")
      .replace(/\bMEDIUMTEXT\b/gi, "TEXT      ")
      .replace(/\bLONGTEXT\b/gi, "TEXT    ")
      .replace(/\bTINYINT\b/gi, "INT    ")
      .replace(/\bMEDIUMINT\b/gi, "INT      ")
      .replace(/\bUNIQUE\s+(?:KEY|INDEX)\s+[a-zA-Z0-9_]+/gi, (match) => "UNIQUE" + " ".repeat(match.length - 6))
      .replace(/\bKEY\s+[a-zA-Z0-9_]+\s*\([^)]+\)/gi, (match) => " ".repeat(match.length))
  }

  // Parse with 60s timeout
  let tree: any
  try {
    tree = await Promise.race([
      parser.parse(content),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Parse timeout for ${filePath}`)), 60000)
      ),
    ])
  } catch (err) {
    log.warn("parse failed", { filePath, error: String(err) })
    return createErrorResult(language, content, `Parse failed: ${String(err)}`)
  }

  // Collect parse errors
  const parseErrors: ParseResult["errors"] = []
  if (tree.rootNode?.hasError) {
    const stack = [tree.rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "ERROR" || node.isMissing) {
        parseErrors.push({
          message: `Syntax error (${node.isMissing ? "missing" : "unexpected"} node)`,
          range: {
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column + 1,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column + 1,
          },
          severity: "warning",
        })
        if (parseErrors.length >= 50) break
      }
      if (node.children) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push(node.children[i])
        }
      }
    }
  }

  // Run language-specific analyzer
  let result: Omit<ParseResult, "language" | "metadata">
  try {
    const analyzer = await getAnalyzer(language)
    result = await Promise.race([
      analyzer.analyze(tree.rootNode, content, filePath),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Analyzer timeout for ${filePath}`)), 60000)
      ),
    ]) as any
  } catch (err) {
    log.warn("analyzer failed, using generic fallback", { language, error: String(err) })
    // Fallback to generic analyzer
    const { GenericAnalyzer } = await import("./analyzers/generic.js")
    const generic = new GenericAnalyzer()
    result = generic.analyze(tree.rootNode, content, filePath) as any
  }

  // Free WASM memory
  try { if (tree && typeof tree.delete === "function") tree.delete() } catch {}

  // Compute metadata
  const meta = (result as any).metadata || {}

  return {
    language,
    symbols: result.symbols || [],
    relationships: result.relationships || [],
    imports: result.imports || [],
    exports: result.exports || [],
    errors: [...(result.errors || []), ...parseErrors],
    rawContent: content,
    metadata: {
      complexity: meta.complexity || 0,
      linesOfCode: content.split("\n").length,
      cyclomaticComplexity: meta.cyclomaticComplexity,
      framework: meta.framework,
      architecture: meta.architecture,
      patterns: meta.patterns || [],
      detectedFrameworks: meta.detectedFrameworks || [],
      frameworkPatterns: meta.frameworkPatterns || [],
      architecturalInsights: meta.architecturalInsights || [],
      architecturalScore: meta.architecturalScore || 0,
      codeQuality: meta.codeQuality || "unknown",
      hasTypeInference: meta.hasTypeInference || false,
      hasFrameworkIntelligence: meta.hasFrameworkIntelligence || false,
      analysisVersion: "2.0-mcp-brain",
    },
  }
}

function createErrorResult(language: string, content: string, message: string): ParseResult {
  return {
    language,
    symbols: [],
    relationships: [],
    imports: [],
    exports: [],
    errors: [{
      message,
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      severity: "error",
    }],
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
      analysisVersion: "2.0-error-fallback",
    },
  }
}
