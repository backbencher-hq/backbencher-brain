/**
 * SCSS CUSTOM-PROPERTY OWNERSHIP — who declares the 286 unresolved `var(--x)` reads.
 *
 * ## The question
 *
 * `scss-u2-classify.ts` splits this lane's 861 "declared nowhere" (U2) targets by shape.
 * Three shapes, 861 edges:
 *
 *     MODULE-PATH   520  (60.4%)   `@use './placeholders'`, `@forward './property-24'`
 *     CUSTOM-PROP   286  (33.2%)   `var(--color-border-default)`
 *     BARE-IDENT     55  ( 6.4%)   `@import 'variables'`, `@extend %csv`
 *
 * MODULE-PATH and BARE-IDENT are the same fact wearing two shapes: both are a module
 * specifier, and no analyzer can resolve a filesystem path to a declaration because there
 * is no declaration under that name. 6 of the 520 path-shaped targets have a basename some
 * symbol does publish, and the other 514 have no referent by construction.
 *
 * CUSTOM-PROP is different and is the only shape with a live counterfactual. This lane —
 * through the CSS analyzer it delegates to — DOES publish custom-property declarations:
 * the dump carries 2,122 symbols named `--*` over 1,395 distinct names. So a `var(--x)`
 * read can resolve in principle, and the question is whether the 286 do not resolve
 * because the ANALYZER misses the declaration or because the declaration is in a file this
 * walk never admitted.
 *
 * ## Why the walk's own universe cannot answer it
 *
 * The admitted set is three filters deep: git-tracked, under 512 KB, and
 * `detectLanguageFromPath(abs, text) === 'scss'`. A design-token file in `.css`, a
 * `.sass` partial, or a tracked `.scss` over 512 KB declares a custom property that this
 * walk never parsed, so the name is genuinely absent from the universe and the audit
 * reports it as U2. That is a statement about the WALK, not about the analyzer, and the
 * audit cannot tell the two apart because it never looks outside the universe it built.
 *
 * So this file looks outside it, and attributes each of the 143 unread distinct property
 * names to the extension of the files that declare it:
 *
 *   DECLARED IN A WALKED .scss   a defect in this lane. The analyzer had the file and did
 *                                not publish the name. This is the only cell that is one.
 *   DECLARED IN .css / .sass     not a defect. A stylesheet the walk never admitted
 *                                declares it; the read is correct and the resolution gap
 *                                is an admission artifact.
 *   DECLARED IN ANOTHER EXT      the token is set by a build script, a JS theme object or
 *                                a framework config — not a stylesheet at all.
 *   UNDECLARED ANYWHERE          a real dangling read: a typo, or a property supplied by a
 *                                stylesheet that is not in the corpus.
 *
* ## The probe, and its one admitted weakness
 *
 * One `rg` pass over the corpus collecting every `--token:` in `*.scss`, `*.sass`, `*.css`,
 * intersected with the population. It is a TEXT probe, not a parse, so a name appearing only
 * inside a string literal or a comment is a FALSE POSITIVE — and this file's own measurement
 * shows where that lands, which is not where an earlier draft of this header claimed.
 *
 * An earlier version of this header said the false-positive direction was "safe, because a
 * false positive cannot create the one cell that would be a finding". **That is false and it
 * was falsified here.** element-plus `packages/theme-chalk/src/mixins/_var.scss` carries
 * `// --el-color-primary: red;` on line 11 — a commented-out line in a file this walk DID
 * parse — so a false positive does land in WALKED-SCSS, which is the one cell that reads as
 * a defect. The cell is therefore not self-certifying, and the file now says so: it is
 * followed by a per-declaration CAUSE classification (COMMENTED / INTERPOLATED / PLAIN)
 * that reads the declaring files directly, because "the analyzer missed it" and "there is no
 * declaration to miss" are different claims and only one of them is a finding.
 *
 * The other direction is bounded rather than claimed safe: the probe can miss an
 * interpolated or differently-spaced declaration, which lands the name in UNDECLARED. That
 * is why the walk's own `--*` symbols are subtracted first — any name the walk already
 * publishes leaves the population before the probe runs — and why the positive control below
 * is printed on every run. Measured over the whole corpus, the control reads 5,944 hits
 * across the 1,395 `--*` names the walk publishes, so the probe finds declarations when
 * declarations are there.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-custom-prop-ownership.ts <dump.ndjson> [windowSize]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const DUMP = process.argv[2] ?? "/tmp/opencode/scss/scss-incoming-walk-full.ndjson"
const WINDOW = Number(process.argv[3] ?? 600)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

type SymRec = { k: "s"; f: string; n: string }
type EdgeRec = { k: "e"; f: string; t: string; s: string; g: string; ec: string }
type FileRec = { k: "file"; f: string; thrown?: boolean }

const syms: SymRec[] = []
const edges: EdgeRec[] = []
const files: FileRec[] = []
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (line.length === 0) continue
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    continue
  }
  if (o.k === "s") syms.push(o)
  else if (o.k === "e") edges.push(o)
  else if (o.k === "file") files.push(o)
}

const walkedFiles = new Set(files.filter((f) => !f.thrown).map((f) => f.f))
const fileRecords = new Map(files.filter((f) => !f.thrown).map((f) => [f.f, f]))
const published = new Set<string>()
for (const s of syms) {
  if (s.n.startsWith("--")) published.add(s.n)
  if (s.q.length > 0 && s.q.startsWith("--")) published.add(s.q)
}

const sortedFiles = [...walkedFiles].sort()
const step = Math.max(1, Math.floor(sortedFiles.length / WINDOW))
const windowFiles = new Set(sortedFiles.filter((_, i) => i % step === 0).slice(0, WINDOW))

// The population: `references`/`uses`/`calls`/`contains` edges in the window whose target
// is a custom property, MINUS the names the walk already publishes. `t` is the type, `g`
// the target string.
const popped = new Map<string, { edges: number; types: Map<string, number>; readIn: Map<string, number> }>()
for (const e of edges) {
  if (!windowFiles.has(e.f)) continue
  const g = e.g
  if (!g.startsWith("--") || g.length <= 2) continue
  if (published.has(g)) continue
  let rec = popped.get(g)
  if (!rec) {
    rec = { edges: 0, types: new Map(), readIn: new Map() }
    popped.set(g, rec)
  }
  rec.edges++
  rec.types.set(e.t, (rec.types.get(e.t) ?? 0) + 1)
  rec.readIn.set(e.f, (rec.readIn.get(e.f) ?? 0) + 1)
}

const names = [...popped.keys()].sort()
console.log(`scss custom-property ownership`)
console.log(`corpus root        ${CR}`)
console.log(`files walked       ${walkedFiles.size}   window ${windowFiles.size}`)
console.log(`--* symbols the walk publishes   ${published.size} distinct`)
console.log(`unread custom-property edges     ${[...popped.values()].reduce((a, r) => a + r.edges, 0)} over ${names.length} distinct names\n`)

if (names.length === 0) {
  console.log("population empty — nothing to attribute")
  process.exit(0)
}

// One rg pass. The alternation is `--name\\s*:` so a hit is a DECLARATION-shaped token and
// not a `var(--name)` read; `var(--x)` is followed by `)` so it cannot match.
// ONE pass, and the pattern matches EVERY `--token:` declaration rather than an
// alternation of the population's names. Two bugs got this to a confident zero first, and
// both are recorded because the shape of each is the shape of the next one somebody writes.
//
//   1. The first version built an alternation of the population's names and read the matched
//      text back as the name. Rust's regex engine resolves an alternation to the LONGEST
//      match at a position, so every branch came back as the longer superstring it prefixes
//      (`--color-border-default` inside `--color-border-default-muted`) and the population
//      lookup rejected all 202 lines. Rust regex has no lookahead, so the branch cannot be
//      anchored from the right; collecting every declaration and intersecting is correct and
//      is one pass instead of 142.
//   2. That version passed `-I` intending "ignore binary", which in ripgrep is
//      `--no-filename`. rg emitted bare `--token:` with no path, so the path/token split
//      found no separator and every hit was dropped. The calibration row below is what
//      caught it: it read 0 of 1,395 known-declared names against an rg that had returned
//      213,302 matches. Without a positive control with a known non-zero answer, version 2
//      printed "142 names declared nowhere" and it would have been the probe talking.
//
// Restricted to the three stylesheet extensions. The question is who declares the property
// in a STYLESHEET — a `.ts` theme object or a JSON token file is a different answer, and
// including them would turn this into a measurement of the corpus's file mix.
const DECL_PATTERN = "--[-\\w]+\\s*:"
let out = ""
let rgStatus = "ok"
try {
  out = execFileSync(
    "rg",
    [
      "--no-heading", "--with-filename", "-o",
      "--glob", "!.git",
      "--glob", "*.scss", "--glob", "*.sass", "--glob", "*.css",
      "-e", DECL_PATTERN, CR,
    ],
    { encoding: "utf8", maxBuffer: 4096 * 1024 * 1024 },
  )
} catch (err: any) {
  const code = typeof err?.status === "number" ? err.status : -1
  const stderr = typeof err?.stderr === "string" ? err.stderr : ""
  out = typeof err?.stdout === "string" ? err.stdout : ""
  if (code === 1) rgStatus = "ok (no match)"
  else rgStatus = `FAILED exit=${code} stderr=${stderr.trim().split("\n")[0] ?? "(none)"}`
}
console.log(`rg probe            ${rgStatus}   --token: over *.scss,*.sass,*.css`)
if (rgStatus.startsWith("FAILED")) {
  console.log("\nPROBE DID NOT RUN. No attribution is printed, because an unrun probe " +
    "cannot attribute anything and the zero it would print is indistinguishable from a real zero.")
  process.exit(2)
}
const rawLines = out.split("\n").filter((l) => l.length > 0)
console.log(`rg raw match lines  ${rawLines.length}`)

// SORTED, and it has to be. rg walks with a thread pool, so the order of its matches is not
// stable between runs over identical bytes. Both attribution rules below are "first hit wins"
// — which bucket a name lands in, and which declaring file is blamed for it — so on unsorted
// output they inherited rg's thread order and the numbers MOVED between two runs over the
// same fixed dump: the cause split read PLAIN 120 / COMMENTED 11 / INTERPOLATED 238 on one
// run and PLAIN 127 / COMMENTED 4 / INTERPOLATED 238 on the next, with 101 names and 369 edges
// unchanged in both. A split that moves when its input does not is a split that cannot be
// checked, and the input here is a file on disk.
rawLines.sort()

// THE CALIBRATION ROW, and it is not decoration. "0 of the 142 names are declared anywhere"
// is evidence of absence only if the same probe finds the names that ARE declared. The walk
// publishes 1,395 distinct `--*` symbols from the very files rg just searched, so the
// intersection of those 1,395 with rg's 213,302 tokens is a positive control with a known
// non-zero answer. If it reads 0, this probe finds nothing and every zero below it is the
// probe's, not the corpus's — which is exactly what the first two versions of this file did.
let calHit = 0
let calMiss = 0
for (const line of rawLines) {
  const sep = line.indexOf(":")
  if (sep <= 0) continue
  const token = line.slice(sep + 1).trim().replace(/\s*:$/, "")
  if (published.has(token)) calHit++
  else calMiss++
}
console.log(`calibration         ${calHit} of the ${published.size} --* names the walk publishes were re-found by rg in the same files (${calMiss} tokens are other names)`)

type Bucket = "WALKED-SCSS" | "SCSS-NOT-WALKED" | "CSS" | "SASS" | "OTHER-EXT" | "UNDECLARED"
const perName = new Map<string, Bucket>()
const hitsByExt = new Map<string, number>()
const sampleByBucket = new Map<Bucket, string[]>()
// name -> the walked .scss files that declare it. The only bucket that means anything is a
// defect in this lane, so its full evidence is printed rather than three samples of it.
const walkedDeclarations = new Map<string, Set<string>>()
for (const line of rawLines) {
  // `rg --with-filename -o` emits `path:match`, and the MATCH ITSELF ends in the
  // declaration colon — `--color-border-default:` — so the line is
  // `path/to/f.scss:--color-border-default:`. Splitting on the LAST colon (the first
  // version) yields an empty token and an empty file; splitting on the FIRST colon is
  // correct because a corpus path cannot contain one.
  const sep = line.indexOf(":")
  if (sep <= 0) continue
  const file = line.slice(0, sep)
  const token = line.slice(sep + 1).trim().replace(/\s*:$/, "")
  if (!popped.has(token)) continue
  const rel = path.relative(CR, file)
  const ext = path.extname(file).toLowerCase()
  if (ext === ".scss" || ext === ".sass") hitsByExt.set(ext, (hitsByExt.get(ext) ?? 0) + 1)
  let bucket: Bucket
  if (ext === ".scss") bucket = walkedFiles.has(rel) ? "WALKED-SCSS" : "SCSS-NOT-WALKED"
  else if (ext === ".css") bucket = "CSS"
  else if (ext === ".sass") bucket = "SASS"
  else bucket = "OTHER-EXT"
  if (bucket === "WALKED-SCSS") {
    let set = walkedDeclarations.get(token)
    if (!set) {
      set = new Set()
      walkedDeclarations.set(token, set)
    }
    set.add(rel)
  }
  // First bucket wins, and the buckets are ordered by how much they would mean: a hit in a
  // walked .scss file outranks every other reading.
  const prev = perName.get(token)
  if (prev === "WALKED-SCSS") continue
  if (prev === undefined) {
    perName.set(token, bucket)
    const arr = sampleByBucket.get(bucket) ?? []
    if (arr.length < 6) {
      arr.push(rel)
      sampleByBucket.set(bucket, arr)
    }
  } else if (prev !== bucket && bucket === "WALKED-SCSS") perName.set(token, bucket)
}
for (const n of names) if (!perName.has(n)) perName.set(n, "UNDECLARED")

const BUCKETS: Bucket[] = ["WALKED-SCSS", "SCSS-NOT-WALKED", "CSS", "SASS", "OTHER-EXT", "UNDECLARED"]
console.log("distinct unread names by declaring-file class:")
const edgesByBucket = new Map<Bucket, number>()
for (const [n, b] of perName) {
  edgesByBucket.set(b, (edgesByBucket.get(b) ?? 0) + popped.get(n)!.edges)
}
for (const b of BUCKETS) {
  const inBucket = [...perName.entries()].filter(([, x]) => x === b)
  const e = edgesByBucket.get(b) ?? 0
  if (inBucket.length === 0 && e === 0) continue
  console.log(`  ${b.padEnd(16)} ${String(inBucket.length).padStart(4)} names  ${String(e).padStart(4)} edges`)
  for (const s of sampleByBucket.get(b) ?? []) console.log(`      e.g. ${s}`)
}
const totalNames = [...perName.values()].filter((b) => b !== "UNDECLARED").length
console.log(`\nVERDICT: names declared somewhere in the corpus  ${totalNames} of ${names.length}`)
console.log(`         names declared NOWHERE in the corpus    ${[...perName.values()].filter((b) => b === "UNDECLARED").length}`)
const defect = edgesByBucket.get("WALKED-SCSS") ?? 0
console.log(`         edges in the lane-defect cell          ${defect}  (declaration in a file this walk parsed)`)
if (defect > 0) {
  console.log("\nthe lane-defect cell in full — name -> declaring walked .scss file, and where it is read:")
  for (const [n, declFiles] of [...walkedDeclarations.entries()].sort()) {
    const rec = popped.get(n)!
    const readers = [...rec.readIn.entries()].sort().map(([f, k]) => `${f}(${k})`)
    console.log(`  ${n}  ${rec.edges} edge(s), type ${[...rec.types.entries()].map(([t, k]) => `${t}x${k}`).join(",")}`)
    console.log(`      declared in : ${[...declFiles].sort().join(", ")}`)
    console.log(`      read in     : ${readers.join(", ")}`)
  }

  // WHY each of the 369 is unpublishable, because "the analyzer missed it" and "the
  // declaration is not there" are different claims and only one of them is a defect.
  //
  // The two non-defect causes are both real and both common in this corpus:
  //   COMMENTED      bootstrap's `_variables.scss` documents its own custom properties on
  //                 commented-out lines (`// --blue: #{$blue};`) — the CSS lexer reads a
  //                 declaration there and the grammar never does. Measured, not assumed:
  //                 element-plus `_var.scss:11` is `// --el-color-primary: red;` and that is
  //                 what put an element-plus edge in this cell in the 600-file run.
  //   INTERPOLATED   `--#{$name}: v` publishes a name the analyzer cannot know statically.
  //   PLAIN          a bare `--x: v` in a walked file that the analyzer did not publish.
  //                 This is the only cause that is a finding about the analyzer.
  //
  // Classified by reading the DECLARING FILES directly rather than by regex over the
  // corpus: `walkedDeclarations` already names the file for each pair, so this opens at most
  // a few dozen stylesheets and matches the name at the start of a line. A line is COMMENTED
  // when it opens with `//` or `*`; INTERPOLATED when the token itself carries `#{`; PLAIN
  // otherwise. A declaration inside a `/* … */` block on a line that does not open with `*`
  // is reported PLAIN and is therefore a false accusation, which is the safe direction to
  // err in — it enlarges the cell a reviewer must check rather than hiding it.
  const readFileCache = new Map<string, string[]>()
  function linesOf(rel: string): string[] {
    let l = readFileCache.get(rel)
    if (l === undefined) {
      try {
        l = readFileSync(path.join(CR, rel), "utf8").split("\n")
      } catch {
        l = []
      }
      readFileCache.set(rel, l)
    }
    return l
  }
  type Cause = "COMMENTED" | "INTERPOLATED" | "PLAIN" | "NOT-FOUND-IN-FILE"
  const causeEdges = new Map<Cause, number>()
  const causeNames = new Map<Cause, Set<string>>()
  const plainNames = new Set<string>()
  // Block-comment state has to be tracked ACROSS lines, and the first version of this
  // classifier only looked at the line the name sat on. That produced a false accusation of
  // 120 edges: `hasura-engine/docs/src/css/default-fonts-and-colors.scss` parses with ZERO
  // error spans and publishes 131 symbols, and two of the names blamed on it —
  // `--ifm-color-gray-500`, `--ifm-color-gray-600` — sit on lines 167-168 inside a
  // `/* … */` block that opens on line 165 and closes on line 171. The analyzer is right not
  // to publish a declaration inside a comment; the classifier was wrong to call it an
  // omission. A cause label that survives only because the probe is lazy is a finding about
  // the probe, so this scans comment state properly.
  function commentState(lines: string[]): boolean[] {
    const inComment: boolean[] = []
    let open = false
    for (const line of lines) {
      let i = 0
      const wasOpen = open
      let insideAtStart = wasOpen
      while (i < line.length) {
        if (open) {
          const close = line.indexOf("*/", i)
          if (close < 0) {
            i = line.length
          } else {
            open = false
            i = close + 2
          }
        } else {
          const o = line.indexOf("/*", i)
          if (o < 0) break
          open = true
          i = o + 2
        }
      }
      // A line that OPENS and CLOSES a comment on the same line is never wholly inside one,
      // so `insideAtStart` (state on entry) is the right per-line answer for a declaration.
      inComment.push(insideAtStart)
    }
    return inComment
  }
  for (const [n, declFiles] of walkedDeclarations) {
    const rec = popped.get(n)!
    let cause: Cause = "NOT-FOUND-IN-FILE"
    for (const rel of declFiles) {
      const lines = linesOf(rel)
      const inComment = commentState(lines)
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li]
        const at = line.indexOf(`${n}:`)
        if (at < 0) continue
        const trimmed = line.trimStart()
        if (inComment[li] || trimmed.startsWith("//")) cause = "COMMENTED"
        else if (line.includes("#{")) cause = "INTERPOLATED"
        else cause = "PLAIN"
        break
      }
      if (cause !== "NOT-FOUND-IN-FILE") break
    }
    causeEdges.set(cause, (causeEdges.get(cause) ?? 0) + rec.edges)
    let set = causeNames.get(cause)
    if (!set) {
      set = new Set()
      causeNames.set(cause, set)
    }
    set.add(n)
    if (cause === "PLAIN") plainNames.add(n)
  }
  console.log("\ncause of the lane-defect cell, by edge and by distinct name:")
  const CAUSES: Cause[] = ["PLAIN", "COMMENTED", "INTERPOLATED", "NOT-FOUND-IN-FILE"]
  for (const c of CAUSES) {
    const e = causeEdges.get(c) ?? 0
    const nm = causeNames.get(c)?.size ?? 0
    if (e === 0 && nm === 0) continue
    const label =
      c === "PLAIN"
        ? "a bare declaration in a walked file — the analyzer's own omission"
        : c === "COMMENTED"
          ? "a commented-out line — no declaration exists to publish"
          : c === "INTERPOLATED"
            ? "an interpolated name — not statically knowable"
            : "rg named the file but the line is not there"
    console.log(`  ${c.padEnd(18)} ${String(nm).padStart(4)} names  ${String(e).padStart(4)} edges   ${label}`)
  }
  if (plainNames.size > 0) {
    console.log("\nthe PLAIN names, which are the only ones a reviewer should check:")
    // All of them, not a page. The previous version printed 25 and "... and 6 more", and a
    // reader doing the arithmetic that matters — "how many of these files does the walk
    // parse cleanly?" — was working from 25 of 31 names and did not know it.
    const plainNamesSorted = [...plainNames].sort()
    for (const n of plainNamesSorted) {
      const rec = popped.get(n)!
      console.log(`  ${n}  ${rec.edges} edge(s)  declared in ${[...walkedDeclarations.get(n)!].sort().join(", ")}`)
    }
    // The cause cell is only a finding if the declaration is one the walk COULD have read,
    // so the error-span count of each declaring file is printed with it. A PLAIN name in a
    // file with zero ERROR spans is an analyzer omission; the same name in a file the
    // grammar lost is parse loss, and the two want different owners.
    const declaring = new Set<string>()
    for (const n of plainNamesSorted) for (const f of walkedDeclarations.get(n)!) declaring.add(f)
    console.log(`\n  ${plainNamesSorted.length} PLAIN names are declared in ${declaring.size} distinct walked files.`)
    console.log(`  Parse health of those ${declaring.size} files, read out of the walk dump:`)
    for (const f of [...declaring].sort()) {
      const rec = fileRecords.get(f)
      console.log(`    err=${String(rec?.err ?? 0).padStart(5)}  symbols=${String(rec?.ns ?? 0).padStart(4)}  ${f}`)
    }
    const clean = [...declaring].filter((f) => (fileRecords.get(f)?.err ?? 0) === 0)
    console.log(`  files with ZERO error spans: ${clean.length} of ${declaring.size}` +
      (clean.length === 0 ? "  <- every PLAIN declaration sits in a file the grammar lost" : `  <- ${clean.join(", ")}`))
  }
}