/**
 * M60 — yaml `exports` probe. The question the census cannot answer by itself: which
 * YAML construct PUBLISHES a name outward, and how often does it occur?
 *
 * Two candidate readings were measured and one was discarded:
 *
 *   1. `on.workflow_call.outputs.<name>` — a reusable workflow's published outputs.
 *      MEASURED 0 occurrences in 16371 files (see yaml-ontology-probe.ts, which
 *      reports every `exports:*` probe it fired and this one is absent from).
 *      GitHub's own docs write `outputs` under `workflow_call`, but no repo in the
 *      corpus uses it, so an `exports` edge resting on it would be correct and dead.
 *
 *   2. `components.schemas.<Name>` / `definitions.<Name>` in a document that declares
 *      `openapi:` or `swagger:`. A component is defined ONCE in the publishing file
 *      and referenced from other files by `$ref: '#/components/schemas/<Name>'`. That
 *      is what `exports` means in every other lane: a name this unit makes reachable
 *      to its consumers. This probe counts both sides — the publication and the
 *      reference that consumes it — because a publication with no consumer is a
 *      declaration, and a consumer with no publication is a dangling ref, and only
 *      counting one side would report half the fact.
 *
 * The probe is role-scoped: the container must be reached through a top-level
 * `openapi`/`swagger` declaration, so a `components:` or `definitions:` key inside an
 * unrelated document is not counted.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "../../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

// Cheap substring prefilter, so a full-corpus answer does not need 16k parses.
const CANDIDATE = /(^|\n)\s*(openapi|swagger)\s*:/m

const files: { label: string; text: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 2048 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "yaml") continue
    if (!CANDIDATE.test(text)) continue
    files.push({ label: `${e}/${rel}`, text })
  }
}
console.log(`[exports-probe] corpus: ${files.length} yaml files declaring openapi:/swagger:`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-yaml.wasm"))))

const PAIR_TYPES = new Set(["block_mapping_pair", "flow_pair"])
const KEY_TOKENS = new Set(["string_scalar", "plain_scalar", "single_quote_scalar", "double_quote_scalar"])
function unquote(t: string): string {
  const s = t.trim()
  return s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) ? s.slice(1, -1) : s
}
function keyTextOf(pair: any): string | null {
  const k = pair.childForFieldName?.("key")
  if (!k) return null
  if (KEY_TOKENS.has(k.type)) return unquote(k.text)
  for (let i = 0; i < k.namedChildCount; i++) {
    const c = k.namedChild(i)
    if (c && KEY_TOKENS.has(c.type)) return unquote(c.text)
  }
  return null
}
function keyChain(node: any): string[] {
  const parts: string[] = []
  let cur: any = node
  while (cur) {
    if (PAIR_TYPES.has(cur.type)) {
      const k = keyTextOf(cur)
      if (k !== null) parts.unshift(k)
    }
    cur = cur.parent
  }
  return parts
}

interface Bucket { n: number; files: Set<string>; ex: string[] }
const buckets = new Map<string, Bucket>()
const hit = (k: string, file: string, ex: string): void => {
  let b = buckets.get(k)
  if (!b) { b = { n: 0, files: new Set(), ex: [] }; buckets.set(k, b) }
  b.n++
  b.files.add(file)
  if (b.ex.length < 3) b.ex.push(ex)
}

/** Publication containers, and which sub-container holds the named definitions. */
const PUBLISH = new Map<string, string[]>([
  ["components", ["schemas", "responses", "parameters", "examples", "requestBodies", "headers", "securitySchemes", "links", "callbacks"]],
  ["definitions", []],
  ["$defs", []],
])

let topLevelOpenapi = 0
for (const f of files) {
  const tree = parser.parse(f.text)
  if (!tree) continue
  const root = tree.rootNode
  const stack = [root]
  let declares = false
  while (stack.length > 0) {
    const n = stack.pop()!
    if (PAIR_TYPES.has(n.type)) {
      const chain = keyChain(n)
      const key = keyTextOf(n)
      // The role gate: `openapi:`/`swagger:` at the document's top level.
      if (chain.length === 1 && (key === "openapi" || key === "swagger")) declares = true
      // A named definition inside a publication container.
      if (declares && chain.length >= 2) {
        const container = chain[chain.length - 2]!
        const parent = chain[chain.length - 3]
        const sub = chain[chain.length - 1]!
        if (parent !== undefined && PUBLISH.get(parent)?.includes(container)) {
          hit(`exports:${parent}.${container}.<name>`, f.label, `${chain.join(".")}`)
        } else if (PUBLISH.has(container) && (PUBLISH.get(container)!.length === 0)) {
          hit(`exports:${container}.<name>`, f.label, `${chain.join(".")}`)
        }
      }
    }
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  if (declares) topLevelOpenapi++
  // The consumer side: a `$ref` naming a path under a publication container.
  const refs = f.text.match(/#\/components\/(schemas|responses|parameters|examples|requestBodies|headers)\/[A-Za-z0-9_.\-]+/g) ?? []
  for (const r of refs) hit(`ref-consumes:${r.split("/")[2]}`, f.label, r)
  tree.delete?.()
}

console.log(`\nfiles whose TOP LEVEL declares openapi:/swagger: ${topLevelOpenapi} of ${files.length}`)
console.log(`\nB: PUBLICATION and CONSUMPTION counts`)
for (const [k, b] of [...buckets.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`   ${k.padEnd(30)} ${String(b.n).padStart(7)} in ${String(b.files.size).padStart(5)} files`)
  for (const ex of b.ex.slice(0, 2)) console.log(`        e.g. ${ex}`)
}
if (buckets.size === 0) console.log("   (no publication or consumption found)")