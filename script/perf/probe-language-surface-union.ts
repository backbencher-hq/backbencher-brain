#!/usr/bin/env npx tsx
/**
 * probe-language-surface-union.ts — the website's language dataset vs the engine registry.
 *
 * Why this exists: `script/m56/verify-languages-surface.ts` owns this contract, but it
 * IMPORTS website/src/data/brain-languages.ts, which imports `react-icons/*` and
 * `lucide-react` — and those packages are not installed in this checkout, so that gate dies
 * with `Cannot find module 'react-icons/si'` before any of its dataset checks run. (It still
 * prints its registry line first, which is how its numbers were obtained.) This probe reads
 * the same file as BYTES, with the same row shape the gate parses, so the union can be
 * checked without a React tree.
 *
 * It reports; it does not gate. The gate remains the authority where its dependencies exist.
 *
 * Usage: npx tsx script/perf/probe-language-surface-union.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { languageExtensionEntries } from "../../src/ast/language-detection"

const ENUM = ["calls", "contains", "exports", "extends", "implements", "imports", "instantiates", "overrides", "references", "uses"]

const ROOT = process.cwd()
const langSrc = readFileSync(path.join(ROOT, "website/src/data/brain-languages.ts"), "utf8")

// Same row shape the m56 gate parses (kept identical on purpose so the two agree).
const ROW = /^\s*\{ name: '([^']+)', ext: '([^']*)', ids: \[([^\]]*)\], icon: ([A-Za-z][A-Za-z0-9]*), color: '([^']*)', emits: \[([^\]]*)\], extracts: '([^']*)' \},\s*$/gm
const rows = [...langSrc.matchAll(ROW)].map((m) => ({
  name: m[1]!,
  ids: [...m[3]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
  emits: [...m[6]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
}))

const registry = ASTEngine.supportedLanguageNames()
const siteIds = [...new Set(rows.flatMap((r) => r.ids))]
const missing = registry.filter((l) => !siteIds.includes(l))
const extra = siteIds.filter((l) => !registry.includes(l))
const mismatched = rows.filter((r) => r.emits.some((e) => !ENUM.includes(e)))
const dupes = rows.flatMap((r) => r.ids).filter((id, i, a) => a.indexOf(id) !== i)

const bandsBlock = langSrc.slice(langSrc.indexOf("export const BANDS"), langSrc.indexOf("export const RAILS"))
const bands = [...bandsBlock.matchAll(/\{\s*label: '([^']+)',\s*names: \[([\s\S]*?)\],\s*\}/g)].map((m) => ({
  label: m[1]!,
  names: [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
}))
const bandNames = bands.flatMap((b) => b.names)
const notInExactlyOneBand = rows.map((r) => r.name).filter((n) => bandNames.filter((b) => b === n).length !== 1)

// Analyzer modules: every real-*-analyzer.ts should be claimed by some family's ids.
const analyzerModules = readdirAnalyzers()
// The gate's own alias map, copied rather than invented: the family id is `make` and the
// module is `real-makefile-analyzer.ts`. That one mismatch is also why the doc-truth
// surface counted 47 analyzers with a canonical doc against 48 examined.
const alias: Record<string, string> = { make: "makefile" }
const claimed = new Set(rows.flatMap((r) => r.ids.map((id) => alias[id] ?? id)))
const unclaimedModules = analyzerModules.filter((m) => !claimed.has(m))

console.log(`\nregistry languages      : ${registry.length}`)
console.log(`website families        : ${rows.length}`)
console.log(`website ids (unique)    : ${siteIds.length}`)
console.log(`missing from the site   : ${missing.length ? missing.join(", ") : "(none)"}`)
console.log(`not in the registry     : ${extra.length ? extra.join(", ") : "(none)"}`)
console.log(`ids claimed twice       : ${dupes.length ? [...new Set(dupes)].join(", ") : "(none)"}`)
console.log(`families not in 1 band  : ${notInExactlyOneBand.length ? notInExactlyOneBand.join(", ") : "(none)"}`)
console.log(`emits outside the enum  : ${mismatched.length ? mismatched.map((m) => m.name).join(", ") : "(none)"}`)
console.log(`analyzer modules        : ${analyzerModules.length}`)
console.log(`unclaimed by any family : ${unclaimedModules.length ? unclaimedModules.join(", ") : "(none)"}`)
console.log(
  `\nVERDICT: ${missing.length === 0 && extra.length === 0 && dupes.length === 0 && notInExactlyOneBand.length === 0 && mismatched.length === 0 && unclaimedModules.length === 0 ? "the dataset covers the registry exactly" : "DRIFT"}\n`,
)

function readdirAnalyzers(): string[] {
  const dir = path.join(ROOT, "src/ast")
  return readdirSync(dir)
    .filter((f) => /^real-.*-analyzer\.ts$/.test(f))
    .map((f) => f.replace(/^real-/, "").replace(/-analyzer\.ts$/, ""))
}

void languageExtensionEntries
