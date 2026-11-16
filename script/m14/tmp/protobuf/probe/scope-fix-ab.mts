/**
 * A/B THE `extend` SCOPE FIX, ANALYZER AGAINST ANALYZER.
 *
 * Reads the analyzer directly on every corpus file — twice, once per arm — so
 * nothing here depends on `parseFile`, whose wasm faults lose a file's whole
 * parse on a fraction of corpus-scale runs (measured 9 of 19 rounds; see
 * `lost-parse-locality.mts`). A diff taken through `parseFile` would attribute
 * that loss to whichever arm happened to hit it.
 *
 * The two arms are HEAD's `real-protobuf-analyzer.ts` and the working tree's,
 * imported side by side. Every `uses` edge is keyed on
 * `file \t source \t occurrence-index-within-source`, because an rpc emits TWO
 * `uses` edges under one source id (request and response) and a key without the
 * occurrence index collides on all 1,552 of them.
 *
 * Prints every edge whose TARGET moved, in both directions, so a gain cannot
 * hide a loss. A fix that moves N edges in and M edges out is a net M-N at best
 * and a regression at worst; the counts here are the only thing that says which.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/scope-fix-ab.mts
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { RealProtobufAnalyzer as After } from "../../../../../src/ast/real-protobuf-analyzer"

/**
 * The BEFORE arm is the analyzer as it stood immediately before the nested-`extend`
 * scope fix, pinned to the commit that fix landed in (`dd6b42bc6`, "fix(m60): protobuf
 * resolved a nested `extend`'s type against the type it extends").
 *
 * It used to be a file a human had to remember to create, and the cost of forgetting
 * was an opaque `ERR_MODULE_NOT_FOUND` naming a module that appears in no source file —
 * which is what pass 9 hit on a clean checkout. So the probe now materialises it from
 * git itself and the import is deferred until it exists. A static import cannot do this:
 * it is resolved before any statement in this file runs.
 */
const BEFORE_ARM_COMMIT = "dd6b42bc6^"
const BEFORE_ARM_PATH = path.join(process.cwd(), "src", "ast", "_ab-before-protobuf-analyzer.ts")

function materialiseBeforeArm(): string {
  if (existsSync(BEFORE_ARM_PATH)) return "already present"
  let blob: string
  try {
    blob = execFileSync("git", ["show", `${BEFORE_ARM_COMMIT}:src/ast/real-protobuf-analyzer.ts`], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    })
  } catch (e) {
    throw new Error(
      `cannot materialise the BEFORE arm: git show ${BEFORE_ARM_COMMIT}:src/ast/real-protobuf-analyzer.ts failed.\n` +
        `This probe compares the analyzer against its own pre-fix blob, so it needs that\n` +
        `commit in this clone. It is ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  writeFileSync(BEFORE_ARM_PATH, blob)
  return `written from ${BEFORE_ARM_COMMIT}`
}

const beforeArmState = materialiseBeforeArm()
const { RealProtobufAnalyzer: Before } = await import("../../../../../src/ast/_ab-before-protobuf-analyzer")

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"

const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  let ok = false
  try { ok = statSync(dir).isDirectory() } catch { continue }
  if (!ok) continue
  const walk = (d: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs); continue }
      if (k.endsWith(".proto")) files.push(abs)
    }
  }
  walk(dir)
}

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))

const before = new Before()
const after = new After()

/** file -> Map<"src#n", target> for every `uses` edge. */
function edgesOf(analyzer: Before | After, abs: string): Map<string, string> {
  const content = readFileSync(abs, "utf8")
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const r: any = analyzer.analyze(parser.parse(content).rootNode, content, abs)
  const out = new Map<string, string>()
  const seen = new Map<string, number>()
  for (const e of (r.relationships ?? []) as any[]) {
    if (String(e.type) !== "uses") continue
    const src = String(e.source)
    const n = seen.get(src) ?? 0
    seen.set(src, n + 1)
    out.set(`${src}#${n}`, String(e.target))
  }
  return out
}

let beforeCount = 0
let afterCount = 0
const gained: string[] = []
const lost: string[] = []
for (const abs of files) {
  const rel = path.relative(CR, abs)
  const b = edgesOf(before, abs)
  const a = edgesOf(after, abs)
  beforeCount += b.size
  afterCount += a.size
  for (const [k, t] of b) {
    const now = a.get(k)
    if (now === undefined) { lost.push(`${rel}\t${k}\t${t}\t<edge removed>`); continue }
    if (now !== t) gained.push(`${rel}\t${k}\t${t}\t${now}`)
  }
  for (const [k, t] of a) if (!b.has(k)) lost.push(`${rel}\t${k}\t<edge added>\t${t}`)
}

console.log(`files            ${files.length}`)
console.log(`before arm       ${BEFORE_ARM_COMMIT} (${beforeArmState})`)
console.log(`uses edges       before ${beforeCount}   after ${afterCount}   delta ${afterCount - beforeCount}`)
console.log(`targets MOVED    ${gained.length}`)
console.log(`edges added/removed ${lost.length}`)
console.log(`\n--- every moved target (before -> after) ---`)
for (const g of gained.sort()) console.log(`  ${g}`)
if (lost.length) {
  console.log(`\n--- every added/removed edge ---`)
  for (const l of lost.sort()) console.log(`  ${l}`)
}
console.log(`\n${lost.length === 0 ? "no edge was added or removed" : `${lost.length} edge(s) added or removed`}`)
