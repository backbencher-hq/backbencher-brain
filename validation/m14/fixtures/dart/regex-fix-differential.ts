/**
 * REGEX-FIX DIFFERENTIAL — is the char-wise predicate EXACTLY the regex it replaced?
 *
 * ## Why this exists
 *
 * The fleet's no-regex rule is absolute, and `real-dart-analyzer.ts` carried 8 regex literals
 * (the largest single share of the gate's 12). They were replaced with `isPlainIdentifier`,
 * `stripNullableSuffix` and the already-present `isCapitalized`. A replacement that is
 * *nearly* the same is worse than the regex: it is a silent behaviour change wearing the
 * clothes of a cleanup. Reading the char classes and agreeing with yourself is not evidence.
 *
 * So this probe runs BOTH revisions over the same files and compares the FULL output — every
 * symbol (kind, owner, name, line) and every relationship (type, source, target, line,
 * metadata) — canonicalised and sorted. Files whose output differs are named with the first
 * difference.
 *
 * The comparison revision is extracted from git at run time (`git show <rev>:src/ast/…`), its
 * two relative imports rewritten, imported from a temp file beside this probe and deleted
 * afterwards — so no second copy of a 4,700-line analyzer is ever committed.
 *
 * ## Run
 *
 *   npx tsx validation/m14/fixtures/dart/regex-fix-differential.ts            (rev = HEAD)
 *   BB_DART_DIFF_REV=ab6dab8e9 BB_DART_DIFF_N=200 npx tsx …
 *   BB_DART_DIFF_REV=ab6dab8e9 BB_DART_DIFF_N=3000 …      (a wider draw)
 *
 * `BB_DART_DIFF_N` is a stride draw of the dart-sdk population, deterministic and sorted.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const CORPUS = process.env.BB_DART_CORPUS || "/home/ishaq2321/bb_tests/repositories/dart-sdk"
const REV = process.env.BB_DART_DIFF_REV || "HEAD"
const N = Number(process.env.BB_DART_DIFF_N || 200)

function discover(dir: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git|\.dart_tool/.test(e.name)) walk(p, depth + 1) }
      else if (e.name.endsWith(".dart")) out.push(p)
    }
  }
  walk(dir, 0)
  out.sort()
  const stride = Math.max(1, Math.floor(out.length / want))
  return out.filter((_, i) => i % stride === 0).slice(0, want)
}

// ── extract the comparison revision, with its relative imports rewritten for its temp home
const tmpPath = join(HERE, `.diff-rev-${REV.replace(/[^A-Za-z0-9]/g, "_")}.ts`)
const src = execFileSync("git", ["show", `${REV}:src/ast/real-dart-analyzer.ts`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const rewritten = src
  .replace('from "./engine"', 'from "../../../../src/ast/engine"')
  .replace('from "./types"', 'from "../../../../src/ast/types"')
if (rewritten === src) throw new Error("import rewrite did not apply — refusing to compare the wrong module")
writeFileSync(tmpPath, rewritten)
const revMod: any = await import(pathToFileURL(tmpPath).href)
unlinkSync(tmpPath)
const RevCls: any = Object.values(revMod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))

const { getParser } = await import(join(REPO, "src/ast/engine.ts"))
const workMod: any = await import(join(REPO, "src/ast/real-dart-analyzer.ts"))
const WorkCls: any = Object.values(workMod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))
if (!RevCls || !WorkCls) throw new Error(`analyzer class not found in ${REV} or working tree`)

/** Order-insensitive, whitespace-free canonical form of an analysis result. */
function canon(res: any): string {
  const syms = (res.symbols || []).map((s: any) => `${s.kind}|${s.ownerName ?? ""}|${s.name}|${s.range?.startLine ?? ""}`).sort()
  const rels = (res.relationships || []).map((r: any) =>
    `${r.type ?? r.relationshipType}|${r.source}|${r.target}|${r.line_number ?? ""}|${JSON.stringify(r.metadata ?? {}, Object.keys(r.metadata ?? {}).sort())}`).sort()
  return JSON.stringify({ syms, rels })
}

const files = discover(CORPUS, N)
const parser = await getParser("dart")
let same = 0, diff = 0, failed = 0
const diffs: string[] = []
for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failed++; continue }
  try {
    const a: any = await parser.parse(content, f)
    const revOut = canon(new RevCls().analyze(a.rootNode, content, f))
    const b: any = await parser.parse(content, f)
    const workOut = canon(new WorkCls().analyze(b.rootNode, content, f))
    if (revOut === workOut) { same++; continue }
    diff++
    if (diffs.length < 5) {
      const ra = JSON.parse(revOut), rb = JSON.parse(workOut)
      const d: string[] = []
      for (const k of ["syms", "rels"] as const) {
        const A = new Set(ra[k]), B = new Set(rb[k])
        const onlyRev = [...A].filter((x: string) => !B.has(x)).slice(0, 3)
        const onlyWork = [...B].filter((x: string) => !A.has(x)).slice(0, 3)
        if (onlyRev.length || onlyWork.length) d.push(`${k}: -[${onlyRev.join(" ; ")}] +[${onlyWork.join(" ; ")}]`)
      }
      diffs.push(`${f.slice(CORPUS.length + 1)}: ${d.join(" | ")}`)
    }
  } catch (e) { failed++; if (failed < 4) console.log(`parse/analyze failure ${f}: ${String(e).slice(0, 120)}`) }
}

console.log(`comparison revision: ${REV}`)
console.log(`population: ${files.length} .dart files (stride draw of ${CORPUS})`)
console.log(`IDENTICAL ${same}   DIFFERENT ${diff}   FAILED ${failed}`)
for (const d of diffs) console.log(`  ${d}`)
console.log(diff === 0 && failed === 0
  ? `VERDICT: the two revisions are output-identical on all ${same} files`
  : `VERDICT: NOT equivalent — ${diff} file(s) differ, ${failed} failed`)
