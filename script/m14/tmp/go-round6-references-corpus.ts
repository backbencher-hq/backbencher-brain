// go lane — ROUND 6: the CORPUS sweep for the `references` truth.
//
// The measurement half of the round-6 work: run the tree-derived truth and the
// analyzer over a whole corpus, per file, and report every row where they
// disagree. A red row here is a finding; the point of the instrument is that
// `references` is one of the labels the harness EXCLUDES from the go
// comparison, so this is the first oracle that can charge that surface at all.
//
// Run: bun script/m14/tmp/go-round6-references-corpus.ts [--repo <name>] [--files N]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoDeclaredTypeRefs } from "./go-round6-references-truth"

const arg = (n: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${n}=`))
  if (eq) return eq.slice(n.length + 1)
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const REPO = arg("--repo") ?? "/home/ishaq2321/bb_tests/repositories/go-tools"
const LIMIT = Number(arg("--files") ?? 0)

const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "vendor" || e.name === "node_modules") continue
      walk(path.join(d, e.name))
    } else if (e.isFile() && e.name.endsWith(".go")) files.push(path.join(d, e.name))
  }
}
walk(REPO)
files.sort()
const read = LIMIT > 0 ? files.slice(0, LIMIT) : files

const analyzer = new RealGoAnalyzer()
let truthTotal = 0
let analyzerTotal = 0
let matched = 0
let filesWithAFile = 0
let parseSkips = 0
const missingByClass = new Map<string, number>()
const extraByClass = new Map<string, number>()
const missingSamples: string[] = []
const extraSamples: string[] = []

// Classify a row by reading the SOURCE TEXT at the row's own line, so a red row
// is a construct name rather than a number. The classes are the shapes a Go
// type reference can take; a class with no members is a class that does not
// occur, which is information too.
const classOf = (src: string, line: number): string => {
  // A `type X = ...` on the line is a TYPE ALIAS, and an alias's declarations
  // are where GO36 lived: the analyzer's resolveSource recognised `type_spec`
  // only, so an alias's field types fell through to the `global` pseudo-source.
  // Checked FIRST, because the line-text heuristics below classify a long
  // generic alias by its brackets and reported GO36 rows as
  // "generic-instantiation" / "channel-or-func-type" — an instrument that
  // names a real corpus row with the wrong class is itself a defect, and it is
  // how a real finding gets filed as noise.
  const lines = src.split("\n")
  for (let i = Math.max(0, line - 1); i < Math.min(lines.length, line + 2); i++) {
    if (/^\s*type\s+[A-Za-z_][A-Za-z0-9_]*\s*=/.test(lines[i])) return "TYPE-ALIAS-declaration"
  }
  const text = lines[line - 1] ?? ""
  const t = text.trim()
  if (/\[[A-Za-z_*\[\]]/.test(t) && /type\s|struct\s*\{|interface\s*\{/.test(t)) return "generic-instantiation"
  if (/^(type|func)\s+[A-Za-z_][A-Za-z0-9_]*\[/.test(t)) return "generic-declaration"
  if (/\bchan\b|<-chan|func\s*\(/.test(t)) return "channel-or-func-type"
  if (/struct\s*\{|interface\s*\{/.test(t)) return "inline-type-literal"
  if (/\bstruct\s*$|\binterface\s*$/.test(text.replace(/\s+/g, " "))) return "inline-type-literal-continued"
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*:=/.test(t) || /^\s*var\s/.test(t) || /^\s*[A-Za-z_][A-Za-z0-9_]*\s*[,=]/.test(t)) return "function-local-var"
  if (/^(var|const)\s/.test(t)) return "package-var-or-const"
  if (/^\s+[A-Za-z_]/.test(t)) return "struct-field"
  if (/^func\b/.test(t)) return "func-signature"
  return "other"
}

for (const f of read) {
  const src = fs.readFileSync(f, "utf8")
  const rel = path.relative(REPO, f)
  let tree: any
  try {
    const parser = await ASTEngine.getParser("go" as any)
    tree = parser.parse(src)
  } catch {
    parseSkips++
    continue
  }
  if (!tree?.rootNode) continue
  filesWithAFile++
  const res: any = await analyzer.analyze(tree.rootNode, src, f)
  const truth = deriveGoDeclaredTypeRefs(tree.rootNode)

  const got = new Set<string>()
  const lineOf = new Map<string, number>()
  for (const r of res.relationships ?? []) {
    const rt = String((r.metadata ?? {}).relationshipType ?? "")
    if (rt !== "declared_type" && rt !== "return_type") continue
    const k = `${String(r.source ?? "")}|${String(r.target ?? "")}|${rt}`
    if (got.has(k)) continue
    got.add(k)
    if (typeof (r as any).line_number === "number") lineOf.set(k, (r as any).line_number)
  }
  analyzerTotal += got.size
  const truthKeys = new Set(truth.map((t) => `${t.from}|${t.target}|${t.rt}`))
  for (const t of truth) {
    truthTotal++
    const k = `${t.from}|${t.target}|${t.rt}`
    if (got.has(k)) { matched++; continue }
    const cls = `${t.rt}|${classOf(src, t.line)}`
    missingByClass.set(cls, (missingByClass.get(cls) ?? 0) + 1)
    if (missingSamples.length < 40) missingSamples.push(`${rel}:${t.line} ${t.from}->${t.target} ${t.rt} [${cls}]`)
  }
  for (const k of got) {
    if (truthKeys.has(k)) continue
    const [from, target, rt] = k.split("|")
    const cls = `${rt}|extra`
    extraByClass.set(cls, (extraByClass.get(cls) ?? 0) + 1)
    if (extraSamples.length < 40) extraSamples.push(`${rel}:${lineOf.get(k) ?? "?"} ${from}->${target} ${rt}`)
  }
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0)
const rows = (m: Map<string, number>) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${String(v).padStart(7)}  ${k}`).join("\n")

console.log(JSON.stringify({
  repo: REPO,
  filesListed: files.length,
  filesRead: filesWithAFile,
  parseSkips,
  truth: truthTotal,
  analyzerReferences: analyzerTotal,
  matched,
  MISSING: truthTotal - matched,
  missingPct: pct(truthTotal - matched, truthTotal),
  UNEXPLAINED: analyzerTotal - matched,
  unexplainedPct: pct(analyzerTotal - matched, analyzerTotal),
  coveragePct: pct(matched, truthTotal),
  missingByClass: rows(missingByClass) || "    (none)",
  extraByClass: rows(extraByClass) || "    (none)",
  missingSamples,
  extraSamples,
}, null, 2))
