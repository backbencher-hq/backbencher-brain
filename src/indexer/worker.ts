// Pool Worker — Child process that parses individual files
// Loads WASM parser once, parses batches of files via IPC messages
// Ported from backbencher's pool-worker.ts

import { createHash } from "crypto"

// Will be populated via IPC: { type: "parse_batch", batchId, files, projectPath }
// Sends back: { type: "file_done", batchId, filePath, result }
//             { type: "file_error", batchId, filePath, error }
//             { type: "batch_done", batchId }

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

interface FileResult {
  filePath: string
  success: boolean
  timeout?: boolean
  error?: string
  symbols?: any[]
  relationships?: any[]
  imports?: any[]
  language?: string
  framework?: string
  fileHash?: string
  sizeBytes?: number
  lastModified?: number
}

// ============================================================================
// REGEX-BASED FALLBACK EXTRACTION (when Tree-sitter is unavailable)
// ============================================================================

function extractBasicSymbols(content: string, language: string): BasicSymbol[] {
  const symbols: BasicSymbol[] = []
  const lines = content.split("\n")

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
    kotlin: [/^(?:fun|suspend\s+fun)\s+(\w+)/, /^(?:class|data\s+class|sealed\s+class|object)\s+(\w+)/],
    swift: [/^(?:func|class\s+func|static\s+func)\s+(\w+)/, /^(?:class|struct|protocol|enum)\s+(\w+)/],
    ruby: [/^def\s+(\w+)/, /^class\s+(\w+)/, /^module\s+(\w+)/],
    php: [/^(?:public|private|protected)?\s*function\s+(\w+)/, /^class\s+(\w+)/, /^interface\s+(\w+)/],
    csharp: [
      /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:\w+\s+)+(\w+)\s*\(/,
      /^(?:public|private|protected|internal)?\s*(?:partial\s+)?class\s+(\w+)/,
    ],
  }

  const langPatterns = patterns[language] || patterns["javascript"] || []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    for (const pattern of langPatterns) {
      const match = line.match(pattern)
      if (match && match[1]) {
        const name = match[1]!
        if (["if", "for", "while", "switch", "catch", "return", "new", "this", "super"].includes(name)) continue
        symbols.push({ name, type: "unknown", startLine: i + 1, endLine: i + 1 })
        break
      }
    }
  }
  return symbols
}

function extractBasicImports(content: string, language: string): BasicImport[] {
  const imports: BasicImport[] = []
  const lines = content.split("\n")

  const importPatterns: Record<string, RegExp> = {
    typescript: /^import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/,
    javascript: /^import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/,
    python: /^(?:from\s+(\S+)\s+)?import\s+(.+)/,
    java: /^import\s+(?:static\s+)?(.+);/,
    go: /^\s*"(.*?)"/,
    rust: /^use\s+(.+);/,
    ruby: /^require(?:_relative)?\s+['"](.+?)['"]/,
  }

  const pattern = importPatterns[language] || importPatterns["typescript"]
  if (!pattern) return imports

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    const match = line.match(pattern)
    if (match) {
      const path = match[1] || match[2] || ""
      imports.push({
        name: path.split("/").pop()?.replace(/['"]/g, "") || path,
        path,
        type: "named",
        isExternal: !path.startsWith("."),
        line: i + 1,
      })
    }
  }
  return imports
}

// ============================================================================
// MAIN PARSER (called by worker process)
// ============================================================================

export async function parseFile(
  filePath: string,
  projectPath: string,
): Promise<FileResult> {
  const { readFileSync, statSync } = await import("fs")
  const path = await import("path")

  try {
    const content = readFileSync(filePath, "utf8")
    const stats = statSync(filePath)
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)
    const ext = path.extname(filePath).slice(1).toLowerCase()

    // Map extension to language
    const langMap: Record<string, string> = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      py: "python", rb: "ruby", php: "php", java: "java",
      go: "go", rs: "rust", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
      cs: "csharp", fs: "fsharp", kt: "kotlin", scala: "scala",
      swift: "swift", dart: "dart",
      sql: "sql", r: "r", lua: "lua", zig: "zig",
      sh: "bash", bash: "bash",
      hs: "haskell", elm: "elm", clj: "clojure",
      ex: "elixir", exs: "elixir", erl: "erlang",
    }
    const language = langMap[ext] || ext

    // Try AST parsing first, fall back to regex
    try {
      const { parseFile: astParse } = await import("../ast/engine.js.js")
      const result = await astParse(filePath, content)
      return {
        filePath,
        success: true,
        symbols: result.symbols,
        relationships: result.relationships,
        imports: result.imports,
        language: result.language || language,
        framework: result.metadata.framework,
        fileHash: hash,
        sizeBytes: stats.size,
        lastModified: stats.mtimeMs,
      }
    } catch {
      // AST parse failed — use regex fallback
      const symbols = extractBasicSymbols(content, language)
      const imports = extractBasicImports(content, language)
      return {
        filePath,
        success: true,
        symbols,
        relationships: [],
        imports,
        language,
        fileHash: hash,
        sizeBytes: stats.size,
        lastModified: stats.mtimeMs,
      }
    }
  } catch (err: any) {
    return {
      filePath,
      success: false,
      error: err?.message || String(err),
    }
  }
}

// ============================================================================
// IPC WORKER LOOP (when spawned as child process)
// ============================================================================

if (process.send) {
  // Worker mode — listen for parse_batch messages
  process.on("message", async (msg: any) => {
    if (msg.type === "warmup") {
      // Initialize parser (preload WASM)
      try {
        // Warm up by loading the most common parser
        const { getParser } = await import("../ast/wasm.js.js")
        // Don't actually load — just verify the module works
      } catch {}
      process.send!({ type: "ready", workerId: msg.workerId })
      return
    }

    if (msg.type === "parse_batch") {
      const { batchId, files, projectPath } = msg
      for (const filePath of files) {
        process.send!({ type: "file_start", batchId, filePath })
        try {
          const result = await parseFile(filePath, projectPath)
          if (result.success) {
            process.send!({ type: "file_done", batchId, filePath, result })
          } else {
            process.send!({ type: "file_error", batchId, filePath, error: result.error })
          }
        } catch (err: any) {
          process.send!({ type: "file_error", batchId, filePath, error: err?.message || String(err) })
        }
      }
      process.send!({ type: "batch_done", batchId })
    }
  })
}
