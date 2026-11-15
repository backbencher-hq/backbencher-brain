// M49 W9 — F6 adjudication part 3: for each dead literal whose branch is
// possibly LOAD-BEARING, prove the observable behavior on a live parse.
// Not "does it compile" — what edge/metadata CHANGES if the intent is unhandled.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const CASES: Array<{ lang: string; wasm: string; analyzer: string; cls: string; file: string; check: (res: any) => string }> = []

// ---- JAVA: does a comment inside an argument list inflate argumentCount? ----
CASES.push({
  lang: "java", wasm: "tree-sitter-java.wasm", analyzer: "real-java-analyzer", cls: "RealJavaAnalyzer", file: "A.java",
  check: (res) => {
    const calls = (res.relationships ?? []).filter((r: any) => r.type === "calls" && String(r.target).startsWith("g"))
    return calls.map((c: any) => `${c.target}#${c.metadata?.argumentCount}`).join(" ") || "(no call edges)"
  },
})

// ---- ZIG: qualified type position + anonymous struct param ----
CASES.push({
  lang: "zig", wasm: "tree-sitter-zig.wasm", analyzer: "real-zig-analyzer", cls: "RealZigAnalyzer", file: "a.zig",
  check: (res) => {
    const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses")
    return uses.map((u: any) => `${u.source}->${u.target}`).join(" ") || "(no uses)"
  },
})

// ---- GO: receiver read on a non-call selector ----
CASES.push({
  lang: "go", wasm: "tree-sitter-go.wasm", analyzer: "real-go-analyzer", cls: "RealGoAnalyzer", file: "a.go",
  check: (res) => {
    const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses")
    return uses.map((u: any) => `${u.source}->${u.target}`).join(" ") || "(no uses)"
  },
})

// ---- CPP: template params + dependent typename ----
CASES.push({
  lang: "cpp", wasm: "tree-sitter-cpp.wasm", analyzer: "real-cpp-analyzer", cls: "RealCppAnalyzer", file: "a.cc",
  check: (res) => {
    const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses")
    const over = (res.relationships ?? []).filter((r: any) => r.type === "overrides")
    return "uses: " + (uses.map((u: any) => `${u.source}->${u.target}`).join(" ") || "-") +
      " | overrides: " + (over.map((o: any) => `${o.source}->${o.target}`).join(" ") || "-")
  },
})

const SOURCES: Record<string, string> = {
  java: [
    "class A {",
    "  void f() {",
    "    g(1, 2);",
    "    g(1 /* inline */, 2);",
    "    g(1, /* lead */ 2);",
    "    g();",
    "  }",
    "  void g(int a, int b) {}",
    "}",
  ].join("\n"),
  zig: [
    "const std = @import(\"std\");",
    "const GLOBAL = 7;",
    "",
    "fn f(s: struct { GLOBAL: u8 }) void {",
    "    var y: std.mem.Allocator = undefined;",
    "    _ = s;",
    "    _ = y;",
    "    _ = GLOBAL;",
    "}",
    "",
    "const S = struct { GLOBAL: u8, pub fn m() void {} };",
  ].join("\n"),
  go: [
    "package p",
    "",
    "var db S",
    "",
    "type S struct{ cfg int }",
    "",
    "func f() {",
    "\tx := db.cfg",
    "\tdb.cfg = 1",
    "\t_ = x",
    "}",
  ].join("\n"),
  cpp: [
    "template <typename T> struct Base { virtual void run(T x); };",
    "template <class T> struct Derived : Base<T> { void run(T x) override; };",
    "template <class T, int N> struct Q { T v[N]; };",
    "template <int N = 3> struct R {};",
    "template <class T> void g() { typename T::X v; (void)v; }",
    "void h() { Q<int, 3> q; (void)q; R<> r; (void)r; }",
  ].join("\n"),
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const byLang = new Map<string, typeof CASES>()
  for (const c of CASES) {
    if (!byLang.has(c.lang)) byLang.set(c.lang, [])
    byLang.get(c.lang)!.push(c)
  }

  for (const [lang, cases] of byLang) {
    const cfg = cases[0]
    const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
    const parser = new P()
    parser.setLanguage(grammar)
    const src = SOURCES[lang]
    const tree = parser.parse(src)
    const mod = await import(path.resolve(ROOT, "src/ast/" + cfg.analyzer + ".ts"))
    const Analyzer = (mod as any)[cfg.cls] ?? (mod as any).default
    const az = new Analyzer()
    const res = await az.analyze(tree.rootNode, src, cfg.file)
    console.log(`\n### ${lang} :: ${cfg.check(res)}`)
    if (lang === "java") {
      // show the raw named-children of each argument_list for the comment cases
      const walk = (n: any) => {
        if (n.type === "argument_list") {
          const kids: string[] = []
          for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i).type)
          console.log(`    arglist ${JSON.stringify(String(n.text).slice(0, 30))} namedKids=[${kids.join(", ")}]`)
        }
        for (let i = 0; i < n.childCount; i++) walk(n.child(i))
      }
      walk(tree.rootNode)
    }
  }
}

main()
