/**
 * WHAT NODE TYPES DOES THIS GRAMMAR ACTUALLY PRODUCE, and what does each construct look like?
 *
 * Written before the whole-corpus construct census, because that census may only count node
 * types that exist: this file is the evidence that the ten construct rules are drawn from the
 * shipped `wasm/tree-sitter-dart.wasm` and not from memory of some other Dart grammar. Every
 * node type the census tests appears in the inventory below first.
 *
 * Iterative walk with an explicit stack and a depth bound — `grammar-inventory.ts` documents
 * that the ontology gate's recursive walker dies on
 * `dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart` (depth 20,005), so this
 * probe must not repeat that.
 *
 * Run: npx tsx validation/m14/fixtures/dart/grammar-construct-shapes.ts [nFiles]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CORPUS = process.env.BB_DART_CORPUS || "/home/ishaq2321/bb_tests/repositories/dart-sdk"
const WANT = Number(process.argv[2] ?? 60)

function discover(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git|\.dart_tool/.test(e.name)) walk(p, depth + 1) }
      else if (e.name.endsWith(".dart")) { try { if (statSync(p).size < 400_000) out.push(p) } catch {} }
    }
  }
  walk(dir, 0)
  out.sort()
  const stride = Math.max(1, Math.floor(out.length / WANT))
  return out.filter((_, i) => i % stride === 0).slice(0, WANT)
}

const { getParser } = await import(join(REPO, "src/ast/engine.ts"))
const parser = await getParser("dart")
const files = discover(CORPUS)

const types = new Map<string, number>()
const samples = new Map<string, string[]>()
/** node types that carry a supertype / interface list / annotation, with their children */
const INTERESTING = new Set([
  "class_definition", "mixin_declaration", "extension_declaration", "enum_declaration",
  "extension_type_declaration", "superclass", "interfaces", "annotation", "class_modifier",
  "library_import", "library_export", "import_or_export", "import_specification",
  "selector", "argument_part", "new_expression", "const_object_expression",
  "type_identifier", "declaration", "class_member", "method_signature", "function_signature",
  "identifier", "function_body", "type_arguments", "initialized_identifier_list",
  "mixin_application", "on_clause", "type_parameter", "type_parameters",
])

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  let root: any
  try { root = (await parser.parse(content, f)).rootNode } catch { continue }
  const rel = f.slice(CORPUS.length + 1)
  const stack: any[] = [root]
  let guard = 0
  while (stack.length && guard++ < 400_000) {
    const n = stack.pop()
    types.set(n.type, (types.get(n.type) ?? 0) + 1)
    if (INTERESTING.has(n.type)) {
      const arr = samples.get(n.type) ?? []
      if (arr.length < 4) {
        const head = n.text.split("\n")[0]!.slice(0, 90)
        const kids = []
        for (let i = 0; i < Math.min(n.namedChildCount, 6); i++) kids.push(n.namedChild(i)!.type)
        arr.push(`${rel}: ${JSON.stringify(head)}  kids=[${kids.join(",")}]`)
        samples.set(n.type, arr)
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
}

console.log(`population: ${files.length} .dart files (stride sample of ${CORPUS})`)
console.log(`\n== node types observed (${types.size}) ==`)
for (const [t, c] of [...types.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(7)}  ${t}`)
console.log(`\n== shapes of the construct-bearing types ==`)
for (const t of INTERESTING) {
  const arr = samples.get(t)
  if (!arr) { console.log(`  ${t}: NOT OBSERVED`); continue }
  console.log(`  ${t}:`)
  for (const s of arr) console.log(`      ${s}`)
}
