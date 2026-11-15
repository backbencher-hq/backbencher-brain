/**
 * READ-ONLY PROBE — dump the real emission for every bash fixture, so each
 * expectation file is transcribed from a run rather than from theory.
 *
 * This is the M14 fixture rule made mechanical: "the expectation is derived
 * from the real emission after a probe, never from theory". The FORBID entries
 * are written by hand against the PRE-FIX shape; the expect entries come from
 * here.
 *
 * Writes nothing.
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealBashAnalyzer } from "../../../src/ast/real-bash-analyzer"

const ROOT = process.cwd()
const DIR = path.join(ROOT, "validation/m14/fixtures/bash")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-bash.wasm"))))
void ASTEngine

const only = process.argv[2]
const files = readdirSync(DIR).filter((f) => f.endsWith(".sh")).sort().filter((f) => !only || f.includes(only))

for (const file of files) {
  const text = readFileSync(path.join(DIR, file), "utf8")
  const tree = parser.parse(text)
  const r: any = new RealBashAnalyzer().analyze(tree.rootNode as any, text, `fixtures/bash/${file}`)
  console.log(`\n${"=".repeat(78)}\n== ${file}`)
  text.split("\n").forEach((l, i) => console.log(`${String(i + 1).padStart(3)} | ${l}`))
  console.log(`-- SYMBOLS (${r.symbols.length})`)
  for (const s of r.symbols as any[]) {
    const meta = Object.entries(s.metadata ?? {})
      .filter(([k]) => k !== "bashSpecific")
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ")
    console.log(
      `   ${String(s.kind).padEnd(9)} ${s.name.padEnd(24)} @${String(s.range?.startLine).padStart(3)}` +
        `${s.ownerName ? ` owner=${s.ownerName}` : " owner=NONE"}` +
        `${s.parameters?.length ? ` params=[${s.parameters.map((p: any) => p.name).join(",")}]` : ""}` +
        `${meta ? `  ${meta}` : ""}`,
    )
  }
  console.log(`-- RELATIONSHIPS (${r.relationships.length})  [every row must carry a line]`)
  for (const x of r.relationships as any[]) {
    const meta = Object.entries(x.metadata ?? {})
      .filter(([k]) => k !== "bashSpecific")
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ")
    console.log(
      `   ${String(x.type).padEnd(11)} ${String(x.source).padEnd(22)} -> ${String(x.target).padEnd(26)}` +
        ` @${x.line_number === undefined ? "NO-LINE" : x.line_number}${meta ? `  ${meta}` : ""}`,
    )
  }
  console.log(`-- IMPORTS (${(r.imports ?? []).length})`)
  for (const im of r.imports as any[]) console.log(`   ${JSON.stringify(im.module)}  ${JSON.stringify(im.metadata ?? {})}`)
  console.log(`-- EXPORTS (${(r.exports ?? []).length}): ${(r.exports ?? []).map((e: any) => e.name).join(", ")}`)
  const noLine = (r.relationships as any[]).filter((x) => typeof x.line_number !== "number" || x.line_number < 1)
  if (noLine.length) console.log(`!! ${noLine.length} relationship(s) with NO line`)
  const names = new Set((r.symbols as any[]).map((s) => s.name))
  const badSrc = (r.relationships as any[]).filter((x) => !names.has(x.source))
  if (badSrc.length) console.log(`!! ${badSrc.length} edge(s) whose SOURCE is not a symbol: ${[...new Set(badSrc.map((x) => x.source))].join(", ")}`)
  tree.delete?.()
}
