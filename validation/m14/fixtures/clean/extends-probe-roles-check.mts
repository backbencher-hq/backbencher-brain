/**
 * Check `extends-probe-roles.probe.json` — the ruling probe's slot roles, per declaration.
 *
 *   npx tsx validation/m14/fixtures/clean/extends-probe-roles-check.mts
 *
 * WHY THIS IS NOT A `runLang` FIXTURE. `run-fixtures.ts` grades an expectation file
 * against the ANALYZER's output, and this asserts something the analyzer does not produce:
 * that the census in `script/m14/clean-ruled.ts` puts every direct named child of every
 * Clean declaration into a named ROLE. So it is a separate check, in the same directory,
 * reading a `.probe.json` beside the fixture rather than a `.expectation.json`. The
 * analyzer's own rows for the same file are in `extends-probe-roles.expectation.json`, so
 * `runLang("clean")` exercises the file too and neither suite can drift from the other.
 *
 * IT IMPORTS THE CENSUS, NOT A COPY. `censusCleanDeclarations` is the same function the
 * arbiter calls through `countCleanExtendsConstruct`, so this check cannot pass against a
 * probe the arbiter does not run — which is the failure mode a second implementation of a
 * probe always invites.
 *
 * Exit 0 when every assertion holds, 1 otherwise, and each failure is printed with the
 * expected and the actual so the diff is readable without re-running anything.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { censusCleanDeclarations, CLEAN_DECLARATION_NODES, CLEAN_DECLARATION_SLOTS } from "../../../../script/m14/clean-ruled"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..", "..")
const DIR = path.join(ROOT, "validation", "m14", "fixtures", "clean")
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
const exp = JSON.parse(fs.readFileSync(EXP, "utf8"))
const lines = src.split("\n")

let failures = 0
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`) }

// ---- the grammar must be intact, or every row below is a statement about error recovery
let errorNodes = 0
let missingTokens = 0
const scan = (n: any) => {
  if (n.type === "ERROR") errorNodes++
  if (n.isMissing) missingTokens++
  for (let i = 0; i < n.childCount; i++) scan(n.child(i))
}
scan(tree.rootNode)
if (errorNodes !== exp.grammar.errorNodes) fail(`ERROR nodes: expected ${exp.grammar.errorNodes}, got ${errorNodes}`)
if (missingTokens !== exp.grammar.missingTokens) fail(`MISSING tokens: expected ${exp.grammar.missingTokens}, got ${missingTokens}`)

// ---- the whole census
const c = censusCleanDeclarations(tree.rootNode)
if (c.declarations !== exp.totals.declarations) fail(`declarations: expected ${exp.totals.declarations}, got ${c.declarations}`)
if (c.unclassified.length !== exp.totals.unclassified) {
  fail(`UNCLASSIFIED: expected ${exp.totals.unclassified}, got ${c.unclassified.length}`)
  for (const u of c.unclassified) fail(`  unclassified child: ${u.nodeType} > ${u.childType} at line ${u.line} (${JSON.stringify(u.text.slice(0, 40))})`)
}
for (const [role, n] of Object.entries(exp.slotsByRole)) {
  const got = c.slotsByRole[role] ?? 0
  if (got !== n) fail(`role ${role}: expected ${n}, got ${got}`)
}
for (const [pair, n] of Object.entries(exp.childInventory)) {
  if (pair.startsWith("_")) continue
  const got = c.childInventory[pair] ?? 0
  if (got !== n) fail(`pair ${pair}: expected ${n}, got ${got}`)
}

// ---- per declaration: the node type, the site line, and every child's ROLE in order
const actual: { line: number; nodeType: string; roles: string[] }[] = []
const walk = (n: any) => {
  if ((CLEAN_DECLARATION_NODES as readonly string[]).includes(n.type)) {
    const roles: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      const role = CLEAN_DECLARATION_SLOTS[child.type]
      roles.push(role ? `${role}:${child.type}` : `UNCLASSIFIED:${child.type}`)
    }
    actual.push({ line: Number(n.startPosition.row) + 1, nodeType: n.type, roles })
  }
  for (let i = 0; i < n.childCount; i++) walk(n.child(i))
}
walk(tree.rootNode)
actual.sort((a, b) => a.line - b.line || (a.nodeType < b.nodeType ? -1 : 1))

const expected: any[] = (exp.declarations ?? []).slice().sort(
  (a, b) => a.line - b.line || (a.nodeType < b.nodeType ? -1 : 1),
)
if (actual.length !== expected.length) fail(`per-declaration rows: expected ${expected.length}, got ${actual.length}`)
for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
  const a = actual[i]
  const e = expected[i]
  if (!a || !e) { fail(`row ${i}: missing on ${a ? "the expectation" : "the tree"} side`); continue }
  if (a.line !== e.line) { fail(`row ${i} (${e.nodeType}): expected line ${e.line}, got ${a.line}`); continue }
  if (a.nodeType !== e.nodeType) { fail(`row at line ${e.line}: expected ${e.nodeType}, got ${a.nodeType}`); continue }
  const want = e.roles.join(" ")
  const got = a.roles.join(" ")
  if (want !== got) fail(`line ${e.line} ${e.nodeType} (${JSON.stringify(lines[e.line - 1]?.trim().slice(0, 60))})\n         expected roles: ${want}\n         actual roles:   ${got}`)
}

console.log(
  `extends-probe-roles-check — ${failures === 0 ? "PASS" : "FAIL"}: ` +
    `${c.declarations} declarations, ${Object.keys(c.childInventory).length} (declaration, child) pairs, ` +
    `${c.unclassified.length} unclassified, ${errorNodes} ERROR nodes, ${missingTokens} MISSING tokens`,
)
if (failures) {
  console.log(`>>> ${failures} assertion(s) failed. The census and its expectation have drifted, or the fixture no longer parses.`)
  process.exitCode = 1
}
