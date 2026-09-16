// script/m59/probe-web-line-coverage.ts — M59.A7 (#825), web family lane.
//
// WHY THIS EXISTS. The M59 oracle answers "of the relationships this language
// emits, how many carry a line, and do those lines pass the source check?" — a
// language-level score. It cannot answer "WHICH EDGE KINDS are still silent",
// which is the only question that tells you what work remains. This probe
// re-reads the same sampled files the oracle scored and tallies the
// line-bearing split by relationship type, so the remaining work is a list and
// not a percentage.
//
// It reads the analyzer (ASTEngine.parseFile) as the thing under test, exactly
// as the oracle does, and derives nothing itself.
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SCOPED = path.join(ROOT, "validation/m59/results/oracle-callsite-scoped.json")
const CORPUS = "$HOME/fixtures/repositories"

const lang = process.argv.find((a) => a.startsWith("--lang="))?.split("=")[1] ?? "typescript"

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const oracle = JSON.parse(readFileSync(SCOPED, "utf8"))
  const files: string[] = (oracle.perFile?.[lang] ?? []).map((r: any) => r.file)
  if (files.length === 0) {
    console.log(`no sampled ${lang} files in ${path.relative(ROOT, SCOPED)} — run the scoped oracle first`)
    return
  }

  const withLine: Record<string, number> = {}
  const noLine: Record<string, number> = {}
  // The oracle's third state, reproduced here so "unverifiable" can be audited
  // per edge kind (the oracle reports the count; the lane needs the reason).
  const notCheckable: Record<string, number> = {}
  const SYNTH = /^(constructor|anonymous_object|anonymous_[\w$]+|given_\d+|component\d+)$/
  const UNKNOWN = new Set(["?", "<unknown>", "<anonymous>", ""])
  let parsed = 0
  let failed = 0
  for (const rel of files) {
    const abs = path.join(CORPUS, rel)
    if (!existsSync(abs)) { failed++; continue }
    let res: any
    try {
      res = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
      parsed++
    } catch {
      failed++
      continue
    }
    for (const r of res?.relationships ?? []) {
      const t = String(r.type ?? "?")
      const has = typeof r.line_number === "number" && r.line_number > 0
      if (has) withLine[t] = (withLine[t] ?? 0) + 1
      else noLine[t] = (noLine[t] ?? 0) + 1
      // Why a line-bearing claim cannot be verified (mirrors isCheckable).
      if (has) {
        const target = (r.target ?? r.to ?? r.targetExternal ?? "") as unknown
        let s = String(target).trim().split("(")[0].split("<")[0]
        if (t === "imports" && s.includes(":")) {
          const segs = s.split(":")
          const item = segs[segs.length - 1]
          s = item && item !== "*" ? item : (segs[0].split("/").pop() ?? segs[0])
        }
        const parts = s.split(".")
        let tok: string | null = parts[parts.length - 1].replace(/^[`"\[]+/, "").replace(/[`"\]]+$/, "")
        if (!tok || !/^[\w$#:@-]+$/.test(tok)) tok = null
        const bad =
          !tok || SYNTH.test(tok) ||
          (typeof target === "string" && (UNKNOWN.has(target) || /[{}\n;]/.test(target)))
        if (bad) notCheckable[t] = (notCheckable[t] ?? 0) + 1
      }
    }
  }

  const kinds = [...new Set([...Object.keys(withLine), ...Object.keys(noLine)])].sort()
  console.log(`unverifiable claims by reason: ${JSON.stringify(notCheckable)}\n`)
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length))
  console.log(`M59.A7 line coverage by edge kind — ${lang} (${parsed} files parsed, ${failed} unavailable)`)
  console.log(`${pad("type", 18)} ${pad("withLine", 9)} ${pad("noLine", 7)} %lined`)
  let tw = 0, tn = 0
  for (const k of kinds) {
    const w = withLine[k] ?? 0, n = noLine[k] ?? 0
    tw += w; tn += n
    console.log(`${pad(k, 18)} ${pad(String(w), 9)} ${pad(String(n), 7)} ${((w / (w + n)) * 100).toFixed(0)}%`)
  }
  console.log(`${pad("TOTAL", 18)} ${pad(String(tw), 9)} ${pad(String(tn), 7)} ${((tw / (tw + tn)) * 100).toFixed(0)}%`)
}

main()
