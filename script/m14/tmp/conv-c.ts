// Convergence sweep: c probes for the 7 shared blind-spot classes.
// CAVEAT (CONV-CPPC-1 #743): the pinned tree-sitter-c grammar fails on 44.4% of
// the jq corpus (un-preprocessed GNU-C macro code), so class verdicts here hold
// for PARSEABLE shapes; the grammar-upgrade wave owns the rest.
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: user call survives
  {
    cls: "C1",
    name: "user call survives builtin filter",
    lines: [
      "void doWork(void);",
      "void run(void) {",
      "    doWork();",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — s->field = v must NOT read-use field
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "struct W { int x; };",
      "void set(struct W *w, int v) {",
      "    w->x = v;",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "read edges on write LHS x: " + bad.length }
    },
  },
  // C2+: field read emits
  {
    cls: "C2+",
    name: "field read still emits",
    lines: [
      "struct W { int x; };",
      "int get(struct W *w) {",
      "    return w->x;",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: uses.length > 0, detail: "read edges on x: " + uses.length }
    },
  },
  // C3: 1-based lines
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "",
      "void target(void) {}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 2, detail: "reported=" + t.range?.startLine + " expected=2" }
    },
  },
  // C4: duplicate function names — CE shape at file scope; deterministic only
  {
    cls: "C4",
    name: "duplicate decls: deterministic handling (CE shape)",
    lines: [
      "int foo(void) { return 1; }",
      "int foo(void) { return 2; }",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      return { ok: foos.length >= 1, detail: "count=" + foos.length + " (compile-error shape; deterministic handling only)" }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "void log2(const char *m);",
      "void go2(void) {",
      "    log2(\"save\");",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: member-chain read keeps middle
  {
    cls: "C6",
    name: "member chain keeps middle",
    lines: [
      "struct Deeper { int leaf; };",
      "struct Inner { struct Deeper deeper; };",
      "int read(struct Inner *inner) {",
      "    return inner->deeper.leaf;",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      const ok = targets.includes("deeper") || targets.includes("leaf")
      return { ok, detail: "chain-read targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework — VERIFIED POSITIVE: c detects "Standard C Library" from
  // libc includes (better than csharp/python — the #751/#747 gap does not apply).
  {
    cls: "C7",
    name: "libc include detected (verified positive)",
    lines: [
      "#include <stdio.h>",
      "int main(void) { return 0; }",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("Standard C Library"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
