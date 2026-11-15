/**
 * TOP-LEVEL VALUE POSITIONS — the population a positional fix for bucket A would touch.
 *
 * ## Why this file exists, and what it settles that `top-level-siblings.ts` does not
 *
 * `top-level-siblings.ts` defines a multi-value document as `document.namedChildCount > 1`
 * and measures **103** of them. That count is the right POPULATION for "how many documents
 * parse as more than one named child" and the wrong gate for a fix, because a `comment` is a
 * named child of `document` in this grammar and a comment is not a value. The measured shapes
 * say so directly: `comment+object` is the single most common shape at 24 files, and
 * `comment+comment+object` adds 6 more. Indexing those would move the object from
 * `<module>` to `<module>[2]` for no reason at all, in 30+ files whose names are not
 * ambiguous and never were.
 *
 * So the question this file answers is narrower and it is the one the fix turns on:
 *
 *   **how many documents have more than one VALUE among `document`'s named children?**
 *
 * Only those can publish one qualified name twice, because only a second value introduces a
 * second top-level key path. Everything else must keep its current name, and the number that
 * must NOT move is reported alongside so a regression is visible.
 *
 * ## What is counted
 *
 *   valueKinds          the histogram of VALUE count per document, over all admitted files
 *   multiValueDocuments documents with >=2 values — the population a positional fix changes
 *   singleValueWithExtras documents with exactly 1 value plus comments/ERROR — the ones a
 *                       naive `namedChildCount > 1` gate would wrongly move
 *   valueChildren       every positionable child, with the node type and index it would get
 *
 * ## Regex-free: node types, child counts and cursor walks only.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/top-level-value-positions.ts [--json] [--limit N]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { admittedFiles } from "./admitted-files"

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const li = argv.indexOf("--limit")
const LIMIT = li >= 0 ? Number(argv[li + 1]) || 0 : 0
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** The node types that are JSON VALUES. `comment` and `ERROR` are not: a comment carries no
 *  data and an ERROR node is the grammar's recovery shape, so neither introduces a key. */
const VALUE_TYPES = new Set(["object", "array", "string", "number", "true", "false", "null"])

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))

async function main(): Promise<void> {
  const walk = admittedFiles(CR)
  const files = LIMIT > 0 ? walk.files.slice(0, LIMIT) : walk.files
  const p = new Parser()
  p.setLanguage(await Language.load(wasm))

  const valueKinds = new Map<number, number>()
  let multiValueDocuments = 0
  let singleValueWithExtras = 0
  let singleValuePlain = 0
  let zeroValues = 0
  let parseFailures = 0
  const valueChildren: { file: string; index: number; type: string; line: number }[] = []
  const multiExamples: string[] = []
  const extraExamples: string[] = []

  for (const f of files) {
    let tree: any
    try {
      tree = p.parse(readFileSync(f.abs, "utf8"))
    } catch {
      parseFailures++
      continue
    }
    // The tree must be freed or the WASM heap grows until the module aborts — measured, not
    // hypothetical: without this, 5,506 of 13,951 files read as parse failures.
    const root = tree.rootNode
    if (root.type !== "document") {
      tree.delete?.()
      continue
    }
    const values: { index: number; type: string; line: number }[] = []
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (!c) continue
      if (VALUE_TYPES.has(c.type)) values.push({ index: i, type: c.type, line: c.startPosition.row + 1 })
    }
    const label = `${f.repo}/${f.rel}`
    tree.delete?.()

    valueKinds.set(values.length, (valueKinds.get(values.length) ?? 0) + 1)
    if (values.length === 0) {
      zeroValues++
      continue
    }
    if (values.length > 1) {
      multiValueDocuments++
      if (valueChildren.length < 60) for (const v of values) valueChildren.push({ file: label, ...v })
      if (multiExamples.length < 12) multiExamples.push(`${label}: ${values.length} values at indices ${values.map((v) => v.index).join(",")}`)
    } else if (root.namedChildCount > 1) {
      singleValueWithExtras++
      if (extraExamples.length < 12) extraExamples.push(`${label}: 1 value, ${root.namedChildCount} named children`)
    } else {
      singleValuePlain++
    }
  }

  const report = {
    files: files.length,
    parseFailures,
    valueKinds: Object.fromEntries([...valueKinds].sort((a, b) => a[0] - b[0])),
    multiValueDocuments,
    singleValueWithExtras,
    singleValuePlain,
    zeroValues,
    valueChildren,
    multiExamples,
    extraExamples,
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`top-level value positions — ${files.length} admitted file(s), ${parseFailures} parse failures`)
  console.log("")
  console.log(`documents with >=2 top-level VALUES  : ${multiValueDocuments}   <-- a positional fix changes these`)
  console.log(`1 value + comments/ERROR siblings    : ${singleValueWithExtras}   <-- must NOT move`)
  console.log(`exactly one value, one named child   : ${singleValuePlain}`)
  console.log(`no top-level value                   : ${zeroValues}`)
  console.log("")
  console.log("value count per document:")
  for (const [k, v] of [...valueKinds].sort((a, b) => a[0] - b[0])) console.log(`  ${k} value(s)  ${v} document(s)`)
  console.log("")
  console.log("multi-value documents, first 12:")
  for (const e of multiExamples) console.log(`  ${e}`)
  console.log("")
  console.log("one value + extras, first 12:")
  for (const e of extraExamples) console.log(`  ${e}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})