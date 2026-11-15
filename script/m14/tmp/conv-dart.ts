// Convergence sweep: dart probes for the 7 shared blind-spot classes.
// Registered gaps referenced in-place: #752 (member reads emit nothing),
// #753 (dup methods keep FIRST body — Low: compile error in real dart).
// C7 control: Flutter detection (verified live: ["Dart","Flutter"]).
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
      "  void run() {",
      "    Logger.doWork();",
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
      "  int x = 0;",
      "  void set(int v) {",
      "    x = v;",
      "  }",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: #752 FIXED — a bare read of a declared field must now emit uses.
  {
    cls: "C2+",
    name: "bare field read emits uses (#752 fixed)",
    lines: [
      "class R {",
      "  int x = 0;",
      "  int get() {",
      "    return x;",
      "  }",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: uses.length === 1 && uses[0].source === "get", detail: "uses edges on x: " + uses.length + " from=" + (uses[0]?.source ?? "-") }
    },
  },
  // C3: 1-based lines
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "class L {",
      "",
      "  void target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate methods — first-wins current pin (#753). Flip when fixed.
  {
    cls: "C4",
    name: "duplicate decls current-state pin (#753 gap)",
    lines: [
      "class D {",
      "  int foo() { return 1; }",
      "  int foo() { return 2; }",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length === 1 && lines[0] === 2, detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (FLIP when #753 lands — last-wins expected)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "class S {",
      "  void go() {",
      "    log('save');",
      "    var s = 'a.b.c';",
      "  }",
      "  void log(String m) {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("'"))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: #752 FIXED — the chain ROOT is a bare read of a declared field, so
  // `inner` must now appear alongside the dotted-link members deeper/leaf.
  {
    cls: "C6",
    name: "chain root read emits uses (#752 fixed)",
    lines: [
      "class Inner { Deeper deeper = Deeper(); }",
      "class Deeper { int leaf = 1; }",
      "class Ch {",
      "  Inner inner = Inner();",
      "  int read() {",
      "    return inner.deeper.leaf;",
      "  }",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: targets.includes("inner") && targets.includes("deeper") && targets.includes("leaf"), detail: "chain-use targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework — Flutter verified live (the user's own question: dart IS the
  // Flutter analyzer; deployment targets don't matter to analysis).
  {
    cls: "C7",
    name: "flutter detected via package import",
    lines: [
      "import 'package:flutter/material.dart';",
      "class MyWidget extends StatelessWidget {",
      "  @override",
      "  Widget build(BuildContext context) => Container();",
      "}",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("Flutter") && fw.includes("Dart"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
