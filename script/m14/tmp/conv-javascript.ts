// Convergence sweep: javascript probes for the 7 shared blind-spot classes.
// JS contracts verified during the M49.J2 wave (J1 owner-keyed payloads, J2 no
// 0.95 fabrication, J3 last-wins, J10 JSX detection).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — user property access survives
  {
    cls: "C1",
    name: "dotted user call survives builtin filter",
    lines: [
      "const Service = { doWork() {} };",
      "class A {",
      "  run() {",
      "    Service.doWork();",
      "  }",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — this.x = y must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "class W {",
      "  constructor() { this.x = 0; }",
      "  set(y) {",
      "    this.x = y;",
      "  }",
      "}",
    ],
    check: (res) => {
      // the ctor `this.x = 0` declares/initializes; the BLIND-SPOT class is a
      // read-use edge on the LHS of `this.x = y` — assert none in set().
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: read still emits
  {
    cls: "C2+",
    name: "read still emits",
    lines: [
      "class R {",
      "  get() {",
      "    return this.x;",
      "  }",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: uses.length > 0, detail: "uses edges on x: " + uses.length }
    },
  },
  // C3: 1-based lines
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "class L {",
      "  ",
      "  target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate decls — J3 pin: one symbol, last (body-carrying) wins
  {
    cls: "C4",
    name: "duplicate decls: last-wins (J3 pin)",
    lines: [
      "class D {",
      "  foo() { return 1 }",
      "  foo() { return 2 }",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length === 1 && lines[0] === 3, detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (J3 pin)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "class S {",
      "  go() {",
      "    log('save');",
      "    const s = 'a.b.c';",
      "  }",
      "  log(m) {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("'") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read keeps root
  {
    cls: "C6",
    name: "chain read keeps root",
    lines: [
      "const inner = { deeper: { leaf: 1 } };",
      "function read() {",
      "  return inner.deeper.leaf;",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      const ok = targets.includes("inner")
      return { ok, detail: "chain-use targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework detection surfaces in payload
  {
    cls: "C7",
    name: "framework import detected",
    lines: [
      "const _ = require('lodash');",
      "module.exports = { first: _.first };",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.length > 0, detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
