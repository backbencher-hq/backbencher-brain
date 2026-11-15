/**
 * SCSS GRAMMAR VOCABULARY — instrument A for the two ruled types.
 *
 * `implements` and `instantiates` are ruled on instrument A, and instrument A's whole
 * claim is an inventory: enumerate every node type the grammar PRODUCES across the
 * corpus and show that none of them expresses the construct. An inventory is only
 * evidence if it is printed, so this file prints the whole vocabulary rather than
 * asserting its size — the number in the ruling table is checkable by running this.
 *
 * The vocabulary is collected from the parse trees of the admitted corpus, NOT from the
 * wasm's declared type table. A declared type the corpus never produces is a capability
 * the corpus does not exercise, and using the declared table would let a ruling rest on
 * a name that no real file ever reaches.
 *
 * It also prints the CALIBRATION, because "0 of 50 probed names appear" is only evidence
 * of absence if the same probe finds names that DO appear. A vocabulary probe that
 * returns 0 for everything is indistinguishable from a broken one, and the gate's own
 * header records what that costs: a regex probe for `extends` once convicted a correct
 * bash ruling by matching `class voice` inside a telnet IAC word list in a string.
 *
 * USAGE: npx tsx validation/m14/fixtures/scss/scss-grammar-vocabulary.ts [sampleSize]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.argv[2] ?? 1000)

const WSP: any = (wts as any).Parser ?? (wts as any).default
const WSL: any = (wts as any).Language ?? (wts as any).default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

/** Node types that would EXPRESS a supertype relation, in any language's grammar. */
const SUPERTYPE = [
  "class_declaration", "class_specifier", "class", "class_definition",
  "interface_declaration", "interface_definition", "interface_body",
  "trait_declaration", "trait_definition", "trait_specifier",
  "struct_declaration", "struct_specifier", "struct_item",
  "enum_declaration", "enum_item", "union_declaration", "union_specifier",
  "object_declaration", "object_type", "type_declaration",
  "extends_clause", "implements_clause", "superclass", "base_class",
  "inheritance_specifier", "interface_implementation", "super_type",
  "protocol_declaration", "mixin_declaration", "base_list",
]
/** Node types that would EXPRESS construction of a value. */
const CONSTRUCTOR = [
  "new_expression", "object_creation_expression", "constructor_invocation",
  "new_declaration", "class_instance", "object_literal", "instantiation",
  "allocate_expression", "constructor_call", "instance_creation",
]
/** CALIBRATION: names that MUST appear, or this probe is broken rather than decisive. */
const MUST_APPEAR = [
  "stylesheet", "rule_set", "declaration", "mixin_statement", "include_statement",
  "use_statement", "forward_statement", "function_statement", "class_selector",
  "variable", "call_expression", "arguments", "block", "comment", "identifier",
]

const all: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) all.push(path.join(dir, rel))
}
const admitted: string[] = []
for (const abs of all) {
  let text: string
  try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
  if (detectLanguageFromPath(abs, text) !== "scss") continue
  admitted.push(abs)
}
admitted.sort()
const step = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample = admitted.filter((_, i) => i % step === 0).slice(0, SAMPLE)

const vocab = new Map<string, number>()
for (const abs of sample) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  const t = parser.parse(text)
  if (!t) continue
  const visit = (n: any): void => {
    vocab.set(n.type, (vocab.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
  }
  visit(t.rootNode)
  t.delete?.()
}

const report = (label: string, names: string[]): void => {
  const present = names.filter((n) => vocab.has(n))
  console.log(`\n${label}: ${present.length} of ${names.length} present`)
  for (const n of names) console.log(`  ${vocab.has(n) ? String(vocab.get(n)).padStart(8) : "       0"}  ${n}`)
}

console.log(`scss grammar vocabulary — instrument A`)
console.log(`admitted ${admitted.length}; sampled ${sample.length} (every ${step}th of the sorted admitted list)`)
console.log(`distinct node types PRODUCED: ${vocab.size}`)
console.log(`\nfull vocabulary (name x count):`)
for (const [k, v] of [...vocab].sort((a, b) => (b[1] as number) - (a[1] as number))) console.log(`  ${String(v).padStart(8)}  ${k}`)

console.log(`\n--- CALIBRATION: these MUST be present for the probes below to mean anything ---`)
report("MUST_APPEAR", MUST_APPEAR)
console.log(`\n--- the two ruled types ---`)
report("SUPERTYPE (would mean implements)", SUPERTYPE)
report("CONSTRUCTOR (would mean instantiates)", CONSTRUCTOR)
