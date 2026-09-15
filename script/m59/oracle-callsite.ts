// script/m59/oracle-callsite.ts — M59.O1
//
// THE ORACLE. Derives the expected answer from SOURCE, independently of the
// analyzer's and the tool's own code, and compares it to what they produced.
// This is the check M48's invariant demanded ("expected value derived
// independently of the tool vs the tool output") and that was skipped.
//
// Independence boundary — stated so the claim is exact:
//   * It does NOT import any analyzer, graph-engine, or store code.
//   * It calls ASTEngine.parseFile() only to READ what the analyzer emitted
//     (that is the thing under test, not the oracle).
//   * The expected value comes from the file's own text.
//   * It shares the tree-sitter *parser* with the analyzers — nothing else.
//     Consequence: tiers, not a single score.
//
// TIER A (necessary condition, all languages): for a relationship that claims
//   line L, the source line L must contain the callee's name as a token. If it
//   does not, L cannot be the call site — a definite defect. A pass is NOT
//   proof the line is the exact call node (a multi-line expression can contain
//   the name on a neighbouring line), so a pass is reported as "consistent",
//   never "correct". Tiers are never conflated.
// TIER B (exact, per language, added incrementally): exact call-node lines from
//   an independent AST query. Not yet implemented — reported as ABSENT, never
//   as a pass.
//
// MUTATION SELF-TEST: the predicate is run against a deliberately wrong line
//   (verified line + 7). If the oracle cannot fail, it is not evidence — so
//   the run prints whether the mutation was caught, and exits non-zero if not.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const OUT_DIR = path.join(ROOT, "validation/m59/results")

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", ".venv", "venv",
  "__pycache__", ".gradle", ".idea", "vendor", "third_party", "tmp", ".next", "coverage",
])

// The 21 onboarded languages (reviews/onboarding.md) → extensions to sample.
const LANGUAGES: Array<{ lang: string; ext: string[] }> = [
  { lang: "java", ext: [".java"] },
  { lang: "kotlin", ext: [".kt", ".kts"] },
  { lang: "scala", ext: [".scala"] },
  { lang: "groovy", ext: [".groovy", ".gradle"] },
  { lang: "typescript", ext: [".ts"] },
  { lang: "javascript", ext: [".js", ".mjs", ".cjs"] },
  { lang: "vue", ext: [".vue"] },
  { lang: "svelte", ext: [".svelte"] },
  { lang: "c", ext: [".c", ".h"] },
  { lang: "cpp", ext: [".cpp", ".cc", ".hpp", ".hh"] },
  { lang: "rust", ext: [".rs"] },
  { lang: "go", ext: [".go"] },
  { lang: "zig", ext: [".zig"] },
  { lang: "csharp", ext: [".cs"] },
  { lang: "dart", ext: [".dart"] },
  { lang: "swift", ext: [".swift"] },
  { lang: "objc", ext: [".m", ".mm"] },
  { lang: "php", ext: [".php"] },
  { lang: "ruby", ext: [".rb"] },
  { lang: "python", ext: [".py"] },
  { lang: "haskell", ext: [".hs"] },
]

const MAX_BYTES = 400_000

function argNum(name: string, dflt: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? Number(a.split("=")[1]) : dflt
}
function argList(name: string): string[] | null {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : null
}

function walkFiles(root: string, exts: Set<string>, cap: number): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0 && found.length < cap) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (found.length >= cap) break
      if (SKIP_DIRS.has(e)) continue
      const p = path.join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(p)
      } else if (st.size > 0 && st.size <= MAX_BYTES && exts.has(path.extname(e))) {
        found.push(p)
      }
    }
  }
  return found
}

/** The callee token a relationship names, normalised to its last identifier. */
function calleeToken(rel: any): string | null {
  const raw =
    rel?.target ?? rel?.to ?? rel?.targetExternal ?? rel?.target_external ?? rel?.metadata?.calleeExpression
  if (typeof raw !== "string" || raw.trim().length === 0) return null
  let s = raw.trim()
  s = s.split("(")[0] // drop call arguments
  s = s.split("<")[0] // drop generics
  const parts = s.split(".")
  const last = parts[parts.length - 1]
  return last && /^[\w$#:@-]+$/.test(last) ? last : null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** TIER A: does the source line at `line` contain the callee name as a token? */
function tierAConsistent(lines: string[], line: number, token: string): boolean {
  if (!Number.isFinite(line) || line < 1 || line > lines.length) return false
  const src = lines[line - 1]
  const head = token.replace(/_+$/, "")
  const variants = token === head ? [token] : [token, head]
  return variants.some((v) => new RegExp(`(^|[^\\w$])${escapeRe(v)}([^\\w$]|$)`).test(src))
}

interface FileResult {
  file: string
  language: string
  rels: number
  withLine: number
  noLine: number
  consistent: number
  inconsistent: number
  inconsistentSample: Array<{ type: string; callee: string; claimedLine: number; sourceLine: string }>
}

async function main() {
  const filesPerLang = argNum("files-per-lang", 6)
  const only = argList("only")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  mkdirSync(OUT_DIR, { recursive: true })

  const languages = only ? LANGUAGES.filter((l) => only.includes(l.lang)) : LANGUAGES
  const perLang: Record<string, FileResult[]> = {}
  const totals: Record<string, { files: number; rels: number; withLine: number; noLine: number; consistent: number; inconsistent: number }> = {}
  const skipped: Array<{ lang: string; reason: string }> = []

  for (const { lang, ext } of languages) {
    const files = walkFiles(CORPUS, new Set(ext), filesPerLang)
    if (files.length === 0) {
      skipped.push({ lang, reason: `no ${ext.join("/")} files found under ${CORPUS}` })
      continue
    }
    const results: FileResult[] = []
    for (const f of files) {
      let res: any
      try {
        const content = readFileSync(f, "utf8")
        res = await ASTEngine.parseFile(f, content)
      } catch (e: any) {
        skipped.push({ lang, reason: `${path.basename(f)}: ${e?.message}` })
        continue
      }
      const lines = readFileSync(f, "utf8").split("\n")
      const rels: any[] = res?.relationships ?? []
      const r: FileResult = {
        file: path.relative(CORPUS, f),
        language: res?.language ?? lang,
        rels: rels.length,
        withLine: 0,
        noLine: 0,
        consistent: 0,
        inconsistent: 0,
        inconsistentSample: [],
      }
      for (const rel of rels) {
        const ln = rel?.line_number
        if (typeof ln !== "number" || ln <= 0) {
          r.noLine++
          continue
        }
        r.withLine++
        const token = calleeToken(rel)
        if (!token) {
          r.inconsistent++
          if (r.inconsistentSample.length < 5) {
            r.inconsistentSample.push({ type: String(rel?.type ?? "?"), callee: "(unnamed)", claimedLine: ln, sourceLine: "" })
          }
          continue
        }
        if (tierAConsistent(lines, ln, token)) {
          r.consistent++
        } else {
          r.inconsistent++
          if (r.inconsistentSample.length < 5) {
            r.inconsistentSample.push({
              type: String(rel?.type ?? "?"),
              callee: token,
              claimedLine: ln,
              sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100),
            })
          }
        }
      }
      results.push(r)
    }
    perLang[lang] = results
    totals[lang] = results.reduce(
      (a, r) => ({
        files: a.files + 1,
        rels: a.rels + r.rels,
        withLine: a.withLine + r.withLine,
        noLine: a.noLine + r.noLine,
        consistent: a.consistent + r.consistent,
        inconsistent: a.inconsistent + r.inconsistent,
      }),
      { files: 0, rels: 0, withLine: 0, noLine: 0, consistent: 0, inconsistent: 0 },
    )
  }

  // ── MUTATION SELF-TEST: prove the Tier A predicate can fail ────────────────
  let mutation: { file: string; trueLine: number; mutatedLine: number; caught: boolean } | null = null
  for (const [lang, results] of Object.entries(perLang)) {
    for (const r of results) {
      const abs = path.join(CORPUS, r.file)
      if (!existsSync(abs)) continue
      const lines = readFileSync(abs, "utf8").split("\n")
      const res: any = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
      const rel = (res?.relationships ?? []).find((x: any) => typeof x?.line_number === "number" && x.line_number > 0 && calleeToken(x))
      if (!rel) continue
      const token = calleeToken(rel)!
      const trueLine = rel.line_number
      const mutatedLine = trueLine + 7
      const caught = !tierAConsistent(lines, mutatedLine, token)
      mutation = { file: `${lang}:${r.file}`, trueLine, mutatedLine, caught }
      break
    }
    if (mutation) break
  }

  const report = {
    probe: "M59.O1",
    at: new Date().toISOString(),
    corpus: CORPUS,
    filesPerLang,
    oracleIndependence: {
      importsAnalyzerCode: false,
      importsGraphOrStoreCode: false,
      readsEmittedRelationshipsVia: "ASTEngine.parseFile (the thing under test)",
      expectedValueSource: "the file's own text",
      sharedWithAnalyzers: "the tree-sitter parser only",
      tierA: "necessary condition — a pass means 'consistent', not 'correct'",
      tierB: "exact call-node lines via independent AST query — NOT IMPLEMENTED, reported absent",
    },
    mutation,
    totals,
    perFile: perLang,
    skipped,
  }
  const outFile = path.join(OUT_DIR, "oracle-callsite.json")
  writeFileSync(outFile, JSON.stringify(report, null, 2))

  // ── Human-readable verdict ────────────────────────────────────────────────
  console.log("\n=== M59 ORACLE — Tier A (necessary condition) ===")
  console.log("lang".padEnd(12), "files".padStart(5), "rels".padStart(7), "withLine".padStart(9), "noLine".padStart(7), "consistent".padStart(11), "INCONSISTENT".padStart(13))
  for (const [lang, t] of Object.entries(totals)) {
    console.log(
      lang.padEnd(12),
      String(t.files).padStart(5),
      String(t.rels).padStart(7),
      String(t.withLine).padStart(9),
      String(t.noLine).padStart(7),
      String(t.consistent).padStart(11),
      String(t.inconsistent).padStart(13),
    )
  }
  const T = Object.values(totals).reduce(
    (a, t) => ({
      files: a.files + t.files, rels: a.rels + t.rels, withLine: a.withLine + t.withLine,
      noLine: a.noLine + t.noLine, consistent: a.consistent + t.consistent, inconsistent: a.inconsistent + t.inconsistent,
    }),
    { files: 0, rels: 0, withLine: 0, noLine: 0, consistent: 0, inconsistent: 0 },
  )
  console.log(
    "TOTAL".padEnd(12),
    String(T.files).padStart(5), String(T.rels).padStart(7), String(T.withLine).padStart(9),
    String(T.noLine).padStart(7), String(T.consistent).padStart(11), String(T.inconsistent).padStart(13),
  )
  console.log(`\nmutation self-test: ${mutation ? JSON.stringify(mutation) : "NOT RUN (no line-bearing relationship found)"}`)
  if (skipped.length > 0) console.log(`skipped: ${skipped.length} (see evidence json)`)
  console.log(`evidence: ${path.relative(ROOT, outFile)}`)

  if (!mutation || !mutation.caught) {
    console.log("\nFAIL: the oracle did not prove it can fail — it is not evidence yet.")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
