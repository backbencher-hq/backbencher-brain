/**
 * script/m60/objc-method-attribute-probe.ts — TRAILING METHOD ATTRIBUTES IN THE SELECTOR.
 *
 * WHY THIS FILE EXISTS. `script/m60/objc-construct-site-probe.ts` compares grammar sites
 * against emitted edges per relationship type, and the `contains` bucket came back with
 * 726 unmatched sites. Reading them rather than assuming deduplication found this:
 *
 *     afnetworking/AFNetworking/AFHTTPSessionManager.h  - (instancetype)initWithBaseURL:(NSURL *)url
 *                                        sessionConfiguration:(NSURLSessionConfiguration *)configuration
 *                                        NS_DESIGNATED_INITIALIZER;
 *
 * publishes a `method` symbol named
 *
 *     initWithBaseURL:sessionConfiguration:NS_DESIGNATED_INITIALIZER
 *
 * `NS_DESIGNATED_INITIALIZER` is a MACRO — Apple's spelling of
 * `__attribute__((objc_designated_initializer))` — and is not part of the selector. The
 * real selector is `initWithBaseURL:sessionConfiguration:`, so three things break at once:
 * the symbol is published under a name no runtime method has, every message send to the
 * real selector stops resolving to it, and `overrides`' first-parent branch compares the
 * polluted name against the superclass's clean one and can never match.
 *
 * The lane already handles the OTHER spelling of this class of defect — an
 * `availability_attribute` node — and there is a mutant for it
 * (`objc/availability-annotation-into-selector`). This macro attribute arrives as a bare
 * `identifier` at the TOP LEVEL of the method node, so it is indistinguishable from a
 * selector keyword by node type, and only its POSITION separates it.
 *
 * So the file does two things: it dumps the exact tree shapes from the pinned wasm (so a
 * rule can be written against structure), and it counts every affected declaration on the
 * corpus (so the size of the defect is a number and not an anecdote).
 *
 * INSTRUMENT. Parse-tree counts and shape dumps. No text regex: the corpus is full of
 * attribute names inside NSString literals in test helpers.
 *
 * READ-ONLY. Writes nothing.
 *
 * Usage: bun run script/m60/objc-method-attribute-probe.ts [--shapes]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

// ---------------------------------------------------------------- 1 the shapes
if (process.argv.includes("--shapes")) {
  const SRC = [
    "@interface A : NSObject",
    "- (instancetype)initWithA:(NSInteger)a b:(NSInteger)b NS_DESIGNATED_INITIALIZER;",
    "- (void)flush NS_UNAVAILABLE;",
    "- (instancetype)init;",
    "- (void)noAttributes;",
    "- (instancetype)initWithC:(NSInteger)c __attribute__((deprecated));",
    "- (void)withAvailability API_AVAILABLE(ios(9.0));",
    "- (void)colonlessKeyword;",
    "- (void)zeroArgWithDesignatedInitializer NS_DESIGNATED_INITIALIZER;",
    "- (void)zeroArgWithUnderscoreAttr NS_RETURNS_INNER_POINTER;",
    "- (void)kwThenMacroKw:(NSInteger)x NS_DESIGNATED_INITIALIZER API_AVAILABLE(ios(9.0));",
    "@end",
    "",
  ].join("\n")
  const t = parser.parse(SRC)!
  const sexp = (n: any, d = 0): string => {
    const pad = "  ".repeat(d)
    if (!n.isNamed) return `${pad}"${n.type}"`
    let s = `${pad}(${n.type}\n`
    for (let i = 0; i < n.childCount; i++) s += sexp(n.child(i), d + 1) + "\n"
    return s + pad + ")"
  }
  console.log(SRC)
  console.log(sexp(t.rootNode))
  t.delete?.()
  process.exit(0)
}

// ---------------------------------------------------------------- 2 the census
const files: { label: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "ls-files", "-z"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "objective-c") continue
    files.push({ label: `${e}/${rel}`, abs, text })
  }
}

/** The analyzer's own selector rule, re-derived: a keyword identifier is one whose NEXT
 *  named sibling is a `method_parameter` (a parameter's local name lives inside it).
 *  Returned alongside the trailing identifiers the rule would wrongly keep, so the two
 *  can be compared instead of argued about. */
const split = (m: any): { selector: string; trailing: string[] } => {
  const kids: any[] = []
  for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) kids.push(c) }
  const params = kids.filter((c) => c.type === "method_parameter").length
  const keywords: string[] = []
  const rest: string[] = []
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]
    if (c.type !== "identifier") continue
    const next = kids[i + 1]
    if (next && next.type === "method_parameter") keywords.push(c.text)
    else rest.push(c.text)
  }
  // A keyword ALWAYS owns the method_parameter that follows it (the parameter's local name
  // lives inside that node), so `keywords.length === params` always. Therefore:
  //   params > 0  -> every leftover identifier is trailing ATTRIBUTE text
  //   params = 0  -> the first leftover is the zero-argument SELECTOR and the rest are
  //                  attributes
  // Both halves are positional; no attribute name is hardcoded, so a new macro cannot leak
  // and a selector that happens to be spelled like a macro cannot be dropped.
  const selector = params > 0 ? keywords.map((k) => k + ":").join("") : (rest[0] ?? "")
  const trailing = params > 0 ? rest : rest.slice(1)
  return { selector, trailing }
}

type Bucket = { n: number; files: Set<string>; samples: string[]; selectors: Set<string> }
const affected: Bucket = { n: 0, files: new Set<string>(), samples: [], selectors: new Set<string>() }
const byAttribute = new Map<string, number>()
let methods = 0
let idx = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const t = parser.parse(f.text)
    if (!t) continue
    const v = (n: any): void => {
      if (n.type === "method_declaration" || n.type === "method_definition") {
        methods++
        const { selector, trailing } = split(n)
        if (trailing.length > 0) {
          affected.n++
          affected.files.add(f.label)
          affected.selectors.add(`${selector}${trailing.length ? `:${trailing.join(":")}` : ""}`)
          if (affected.samples.length < 20) affected.samples.push(`${f.label}:${n.startPosition.row + 1}  selector="${selector}"  trailing=[${trailing.join(", ")}]`)
          for (const tname of trailing) byAttribute.set(tname, (byAttribute.get(tname) ?? 0) + 1)
        }
      }
      for (let k = 0; k < n.childCount; k++) { const c = n.child(k); if (c) v(c) }
    }
    v(t.rootNode)
    t.delete?.()
  }
}))

console.log(`OBJECTIVE_C trailing-method-attribute probe`)
console.log(`  corpus ${CR}: ${files.length} admitted files`)
console.log(`  method_declaration / method_definition nodes: ${methods}`)
console.log(`  nodes carrying an identifier the selector rule cannot use as a keyword: ${affected.n} in ${affected.files.size} files`)
console.log(`  distinct polluted selectors: ${affected.selectors.size}`)
console.log(`\n  trailing identifier frequencies:`)
for (const [k, v] of [...byAttribute].sort((a, b) => b[1] - a[1])) console.log(`     ${k}=${v}`)
console.log(`\n  samples:`)
for (const s of affected.samples) console.log(`     ${s}`)