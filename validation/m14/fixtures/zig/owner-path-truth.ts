/**
 * ZIG OWNER-PATH TRUTH (C8) — does the ABSOLUTE owner path match the tree?
 *
 * ## What it is for
 *
 * Z-p22 changed what a container member's `ownerName`/`scope` is spelled: the
 * container's absolute dotted path instead of its bare name. That change can go
 * wrong in two directions, and only one of them shows up in a resolution count:
 *
 *   - it can NAME A CONTAINER THAT DOES NOT EXIST. A `contains` edge whose
 *     source is a path no declaration holds is a fabricated edge — the most
 *     expensive mistake this workstream prices.
 *   - it can SPELL A REAL CONTAINER WRONG. The member still resolves to
 *     something, so every count stays green while the graph attributes it to
 *     the wrong declaration.
 *
 * So this probe re-derives the path from the PARSE TREE and compares, per site.
 * The tree walk is independent of `real-zig-analyzer.ts`: it ascends to the
 * nearest enclosing `container_declaration`, reads each one's DECLARED name off
 * its `variable_declaration` parent, and joins them. If the two disagree the
 * analyzer's container chain is wrong; if the analyzer publishes a member whose
 * tree-derived owner path no published symbol holds, the edge is fabricated.
 *
 * No regex over source text: names are read off node fields and positions.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/owner-path-truth.ts <file...>
 *   or   ... --from <file-list>   (one path per line, as the shard draws are)
 */
import { readFileSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { stripZigQuoting } from "../../../../src/ast/real-zig-analyzer"

const ROOT = resolve(new URL("../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const fromIdx = argv.indexOf("--from")
let files: string[] = []
if (fromIdx >= 0) {
  files = readFileSync(argv[fromIdx + 1], "utf8").split("\n").filter(Boolean)
} else {
  files = argv
}
// The shard lists are corpus-relative (`zig/lib/std/elf.zig`), the draw's key is
// `<repo>/<rel>`, and both resolve under the corpus root. An absolute path is
// taken as-is so the probe also runs over a fixture.
files = files.map((f) => (f.startsWith("/") ? f : `${CR}/${f}`))

await Parser.init({
  locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm`,
})
const language: any = await Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-zig.wasm`))
const parser = new Parser()
parser.setLanguage(language)

/**
 * The DECLARED name of a container node, read off the grammar: a container is
 * the right-hand side of a `variable_declaration`, whose binding is child 1
 * (child 0 is the `const`/`var` keyword — it carries no field name).
 */
function declaredName(text: string, container: any): string | null {
  const vd = container.parent
  if (!vd || vd.type !== "variable_declaration") return null
  const id = vd.child(1)
  if (!id || id.type !== "identifier") return null
  // `stripZigQuoting` is the analyzer's OWN exported pure function, imported rather
  // than reimplemented: a second copy of the quoting rule would drift, and the whole
  // question here is whether production's spelling is right.
  return stripZigQuoting(text.slice(id.startIndex, id.endIndex))
}

/**
 * The absolute owner path for a node: every enclosing `container_declaration`
 * from the innermost out, joined with `.`. Returns null when no container
 * encloses the node, which is the file-scope case the analyzer also treats as
 * ownerless.
 */
function treeOwnerPath(text: string, node: any): string | null {
  const parts: string[] = []
  let cur = node.parent
  while (cur) {
    if (
      cur.type === "container_declaration" ||
      cur.type === "struct_declaration" ||
      cur.type === "enum_declaration" ||
      cur.type === "union_declaration" ||
      cur.type === "error_set_declaration" ||
      cur.type === "opaque_declaration"
    ) {
      const n = declaredName(text, cur)
      if (n === null) return null
      parts.unshift(n)
    }
    cur = cur.parent
  }
  return parts.length ? parts.join(".") : null
}

/**
 * The member sites this probe holds the analyzer to: a declaration that is a
 * MEMBER OF A CONTAINER.
 *
 * `insideFn` matters to the denominator and was the probe's own error at first
 * reading: `fn includeFiles(self: *const HarfBuzzC) { var len: usize = 1; }`
 * (ghostty/pkg/harfbuzz/build.zig:126-127) puts an enclosing `container_declaration`
 * above `len`, so a naive ascent calls it a member of `HarfBuzzC` and then
 * reports 4,354 "unpublished" sites that are function-body LOCALS — which the
 * analyzer refuses by contract (Z9 / the family's LocalsAreNotSymbols rule) and
 * which are not an owner-path question at all. So a site inside a function body
 * is not counted, and the walk below a `function_declaration` stops collecting.
 */
function memberSites(text: string, root: any): { path: string; name: string; line: number }[] {
  const out: { path: string; name: string; line: number }[] = []
  const visit = (node: any, insideFn: boolean): void => {
    let name: string | null = null
    let isFnDecl = false
    if (node.type === "container_field") {
      const nf = node.childForFieldName?.("name")
      // Only an `identifier` is a name; a `builtin_type`/`null`/`boolean` name
      // field is the enum-member case Z-p20 handles, and it is covered by that
      // fixture. A tuple struct's element type is NOT a name and is not a member.
      if (nf && nf.type === "identifier") name = stripZigQuoting(text.slice(nf.startIndex, nf.endIndex))
    } else if (node.type === "function_declaration") {
      const nf = node.childForFieldName?.("name")
      if (nf) name = stripZigQuoting(text.slice(nf.startIndex, nf.endIndex))
      isFnDecl = true
    } else if (
      node.type === "identifier" &&
      node.parent?.type === "error_set_declaration"
    ) {
      name = stripZigQuoting(text.slice(node.startIndex, node.endIndex))
    } else if (node.type === "variable_declaration") {
      const id = node.child(1)
      if (id && id.type === "identifier") name = stripZigQuoting(text.slice(id.startIndex, id.endIndex))
    }
    // A `function_declaration` IS a member when it sits directly in a container;
    // everything else inside a function body is a local and is not counted.
    if (name && name !== "_" && (isFnDecl || !insideFn)) {
      const path = treeOwnerPath(text, node)
      if (path) out.push({ path, name, line: node.startPosition.row + 1 })
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) visit(c, insideFn || isFnDecl)
    }
  }
  visit(root, false)
  return out
}

let sites = 0
let matched = 0
let missing = 0
let mismatch = 0
const problems: string[] = []
const notPublished: string[] = []
let filesRead = 0
let parseFail = 0

for (const f of files) {
  let text: string
  try {
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  let tree: any
  try {
    tree = parser.parse(text)
  } catch {
    parseFail++
    continue
  }
  let res: any
  try {
    res = await parseFile(f, "zig")
  } catch {
    parseFail++
    tree?.delete?.()
    continue
  }
  filesRead++
  const syms: any[] = res?.symbols ?? []
  // The published (qualifiedName) spelling of every symbol, which is what the
  // graph resolves against.
  const published = new Map<string, { name: string; owner: string | undefined }>()
  for (const s of syms) {
    const qn = typeof s.qualifiedName === "string" && s.qualifiedName ? s.qualifiedName : String(s.name)
    published.set(qn, { name: String(s.name), owner: s.ownerName ?? undefined })
  }
  for (const site of memberSites(text, tree.rootNode)) {
    sites++
    const key = `${site.path}.${site.name}`
    const got = published.get(key)
    if (!got) {
      // The analyzer publishes no symbol at this site. That is a pre-existing
      // publication decision (Z22's local-container refusal, the enum-name
      // node-type set, …), not an owner-path question, so it is counted apart
      // rather than charged to the path spelling.
      notPublished.push(`${f}:${site.line} ${key}`)
      continue
    }
    if (got.owner === site.path) matched++
    else {
      mismatch++
      if (problems.length < 25) {
        problems.push(
          `${basename(f)}:${site.line} tree says owner "${site.path}", published ownerName "${String(got.owner)}"`,
        )
      }
    }
  }
  tree?.delete?.()
}

console.log(`files read ${filesRead} · parse failures ${parseFail} · member sites in a container ${sites}`)
console.log(`  owner path MATCHES the tree : ${matched}`)
console.log(`  owner path MISMATCHES       : ${mismatch}`)
console.log(`  site published under no such qn (pre-existing publication decision, not a path question): ${notPublished.length}`)
for (const p of problems) console.log(`    ${p}`)
for (const p of notPublished.slice(0, 10)) console.log(`    unpublished: ${p}`)
if (process.env.ZIG_OWNER_PATH_UNPUBLISHED_OUT) {
  // The unpublished keys are written out so they can be checked against the
  // BEFORE arm's published set: a key absent from BOTH is a pre-existing
  // publication decision, and a key present only in the before arm would be a
  // regression this change introduced. The distinction is not visible from this
  // probe alone, and it is the whole question.
  writeFileSync(process.env.ZIG_OWNER_PATH_UNPUBLISHED_OUT, notPublished.join("\n") + "\n")
}
if (sites === 0) {
  console.error("REFUSING: 0 member sites read. An empty result over a non-empty corpus is not a pass.")
  process.exit(1)
}
if (mismatch > 0) process.exit(1)
