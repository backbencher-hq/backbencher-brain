/**
 * THE `extends` PROBE MUST TERMINATE — the guard for the infinite loop fixed in `script/m14/graphql-ruled.ts`.
 *
 * WHY IT EXISTS. The arbiter's instrument B calls `countOnTree` for every RULED type over the whole
 * admitted population, synchronously, in the same process that walks it. This lane's `extends` probe
 * contained `unwrap`, which descended a wrapper chain but re-read the child list from the node it was
 * CALLED with instead of the node it had reached:
 *
 *     let cur = n
 *     for (;;) {
 *       if (!WRAPPERS.has(cur.type)) return cur
 *       const kids = (n.namedChildren ?? []).filter(Boolean)   // <-- `n`, not `cur`
 *       if (kids.length !== 1) return cur
 *       cur = kids[0]
 *     }
 *
 * With `n` a wrapper holding exactly one named child that is ALSO a wrapper — which is what a
 * `Definition` is in this grammar — `kids` was recomputed from the same `n` on every pass and `cur`
 * never advanced. It does not throw, so nothing catches it; it does not return, so the gate never
 * prints; and it is pure JS/SYNCHRONOUS WASM, so no 120 s timeout in `engine.ts` can touch it. The
 * measured consequence, on 2026-10-12: the arbiter's walk finished all 1,911 files at 08:13:56
 * (checkpoint written, every file settled) and the process then sat at 98% CPU for **107 minutes**
 * with four lines of output.
 *
 * TWO ARMS, and the first is the one that makes this a guard rather than a comment:
 *
 *   1. FALSIFIER — the OLD shape, bounded by an iteration cap, must EXCEED the cap on a REAL corpus
 *      file. If the old shape returns within the cap on every corpus file, this guard is inert and
 *      says so, because then the loop was not reachable from this corpus and the fix addressed a
 *      hypothetical.
 *   2. THE FIX — the lane's real `countOnTree`, IMPORTED from `script/m14/graphql-ruled.ts` rather
 *      than reimplemented, must run to completion over the whole population and report the count the
 *      ruling publishes (`publishedCount`, 0 hits) — a fix that terminates but changes the number is
 *      a different defect wearing a green tick.
 *
 * CLI: npx tsx validation/m14/fixtures/graphql/extends-probe-terminates.mts
 * Read-only.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = process.env.BB_REPO ?? path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const { detectLanguageFromPath } = await import(`${REPO_ROOT}/src/ast/language-detection.ts`)
const { GRAPHQL_RULED } = await import(`${REPO_ROOT}/script/m14/graphql-ruled.ts`)

const files: { repo: string; rel: string; text: string }[] = []
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
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      const text = readFileSync(abs, "utf8")
      if (detectLanguageFromPath(abs, text) !== "graphql") continue
      files.push({ repo: e, rel, text })
    } catch {
      /* unreadable */
    }
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(REPO_ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-graphql.wasm"))))

const WRAPPERS = new Set(["Document", "Definition", "ExecutableDefinition", "TypeSystemDefinition", "TypeSystemExtension", "TypeDefinition", "TypeExtension"])

/** ARM 1 — the OLD shape, verbatim in its defect, with an iteration cap standing in for "forever". */
function oldUnwrap(n: any, cap: number): { steps: number; returned: boolean } {
  let cur = n
  for (let steps = 1; steps <= cap; steps++) {
    if (!WRAPPERS.has(cur.type)) return { steps, returned: true }
    const kids = (n.namedChildren ?? []).filter(Boolean)
    if (kids.length !== 1) return { steps, returned: true }
    cur = kids[0]
  }
  return { steps: cap, returned: false }
}

const failure: string[] = []
let wrapperSixtyWrappers = 0 // wrappers with exactly one named child that is also a wrapper: the trigger
for (const f of files) {
  const root = parser.parse(f.text)?.rootNode
  if (!root) continue
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (WRAPPERS.has(n.type)) {
      const kids = (n.namedChildren ?? []).filter(Boolean)
      if (kids.length === 1 && WRAPPERS.has(kids[0].type)) {
        wrapperSixtyWrappers++
        const r = oldUnwrap(n, 5_000)
        if (r.returned) failure.push(`the OLD shape terminated on a real corpus file (${f.repo}/${f.rel}) — the loop was NOT reachable, so this guard is inert`)
      }
    }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
}

const extendsRule: any = GRAPHQL_RULED.find((r: any) => r.type === "extends")
if (!extendsRule?.countOnTree) throw new Error("the lane's `extends` ruling is missing its countOnTree probe")

const hits: string[] = []
const t0 = Date.now()
for (const f of files) {
  const root = parser.parse(f.text)?.rootNode
  if (root) extendsRule.countOnTree(root, `${f.repo}/${f.rel}`, hits)
}
const ms = Date.now() - t0

console.log(`graphql extends-probe guard — ${files.length} admitted files`)
console.log(`  trigger population : ${wrapperSixtyWrappers.toLocaleString()} wrapper node(s) with exactly one wrapper child (the shape that hung the old loop)`)
console.log(`  the fixed probe    : completed over every file in ${ms.toLocaleString()} ms, ${hits.length} hit(s)`)
console.log(`  published count    : ${extendsRule.publishedCount}`)
if (hits.length !== (extendsRule.publishedCount ?? 0)) failure.push(`the fixed probe reports ${hits.length} hit(s), the ruling publishes ${extendsRule.publishedCount}`)
if (wrapperSixtyWrappers === 0) failure.push("NO trigger shape exists in this corpus, so arm 1 proves nothing on it")

console.log(`\nGUARD ${failure.length === 0 ? "PASS" : "FAIL"} — ${failure.length} failure(s)`)
for (const f of failure) console.log(`  ${f}`)
process.exit(failure.length === 0 ? 0 : 3)
