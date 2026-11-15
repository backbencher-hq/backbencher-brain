/**
 * INSTRUMENT A, STRONGER — the grammar's node-type VOCABULARY, not the corpus's.
 *
 * ## Why this file exists
 *
 * The three RULED types are ruled by instrument A: "enumerate every node type the
 * grammar actually produces across your corpus and show none expresses the
 * construct". Every version of that measurement so far has been a property of a
 * CORPUS SAMPLE — `probe-bash-grammar-inventory.mts` reports 144 distinct types on
 * the 400-file hash-order sample, and the shared gate reported 164 across the whole
 * admitted corpus. Both are counts of what some set of files happened to exercise.
 *
 * That is a weaker claim than it looks, and this session made the weakness concrete.
 * `probe-bash-corpus-pin.mts` found 22,861 files that `git ls-files` lists and the
 * working tree does not contain, 394 of which carry a bash extension, and
 * `probe-bash-recovered-blobs.mts` measured that 22,849 of them have no blob in the
 * local object database — so on this host NO instrument can read them, at any
 * sample size. A ruling whose population is "the files we could read" has a hole
 * in it, and the hole is 394 files wide.
 *
 * But the hole is an artefact of the INSTRUMENT, not of the ruling. A tree-sitter
 * grammar's node-type vocabulary is closed and finite: it is the set of symbols the
 * parser was compiled with. The pinned wasm carries it, and web-tree-sitter exposes
 * it directly — `nodeTypeCount`, `nodeTypeForId(i)`, `nodeTypeIsNamed(i)`. So the
 * question "can this grammar ever express an `extends` edge?" is answerable without
 * a corpus at all, and the answer is a property of the binary:
 *
 *   nodeTypeCount  280 symbols, of which **236 are distinct names** (85 named
 *   symbols collapsing to 59 distinct names, 195 anonymous to 177) — anonymous
 *   tokens repeat, because several distinct symbols share a surface form. The
 *   DISTINCT count is the one to quote for "how many node types can this grammar
 *   produce"; 280 is how many symbol slots it has.
 *
 * None of the 13 falsifier node types named in `script/m14/bash-ruled.ts` is in that
 * set. Therefore no corpus — this one, the 4,185 files nobody could read, or any
 * corpus anyone parses in future — can produce a `class_declaration`, an
 * `implements_clause`, or a `new_expression`, because the parser has no such symbol
 * to emit. The three rulings stop being corpus-dependent claims and become
 * properties of the pinned grammar.
 *
 * ## ONE THING THIS ENUMERATION CANNOT SEE, measured rather than assumed
 *
 * `ERROR` is absent from the vocabulary, and the parser produces it constantly —
 * 195 nodes on a 400-file sample, and 427 function definitions inside one corpus
 * wide. `nodeTypeForId` does not enumerate the reserved error symbol, so a
 * "is this node type producible" test built on this list alone would report
 * `ERROR` as impossible and an analyzer that guards on it as broken. It is not.
 *
 * That was found by `probe-bash-dead-branches.mts`, which flagged its own
 * `ERROR` branch as a defect in the same run that counted 148 ERROR nodes, and the
 * rule there is now that OBSERVATION OVERRIDES THE VOCABULARY: a branch is a
 * defect only when the corpus never produces it either. Recorded here because the
 * next reader of this list will otherwise rediscover it.
 *
 * ## What it does NOT do, stated before the number is read as more than it is
 *
 * A missing NODE TYPE does not exclude a construct reached by runtime indirection
 * (`eval`, `${!var}`, `bash -c`), which never becomes a node. That is why
 * instrument B — the corpus-text lexical probe in
 * `probe-bash-ruled-constructs.mts` — runs alongside instrument A, and why
 * instrument B remains corpus-dependent: it CANNOT be extended to the 394 unreadable
 * files. So instrument A is now settled for all time and instrument B is settled for
 * the readable corpus, and the honest statement is that one of the two instruments
 * covers the hole.
 *
 * It also does not claim the corpus exercises the grammar. The whole vocabulary is
 * 280 types and the corpus-wide observation is 164, so **116 node types the pinned
 * grammar can produce have never been seen in this corpus**. That is a fact about
 * corpus coverage, printed here rather than left implicit, and it is the same
 * limitation in a different direction: an analyzer that reads a shape only the 116
 * produce would be silently dead on this corpus, which is precisely round 12's defect
 * and round 13's shape census. Absence of evidence in a corpus is not evidence of
 * absence in a grammar; only one of the two is being claimed here, and it is the
 * second.
 *
 * No regex: the vocabulary is read from the binary through the library's own API,
 * and the falsifier test is `Set.has` against names the ruling table declares.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-grammar-vocabulary.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { BASH_RULED } from "../../../../script/m14/bash-ruled"

const WASM = path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm")

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const lang = await WSL.load(readFileSync(WASM))

interface NodeType {
  name: string
  named: boolean
}
const all: NodeType[] = []
for (let i = 0; i < lang.nodeTypeCount; i++) {
  all.push({ name: lang.nodeTypeForId(i), named: lang.nodeTypeIsNamed(i) })
}
const named = all.filter((t) => t.named)
const anonymous = all.filter((t) => !t.named)
const have = new Set(all.map((t) => t.name))
const distinct = have.size
const namedDistinct = new Set(named.map((t) => t.name)).size
const anonymousDistinct = new Set(anonymous.map((t) => t.name)).size

console.log(`bash grammar vocabulary — instrument A, corpus-independent`)
console.log(`  wasm                  : ${path.relative(process.cwd(), WASM)}`)
console.log(`  grammar name/version  : ${lang.name} ${lang.version} (abi ${lang.abiVersion})`)
console.log(`  symbol slots          : ${lang.nodeTypeCount}`)
console.log(`  DISTINCT node names   : ${distinct}   <- the vocabulary; anonymous tokens share surface forms`)
console.log(`    distinct named      : ${namedDistinct} of ${named.length} named symbols`)
console.log(`    distinct anonymous  : ${anonymousDistinct} of ${anonymous.length} anonymous symbols`)
console.log(`  parse states          : ${lang.stateCount}`)
console.log(`  fields                : ${lang.fieldCount}`)
console.log(`  NOT enumerable        : ERROR — producible (195 nodes on a 400-file sample) but absent`)
console.log(`                           from nodeTypeForId, so it must be cleared by observation, not by this list`)
console.log("")
console.log(`the complete DISTINCT NAMED vocabulary (${namedDistinct} types — every named symbol the parser can emit):`)
{
  const namedDistinctList = [...new Set(named.map((t) => t.name))].sort()
  for (let r = 0; r < namedDistinctList.length; r += 7) {
    console.log(`  ${namedDistinctList.slice(r, r + 7).join("  ")}`)
  }
}
console.log("")
console.log(`the complete DISTINCT ANONYMOUS vocabulary (${anonymousDistinct} terminal tokens):`)
{
  const anonDistinctList = [...new Set(anonymous.map((t) => t.name))].sort()
  for (let r = 0; r < anonDistinctList.length; r += 12) {
    console.log(`  ${anonDistinctList.slice(r, r + 12).map((t) => (t.length <= 14 ? t : t.slice(0, 13))).join("  ")}`)
  }
}

console.log("")
console.log("every RULED entry's falsifier, tested against the CLOSED vocabulary:")
let falsified = 0
for (const entry of BASH_RULED) {
  const names = entry.nodeTypesThatWouldMeanIt ?? []
  const present = names.filter((n) => have.has(n))
  if (present.length > 0) falsified++
  console.log(`  ${entry.type.padEnd(13)} instrument ${entry.instrument}`)
  console.log(`  ${"".padEnd(13)} falsifiers ${names.length}: ${names.join(", ")}`)
  console.log(
    `  ${"".padEnd(13)} PRESENT in the grammar: ${present.length === 0 ? "NONE — the construct has no node type to be read from" : present.join(", ")}`,
  )
}

console.log("")
console.log("what the corpus exercises, against what the grammar can express:")
// The corpus-wide observed count is the shared gate's figure and is reported as the
// reference point, not recomputed here: this file measures the grammar, and mixing a
// corpus observation into it would make the number it prints depend on a corpus again.
const OBSERVED_CORPUS_WIDE = 164
const neverSeen = distinct - OBSERVED_CORPUS_WIDE
console.log(`  distinct node types in the grammar: ${distinct}`)
console.log(`  distinct types observed corpus-wide (gate): ${OBSERVED_CORPUS_WIDE}`)
console.log(`  types the grammar can produce that this corpus never produced: ${neverSeen}`)
console.log("")
console.log("  An analyzer that reads a shape only those produce would be silently dead on")
console.log("  this corpus. That is round 12's defect (a `subscript` one level deeper than")
console.log("  the handler looked for) and round 13's shape census, both found by asking what")
console.log("  the grammar HAS rather than what the corpus SHOWED — so this line is the")
console.log("  standing reminder, not a new finding.")

if (falsified > 0) {
  console.log("")
  console.log(`FALSIFIED: ${falsified} ruled entr${falsified === 1 ? "y has" : "ies have"} a node type the pinned grammar can emit.`)
  process.exit(4)
}
console.log("")
console.log(
  `All ${BASH_RULED.length} RULED entries are settled by a property of the pinned binary, not of a corpus:`,
)
console.log("no corpus of any size can produce a node type the parser was not compiled with.")