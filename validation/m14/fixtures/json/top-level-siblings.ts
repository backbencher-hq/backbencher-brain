/**
 * TOP-LEVEL SIBLING COLLISIONS — how many files publish one qualified name more than once.
 *
 * ## The defect this measures
 *
 * `str-lit-type-mismatch.json` is a SEQUENCE of four concatenated top-level JSON objects in
 * one file (rustfix's compiler-diagnostic fixtures; cargo tracks 3 such files, and
 * `str-lit-type-mismatch.json` opens a new `{` at line 71). tree-sitter's `json` grammar
 * parses that as ONE `document` node with FOUR named children.
 *
 * `extractSymbols` seeds its stack with the `document` node and `pushNamedChildren` pushes
 * every named child under the SAME `parentPath` — `ctx.rootName`. So all four top-level
 * objects are addressed as `str-lit-type-mismatch.<key>`, and the analyzer publishes:
 *
 *     name=code kind=class    qn=str-lit-type-mismatch.code  line 3
 *     name=code kind=class    qn=str-lit-type-mismatch.code  line 73
 *     name=code kind=class    qn=str-lit-type-mismatch.code  line 143
 *     name=code kind=property qn=str-lit-type-mismatch.code  line 213
 *
 * FOUR distinct symbols under ONE qualified name, and the 4th has a different kind from the
 * other three, so this is the whole of bucket A in the ambiguity split and the one place
 * where the reverse walk can pick a winner that is simply the wrong line.
 *
 * This is the SAME class of defect as the top-level-array naming fix (19,708 names over 214
 * files) and the fix is the same shape: a container that holds N siblings needs to give them
 * N positions, because a JSON key is not a name. A top-level array is indexed `rootName[i]`
 * by `arrayItemName`; N top-level OBJECTS are not indexed at all.
 *
 * ## What is counted, and what is not
 *
 * Counted, per file, on the parse tree:
 *
 *   - `multiValueDocuments`   — a `document` node with >1 named child. The population.
 *   - `collidingQualifiedNames` — distinct qualified names the analyzer would publish more
 *     than once. Derived from the TREE by walking the same path construction the analyzer
 *     uses, not by reading the analyzer's output, so it is independent of the defect.
 *   - `kindsDisagree`          — of those, how many carry >1 distinct kind, i.e. how many the
 *     shared arbiter will count as AMBIGUOUS rather than merely duplicated.
 *   - the SIBLING SHAPES that produce it: N objects, objects mixed with arrays, etc.
 *
 * NOT counted here: whether a name is ambiguous against OTHER files. That is bucket B/C in
 * `ambiguity-split.ts`, and it is a different cause with a different owner.
 *
 * Regex-free: node types, child counts and cursor walks only. It never reads source text.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/top-level-siblings.ts [--limit N] [--json]
 */
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { admittedFiles, describeWalk } from "./admitted-files"

const argv = process.argv.slice(2)
const argOf = (k: string, d: string): string => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const JSON_OUT = argv.includes("--json")
const LIMIT = Number(argOf("--limit", "0"))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))

/**
 * Walk the tree the way `extractSymbols` does — `document` -> `object` -> `pair` key/value —
 * and record every qualified path with its occurrence count and kind.
 *
 * The path construction mirrors the analyzer: a keyed child is `<parentPath>.<key>`, and an
 * array element is `<self>[<index>]`. It is re-derived here deliberately: this probe must be
 * able to see the defect, so it must not ask the code that has it.
 */
function walkPaths(root: any, rootName: string): Map<string, { count: number; kinds: Set<string>; owners: Set<number> }> {
  const out = new Map<string, { count: number; kinds: Set<string>; owners: Set<number> }>()
  const bump = (p: string, kind: string, owner: number): void => {
    const row = out.get(p)
    if (row) {
      row.count++
      row.kinds.add(kind)
      row.owners.add(owner)
    } else out.set(p, { count: 1, kinds: new Set([kind]), owners: new Set([owner]) })
  }
  /** `arrayItemName`'s short name for an array's element: the path's last segment, except that
   *  an element's own last segment ends in `]` and is named by what follows the module. */
  const lastSegment = (arrayPath: string, root: string): string => {
    if (arrayPath === root) return root
    const last = arrayPath.slice(arrayPath.lastIndexOf(".") + 1)
    if (!last.endsWith("]")) return last
    const dot = arrayPath.indexOf(".", root.length)
    return dot < 0 ? arrayPath.slice(root.length) : arrayPath.slice(dot + 1)
  }
  const unquote = (t: string): string => {
    const v = t.trim()
    return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v
  }
  const keyOf = (pair: any): string | null => {
    if (pair?.type !== "pair") return null
    const k = pair.childForFieldName?.("key")
    if (!k) return null
    const c = k.namedChildren?.find((x: any) => x.type === "string_content")
    return c ? String(c.text ?? "") : unquote(String(k.text ?? ""))
  }
  const valueType = (v: any): string => {
    if (!v) return "unknown"
    if (v.type === "object") return "object"
    if (v.type === "array") return "array"
    return "scalar"
  }
  // The KIND the analyzer publishes: object -> class, everything else -> property.
  const kindFor = (v: any): string => (valueType(v) === "object" ? "class" : "property")

  // `owner` is the index of the top-level value the symbol came from. Two occurrences under the
  // same path with DIFFERENT owners is the defect; the same owner is a duplicate key inside one
  // object, which is the `overrides` case and has no position to separate it.
  const stack: any[] = [{ node: root, parentPath: rootName, parentName: rootName, owner: 0 }]
  while (stack.length) {
    const { node, parentPath, parentName, owner } = stack.pop()
    if (node.type === "document") {
      // The defect: every named child of `document` shares one parentPath.
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, parentPath, parentName, owner: i })
      }
      continue
    }
    if (node.type === "array") {
      // The CHILD keeps the array's qualified path and gains an index — `pushArrayChildren`'s
      // `itemPath`, not `arrayItemName`'s short `item`. Those are two different strings and only
      // the second one is the symbol NAME: an earlier version of this probe used the short name
      // for the path, which drops every prefix before the array's own key, and that reports
      // duplicates the analyzer does not publish (`statuses[0].x` and `statuses[1].x` collide
      // only if the prefix is thrown away). Deriving the population is only independent of the
      // analyzer if it also derives it CORRECTLY.
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, parentPath: `${parentPath}[${i}]`, parentName: lastSegment(parentPath, rootName), owner })
      }
      continue
    }
    if (node.type === "object") {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const pair = node.namedChild(i)
        if (pair?.type !== "pair") continue
        const key = keyOf(pair)
        if (key === null) continue
        const value = pair.childForFieldName?.("value")
        const childPath = `${parentPath}.${key}`
        bump(childPath, kindFor(value), owner)
        if (value) stack.push({ node: value, parentPath: childPath, parentName: key, owner })
      }
      continue
    }
  }
  return out
}

async function main(): Promise<void> {
  const walk = admittedFiles(CR)
  const files = LIMIT > 0 ? walk.files.slice(0, LIMIT) : walk.files
  const p = new Parser()
  const lang = await Language.load(wasm)
  p.setLanguage(lang)

  let multiValue = 0
  let filesWithDuplicates = 0
  let duplicateNames = 0
  let kindsDisagree = 0
  let symbolsInvolved = 0
  let fromSiblingValues = 0
  let occurrencesFromSiblingValues = 0
  let filesWithSiblingDuplicates = 0
  let duplicateKeyNames = 0
  let occurrencesInDuplicateKeys = 0
  const shapes = new Map<string, number>()
  const examples: string[] = []
  const sharpest: { file: string; path: string; count: number }[] = []
  let parseFailures = 0

  for (const f of files) {
    let tree: any
    try {
      const text = readFileSync(f.abs, "utf8")
      tree = p.parse(text)
    } catch {
      parseFailures++
      continue
    }
    // The tree must be freed or the WASM heap grows until the module aborts. This is not
    // hypothetical: an earlier version of this probe WITHOUT the delete reported 5,506 of
    // 13,951 files as "parse failures", and every one of them was an out-of-memory abort of
    // the whole module rather than a file the parser could not read — so the population
    // below was measured against a corpus 40% smaller than the one claimed. Measured: with
    // the delete, 13,951 of 13,951 parse and 0 abort.
    const root = tree.rootNode
    if (root.type !== "document") {
      tree.delete?.()
      continue
    }
    const n = root.namedChildCount
    if (n <= 1) {
      tree.delete?.()
      continue
    }
    multiValue++
    const shapeParts: string[] = []
    for (let i = 0; i < n; i++) shapeParts.push(root.namedChild(i)?.type ?? "?")
    const shape = shapeParts.join("+")
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1)

    const rootName = documentName(f.abs)
    const paths = walkPaths(root, rootName)
    let dupsHere = 0
    let siblingDupsHere = 0
    for (const [p2, row] of paths) {
      if (row.count <= 1) continue
      dupsHere++
      duplicateNames++
      symbolsInvolved += row.count
      if (row.kinds.size > 1) kindsDisagree++
      if (row.owners.size > 1) {
        fromSiblingValues++
        siblingDupsHere++
        occurrencesFromSiblingValues += row.count
        sharpest.push({ file: f.abs, path: p2, count: row.count })
      } else {
        duplicateKeyNames++
        occurrencesInDuplicateKeys += row.count
      }
      if (examples.length < 20) examples.push(`${f.abs}: ${p2} x${row.count} owners=${row.owners.size} kinds=[${[...row.kinds].join(",")}]`)
    }
    if (dupsHere > 0) filesWithDuplicates++
    if (siblingDupsHere > 0) filesWithSiblingDuplicates++
    tree.delete?.()
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ files: files.length, multiValueDocuments: multiValue, filesWithDuplicates, duplicateNames, kindsDisagree, symbolsInvolved, fromSiblingValues, occurrencesFromSiblingValues, filesWithSiblingDuplicates, duplicateKeyNames, occurrencesInDuplicateKeys, shapes: Object.fromEntries([...shapes].sort((a, b) => b[1] - a[1])), examples, sharpest: sharpest.sort((a, b) => b.count - a.count).slice(0, 25), parseFailures }, null, 2))
    return
  }
  console.log(describeWalk(walk, CR))
  console.log(`files probed                        : ${files.length}`)
  console.log(`parse failures                      : ${parseFailures}`)
  console.log(`documents with >1 top-level value   : ${multiValue}`)
  console.log(`  of those, with a DUPLICATE path   : ${filesWithDuplicates}`)
  console.log(`duplicate qualified names           : ${duplicateNames}`)
  console.log(`  of those, KINDS DISAGREE          : ${kindsDisagree}`)
  console.log(`symbol occurrences involved         : ${symbolsInvolved}`)
  console.log("")
  console.log("SPLIT BY CAUSE — they have different owners and different fixes:")
  console.log(`  from >1 top-level VALUE           : ${fromSiblingValues} names / ${occurrencesFromSiblingValues} occurrences, in ${filesWithSiblingDuplicates} files`)
  console.log(`    -> a container with N siblings needs N positions. FIXABLE.`)
  console.log(`  duplicate key in ONE object       : ${duplicateKeyNames} names / ${occurrencesInDuplicateKeys} occurrences`)
  console.log(`    -> that is the \`overrides\` case; the duplicate name is inherent to the shape.`)
  console.log("")
  console.log("sibling shapes of a multi-value document:")
  for (const [shape, n] of [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${pad(shape, 60)} ${n}`)
  console.log("")
  console.log("sharpest files by occurrences on one duplicated path:")
  const byFile = new Map<string, number>()
  for (const s of sharpest) byFile.set(s.file, (byFile.get(s.file) ?? 0) + s.count)
  for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${pad(file, 96)} ${n} occurrences`)
  console.log("")
  for (const e of examples) console.log(`  ${e}`)
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

/** The analyzer's documented identity for a document: the basename without its extension. */
function documentName(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1)
  const lower = base.toLowerCase()
  for (const suffix of [".json", ".jsonc", ".json5"]) {
    if (lower.endsWith(suffix)) return base.slice(0, base.length - suffix.length) || "document"
  }
  return base || "document"
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})