#!/usr/bin/env bun
import { createHash } from "crypto"
import { decodeSourceText } from "../util/source-text"
import { createRequire } from "node:module"
import path from "path"
import fs from "fs"
import type { ASTEngine } from "./engine"
// Type-only: the module itself is loaded lazily via `await import("./project-index")` so
// a worker that cannot deserialise an index still runs per-file. Importing the type
// costs nothing at runtime and keeps `ASTEngine.n` -- a name that never existed -- from
// silently becoming `any` here and `ProjectIndex` at the use site.
import type { ProjectIndex } from "./project-index"
import { detectLanguageFromPath } from "./language-detection"
// THE BINDING SEPARATOR IS IMPORTED, NEVER RE-SPELLED. It is `\u0000` in `types.ts`, and a filter that
// hard-coded its own copy would drift from the spelling the analyzers write — the "one spelling, two
// places" hazard this programme keeps paying for.
import { BINDING_SEP } from "./types"

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

// ── worker startup diagnostics ───────────────────────────────────────────────
//
// THE CONTRACT THIS FILE NOW HONOURS: a worker that cannot do its job says so
// on stderr, in a form the parent already forwards to the user. The pool
// mirrors child stderr verbatim (`[WORKER-ERR] …`, parallel-indexer.ts:1544),
// so writing one line here makes a failure visible with NO change to any other
// file — which is the whole point, because every previous report of "pool
// workers don't start" arrived with no attached explanation.
//
// Two failures were silent here before, and both are silent *by omission*:
//
//   1. `import("./engine")` failing during warmup. `engineModule` stayed null,
//      every `parseFile` re-attempted the import, the import threw again, and
//      the file fell through to `extractFallback` — regex extraction, marked
//      `fallback: true`. The index completed, looked healthy, and contained
//      fewer symbols than the same run would have produced with a working
//      engine. The parent's handler for an `engine_fail` message
//      (parallel-indexer.ts:1557) has existed all along and nothing ever sent
//      one; that branch was dead code.
//   2. The wasm registry failing to load. Same shape, same silence.

/** Startup problems found so far, reported in the `ready` handshake. */
const startupDiagnostics: string[] = []

/**
 * Deduplicates the report.
 *
 * One of these can fire PER BATCH (the project index is deserialised once per
 * `parse_batch`), so a worker serving 1,000 batches with an unbuildable index
 * would emit 1,000 identical lines and grow `startupDiagnostics` without
 * bound. The first occurrence carries the information; the other 999 are noise
 * on a channel the parent forwards to a terminal.
 */
const reportedStartupProblems = new Set<string>()

function reportStartupProblem(what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const line = `${what}: ${message}`
  if (reportedStartupProblems.has(line)) return
  reportedStartupProblems.add(line)
  // stderr first: it is the channel the parent forwards verbatim, so this is
  // visible on the user's terminal on the very next line.
  process.stderr.write(`[BB-WORKER-STARTUP] ${line}\n`)
  startupDiagnostics.push(line.slice(0, 300))
}

/**
 * `process.send` that cannot take the worker down.
 *
 * Every send in this file used `process.send?.(…)`, which is null-safe but
 * NOT channel-safe. When the parent dies mid-batch the send throws
 * `ERR_IPC_CHANNEL_CLOSED`; inside the async `message` handler that becomes an
 * unhandled rejection, which Node 22 terminates the process on — so a clean
 * shutdown could be reported as a worker crash. A send that fails because
 * nobody is listening is not an error worth dying over.
 */
function safeSend(message: Record<string, unknown>): boolean {
  try {
    if (typeof process.send !== "function") return false
    if (process.connected === false) return false
    process.send(message)
    return true
  } catch {
    return false
  }
}

/**
 * THE REGEX-FALLBACK SYMBOL — what this file can recover when a parse fails.
 *
 * IT IS A UNION WITH THE AST-PATH SYMBOL, AND THE UNION IS THE POINT: a caller reading `parseFile`'s
 * `symbols` may be holding either, and the fields below are the ones ONLY the AST path can fill.
 *
 * THEY ARE DECLARED HERE AS OPTIONAL, WHICH IS A CORRECTION AND NOT A WIDENING. `parseFile` returns the
 * union of this shape and the full symbol, so `s.kind`, `s.range`, `s.ownerName`, `s.scope` and
 * `s.metadata` exist on one arm and not the other — and TypeScript therefore refused every read of them
 * on the union, which is why **39 type errors across 8 files** in `script/m12` and `script/m14` had
 * accumulated since the ratchet's baseline reached ZERO on 2026-10-08.
 *
 * The alternative — casting at each of the ~39 call sites — would have hidden the real fact the compiler
 * was pointing at: **a fallback symbol genuinely does not have these**, so a reader must handle their
 * absence. Declaring them optional states that once, in the type, where every reader sees it.
 */
interface BasicSymbol {
  name: string
  type: string
  startLine: number
  endLine: number
  visibility?: string
  parameters?: any[]
  returnType?: string
  qualifiedCalls?: string[]
  // ── FIELDS ONLY THE AST PATH FILLS. Optional because a fallback symbol cannot supply them.
  //
  // NO `range` HERE, AND THAT IS DELIBERATE — IT WAS TRIED AND REVERTED. `parseFile` FLATTENS
  // `UniversalSymbol.range` into `startLine`/`endLine`/`startIndex`/`endIndex`, so **neither arm of this
  // union carries a `range`**. Declaring it optional here silenced the compiler on nine probe sites
  // without making the field exist: `s.range?.startLine` would still have been `undefined` at runtime,
  // and one of those probes (`perl-probe.ts`) printed `Lundefined` on EVERY row because of it. **A type
  // declaration that makes a dead read compile is the defect, not the fix** — it is the same shape as
  // php's unreachable `owner_provable` (§6.11) and the same reason the `range` fallbacks were removed
  // from the probes instead.
  kind?: string
  ownerName?: string
  scope?: string
  metadata?: Record<string, any>
}

interface BasicImport {
  name: string
  /**
   * The ORIGINAL imported name when the specifier was aliased (`A as B` -> `A`).
   * `name` carries the LOCAL binding. Set so brain_import.imported_as has a writer
   * on this path too; the AST path publishes the same pair via ImportInfo.alias.
   */
  alias?: string
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

  // Capture-group roles per language, keyed to the patterns above: `module` is the
  // group holding the module/specifier path, `items` the group holding the imported
  // names. See the note at the derivation site for why this is not inferred.
  const GROUP_ROLES: Record<string, { module: number; items: number }> = {
    typescript: { module: 3, items: 1 },
    javascript: { module: 3, items: 1 },
    python: { module: 1, items: 2 },
    go: { module: 3, items: 1 },
    rust: { module: 1, items: 2 },
    java: { module: 1, items: 1 },
  }

  const langPatterns = patterns[language] || patterns.javascript || []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    for (const pattern of langPatterns) {
      const match = line.match(pattern)
      if (match) {
        // M60: which capture group holds the MODULE and which the ITEM LIST. These
        // two lines used to be positional (`match[3] || match[2] || match[1]` and
        // `match[1] || match[2]`), which is only right for patterns shaped like the
        // JS/TS one — group 1 items, group 3 module. Python's pattern is
        // `/^from\s+([\w.]+)\s+import\s+(.+)$/`, where group 1 is the MODULE and
        // group 2 the items, so every python row came out INVERTED:
        //   `from Cython.Debugger import Cygdb as cygdb`
        //     imported_name = "Cython.Debugger"  (the module)
        //     import_path  = "Cygdb as cygdb"    (the imported item)
        // and isExternal was computed from the wrong string too. The roles are now
        // stated per language instead of assumed, so a grammar that orders its
        // groups differently cannot silently invert again.
        const roles = GROUP_ROLES[language] ?? GROUP_ROLES.javascript
        const path = String(match[roles.module] ?? "")
        const names = String(match[roles.items] ?? "")
        if (!path) continue
        const isExternal = !path.startsWith(".") && !path.startsWith("/")

        const items = names
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
        if (items.length === 0) items.push(path.split("/").pop() || path)

        for (const name of items) {
          // M60: `A as B` used to be stripped to `A` outright, which threw the
          // local binding name away and left brain_import.imported_as with nothing
          // to hold — while extractBasicRelationships below KEEPS the alias, so the
          // fallback and the AST path disagreed about the same construct and that
          // function's own `as` branch was unreachable.
          //
          // `alias` carries the LOCAL binding, which is the convention the analyzer
          // already uses (ImportInfo.alias is set to `item.split(" as ")[1]`) and
          // the one brain_import.imported_as is read with: patterns.ts computes
          // `usedName = imported_as || imported_name` and then looks that name up
          // IN THE FILE, so it must be the name the source writes. `name` keeps its
          // original meaning, the imported name.
          const asMatch = name.match(/^(\S+)\s+as\s+(\S+)$/)
          imports.push({
            name: asMatch ? asMatch[1] : name,
            alias: asMatch ? asMatch[2] : undefined,
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
/**
 * DECLARATION SHAPE (2026-10-19, shared-pipeline fix (a)). The JS-global denylist was name-only, and two
 * independent raw-output measurements (TS lane 19/19, JS lane 22/22 raw symbols whose name is denylisted)
 * found EVERY such symbol declaration-shaped with a real non-zero span — a method `process()`, a const
 * `module`, a property `document` in generated .d.ts — and ZERO synthetic/phantom shapes (the analyzers no
 * longer inject them). A name is therefore the wrong discriminator; a shape is the right one: keep a real
 * declaration and drop only range-less/zero-width/invalid-line entries (the class the denylist was
 * originally written for). Fix (b) already exempted the synthetic module-leaf source of imports/exports;
 * (a) restores the remaining symbol-sourced edges for genuinely-declared global-named symbols.
 */
function isDeclarationShaped(s: any): boolean {
  const r = s?.range ?? {}
  const st = Number(r.startIndex ?? s?.startIndex)
  const en = Number(r.endIndex ?? s?.endIndex)
  const sl = Number(r.startLine ?? s?.startLine)
  const el = Number(r.endLine ?? s?.endLine)
  return (
    Number.isFinite(st) && Number.isFinite(en) && en > st &&
    Number.isFinite(sl) && sl >= 1 && Number.isFinite(el) && el >= sl
  )
}

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
  if (JS_FAMILY.has(lang) && JS_GLOBALS.has(name)) return isDeclarationShaped(s)
  // Universal denylist. SPLIT, because the original conflated two different
  // things and the comment claimed a property none of the second kind has.
  //
  // The original read: "language keywords / conventions and synthetic tree-sitter
  // artifact names — never legitimate declarations in any language." Both halves of
  // that sentence are wrong for the second list.
  //
  // A node type and a user identifier occupy the SAME namespace in every language
  // that allows keywords as names. `source_file` is tree-sitter's ROOT node type and
  // also an ordinary R function (`r-testthat/R/source.R:18`). `program` is a grammar
  // root type and a legal SQL COLUMN name. `Query.me` is a GraphQL field name in most
  // public APIs. `me` is legitimate in every language there is. `root` is a local in
  // lazy.nvim's loader. `this` is a local in lazy.nvim's float view.
  //
  // Six lanes measured the cost INDEPENDENTLY, which is what makes this a register
  // problem rather than six coincidences:
  //   R        12 symbols deleted across 9 files
  //   graphql  1 of 8,796 symbols (Query.me)
  //   sql      3 of 18,325 symbols; 1 of 11,786 `contains` edges left naming nothing
  //   lua      236 declarations deleted, leaving 677 edges pointing at them
  //   hcl      filed as H10 — a legitimately-declared `unknown` variable dropped
  //   solidity measured the denylist as a store-vs-analyzer divergence
  //
  // So: keep only names that are RESERVED in the language being parsed, and decide
  // that per language. The three below are reserved essentially everywhere and are
  // kept unconditionally. Everything else moves to a RESERVED set consulted only for
  // languages that actually reserve it, which is what a correct implementation of
  // "never legitimate declarations in any language" looks like.
  //
  // The names that REMAIN here are the ones no lane has produced a counterexample
  // for, and each is a word that is a keyword or a tree-sitter internal in the
  // languages that would parse it: they are not claims, they are the residue after
  // the measured removals.
  const UNIVERSAL = new Set([
    // Reserved in essentially every language parsed here. Kept unconditionally
    // because no lane produced a legitimate declaration of any of them.
    "this",
    "super",
    // Synthetic artifact names the analyzers themselves mint. These are OURS, not
    // the language's, so no user program can declare them.
    "SCSS_FILE_SCOPE",
    "GlobalScope",
    "module_declaration",
    "package_manifest",
    // REMOVED, each with a lane and a count — see the comment above:
    //   self, Self   deleted R/Python/Zig `self`; lua declares `local this`
    //   me, My       legitimate in every language (graphql `me`, lua `me`)
    //   destructor    a real method name in C++/Rust/Go
    //   root          lua `local root` at lazy.nvim/lua/lazy/core/loader.lua:497
    //   program       a legal SQL column name
    //   source_file   an ordinary R function
    //   unknown       hcl files declare a variable literally named `unknown`
    //
    // `unknown` is the one that cannot simply be deleted: R7 counts it as a
    // PLACEHOLDER, and 46 registered placeholder sites depend on that. It now moves
    // to RESERVED below rather than being dropped, so a placeholder is still refused
    // while a declared `unknown` survives.
  ])
  if (UNIVERSAL.has(name)) return false

  // Reserved words, consulted ONLY for a language that reserves them. Measured
  // evidence that a universal application of this set is wrong: `root` is declared
  // as a local in lua, `unknown` as a variable in hcl, `self` in python/zig/rust.
  const RESERVED: Record<string, ReadonlySet<string>> = {
    // `self` is reserved in PHP and Python 2-style declarations but a LEGAL variable
    // in Lua, Python 3, Rust and Zig, all of which are parsed here.
    php: new Set(["self", "parent"]),
    // `program` is reserved in Haskell/Elm-ish contexts; it is a SQL column name.
    sql: new Set(["program"]),
  }
  if (RESERVED[lang]?.has(name)) {
    // …except where the language makes the word SEMI-RESERVED, and php does.
    //
    // PHP 7.0 made `self`, `parent` and the rest of the keyword list usable as
    // METHOD, PROPERTY and CLASS-CONSTANT names, because a member is reached
    // through its owner and can never be confused with the type position the
    // keyword occupies. The name-only test above predates that distinction and
    // deletes real members.
    //
    // MEASURED COST, whole admitted php population (5,094 files, 350,342 edges,
    // production `parseFile`, 0 fallbacks): the only edge in the lane that names a
    // declaration the store does not hold is `contains Node -> parent` in
    // `phpmyadmin/src/Navigation/Nodes/Node.php:54` — `public Node|null $parent = null;`
    // — deleted here while the analyzer kept emitting the containment.
    // `validation/m14/fixtures/php/orphan-endpoint-gate.mts` is the gate that sees it
    // (the fixture runner calls `analyze()` directly at `run-fixtures.ts:728`, so no
    // fixture can observe this file): 5 orphaned `contains` targets in
    // `keyword-member-names.php` before this change, 0 after. 98 corpus declarations
    // are named `$parent`/`$self`; 0 methods or classes are.
    //
    // The exemption is deliberately narrow in two directions: it needs a member KIND,
    // and it needs an OWNER, so it cannot resurrect a tree-sitter artifact that has
    // neither — and a class, interface, trait, enum, namespace or top-level function
    // named `parent`/`self` is still refused, which is what php actually reserves
    // (`class parent {}` is a parse error, so that half can only be exercised by the
    // injectable mutant `php/drop-keyword-named-members`).
    const PHP_MEMBER_KINDS = new Set(["method", "property", "constant", "enum_member"])
    const isPhpMember = lang === "php" && PHP_MEMBER_KINDS.has(String(s.kind)) && Boolean(s.ownerName)
    if (!isPhpMember) return false
  }
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
const CSS_FAMILY_LANGUAGES = new Set(["css", "scss", "sass", "less"])
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

/**
 * The names a file BINDS without DECLARING — import bindings.
 *
 * WHY THIS EXISTS (JS lane finding §1). The NOISE_TARGETS escape hatch admits a
 * row when the file DECLARES the name, on the reasoning recorded at the check:
 * "an analyzer that accidentally emits `node.type` emits a name the file never
 * declares". An import binding is exactly that second case and the hatch cannot
 * see it: `import text from "./text.js"` binds `text`, publishes no symbol named
 * `text`, and so EVERY row naming `text` is deleted on the way to the index — the
 * `uses` reads AND the `imports` row itself, because the filter tests the target's
 * last segment and that segment is the bound name. Measured on a 600-file svelte
 * sample by `script/m14/javascript-two-path-loss.ts`: 378 rows lost, 0 gained, and
 * the instrument attributes each deletion as "the escape hatch being unreachable for
 * a name the file only READS or BINDS".
 *
 * This does NOT widen the hatch to property reads (see the OPEN half recorded in
 * `docs/analyzers/real-javascript-analyzer.md` §1): a name the file neither
 * declares nor binds is still treated as noise, and `type`/`parent` read off an
 * external object keep being deleted until a policy decision is taken for them.
 *
 * Shape-agnostic on purpose: analyzers spell their import records differently
 * (`items`, `localName`, `defaultName`, `alias`, `namespaceName`, and
 * `"./m:item"` / `"X as Y"` / path-ish tails), and a language whose record this
 * does not understand contributes nothing rather than contributing the wrong name.
 */
export function importBindingNames(imports: any[] | undefined): Set<string> {
  const names = new Set<string>()
  const add = (raw: unknown): void => {
    if (typeof raw !== "string") return
    let s = raw.trim()
    if (!s) return
    // `./m:text` — the last `:`-segment is the item; a `:12` line suffix was
    // already consumed by the same split.
    const colon = s.lastIndexOf(":")
    if (colon >= 0) s = s.slice(colon + 1).trim()
    // A path-ish tail names a module, not a binding.
    const slash = s.lastIndexOf("/")
    if (slash >= 0) s = s.slice(slash + 1).trim()
    if (!s) return
    // `X as Y` binds BOTH spellings in the file's text; the local one is Y.
    const asAt = s.indexOf(" as ")
    if (asAt > 0) {
      const imported = s.slice(0, asAt).trim()
      const local = s.slice(asAt + 4).trim()
      if (imported) names.add(imported)
      if (local) names.add(local)
      return
    }
    names.add(s)
  }
  for (const i of imports ?? []) {
    if (!i || typeof i !== "object") continue
    if (Array.isArray(i.items)) for (const it of i.items) add(it)
    add(i.localName)
    add(i.defaultName)
    add(i.alias)
    add(i.namespaceName)
  }
  return names
}

/**
 * UNION: main's helper, absent from this branch's copy and imported by `js-filter-hatch-probe.ts`.
 * Verbatim from `origin/main` — it is self-contained and depends on nothing this file changed.
 */
export function filterNoiseRelationships(
  rels: any[],
  language: string,
  declaredNames?: Set<string>,
  /**
   * NAMES THE FILE BINDS WITHOUT DECLARING THEM (`importBindingNames`). UNION: this parameter and the
   * hatch below are main's, whose side of this file had them while this branch's did not — and a probe
   * taken from main calls this function with FOUR arguments, so the two sides disagree about the
   * signature rather than about the body. The body kept here is THIS BRANCH's (it carries the
   * binding-separator and qualified-exemption fixes recorded below), so main's parameter was ported
   * INTO it rather than the body being replaced.
   */
  boundNames?: Set<string>,
): any[] {
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
    // THE BINDING SEPARATOR IS NOT PART OF THE TARGET, AND LEAVING IT IN SILENTLY DELETES EDGES.
    //
    // A target spelled `<read source>\u0000<binding>` — the family mechanism for a local binding, which
    // dart adopted and php has now adopted across all five variable-read arms — was passed through this
    // leaf extractor whole. `split(":")` and `split(".")` do not split on the separator, so the SOURCE
    // NAME stayed attached and counted toward the 80-character budget below, a budget whose intent is
    // code snippets rather than identifiers.
    //
    // MEASURED CONSEQUENCE (php-lane, whole 5,094-file population, pre-registered prediction against
    // observed): **1,132 additional edges dropped, 0 fewer** — the entire gap. Named instance: an 89-char
    // test method whose leaf reached 93 chars and was deleted. **THE LOSS IS SILENT**: the edge is
    // ABSENT from the graph rather than mis-bound, so no column, count or fixture shows it and only an
    // explicit difference of two totals finds it. php-lane found it by exactly that difference.
    //
    // EVERY LANE THAT ADOPTS `BINDING_SEP` INHERITS THIS, and php is only the first. The segment AFTER
    // the separator is the target; everything before it is the read site.
    const afterSep = BINDING_SEP.length > 0 && name.includes(BINDING_SEP)
      ? name.slice(name.lastIndexOf(BINDING_SEP) + BINDING_SEP.length)
      : name
    const noLine = afterSep.replace(/:\d+$/, "")
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
    //
    // TOML BELONGS IN THIS LIST, and its absence was dropping edges. Measured by toml-lane
    // (2026-10-09): `extractLeaf` splits a target on `:` and `.` before the leading-space test
    // below, so a dotted key whose QUOTED segment contains a colon —
    // `project.urls."CI: Azure Pipelines"`, valid TOML — yields the leaf ` Azure Pipelines"`,
    // which starts with a space, so the edge was silently deleted on the way to the index. toml
    // is a data language exactly like the four above: its targets are dotted key paths, a colon
    // inside a quoted key is a character in a name rather than punctuation, and no part of the
    // identifier sanitizer below applies to it. The two path-shaped exemptions further down
    // (bash, toml's `imports`/`references`) still matter for their own targets and are unchanged.
    if (language === "json" || language === "yaml" || language === "hcl" || language === "terraform" || language === "graphql" || language === "toml") return true

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
    // M60 (#919, toml lane): the SAME exemption, for the SAME reason, for toml's
    // `imports`. A path dependency's target is the path AS WRITTEN —
    // `[sources] Documenter = { path = ".." }` — and `extractLeaf("..")` splits on
    // `.` to `["", "", ""]`, whose last segment is the EMPTY string, so
    // `leaf.length < 1` deleted the edge on the way to the index. Measured on the
    // corpus: the analyzer collected all 331 path-dependency sites and
    // `parseFile` delivered only those whose leaf happened to survive, so the
    // relative paths that are most of a Julia manifest's `[sources]` section
    // (`..`, `../..`) were deleted silently while `crates/build-rs` survived.
    //
    // It is the same category as the data paths above and as bash's, so it gets
    // the same narrowly-scoped exemption: only these two languages, only the two
    // path-shaped labels, and still refusing a target over 200 characters or
    // containing a newline. A `calls`/`contains` target that is a path is still
    // garbage and is still dropped, which is what keeps a fabricated
    // `calls -> ../x` from being laundered through this.
    if ((language === "bash" || language === "toml") && (r.type === "imports" || r.type === "references" || r.relationshipType === "imports" || r.relationshipType === "references")) {
      if (target.length > 200 || target.includes("\n")) return false
      return true
    }

    // Block garbage targets: source code snippets, malformed names.
    //
    // THE LENGTH BUDGET APPLIES TO THE LEAF, NOT TO THE WHOLE TARGET — and that distinction was
    // silently deleting real edges. Measured by the css lane (2026-10-09): once css published
    // project-unique `qualifiedName`s (`<file-scope>::<name>`) every target grew, and **46 edges per
    // 60 files crossed this 200-character line and were DELETED on the way to the index** — 318
    // more were already long enough bare. The css analyzer now refuses to qualify a target that
    // would cross the line, which is the right instinct (a visible residual of 183 beats a silent
    // deletion) but the wrong place: this budget exists to reject a target that is a code SNIPPET,
    // and a snippet is long in its LEAF. A qualified name is long in its SCOPE, and the checks
    // below validate the leaf on its own terms — `leaf.length > 80`, the garbage-character set, the
    // spacing rules. So the length test moves to the leaf, where the intent always was, and no
    // language needs an exemption in order to spell its targets unambiguously.
    //
    // A genuine snippet is still refused: its leaf is long or carries `{`/`}`/backtick/angle
    // brackets, and both of those checks stay unconditional.
    if (target.includes("\n")) return false

    const leaf = extractLeaf(target)
    const lower = leaf.toLowerCase()

    // Block targets that are clearly not valid symbol names. `$` is a valid
    // identifier character (Vue instance methods $emit/$refs/$attrs, jQuery,
    // JS `$` bindings) — dropping it silently deleted legitimate Vue call
    // targets; template-literal garbage is still blocked via `{`, `}` and the
    // backtick, and `${x}` contains braces.
    if (leaf.length < 1) return false
    /* THE LEAF-LENGTH BUDGET IS GONE, AND IT WAS A PROXY FOR A SHAPE TEST (ruby lane, 2026-10-21).
     *
     * The budget was `leaf.length > 80`, and its stated intent was to reject a target that is a code
     * SNIPPET. It was a LENGTH proxy for that intent, and the proxy is WRONG: a legal identifier can
     * be arbitrarily long, and the corpus proves it.
     *
     * MEASURED BY THE RUBY LANE, WITH A CONTROL, OVER ITS OWN ADMITTED POPULATION: 4 edges that the
     * analyzer DID emit were eaten by this filter — `overrides` and `contains` on
     * `ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_without_intersecting_
     * propagation_report_all_instances` and its sibling, leaf lengths 98, 96, 98 and 96. The CONTROL
     * is what makes this a measurement and not a report: the same edges with a SHORT target are kept,
     * so the analyzer emitted them and the filter ate them. The loss is SILENT — the edges are ABSENT
     * from the graph rather than mis-bound, so no column and no count shows it.
     *
     * This is the SECOND lane to be bitten by this budget (php measured 1,132 edges dropped by the
     * whole-target form of the same rule, which is why the test moved to the leaf at all), so it is
     * the second measurement against it.
     *
     * THE REPLACEMENT IS A SHAPE TEST, AND IT IS THE INTENT STATED HONESTLY: a snippet is not long,
     * it is not an IDENTIFIER. It carries characters an identifier cannot — whitespace, a quote, a
     * comma, a parenthesis, an assignment — and those are the same characters that made the old
     * length rule fire on real code. A long legal identifier carries none of them.
     *
     * WHAT IS REFUSED NOW, AND IT IS THE SAME CLASS OF THING:
     *   - whitespace inside the leaf (a snippet is `foo (a, b)`, an identifier is `foo`)
     *   - a quote, a comma, a parenthesis, an equals sign
     *   - and everything the tests below already refused: braces, a backtick, angle brackets, a
     *     newline, a tab, a leading space, a double space.
     * The operator-name rule below is unchanged and still exempts a leaf made SOLELY of operator
     * characters, so ruby's `<=>` still passes — and THIS test carries that same exemption inline,
     * because an operator name is full of `=` and `<` and `>` and would otherwise be refused here
     * before the operator rule below ever saw it. (The proof caught exactly that: the first run of
     * `script/m14/leaf-length-proof.ts` refused 8 of the 12 operator names, because `<=>` contains
     * `=` and the shape test fired before the operator rule. A proof that fails is worth more than a
     * proof that was never run.)
     *
     * WHAT IS NO LONGER REFUSED: a long legal identifier, in any language, at any length. There is no
     * length at which a legal name stops being legal, so no length cap can be correct.
     */
    // ★ THE SETTER-NAME EXEMPTION, AND IT IS A SHAPE RULE, NOT A RUBY EXEMPTION (ruby lane,
    // 2026-10-22). THE MEASUREMENT, WITH A CONTROL, OVER RUBY'S OWN ADMITTED POPULATION: the shape
    // test above refuses a leaf carrying `=`, and **IN RUBY `=` IS THE SETTER MARKER** —
    // `attr_accessor :level` declares a writer named `level=`, and `def level=(v)` is an ordinary
    // setter. ⇒ EVERY RUBY SETTER EDGE WAS SILENTLY EATEN: **48 ROWS** — `contains Skip ->
    // ast_nodes=`, `contains Connection -> max_page_size=`, `overrides Skip.ast_nodes= ->
    // RuntimeError.ast_nodes=`, `contains ConcurrentishMap -> []=`. THE CONTROL IS WHAT MAKES THIS A
    // MEASUREMENT: the production path publishes 85,071 rows and the direct arm 85,119, and **ALL 48
    // of the dropped rows have an `=` in the target leaf and NOT ONE does not**; handed to the filter
    // ALONE every one of the 48 is eaten, and every one's `=`-stripped CONTROL is kept. THE LOSS IS
    // SILENT — the edges are ABSENT from the graph rather than mis-bound, so no column and no count
    // shows it.
    //
    // ⇒ THE RULE IS THE SAME SHAPE AS THE OPERATOR EXEMPTION ALREADY IN THIS FILE, AND IT IS THE
    // SAME SHAPE FOR THE SAME REASON: a SETTER NAME IS A LEGAL DECLARED NAME IN SEVERAL LANGUAGES
    // (ruby's `level=` `ast_nodes=` `max_page_size=`, and the same spelling appears in any language
    // that permits `=` in a method name), so a NAME may END in `=` without being a fragment. A leaf
    // that is an IDENTIFIER FOLLOWED BY A TRAILING `=` is a SETTER NAME; a leaf that carries `=`
    // ANYWHERE ELSE is still a fragment and is still refused.
    //
    // ⇒ THE CONTROL STAYS GREEN, WHICH IS THE POINT: `foo = bar` carries WHITESPACE and is still
    // refused; `foo=bar` carries `=` in the MIDDLE and is still refused; only a leaf that is a plain
    // identifier with a TRAILING `=` is exempt. And `[]=` — ruby's own index-setter — was already
    // exempt as an operator name; it stays exempt, and the two rules do not overlap.
    const SETTER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*=$/
    // ⇒⇒⇒ AND THE OPERATOR-NAME CLASS IS NOW COMPLETE, AND IT WAS NOT: THE CLASS WAS
    // `/^[<>=!+\-*/%^&|~]+$/`, WHICH DOES NOT INCLUDE `[` OR `]` — SO `[]` (ruby's index READER) AND
    // `[]=` (ruby's index WRITER) NEVER MATCHED IT. ⇒ THE RUBY LANE MEASURED THE CONSEQUENCE: 7 ROWS
    // STILL DROPPED AFTER THE SETTER EXEMPTION, **ALL SEVEN `[]=`**, ALL SEVEN WITH AN `=` IN THE
    // LEAF, ALL SEVEN EATEN BY THE FILTER ALONE, AND EVERY ONE'S `=`-STRIPPED CONTROL KEPT.
    // ⇒⇒⇒ AND THE LEAD'S OWN COMMIT MESSAGE CLAIMED "`[]=` — RUBY'S OWN INDEX-SETTER — WAS ALREADY
    // EXEMPT AS AN OPERATOR NAME", AND THE LEAD'S OWN COMMENT AT THE OTHER SITE LISTS `[]` AND `[]=`
    // AMONG RUBY'S LEGAL OPERATOR NAMES. ⇒⇒⇒ **THE COMMENT AND THE CODE DISAGREED, AND THE COMMENT
    // WAS RIGHT ABOUT THE LANGUAGE AND WRONG ABOUT THE CODE** — the class was never extended. ⇒⇒⇒
    // THAT IS THE FLEET'S SHAPE, AND IT IS THE LEAD'S OWN INSTANCE OF IT: A COMMENT STATING A FACT
    // ABOUT THE CODE WHICH THE CODE DOES NOT BEAR OUT. ⇒⇒⇒ THE CLASS IS NOW WHAT THE COMMENT SAYS
    // IT IS, AND THE MEASUREMENT IS THE RUBY LANE'S: with the class extended, the 7 still-dropped
    // rows become 0, and the controls stay green — `foo = bar` and `foo=bar` and `a = b` and `x==y`
    // are still refused, while `level=` and `ast_nodes=` and `[]` and `[]=` are kept.
    const OPERATOR_NAME = /^[<>=!+\-*/%^&|~\[\]]+$/
    if (/[\s'"(),=]/.test(leaf) && !OPERATOR_NAME.test(leaf) && !SETTER_NAME.test(leaf)) return false
    // THE ANGLE-BRACKET BAN, AND WHY IT MUST NOT BE UNCONDITIONAL (ruby lane, 2026-10-21).
    //
    // `<` and `>` are banned because a target carrying them is usually a SNIPPET or a template
    // fragment (`${x}`, `<div>`) and not an identifier. **BUT RUBY'S COMPARISON OPERATOR IS A
    // METHOD NAME — `<=>` — AND IT IS A REAL DECLARATION IN REAL CODE.** The ban deleted every
    // edge whose target was `<=>`, and the loss was SILENT and TOTAL for that class: the ruby lane
    // measured **12 rows over 8 files in 4 repos** (calls -2, contains -8, overrides -2; gql-ruby
    // x2, rack x3, rake x3 — early_time.rb, file_list.rb, late_time.rb, pseudo_status.rb) that the
    // analyzer emitted and this filter ate. `Comparable#<=>` is the operator behind `sort`,
    // `between?` and `clamp`, so this deleted real structure, not noise.
    //
    // ⇒ THE FIX IS THE OPERATOR SHAPE, NOT A RUBY EXEMPTION: a leaf that is ENTIRELY made of
    // operator characters is an OPERATOR NAME, and an operator name is a legal method name in
    // several languages (ruby's `<=>` `<=` `>=` `==` `!=` `===` `=~` `!~` `<<` `>>` `[]` `[]=`,
    // python's `__lt__`-adjacent spellings are words but `**` is not, and C's operators are not
    // identifiers at all so they never reach here as leaves). A leaf that MIXES operator characters
    // with letters (`Array<T>`, `<div>`) is still a fragment and is still banned.
    //
    // ⇒ THE BAN ITSELF IS NOT WEAKENED FOR SNIPPETS: a snippet carries braces, a backtick, a
    // newline or a tab, and those four remain unconditional; only the two angle brackets are
    // relaxed, and only for a leaf made SOLELY of operator characters.
    // THE SAME CLASS AS THE GUARD ABOVE, AND IT MUST BE THE SAME CLASS — two copies of an
    // operator-name test that disagree is how a comment ends up right about the language and
    // wrong about the code. Ruby's `[]` and `[]=` are legal method names, and the class says so.
    const isOperatorName = /^[<>=!+\-*/%^&|~\[\]]+$/.test(leaf)
    if (!isOperatorName && /[{}`<>\n\r\t]/.test(leaf)) return false
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
    // M60 FS-P4-3. THE EXEMPTION MUST BE TESTED ON THE SAME STRING AS THE NOISE TEST.
    //
    // The noise test is on the target's LEAF (`NOISE_TARGETS.has(leaf)`) and the
    // exemption was on the target AS WRITTEN. For a bare endpoint those are the same
    // string and the asymmetry is invisible; for a QUALIFIED one they are not, and the
    // exemption silently stops applying — so a file that declares `tearDown` has its own
    // containment edge eaten as framework noise.
    //
    // Not hypothetical, and found by measuring a spelling change rather than by reading
    // this function. `FsCheck/src/FsCheck/StateMachine.fs` declares `let tearDown` and
    // emits `contains FsCheck.Experimental.StateMachine -> StateMachine.tearDown@209`:
    //
    //   engine path 115 contains   production path 114   the missing one is that edge
    //
    // and it is the ONLY difference between the two paths on that file, so the
    // production filter is what deleted it.
    //
    // Scoped over the same 3,000-file corpus draw before and after the fsharp lane's
    // endpoint change: edges whose target leaf is in `NOISE_TARGETS` and whose name the
    // file DECLARES — 12 of 12 exempted before, 0 of 11 after. The filter was eating
    // exactly the edges it exists to protect, and only for endpoints whose spelling had
    // moved away from the bare name. Testing BOTH spellings keeps the block's power
    // (a name this file does not declare is still dropped) and restores the exemption
    // for every lane that spells an endpoint qualified.
    const declaredTarget =
      !!declaredNames &&
      (declaredNames.has(String(r.target ?? r.to ?? "")) || declaredNames.has(leaf))
    if (
      NOISE_TARGETS.has(leaf) &&
      !declaredTarget &&
      // UNION: main's second hatch — a name the file BINDS without declaring (an imported binding is
      // not framework noise). Absent here, present there, and the probe taken from main depends on it.
      !(boundNames && boundNames.has(leaf))
    ) {
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
      // WRAPPED, and the reason is measured rather than defensive habit. This debug line used
      // to be an unguarded `fs.appendFileSync`, six lines below an identical write to
      // `parse-errors.log` that IS wrapped in try/catch. Where the diagnostics directory is
      // not writable — a read-only `$HOME` in a sandbox, a full disk, a container with `~/.bb`
      // mounted read-only — the write THREW, and it threw AFTER `parseFile` returned, so the
      // whole file fell through to the extractFallback path. The dart lane measured the
      // consequence with a controlled A/B on the same 60 files and the same stride:
      //
      //     as run (unwritable diagnostics dir):     79 edges,  12 ambiguous,   0 unresolved
      //     BB_DATA_DIR=/tmp/bb-data (writable):  8,112 edges, 530 ambiguous, 2,273 unresolved
      //
      // 102.7x the denominator, and the incoming gate's own summary said
      // `parse failures: 0   degraded (regex fallback): 60` — an honest report of a lane
      // measured on its fallback path. A DEBUG LOG MUST NEVER DECIDE WHETHER AN ANALYZER RUNS.
      // Swallowing a failed diagnostic write is correct: the log is optional, the parse is not.
      try {
        fs.appendFileSync(
          bbDiagnosticsLogPath("worker-debug.log"),
          `[Worker] ASTEngine.parseFile returned ${parsed?.relationships?.length || 0} relationships for ${filePath}\n`,
        )
      } catch {}
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

    // ── THE INVARIANT: a symbol this function DROPS must not leave edges behind that name it ──
    //
    // MEASURED 2026-10-10 (fsharp lane). `keepSymbol` drops a symbol by NAME — its `UNIVERSAL`
    // set takes `this` and `super` unconditionally (`:545-548`) — while the RELATIONSHIPS were
    // never filtered at all, and could not be by that predicate: the filter is symbol-shaped and
    // a relationship carries endpoint STRINGS. So the symbol vanished and its edges stayed,
    // pointing at a symbol the consumer never received.
    //
    // The reproduction, on `fsharp/tests/service/data/SyntaxTree/Type/As 03.fs`:
    //   analyze()  publishes `Module` and `this<Module>`
    //   parseFile  returns  `Module` only
    //   and BOTH `contains Module -> Module.this` and `exports Module -> Module.this` survived.
    // The analyzer's own `contains` pass states the invariant that is violated: "the TARGET is
    // always an identity this file minted" (`real-fsharp-analyzer.ts:2174-2180`).
    //
    // The rule is deliberately one-directional: an edge is dropped only when an endpoint STRING
    // equals a name this call dropped AND no kept symbol still publishes that name. A name any
    // kept symbol carries is never dropped, so nothing is lost for a symbol the consumer DID
    // receive.
    //
    // SCOPE, because a measured fleet sweep is what sized it: this closes the DROPPED-SYMBOL
    // seam only. It does NOT close every containment target that fails to resolve — julia and
    // lua emit `exports` whose target was never a symbol identity at all (no symbol was dropped,
    // so there is nothing to drop an edge for), 681 and 618 edges on the same sweep. Those are a
    // different defect with a different owner, and this change is deliberately not widened to
    // cover them.
    // The drop-set must hold every IDENTITY the edges can name, not just the symbol's `name`:
    // `keepSymbol` filters on the NAME (`this`), while a containment edge names the symbol's
    // published identity (`Module.this` = its `metadata.fqn`). A first cut of this fix keyed the
    // set on `name` alone and was measured INERT on the very files it was written for — the set
    // held `this`, the edge said `Module.this`, nothing matched. The identities below are exactly
    // the ones `ret.symbols` publishes at `qualifiedName`, derived the same way, so the two
    // cannot drift.
    const identityOf = (s: any): string[] => {
      const out: string[] = []
      if (s?.name) out.push(String(s.name))
      if (s?.qualifiedName) out.push(String(s.qualifiedName))
      if (typeof s?.metadata?.fqn === "string" && s.metadata.fqn) out.push(String(s.metadata.fqn))
      if (s?.name) {
        out.push(
          s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : String(s.name)),
        )
      }
      return out
    }
    const keptSymbols: any[] = []
    const keptNames = new Set<string>()
    const notKept: any[] = []
    for (const s of parsed.symbols ?? []) {
      if (keepSymbol(s, parsed.language || language)) {
        keptSymbols.push(s)
        for (const id of identityOf(s)) keptNames.add(id)
      } else {
        notKept.push(s)
      }
    }
    const droppedNames = new Set<string>()
    for (const s of notKept) {
      for (const id of identityOf(s)) {
        // A symbol this call KEEPS may publish the same identity; then nothing is dropped.
        if (!keptNames.has(id)) droppedNames.add(id)
      }
    }

    const ret = {
      success: true,
      language: parsed.language || language,
      framework: parsed.metadata?.framework,
      fileHash: hash,
      sizeBytes,
      lastModified,
      symbols: keptSymbols.map((s: any) => {
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
          // SOL-16. `docstring` alone cannot answer "is this NatSpec, or a stray
          // `//` remark?" — and Solidity's documentation system has THREE forms
          // (`///`, the slash-star block, and a plain line comment), so the kind is
          // the difference between documented code and a comment that happened to sit
          // above a declaration. `docTags` is the structured half: the tags are inside
          // `docstring` already, but a consumer that wants `@param` names should not
          // have to re-parse prose, and `comments` is the per-comment array the
          // TypeScript lane populates for the same job, so a reader of Solidity
          // documentation should not have to learn a second shape.
          //
          // Purely additive, on the same terms as the CSS forwarding above: nothing
          // read these before, so no consumer changes behaviour.
          // SOL-22. A LICENCE is a file-level fact and the module symbol is the only
          // symbol that can carry it, so without this key a Solidity file's licence was
          // in the analyzer's payload and in no consumer's hands — the same seam as
          // `docstring` above, and the same terms: additive, nothing read it before.
          license: (s as any).license ?? (s.metadata as any)?.license ?? null,
          // SOL-23: the NatSpec-vs-signature findings, per symbol. Additive on the same
          // terms as the rest of this block.
          undocumentedParameters: (s as any).undocumentedParameters ?? null,
          // Data location (`transient` / `storage` / `memory` / `calldata`). Read by the
          // analyzer from the declaration's `location:` field, and invisible until it is
          // whitelisted here. The CORPUS cannot exercise it — this grammar reports
          // `transient` on the state-variable field rather than as a `layout_specifier`
          // node, and no OpenZeppelin contract at 5.5.0 declares one — so the fixture is
          // the only place this can be gated, which is worth knowing before anyone reads
          // a zero here as a broken path.
          stateLocation: (s as any).stateLocation ?? (s.metadata as any)?.stateLocation ?? null,
          overDocumentedParameters: (s as any).overDocumentedParameters ?? null,
          returnDocumentedWithoutReturn: (s as any).returnDocumentedWithoutReturn ?? false,
          docstringKind: (s as any).docstringKind ?? (s.metadata as any)?.docstringKind ?? null,
          docTags: (s as any).docTags ?? (s.metadata as any)?.docTags ?? null,
          comments: (s as any).comments ?? (s.metadata as any)?.comments ?? null,
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

            // ── bash, M60 ─────────────────────────────────────────────────────
            // The bash lane measured that it publishes 13 metadata keys and the
            // intersection with THIS allowlist was ZERO — 13 of 13 keys measure 0%
            // survival over 105 files, and on protoc.sh `analyze()` returns 22
            // symbols WITH metadata while `parseFile()` returns 22 symbols
            // WITHOUT it.
            //
            // Three labels this lane publishes are DERIVED from these keys:
            //   isExported        -> the `exports` label
            //   isImplicitBinding -> the round-4 implicit-binding families
            //   bindingSite       -> which construct bound the name
            //   isArray           -> the array-vs-scalar distinction
            // so each was verifiable where the ANALYZER runs and unverifiable where
            // the PRODUCT runs. An edge can be perfectly correct and its evidence
            // still be unreadable downstream — which is the question the six
            // questions do not ask.
            //
            // Four keys, not thirteen. The precedent at the markdown block above
            // states the rule this follows: only keys a READER CONSUMES belong
            // here. The other nine bash keys are read by nothing and forwarding
            // them would put unverifiable claims on every bash symbol.
            if (m.isExported === true) out.isExported = m.isExported
            if (m.isImplicitBinding === true) out.isImplicitBinding = m.isImplicitBinding
            if (typeof m.bindingSite === "string") out.bindingSite = m.bindingSite
            if (typeof m.isArray === "boolean") out.isArray = m.isArray

            // ── the type hierarchy, M60/php (and every other lane that
            // declares one) ──────────────────────────────────────────────────
            // SDJ-8 writes this key into `brain_symbol.super_types` at
            // `parallel-indexer.ts` and the comment there says it is "published
            // by every analyzer on symbol.metadata.superTypes and discarded
            // here". It was right about the discard, and the discard was not at
            // that binding: it was HERE, in the allowlist above, which did not
            // name the key. So the binding read `undefined` for every symbol in
            // every language and wrote NULL for all of them, and a column that
            // SDJ-8 documents as the hierarchy a consumer walks was, on real
            // projects, empty.
            //
            // Measured on php, through the production path, with
            // `script/m60/php-store-pipeline-seam.ts`: the analyzer published
            // `metadata.superTypes` on 8 of 8 class-like symbols in two fixture
            // sources and the store held the column on **0** — while the same
            // two sources' `extends`/`implements` EDGES (11 rows) arrived
            // intact. On a real project the count was 0 of 4,940. That gap is
            // not a rendering detail: `override-retarget.ts` opens with
            // `if (supertypes.size === 0) return out`, so a NULL column means the
            // pass never runs and php has no project-wide hierarchy at all — not
            // a thin one, none — and the `owner+inherited` resolution lever the
            // ambiguity census priced at 24,223 endpoints cannot be implemented
            // by any downstream consumer until the column carries the fact.
            //
            // The rule above still holds, and it is why this is a one-key
            // widening rather than "forward metadata": the reader is
            // enumerable and there is exactly one of it
            // (`parallel-indexer.ts`'s INSERT). Unlike the CSS/markdown/bash
            // blocks this key is NOT language-scoped — kotlin, scala, php, go
            // and the rest all publish it under this exact name — so a
            // per-language switch here would only move the drop somewhere
            // nobody looks. Carried only when non-empty, mirroring the store's
            // own emptiness test: `[]` and absent are one fact downstream, and
            // the store already writes NULL for both.
            if (Array.isArray(m.superTypes) && m.superTypes.length > 0) out.superTypes = m.superTypes
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
        /**
         * ROUND 17 — TWO FACTS THE ANALYZER PUBLISHES AND THIS PROJECTION DROPPED, which is why
         * `brain_import.imported_as` had NO writer on the AST path for any language while the
         * fallback path had one (M60), and why the classification five lanes declare never reached
         * the column the file-dependency engine reads.
         *
         *   alias       `ImportInfo.alias` covers `import X as Y` (python, typescript). Python's
         *               from-imports publish their bindings PER ITEM on `ImportInfo.itemBindings`,
         *               which one `alias` cannot express (`from m import a as b, c as d` is two
         *               bindings) — the seam's row id is per STATEMENT (`module:line`) while this
         *               projection emits one row per ITEM, and the insert is `INSERT OR REPLACE`, so
         *               the LAST item of a statement is what survives; the binding therefore has to
         *               ride the item. Measured over the python population: **3,333** aliased
         *               statements whose binding can reach the store (2,893 single-item, 20 whose
         *               aliased item is last, 420 `import X as Y`), **6** that cannot (the aliased
         *               item is not last — the six files are named in
         *               `.tmp-py/price-last-item-wins.py`), and 41,560 where NULL is the CORRECT
         *               value. The first price this round ran (`.tmp-py/price-import-alias-seam.py`)
         *               bucketed by FIRST-vs-LATER and is superseded: the row semantics it assumed
         *               are the opposite of the measured ones, which the probe
         *               `.tmp-py/probe-import-rows.mts` shows directly (`… Sku as SKU, fixture`
         *               stores `fixture`; `… fixture, Sku as SKU2` stores `Sku as SKU2`).
         * NOT CARRIED HERE, and measured rather than waved at: the analyzer's `importType` (declared
         * by makefile, objective-c, sql, xml, yaml, markdown, erlang, java, julia and clojure) is
         * put into this projection's `type` field, which the indexer does not read — it reads
         * `imp.importType` — so those lanes' classification is dropped for the store. Passing it
         * through is a VOCABULARY decision, not a plumbing one: `brain.sql.ts` documents
         * `import_type` as `"default", "named", "namespace", "side_effect"` while those lanes
         * declare `make_include`, `include`, `sql_extension`, `java-module-requires`, …, so storing
         * them would widen a documented contract. Python's own `import_type` is separately wrong
         * for the same reason in reverse: the projection computes `"namespace"` for `import X`
         * (correct) and for a from-import too (because the analyzer sets `isNamespace: true` on
         * both), so `baseType` cannot be trusted as a classification for this lane. Pinned at its
         * current value by `import-bound-name-seam.mts` (check B) so it cannot drift unseen.
         */
        const bindings = new Map<string, string>()
        for (const b of (Array.isArray((i as any).itemBindings) ? (i as any).itemBindings : [])) {
          if (b && typeof b.name === "string" && typeof b.as === "string" && b.name && b.as) {
            bindings.set(b.name, b.as)
          }
        }
        const itemCount = items.length
        // A statement-wide `alias` is exact only when the statement has ONE item, i.e. when the
        // binding cannot belong to a different item. A multi-item statement relies on the per-item
        // list, which is the only shape that can distinguish `from m import a, c as d`.
        const statementAlias = itemCount === 1 && typeof i.alias === "string" && i.alias
          ? i.alias
          : itemCount === 1 && typeof i.localName === "string" && i.localName
            ? i.localName
            : undefined
        return items
          .filter((name: string) => typeof name === "string" && name.length > 0)
          .map((name: string) => {
            // "X as Y" → `name` is the IMPORTED name, `alias` the LOCAL BINDING.
            //
            // ROUND 17: this read `asMatch[2]` for BOTH, so the imported name was thrown away and
            // `name` became the bound name — the one shape where the projection disagreed with the
            // convention the fallback path's own comment states ("`name` keeps its original meaning,
            // the imported name"). Measured consequence on the pipeline: `import { A as B } from
            // "./a"` reached the indexer as `{name:"B", alias:"B"}`, so `imported_name` and
            // `imported_as` were the SAME string and the imported `A` was nowhere in the store —
            // while `patterns.ts` computes `usedName = imported_as || imported_name` and would have
            // been right by accident. With the roles split, a consumer can tell which name the
            // source module declares from which name this file binds.
            const asMatch = name.match(/^(\S+)\s+as\s+(\S+)$/)
            const importedName = asMatch ? asMatch[1] : name
            // Strip `type` qualifier: "type Repository" → "Repository"
            const cleanName = importedName.replace(/^type\s+/, "").trim()
            const boundName = asMatch ? asMatch[2] : (bindings.get(name) ?? statementAlias)
            return {
              name: cleanName,
              path: i.module || i.path || "",
              ...(boundName ? { alias: boundName } : {}),
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
      // THE DROPPED-SYMBOL INVARIANT — see `droppedNames` above. An edge that names a symbol
      // this call filtered out is not a weaker edge, it is an edge to nothing, so it goes with
      // the symbol. Applied BEFORE the noise filter so the two are independent and either can
      // be measured alone.
      relationships: filterNoiseRelationships(
        droppedNames.size
          ? (parsed.relationships ?? []).filter((r: any) => {
              const type = String(r?.type ?? r?.relationshipType ?? "")
              const src = String(r?.source ?? r?.from ?? "")
              const tgt = String(r?.target ?? r?.to ?? "")
              // (b) THE MODULE LEAF IS SYNTHETIC (2026-10-19, TS lane's sized shared-pipeline
              // defect): an `imports`/`exports` row's SOURCE is the file's module leaf, not a
              // symbol identity — if a dropped symbol's name happens to equal that stem, this
              // invariant was deleting the ENTIRE import/export surface of the file. Measured on
              // the admitted population: 16 JS_GLOBAL-stem files, 2 affected, 49 delivered edges
              // silently lost (shopify `process.ts`: 17 imports + 1 exports + calls/references/
              // uses/instantiates; phpmyadmin `console.ts`: 10 calls). Only the SYNTHETIC source
              // is exempted here; real symbol endpoints still obey the invariant.
              if ((type === "imports" || type === "exports") && droppedNames.has(src)) return true
              return !droppedNames.has(src) && !droppedNames.has(tgt)
            })
          : parsed.relationships,
        language,
        new Set((parsed.symbols ?? []).map((s: any) => String(s?.name ?? "")).filter(Boolean)),
      ),
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
      // THE SECOND of the two dart debug writes, and the one that actually decided the
      // measurement. Wrapping only the first left the degradation in place: the controlled
      // A/B still read `degraded (regex fallback): 60` and 79 edges with an unwritable
      // diagnostics directory, against 8,112 edges with a writable one. This write sits on
      // the success path immediately before `return ret`, so its throw aborted the return and
      // the caller fell through to the fallback — i.e. a debug line decided whether the
      // analyzer ran. Both are wrapped now; the log is optional, the parse is not.
      try {
        fs.appendFileSync(
          bbDiagnosticsLogPath("worker-debug.log"),
          `[Worker] Returning object with ${ret.relationships?.length || 0} relationships for ${filePath}\n`,
        )
      } catch {}
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
    // ONE return, not two. The `if (isExpected)` branch this replaced returned
    // exactly what the line below it returned — identical arguments, identical
    // value — so the branch could only ever be dead. That matters here because
    // `isExpected` LOOKS like a decision: a reader (or a future editor) has to
    // re-derive that the "expected" failures take no different path, and can
    // easily conclude the opposite and give a supported file type a
    // regex-only result. `isExpected` still has exactly one job — it decides
    // whether the error is worth a stderr line.
    return extractFallback(content, lang, hash, sizeBytes, lastModified)
  }
}

/**
 * The startup work, factored out so the IPC handshake and the self-test cannot
 * disagree about what "started" means.
 *
 * Two callers, one implementation, deliberately:
 *
 *   - the `warmup` IPC message, which answers `ready` afterwards;
 *   - `BB_POOL_WORKER_SELFTEST=1`, which prints a machine-readable line and
 *     exits, so `bb doctor` can verify a worker from a SYNCHRONOUS caller
 *     (`runDoctorChecks` is sync and src/cli/index.ts calls it without `await`).
 *
 * If these were written twice they would drift, and the drift would be silent
 * and one-sided: doctor would keep reporting a healthy worker while indexing
 * quietly fell back to regex.
 */
async function warmUpWorker(): Promise<{ engine: "ok" | "unavailable"; wasm: "ok" | "unavailable" }> {
  // Pre-load the WASM registry and engine before processing.
  // Registry loads core grammars only with 10s timeout per import.
  //
  // Both of these used to be `catch {}`. A failure in either one left the
  // worker alive, holding the IPC channel, answering `ready`, and then parsing
  // every file with regex extraction while reporting success — see the note on
  // reportStartupProblem above. A degraded worker now SAYS SO on stderr (which
  // the parent forwards) and in the `ready` payload (which the parent's `ready`
  // branch ignores, so this changes no control flow).
  let wasm: "ok" | "unavailable" = "ok"
  try {
    const { ensureWasmRegistry } = await import("../util/wasm")
    await ensureWasmRegistry()
  } catch (e: any) {
    wasm = "unavailable"
    reportStartupProblem("wasm registry unavailable — tree-sitter grammars may not load", e)
  }

  let engine: "ok" | "unavailable" = "ok"
  try {
    engineModule = await import("./engine")
    if (!engineModule?.ASTEngine) {
      engine = "unavailable"
      reportStartupProblem("engine module loaded but exports no ASTEngine", new Error("ASTEngine missing"))
    }
  } catch (e: any) {
    engine = "unavailable"
    reportStartupProblem("engine module failed to load — falling back to regex extraction for EVERY file", e)
  }
  return { engine, wasm }
}

/** Persist startup problems where someone will find them without a terminal. */
function persistStartupDiagnostics(): void {
  if (startupDiagnostics.length === 0) return
  // stderr only reaches whoever happened to be watching. Same place parse errors
  // already go: $BB_DATA_DIR/logs/.
  try {
    fs.appendFileSync(
      bbDiagnosticsLogPath("worker-startup.log"),
      `${new Date().toISOString()} | pid=${process.pid} | node=${process.version} | ${startupDiagnostics.join(" | ")}\n`,
    )
  } catch {}
}

/**
 * One-shot startup self-test: `BB_POOL_WORKER_SELFTEST=1 node <this file>`.
 *
 * Prints `[BB-WORKER-SELFTEST] {json}` on stdout and sets an exit code. It runs
 * the SAME `warmUpWorker()` the IPC handshake runs, so it exercises the real
 * module graph — a native module built for another platform, an uninstalled
 * import, or a missing engine all show up here rather than being discovered
 * halfway through an index run.
 *
 * Exits 0 when the engine and the grammars both loaded, 1 when either did not.
 * A non-zero exit is NOT "the pool cannot start": the worker still indexes, it
 * just indexes with regex. `diagnosePoolStartupSync` reports that as `degraded`,
 * which is why the distinction matters.
 *
 * Nothing here is written to stderr on the happy path, so `bb doctor` stays
 * quiet for a healthy install.
 */
async function runSelfTest(): Promise<number> {
  const { engine, wasm } = await warmUpWorker()
  persistStartupDiagnostics()
  const report = {
    ok: engine === "ok" && wasm === "ok",
    engine,
    wasm,
    node: process.version,
    pid: process.pid,
    execPath: process.execPath,
    diagnostics: startupDiagnostics.slice(0, 5),
  }
  process.stdout.write(`[BB-WORKER-SELFTEST] ${JSON.stringify(report)}\n`)
  return report.ok ? 0 : 1
}
// IPC message handler
process.on("message", async (msg: any) => {
  if (msg.type === "warmup") {
    // Timed, because a startup TIMEOUT is otherwise undiagnosable from the
    // worker's side. The parent kills this process if `ready` has not arrived
    // within its watchdog and reports "worker did not become ready within
    // startup timeout"; when that happens on a slow machine or a cold cache
    // there is nothing in the log to say whether the worker was dead or merely
    // still loading grammars. It announces itself now.
    //
    // The threshold is half the parent's watchdog, read from the same env var.
    // `poolStartupTimeoutMs()` in ./pool-diagnostics is the canonical reader;
    // it is deliberately NOT imported here — this file is the one process that
    // must never fail to LOAD, so it keeps a dependency-free import graph — and
    // the only thing at stake is when to print a note, never whether to fail.
    const watchdogMs = Number(process.env.BB_WORKER_STARTUP_TIMEOUT_MS || 0) || 30_000
    const slowWarmNote = setTimeout(() => {
      process.stderr.write(
        `[BB-WORKER-STARTUP] still warming after ${Math.round(watchdogMs / 2)}ms ` +
          `(loading tree-sitter grammars); the parent's watchdog is ${watchdogMs}ms\n`,
      )
    }, Math.max(1, Math.round(watchdogMs / 2)))
    slowWarmNote.unref?.()

    const { engine: engineStatus, wasm: wasmStatus } = await warmUpWorker()
    // The parent has always handled `engine_fail` (parallel-indexer.ts:1557):
    // it counts the worker, reports the reason, and puts it in the idle pool
    // because regex extraction still parses files. Sending it activates a dead
    // branch and changes no outcome — it only stops the degradation from being
    // invisible.
    if (engineStatus === "unavailable") {
      safeSend({ type: "engine_fail", workerId: msg.workerId, error: startupDiagnostics.join(" | ") })
    }

    // M21.W1 debug hook: BB_WORKER_DELAY_READY_MS delays the `ready` signal so
    // the parent's startup watchdog can be exercised deterministically.
    // M40.A8: quarantined behind BB_TEST_HOOKS=1 — a stray env var can no
    // longer stall a production index's worker startup.
    if (process.env.BB_TEST_HOOKS === "1") {
      const delayReady = Number(process.env.BB_WORKER_DELAY_READY_MS || 0)
      if (delayReady > 0) await new Promise((r) => setTimeout(r, delayReady))
    }
    clearTimeout(slowWarmNote)

    // The extra fields are ADDITIVE. The parent branches on `msg.type` only, so
    // this payload is inert against today's indexer and free evidence for
    // `bb doctor` / a future parent that wants to report a degraded pool.
    safeSend({
      type: "ready",
      workerId: msg.workerId,
      pid: process.pid,
      node: process.version,
      execPath: process.execPath,
      engine: engineStatus,
      wasm: wasmStatus,
      diagnostics: startupDiagnostics.slice(0, 5),
    })

    persistStartupDiagnostics()
  } else if (msg.type === "parse_batch") {
    const { batchId, files, projectPath, projectIndexes } = msg
    // SOL-21. A project index, when the parent built one, deserialised ONCE per worker
    // and cached for the worker's lifetime — a worker is forked once and then serves many
    // batches, so rebuilding per batch would re-parse the project for every batch.
    //
    // It arrives as a PLAIN object because `fork()` serialises IPC with JSON and JSON
    // cannot carry a `Map`; a `Map` would arrive as `{}` and the index would silently
    // resolve nothing, which looks like "the feature does not work" rather than "the
    // transport dropped it". `deserializeProjectIndex` refuses a payload it does not
    // fully understand instead of best-effort parsing it, so a format change is a
    // no-enrichment outcome and never a wrong answer.
    //
    // A worker that cannot deserialise gets NO index, which is exactly the pre-SOL-21
    // per-file behaviour. Enrichment is therefore additive and never load-bearing.
    let indexCache: Map<string, ProjectIndex> | null = null
    if (projectIndexes !== undefined && projectIndexes !== null) {
      try {
        const mod: any = await import("./project-index")
        indexCache = new Map()
        for (const [lang, raw] of Object.entries(projectIndexes as Record<string, unknown>)) {
          const built = mod.deserializeProjectIndex(raw)
          if (built !== null) {
            mod.buildResolutionTables(built)
            indexCache.set(lang, built)
          }
        }
      } catch (e: any) {
        log(`[Worker] project index unavailable, continuing per-file: ${e?.message ?? e}`)
        // Reported, not swallowed. The comment above says enrichment is
        // additive and never load-bearing, which is true — so this used to be
        // safe to discard entirely, and the cost was that a project index that
        // fails on EVERY file is indistinguishable from one that was never
        // built. It costs one stderr line to keep them apart.
        reportStartupProblem("project index unavailable, indexing per-file", e)
        indexCache = null
      }
    }
    const extnameOf = (p: string): string => {
      const base = p.slice(p.lastIndexOf("/") + 1)
      const dot = base.lastIndexOf(".")
      return dot <= 0 ? "" : base.slice(dot).toLowerCase()
    }
    const contextFor = (filePath: string): ASTEngine.AnalyzeContext | undefined => {
      const root = String(projectPath ?? "") || undefined
      // THE ROOT DOES NOT COME FROM THE INDEX, so neither guard may gate it. This function used to
      // return `undefined` unless a PROJECT INDEX existed for the extension — and `indexCache` is
      // `null` unless the worker was handed indexes at all, which happens only for languages with an
      // index spec (`INDEX_SPECS` carries `dart` alone). So for every other language production
      // handed the analyzer NO CONTEXT, and with it no `projectRoot`.
      //
      // Found by json-lane (2026-10-10, `6fc778018`) and measured on both sides: the store held json
      // qualified names UNSCOPED (`11152[3].fileSize`; 39 symbols across 39 files all named
      // `functions` with qualified name `functions`) while the gate and every census — which pass
      // `projectRoot` explicitly — measured them SCOPED (`data.json.11152[3].fileSize`). **The two
      // instruments were therefore measuring DIFFERENT KEY SPACES**, and every cross-file collision
      // the document scope exists to prevent was present in production and absent from the model.
      // It also explains why the store binds these edges so readily: `resolveTargetStmt` matches
      // `s.name` with `LIMIT 1`, and unscoped names collide heavily, so the tie-break decides far
      // more often than the gate's numbers suggest.
      //
      // NOT json-specific: any lane whose language has no index spec was indexed without a root, so
      // every analyzer deriving identity from `projectRoot` published one spelling to the gate and
      // another to the store. Those analyzers are dart, json, php, toml, typescript and yaml — and
      // dart is the only one with an index spec, so the other five are the blast radius.
      //
      // SAFE BY TYPE, not by hope: `AnalyzeContext.projectIndex` is OPTIONAL and ADDITIVE — "an
      // analyzer that does not read this field behaves exactly as it did before it existed, byte for
      // byte" — so a context carrying only a root cannot break a reader that wants an index.
      //
      // M60 yaml lane (2026-10-09), whose note follows, added `projectRoot` riding the index; the
      // index was never the right carrier. `projectPath` is in the `parse_batch` message
      // (`pool-worker.ts:1703`) and was until now passed only to `parseFile`'s second argument,
      // where no analyzer could see it.
      if (indexCache === null) return root === undefined ? undefined : { projectRoot: root }
      const ext = extnameOf(filePath)
      const built = indexCache.get(ext)
      if (built === undefined) return root === undefined ? undefined : { projectRoot: root }
      return { projectIndex: built, projectRoot: root }
    }
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
        safeSend({ type: "file_start", batchId, filePath })
        await new Promise((r) => setTimeout(r, 0))
        // M21.W1 fixture hook: per-file delay AFTER file_start (see above).
        if (delayParse > 0) await new Promise((r) => setTimeout(r, delayParse))

        // Self-timeout: kill worker if file processing hangs (doesn't rely on parent process)
        const fileTimer = setTimeout(() => {
          log(`Worker self-timeout: killing process after ${FILE_TIMEOUT_MS}ms on ${filePath}`)
          process.exit(1)
        }, FILE_TIMEOUT_MS)

        const result = await parseFile(filePath, projectPath, contextFor(filePath))
        clearTimeout(fileTimer)

        safeSend({ type: "file_done", batchId, filePath, result })
      } catch (err) {
        safeSend({
          type: "file_error",
          batchId,
          filePath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    safeSend({ type: "batch_done", batchId })
  }
})

// Prevent exiting
process.on("disconnect", () => process.exit(0))

// Self-executing worker entry (compiled dist: `node dist/pool-worker.js`).
// The IPC channel alone keeps a forked child alive, but hold the event loop
// explicitly so this entry works under every runtime (plain Node, tsx, Bun).
//
// THE CONDITION IS THE IPC CHANNEL, NOT THE ENV VAR — and getting that wrong
// was a "workers don't start" bug that reported itself as something else
// entirely.
//
// `BB_POOL_WORKER=1` is set BY THE PARENT for its children
// (parallel-indexer.ts:1516 and 4543), so an exported `BB_POOL_WORKER=0` —
// which reads like a supported "don't use the pool" switch, and which the
// product's own remediation text would tell a user to set — reached every
// forked worker as `!== "1"`. The child then skipped this keep-alive, ran out
// of work, and exited 0 WITHOUT EVER SENDING `ready`. The fork probe's `exit`
// handler only rejects a NON-zero code (parallel-indexer.ts:4562), so the
// promise never settled: every index run sat for the probe's full 60 s
// timeout, then reported "worker pool unavailable (worker fork test timed out
// after 60s)" and silently switched to in-process indexing. Turning off the
// pool was supposed to be faster; it was a minute-long stall.
//
// A forked child is exactly a process with a live IPC channel, so that is the
// condition. The env var is still read — as evidence, below — because a
// misconfigured env is worth saying out loud, and `process.connected` is false
// when this entry is run standalone (`node dist/pool-worker.js`), which is
// where the original check was right.
if (process.connected) {
  if (process.env.BB_POOL_WORKER !== "1") {
    process.stderr.write(
      `[BB-WORKER-STARTUP] forked with BB_POOL_WORKER=${JSON.stringify(process.env.BB_POOL_WORKER ?? null)} rather than "1"; ` +
        `serving anyway — unset BB_POOL_WORKER to use in-process indexing\n`,
    )
  }
  setInterval(() => {}, 1 << 30)
}

// Startup self-test: `BB_POOL_WORKER_SELFTEST=1`. Runs the same warm-up the
// `warmup` message runs and exits, so `bb doctor` can verify a worker without an
// IPC handshake and without making the CLI's synchronous call path async.
//
// Deliberately NOT top-level await: this file is bundled by tsup and a top-level
// await in the entry would constrain the whole bundle's output shape. A promise
// chain sets the exit code instead, which is all this needs.
if (process.env.BB_POOL_WORKER_SELFTEST === "1" && !process.connected) {
  runSelfTest().then(
    (code) => {
      process.exitCode = code
    },
    (e: any) => {
      // A self-test that throws is itself a result: the worker cannot even start.
      process.stderr.write(`[BB-WORKER-SELFTEST] failed: ${e?.message ?? String(e)}\n`)
      process.exitCode = 1
    },
  )
}
