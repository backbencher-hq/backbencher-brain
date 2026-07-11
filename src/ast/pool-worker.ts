// @ts-nocheck — Pool worker port from backbencher.
// was bun shebang
import { createHash } from "node:crypto"
import path from "node:path"
import fs from "node:fs"

process.env.BB_LOG_LEVEL = "error"
const debug = false

function log(..._args: unknown[]) {}

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
    svelte: [
      /^\s*export\s+let\s+(\w+)/,
      /^\s*\$:.*?\s*=\s*(.+)/,
      /^\s*const\s+(\w+)\s*=\s*\$state/,
      /^\s*const\s+(\w+)\s*=\s*\$derived/,
      /^\s*\$effect\s*\(/,
      /^\s*\$props\s*\(/,
      /^\s*function\s+(\w+)/,
      /^\s*class\s+(\w+)/,
    ],
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
        if (["if", "for", "while", "switch", "catch", "return", "new", "this", "super"].includes(name)) continue

        let type = "function"
        if (/class\s/.test(line)) type = "class"
        else if (/interface\s/.test(line)) type = "interface"
        else if (/struct\s/.test(line)) type = "class"
        else if (/trait\s/.test(line) || /protocol\s/.test(line)) type = "interface"
        else if (/type\s/.test(line)) type = "type"
        else if (/const\s|let\s|var\s/.test(line)) type = "variable"
        else if (/module\s/.test(line) || /namespace\s/.test(line)) type = "module"
        else if (language === "svelte") {
          if (/export\s+let/.test(line)) type = "prop"
          else if (/^\$:\s/.test(line)) type = "reactive"
          else if (/\$state/.test(line)) type = "rune"
          else if (/\$derived/.test(line)) type = "rune"
          else if (/\$effect\(/.test(line)) type = "rune"
          else if (/\$props\(/.test(line)) type = "rune"
        }

        // Compute byte offsets for this line
        let byteOffset = 0
        for (let j = 0; j < i; j++) byteOffset += lines[j].length + 1 // +1 for newline
        const lineLen = lines[i].length

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

interface BasicRelationship {
  source: string
  target: string
  type: string
  confidence: number
  metadata?: Record<string, any>
}

function extractBasicRelationships(
  content: string,
  _language: string,
  symbols: BasicSymbol[],
  imports: BasicImport[] = [],
): BasicRelationship[] {
  const rels: BasicRelationship[] = []
  const knownNames = new Set(symbols.map((s) => s.name))
  // Also include imported names — they are cross-file call targets
  for (const imp of imports) {
    knownNames.add(imp.name)
  }

  // Build a set of known function/class names from symbols
  const knownFunctions = new Set(
    symbols.filter((s) => s.type === "function" || s.type === "method").map((s) => s.name),
  )

  // Line-by-line: find function/method calls
  const lines = content.split("\n")
  const callPattern = /(\w+)\s*\(/g
  const methodCallPattern = /(\w+)\.(\w+)\s*\(/g
  const newPattern = /new\s+(\w+)\s*[\(<]/g  // new ClassName( or new ClassName<

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Constructor calls: new ClassName(...) — Instantiates
    let nmatch: RegExpExecArray | null
    while ((nmatch = newPattern.exec(line)) !== null) {
      const className = nmatch[1]
      if (className.length < 2) continue
      if (className === className.toUpperCase()) continue // Skip ALL_CAPS
      if (knownNames.has(className)) {
        rels.push({
          source: "this",
          target: className,
          type: "instantiates",
          confidence: 0.6,
          metadata: { line: i + 1, method: "regex", isNew: true },
        })
      }
    }
    newPattern.lastIndex = 0

    // Method calls: obj.method(...)
    let match: RegExpExecArray | null
    while ((match = methodCallPattern.exec(line)) !== null) {
      const target = match[2] // method name
      if (knownFunctions.has(target) || knownNames.has(target)) {
        rels.push({
          source: match[1], // object name (approximate)
          target,
          type: "calls",
          confidence: 0.4, // Lower confidence: regex-based, may have false positives
          metadata: { line: i + 1, method: "regex" },
        })
      }
    }
    // Reset regex state
    methodCallPattern.lastIndex = 0

    // Direct function calls: funcName(...)
    while ((match = callPattern.exec(line)) !== null) {
      const target = match[1]
      // Skip keywords and common patterns
      if (
        ["if", "for", "while", "switch", "catch", "return", "new", "this", "super", "function",
          "class", "import", "export", "const", "let", "var", "typeof", "instanceof", "throw",
          "else", "case", "default", "break", "continue", "delete", "void"].includes(target)
      ) continue
      if (target.length < 2) continue
      if (target === target.toUpperCase() && target.length > 3) continue // Skip CONSTANT_CALLS
      if (target.startsWith("_") && target.length < 3) continue // Skip _x patterns

      if (knownFunctions.has(target) || knownNames.has(target)) {
        rels.push({
          source: "this",
          target,
          type: "calls",
          confidence: 0.5,
          metadata: { line: i + 1, method: "regex" },
        })
      }
    }
    callPattern.lastIndex = 0
  }

  // Deduplicate
  const seen = new Set<string>()
  return rels.filter((r) => {
    const key = `${r.source}:${r.target}:${r.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function extractFallback(
  content: string,
  language: string,
  hash: string,
  sizeBytes: number,
  lastModified: number,
) {
  const symbols = extractBasicSymbols(content, language)
  const imports = extractBasicImports(content, language)
  const relationships = filterNoiseRelationships(
    extractBasicRelationships(content, language, symbols, imports),
    language,
  )

  return {
    success: true,
    language,
    framework: null,
    fileHash: hash,
    sizeBytes,
    lastModified,
    symbols,
    imports,
    relationships,
    errors: [],
    fallback: true,
  }
}

const NOISE_TARGETS = new Set([
  // Tree-sitter AST internals
  "namedChild", "childForFieldName", "namedChildren", "childCount",
  "namedChildCount", "type", "text", "startIndex", "endIndex",
  "startPosition", "endPosition", "nextSibling", "previousSibling",
  "firstChild", "lastChild", "parent",

  // CSS properties that leak into relationships (hyphenated names)
  "font-size", "background-color", "align-items", "justify-content",
  "flex-direction", "border-radius", "font-weight", "line-height",
  "margin-bottom", "min-width",

  // Test-framework boilerplate (NOT valid production targets)
  "setUp", "tearDown", "setUpBeforeClass", "tearDownAfterClass",
  "beforeEach", "afterEach",
])

function filterNoiseRelationships(rels: any[], language: string): any[] {
  if (!rels || rels.length === 0) return rels

  const extractLeaf = (name: string): string => {
    const noLine = name.replace(/:\d+$/, "")
    const segments = noLine.split(":")
    const last = segments[segments.length - 1]
    const dotParts = last.split(".")
    return dotParts[dotParts.length - 1]
  }

  return rels.filter((r: any) => {
    const target = r.target || r.targetId || r.to || r.toSymbol || ""
    if (!target) return true

    // Block garbage targets: source code snippets, malformed names
    if (target.length > 200 || target.includes("\n")) return false

    const leaf = extractLeaf(target)
    const lower = leaf.toLowerCase()

    // Block targets that are clearly not valid symbol names
    if (leaf.length > 80 || leaf.length < 1) return false
    if (/[{}`$<>\n\r\t]/.test(leaf)) return false
    if (leaf.startsWith(" ") || leaf.includes("  ")) return false

    // CSS files: only keep "contains" relationships (no "calls" for properties)
    if (language === "css" || language === "scss" || language === "sass") {
      const rt = r.type || r.relationshipType || ""
      return rt === "contains"
    }

    // Block targets with hyphens (CSS properties: font-size, align-items, etc.)
    if (lower.includes("-")) return false

    // Block tree-sitter AST internals
    if (NOISE_TARGETS.has(leaf)) return false

    return true
  })
}

let engineModule: any = null

export async function parseFile(filePath: string, projectPath: string) {
  const stat = await import("fs/promises").then((fs) => fs.stat(filePath))
  const sizeBytes = stat.size
  const lastModified = stat.mtimeMs
  const ext = path.extname(filePath).toLowerCase()
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".css": "css",
    ".html": "html",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".php": "php",
    ".swift": "swift",
    ".dart": "dart",
    ".lua": "lua",
    ".r": "r",
    ".R": "r",
    ".sql": "sql",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".ps1": "powershell",
    ".perl": "perl",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hrl": "erlang",
    ".zig": "zig",
    ".nim": "nim",
    ".fsharp": "fsharp",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".vue": "vue",
    ".svelte": "svelte",
    ".scss": "css",
    ".sass": "css",
    ".less": "css",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".xml": "xml",
    ".md": "markdown",
    ".proto": "protobuf",
    ".m": "objective-c",
    ".mm": "objective-c",
  }
  const language = filePath.endsWith("source") ? "html" : langMap[ext] || "unknown"

  const STRUCTURAL_LIMIT = 5 * 1024 * 1024 // 5 MB
  if (sizeBytes > STRUCTURAL_LIMIT) {
    log(`Skipping file over 5MB: ${filePath} (${sizeBytes} bytes)`)
    return {
      success: true,
      language,
      fileHash: createHash("sha256").update("").digest("hex").slice(0, 16),
      sizeBytes,
      lastModified,
      symbols: [],
      imports: [],
      relationships: [],
      errors: [],
      fallback: true,
    }
  }

  // For files between 1MB and 5MB, use structural/fallback extraction
  const FULL_AST_LIMIT = 1 * 1024 * 1024 // 1 MB
  if (sizeBytes > FULL_AST_LIMIT) {
    const fsModule = await import("fs/promises")
    // Read first 256KB for structural extraction
    const fd = await fsModule.open(filePath, "r")
    const buffer = Buffer.alloc(Math.min(sizeBytes, 256 * 1024))
    await fd.read(buffer, 0, buffer.length, 0)
    await fd.close()
    const content = buffer.toString("utf-8")
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)
    log(`Using structural extraction for large file: ${filePath} (${sizeBytes} bytes)`)
    return extractFallback(content, language, hash, sizeBytes, lastModified)
  }

  const content = await import("fs/promises").then((fs) => fs.readFile(filePath, "utf-8"))
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)

  try {
    if (!engineModule) {
      engineModule = await import("./engine.js")
    }
    const parsed = await engineModule.ASTEngine.parseFile(filePath, content)

    // Log when engine returns 0 symbols (silent failure — no exception thrown)
    if ((parsed?.symbols?.length || 0) === 0 && (parsed?.errors?.length || 0) > 0) {
      try {
        const fs = require("fs")
        const errSample = parsed.errors.slice(0, 3).map((e: any) => e.message).join(" | ")
        fs.appendFileSync("/tmp/bb-parse-errors.log",
          `${new Date().toISOString()} | ${language} | ${sizeBytes}B | ${filePath} | ENGINE_EMPTY: ${errSample.substring(0, 200)}\n`)
      } catch {}
    }

    if (ext === ".dart") {
      fs.appendFileSync(
        "/tmp/bb-worker-debug.log",
        `[Worker] ASTEngine.parseFile returned ${parsed?.relationships?.length || 0} relationships for ${filePath}\n`,
      )
    }

    // Stage 5: Universal Multi-Language Taint Data-Flow Extraction
    try {
      const { TaintAnalyzer } = await import("./taint-analyzer")
      TaintAnalyzer.enrichSymbols(parsed.symbols, content, language)
    } catch (e) {
      log("Taint extraction failed:", e)
    }

    const ret = {
      success: true,
      language: parsed.language || language,
      framework: parsed.metadata?.framework,
      fileHash: hash,
      sizeBytes,
      lastModified,
      symbols: parsed.symbols
        .filter((s: any) => {
          const name = s.name || ""
          if (s.qualifiedName?.startsWith("__global__")) return false
          const DENYLIST = new Set([
            "window", "document", "console",
            "process", "global", "__dirname", "__filename",
            "this", "super", "self", "Self", "me", "My",
            "constructor", "destructor",
            "module", "exports", "default", "globalThis",
            "root", "program", "source_file", "module_declaration",
            "package_manifest", "GlobalScope", "SCSS_FILE_SCOPE",
            "unknown",
          ])
          if (DENYLIST.has(name)) return false
          return true
        })
        .map((s: any) => {
        let snippet = ""
        if (["function", "class", "method", "interface"].includes(s.kind)) {
          const lines = content.split("\n")
          snippet = lines.slice(Math.max(0, s.range.startLine - 1), s.range.endLine).join("\n")
          if (snippet.length > 10000) snippet = snippet.substring(0, 10000)
        }
        return {
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
          ownerName: s.ownerName || s.scope,
          ownerKind: s.ownerKind || s.metadata?.ownerKind,
          scope: s.scope,
          taintSources: s.taintSources,
          taintSinks: s.taintSinks,
          decorators: s.decorators,
          genericParameters: s.genericParameters,
          isStatic: s.isStatic,
          isAsync: s.isAsync,
          isAbstract: s.isAbstract,
          snippet,
        }
      }),
      imports: parsed.imports.map((i: any) => ({
        name: i.items?.[0] || i.module || "",
        path: i.module || i.path || "",
        type: i.isDefault ? "default" : i.isNamespace ? "namespace" : "named",
        isExternal: i.module ? !i.module.startsWith(".") : false,
        line: i.range?.startLine || 0,
      })),
      relationships: filterNoiseRelationships(parsed.relationships, language),
      errors: parsed.errors || [], // <-- Stage 4: propagate syntax errors from the AST Engine
    }

    if (ext === ".dart") {
      fs.appendFileSync(
        "/tmp/bb-worker-debug.log",
        `[Worker] Returning object with ${ret.relationships?.length || 0} relationships for ${filePath}\n`,
      )
    }

    return ret
  } catch (parseError: any) {
    const errMsg = parseError?.message || String(parseError)
    const isExpected =
      errMsg.includes("Unsupported file type") ||
      errMsg.includes("Failed to determine WASM path") ||
      errMsg.includes("not yet implemented")
    // Use a local var — `language` from outer scope may not be accessible in compiled mode
    const lang = filePath.endsWith("source") ? "html" : (langMap[ext] || "unknown")
    if (!isExpected) {
      process.stderr.write(`[BB-PARSE-ERR] ${lang} | ${filePath} | ${errMsg.substring(0, 300)}\n`)
    }
    if (isExpected) {
      return extractFallback(content, lang, hash, sizeBytes, lastModified)
    }
    return extractFallback(content, lang, hash, sizeBytes, lastModified)
  }
}

// IPC message handler
process.on("message", async (msg: any) => {
  if (msg.type === "warmup") {
    // Pre-load the WASM registry and engine before processing.
    // Registry loads core grammars only with 10s timeout per import.
    // WASM registry initialized by engine on first parse
    try {
      engineModule = await import("./engine.js")
    } catch {}
    process.send?.({ type: "ready", workerId: msg.workerId })
  } else if (msg.type === "parse_batch") {
    const { batchId, files, projectPath } = msg
    const FILE_TIMEOUT_MS = 45000 // 45s per-file self-timeout

    for (const filePath of files) {
      try {
        // Yield to event loop to ensure file_start is sent BEFORE sync tree-sitter block
        process.send?.({ type: "file_start", batchId, filePath })
        await new Promise((r) => setTimeout(r, 0))

        // Self-timeout: kill worker if file processing hangs (doesn't rely on parent process)
        const fileTimer = setTimeout(() => {
          log(`Worker self-timeout: killing process after ${FILE_TIMEOUT_MS}ms on ${filePath}`)
          process.exit(1)
        }, FILE_TIMEOUT_MS)

        const result = await parseFile(filePath, projectPath)
        clearTimeout(fileTimer)

        process.send?.({ type: "file_done", batchId, filePath, result })
      } catch (err) {
        process.send?.({
          type: "file_error",
          batchId,
          filePath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    process.send?.({ type: "batch_done", batchId })
  }
})

// Prevent exiting
process.on("disconnect", () => process.exit(0))
