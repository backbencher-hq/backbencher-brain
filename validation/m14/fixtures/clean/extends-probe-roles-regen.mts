/**
 * Regenerate `extends-probe-roles.probe.json` from the fixture, preserving every hand-written
 * `note` and `text`.
 *
 *   npx tsx validation/m14/fixtures/clean/extends-probe-roles-regen.mts
 *
 * ## WHY THIS EXISTS, AND WHY IT IS SAFE
 *
 * The expectation pins per-declaration child ROLES, which is 18 rows of order-sensitive text
 * that a human cannot keep correct by hand across an edit to the fixture. So it is generated —
 * and a generated expectation is only trustworthy under two conditions, both of which this
 * script is arranged to satisfy:
 *
 * 1. **The notes survive.** Each `note` and each `text` is keyed by `<line> <nodeType>` and
 *    re-attached to the regenerated row. A row whose line moved loses its note, which is
 *    visible in the diff rather than silent — a note that quietly migrated onto a different
 *    declaration would be worse than no note.
 * 2. **Regenerating is not asserting.** `extends-probe-roles-check.mts` is what decides
 *    pass/fail, and it compares the CENSUS against the file. Running this script over a
 *    broken census rewrites the expectation to match the breakage and the check then passes.
 *    So the rule is: regenerate, then read the diff. A regeneration whose only change is
 *    `unclassified: 0` becoming `unclassified: 3` is the probe breaking, not the fixture.
 *    The `unclassified` and grammar rows are printed for exactly that reason.
 *
 * It imports `censusCleanDeclarations` from `script/m14/clean-ruled.ts`, the same function the
 * arbiter reaches through `countCleanExtendsConstruct`, so a regenerated expectation cannot be
 * produced against a probe the arbiter does not run.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { censusCleanDeclarations, CLEAN_DECLARATION_NODES, CLEAN_DECLARATION_SLOTS } from "../../../../script/m14/clean-ruled"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = HERE
const ROOT = path.resolve(HERE, "..", "..", "..", "..")
const SRC = path.join(DIR, "extends-probe-roles.icl")
const EXP = path.join(DIR, "extends-probe-roles.probe.json")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(grammar)

const src = fs.readFileSync(SRC, "utf8")
const tree: any = parser.parse(src)
const lines = src.split("\n")
const previous = JSON.parse(fs.readFileSync(EXP, "utf8"))

const notes = new Map<string, string>()
const texts = new Map<string, string>()
for (const d of previous.declarations ?? []) {
  const key = `${d.line} ${d.nodeType}`
  if (d.note) notes.set(key, d.note)
  if (d.text) texts.set(key, d.text)
}

let errorNodes = 0
let missingTokens = 0
const scan = (n: any) => {
  if (n.type === "ERROR") errorNodes++
  if (n.isMissing) missingTokens++
  for (let i = 0; i < n.childCount; i++) scan(n.child(i))
}
scan(tree.rootNode)

const census = censusCleanDeclarations(tree.rootNode)
const declarations: any[] = []
const walk = (n: any) => {
  if ((CLEAN_DECLARATION_NODES as readonly string[]).includes(n.type)) {
    const line = Number(n.startPosition.row) + 1
    const roles: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      const role = CLEAN_DECLARATION_SLOTS[child.type]
      roles.push(role ? `${role}:${child.type}` : `UNCLASSIFIED:${child.type}`)
    }
    const key = `${line} ${n.type}`
    const row: any = { line, nodeType: n.type, roles }
    row.text = texts.get(key) ?? (lines[line - 1]?.trim().slice(0, 70) ?? "")
    const note = notes.get(key)
    if (note) row.note = note
    declarations.push(row)
  }
  for (let i = 0; i < n.childCount; i++) walk(n.child(i))
}
walk(tree.rootNode)
declarations.sort((a, b) => a.line - b.line || (a.nodeType < b.nodeType ? -1 : 1))

const inventory: Record<string, number> = {}
for (const key of Object.keys(census.childInventory).sort()) inventory[key] = census.childInventory[key]

const out = {
  ...previous,
  grammar: { ...previous.grammar, errorNodes, missingTokens },
  totals: { ...previous.totals, declarations: census.declarations, unclassified: census.unclassified.length },
  slotsByRole: Object.fromEntries(Object.entries(census.slotsByRole).sort((a: any, b: any) => b[1] - a[1])),
  childInventory: { ...inventory, _comment_pairs: previous.childInventory?._comment_pairs },
  declarations,
}
fs.writeFileSync(EXP, JSON.stringify(out, null, 2) + "\n")

const lostNotes = (previous.declarations ?? []).filter((d: any) => d.note && !notes.has(`${d.line} ${d.nodeType}`)).length
console.log(`regenerated ${path.relative(ROOT, EXP)}`)
console.log(`  declarations ${census.declarations}, (declaration, child) pairs ${Object.keys(inventory).length}`)
console.log(`  UNCLASSIFIED ${census.unclassified.length}   ERROR nodes ${errorNodes}   MISSING tokens ${missingTokens}`)
console.log(`  slotsByRole ${JSON.stringify(out.slotsByRole)}`)
console.log(`  notes carried over ${notes.size}; notes that will be DROPPED because their line moved: ${lostNotes}`)
console.log(`\nRead the diff. A change to UNCLASSIFIED or to the ERROR/MISSING counts is the probe or the grammar moving, not the fixture.`)
