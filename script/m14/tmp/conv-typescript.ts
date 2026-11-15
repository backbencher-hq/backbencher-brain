// Convergence sweep: typescript probes for the 7 shared blind-spot classes.
// TS contracts verified during the M49.T1 wave (rel `type` field, 1-based lines,
// last-wins J3-family pin, detectedFrameworks payload).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — FQ dotted third-party call survives
  {
    cls: "C1",
    name: "dotted user call survives builtin filter",
    lines: [
      "class Service {",
      "  static doWork(): void {}",
      "}",
      "class A {",
      "  run(): void {",
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
      "  x: number = 0;",
      "  set(y: number): void {",
      "    this.x = y;",
      "  }",
      "}",
    ],
    check: (res) => {
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
      "  x: number = 0;",
      "  get(): number {",
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
      "  target(): void {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate decls — TS last-wins pin (JSD family): one symbol, last line
  {
    cls: "C4",
    name: "duplicate decls: last-wins (JSD pin)",
    lines: [
      "class D {",
      "  foo(): number { return 1; }",
      "  foo(): number { return 2; }",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length === 1 && lines[0] === 3, detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (JSD last-wins pin)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "class S {",
      "  go(): void {",
      "    log(\"save\");",
      "    const s = \"a.b.c\";",
      "  }",
      "  log(m: string): void {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read keeps root
  {
    cls: "C6",
    name: "chain read keeps root",
    lines: [
      "class Deeper { leaf: number = 1; }",
      "class Inner { deeper: Deeper = new Deeper(); }",
      "class Ch {",
      "  inner: Inner = new Inner();",
      "  read(): number {",
      "    return this.inner.deeper.leaf;",
      "  }",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      const ok = targets.includes("inner") || targets.includes("deeper")
      return { ok, detail: "chain-use targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework detection surfaces in payload
  {
    cls: "C7",
    name: "framework import detected",
    lines: [
      "import express from \"express\";",
      "export const app = express();",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.length > 0, detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
