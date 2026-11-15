// Convergence sweep harness: run the 7-class blind-spot probes through ANY
// analyzer. Per-language probe sources + assertions live in conv-probes/ files;
// this file does grammar/analyzer loading and verdict reporting.
// Usage: bun run script/m14/tmp/conv-harness.ts <lang> [<lang> ...]
//
// Per-language probe modules live next to this file: conv-<lang>.ts exporting
// `probes: Probe[]` where Probe = { cls, name, lines, check(res, src) }.
// `src` is the joined probe source (1-based line numbers = line index + 1).
import * as fs from "fs"
import * as path from "path"

export type Probe = {
  cls: string
  name: string
  lines: string[]
  check: (res: any, src: string, ctx: ProbeCtx) => { ok: boolean; detail: string }
}
export type ProbeCtx = { file: string; lineOf: (startIndex: number) => number }

// Probe modules for analyzers needing custom parse plumbing (vue/svelte SFC
// context) export `analyze(lines, file)` instead of relying on the default
// single-grammar path. Everything else stays the same.
type ProbeModule = { probes: Probe[]; analyze?: (lines: string[], file: string) => Promise<any> }

// The canonical 21-analyzer map, identical to differential.ts (single source of
// truth for wasm file, analyzer class, file extension).
const LANGS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string }> = {
  javascript: { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: "js" },
  typescript: { wasm: "tree-sitter-typescript.wasm", analyzerFile: "real-typescript-analyzer", className: "RealTypeScriptAnalyzer", ext: "ts" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt" },
  scala: { wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: "scala" },
  java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  groovy: { wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy" },
  vue: { wasm: "tree-sitter-vue.wasm", analyzerFile: "real-vue-analyzer", className: "RealVueAnalyzer", ext: "vue" },
  svelte: { wasm: "tree-sitter-svelte.wasm", analyzerFile: "real-svelte-analyzer", className: "RealSvelteAnalyzer", ext: "svelte" },
  cpp: { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cc" },
  c: { wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer", ext: "c" },
  rust: { wasm: "tree-sitter-rust.wasm", analyzerFile: "real-rust-analyzer", className: "RealRustAnalyzer", ext: "rs" },
  go: { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go" },
  zig: { wasm: "tree-sitter-zig.wasm", analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: "cs" },
  dart: { wasm: "tree-sitter-dart.wasm", analyzerFile: "real-dart-analyzer", className: "RealDartAnalyzer", ext: "dart" },
  swift: { wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: "swift" },
  objc: { wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m" },
  php: { wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: "php" },
  ruby: { wasm: "tree-sitter-ruby.wasm", analyzerFile: "real-ruby-analyzer", className: "RealRubyAnalyzer", ext: "rb" },
  python: { wasm: "tree-sitter-python.wasm", analyzerFile: "real-python-analyzer", className: "RealPythonAnalyzer", ext: "py" },
  haskell: { wasm: "tree-sitter-haskell.wasm", analyzerFile: "real-haskell-analyzer", className: "RealHaskellAnalyzer", ext: "hs" },
}

export { LANGS }

async function loadAnalyzer(lang: string) {
  const cfg = LANGS[lang]
  if (!cfg) throw new Error("unknown lang: " + lang)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const langObj = await L.load(fs.readFileSync("wasm/" + cfg.wasm))
  const parser = new P()
  parser.setLanguage(langObj)
  const mod = await import(path.resolve("src/ast/" + cfg.analyzerFile + ".ts"))
  const Az = mod[cfg.className] ?? mod.default?.[cfg.className] ?? mod.default
  return { az: new Az(), parser, ext: cfg.ext, className: cfg.className }
}

async function main() {
  const langs = process.argv.slice(2)
  if (!langs.length) {
    console.error("usage: conv-harness <lang> ...")
    console.error("known: " + Object.keys(LANGS).join(" "))
    process.exit(2)
  }
  // Sentinel so the default path can flag probe parse errors distinctly.
  class ParseErrorSentinel extends Error {}
  const report: any = {}
  for (const lang of langs) {
    const cfg = LANGS[lang]
    const probePath = path.resolve("script/m14/tmp/conv-" + lang + ".ts")
    if (!fs.existsSync(probePath)) {
      report[lang] = { error: "no probe module script/m14/tmp/conv-" + lang + ".ts" }
      continue
    }
    const mod: ProbeModule = await import(probePath)
    const { probes } = mod
    let runDefault: ((lines: string[], file: string) => Promise<any>) | null = null
    let analyzerName = mod.analyze ? "(module-managed)" : ""
    if (!mod.analyze) {
      const { az, parser, className } = await loadAnalyzer(lang)
      analyzerName = className
      runDefault = async (lines: string[], file: string) => {
        const source = lines.join("\n") + "\n"
        const tree = parser.parse(source)
        // A probe with a parse error produces garbage verdicts — surface it.
        if ((tree.rootNode as any).hasError) throw new ParseErrorSentinel("probe source has ERROR nodes — fix the probe, not the analyzer")
        return az.analyze(tree.rootNode, source, file)
      }
    } else {
      await loadAnalyzer(lang).catch(() => null) // keep load errors visible
    }
    const results: any[] = []
    for (const probe of probes) {
      const source = probe.lines.join("\n") + "\n"
      const file = "probe." + cfg.ext
      const lineOf = (startIndex: number) => source.slice(0, startIndex).split("\n").length
      let res: any
      try {
        res = mod.analyze ? await mod.analyze(probe.lines, file) : await runDefault!(probe.lines, file)
      } catch (e: any) {
        results.push({ cls: probe.cls, name: probe.name, verdict: e instanceof ParseErrorSentinel ? "PARSE_ERROR" : "ERROR", detail: String(e && e.message || e) })
        continue
      }
      const ctx: ProbeCtx = { file, lineOf }
      let out: { ok: boolean; detail: string }
      try {
        out = probe.check(res, source, ctx)
      } catch (e: any) {
        out = { ok: false, detail: "check threw: " + String(e && e.message || e) }
      }
      results.push({
        cls: probe.cls, name: probe.name,
        verdict: out.ok ? "PASS" : "FAIL",
        detail: out.detail,
      })
    }
    report[lang] = { analyzer: analyzerName, checks: results }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
