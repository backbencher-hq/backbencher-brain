/**
 * M60 ONTOLOGY PROBE — yaml. The two instruments the workstream requires,
 * run over the WHOLE admitted corpus (not a sample), so a ruling is backed by
 * a count over every yaml file in the box.
 *
 *   A: GRAMMAR INVENTORY. Every node type the yaml grammar actually produces,
 *      counted. For a type needing a node type YAML has none of, this is
 *      positive evidence of absence.
 *
 *   B: PARSE-TREE SEMANTIC COUNT. For a type YAML CAN express but the corpus
 *      happens not to use in a form the analyzer reads. Counted on the tree by
 *      ROLE — a `block_mapping_pair` whose KEY node's text is `<<` is a merge
 *      key, whatever a string literal happens to contain. A probe that matches
 *      a shape rather than a role produces a number worth nothing, which is how
 *      this workstream's first gate version returned two false positives.
 *
 * Reads `grammars/tree-sitter-yaml/src/node-types.json` for the declared
 * vocabulary, so instrument A compares the corpus against the GRAMMAR and not
 * against a hand-kept list.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "../../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "yaml"

const nodeTypes: any[] = JSON.parse(readFileSync(path.join(ROOT, "grammars/tree-sitter-yaml/src/node-types.json"), "utf8"))
const declared = nodeTypes.filter((n) => n.named).map((n) => n.type).sort()

// ------------------------------------------------------------------ corpus
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
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ label: `${e}/${rel}`, text })
  }
}
console.log(`[probe] corpus: ${files.length} admitted files\n`)

// ------------------------------------------------------------------ parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-yaml.wasm"))))

// ------------------------------------------------------- A: grammar inventory
const produced = new Map<string, number>()
let errorRootFiles = 0
let errorNodes = 0
let missingNodes = 0

/** Strip a scalar node's quoting. YAML quoting is punctuation, not content. */
function unquote(text: string): string {
  const t = text.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1)
  return t
}

const PAIR_TYPES = new Set(["block_mapping_pair", "flow_pair"])
const MAPPING_TYPES = new Set(["block_mapping", "flow_mapping"])
const KEY_TOKENS = new Set(["string_scalar", "plain_scalar", "single_quote_scalar", "double_quote_scalar", "integer_scalar", "float_scalar", "boolean_scalar", "null_scalar", "timestamp_scalar", "block_scalar"])

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

/** Descendants of `n` at any depth. Iterative: corpus files nest deeply. */
function walk(root: any, fn: (n: any) => void): void {
  const stack = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    fn(n)
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

// ------------------------------------------------- B: semantic counts on tree
interface Probe {
  type: string
  label: string
  occurrences: number
  files: Set<string>
  examples: string[]
}
const probes = new Map<string, Probe>()
const tagInventory = new Map<string, number>()
let shapeNoOn = 0
let shapePlain = 0
const hit = (type: string, label: string, file: string): void => {
  let p = probes.get(type)
  if (!p) { p = { type, label, occurrences: 0, files: new Set(), examples: [] }; probes.set(type, p) }
  p.occurrences++
  p.files.add(file)
  if (p.examples.length < 5) p.examples.push(`${file} :: ${label}`)
}

/** GH Actions / generic: the value of a `uses:` key, with the ROLE that decides it. */
function workflowUsesRole(value: string): "reusable-workflow" | "action" | "docker" | "other" {
  if (value.startsWith("docker://")) return "docker"
  if (/\.ya?ml(@.+)?$/.test(value)) return "reusable-workflow"
  if (value.includes("/")) return "action"
  return "other"
}

/**
 * The dotted KEY chain from the outermost mapping down to `node`, e.g.
 * `jobs.build.steps.uses`. This is what makes a `uses:` probe role-scoped: a
 * `uses:` directly under `jobs.<id>` names a REUSABLE WORKFLOW to invoke, while a
 * `uses:` under `jobs.<id>.steps[]` names an ACTION to run. Both spell the key
 * `uses`, so only the chain distinguishes them — which is exactly the distinction
 * a `calls` edge rests on.
 */
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

for (const f of files) {
  let tree: any
  try { tree = parser.parse(f.text) } catch { continue }
  if (!tree) continue
  const root = tree.rootNode
  if (root.type === "ERROR") errorRootFiles++
  // A per-file pass so role-scoped counts do not need a second parse.
  walk(root, (n) => {
    produced.set(n.type, (produced.get(n.type) ?? 0) + 1)
    if (n.type === "ERROR") errorNodes++
    if (n.isMissing) missingNodes++

    if (n.type === "tag") tagInventory.set(n.text, (tagInventory.get(n.text) ?? 0) + 1)
    if (n.type === "anchor") {
      const an = n.namedChildren?.find((c: any) => c.type === "anchor_name")
      hit("anchor", `&${an?.text ?? "?"}`, f.label)
      return
    }
    if (n.type === "alias") {
      const nm = n.namedChildren?.find((c: any) => c.type === "alias_name")
      hit("uses", `alias *${nm?.text ?? "?"}`, f.label)
      return
    }
    if (!PAIR_TYPES.has(n.type)) return

    const key = keyTextOf(n)
    if (key === null) return
    const valueNode = n.childForFieldName?.("value")
    const scalarOf = (v: any): string | null => {
      if (!v) return null
      let cur = v
      for (let d = 0; d < 8 && (cur.type === "block_node" || cur.type === "flow_node"); d++) {
        let next: any = null
        for (let i = 0; i < cur.namedChildCount; i++) {
          const c = cur.namedChild(i)
          if (c && c.type !== "tag" && c.type !== "anchor" && c.type !== "anchor_name") { next = c; break }
        }
        if (!next) break
        cur = next
      }
      return KEY_TOKENS.has(cur.type) ? unquote(cur.text) : null
    }

    // merge key: the one YAML inheritance construct that is unambiguous.
    if (key === "<<") hit("extends", "merge key <<", f.label)

    // Duplicate key in the SAME mapping: the later entry replaces the earlier, so the
    // construct is a redefinition. The pairs are the named children of the MAPPING —
    // a pair's parent is `block_mapping`/`flow_mapping`, never another pair, so a
    // parent-type test for a pair never fires and this probe silently counted 0.
    const mapping = n.parent
    if (mapping && MAPPING_TYPES.has(mapping.type)) {
      let earlier = 0
      // The STRICT probe: a duplicate whose two entries are DISTINCT symbols. A key's
      // document path is built from its UNQUOTED text, so `a` and `'a'` are one key in
      // YAML and one path here — while `a` and `a ` written as distinct scalars keep
      // their own raw text. Only a pair whose RAW key text differs can ever become two
      // endpoints of an `overrides` edge; a same-text duplicate collapses onto one path.
      let distinctEarlier = 0
      for (let i = 0; i < mapping.namedChildCount; i++) {
        const sib = mapping.namedChild(i)
        if (!sib || !PAIR_TYPES.has(sib.type)) continue
        if (sib.startIndex >= n.startIndex) continue
        if (keyTextOf(sib) !== key) continue
        earlier++
        const rawSib = sib.childForFieldName?.("key")?.text ?? ""
        const rawSelf = n.childForFieldName?.("key")?.text ?? ""
        if (rawSib !== rawSelf) distinctEarlier++
      }
      if (earlier > 0) hit("overrides", `duplicate key ${key} (${earlier} earlier)`, f.label)
      if (distinctEarlier > 0) hit("overrides:distinct", `duplicate key ${key} with ${distinctEarlier} distinct-path earlier`, f.label)
    }

    // Ansible's `!override` is a directive to REPLACE a lower-precedence definition.
    // It is the corpus's second override construct and its target is a variable in
    // ANOTHER file, so it is counted here rather than silently ignored.
    for (const c of (valueNode?.namedChildren ?? [])) {
      if (c?.type !== "tag") continue
      if (c.text === "!override" || c.text === "!reset") hit(`overrides:tag:${c.text}`, keyChain(n).join("."), f.label)
    }

    if (key === "uses") {
      const v = scalarOf(valueNode)
      if (v) {
        const role = workflowUsesRole(v)
        hit("uses", `uses: ${v} [${role}]`, f.label)
        const chain = keyChain(n)
        // The role the CHAIN decides, which is the role a `calls` edge may rest on.
        const atJobLevel = chain.length === 3 && chain[0] === "jobs" && chain[2] === "uses"
        const atStepLevel = chain.length >= 4 && chain[0] === "jobs" && chain[2] === "steps"
        hit(atJobLevel ? "calls:job-level" : atStepLevel ? "uses:step-level" : "uses:other-level",
          `${chain.join(".")} = ${v}`, f.label)
        if (role === "reusable-workflow") hit("calls", `uses: ${v}`, f.label)
      }
      return
    }
    // A `workflow_call` trigger makes the workflow itself invocable.
    if (key === "workflow_call" || key === "workflow_dispatch" || key === "workflow_run") {
      hit(`exports:${key}`, `on.${key}`, f.label)
    }
    // `on.workflow_call.{inputs,outputs,secrets}.<name>` is the surface the workflow
    // publishes to whatever caller invokes it: the one place YAML writes down an
    // export rather than merely naming an entry point. The named inputs live in the
    // VALUE mapping of the `workflow_call` entry, not beside it — an earlier version
    // walked the parent mapping and so counted 0 of a construct that occurs in 88 files.
    if (key === "workflow_call") {
      const chain = keyChain(n)
      const surface = chain[0] === "on" ? chain[1] : "<not-under-on>"
      const vm = valueNode?.namedChildren?.find((c: any) => MAPPING_TYPES.has(c.type))
      for (const sib of (vm?.namedChildren ?? [])) {
        if (!sib || !PAIR_TYPES.has(sib.type)) continue
        const sk = keyTextOf(sib)
        if (sk !== "inputs" && sk !== "outputs" && sk !== "secrets") continue
        const gm = sib.namedChildren?.find((c: any) => MAPPING_TYPES.has(c.type))
        for (const leaf of (gm?.namedChildren ?? [])) {
          if (!leaf || !PAIR_TYPES.has(leaf.type)) continue
          const lk = keyTextOf(leaf)
          if (lk === null) continue
          hit(`exports:${surface}.${sk}`, `on.workflow_call.${sk}.${lk}`, f.label)
        }
      }
    }
    // A `!Custom` tag constructs a value of an application-defined type.
    if (key === "extends" || key === "implements" || key === "inherits" || key === "implements_type") {
      hit("implements", `${key}: ${scalarOf(valueNode) ?? "<mapping>"}`, f.label)
    }
  })
  // Files whose top level has `jobs` but no `on`: a job-level `uses:` in one of these
  // is NOT provably a GitHub Actions workflow, so it is where a framework-gated `calls`
  // edge would be withheld. The count is the gate's own blind spot, measured.
  const hasOn = /(^|\n)\s*['"]?on['"]?\s*:/.test(f.text)
  const hasJobs = /(^|\n)\s*jobs\s*:/.test(f.text)
  if (hasJobs && !hasOn) shapeNoOn++
  if (!hasOn && !hasJobs) shapePlain++
  tree.delete?.()
}

// ------------------------------------------------------------------ report
console.log(`A: GRAMMAR INVENTORY — ${produced.size} distinct node types produced over ${files.length} files`)
const rows = [...produced.entries()].sort((a, b) => b[1] - a[1])
for (const [t, n] of rows) console.log(`   ${String(n).padStart(12)}  ${t}`)
const undeclared = [...produced.keys()].filter((t) => !declared.includes(t))
console.log(`\nnode-types.json declares ${declared.length} named types; corpus produced ${produced.size};`)
console.log(`produced but NOT declared: ${undeclared.length ? undeclared.join(", ") : "(none)"}`)
console.log(`declared but NEVER produced: ${declared.filter((d) => !produced.has(d)).join(", ") || "(none)"}`)
console.log(`\nroot-is-ERROR files: ${errorRootFiles} (${((errorRootFiles / files.length) * 100).toFixed(1)}%)   ERROR nodes: ${errorNodes}   MISSING nodes: ${missingNodes}`)

console.log(`\nB: PARSE-TREE SEMANTIC COUNTS (role-scoped, whole corpus)`)
for (const p of [...probes.values()].sort((a, b) => b.occurrences - a.occurrences)) {
  console.log(`   ${p.type.padEnd(12)} ${String(p.occurrences).padStart(8)} occurrences in ${p.files.size} files — ${p.label}`)
  for (const ex of p.examples.slice(0, 3)) console.log(`        e.g. ${ex}`)
}

console.log(`\nTAG INVENTORY — ${tagInventory.size} distinct tag texts`)
for (const [t, n] of [...tagInventory.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(8)}  ${t}`)
console.log(`\nSHAPE — files with top-level \`jobs\` but no \`on\`: ${shapeNoOn}   files with neither: ${shapePlain}   (of ${files.length})`)
