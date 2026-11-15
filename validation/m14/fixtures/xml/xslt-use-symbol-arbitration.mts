/**
 * WHY THIS EXISTS — it is a check on the CENSUS, not a new census.
 *
 * `xslt-dialect-census.mts` reports two numbers that cannot both be right:
 *
 *   useConstructSitesAnyPrefix.files            23
 *   productionParseFile…symbolNamesWithUse    485
 *
 * 485 symbols named `use-attribute-sets` cannot come from 23 files unless a single
 * file publishes ~21 of them, which nothing in the analyzer's contract suggests.
 * One of the two instruments is miscounting, and the arbitration rule matters:
 * a count this large is either a real construct with a real edge type (a GAP),
 * or a bug in the probe that produced it. This file decides which, by naming the
 * FILES and the SYMBOLS instead of only counting them.
 *
 * It is deliberately tiny and reads no corpus-wide tree: it takes the file list
 * the census found and reports, per file, how many such symbols the analyzer
 * publishes and what `kind` and `line` each carries. If the 485 is a bug, the
 * per-file counts show it; if it is real, the kinds show whether these are
 * distinct declarations or one declaration re-counted per attribute.
 *
 * ZERO REGEX, like every instrument in this lane.
 */
import { readdirSync, statSync, readFileSync } from "fs"
import * as path from "path"
import * as childProcess from "child_process"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"
const USE_LOCALS = ["use-attribute-sets", "use-package"]

function splitOnChars(text: string, delims: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (delims.includes(text[i])) {
      if (i > start) out.push(text.slice(start, i))
      start = i + 1
    }
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}
const DELIMS = " \t\n\r\f\v\"'<>="

function declaresXsltNamespace(text: string): boolean {
  for (const tok of splitOnChars(text, DELIMS)) if (tok === XSLT_NS) return true
  return false
}

function textSites(text: string): number {
  let n = 0
  for (const raw of splitOnChars(text, DELIMS)) {
    const c = raw.indexOf(":")
    if (c <= 0) continue
    if (USE_LOCALS.includes(raw.slice(c + 1))) n++
  }
  return n
}

const admitted: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; statSync(path.join(dir, ".git")) } catch { continue }
  let tracked: string[]
  try {
    tracked = childProcess.execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    if (!declaresXsltNamespace(text)) continue
    admitted.push({ repo: e, rel, abs })
  }
}

const perFile: { repo: string; rel: string; textSites: number; symSites: number; kinds: Record<string, number>; sample: any[] }[] = []
let grandSym = 0, grandText = 0
for (const f of admitted) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  const ts = textSites(text)
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo)) } catch { continue }
  const matched: any[] = []
  const kinds: Record<string, number> = {}
  for (const s of r.symbols ?? []) {
    const n = typeof s.name === "string" ? s.name.toLowerCase() : ""
    if (!n) continue
    const c = n.indexOf(":")
    const local = c >= 0 ? n.slice(c + 1) : n
    if (!USE_LOCALS.includes(local)) continue
    matched.push({ name: s.name, kind: s.kind, line: s.startLine ?? s.line, endLine: s.endLine })
    kinds[String(s.kind)] = (kinds[String(s.kind)] ?? 0) + 1
  }
  if (!ts && !matched.length) continue
  grandSym += matched.length
  grandText += ts
  perFile.push({ repo: f.repo, rel: f.rel, textSites: ts, symSites: matched.length, kinds, sample: matched.slice(0, 6) })
}

console.log(JSON.stringify({
  instrument: "xslt-use-symbol-arbitration",
  filesWithEitherSignal: perFile.length,
  grandTotalTextSites: grandText,
  grandTotalSymbolSites: grandSym,
  perFile,
}, null, 2))