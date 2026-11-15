/**
 * CS3 / csharp — `exports` CONSTRUCT CENSUS. Measure before implementing.
 *
 * ## The question
 *
 * `exports` is the one silent type on the RELATIONSHIP channel that this lane
 * could plausibly close, and the workstream's rule is explicit: a missing type is
 * a GAP only when "the language HAS the construct", and that has to be MEASURED
 * on real code, not argued.
 *
 * So this census answers two questions on the tree, where a string literal cannot
 * fake a construct:
 *
 *   A. VOCABULARY — every node type the grammar actually produces across the
 *      corpus, with the node types that would express an export declaration.
 *   B. POPULATION — how many declarations carry an accessibility modifier, how
 *      they break down, and how many an `exports` edge would name under three
 *      candidate rules. The three rules are counted rather than chosen, because
 *      the choice between them is a MODELLING decision and the numbers are what
 *      make it defensible.
 *
 * ## What already exists, so nothing is invented here
 *
 * The analyzer already computes the whole fact. `extractVisibility` reads the
 * grammar's `modifier` children (real-csharp-analyzer.ts, "public" / "private" /
 * "protected" / "internal" / "file"), and `res.exports[]` is already published
 * for namespace-free top-level types (lines 1452 and 1494). So the question is
 * not "can the analyzer see accessibility" — it can — but "which of these
 * declarations belongs in the graph's export surface, and does anything read the
 * channel it already writes to".
 *
 * ## No regular expression
 *
 * MASTER-HANDOFF rule 1. Every count below is a node walk: `node.type`,
 * `namedChild`, `childForFieldName`. `String.prototype.includes` is used only to
 * compare an accessibility token against a fixed list, never against source text.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const NFILES = Number(process.env.NFILES || 400)
const REPO_ONLY = process.env.BB_REPO || "roslyn-cs"
const LANG = "csharp"

// The node types that would EXPRESS an export declaration, if the language had
// one as a distinct syntactic form (a `module.exports =` / `pub fn` /
// `module X { export ... }`). Compared against the grammar's OWN inventory.
const EXPORT_DECLARATION_NODES = [
  "export_statement",
  "export_declaration",
  "export_specifier",
  "module_export",
  "visibility_modifier",
  "export_list",
  "pub_item",
  "export",
]

const TYPE_DECLS = new Set([
  "class_declaration",
  "struct_declaration",
  "interface_declaration",
  "record_declaration",
  "record_struct_declaration",
  "enum_declaration",
  "delegate_declaration",
])
const MEMBER_DECLS = new Set([
  "method_declaration",
  "property_declaration",
  "field_declaration",
  "event_declaration",
  "event_field_declaration",
  "indexer_declaration",
  "constructor_declaration",
  "destructor_declaration",
  "operator_declaration",
  "conversion_operator_declaration",
])
const ACCESS = new Set(["public", "private", "protected", "internal", "file", "protected internal", "private protected"])

const files: string[] = []
{
  const dir = path.join(CR, REPO_ONLY)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch {
    console.error(`no git repo at ${dir}`)
    process.exit(2)
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let head = ""
    try {
      if (statSync(abs).size > 512 * 1024) continue
      head = readFileSync(abs, "utf8").slice(0, 4096)
    } catch { continue }
    if (detectLanguageFromPath(abs, head) !== LANG) continue
    files.push(abs)
  }
}
// A PREFIX draw is biased and this corpus shows it: `git ls-files` order is
// alphabetical, so the first 300 roslyn files are eng/ and docs/, and roslyn's
// src/ — where the public surface and the dense type declarations live — is not
// in the prefix at all. So the draw is a STRIDE over the derived list, which
// cannot be hand-written and cannot rot, and the stride is printed with the
// count so the population is never mistaken for the whole.
const STRIDE = Math.max(1, Number(process.env.BB_STRIDE || 1))
const cap = NFILES > 0 ? NFILES : files.length
const drawn = files.filter((_, i) => i % STRIDE === 0).slice(0, cap)
console.log(`CS3 csharp exports construct census`)
console.log(`repo ${REPO_ONLY}: ADMITTED ${files.length} .cs (language-detection.ts)`)
console.log(`DRAWN ${drawn.length} (stride ${STRIDE}, cap ${cap}) = ${((drawn.length / Math.max(1, files.length)) * 100).toFixed(1)}% of the admitted population`)
console.log()

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const ROOTW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOTW, "wasm", "tree-sitter-c_sharp.wasm"))))

// ---------------------------------------------------------------- A. vocabulary
const nodeTypes = new Map<string, number>()
const modifierTokens = new Map<string, number>()

// ---------------------------------------------------------------- B. population
let typeDecls = 0, memberDecls = 0
const byAccess = new Map<string, number>()
const topLevelByAccess = new Map<string, number>()
const memberByAccess = new Map<string, number>()
const rules = { R1_topLevelPublic: 0, R2_allPublicTypes: 0, R3_allPublicTypesAndMembers: 0, R0_existing_exports_channel: 0 }
let filesWithExportableTopLevel = 0
const examples: string[] = []

function accessibilityOf(node: any): string {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "modifier") {
      const t = c.text
      // `protected internal` / `private protected` arrive as TWO modifier children
      // in this grammar, so the pair is rejoined here rather than in a pattern.
      for (const a of ACCESS) {
        if (a.includes(" ") && t === a.split(" ")[0]) {
          const next = node.namedChild(i + 1)
          if (next && next.type === "modifier" && next.text === a.split(" ")[1]) return a
        }
      }
      if (ACCESS.has(t)) return t
    }
  }
  return "(none)"
}

/** Nearest enclosing declaration node of a type kind, walking up the parent chain. */
function enclosingType(node: any): any {
  let p = node.parent
  while (p) {
    if (TYPE_DECLS.has(p.type)) return p
    if (p.type === "compilation_unit") return null
    p = p.parent
  }
  return null
}

function enclosingNamespaceName(node: any): string | null {
  let p = node.parent
  while (p) {
    if (p.type === "namespace_declaration" || p.type === "file_scoped_namespace_declaration") {
      return p.childForFieldName("name")?.text ?? null
    }
    if (TYPE_DECLS.has(p.type)) return null
    p = p.parent
  }
  return null
}

function nameOf(node: any): string {
  return node.childForFieldName("name")?.text ?? "(unnamed)"
}

const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const abs of drawn) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  const tree = parser.parse(text)
  if (!tree) continue
  // No regex: strip the repo prefix by index arithmetic. `.replace(prefix + "/", "")`
  // reads as a plain string replacement and IS one — but MASTER-HANDOFF rule 1 and this
  // lane's own gate (`verify-csharp-no-regex --file`) cannot PROVE that from the call
  // alone, so it fails the file. Index arithmetic is unambiguous.
  const prefix = path.join(CR, REPO_ONLY) + "/"
  const rel = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs
  let sawExportable = false

  const walk = (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    if (n.type === "modifier") tally(modifierTokens, n.text)
    if (TYPE_DECLS.has(n.type)) {
      typeDecls++
      const acc = accessibilityOf(n)
      tally(byAccess, acc)
      const owner = enclosingType(n)
      const topLevel = owner === null
      if (topLevel) {
        tally(topLevelByAccess, acc)
        if (acc === "public") {
          rules.R1_topLevelPublic++
          rules.R2_allPublicTypes++
          if (!sawExportable) { sawExportable = true; if (examples.length < 6) examples.push(`${rel} :: ${nameOf(n)}  ns=${enclosingNamespaceName(n) ?? "(global)"}`) }
        }
      } else if (acc === "public") {
        rules.R2_allPublicTypes++
        rules.R3_allPublicTypesAndMembers++
      }
      // The channel the analyzer writes TODAY: top-level AND namespace-free AND
      // not `file`. Counted here so the delta against a candidate rule is a
      // measurement rather than an assertion.
      if (topLevel && acc !== "file" && enclosingNamespaceName(n) === null) rules.R0_existing_exports_channel++
    } else if (MEMBER_DECLS.has(n.type)) {
      memberDecls++
      const acc = accessibilityOf(n)
      tally(memberByAccess, acc)
      if (acc === "public") rules.R3_allPublicTypesAndMembers++
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(tree.rootNode)
  if (sawExportable) filesWithExportableTopLevel++
  tree.delete?.()
}

console.log(`--- A. GRAMMAR VOCABULARY (instrument A) ---`)
console.log(`distinct node types produced across ${drawn.length} files: ${nodeTypes.size}`)
const present = EXPORT_DECLARATION_NODES.filter((t) => nodeTypes.has(t))
console.log(`node types that would EXPRESS an export declaration: ${EXPORT_DECLARATION_NODES.join(", ")}`)
console.log(`  of those, PRESENT in this grammar: ${present.length ? present.join(", ") : "NONE"}`)
console.log()
console.log("accessibility modifier tokens seen (top 12 by count):")
for (const [k, v] of [...modifierTokens].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${k.padEnd(28)} ${v}`)
console.log()
console.log(`--- B. DECLARATION POPULATION (instrument B, on the tree) ---`)
console.log(`type declarations   ${typeDecls}`)
console.log(`member declarations ${memberDecls}`)
console.log(`type declarations by accessibility:`)
for (const [k, v] of [...byAccess].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(24)} ${v}`)
console.log(`TOP-LEVEL type declarations by accessibility:`)
for (const [k, v] of [...topLevelByAccess].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(24)} ${v}`)
console.log(`member declarations by accessibility:`)
for (const [k, v] of [...memberByAccess].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(24)} ${v}`)
console.log()
console.log(`candidate exports populations over ${drawn.length} files (${filesWithExportableTopLevel} files carry >=1 public top-level type):`)
console.log(`   R0  top-level AND namespace-free AND not file   = ${rules.R0_existing_exports_channel}   <- what res.exports[] carries TODAY`)
console.log(`   R1  top-level public type                      = ${rules.R1_topLevelPublic}`)
console.log(`   R2  every public type (nested included)        = ${rules.R2_allPublicTypes}`)
console.log(`   R3  R2 + every public member                   = ${rules.R3_allPublicTypesAndMembers}`)
console.log(`examples of public top-level types:`)
for (const e of examples) console.log(`   ${e}`)
