// The R10 census reports php's `references` class carrying `'` and `/` now.
// Its sample list did not capture one, so this finds them at the real sites
// instead of guessing: php analyzer over the php corpora, printing every
// `references` target whose text contains an apostrophe or a slash.
import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

const SKIP_DIR = new Set(["node_modules", ".git", "build", "out", "target", "vendor", ".gradle", "generated"])
function walk(dir: string, out: string[] = [], cap = 60000): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= cap) return out
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue
      walk(p, out, cap)
    } else if (e.isFile() && e.name.endsWith(".php")) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-php.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealPhpAnalyzer()

  const roots = ["/home/ishaq2321/bb_tests/repositories/phpunit", "/home/ishaq2321/bb_tests/repositories/phpmyadmin"]
  const files: string[] = []
  for (const r of roots) files.push(...walk(r))
  const stride = Math.max(1, Math.floor(files.length / 300))
  const picked: string[] = []
  for (let i = 0; i < files.length && picked.length < 300; i += stride) picked.push(files[i])

  const hits: { type: string; target: string; file: string; line: number }[] = []
  let refs = 0
  for (const file of picked) {
    let source: string
    try {
      source = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    let res: any
    try {
      res = az.analyze(parser.parse(source).rootNode, source, file)
    } catch {
      continue
    }
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.label ?? "")
      if (t !== "references") continue
      refs++
      const target = String(r.target ?? "")
      if (target.indexOf("'") >= 0 || target.indexOf("/") >= 0 || target.indexOf(".") >= 0) {
        hits.push({ type: t, target, file, line: r.line_number ?? 0 })
      }
    }
  }
  process.stdout.write(`files: ${picked.length} of ${files.length}; references edges: ${refs}; hits: ${hits.length}\n`)
  const byShape = new Map<string, number>()
  for (const h of hits) {
    const k = h.target.indexOf("'") >= 0 ? "apostrophe" : h.target.indexOf("/") >= 0 ? "slash" : "dot-only"
    byShape.set(k, (byShape.get(k) ?? 0) + 1)
  }
  process.stdout.write(`by shape: ${JSON.stringify(Object.fromEntries(byShape))}\n`)
  const shown = new Set<string>()
  for (const h of hits) {
    if (shown.has(h.target)) continue
    shown.add(h.target)
    if (shown.size > 25) break
    process.stdout.write(`  ${JSON.stringify(h.target)}  @ ${h.file.replace(/^.*repositories\//, "")}:${h.line}\n`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
