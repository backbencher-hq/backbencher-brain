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

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
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
//
// A MODULE UNDER script/ IS ALSO PRODUCT WHEN SOMETHING OUTSIDE script/ IMPORTS IT.
//
// The census above reads src/ only, and that made a real drift invisible. Found
// 2026-10-12: script/m26/verify-content-security.ts:47 hand-writes the signature of
// `buildWebviewHtml`, and its copy was missing `styles?: boolean` — which
// script/m26/webview-html.ts:111 DECLARES and :121 READS. The runtime stayed correct
// (the implementation honours the flag), so the gate's checks passed while its type
// claimed a field the real signature does not have: precisely the failure this gate is
// named for, in the one shape this gate could not see.
//
// webview-html.ts lives under script/, not src/, so it was not in the census. But it is
// the canonical webview shell and every provider imports it:
//
//     ide/vscode/src/extension.ts:39   from "../../../script/m26/webview-html"
//     ide/vscode/src/graph-panel.ts:173 from "../../../script/m26/webview-html"
//     ide/vscode/src/impact-panel.ts:27 from "../../../script/m26/webview-html"
//     ide/vscode/src/hub-panel.ts:173   from "../../../script/m26/webview-html"
//
// So the rule is not "under src/", it is "imported by a consumer outside the gate layer".
// Modules under script/ that a non-script consumer imports are counted, by resolving the
// specifiers those consumers actually write. Nothing is hard-coded: if a script/ module
// stops being imported from outside, it leaves the census on its own.
let adoptedProductModules = 0
for (const consumer of walkSourceFiles(path.join(ROOT, "ide"))) {
  if (!consumer.endsWith(".ts")) continue
  for (const m of readFileSync(consumer, "utf8").matchAll(/["']((?:\.\.\/)+script\/[\w./-]+)["']/g)) {
    const spec = m[1]!
    // CONSUMERS WRITE THE SPECIFIER WITHOUT AN EXTENSION —
    //   from "../../../script/m26/webview-html"
    // so requiring `.ts` adopted nothing, and the vacuity check below caught exactly that
    // on the first run of this change. A widened census that widens nothing is the old
    // census wearing a new comment, which is the failure mode this session has hit three
    // times (the path-encoding gate scanning zero files, verify-check-arg-order's first two
    // versions, and this).
    const base = path.resolve(path.dirname(consumer), spec)
    const abs = [`${base}.ts`, path.join(base, "index.ts")].find((c) => existsSync(c))
    if (!abs || exportedTypes.has(abs)) continue
    const names = new Set<string>()
    for (const t of readFileSync(abs, "utf8").matchAll(/^export (?:interface|type) (\w+)/gm)) names.add(t[1]!)
    exportedTypes.set(abs, names)
    adoptedProductModules++
  }
}

check(
  "the src/ export census was readable (zero modules means the walk failed, not that none export types)",
  exportedTypes.size > 50 && [...exportedTypes.values()].some((s) => s.size > 0),
  `${exportedTypes.size} modules read (src/ plus ${adoptedProductModules} under script/ adopted because a non-script consumer imports them), ${[...exportedTypes.values()].reduce((n, s) => n + s.size, 0)} exported types`,
)

check(
  "the adopted script/ product modules were actually found (a widened census that adopts nothing is the old census)",
  adoptedProductModules > 0,
  adoptedProductModules > 0
    ? `${adoptedProductModules} script/ module(s) adopted as product modules via imports from ide/`
    : `*** no script/ module was adopted, so the census is still src/-only and script/m26/webview-html.ts is invisible — the drift that hid ` +
        `buildWebviewHtml's missing styles?: boolean is exactly what this must prevent ***`,
)

/** Product modules a cast was pointed at that export NO type — reported, not hidden. */
const unanchoredProductModules = new Set<string>()

type Offender = { file: string; line: number; productModule: string; fn: string; form: string }

/** Find `await import(<src module>) as { <name>: ... }` casts in one file. */
function findHandwrittenCopies(rel: string, abs: string, text: string, census: Map<string, Set<string>>): Offender[] {
  const found: Offender[] = []
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    if (!line.includes("await import(")) return
    // The specifier may sit on this line or the next two (multi-line import call).
    const window = lines.slice(i, i + 3).join(" ")
    let m = window.match(/(?:path\.join\(ROOT,\s*)?["']((?:\.\.\/)*[a-z][\w./-]*\.ts)["']/)
    let spec = m?.[1]
    //
    // A SPECIFIER PASSED AS A CONSTANT IS STILL A SPECIFIER.
    //
    // script/m26/verify-content-security.ts writes
    //
    //     const SHELL = join(ROOT, "script", "m26", "webview-html.ts")     line 31
    //     const shell = await import(SHELL)                                line 43
    //     const { buildWebviewHtml } = shell as { … }                      line 44
    //
    // so `await import(` is followed by a bare identifier and the three-line window holds no
    // quoted path at all. That is how a real drifted copy of `buildWebviewHtml`'s signature
    // — missing `styles?: boolean`, which the real module both declares and reads — stayed
    // invisible to this gate. Three gaps in one detector, each found by a real instance and
    // not by reading: src/-only census, extensionless specifiers, and now this.
    if (!m) {
      const idm = window.match(/await import\(\s*([A-Z_][A-Z0-9_]*)\s*\)/)
      if (!idm) return
      const decl = text.match(
        new RegExp(`const\\s+${idm[1]}\\s*=\\s*join\\(\\s*ROOT\\s*,\\s*([^)]*)\\)`),
      )
      if (!decl) return
      const segs = [...decl[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)
      if (segs.length === 0) return
      spec = segs.join("/")
    }
    // `spec` is `string | undefined` because the literal match is optional and the
    // constant-specifier branch assigns it. The reassignment of `m` that used to sit here
    // was never read again — `spec` is what everything downstream uses — so it is gone
    // rather than kept as a cast to satisfy nothing.
    if (!spec) return
    const productModule = resolveImported(abs, spec)
    if (!census.has(productModule)) return
    const castAt = window.indexOf("as {")
    if (castAt === -1) return
    //
    // BALANCED BRACES, NOT THE FIRST "}".
    //
    // `window.indexOf("}", castAt)` stopped the body at the first closing brace, which in a
    // parameter type is usually a NESTED one. Concretely, script/m55/verify-relations.ts:118
    // reads
    //
    //     hover: (db: unknown, req: { filePath: string; position: { line: number; … } }) =>
    //       Promise<HoverResult>
    //
    // so the first "}" belongs to `position: { … }` and the body examined ended before
    // `HoverResult` ever appeared. `HoverResult` IS exported — src/lsp/hover.ts:168, `export
    // interface HoverResult` — so that cast is exactly the ANCHORED kind this gate says it
    // must not report, and its own comment says so. The gate reported it anyway.
    //
    // A gate that flags correct code is worse than no gate: it teaches people to ignore it,
    // which is the lesson script/m62/verify-indexer-option-contract.ts and
    // verify-esm-only-globals.ts each learned the hard way.
    let depth = 0
    let close = -1
    for (let k = castAt; k < window.length; k++) {
      if (window[k] === "{") depth++
      else if (window[k] === "}") {
        depth--
        if (depth === 0) {
          close = k
          break
        }
      }
    }
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
    //
    // A MODULE THAT EXPORTS NO TYPE CANNOT BE ANCHORED, SO A CAST OVER IT IS NOT A COPY.
    //
    // MEASURED 2026-10-17: script/m14/tmp/protobuf/probe/extraction-ab.mts imports
    // src/ast/real-protobuf-analyzer.ts for its CLASS, then casts a JSON manifest as
    // `{ corpora: any[] }`. The analyzer exports zero interfaces and zero types, so
    // there is nothing to import instead and `anchors` was necessarily empty — the gate
    // reported a "hand-written product type copy" whose prescribed remedy ("import the
    // real type") cannot be carried out, because no such type exists. An unsatisfiable
    // ask is the same defect as a lint that matches its own documentation.
    //
    // The exclusion is COUNTED and printed below, so it cannot silently widen.
    if (productTypeNames.size === 0) {
      unanchoredProductModules.add(productModule)
      return
    }
    const anchors = [...productTypeNames].filter((n) => new RegExp(`\\b${n}\\b`).test(body))
    if (anchors.length > 0) return
    //
    // `typeof import("…")` IS THE FIX, SO IT IS NOT THE DISEASE.
    //
    //     const { hover } = (await import(path.join(ROOT, "src/lsp/hover.ts"))) as
    //       typeof import("../../src/lsp/hover.ts")
    //
    // The dynamic `await import(<variable>)` returns `any`, so a cast is needed to type it —
    // and this is the cast that ties the gate to the real module instead of to a snapshot of
    // it. Any change to the product's signature becomes a type error here, which is the whole
    // point. Reporting it would mean the gate rejects its own prescribed remedy, so the
    // 16 remaining copies could never be fixed without the gate going red for doing it right.
    //
    // This is the same rule as the named-type anchor above, stated for the form the remedy
    // takes: a cast is a SNAPSHOT only if it spells out the shape itself.
    if (/\btypeof\s+import\s*\(/.test(body)) return

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

// IT IS GREEN NOW, AND IT IS IN verify-suite.mts, AND THE SWITCH IS RECORDED HERE.
//
// This gate used to declare itself RED BY DESIGN and to sit outside the suite on that
// declaration: 15 gates hand-wrote a product type, and each was an open question about
// what that gate was measuring, not an environment block. Filing it on the honest-block
// allowlist would have said "cannot run here", which is false — it runs fine here and
// correctly reports a defect. That is the laundering the allowlist exists to prevent.
//
// All 16 copies are now anchored to the real module with `typeof import(...)`, so the
// class is empty and the declaration above is FALSE. Leaving it in place would be worse
// than having never written it: script/m62/verify-suite-coverage.ts accepts a gate that
// "declares itself unresolved", so a stale declaration would keep a gate out of the suite
// while looking like a considered decision. A self-declaration is a claim about the world,
// and it has to be withdrawn when the world changes.
//
// It went green by fixing the gates, not by widening the gate until it agreed — which is
// the direction that matters here, because the detector was simultaneously BROKEN and
// under-reporting. Fixing the 16 copies alone would have been impossible without first
// repairing it, because it reported two correctly-anchored casts as defects (see the
// balanced-brace note below) and could not see three real ones at all.

console.log(
  `\n  ${offenders.length} hand-written product type cop${offenders.length === 1 ? "y" : "ies"}.` +
    (offenders.length > 0
      ? "\n  Each is a snapshot of a shape the product still honours at RUNTIME — the gate keeps passing while\n  its type says fields that really exist do not. Import the real type so drift becomes a type error."
      : ""),
)
// The exclusion above is REPORTED. A cast over a module that exports no type cannot be
// anchored to anything, so it is neither a copy nor fixable by the remedy this gate names.
if (unanchoredProductModules.size > 0) {
  console.log(
    `\n  ${unanchoredProductModules.size} module(s) were imported by a cast but export NO type, so the cast cannot be anchored and is not reported:`,
  )
  for (const m of [...unanchoredProductModules].sort()) console.log(`    ${path.relative(ROOT, m)}`)
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nHANDWRITTEN TYPE COPIES: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)