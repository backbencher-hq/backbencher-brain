/**
 * #974 — C line-number CORRECTNESS audit.
 *
 * The census already proves every C edge CARRIES a line (`edgesWithoutLine` is 0
 * across all three corpora). That is not the same claim, and the gap between the
 * two is where a whole class of defects can hide:
 *
 *   "has a line"      every edge has some integer
 *   "has the RIGHT line"  that integer is the line the relationship is ABOUT
 *
 * A stale offset — one inserted or deleted line between the walk and the symbol
 * table, a macro definition credited to its use site, a glued/recovered node
 * credited to the enclosing declaration — all produce an edge with a
 * perfectly-present, perfectly-wrong line. Nothing in the gate suite can see it:
 * the fixtures pin a handful of lines by hand, so a systematic offset in the 99%
 * that no fixture happens to touch is invisible.
 *
 * This is the measurement for the second claim. For every relationship it asks:
 * does the SOURCE LINE the edge names actually contain the edge's target token?
 * That is not a proof — a target can legitimately be absent from its own line,
 * and the exceptions are enumerated below rather than hidden — but a rate far
 * below 100% is the signal, and the exceptions are where the real defects live.
 *
 * Run: bun run script/m14/tmp/c-audit/line-audit.ts [--repos a,b,c] [--limit N]
 * Out: validation/m12/results/c-line-audit.json
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../../..")
const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const REPOS = argOf(
  "repos",
  ["curl", "libgit2", "redis", "zig"].join(","),
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const LIMIT = Number(argOf("limit", "900"))
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const OUT = path.join(ROOT, "validation/m12/results/c-line-audit.json")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const Parser = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new Parser()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer }: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

function walkFiles(dir: string, out: string[], cap: number): void {
  if (out.length >= cap) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= cap) return
    if (e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(full, out, cap)
    else if (/\.[ch]$/.test(e.name) && fs.statSync(full).size > 1000) out.push(full)
  }
}

type Row = { type: string; onLine: number; onToken?: number; total: number }
const perType = new Map<string, Row>()
/** Sampled misses, so a systematic offset is visible rather than inferred. */
const samples: any[] = []

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) {
    console.log(`  ${repo.padEnd(10)} SKIP (no such corpus: ${dir})`)
    continue
  }
  const files: string[] = []
  walkFiles(dir, files, LIMIT)
  files.sort()
  let checked = 0
  let crashes = 0
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8")
    let result: any
    try {
      result = await new RealCAnalyzer().analyze(parser.parse(src).rootNode, src, file)
    } catch {
      crashes++
      continue
    }
    checked++
    const lines = src.split("\n")
    for (const rel of result.relationships ?? []) {
      const type = String(rel.type)
      const target = String(rel.target ?? "")
      const lineNo = rel.line_number
      const row = perType.get(type) ?? { type, onLine: 0, total: 0 }
      row.total++
      if (typeof lineNo !== "number" || lineNo < 1) {
        perType.set(type, row)
        continue
      }
      // The claim under test: the named line mentions the target token.
      //
      // TWO tests, because a loose one passing proves almost nothing about the
      // single-character targets that dominate `uses`. With `line.includes`, a
      // target of `n` matches ANY line containing the letter n, so a wholesale
      // off-by-N offset could still score 100%. The strict test requires the
      // target to appear as a WHOLE TOKEN — C identifiers are `[A-Za-z_][A-Za-z0-9_]*`
      // (plus the anonymous-member `anonymous_struct` spelling the analyzer mints),
      // so a target is on-line only if a maximal identifier run equals it. A
      // substring hit that is not a whole token is counted separately rather than
      // rounded in either direction.
      const line = lines[lineNo - 1] ?? ""
      // `imports` targets are header PATHS (`stdio.h`, `sys/types.h`), not C
      // identifiers, so the identifier tokeniser splits them at every dot/slash and
      // the whole-token test would report 0% for a relation that is entirely
      // correct. Tokenise by include-spelling instead: a path is on-line when the
      // line's own include spelling contains it as a maximal run.
      const isPathTarget = /[/\\.]/.test(target) && !/[()]/.test(target)
      let isWholeToken: boolean
      if (isPathTarget) {
        const PATHISH = /[A-Za-z0-9_.\\/-]+/g
        const runs = line.match(PATHISH)
        isWholeToken = !!runs && runs.includes(target)
      } else {
        const tokens = line.match(/[A-Za-z_$][A-Za-z0-9_$]*/g)
        isWholeToken = !!tokens && tokens.includes(target)
      }
      const ok = isWholeToken || (target.length > 0 && line.includes(target))
      if (isWholeToken) row.onToken = (row.onToken ?? 0) + 1
      if (ok) row.onLine++
      else if (samples.length < 200) {
        samples.push({
          dir: "OFF_LINE",
          repo,
          file: path.relative(dir, file),
          type,
          source: String(rel.source ?? ""),
          target,
          line_number: lineNo,
          lineText: line.trim().slice(0, 110),
        })
      }
      perType.set(type, row)
    }
  }
  const off = [...perType.values()].reduce((a, r) => a + (r.total - r.onLine), 0)
  const tot = [...perType.values()].reduce((a, r) => a + r.total, 0)
  console.log(
    `  ${repo.padEnd(10)} files=${checked} crashes=${crashes}  off-line ${off}/${tot}` +
      (tot ? ` (${((100 * (tot - off)) / tot).toFixed(2)}% on-line)` : ""),
  )
}

const rows = [...perType.values()].sort((a, b) => b.total - a.total)
console.log("\nper relationship type — does the named line contain the target token?")
for (const r of rows) {
  const loose = r.total ? (100 * r.onLine) / r.total : 0
  const strict = r.total ? (100 * (r.onToken ?? 0)) / r.total : 0
  console.log(
    `  ${r.type.padEnd(14)} ${String(r.onLine).padStart(7)}/${String(r.total).padEnd(7)} ${loose.toFixed(2).padStart(6)}%` +
      `   whole-token ${String(r.onToken ?? 0).padStart(7)} ${strict.toFixed(2).padStart(6)}%` +
      `   substring-only ${r.onLine - (r.onToken ?? 0)}`,
  )
}

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      schemaVersion: 1,
      instrument: "c-line-audit",
      // The claim is deliberately NOT "every line is right" -- macro-generated and
      // glued/recovered edges legitimately name a line that does not spell the
      // target. It is "measure the rate, and name every exception".
      claim:
        "an edge's line_number names a line that mentions the edge's target token; " +
        "exceptions are enumerated, not assumed away",
      knownLegitimateExceptions: [
        "macro-expanded edges: the target is defined in a replacement list, so the use site spells the macro's arguments instead",
        "edges from a glued or ERROR-recovered declaration: the line is the enclosing declaration's, which is the closest truthful anchor",
        "edges whose target is a scope name rather than a token (`global`, a function-local owner)",
      ],
      generatedAt: new Date().toISOString(),
      repos: REPOS,
      limit: LIMIT,
      perType: rows,
      samples,
    },
    null,
    2,
  ),
  +"\n",
)
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)