/**
 * M14 ONTOLOGY — LUA WAVE-2. The grammar shape behind a claim.
 *
 * Two questions the A/B in lua-write-as-read.ts raised, settled on the tree
 * rather than by reading the analyzer:
 *
 *   Q1  Is an assignment's TARGET LIST a `variable_list` child of
 *       `assignment_statement`, or are the targets direct named children? The
 *       answer decides whether `emitNameRead`'s `variable_list` exclusion covers
 *       assignment targets at all — and `emitMemberRead` has no `variable_list`
 *       exclusion, which is what produced `references:global->reset@L3` on the
 *       line `t.a, t.reset = 1, 2`, a WRITE published as a member READ.
 *
 *   Q2  For `M.field`, which named children of the `dot_index_expression` are
 *       identifiers? `emitNameRead` excludes `namedChild(0)` only, so if the
 *       FIELD is also an identifier the member is published TWICE — once as
 *       `references -> field` and once as `uses -> field`. Pass 1's doc states
 *       the exclusion as "the head of a qualified name is not read on its own
 *       account", which is about the head; it says nothing about the field.
 *
 * Each case prints the tree shape AND the edges, so a claim cannot be made from
 * either alone.
 *
 * USAGE: npx tsx script/m60/lua-grammar-shape.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

const DIR = "/tmp/opencode/lua-lane/grammar-shape"
mkdirSync(DIR, { recursive: true })

const CASES: Record<string, string> = {
  "single-var-write": `local a = 1\na = 2\n`,
  "single-var-read": `local a = 1\nlocal b = a\n`,
  "multi-var-write": `local a, b = 1, 2\na, b = 3, 4\n`,
  "swap": `local a, b = 1, 2\na, b = b, a\n`,
  "member-write": `local t = {}\nt.reset = 1\n`,
  "member-read": `local t = {}\nlocal v = t.reset\n`,
  "method-write": `local t = {}\nt:reset()\nt:reset = 1\n`,
  "member-multi-write": `local t = {}\nt.a, t.reset = 1, 2\n`,
  "chained-member": `local M = {}\nlocal v = M.a.b\n`,
  "self-member-read": `local M = {}\nfunction M.run() return M.a end\n`,
}

function shape(n: any, depth = 0): string {
  const pad = "  ".repeat(depth)
  let s = `${pad}${n.type}`
  if (n.isNamed) {
    if (n.type === "identifier" || n.type === "string" || n.type === "number") s += ` "${String(n.text).slice(0, 24)}"`
  }
  const f = ["name", "table", "field"].map((k) => { try { return n.childForFieldName(k) } catch { return null } })
    .map((c, i) => (c ? `${["name", "table", "field"][i]}=${c.type}` : null)).filter(Boolean)
  if (f.length) s += `   {${f.join(" ")}}`
  if (n.isMissing) s += "   [MISSING]"
  let out = s + "\n"
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) out += shape(c, depth + 1) }
  return out
}

const report: Record<string, any> = {}
for (const [name, src] of Object.entries(CASES)) {
  const p = path.join(DIR, `${name}.lua`)
  writeFileSync(p, src)
  const t = parser.parse(src)
  const r: any = await parseFile(p, DIR)
  const rels = (r.relationships ?? [])
    .filter((x: any) => { const ty = String(x.type).toLowerCase(); return ty === "uses" || ty === "references" || ty === "calls" })
    .map((x: any) => `${String(x.type).toLowerCase()}: ${x.source} -> ${x.target} @L${x.line_number}`)
  report[name] = { source: src.replace(/\n/g, " \\n "), tree: shape(t.rootNode), edges: rels }
  console.log(`\n${"=".repeat(78)}\n${name}:  ${src.replace(/\n/g, " \\n ")}`)
  console.log(`--- tree ---\n${shape(t.rootNode).trimEnd()}`)
  console.log(`--- edges (uses/references/calls) ---`)
  for (const e of rels) console.log(`    ${e}`)
  if (!rels.length) console.log("    (none)")
}

writeFileSync(path.join(DIR, "report.json"), JSON.stringify(report, null, 2))
console.log(`\n-> ${path.join(DIR, "report.json")}`)