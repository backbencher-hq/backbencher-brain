// script/m13/verify-cross-language-family.ts
//
// FOUND BY VERIFYING THE PUBLISHED 0.2.0, not by any gate.
//
// A fresh 0.2.0 index of an all-TypeScript project still contained ONE row with
// is_cross_language = 1: a `calls` edge from src/app/dashboard/page.tsx to src/lib/util.ts —
// both TypeScript. Because that flag is a STORED COLUMN, every reader (bb_graph, bb_impact,
// bb_cross_language) reported a false cross-language edge.
//
// The cause was a label comparison: `.tsx` has its own grammar id ("tsx") while `.ts` is
// "typescript", so seven queries that ask "do these endpoints have different languages?" said
// YES for two TypeScript files. The fix normalises the COMPARISON into language families
// (tsx≡typescript, jsx/mjs/cjs≡javascript) rather than rewriting the stored ids, which the
// parsers actually need.
//
// This gate pins BOTH directions, because a fix that silences the false row by flattening every
// language would destroy a real feature:
//   · .tsx -> .ts must NOT be cross-language;
//   · .ts  -> .js must STILL be cross-language.

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ROOT = path.resolve(import.meta.dirname, "../..")
const SCRATCH = path.join(ROOT, ".tools/xlfam")
rmSync(SCRATCH, { recursive: true, force: true })
process.env.BB_DATA_DIR = path.join(SCRATCH, "data")

const { getProjectId } = await import("../../src/util/project-id")
const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")

console.log("M13 cross-language: same language FAMILY is not cross-language\n")

/** Cross-language rows for one project, as readable endpoint pairs. */
async function crossRows(projectId: string): Promise<string[]> {
  const db = await BrainDatabase.getRawInstance(projectId as any)
  const rows = db
    .prepare(
      `SELECT sf.language || ' ' || sf.relative_path || ' -> ' || tf.language || ' ' || tf.relative_path
       FROM brain_relationship r
       JOIN brain_symbol ss ON ss.id = r.source_symbol_id JOIN brain_file sf ON sf.id = ss.file_id
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.is_cross_language = 1 AND r.project_id = ?`,
    )
    .all(projectId) as Array<{ [k: string]: string }>
  return rows.map((r) => Object.values(r)[0])
}

// ── the reported shape: a .tsx file calling a .ts file ──────────────────────
{
  const P = path.join(SCRATCH, "tsx")
  mkdirSync(path.join(P, "web"), { recursive: true })
  writeFileSync(path.join(P, "package.json"), '{"name":"fam-tsx","version":"1.0.0"}\n')
  writeFileSync(path.join(P, "web", "util.ts"), "export function helper(): number { return 7 }\n")
  writeFileSync(path.join(P, "web", "page.tsx"), 'import { helper } from "./util"\nexport function Page(){ return helper() }\n')
  const id = getProjectId(P)
  await indexProjectParallel(id, P, {})
  const rows = await crossRows(id)
  check("THE REPORTED DEFECT: .tsx -> .ts is NOT cross-language", rows.length === 0, rows.join(" | "))
}

// ── a genuine cross-language edge must survive ──────────────────────────────
{
  const P = path.join(SCRATCH, "tsjs")
  mkdirSync(path.join(P, "web"), { recursive: true })
  writeFileSync(path.join(P, "package.json"), '{"name":"fam-tsjs","version":"1.0.0"}\n')
  writeFileSync(path.join(P, "web", "legacy.js"), "export function legacyCompute(){ return 2 }\n")
  writeFileSync(path.join(P, "web", "modern.ts"), 'import { legacyCompute } from "./legacy"\nexport function useIt(){ return legacyCompute() }\n')
  const id = getProjectId(P)
  await indexProjectParallel(id, P, {})
  const rows = await crossRows(id)
  check("typescript -> javascript is STILL cross-language (no over-correction)", rows.length > 0, rows.join(" | "))
  check("and the bridge is recorded", rows.length > 0 && /typescript .* -> javascript /.test(rows[0]), rows[0] ?? "")
}

// ── the seven comparisons share ONE expression ──────────────────────────────
{
  const src = (await import("node:fs")).readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8") as string
  const raw = src.match(/lower\(sf\.language\) <> lower\(tf\.language\)/g) ?? []
  check("no query compares raw language labels any more", raw.length === 0, `${raw.length} raw comparison(s) left`)
  check("the family expression is used", /LANG_FAMILY_SF/.test(src) && /LANG_FAMILY_TF/.test(src))
  check("tsx is treated as typescript", /WHEN 'tsx' THEN 'typescript'/.test(src))
  check("jsx is treated as javascript", /WHEN 'jsx' THEN 'javascript'/.test(src))
  check("typescript and javascript are NOT flattened together", !/WHEN 'typescript' THEN 'javascript'/.test(src))
}

rmSync(SCRATCH, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "CROSS-LANGUAGE FAMILY: PASS" : `CROSS-LANGUAGE FAMILY: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
