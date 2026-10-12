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
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
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

  // ── 3. A DECLARED RUNNER MUST BE ABLE TO START WHAT IT NAMES ───────────
  //
  // The incident this closes (2026-10-12, found by running the JavaScript lane's
  // own instruments through their declared entry points): three gates were
  // declared as `bun run <script>` in package.json while opening the store with
  // better-sqlite3 directly, and Bun cannot load it —
  // `ERR_DLOPEN_FAILED … 'better-sqlite3' is not yet supported in Bun`. Each died
  // BEFORE its first check, so `verify` and its milestone aliases stopped at that
  // step and the gate read as "not run" rather than as red: a red gate is a
  // finding, an unrunnable one is silence. Repaired in 4b26bd3a (m40, m54) and in
  // the m29 follow-up that found the same shape one hop down, in a fixture the
  // gate imports; this check is what keeps the class closed.
  //
  // The predicate is deliberately about STATIC LOADING, and it is measured rather
  // than guessed: a file counts when it is the entry itself or is pulled by a
  // top-level static `import … from "./x"` (two hops), and the escape hatch is
  // the runtime selection the project already has (`bun:sqlite`, or the
  // `src/storage/db.bun.ts` / `db.node.ts` driver pair). A scan that followed
  // every relative mention instead reported **136 of 383 entries** — all but
  // three of them files that name better-sqlite3 somewhere off the startup path
  // (inside a function, or behind a dynamic import the runtime never reaches),
  // which is noise a gate cannot afford. Comments are stripped first, so the
  // vendored name in a comment is not a finding.
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  }
  const STATIC_SQLITE3_LOAD = /(?:^|\n)\s*import\s+(?!type\s)[^\n]*from\s+"better-sqlite3"|require\("better-sqlite3"\)|await import\("better-sqlite3"\)/
  const SELECTS_DRIVER_BY_RUNTIME = /bun:sqlite|db\.bun\.ts|db\.node\.ts/
  const startsUnderBun = (src: string) => {
    const code = stripComments(src)
    return SELECTS_DRIVER_BY_RUNTIME.test(code) || !STATIC_SQLITE3_LOAD.test(code)
  }
  negative("a static better-sqlite3 import with no runtime selection is detected", !startsUnderBun(`import Database from "better-sqlite3"\n`))
  negative("the same load passes once the file selects its driver by runtime",
    startsUnderBun(`const isBun = typeof (globalThis as any).Bun !== "undefined"\nconst { openDatabase } = await import(isBun ? "src/storage/db.bun.ts" : "src/storage/db.node.ts")\n`))
  negative("the name in a COMMENT is not a finding (the predicate is about loading)",
    startsUnderBun(`// we used to require("better-sqlite3") here and died on bun\nconst x = 1\n`))
  negative("a TYPE-ONLY import is not a load", startsUnderBun(`import type Database from "better-sqlite3"\n`))

  const STATIC_RELATIVE_IMPORT = /^\s*import\s[^\n]*?from\s+"(\.[^"]+)"/gm
  function staticClosure(entry: string): string[] {
    const seen = new Set<string>()
    const walk = (p: string, depth: number) => {
      if (seen.has(p) || depth > 2) return
      seen.add(p)
      let src = ""
      try { src = readFileSync(p, "utf8") } catch { return }
      for (const m of src.matchAll(STATIC_RELATIVE_IMPORT)) {
        const cand = path.resolve(path.dirname(p), m[1])
        for (const ext of ["", ".ts", ".mts"]) {
          if (existsSync(cand + ext) && statSync(cand + ext).isFile()) { walk(cand + ext, depth + 1); break }
        }
      }
    }
    walk(entry, 0)
    return [...seen]
  }
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }
  const declared = new Map<string, string[]>()
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const m of String(cmd).matchAll(/bun run (script\/[^\s&|;]+)/g)) {
      const arr = declared.get(m[1]) ?? []
      arr.push(name)
      declared.set(m[1], arr)
    }
  }
  check("the declared runners name gate scripts to sweep", declared.size > 0, `${declared.size} distinct path(s) across ${Object.keys(pkg.scripts ?? {}).length} scripts`)
  const cannotStart: string[] = []
  let swept = 0
  for (const entry of [...declared.keys()].sort()) {
    if (!existsSync(path.join(ROOT, entry))) continue
    swept++
    for (const f of staticClosure(path.join(ROOT, entry))) {
      let src = ""
      try { src = readFileSync(f, "utf8") } catch { continue }
      if (!startsUnderBun(src)) {
        cannotStart.push(`${entry} (declared by ${declared.get(entry)!.join(", ")}) loads ${path.relative(ROOT, f)}`)
      }
    }
  }
  check("the sweep reached every declared entry that exists", swept > 0, `${swept} of ${declared.size} swept`)
  check(
    "every `bun run` entry can start on Bun (no unguarded better-sqlite3 in its static closure)",
    cannotStart.length === 0,
    cannotStart.length === 0
      ? `${swept} entr(ies) swept, 0 with an unguarded better-sqlite3 load`
      : `${cannotStart.length} entr(ies) would die before their first check: ${cannotStart.slice(0, 4).join("; ")}`,
  )

  console.log(`M49.G4: ${passed} passed, ${failed} failed, ${negatives} negative(s) exercised`)
  if (failed > 0) {
    console.error(`script integrity FAILED:\n  ${failures.join("\n  ")}`)
    process.exitCode = 1
  }
}

main()
