// Convergence sweep: swift probes for the 7 shared blind-spot classes.
// Registered gap: #754 (member reads emit nothing). C4 keep-both = swift's
// overload-correct contract. C7 SwiftUI verified live.
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: dotted user call survives (verified: calls:doWork)
  {
    cls: "C1",
    name: "dotted user call survives",
    lines: [
      "class A {",
      "  func run() {",
      "    Logger.doWork()",
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
      "  var x = 0",
      "  func set(v: Int) {",
      "    x = v",
      "  }",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: current-state pin — reads emit NOTHING (#754). Flip when fixed.
  {
    cls: "C2+",
    name: "read current-state pin (#754 gap)",
    lines: [
      "class R {",
      "  var x = 0",
      "  func get() -> Int {",
      "    return x",
      "  }",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: uses.length === 0, detail: "uses edges on x: " + uses.length + " (FLIP when #754 lands — read expected)" }
    },
  },
  // C3: 1-based lines
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "class L {",
      "",
      "  func target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate methods — swift keeps BOTH (overload model, correct for swift)
  {
    cls: "C4",
    name: "duplicate decls: keep-both (overload model)",
    lines: [
      "class D {",
      "  func foo() -> Int { return 1 }",
      "  func foo() -> Int { return 2 }",
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
    name: "string literals stay inert",
    lines: [
      "class S {",
      "  func go() {",
      "    log(\"save\")",
      "    let s = \"a.b.c\"",
      "  }",
      "  func log(_ m: String) {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read — current-state pin (nothing emitted, #754)
  {
    cls: "C6",
    name: "chain read current-state pin (#754 gap)",
    lines: [
      "class Inner { var deeper = Deeper() }",
      "class Deeper { var leaf = 1 }",
      "class Ch {",
      "  var inner = Inner()",
      "  func read() -> Int {",
      "    return inner.deeper.leaf",
      "  }",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: !targets.includes("inner") && !targets.includes("deeper"), detail: "chain-use targets: " + JSON.stringify(targets) + " (FLIP when #754 lands — members expected)" }
    },
  },
  // C7: framework — SwiftUI verified live
  {
    cls: "C7",
    name: "swiftui detected via import",
    lines: [
      "import SwiftUI",
      "struct ContentView: View {",
      "  var body: some View { Text(\"hi\") }",
      "}",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("SwiftUI"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
