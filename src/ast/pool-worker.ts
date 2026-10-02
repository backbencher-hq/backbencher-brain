#!/usr/bin/env bun
import { createHash } from "crypto"
import { decodeSourceText } from "../util/source-text"
import { createRequire } from "node:module"
import path from "path"
import fs from "fs"
import type { ASTEngine } from "./engine"
import { detectLanguageFromPath } from "./language-detection"

const require = createRequire(import.meta.url)

// M22.W1: respect an explicit log level handed down by the parent process
// (--verbose/--quiet); only default to "error" when the parent did not set one.
if (!process.env.BB_LOG_LEVEL) {
  process.env.BB_LOG_LEVEL = "error"
}

// M22.W1: discoverable diagnostics location. Parse-error/symbol-loss evidence
// used to be silently appended to /tmp/bb-parse-errors.log (undocumented,
// machine-specific, never surfaced). It now lives under the bb data dir
// (~/.bb/logs/ or $BB_DATA_DIR/logs/) so users can actually find it.
function bbDiagnosticsLogPath(name: string): string {
  const dataDir = process.env.BB_DATA_DIR || path.join((process.env.HOME || process.env.USERPROFILE || "/tmp"), ".bb")
  const logsDir = path.join(dataDir, "logs")
  try { fs.mkdirSync(logsDir, { recursive: true }) } catch {}
  return path.join(logsDir, name)
}

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
    new Set(symbols.map((s: any) => String(s?.name ?? "")).filter(Boolean)),
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

/**
 * @param declaredNames names of symbols THIS FILE declares. A name the file
 *   declares cannot be a web-tree-sitter API leak, so the NOISE_TARGETS check is
 *   skipped for it. See the note at the check itself.
 */
/**
 * M60: exported so the output-coverage audit can ask THIS function whether a
 * SYMBOL loss is real, for the same reason `filterNoiseRelationships` is exported
 * beside it. The symbol filter used to be an inline `.filter()` callback, so an
 * audit could only re-state the rule and hope it still matched; the lane reported
 * 68 unexplained-looking drops and no attribution. One implementation, called from
 * both places.
 *
 * `lang` is passed in rather than read from a closure so the decision is a pure
 * function of (symbol, language) and can be exercised directly.
 */
export function keepSymbol(s: any, lang: string): boolean {
  const name = s.name || ""
  if (s.qualifiedName?.startsWith("__global__")) return false
  // The denylist targets JS/TS global-object noise (window, process, module,
  // exports, ...). XML/Make/Markdown use names like "module" and "export" as
  // legitimate declaration identifiers, so the filter must not apply there — their
  // dedicated analyzers already exclude real noise (xmlns, CharData, ...).
  if (lang === "json" || lang === "yaml" || lang === "xml" || lang === "make" || lang === "markdown") return true
  // JS-global names are only noise for JS-family languages. A method named
  // `process` (Scala/Python/Java), `window` or `module` is a legitimate
  // declaration elsewhere — applying the JS global list cross-language silently
  // dropped real symbols.
  const JS_FAMILY = new Set(["javascript", "typescript", "tsx", "vue", "svelte"])
  const JS_GLOBALS = new Set([
    "window", "document", "console", "process", "global",
    "__dirname", "__filename", "module", "exports", "default", "globalThis",
  ])
  if (JS_FAMILY.has(lang) && JS_GLOBALS.has(name)) return false
  // Universal denylist: language keywords / conventions and synthetic tree-sitter
  // artifact names — never legitimate declarations in any language.
  // "constructor" is a first-class declaration in TS/JS, so it is NOT here.
  const UNIVERSAL = new Set([
    "this", "super", "self", "Self", "me", "My",
    "destructor",
    "root", "program", "source_file", "module_declaration",
    "package_manifest", "GlobalScope", "SCSS_FILE_SCOPE",
    "unknown",
  ])
  if (UNIVERSAL.has(name)) return false
  return true
}

/** Why `keepSymbol` rejected a symbol, for the audit's report. Never decides anything. */
export function nameTheSymbolRule(s: any, lang: string): string {
  const name = s.name || ""
  if (s.qualifiedName?.startsWith("__global__")) return "qualifiedName is the __global__ sentinel"
  if (["json", "yaml", "xml", "make", "markdown"].includes(lang)) return "language-exempt (kept)"
  if (new Set(["javascript", "typescript", "tsx", "vue", "svelte"]).has(lang) && new Set([
    "window", "document", "console", "process", "global",
    "__dirname", "__filename", "module", "exports", "default", "globalThis",
  ]).has(name)) return "JS-family global name"
  return "UNIVERSAL denylist (a keyword or a synthetic tree-sitter artifact name)"
}

/**
 * M60: exported so the output-coverage audit can ask THIS function whether a
 * relationship loss is real, instead of keeping a copy of these rules.
 *
 * That distinction is the whole point. An audit that re-implements the filter
 * agrees with the filter only for as long as the copy stays in step, and a copy
 * that has drifted reports confident, wrong reasons for missing edges — which is
 * the failure this repo already paid for once, in the classifier that "excused
 * edges by inferring" and let a collapsed analyzer pass clean. Calling the
 * production function means the audit cannot disagree with it by construction.
 *
 * Behaviour is unchanged; this only makes an existing pure function reachable.
 */
/**
 * M60 LUA-16: which languages each family of `NOISE_TARGETS` names is actually
 * noise for. A name absent from this table is universal noise and keeps the old
 * behaviour.
 *
 * Two groups are language-owned and are now scoped:
 *
 *   - the tree-sitter API names (`type`, `parent`, `text`, `childForFieldName`, …)
 *     are a web-tree-sitter LEAK: JS/TS analyzers that walk a tree by property
 *     read as if the file called them. `type` and `parent` are ordinary
 *     identifiers in most languages, and a Lua `type(x)` is a stdlib query that
 *     no JS-style leak can explain.
 *   - the CSS property names are CSS/derived-syntax values, which only appear as
 *     relationship targets in a stylesheet.
 *
 * The JS list is the same five values the SYMBOL filter beside this uses, and
 * deliberately no wider: `.jsx` is routed to `js` by language-detection, so
 * "jsx" is not a language value in this codebase and listing it would be a
 * name that can never match — the claim-without-coverage shape, in a table whose
 * whole job is to say which languages own which noise.
 *
 * The test-lifecycle hooks are deliberately NOT listed: they stay universal,
 * because a `beforeEach` is framework noise in whatever language it is written
 * in, and deciding which languages have such frameworks is not this function's
 * call.
 */
const JS_FAMILY_LANGUAGES = new Set(["javascript", "typescript", "tsx", "vue", "svelte"])
const CSS_FAMILY_LANGUAGES = new Set(["css", "scss", "less"])
const NOISE_TARGET_FAMILIES: Record<string, Set<string>> = {}
for (const n of [
  "namedChild", "childForFieldName", "namedChildren", "childCount", "namedChildCount",
  "type", "text", "startIndex", "endIndex", "startPosition", "endPosition",
  "nextSibling", "previousSibling", "firstChild", "lastChild", "parent",
]) {
  NOISE_TARGET_FAMILIES[n] = JS_FAMILY_LANGUAGES
}
for (const n of [
  "font-size", "background-color", "align-items", "justify-content", "flex-direction",
  "border-radius", "font-weight", "line-height", "margin-bottom", "min-width",
]) {
  NOISE_TARGET_FAMILIES[n] = CSS_FAMILY_LANGUAGES
}

export function filterNoiseRelationships(rels: any[], language: string, declaredNames?: Set<string>): any[] {
  if (!rels || rels.length === 0) return rels

  // M60 (objc lane, 2026-09-25): the leaf must be the last NON-EMPTY segment.
  // An Objective-C selector ENDS in ':' by definition (`saveUser:`, `addObject:`,
  // `errorWithDomain:code:userInfo:`) — that colon is the method's arity, not
  // punctuation — so `split(":")` on a selector produced a trailing empty
  // segment, `leaf.length < 1` fired, and the filter DROPPED every message-send
  // target. Measured on the M12 objc differential: 12 of its 30 false negatives
  // were rows the analyzer had emitted and this filter had eaten — every
  // parameterized `contains` (`UserService -> initWithName:`) and every `calls`
  // to a keyword selector (`saveUser -> addObject:`). The noise-blocking intent
  // is unchanged: a target of `:` or `` still has no non-empty segment and is
  // still dropped, and `file.h:12`/`std::vector` resolve exactly as before.
  const extractLeaf = (name: string): string => {
    const noLine = name.replace(/:\d+$/, "")
    const segments = noLine.split(":").filter((s) => s.length > 0)
    const last = segments[segments.length - 1] ?? ""
    const dotParts = last.split(".")
    return dotParts[dotParts.length - 1]
  }

  return rels.filter((r: any) => {
    const target = r.target || r.targetId || r.to || r.toSymbol || ""
    if (!target) return true

    // JSON/YAML/HCL/GraphQL relationships are structural data paths, not
    // source-code identifiers. Keys such as `<<`, `<tag>`, `type` (HCL
    // `variable` type constraint), or a GraphQL field named `type`/`text` are
    // valid data and must bypass the universal identifier sanitizer.
    if (language === "json" || language === "yaml" || language === "hcl" || language === "terraform" || language === "graphql") return true

    // M14 #277 (bash): a `source`/`.` target is a FILESYSTEM PATH, which is the
    // same category as the data paths above and not a code identifier — so the
    // universal identifier sanitizer does not apply to it. It applied, and the
    // cost was silent and total: the brace ban below matched the `{}` of
    // `${rootfsDir}/etc/os-release`, so EVERY dynamic source path was deleted on
    // the way to the index. Measured on the pinned corpus, the analyzer emitted
    // 23 import edges and the production path delivered 2; the 21 that vanished
    // were exactly the ones whose path is built from a variable, which is the
    // form most real install scripts use. The pre-fix artifacts did not show it
    // because the m12 corpus measurement read `analyze()` directly, not
    // `parseFile` — the same known-zeros gap the groovy lane recorded.
    //
    // The exemption is deliberately SCOPED to the two path-shaped labels. A
    // `calls` or `uses` target containing braces is still garbage and is still
    // dropped, which is what keeps a fabricated `calls -> ${dotnetPath}` — the
    // defect class BD4 exists to prevent — from being laundered through this
    // exemption. The differential is what proves both halves: its oracle
    // corroborates the path rows and expects no braced call rows.
    if (language === "bash" && (r.type === "imports" || r.type === "references" || r.relationshipType === "imports" || r.relationshipType === "references")) {
      if (target.length > 200 || target.includes("\n")) return false
      return true
    }

    // Block garbage targets: source code snippets, malformed names
    if (target.length > 200 || target.includes("\n")) return false

    const leaf = extractLeaf(target)
    const lower = leaf.toLowerCase()

    // Block targets that are clearly not valid symbol names. `$` is a valid
    // identifier character (Vue instance methods $emit/$refs/$attrs, jQuery,
    // JS `$` bindings) — dropping it silently deleted legitimate Vue call
    // targets; template-literal garbage is still blocked via `{`, `}` and the
    // backtick, and `${x}` contains braces.
    if (leaf.length > 80 || leaf.length < 1) return false
    if (/[{}`<>\n\r\t]/.test(leaf)) return false
    if (leaf.startsWith(" ") || leaf.includes("  ")) return false

    // CSS/SCSS/SASS: no type-based filter. The rule this replaces was "keep
    // `contains` only", on the stated grounds that a `uses` edge to a CSS
    // property name is not valid. That was true of the ANALYZER'S OUTPUT and is
    // no longer: `real-css-analyzer.ts` now emits no relationship to a property
    // name at all (a property is a token in a declaration, not a graph node — the
    // information rides `declaresProperties` on the symbol payload instead), and
    // it emits a `contains` edge only where both ends resolve to a symbol it
    // publishes.
    //
    // Measured over 457 files / 13 corpora, this filter was discarding the CSS
    // lane's most valuable edges — `var(--x)` references to custom properties and
    // `animation:` references to `@keyframes` — 2,170 of them, 1,437 of which
    // resolve at both ends. Keeping `contains` only meant the production graph
    // was made of structural containment and nothing else.
    //
    // The universal rules above still apply to CSS unchanged (block garbage
    // targets, over-long or empty leaves, brace/angle-bracket leaves), and the
    // store still records an edge whose target is in another file as an external
    // reference — which is what a `references` edge between stylesheets IS.

    // NOTE: no blanket hyphen block here. Hyphens are valid identifier
    // characters in Clojure/Lisp-family and shell languages (create-service,
    // multi-arity, format-value); a global `lower.includes("-")` filter would
    // silently drop legitimate relationships for those analyzers. CSS property
    // leakage is already fully handled by the language-specific branch above.

    // Block tree-sitter AST internals — BUT NOT a name this file DECLARES.
    //
    // Every entry in NOISE_TARGETS is the name of a web-tree-sitter Node
    // accessor (`node.type`, `node.namedChild`, `node.parent`, …). The list
    // defends against an analyzer passing an API member name where a symbol
    // name belongs. It is not a list of language keywords, and it was applied as
    // if it were — which is the same error this file already documents for the
    // JS-globals list ("a method named `process` is a legitimate declaration in
    // Scala/Python/Java; applying the JS global list cross-language silently
    // dropped real symbols").
    //
    // `type` is the costly entry: it is a web-tree-sitter accessor AND a shell
    // builtin AND an ordinary variable name. Measured over five bash corpora
    // (ohmyzsh, otp, fsharp, nvm, rbenv): 18 emitted edges had `type` as their
    // target leaf, and 17 of them named a variable THE SAME FILE DECLARES —
    // `local type="$1"`, `type="${match[1]}"` — so they were real containment and
    // read relationships deleted on the way to the index. The same applies to a
    // Java field named `parent`, a Python method named `text`, a Kotlin
    // property named `firstChild`.
    //
    // The discriminator is DECLARATION, and it is the right one: an analyzer that
    // accidentally emits `node.type` emits a name the file never declares, while
    // a variable the file declares is a real node in the graph. So the list keeps
    // its power against the bug it was written for and stops eating the graph.
    if (NOISE_TARGETS.has(leaf) && !(declaredNames && declaredNames.has(String(r.target ?? r.to ?? "")))) {
      // M60 LUA-16: `NOISE_TARGETS` bundles three groups whose names are noise
      // ONLY in the languages that own the convention, and all three were applied
      // to every language. Measured over every Lua file of two pinned corpora, the
      // cost was 351 real edges: 345 `calls` to the Lua stdlib `type()` and 6 to
      // `parent`, all of which the Lua analyzer resolved correctly and the product
      // then discarded.
      //
      // A `type(...)` call in Lua is a stdlib type query. It is not a web-tree-sitter
      // `node.type` leak, and no Lua file can produce one — same for a CSS property
      // name reached from Lua. So those two groups are scoped to the languages that
      // own them, mirroring the `JS_GLOBALS`/`JS_FAMILY` split the SYMBOL filter
      // beside this already does. The change is a `return true` for every language
      // that never had this noise, so it cannot introduce noise anywhere.
      //
      // The third group — `setUp`/`tearDown`/`beforeEach`/`afterEach` — stays
      // universal on purpose. A test-lifecycle hook is framework noise in whatever
      // language it appears in, and scoping it means judging which languages have
      // such frameworks, which is not a question this function can answer.
      const family = NOISE_TARGET_FAMILIES[leaf]
      if (family && !family.has(language)) return true
      return false
    }

    return true
  })
}

/**
 * Which symbol kinds get a stored body, and why each one is in or out.
 *
 * This list decides what content search can reach, so it was measured rather
 * than guessed. Before it was explicit, only `function | class | method |
 * interface` produced a snippet, and the result was whole ABSTRACTIONS with no
 * searchable text at all:
 *
 *     ripgrep   impl         0/443    <- Rust's central abstraction, 0% searchable
 *     ripgrep   struct       0/311
 *     lodash    type       0/1302    <- measured: "Lodash Governance", a MARKDOWN heading
 *     clojure   constructor  0/325
 *
 * IN, because the body is code nothing else can reach:
 *   impl      a 73-line `impl HaystackBuilder` block is the whole answer to "how
 *             does the haystack builder work". Its NAME was searchable; its logic
 *             was not, so "HaystackBuilder" found a declaration and nothing else.
 *   struct    3 lines of field declarations, but the field NAMES ("what has a
 *             strip_dot_prefix flag") are signal the name alone does not carry.
 *
 * OUT, on measured grounds rather than tidiness:
 *   type      in lodash these are markdown section headings, not code. Storing
 *             them would put prose into a code index and dilute the bm25 ranking
 *             that now ranks bodies. Better extraction, not a bigger list, is the
 *             fix for that coverage number.
 *   property / variable / constant / module / enum_member
 *             declarations. A symbol's own name and qualified name are already
 *             indexed and searched, so a one-line body adds rows and no recall —
 *             which is why their measured 0% coverage is CORRECT, not a gap.
 *
 * `function` is 40% covered on rake, which is an analyzer-extraction limit rather
 * than this list: those bodies arrive empty from upstream.
 */
const SNIPPET_KINDS = new Set(["function", "class", "method", "interface", "impl", "struct"])

let engineModule: any = null

export async function parseFile(filePath: string, projectPath: string, context?: ASTEngine.AnalyzeContext) {
  const stat = await import("fs/promises").then((fs) => fs.stat(filePath))
  const sizeBytes = stat.size
  const lastModified = stat.mtimeMs
  const ext = path.extname(filePath).toLowerCase()
  const language = detectLanguageFromPath(filePath) ?? "unknown"

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
    // Decoded, not `toString("utf-8")` — see src/util/source-text.ts. A UTF-16
    // file read as UTF-8 yields NUL-interleaved text that parses to nothing, and
    // the read itself throws no error, so the loss is invisible here.
    const content = decodeSourceText(buffer).text
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)
    log(`Using structural extraction for large file: ${filePath} (${sizeBytes} bytes)`)
    return extractFallback(content, language, hash, sizeBytes, lastModified)
  }

  // M60 X12: the encoding is not known before the first four bytes are read, so
  // the file is read as bytes and decoded by BOM. `readFile(path, "utf-8")` is
  // correct for almost every file and silently destroys the rest — 24 files in
  // the XML corpus, including 34 KB and 14 KB of ordinary WordprocessingML, were
  // reaching the grammar as NUL-interleaved text and producing zero symbols.
  const decoded = decodeSourceText(await import("fs/promises").then((fs) => fs.readFile(filePath)))
  const content = decoded.text
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)
  if (decoded.encoding !== "utf8" || decoded.inferred) {
    // Recorded rather than logged-and-dropped: a file this system had to GUESS
    // the encoding of is weaker evidence than one that declared it, and the
    // distinction has to survive into the index for a consumer to act on.
    log(`Decoded ${filePath} as ${decoded.encoding}${decoded.inferred ? " (inferred from a NUL pattern, no BOM)" : decoded.hadBom ? " (BOM)" : ""}`)
  }

  try {
    if (!engineModule) {
      engineModule = await import("./engine")
    }
    const parsed = await engineModule.ASTEngine.parseFile(filePath, content, context)

    // Log when engine returns 0 symbols (silent failure — no exception thrown)
    if ((parsed?.symbols?.length || 0) === 0 && (parsed?.errors?.length || 0) > 0) {
      try {
        const errSample = parsed.errors.slice(0, 3).map((e: any) => e.message).join(" | ")
        fs.appendFileSync(bbDiagnosticsLogPath("parse-errors.log"),
          `${new Date().toISOString()} | ${language} | ${sizeBytes}B | ${filePath} | ENGINE_EMPTY: ${errSample.substring(0, 200)}\n`)
      } catch {}
    }

    if (ext === ".dart") {
      fs.appendFileSync(
        bbDiagnosticsLogPath("worker-debug.log"),
        `[Worker] ASTEngine.parseFile returned ${parsed?.relationships?.length || 0} relationships for ${filePath}\n`,
      )
    }

    // Stage 5: Universal Multi-Language Taint Data-Flow Extraction
    //
    // GATED on the language. `TaintAnalyzer` matches SOURCE and SINK TOKENS
    // over a symbol's text, so it will happily "find" a taint flow in prose:
    // measured on this repository's own index, 326 of bb_security's 3,190
    // findings (10.2%) were in Markdown, JSON, YAML, HTML and CSS, including
    // `docs/m15/M15-MASTER-PLAN.md:214` reported as a `sql_injection` with the
    // symbol name parsed out of a markdown table pipe. No amount of token
    // matching can make those valid; they are an artefact of running a text
    // matcher over a text format.
    //
    // The gate is a NAME list, not a heuristic, because the taint rules are
    // written against programming-language APIs (`db.query`, `child_process`,
    // `PreparedStatement`). A configuration or prose format has no such API, so
    // there is nothing for the rules to legitimately match. It lives here rather
    // than inside `taint-analyzer.ts` so the analyzer stays a pure rule set and
    // the eligibility decision stays visible at the call site.
    const TAINT_ELIGIBLE_LANGUAGES = new Set([
      // The languages the engine dispatches to a REAL analyzer AND for which
      // the taint rules are written against a language API (`db.query`,
      // `child_process`, `PreparedStatement`, `cursor.execute`, …).
      "typescript", "tsx", "javascript", "java", "kotlin", "scala", "groovy",
      "python", "ruby", "php", "go", "rust", "swift", "dart", "c", "cpp",
      "csharp", "perl", "lua", "r", "elixir", "erlang", "clojure", "haskell",
      "zig", "nim", "fsharp", "vb", "powershell", "bash", "objective-c",
      // Explicitly EXCLUDED, and each exclusion is load-bearing:
      //   markdown json yaml toml xml html css sass scss graphql protobuf
      //   make clean hcl terraform svelte vue sql
      // Markdown/JSON/YAML/TOML/XML/HTML/CSS carry prose and data, not code —
      // measured at 326 of 3,190 bb_security findings (10.2%). The rest are
      // schema, query, build and markup formats whose tokens ("select", "exec",
      // "query") collide with the sink rules without ever being a sink.
    ])
    const taintEligible = TAINT_ELIGIBLE_LANGUAGES.has((language || "").toLowerCase())
    try {
      if (taintEligible) {
        const { TaintAnalyzer } = await import("./taint-analyzer")
        TaintAnalyzer.enrichSymbols(parsed.symbols, content, language)
      }
    } catch (e) {
      log("Taint extraction failed:", e)
    }

    // ONE split of the file for the whole symbol list, not one per symbol.
    //
    // Measured 2026-09-28 (script/m60/yaml-scaling-probe.ts, per-doubling ratios, which
    // survive a loaded box in a way an absolute ms/file cannot): the `.map` below called
    // `content.split("\n")` for EVERY function/class/method/interface symbol, so a file with
    // n such symbols split the entire source n times. That is O(n^2) in file size, on the
    // PRODUCTION path, for every language. A CPU profile put 81% of all sampled time in
    // `stringSplitFast` with this frame as the only caller.
    //
    // YAML exposed it rather than causing it: yaml publishes a `class` symbol for every
    // object-valued key, so a 4,096-key nested document produced 4,096 class symbols and
    // 4,096 whole-file splits. Flat documents are unaffected (property symbols do not
    // take this branch), which is why the same probe measured a flat mapping as linear
    // and a nested one at ~1.93 per doubling. The `??=` keeps the split lazy so a file
    // with no such symbol never pays for it at all.
    let snippetLines: string[] | undefined
    const ret = {
      success: true,
      language: parsed.language || language,
      framework: parsed.metadata?.framework,
      fileHash: hash,
      sizeBytes,
      lastModified,
      symbols: parsed.symbols
        .filter((s: any) => keepSymbol(s, parsed.language || language))
        .map((s: any) => {
        let snippet = ""
        if (SNIPPET_KINDS.has(s.kind)) {
          const lines = snippetLines ?? (snippetLines = content.split("\n"))
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
          // M35 pre-work: carry the analyzer-extracted docstring across the
          // worker boundary. It was dropped here AND never bound in the
          // brain_symbol INSERT, so brain_symbol.docstring was always NULL.
          docstring: s.docstring ?? null,
          // #612 store-phase (same seam class as docstring above and scope_kind
          // below): the declaration/definition fact. c has published
          // `metadata.isDeclaration` since the HC1 review, and cpp/rust/zig
          // publish it as of #612 — but the whole `metadata` object was dropped
          // HERE, so brain_symbol.annotations was NULL for every analyzer
          // symbol and the store had nothing but the NAME to resolve with. The
          // narrow key is carried rather than all of metadata: it is the one
          // metadata fact the store phase reads (a schema column of its own,
          // `is_declaration`), and widening `annotations` for every symbol in
          // every language is a separate, larger change that would need its own
          // measurement round.
          isDeclaration: s.metadata?.isDeclaration === true || undefined,
          // CSS lane (2026-09-26). The same seam as `isDeclaration` above, met
          // from the other side: the store DOES read `symbol.metadata` and
          // serialise it into `brain_symbol.annotations`, but the whole
          // `metadata` object is dropped HERE, so nothing an analyzer puts in it
          // survives the worker boundary. For CSS that silently deleted a
          // payload the lane's own ruling depends on — `declaresProperties`,
          // which replaced 32,654 relationships to CSS property names that are
          // not graph nodes (measured: `uses` resolved at both ends 6.0% of the
          // time, and the production filter then discarded the class outright).
          // Trading a wrong edge for a dead field is not a fix, so the payload is
          // carried.
          //
          // Deliberately NARROW, and deliberately CSS-only, for the reason the
          // comment above gives: widening `annotations` for every symbol in every
          // language is a separate, larger change that needs its own measurement
          // round. The keys below are the ones the CSS lane's F6/F8/CC1 checks
          // read, so the channel carries facts that are consumed rather than
          // facts that are merely produced.
          // Emitted under the name the indexer already reads, so the existing
          // `symbol.metadata -> annotations` INSERT path carries it with no
          // change on the store side.
          metadata: (() => {
            const m = s.metadata as Record<string, any> | undefined
            if (!m) return undefined
            const out: Record<string, any> = {}
            if (Array.isArray(m.declaresProperties)) out.declaresProperties = m.declaresProperties
            if (typeof m.declaredPropertyCount === "number") out.declaredPropertyCount = m.declaredPropertyCount
            if (typeof m.isSelector === "boolean") out.isSelector = m.isSelector
            if (typeof m.isComplex === "boolean") out.isComplex = m.isComplex
            if (typeof m.isUtility === "boolean") out.isUtility = m.isUtility
            if (typeof m.isCustomProperty === "boolean") out.isCustomProperty = m.isCustomProperty
            if (typeof m.isKeyframes === "boolean") out.isKeyframes = m.isKeyframes
            if (typeof m.isSupports === "boolean") out.isSupports = m.isSupports
            if (typeof m.isAtRule === "boolean") out.isAtRule = m.isAtRule
            if (typeof m.isCssModule === "boolean") out.isCssModule = m.isCssModule
            if (Array.isArray(m.specificity)) out.specificity = m.specificity
            if (Array.isArray(m.classNames)) out.classNames = m.classNames
            if (m.selectorComposition) out.selectorComposition = m.selectorComposition
            if (typeof m.supportsCondition === "string") out.supportsCondition = m.supportsCondition
            if (typeof m.atKeyword === "string") out.atKeyword = m.atKeyword
            if (Array.isArray(m.selectorChain)) out.selectorChain = m.selectorChain
            // M14 #290 / MD-5 — MARKDOWN, on the same terms as the CSS keys above:
            // each of these is READ by a check, not merely produced. The reader is
            // `script/m14/verify-pipeline-e2e.ts`, which indexes a markdown document
            // through the REAL CLI and asserts the rows in brain.db — and it could not
            // be written before this line existed, because there was nothing to assert:
            // every markdown symbol arrived with `annotations = NULL` while every
            // fixture passed against the analyzer's return value.
            //
            // That is the exact shape of the defect, and it is worth being precise
            // about why no existing gate saw it. A fixture calls `engine.parseFile`,
            // which never crosses the worker boundary, so the F3 lane is structurally
            // incapable of observing this seam — which is why the review recorded MD-5
            // as "unpinnable" rather than "unpinned". It was unpinnable, and the reason
            // was that the one instrument in the repository that CAN see the worker was
            // not covering this language. The instrument existed; the case did not.
            //
            // `headingLevel` is the load-bearing one: without it the index cannot
            // reconstruct a document outline, so a markdown heading and a code block
            // are indistinguishable rows. `isRepeatedSite` is the one that makes two
            // sites of one construct tellable apart. `nodeType` is the grammar's own
            // name for the node, which is the fact a reader needs in order to trust
            // the other four.
            if (typeof m.nodeType === "string") out.nodeType = m.nodeType
            if (typeof m.headingLevel === "number") out.headingLevel = m.headingLevel
            if (typeof m.language === "string") out.language = m.language
            if (m.isMarkdownHeading === true) out.isMarkdownHeading = m.isMarkdownHeading
            if (m.isMarkdownTable === true) out.isMarkdownTable = m.isMarkdownTable
            if (m.isMarkdownTableColumn === true) out.isMarkdownTableColumn = m.isMarkdownTableColumn
            if (m.isMarkdownCodeBlock === true) out.isMarkdownCodeBlock = m.isMarkdownCodeBlock
            if (m.isMarkdownFrontMatter === true) out.isMarkdownFrontMatter = m.isMarkdownFrontMatter
            if (m.isRepeatedSite === true) out.isRepeatedSite = m.isRepeatedSite
            return Object.keys(out).length > 0 ? out : undefined
          })(),
          snippet,
        }
      }),
      imports: (parsed.imports || []).flatMap((i: any) => {
        // Emit one BasicImport per imported name so that a multi-item named
        // import (e.g. `import { a, b, type C } from "./mod"`) produces one
        // brain_import row per symbol — i.e. don't lose items[1..]. The
        // analyzer's per-file granularity is the row that ends up being
        // queried by intelligence layers, so fidelity here directly
        // determines audit precision.
        const items: string[] = Array.isArray(i.items) && i.items.length > 0
          ? i.items
          : [i.localName || i.module || ""]
        const baseType = i.isDefault || i.isDefaultImport ? "default" : i.isNamespace || i.isNamespaceImport ? "namespace" : "named"
        // M60/#910: the analyzer's OWN classification wins over the
        // bare-specifier shape rule. That rule is a js/ts idiom ("bare module
        // specifier = package"), and applying it to every language made c's
        // two include forms indistinguishable: `#include "util.h"` (a project
        // header) and `#include <stdio.h>` (a system header) both have a
        // specifier that starts with neither "." nor "/", so both were stored
        // external and the file-dependency engine could not tell a sibling
        // header from libc. c/cpp declare it (`metadata.isSystemInclude`),
        // clojure/sql declare it (`isExternal`); an undeclared dependency keeps
        // the historical heuristic unchanged.
        const declared = (i.metadata ?? {}) as Record<string, any>
        const external =
          declared.isSystemInclude === true || declared.isExternal === true || i.isExternal === true
            ? true
            : declared.isSystemInclude === false || declared.isExternal === false
              ? false
              : typeof i.module === "string"
                ? !i.module.startsWith(".") && !i.module.startsWith("/")
                : !!i.isExternal
        // The import's LINE. `line_number` is the field every analyzer in the tree
        // actually writes (types, go, ruby, python, yaml — 45 call sites, zero of them
        // write `line`), and this read looked for `range.startLine` and `line` only, so
        // every import in EVERY language arrived at the store with `line: 0`. Found by
        // running a real `!include` file through `parseFile` rather than through the
        // analyzer: the analyzer reported `line_number: 1` and the production entry
        // reported `line: 0`. The fallback is additive, so an analyzer that does set
        // `line` or `range.startLine` is unaffected.
        // FOUR spellings of an import's line exist in this tree and this read matched two
        // of them: `range.startLine` (xml), `line`, and now `line_number` (yaml, ts, go,
        // ruby, python). makefile, objective-c and sql write a FOURTH — `lineNumber` —
        // and were still arriving with 0 after the first fix. All four are accepted;
        // the order is widest-known first and every step is a fallback, so nothing that
        // already resolved changes.
        const line = i.range?.startLine ?? i.line ?? i.line_number ?? i.lineNumber ?? 0
        return items
          .filter((name: string) => typeof name === "string" && name.length > 0)
          .map((name: string) => {
            // "X as Y" → keep the alias form: name imported-as local alias
            const asMatch = name.match(/^(\S+)\s+as\s+(\S+)$/)
            const importedName = asMatch ? asMatch[2] : name
            // Strip `type` qualifier: "type Repository" → "Repository"
            const cleanName = importedName.replace(/^type\s+/, "").trim()
            return {
              name: cleanName,
              path: i.module || i.path || "",
              // The analyzer's OWN classification, when it declares one. Five lanes do:
              // makefile `make_include`, objective-c `include`, sql `sql_import`, xml
              // `xml-doctype`, yaml `yaml_tag_include` / `yaml_keyword_include` /
              // `github_action`. The fallback below is the JS/TS idiom
              // (named/default/namespace), and applying it to every language made all
              // 442 of this lane's corpus imports read `named` — so an Ansible
              // `include_tasks: tasks.yml` PROJECT file dependency and a GitHub Actions
              // `uses: actions/checkout@v4` EXTERNAL tool invocation became
              // indistinguishable in the row the file-dependency engine reads. The
              // relationships always carried the distinction; the row did not.
              //
              // Safe to prefer: the stored column is `import_type`, no fixture in the
              // tree pins this field, and the only consumer that branches on an import's
              // `type` (import-pruner.ts) reads JS/TS AST SPECIFIERS — a different
              // structure entirely, not these rows. A lane that sets no `importType`
              // keeps the historical value unchanged.
              type: i.importType ?? (asMatch ? "alias" : baseType),
              isExternal: external,
              line,
            }
          })
      }),
      relationships: filterNoiseRelationships(parsed.relationships, language, new Set((parsed.symbols ?? []).map((s: any) => String(s?.name ?? "")).filter(Boolean))),
      // M60 LUA-14: the analyzer's `exports` were never forwarded here, so the
      // entire export surface of every language was invisible to the index. This
      // is the same defect the `metadata` line below already documents for
      // metadata — two entry points that disagreed, with the worker the lossy one
      // — except that nobody had measured the size of it. Now measured, over
      // every Lua file of two pinned corpora: 1,587 exports on kong and 187 on
      // luvit, emitted by the analyzer and returned by nobody. Zero of 1,774
      // reached the product.
      //
      // `ParseResult.exports` was already declared optional and `engine.ts`
      // already forwards it, so this adds no new contract: it makes the worker
      // agree with the engine it wraps. `?? []` rather than a bare field, because
      // `extractFallback` and the size/extension early-returns build their own
      // objects and a consumer must not have to distinguish "no exports" from
      // "this path never set the key".
      exports: (parsed as any).exports ?? [],
      errors: parsed.errors || [], // <-- Stage 4: propagate syntax errors from the AST Engine
      // The analyzer's WHOLE `metadata` object was being dropped here, and this
      // is the function `parallel-indexer.ts:889` uses — the production indexing
      // path. `engine.ts` carries it (its own result type is
      // `Omit<ParseResult, "language" | "metadata"> & { metadata?: ... }`), so the
      // two entry points disagreed and the worker was the lossy one. Found by
      // running the bash contract probe through `parseFile` rather than through
      // the analyzer directly: the analyzer reported 10 patterns for
      // `Deploy.sh` — Strict Error Handling, Insecure Pipe Execution, Privilege
      // Escalation, Destructive File Operation — and `parseFile` returned none.
      // Every pattern-based signal in every language was invisible to the index.
      // Purely additive: nothing read this before, so no consumer changes
      // behaviour, and the fields that WERE forwarded (`framework` above) are
      // left exactly as they were.
      metadata: parsed.metadata,
    }

    if (ext === ".dart") {
      fs.appendFileSync(
        bbDiagnosticsLogPath("worker-debug.log"),
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
    const lang = detectLanguageFromPath(filePath) ?? "unknown"
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
    try {
      const { ensureWasmRegistry } = await import("../util/wasm")
      await ensureWasmRegistry()
    } catch {}
    try {
      engineModule = await import("./engine")
    } catch {}
    // M21.W1 debug hook: BB_WORKER_DELAY_READY_MS delays the `ready` signal so
    // the parent's startup watchdog can be exercised deterministically.
    // M40.A8: quarantined behind BB_TEST_HOOKS=1 — a stray env var can no
    // longer stall a production index's worker startup.
    if (process.env.BB_TEST_HOOKS === "1") {
      const delayReady = Number(process.env.BB_WORKER_DELAY_READY_MS || 0)
      if (delayReady > 0) await new Promise((r) => setTimeout(r, delayReady))
    }
    process.send?.({ type: "ready", workerId: msg.workerId })
  } else if (msg.type === "parse_batch") {
    const { batchId, files, projectPath } = msg
    // 45s per-file self-timeout; env-configurable (BB_FILE_TIMEOUT_MS) so
    // deterministic crash/timeout fixtures die fast (M21.W1).
    const FILE_TIMEOUT_MS = Number(process.env.BB_FILE_TIMEOUT_MS || 45000)

    // M21.W1 debug hooks (fixture-only, zero default effect):
    //  - BB_WORKER_CRASH_ON_BATCH=1: exit immediately on parse_batch, before
    //    reporting file_start — deterministic poison-pill fixture (worker dies
    //    mid-batch with no in-flight file).
    //  - BB_WORKER_DELAY_PARSE_MS: sleep after file_start so the parent's
    //    per-file timeout fires deterministically (currentFile is already set,
    //    exercising the timeout→kill→retry path, not the poison path).
    // M40.A8: quarantined behind BB_TEST_HOOKS=1 — without the explicit
    // opt-in they are no-ops in every process, production included.
    let delayParse = 0
    if (process.env.BB_TEST_HOOKS === "1") {
      if (process.env.BB_WORKER_CRASH_ON_BATCH === "1") {
        process.stderr.write(`[BB-WORKER-FIXTURE] crashing on parse_batch (batch ${batchId})\n`)
        process.exit(1)
      }
      delayParse = Number(process.env.BB_WORKER_DELAY_PARSE_MS || 0)
    }

    for (const filePath of files) {
      try {
        // Yield to event loop to ensure file_start is sent BEFORE sync tree-sitter block
        process.send?.({ type: "file_start", batchId, filePath })
        await new Promise((r) => setTimeout(r, 0))
        // M21.W1 fixture hook: per-file delay AFTER file_start (see above).
        if (delayParse > 0) await new Promise((r) => setTimeout(r, delayParse))

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

// Self-executing worker entry (compiled dist: `node dist/pool-worker.js`).
// The IPC channel alone keeps a forked child alive, but hold the event loop
// explicitly so this entry works under every runtime (plain Node, tsx, Bun).
if (process.env.BB_POOL_WORKER === "1") {
  setInterval(() => {}, 1 << 30)
}
