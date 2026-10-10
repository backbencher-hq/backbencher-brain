#!/usr/bin/env tsx
// script/m62/verify-handwritten-type-copies.ts — gates that re-declare a product
// type by hand instead of importing it.
//
// FOUND 2026-10-10 in script/m55/verify-relations.ts. The gate did:
//
//   const { resolveReferences } = (await import(".../src/lsp/navigation.ts")) as {
//     resolveReferences: (db, req) => { locations: Array<{path,line,character}>; totalCount: number }
//   }
//
// src/lsp/navigation.ts:190 declares ReferencesResult with nine fields. The cast
// kept two. So `coalescedRows`, `omittedUnresolvable`, `omittedUnpositionable`,
// `truncated`, `limit`, `evidenceTier`, `absence` and `NavigationLocation.callSite`
// all reported as fields that do not exist — 12 diagnostics, on fields the product
// has carried all along.
//
// WHY THIS IS WORTH A GATE RATHER THAN A FIX. The hand-written copy is a snapshot.
// It is correct on the day it is written and silently wrong the first time the
// product moves. Nothing complains: the gate still RUNS, still passes, still prints
// green — because at runtime the real object carries every field regardless of what
// the annotation claims. The only symptom is compiler noise, and noise in a gate
// suite is exactly what gets batch-suppressed.
//
// The specific damage: three of the omitted fields are the accounting counters that
// §13.2 ("nothing is merged into silence") exists to check. A gate whose type cannot
// see the accounting fields cannot check that law. The evidence that this had already
// started to bite was sitting in the file: one line carried a one-off
// `as { coalescedRows?: number }` — someone hit the error and patched that single
// site rather than the cause.
//
// ---------------------------------------------------------------------------
// THE FIRST VERSION OF THIS GATE WAS WRONG, AND IT TAUGHT THE MOST IMPORTANT
// LESSON IN THIS FILE.
//
// It resolved the imported path against the SCRIPT's directory:
//
//     path.join(path.dirname(rel), m[2])
//
// But the pattern it was matching is `path.join(ROOT, "src/lsp/navigation.ts")` —
// ROOT-relative. Resolving "src/lsp/navigation.ts" against "script/m55" yields
// "script/m55/src/lsp/navigation.ts", which is not in the export census. Every file
// therefore hit `if (!productTypes) return` and was skipped.
//
// The gate printed `0 hand-written product type copies` and exited 0. It was
// PASSING while scanning nothing, on the very defect it was written to catch — and
// the only reason I know that is that I reverted the fix and re-ran it. A green tick
// from a gate that reads nothing is worse than no gate at all, because it converts
// an open question into a closed one.
//
// So this file now carries its OWN CANARY, below, which runs the detector over a
// synthetic file containing the exact pattern and REQUIRES it to be found. If a
// future edit breaks the matcher again, the gate goes red on the canary instead of
// green on nothing.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

/** Resolve the module specifier a script imports, to a repo-relative .ts path.
 *
 *  Two forms appear in this codebase and they resolve differently:
 *    `path.join(ROOT, "src/lsp/navigation.ts")`  -> ROOT-relative
 *    `"../../src/lsp/navigation.ts"`             -> relative to the importing file
 *  Getting this wrong is the bug described at the top of this file, so it is a
 *  named function rather than an inline expression. */
function resolveImported(importingFileAbs: string, spec: string): string {
  if (path.isAbsolute(spec)) return path.normalize(spec)
  // `path.join(ROOT, "src/...")` — the spec is ROOT-relative, so join against ROOT.
  // Joining it against the importing file's directory is the exact bug described
  // above: it yields script/m55/src/... which is not in the census, so every file
  // is silently skipped and the gate passes on nothing.
  if (spec.startsWith("src/") || spec.startsWith("script/")) return path.normalize(path.join(ROOT, spec))
  // `"../../src/..."` — relative to the importing file.
  return path.normalize(path.join(path.dirname(importingFileAbs), spec))
}

// Read the exported type names of a src/ module, so "the module exports a type" is
// answered by the module rather than by a guess.
const exportedTypes = new Map<string, Set<string>>()
const { walkSourceFiles } = await import("./path_encoding_scan.ts")
for (const f of walkSourceFiles(path.join(ROOT, "src"))) {
  if (!f.endsWith(".ts")) continue
  const text = readFileSync(f, "utf8")
  const names = new Set<string>()
  for (const m of text.matchAll(/^export (?:interface|type) (\w+)/gm)) names.add(m[1]!)
  exportedTypes.set(f, names)
}
check(
  "the src/ export census was readable (zero modules means the walk failed, not that none export types)",
  exportedTypes.size > 50 && [...exportedTypes.values()].some((s) => s.size > 0),
  `${exportedTypes.size} src modules read, ${[...exportedTypes.values()].reduce((n, s) => n + s.size, 0)} exported types`,
)

type Offender = { file: string; line: number; productModule: string; fn: string; form: string }

/** Find `await import(<src module>) as { <name>: ... }` casts in one file. */
function findHandwrittenCopies(rel: string, abs: string, text: string, census: Map<string, Set<string>>): Offender[] {
  const found: Offender[] = []
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    if (!line.includes("await import(")) return
    // The specifier may sit on this line or the next two (multi-line import call).
    const window = lines.slice(i, i + 3).join(" ")
    const m = window.match(/(?:path\.join\(ROOT,\s*)?["']((?:\.\.\/)*[a-z][\w./-]*\.ts)["']/)
    if (!m) return
    const spec = m[1]!
    const productModule = resolveImported(abs, spec)
    if (!census.has(productModule)) return
    const castAt = window.indexOf("as {")
    if (castAt === -1) return
    const close = window.indexOf("}", castAt)
    const body = window.slice(castAt, close === -1 ? undefined : close)

    // THE DISTINCTION THAT MATTERS. Not every `as { ... }` over a src import is a
    // hand-written copy. A cast that NAMES a type the product exports —
    // `=> ReferencesResult`, `=> RichSite[]` — is anchored to the real shape: if
    // the product moves, that line becomes a type error. That is the fix, and it
    // must not be reported as the disease.
    //
    // A cast that spells out `=> { locations: Array<{path, line}>; totalCount: n }`
    // in structural form is a SNAPSHOT. It stays green through any product change.
    // Only those are offenders.
    const productTypeNames = census.get(productModule)!
    const anchors = [...productTypeNames].filter((n) => new RegExp(`\\b${n}\\b`).test(body))
    if (anchors.length > 0) return

    const fn = body.match(/(\w+)\s*:/)?.[1]
    if (!fn) return
    found.push({ file: rel, line: i + 1, productModule, fn, form: spec })
  })
  return found
}

// This gate is EXCLUDED from its own scan: its canary and its header comments quote
// the exact `as { ... }` shape it detects, so including it would make the gate
// permanently red on its own documentation. Everything else in script/ is scanned.
const SELF = "script/m62/verify-handwritten-type-copies.ts"
const scripts = walkSourceFiles(path.join(ROOT, "script"))
  .filter((f) => f.endsWith(".ts") || f.endsWith(".mts"))
  .map((f) => path.relative(ROOT, f))
  .filter((f) => f !== SELF)

const offenders: Offender[] = []
for (const rel of scripts) {
  const abs = path.join(ROOT, rel)
  offenders.push(...findHandwrittenCopies(rel, abs, readFileSync(abs, "utf8"), exportedTypes))
}

// --- THE CANARY -------------------------------------------------------------
// A synthetic file carrying the exact shape this gate exists to catch, written to a
// real temp path under script/ so path resolution behaves as it does in production.
// If the matcher cannot find THIS, it cannot be trusted on anything else.
const canaryDir = mkdtempSync(path.join(tmpdir(), "bb-hwtypes-"))
let canaryFound = 0
try {
  const canaryRel = path.join(path.relative(ROOT, canaryDir), "canary-gate.ts")
  writeFileSync(
    path.join(canaryDir, "canary-gate.ts"),
    `import path from "node:path"\n` +
      `const ROOT = process.cwd()\n` +
      `const { resolveReferences } = (await import(path.join(ROOT, "src/lsp/navigation.ts"))) as {\n` +
      `  resolveReferences: (db: unknown, req: { filePath: string }) => { locations: unknown[]; totalCount: number }\n` +
      `}\n` +
      `void resolveReferences\n`,
  )
  // The census the canary is judged against must actually contain the module it
  // imports — otherwise the canary passes for the same wrong reason as the bug.
  const canaryAbs = path.join(ROOT, canaryRel)
  canaryFound = findHandwrittenCopies(
    canaryRel,
    canaryAbs,
    readFileSync(canaryAbs, "utf8"),
    exportedTypes,
  ).length
} finally {
  rmSync(canaryDir, { recursive: true, force: true })
}

check(
  "CANARY: the detector finds a hand-written cast in a file that provably contains one",
  canaryFound === 1,
  canaryFound === 1
    ? "the synthetic cast was found, so a PASS below means the scan really ran"
    : `*** the synthetic cast was NOT found (found ${canaryFound}). A PASS from this gate would mean it scanned nothing. ***`,
)

check(
  "no gate re-declares a product type by hand (import the real type instead)",
  offenders.length === 0,
  offenders.length === 0
    ? `${scripts.length} script(s) scanned for hand-written product type copies`
    : `*** ${offenders.length} hand-written cast(s) over a product module that exports types: ${offenders
        .slice(0, 40)
        .map((o) => `${o.file}:${o.line} (${o.fn} <- ${path.relative(ROOT, o.productModule)})`)
        .join(", ")} ***`,
)

console.log(
  `\n  ${offenders.length} hand-written product type cop${offenders.length === 1 ? "y" : "ies"}.` +
    (offenders.length > 0
      ? "\n  Each is a snapshot of a shape the product still honours at RUNTIME — the gate keeps passing while\n  its type says fields that really exist do not. Import the real type so drift becomes a type error."
      : ""),
)

const failed = checks.filter((c) => !c.ok).length
console.log(`\nHANDWRITTEN TYPE COPIES: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)