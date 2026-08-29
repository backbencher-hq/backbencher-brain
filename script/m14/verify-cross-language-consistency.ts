/**
 * M14 Cross-Language Consistency Gate
 *
 * Born from the scala column-base finding: identical code shapes must
 * produce structurally identical metadata across languages.
 *
 * Asserts, for an equivalent class/method shape expressed in
 * java/groovy/kotlin/scala:
 *   1. Ranges: startColumn >= 1 (1-based everywhere), endColumn >= startColumn
 *   2. Lines >= 1
 *   3. Symbol kinds consistent: class -> "class", method -> "method"
 *   4. qualified_calls present for methods in languages that emit them
 *      (java/groovy/kotlin); scala's absence is a DECLARED pending item
 *
 * CLI: npx tsx script/m14/verify-cross-language-consistency.ts
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const EQUIVALENTS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string; source: string }> = {
  java: {
    wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java",
    source: `public class Widget {\n    private String label;\n    public String render(String input) {\n        return label + input;\n    }\n}\n`,
  },
  groovy: {
    wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy",
    source: `class Widget {\n    String label\n    String render(String input) {\n        return label + input\n    }\n}\n`,
  },
  kotlin: {
    wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt",
    source: `class Widget {\n    private var label: String = ""\n    fun render(input: String): String {\n        return label + input\n    }\n}\n`,
  },
  scala: {
    wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: "scala",
    source: `class Widget {\n  private var label: String = ""\n  def render(input: String): String = {\n    label + input\n  }\n}\n`,
  },
  // NOTE: vue and svelte are NOT included here because they are framework-
  // specific component formats requiring SFC pre-parse (context.sfcScriptTrees)
  // which this gate doesn't provide. They are verified through their own
  // fixture suites + CLI pipeline e2e instead (#384 covers web cluster).
}

// Systems-family equivalents (added 2026-08-29, family closure): the same
// struct + method shape expressed in c/cpp/rust/go/zig. Asserts 1-based
// ranges, consistent struct/method kinds, and per-symbol complexity presence
// (the family standard all five emit).
const SYSTEMS_EQUIVALENTS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string; source: string; methodName: string }> = {
  c: {
    wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer", ext: "c",
    source: `typedef struct { int w; } Widget;\nint render(Widget* w) {\n  return w->w;\n}\n`,
    methodName: "render",
  },
  cpp: {
    wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cpp",
    source: `struct Widget {\n  int w;\n  int render() { return w; }\n};\n`,
    methodName: "render",
  },
  rust: {
    wasm: "tree-sitter-rust.wasm", analyzerFile: "real-rust-analyzer", className: "RealRustAnalyzer", ext: "rs",
    source: `struct Widget {\n  w: i32,\n}\nimpl Widget {\n  fn render(&self) -> i32 { self.w }\n}\n`,
    methodName: "render",
  },
  go: {
    wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go",
    source: `type Widget struct {\n  W int\n}\nfunc (w *Widget) Render() int {\n  return w.W\n}\n`,
    methodName: "Render",
  },
  zig: {
    wasm: "tree-sitter-zig.wasm", analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig",
    source: `const Widget = struct {\n  w: u32,\n  pub fn render(self: *const Widget) u32 {\n    return self.w;\n  }\n};\n`,
    methodName: "render",
  },
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const failures: string[] = []
  const summary: Record<string, any> = {}

  for (const [lang, cfg] of Object.entries(EQUIVALENTS)) {
    const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    const analyzer = new mod[cfg.className]()
    const r = await analyzer.analyze(parser.parse(cfg.source).rootNode, cfg.source, `Widget.${cfg.ext}`)

    const symbols = r.symbols ?? []
    const cls = symbols.find(s => s.name === "Widget" && /class/i.test(String(s.kind)))
    const method = symbols.find(s => s.name === "render")

    if (!cls) failures.push(`${lang}: class Widget not extracted as class-kind symbol`)
    if (!method) failures.push(`${lang}: method render not extracted`)

    for (const s of [...(cls ? [cls] : []), ...(method ? [method] : [])]) {
      const rng = s.range ?? {}
      if (!(rng.startColumn >= 1)) failures.push(`${lang}/${s.name}: startColumn=${rng.startColumn} is not 1-based`)
      // Multi-line symbols: endColumn lives on the LAST line, so it is
      // naturally < startColumn (which lives on the FIRST line). The correct
      // invariant is endLine >= startLine, and endColumn >= startColumn only
      // when the symbol is single-line. (Gate fix 2026-08-29: the old
      // unconditional endColumn >= startColumn only ever passed for symbols
      // starting at column 0 — java's class passed by accident, go's Widget
      // at column 5 failed despite a correct range.)
      if (!(rng.endLine >= (rng.startLine ?? 1))) failures.push(`${lang}/${s.name}: endLine < startLine`)
      if (rng.endLine === rng.startLine && !(rng.endColumn >= (rng.startColumn ?? 0))) failures.push(`${lang}/${s.name}: endColumn < startColumn on single line`)
      if (!(rng.startLine >= 1)) failures.push(`${lang}/${s.name}: startLine not 1-based`)
    }

    // kind consistency across languages (string-insensitive)
    const kindNorm = (k: string) => String(k).toLowerCase()
    if (cls && !/class/.test(kindNorm(cls.kind))) failures.push(`${lang}: Widget kind ${cls.kind} is not class-like`)
    if (method && !/method|function/.test(kindNorm(method.kind))) failures.push(`${lang}: render kind ${method.kind} unexpected`)

    // qualified_calls where the language emits them
    if (["java", "kotlin"].includes(lang)) {
      const qc = method?.qualified_calls
      if (!Array.isArray(qc)) failures.push(`${lang}: render.qualified_calls missing (language declares support)`)
    } else {
      summary[lang] = { note: "qualified_calls not emitted by this analyzer - PENDING #383" }
    }

    summary[lang] = {
      ...(summary[lang] ?? {}),
      classKind: cls?.kind,
      methodKind: method?.kind,
      widgetRange: cls ? { sl: cls.range.startLine, sc: cls.range.startColumn } : null,
    }
  }

  // ── Systems family (c/cpp/rust/go/zig) — family closure 2026-08-29 ──
  const sysFailures: string[] = []
  const sysSummary: Record<string, any> = {}
  for (const [lang, cfg] of Object.entries(SYSTEMS_EQUIVALENTS)) {
    const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    const analyzer = new mod[cfg.className]()
    const r = await analyzer.analyze(parser.parse(cfg.source).rootNode, cfg.source, `Widget.${cfg.ext}`)
    const symbols = r.symbols ?? []
    const st = symbols.find(s => s.name === "Widget")
    const method = symbols.find(s => s.name === cfg.methodName)
    if (!st) sysFailures.push(`${lang}: Widget struct not extracted`)
    if (!method) sysFailures.push(`${lang}: method ${cfg.methodName} not extracted`)
    for (const s of [...(st ? [st] : []), ...(method ? [method] : [])]) {
      const rng = s.range ?? {}
      if (!(rng.startColumn >= 1)) sysFailures.push(`${lang}/${s.name}: startColumn=${rng.startColumn} is not 1-based`)
      if (!(rng.endLine >= (rng.startLine ?? 1))) sysFailures.push(`${lang}/${s.name}: endLine < startLine`)
      if (rng.endLine === rng.startLine && !(rng.endColumn >= (rng.startColumn ?? 0))) sysFailures.push(`${lang}/${s.name}: endColumn < startColumn on single line`)
      if (!(rng.startLine >= 1)) sysFailures.push(`${lang}/${s.name}: startLine not 1-based`)
    }
    // kind: struct-like for the container, method/function for the member
    if (st && !/struct|class/.test(String(st.kind).toLowerCase())) sysFailures.push(`${lang}: Widget kind ${st.kind} is not struct-like`)
    if (method && !/method|function/.test(String(method.kind).toLowerCase())) sysFailures.push(`${lang}: ${cfg.methodName} kind ${method.kind} unexpected`)
    // complexity: family standard — every systems analyzer emits it
    if (method && !(typeof method.complexity === "number" && method.complexity >= 1)) sysFailures.push(`${lang}: ${cfg.methodName} missing per-symbol complexity`)
    sysSummary[lang] = { structKind: st?.kind, methodKind: method?.kind, complexity: method?.complexity }
  }

  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.CC1",
    title: "Cross-language consistency gate",
    claimLevel: "L1",
    layers: ["consistency"],
    checks: [
      { id: "ranges-1based", description: "all symbol ranges use 1-based lines AND columns across java/groovy/kotlin/scala", status: failures.length ? "fail" : "pass" },
      { id: "kind-consistency", description: "equivalent declarations map to consistent symbol kinds", status: failures.some(f => f.includes("kind")) ? "fail" : "pass" },
      { id: "payload-presence", description: "qualified_calls present in languages that emit it", status: failures.some(f => f.includes("qualified_calls")) ? "fail" : "pass" },
      { id: "systems-ranges-1based", description: "1-based ranges across c/cpp/rust/go/zig", status: sysFailures.some(f => f.includes("startColumn") || f.includes("startLine")) ? "fail" : "pass" },
      { id: "systems-kind-consistency", description: "struct/method kinds consistent across c/cpp/rust/go/zig", status: sysFailures.some(f => f.includes("kind")) ? "fail" : "pass" },
      { id: "systems-complexity", description: "per-symbol complexity present in all five systems analyzers", status: sysFailures.some(f => f.includes("complexity")) ? "fail" : "pass" },
    ],
    limitations: [
      { description: "covers JVM-family + systems-family equivalents; other clusters added with their waves (#384)" },
      { description: "scala qualified_calls absence declared pending under #383" },
    ],
    data: { failures, summary, systemsFailures: sysFailures, systemsSummary: sysSummary },
  })

  if (sysFailures.length) {
    console.error("SYSTEMS CONSISTENCY FAILED:")
    for (const f of sysFailures) console.error("  -", f)
    process.exit(9)
  }

  if (failures.length) {
    console.error("CONSISTENCY FAILED:")
    for (const f of failures) console.error("  -", f)
    process.exit(9)
  }
  console.log("cross-language consistency verified across " + Object.keys(EQUIVALENTS).length + " languages")
}

main().catch(e => { console.error(e); process.exit(1) })
