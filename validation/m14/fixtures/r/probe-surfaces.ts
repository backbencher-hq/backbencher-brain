/**
 * R LANE — INSTRUMENT B: parse-tree semantic counts for the candidate surfaces.
 *
 * INSTRUMENT A (grammar inventory) is in census-grammar.ts. This file is
 * INSTRUMENT B, used where the language CAN express the construct and the only
 * way to see it is on the tree: a string literal and a comment cannot fake a
 * node, so a count of nodes is a count of the construct.
 *
 * The candidate surfaces measured here are the ones a `uses` edge could carry in
 * R. Each is counted SEPARATELY and in its callee and non-callee positions, because
 * the callee position is already carried by `calls` (the analyzer emits
 * `obj$method` and `Cls$new` as call targets) and an edge that duplicates a call
 * is a fabricated edge. The count that justifies an implementation is the
 * NON-CALL one.
 *
 *   extract_operator        obj$member , obj@slot          -- member read
 *   namespace_operator      pkg::NAME                      -- qualified name read
 *   subset2 with a string   x[["col"]]                     -- member read by name
 *   subset with a string    x["col"]                       -- the same, but a SUBSET
 *   extract_operator chain  a$b$c                          -- nested receiver
 *
 * USAGE: npx tsx validation/m14/fixtures/r/probe-surfaces.ts [--sample N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const SAMPLE_PER_REPO = Number(argOf("--sample") ?? 250)

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
const repos: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const admitted: typeof files = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
  if (admitted.length === 0) continue
  repos.push(e)
  files.push(...admitted.slice(0, SAMPLE_PER_REPO))
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))

type Counter = { total: number; callee: number; nonCallee: number; files: Set<string>; examples: string[] }
const counters = new Map<string, Counter>()
const bump = (k: string, label: string, inCallee: boolean) => {
  let c = counters.get(k)
  if (!c) { c = { total: 0, callee: 0, nonCallee: 0, files: new Set(), examples: [] }; counters.set(k, c) }
  c.total++
  if (inCallee) c.callee++
  else c.nonCallee++
  c.files.add(label)
  if (c.examples.length < 4) c.examples.push(label)
}

/**
 * Is this node the `function` field of an enclosing `call`?
 *
 * Grammar-field read, so a `pkg::fn` inside an argument list is not mistaken for
 * a callee. The comparison is by node RANGE, not by object identity:
 * web-tree-sitter allocates a FRESH JS wrapper on every `childForFieldName`
 * call, so `parent.childForFieldName("function") === n` is FALSE for the very
 * node it just returned. The first version of this probe compared identities and
 * reported 0 callee-position nodes out of 11,216 -- a number that reads as "R
 * never calls through a namespace" and is a bug in the probe, not a fact about
 * R. `sameNode()`-style range comparison is what the analyzer itself uses.
 */
const sameNode = (a: any, b: any): boolean => !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex
const inCalleePosition = (n: any): boolean => {
  const p = n.parent
  if (!p) return false
  if (p.type === "call") return sameNode(p.childForFieldName("function"), n)
  if (p.type === "extract_operator" || p.type === "namespace_operator") {
    // `pkg::a$b(...)`: the extract node sits inside the namespace wrapper, and it
    // is the WRAPPER that occupies the call's function field.
    const rhs = p.childForFieldName("rhs")
    if (sameNode(rhs, n)) return inCalleePosition(p)
  }
  return false
}

/** The `arguments` field of a subset/subset2 node, or null. */
const subsetIndexArgs = (n: any): any[] => {
  const args = n.childForFieldName("arguments")
  if (!args) return []
  const out: any[] = []
  for (let i = 0; i < args.namedChildCount; i++) {
    const c = args.namedChild(i)
    if (c && c.type === "argument") out.push(c)
  }
  return out
}

const nodeTypeCounts = new Map<string, number>()
let parseFailures = 0
for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = parser.parse(f.text)
  if (!t) { parseFailures++; continue }
  const visit = (n: any) => {
    nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
    if (n.type === "extract_operator") {
      const op = n.childForFieldName("operator")?.text
      const rhs = n.childForFieldName("rhs")
      const lhs = n.childForFieldName("lhs")
      bump("extract_operator", label, inCalleePosition(n))
      if (op === "@") bump("extract_operator.$", label, inCalleePosition(n))
      if (op === "$") bump("extract_operator.dollar", label, inCalleePosition(n))
      // the RECEIVER's own text: a nested member read has a non-identifier lhs
      if (lhs && lhs.type !== "identifier" && lhs.type !== "string") bump("extract_operator.nested_receiver", label, inCalleePosition(n))
      if (rhs && rhs.type !== "identifier" && rhs.type !== "string") bump("extract_operator.computed_rhs", label, inCalleePosition(n))
      if (n.parent && n.parent.type === "binary_operator") bump("extract_operator.assignment_rhs", label, inCalleePosition(n))
    }
    if (n.type === "namespace_operator") {
      const op = n.childForFieldName("operator")?.text
      bump("namespace_operator", label, inCalleePosition(n))
      if (op === ":::") bump("namespace_operator.triple_colon", label, inCalleePosition(n))
      if (op === "::") bump("namespace_operator.double_colon", label, inCalleePosition(n))
    }
    if (n.type === "subset" || n.type === "subset2") {
      const key = n.type === "subset2" ? "subset2.string_index" : "subset.string_index"
      bump(key, label, inCalleePosition(n))
      for (const a of subsetIndexArgs(n)) {
        if (a.childForFieldName("value")?.type === "string") bump(`${key}.literal`, label, inCalleePosition(n))
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)
  t.delete?.()
}

console.log(`INSTRUMENT B — R parse-tree surface counts`)
console.log(`corpus ${CR}; repos ${repos.length}: ${repos.join(", ")}`)
console.log(`files sampled ${files.length}; tree-sitter-r returned no tree for ${parseFailures}`)
console.log(`distinct node types ${nodeTypeCounts.size}`)
console.log("")
const hdr = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(hdr("surface", 40) + hdr("total", 10) + hdr("calleePos", 11) + hdr("nonCallee", 11) + hdr("files", 8) + "examples")
for (const [k, c] of [...counters.entries()].sort((a, b) => b[1].nonCallee - a[1].nonCallee)) {
  console.log(hdr(k, 40) + hdr(String(c.total), 10) + hdr(String(c.callee), 11) + hdr(String(c.nonCallee), 11) + hdr(String(c.files.size), 8) + c.examples.slice(0, 2).join(" | "))
}
console.log("")
console.log("OVERWHOLMING node types (sorted by count):")
console.log([...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "))
