// script/m13/verify-orphan-by-design.ts
//
// Reported on 0.1.9: "Orphan false positives remain for bundled JS/Makefile/polyfills."
//
// Each of these is real code that NO in-code reference can ever point at, so reporting it
// as dead is wrong by construction:
//   · build output / vendored code — a bundle's identifiers are consumed by the loader,
//     not by an import in this project;
//   · Makefile/CMake/Dockerfile targets — invoked BY NAME from a shell or CI, and the
//     language has no reference construct at all;
//   · polyfills and shims — loaded for their side effect, so nothing imports them.
//
// The safe direction: a missed orphan leaves cleanup on the table, while a false one
// invites an agent to delete live build configuration.

import { readFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ROOT = path.resolve(import.meta.dirname, "../..")
const { isUnreferencableByDesign } = await import("../../src/intelligence/patterns/orphans")

console.log("M13 orphan: unreferencable by design\n")

// ── the three reported classes ──────────────────────────────────────────────
for (const [file, lang] of [
  ["Makefile", "make"],
  ["scripts/release.mk", "makefile"],
  ["CMakeLists.txt", "cmake"],
  ["Dockerfile", "dockerfile"],
  ["static/vendor/openlayers/ol.js", null],
  ["web/lib/ol.min.js", "javascript"],
  ["assets/app.bundle.js", "javascript"],
  ["node_modules/pkg/index.js", "javascript"],
  ["src/polyfills.ts", "typescript"],
  ["src/polyfill-array.js", "javascript"],
  ["lib/shim.mjs", "javascript"],
] as Array<[string, string | null]>) {
  check(`suppresses ${file}${lang ? ` (${lang})` : ""}`, isUnreferencableByDesign(file, lang), String(isUnreferencableByDesign(file, lang)))
}

// ── ordinary code is NOT suppressed (a filter that eats everything is not a fix) ──
for (const [file, lang] of [
  ["src/lib/util.ts", "typescript"],
  ["internal/pkg/load.go", "go"],
  ["app/components/Button.tsx", "typescript"],
  ["src/index.js", "javascript"],
  ["cmd/main.rs", "rust"],
] as Array<[string, string]>) {
  check(`keeps ${file} reportable`, !isUnreferencableByDesign(file, lang), String(isUnreferencableByDesign(file, lang)))
}

// ── wired in, and counted rather than silently dropped ──────────────────────
{
  const src = readFileSync(path.join(ROOT, "src/intelligence/patterns/orphans.ts"), "utf8")
  check("the scan calls the predicate", /isUnreferencableByDesign\(sym\.file, sym\.language\)/.test(src))
  check("suppressions are COUNTED", /suppressed\.unreferencableByDesign\+\+/.test(src))
  check("the count is published in suppressedByReason", /suppressedByReason: suppressed/.test(src))
  check("it runs before the candidate is pushed", src.indexOf("isUnreferencableByDesign(sym.file") < src.indexOf("candidates.push({ conf: confidence"))
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "ORPHAN BY-DESIGN: PASS" : `ORPHAN BY-DESIGN: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
