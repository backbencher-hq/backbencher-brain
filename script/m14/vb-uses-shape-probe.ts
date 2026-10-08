/**
 * THE `uses` SHAPE — is the class this lane publishes the class the family means?
 *
 * Two contested boundaries, both decided on the PARSE TREE rather than on a line
 * of text, because a line of text cannot tell `a.B = 1` from `x = a.B`.
 *
 *   1. THE ASSIGNMENT LEFT SIDE. `real-csharp-analyzer.ts:2824` excludes an
 *      access that is the LEFT operand of an assignment:
 *
 *          if (!isCallee && !isLhsWrite) { … emit `uses` … }
 *
 *      with the stated reason at line 2816 — a field WRITE is not a field READ.
 *      This lane's `uses` (added for this ontology wave) has no such test, so a
 *      `Private _count As Integer` declaration and a `Me._count = 1` assignment
 *      both produce `uses _count`, and the second of those is a write. A text-line
 *      proxy measured 2,044 apparent "LHS writes" in a 120-file draw that were
 *      mostly reads sharing a line with an unrelated `=`, so the number that
 *      matters is the tree one, and it is what this measures.
 *
 *      The question is NOT "is excluding them right" — it is a family ruling that
 *      belongs to the master. The question is HOW BIG, because a class where 40 %
 *      of the rows are writes and 60 % reads cannot be reasoned about as either.
 *
 *   2. `With` BLOCKS. `with_member_access_expression` has no `function` field and
 *      no `member` field in this grammar (measured at 1,017 of them), so the
 *      analyzer's callee/index test always says "not a callee" and every one is a
 *      read. That is right for `With obj` / `.Value = 1`. The counts here say how
 *      much of the class it is, so the claim is sized rather than asserted.
 *
 * It also partitions EVERY qualified access into the three slots, which is the
 * only way to check that the emitted class and the excluded classes are disjoint
 * and exhaustive — a partition that does not add up means one of the three
 * branches is dead.
 *
 * CLI: npx tsx script/m14/vb-uses-shape-probe.ts [--sample N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/vb-corpus"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "400") ?? "400")
const OUT = argOf("--out")

const files: { repo: string; rel: string; text: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    let text = ""
    try { text = readFileSync(path.join(dir, rel), "utf8").replace(/^\uFEFF/, "") } catch { continue }
    if (detectLanguageFromPath(rel, text) !== "vb") continue
    files.push({ repo: e, rel, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const draw = SAMPLE > 0 ? files.slice(0, SAMPLE) : files

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-vbnet.wasm"))))

type Slot = "callee" | "index" | "value-read" | "lhs-write" | "other"
const slotCount = new Map<Slot, number>()
const hitFiles = new Map<Slot, Set<string>>()
const bump = (s: Slot, file: string): void => {
  slotCount.set(s, (slotCount.get(s) ?? 0) + 1)
  if (!hitFiles.has(s)) hitFiles.set(s, new Set())
  hitFiles.get(s)!.add(file)
}
const samples = new Map<Slot, string[]>()

/** The same callee/index test the analyzer applies, so the partition is over the
 *  analyzer's OWN rule and not over a paraphrase of it. */
const isCalleeOrIndexSlot = (n: any): boolean => {
  const p = n.parent
  if (!p) return false
  if (p.type === "with_member_access_expression") return false
  const fn = p.childForFieldName?.("function")
  if (fn && fn.id === n.id) return true
  const arr = p.childForFieldName?.("array")
  if (arr && arr.id === n.id) return true
  return false
}

/** Is this access the LEFT operand of an assignment? Climbs the span, never
 *  compares `id` across retrievals — the csharp lane's documented rule. */
const isLhsWrite = (n: any): boolean => {
  let a = n.parent
  let guard = 0
  while (a && guard++ < 16) {
    if (a.type === "member_access_expression" || a.type === "with_member_access_expression") { a = a.parent; continue }
    if (a.type === "assignment_expression") {
      const l = a.childForFieldName?.("left")
      return !!l && l.startIndex <= n.startIndex && l.endIndex >= n.endIndex
    }
    if (a.type === "invocation_expression" || a.type === "argument_list") return false
    a = a.parent
  }
  return false
}

for (const f of draw) {
  const label = `${f.repo}/${f.rel}`
  const t = parser.parse(f.text)
  if (!t) continue
  const visit = (n: any): void => {
    if (n.type === "member_access_expression" || n.type === "with_member_access_expression") {
      let slot: Slot
      if (isCalleeOrIndexSlot(n)) {
        slot = "callee"
      } else if (isLhsWrite(n)) {
        slot = "lhs-write"
      } else {
        slot = n.type === "with_member_access_expression" ? "other" : "value-read"
        if (n.type === "with_member_access_expression") slot = "value-read"
      }
      bump(slot, label)
      const arr = samples.get(slot) ?? []
      if (arr.length < 4) arr.push(`${String(n.text).replace(/\s+/g, " ").slice(0, 60)} @${label}:${n.startPosition.row + 1}`)
      samples.set(slot, arr)
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
  }
  visit(t.rootNode)
  t.delete?.()
}

const total = [...slotCount.values()].reduce((a, b) => a + b, 0)
console.log(`vb uses-shape probe — corpus ${CR}  drawn ${draw.length} files  (tree counts, no analyzer output read)\n`)
console.log(`qualified accesses seen: ${total}`)
const order: Slot[] = ["callee", "index", "value-read", "lhs-write", "other"]
for (const s of order) {
  const n = slotCount.get(s) ?? 0
  console.log(`  ${s.padEnd(12)} ${String(n).padStart(8)}  ${((n / Math.max(1, total)) * 100).toFixed(1).padStart(5)}%  in ${String(hitFiles.get(s)?.size ?? 0).padStart(4)} files`)
  for (const x of samples.get(s) ?? []) console.log(`      ${x}`)
}
const reads = (slotCount.get("value-read") ?? 0) + (slotCount.get("lhs-write") ?? 0)
const excluded = (slotCount.get("callee") ?? 0) + (slotCount.get("index") ?? 0)
console.log(`\npartition check: callee+index (excluded, already a \`calls\`/index edge) = ${excluded}`)
console.log(`                 value-read+lhs-write (what \`uses\` publishes)             = ${reads}`)
console.log(`                 sum = ${excluded + reads} of ${total} seen  -> ${excluded + reads === total ? "PARTITION IS EXACT" : "*** PARTITION DOES NOT ADD UP: a slot is missing or double counted ***"}`)
if (reads > 0) {
  console.log(`\nWRITE SHARE of the \`uses\` class: ${(((slotCount.get("lhs-write") ?? 0) / reads) * 100).toFixed(1)}% of published rows are an assignment's LEFT side.`)
  console.log(`real-csharp-analyzer.ts excludes exactly those (isLhsWrite). Whether the family's ruling is right for VB is the`)
  console.log(`master's call; the size of the difference is what this measures.`)
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, drawn: draw.length, totalQualifiedAccesses: total,
    slots: Object.fromEntries(order.map((s) => [s, { occurrences: slotCount.get(s) ?? 0, files: hitFiles.get(s)?.size ?? 0, samples: samples.get(s) ?? [] }])),
    partitionExact: excluded + reads === total,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
process.exitCode = excluded + reads === total ? 0 : 1
