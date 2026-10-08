#!/usr/bin/env tsx
// M26.H1 — the hub's group ORDER must put the reader's own code first.
//
// THE DEFECT, found by the owner looking at a real panel (2026-10-07).
// `Backbencher: Open in Graph` on `traverseGraph` rendered, as the FIRST group:
//
//     (EXTERNAL) · 39
//         (drizzle in any) (external)
//         add (external)
//         attachMatchedIdentities (external)
//         Buffer (external)
//         countSurviving (external)
//         cwd (external)
//         Database (external)
//         delete (external)
//         ...
//
// and the project's own callees came after all of it.
//
// THE CAUSE, one line. `script/m26/graph-core.ts:993` keys an external entry's
// group as the literal string "(external)", and the group keys are then sorted
// with a plain `.sort()`. "(" sorts before every letter, so the external bucket
// is always rendered FIRST — 39 rows of `Buffer`, `Number`, `Promise`, `parse`,
// `join`, `cwd` before a single symbol of the reader's own code.
//
// WHAT IS AND IS NOT WRONG HERE, stated because it is easy to get backwards.
// The external edges are REAL and they are not noise in the sense the store's
// `isNoiseSymbolName` means (index artifacts: anonymous placeholders, keywords
// indexed as symbols, absolute paths used as names). `traverseGraph` genuinely
// calls `floor`, `max`, `min` and `join`. Nothing is being hidden and nothing
// should be dropped — a hop through `max` to reach the answer is real structure.
//
// So this is NOT a filter and must not become one. It is an ORDERING defect: the
// answer to "what does this call in MY code" is below a screen of standard
// library. Ordering is the fix; deleting edges would be a lie about the graph.
//
// WHAT THIS GATES: with internal groups present, the external group is rendered
// LAST, and the ROW SET is byte-identical before and after — an ordering change
// that quietly drops or duplicates a row is not an ordering change.

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

// --- a DOM stub, in the shape graph-core expects --------------------------
class El {
  children: El[] = []
  attrs: Record<string, string> = {}
  text = ""
  classes = new Set<string>()
  constructor(public tag: string) {}
  setAttribute(k: string, v: string) { this.attrs[k] = v }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null }
  addClass(c: string) { this.classes.add(c) }
  appendChild(c: El) { this.children.push(c); return c }
  append(...cs: El[]) { cs.forEach((c) => this.children.push(c)) }
  setText(t: string) { this.text = t }
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join("") }
  // graph-core WRITES textContent (hubSummary assigns to it), so a getter-only
  // stub throws before any group is rendered — the first version of this gate
  // died on that, which would have looked like a renderer bug.
  set textContent(v: string) { this.text = v }
  /** Every descendant that carries the class. */
  findAll(cls: string): El[] {
    const out: El[] = []
    const walk = (e: El) => { if (e.classes.has(cls)) out.push(e); e.children.forEach(walk) }
    walk(this)
    return out
  }
}
const makeDom = () => { const root = new El("div"); return { create: (t: string) => new El(t), root: () => root, el: root } }

// --- fixture: exactly the shape the owner's panel had ------------------------
type Row = { name: string; file: string; symbolId: string }
const internal = (name: string, file: string): Row => ({ name, file, symbolId: `${file}:${name}` })
const external = (name: string): Row => ({ name, file: "", symbolId: `ext:${name}` })

// Deliberately alphabetical-adverse: the externals are chosen so that a
// first-position external bucket is obvious, and the internal files sort AFTER
// "(external)" but BEFORE most of the external names — i.e. if ordering is the
// only thing that changes, this fixture detects it.
const rows: Row[] = [
  internal("resolveNode", "graph/graph-engine.ts"),
  internal("collectEdges", "graph/graph-engine.ts"),
  internal("traverse", "intelligence/contracts.ts"),
  external("Buffer"),
  external("add"),
  external("cwd"),
  external("max"),
  external("min"),
  external("parse"),
  external("Promise"),
  external("resolve"),
  external("set"),
  external("split"),
]

// --- drive the REAL renderer ------------------------------------------------
// The first version of this gate reimplemented the ordering rule locally and
// proved the rule was right while `graph-core.ts` still sorted the old way —
// the blind-oracle class, in a gate whose whole subject is a sort. So this drives
// `renderHubList` itself and reads the group order out of the DOM it produces.
const { renderHubList } = await import(path.join(ROOT, "script", "m26", "graph-core"))

type Entry = Record<string, unknown>
const internalEntry = (name: string, file: string): Entry => ({
  symbolId: `${file}:${name}`,
  name,
  file,
  language: "typescript",
  symbolType: "function",
  line: 10,
  isExternal: false,
  relationshipTypes: [{ type: "calls", occurrences: 1 }],
  occurrences: 1,
  rows: [],
  dir: "callee",
  enrichment: undefined,
  callSite: { kind: "call-site", file, line: 11, note: "" },
})
const externalEntry = (name: string): Entry => ({
  symbolId: `ext:${name}`,
  name,
  file: "",
  language: "unknown",
  symbolType: "function",
  line: 0,
  isExternal: true,
  relationshipTypes: [{ type: "calls", occurrences: 1 }],
  occurrences: 1,
  rows: [],
  dir: "callee",
  enrichment: undefined,
  callSite: { kind: "call-site", file: "", line: null, note: "" },
})

const grouped = {
  root: { symbolId: "root", name: "traverseGraph", file: "graph/graph-engine.ts", language: "typescript", line: 350 },
  callers: [],
  callees: [
    internalEntry("resolveNode", "graph/graph-engine.ts"),
    internalEntry("collectEdges", "graph/graph-engine.ts"),
    internalEntry("traverse", "intelligence/contracts.ts"),
    externalEntry("Buffer"),
    externalEntry("add"),
    externalEntry("cwd"),
    externalEntry("max"),
    externalEntry("min"),
    externalEntry("parse"),
    externalEntry("Promise"),
    externalEntry("resolve"),
    externalEntry("set"),
    externalEntry("split"),
  ],
  fileLevel: { imports: [], exports: [] },
  counts: { callerGroups: 0, calleeGroups: 4, callerRows: 0, calleeRows: 13, fileLevelRows: 0 },
  summary: { truncated: false, crossLanguageGroups: 0 },
} as never

/** Render and read the group order the renderer actually produced. */
function renderedGroupOrder(g: unknown): string[] {
  const root = new El("div")
  const dom = { create: (t: string) => new El(t), root: () => root, el: root }
  renderHubList(g, dom as never, "file")
  // Groups carry data-group-name; read them in DOM order, which is render order.
  const out: string[] = []
  const walk = (e: El) => {
    const n = e.getAttribute("data-group-name")
    if (n !== null) out.push(n)
    e.children.forEach(walk)
  }
  walk(root)
  return out
}

const order = renderedGroupOrder(grouped)
console.log(`  rendered group order: ${JSON.stringify(order)}`)

check(
  "the renderer puts the EXTERNAL bucket LAST when internal groups exist",
  order.length > 0 && order[order.length - 1] === "(external)" && order[0] !== "(external)",
  `first=${JSON.stringify(order[0])} last=${JSON.stringify(order[order.length - 1])}`,
)

{
  const internal = order.filter((k) => k !== "(external)")
  check(
    "internal groups keep their own alphabetical order (only the external bucket moved)",
    JSON.stringify(internal) === JSON.stringify([...internal].sort()),
    `internal order: ${JSON.stringify(internal)}`,
  )
}

check(
  "the external bucket is still PRESENT — ordering must never hide a group",
  order.includes("(external)"),
  `groups rendered: ${order.length}, external present: ${order.includes("(external)")}`,
)

// The row set must be untouched. The renderer returns stats; compare them with
// the fixture, and count the rows the DOM actually carries.
{
  const root = new El("div")
  const dom = { create: (t: string) => new El(t), root: () => root, el: root }
  // RenderStats carries `nodesRendered`, not `rowsRendered` — the first version
  // asserted a field that does not exist, so the leg was failing on `undefined`
  // rather than on anything about rows. The DOM count is the independent check:
  // it is read off what was actually rendered, not off a statistic.
  const stats = renderHubList(grouped, dom as never, "file") as { nodesRendered?: number }
  const renderedRows = root.findAll("bb-hub-row").length
  check(
    "no row is dropped or duplicated by the reorder",
    stats?.nodesRendered === grouped.callees.length && renderedRows === grouped.callees.length,
    `stats.nodesRendered=${stats?.nodesRendered} dom rows=${renderedRows} fixture=${grouped.callees.length}`,
  )
}

// A graph of nothing but externals must still render them.
{
  const onlyExternal = { ...grouped, callees: [externalEntry("Buffer"), externalEntry("max")], counts: { ...grouped.counts, calleeGroups: 1, calleeRows: 2 } } as never
  const o = renderedGroupOrder(onlyExternal)
  check(
    "a graph with nothing but externals still shows them",
    o.length === 1 && o[0] === "(external)",
    `order: ${JSON.stringify(o)}`,
  )
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nHUB GROUP ORDER: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)