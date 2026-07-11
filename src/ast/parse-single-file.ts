// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
// was bun shebang
// parse-single-file.ts - Subprocess script for isolated file parsing
// This runs in a separate process that can be KILLED if it hangs
// Prevents Tree-sitter WASM from blocking the entire system

import { createHash } from "crypto"
import path from "path"

// Suppress all logging in subprocess mode - we only output JSON to stdout
// This prevents Log.info() from corrupting our JSON output
process.env.BB_LOG_LEVEL = "error"

// Minimal logging for subprocess (goes to stderr)
const debug = process.env.BB_DEBUG === "1"

function log(..._args: unknown[]) {}

// ============================================================================
// FALLBACK BASIC EXTRACTION (when AST fails or times out)
// ============================================================================

interface BasicSymbol {
  name: string
  type: string
  startLine: number
  endLine: number
  visibility?: string
  parameters?: any[]
  returnType?: string
  qualifiedCalls?: string[]
}

interface BasicImport {
  name: string
  path: string
  type: string
  isExternal: boolean
  line: number
}

function extractBasicSymbols(content: string, language: string): BasicSymbol[] {
  const symbols: BasicSymbol[] = []
  const lines = content.split("\n")

  // Language-specific regex patterns for basic extraction
  const patterns: Record<string, RegExp[]> = {
    typescript: [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /^(?:export\s+)?class\s+(\w+)/,
      /^(?:export\s+)?interface\s+(\w+)/,
      /^(?:export\s+)?type\s+(\w+)/,
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)/,
      /^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/,
    ],
    javascript: [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /^(?:export\s+)?class\s+(\w+)/,
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)/,
    ],
    python: [/^(?:async\s+)?def\s+(\w+)/, /^class\s+(\w+)/],
    go: [/^func\s+(?:\([^)]+\)\s+)?(\w+)/, /^type\s+(\w+)\s+struct/, /^type\s+(\w+)\s+interface/],
    rust: [
      /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
      /^(?:pub\s+)?struct\s+(\w+)/,
      /^(?:pub\s+)?trait\s+(\w+)/,
      /^(?:pub\s+)?impl(?:\s+\w+)?\s+(?:for\s+)?(\w+)/,
    ],
    java: [
      /^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?class\s+(\w+)/,
      /^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?interface\s+(\w+)/,
      /^(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/,
    ],
    kotlin: [
      /^(?:fun|suspend\s+fun)\s+(\w+)/,
      /^(?:class|data\s+class|sealed\s+class|object)\s+(\w+)/,
      /^interface\s+(\w+)/,
    ],
    swift: [/^(?:func|class\s+func|static\s+func)\s+(\w+)/, /^(?:class|struct|protocol|enum)\s+(\w+)/],
    ruby: [/^def\s+(\w+)/, /^class\s+(\w+)/, /^module\s+(\w+)/],
    php: [
      /^(?:public|private|protected)?\s*function\s+(\w+)/,
      /^class\s+(\w+)/,
      /^interface\s+(\w+)/,
      /^trait\s+(\w+)/,
    ],
    csharp: [
      /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:\w+\s+)+(\w+)\s*\(/,
      /^(?:public|private|protected|internal)?\s*(?:partial\s+)?class\s+(\w+)/,
      /^(?:public|private|protected|internal)?\s*interface\s+(\w+)/,
    ],
  }

  const langPatterns = patterns[language] || patterns.javascript || []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    for (const pattern of langPatterns) {
      const match = line.match(pattern)
      if (match && match[1]) {
        const name = match[1]
        // Skip common false positives
        if (["if", "for", "while", "switch", "catch", "return", "new", "this", "super"].includes(name)) continue

        let type = "function"
        if (/class\s/.test(line)) type = "class"
        else if (/interface\s/.test(line)) type = "interface"
        else if (/struct\s/.test(line)) type = "class"
        else if (/trait\s/.test(line) || /protocol\s/.test(line)) type = "interface"
        else if (/type\s/.test(line)) type = "type"
        else if (/const\s|let\s|var\s/.test(line)) type = "variable"
        else if (/module\s/.test(line) || /namespace\s/.test(line)) type = "module"

        symbols.push({
          name,
          type,
          startLine: i + 1,
          endLine: i + 1,
        })
        break
      }
    }
  }

  return symbols
}

function extractBasicImports(content: string, language: string): BasicImport[] {
  const imports: BasicImport[] = []
  const lines = content.split("\n")

  const patterns: Record<string, RegExp[]> = {
    typescript: [
      /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
      /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
    ],
    javascript: [/import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/],
    python: [/^from\s+([\w.]+)\s+import\s+(.+)$/, /^import\s+([\w.]+)/],
    go: [/import\s+(?:"([^"]+)"|(\w+)\s+"([^"]+)")/],
    rust: [/use\s+([\w:]+)(?:::\{([^}]+)\})?/],
    java: [/import\s+(?:static\s+)?([\w.]+)/],
  }

  const langPatterns = patterns[language] || patterns.javascript || []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    for (const pattern of langPatterns) {
      const match = line.match(pattern)
      if (match) {
        const path = match[3] || match[2] || match[1] || ""
        const names = match[1] || match[2] || ""

        const isExternal = !path.startsWith(".") && !path.startsWith("/")

        // Split named imports
        const items = names
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
        if (items.length === 0) items.push(path.split("/").pop() || path)

        for (const name of items) {
          imports.push({
            name: name.replace(/\s+as\s+\w+/, "").trim(),
            path,
            type: "named",
            isExternal,
            line: i + 1,
          })
        }
        break
      }
    }
  }

  return imports
}

// ============================================================================
// MAIN PARSING LOGIC
// ============================================================================

async function parseFile(filePath: string, projectPath: string) {
  const startTime = Date.now()

  try {
    // Read file content
    const file = Bun.file(filePath)
    const content = await file.text()
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)

    // Detect language from file extension
    const ext = path.extname(filePath).toLowerCase()
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "tsx",
      ".js": "javascript",
      ".jsx": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
      ".kt": "kotlin",
      ".kts": "kotlin",
      ".swift": "swift",
      ".rb": "ruby",
      ".php": "php",
      ".cs": "csharp",
      ".c": "c",
      ".cpp": "cpp",
      ".cc": "cpp",
      ".h": "c",
      ".hpp": "cpp",
      ".scala": "scala",
      ".dart": "dart",
      ".erl": "erlang",
      ".hrl": "erlang",
      ".ex": "elixir",
      ".exs": "elixir",
      ".lua": "lua",
      ".hs": "haskell",
      ".clj": "clojure",
      ".cljs": "clojure",
      ".r": "r",
      ".R": "r",
      ".sql": "sql",
      ".html": "html",
      ".css": "css",
      ".scss": "css",
      ".sass": "css",
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".sh": "bash",
      ".bash": "bash",
      ".icl": "clean",
      ".dcl": "clean",
    }

    const language = langMap[ext] || "unknown"

    // Try full AST parsing first
    let result: any
    let usedFallback = false

    try {
      // Import and use the AST engine
      const { ASTEngine } = await import("./engine.js")
      const parsed = await ASTEngine.parseFile(filePath, content)

      result = {
        success: true,
        language: parsed.language || language,
        framework: parsed.metadata?.framework,
        fileHash: hash,
        symbols: parsed.symbols.map((s) => ({
          name: s.name,
          type: s.kind,
          kind: s.kind,
          qualifiedName: s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : s.name),
          startLine: s.range.startLine,
          endLine: s.range.endLine,
          startIndex: s.range.startIndex,
          endIndex: s.range.endIndex,
          visibility: s.visibility || "public",
          parameters: s.parameters,
          returnType: s.returnType,
          qualifiedCalls: s.qualified_calls,
          complexity: s.complexity || s.metadata?.complexity || 1,
          ownerName: s.ownerName,
          ownerKind: s.ownerKind,
          snippet: s.snippet,
        })),
        imports: parsed.imports.map((i) => ({
          name: i.items?.[0] || i.module || "",
          path: i.module || i.path || "",
          type: i.isDefault ? "default" : i.isNamespace ? "namespace" : "named",
          isExternal: i.module ? !i.module.startsWith(".") : false,
          line: i.range?.startLine || 0,
        })),
        relationships: parsed.relationships,
      }
    } catch (parseError) {
      // AST parsing failed, use fallback basic extraction
      log("AST parsing failed, using fallback:", parseError)
      usedFallback = true

      const symbols = extractBasicSymbols(content, language)
      const imports = extractBasicImports(content, language)

      result = {
        success: true,
        language,
        framework: null,
        fileHash: hash,
        symbols,
        imports,
        relationships: [],
        fallback: true,
      }
    }

    log(`Parsed ${filePath} in ${Date.now() - startTime}ms (fallback: ${usedFallback})`)

    // Output result as JSON to stdout
    console.log(JSON.stringify(result))
  } catch (error) {
    // Fatal error - output error JSON
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`Failed to parse ${filePath}: ${errorMsg}`)
    process.exit(1)
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

const args = process.argv.slice(2)

if (args.length < 2) {
  console.error("Usage: bun parse-single-file.ts <file-path> <project-path>")
  process.exit(1)
}

const [filePath, projectPath] = args

// Run with a safety timeout (process will be killed by parent anyway)
const timeout = setTimeout(() => {
  console.error("Internal timeout reached")
  process.exit(124) // Standard timeout exit code
}, 30000) // 30 second internal safety

parseFile(filePath, projectPath)
  .then(() => {
    clearTimeout(timeout)
    process.exit(0)
  })
  .catch((error) => {
    clearTimeout(timeout)
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
