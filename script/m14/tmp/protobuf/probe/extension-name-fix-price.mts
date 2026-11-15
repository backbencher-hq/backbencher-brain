/**
 * WHAT WOULD THE FIX BE WORTH? — the price of publishing extension fields under their
 * PROTOBUF name instead of the extendee's scope.
 *
 * ## The finding that produced this file
 *
 * A custom option references the extension type in its parentheses:
 * `option (google.api.http).get = "/v1/x";`. Protobuf addresses an extension field by
 * ITS OWN fully-qualified name — the package of the file that declares it, plus the
 * field name — so `google.api.http` is correct even though the extension is declared as
 *
 *   extend google.protobuf.MethodOptions {      // annotations.proto, package google.api
 *     HttpRule http = 72295728;
 *   }
 *
 * This analyzer publishes that field as `google.protobuf.MethodOptions.http`, i.e. under
 * the EXTENDED TYPE's scope. So every custom-option reference misses it.
 *
 * Measured by implementing the `option` -> extension `uses` edge and running the census:
 * `uses` 13,275 -> 14,806 (+1,531) and edges resolving at BOTH ends 9,673 -> 9,673. The
 * 1,531 new edges resolved at 0%. That edge is therefore NOT in the analyzer: shipping it
 * would add edges the graph cannot walk.
 *
 * ## The question this file answers
 *
 * The id change is not a small edit — it moves the published id of every extension field,
 * which is an endpoint of `contains` edges and therefore of `bb_impact` and reverse walks.
 * Before proposing it, the number needed is: **if extensions were published under
 * `<package>.<field>`, how many of the option references would bind?**
 *
 *   near 0    -> the declarations are not in the corpus (sparse checkouts); the fix buys
 *                nothing measurable and should wait for the corpus
 *   high      -> the fix is real and the corpus holds the declarations; it is worth
 *                doing, with the oracle battery re-run because ids move
 *
 * This probe does NOT resolve names loosely. For each option reference it asks the parse
 * tree a structural question: is there a file whose PACKAGE matches the reference's
 * package and which declares, inside an `extend` block, a field with the reference's last
 * component? That is the declaration protoc would resolve to.
 *
 * ## NO REGEX
 *
 * Packages and field names are read from the tree (`package` node's `full_ident`, `extend`
 * node's body children). Nothing matches source text.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/tmp/protobuf/probe/extension-name-fix-price.mts
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

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

// ------------------------------------------------ what extensions the corpus actually declares
/**
 * `pkg.field` -> the extendee, for every field declared inside an `extend` block. Keyed by
 * the name protoc would give it, so the option side and this side use ONE convention.
 */
const extensionDecls = new Map<string, { file: string; extendee: string; row: number }>()
let extendBlocks = 0
let extendFields = 0
let filesAnalyzed = 0
let filesLost = 0

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

  // The file's package, read off the `package` node's `full_ident` child.
  let pkg = ""
  const walkTop = (n: any): boolean => {
    if (n.type === "package") {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && (c.type === "full_ident" || c.type === "ident")) {
          pkg = c.text
          return true
        }
      }
    }
    return false
  }
  walkTop(root)
  pkg = pkg.replace(/^\.+/, "")

  const visit = (n: any): void => {
    if (n.type === "extend") {
      extendBlocks++
      let extendee = ""
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && (c.type === "full_ident" || c.type === "message_or_enum_type" || c.type === "type")) {
          extendee = c.text
          break
        }
      }
      const body = (() => {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c.type === "message_body") return c
        }
        return null
      })()
      if (body) {
        for (let i = 0; i < body.childCount; i++) {
          const fld = body.child(i)
          if (!fld) continue
          if (fld.type !== "field" && fld.type !== "map_field") continue
          extendFields++
          let fname = ""
          for (let j = 0; j < fld.childCount; j++) {
            const c = fld.child(j)
            if (c && (c.type === "identifier" || c.type === "field_name")) {
              fname = c.text
              break
            }
          }
          if (fname.length === 0) continue
          const key = pkg.length > 0 ? `${pkg}.${fname}` : fname
          if (!extensionDecls.has(key)) extensionDecls.set(key, { file: f, extendee, row: fld.startPosition.row + 1 })
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  tree.delete?.()
  filesAnalyzed++
}

// ------------------------------------------------ what the options reference
interface Ref {
  file: string
  row: number
  ref: string
}
const refs: Ref[] = []
for (const f of protoFiles(CORPUS)) {
  let text: string
  try {
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  const tree = parser.parse(text)
  if (!tree) continue
  if (tree.rootNode.type !== "source_file") continue
  const visit = (n: any): void => {
    if (n.type === "option") {
      const kids: any[] = []
      for (let i = 0; i < n.childCount; i++) kids.push(n.child(i))
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].type !== "(") continue
        const parts: string[] = []
        for (let j = i + 1; j < kids.length; j++) {
          if (kids[j].type === ")") break
          if (kids[j].type === ".") continue
          parts.push(kids[j].text)
        }
        const joined = parts.join(".").replace(/^\.+/, "")
        if (joined.length > 0) refs.push({ file: f, row: n.startPosition.row + 1, ref: joined })
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(tree.rootNode)
  tree.delete?.()
}

// ------------------------------------------------ the verdict
let wouldBind = 0
let wouldNotBind = 0
const notFound: string[] = []
const found: string[] = []
for (const r of refs) {
  if (extensionDecls.has(r.ref)) {
    wouldBind++
    if (found.length < 15) found.push(`${r.ref}  declared in ${path.relative(CORPUS, extensionDecls.get(r.ref)!.file)}:${extensionDecls.get(r.ref)!.row}  extend ${extensionDecls.get(r.ref)!.extendee}`)
  } else {
    wouldNotBind++
    if (notFound.length < 15) notFound.push(r.ref)
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`)

console.log(`corpus: ${filesAnalyzed} .proto files\n`)
console.log(`EXTENSIONS THE CORPUS DECLARES`)
console.log(`  extend blocks                       ${extendBlocks}`)
console.log(`  fields inside extend blocks         ${extendFields}`)
console.log(`  distinct \`package.field\` names       ${extensionDecls.size}`)
console.log(`\nCUSTOM OPTIONS`)
console.log(`  option extension references         ${refs.length}`)
console.log(`\nIF EXTENSIONS WERE PUBLISHED AS \`package.field\``)
console.log(`  reference would BIND                ${wouldBind}   ${pct(wouldBind, refs.length)}`)
console.log(`  reference would NOT bind            ${wouldNotBind}   ${pct(wouldNotBind, refs.length)}`)

if (found.length > 0) {
  console.log(`\nWOULD BIND (first 15)`)
  for (const s of found) console.log(`  ${s}`)
}
if (notFound.length > 0) {
  console.log(`\nWOULD NOT BIND (first 15 distinct)`)
  for (const s of [...new Set(notFound)].slice(0, 15)) console.log(`  ${s}`)
}

console.log(`\nVERDICT`)
const rate = refs.length === 0 ? 0 : wouldBind / refs.length
if (rate >= 0.8) {
  console.log(`  ${pct(wouldBind, refs.length)} would bind. The fix is REAL and the corpus holds the declarations:`)
  console.log(`  publishing extension fields under their protobuf name would turn ${wouldBind} unresolvable`)
  console.log(`  references into walkable edges. It is worth doing — and it moves ids that \`contains\`,`)
  console.log(`  \`bb_impact\` and the reverse walk consume, so the descriptor oracle must be re-run.`)
} else if (rate > 0) {
  console.log(`  Only ${pct(wouldBind, refs.length)} would bind. A partial fix: it would make ${wouldBind} references walkable and`)
  console.log(`  leave ${wouldNotBind} pointing at extensions this corpus does not hold. Emit the edge only for`)
  console.log(`  references that resolve, and the unresolvable remainder stays a measured non-edge.`)
} else {
  console.log(`  NONE would bind: no extension field in this corpus carries the package-qualified name an`)
  console.log(`  option references. The declarations are in files the sparse checkouts do not hold, so the`)
  console.log(`  fix cannot be validated here and should wait for the corpus.`)
}