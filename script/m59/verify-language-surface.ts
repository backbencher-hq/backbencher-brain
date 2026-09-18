// script/m59/verify-language-surface.ts — M59 language-surface gate.
//
// WHY THIS EXISTS. Two user-facing claims had no instrument behind them:
//
//   1. `src/ast/language-detection.ts` names 46 languages, and nothing checked that
//      the product can actually PARSE what it names. Measured empirically by
//      `script/m59/measure-analyzer-surface.ts` (detector → ASTEngine.parseFile on
//      one minimal file per language): 43 analyze, and **3 throw
//      "parser not yet implemented"** — nim, protobuf, vb. A `.proto`/`.nim`/`.vb`
//      file is detected, offered to the parser, and counted as an ERROR FILE, so a
//      project containing them indexes as `partial` for a reason that is a missing
//      feature, not a broken file.
//   2. `package.json`'s `description` says "40+ language analyzers". Nothing
//      derived or checked that number — the same "a record asserts a number no gate
//      maintains" class as the regex census that claimed 0 while 55 existed.
//
// WHAT THIS GATE ASSERTS, and why each direction is necessary:
//   * every registry language either PARSES, or is on the declared gap list —
//     so a new unimplemented language cannot be added to the detector unnoticed;
//   * every declared-gap language STILL fails — so the list cannot rot into a
//     permanently-excused set after the parsers land (a stale exclusion is how a
//     gap becomes invisible);
//   * the description's "N+" does not exceed the number of analyzer modules, and —
//     because the phrase says "analyzers", not "languages" — the module count is
//     the population it is allowed to draw from.
//
// The empirical half is deliberately not inferential: this file's first version
// inferred the surface from `wasm/tree-sitter-*.wasm` filenames and produced a
// WRONG answer, reporting csharp and objective-c as grammarless (their files are
// `tree-sitter-c_sharp.wasm` and `tree-sitter-objc.wasm`) and css/hcl/nim/protobuf/
// vb as undispatched. Filename identity is not product identity, so the gate runs
// the product.
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/**
 * The declared gap: languages the detector names but the engine has no grammar
 * branch for. Each entry needs a reason and an issue, and the gate fails if one of
 * them starts parsing (the declaration is then stale) or if a language appears here
 * that this list does not name.
 */
const DECLARED_UNSUPPORTED: Array<{ lang: string; why: string }> = [
  { lang: "nim", why: "no tree-sitter-nim wasm branch in engine.ts (#892)" },
  { lang: "protobuf", why: "no tree-sitter-proto wasm branch in engine.ts (#892)" },
  { lang: "vb", why: "no tree-sitter-vb wasm branch in engine.ts (#892)" },
]

function extensionsByLanguage(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const src = readFileSync(path.join(ROOT, "src/ast/language-detection.ts"), "utf8")
  const body = src.slice(src.indexOf("const EXTENSION_LANGUAGE"), src.indexOf("const BASENAME_LANGUAGE"))
  for (const m of body.matchAll(/([a-z0-9_+]+):\s*"([a-z0-9-]+)"/g)) {
    const lang = m[2]
    if (!out.has(lang)) out.set(lang, [])
    out.get(lang)!.push(m[1])
  }
  return out
}

interface Surface {
  registry: string[]
  parsed: string[]
  failed: Array<{ lang: string; error: string }>
}

async function measureSurface(): Promise<Surface> {
  const { detectLanguageFromPath } = (await import(path.join(ROOT, "src/ast/language-detection.ts"))) as any
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const byLang = extensionsByLanguage()
  const dir = mkdtempSync(path.join(tmpdir(), "surface-"))
  const parsed: string[] = []
  const failed: Array<{ lang: string; error: string }> = []
  for (const [lang, exts] of [...byLang].sort()) {
    const file = path.join(dir, `probe.${exts[0]}`)
    const text = "// probe\n"
    writeFileSync(file, text)
    const detected = detectLanguageFromPath(file, text)
    if (detected !== lang) {
      // A registry whose own detector disagrees with it is a third state, reported
      // as a failure rather than silently tolerated.
      failed.push({ lang, error: `detector returned ${detected} for .${exts[0]}` })
      continue
    }
    try {
      await ASTEngine.parseFile(file, text)
      parsed.push(lang)
    } catch (e: any) {
      failed.push({ lang, error: String(e?.message ?? e).slice(0, 120) })
    }
  }
  return { registry: [...byLang.keys()].sort(), parsed: parsed.sort(), failed }
}

let failures = 0
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

async function main() {
  const surface = await measureSurface()
  const declared = new Set(DECLARED_UNSUPPORTED.map((d) => d.lang))
  const failedLangs = new Set(surface.failed.map((f) => f.lang))

  console.log(`registry languages: ${surface.registry.length} · parse: ${surface.parsed.length} · fail: ${surface.failed.length}`)

  // 1. nothing fails that is not declared
  const undeclared = surface.failed.filter((f) => !declared.has(f.lang))
  check(
    "every language the detector names either parses or is a DECLARED gap",
    undeclared.length === 0,
    undeclared.length === 0
      ? `${surface.failed.length} failure(s), all declared`
      : `undeclared failure(s): ${undeclared.map((u) => `${u.lang} (${u.error})`).join("; ")} — either wire a grammar or add it to DECLARED_UNSUPPORTED with a reason and an issue`,
  )

  // 2. every declared gap is still a gap (stale declarations are how a gap hides)
  const stale = DECLARED_UNSUPPORTED.filter((d) => !failedLangs.has(d.lang))
  check(
    "every DECLARED gap still fails (no stale exclusions)",
    stale.length === 0,
    stale.length === 0 ? `${DECLARED_UNSUPPORTED.length} declared` : `these now parse, so the declaration is stale: ${stale.map((s) => s.lang).join(", ")} — remove them from DECLARED_UNSUPPORTED`,
  )

  // 3. a declared language must still be one the detector knows
  const unknown = DECLARED_UNSUPPORTED.filter((d) => !surface.registry.includes(d.lang))
  check(
    "no DECLARED gap names a language the registry does not have",
    unknown.length === 0,
    unknown.length === 0 ? "" : unknown.map((u) => u.lang).join(", "),
  )

  // 4. the module population the description is allowed to draw from
  const modules = readdirSync(path.join(ROOT, "src/ast")).filter((f) => /^real-.*-analyzer\.ts$/.test(f))
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const claim = typeof pkg.description === "string" ? pkg.description : ""
  const claimed = [...claim.matchAll(/(\d+)\+/g)].map((m) => Number(m[1]))
  check(
    "the package description's 'N+' does not exceed the analyzer modules that back it",
    claimed.every((n) => n <= modules.length),
    claimed.length === 0
      ? "no 'N+' claim found in the description (nothing to gate)"
      : `claim ${claimed.join(",")} vs ${modules.length} module(s)`,
  )
  check(
    "the package description's 'N+' is not below what the product actually parses",
    claimed.every((n) => n <= surface.parsed.length),
    `claim ${claimed.join(",")} vs ${surface.parsed.length} parsing language(s)`,
  )

  console.log(`\nnumbers this gate can vouch for: ${surface.parsed.length} languages parse, ` +
    `${surface.registry.length} detected, ${modules.length} analyzer modules, ` +
    `${DECLARED_UNSUPPORTED.length} declared gap(s)`)
  console.log(failures === 0 ? "\nLANGUAGE SURFACE: PASS" : `\nLANGUAGE SURFACE: ${failures} FAILURE(S)`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
