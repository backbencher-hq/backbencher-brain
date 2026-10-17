// script/m71/probe-refactor-completeness.ts — REVIEW PROBE for bb_edit (not a gate).
//
// D2's claim is "refactor silently skips cross-file call sites". This probe
// measures WHICH shapes are skipped and whether the plan is even self-consistent
// (a rename that updates a call site but leaves the `import { target }` specifier
// behind has broken the file in a different place than the one it fixed).
//
// Each case prints the outcome, the summary, and the FULL content of every file
// other than the declaration, because the interesting failures differ only in
// a token inside a file the summary never mentions.
//
// Run: npx tsx script/m71/probe-refactor-completeness.ts
// Optional: PROBE_CASE=A to run one case.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

const DECL = `export function target(): number {\n  return 1\n}\n`

type Case = {
  id: string
  what: string
  files: Record<string, string>
  symbol?: string
  newName?: string
}

const CASES: Case[] = [
  {
    id: "A",
    what: "module-top-level call (edge source is NULL)",
    files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const n = target()\n` },
  },
  {
    id: "B",
    what: "call inside an exported function (the shape the old gate used)",
    files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport function caller(): number {\n  return target()\n}\n` },
  },
  {
    id: "C",
    what: "aliased import + call through the alias",
    files: { "src/a.ts": DECL, "src/b.ts": `import { target as t } from './a'\nexport const n = t()\n` },
  },
  {
    id: "D",
    what: "import specifier only, no call site in the file",
    files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const x = 1\n` },
  },
  {
    id: "E",
    what: "re-export barrel",
    files: { "src/a.ts": DECL, "src/index.ts": `export { target } from './a'\n` },
  },
  {
    id: "F",
    what: "typeof target in another file",
    files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const t = typeof target\n` },
  },
  {
    id: "G",
    what: "side-effect import of the declaration module only",
    files: { "src/a.ts": DECL, "src/b.ts": `import './a'\nexport const x = 1\n` },
  },
  {
    id: "H",
    what: "FALSE-POSITIVE CONTROL: unrelated local named target, importing another export",
    files: {
      "src/a.ts": `export function target(): number {\n  return 1\n}\nexport function other(): number {\n  return 2\n}\n`,
      "src/b.ts": `import { other } from './a'\nconst target = 1\nexport const y = target + other()\n`,
    },
  },
  {
    id: "I",
    what: "two importers, one call each (module-top-level in both)",
    files: {
      "src/a.ts": DECL,
      "src/b.ts": `import { target } from './a'\nexport const n = target()\n`,
      "src/c.ts": `import { target } from './a'\nexport const m = target()\n`,
    },
  },
  {
    id: "S",
    what: "SHADOW CONTROL: importer whose nested function re-declares the name as a parameter",
    files: {
      "src/a.ts": DECL,
      "src/b.ts": `import { target } from './a'\nexport function outer(target: number): number {\n  return target + 10\n}\nexport const n = target()\n`,
    },
  },
  {
    id: "T",
    what: "SHADOW CONTROL: importer whose nested function has a LOCAL named target",
    files: {
      "src/a.ts": DECL,
      "src/b.ts": `import { target } from './a'\nexport function outer(): number {\n  const target = 5\n  return target + 10\n}\nexport const n = target()\n`,
    },
  },
  {
    id: "V",
    what: "SHADOW CONTROL in the DECLARATION file: a nested function whose PARAMETER is named target",
    files: {
      "src/a.ts": `export function target(): number {\n  return 1\n}\nexport function use(target: number): number {\n  return target + 1\n}\n`,
    },
  },
  {
    id: "W",
    what: "SHADOW CONTROL: a parameter named target that is CALLED inside the body",
    files: {
      "src/a.ts": DECL,
      "src/b.ts": `import { target } from './a'\nexport function outer(target: () => number): number {\n  return target()\n}\nexport const n = target()\n`,
    },
  },
  {
    id: "U",
    what: "two modules with the same stem: only the one that resolves may be rewritten",
    files: {
      "src/a.ts": DECL,
      "src/other/a.ts": `export function target(): number {\n  return 9\n}\n`,
      "src/b.ts": `import { target } from './other/a'\nexport const n = target()\n`,
    },
  },
  {
    id: "J",
    what: "D3: refactor of a YAML mapping key (no identifier node type)",
    files: { "a.yaml": `target:\n  replicas: 1\n\nother:\n  ref: target\n` },
    symbol: "target",
    newName: "renamedTarget",
  },
  {
    id: "K",
    what: "D3: refactor of a Makefile rule target",
    files: { Makefile: `target:\n\techo hi\n\nall: target\n` },
    symbol: "target",
    newName: "renamedTarget",
  },
]

const only = process.env.PROBE_CASE
for (const c of CASES) {
  if (only && c.id !== only) continue
  const root = mkdtempSync(path.join(tmpdir(), `bb-refac-${c.id}-`))
  for (const [rel, content] of Object.entries(c.files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const projectId = getProjectId(root)
  const declFile = Object.keys(c.files)[0] ?? "src/a.ts"
  try {
    await indexProjectParallel(projectId, root, {})
    let outcome = "ok"
    let error: string | undefined
    let summary: unknown
    let warnings: string[] | undefined
    try {
      const result = await executeEdit(root, projectId, {
        mode: "refactor",
        symbolName: c.symbol ?? "target",
        newName: c.newName ?? "renamed",
        filePath: declFile,
        format: false,
      })
      summary = result.summary
      warnings = result.warnings
    } catch (e: any) {
      outcome = "error"
      error = e?.message ?? String(e)
    }
    console.log(`── ${c.id}: ${c.what}`)
    console.log(`   outcome=${outcome}${error ? ` error=${JSON.stringify(error)}` : ""} summary=${JSON.stringify(summary)}`)
    if (warnings?.length) console.log(`   warnings=${JSON.stringify(warnings)}`)
    for (const rel of Object.keys(c.files)) {
      if (rel === declFile) continue
      console.log(`   ${rel}=${JSON.stringify(readFileSync(path.join(root, rel), "utf8"))}`)
    }
    // Did the declaration file itself survive?
    console.log(`   ${declFile}=${JSON.stringify(readFileSync(path.join(root, declFile), "utf8"))}`)
  } catch (e: any) {
    console.log(`── ${c.id}: ${c.what}`)
    console.log(`   SETUP ERROR ${e?.message ?? String(e)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}
console.log("PROBE COMPLETE")
