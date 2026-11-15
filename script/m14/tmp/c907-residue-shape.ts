// #907 residue, site by site: for each remaining lost definition, print the
// ancestor chain of the node carrying its name, the analyzer's symbols in that
// window, and what follows the declarator. The last one is the discriminator the
// recovery keys on, so it says directly whether the site is a shape the fix
// covers or a different mechanism.
//
// Run: bun script/m14/tmp/c907-residue-shape.ts
import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = "/home/ishaq2321/bb_tests/repositories/jq"
const SITES: Array<[string, string]> = [
  ["src/jv.c", "jv_number"],
  ["src/builtin.c", "gen_last_1"],
  ["src/builtin.c", "bind_bytecoded_builtins"],
  ["src/jv_dtoa.c", "jvp_dtoa"],
  ["src/jv_dtoa.c", "ulp"],
  ["src/parser.c", "yyerror"],
  ["src/util.c", "strptime"],
  ["vendor/decNumber/decNumber.c", "decNumberNormalize"],
]

const isWord = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch)

/** Every offset where the name appears as a whole word followed by `(`. */
function occurrences(content: string, name: string): number[] {
  const out: number[] = []
  let from = 0
  for (;;) {
    const i = content.indexOf(name, from)
    if (i < 0) return out
    from = i + 1
    const before = i > 0 ? content[i - 1] : "\n"
    if (isWord(before)) continue
    let j = i + name.length
    while (j < content.length && /\s/.test(content[j])) j++
    if (content[j] !== "(") continue
    out.push(i)
  }
}

/** Does a balanced (...) follow, and is the next non-space character `{`? */
function declaratorFollowedByBrace(content: string, start: number): { def: boolean; after: string } {
  let i = content.indexOf("(", start)
  if (i < 0) return { def: false, after: "" }
  let depth = 0
  for (; i < content.length; i++) {
    if (content[i] === "(") depth++
    else if (content[i] === ")") { depth--; if (depth === 0) break }
  }
  let j = i + 1
  while (j < content.length && /\s/.test(content[j])) j++
  return { def: content[j] === "{", after: content.slice(j, j + 46).replace(/\n/g, "|") }
}

for (const [rel, name] of SITES) {
  const abs = `${ROOT}/${rel}`
  const content = readFileSync(abs, "utf8")
  const { tree } = await ASTEngine.parseTree(abs, content)
  const all = occurrences(content, name)
  let chosen = -1
  let after = ""
  for (const h of all) {
    const r = declaratorFollowedByBrace(content, h)
    if (r.def) { chosen = h; after = r.after; break }
  }
  const line = chosen >= 0 ? content.slice(0, chosen).split("\n").length : -1
  console.log(`\n=== ${rel} :: ${name} ===`)
  console.log(`  occurrences=${all.length}  definition-shaped=${chosen >= 0 ? `yes @L${line}` : "NO"}  after-declarator="${after}"`)
  if (chosen < 0) continue
  const depth = chosen + name.length
  const find = (node: any): any => {
    if (node.startIndex <= depth && node.endIndex >= depth) {
      for (const c of node.children ?? []) {
        const r = find(c)
        if (r) return r
      }
      return node
    }
    return null
  }
  const leaf = find(tree.rootNode)
  const chain: string[] = []
  let p = leaf
  while (p) { chain.push(`${p.type}[${p.startPosition.row + 1}-${p.endPosition.row + 1}]`); p = p.parent }
  console.log(`  chain: ${chain.reverse().join(" > ")}`)
  const r: any = await parseFile(abs, ROOT)
  const near = (r.symbols ?? [])
    .filter((s: any) => Math.abs((s.startLine ?? -1) - line) < 20)
    .map((s: any) => `${s.kind}:${s.name}@${s.startLine}`)
  console.log(`  analyzer symbols within ±20 lines: ${near.length ? near.slice(0, 8).join(", ") : "(none)"}`)
}
