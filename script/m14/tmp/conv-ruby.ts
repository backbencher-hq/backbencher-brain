// Convergence sweep: ruby probes for the 7 shared blind-spot classes.
// Contracts verified via discovery: ivar reads emit (uses:get->@x), write-gates
// hold, chain READS are call-typed in ruby (calls:read->deeper — dynamic-dispatch
// contract, not the java uses pin), dup methods keep-both.
// C7: #749 = the registered trigger-surface gap; positive control here is the
// VERIFIED mechanism (ActiveRecord base class), which fires "Ruby on Rails".
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — user method call survives
  {
    cls: "C1",
    name: "user call survives builtin filter",
    lines: [
      "class Service",
      "  def self.do_work",
      "  end",
      "end",
      "class A",
      "  def run",
      "    Service.do_work",
      "  end",
      "end",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("do_work"))
      return { ok: hits.length > 0, detail: "edges reaching do_work: " + hits.length }
    },
  },
  // C2: write-gate — @x = v must NOT read-use @x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "class W",
      "  def set(v)",
      "    @x = v",
      "  end",
      "end",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "@x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS @x: " + bad.length }
    },
  },
  // C2+: read still emits (discovery: uses:get->@x)
  {
    cls: "C2+",
    name: "read still emits",
    lines: [
      "class R",
      "  def get",
      "    @x",
      "  end",
      "end",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "@x")
      return { ok: uses.length > 0, detail: "uses edges on @x: " + uses.length }
    },
  },
  // C3: 1-based lines
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "class L",
      "",
      "  def target",
      "  end",
      "end",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate defs — keep-both class; last not dropped
  {
    cls: "C4",
    name: "duplicate decls: last not silently dropped",
    lines: [
      "class D",
      "  def foo",
      "    1",
      "  end",
      "  def foo",
      "    2",
      "  end",
      "end",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(5), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "class S",
      "  def go",
      "    log('save')",
      "  end",
      "  def log(m)",
      "  end",
      "end",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("'"))
      const logCall = rels(res).filter((e: any) => String(e.target) === "log" && e.type !== "contains")
      return { ok: bad.length === 0 && logCall.length > 0, detail: "string-read edges: " + bad.length + ", log edges: " + logCall.length }
    },
  },
  // C6: chain read — ruby's dynamic-dispatch contract types these as CALLS;
  // root and middle present (discovery: read->leaf, read->deeper via calls).
  {
    cls: "C6",
    name: "chain read keeps middle (call-typed contract)",
    lines: [
      "class Ch",
      "  def read",
      "    inner.deeper.leaf",
      "  end",
      "end",
    ],
    check: (res) => {
      const callTargets = ofType(res, "calls").map((e: any) => String(e.target))
      const ok = callTargets.includes("deeper") && callTargets.includes("leaf")
      return { ok, detail: "chain call targets: " + JSON.stringify(callTargets) }
    },
  },
  // C7: framework — positive control from the VERIFIED trigger (ActiveRecord
  // base). The require-level gap is #749; flip when that fix lands.
  {
    cls: "C7",
    name: "ActiveRecord base detected (verified trigger)",
    lines: [
      "class User < ActiveRecord::Base",
      "end",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("Ruby on Rails"), detail: "detectedFrameworks=" + JSON.stringify(fw) + " (require-level gap = #749)" }
    },
  },
]

export { probes }
