// Convergence sweep: haskell probes for the 7 shared blind-spot classes.
// Verified conventions: symbols report the DEFINITION (bind) line, not the
// type-signature line (1-based, consistent); function APPLICATIONS emit calls;
// value-level references emit nothing (#755 — registered gap, pinned here).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: user call survives — application form emits (verified calls:run->helper)
  {
    cls: "C1",
    name: "application call survives builtin filter",
    lines: [
      "module M where",
      "",
      "serviceDoWork :: IO ()",
      "serviceDoWork = return ()",
      "",
      "run :: IO ()",
      "run = serviceDoWork",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("serviceDoWork"))
      return { ok: hits.length > 0, detail: "edges reaching serviceDoWork: " + hits.length }
    },
  },
  // C2: pure binding emits no spurious self-read
  {
    cls: "C2",
    name: "pure binding emits no spurious read of itself",
    lines: [
      "module M where",
      "",
      "x :: Int",
      "x = compute 1",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "self-read edges on binding x: " + bad.length }
    },
  },
  // C2+: value reference — current-state pin (#755). Flip when fixed.
  {
    cls: "C2+",
    name: "value reference current-state pin (#755 gap)",
    lines: [
      "module M where",
      "",
      "base :: Int",
      "base = 1",
      "",
      "derived :: Int",
      "derived = base + 1",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "base")
      return { ok: uses.length === 0, detail: "uses edges on base: " + uses.length + " (FLIP when #755 lands — value ref expected)" }
    },
  },
  // C3: bind-line convention — decl at `target = 1` on line 4 reports 4
  {
    cls: "C3",
    name: "symbol line is bind-line (verified convention)",
    lines: [
      "module L where",
      "",
      "target :: Int",
      "target = 1",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 4, detail: "reported=" + t.range?.startLine + " expected=4 (bind-line pin)" }
    },
  },
  // C4: duplicate top-level names — CE shape; deterministic keep (verified: 1 kept)
  {
    cls: "C4",
    name: "duplicate decls: deterministic keep (CE shape)",
    lines: [
      "module D where",
      "",
      "foo :: Int",
      "foo = 1",
      "",
      "foo :: Int",
      "foo = 2",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length === 1 && lines.includes(4), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (verified: first kept)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "module S where",
      "",
      "go :: IO ()",
      "go = log \"save\"",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: application chain keeps root (verified: calls:run->helper)
  {
    cls: "C6",
    name: "application chain keeps head (calls)",
    lines: [
      "module C where",
      "",
      "deep :: Int -> Int",
      "deep = id",
      "",
      "run :: Int -> Int",
      "run n = deep n",
    ],
    check: (res) => {
      const targets = ofType(res, "calls").map((e: any) => String(e.target))
      return { ok: targets.includes("deep"), detail: "chain-call targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework payload — haskell builds [] (verified); pin current.
  {
    cls: "C7",
    name: "framework payload current-state pin",
    lines: [
      "module M where",
      "",
      "main :: IO ()",
      "main = return ()",
    ],
    check: (res) => {
      const fw = res.metadata?.detectedFrameworks
      return { ok: fw === undefined || (Array.isArray(fw) && fw.length === 0), detail: "detectedFrameworks=" + JSON.stringify(fw) + " (ecosystem-detection scope note, not a defect)" }
    },
  },
]

export { probes }
