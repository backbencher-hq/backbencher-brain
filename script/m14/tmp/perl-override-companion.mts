/**
 * PERL-MR14 measurement: what would a cross-file base index do to perl's 3,182
 * first-parent GUESS overrides?
 *
 * The analyzer already reads `context.overrideCompanion` and behaves correctly with
 * it (verified in isolation: guess -> confirmed at 0.95, or withdrawn when the base
 * is known not to declare the method). Nothing ever POPULATES it — the module
 * `src/ast/override-context.ts` has had `buildOverrideCompanion` since it was
 * written, six analyzers import it, and no caller builds one. M37.10 says so in as
 * many words: "it is never populated in production".
 *
 * So the question is not whether the rule is right but what it is worth. This
 * measures it: build the companion from one parse pass over a corpus, re-analyze
 * with it, and count the three outcomes per corpus.
 *
 *   confirmed  0.5 guess -> 0.95 `base-declares-method`   the base declares it
 *   withdrawn  0.5 guess -> no edge at all                 the base does NOT
 *   still-guess  unchanged                                the base is unknown
 *
 * The third number is the honest ceiling: no index can confirm a base that is not
 * in the project, and a corpus is full of stdlib bases.
 */
import * as fs from "fs"
import * as path from "path"
import { buildOverrideCompanion } from "/home/ishaq2321/backbencher-brain/src/ast/override-context"

const ROOT = "/home/ishaq2321/backbencher-brain"
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const p = new P()
p.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm"))))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

const CR = process.env.BB_PERL_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const CORPORA: Record<string, string> = {
  mojo: `${CR}/mojo`,
  plack: `${CR}/plack`,
  Moose: `${CR}/cpan/Moose-2.4000`,
  Moo: `${CR}/cpan/Moo-2.005005`,
  Catalyst: `${CR}/cpan/Catalyst-Runtime-5.90132`,
  DBI: `${CR}/cpan/DBI-1.654`,
  perl5: `${CR}/perl5`,
}
const LIMIT = Number(process.argv[2] ?? 200)

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let es: fs.Dirent[]
  try {
    es = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of es) {
    if (e.name === ".git" || e.name === "build" || e.name === "node_modules") continue
    const q = path.join(dir, e.name)
    if (e.isDirectory()) walk(q, out, depth + 1)
    else if (/\.(pm|pl|t)$/.test(e.name)) out.push(q)
  }
  return out
}

let companionSize = 0
const totals = { before: 0, confirmed: 0, withdrawn: 0, stillGuess: 0, confirmedHigh: 0 }
for (const [name, dir] of Object.entries(CORPORA)) {
  if (!fs.existsSync(dir)) {
    console.log(`  ${name.padEnd(9)} ABSENT`)
    continue
  }
  const files = walk(dir).sort().slice(0, LIMIT)
  const parsed: Array<{ f: string; src: string; root: any; before: any[] }> = []
  // PASS 1 — parse and analyze with no companion (today's production behaviour).
  for (const f of files) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    let root: any
    let r: any
    try {
      root = p.parse(src).rootNode
      r = new RealPerlAnalyzer().analyze(root, src, f)
    } catch {
      continue
    }
    parsed.push({ f, src, root, before: (r.relationships ?? []).filter((e: any) => e.type === "overrides") })
  }
  // The companion, built from the SAME pass — which is what a real pre-pass gives.
  const allSymbols = parsed.flatMap(({ f, src, root }) => {
    try {
      return new RealPerlAnalyzer().analyze(root, src, f).symbols ?? []
    } catch {
      return []
    }
  })
  const companion = buildOverrideCompanion(allSymbols)
  companionSize = companion.size
  // PASS 2 — re-analyze with it.
  let before = 0, confirmed = 0, withdrawn = 0, stillGuess = 0
  for (const { f, src, root, before: b } of parsed) {
    before += b.length
    let r2: any
    try {
      r2 = new RealPerlAnalyzer().analyze(root, src, f, { overrideCompanion: companion })
    } catch {
      continue
    }
    const after = (r2.relationships ?? []).filter((e: any) => e.type === "overrides")
    const confirmedHere = after.filter((e: any) => e.metadata?.reasonCode === "base-declares-method" && e.confidence >= 0.9).length
    const guessHere = after.filter((e: any) => e.metadata?.reasonCode === "first-parent-guess").length
    confirmed += confirmedHere
    stillGuess += guessHere
    withdrawn += Math.max(0, b.length - confirmedHere - guessHere)
  }
  totals.before += before
  totals.confirmed += confirmed
  totals.withdrawn += withdrawn
  totals.stillGuess += stillGuess
  const pct = before ? (100 * confirmed) / before : 0
  console.log(
    `  ${name.padEnd(9)} files=${String(files.length).padStart(4)}  guesses=${String(before).padStart(5)}  ` +
      `confirmed=${String(confirmed).padStart(5)} (${pct.toFixed(1)}%)  withdrawn=${String(withdrawn).padStart(5)}  still-guess=${String(stillGuess).padStart(5)}`,
  )
}
const t = totals
const share = t.before ? (100 * t.confirmed) / t.before : 0
console.log("")
console.log(`  TOTAL guesses               ${t.before}`)
console.log(`  confirmed at 0.95           ${t.confirmed}  (${share.toFixed(1)}% of guesses)`)
console.log(`  withdrawn (base does not)   ${t.withdrawn}`)
console.log(`  still a guess (base absent) ${t.stillGuess}`)
console.log(`  companion size: ${companionSize} owners`)
console.log(`  (the three outcomes sum to the guess count, which is the invariant that`)
console.log(`   makes the ratio readable: a companion either CONFIRMS a base's method,`)
console.log(`   WITHDRAWS the guess because the base is present and does not declare it,`)
console.log(`   or has no opinion and the guess stands.)`)
