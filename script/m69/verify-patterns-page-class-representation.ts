// script/m69/verify-patterns-page-class-representation.ts
// M69.P1 — a pattern class the caller asked for must not vanish because the page
// filled up with another class.
//
// THE DEFECT. Found by running script/m13/verify-patterns-e2e-corpus.ts, which had
// never executed outside one developer's machine (it hard-coded a corpus path).
// The moment it ran for real, against rebar3/apps:
//
//   request: { scope: "all", includeFramework: true, confidenceThreshold: 0.51,
//              includeOrphaned: true, includeAntiPatterns: true, maxResults: 200 }
//   framework types in the index : Erlang, cowboy, eunit, otp, rebar3  (5)
//   framework findings returned  : 0
//
// Not filtered by the threshold — a framework finding carries a fixed 0.6 and the
// threshold was 0.51. Never rendered at all. The page ranks by confidence
// descending, an orphan candidate carries up to 0.7, and rebar3/apps has more
// than 200 orphan candidates above 0.6, so every framework and anti-pattern
// finding was pushed off the end of the page.
//
// graphql-js emitted 4 and cabal emitted 2 from the same code path. Only the
// corpus with a deep orphan census lost its frameworks, which is why no unit
// fixture caught it: a small fixture never fills a page.
//
// WHY IT MATTERS. A caller that passed `includeFramework: true` and received none
// cannot tell "no framework here" from "the page was full". The census line does
// report the total, but the caller asked for a CLASS and got none of it — which is
// exactly the ambiguity that makes an agent raise `limit` when it should accept
// the answer, or accept the answer when it should raise `limit`.
//
// THE CONTRACT ASSERTED HERE: for every class the caller requested, if findings
// exist then at least one appears on the page — even when the page is full of a
// higher-ranked class. One slot per requested class, not a quota: a repository
// with 900 god classes still returns one, and the caller still gets its
// frameworks.
//
// It also asserts the fix did not become a quota, because the obvious wrong fix
// is to reserve N slots per class, which would silently change what `limit` means.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { PatternBrainTools } from "../../src/ast/tools"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ORPHAN = "orphaned_"
const FRAMEWORK = "framework-detected"
const ANTIPATTERN = ["high-complexity-function", "long-parameter-list", "god-class"]

const root = mkdtempSync(path.join(tmpdir(), "bb-m69-page-"))
mkdirSync(path.join(root, "src"), { recursive: true })
const projectId = getProjectId(root)

try {
  // A project with MANY orphan candidates, each scoring above a framework
  // finding's fixed 0.6, plus one god class and one framework — the shape that
  // made rebar3/apps return nothing.
  const files: string[] = []
  for (let i = 0; i < 60; i++) {
    const name = `mod${i}.ts`
    files.push(name)
    writeFileSync(path.join(root, "src", name),
      `export function unreferenced${i}(): number {\n  return ${i}\n}\n` +
      `export function caller${i}(): number {\n  return ${i}\n}\n` +
      `export class Wide${i} {\n` +
      Array.from({ length: 12 }, (_, k) => `  f${k}(): number { return ${k} }`).join("\n") +
      `\n}\n`)
  }
  await indexProjectParallel(projectId, root, {})

  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare("UPDATE brain_file SET framework_type = 'react' WHERE project_id = ? AND relative_path LIKE 'src/mod1%'").run(projectId)

  // Establish the precondition, or the rest of the gate proves nothing.
  const wide = await PatternBrainTools.detectPatterns(projectId as any, {
    includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0, maxResults: 1000,
  })
  const orphanCount = wide.patterns.filter((p: any) => String(p.type).startsWith(ORPHAN)).length
  check("P1 the fixture produces MANY orphan candidates, so a small page can fill",
    orphanCount >= 30, `${orphanCount} orphan candidates`)
  check("P1b it also produces framework and anti-pattern findings to be displaced",
    wide.patterns.some((p: any) => p.type === FRAMEWORK) && wide.patterns.some((p: any) => ANTIPATTERN.includes(p.type)),
    `types: ${[...new Set(wide.patterns.map((p: any) => p.type))].join(", ")}`)

  // The page is deliberately tiny — smaller than the orphan count.
  const page = await PatternBrainTools.detectPatterns(projectId as any, {
    includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0, maxResults: 5,
  })
  const types = page.patterns.map((p: any) => String(p.type))
  check("P2 the page honours maxResults", page.patterns.length <= 5, `${page.patterns.length}`)
  check("P2b a requested class that HAS findings is represented on a full page",
    types.includes(FRAMEWORK), `page types: ${types.join(", ")}`)
  check("P2c and so is a requested anti-pattern class",
    types.some((t) => ANTIPATTERN.includes(t)), `page types: ${types.join(", ")}`)
  check("P2d orphans are still represented — the promotion did not evict them",
    types.some((t) => t.startsWith(ORPHAN)), `page types: ${types.join(", ")}`)

  // --- and the fix did not become a quota -------------------------------
  check("P3 the page is NOT padded to one of every class beyond the budget",
    page.patterns.length <= 5, `${page.patterns.length} for maxResults 5`)
  const bigger = await PatternBrainTools.detectPatterns(projectId as any, {
    includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0, maxResults: 40,
  })
  const biggerTypes = bigger.patterns.map((p: any) => String(p.type))
  check("P3b a larger page is still ranked by confidence, with the promoted class last",
    (() => {
      const idx = biggerTypes.lastIndexOf(FRAMEWORK)
      if (idx < 0) return false
      for (let i = idx + 1; i < biggerTypes.length; i++) {
        const a = bigger.patterns[idx].confidence, b = bigger.patterns[i].confidence
        if (b > a) return false
      }
      return true
    })(),
    `framework at index ${biggerTypes.lastIndexOf(FRAMEWORK)} of ${biggerTypes.length}: ${biggerTypes.join(",")}`)

  // --- the census must still describe the whole, not the promoted page -----
  check("P4 the census is unchanged by promotion: totalFound exceeds the page",
    bigger.statistics.totalFound >= bigger.patterns.length,
    `totalFound=${bigger.statistics.totalFound} page=${bigger.patterns.length}`)
  const byTypeSum = Object.values(bigger.statistics.byType).reduce((a: any, b: any) => a + b, 0) as number
  check("P4b byType still sums to the census", byTypeSum === bigger.statistics.totalFound,
    `byType=${byTypeSum} totalFound=${bigger.statistics.totalFound}`)

  // --- a class the caller did NOT request stays off the page --------------
  {
    const noFw = await PatternBrainTools.detectPatterns(projectId as any, {
      includeOrphaned: true, includeFramework: false, includeAntiPatterns: true, confidenceThreshold: 0, maxResults: 5,
    })
    check("P5 a class switched OFF is not promoted in",
      !noFw.patterns.some((p: any) => p.type === FRAMEWORK),
      `page: ${noFw.patterns.map((p: any) => p.type).join(", ")}`)
  }
  // --- and a class with NO findings is not invented ------------------------
  {
    // No framework_type is set on this project at all now, so a framework
    // finding cannot exist and must not be represented.
    raw.prepare("UPDATE brain_file SET framework_type = NULL WHERE project_id = ?").run(projectId)
    const none = await PatternBrainTools.detectPatterns(projectId as any, {
      includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0, maxResults: 5,
    })
    check("P6 a requested class with NO findings is not represented either",
      !none.patterns.some((p: any) => p.type === FRAMEWORK),
      `page: ${none.patterns.map((p: any) => p.type).join(", ")}`)
    check("P6b and the page is still full of what does exist",
      none.patterns.length === 5, `${none.patterns.length}`)
  }
} catch (error) {
  check("M69.P1 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

console.log(`\nM69.P1: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)