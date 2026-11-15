// Review instrument (NOT a gate): reduce a REAL failing corpus file to the
// smallest construct the pinned grammar cannot parse.
//
//   bun script/m14/tmp/css-reduce.ts <file> [--out <path>]
//
// Why this exists. `css-parse-classes.ts` attributes a failure to a class by
// matching the FIRST ERROR node's source line against a signature list. For the
// grails-core `ie-progid-filter` class that attribution is REFUTED by its own
// minimal reproduction: `.a { filter: progid:DXImageTransform...; }` parses
// CLEAN. So either the repro is too simple or the line is the recovery point
// rather than the cause — and a class attribution that survives no reduction is
// a false claim, not a finding.
//
// The W21 method: the biggest signature in a histogram is often the RECOVERY
// POINT, not the cause. So slice the actual ERROR node, then reduce the
// enclosing block construct by construct, and report the reduction ladder.

import { Parser, Language } from "web-tree-sitter"
import { readFileSync, writeFileSync } from "fs"

await Parser.init()
const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))

const argv = process.argv.slice(2)
const FILE = argv[0]
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
if (!FILE) { console.error("usage: css-reduce.ts <file.css> [--out <path>]"); process.exit(1) }

const p = new Parser()
p.setLanguage(lang)

function errs(src: string): { count: number; first: string; firstLine: string } {
  const t = p.parse(src)
  const lines = src.split("\n")
  let count = 0
  let first = ""
  let firstLine = ""
  const w = (x: any): boolean => {
    if (x.type === "ERROR") {
      count++
      if (!first) { first = JSON.stringify(x.text.slice(0, 120)); firstLine = (lines[x.startPosition.row] ?? "").trim() }
      return count >= 1 ? true : false
    }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c && w(c)) return true }
    return false
  }
  w(t.rootNode)
  const has = t.rootNode.hasError
  t.delete?.()
  return { count: has ? Math.max(1, count) : 0, first, firstLine }
}

const text = readFileSync(FILE, "utf8")
const base = errs(text)

// The rule block that contains the first error, then progressively smaller cuts.
const rules = text.split(/\n\s*\n/)
const ladder: { step: string; errors: number; text: string }[] = [{ step: "whole file", errors: base.count, text: text.slice(0, 120) + (text.length > 120 ? "…" : "") }]

// 1. the block that contains the first error line
const lines = text.split("\n")
let firstErrRow = -1
{
  const t = p.parse(text)
  const w = (x: any): boolean => {
    if (x.type === "ERROR") { firstErrRow = x.startPosition.row; return true }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c && w(c)) return true }
    return false
  }
  w(t.rootNode)
  t.delete?.()
}

// walk out to the enclosing brace-balanced block
if (firstErrRow >= 0) {
  let depth = 0
  let start = firstErrRow
  for (let i = firstErrRow; i >= 0; i--) {
    for (const ch of lines[i]) { if (ch === "}") depth++; else if (ch === "{") depth-- }
    if (depth <= 0) { start = i; break }
    start = i
  }
  depth = 0
  let end = firstErrRow
  for (let i = firstErrRow; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === "{") depth++; else if (ch === "}") depth-- }
    end = i
    if (depth <= 0) break
  }
  const block = lines.slice(start, end + 1).join("\n")
  ladder.push({ step: `enclosing block (lines ${start + 1}-${end + 1})`, errors: errs(block).count, text: block.slice(0, 400) })

  // 2. each declaration in that block, alone
  const decls = block.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("/*") && !l.startsWith("*"))
  for (const d of decls) {
    const wrapped = `X { ${d} }\n`
    const e = errs(wrapped).count
    if (e > 0) ladder.push({ step: `declaration alone: ${d.slice(0, 70)}`, errors: e, text: wrapped })
  }

  // 3. the value alone, and the value with the progid wrapper removed
  const m = block.match(/(filter\s*:\s*)([^;]+)/)
  if (m) {
    const decl = `X { ${m[0]}; }\n`
    ladder.push({ step: "the progid declaration alone", errors: errs(decl).count, text: decl })
    const stripped = m[2].replace(/progid:[^,)]*/gi, "").replace(/^\s*\(\s*/, "").replace(/\)\s*$/, "").trim()
    const alt = `X { ${m[1]}${stripped}; }\n`
    ladder.push({ step: `same declaration, progid:… wrapper REMOVED`, errors: errs(alt).count, text: alt })
  }
}

const artifact = {
  instrument: "css-reduce",
  purpose: "Reduce a real failing corpus file to the smallest construct the pinned grammar cannot parse. An attribution that survives no reduction is a false claim.",
  file: FILE,
  fileErrors: base.count,
  firstErrorNodeText: base.first,
  firstErrorLine: base.firstLine,
  ladder,
  verdict: ladder.filter((l) => l.errors === 0 && l.step.startsWith("same declaration")).length > 0
    ? "REFUTED: the class signature is the RECOVERY POINT, not the cause — removing the signature text makes the construct parse."
    : "CONFIRMED: the signature text is load-bearing for the failure.",
}
const out = JSON.stringify(artifact, null, 2)
if (OUT && OUT !== "undefined") { writeFileSync(OUT, out + "\n"); console.error(`wrote ${OUT}`) }
console.log(out)
p.delete?.()
