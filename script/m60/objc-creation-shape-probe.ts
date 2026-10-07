/**
 * script/m60/objc-creation-shape-probe.ts — WHICH OBJECT-C CONSTRUCTION SELECTORS EXIST,
 * and which of them does the analyzer read?
 *
 * WHY THIS FILE EXISTS. `script/m60/objc-construct-site-probe.ts` counts grammar sites per
 * relationship type and prints the ones with no emitted edge. Applied to `instantiates`
 * it returned 24 unmatched sites in 322 corpus files, every one of them a construction
 * selector the analyzer's rule does not recognise:
 *
 *     - (AFHTTPSessionManager)copyWithZone: { ... [[[self class] allocWithZone:zone] init] ... }
 *     - (AFSecurityPolicy)copyWithZone:      { ... [[[self class] allocWithZone:zone] init] ... }
 *
 * The analyzer's `instantiates` rule fires on a message send whose FIRST KEYWORD is
 * `alloc` or `new`. `allocWithZone:` is the same NSObject allocator with a zone argument,
 * so the rule's boundary is an omission rather than a judgement — but the receiver here
 * is `[self class]`, a MESSAGE, whose class is decided by the objc runtime and is not the
 * enclosing class in general (a subclass instance may be in play). So "publish the
 * enclosing class" would be a fabrication and "publish nothing" is what the lane does.
 *
 * That is only defensible with a count attached, which is what this file produces:
 * every creation-shaped message send in the corpus, split by receiver shape, so the
 * boundary between "the analyzer should read this" and "the language cannot say" is a
 * measurement instead of an assertion.
 *
 * It also publishes the NEGATIVE side the census does not: `allocWithZone:` and
 * `copyWithZone:` as counts, so a later corpus that starts using them widely is visible.
 *
 * INSTRUMENT. Parse-tree counts only. A text regex would match `new` inside a string
 * literal and `alloc` inside a comment; the ontology gate's header records exactly that
 * class of false positive convicting two correct bash rulings.
 *
 * READ-ONLY. Writes nothing.
 *
 * Usage: bun run script/m60/objc-creation-shape-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"

/** Every NSObject creation/copy spelling a selector can carry. `alloc` and `new` are what
 *  the analyzer reads; the rest are measured here so the set is not asserted. */
const CREATE = ["alloc", "allocWithZone:", "new", "copy", "mutableCopy", "copyWithZone:", "mutableCopyWithZone:"]

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

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

/** The full selector and its FIRST keyword, from the grammar's own flattening: a keyword
 *  is an `identifier` whose next sibling is an anonymous ':'. */
const selOf = (n: any): { full: string; firstKw: string } => {
  const kids: any[] = []
  for (let k = 0; k < n.childCount; k++) kids.push(n.child(k))
  let full = "", firstKw = "", lastId = ""
  for (let k = 0; k < kids.length; k++) {
    const c = kids[k]
    if (!c || !c.isNamed || c.type !== "identifier") continue
    const nx = kids[k + 1]
    if (nx && !nx.isNamed && nx.type === ":") { full += c.text + ":"; if (!firstKw) firstKw = c.text + ":" }
    else lastId = c.text
  }
  return { full: full || lastId, firstKw }
}

const shapes = new Map<string, { n: number; files: Set<string>; sample: string[] }>()
let idx = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const t = parser.parse(f.text)
    if (!t) continue
    const v = (n: any): void => {
      if (n.type === "message_expression") {
        const { full, firstKw } = selOf(n)
        // `alloc`/`new` are ZERO-ARGUMENT selectors: they carry no ':' token, so the
        // keyword loop never sets `firstKw` and the name lands in `lastId`. The first
        // version of this probe compared `CREATE` against `firstKw` alone and therefore
        // counted ZERO alloc/new sites in a corpus that has 508 of them published as
        // `instantiates` — an instrument that reported 0 for the commonest construction
        // in the language. The selector's first component is `firstKw || full`.
        const first = firstKw || full
        if (CREATE.includes(first)) {
          const recv = n.namedChild(0)
          let rshape = recv ? recv.type : "(none)"
          if (recv && (recv.type === "identifier" || recv.type === "type_identifier")) rshape += `:${recv.text}`
          else if (recv && recv.type === "message_expression") rshape += `:[${selOf(recv).full}]`
          const key = `${first.padEnd(20)} recv=${rshape}`
          const r = shapes.get(key) ?? { n: 0, files: new Set<string>(), sample: [] }
          r.n++
          r.files.add(f.label)
          if (r.sample.length < 2) r.sample.push(`${f.label}:${n.startPosition.row + 1} ${n.text.split("\n")[0]!.trim().slice(0, 88)}`)
          shapes.set(key, r)
        }
      }
      for (let k = 0; k < n.childCount; k++) { const c = n.child(k); if (c) v(c) }
    }
    v(t.rootNode)
    t.delete?.()
  }
}))

console.log(`OBJECTIVE_C creation-selector shape probe`)
console.log(`  corpus ${CR}: ${files.length} admitted files\n`)
console.log(`  first keyword / receiver shape                            sites  files   analyzer reads it as`)
console.log("  " + "-".repeat(104))
for (const [k, r] of [...shapes].sort((a, b) => b[1].n - a[1].n)) {
  const kw = k.slice(0, 20).trim()
  const reads = kw === "alloc" || kw === "new" ? "`instantiates` (if the receiver names a class)" : "NOTHING (`calls` only)"
  console.log(`  ${k.padEnd(52)} ${String(r.n).padStart(5)}  ${String(r.files.size).padStart(5)}   ${reads}`)
}
console.log("")
for (const [k, r] of [...shapes].sort((a, b) => b[1].n - a[1].n)) {
  if (k.slice(0, 20).trim() === "alloc" || k.slice(0, 20).trim() === "new") continue
  console.log(`  ${k}`)
  for (const s of r.sample) console.log(`      e.g. ${s}`)
}