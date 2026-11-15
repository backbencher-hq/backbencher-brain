// Does an anonymous class body's FIELD/`val` member become a symbol, or only its
// methods? One probe, four JVM analyzers, so the finding is measured and not
// generalised from scala alone.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const CASES: Array<{ lang: string; file: string; src: string }> = [
  {
    lang: "java",
    file: "Aj.java",
    src: [
      "public class Aj {",
      "  int target() { return 1; }",
      "  void build() {",
      "    Runnable r = new Runnable() {",
      "      int field = target();",
      "      public void run() { target(); }",
      "    };",
      "    r.run();",
      "  }",
      "}",
    ].join("\n"),
  },
  {
    lang: "kotlin",
    file: "Ak.kt",
    src: [
      "class Ak {",
      "  fun target(): Int = 1",
      "  fun build() {",
      "    val r = object : Runnable {",
      "      val field = target()",
      "      override fun run() { target() }",
      "    }",
      "    r.run()",
      "  }",
      "}",
    ].join("\n"),
  },
  {
    lang: "groovy",
    file: "Ag.groovy",
    src: [
      "class Ag {",
      "  int target() { return 1 }",
      "  void build() {",
      "    def r = new Runnable() {",
      "      int field = target()",
      "      void run() { target() }",
      "    }",
      "    r.run()",
      "  }",
      "}",
    ].join("\n"),
  },
  {
    lang: "scala",
    file: "As.scala",
    src: [
      "class As {",
      "  def target(): Int = 1",
      "  def build(): Unit =",
      "    new Runnable {",
      "      val field = As.this.target()",
      "      def run2(): Int = As.this.target()",
      "    }",
      "}",
    ].join("\n"),
  },
]

const dir = mkdtempSync(path.join(tmpdir(), "bb-anon-syms-"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

for (const c of CASES) {
  writeFileSync(path.join(dir, c.file), c.src)
  const f = path.join(dir, c.file)
  const res: any = await ASTEngine.parseFile(f, c.src)
  const syms = (res.symbols ?? []).slice().sort((a: any, b: any) => a.range.startLine - b.range.startLine)
  console.log(`\n===== ${c.lang} (${c.file}) =====`)
  console.log("  symbols:")
  for (const s of syms)
    console.log(`     L${String(s.range.startLine).padStart(3)} ${String(s.kind).padEnd(12)} ${String(s.name).padEnd(20)} owner=${s.ownerName ?? "-"}`)
  console.log("  edges naming `target`:")
  for (const r of (res.relationships ?? []).filter((r: any) => String(r.target) === "target"))
    console.log(`     ${String(r.type).padEnd(12)} ${String(r.source).padEnd(22)} @ ${r.line_number}`)
  const fieldSym = syms.some((s: any) => s.name === "field")
  console.log(`  >>> anonymous-body FIELD member emitted as a symbol: ${fieldSym}`)
}
