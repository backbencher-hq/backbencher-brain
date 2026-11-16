/**
 * Corpus-census blind-spot localizer.
 *
 * `verify-corpus-census.ts` says WHICH node types the spec never ruled. It does
 * not say where they occur or what shape they are, which is exactly what a
 * ruling needs: a type reachable inside a construct the analyzer already walks
 * is a different decision from one that appears where symbols are extracted.
 *
 * This probe repeats the census's own file selection (same DFS, same limit,
 * same skip list) so the occurrences it prints are the occurrences the gate
 * counted, then prints for each unclassified type: how many files contain it,
 * and one sample per file with the ancestor chain and the node's text.
 *
 *   npx tsx script/m14/tmp/corpus-blindspot-probe.ts <lang> [--files N] [--samples N]
 */
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SPEC_DIR = path.join(ROOT, "script", "m14", "spec")
const WASM_DIR = path.join(ROOT, "wasm")
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"

const GATED: Record<string, { wasm: string; ext: string[]; repo: string }> = {
  java: { wasm: "tree-sitter-java.wasm", ext: [".java"], repo: "grails-core" },
  groovy: { wasm: "tree-sitter-groovy.wasm", ext: [".groovy"], repo: "grails-core" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", ext: [".kt"], repo: "Exposed" },
  scala: { wasm: "tree-sitter-scala.wasm", ext: [".scala"], repo: "scala3" },
  typescript: { wasm: "tree-sitter-typescript.wasm", ext: [".ts"], repo: "vue-core" },
  javascript: { wasm: "tree-sitter-javascript.wasm", ext: [".js"], repo: "grails-core" },
  vue: { wasm: "tree-sitter-vue.wasm", ext: [".vue"], repo: "element-plus" },
  svelte: { wasm: "tree-sitter-svelte.wasm", ext: [".svelte"], repo: "svelte" },
  c: { wasm: "tree-sitter-c.wasm", ext: [".c", ".h"], repo: "sqlite" },
  cpp: { wasm: "tree-sitter-cpp.wasm", ext: [".cc", ".cpp", ".h", ".hpp"], repo: "fmt" },
  rust: { wasm: "tree-sitter-rust.wasm", ext: [".rs"], repo: "ripgrep" },
  go: { wasm: "tree-sitter-go.wasm", ext: [".go"], repo: "go-tools" },
  zig: { wasm: "tree-sitter-zig.wasm", ext: [".zig"], repo: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", ext: [".cs"], repo: "powershell" },
  dart: { wasm: "tree-sitter-dart.wasm", ext: [".dart"], repo: "proxicall" },
  swift: { wasm: "tree-sitter-swift.wasm", ext: [".swift"], repo: "swift-nio" },
  objc: { wasm: "tree-sitter-objc.wasm", ext: [".m", ".h"], repo: "sdwebimage" },
  php: { wasm: "tree-sitter-php.wasm", ext: [".php"], repo: "phpunit" },
  ruby: { wasm: "tree-sitter-ruby.wasm", ext: [".rb"], repo: "rake" },
  python: { wasm: "tree-sitter-python.wasm", ext: [".py"], repo: "cython" },
  haskell: { wasm: "tree-sitter-haskell.wasm", ext: [".hs"], repo: "cabal" },
  erlang: { wasm: "tree-sitter-erlang.wasm", ext: [".erl"], repo: "rebar3" },
  elixir: { wasm: "tree-sitter-elixir.wasm", ext: [".ex", ".exs"], repo: "elixir" },
  clojure: { wasm: "tree-sitter-clojure.wasm", ext: [".clj", ".cljc", ".cljs"], repo: "clojure" },
}

const lang = process.argv[2]
const filesLimit = process.argv.includes("--files") ? parseInt(process.argv[process.argv.indexOf("--files") + 1]) : 60
const samples = process.argv.includes("--samples") ? parseInt(process.argv[process.argv.indexOf("--samples") + 1]) : 3
const cfg = GATED[lang]
if (!cfg) {
  console.error(`unknown language: ${lang} (known: ${Object.keys(GATED).join(", ")})`)
  process.exit(2)
}

// Same selection as the census gate: DFS, LIFO pop, same skips.
function collectFiles(repoPath: string, exts: string[], limit: number): string[] {
  const out: string[] = []
  const stack = [repoPath]
  while (stack.length > 0 && out.length < limit) {
    const d = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "obj" || e.name === "bin") continue
        stack.push(p)
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(p)
        if (out.length >= limit) break
      }
    }
  }
  return out
}

function classifiedTypes(spec: any): Set<string> {
  const classified = new Set<string>()
  for (const t of spec.handled_verified?.types ?? []) classified.add(t)
  for (const t of spec.internal_silent?.types ?? []) classified.add(t)
  for (const t of spec.gap?.types ?? []) classified.add(t)
  for (const t of spec.design_decision?.types ?? []) classified.add(t)
  for (const d of spec.design_decision?.decisions ?? []) {
    for (const t of String(d.node_type ?? "").split(",")) {
      const tt = t.trim()
      if (tt) classified.add(tt)
    }
  }
  for (const g of spec.gap?.gaps ?? []) {
    for (const t of String(g.node_type ?? "").split(",")) {
      const tt = t.trim()
      if (tt) classified.add(tt)
    }
  }
  return classified
}

async function main() {
  const specPath = path.join(SPEC_DIR, `${lang}-completeness.json`)
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"))
  const classified = classifiedTypes(spec)
  const repoPath = path.join(CORPUS_ROOT, cfg.repo)
  const files = collectFiles(repoPath, cfg.ext, filesLimit)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
  const parser = new P()
  parser.setLanguage(langWasm)

  const hits: Record<string, { files: string[]; occurrences: number; samples: any[] }> = {}
  const occurring = new Set<string>()
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    if (src.length > 800_000) continue
    const tree = parser.parse(src)
    const walk = [tree.rootNode]
    while (walk.length > 0) {
      const n = walk.pop()!
      if (n.type && !n.type.startsWith("_")) occurring.add(n.type)
      if (n.type && !n.type.startsWith("_") && !classified.has(n.type) && n.type !== "ERROR") {
        const h = (hits[n.type] ??= { files: [], occurrences: 0, samples: [] })
        h.occurrences++
        const rel = path.relative(repoPath, f)
        if (!h.files.includes(rel)) h.files.push(rel)
        if (h.samples.length < samples * Math.max(1, h.files.length)) {
          const chain: string[] = []
          for (let a: any = n.parent; a; a = a.parent) chain.push(a.type)
          h.samples.push({
            file: rel,
            line: n.startPosition.row + 1,
            ancestors: chain.slice(0, 6).join(" < "),
            children: Array.from({ length: n.namedChildCount }, (_, i) => n.namedChild(i)?.type).join(", "),
            text: String(n.text).slice(0, 160).replace(/\s+/g, " "),
          })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk.push(c)
      }
    }
  }

  const out = {
    language: lang,
    repo: cfg.repo,
    repoHead: (() => {
      try {
        return require("child_process").execSync("git rev-parse HEAD", { cwd: repoPath }).toString().trim()
      } catch {
        return "(not a git checkout?)"
      }
    })(),
    filesScanned: files.length,
    occurringTypes: occurring.size,
    unclassified: Object.fromEntries(
      Object.entries(hits)
        .sort((a, b) => b[1].occurrences - a[1].occurrences)
        .map(([t, h]) => [t, { occurrences: h.occurrences, files: h.files, samples: h.samples }]),
    ),
  }
  console.log(JSON.stringify(out, null, 1))
}

main()
