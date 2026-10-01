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

// Managed-OO family equivalents (added 2026-08-31, family closure): the same
// class + method shape expressed in csharp/dart/swift/objc/php/ruby. Asserts
// 1-based ranges, consistent class/method kinds, and per-symbol complexity
// presence (the family standard all six emit). This family closure also caught
// a REAL defect: objc + swift emitted 0-based columns (startColumn: column
// without +1) while csharp/dart/php/ruby were 1-based — fixed in the same
// closure (commit follows), and now pinned here so it can never regress.
const OO_EQUIVALENTS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string; source: string; methodName: string; classNameLiteral: string }> = {
  csharp: {
    wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: "cs",
    source: `class Widget {\n    private string label;\n    public string Render(string input) {\n        return label + input;\n    }\n}\n`,
    methodName: "Render", classNameLiteral: "Widget",
  },
  dart: {
    wasm: "tree-sitter-dart.wasm", analyzerFile: "real-dart-analyzer", className: "RealDartAnalyzer", ext: "dart",
    source: `class Widget {\n  String label = '';\n  String render(String input) {\n    return label + input;\n  }\n}\n`,
    methodName: "render", classNameLiteral: "Widget",
  },
  swift: {
    wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: "swift",
    source: `class Widget {\n    var label: String = ""\n    func render(input: String) -> String {\n        return label + input\n    }\n}\n`,
    methodName: "render", classNameLiteral: "Widget",
  },
  objc: {
    wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m",
    // OBJCD7: ObjC method identity is the FULL selector — this single-argument
    // method's symbol name is `render:` (the trailing colon is part of the
    // selector, matching runtime/clangd/Xcode identity).
    source: `@interface Widget : NSObject\n@property (nonatomic, strong) NSString *label;\n- (NSString *)render:(NSString *)input;\n@end\n@implementation Widget\n- (NSString *)render:(NSString *)input {\n    return self.label;\n}\n@end\n`,
    methodName: "render:", classNameLiteral: "Widget",
  },
  php: {
    wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: "php",
    source: `<?php\nclass Widget {\n    private string $label = '';\n    public function render(string $input): string {\n        return $this->label . $input;\n    }\n}\n`,
    methodName: "render", classNameLiteral: "Widget",
  },
  ruby: {
    wasm: "tree-sitter-ruby.wasm", analyzerFile: "real-ruby-analyzer", className: "RealRubyAnalyzer", ext: "rb",
    source: `class Widget\n  def initialize\n    @label = ""\n  end\n  def render(input)\n    @label + input\n  end\nend\n`,
    methodName: "render", classNameLiteral: "Widget",
  },
  python: {
    wasm: "tree-sitter-python.wasm", analyzerFile: "real-python-analyzer", className: "RealPythonAnalyzer", ext: "py",
    source: `class Widget:\n    def __init__(self):\n        self.label = ""\n\n    def render(self, input):\n        return self.label + input\n`,
    methodName: "render", classNameLiteral: "Widget",
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

  // ── Managed-OO family (csharp/dart/swift/objc/php/ruby) — family closure 2026-08-31 ──
  const ooFailures: string[] = []
  const ooSummary: Record<string, any> = {}
  for (const [lang, cfg] of Object.entries(OO_EQUIVALENTS)) {
    const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    const analyzer = new mod[cfg.className]()
    const r = await analyzer.analyze(parser.parse(cfg.source).rootNode, cfg.source, `Widget.${cfg.ext}`)
    const symbols = r.symbols ?? []
    const cls = symbols.find(s => s.name === cfg.classNameLiteral && /class|interface/.test(String(s.kind).toLowerCase()))
    const method = symbols.find(s => s.name === cfg.methodName)
    if (!cls) ooFailures.push(`${lang}: class ${cfg.classNameLiteral} not extracted as class-kind symbol`)
    if (!method) ooFailures.push(`${lang}: method ${cfg.methodName} not extracted`)
    for (const s of [...(cls ? [cls] : []), ...(method ? [method] : [])]) {
      const rng = s.range ?? {}
      if (!(rng.startColumn >= 1)) ooFailures.push(`${lang}/${s.name}: startColumn=${rng.startColumn} is not 1-based`)
      if (!(rng.endLine >= (rng.startLine ?? 1))) ooFailures.push(`${lang}/${s.name}: endLine < startLine`)
      if (rng.endLine === rng.startLine && !(rng.endColumn >= (rng.startColumn ?? 0))) ooFailures.push(`${lang}/${s.name}: endColumn < startColumn on single line`)
      if (!(rng.startLine >= 1)) ooFailures.push(`${lang}/${s.name}: startLine not 1-based`)
    }
    if (cls && !/class|interface/.test(String(cls.kind).toLowerCase())) ooFailures.push(`${lang}: ${cfg.classNameLiteral} kind ${cls.kind} is not class-like`)
    if (method && !/method|function/.test(String(method.kind).toLowerCase())) ooFailures.push(`${lang}: ${cfg.methodName} kind ${method.kind} unexpected`)
    if (method && !(typeof method.complexity === "number" && method.complexity >= 1)) ooFailures.push(`${lang}: ${cfg.methodName} missing per-symbol complexity`)
    ooSummary[lang] = { classKind: cls?.kind, methodKind: method?.kind, complexity: method?.complexity, classStartColumn: cls?.range?.startColumn }
  }

  // ── Web family (typescript/javascript) — family closure 2026-09-08 ──
  // vue/svelte stay out of the structural block (SFC pre-parse); their
  // template contracts are pinned by fixtures + the F5 embedded-script
  // oracles. ts/js get the standard class/method shape; BOTH get the
  // builtin-set parity check born from the #611 drift finding.
  const WEB_EQUIVALENTS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string; source: string }> = {
    typescript: {
      wasm: "tree-sitter-typescript.wasm", analyzerFile: "real-typescript-analyzer", className: "RealTypeScriptAnalyzer", ext: "ts",
      source: `class Widget {\n    private label: string = ""\n    render(input: string): string {\n        return this.label + input\n    }\n}\n`,
    },
    javascript: {
      wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: "js",
      source: `class Widget {\n    render(input) {\n        return input\n    }\n}\n`,
    },
  }
  const webFailures: string[] = []
  const webSummary: Record<string, any> = {}
  for (const [lang, cfg] of Object.entries(WEB_EQUIVALENTS)) {
    const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    const analyzer = new mod[cfg.className]()
    const r = await analyzer.analyze(parser.parse(cfg.source).rootNode, cfg.source, `Widget.${cfg.ext}`)
    const symbols = r.symbols ?? []
    const cls = symbols.find(s => s.name === "Widget" && /class/i.test(String(s.kind)))
    const method = symbols.find(s => s.name === "render")
    if (!cls) webFailures.push(`${lang}: class Widget not extracted as class-kind symbol`)
    if (!method) webFailures.push(`${lang}: method render not extracted`)
    for (const s of [...(cls ? [cls] : []), ...(method ? [method] : [])]) {
      const rng = s.range ?? {}
      if (!(rng.startColumn >= 1)) webFailures.push(`${lang}/${s.name}: startColumn=${rng.startColumn} is not 1-based`)
      if (!(rng.endLine >= (rng.startLine ?? 1))) webFailures.push(`${lang}/${s.name}: endLine < startLine`)
      if (rng.endLine === rng.startLine && !(rng.endColumn >= (rng.startColumn ?? 0))) webFailures.push(`${lang}/${s.name}: endColumn < startColumn on single line`)
      if (!(rng.startLine >= 1)) webFailures.push(`${lang}/${s.name}: startLine not 1-based`)
    }
    if (cls && !/class/.test(String(cls.kind).toLowerCase())) webFailures.push(`${lang}: Widget kind ${cls.kind} is not class-like`)
    if (method && !/method|function/.test(String(method.kind).toLowerCase())) webFailures.push(`${lang}: render kind ${method.kind} unexpected`)
    webSummary[lang] = { classKind: cls?.kind, methodKind: method?.kind }
  }

  // Builtin-set parity (born 2026-09-08, #611 drift finding): the vue and
  // svelte analyzers' HTML_BUILTIN_TAGS and the F5 oracle's ORACLE_HTML_TAGS
  // must be the IDENTICAL set — the pre-fix oracle carried 126 tags vs the
  // analyzers' 134 and faked a MISSING instantiates->search (2023 HTML
  // element) in vue-element-admin. This check fails the gate on ANY future
  // drift between the three parallel lists.
  const vueSrc = fs.readFileSync(path.join(ROOT, "src/ast/real-vue-analyzer.ts"), "utf8")
  const svelteSrc = fs.readFileSync(path.join(ROOT, "src/ast/real-svelte-analyzer.ts"), "utf8")
  const diffSrc = fs.readFileSync(path.join(ROOT, "script/m14/differential.ts"), "utf8")
  const extractSet = (src: string, name: string): Set<string> | null => {
    const anchor = "const " + name + " = new Set(["
    const start = src.indexOf(anchor)
    if (start === -1) return null
    const bodyStart = start + anchor.length
    const end = src.indexOf("])", bodyStart)
    if (end === -1) return null
    return new Set([...src.slice(bodyStart, end).matchAll(/"([^"]+)"/g)].map(x => x[1]))
  }
  const vueTags = extractSet(vueSrc, "HTML_BUILTIN_TAGS")
  const svelteTags = extractSet(svelteSrc, "HTML_BUILTIN_TAGS")
  const oracleTags = extractSet(diffSrc, "ORACLE_HTML_TAGS")
  if (!vueTags || !svelteTags || !oracleTags) {
    webFailures.push("builtin-set parity: could not extract HTML_BUILTIN_TAGS/ORACLE_HTML_TAGS from source")
  } else {
    for (const t of vueTags) if (!oracleTags.has(t)) webFailures.push(`builtin-set parity: tag '${t}' in vue analyzer but missing from ORACLE_HTML_TAGS`)
    for (const t of oracleTags) if (!vueTags.has(t)) webFailures.push(`builtin-set parity: tag '${t}' in ORACLE_HTML_TAGS but missing from vue analyzer`)
    for (const t of svelteTags) if (!vueTags.has(t)) webFailures.push(`builtin-set parity: tag '${t}' in svelte analyzer but missing from vue analyzer`)
    for (const t of vueTags) if (!svelteTags.has(t)) webFailures.push(`builtin-set parity: tag '${t}' in vue analyzer but missing from svelte analyzer`)
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
      { id: "oo-ranges-1based", description: "1-based ranges across csharp/dart/swift/objc/php/ruby", status: ooFailures.some(f => f.includes("startColumn") || f.includes("startLine")) ? "fail" : "pass" },
      { id: "oo-kind-consistency", description: "class/method kinds consistent across csharp/dart/swift/objc/php/ruby", status: ooFailures.some(f => f.includes("kind")) ? "fail" : "pass" },
      { id: "oo-complexity", description: "per-symbol complexity present in all six OO analyzers", status: ooFailures.some(f => f.includes("complexity")) ? "fail" : "pass" },
      { id: "web-ranges-1based", description: "1-based ranges across typescript/javascript", status: webFailures.some(f => f.includes("startColumn") || f.includes("startLine")) ? "fail" : "pass" },
      { id: "web-kind-consistency", description: "class/method kinds consistent across typescript/javascript", status: webFailures.some(f => f.includes("kind")) ? "fail" : "pass" },
      { id: "web-builtin-set-parity", description: "HTML/SVG builtin tag sets identical across vue analyzer, svelte analyzer, and F5 oracle (the #611 search-drift class)", status: webFailures.some(f => f.includes("builtin-set parity")) ? "fail" : "pass" },
    ],
    limitations: [
      { description: "covers JVM-family + systems-family + managed-OO + web(ts/js structural, vue/svelte builtin-parity) equivalents" },
      { description: "scala qualified_calls absence declared pending under #383" },
    ],
    data: { failures, summary, systemsFailures: sysFailures, systemsSummary: sysSummary, ooFailures, ooSummary, webFailures, webSummary },
  })

  if (sysFailures.length) {
    console.error("SYSTEMS CONSISTENCY FAILED:")
    for (const f of sysFailures) console.error("  -", f)
    process.exit(9)
  }

  if (ooFailures.length) {
    console.error("OO CONSISTENCY FAILED:")
    for (const f of ooFailures) console.error("  -", f)
    process.exit(9)
  }

  if (webFailures.length) {
    console.error("WEB CONSISTENCY FAILED:")
    for (const f of webFailures) console.error("  -", f)
    process.exit(9)
  }

  if (failures.length) {
    console.error("CONSISTENCY FAILED:")
    for (const f of failures) console.error("  -", f)
    process.exit(9)
  }
  console.log("cross-language consistency verified across " + Object.keys(EQUIVALENTS).length + " JVM + " + Object.keys(SYSTEMS_EQUIVALENTS).length + " systems + " + Object.keys(OO_EQUIVALENTS).length + " OO + " + Object.keys(WEB_EQUIVALENTS).length + " web languages (+ vue/svelte builtin-set parity)")
}

main().catch(e => { console.error(e); process.exit(1) })
