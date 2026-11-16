/**
 * THE 2 UNCOVERED ROWS, PRICED BEFORE ANY EDGE IS WRITTEN.
 *
 * ## What `message-typed-coverage.mts` found
 *
 * 2 of 16,204 message-typed declaration rows carry no `uses` edge, both in
 * `pb-reference/src/google/protobuf/unittest_custom_options.proto`:
 *
 *   338  option (.proto2_unittest.complex_opt1).foo = 42;
 *   340  option (.proto2_unittest.complex_opt1).(proto2_unittest.corge).moo = 876;
 *
 * The parenthesized name in a custom option is an EXTENSION TYPE the option's value is
 * interpreted by. The analyzer reads the option and publishes no edge naming that type.
 *
 * ## The question that decides whether this becomes an edge
 *
 * The honesty contract's incoming section: "Every applicable relationship must RESOLVE.
 * Unresolvable is not close enough — an edge the graph cannot walk is a thing the graph
 * asserts that is not there." So before writing a `uses` edge here, the number that
 * matters is not how many option references exist but **how many of their names bind to a
 * symbol the analyzer actually publishes.**
 *
 *   if resolution is high  -> an edge is warranted and cheap
 *   if resolution is ~0    -> an edge would be 0%-resolvable noise, and the honest
 *                            verdict is a measured non-edge, not a silent omission
 *
 * ## NO REGEX
 *
 * The parenthesized name is found with the node API: `option` nodes and their named
 * children by node type, then the `(` token among a node's children by
 * `child(i).type === "("`. Nothing here matches source text.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/tmp/protobuf/probe/custom-option-refs.mts
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"

function protoFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (e === ".git") continue
      const abs = path.join(dir, e)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(abs)
      else if (e.endsWith(".proto")) out.push(abs)
    }
  }
  return out.sort()
}

const wtsAny: any = await import("web-tree-sitter")
const P = wtsAny.Parser ?? wtsAny.default ?? wtsAny
const L = wtsAny.Language ?? wtsAny.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))

// ---------------------------------------------------------------- the parse-tree side
interface Ref {
  file: string
  row: number
  /** the extension type named, with leading/trailing dots stripped from its parts */
  names: string[]
}
const refs: Ref[] = []
let optionNodes = 0
let optionsWithParen = 0

for (const f of protoFiles(CORPUS)) {
  let text: string
  try {
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  const tree = parser.parse(text)
  if (!tree) continue
  const root = tree.rootNode
  if (root.type !== "source_file") continue

  const walk = (n: any): void => {
    if (n.type === "option") {
      optionNodes++
      // Find the `(` among this option's children, then take the dotted name that
      // follows it, up to the matching `)`. Both are node boundaries, not text.
      const kids: any[] = []
      for (let i = 0; i < n.childCount; i++) kids.push(n.child(i))
      const openIdx = kids.findIndex((c) => c.type === "(")
      if (openIdx >= 0) {
        optionsWithParen++
        const names: string[] = []
        let closed = false
        for (let i = openIdx + 1; i < kids.length && !closed; i++) {
          const c = kids[i]
          if (c.type === ")") {
            closed = true
            break
          }
          if (c.type === ".") continue
          names.push(c.text)
        }
        // An option name may itself be `(ext).(field)` — a chained form. Every
        // parenthesized group in this option contributes its name.
        for (let i = 0; i < kids.length; i++) {
          if (kids[i].type !== "(") continue
          const grp: string[] = []
          for (let j = i + 1; j < kids.length; j++) {
            if (kids[j].type === ")") break
            if (kids[j].type === ".") continue
            grp.push(kids[j].text)
          }
          if (grp.length > 0) names.push(grp.join("."))
        }
        const uniq = [...new Set(names.filter((s) => s.length > 0))]
        if (uniq.length > 0) refs.push({ file: f, row: n.startPosition.row, names: uniq })
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  tree.delete?.()
}

// ---------------------------------------------------------------- the published-symbol side
const publishedIds = new Set<string>()
const publishedNames = new Set<string>()
let filesAnalyzed = 0
let filesLost = 0
for (const f of protoFiles(CORPUS)) {
  let r: any
  try {
    r = await parseFile(f, path.dirname(f))
  } catch {
    filesLost++
    continue
  }
  const syms: any[] = r?.symbols ?? []
  if (syms.length === 0 && (r?.relationships?.length ?? 0) === 0) {
    filesLost++
    continue
  }
  filesAnalyzed++
  for (const s of syms) {
    if (typeof s?.name === "string" && s.name.length > 0) publishedNames.add(s.name)
    const id = s?.meta?.id
    if (typeof id === "string" && id.length > 0) publishedIds.add(id)
  }
}

// ---------------------------------------------------------------- resolution
let refTotal = 0
let nameTotal = 0
let byExactName = 0
let byQualifiedId = 0
let unresolved = 0
const unresolvedExamples: string[] = []
const resolvedExamples: string[] = []

for (const r of refs) {
  refTotal++
  for (const nm of r.names) {
    nameTotal++
    const last = nm.split(".").pop() as string
    const exact = publishedNames.has(nm) || publishedNames.has(last)
    const qual = publishedIds.has(nm)
    if (exact) byExactName++
    if (qual) byQualifiedId++
    if (!exact && !qual) {
      unresolved++
      if (unresolvedExamples.length < 20) unresolvedExamples.push(`${path.relative(CORPUS, r.file)}:${r.row + 1}  ${nm}`)
    } else if (resolvedExamples.length < 20) {
      resolvedExamples.push(`${path.relative(CORPUS, r.file)}:${r.row + 1}  ${nm}  exact=${exact} qualified=${qual}`)
    }
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`)

console.log(`corpus: ${filesAnalyzed} .proto files analyzed (production published nothing: ${filesLost})\n`)
console.log(`CUSTOM OPTIONS`)
console.log(`  option nodes                       ${optionNodes}`)
console.log(`  options naming an extension type   ${optionsWithParen}   ${pct(optionsWithParen, optionNodes)}`)
console.log(`  distinct option references         ${refTotal}`)
console.log(`  names inside them                  ${nameTotal}`)
console.log(`\nRESOLUTION of those names against published symbols`)
console.log(`  binds by name                      ${byExactName}   ${pct(byExactName, nameTotal)}`)
console.log(`  binds by qualified id              ${byQualifiedId}   ${pct(byQualifiedId, nameTotal)}`)
console.log(`  binds either way                   ${byExactName}     ${pct(Math.max(byExactName, byQualifiedId), nameTotal)}`)
console.log(`  UNRESOLVED                         ${unresolved}   ${pct(unresolved, nameTotal)}`)
console.log(`  published symbols in corpus        ${publishedIds.size} ids / ${publishedNames.size} names`)

if (resolvedExamples.length > 0) {
  console.log(`\nRESOLVED (first 20)`)
  for (const e of resolvedExamples) console.log(`  ${e}`)
}
if (unresolvedExamples.length > 0) {
  console.log(`\nUNRESOLVED (first 20)`)
  for (const e of unresolvedExamples) console.log(`  ${e}`)
}

console.log(`\nVERDICT`)
const bindRate = nameTotal === 0 ? 0 : Math.max(byExactName, byQualifiedId) / nameTotal
if (refTotal === 0) {
  console.log(`  No custom option names an extension type in this corpus. Nothing to emit.`)
} else if (bindRate >= 0.5) {
  console.log(`  ${pct(Math.max(byExactName, byQualifiedId), nameTotal)} of the names BIND. A \`uses\` edge from each option to the`)
  console.log(`  extension type it names would resolve. This is a GAP: the construct is present, the analyzer`)
  console.log(`  reads it nowhere, and the edge would be walkable.`)
} else {
  console.log(`  Only ${pct(Math.max(byExactName, byQualifiedId), nameTotal)} of the names bind, so ${pct(unresolved, nameTotal)} of the edges would be UNRESOLVABLE.`)
  console.log(`  Emitting them would add edges the graph cannot walk — the failure mode the contract names`)
  console.log(`  explicitly. The honest verdict is a MEASURED omission, not a silent one: the construct is`)
  console.log(`  present in the corpus and this analyzer does not read it, and the reason it is not read is`)
  console.log(`  that its target is usually an extension declared outside the corpus.`)
}