// script/m59/measure-analyzer-surface.ts — what IS the language surface?
//
// Written because `package.json`'s `description` claims "40+ language analyzers"
// and NOTHING in the repo derives or checks that number — the same defect class as
// the regex census that claimed 0 while 55 existed (R2/M12), and the same class as
// a docs page asserting a count no gate maintains.
//
// The FIRST version of this probe inferred the surface from filenames and was
// WRONG in a way worth recording: it matched `wasm/tree-sitter-*.wasm` against
// language names, so csharp (`tree-sitter-c_sharp.wasm`) and objective-c
// (`tree-sitter-objc.wasm`) looked like they had no grammar, and css/hcl/nim/
// protobuf/vb looked undispatched because they are wired outside the engine's
// case-label switch. Filename identity is not product identity.
//
// So this measures EMPIRICALLY instead: for every language the product's own
// detector can name, ask the product's own parser to analyze one minimal file and
// record what comes back. The number in the package description must be a number
// this file produces — never a number typed into prose.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

const SNIPPET: Record<string, string> = {
  default: "// probe\n",
}

function extensionsByLanguage(): Map<string, string[]> {
  // The registry's own mapping, not a copy of it: whatever the detector accepts is
  // what gets probed.
  const out = new Map<string, string[]>()
  const src = readFileSync(path.join(ROOT, "src/ast/language-detection.ts"), "utf8")
  const body = src.slice(src.indexOf("const EXTENSION_LANGUAGE"), src.indexOf("const BASENAME_LANGUAGE"))
  for (const m of body.matchAll(/([a-z0-9_+]+):\s*"([a-z0-9-]+)"/g)) {
    const ext = m[1]
    const lang = m[2]
    if (!out.has(lang)) out.set(lang, [])
    out.get(lang)!.push(ext)
  }
  return out
}

async function main() {
  const { detectLanguageFromPath } = (await import(path.join(ROOT, "src/ast/language-detection.ts"))) as any
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any

  const byLang = extensionsByLanguage()
  const dir = mkdtempSync(path.join(tmpdir(), "surface-"))

  const analyzed: string[] = []
  const failed: Array<{ lang: string; error: string }> = []
  const empty: string[] = []

  for (const [lang, exts] of [...byLang].sort()) {
    const ext = exts[0]
    const file = path.join(dir, `probe.${ext}`)
    const text = SNIPPET[lang] ?? SNIPPET.default
    writeFileSync(file, text)
    const detected = detectLanguageFromPath(file, text)
    if (detected !== lang) {
      failed.push({ lang, error: `detector returned ${detected} for .${ext} (registry says ${lang})` })
      continue
    }
    try {
      const res = await ASTEngine.parseFile(file, text)
      if (res?.language === undefined && res?.relationships === undefined) {
        failed.push({ lang, error: `parseFile returned no result shape: ${Object.keys(res ?? {}).join(",")}` })
      } else if ((res?.relationships?.length ?? 0) === 0 && (res?.symbols?.length ?? 0) === 0) {
        // Parsed, but a minimal file yields nothing — not evidence about support,
        // so it is its own state rather than counted as analyzed or failed.
        empty.push(lang)
        analyzed.push(lang)
      } else {
        analyzed.push(lang)
      }
    } catch (e: any) {
      failed.push({ lang, error: String(e?.message ?? e).slice(0, 120) })
    }
  }

  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const claim = typeof pkg.description === "string" ? pkg.description : ""
  const claimedNumbers = [...claim.matchAll(/(\d+)\+/g)].map((m) => Number(m[1]))

  console.log("=== measured by running the product (detector → parser), one minimal file per language ===")
  console.log(`registry languages probed:        ${byLang.size}`)
  console.log(`analyzed without error:           ${analyzed.length}  (of which a minimal file produced nothing: ${empty.length})`)
  console.log(`FAILED to analyze:                ${failed.length}`)
  if (failed.length > 0) for (const f of failed) console.log(`    ${f.lang.padEnd(14)} ${f.error}`)
  console.log(`\nanalyzed: ${analyzed.sort().join(" ")}`)

  console.log("\n=== the user-facing claim ===")
  console.log(`package.json description: ${JSON.stringify(claim)}`)
  console.log(`numbers written as N+ in it: ${JSON.stringify(claimedNumbers)}`)

  console.log("\n=== analyzer modules on disk (distinct from languages: a module is not a language) ===")
  const { readdirSync } = await import("node:fs")
  const modules = readdirSync(path.join(ROOT, "src/ast")).filter((f) => /^real-.*-analyzer\.ts$/.test(f))
  console.log(`src/ast/real-*-analyzer.ts:       ${modules.length}`)

  console.log(
    `\nRESULT: the only user-facing-readable numbers are ` +
      `${byLang.size} detected languages and ${modules.length} analyzer modules; the claim says ${claimedNumbers.join("/") || "(none)"}.`,
  )
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
