// Convergence sweep: scala probes for the 7 shared blind-spot classes.
// Contract verified via discovery probe + #741:
//   - CONV-S-1 (#741): Spring NOT detected — C7 asserts a framework that IS in
//     the list (Cats Effect) as the positive control; Spring is the registered gap.
//   - uses edges exist (read->inner root attribution); chain middle/leaf not
//     emitted as uses (scala's current shape — noted, not the java pin).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — FQ third-party call survives
  {
    cls: "C1",
    name: "com.mycompany survives root filter",
    lines: [
      "package com.mycompany.app",
      "class A {",
      "  def run(): Unit = {",
      "    com.mycompany.Service.doWork()",
      "  }",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — x = v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "class W {",
      "  var x: Int = 0",
      "  def set(v: Int): Unit = { x = v }",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: read still emits (scala emits uses:read->inner on chain roots)
  {
    cls: "C2+",
    name: "read still emits",
    lines: [
      "class Inner { val deeper = 1 }",
      "class R {",
      "  val inner = new Inner",
      "  def get(): Int = inner.deeper",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "inner")
      return { ok: uses.length > 0, detail: "uses edges on inner: " + uses.length }
    },
  },
  // C3: 1-based lines
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "class L {",
      "  ",
      "  def target(): Unit = ()",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate decls — scala keeps both (overload model); last must survive
  {
    cls: "C4",
    name: "duplicate decls: last not silently dropped",
    lines: [
      "class D {",
      "  def foo(): Int = 1",
      "  def foo(): Int = 2",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(3), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert (non-template)",
    lines: [
      "class S {",
      "  def go(): Unit = { log(\"save\") }",
      "  def log(m: String): Unit = ()",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read keeps root (discovery: uses:read->inner)
  {
    cls: "C6",
    name: "chain read keeps root",
    lines: [
      "class Inner { val deeper = new Deeper }",
      "class Deeper { val leaf: Int = 1 }",
      "class Ch {",
      "  val inner = new Inner",
      "  def read(): Int = inner.deeper.leaf",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: targets.includes("inner"), detail: "chain-use targets: " + JSON.stringify(targets) + " (root present = no collapse)" }
    },
  },
  // C7: framework detection — positive control from the ACTUAL list.
  // Spring is CONV-S-1 (#741): registered gap, do not assert it here.
  {
    cls: "C7",
    name: "framework import detected (Cats Effect control)",
    lines: [
      "import cats.effect.IO",
      "class App",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("Cats Effect"), detail: "detectedFrameworks=" + JSON.stringify(fw) + " (Spring gap = #741)" }
    },
  },
]

export { probes }
