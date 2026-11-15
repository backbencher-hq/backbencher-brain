// Convergence sweep: kotlin probes for the 7 shared blind-spot classes.
// Asserts written against the verified contract (discovery probe + #740):
//   - metadata.detectedFrameworks carries e.g. ["Spring Boot","Spring Framework"]
//   - CONV-K-1 (#740) is FIXED: plain and dotted member reads now emit uses.
//     C2+ and C6 used to assert only the narrower K1 indexing contract because
//     the gap was registered; they now pin the member-read emission itself
//     (the bare read in C2+, the chain base read in C6) alongside the controls
//     they already carried, so the port cannot silently regress.
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — FQ third-party call with a stdlib-looking segment
  {
    cls: "C1",
    name: "com.mycompany survives root filter",
    lines: [
      "package com.mycompany.app",
      "class A {",
      "  fun run() {",
      "    com.mycompany.Service.doWork()",
      "  }",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length + " (root-only filter must keep FQ user calls)" }
    },
  },
  // C2: write-gate — assignment LHS is a write, not a read
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "class W {",
      "  val xs = intArrayOf(1, 2)",
      "  fun set() {",
      "    xs[0] = 5",
      "  }",
      "}",
    ],
    check: (res) => {
      // KAD1 gate: xs[0] = 5 must NOT emit uses on xs
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "xs")
      return { ok: bad.length === 0, detail: "uses edges on write LHS xs: " + bad.length + " (KAD1 gate)" }
    },
  },
  // C2+: post-assign READ of both shapes must emit — the K1 indexing read
  // (positive control) AND the bare member read (#740, previously the gap)
  {
    cls: "C2+",
    name: "indexing read and bare member read both emit",
    lines: [
      "class R {",
      "  val xs = intArrayOf(1, 2)",
      "  var n = 3",
      "  fun get(): Int {",
      "    return xs[0] + n",
      "  }",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses")
      const onXs = uses.filter((e: any) => String(e.target) === "xs")
      const onN = uses.filter((e: any) => String(e.target) === "n")
      return {
        ok: onXs.length > 0 && onN.length > 0,
        detail: "uses(xs)=" + onXs.length + " (K1 control) uses(n)=" + onN.length + " (#740 bare member read)",
      }
    },
  },
  // C3: 1-based lines — symbol on line 3 reports 3
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "class L {",
      "  ",
      "  fun target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate decls — kotlin last-wins pin (J3-family): one symbol, last line
  {
    cls: "C4",
    name: "duplicate decls: last not silently dropped",
    lines: [
      "class D {",
      "  fun foo(): Int { return 1 }",
      "  fun foo(): Int { return 2 }",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      // discovery showed kotlin keeps BOTH duplicate method symbols (java-like
      // overload model, contains:C->foo twice). The blind-spot class is SILENT
      // DROP of the body-carrying (last) declaration — assert the last decl
      // line is present, mirroring the java C4 ruling.
      const lastPresent = lines.includes(3)
      return { ok: foos.length >= 1 && lastPresent, detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (overload model legal; last decl must not be dropped)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert (non-template)",
    lines: [
      "class S {",
      "  fun go() {",
      "    log(\"save\")",
      "    val s = \"a.b.c\"",
      "  }",
      "  fun log(m: String) {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\"") ||
        String(e.source ?? "").includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read — the BASE is a declared member and must emit uses (#740),
  // while the CALL on the chain still resolves through the call graph. A chain
  // MID/LEAF that belongs to another type must NOT emit (gate A).
  {
    cls: "C6",
    name: "chain base read emits and chained call resolves",
    lines: [
      "class Ch {",
      "  val svc = Service()",
      "  fun run() {",
      "    svc.repo.find()",
      "  }",
      "}",
    ],
    check: (res) => {
      const calls = ofType(res, "calls").filter((e: any) =>
        String(e.target) === "find" || String(e.target) === "repo")
      const baseUse = ofType(res, "uses").filter((e: any) => String(e.target) === "svc")
      const leaked = ofType(res, "uses").filter((e: any) =>
        String(e.target) === "repo" || String(e.target) === "find")
      return {
        ok: calls.length > 0 && baseUse.length > 0 && leaked.length === 0,
        detail: "chain-calls=" + JSON.stringify(calls.map((e: any) => e.source + "->" + e.target)) +
          " uses(svc)=" + baseUse.length + " leaked(mid/leaf)=" + leaked.length,
      }
    },
  },
  // C7: framework detection surfaces in payload
  {
    cls: "C7",
    name: "framework import detected",
    lines: [
      "import org.springframework.boot.autoconfigure.SpringBootApplication",
      "class App",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      const hasSpring = fw.some((f) => f.toLowerCase().includes("spring"))
      return { ok: hasSpring, detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
