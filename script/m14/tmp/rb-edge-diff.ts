/**
 * RUBY LANE — per-file analyzer↔oracle diff (M60 deep round 2 instrument).
 *
 * The F5 differential reports lane totals; this reports the FILE. For one .rb
 * file it runs the real analyzer and the real `deriveRubyEdges` truth, prints
 * every edge on each side, and marks each as matched / MISSING / UNEXPLAINED.
 *
 * It exists because a lane total cannot be adjudicated. "61 unexplained on
 * rails" is a number; this turns it into 61 lines each naming a file, a line
 * number and the source text, and the source text is what decides which side
 * is wrong.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-edge-diff.ts <file.rb> [more files...]
 *   npx tsx script/m14/tmp/rb-edge-diff.ts --all   # every edge, matched too
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

const normTarget = (t: string): string => t.toLowerCase().trim()

async function main() {
  const { RealRubyAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts"))
  const { deriveRubyEdges } = await import(path.join(ROOT, "script", "m14", "differential.ts"))

  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang)

  const showAll = process.argv.includes("--all")
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (files.length === 0) {
    console.error("usage: rb-edge-diff.ts <file.rb>...")
    process.exit(2)
  }

  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const tree = parser.parse(content)
    const res: any = new RealRubyAnalyzer().analyze(tree.rootNode as any, content, f)

    const truth = deriveRubyEdges(tree.rootNode)
    // Map the analyzer's relationship onto the differential's wire shape
    // EXACTLY as differential.ts does (`label: r.type ?? r.relationshipType`,
    // `target: r.target ?? r.to ?? r.toSymbol`). Reading `r.label` off the raw
    // object matches nothing, so every edge reads UNEXPLAINED and the probe
    // manufactures a red — the same "which object does the gate read" mistake
    // it exists to catch, found in the instrument itself.
    const rels: any[] = (res.relationships ?? []).map((r: any) => ({
      label: String(r.type ?? r.relationshipType ?? ""),
      target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
      from: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
      line: r.line_number ?? 0,
      confidence: typeof r.confidence === "number" ? r.confidence : 1,
      raw: r,
    }))
    // differential.ts compares only the labels its per-language allowlist
    // admits. Reproduce ruby's set so the probe reports what F5 reports, and
    // report the unaudited ones separately rather than calling them red.
    const AUDITED = new Set(["extends", "implements", "instantiates", "overrides", "calls", "uses"])
    const unaudited = rels.filter((r) => !AUDITED.has(r.label))

    const lines = content.split("\n")
    console.log("=".repeat(100))
    console.log(f)
    console.log(`symbols=${res.symbols.length} rels=${rels.length} truth=${truth.length}`)

    console.log("\n--- MISSING (truth edge, analyzer emits nothing) ---")
    let miss = 0
    for (const te of truth) {
      if (rels.some((r) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) continue
      miss++
      const ln = findLine(content, te.target)
      console.log(`  ${te.label.padEnd(11)} -> ${te.target}   @${ln >= 0 ? ln : "?"}: ${ln >= 0 ? lines[ln - 1]?.trim() : ""}`)
    }
    if (!miss) console.log("  (none)")

    console.log("\n--- UNEXPLAINED (analyzer edge, no truth counterpart) ---")
    let unexp = 0
    for (const r of rels) {
      if (!AUDITED.has(r.label)) continue
      const hit = truth.some((te) => te.label === r.label &&
        (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))
      if (hit) {
        if (showAll) console.log(`  ok        ${r.label.padEnd(11)} ${r.from} -> ${r.target}  conf=${r.confidence}`)
        continue
      }
      unexp++
      const ln = typeof r.line === "number" && r.line > 0 ? r.line : findLine(content, r.target)
      console.log(
        `  conf=${String(r.confidence).padEnd(4)} ${String(r.label).padEnd(11)} ${String(r.from)} -> ${r.target}` +
        `  @${ln}: ${ln > 0 ? (lines[ln - 1] ?? "").trim() : ""}` +
        (r.raw?.metadata && Object.keys(r.raw.metadata).length ? `   md=${JSON.stringify(r.raw.metadata)}` : ""),
      )
    }
    if (!unexp) console.log("  (none)")

    // Labels differential.ts does NOT admit for ruby. They are neither
    // fabrications nor covered — they are outside the comparison. Printing
    // them under a separate head keeps "unexplained" meaning one thing.
    const byLabel = new Map<string, number>()
    for (const r of unaudited) byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + 1)
    console.log(`\n--- OUTSIDE the audited label set (not scored by F5) ---`)
    if (byLabel.size === 0) console.log("  (none)")
    for (const [l, n] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${l}   e.g. ${unaudited.find((r) => r.label === l)!.from} -> ${unaudited.find((r) => r.label === l)!.target}`)
    }

    console.log(`\n  summary: MISSING=${miss} UNEXPLAINED=${unexp} outside-audited=${unaudited.length}`)
  }
}

function findLine(content: string, target: string): number {
  if (!target) return -1
  const leaf = target.includes("::") ? target.slice(target.lastIndexOf("::") + 2) : target
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(leaf)) return i + 1
  }
  return -1
}

main()
