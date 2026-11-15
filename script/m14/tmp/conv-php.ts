// Convergence sweep: php probes for the 7 shared blind-spot classes.
// `<?php` is the FIRST line of every probe so SFC-line asserts are 1:1.
// Contracts verified via discovery: full chain reads keep root, write-gates hold,
// Laravel detected, dup methods keep-both (overload-echo class, same as java/py).
import type { Probe } from "./conv-harness"

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — FQ user call survives
  {
    cls: "C1",
    name: "dotted user call survives builtin filter",
    lines: [
      "<?php",
      "class A {",
      "  public function run() {",
      "    \\My\\Company\\Service::doWork();",
      "  }",
      "}",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — $this->x = $v must NOT read-use x
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "<?php",
      "class W {",
      "  public $x = 0;",
      "  public function set($v) { $this->x = $v; }",
      "}",
    ],
    check: (res) => {
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: bad.length === 0, detail: "uses edges on write LHS x: " + bad.length }
    },
  },
  // C2+: read still emits (discovery: uses:get->x)
  {
    cls: "C2+",
    name: "read still emits",
    lines: [
      "<?php",
      "class R {",
      "  public $x = 0;",
      "  public function get() { return $this->x; }",
      "}",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "x")
      return { ok: uses.length > 0, detail: "uses edges on x: " + uses.length }
    },
  },
  // C3: 1-based lines (target on line 3)
  {
    cls: "C3",
    name: "symbol line is 1-based",
    lines: [
      "<?php",
      "class L {",
      "  public function target() {}",
      "}",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 3, detail: "reported=" + t.range?.startLine + " expected=3" }
    },
  },
  // C4: duplicate methods — keep-both class (like java/py); last not dropped
  {
    cls: "C4",
    name: "duplicate decls: last not silently dropped",
    lines: [
      "<?php",
      "class D {",
      "  public function foo() { return 1; }",
      "  public function foo() { return 2; }",
      "}",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(4), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) }
    },
  },
  // C5: string contents never become edges (discovery: only calls:go->log)
  {
    cls: "C5",
    name: "string literals stay inert",
    lines: [
      "<?php",
      "class S {",
      "  public function go() { $this->log('save'); }",
      "  public function log($m) {}",
      "}",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) =>
        String(e.target).includes("a.b.c") || String(e.target).includes("'"))
      const logCall = ofType(res, "calls").filter((e: any) => String(e.target) === "log")
      return { ok: bad.length === 0 && logCall.length > 0, detail: "string-read edges: " + bad.length + ", calls log: " + logCall.length }
    },
  },
  // C6: chain read keeps root (discovery: read->inner + deeper + leaf)
  {
    cls: "C6",
    name: "chain read keeps root",
    lines: [
      "<?php",
      "class Inner { public Deeper $deeper; }",
      "class Deeper { public int $leaf = 1; }",
      "class Ch {",
      "  public Inner $inner;",
      "  public function read() { return $this->inner->deeper->leaf; }",
      "}",
    ],
    check: (res) => {
      const targets = ofType(res, "uses").map((e: any) => String(e.target))
      return { ok: targets.includes("inner"), detail: "chain-use targets: " + JSON.stringify(targets) }
    },
  },
  // C7: framework detection (discovery: ["Laravel"])
  {
    cls: "C7",
    name: "framework use detected",
    lines: [
      "<?php",
      "use Illuminate\\Support\\Facades\\Route;",
      "class App {}",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("Laravel"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
