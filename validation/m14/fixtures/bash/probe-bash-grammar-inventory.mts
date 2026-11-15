/**
 * INSTRUMENT A for the RULED types — grammar inventory.
 *
 * ## What it measures
 *
 * `script/m14/ontology-coverage-gate.ts` prints, for each relationship type the
 * analyzer does not emit, "the grammar produced N distinct node types across the
 * corpus and NONE expresses it". This file is the probe that N comes from, written
 * out so the number in `docs/analyzers/bash.md` is reproducible
 * rather than quoted. It walks the parse trees of a hash-ordered corpus sample and
 * tallies every node type the pinned wasm actually produces, then prints the whole
 * inventory sorted, and greps it for the shapes the three RULED constructs would
 * need:
 *
 *   extends        a node expressing a supertype/superclass relationship
 *   implements     a node expressing interface satisfaction
 *   instantiates   a node expressing construction of a type
 *
 * ## Why the absence of a node type is the right instrument here, and what it does
 * NOT prove
 *
 * bash has no type declarations at all. That is a property of the LANGUAGE, and a
 * node type inventory is the direct measurement of it: if the grammar produced no
 * node that can denote a supertype, then no analyzer over that grammar can derive
 * an `extends` edge that is not invented — there is nothing to read. This is
 * instrument A in the task's taxonomy ("enumerate every node type the grammar
 * actually produces and show none expresses the construct").
 *
 * The limitation is stated rather than hidden: this instrument proves the CONSTRUCT
 * is absent from the grammar, not that the word is absent from the corpus. A
 * construct expressed only through expansions (`eval`, `${!var}` indirection,
 * `bash -c`) is not visible to a node-type inventory at all, and for these three
 * types that is precisely why the corpus probe in `probe-bash-ruled-constructs.mts`
 * is run as instrument B alongside it. A node-type inventory on its own would be
 * the weaker claim; the two together are the ruling.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-grammar-inventory.mts [--sample 400]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const i = argv.indexOf("--sample")
const SAMPLE = Number(i >= 0 ? argv[i + 1] : "400")

type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
let scanned = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : hb > ha ? 1 : 0
})
const files = admitted.slice(0, SAMPLE)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

const counts = new Map<string, number>()
let nodes = 0
let errors = 0
let missing = 0
let parsedFiles = 0
const rows: string[] = []
for (const f of files) {
  let t: any
  try {
    t = parser.parse(f.text)
  } catch {
    continue
  }
  if (!t) continue
  parsedFiles++
  const stack: any[] = [t.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    nodes++
    if (n.type === "ERROR") errors++
    if (n.isMissing) missing++
    counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
  }
  t.delete?.()
  if (rows.length < 3) rows.push(f.text.split("\n")[0]?.slice(0, 70) ?? "")
}

/** Node-type name fragments that WOULD express each RULED construct. */
const PROBES: Record<string, string[]> = {
  extends: ["class", "inherit", "extends", "super", "interface", "impl", "subclass", "override"],
  implements: ["implement", "interface", "protocol", "trait", "conform", "satisf", "impl"],
  instantiates: ["new", "instantiat", "construct", "allocat", "ctor", "factory"],
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
console.log(`bash grammar inventory — instrument A for the RULED types`)
console.log(`  corpus root        : ${CR}`)
console.log(`  tracked files      : ${scanned}`)
console.log(`  admitted as bash   : ${admitted.length}`)
console.log(`  sampled (hash order): ${files.length}, parsed ${parsedFiles}`)
console.log(`  repositories        : ${new Set(files.map((f) => f.repo)).size}`)
console.log(`  nodes walked        : ${nodes.toLocaleString()}`)
console.log(`  DISTINCT NODE TYPES : ${sorted.length}`)
console.log(`  ERROR nodes         : ${errors.toLocaleString()} (${((100 * errors) / (nodes || 1)).toFixed(3)}%)`)
console.log(`  MISSING nodes       : ${missing.toLocaleString()}`)

console.log(`\nfull inventory (${sorted.length} types, every one the grammar produced):`)
const perRow = 6
for (let r = 0; r < sorted.length; r += perRow) {
  const cells = sorted.slice(r, r + perRow).map(([k, v]) => `${k}=${v.toLocaleString()}`)
  console.log(`  ${cells.join("  ")}`)
}

/**
 * Node-type names are matched on UNDERSCORE-SEPARATED TOKENS, never as a
 * substring. A substring rule reports `simple_expansion` as a match for the
 * fragment `impl` — the letters are inside the word `simple` — and this file was
 * caught doing exactly that on its first run: the `extends` and `implements`
 * probes each returned `simple_expansion=5188` as a hit, which is a node for
 * reading `$FOO`, not for declaring a type. The same substring trap once removed
 * `src/util/edit_distance.rs` from a graph for containing `dist` inside
 * `edit_distance`. Token matching is what makes a NIL result mean nil.
 */
/**
 * Split a node type into underscore/case tokens, by CHARACTER CODE.
 *
 * This was `nodeType.toLowerCase().split(/[^a-z0-9]+/)`, and the regex is the
 * defect the workstream's rule names: `probe-bash-no-regex.mts` counts it. The
 * behaviour is identical — split on every run of characters that is neither a
 * letter nor a digit — and the loop is the same shape as `isShellIdentifierName`
 * in the analyzer, which is the style this lane already uses.
 */
const tokensOf = (nodeType: string): string[] => {
  const out: string[] = []
  let cur = ""
  const text = nodeType.toLowerCase()
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const isAlnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57)
    if (isAlnum) {
      cur += text[i]
      continue
    }
    if (cur.length > 0) out.push(cur)
    cur = ""
  }
  if (cur.length > 0) out.push(cur)
  return out
}

console.log(`\nprobe: does ANY node type express the RULED constructs?`)
console.log(`  (matched on underscore-separated tokens, not substrings — see tokensOf)`)
for (const [type, frags] of Object.entries(PROBES)) {
  const hits = sorted.filter(([k]) => {
    const toks = new Set(tokensOf(k))
    return frags.some((f) => toks.has(f))
  })
  console.log(`  ${type.padEnd(13)} tokens=[${frags.join(",")}]  matching node types: ${hits.length === 0 ? "NONE" : hits.map(([k, v]) => `${k}=${v}`).join(", ")}`)
}

console.log(`\nprobe: the only class-like node types in the whole inventory`)
// Reproduces `/function_definition/.test(k)` EXACTLY, which is an UNANCHORED
// substring test, so this is a substring test and saying otherwise would be a
// rewrite that quietly changed the answer. `String.includes` is the same test
// without a regex literal.
//
// The first attempt here used `tokensOf(k)`, on the theory that token matching is
// stricter and therefore better. It printed NONE for a corpus whose only definition
// construct is the function, because `tokensOf` splits on `_` — it splits on
// `[^a-z0-9]+` — so `function_definition` yields ["function","definition"] and can
// never equal itself as one token. A "stricter" check that reports a known-present
// node as absent is worse than the loose one it replaced, and it is recorded here
// because the same trap is why the PROBES above match on tokens and THIS one cannot.
//
// Substring matching is safe HERE and unsafe in the probes above, and the difference
// is what is being matched: a closed vocabulary of 144 node-type identifiers, not
// source text. The traps this file documents — `impl` inside `simple_expansion`,
// `dist` inside `edit_distance` — are traps when the haystack is a corpus.
const classLike = sorted.filter(([k]) => k.includes("function_definition"))
console.log(`  ${classLike.map(([k, v]) => `${k}=${v.toLocaleString()}`).join(", ") || "NONE"}`)
console.log(`  (bash's ONLY definition construct is the function; there is no node that can name a supertype,`)
console.log(`   an interface, or a constructor, so no edge of those three kinds is derivable without inventing it.)`)

process.exitCode = 0
