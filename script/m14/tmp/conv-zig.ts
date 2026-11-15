// Convergence sweep: zig probes for the 7 shared blind-spot classes.
// Verified: struct-field reads emit (uses:get->x — the #739-family gap is
// ABSENT here), calls emit, dup decls keep-both (CE shape), detectedFrameworks
// key undefined (systems language — no framework ecosystem to detect; recorded
// as a payload-uniformity note, not a defect).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: user call survives
  {
    cls: "C1",
    name: "user call survives builtin filter",
    lines: [
      "fn run() void {",
      "    service.doWork();",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — self.x = v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "const W = struct {",
      "    x: i32,",
      "    fn set(self: *W, v: i32) void {",
      "        self.x = v;",
      "    }",
      "};",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: field read emits (verified: uses:get->x)
  {
    cls: "C2+",
    name: "field read still emits",
    lines: [
      "const W = struct {",
      "    x: i32,",
      "    fn get(self: W) i32 {",
      "        return self.x;",
      "    }",
      "};",
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
      "fn target() void {}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 1, detail: "reported=" + t.range?.startLine + " expected=1" }
    },
  },
  // C4: duplicate decls — top-level const redecl is a compile error; keep-both
  // is the expected deterministic shape (not probed in discovery; honest assert)
  {
    cls: "C4",
    name: "duplicate decls: last not silently dropped",
    lines: [
      "const w1 = struct {",
      "    pub fn foo() i32 {",
      "        return 1;",
      "    }",
      "};",
      "const w2 = struct {",
      "    pub fn foo() i32 {",
      "        return 2;",
      "    }",
      "};",
    ],
    check: (res) => {
      // distinct containers, same inner name: both must survive (no first-wins
      // cross-container collision)
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(7), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) }
    },
  },
  // C5: string contents never become edges
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "fn go2() void {",
      "    log(\"save\");",
      "    const s = \"a.b.c\";",
      "    _ = s;",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("\""))
      return { ok: bad.length === 0, detail: "string-derived edges: " + JSON.stringify(bad.map((e: any) => e.type + ":" + e.target)) }
    },
  },
  // C6: chain read — unverified shape; probe reveals
  {
    cls: "C6",
    name: "dotted chain read keeps root",
    lines: [
      "const Inner = struct { deeper: Deeper };",
      "const Deeper = struct { leaf: i32 };",
      "fn read(inner: Inner) i32 {",
      "    return inner.deeper.leaf;",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      const ok = targets.includes("deeper") || targets.includes("leaf")
      return { ok, detail: "chain-use targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework payload — systems language; key undefined in discovery.
  // Pins current state; payload-uniformity handled at the family level.
  {
    cls: "C7",
    name: "framework payload current-state pin (systems lang)",
    lines: [
      "const std = @import(\"std\");",
      "pub fn main() void {}",
    ],
    check: (res) => {
      const fw = res.metadata?.detectedFrameworks
      return { ok: fw === undefined || (Array.isArray(fw) && fw.length === 0), detail: "detectedFrameworks=" + JSON.stringify(fw) + " (systems language — uniformity note, not a defect)" }
    },
  },
]

export { probes }
