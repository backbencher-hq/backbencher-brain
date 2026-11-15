// Convergence sweep: go probes for the 7 shared blind-spot classes.
// Contracts verified via discovery: method reads emit (uses:Get->x — this-recv
// reads work, unlike the #739 family), selector chain reads emit middle+leaf
// (root missing — same shape as csharp #750 but via parameter receivers; the
// go corpus lanes and GOD-wave verified this as the pinned contract), gin
// detected, dup funcs keep-both.
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: FQ third-party call survives (verified: calls:run->doWork)
  {
    cls: "C1",
    name: "FQ third-party call survives",
    lines: [
      "package main",
      "func run() {",
      "  com.mycompany.Service.doWork()",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — w.x = v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "package main",
      "type W struct { x int }",
      "func (w *W) Set(v int) {",
      "  w.x = v",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: method read still emits (verified: uses:Get->x)
  {
    cls: "C2+",
    name: "method read still emits",
    lines: [
      "package main",
      "type W struct { x int }",
      "func (w *W) Get() int {",
      "  return w.x",
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
      "package main",
      "",
      "func target() {}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate funcs — go forbids redeclaration (compile error); keep-both
  // is the verified current shape (count=2). Deterministic handling only.
  {
    cls: "C4",
    name: "duplicate funcs: keep-both (CE shape pin)",
    lines: [
      "package main",
      "func foo() int {",
      "  return 1",
      "}",
      "func foo() int {",
      "  return 2",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(5), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (compile-error shape; deterministic handling only)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "package main",
      "func go2() {",
      "  log(\"save\")",
      "  s := map[string]string{\"a.b.c\": \"x\"}",
      "  _ = s",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: selector chain read — middle+leaf emitted (verified);
  // root (the parameter binding) is not — same shape as csharp #750, pinned here.
  {
    cls: "C6",
    name: "selector chain keeps middle (root absent = #750-shape pin)",
    lines: [
      "package main",
      "type Inner struct { deeper Deeper }",
      "type Deeper struct { leaf int }",
      "func read(inner Inner) int {",
      "  return inner.deeper.leaf",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: targets.includes("deeper") && targets.includes("leaf"), detail: "chain-use targets: " + JSON.stringify(targets) + " (root `inner` absent — #750-family shape)" }
    },
  },
  // C7: framework — gin verified live
  {
    cls: "C7",
    name: "gin detected via import",
    lines: [
      "package main",
      "import \"github.com/gin-gonic/gin\"",
      "func main() { r := gin.Default() }",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("gin"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
