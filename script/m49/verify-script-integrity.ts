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
// opens with `const MUTANTS: Mutant[] = [` and closes at the first line that is
// exactly `]`. Any id literal outside that span is unreachable.
function containment(src: string): { total: number; inside: number; outside: number } {
  const lines = src.split("\n")
  let open = -1, close = -1
  for (let i = 0; i < lines.length; i++) {
    if (open === -1 && /^const MUTANTS:\s*Mutant\[\]\s*=\s*\[/.test(lines[i])) open = i
    else if (open !== -1 && close === -1 && /^\]$/.test(lines[i])) { close = i; break }
  }
  let total = 0, inside = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^    id: "/.test(lines[i])) continue
    total++
    if (open !== -1 && close !== -1 && i > open && i < close) inside++
  }
  return { total, inside, outside: total - inside }
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
    check(`every ${key} id lives inside the array`, c.outside === 0,
      `${c.outside} of ${c.total} id literal(s) sit outside the array — unreachable registration (the 2026-09-12 incident class)`)
  }

  console.log(`M49.G4: ${passed} passed, ${failed} failed, ${negatives} negative(s) exercised`)
  if (failed > 0) {
    console.error(`script integrity FAILED:\n  ${failures.join("\n  ")}`)
    process.exitCode = 1
  }
}

main()
