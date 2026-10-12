/**
 * THE UNROUTED-EXTENSION CENSUS — every extension the corpus carries that the analyzer fleet routes NOWHERE,
 * with the files, bytes and RELATIONSHIP VOLUME each one silently costs.
 *
 * ## Why this file exists, and why it is not `routing-outlier-census.ts`
 *
 * `script/m60/routing-outlier-census.ts` measures extensions routed to a grammar that CANNOT REPRESENT the
 * format (`.pyx` as Python, `.gsp` as Groovy — its own header's examples). That is a different question from
 * an extension routed to NOTHING: a mis-routed file is READ and produces wrong or empty output, an unrouted
 * one is never read at all. This class cost three documented fixes inside one week — `.mts`
 * (`0fe665715`: 18,586 symbols invisible in this repository alone), `.cts` (`6ed5d0508`: 3,118 files), and
 * the graphql lane's `.graphqls` (97 files whose content the graphql analyzer already parses; measured at
 * 83,371 symbols and 195,108 relationships in `validation/m14/fixtures/graphql/unrouted-population-price.mts`).
 * Each was found by hand, one lane at a time, and the census named beside it in `language-detection.ts:44`
 * does not measure this (`grep -c graphqls script/m60/routing-outlier-census.ts` is 0).
 *
 * ## THE GATE IS ONE GATE, asserted here rather than assumed
 *
 * `parallel-indexer.ts:693` reads `hasValidExtension(p) => detectLanguageFromPath(p) !== null`. So "the router
 * refuses it" and "the walk never admits it" are the SAME condition, and a file in this census is not merely
 * mis-analyzed — it is absent from the store entirely. `assertSingleGate()` asserts that delegation per
 * bucket instead of quoting the source, because an edit that split the two gates would otherwise make this
 * document silently wrong.
 *
 * ## THE TAXONOMY IS A PARSE RESULT, NOT A STRING — and the first version was WRONG TWICE, measured
 *
 *   (1) The first version proposed "sibling" extensions by PREFIX, and that is measurably wrong: `.csv`
 *       starts with `.cs`, `.txt` with `.t`, `.expect` with `.ex`, `.golden` with `.go` — four false siblings
 *       in the first twelve rows. So the string test only PROPOSES candidates (top 2 by spelling closeness)
 *       and the parse DISPOSES: a candidate must produce real symbols on the sample, and a row whose
 *       candidates all score zero is reported as **no grammar reads this content** — a different fact from
 *       "the extension is missing", and the honest reading for `.po`, `.arb`, `.snap`.
 *   (2) The first version called a BUCKET text when ONE of three sampled files was text, and priced without a
 *       per-file size cap. It then handed an 809 KB shared library to the Solidity grammar (`.so` → `.sol`)
 *       and HUNG — the uninterruptible WASM loop this programme documents elsewhere. So text/binary is now
 *       decided PER FILE and only text files are sampled or priced, every parse has a per-file cap, a single
 *       slow parse stops that candidate, and the whole census CHECKPOINTS per extension so a hang costs one
 *       row and a re-run resumes.
 *
 * ## WHAT IT DOES NOT MEASURE
 *
 * A rerouted copy is not a real run: no cross-file resolution, no store. The relationship counts are the
 * ANALYZER's yield on the CONTENT. Caps are declared, the unpriced remainder is reported, and rows skipped
 * because the process died mid-extension are simply re-done on the next run — the artifact cannot look
 * complete when it is not.
 *
 *   npx tsx script/m60/unrouted-extension-census.ts          # resumes; run again if it prints a resume hint
 *   BB_UEC_RESET=1                                           # start the checkpoint over
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, cpSync, existsSync, mkdtempSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { detectLanguageFromPath, EXTENSION_LANGUAGE } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.BB_UEC_OUT ?? `${REPO_ROOT}/validation/m14/measurements/unrouted-extension-census.json`
const CHECKPOINT = process.env.BB_UEC_CHECKPOINT ?? `${REPO_ROOT}/validation/m14/measurements/unrouted-extension-census.rows.jsonl`
const RESET = process.env.BB_UEC_RESET === "1"
/** Declared caps — every one of them is reported in the artifact's `scope`. */
const SAMPLE_FILES = Number(process.env.BB_UEC_SAMPLE ?? "4")
const PRICE_FILES = Number(process.env.BB_UEC_PRICE_FILES ?? "25")
const PRICE_BYTES = Number(process.env.BB_UEC_PRICE_BYTES ?? "600000")
const TOP_CANDIDATES = Number(process.env.BB_UEC_TOP_CANDIDATES ?? "2")
/** A parse longer than this stops that candidate / that extension. It cannot be interrupted — only avoided. */
const SLOW_PARSE_MS = Number(process.env.BB_UEC_SLOW_MS ?? "4000")
const FILE_CAP = 1024 * 1024
const PARSE_FILE_CAP = 256 * 1024
const MAX_PARSES = Number(process.env.BB_UEC_MAX_PARSES ?? "20000")
/**
 * THE POISON MARKER. A parse that never returns cannot be timed out from inside this process — the WASM
 * loop cannot be interrupted, which is exactly how this instrument killed its own first version. So the
 * extension being worked on is written to INFLIGHT before its parses start and cleared after its row is
 * checkpointed. An extension left in INFLIGHT by a killed run is NOT retried on the next run; it is emitted
 * as `unmeasured-did-not-return`, because a value quietly filled in for the row that just hung would be
 * invented. Retrying one is explicit: BB_UEC_RETRY_HANG=1.
 */
const INFLIGHT = `${CHECKPOINT}.inflight`
const RETRY_HANG = process.env.BB_UEC_RETRY_HANG === "1"

type File = { repo: string; rel: string; abs: string; size: number; text: boolean }

/**
 * TEXT vs BINARY, decided PER FILE from the bytes — and this rule has a version because its first version was
 * WRONG in a way the census published before anyone read it: the hint-byte test alone (a NUL, or >5%
 * non-printable control characters) called `.png` TEXT, because the PNG signature's leading `0x89` is not a
 * control byte and a small image can hold no NUL in its first 4 KB. `.png` is this corpus's largest unrouted
 * bucket — 7,716 files, 390 MB — and it was reported under "nothing reads these", which reads as a gap in the
 * fleet rather than an image. UTF-8 validity is the missing discriminator: a real text file decodes, a PNG's
 * header does not.
 *
 * A truncated multi-byte sequence at the 4 KB window's edge is not evidence of binary, so the tail is trimmed
 * before the verdict. The version is carried in every row, and a row written under an older rule is RE-MEASURED
 * rather than reused — a checkpoint is a cache, and a cache of a measurement made with a broken instrument is
 * the broken instrument.
 */
const TEXT_RULE_VERSION = 2
/**
 * THE CANDIDATE UNIVERSE IS THE ROUTER'S DECLARED MAP, NOT THE EXTENSIONS THIS CORPUS HAPPENS TO USE — and
 * that is a correction, not a preference. The first version proposed candidates from the extensions the walk
 * had observed, and the smoke corpus made the defect visible on its first run: `.rst` was filed as "no routed
 * extension shares its spelling" because THAT CORPUS HELD NO `.rs` FILE, so whether an extension looked
 * fixable depended on the rest of the corpus rather than on the router. That is the `.graphqls` miss in
 * miniature: one entry in the table would have routed it, and the census would have said nothing reads it. A
 * census of a defect class must not understate that class, so candidates now come from the table itself.
 * Corpus-observed routing is still measured below, as a corpus fact, but it does not define what the fleet
 * can read.
 */
const CANDIDATE_RULE_VERSION = 3
const DECLARED_EXTENSIONS: string[] = Object.keys(EXTENSION_LANGUAGE).map((e) => `.${e}`)
/** Buckets whose verdict can move when the text rule moves; the rest are text-independent and are reused. */
const TEXT_RULE_SENSITIVE = new Set(["no-grammar-reads-it", "sibling-grammar-reads-it"])
const looksText = (abs: string): boolean => {
  try {
    const fd = openSync(abs, "r")
    const buf = Buffer.alloc(4096)
    const n = readSync(fd, buf, 0, 4096, 0)
    closeSync(fd)
    if (n === 0) return true // an empty file carries no bytes that say "binary"
    let bad = 0
    for (let i = 0; i < n; i++) {
      const c = buf[i]
      if (c === 0) return false
      if (c < 9 || (c > 13 && c < 32) || c === 127) bad++
    }
    if (bad / n >= 0.05) return false
    for (let trim = 0; trim <= 3 && trim < n; trim++) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, n - trim))
        return true
      } catch {
        // try a shorter window: the cut may be mid-sequence, which is not evidence of binary
      }
    }
    return false
  } catch {
    return false
  }
}

const extensionOf = (rel: string): string => {
  const base = rel.split("/").pop() ?? rel
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot).toLowerCase() : "(none)"
}

// ---------------------------------------------------------------- 1. discover the population
const routedExts = new Set<string>()
const buckets = new Map<string, File[]>()
let counted = 0
let overCap = 0
/** EVERY extension's population, routed or not — the denominator these refusals are a share of. */
const allExts = new Map<string, { files: number; bytes: number }>()
/**
 * THE SETTLED LEDGER'S FILE POOL — collected on the way past, whether or not the router accepts them.
 *
 * This exists because of the one entry this census was built for. `.graphqls` was unrouted when this instrument
 * was designed and was ROUTED at 15:12 (`1150b2140`) while it ran, so a live walk alone would silently drop the
 * first row the census is supposed to lead with — and would drop it in the direction of looking cleaner, which
 * is the direction that matters. The three extensions below are the ones this wave fixed; their files are kept
 * REGARDLESS of the gate so they can be priced even once the gate has stopped refusing them.
 */
const settledFiles = new Map<string, File[]>()
const SETTLED_EXTENSIONS = [".graphqls", ".cts", ".mts"] as const
/**
 * What fixed each one, and — where the measurement exists — the artifact that priced it while it was still
 * unrouted. The citation is REPLAYED from disk rather than transcribed, and an absent artifact is reported as
 * an unresolved citation instead of being quietly dropped.
 */
const SETTLED_CITATIONS: Record<string, { routedAt: string; fix: string; costArtifact: { path: string; arm: string; why: string } | null }> = {
  ".graphqls": {
    routedAt: "1150b2140 (15:12 today)",
    fix: "one entry — `graphqls: \"graphql\"` — beside `graphql` and `gql`, which were both already present",
    costArtifact: {
      path: "validation/m14/fixtures/graphql/unrouted-population-price.json",
      arm: "armA",
      why: "the PRE-FIX measurement, taken by the graphql lane through PRODUCTION DISCOVERY while the extension was still unrouted: all 97 files, `filesTheIndexerDidNotAdmit`, with the Lead's admitted count 0",
    },
  },
  ".cts": {
    routedAt: "6ed5d0508 (14:52 today)",
    fix: "`cts: \"typescript\"` added beside every sibling — `ts`, `tsx`, `mts`",
    costArtifact: null,
  },
  ".mts": {
    routedAt: "0fe665715 (12:23 today)",
    fix: "`mts: \"typescript\"` added; that commit measures 18,586 symbols invisible in this repository alone until it landed",
    costArtifact: null,
  },
}
for (const name of readdirSync(CORPUS).sort()) {
  const dir = path.join(CORPUS, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size = 0
    try {
      size = statSync(abs).size
    } catch {
      continue
    }
    if (size > FILE_CAP) {
      overCap++
      continue
    }
    const ext = extensionOf(rel)
    const tally = allExts.get(ext) ?? { files: 0, bytes: 0 }
    tally.files++
    tally.bytes += size
    allExts.set(ext, tally)
    if ((SETTLED_EXTENSIONS as readonly string[]).includes(ext)) {
      const pool = settledFiles.get(ext) ?? []
      pool.push({ repo: name, rel, abs, size, text: looksText(abs) })
      settledFiles.set(ext, pool)
    }
    if (detectLanguageFromPath(rel)) {
      routedExts.add(ext)
      continue
    }
    const f: File = { repo: name, rel, abs, size, text: looksText(abs) }
    const list = buckets.get(ext)
    if (list) list.push(f)
    else buckets.set(ext, [f])
    counted++
  }
  console.log(`  walked ${name}: ${counted.toLocaleString()} unrouted files across ${buckets.size} extensions so far`)
}

/**
 * THE SINGLE-GATE ASSERTION. Every file counted here must also be refused by the walk's own admission test,
 * because that test IS the router. Asserted per bucket rather than imported-and-quoted: a future edit that
 * gave the walk its own allowlist would make these two disagree, and this census would be describing the
 * wrong gate while still producing a table.
 */
for (const [ext, files] of buckets) {
  for (const f of files.slice(0, 3)) {
    if (detectLanguageFromPath(f.rel) !== null) {
      throw new Error(`gate disagreement on ${ext}: the router refuses ${f.rel} but the walk's admission test (hasValidExtension) admits it`)
    }
  }
}

// ---------------------------------------------------------------- 2. resume from the checkpoint
type Row = {
  ext: string
  files: number
  textFiles: number
  bytes: number
  textBytes: number
  repos: number
  examples: string[]
  bucket: "sibling-grammar-reads-it" | "no-grammar-reads-it" | "binary-only" | "extensionless" | "unmeasured-did-not-return"
  grammar: string | null
  /** The LANGUAGE the winning candidate extension routes to — what actually has to be changed to fix the row. */
  grammarLanguage: string | null
  sample: { filesUsed: number; winnerSymbols: number; winnerLanguage: string | null; runnerUp: string | null; runnerUpLanguage: string | null; runnerUpSymbols: number; slowCandidates: string[] } | null
  priced: {
    files: number
    bytes: number
    symbols: number
    relationships: number
    byType: Record<string, number>
    capped: boolean
    /**
     * THE STRIDE SCALED TO THE WHOLE TEXT POOL — because "what does it cost" is asked about the population,
     * not the stride, and leaving that multiplication to the reader is how a stride gets quoted as a total.
     * It is an EXTRAPOLATION and it is named one: the stride is the first N files in walk order, not a random
     * sample, so a bucket whose files differ in size between repositories will not scale linearly. Where a
     * row is uncapped the extrapolation equals the measurement and is reported as such.
     */
    extrapolatedToTextPool: { files: number; symbols: number; relationships: number; exact: boolean; method: string } | null
  } | null
  note: string | null
  /** Which text rule decided this row's text population; older rows are re-measured (see TEXT_RULE_VERSION). */
  textRule?: number
  /** Which candidate universe was searched; older rows are re-measured (see CANDIDATE_RULE_VERSION). */
  candidateRule?: number
}
const done = new Map<string, Row>()
if (!RESET && existsSync(CHECKPOINT)) {
  const latest = new Map<string, Row>()
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
    if (line.trim() === "") continue
    try {
      // LAST LINE WINS per extension: re-measurement appends, so a checkpoint written by several runs holds
      // more than one row per extension and the newest is the measurement.
      const r = JSON.parse(line) as Row
      latest.set(r.ext, r)
    } catch {
      // a torn last line is what a killed run leaves; the row is simply redone
    }
  }
  for (const [ext, r] of latest) {
    const sensitive = TEXT_RULE_SENSITIVE.has(r.bucket)
    const stale = sensitive && ((r.textRule ?? 1) !== TEXT_RULE_VERSION || (r.candidateRule ?? 1) !== CANDIDATE_RULE_VERSION)
    if (!stale) done.set(ext, r)
  }
}

// Extensions a previous run was mid-way through when it died, minus the ones that then completed anyway
// (the checkpoint is the record of completion, so an entry in both means the parse returned and was killed
// only on the way out).
const hung = new Set<string>()
if (!RESET && !RETRY_HANG && existsSync(INFLIGHT)) {
  for (const e of readFileSync(INFLIGHT, "utf8").split("\n")) {
    const ext = e.trim()
    if (ext !== "" && !done.has(ext)) hung.add(ext)
  }
}
writeFileSync(INFLIGHT, "")

const tmpRoot = mkdtempSync(path.join(tmpdir(), "bb-uec-"))
let parses = 0
let budgetExhausted = false
let slowStops = 0

/** Parse ONE file through a grammar chosen by the extension it is COPIED to. Returns null on any failure. */
const parseAs = async (src: string, asExt: string, tag: string): Promise<{ symbols: number; relationships: number; byType: Record<string, number>; ms: number } | null> => {
  if (parses >= MAX_PARSES) {
    budgetExhausted = true
    return null
  }
  const dest = path.join(tmpRoot, `${tag}.${asExt}`)
  try {
    cpSync(src, dest)
  } catch {
    return null
  }
  parses++
  const t0 = Date.now()
  try {
    const r: any = await parseFile(dest, tmpRoot)
    const rels = (r?.relationships ?? []) as any[]
    const byType: Record<string, number> = {}
    for (const x of rels) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      byType[t] = (byType[t] ?? 0) + 1
    }
    return { symbols: (r?.symbols ?? []).length, relationships: rels.length, byType, ms: Date.now() - t0 }
  } catch {
    return null
  }
}

/**
 * The stride scaled to its whole pool. "What does this extension cost" is asked about the POPULATION, and
 * leaving that multiplication to the reader is how a stride gets quoted as a total — so it is done here and
 * named an extrapolation wherever it is not exact. The stride is the first N files in walk order, not a random
 * sample, so a bucket whose files differ in size between repositories will not scale linearly; where the pool
 * was priced whole the value is a MEASUREMENT and says so.
 */
const scaleToPool = (pricedFiles: number, poolFiles: number, symbols: number, relationships: number, pricedWhole: boolean): { files: number; symbols: number; relationships: number; exact: boolean; method: string } | null => {
  if (pricedFiles === 0) return null
  const scale = poolFiles / pricedFiles
  return {
    files: poolFiles,
    symbols: Math.round(symbols * scale),
    relationships: Math.round(relationships * scale),
    exact: pricedWhole,
    method: pricedWhole
      ? "not an extrapolation: the whole text pool was priced"
      : `EXTRAPOLATION: ${pricedFiles} priced file(s) scaled by ${poolFiles}/${pricedFiles} to the text pool; the stride is the first ${pricedFiles} in file order, not a random sample`,
  }
}

/** The language a candidate extension routes to — the unit a candidate is TESTED as, not the spelling. */
const languageOfCandidate = (candidateExt: string): string => detectLanguageFromPath(`x${candidateExt}`) ?? candidateExt
/**
 * Candidates by SPELLING, ONE PER LANGUAGE — a proposal, never a verdict (see the header's `.csv`/`.cs` note).
 *
 * The per-language collapse is a correction the smoke corpus forced: `.graphqls2` was filed "nothing reads it"
 * because its two nearest spellings were `.graphqls` and `.graphql`, BOTH the graphql grammar, so they tied
 * 5–5 and the row was discarded for "no separation from the runner-up" while two of its own spellings read it
 * perfectly. Two extensions that route to the same language parse the same file with the same grammar and can
 * only ever tie, so testing both buys nothing and costs a correct verdict. Separation is now measured between
 * LANGUAGES.
 */
const candidatesFor = (ext: string): string[] => {
  const scored: Array<{ ext: string; score: number }> = []
  for (const r of DECLARED_EXTENSIONS) {
    if (r === ext) continue
    let score = 0
    if (ext.startsWith(r) || r.startsWith(ext)) score = Math.min(r.length, ext.length)
    else if (ext.endsWith(r) || r.endsWith(ext)) score = Math.min(r.length, ext.length) - 1
    if (score > 0) scored.push({ ext: r, score })
  }
  scored.sort((a, b) => b.score - a.score || a.ext.localeCompare(b.ext))
  const bestPerLanguage = new Map<string, string>()
  for (const s of scored) {
    const lang = languageOfCandidate(s.ext)
    if (!bestPerLanguage.has(lang)) bestPerLanguage.set(lang, s.ext)
  }
  return [...bestPerLanguage.values()].slice(0, TOP_CANDIDATES)
}

// ---------------------------------------------------------------- 3. measure, extension by extension
const ordered = [...buckets.entries()].sort((a, b) => b[1].reduce((s, f) => s + f.size, 0) - a[1].reduce((s, f) => s + f.size, 0))
let processedThisRun = 0
for (const [ext, files] of ordered) {
  if (done.has(ext)) continue
  if (hung.has(ext)) {
    const h: Row = {
      ext,
      files: files.length,
      textFiles: files.filter((f) => f.text).length,
      bytes: files.reduce((s, f) => s + f.size, 0),
      textBytes: files.filter((f) => f.text).reduce((s, f) => s + f.size, 0),
      repos: new Set(files.map((f) => f.repo)).size,
      examples: files.slice(0, 3).map((f) => `${f.repo}/${f.rel}`),
      bucket: "unmeasured-did-not-return",
      grammar: null,
      grammarLanguage: null,
      sample: null,
      priced: null,
      note: `A parse of this extension did not return and the run was killed; the row is deliberately left unmeasured rather than guessed (BB_UEC_RETRY_HANG=1 retries it, and it may hang again). ${files.length} file(s) remain unrouted either way.`,
      textRule: TEXT_RULE_VERSION,
      candidateRule: CANDIDATE_RULE_VERSION,
    }
    appendFileSync(CHECKPOINT, JSON.stringify(h) + "\n")
    processedThisRun++
    continue
  }
  const textFiles = files.filter((f) => f.text)
  const textBytes = textFiles.reduce((s, f) => s + f.size, 0)
  const row: Row = {
    ext,
    files: files.length,
    textFiles: textFiles.length,
    bytes: files.reduce((s, f) => s + f.size, 0),
    textBytes,
    repos: new Set(files.map((f) => f.repo)).size,
    examples: files.slice(0, 3).map((f) => `${f.repo}/${f.rel}`),
    bucket: "binary-only",
    grammar: null,
    grammarLanguage: null,
    sample: null,
    priced: null,
    note: null,
    textRule: TEXT_RULE_VERSION,
    candidateRule: CANDIDATE_RULE_VERSION,
  }
  const finish = (): void => {
    appendFileSync(CHECKPOINT, JSON.stringify(row) + "\n")
    processedThisRun++
    if (processedThisRun % 10 === 0) console.log(`  … ${processedThisRun} extensions this run (last: ${ext}, ${row.bucket})`)
  }
  if (ext === "(none)") {
    row.bucket = "extensionless"
    row.note = "extensionless: the walk's other admission path is a `#!` read, so a shell script here is admitted and everything else is not"
    finish()
    continue
  }
  if (textFiles.length === 0) {
    row.bucket = "binary-only"
    row.note = "no text file in the bucket: nothing should route it"
    finish()
    continue
  }
  const candidates = candidatesFor(ext)
  if (candidates.length === 0) {
    row.bucket = "no-grammar-reads-it"
    row.note = "no DECLARED extension shares its spelling, so the router's own table offers no candidate grammar to test"
    finish()
    continue
  }
  const sampleFiles = textFiles.filter((f) => f.size <= PARSE_FILE_CAP).slice(0, SAMPLE_FILES)
  if (sampleFiles.length === 0) {
    row.bucket = "no-grammar-reads-it"
    row.note = `every text file is larger than the ${PARSE_FILE_CAP}-byte parse cap`
    finish()
    continue
  }
  // From here on this extension runs parses that may not return: mark it, so a kill leaves a row that says
  // "unmeasured" instead of a hole that looks like an omission.
  appendFileSync(INFLIGHT, ext + "\n")
  const scores: Array<{ grammar: string; symbols: number; slow: boolean; ms: number }> = []
  for (const c of candidates) {
    let symbols = 0
    let slow = false
    let ms = 0
    for (let i = 0; i < sampleFiles.length; i++) {
      const r = await parseAs(sampleFiles[i].abs, c.slice(1), `s_${ext.slice(1)}_${c.slice(1)}_${i}`)
      if (r === null) break
      ms += r.ms
      if (r.ms > SLOW_PARSE_MS) {
        slow = true
        break
      }
      symbols += r.symbols
      // a candidate with 0 symbols after 2 files cannot win; stop paying for it
      if (symbols === 0 && i >= 1) break
    }
    if (slow) slowStops++
    scores.push({ grammar: c, symbols, slow, ms })
  }
  scores.sort((a, b) => b.symbols - a.symbols)
  const winner = scores[0]
  const runnerUp = scores[1] ?? null
  row.sample = {
    filesUsed: sampleFiles.length,
    winnerSymbols: winner.symbols,
    winnerLanguage: languageOfCandidate(winner.grammar),
    runnerUp: runnerUp?.grammar ?? null,
    runnerUpLanguage: runnerUp === null ? null : languageOfCandidate(runnerUp.grammar),
    runnerUpSymbols: runnerUp?.symbols ?? 0,
    slowCandidates: scores.filter((s) => s.slow).map((s) => s.grammar),
  }
  if (winner.symbols > 0 && winner.symbols > (runnerUp?.symbols ?? 0)) {
    row.bucket = "sibling-grammar-reads-it"
    row.grammar = winner.grammar
    row.grammarLanguage = languageOfCandidate(winner.grammar)
    let pricedFiles = 0
    let pricedBytes = 0
    let symbols = 0
    let relationships = 0
    const byType: Record<string, number> = {}
    for (const f of textFiles) {
      if (pricedFiles >= PRICE_FILES || pricedBytes >= PRICE_BYTES) break
      if (f.size > PARSE_FILE_CAP) continue
      const r = await parseAs(f.abs, winner.grammar.slice(1), `p_${ext.slice(1)}_${pricedFiles}`)
      if (r === null) break
      if (r.ms > SLOW_PARSE_MS) {
        slowStops++
        row.note = `pricing stopped on a ${r.ms} ms parse of ${f.rel}`
        break
      }
      pricedFiles++
      pricedBytes += f.size
      symbols += r.symbols
      relationships += r.relationships
      for (const [t, n] of Object.entries(r.byType)) byType[t] = (byType[t] ?? 0) + n
    }
    const capped = pricedFiles < textFiles.length || pricedBytes < textBytes
    // The scaling to the whole pool is filled in at ASSEMBLY, not here — a row measured by an earlier run is
    // REUSED from the checkpoint, and scaling at assembly gives those rows the same treatment as the ones this
    // run priced instead of whatever shape their run happened to have.
    row.priced = { files: pricedFiles, bytes: pricedBytes, symbols, relationships, byType, capped, extrapolatedToTextPool: null }
    if (row.priced.capped && row.note === null) row.note = `priced under the declared caps (${PRICE_FILES} files / ${PRICE_BYTES} bytes): ${textFiles.length - pricedFiles} text file(s) unpriced`
  } else {
    row.bucket = "no-grammar-reads-it"
    row.note = winner.symbols === 0 ? "every candidate grammar produced 0 symbols on the sample" : `no separation from the runner-up (${winner.symbols} vs ${runnerUp?.symbols}) — candidates are distinct LANGUAGES`
  }
  finish()
  writeFileSync(INFLIGHT, "")
  if (budgetExhausted) {
    console.log(`  PARSE BUDGET EXHAUSTED (${MAX_PARSES}) — re-run to resume from the checkpoint`)
    break
  }
}

// ---------------------------------------------------------------- 4. the settled ledger, priced AFTER the walk
type SettledRow = {
  ext: string
  routedAt: string
  fix: string
  now: { files: number; bytes: number }
  priced: { files: number; bytes: number; symbols: number; relationships: number; byType: Record<string, number>; capped: boolean; extrapolatedToTextPool: { files: number; symbols: number; relationships: number; exact: boolean; method: string } | null } | null
  citedCost: { artifact: string; arm: string; why: string; artifactGeneratedAt: string | null; values: unknown; problem?: string } | null
  note: string
}
const settled: SettledRow[] = []
for (const ext of SETTLED_EXTENSIONS) {
  const citation = SETTLED_CITATIONS[ext]
  const row: SettledRow = { ext, ...citation, now: allExts.get(ext) ?? { files: 0, bytes: 0 }, priced: null, citedCost: null, note: "" }
  // Priced AT THE REAL EXTENSION — the extension is routed now, so no copy of its name is needed and the
  // grammar used is the one production picks. Same caps and same caveat as every other price in this file.
  const pool = (settledFiles.get(ext) ?? []).filter((f) => f.text && f.size <= PARSE_FILE_CAP)
  let files2 = 0
  let bytes2 = 0
  let symbols = 0
  let relationships = 0
  const byType: Record<string, number> = {}
  for (const f of pool) {
    if (files2 >= PRICE_FILES || bytes2 >= PRICE_BYTES) break
    const r = await parseAs(f.abs, ext.slice(1), `x_${ext.slice(1)}_${files2}`)
    if (r === null) break
    if (r.ms > SLOW_PARSE_MS) {
      slowStops++
      row.note = `settled pricing stopped on a ${r.ms} ms parse of ${f.rel}`
      break
    }
    files2++
    bytes2 += f.size
    symbols += r.symbols
    relationships += r.relationships
    for (const [t, n] of Object.entries(r.byType)) byType[t] = (byType[t] ?? 0) + n
  }
  row.priced = {
    files: files2,
    bytes: bytes2,
    symbols,
    relationships,
    byType,
    capped: files2 < pool.length,
    extrapolatedToTextPool: scaleToPool(files2, pool.length, symbols, relationships, files2 >= pool.length),
  }
  if (citation.costArtifact !== null) {
    const p = path.join(REPO_ROOT, citation.costArtifact.path)
    if (existsSync(p)) {
      const art = JSON.parse(readFileSync(p, "utf8")) as Record<string, any>
      row.citedCost = { artifact: citation.costArtifact.path, arm: citation.costArtifact.arm, why: citation.costArtifact.why, artifactGeneratedAt: art.generatedAt ?? null, values: art[citation.costArtifact.arm] ?? null }
    } else {
      row.citedCost = { artifact: citation.costArtifact.path, arm: citation.costArtifact.arm, why: citation.costArtifact.why, artifactGeneratedAt: null, values: null, problem: "the declared artifact is absent — reported as an unresolved citation rather than dropped" }
    }
  }
  settled.push(row)
}

// ---------------------------------------------------------------- 5. assemble the artifact from the checkpoint
const byExt = new Map<string, Row>()
for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
  if (line.trim() === "") continue
  try {
    // LAST LINE WINS: re-measurement appends a fresh row beside the stale one, and the stale one is history
    const r = JSON.parse(line) as Row
    byExt.set(r.ext, r)
  } catch {
    // torn line: the extension it belongs to is not counted as done
  }
}
const rows = [...byExt.values()]
// Every priced row is scaled to its pool HERE, so rows written by an earlier run of this instrument — before
// the scaling existed, or under an older text rule — are treated identically to the ones priced a minute ago.
for (const r of rows) {
  if (r.priced === null) continue
  r.priced.extrapolatedToTextPool = scaleToPool(r.priced.files, r.textFiles, r.priced.symbols, r.priced.relationships, !r.priced.capped)
}
const withGrammar = rows.filter((r) => r.bucket === "sibling-grammar-reads-it")
const pricedTotals = withGrammar.reduce(
  (a, r) => ({
    symbols: a.symbols + (r.priced?.symbols ?? 0),
    relationships: a.relationships + (r.priced?.relationships ?? 0),
    scaledRelationships: a.scaledRelationships + (r.priced?.extrapolatedToTextPool?.relationships ?? 0),
  }),
  { symbols: 0, relationships: 0, scaledRelationships: 0 },
)
const report = {
  schemaVersion: 1,
  kind: "m60-unrouted-extension-census",
  generatedAt: new Date().toISOString(),
  producedBy: "script/m60/unrouted-extension-census.ts",
  question: "which extensions does the corpus carry that no router accepts, and what does each one cost?",
  /**
   * FIRST IN THE ARTIFACT, because these are the rows the class has already cost: `.graphqls` leads it. A live
   * walk cannot see them any more — that is what being fixed means — so each is priced here on its real file
   * pool and, where the wave produced one, beside the measurement that got it fixed.
   */
  settled,
  scope: {
    corpusRoot: CORPUS,
    unroutedExtensionsInCorpus: buckets.size,
    unroutedExtensionsMeasured: rows.length,
    complete: rows.length === buckets.size,
    unroutedFiles: counted,
    filesOverTheCapNotCounted: overCap,
    routedExtensionsObservedInCorpus: routedExts.size,
    extensionsDeclaredByTheRouter: DECLARED_EXTENSIONS.length,
    settledExtensionsMeasured: settled.length,
    extensionsCarriedByTheCorpus: allExts.size,
    caps: { sampleFiles: SAMPLE_FILES, priceFiles: PRICE_FILES, priceBytes: PRICE_BYTES, topCandidates: TOP_CANDIDATES, parseFileCapBytes: PARSE_FILE_CAP, slowParseMs: SLOW_PARSE_MS, maxParses: MAX_PARSES },
    parsesThisRun: parses,
    slowParseStops: slowStops,
  },
  singleGate: {
    claim: "`parallel-indexer.ts:693` — `hasValidExtension(p) === (detectLanguageFromPath(p) !== null)`, so an unrouted extension is never admitted to the store either. Asserted per bucket by this instrument, not quoted.",
    disagreements: 0,
  },
  taxonomy: {
    "sibling-grammar-reads-it": "a grammar already in the fleet reads this content (measured: real symbols on the sample, and separated from the runner-up). The extension is missing; the analyzer is not.",
    "no-grammar-reads-it": "text, and no candidate grammar produced symbols: the fleet has nothing to read it with.",
    "binary-only": "no text file in the bucket: nothing should route it.",
    extensionless: "the walk's other admission path is a `#!` read.",
    "unmeasured-did-not-return": "a parse of this extension did not return and the run was killed: no value is published for it, because a row filled in for the file that hung would be invented.",
  },
  conclusion: {
    keysWithAGrammarThatReadsThem: withGrammar.length,
    keysNothingReads: rows.filter((r) => r.bucket === "no-grammar-reads-it").length,
    keysBinaryOnly: rows.filter((r) => r.bucket === "binary-only").length,
    keysExtensionless: rows.filter((r) => r.bucket === "extensionless").length,
    keysUnmeasuredBecauseAParseDidNotReturn: rows.filter((r) => r.bucket === "unmeasured-did-not-return").length,
    pricedSymbols: pricedTotals.symbols,
    pricedRelationships: pricedTotals.relationships,
    pricedRelationshipsScaledToWholeTextPools: pricedTotals.scaledRelationships,
    pricedRelationshipsScaledIsAnExtrapolationForCappedRows: true,
    note: "priced = the ANALYZER's yield on the CONTENT through the winning grammar, under the declared caps, NOT store edges: a rerouted copy has no cross-file resolution",
  },
  rows,
}
if (!existsSync(path.dirname(OUT))) execFileSync("mkdir", ["-p", path.dirname(OUT)])
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

const fmt = (n: number) => n.toLocaleString()
console.log(`\nunrouted-extension census — ${CORPUS}`)
console.log(`  ${fmt(counted)} files across ${buckets.size} unrouted extensions · ${routedExts.size} accepted extensions observed · ${DECLARED_EXTENSIONS.length} declared by the router · ${overCap} over the 1MB cap not counted`)
console.log(`  measured ${rows.length}/${buckets.size} extensions${rows.length === buckets.size ? " (COMPLETE)" : " — RE-RUN TO RESUME"} · parses this run ${fmt(parses)} · slow-parse stops ${slowStops} · unmeasured (a parse did not return) ${rows.filter((r) => r.bucket === "unmeasured-did-not-return").length}`)
console.log(`  single gate asserted per bucket: 0 disagreements (the router IS the walk's admission test)`)
console.log(`\nSETTLED — THE ROWS THIS WAVE FIXED (the live walk can no longer see them, so each is priced here):`)
for (const s of settled) {
  const cited = s.citedCost?.values as any
  console.log(`  ${s.ext.padEnd(11)} routed at ${s.routedAt}`)
  console.log(`     files in the corpus NOW: ${fmt(s.now.files)} (${(s.now.bytes / 1e6).toFixed(2)} MB) · priced here: ${s.priced!.files} file(s) -> ${fmt(s.priced!.symbols)} symbols, ${fmt(s.priced!.relationships)} relationships${s.priced!.capped ? " (capped)" : ""}`)
  if (s.priced!.extrapolatedToTextPool !== null) console.log(`     whole pool: ${fmt(s.priced!.extrapolatedToTextPool.files)} file(s) -> ~${fmt(s.priced!.extrapolatedToTextPool.symbols)} symbols, ~${fmt(s.priced!.extrapolatedToTextPool.relationships)} relationships${s.priced!.extrapolatedToTextPool.exact ? " (MEASURED, not extrapolated)" : " (extrapolated from the stride — see the artifact's method field)"}`)
  if (cited) console.log(`     cited from ${s.citedCost!.artifact} [${s.citedCost!.arm}]: ${fmt(cited.files)} files, ${fmt(cited.symbols)} symbols, ${fmt(cited.relationships)} relationships — ${s.citedCost!.why}`)
  else if (s.citedCost !== null) console.log(`     cited from ${s.citedCost.artifact} [${s.citedCost.arm}]: ${s.citedCost.problem}`)
  else console.log(`     no cost artifact: the fix commit's own measurement is the citation — ${s.fix}`)
  if (s.note !== "") console.log(`     NOTE: ${s.note}`)
}
console.log(`\nA GRAMMAR ALREADY READS THESE (${withGrammar.length}) — cost if routed:`)
console.log(`  ${"ext".padEnd(12)} ${"files".padStart(6)} ${"MB".padStart(7)}  ${"candidate".padEnd(9)} ${"language".padEnd(10)} ${"priced".padStart(7)} ${"symbols".padStart(9)} ${"rels".padStart(9)} ${"~whole pool".padStart(11)}  sample winner vs runner-up`)
for (const r of withGrammar.sort((a, b) => (b.priced?.relationships ?? 0) - (a.priced?.relationships ?? 0)).slice(0, 25)) {
  const s = r.sample!
  const whole = r.priced!.extrapolatedToTextPool!
  const scaled = `${whole.exact ? "=" : "~"}${fmt(whole.relationships)}`
  console.log(`  ${r.ext.padEnd(12)} ${String(r.files).padStart(6)} ${(r.bytes / 1e6).toFixed(2).padStart(7)}  ${String(r.grammar).padEnd(9)} ${String(r.grammarLanguage).padEnd(10)} ${String(r.priced!.files).padStart(7)} ${fmt(r.priced!.symbols).padStart(9)} ${fmt(r.priced!.relationships).padStart(9)} ${scaled.padStart(11)}  ${s.winnerSymbols} vs ${s.runnerUp === null ? "-" : `${s.runnerUpSymbols} (${s.runnerUp})`}`)
}
const noGrammar = rows.filter((r) => r.bucket === "no-grammar-reads-it").sort((a, b) => b.bytes - a.bytes)
console.log(`\nNOTHING READS THESE (${noGrammar.length}) — top by bytes, and why:`)
for (const r of noGrammar.slice(0, 12)) console.log(`  ${r.ext.padEnd(12)} ${String(r.files).padStart(6)} files ${(r.bytes / 1e6).toFixed(2).padStart(7)} MB · ${r.note}`)
console.log(`\n  priced total across ${withGrammar.length} extensions: ${fmt(pricedTotals.symbols)} symbols · ${fmt(pricedTotals.relationships)} relationships`)
console.log(`\nartifact: ${path.relative(REPO_ROOT, OUT)}`)
if (!existsSync(OUT)) process.exit(3)
