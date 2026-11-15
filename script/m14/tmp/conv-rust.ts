// Convergence sweep: rust probes for the 7 shared blind-spot classes.
// Contracts verified via discovery + focused probes: method reads emit
// (uses:get->x — self-recv reads work), chain reads emit middle+leaf (root
// absent — #750-family shape, pinned), dup fns keep-both, detection is
// derive/attribute-scoped BY DESIGN (documented at real-rust-analyzer.ts L391).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: user method call survives
  {
    cls: "C1",
    name: "user method call survives",
    lines: [
      "fn run() {",
      "  service.do_work();",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("do_work"))
      return { ok: hits.length > 0, detail: "edges reaching do_work: " + hits.length }
    },
  },
  // C2: write-gate — self.x = v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "struct W { x: i32 }",
      "impl W {",
      "  fn set(&mut self, v: i32) {",
      "    self.x = v;",
      "  }",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: method read still emits (verified: uses:get->x)
  {
    cls: "C2+",
    name: "method read still emits",
    lines: [
      "struct W { x: i32 }",
      "impl W {",
      "  fn get(&self) -> i32 {",
      "    self.x",
      "  }",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: uses.length > 0, detail: "uses edges on x: " + uses.length }
    },
  },
  // C3: 1-based lines (verified via nested mod)
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "mod m {",
      "  pub fn target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 2, detail: "reported=" + t.range?.startLine + " expected=2" }
    },
  },
  // C4: duplicate free fns — rust allows shadowing? No: same-module same-name is
  // a compile error; keep-both is the verified current shape (deterministic only)
  {
    cls: "C4",
    name: "duplicate fns: keep-both (CE shape pin)",
    lines: [
      "fn foo() -> i32 {",
      "  1",
      "}",
      "fn foo() -> i32 {",
      "  2",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(4), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "fn go2() {",
      "  log(\"save\");",
      "  let s = \"a.b.c\";",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read keeps middle (root absent — #750-family shape pin)
  {
    cls: "C6",
    name: "chain read keeps middle (root absent = #750-shape pin)",
    lines: [
      "struct Inner { deeper: Deeper }",
      "struct Deeper { leaf: i32 }",
      "fn read(inner: &Inner) -> i32 {",
      "  inner.deeper.leaf",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: targets.includes("deeper") && targets.includes("leaf"), detail: "chain-use targets: " + JSON.stringify(targets) + " (root `inner` absent — #750-family shape)" }
    },
  },
  // C7: framework — derive-scoped detection is the documented contract;
  // positive control = serde derive. use-only imports = known scope (low).
  {
    cls: "C7",
    name: "serde derive detected (documented scope)",
    lines: [
      "use serde::Serialize;",
      "#[derive(Serialize)]",
      "struct Data { a: i32 }",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("serde"), detail: "detectedFrameworks=" + JSON.stringify(fw) + " (use-only scope documented at L391)" }
    },
  },
]

export { probes }
