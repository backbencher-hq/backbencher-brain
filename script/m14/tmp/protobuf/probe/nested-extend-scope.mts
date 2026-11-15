/**
 * DOES A NESTED `extend` RESOLVE AGAINST THE ENCLOSING MESSAGES?
 *
 * A type written inside an `extend` block is looked up from where the block is
 * WRITTEN, because `extend` opens no scope — the extended type is where the
 * block's members GO, not a scope to resolve their types against. The analyzer
 * kept one value for both questions until a corpus measurement separated them:
 * the members' owner, which for an extension is the extended type, and the
 * lexical position, which is the enclosing message chain.
 *
 * `Ctx.owner` and `Ctx.scope` are now separate fields. This probe pins the
 * behaviour they exist for, on the three shapes that produced it — a nested
 * `extend` in one file of the reference corpus, each of which emitted a
 * `uses` target naming an id NO file publishes:
 *
 *   proto2_unittest.ComplexOptionType4                 (1 edge)
 *   proto2_unittest.TestExtensionOrderings3            (1 edge)
 *   edition_unittest.TestExtensionOrderings3           (1 edge)
 *
 * Each is a reference to a type NESTED two messages deep, written inside an
 * `extend` that is itself nested, so C++ lookup walks outward through the
 * enclosing messages and finds it. The members still belong to the extended
 * type, so the `contains` edge is asserted alongside — this probe fails if the
 * fix ever moves ownership too, which is the failure mode a one-sided fix would
 * introduce.
 *
 * Reads the analyzer directly, never `parseFile`, so a production-side parse
 * loss cannot be mistaken for a resolution result.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/nested-extend-scope.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const REF = "/home/ishaq2321/bb_tests/repositories/pb-reference/src/google/protobuf"

/** file -> the ids its nested-extend references must resolve to. Each expected id
 *  is the declaration protoc finds, and each is published by the SAME file, so a
 *  correct answer is provable from the file's own symbol set with no corpus. */
const CASES: { file: string; want: string[] }[] = [
  { file: "unittest_custom_options.proto", want: ["proto2_unittest.ComplexOptionType2.ComplexOptionType4"] },
  { file: "unittest.proto", want: ["proto2_unittest.TestExtensionOrderings2.TestExtensionOrderings3"] },
  { file: "edition_unittest.proto", want: ["edition_unittest.TestExtensionOrderings2.TestExtensionOrderings3"] },
]

/** Ownership must NOT move: an extension's members belong to the extended type,
 *  which is the ruling that keeps an extension from publishing a phantom second
 *  declaration. Carried as `contains` edges whose target is owned by an extended
 *  type name (a type this file does not declare itself). */
const EXTENDED_BY_THIS_FILE: Record<string, string[]> = {
  "unittest_custom_options.proto": ["google.protobuf.MessageOptions"],
  "unittest.proto": ["proto2_unittest.TestFieldOrderings"],
  "edition_unittest.proto": ["edition_unittest.TestFieldOrderings"],
}

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

let failures = 0
const fail = (msg: string): void => { failures++; console.log(`  FAIL ${msg}`) }

for (const c of CASES) {
  const abs = path.join(REF, c.file)
  const content = readFileSync(abs, "utf8")
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const tree = parser.parse(content)
  const r: any = analyzer.analyze(tree.rootNode, content, abs)
  const ids = new Set<string>((r.symbols ?? []).map((s: any) => String(s.metadata?.id ?? s.name)))
  const uses = ((r.relationships ?? []) as any[]).filter((e) => String(e.type) === "uses")
  console.log(`\n${c.file}   ${ids.size} ids, ${uses.length} uses edges`)

  // 1. every expected id is a target of some edge, and it is a PUBLISHED id
  for (const want of c.want) {
    const hits = uses.filter((e) => String(e.target) === want)
    if (hits.length === 0) { fail(`${want} is not the target of any uses edge`); continue }
    if (!ids.has(want)) { fail(`${want} is targeted but not published by this file`); continue }
    const unbound = uses.filter((e) => !ids.has(String(e.target)))
    console.log(`  ok   ${want}  targeted by ${hits.length} edge(s), published in-file`)
    if (unbound.length) console.log(`       (${unbound.length} uses target(s) in this file still unbound: ${[...new Set(unbound.map((e) => String(e.target)))].slice(0, 4).join(", ")})`)
  }

      // 2. the SHAPE: no `uses` target may be the EXTENDED TYPE used as a scope.
      //    Before the fix these read `<pkg>.<ExtendedTypeLeaf>` — the extended
      //    type resolved as though it were an enclosing scope.
      //
      //    The package is read from the TREE, by walking to the `package` node and
      //    taking its `full_ident` child. A regular expression over the file's text
      //    would have been the shorter way to write this and is exactly what this
      //    workstream forbids: a text match reads comments and string literals,
      //    misses nested syntax, and breaks silently on the next grammar version.
      //    The analyzer derives its package the same way (a `package` node's
      //    `full_ident` child), so this reads the same fact from the same place.
      let pkg = ""
      const stack: (Node | null)[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        if ((n as any).type === "package") {
          for (const c of (n as any).children ?? []) {
            if (c && (c as any).isNamed && (c as any).type === "full_ident") { pkg = (c as any).text; break }
          }
          break
        }
        for (const c of ((n as any).children ?? [])) if (c) stack.push(c as any)
      }
      if (!pkg) fail("no package node found on the tree")
      for (const ext of EXTENDED_BY_THIS_FILE[c.file] ?? []) {
        const leaf = ext.split(".").pop()!
        const bogus = `${pkg}.${leaf}`
        const bad = uses.filter((e) => String(e.target) === bogus)
        if (bad.length) fail(`${bad.length} edge(s) still target ${bogus}, the extended-type scope`)
      }

  // 3. ownership must not have moved: a member of an extend block is contained by
  //    the EXTENDED type, not by the message the block is written in.
  const contains = ((r.relationships ?? []) as any[]).filter((e) => String(e.type) === "contains")
  const owners = new Set(contains.map((e) => String(e.source)))
  for (const ext of EXTENDED_BY_THIS_FILE[c.file] ?? []) {
    if (!owners.has(ext)) fail(`no contains edge from the extended type ${ext}`)
  }
  console.log(`  ok   ownership unchanged: contains edges from ${[...(EXTENDED_BY_THIS_FILE[c.file] ?? [])].join(", ")}`)
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} assertion(s)`}`)
process.exit(failures === 0 ? 0 : 1)
