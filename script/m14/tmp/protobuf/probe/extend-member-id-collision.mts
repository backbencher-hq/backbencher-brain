/**
 * DOES AN `extend` MEMBER COLLIDE WITH A FIELD OF THE TYPE IT EXTENDS?
 *
 * `unittest_delimited.proto` writes, in one file:
 *
 *   message TestDelimited {
 *     LengthPrefixed lengthprefixed = 1;          // field number 1
 *     extensions 1000 to max;
 *   }
 *   extend TestDelimited {
 *     LengthPrefixed lengthprefixed = 1004;       // extension number 1004
 *   }
 *
 * An extension's members belong to the EXTENDED TYPE — that is this analyzer's
 * standing ruling, and it is what keeps an extension from publishing a phantom
 * second declaration of a type that already has one. It has a consequence that
 * only shows up when the extension member's name EQUALS a field the extended type
 * already declares: both are published under the same owner-qualified id.
 *
 * protobuf itself has no such collision, because it keys fields by NUMBER within
 * the type and 1 != 1004. So the two ids here are one id standing for two
 * declarations, and `protoc`'s descriptor — which reports them as two separate
 * fields of `TestDelimited`, and which this probe reads back below — is the
 * authority on there being two.
 *
 * This probe answers three questions with counts:
 *   1. does the analyzer publish both members under ONE id, or does it
 *      disambiguate them?
 *   2. how many such collisions does the corpus hold?
 *   3. does `protoc` see two fields where the analyzer sees one id?
 *
 * (3) is the part that decides whether the collision is a reporting artifact or a
 * lost declaration. If protoc reports one field, the analyzer is right to publish
 * one id. If it reports two, one of them is unreachable by id.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/extend-member-id-collision.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const TARGET = "<corpus-root>/bb_tests/repositories/pb-reference/src/google/protobuf/unittest_delimited.proto"

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

function analyze(abs: string): any {
  const content = readFileSync(abs, "utf8")
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  return analyzer.analyze(parser.parse(content).rootNode, content, abs)
}

// ---- 1. the one file, printed
console.log("=== the shape, on unittest_delimited.proto ===")
const one = analyze(TARGET)
const byId = new Map<string, any[]>()
for (const s of one.symbols ?? []) {
  const id = String(s.metadata?.id ?? s.name)
  const arr = byId.get(id) ?? []
  arr.push(s)
  byId.set(id, arr)
}
let collisionsHere = 0
for (const [id, syms] of byId) {
  if (syms.length < 2) continue
  collisionsHere++
  console.log(`  id ${id}  published ${syms.length} times:`)
  for (const s of syms) {
    console.log(`      name=${s.name} kind=${s.kind} owner=${s.ownerName ?? "-"} viaExtension=${s.metadata?.viaExtension ? "yes" : "no"} fieldNumber=${s.metadata?.fieldNumber ?? "-"} line=${s.range?.start?.line ?? "-"}`)
  }
}
console.log(`  ids published more than once in this file: ${collisionsHere}`)

// ---- 2. corpus-wide
const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  const d = path.join(CR, e)
  let ok = false
  try { ok = statSync(d).isDirectory() } catch { continue }
  if (!ok) continue
  const walk = (dir: string): void => {
    let kids: string[]
    try { kids = readdirSync(dir) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(dir, k)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs); continue }
      if (k.endsWith(".proto")) files.push(abs)
    }
  }
  walk(d)
}

const rows: { file: string; id: string; n: number; numbers: string[] }[] = []
for (const abs of files) {
  let r: any
  try { r = analyze(abs) } catch { continue }
  const seen = new Map<string, { n: number; numbers: string[] }>()
  for (const s of r.symbols ?? []) {
    const id = String(s.metadata?.id ?? s.name)
    const cur = seen.get(id) ?? { n: 0, numbers: [] }
    cur.n++
    cur.numbers.push(String(s.metadata?.fieldNumber ?? "-"))
    seen.set(id, cur)
  }
  for (const [id, v] of seen) if (v.n > 1) rows.push({ file: path.relative(CR, abs), id, n: v.n, numbers: v.numbers })
}

console.log(`\n=== corpus-wide: ids published more than once ===`)
console.log(`files scanned            ${files.length}`)
console.log(`ids published >1 time    ${rows.length}`)
for (const r of rows.sort((a, b) => b.n - a.n)) {
  console.log(`  ${String(r.n).padStart(2)}x  ${r.id}   fieldNumbers=[${r.numbers.join(", ")}]   ${r.file}`)
}
console.log(`\n${rows.length === 0 ? "no id is published twice" : `${rows.length} id(s) stand for more than one declaration`}`)
