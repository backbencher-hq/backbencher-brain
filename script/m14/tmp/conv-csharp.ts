// Convergence sweep: csharp probes for the 7 shared blind-spot classes.
// Registered gaps referenced in-place: #750 (bare reads + chain-root missing),
// #751 (framework detection absent — metadata key undefined).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — dotted user call survives
  {
    cls: "C1",
    name: "dotted user call survives builtin filter",
    lines: [
      "public static class Service {",
      "  public static void DoWork() {}",
      "}",
      "public class A {",
      "  public void Run() {",
      "    Service.DoWork();",
      "  }",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("DoWork"))
      return { ok: hits.length > 0, detail: "edges reaching DoWork: " + hits.length }
    },
  },
  // C2: write-gate — x = v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "public class W {",
      "  private int x;",
      "  public void Set(int v) { x = v; }",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: chain read emits (current coverage); bare read is #750.
  {
    cls: "C2+",
    name: "chain member read emits (bare read = #750)",
    lines: [
      "public class Inner { public Deeper deeper; }",
      "public class Deeper { public int leaf; }",
      "public class R {",
      "  public Inner inner;",
      "  public int Read() { return inner.deeper; }",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "deeper")
      return { ok: uses.length > 0, detail: "uses edges on deeper: " + uses.length + " (bare-read gap = #750)" }
    },
  },
  // C3: 1-based lines
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "public class L {",
      "",
      "  public void Target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "Target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate methods — keep-both class; last not dropped
  {
    cls: "C4",
    name: "duplicate decls: last not silently dropped",
    lines: [
      "public class D {",
      "  public int Foo() { return 1; }",
      "  public int Foo() { return 2; }",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "Foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(3), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "public class S {",
      "  public void Go() {",
      "    Log(\"save\");",
      "    var s = \"a.b.c\";",
      "  }",
      "  public void Log(string m) {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read keeps middle (current); root = #750
  {
    cls: "C6",
    name: "chain read keeps middle (root = #750)",
    lines: [
      "public class Inner { public Deeper deeper; }",
      "public class Deeper { public int leaf; }",
      "public class Ch {",
      "  public Inner inner;",
      "  public int Read() { return inner.deeper.leaf; }",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: targets.includes("deeper") && targets.includes("leaf"), detail: "chain-use targets: " + JSON.stringify(targets) + " (root `inner` missing = #750)" }
    },
  },
  // C7: framework — CONV-CS-2 (#751): no mechanism, key undefined. Pin current.
  {
    cls: "C7",
    name: "framework payload current-state pin (#751 gap)",
    lines: [
      "using Microsoft.AspNetCore.Mvc;",
      "public class HomeController : Controller {}",
    ],
    check: (res) => {
      const fw = res.metadata?.detectedFrameworks
      return { ok: fw === undefined || (Array.isArray(fw) && fw.length === 0), detail: "detectedFrameworks=" + JSON.stringify(fw) + " (FLIP when #751 lands — ASP.NET Core expected)" }
    },
  },
]

export { probes }
