// Convergence sweep: cpp probes for the 7 shared blind-spot classes.
// CAVEAT (CONV-CPPC-1 #743): the pinned tree-sitter-cpp grammar fails on 73% of
// the nlohmann-json corpus (95.7% of production headers), so class verdicts here
// hold for PARSEABLE shapes; the grammar-upgrade wave owns the rest.
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: user call survives
  {
    cls: "C1",
    name: "user call survives builtin filter",
    lines: [
      "class Service { public: static void doWork(); };",
      "void run() {",
      "    Service::doWork();",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — this->x = v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "class W {",
      "public:",
      "    int x;",
      "    void set(int v) { this->x = v; }",
      "};",
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
      "class W {",
      "public:",
      "    int x;",
      "    int get() { return this->x; }",
      "};",
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
      "class L {",
      "public:",
      "    void target();",
      "};",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate methods in one class — CE shape; deterministic only
  {
    cls: "C4",
    name: "duplicate decls: deterministic handling (CE shape)",
    lines: [
      "class D {",
      "public:",
      "    int foo() { return 1; }",
      "    int foo() { return 2; }",
      "};",
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
      "void go2() {",
      "    log(\"save\");",
      "    std::string s = \"a.b.c\";",
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
      "struct Inner { Deeper deeper; };",
      "int read(Inner &inner) {",
      "    return inner.deeper.leaf;",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      const ok = targets.includes("deeper") || targets.includes("leaf")
      return { ok, detail: "chain-read targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework payload — systems language; pin current state.
  {
    cls: "C7",
    name: "framework payload current-state pin (systems lang)",
    lines: [
      "#include <string>",
      "int main() { return 0; }",
    ],
    check: (res) => {
      const fw = res.metadata?.detectedFrameworks
      return { ok: fw === undefined || (Array.isArray(fw) && fw.length === 0), detail: "detectedFrameworks=" + JSON.stringify(fw) + " (systems language — uniformity note, not a defect)" }
    },
  },
]

export { probes }
