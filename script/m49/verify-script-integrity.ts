// script/m49/verify-script-integrity.ts — M49.G4: the gates themselves are
// code, and a broken gate is worse than no gate.
//
// Incident (2026-09-12, this line of work): a hunk-scoped staging pass wrote
// `script/m14/mutate-analyzer.ts` with the newly added mutants placed AFTER
// `main().catch(...)` — outside the `MUTANTS` array. The file did not parse at
// that commit. Nothing caught it: the mutant battery was only ever run from the
// WORKING TREE (where the array was correct), so every green came from a file
// that was not the one being shipped.
//
// Two checks, both structural rather than textual:
//   1. PARSE — every gate script under script/m14 and script/m49 transpiles.
//      A syntax error in a gate is a failure in its own right.
//   2. REGISTRY CONTAINMENT — in files that declare a top-level array of
//      registered things (`const X: T[] = [`), every registration literal at
//      that indentation must sit INSIDE the array span. Ids outside it are
//      dead code that silently removes coverage.
//
// Both detectors are self-tested below: each is run against a deliberately
// broken sample and must report the defect (a gate that cannot fail is not a
// gate — the #760/#761 lesson, applied to this gate itself).
//
// Run: bun run script/m49/verify-script-integrity.ts
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

function negative(label: string, detected: boolean) {
  if (detected) { passed++; negatives++ }
  else { failed++; failures.push(`negative not detected: ${label}`); console.log(`FAIL: negative not detected: ${label}`) }
}

// ── 1. Parse a source text ─────────────────────────────────────────────────
function parses(src: string): { ok: boolean; error: string } {
  try {
    new Bun.Transpiler({ loader: "ts" }).transformSync(src)
    return { ok: true, error: "" }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) }
  }
}

// ── 2. Registration literals must live inside their array ──────────────────
// `id: "..."` at 4-space indentation registers a mutant. The MUTANTS array
// opens with a module-level `const MUTANTS … = [` and closes at the first line
// that is exactly `]`. Any id literal outside that span is unreachable.
//
// The declaration pattern is deliberately wider than `^const` NAME-wise and
// narrower than `contains MUTANTS`-wise: the registry became IMPORTABLE
// (`export const MUTANTS: Mutant[] = [`, read by the mutant filter), and the
// first version anchored on `^const`, so it stopped finding the array while
// every id stayed inside it — measured 2026-09-26, this gate reported **931 of
// 931 id literal(s) sit outside the array**, a false alarm that blames the
// registry for the scanner's own blindness. Hence two things: the pattern
// accepts a declaration prefix, and `found` is reported SEPARATELY, so "the
// array was not found" can never again be published as "your ids are strays".
const MUTANTS_DECL = /^\s*(?:export\s+)?(?:declare\s+)?const\s+MUTANTS\b[^=]*=\s*\[/
function containment(src: string): { total: number; inside: number; outside: number; found: boolean } {
  const lines = src.split("\n")
  let open = -1, close = -1
  for (let i = 0; i < lines.length; i++) {
    if (open === -1 && MUTANTS_DECL.test(lines[i])) open = i
    else if (open !== -1 && close === -1 && /^\]$/.test(lines[i])) { close = i; break }
  }
  let total = 0, inside = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^    id: "/.test(lines[i])) continue
    total++
    if (open !== -1 && close !== -1 && i > open && i < close) inside++
  }
  return { total, inside, outside: total - inside, found: open !== -1 && close !== -1 }
}

const MUTANT_FILE = "script/m14/mutate-analyzer.ts"
const REGISTRY_FILES: { file: string; key: string }[] = [
  { file: MUTANT_FILE, key: "MUTANTS" },
]

function main() {
  // ── Self-tests: the detectors must be able to fail ──────────────────────
  const straySample = [
    "const MUTANTS: Mutant[] = [",
    "  {",
    '    id: "inside/ok",',
    "  },",
    "]",
    'main().catch(e => { console.error(e) })',
    "  {",
    '    id: "outside/stray",',
    "  },",
  ].join("\n")
  negative("stray id outside the array is detected", containment(straySample).outside === 1)
  negative("clean array reports no strays", containment(straySample.split("\n").slice(0, 5).join("\n")).outside === 0)
  // The scanner's blindness, measured: the registry declares `export const MUTANTS:
  // Mutant[] = [` and the first version anchored on `^const`, so the whole file read as
  // "931 outside" while every id was inside it.
  const exportedSample = straySample.replace("const MUTANTS", "export const MUTANTS")
  negative("an EXPORTED declaration is found, and its stray is still convicted (the 931-of-931 false alarm's exact site)",
    containment(exportedSample).found && containment(exportedSample).outside === 1)
  const noArray = ["// no registry array in this file at all", "main().catch(e => { console.error(e) })", "  {", '    id: "outside/stray",', "  },"].join("\n")
  negative("an array the scanner cannot FIND is reported as a scanner failure, never as strays",
    !containment(noArray).found && containment(noArray).outside === 1)
  negative("syntax error is detected", !parses("const a = { b: 1,, }").ok)

  // ── 1. Every gate script parses ─────────────────────────────────────────
  for (const dir of ["script/m14", "script/m49"]) {
    const abs = path.join(ROOT, dir)
    if (!existsSync(abs)) { check(`${dir} exists`, false, abs); continue }
    const files = readdirSync(abs).filter((f) => f.endsWith(".ts")).sort()
    check(`${dir} has gate scripts`, files.length > 0, `${files.length} files`)
    for (const f of files) {
      const r = parses(readFileSync(path.join(abs, f), "utf8"))
      check(`${dir}/${f} parses`, r.ok, r.error)
    }
  }

  // ── 2. Registry containment ─────────────────────────────────────────────
  for (const { file, key } of REGISTRY_FILES) {
    const p = path.join(ROOT, file)
    if (!existsSync(p)) { check(`${file} exists`, false, p); continue }
    const c = containment(readFileSync(p, "utf8"))
    check(`${key} registry is non-empty`, c.total > 0, `${c.total} id literals`)
    // A SCANNER failure is its own finding: without this check the two states are the
    // same sentence to the reader, and the wrong one is actionable (see MUTANTS_DECL).
    check(`${key} registry's array is findable`, c.found,
      `no line matches ${MUTANTS_DECL} followed by a top-level \`]\` — the file's shape changed, so containment cannot be adjudicated (this is a SCANNER failure, not a stray id)`)
    check(`every ${key} id lives inside the array`, c.found && c.outside === 0,
      c.found
        ? `${c.outside} of ${c.total} id literal(s) sit outside the array — unreachable registration (the 2026-09-12 incident class)`
        : `containment could not be adjudicated — see the scanner failure above`)
  }

  console.log(`M49.G4: ${passed} passed, ${failed} failed, ${negatives} negative(s) exercised`)
  if (failed > 0) {
    console.error(`script integrity FAILED:\n  ${failures.join("\n  ")}`)
    process.exitCode = 1
  }
}

main()
