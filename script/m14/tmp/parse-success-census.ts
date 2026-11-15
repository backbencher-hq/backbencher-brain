// Corpus parse-success census (#742 CONV-G-1, proposed step 1).
//
// WHY THIS EXISTS: F5 parity compares analyzer against oracle, and BOTH walk the
// same partial tree. A grammar that fails on half a corpus produces perfectly
// equal sides — parity measures agreement, not coverage — so this blind spot is
// invisible to every gate the project already has. This probe measures how much
// of a corpus the PINNED grammar can actually parse.
//
// ERROR vs MISSING are reported separately because they are different defects:
// ERROR is a construct the grammar cannot represent, MISSING is a token the
// grammar demanded and did not find (groovy's characteristic failure).
//
// Usage: bun run script/m14/tmp/parse-success-census.ts <lang>|all [--limit N] [--repo NAME]
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"

// wasm / extensions / PRIMARY corpus, mirroring the sweep's routing in
// script/m14/differential.ts (LANG_REPOS + LANGS).
const LANGS: Record<string, { wasm: string; exts: string[]; repo: string }> = {
  java: { wasm: "tree-sitter-java.wasm", exts: ["java"], repo: "grails-core" },
  groovy: { wasm: "tree-sitter-groovy.wasm", exts: ["groovy"], repo: "grails-core" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", exts: ["kt"], repo: "Exposed" },
  scala: { wasm: "tree-sitter-scala.wasm", exts: ["scala"], repo: "scala3" },
  typescript: { wasm: "tree-sitter-typescript.wasm", exts: ["ts"], repo: "vue-core" },
  javascript: { wasm: "tree-sitter-javascript.wasm", exts: ["js"], repo: "grails-core" },
  vue: { wasm: "tree-sitter-vue.wasm", exts: ["vue"], repo: "element-plus" },
  svelte: { wasm: "tree-sitter-svelte.wasm", exts: ["svelte"], repo: "svelte" },
  c: { wasm: "tree-sitter-c.wasm", exts: ["c"], repo: "sqlite" },
  // cpp's real corpus surface is .cc/.h AND .cpp/.hpp — the sweep's own
  // `ext: "cc,h"` convention under-counts it (nlohmann-json is mostly .hpp).
  cpp: { wasm: "tree-sitter-cpp.wasm", exts: ["cc", "h", "cpp", "hpp"], repo: "fmt" },
  rust: { wasm: "tree-sitter-rust.wasm", exts: ["rs"], repo: "ripgrep" },
  go: { wasm: "tree-sitter-go.wasm", exts: ["go"], repo: "go-tools" },
  zig: { wasm: "tree-sitter-zig.wasm", exts: ["zig"], repo: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", exts: ["cs"], repo: "powershell" },
  dart: { wasm: "tree-sitter-dart.wasm", exts: ["dart"], repo: "proxicall" },
  swift: { wasm: "tree-sitter-swift.wasm", exts: ["swift"], repo: "swift-nio" },
  objc: { wasm: "tree-sitter-objc.wasm", exts: ["m"], repo: "sdwebimage" },
  php: { wasm: "tree-sitter-php.wasm", exts: ["php"], repo: "phpunit" },
  ruby: { wasm: "tree-sitter-ruby.wasm", exts: ["rb"], repo: "rake" },
  python: { wasm: "tree-sitter-python.wasm", exts: ["py"], repo: "cython" },
  haskell: { wasm: "tree-sitter-haskell.wasm", exts: ["hs"], repo: "cabal" },
}

function walk(dir: string, exts: string[], out: string[], limit: number): void {
  if (out.length >= limit) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= limit) return
    if (e.name === "node_modules" || e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, exts, out, limit)
    else if (e.isFile() && exts.some((x) => e.name.endsWith("." + x))) out.push(full)
  }
}

type Census = { files: number; errFiles: number; missFiles: number; either: number; empty: number; capped: boolean }

function census(root: any, src: string): { err: boolean; miss: boolean } {
  const st = { err: false, miss: false }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "ERROR") st.err = true
    if (n.isMissing) st.miss = true
    if (st.err && st.miss) break
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return st
}

async function measure(P: any, cfg: { exts: string[]; repo: string }, limit: number): Promise<Census> {
  const repoDir = path.join(CORPUS_ROOT, cfg.repo)
  const files: string[] = []
  walk(repoDir, cfg.exts, files, limit)
  const out: Census = { files: 0, errFiles: 0, missFiles: 0, either: 0, empty: 0, capped: files.length >= limit }
  for (const f of files) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    let root: any
    try {
      root = P.parse(src).rootNode
    } catch {
      out.files++
      out.errFiles++
      out.either++
      continue
    }
    if (!root || root.childCount === 0) out.empty++
    const st = census(root, src)
    out.files++
    if (st.err) out.errFiles++
    if (st.miss) out.missFiles++
    if (st.err || st.miss) out.either++
  }
  return out
}

async function main() {
  const arg = process.argv[2]
  const langs = arg === "all" ? Object.keys(LANGS) : [arg]
  if (!LANGS[langs[0]]) {
    console.error("usage: <lang>|all [" + Object.keys(LANGS).join("|") + "] [--limit N] [--repo NAME]")
    process.exit(2)
  }
  const limit = process.argv.includes("--limit")
    ? parseInt(process.argv[process.argv.indexOf("--limit") + 1])
    : 100000
  const repoOverride = process.argv.includes("--repo")
    ? process.argv[process.argv.indexOf("--repo") + 1]
    : null

  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  const rows: { lang: string; c: Census; repo: string }[] = []
  for (const lang of langs) {
    const cfg = LANGS[lang]
    const repo = repoOverride ?? cfg.repo
    let grammar: any
    try {
      grammar = await Language.load(fs.readFileSync(ROOT + "/wasm/" + cfg.wasm))
    } catch (e) {
      console.log(`${lang.padEnd(11)} wasm load FAILED (${cfg.wasm})`)
      continue
    }
    const P = new Parser()
    P.setLanguage(grammar)
    const c = await measure(P, { exts: cfg.exts, repo }, limit)
    rows.push({ lang, c, repo })
    const pct = (n: number) => (c.files ? ((100 * n) / c.files).toFixed(1) : "n/a")
    console.log(
      `${lang.padEnd(11)} ${repo.padEnd(18)} files=${String(c.files).padStart(5)}` +
        ` either=${String(c.either).padStart(5)} (${pct(c.either)}%)` +
        ` ERROR=${String(c.errFiles).padStart(5)} (${pct(c.errFiles)}%)` +
        ` MISSING=${String(c.missFiles).padStart(5)} (${pct(c.missFiles)}%)` +
        ` empty=${c.empty}${c.capped ? " CAPPED" : ""}`,
    )
  }
  const worst = [...rows].sort((a, b) => (b.c.either / b.c.files) - (a.c.either / a.c.files)).slice(0, 5)
  console.log("\nworst five by parse-failure rate:")
  for (const w of worst) {
    console.log(`  ${w.lang} (${w.repo}): ${((100 * w.c.either) / w.c.files).toFixed(1)}% of ${w.c.files} files`)
  }
}

main()
