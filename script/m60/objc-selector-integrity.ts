// script/m60/objc-selector-integrity.ts — is the published Objective-C selector the selector?
//
// THE DEFECT THIS MEASURES. `fullMethodSelector` (src/ast/real-objective-c-analyzer.ts)
// concatenates EVERY top-level `identifier` child of a `method_declaration` /
// `method_definition`, appending ':' when the next named sibling is a
// `method_parameter`. The grammar also puts a method's TRAILING MACROS at the
// method node's top level, as bare identifiers with no `method_parameter`
// after them:
//
//   method_declaration "- (instancetype)initWithBaseURL:(nullable NSURL *)url
//                           sessionConfiguration:(nullable NSURLSessionConfiguration *)configuration
//                           NS_DESIGNATED_INITIALIZER;"
//     -                        "-"
//     method_type              "(instancetype)"
//     identifier               "initWithBaseURL"
//     method_parameter         ":(nullable NSURL *)url"
//     identifier               "sessionConfiguration"
//     method_parameter         ":(nullable NSURLSessionConfiguration *)configuration"
//     identifier               "NS_DESIGNATED_INITIALIZER"   <- an annotation, not a keyword
//     ;                        ";"
//
// `NS_DESIGNATED_INITIALIZER` declares nothing about the selector; the selector
// is `initWithBaseURL:sessionConfiguration:`. Concatenating it publishes a
// SYMBOL whose name exists in no class in the world, and an `overrides` edge
// whose TARGET resolves to nothing.
//
// The structural rule the grammar supports, and the one this probe measures
// against: a selector is the chain of keywords, each an `identifier`
// immediately followed by a `method_parameter`. A zero-argument selector has
// exactly one `identifier` and no `method_parameter` after it. Anything else at
// the method node's top level is an annotation.
//
// NO REGEXP (lane rule 1). Tree walk only.
//
// Usage: bun script/m60/objc-selector-integrity.ts
// Writes: validation/m60/results/objc-selector-integrity.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories/objc"
const OUT = path.join(ROOT, "validation/m60/results/objc-selector-integrity.json")

/** The analyzer's rule, restated so the probe measures the SOURCE and not the output. */
function publishedSelector(node: any): string {
  let sel = ""
  const count = node.namedChildCount
  for (let i = 0; i < count; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "identifier") continue
    sel += c.text
    const next = i + 1 < count ? node.namedChild(i + 1) : null
    if (next && next.type === "method_parameter") sel += ":"
  }
  return sel
}

/** The grammar's own shape: a keyword chain, or one bare identifier. */
function structuralSelector(node: any): string {
  const keywords: string[] = []
  const bare: string[] = []
  const count = node.namedChildCount
  for (let i = 0; i < count; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "identifier") continue
    const next = i + 1 < count ? node.namedChild(i + 1) : null
    if (next && next.type === "method_parameter") keywords.push(c.text + ":")
    else bare.push(c.text)
  }
  if (keywords.length > 0) return keywords.join("")
  return bare.length > 0 ? bare[0] : ""
}

/**
 * The SHAPE of a method node's top-level identifier chain, counted over every
 * method node in the corpus.
 *
 * WHY THE SHAPES ARE COUNTED. The fix replaces "concatenate every identifier"
 * with "take the keyword chain, else the first bare identifier". That rule is
 * only safe if no real selector has the shape "bare identifier followed by
 * keywords" — a method would then lose its selector to an annotation that
 * precedes it. Nothing in the grammar forbids it, so it is measured rather than
 * assumed: `bareThenKeyword` is the count that would refute the rule.
 */
type MethodShape =
  | "keywordChain"      // >=1 keyword, no bare identifier — the common multi-part selector
  | "singleBare"        // exactly one bare identifier, no keyword — the zero-argument selector
  | "bareThenKeyword"   // a bare identifier BEFORE keywords — would refute the fix
  | "bareAfterKeyword"  // >=1 keyword then a bare identifier — the annotation case
  | "bareOnlyMulti"     // >=2 bare identifiers, no keyword — one selector plus annotations
  | "noIdentifier"      // no top-level identifier at all — nothing can be named

/** Classify a method node's top-level identifier chain. Structural, no text tests. */
function methodShape(node: any): MethodShape {
  let keywords = 0
  let bare = 0
  let bareBeforeKeyword = false
  let sawKeyword = false
  const count = node.namedChildCount
  for (let i = 0; i < count; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "identifier") continue
    const next = i + 1 < count ? node.namedChild(i + 1) : null
    if (next && next.type === "method_parameter") { keywords++; sawKeyword = true }
    else { bare++; if (!sawKeyword) bareBeforeKeyword = true }
  }
  if (keywords === 0 && bare === 0) return "noIdentifier"
  if (keywords === 0) return bare === 1 ? "singleBare" : "bareOnlyMulti"
  if (bareBeforeKeyword) return "bareThenKeyword"
  return bare === 0 ? "keywordChain" : "bareAfterKeyword"
}

/** Identifiers at the method's top level that are neither a keyword nor the selector. */
function annotationIdentifiers(node: any): string[] {
  const ids: Array<{ text: string; isKeyword: boolean }> = []
  const count = node.namedChildCount
  for (let i = 0; i < count; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "identifier") continue
    const next = i + 1 < count ? node.namedChild(i + 1) : null
    ids.push({ text: c.text, isKeyword: !!(next && next.type === "method_parameter") })
  }
  const hasKeyword = ids.some((x) => x.isKeyword)
  const out: string[] = []
  for (let i = 0; i < ids.length; i++) {
    if (ids[i].isKeyword) continue
    // With a keyword chain present, every non-keyword identifier is an
    // annotation. With no keyword chain, the FIRST bare identifier IS the
    // zero-argument selector and the rest are annotations.
    if (!hasKeyword && i === 0) continue
    out.push(ids[i].text)
  }
  return out
}

async function main(): Promise<void> {
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (ext !== ".m" && ext !== ".mm" && ext !== ".h") continue
      if (statSync(p).size > 1024 * 1024) continue
      let src = ""
      try { src = readFileSync(p, "utf8") } catch { continue }
      if (detectLanguageFromPath(p, src) === "objective-c") files.push(p)
    }
  }
  walk(CORPUS_ROOT)
  files.sort()

  const parser = await getParser("objective-c")
  let methodNodes = 0, differ = 0, affectedFiles = 0
  const annotationCounts = new Map<string, number>()
  const shapeCounts = new Map<string, number>()
  const examples: Array<Record<string, unknown>> = []
  const perFile: Array<Record<string, unknown>> = []

  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const tree: any = (parser as any).parse(src, f)
    let fileDiffer = 0, fileNodes = 0
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      if (n.type === "method_declaration" || n.type === "method_definition") {
        methodNodes++
        fileNodes++
        const shape = methodShape(n)
        shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1)
        const pub = publishedSelector(n)
        const str = structuralSelector(n)
        const ann = annotationIdentifiers(n)
        if (pub !== str) {
          differ++
          fileDiffer++
          for (const a of ann) annotationCounts.set(a, (annotationCounts.get(a) ?? 0) + 1)
          if (examples.length < 40) {
            examples.push({
              file: f.slice(CORPUS_ROOT.length + 1),
              line: n.startPosition.row + 1,
              nodeType: n.type,
              published: pub,
              structural: str,
              annotations: ann,
            })
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (fileDiffer > 0) { affectedFiles++; perFile.push({ file: f.slice(CORPUS_ROOT.length + 1), methods: fileNodes, differing: fileDiffer }) }
  }

  const report = {
    instrument: "script/m60/objc-selector-integrity.ts",
    corpus: CORPUS_ROOT,
    admission: "detectLanguageFromPath(filePath, content) === objective-c",
    files: files.length,
    methodNodes,
    differing: differ,
    affectedFiles,
    annotationCounts: Object.fromEntries([...annotationCounts.entries()].sort((a, b) => b[1] - a[1])),
    shapeCounts: Object.fromEntries([...shapeCounts.entries()].sort((a, b) => b[1] - a[1])),
    examples,
    perFile,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`objc selector integrity  files ${files.length}  method nodes ${methodNodes}`)
  console.log(`  published selector != grammar's structural selector: ${differ} in ${affectedFiles} files`)
  console.log(`  annotations absorbed into a selector: ${JSON.stringify(report.annotationCounts)}`)
  console.log(`  method-node identifier-chain shapes: ${JSON.stringify(report.shapeCounts)}`)
  for (const e of examples.slice(0, 12)) console.log(`   ${e.file}:${e.line}  published "${e.published}"  should be "${e.structural}"`)
  console.log(`wrote ${OUT}`)
}

await main()