// script/m14/tmp/php-931-corpus-delta.ts — was php's 21 -> 50 corpus detection jump
// the marker fix working, or a false-positive wave?
//
// The R8 runtime artifact's php row moved from 21 detecting files (2026-09-22, before
// #931) to 50 (2026-09-24, after). "More detections" is not evidence of a better
// detector: the corpus half has no `expectDetected` to convict a wrong one, so a marker
// grown too wide would raise the count and read CLEAN. This prints, per detecting file,
// WHICH frameworks and WHY, so the delta is a list of named files rather than a number.
//
// Same draw as the probe: every matching file per repo, sorted, then capped at 150/repo.
// Run from the repo root: bun script/m14/tmp/php-931-corpus-delta.ts [--json]
import * as fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = ["phpunit", "slim", "phpmyadmin"]

function filesIn(repos: string[], ext: string[], cap: number): string[] {
  const out: string[] = []
  for (const repo of repos) {
    const base = path.join(CORPUS, repo)
    if (!fs.existsSync(base)) continue
    const found: string[] = []
    const stack = [base]
    while (stack.length) {
      const dir = stack.pop()!
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
          stack.push(p)
        } else if (ext.some((x) => e.name.endsWith(x))) found.push(p)
      }
    }
    found.sort()
    out.push(...found.slice(0, cap))
  }
  return out
}

/** Why this file detected what it did, from the source text — triage, not a verdict. */
function evidence(src: string): string {
  const bits: string[] = []
  if (/namespace\s+App\s*;/m.test(src)) bits.push("namespace App; (alone)")
  if (/namespace\s+App\\\\/.test(src)) bits.push("namespace App\\...")
  if (/^use Illuminate\\/m.test(src)) bits.push("use Illuminate\\")
  if (/^use Symfony\\/m.test(src)) bits.push("use Symfony\\")
  if (/^use PHPUnit\\/m.test(src)) bits.push("use PHPUnit\\")
  if (/Illuminate\\/.test(src)) bits.push("Illuminate\\ ref")
  if (/Symfony\\/.test(src)) bits.push("Symfony\\ ref")
  const base = src.match(/class\s+\w+\s+extends\s+([A-Za-z_\\][\w\\]*)/)
  if (base) bits.push(`extends ${base[1]}`)
  for (const m of src.matchAll(/use\s+([A-Za-z_\\][\w\\]*)\s*;/g)) {
    if (/TestCase$/i.test(m[1])) bits.push(`use ${m[1]}`)
  }
  return bits.join(" | ") || "(no marker text visible)"
}

async function mkParser(wasm: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const p = new P()
  p.setLanguage(language)
  return p
}

async function main() {
  const parser = await mkParser("tree-sitter-php.wasm")
  const mod: any = await import(path.join(ROOT, "src/ast/real-php-analyzer"))
  const Cls = mod.RealPhpAnalyzer
  const out: any[] = []
  let analyzed = 0
  const files = filesIn(REPOS, [".php"], 150)
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8")
    const root = parser.parse(src).rootNode
    const r = await new Cls().analyze(root, src, file)
    analyzed++
    const meta: any = r?.metadata ?? {}
    if ((meta.detectedFrameworks ?? []).length) {
      out.push({
        file: path.relative(CORPUS, file),
        frameworks: meta.detectedFrameworks,
        primary: meta.framework,
        why: evidence(src),
      })
    }
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ analyzed, detecting: out.length, files: out }, null, 1))
    return
  }
  console.log(`draw: ${analyzed} file(s), ${out.length} detecting`)
  for (const f of out) console.log(`${f.file}\n    ${JSON.stringify(f.frameworks)} primary=${JSON.stringify(f.primary)}  [${f.why}]`)
}

main()
