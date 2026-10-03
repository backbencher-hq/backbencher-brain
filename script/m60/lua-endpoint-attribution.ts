/**
 * M14 ONTOLOGY — LUA WAVE-2 ENDPOINT ATTRIBUTION.
 *
 * Pass 2 of the wave-2 audit found, on the whole admitted corpus:
 *
 *   44 `references` edges whose TARGET is a Lua reserved word (`function`, `nil`,
 *   `local`), 3 `calls` (target `true` / `false`), 2 `uses` (`for`, `in`), 2
 *   `exports` (`local`), 808 `uses` and 180 `contains` and 46 `extends` whose
 *   endpoint is a LITERAL (`self`, `_G`, `_ENV`, `nil`).
 *
 * A count is not a verdict. The BASH lane measured 30 `calls` edges whose target
 * was a POSIX reserved word and every one was a FABRICATION — tree-sitter's error
 * recovery reads a keyword as a `command_name`. The identical-looking shape in
 * Lua could be the same defect or the opposite: `v['function']` writes the string
 * "function" as a table key, which is a REAL member name that happens to be
 * unspellable as an identifier. Those two readings demand opposite fixes, so
 * guessing is not available and this probe exists to settle it.
 *
 * WHAT THIS DOES: it walks the parse tree with its OWN visitor — it never calls
 * the analyzer and shares no rule table with it — and for every occurrence of a
 * reserved word or a literal in a POSITION THAT COULD PRODUCE AN EDGE, records
 * the node type and the role, plus the source line. An occurrence inside an
 * ERROR node is counted separately, because that is the fabrication signature.
 *
 * The two counts are then read against the audit's edge counts, and the report
 * states agreement or disagreement rather than assuming either.
 *
 * USAGE: npx tsx script/m60/lua-endpoint-attribution.ts [--cap N]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.resolve(ROOT, process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]!
  : "validation/m60/lua/endpoint-attribution.json")
const CAP = Number(process.argv.includes("--cap") ? process.argv[process.argv.indexOf("--cap") + 1] : "0")

const RESERVED = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
])
const LITERALS = new Set(["nil", "true", "false", "...", "self", "_ENV", "_G"])

interface Hit { role: string; nodeType: string; inError: boolean; file: string; line: number; text: string }
const reservedHits: Hit[] = []
const literalHits: Hit[] = []
/** role -> count. The role is the PARENT node type plus which field/position, which
 * is the only thing that decides whether an edge built on it is a name. */
const reservedByRole = new Map<string, number>()
const literalByRole = new Map<string, number>()
/** The fabrication signature: a reserved word reached only through ERROR. */
let reservedInError = 0
let literalInError = 0
/** Per-file counts so a nondeterministic file can be identified from two runs. */
const perFile = new Map<string, { reserved: number; literal: number }>()
let filesWithReserved = 0, filesWithLiteral = 0

const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  const drawn = CAP > 0 ? tracked.slice(0, CAP) : tracked
  for (const rel of drawn) files.push({ repo: e, rel, abs: path.join(dir, rel) })
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

/** Which role does this identifier occupy? This mirrors the analyzer's DISPATCH
 * (which node types it acts on) without reusing its code: an edge can only be
 * built from a position the analyzer visits, so anything else is irrelevant. */
function roleOf(node: any): string {
  const p = node.parent
  if (!p) return "orphan"
  const pt = p.type
  if (pt === "bracket_index_expression") {
    const f = p.childForFieldName("field")
    if (f && f.startIndex === node.startIndex && f.endIndex === node.endIndex) {
      return f.type === "string" ? "bracket_index_STRING_KEY" : `bracket_index_${f.type}`
    }
    return "bracket_index_table"
  }
  if (pt === "dot_index_expression") return p.namedChild(p.namedChildCount - 1)?.startIndex === node.startIndex ? "dot_index_FIELD" : "dot_index_table"
  if (pt === "method_index_expression") return p.namedChild(p.namedChildCount - 1)?.startIndex === node.startIndex ? "method_index_FIELD" : "method_index_table"
  if (pt === "function_call") {
    const n = p.childForFieldName("name")
    if (n && n.startIndex === node.startIndex) return "function_call_NAME"
    return "function_call_argument"
  }
  if (pt === "function_declaration") {
    const n = p.childForFieldName("name")
    if (n && n.startIndex === node.startIndex) return "function_declaration_NAME"
    return "function_declaration_other"
  }
  if (pt === "variable_list") return "variable_list_DECLARATION"
  if (pt === "parameters") return "parameters_BINDING"
  if (pt === "assignment_statement") return p.namedChild(0)?.startIndex === node.startIndex ? "assignment_LHS_0" : "assignment_LHS_N_or_RHS"
  if (pt === "field") {
    const n = p.childForFieldName("name")
    if (n && n.startIndex === node.startIndex) return "field_KEY"
    return "field_value"
  }
  if (pt === "variable_declaration") return "variable_declaration_value"
  if (pt === "return_statement") return "return_value"
  return `other:${pt}`
}

/** Is this node inside an ERROR node? That is the fabrication signature the bash
 * lane measured: recovery reached a keyword and the analyzer published it. */
function insideError(node: any): boolean {
  let n = node.parent
  let depth = 0
  while (n && depth++ < 200) {
    if (n.type === "ERROR") return true
    n = n.parent
  }
  return false
}

let parseFailures = 0
for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let t: any
  try { t = parser.parse(text) } catch { parseFailures++; continue }
  if (!t) { parseFailures++; continue }
  const label = `${f.repo}/${f.rel}`
  let fileReserved = 0, fileLiteral = 0
  const v = (n: any) => {
    // A reserved word or literal reaches an edge endpoint through TWO node types,
    // and the first version of this probe read only `identifier`. That is how it
    // reported 3 reserved hits against the audit's 51 reserved-word EDGES — the
    // probe was not contradicting the analyzer, it was looking at half the
    // grammar. `assert.is["true"](x)` writes the member's name as a `string`, so
    // the node carrying the name "true" is a `string`, not an `identifier`, and
    // it is a REAL name written with bracket syntax rather than a fabrication.
    // Both node types are read here, and each is labelled by its own node type so
    // the two are never summed into one claim.
    const consider = (n: any, isString: boolean) => {
      const raw = String(n.text ?? "").trim()
      // A `string` node's text carries its quotes; the NAME is the content.
      const txt = isString ? raw.replace(/^(['"])|(['"])$/g, "") : raw
      const isReserved = RESERVED.has(txt)
      const isLiteral = !isReserved && LITERALS.has(txt)
      if (!isReserved && !isLiteral) return
      const role = roleOf(n)
      const err = insideError(n)
      const kind = `${n.type}:${role}`
      if (isReserved) {
        reservedByRole.set(kind, (reservedByRole.get(kind) ?? 0) + 1)
        if (err) reservedInError++
        fileReserved++
        if (reservedHits.length < 400) reservedHits.push({
          role: kind, nodeType: n.type, inError: err, file: label,
          line: n.startPosition.row + 1, text: String(n.text ?? "").slice(0, 60),
        })
      } else {
        literalByRole.set(kind, (literalByRole.get(kind) ?? 0) + 1)
        if (err) literalInError++
        fileLiteral++
        if (literalHits.length < 400) literalHits.push({
          role: kind, nodeType: n.type, inError: err, file: label,
          line: n.startPosition.row + 1, text: String(n.text ?? "").slice(0, 60),
        })
      }
    }
    if (n.type === "identifier") consider(n, false)
    // A `string` only counts when it is the field of a bracket subscript, i.e.
    // exactly the position a `references`/`calls` target is built from. Any other
    // string is a value and cannot reach an endpoint.
    else if (n.type === "string") {
      const p = n.parent
      if (p && p.type === "bracket_index_expression") {
        const f = p.childForFieldName("field")
        if (f && f.startIndex === n.startIndex && f.endIndex === n.endIndex) consider(n, true)
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) v(c) }
  }
  v(t.rootNode)
  if (fileReserved) filesWithReserved++
  if (fileLiteral) filesWithLiteral++
  perFile.set(label, { reserved: fileReserved, literal: fileLiteral })
}

const out = {
  schemaVersion: 1, kind: "lua-endpoint-attribution",
  note: "independent tree walk; shares no rule table with the analyzer. A reserved word in a bracket_index_STRING_KEY is a REAL member name that happens to be unspellable; a reserved word reached through ERROR is the fabrication signature the bash lane measured.",
  files: files.length, parseFailures,
  reserved: {
    totalHits: [...reservedByRole.values()].reduce((a, b) => a + b, 0),
    byRole: Object.fromEntries([...reservedByRole].sort((a, b) => b[1] - a[1])),
    insideError: reservedInError,
    filesWithReserved,
    examples: reservedHits.slice(0, 60),
  },
  literals: {
    totalHits: [...literalByRole.values()].reduce((a, b) => a + b, 0),
    byRole: Object.fromEntries([...literalByRole].sort((a, b) => b[1] - a[1])),
    insideError: literalInError,
    filesWithLiteral,
    examples: literalHits.slice(0, 60),
  },
  perFileReservedLiteral: Object.fromEntries(perFile),
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`files ${files.length} parseFailures ${parseFailures}`)
console.log(`RESERVED hits ${out.reserved.totalHits} in ${filesWithReserved} files; insideError ${reservedInError}`)
for (const [r, n] of Object.entries(out.reserved.byRole)) console.log(`   ${String(n).padStart(6)}  ${r}`)
console.log(`LITERAL  hits ${out.literals.totalHits} in ${filesWithLiteral} files; insideError ${literalInError}`)
for (const [r, n] of Object.entries(out.literals.byRole)) console.log(`   ${String(n).padStart(6)}  ${r}`)
console.log(`-> ${OUT}`)