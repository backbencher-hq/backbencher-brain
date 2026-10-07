/**
 * VUE TEMPLATE-CALL PROBE — measures the population behind a possible `calls`
 * emission from the template pass.
 *
 * THE QUESTION. `calls` is EMITTED for this lane from the SCRIPT pass only.
 * The lane documents "template event bindings do not emit calls" as a scope
 * boundary. But a template expression is an EXPRESSION: `@click="save(1)"`,
 * `:label="t.toUpperCase()"`, `{{ fmt(n) }}` all contain a call, and the
 * template pass currently collects IDENTIFIERS from them (which is why
 * `@click="handler"` already yields `uses`). So either
 *
 *   (a) the construct never occurs — the label is RULED with a measurement, or
 *   (b) it occurs and the lane has a GAP.
 *
 * Prose cannot decide that, so this walks the corpus and counts. INSTRUMENT: the
 * expression TEXT is re-parsed with the javascript grammar and the count is
 * taken on THAT tree (`call_expression` nodes), never on the text. A text pattern
 * over a template would match a call inside a string — `{{ "f(" }}` — and miss
 * a call the grammar recovers from, which is the defect class the ontology gate
 * measured twice.
 *
 * Shadowing is reported too, because it decides whether the callee is a COMPONENT
 * member: `v-for="row in rows"` binds `row`, so `@click="row.save()"` calls a
 * loop-local and must NOT become `component -> save`.
 *
 * NO REGEX.
 *
 * Usage: bun script/vue-fix/vue-template-call-probe.ts [--repos a,b] [--json out.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"
import { getParser } from "../../src/ast/engine"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (argOf("--repos") ?? "vuejs,vue-element-admin,element-plus").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--json")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))

const vueParser = await getParser("vue")
const jsParser = await getParser("javascript")

const childOfType = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
const unquote = (t: string): string => {
  if (t.length >= 2) {
    const f = t[0]
    if ((f === '"' || f === "'" || f === "`") && t[t.length - 1] === f) return t.slice(1, -1)
  }
  return t
}

type Row = {
  filesWithTemplateCall: Set<string>
  exprWithCall: number
  exprTotal: number
  parseFailures: number
  calleeLeaves: Map<string, number>
  shadowedCalleeLeaves: Map<string, number>
  examples: string[]
  handlerShapes: Map<string, number>
}
const row: Row = {
  filesWithTemplateCall: new Set(), exprWithCall: 0, exprTotal: 0, parseFailures: 0,
  calleeLeaves: new Map(), shadowedCalleeLeaves: new Map(), examples: [], handlerShapes: new Map(),
}
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** Leaf of a callee expression: `a.b.c` -> `c`, `f(x)` -> `f`. Node walk only. */
function calleeLeaf(fn: Node): string {
  let cur = fn
  for (let i = 0; i < 8; i++) {
    if (cur.type === "member_expression") {
      const p = cur.childForFieldName("property")
      if (p) { cur = p; continue }
      const o = cur.childForFieldName("object")
      if (o) { cur = o; continue }
      return ""
    }
    if (cur.type === "identifier") return cur.text
    if (cur.type === "subscript_expression") {
      const o = cur.childForFieldName("object")
      if (o) { cur = o; continue }
      return ""
    }
    if (cur.type === "parenthesized_expression" || cur.type === "as_expression") {
      const k = cur.namedChild(0)
      if (k) { cur = k; continue }
      return ""
    }
    return ""
  }
  return ""
}

/** v-for loop vars + slot props visible in this element's subtree. */
function shadowedNames(element: Node): Set<string> {
  const out = new Set<string>()
  const stack: Node[] = [element]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "directive_attribute") {
      const dn = childOfType(n, "directive_name")
      const name = dn?.text ?? ""
      if (name === "v-for" || name === "#" || name === "v-slot" || name === "slot") {
        const q = childOfType(n, "quoted_attribute_value")
        const av = q ? childOfType(q, "attribute_value") : null
        if (av) {
          const text = av.text
          // No regex: split on the delimiters Vue's own grammar uses. `(` is the
          // destructure/slot-param opener, `,` and `:` separate aliases, and the
          // `in` keyword (as a whole word) ends the v-for alias head.
          const head = name === "v-for" ? splitHeadBeforeIn(text) : text
          let token = ""
          const flush = () => {
            const t = token.trim()
            if (t.length > 0 && t !== "in" && !t.includes(".")) out.add(t)
            token = ""
          }
          for (const ch of head) {
            if (ch === "{" || ch === "(" || ch === "," || ch === ":" || ch === " " || ch === "\t" || ch === "\n") flush()
            else token += ch
          }
          flush()
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}
function splitHeadBeforeIn(text: string): string {
  const parts = text.split(" in ")
  return parts.length > 1 ? parts[0] : text
}

let files = 0
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  if (!statSync(dir).isDirectory()) { console.error(`skip ${dir}`); continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    const label = `${repo}/${rel}`
    const tree = vueParser.parse(text)
    if (!tree) continue
    files++
    // Collect (expression text, kind, owning element) with the element so the
    // shadow set can be computed at the right scope.
    const exprs: { text: string; kind: string; owner: Node | null }[] = []
    const stack: Node[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "interpolation") {
        const raw = childOfType(n, "raw_text")
        if (raw) exprs.push({ text: raw.text, kind: "interpolation", owner: n.parent })
      }
      if (n.type === "directive_attribute") {
        const q = childOfType(n, "quoted_attribute_value")
        const av = q ? childOfType(q, "attribute_value") : null
        if (av) {
          const dn = childOfType(n, "directive_name")?.text ?? ""
          exprs.push({ text: av.text, kind: `directive:${dn}`, owner: n.parent })
          if (dn === "v-on" || dn === "@") bump(row.handlerShapes, "v-on")
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    for (const e of exprs) {
      if (e.text.trim().length === 0) continue
      row.exprTotal++
      let sub
      try { sub = jsParser.parse(e.text) } catch { row.parseFailures++; continue }
      if (!sub) { row.parseFailures++; continue }
      if (sub.rootNode.hasError) { row.parseFailures++ }
      const calls: string[] = []
      const w: Node[] = [sub.rootNode]
      while (w.length) {
        const n = w.pop()!
        if (n.type === "call_expression") {
          const fn = n.childForFieldName("function")
          if (fn) {
            const leaf = calleeLeaf(fn)
            if (leaf.length > 0) calls.push(leaf)
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) w.push(c)
        }
      }
      if (calls.length === 0) continue
      row.exprWithCall++
      row.filesWithTemplateCall.add(label)
      if (row.examples.length < 8) row.examples.push(`${label} [${e.kind}] ${e.text.trim().slice(0, 50)} -> ${calls.join(",")}`)
      const shadow = e.owner ? shadowedNames(e.owner) : new Set<string>()
      for (const c of calls) {
        if (shadow.has(c)) bump(row.shadowedCalleeLeaves, c)
        else bump(row.calleeLeaves, c)
      }
    }
    tree.delete?.()
  }
}

const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
console.log(`\nvue template-call probe — corpora: ${REPOS.join(", ")}`)
console.log(`files(.vue)=${files}  template expressions parsed=${row.exprTotal}  of which containing a call_expression=${row.exprWithCall} (in ${row.filesWithTemplateCall.size} files)  parse-error expressions=${row.parseFailures}`)
console.log(`\nunshadowed callee leaves (a component member a calls edge could name): ${row.calleeLeaves.size} distinct`)
for (const [k, v] of top(row.calleeLeaves, 25)) console.log(`   ${String(v).padStart(5)}  ${k}`)
console.log(`\nshadowed callee leaves (v-for/slot-local — must NOT become a component call): ${row.shadowedCalleeLeaves.size} distinct`)
for (const [k, v] of top(row.shadowedCalleeLeaves, 15)) console.log(`   ${String(v).padStart(5)}  ${k}`)
console.log(`\nexamples:`)
for (const e of row.examples) console.log(`   ${e}`)
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), corpora: REPOS, files,
    expressions: row.exprTotal, expressionsWithCall: row.exprWithCall,
    filesWithTemplateCall: row.filesWithTemplateCall.size,
    expressionParseErrors: row.parseFailures,
    unshadowedCalleeLeaves: Object.fromEntries(row.calleeLeaves),
    shadowedCalleeLeaves: Object.fromEntries(row.shadowedCalleeLeaves),
    examples: row.examples,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}