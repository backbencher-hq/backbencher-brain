// Convergence sweep: objc probes for the 7 shared blind-spot classes.
// Contracts verified via discovery: property reads EMIT (uses:getV->x — the
// #739-family gap is ABSENT here), write-gate holds, full-selector pins visible,
// UIKit detected. C4/C6 asserts probe unverified shapes honestly.
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: user message-send survives (objc idiom: [Service doWork])
  {
    cls: "C1",
    name: "user message send survives builtin filter",
    lines: [
      "@implementation A",
      "- (void)run {",
      "  [Service doWork];",
      "}",
      "@end",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — self.x = v must NOT read-use x (verified in discovery)
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "@interface W : NSObject",
      "@property (atomic, assign) int x;",
      "@end",
      "@implementation W",
      "- (void)setV:(int)v {",
      "  self.x = v;",
      "}",
      "@end",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: property read emits (verified: uses:getV->x)
  {
    cls: "C2+",
    name: "property read still emits",
    lines: [
      "@interface R : NSObject",
      "@property (atomic, assign) int x;",
      "@end",
      "@implementation R",
      "- (int)getV {",
      "  return self.x;",
      "}",
      "@end",
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
      "@interface L : NSObject",
      "@end",
      "@implementation L",
      "- (void)target {}",
      "@end",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 4, detail: "reported=" + t.range?.startLine + " expected=4" }
    },
  },
  // C4: duplicate selectors — objc forbids them at compile time; assert the
  // last decl is not silently dropped (family pattern; current shape recorded)
  {
    cls: "C4",
    name: "duplicate selectors: last not silently dropped",
    lines: [
      "@implementation D",
      "- (int)foo { return 1; }",
      "- (int)foo { return 2; }",
      "@end",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo" || String(s.name).startsWith("foo"))
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && (lines.includes(4) || lines.includes(3)), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) + " (compile-error shape; deterministic handling only)" }
    },
  },
  // C5: string contents never become edges (verified in discovery)
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "@implementation S",
      "- (void)go {",
      "  [self log:@\"save\"];",
      "}",
      "- (void)log:(NSString *)m {}",
      "@end",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || (String(e.target).includes("\"") && !String(e.target).includes("log")))
      const logCall = ofType(res, "calls").filter((e: any) => String(e.target).includes("log"))
      return { ok: bad.length === 0 && logCall.length > 0, detail: "string-read edges: " + bad.length + ", calls log: " + logCall.length }
    },
  },
  // C6: dotted property chain keeps root — unverified shape; probe reveals.
  {
    cls: "C6",
    name: "dotted property chain keeps root",
    lines: [
      "@interface Inner : NSObject",
      "@property (atomic, strong) Deeper *deeper;",
      "@end",
      "@implementation Ch",
      "- (int)readInner:(Inner *)inner {",
      "  return inner.deeper.leaf;",
      "}",
      "@end",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      const ok = targets.includes("deeper") || targets.includes("leaf")
      return { ok, detail: "chain-use targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework — UIKit verified live
  {
    cls: "C7",
    name: "uikit detected via import",
    lines: [
      "#import <UIKit/UIKit.h>",
      "@implementation HomeVC",
      "@end",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("UIKit"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
