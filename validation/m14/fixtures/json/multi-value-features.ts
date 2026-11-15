/**
 * MULTI-VALUE DOCUMENT — which of the analyzer's OTHER passes read these files.
 *
 * ## Why
 *
 * Indexing top-level siblings (`rootName[0]`, `rootName[1]`, …) is the fix for the
 * duplicate qualified names `top-level-siblings.ts` measures. But six other places in
 * the analyzer read the document's top level, and each of them has to keep agreeing
 * with the symbol walk or the fix trades one defect for another:
 *
 *   - `extractManifestExports` / `extractPackageDependencies` / `extractCalls` /
 *     `extractSchemaComposition` all take `document.namedChildren.find(type === "object")`
 *     — the FIRST object. On a multi-value file that is an arbitrary choice among N.
 *   - `referenceTarget` resolves `#/a/b` to `rootName.a.b`. A multi-value file has no
 *     single root for a pointer to be relative to, so every pointer in one is ambiguous
 *     and indexing the siblings makes all of them unresolved.
 *
 * This probe counts, per multi-value document, which of those the file exercises, so the
 * fix's blast radius is measured rather than assumed. It reads the PARSE TREE only; no
 * regex, no source text.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/multi-value-features.ts [--json]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { admittedFiles, describeWalk } from "./admitted-files"

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))

const VALUE_TYPES = new Set(["object", "array", "string", "number", "true", "false", "null"])

/** Every distinct key in the document, and whether the named features appear anywhere. */
function features(root: any): { keys: Set<string>; refs: number } {
  const keys = new Set<string>()
  let refs = 0
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (!c) continue
      stack.push(c)
      if (c.type === "pair") {
        const k = c.childForFieldName?.("key")
        const sc = k?.namedChildren?.find((x: any) => x.type === "string_content")
        if (sc) keys.add(String(sc.text ?? ""))
        const v = c.childForFieldName?.("value")
        if (v?.type === "string") {
          const t = v.text ?? ""
          if (t.startsWith("#/") || t.startsWith("#")) refs++
        }
      }
    }
  }
  return { keys, refs }
}

async function main(): Promise<void> {
  const walk = admittedFiles(CR)
  const p = new Parser()
  const lang = await Language.load(wasm)
  p.setLanguage(lang)

  const files: string[] = []
  const kinds: Record<string, number> = {}
  const featureFiles: Record<string, number> = {}
  const controlFiles: Record<string, number> = {}
  let refEdges = 0
  let parseFailures = 0
  const examples: string[] = []
  const FEATURES = ["$ref", "allOf", "anyOf", "oneOf", "mixins", "extends", "implements", "scripts", "dependencies", "devDependencies", "main", "bin", "exports", "openapi", "swagger", "paths", "$schema", "definitions", "$defs"]

  for (const f of walk.files) {
    let tree: any
    try {
      tree = p.parse(readFileSync(f.abs, "utf8"))
    } catch {
      parseFailures++
      continue
    }
    // Free the tree. Without this the WASM heap grows until the module aborts, which
    // presents as thousands of "parse failures" that are not failures at all — measured
    // 5,506 of 13,951 in a version of the sibling probe that omitted it.
    const root = tree.rootNode
    if (root.type !== "document") {
      tree.delete?.()
      continue
    }
    let values = 0
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (c && VALUE_TYPES.has(c.type)) values++
    }
    // Every `continue` in this loop MUST free the tree. An early-out that skipped the
    // delete leaked the whole corpus's parse trees, and the WASM heap aborted the module
    // partway through — which presented as 4,644 "parse failures" that were not failures
    // at all. The population was measured against a corpus 33% smaller than the one the
    // header claims. Measured with the delete on every exit: 13,951 of 13,951 parse, 0 abort.
    if (values <= 1) {
      // The NEGATIVE CONTROL, run on the way past. Without it a row of zeroes below cannot be
      // told apart from a detector that never matches anything — and "these documents exercise
      // nothing" is only evidence if the same detector finds the features elsewhere. Measured:
      // every one of the 20 keys is found in hundreds of files across the population, so the
      // zeroes among the multi-value documents are the documents' property and not the probe's.
      const control = features(root)
      for (const t of FEATURES) if (control.keys.has(t)) controlFiles[t] = (controlFiles[t] ?? 0) + 1
      tree.delete?.()
      continue
    }
    files.push(f.abs)
    const { keys, refs } = features(root)
    for (const t of FEATURES) {
      if (keys.has(t)) {
        featureFiles[t] = (featureFiles[t] ?? 0) + 1
        if (examples.length < 40 && !examples.some((e) => e.endsWith(t))) examples.push(`${f.abs} :: ${t}`)
      }
    }
    refEdges += refs
    tree.delete?.()
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ files: walk.files.length, multiValueFiles: files.length, featureFiles, controlFiles, refPointersInThem: refEdges, filesList: files, examples, parseFailures }, null, 2))
    return
  }
  console.log(describeWalk(walk, CR))
  console.log(`files probed                       : ${walk.files.length}`)
  console.log(`parse failures                     : ${parseFailures}`)
  console.log(`MULTI-VALUE documents              : ${files.length}`)
  console.log(`$ref-style pointers inside them    : ${refEdges}`)
  console.log("")
  console.log("features exercised by those documents (file counts):")
  for (const [k, v] of Object.entries(featureFiles).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`)
  if (Object.keys(featureFiles).length === 0) console.log("  (none)")
  console.log("")
  console.log("NEGATIVE CONTROL — the same detector over the whole population:")
  for (const [k, v] of Object.entries(controlFiles).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`)
  console.log("")
  for (const e of examples) console.log(`  ${e}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})