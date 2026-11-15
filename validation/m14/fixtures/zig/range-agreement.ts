/**
 * ZIG RANGE AGREEMENT — C6, the control pass 20 §I left open in this lane's hands.
 *
 * ## The gap this closes
 *
 * The miss-cause ladder now checks the published `(name, ownerName, kind)` triple:
 *
 *   C1  the name is in parseFile's published name SET
 *   C4  the owner's NAME is the nearest declaration's name
 *   C5  the published KIND is the kind the container's site implies
 *
 * All three read a `Set<string>`, or a name and a kind beside it. **None of them can
 * see WHERE the symbol was published.** A symbol carrying the right name, under the
 * right owner, with the right kind, and a range pointing at an unrelated part of the
 * file passes all five controls. That is not a hypothetical shape: it is what a
 * `nodeRange(node)` applied to the wrong `node` produces, and `nodeRange` is called
 * from nine sites in `real-zig-analyzer.ts` (`:231 :329 :426 :451 :526 :643 :671
 * :847 :869`) where the node handed to it is the one the branch decided to publish —
 * so the range is only as right as that branch's node choice, and nothing measures it.
 *
 * The range is not cosmetic here. It is what `bb_graph` and `bb_impact` navigate by,
 * what the editor's hover and go-to-definition resolve against, and what
 * `relationship.line_number` is reconciled with. A symbol published against the wrong
 * span is an edge the graph asserts at a place in the file where the declaration is
 * not.
 *
 * ## The five rungs, and what each can prove
 *
 * Rungs 1-3 are SELF-CONSISTENCY: they need no oracle and no second walker, because
 * they check the published range against the published file's own bytes. Rung 4 and 5
 * are relational and need the symbol table only.
 *
 *   C6.1  offset/position agreement. tree-sitter reports `startPosition.row/column`
 *         and `startIndex` for the same node, and `nodeRange` (:2696) copies both,
 *         +1 on the positions and +0 on the indices. If those two copies ever
 *         disagree, the range describes two different places. Decoded in BYTES,
 *         because tree-sitter's column and index are both byte quantities while a JS
 *         string index is UTF-16 — decoding with a JS index makes every file with a
 *         non-ASCII character before the declaration report a violation, which would
 *         be a defect in the instrument, not in the analyzer.
 *   C6.2  bounds and ordering: 0 <= startIndex <= endIndex <= byteLength, and the
 *         position pair must not run backwards (a range whose end precedes its start
 *         is inverted; some consumers then read it as empty).
 *   C6.3  NAME CONTAINMENT: the published name must occur inside the published span.
 *         Counted per KIND and never asserted as a blanket rule, because some kinds
 *         publish a name the span does not spell — a derived name, a dequoted import
 *         target, a builtin. The per-kind table is the measurement; a kind whose
 *         rate is low for a stated reason is reported, not fixed by fiat.
 *   C6.4  SPAN COLLISION: two DIFFERENT declarations cannot occupy the same bytes. A
 *         symbol whose (startIndex,endIndex) is identical to another symbol's, under
 *         a different qualified name, means one of the two spans is wrong — and the
 *         graph cannot tell which. Counted over distinct qualified names only, so
 *         one declaration published twice under one name is a different (and already
 *         measured) finding.
 *   C6.5  `contains` NESTING: a `contains` edge asserts that the target is declared
 *         INSIDE the source. If both endpoints resolve to exactly one published
 *         symbol in that file, the target's byte span must lie within the source's.
 *         This is the rung with the most leverage: `contains` is 99.99% resolved at
 *         both ends (pass 20 §F), so a nesting violation is not a resolution
 *         question at all — both endpoints are known symbols and the graph still
 *         contradicts the bytes. Endpoints that resolve to MORE THAN ONE symbol are
 *         counted and skipped, because that is §B's ambiguity finding, not a range
 *         defect, and collapsing the two would misattribute it.
 *
 * ## WHAT THIS INSTRUMENT CANNOT SEE — stated, because a bound read as a pass is
 * the failure mode this lane keeps reporting in others
 *
 *   - It compares the published span against the FILE, not against the node the
 *     analyzer meant to publish. A span that is internally consistent, contains the
 *     name, and is uniquely held can still be the span of the WRONG NODE — a
 *     container's span where a member's was meant, say. Rung 4 catches only the
 *     case where that mistake makes two declarations collide. Catching it in general
 *     needs a tree walk that re-derives each branch's node choice, which is a second
 *     implementation of `real-zig-analyzer.ts` and inherits the shadow walk's
 *     weakness: a bug shared by the analyzer and its shadow is invisible to it. This
 *     is why C6 is reported as FIVE counts with their populations, not as a verdict.
 *   - `range` is OPTIONAL on the shared symbol type, so a symbol published with no
 *     range at all is counted (`noRange`) rather than skipped: an editor asked to
 *     navigate to it has nothing to navigate by, and that is this lane's business.
 *   - Non-ASCII column handling is verified BY MEASUREMENT against the corpus, not
 *     assumed: rung 1's `nonAsciiFiles` counts the files where a byte decode and a
 *     UTF-16 decode would disagree, so a reader can see whether the byte discipline
 *     was load-bearing on this population or merely correct.
 *
 * ## Population and invocation
 *
 * Same admission and draw as `ontology-census.ts`: `git ls-files -- '*.zig'` per
 * corpus repo, size <= 512 KiB, ordered by `sha256("<seed>|<repo>/<rel>")`, with the
 * `--files-from` shard list filtering it. Run in shards and merged, because one
 * process over the whole draw trips `parseFile`'s 120 s self-destruct guard.
 *
 *   npx tsx validation/m14/fixtures/zig/range-agreement.ts --files-from <shard> --out <json>
 *
 * The artifact name carries the day it was measured (pass 19 §B: four of this lane's
 * instruments hardcoded a date and one clobbered another's measurement in place).
 *
 * NO REGEX anywhere in this file — the workstream's standing rule. Text predicates
 * here are `Buffer`/`String` comparisons on decoded spans, not patterns over source.
 */

import { execFileSync } from "node:child_process"
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const FILES_FROM = arg("files-from", "")
const SEED = arg("seed", "ontology-census-v1")
const MEASURED_ON = new Date().toISOString().slice(0, 10)
/**
 * The artifact NAME carries the day (pass 19 §B), and its SHARD TAG is new here.
 *
 * The side-car is truncated at the start of a measuring run (see `JSONL` below),
 * so with one default `--out` an 8-shard population silently keeps only the LAST
 * shard: shards 0-6 each print `measured 480 file(s) -> …jsonl`, which reads as
 * eight successful runs, and the aggregate then reports 480 files instead of
 * 3,834 with nothing in the output saying a population was truncated. Measured
 * at pass 22 on exactly that invocation — the run printed 8 successes and the
 * aggregate had one shard's rows.
 *
 * That is the same defect pass 19 fixed on the INPUT side of four other
 * instruments (a default that pointed at dumps four passes stale), one level
 * down: there the path named the wrong data, here the path is right and every
 * writer of it is unnamed. So when `--files-from` names a shard, the default
 * `out` carries that shard's own tag. An explicit `--out` still wins.
 */
const shardTag = (() => {
  if (!FILES_FROM) return ""
  const base = path.basename(FILES_FROM)
  // The tag is an artifact path, not source text, so this is a filename
  // transformation rather than a pattern over code. `lastIndexOf`/slice keep it
  // out of the pattern language entirely.
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  return `-${stem.split(".").join("-")}`
})()
const OUT = arg(
  "out",
  path.join(HERE, "measurements", `range-agreement-${MEASURED_ON}${shardTag}.json`),
)
/**
 * INCREMENTAL SIDE-CAR, and it is not belt-and-braces — it is required.
 *
 * `src/ast/engine.ts:1440-1448` arms a 120 s self-destruct bomb per `parse()`
 * call and clears it AFTER `parse()` returns, with no `finally` between the two. A
 * WASM trap therefore throws, is caught by `pool-worker.ts:1196-1210`, is replaced by
 * `extractFallback`, and leaves the bomb ARMED — so the process dies 120 s later
 * naming a file that already failed, and every measurement taken since the trap is
 * lost with it. Measured here on the first attempt: `zig/lib/compiler_rt/divtf3.zig`
 * trapped, the run continued, and `[BB-HANG]` killed the process at the 120 s mark
 * with nothing written.
 *
 * So each file's rows are appended to a JSONL side-car the moment they are measured,
 * and the report is aggregated from the side-car. A killed shard keeps everything it
 * did measure, and `--aggregate` rebuilds the report from the side-cars alone without
 * parsing a single file.
 */
/** `.json` -> `.jsonl`, without a pattern. The workstream's NO REGEX rule is aimed at
 *  source text, and this operates on an artifact path, so a pattern would be
 *  harmless here — but "harmless here" is the argument every inherited regex makes,
 *  and removing it costs four characters. */
const sidecarPath = (p: string): string => (p.endsWith(".json") ? `${p.slice(0, -5)}.jsonl` : `${p}.jsonl`)

const JSONL = arg("jsonl", sidecarPath(OUT))
const AGGREGATE_ONLY = argv.includes("--aggregate")

type FileRec = { repo: string; dir: string; rel: string; abs: string }

// ───────────────────────────────────────────────────────────── the draw (as census)
const all: FileRec[] = []
for (const e of readdirSorted(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    all.push({ repo: e, dir, rel, abs })
  }
}
function readdirSorted(p: string): string[] {
  // `readdirSync` + sort, so the draw does not depend on directory order.
  return readdirSync(p).sort()
}

const key = (f: FileRec) => `${f.repo}/${f.rel}`
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  .map((x) => x.f)
let draw = hashed
if (FILES_FROM) {
  const want = new Set(readFileSync(path.resolve(ROOT, FILES_FROM), "utf8").split("\n").map((x) => x.trim()).filter(Boolean))
  draw = draw.filter((f) => want.has(key(f)))
}
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ───────────────────────────────────────────────── byte-exact position decoding
/**
 * THE PUBLISHED INDEX COORDINATE SYSTEM, and it is UTF-16 code units — NOT bytes.
 *
 * Measured, because guessing it produced this lane's own first false positive:
 * `real-zig-analyzer.ts:2696` copies `node.startIndex`, and the engine parses a
 * DECODED STRING, so the published `startIndex` is a JavaScript string index. On
 * `ghostty/src/apprt/gtk/scale.zig`, whose first 3,483 bytes contain exactly one
 * two-byte character (offsets 3397-3398), decoding 3483 as a BYTE offset puts it on
 * line 115 — a doc-comment line — while the published `startLine` is 116, where
 * `fn snappedAxis` actually starts. Decoding the same 3483 as a UTF-16 index puts it
 * on line 116, which agrees.
 *
 * Over three files / 279 symbols: UTF-16 decode agrees with the published `startLine`
 * **279 of 279 (100.00%)**; byte decode agrees **278 of 279 (99.64%)**, the single
 * failure being the non-ASCII file. So the byte reading is not merely close, it is
 * wrong in exactly the way that hides a real bug, and any consumer that slices a
 * `Buffer` by a published `startIndex` lands one byte off in every file containing a
 * multi-byte character. (`pool-worker.ts:923` builds snippets from LINE numbers, so it
 * never slices by index and is unaffected — which is why this survived until a control
 * read the published index directly.)
 */
function decodeIndex(txt: string, off: number): { row: number; column: number } | null {
  if (off < 0 || off > txt.length) return null
  let row = 0
  let lineStart = 0
  for (let i = 0; i < off; i++) {
    if (txt.charCodeAt(i) === 10) { row++; lineStart = i + 1 }
  }
  return { row, column: off - lineStart }
}

/** Endpoints that name a SCOPE rather than a declaration; see the deliverable-B
 *  block in the worker for why they are excluded from the ambiguity numerator. */
const SCOPE_MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(import)", "(local)"])

const isAscii = (buf: Buffer): boolean => {
  for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) return false
  return true
}

// ──────────────────────────────────────────────────────────────────── the tallies
type KindRow = { symbols: number; nameInsideSpan: number; nameOutsideSpan: number }
const kinds = new Map<string, KindRow>()
const kindRow = (k: string): KindRow => {
  let r = kinds.get(k)
  if (!r) { r = { symbols: 0, nameInsideSpan: 0, nameOutsideSpan: 0 }; kinds.set(k, r) }
  return r
}

let filesParsed = 0
let parseFailures = 0
let fallbackFiles = 0
let symbolsChecked = 0

/** One JSONL row per file: every count this file contributed, plus up to a few
 *  examples per rung. Aggregating rows is what makes a trap-death lossless. */
type Row = {
  file: string
  parsed: boolean
  fallback: boolean
  nonAscii: boolean
  symbols: number
  noRange: number
  c61: [number, number, string[]]
  c62: [number, number, string[]]
  c63: [number, number, string[]]
  c64: [number, number, string[]]
  c65: [number, number, number, number, string[], Record<string, number>]
  kinds: [string, number, number][]
  /** deliverable B — per relationship type, how many edges name an endpoint that
   *  matches MORE THAN ONE published symbol in their own file. */
  amb: [string, number, number][]
  violation: boolean
}
const rows: Row[] = []

/** What rung 5 needs per endpoint: the qualified name's ONE published span. */
type Pub = { qn: string; name: string; kind: string; si: number; ei: number }

const violationFiles = new Set<string>()

/** A zeroed row. `parsed=false` marks a file parseFile THREW on, so the row still
 *  lands in the side-car and the file is counted rather than vanishing from the
 *  population — the difference between "measured 3,834 files" and "measured 3,826". */
function blankRow(file: string, parsed: boolean): Row {
  return {
    file, parsed, fallback: false, nonAscii: false, symbols: 0, noRange: 0,
    c61: [0, 0, []], c62: [0, 0, []], c63: [0, 0, []], c64: [0, 0, []],
    c65: [0, 0, 0, 0, [], {}],
    kinds: [], amb: [], violation: false,
  }
}

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const k = key(f)
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch {
      parseFailures++
      rows.push(blankRow(k, false))
      return
    }
    if (r?.fallback === true) fallbackFiles++
    filesParsed++
    const buf = readFileSync(f.abs)
    // Decoded ONCE, and every index below is a UTF-16 index into THIS string, per
    // decodeIndex's measured note. The Buffer is kept for one thing only: isAscii.
    const txt = buf.toString("utf8")
    const nonAscii = !isAscii(buf)

    const syms: any[] = r.symbols ?? []
    const byQName = new Map<string, Pub[]>()
    /* BARE-NAME index as well, and the reason is a measured false positive.
     *
     * A `contains` edge names its target by BARE name, so `contains Action -> version`
     * in `ghostty/src/cli/ghostty.zig` resolves a target that is simultaneously the
     * file-level `const version = @import("version.zig")` [276:315] AND the enum
     * member `Action.version` [1390:1397] — both real declarations. Resolving the
     * bare name to the first match made this lane's own control report 8 nesting
     * "violations" in 8 checked edges (100%), every one of them an artifact of
     * attributing the edge to the wrong declaration. That is not a range defect; it
     * is §B's ambiguity finding wearing a range defect's clothes, and conflating the
     * two would have put a false number in this report.
     *
     * So an endpoint that matches MORE THAN ONE published symbol is counted as
     * `ambiguous` and NOT checked — the honest state is "the graph asserts one target
     * and the file declares several", which is a delivery finding for this lane and a
     * separate count from the nesting invariant. */
    const byBare = new Map<string, Pub[]>()
    const kindLocal = new Map<string, KindRow>()
    const kl = (kk: string): KindRow => {
      let rr = kindLocal.get(kk)
      if (!rr) { rr = { symbols: 0, nameInsideSpan: 0, nameOutsideSpan: 0 }; kindLocal.set(kk, rr) }
      return rr
    }
    const row: Row = blankRow(k, true)
    row.fallback = r?.fallback === true
    row.nonAscii = nonAscii

    /** span key -> the qualified names holding it, WITHIN this file. */
    const spanOwners = new Map<string, Set<string>>()

    for (const s of syms) {
      symbolsChecked++
      const nm = typeof s.name === "string" ? s.name : ""
      const kind = typeof s.kind === "string" ? s.kind : String(s.kind ?? "")
      const qn = typeof s.qualifiedName === "string" && s.qualifiedName.length
        ? s.qualifiedName
        : (typeof s.ownerName === "string" && s.ownerName.length ? `${s.ownerName}.${nm}` : nm)
      // THE PUBLISHED SHAPE, read from the production entry point rather than from
      // the analyzer's internal one. `real-zig-analyzer.ts:2696` builds
      // `{startLine, startColumn, endLine, endColumn, startIndex, endIndex}` and
      // nests it under `range`, but `src/ast/pool-worker.ts:926-934` — the SHARED
      // projection `parseFile` returns — copies FOUR of those six onto the symbol
      // (`startLine`, `endLine`, `startIndex`, `endIndex`) and DROPS BOTH COLUMNS.
      // So a first version of this instrument read `s.range`, matched nothing, and
      // reported `checked 0` on a population of 205 symbols in one file — a control
      // that measures nothing and reads as a pass, which is the exact failure the
      // workstream forbids. The `zeroCheckedRungs` gate below now refuses that
      // outcome, and it is the reason the flat read is here rather than the nested
      // one this lane's own analyzer uses internally.
      //
      // The dropped columns are a real finding and NOT this lane's to fix
      // (pool-worker.ts is shared machinery, §8): the +1 column discipline
      // `nodeRange` documents as the family standard never reaches a published
      // symbol, so byte-exact column navigation is unavailable for zig and for every
      // other language behind the same projection.
      const si: unknown = s.startIndex
      const ei: unknown = s.endIndex
      const sl: unknown = s.startLine
      const el: unknown = s.endLine
      if (typeof si !== "number" || typeof ei !== "number") {
        // Counted, not skipped: a symbol with no span cannot be navigated to.
        row.noRange++
        continue
      }
      const rg = { startLine: sl as number, endLine: el as number, startIndex: si, endIndex: ei }
      const pub: Pub = { qn, name: nm, kind, si, ei }
      const arr = byQName.get(qn)
      if (arr) arr.push(pub); else byQName.set(qn, [pub])
      const barr = byBare.get(nm)
      if (barr) barr.push(pub); else byBare.set(nm, [pub])

      // ── C6.1 offset/position agreement — the LINE half only, and the reason is
      // stated at the read above: the projection publishes no column, so there is no
      // published column to disagree with. Checking one would compare the offset
      // against this instrument's own arithmetic and call the result agreement.
      row.c61[0]++
      const ds = decodeIndex(txt, si)
      const de = decodeIndex(txt, ei)
      if (
        ds === null || de === null ||
        ds.row !== (rg.startLine ?? -1) - 1 || de.row !== (rg.endLine ?? -1) - 1
      ) {
        row.c61[1]++
        row.violation = true
        if (row.c61[2].length < 3) {
          row.c61[2].push(
            `${k}:${rg.startLine} ${qn} ` +
            `start(${si}->${ds ? `row ${ds.row} col ${ds.column}` : "OUT_OF_FILE"}) ` +
            `end(${ei}->${de ? `row ${de.row} col ${de.column}` : "OUT_OF_FILE"})`,
          )
        }
      }

      // ── C6.2 bounds and ordering
      row.c62[0]++
      if (
        si < 0 || ei < si || ei > txt.length ||
        !Number.isInteger(rg.startLine) || !Number.isInteger(rg.endLine) ||
        rg.startLine < 1 || rg.endLine < rg.startLine
      ) {
        row.c62[1]++
        row.violation = true
        if (row.c62[2].length < 3) {
          row.c62[2].push(`${k}:${qn} startIndex=${si} endIndex=${ei} units=${txt.length} lines=${rg.startLine}:${rg.endLine}`)
        }
      }

      // ── C6.3 name containment, per kind
      kl(kind).symbols++
      row.c63[0]++
      const spanText = txt.slice(si, ei)
      if (nm.length > 0 && spanText.includes(nm)) {
        kl(kind).nameInsideSpan++
      } else {
        kl(kind).nameOutsideSpan++
        row.c63[1]++
        row.violation = true
        if (row.c63[2].length < 3) {
          row.c63[2].push(`${k}:${rg.startLine} ${qn} kind=${kind} name=${JSON.stringify(nm)} span=${JSON.stringify(spanText.slice(0, 60))}`)
        }
      }

      // ── C6.4 span collision, over DISTINCT qualified names
      const sk = `${si}:${ei}`
      const owners = spanOwners.get(sk)
      if (!owners) { spanOwners.set(sk, new Set([qn])); row.c64[0]++ }
      else if (!owners.has(qn)) {
        owners.add(qn); row.c64[0]++; row.c64[1]++; row.violation = true
        if (row.c64[2].length < 3) row.c64[2].push(`${k} span ${sk} held by ${[...owners].sort().join(" | ")}`)
      }
    }

    // ── C6.5 `contains` nesting
    for (const e of (r.relationships ?? [])) {
      if (String(e.type ?? e.relationshipType ?? "") !== "contains") continue
      const src = String(e.source ?? "")
      const tgt = String(e.target ?? "")
      // SOURCE by qualified name (a `contains` source is an owner's name, and the
      // owner index is unambiguous by construction). TARGET by BARE name across EVERY
      // published symbol in the file, and uniqueness is REQUIRED.
      //
      // The first version resolved the target as `byQName.get(tgt) ?? byBare.get(tgt)`,
      // and that short-circuit defeated the ambiguity guard it sat behind: for
      // `contains Action -> version` the qn index holds exactly one `version` (the
      // file-level `const version = @import("version.zig")`), so `ct.length === 1`
      // passed while the file ALSO declares `Action.version` at [1390:1397]. The
      // control then compared the enum's span against an unrelated top-level import
      // and called it a nesting violation. Measured cost of that one short-circuit at
      // the full population: **1,129 phantom violations** — 997 `other` plus 132
      // `short-parent`, every one of them a real edge bound to the wrong of two real
      // declarations. `EI -> CLASS`, `Kind -> std` and `Foo -> a` are the same shape.
      //
      // Resolving by bare name and requiring exactly one candidate is what makes the
      // remaining count mean something: an endpoint with two declarations is §B's
      // ambiguity finding, counted as `ambiguous`, NOT a range defect.
      const cs = byQName.get(src) ?? byBare.get(src)
      const ct = byBare.get(tgt)
      if (!cs || !ct) { row.c65[3]++; continue }
      if (cs.length !== 1 || ct.length !== 1) { row.c65[2]++; continue }
      const p = cs[0]
      const ch = ct[0]
      row.c65[0]++
      // The child must lie inside the parent. Equal spans are NOT nesting: a
      // declaration cannot contain itself by occupying the same bytes, and rung 4
      // already reports a same-span pair under different names.
      if (!(ch.si >= p.si && ch.ei <= p.ei && (ch.si !== p.si || ch.ei !== p.ei))) {
        row.c65[1]++
        row.violation = true
        // CLASSIFIED, because "N violations" without a shape is a number rather than
        // a finding, and the shapes here have different owners. The parent span's own
        // TEXT is the discriminator, and it is read from the file rather than guessed:
        //
        //   this-alias   the parent's span IS `const X = @This();` — zig's
        //                module-as-type idiom. The span is byte-accurate for the node
        //                it is attached to; the IDENTITY is what is wrong, because the
        //                alias shares a name with the container whose members the edge
        //                is about. Measured on `ghostty/src/App.zig`: `App` is published
        //                as a 20-character `const App = @This();` [174:194] on line 4,
        //                ~50 fields carry ownerName `App`, and the struct that actually
        //                declares them is published as NO symbol at all.
        //   short-parent the parent's span is real but far smaller than the members it
        //                is said to contain.
        //   other        neither of the above.
        const pText = txt.slice(p.si, p.ei)
        const shape = pText.includes("@This()") ? "this-alias" : (p.ei - p.si < 64 ? "short-parent" : "other")
        row.c65[5][shape] = (row.c65[5][shape] ?? 0) + 1
        if (row.c65[4].length < 3) {
          row.c65[4].push(`${k} contains ${src} [${p.si}:${p.ei}] -> ${tgt} [${ch.si}:${ch.ei}]  shape=${shape} parentText=${JSON.stringify(pText.slice(0, 40))}`)
        }
      }
    }

    // ── DELIVERABLE B: endpoint ambiguity, per relationship type.
    //
    // The task's §B asks for the count of targets that resolve to more than one
    // published declaration, because an ambiguous target is ONE edge attributed to
    // ONE declaration and the reverse walk picks one by a rule nobody chose. Both
    // endpoints are counted, per type, against the file's own symbol table — so this
    // is an intra-file ambiguity rate, which is the tightest reading and the one a
    // reverse walk inside one file actually faces.
    //
    // SCOPE MARKERS are excluded, and that is stated rather than silent: a source of
    // `(global)`/`(file)`/`(local)` names a SCOPE, not a declaration, so counting it as
    // ambiguous would inflate every type that uses markers (100% of `exports`,
    // `imports` and `references` per pass 20 §I) with an ambiguity that does not exist.
    const ambLocal = new Map<string, [number, number]>()
    const ambRow = (t: string): [number, number] => {
      let v = ambLocal.get(t)
      if (!v) { v = [0, 0]; ambLocal.set(t, v) }
      return v
    }
    for (const e of (r.relationships ?? [])) {
      const t = String(e.type ?? e.relationshipType ?? "")
      for (const ep of [String(e.source ?? ""), String(e.target ?? "")]) {
        if (SCOPE_MARKERS.has(ep)) continue
        const n = (byQName.get(ep)?.length ?? 0) + 0
        const b = byBare.get(ep)?.length ?? 0
        const declarations = Math.max(n, b)
        const v = ambRow(t)
        v[0]++
        if (declarations > 1) v[1]++
      }
    }
    row.amb = [...ambLocal.entries()].map(([t, v]) => [t, v[0], v[1]])

    row.kinds = [...kindLocal.entries()].map(([kk, v]) => [kk, v.symbols, v.nameInsideSpan])
    row.symbols = syms.length
    if (row.violation) violationFiles.add(k)
    rows.push(row)
    // The side-car append is what makes a `[BB-HANG]` death lossless; see JSONL above.
    appendFileSync(JSONL, JSON.stringify(row) + "\n")
  }
}

const WORKERS = Number(arg("workers", "4"))
if (!AGGREGATE_ONLY) {
  writeFileSync(JSONL, "")
  await Promise.all(Array.from({ length: WORKERS }, () => worker()))
  console.log(`measured ${rows.length} file(s) -> ${JSONL}`)
}

// ────────────────────────────────────────── aggregate the side-car into the report
/** Read every side-car row, so a shard killed by the leaked bomb still contributes.
 *  `JSONL_DIR` collects the per-shard side-cars of one population; without it the
 *  single `--jsonl` of this run is used. */
const JSONL_DIR = arg("jsonl-dir", "")
const allRows: Row[] = JSONL_DIR
  ? readdirSync(JSONL_DIR).filter((f) => f.endsWith(".jsonl")).sort()
      .flatMap((f) => readFileSync(path.join(JSONL_DIR, f), "utf8").split("\n").filter(Boolean)
        .map((l) => { try { return JSON.parse(l) as Row } catch { return null } })
        .filter((x): x is Row => x !== null))
  : (() => {
      try {
        return readFileSync(JSONL, "utf8").split("\n").filter(Boolean)
          .map((l) => { try { return JSON.parse(l) as Row } catch { return null } })
          .filter((x): x is Row => x !== null)
      } catch { return [] as Row[] }
    })()

const agg = {
  files: allRows.length,
  parsed: allRows.filter((r) => r.parsed).length,
  fallback: allRows.filter((r) => r.fallback).length,
  symbols: allRows.reduce((n, r) => n + r.symbols, 0),
  noRange: allRows.reduce((n, r) => n + r.noRange, 0),
  nonAsciiFiles: allRows.filter((r) => r.nonAscii).length,
}
const sum = (pick: (r: Row) => [number, number, ...unknown[]], ex: (r: Row) => string[], cap = 12): [number, number, string[]] => {
  let checked = 0, violations = 0
  const examples: string[] = []
  for (const r of allRows) {
    const [c, v] = pick(r)
    checked += c; violations += v
    for (const e of ex(r)) if (examples.length < cap) examples.push(e)
  }
  return [checked, violations, examples]
}
const c61 = sum((r) => r.c61, (r) => r.c61[2])
const c62 = sum((r) => r.c62, (r) => r.c62[2])
const c63 = sum((r) => r.c63, (r) => r.c63[2])
const c64 = sum((r) => r.c64, (r) => r.c64[2])
const c65 = sum((r) => r.c65, (r) => r.c65[4])
const c65Ambiguous = allRows.reduce((n, r) => n + r.c65[2], 0)
const c65Unresolved2 = allRows.reduce((n, r) => n + r.c65[3], 0)
const c65Shapes: Record<string, number> = {}
for (const r of allRows) for (const [k2, v] of Object.entries(r.c65[5] ?? {})) c65Shapes[k2] = (c65Shapes[k2] ?? 0) + v

for (const [kk, syms2, inside] of allRows.flatMap((r) => r.kinds)) {
  const t = kindRow(kk)
  t.symbols += syms2; t.nameInsideSpan += inside; t.nameOutsideSpan += syms2 - inside
}
const c63Table = [...kinds.entries()]
  .map(([kk, r]) => ({
    kind: kk,
    symbols: r.symbols,
    nameInsideSpan: r.nameInsideSpan,
    nameOutsideSpan: r.nameOutsideSpan,
    insidePct: r.symbols ? Number(((r.nameInsideSpan / r.symbols) * 100).toFixed(2)) : null,
  }))
  .sort((a, b) => b.symbols - a.symbols)

const ambTable = allRows
  .flatMap((r) => r.amb ?? [])
  .reduce((acc: [string, number, number][], [t, n, a]) => {
    const e = acc.find((x) => x[0] === t)
    if (e) { e[1] += n; e[2] += a } else acc.push([t, n, a])
    return acc
  }, [])
  .map(([type, endpoints, ambiguous]) => ({
    type,
    declarationEndpoints: endpoints,
    ambiguousEndpoints: ambiguous,
    ambiguousPct: endpoints ? Number(((ambiguous / endpoints) * 100).toFixed(2)) : null,
  }))
  .sort((a, b) => b.declarationEndpoints - a.declarationEndpoints)
const ambTotal = ambTable.reduce((n, x) => n + x.ambiguousEndpoints, 0)
const ambEnds = ambTable.reduce((n, x) => n + x.declarationEndpoints, 0)

const report = {
  instrument: "validation/m14/fixtures/zig/range-agreement.ts",
  control: "C6 — published range agreement",
  measuredOn: MEASURED_ON,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  population: { seed: SEED, drawHash, shard: FILES_FROM || "full hashed draw", jsonlDir: JSONL_DIR || "single" },
  run: agg,
  rungs: {
    c61_offsetPositionAgreement: { checked: c61[0], violations: c61[1], examples: c61[2] },
    c62_boundsOrdering: { checked: c62[0], violations: c62[1], examples: c62[2] },
    c63_nameContainment: { checked: c63[0], violations: c63[1], examples: c63[2], byKind: c63Table },
    c64_spanCollision: { checked: c64[0], violations: c64[1], examples: c64[2] },
    c65_containsNesting: {
      checked: c65[0], violations: c65[1],
      ambiguousEndpointsSkipped: c65Ambiguous, unresolvedEndpointsSkipped: c65Unresolved2,
      byShape: c65Shapes,
      examples: c65[2],
    },
  },
  deliverableB_endpointAmbiguity: {
    note: "intra-file: an endpoint is ambiguous when its name matches >1 published symbol in the SAME file. Scope markers excluded.",
    declarationEndpoints: ambEnds,
    ambiguousEndpoints: ambTotal,
    ambiguousPct: ambEnds ? Number(((ambTotal / ambEnds) * 100).toFixed(2)) : null,
    byType: ambTable,
  },
  noRangeSymbols: agg.noRange,
  // Derived from the ROWS, not from the in-memory set: under `--aggregate` no worker
  // runs, so reading the set reported 0 violating files beside 4,081 violating edges —
  // the two numbers contradicting each other in one artifact, which is worse than
  // either being wrong alone. (Found by the aggregation disagreeing with the shards.)
  filesWithAnyViolation: allRows.filter((r) => r.violation).length,
  violationFileExamples: allRows.filter((r) => r.violation).map((r) => r.file).slice(0, 15),
}

writeFileSync(OUT, JSON.stringify(report, null, 2))

console.log(`C6 range agreement — ${agg.files} rows, ${agg.parsed} parsed, ${agg.symbols} symbols`)
console.log(`  run: fallback ${agg.fallback}  nonAsciiFiles ${agg.nonAsciiFiles}  noRange ${agg.noRange}`)
console.log(`  C6.1 offset/position agreement : checked ${c61[0]}  violations ${c61[1]}`)
console.log(`  C6.2 bounds and ordering       : checked ${c62[0]}  violations ${c62[1]}`)
console.log(`  C6.3 name containment          : checked ${c63[0]}  violations ${c63[1]}`)
console.log(`  C6.4 span collision            : checked ${c64[0]}  violations ${c64[1]}`)
console.log(`  C6.5 contains nesting          : checked ${c65[0]}  violations ${c65[1]}  (ambiguous ${c65Ambiguous}, unresolved ${c65Unresolved2})`)
console.log(`       by shape: ${Object.entries(c65Shapes).map(([a, b]) => `${a}=${b}`).join("  ") || "none"}`)
console.log(`  deliverable B — intra-file endpoint ambiguity: ${ambTotal} of ${ambEnds} declaration endpoints (${ambEnds ? ((ambTotal / ambEnds) * 100).toFixed(2) : "0"}%)`)
for (const x of ambTable) console.log(`       ${x.type.padEnd(14)} ${String(x.ambiguousEndpoints).padStart(7)} / ${String(x.declarationEndpoints).padStart(7)}  ${x.ambiguousPct}%`)
console.log(`  files with >=1 violation: ${allRows.filter((r) => r.violation).length}  wrote ${OUT}`)

// The gate is a COUNT, and every rung is reported rather than one verdict: a bound
// read as a pass is the defect this lane keeps finding in other lanes' instruments.
//
// AND THE GATE FAILS WHEN A RUNG MEASURED NOTHING. This clause is not hypothetical:
// the first run of this instrument read the analyzer's internal `s.range`, which the
// production projection does not publish, and printed `C6.1 … checked 0 violations 0`
// for 205 symbols in a single file — four rungs reporting a clean pass over a
// population they never touched. A control that checks 0 against a non-empty
// population has not passed; it has not run, and the only honest exit code for that
// state is non-zero.
const rungsByName: [string, number, number][] = [
  ["C6.1 offset/position agreement", c61[0], c61[1]],
  ["C6.2 bounds and ordering", c62[0], c62[1]],
  ["C6.3 name containment", c63[0], c63[1]],
  ["C6.4 span collision", c64[0], c64[1]],
  ["C6.5 contains nesting", c65[0], c65[1]],
]
const zeroChecked = agg.parsed > 0 && agg.symbols > 0 ? rungsByName.filter(([, c]) => c === 0).map(([n]) => n) : []
const total = c61[1] + c62[1] + c63[1] + c64[1] + c65[1]
if (zeroChecked.length) {
  console.log(`  gate: REFUSING — ${zeroChecked.join(", ")} checked 0 over ${agg.symbols} symbols in ${agg.parsed} files. A rung that measures nothing is not a pass.`)
  process.exit(2)
}
console.log(total === 0
  ? "  gate: 0 violations across all five rungs"
  : `  gate: ${total} violation(s) — see examples above and the artifact`)
process.exit(total === 0 ? 0 : 1)
