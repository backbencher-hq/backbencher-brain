// Convergence sweep: java probes for the 7 shared blind-spot classes.
// Asserts written against the REAL analyzer contract (verified via shape dump):
//   - relationships use `type` (lowercase: calls/uses/contains/...), source/target
//   - metadata.detectedFrameworks is the framework payload
//   - java keeps same-name method symbols (overload model) — C4 asserts no silent
//     drop of the last decl, not dedupe
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — FQ third-party call with a stdlib-looking segment
  {
    cls: "C1",
    name: "com.mycompany survives root filter",
    lines: [
      "package com.mycompany.app;",
      "public class A {",
      "  void run() {",
      "    com.mycompany.Service.doWork();",
      "  }",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length + " (org/com root-only fix must keep the call)" }
    },
  },
  // C2: write-gate — this.x = y must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "public class W {",
      "  int x;",
      "  void set(int y) {",
      "    this.x = y;",
      "  }",
      "}",
    ],
    check: (res) => {
      const xReads = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: xReads.length === 0, detail: "read-edges targeting x: " + xReads.length }
    },
  },
  // C2+: post-assign read must still emit
  {
    cls: "C2+",
    name: "read after assign still emits",
    lines: [
      "public class R {",
      "  int x;",
      "  int get() {",
      "    return this.x;",
      "  }",
      "}",
    ],
    check: (res) => {
      const xReads = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: xReads.length > 0, detail: "uses edges targeting x: " + xReads.length }
    },
  },
  // C3: 1-based lines — symbol on line 3 reports 3
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "public class L {",
      "  ",
      "  void target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      const reported = t.range?.startLine
      return { ok: reported === 3, detail: "reported=" + reported + " expected=3" }
    },
  },
  // C4: duplicate method decls — java keeps both (overload model); the blind-spot
  // class is a SILENT DROP of the later decl. Assert the last decl is present.
  {
    cls: "C4",
    name: "duplicate decls: last not silently dropped",
    lines: [
      "public class D {",
      "  void foo() { int a = 1; }",
      "  void foo() { int b = 2; }",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      const lastPresent = lines.includes(3)
      return { ok: foos.length >= 1 && lastPresent, detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (java overload model: both kept is legal)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "public class S {",
      "  void go() {",
      "    log(\"save\");",
      "    String s = \"a.b.c\";",
      "  }",
      "  void log(String m) {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\"") ||
        String(e.source ?? "").includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read — JAD2 pin: reads source to the enclosing METHOD with each
  // nesting level's target (`read -> deeper`, `read -> leaf`). The collapse class
  // was `a.b.c -> a->c` with the MIDDLE lost; the middle must stay present.
  // Chain-root and bare-identifier reads are CONV-J-1 (registered, open).
  {
    cls: "C6",
    name: "chain read keeps middle (no collapse)",
    lines: [
      "public class Ch {",
      "  Inner inner;",
      "  static class Inner { Deeper deeper; }",
      "  static class Deeper { int leaf; }",
      "  int read() {",
      "    return inner.deeper.leaf;",
      "  }",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      const middleKept = targets.includes("deeper")
      const leafKept = targets.includes("leaf")
      return { ok: middleKept && leafKept, detail: "chain-use targets: " + JSON.stringify(targets) + " (middle `deeper` present = no a.b.c->leaf collapse; root gap = CONV-J-1)" }
    },
  },
  // C7: framework detection surfaces in payload
  {
    cls: "C7",
    name: "framework import detected",
    lines: [
      "import org.springframework.boot.autoconfigure.SpringBootApplication;",
      "public class App {}",
    ],
    check: (res) => {
      const fw = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("spring"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
