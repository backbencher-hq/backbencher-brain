// script/m13/verify-cross-language-write-refusal.ts
//
// Reported on 0.1.9: "122 false cross-language rows remain (110 Go→JS); bb_graph N still
// exposes 85, while bb_cross_language hides them."
//
// That is exactly right, and it is why the 0.1.9 fix was half a fix. It filtered the
// `bb_cross_language` PROJECTION. But `is_cross_language` is a STORED COLUMN, and
// bb_graph / bb_impact / bb_visualize all read the column directly — so the noise
// disappeared from one surface and stayed on the others.
//
// The refusal is moved to the WRITE, which is the only place all readers agree. The row
// is still stored as a relationship and still records `name-resolution` in its bridge, so
// the guess stays visible in metadata; what is withheld is the cross-language CLAIM.

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
const { crossLanguageStorable } = await import("../../src/ast/parallel-indexer")

console.log("M13 cross-language write refusal\n")

// ── the reported shape is refused ────────────────────────────────────────────
check(
  "THE REPORTED DEFECT: a bare name-resolution guess is NOT stored as cross-language",
  crossLanguageStorable(undefined, true) === false,
  String(crossLanguageStorable(undefined, true)),
)
check(
  "an explicit `name-resolution` bridge is not cross-language either",
  crossLanguageStorable({ bridgeMechanism: "name-resolution" }, true) === false,
)
check(
  "a non-cross-language row stays non-cross-language",
  crossLanguageStorable({}, false) === false,
)

// ── real evidence still comes through ───────────────────────────────────────
check(
  "an analyzer ASSERTION is honoured (metadata.isCrossLanguage)",
  crossLanguageStorable({ isCrossLanguage: true }, false) === true,
)
check(
  "a REAL bridge mechanism is honoured",
  crossLanguageStorable({ bridgeMechanism: "ffi" }, true) === true,
)
check(
  "the C# decorates bridge survives",
  crossLanguageStorable({ bridgeMechanism: "attribute" }, true) === true,
)
check(
  "the Go module-path bridge survives",
  crossLanguageStorable({ bridgeMechanism: "go-module" }, true) === true,
)
check(
  "a declared bridge with no cross flag is still allowed",
  crossLanguageStorable({ bridgeMechanism: "wasm-import" }, false) === true,
)

// ── the writer actually calls it (a helper nobody calls is not a fix) ───────
{
  const src = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
  check(
    "the relationship INSERT uses the refusal",
    /crossLanguageStorable\(rel\.metadata, relIsCrossLanguage\) \? 1 : 0/.test(src),
  )
  check(
    "the row is still stored, and the guess stays visible in its bridge",
    /rel\.metadata\?\.bridgeMechanism \|\| \(relIsCrossLanguage \? "name-resolution" : null\)/.test(src),
  )
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "CROSS-LANGUAGE WRITE: PASS" : `CROSS-LANGUAGE WRITE: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
