// M12.PHP-SYMBOL-AUDIT — are there phantom symbols?
//
// A differential proves the analyzer agrees with the oracle. It cannot prove
// either of them is right. This asks the question neither can: of every symbol
// the analyzer emits across a large sample of BOTH corpora, does any one look
// like something that was fabricated rather than declared?
//
// The php lane has a history here — phantom Laravel Eloquent
// getAttribute/setAttribute symbols and WordPress wp_add_* hook symbols were
// removed once already (see validation/m12/corpus-manifest.json). A phantom is
// invisible to precision/recall if the oracle is wrong the same way, so it needs
// its own check.
//
// Rejects, by name shape:
//   EMPTY / STARTS_WITH_DOLLAR / STARTS_WITH_DIGIT  — not declaration-shaped
//   CONTAINS_QUOTE_OR_TICK                          — source text, not a name
//   CONTAINS_ACCESSOR                               — an `->`/`::` fragment leaked
//   ABSURDLY_LONG / PLACEHOLDER_NAME                — degenerate emission
//
// Run:  bun script/m12/php-symbol-audit.ts
// Writes: validation/m12/results/php-symbol-audit.json
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
import { RealPhpAnalyzer } from "../../src/ast/real-php-analyzer"

const ROOT = process.cwd()
const CORPORA = [
  "$HOME/fixtures/repositories/phpunit",
  "$HOME/fixtures/repositories/phpmyadmin",
].filter((d) => existsSync(d))
const PER_CORPUS = Number(process.env.SAMPLE ?? 600)

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const an: any = new RealPhpAnalyzer()

const sus = new Map<string, number>()
const byKind = new Map<string, number>()
const distinct = new Set<string>()
let total = 0, files = 0
const bad = (name: unknown, why: string) => {
  const k = `${why}: ${JSON.stringify(name)}`
  sus.set(k, (sus.get(k) ?? 0) + 1)
}

for (const REPO of CORPORA) {
  const all = execSync(`git ls-files -z -- '*.php'`, { cwd: REPO, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()
  const sample = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / PER_CORPUS)) === 0).slice(0, PER_CORPUS)
  for (const f of sample) {
    const p = new P()
    p.setLanguage(grammar)
    const c = readFileSync(path.join(REPO, f), "utf8")
    let r: any
    try { r = await an.analyze(p.parse(c).rootNode, c, f) } catch { continue }
    files++
    for (const s of r.symbols ?? []) {
      total++
      byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1)
      distinct.add(`${s.kind}|${s.name}`)
      const n = String(s.name ?? "")
      if (!n) bad(s.name, "EMPTY")
      else if (n.startsWith("$")) bad(s.name, "STARTS_WITH_DOLLAR")
      else if (/^\d/.test(n)) bad(s.name, "STARTS_WITH_DIGIT")
      else if (n.includes("`") || n.includes('"') || n.includes("'")) bad(s.name, "CONTAINS_QUOTE_OR_TICK")
      else if (n.includes("->") || n.includes("::")) bad(s.name, "CONTAINS_ACCESSOR")
      else if (n.length > 200) bad(s.name, "ABSURDLY_LONG")
      else if (n === "Global" || n === "global") bad(s.name, "PLACEHOLDER_NAME")
    }
  }
}

const art = {
  schemaVersion: 1, milestone: "M12", language: "php",
  purpose: "phantom-symbol detection: can a differential prove this? NO — precision/recall only shows analyzer and oracle AGREE",
  corpora: CORPORA, perCorpusSample: PER_CORPUS, filesScanned: files,
  symbolsScanned: total, distinctKindName: distinct.size,
  byKind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])),
  suspicious: sus.size,
  suspiciousDetail: [...sus].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ kind: k.split(":")[0], sample: k.split(":").slice(1).join(":").trim(), count: v })),
  history: "php has had phantom symbols removed before (Laravel Eloquent getAttribute/setAttribute, WordPress wp_add_* hooks) — see validation/m12/corpus-manifest.json. A phantom is invisible to precision/recall when the oracle is wrong the same way, which is why this check exists separately.",
  generatedAt: new Date().toISOString(),
}
writeFileSync(path.join(ROOT, "validation/m12/results/php-symbol-audit.json"), JSON.stringify(art, null, 2) + "\n")
console.log(`php symbol audit: ${total} symbols over ${files} files | distinct kind|name ${distinct.size} | suspicious ${sus.size}`)
if (sus.size) for (const [k, v] of [...sus].slice(0, 15)) console.log(`  ${v}x ${k.slice(0, 110)}`)
