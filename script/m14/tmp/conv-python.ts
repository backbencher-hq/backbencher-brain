// Convergence sweep: python probes for the 7 shared blind-spot classes.
// Registered gaps referenced in-place: #747 (framework detection dead),
// #748 (dup defs keep-both vs last-wins runtime semantics).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — dotted user call survives
  {
    cls: "C1",
    name: "dotted user call survives builtin filter",
    lines: [
      "class Service:",
      "    @staticmethod",
      "    def doWork():",
      "        pass",
      "class A:",
      "    def run(self):",
      "        Service.doWork()",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — self.x = v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "class W:",
      "    def set(self, v):",
      "        self.x = v",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: read still emits (discovery: uses:get->x)
  {
    cls: "C2+",
    name: "read still emits",
    lines: [
      "class R:",
      "    def get(self):",
      "        return self.x",
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
      "class L:",
      "",
      "    def target(self):",
      "        pass",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate defs — python keeps BOTH (#748 registered: runtime is last-wins).
  // The blind-spot class is a SILENT DROP of the later decl; both-kept is the
  // current pin (flip to last-wins with the #748 fix wave).
  {
    cls: "C4",
    name: "duplicate defs: last not silently dropped (#748 pin)",
    lines: [
      "class D:",
      "    def foo(self):",
      "        return 1",
      "    def foo(self):",
      "        return 2",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(4), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (keep-both pin; last-wins = #748)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "class S:",
      "    def go(self):",
      "        log('save')",
      "        s = 'a.b.c'",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("'"))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read keeps root (discovery: uses:read->inner — full chain)
  {
    cls: "C6",
    name: "chain read keeps root",
    lines: [
      "class Inner:",
      "    def __init__(self):",
      "        self.deeper = None",
      "class Ch:",
      "    def __init__(self):",
      "        self.inner = Inner()",
      "    def read(self):",
      "        return self.inner.deeper.leaf",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: targets.includes("inner"), detail: "chain-use targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework detection — CONV-PY-1 (#747): the mechanism is dead code.
  // Pins the CURRENT contract; flip this assert when the #747 fix lands.
  {
    cls: "C7",
    name: "framework payload current-state pin (#747 gap)",
    lines: [
      "from django.db import models",
      "class App:",
      "    pass",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.length === 0, detail: "detectedFrameworks=" + JSON.stringify(fw) + " (FLIP THIS ASSERT when #747 lands — Django/Flask expected)" }
    },
  },
]

export { probes }
