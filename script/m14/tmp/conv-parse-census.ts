// Corpus parse-success census (the gate #742 showed was missing).
//
// F5 differential parity compares analyzer vs oracle over the SAME tree — a
// grammar that drops content drops it from BOTH sides and parity stays perfect.
// This census measures grammar coverage directly: ERROR-node rate per language
// over its F5 corpus.
//
// Usage: bun run script/m14/tmp/conv-parse-census.ts [<lang> ...]
// Output: JSON to stdout + human table to stderr.
import * as fs from "fs"

const CORPORA: Record<string, { repo: string; ext: string; wasm: string }> = {
  javascript: { repo: "lodash", ext: ".js", wasm: "tree-sitter-javascript.wasm" },
  typescript: { repo: "element-plus", ext: ".ts", wasm: "tree-sitter-typescript.wasm" },
  kotlin: { repo: "kotlinx-coroutines", ext: ".kt", wasm: "tree-sitter-kotlin.wasm" },
  scala: { repo: "cats-effect", ext: ".scala", wasm: "tree-sitter-scala.wasm" },
  java: { repo: "clojure", ext: ".java", wasm: "tree-sitter-java.wasm" },
  groovy: { repo: "grails-core", ext: ".groovy", wasm: "tree-sitter-groovy.wasm" },
  vue: { repo: "element-plus", ext: ".vue", wasm: "tree-sitter-vue.wasm" },
  svelte: { repo: "shadcn-svelte", ext: ".svelte", wasm: "tree-sitter-svelte.wasm" },
  cpp: { repo: "nlohmann-json", ext: ".hpp", wasm: "tree-sitter-cpp.wasm" },
  c: { repo: "jq", ext: ".c", wasm: "tree-sitter-c.wasm" },
  rust: { repo: "cargo", ext: ".rs", wasm: "tree-sitter-rust.wasm" },
  go: { repo: "terraform", ext: ".go", wasm: "tree-sitter-go.wasm" },
  zig: { repo: "zig", ext: ".zig", wasm: "tree-sitter-zig.wasm" },
  csharp: { repo: "fsharp", ext: ".cs", wasm: "tree-sitter-c_sharp.wasm" },
  dart: { repo: "dart-http", ext: ".dart", wasm: "tree-sitter-dart.wasm" },
  swift: { repo: "alamofire", ext: ".swift", wasm: "tree-sitter-swift.wasm" },
  objc: { repo: "afnetworking", ext: ".m", wasm: "tree-sitter-objc.wasm" },
  php: { repo: "phpmyadmin", ext: ".php", wasm: "tree-sitter-php.wasm" },
  ruby: { repo: "rack", ext: ".rb", wasm: "tree-sitter-ruby.wasm" },
  python: { repo: "requests", ext: ".py", wasm: "tree-sitter-python.wasm" },
  haskell: { repo: "hledger", ext: ".hs", wasm: "tree-sitter-haskell.wasm" },
}

const ROOT = "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = 400 // deterministic sample cap; full-corpus when fewer

async function main() {
  const only = process.argv.slice(2)
  const langs = only.length ? only : Object.keys(CORPORA)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  const results: Record<string, any> = {}
  for (const lang of langs) {
    const cfg = CORPORA[lang]
    if (!cfg) { results[lang] = { error: "unknown lang" }; continue }
    const repoDir = ROOT + "/" + cfg.repo
    if (!fs.existsSync(repoDir)) { results[lang] = { error: "corpus missing: " + repoDir }; continue }
    const langObj = await L.load(fs.readFileSync("wasm/" + cfg.wasm))
    const parser = new P()
    parser.setLanguage(langObj)
    const files: string[] = []
    const collect = (dir: string): void => {
      if (files.length >= MAX_FILES) return
      let entries: fs.Dirent[] = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (files.length >= MAX_FILES) return
        const p = dir + "/" + e.name
        if (e.isDirectory()) collect(p)
        else if (e.name.endsWith(cfg.ext) || (lang === "cpp" && e.name.endsWith(".cc")) || (lang === "cpp" && e.name.endsWith(".h"))) {
          files.push(p)
        }
      }
    }
    collect(repoDir)
    let err = 0, parsed = 0
    for (const f of files) {
      try {
        const src = fs.readFileSync(f, "utf8")
        const tree = parser.parse(src)
        parsed++
        if ((tree.rootNode as any).hasError) err++
      } catch { /* unreadable file — skip */ }
    }
    const rate = parsed ? +(100 * err / parsed).toFixed(1) : null
    results[lang] = { corpus: cfg.repo, sampled: parsed, withErrors: err, errorRatePct: rate, wasm: cfg.wasm }
    process.stderr.write(`${lang.padEnd(12)} ${String(parsed).padStart(5)} files  ${String(err).padStart(5)} with errors  ${rate}%\n`)
  }
  process.stdout.write(JSON.stringify(results, null, 2) + "\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
