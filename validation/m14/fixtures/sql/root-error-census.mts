/**
 * ROOT-IS-ERROR CENSUS — how many corpus .sql files collapse so far that the file's own ROOT
 * node is an `ERROR`, and how many therefore never reach the statement resync.
 *
 * WHY THIS INSTRUMENT EXISTS. `real-sql-analyzer.ts`'s `resyncNeeded` fires only when some
 * top-level CHILD of the root is an `ERROR` spanning >= RESYNC_ERROR_SPAN_RATIO (0.6) of the
 * file. The grammar's `dollar_quote` node carries only the `$$` delimiter and not the body
 * between the delimiters, so in a file with two or more dollar-quoted bodies every closing
 * `$$` is left dangling. Measured on the minimal repro
 *
 *   CREATE FUNCTION a() RETURNS text LANGUAGE sql AS $$ SELECT 1 $$;
 *   CREATE FUNCTION b() RETURNS text LANGUAGE sql AS $$ SELECT 2 $$;
 *
 * the root node is `ERROR`, not `program`, and its named children are bare `keyword_*`
 * nodes. There is no ERROR CHILD for the trigger to find, so `resyncNeeded` returns false
 * and the file publishes 0 of its 2 declarations through `parseFile`.
 *
 * The two halves are measured separately because they fail separately:
 *   rootIsError   — the file collapsed to the root. The resync cannot trigger on these.
 *   resyncFired   — what the analyzer's own counters say it did with the file.
 *   declarations  — how many `CREATE <object>` heads the TEXT carries, which is the ceiling
 *                   on what a correct parse could have published. Read by splitting on
 *                   semicolons at depth 0 over the raw text, NOT with a regular expression,
 *                   and deliberately an over-count: a head inside a dollar-quoted body is
 *                   counted too, so the figure is an upper bound and never a floor claim.
 *
 * SHARDING, and why the single-process run could not finish. Measured 2026-10-05: one
 * process over the whole corpus reached file 831 in 120 s and file 1402 in 900 s, then the
 * wall-clock budget expired with 491 files unparsed and NO artifact written. The rate is not
 * uniform — it is ~7 files/s over the alphabetically-early repositories and ~1.4 files/s
 * over `phpmyadmin`/`postgrest`, whose fixtures are large — so the cost is a property of the
 * corpus ordering, not of the instrument. `postgrest/test/io/fixtures/big_schema.sql` was
 * checked as the prime suspect and is NOT the cause: parsed alone through the same wasm
 * grammar it takes 948 ms for 100,484 descendants. So this is throughput, not a hang, and a
 * hang is exactly what the earlier claim in this header ("the two files that stall
 * `parser.parse` outright are both larger than this") implied and could not support — the cap
 * does not buy survivability.
 *
 * So the instrument shards, and one shard's death costs one shard rather than the run. The
 * shards are a deterministic round-robin over the SAME sorted list, so the union is the same
 * population a single process would have read and `--shards 1` is bit-identical to the
 * unsharded run. `--merge` sums the per-shard artifacts and states the shard count it merged,
 * because a merged summary whose denominators came from different runs is not a measurement.
 *
 * PER-FILE TIMING is recorded because the doc's standing finding is that this lane's totals are
 * load-sensitive, and an instrument that reports only totals cannot show which file the
 * sensitivity came from. `slowest` names the ten.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/sql/root-error-census.mts --out FILE [--files N]
 *                                                         [--shards N --shard I]
 *   npx tsx validation/m14/fixtures/sql/root-error-census.mts --merge A.json B.json ... \
 *       --out MERGED.json
 */
import { readdirSync, statSync, writeFileSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : undefined
const filesIdx = argv.indexOf("--files")
const FILE_CAP = filesIdx >= 0 ? Number(argv[filesIdx + 1]) : Infinity
const shardsIdx = argv.indexOf("--shards")
const SHARDS = shardsIdx >= 0 ? Number(argv[shardsIdx + 1]) : 1
const shardIdx = argv.indexOf("--shard")
const SHARD = shardIdx >= 0 ? Number(argv[shardIdx + 1]) : 0
const mergeIdx = argv.indexOf("--merge")
const MERGE_INPUTS: string[] = mergeIdx >= 0 ? argv.slice(mergeIdx + 1).filter(a => !a.startsWith("--") && a !== (outIdx >= 0 ? argv[outIdx + 1] : "")) : []
const ROOT = "/home/ishaq2321/mcp/bb-lanes/sql"
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/**
 * Merge per-shard artifacts into one, summing every count and concatenating every row.
 *
 * The rows are re-sorted by file path so the merged artifact does not depend on the order the
 * shards finished in, which is what makes two merged runs comparable byte-for-byte on the
 * measurement fields.
 *
 * It REFUSES to merge a set whose shards disagree about the population — a different
 * `sqlFilesDiscovered`, `sampleStride`, `sizeCapBytes` or corpus root means the shards were not
 * slices of one census, and summing them would produce a number no run produced. Measured need:
 * the first version merged whatever it was handed and one stale shard from an earlier corpus
 * state would have entered the total silently.
 */
function merge(inputs: string[]): void {
  const parts = inputs.map(p => JSON.parse(readFileSync(p, "utf8")))
  const head = parts[0].summary
  for (const p of parts.slice(1)) {
    for (const k of ["corpusRoot", "sqlFilesDiscovered", "sampleStride", "sizeCapBytes"] as const) {
      if (p.summary[k] !== head[k]) {
        console.error(`REFUSING to merge: shard disagrees on ${k} (${JSON.stringify(head[k])} vs ${JSON.stringify(p.summary[k])}) — file ${p.summary.shard}`)
        process.exit(2)
      }
    }
  }
  const summed = {
    corpusRoot: head.corpusRoot,
    sqlFilesDiscovered: head.sqlFilesDiscovered,
    sampleStride: head.sampleStride,
    repositoriesCovered: new Set<string>(),
    filesSampled: 0,
    filesParsed: 0,
    filesOverSizeCap: 0,
    sizeCapBytes: head.sizeCapBytes,
    rootIsError: 0,
    rootIsErrorWithDeclarationHeads: 0,
    declarationHeadsLostInRootErrorFiles: 0,
    shardsMerged: parts.length,
    shardIds: parts.map((p: any) => p.summary.shard),
  }
  const rows: any[] = []
  for (const p of parts) {
    summed.filesSampled += p.summary.filesSampled
    summed.filesParsed += p.summary.filesParsed
    summed.filesOverSizeCap += p.summary.filesOverSizeCap
    summed.rootIsError += p.summary.rootIsError
    summed.rootIsErrorWithDeclarationHeads += p.summary.rootIsErrorWithDeclarationHeads
    summed.declarationHeadsLostInRootErrorFiles += p.summary.declarationHeadsLostInRootErrorFiles
    for (const f of p.summary.filesOfShard ?? []) summed.repositoriesCovered.add(f)
    rows.push(...p.rows)
  }
  summed.repositoriesCovered = summed.repositoriesCovered.size
  rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  const slowest = rows.slice().sort((a, b) => b.ms - a.ms).slice(0, 10)
    .map((r: any) => ({ file: r.file, ms: r.ms, rootType: r.rootType }))
  const out = {
    summary: { ...summed, parseMsTotal: rows.reduce((s: number, r: any) => s + r.ms, 0), slowest },
    rows,
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out.summary, null, 2))
}

if (MERGE_INPUTS.length > 0) {
  merge(MERGE_INPUTS)
  process.exit(0)
}

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(language as any)

/**
 * Corpus .sql files, breadth-first by directory, SORTED so the sample is reproducible.
 *
 * The cap is deliberately NOT applied here. It used to be, and that made `--files 60` return the
 * 60 alphabetically-first files of the alphabetically-first repository — a sample of ONE repo
 * that reported `rootIsError: 0` because it never looked at the other 198. Measured, then fixed:
 * collection is now complete and the cap is applied afterwards, to a deterministic STRIDE.
 */
function collect(dir: string, acc: string[], depth: number): void {
  if (depth > 8) return
  let entries: string[]
  try {
    entries = readdirSync(dir).sort()
  } catch {
    return
  }
  for (const name of entries) {
    if (name === ".git" || name === "node_modules" || name === "target" || name === "dist" || name === "build") continue
    const p = path.join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) collect(p, acc, depth + 1)
    else if (name.endsWith(".sql")) acc.push(p)
  }
}

/**
 * `CREATE <something> <name>` heads at depth 0, outside comments, string literals and
 * dollar-quoted regions. Not a regular expression: the string `CREATE TABLE` inside a `$$ … $$`
 * body is a body statement, not a declaration, and a regex cannot tell the two apart. Depth is
 * tracked by a character walk over comments, quotes and dollar tags instead.
 *
 * It returns the NAMES as well as the count, and the names are what make the loss measurable: a
 * count on one side and a symbol count on the other compares two different things. `name` is the
 * declared object name with any `"` stripped and `IF NOT EXISTS` / `OR REPLACE` skipped; a head
 * whose name cannot be read contributes to the count and carries the name `""`, so
 * `namedHeads` is reported separately from `declHeads` and the gap between them is visible rather
 * than folded into one number.
 *
 * THIS FUNCTION WAS DEAD FROM BIRTH AND EVERY FIGURE IT PRODUCED WAS 0. Measured 2026-10-05:
 * the first full-corpus run reported `rows with declHeads>0: 0 of 1885` — not one file in the
 * corpus carries a single declaration head — and the header above that run described the
 * counter as "deliberately an over-count … an upper bound and never a floor claim". Nine probe
 * inputs were then run through it directly and it returned 0 on all nine, INCLUDING
 * `CREATE TABLE a (id int);\nCREATE TABLE b (id int);`, which is the easiest possible input.
 *
 * The cause was one character. The word boundary was tested as
 * `!/[A-Za-z0-9_]/.test(text[i + 5])`, and `i + 5` is the LAST LETTER of `create` (`c`=0,
 * `r`=1, `e`=2, `a`=3, `t`=4, `e`=5), which is always a letter — so the condition was
 * unsatisfiable and the counter never fired on any input. `CREATE` is six characters, so the
 * character after it is `text[i + 6]`. That is the fix.
 *
 * The second defect was found by the same probe and would have survived the first fix alone: the
 * walk handled `'` `"` and `$tag$` but NOT comments, so a single apostrophe inside a `--` comment
 * (`-- don't`) put the scanner into string-scan mode and swallowed the rest of the file. Corpus
 * migrations are full of those, so on this corpus the over-count would have become an
 * UNDER-count on every file with an apostrophe in a leading comment.
 *
 * `--selftest` exists because a counter that returns 0 for every input is indistinguishable from
 * a corpus with none, and this instrument's own numbers were the only evidence either way. It
 * runs the assertions below and exits non-zero on any failure, so the failure mode cannot recur
 * silently. Verified: the pre-fix function fails the two-bare-declarations case and the
 * apostrophe-in-comment case; the fixed one passes all 9.
 */
function declarationHeads(text: string): { count: number; names: string[] } {
  let n = 0
  let i = 0
  const names: string[] = []
  const lower = text.toLowerCase()
  const isWord = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_]/.test(ch)
  while (i < text.length) {
    const c = text[i]
    // `-- …` to end of line, and `/* … */`. Both are checked BEFORE quotes, because an
    // apostrophe inside a comment is not a string delimiter.
    if (c === "-" && text[i + 1] === "-") {
      const nl = text.indexOf("\n", i)
      i = nl < 0 ? text.length : nl + 1
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2)
      i = close < 0 ? text.length : close + 2
      continue
    }
    if (c === "'" ) {
      i++
      while (i < text.length && text[i] !== "'") i += text[i] === "\\" ? 2 : 1
      i++
      continue
    }
    if (c === '"') {
      i++
      while (i < text.length && text[i] !== '"') i++
      i++
      continue
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(lower.slice(i))
      if (m) {
        const tag = m[0]
        const close = lower.indexOf(tag, i + tag.length)
        if (close < 0) break
        i = close + tag.length
        continue
      }
    }
    // `create` is six characters, so the boundary is `text[i + 6]`. The predecessor check keeps
    // `recreate`/`_create` from matching.
    if (
      (c === "c" || c === "C") &&
      lower.startsWith("create", i) &&
      !isWord(text[i - 1]) &&
      (text[i + 6] === undefined || /[ \t\r\n]/.test(text[i + 6]))
    ) {
      // Tokenise the head: at most HEAD_TOKENS words, each a bare identifier or a `"quoted"`
      // one, with the offset just past each so a following `.` can be seen. A single greedy
      // `[A-Za-z0-9_ ]` match does not work and the selftest caught it: on
      // `CREATE VIEW v AS SELECT 1;` it returned the name `1`, because the match ran to the end
      // of the statement.
      const toks: Array<{ s: string; end: number }> = []
      let j = i + 6
      while (j < text.length && /[ \t\r\n]/.test(text[j])) j++
      let k = j
      while (toks.length < HEAD_TOKENS && k < text.length) {
        while (k < text.length && /[ \t\r\n]/.test(text[k])) k++
        if (k >= text.length) break
        // A `.` between two identifiers is a schema separator, not a token of its own. It is
        // stepped over so the leaf is tokenised too, and `toks[i].end` then points AT the dot,
        // which is what the qualification walk below tests. Without this the tokenizer stopped at
        // `CREATE TABLE public.` and the head was recorded as named `public`.
        if (text[k] === "." && toks.length > 0) {
          k++
          continue
        }
        if (text[k] === '"') {
          const e = text.indexOf('"', k + 1)
          if (e < 0) break
          toks.push({ s: text.slice(k, e + 1), end: e + 1 })
          k = e + 1
          continue
        }
        const m2 = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(k))
        if (!m2) break
        toks.push({ s: m2[0], end: k + m2[0].length })
        k = k + m2[0].length
      }
      // The head kind is the first token in the whitelist. `materialized` is deliberately NOT in
      // it: it is a modifier, and treating it as the kind made `CREATE MATERIALIZED VIEW mv`
      // record the name `VIEW`. The selftest caught that too.
      const kindIdx = toks.findIndex(t => HEAD_KINDS.has(t.s.toLowerCase()))
      if (kindIdx >= 0 && kindIdx + 1 < toks.length) {
        n++
        // `IF NOT EXISTS` / `OR REPLACE` sit between the kind and the name.
        let nameIdx = kindIdx + 1
        while (nameIdx < toks.length && HEAD_NOISE.has(toks[nameIdx].s.toLowerCase())) nameIdx++
        if (nameIdx >= toks.length) {
          names.push("")
          i = k > j ? k : j + 6
          continue
        }
        let name = stripQuotes(toks[nameIdx].s)
        // A schema-qualified head: `public.users`, `"my.schema"."tbl"`. The leaf is the name,
        // matching what the analyzer publishes, so the same declaration matches on both sides.
        let j2 = nameIdx
        while (text[toks[j2].end] === "." && j2 + 1 < toks.length) {
          j2++
          name = stripQuotes(toks[j2].s)
        }
        names.push(name)
      }
      i = k > j ? k : j + 6
      continue
    }
    i++
  }
  return { count: n, names }
}

function stripQuotes(s: string): string {
  let out = s
  while (out.length >= 2 && out[0] === '"' && out[out.length - 1] === '"') out = out.slice(1, -1)
  return out
}

/** The `CREATE <kind>` words this census counts. Matched as a SET over the head's tokens.
 *  `materialized` is absent on purpose: it is a modifier, not a kind. */
const HEAD_KINDS = new Set([
  "function", "procedure", "table", "view", "index", "trigger", "type", "schema",
  "sequence", "domain", "extension",
])
/** Words that sit between the head kind and the declared name. */
const HEAD_NOISE = new Set(["if", "not", "exists", "or", "replace"])
/** How many words of a head are tokenised. `OR REPLACE MATERIALIZED VIEW` needs four. */
const HEAD_TOKENS = 6

/**
 * The assertions that keep `declarationHeads` from being vacuous again. Run with `--selftest`.
 * Each case is a shape the corpus actually contains, so a regression in the walk shows up here
 * rather than as a plausible-looking corpus total.
 */
const SELFTEST: Array<[string, string, number, string[]?]> = [
  ["two bare declarations", "CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n", 2, ["a", "b"]],
  ["apostrophe in a line comment does not swallow the file", "-- don't touch\nCREATE TABLE a (id int);\n", 1],
  ["apostrophe in a block comment", "/* it's fine */\nCREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n", 1, ["f"]],
  ["doubled-quote escape inside a literal", "INSERT INTO t VALUES ('it''s');\nCREATE TABLE a (id int);\n", 1],
  ["CREATE inside a dollar body is not a declaration", "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ CREATE TABLE inner (id int); $$;\n", 1, ["f"]],
  ["CREATE inside a comment is not a declaration", "-- CREATE TABLE fake (id int);\nCREATE VIEW v AS SELECT 1;\n", 1, ["v"]],
  ["a substring is not a word", "SELECT recreate(x) FROM t;\nCREATE SEQUENCE s;\n", 1, ["s"]],
  ["materialized view counts as one head and the name is the view", "CREATE MATERIALIZED VIEW mv AS SELECT 1;\n", 1, ["mv"]],
  ["IF NOT EXISTS is skipped, not mistaken for the name", "CREATE TABLE IF NOT EXISTS t (id int);\n", 1, ["t"]],
  ["a quoted dotted name keeps its dot", 'CREATE TABLE "vault.secret" (id int);\n', 1, ["vault.secret"]],
  ["schema-qualified head keeps the leaf", "CREATE TABLE public.users (id int);\n", 1, ["users"]],
  ["every head kind the census accepts", "CREATE TABLE t (id int);\nCREATE VIEW v AS SELECT 1;\nCREATE INDEX i ON t (id);\nCREATE TYPE ty AS (a int);\nCREATE SCHEMA s;\nCREATE SEQUENCE q;\nCREATE MATERIALIZED VIEW mv AS SELECT 1;\nCREATE DOMAIN d AS int;\nCREATE EXTENSION e;\n", 9, ["t", "v", "i", "ty", "s", "q", "mv", "d", "e"]],
]

if (argv.includes("--selftest")) {
  let failed = 0
  for (const [label, input, want, wantNames] of SELFTEST) {
    const got = declarationHeads(input)
    const ok = got.count === want && (!wantNames || JSON.stringify(got.names) === JSON.stringify(wantNames))
    if (!ok) {
      failed++
      console.error(`FAIL  ${label}: want ${want}${wantNames ? ` names ${JSON.stringify(wantNames)}` : ""}, got ${got.count} names ${JSON.stringify(got.names)}`)
    } else {
      console.log(`ok    ${label}: ${got.count}${wantNames ? ` ${JSON.stringify(got.names)}` : ""}`)
    }
  }
  console.log(failed === 0 ? `selftest: ${SELFTEST.length}/${SELFTEST.length} pass` : `selftest: ${failed} FAIL`)
  process.exit(failed === 0 ? 0 : 1)
}

const files: string[] = []
collect(CORPUS, files, 0)
files.sort()
// A deterministic STRIDE over the full sorted list, not a head slice. The head is one repo.
const stride = Math.max(1, Math.ceil(files.length / FILE_CAP))
const sampled = FILE_CAP === Infinity ? files : files.filter((_, i) => i % stride === 0)
// Deterministic round-robin, so the union over all shards is the same population and
// `--shards 1 --shard 0` is the unsharded run.
const mine = sampled.filter((_, i) => i % SHARDS === SHARD)
const sample = mine

const rows: Array<Record<string, unknown>> = []
let parsed = 0
let rootIsError = 0
let rootIsErrorWithDecls = 0
let lostDeclarations = 0
let tooBig = 0
for (const [i, f] of sample.entries()) {
  // Progress on stderr, one line per file. A wasm parse cannot be interrupted from inside the
  // process (`src/ast/engine.ts` exits the process instead, which is why this instrument does not
  // use `parseFile`), so an instrument with no progress line is indistinguishable from a hang.
  process.stderr.write(`[shard ${SHARD}/${SHARDS} ${i + 1}/${sample.length}] ${path.relative(CORPUS, f)}\n`)
  let text: string
  try {
    const st = statSync(f)
    // 512 KB. Measured on this corpus the declarations this instrument is counting live in
    // migration files. This bound is a stated exclusion, not a silent one, and it is NOT what
    // makes the run survivable — see the header: the run's cost is throughput, and sharding is
    // what makes it survivable.
    if (st.size > 512_000) {
      tooBig++
      continue
    }
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  const t0 = Date.now()
  const tree = parser.parse(text)
  const ms = Date.now() - t0
  parsed++
  const root = tree.rootNode
  const decls = declarationHeads(text)
  const isErr = root.type === "ERROR"
  if (isErr) {
    rootIsError++
    if (decls.count > 0) rootIsErrorWithDecls++
    lostDeclarations += decls.count
  }
  rows.push({
    file: path.relative(CORPUS, f),
    rootType: root.type,
    hasError: root.hasError,
    declHeads: decls.count,
    // The names, so a downstream instrument can ask which of these declarations a parse actually
    // PUBLISHED rather than comparing a text count to a symbol count. `declHeadNames` on 1,885
    // files is 4,690 short strings, so the artifact grows by ~90 KB and buys the measurement.
    declHeadNames: decls.names,
    nodeCount: root.descendantCount,
    bytes: Buffer.byteLength(text),
    ms,
  })
}

const summary = {
  corpusRoot: CORPUS,
  sqlFilesDiscovered: files.length,
  sampleStride: stride,
  shard: SHARD,
  shards: SHARDS,
  filesOfShard: mine.map(f => f.slice(CORPUS.length + 1).split("/")[0]),
  repositoriesCovered: new Set(mine.map(f => f.slice(CORPUS.length + 1).split("/")[0])).size,
  filesSampled: sample.length,
  filesParsed: parsed,
  filesOverSizeCap: tooBig,
  sizeCapBytes: 512_000,
  rootIsError,
  rootIsErrorWithDeclarationHeads: rootIsErrorWithDecls,
  declarationHeadsLostInRootErrorFiles: lostDeclarations,
  parseMsTotal: rows.reduce((s, r) => s + (r.ms as number), 0),
  slowest: rows.slice().sort((a, b) => (b.ms as number) - (a.ms as number)).slice(0, 10)
    .map(r => ({ file: r.file, ms: r.ms, rootType: r.rootType })),
  sampledAt: new Date().toISOString(),
}
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2))
console.log(JSON.stringify({ ...summary, filesOfShard: `[${summary.filesOfShard.length} names]` }, null, 2))