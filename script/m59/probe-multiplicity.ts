// script/m59/probe-multiplicity.ts — M59.P2 (#822)
//
// The question #822 cannot be answered from memory: when one function calls the
// same callee N times, does the ANALYZER emit N relationships (one per call
// site) or 1 relationship (one per (source,type,target) triple)?
//
// Method — controlled fixtures, so the expected count is known exactly and
// independently: each fixture contains a callee `target()` and a caller that
// invokes it EXACTLY 4 times on 4 distinct lines. The expected number of call
// sites is 4 by construction (asserted against the source text, not assumed).
//
// Then: ASTEngine.parseFile() (the analyzer seam, no store involved) and we
// report emitted `calls` edges, their lines, and whether the true 4 survived.
//
// This is an analyzer-layer instrument only. The store's own collapse
// (parallel-indexer relId has no line component) is separate and already
// reported in M59's PLAN; it can only matter once the analyzer emits >1 edge.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

type Fixture = { lang: string; file: string; src: string; expectCalls: number }

// 4 call sites to the same callee, each on its own line. `target(` appears
// exactly 4 times in the caller by construction (the declaration is `target():`).
const FIXTURES: Fixture[] = [
  {
    lang: "typescript",
    file: "multi.ts",
    expectCalls: 4,
    src: `export function target(): number { return 1 }
export function caller(): number {
  const a = target()
  const b = target()
  const c = target()
  const d = target()
  return a + b + c + d
}
`,
  },
  {
    lang: "javascript",
    file: "multi.js",
    expectCalls: 4,
    src: `export function target() { return 1 }
export function caller() {
  const a = target()
  const b = target()
  const c = target()
  const d = target()
  return a + b + c + d
}
`,
  },
  {
    lang: "java",
    file: "Multi.java",
    expectCalls: 4,
    src: `public class Multi {
  static int target() { return 1; }
  static int caller() {
    int a = target();
    int b = target();
    int c = target();
    int d = target();
    return a + b + c + d;
  }
}
`,
  },
  {
    lang: "kotlin",
    file: "Multi.kt",
    expectCalls: 4,
    src: `fun target(): Int { return 1 }
fun caller(): Int {
  val a = target()
  val b = target()
  val c = target()
  val d = target()
  return a + b + c + d
}
`,
  },
  {
    lang: "scala",
    file: "Multi.scala",
    expectCalls: 4,
    src: `object Multi {
  def target(): Int = 1
  def caller(): Int = {
    val a = target()
    val b = target()
    val c = target()
    val d = target()
    a + b + c + d
  }
}
`,
  },
  {
    lang: "python",
    file: "multi.py",
    expectCalls: 4,
    src: `def target():
    return 1

def caller():
    a = target()
    b = target()
    c = target()
    d = target()
    return a + b + c + d
`,
  },
  {
    lang: "go",
    file: "multi.go",
    expectCalls: 4,
    src: `package main

func target() int { return 1 }

func caller() int {
	a := target()
	b := target()
	c := target()
	d := target()
	return a + b + c + d
}
`,
  },
]

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const dir = mkdtempSync(path.join(tmpdir(), "m59-mult-"))
  console.log(`fixtures: ${dir}\n`)

  const rows: Array<Record<string, unknown>> = []

  for (const f of FIXTURES) {
    const p = path.join(dir, f.file)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, f.src)

    // Independent expected count from the SOURCE TEXT (not from the analyzer):
    // `target(` occurrences minus the declaration line.
    const textual = (f.src.match(/target\(/g) ?? []).length
    const expected = textual - 1 // one declaration
    if (expected !== f.expectCalls) {
      console.log(`${f.lang}: FIXTURE BUG expected=${expected} declared=${f.expectCalls}`)
      continue
    }

    let res: any
    try {
      res = await ASTEngine.parseFile(p, f.src)
    } catch (e: any) {
      console.log(`${f.lang}: THROW ${e?.message}`)
      rows.push({ lang: f.lang, error: String(e?.message) })
      continue
    }

    const rels: any[] = res?.relationships ?? []
    const calls = rels.filter((r) => {
      const t = String(r.type ?? r.relationshipType ?? "").toLowerCase()
      return t === "calls" || t === "call"
    })
    // Any relationship type pointing at the callee name — some analyzers label
    // call edges `uses`/`references`.
    const towardsTarget = rels.filter((r) => String(r.target ?? r.to ?? "").includes("target"))
    const lines = calls
      .map((r) => r.line_number)
      .filter((n) => typeof n === "number" && (n as number) > 0) as number[]
    const distinct = new Set(lines)

    console.log(
      `${f.lang.padEnd(11)} trueCallSites=${expected}  callsEdges=${calls.length}  ` +
        `edgesTowardTarget=${towardsTarget.length}  lines=${lines.length} distinctLines=${distinct.size}  ` +
        `multiplicity=${calls.length > 0 ? (calls.length / distinct.size).toFixed(2) : "n/a"}`,
    )
    for (const r of calls) {
      console.log(
        `    calls  src=${String(r.source ?? r.from ?? "?")} tgt=${String(r.target ?? r.to ?? "?")} line=${JSON.stringify(r.line_number)}`,
      )
    }

    rows.push({
      lang: f.lang,
      file: f.file,
      trueCallSites: expected,
      callsEdges: calls.length,
      edgesTowardTarget: towardsTarget.length,
      withLine: lines.length,
      distinctLines: distinct.size,
      collapsed: calls.length < expected,
      perCallSiteLines: calls.length === expected,
    })
  }

  console.log("\nsummary:")
  console.log(JSON.stringify(rows, null, 2))

  const collapsed = rows.filter((r) => r.collapsed === true).length
  const perSite = rows.filter((r) => r.perCallSiteLines === true).length
  console.log(`\nlanguages measured=${rows.length}  emit-per-call-site=${perSite}  collapsed=${collapsed}`)
  console.log(`fixtures dir (delete freely): ${dir}`)

  // Evidence written BY THE RUN (M59 contract): the command is recorded in it.
  const out = path.join(ROOT, "validation/m59/results/multiplicity.json")
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(
    out,
    JSON.stringify(
      {
        probe: "M59.P2",
        issue: "#822",
        at: new Date().toISOString(),
        command: "npx tsx script/m59/probe-multiplicity.ts",
        question:
          "when a caller invokes the same callee 4 times on 4 lines, does the analyzer emit 4 edges or 1?",
        method:
          "controlled fixtures; expected=4 asserted against the fixture source text (occurrences - declaration); ASTEngine.parseFile only (no store)",
        languagesMeasured: rows.length,
        emitPerCallSite: perSite,
        collapsed,
        rows,
        scope: "analyzer seam only — the store's relId collapse is NOT exercised here",
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`evidence: ${out}`)
  void fileURLToPath
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
