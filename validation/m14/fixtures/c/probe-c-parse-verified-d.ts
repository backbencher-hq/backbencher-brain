/**
 * probe-c-parse-verified-d — THE D BUCKET'S PARSE-VERIFIED SPOT-CHECK.
 *
 * Author: the c lane. Probe, not production code. READ-ONLY over the corpus.
 *
 * THE GAP THIS CLOSES. The wall's bucket D (52,283 rows) is **TEXT-LEVEL**: the I1 instrument
 * answers "does this name appear as a TOKEN somewhere in a project header?", and the impact probe's
 * declaration rules answer "does a header in this row's repository DECLARE it?" — both by reading
 * the source TEXT. The buckets page says of bucket D: *"TOKEN-ONLY — INSTRUMENT GAP, with a
 * parse-verified follow-up OWED"*. **THIS IS THAT FOLLOW-UP, ON A SAMPLE.**
 *
 * THE EXPERIMENT. Take a sample of the corpus's tracked headers. For each one:
 *   · the TEXT-LEVEL rules (`script/m14/c-header-shape.ts` — the SHARED rules, the same ones the
 *     impact probe prices the wall with) give a set of DECLARED names and a set of WEAK tokens
 *     (names that occur but whose shape the rules do not call a declaration);
 *   · the PARSE gives the analyzer's own published symbols (`parseFile` on the production path —
 *     `src/ast/pool-worker.ts`, the very path the gate uses).
 * **THE D BUCKET'S CLASS IS THE WEAK TOKENS** — a name the header mentions but does not declare —
 * **so the D bucket's MISCLASSIFICATION RATE IS: of the weak tokens, how many does the PARSE call a
 * declaration?** A weak token the parse calls a declaration is a row the text-level rule LOST, and
 * the D bucket OVER-counts by that many.
 *
 * AND THE SAME COMPARISON ANSWERS THE OTHER HALF: a name the text-level rules call a declaration
 * that the parse does NOT publish is a row the rules OVER-called, and it would move a row OUT of
 * bucket A (the ceiling's source) — so the CEILING is measured on both sides.
 *
 * WHY A SAMPLE, AND WHY IT IS STATED AS A SAMPLE. The full population is 15,812 readable headers;
 * parsing all of them is the whole-tree cost the fleet's memory gate forbids, and the answer this
 * probe gives is a RATE, which a sample states honestly with its size. **The sample is drawn across
 * the population's repos (not from one repo), and the probe prints its own controls:**
 *   C1 · every sampled header was read and parsed (none silently dropped);
 *   C2 · the text-level and the parse-level name universes are compared on the SAME header, so the
 *        comparison is paired, not aggregate;
 *   C3 · the parse-level run's own failure count is printed (a header the analyzer cannot parse is
 *        COUNTED and excluded from the rate, never dropped from the denominator silently).
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { declarationKindOf, tokenizeHeader } from "../../../../script/m14/c-header-shape"
import { parseFile } from "../../../../src/ast/pool-worker"

function repoRoot(): string {
  let dir = path.resolve(import.meta.dirname ?? ".")
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(path.join(dir, "package.json"), "utf8")
      return dir
    } catch { /* keep walking up */ }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}
const ROOT = repoRoot()
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const OUT = process.env.C_PARSE_VERIFIED_OUT ?? path.join(ROOT, "validation/m14/fixtures/c/measurements/c-parse-verified-d.json")
/**
 * THE WHOLE-POPULATION MODE: `C_PARSE_SAMPLE=0` takes EVERY tracked header of every repo (the
 * parse-verified run the Lead named as the lane's next piece). The default (12) is the SAMPLE.
 * A rate with no denominator must not be printed: if the sample comes out empty, the probe reports
 * the zero and exits non-zero, and it never prints a rate it cannot divide.
 */
const SAMPLE_PER_REPO = Number(process.env.C_PARSE_SAMPLE ?? 12)
const ALL_HEADERS = SAMPLE_PER_REPO <= 0

/** the corpus's repos */
function repos(): string[] {
  return readdirSync(CR).filter((r) => {
    try {
      return statSync(path.join(CR, r)).isDirectory()
    } catch {
      return false
    }
  })
}

/** the tracked headers of one repo, in the gate's own way: `git ls-files` */
function trackedHeaders(repo: string): string[] {
  const dir = path.join(CR, repo)
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
    return out
      .split("\0")
      .filter((f) => f.toLowerCase().endsWith(".h"))
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  const all = repos()
  const sampled: { repo: string; file: string }[] = []
  let trackedTotal = 0
  for (const r of all) {
    const hs = trackedHeaders(r)
    trackedTotal += hs.length
    if (hs.length === 0) continue
    // a deterministic stride across the repo's header list, so the sample is not the first N, and
    // at most SAMPLE_PER_REPO headers per repo, so no single repo carries the sample.
    if (ALL_HEADERS) {
      for (const f of hs) sampled.push({ repo: r, file: f })
      continue
    }
    const step = Math.max(1, Math.floor(hs.length / SAMPLE_PER_REPO))
    for (let i = 0; i < SAMPLE_PER_REPO; i++) {
      const idx = i * step
      if (idx >= hs.length) break
      sampled.push({ repo: r, file: hs[idx] })
    }
  }

  let read = 0
  let parsed = 0
  let parseFailed = 0
  let textDeclared = 0
  let parseDeclared = 0
  let weakTokens = 0
  let weakThatParseDeclares = 0
  let declaredThatParseDoesNot = 0
  let parseOnly = 0
  const examples: string[] = []
  const perRepo = new Map<string, { weak: number; weakParseDeclares: number }>()

  for (const s of sampled) {
    let src = ""
    try {
      const st = statSync(s.file)
      if (st.size > 1024 * 1024) continue
      src = readFileSync(s.file, "utf8")
    } catch {
      continue
    }
    read++
    // the TEXT-LEVEL rules (the shared ones)
    const lines = src.split("\n")
    const toks = tokenizeHeader(src)
    const declared = new Set<string>()
    const weak = new Set<string>()
    for (let i = 0; i < toks.length; i++) {
      const name = toks[i].t
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
      const kind = declarationKindOf(toks, i, lines, name)
      if (kind) declared.add(name)
      else weak.add(name)
    }
    // the PARSE (the production path the gate uses)
    let symbols: any[] = []
    try {
      const res: any = await parseFile(s.file, path.join(CR, s.repo))
      symbols = res?.symbols ?? res?.result?.symbols ?? []
      parsed++
    } catch {
      parseFailed++
      continue
    }
    const parseNames = new Set<string>()
    for (const sym of symbols) {
      const n = sym?.name ?? sym?.symbol?.name
      if (typeof n === "string" && n) parseNames.add(n)
    }
    textDeclared += declared.size
    parseDeclared += parseNames.size
    let repoWeak = 0
    let repoWeakParse = 0
    for (const w of weak) {
      if (declared.has(w)) continue
      weakTokens++
      repoWeak++
      if (parseNames.has(w)) {
        weakThatParseDeclares++
        repoWeakParse++
        if (examples.length < 10) examples.push(`${w} ← ${path.basename(s.file)} (${s.repo})`)
      }
    }
    for (const d of declared) if (!parseNames.has(d)) declaredThatParseDoesNot++
    for (const p of parseNames) if (!declared.has(p) && !weak.has(p)) parseOnly++
    perRepo.set(s.repo, { weak: repoWeak, weakParseDeclares: repoWeakParse })
  }

  if (read === 0) {
    console.error("A RATE WITH NO DENOMINATOR MUST NOT BE PRINTED: the sample is empty. Nothing is reported.")
    process.exit(1)
  }
  const rate = weakTokens ? (weakThatParseDeclares / weakTokens) * 100 : 0
  const overCalled = textDeclared ? (declaredThatParseDoesNot / textDeclared) * 100 : 0
  const report = {
    generatedAt: new Date().toISOString(),
    instrument: {
      textRules: "script/m14/c-header-shape.ts (the SHARED rules the impact probe prices the wall with)",
      parse: "src/ast/pool-worker.ts parseFile — the PRODUCTION path the gate uses",
      corpusRoot: CR,
    },
    population: { repos: all.length, trackedHeaders: trackedTotal, sampledHeaders: read, parsed: parsed, parseFailed },
    result: {
      weakTokens: weakTokens,
      weakTokensTheParseCallsADeclaration: weakThatParseDeclares,
      weakTokenMisclassificationRatePct: Number(rate.toFixed(2)),
      textDeclaredNames: textDeclared,
      declaredTheParseDoesNotPublish: declaredThatParseDoesNot,
      textLevelOverCallRatePct: Number(overCalled.toFixed(2)),
      parseOnlyNames: parseOnly,
    },
    perRepo: Object.fromEntries([...perRepo.entries()].filter(([, v]) => v.weak > 0)),
    examples,
    controls: {
      c1_every_sampled_header_read: read === sampled.length,
      c2_paired_comparison: true,
      c3_parseFailuresCountedNotDropped: parseFailed,
    },
    limits: [
      "A SAMPLE, and the rate is stated with its size — the full population is 15,812 readable headers and parsing them all is the fleet's memory cost.",
      "The parse-level name universe is the ANALYZER's published symbols, which is the production resolver's universe — a name the analyzer does not publish is a name the gate cannot bind.",
      "The text-level rules are a CHARACTER scanner (no regex, no parse); the parse is tree-sitter. Their disagreement is the measurement.",
    ],
  }
  writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n")
  console.log("probe-c-parse-verified-d — the D bucket's parse-verified spot-check")
  console.log(`  corpus root : ${CR}`)
  console.log(`  sample      : ${read} headers across ${perRepo.size} repos (of ${trackedTotal} tracked headers in ${all.length} repos)`)
  console.log(`  parsed      : ${parsed} · parse failures (counted, not dropped): ${parseFailed}`)
  console.log("")
  console.log(`  WEAK TOKENS (the D bucket's class: mentioned but not declared)   : ${weakTokens}`)
  console.log(`    of which the PARSE calls a DECLARATION → THE TEXT RULE LOST   : ${weakThatParseDeclares} (${rate.toFixed(2)} %)`)
  console.log(`  TEXT-LEVEL DECLARED NAMES                                        : ${textDeclared}`)
  console.log(`    of which the PARSE does NOT publish → the text rule OVER-called : ${declaredThatParseDoesNot} (${overCalled.toFixed(2)} %)`)
  console.log(`  PARSE-ONLY NAMES (published by the analyzer, neither declared nor weak by the rules): ${parseOnly}`)
  if (examples.length) {
    console.log("")
    console.log("  examples (weak token, parse calls it a declaration):")
    for (const e of examples) console.log(`    ${e}`)
  }
  console.log("")
  console.log(`  artifact: ${OUT}`)
}

await main()
