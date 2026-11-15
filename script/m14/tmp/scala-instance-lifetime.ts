// scala-instance-lifetime.ts — why does the scala lane read ZERO truth edges at full
// extent, and what else is wrong underneath it?
//
// Measured facts this probe starts from (all reproducible, all in the repo's own
// artefacts):
//   * `differential.ts --lang scala --sample 100000` throws
//       "parsed 18435 file(s) and derived ZERO truth edges — the parser or the oracle
//        is dead" (the parsed-but-empty guard, differential.ts:13662).
//   * The SAME lane on the SAME corpus at 60 files is healthy: the pinned F5 artefact
//     records scala3 treeTruthEdges 628 / coverage 100% / MISSING 0, cats-effect 1462.
//   * A first run of THIS probe (one instance, one pass, parse + oracle) read 16,000
//     files with 52,437 truth edges and no failure — the instance is alive well past
//     the "~9,000-10,000 parses" figure engine.ts rotates for — and then died with
//         TypeError: undefined is not an object (evaluating 'decls[nm].methods.add')
//           at collectDecl (differential.ts:12026) -> collectDecl -> deriveTreeEdges
//     i.e. an ORACLE crash on a real scala3 file, not a parser failure.
//
// So there are two defects, and they MASK EACH OTHER. The harness's lane loop parses
// the whole sample up to FOUR times on one instance (three retry passes when the load
// average is above 4 — this box sits at 10-12 — plus the measuring pass), and it calls
// `deriveTreeEdges` OUTSIDE any try. If the instance is dead by the measuring pass, the
// loop `continue`s on every file: zero truth, guard fires, nothing else is ever called.
// If the instance is alive, the measuring pass reaches the crashing file and the lane
// dies with a TypeError instead.
//
// This probe measures both sides separately, one process per mode:
//   one     one instance, one pass (parse + oracle): first decay, every oracle throw
//   sweep   ONE instance, the harness's shape: 3 parse-only passes + 1 measuring pass
//   rotate  a fresh Parser every 500 parses, same shape: the fix's proof, per pass
//   file    the file the oracle threw on, alone on a fresh parser (instance vs file)
//
// "Decay" is what a dead instance looks like from the loop's seat: a thrown parse, a
// null root, or an EMPTY tree for a NON-EMPTY file. The last case needs the size test:
// this corpus contains two 0-byte `.scala` files (one is literally `empty-file.scala`),
// and a 0-byte file legitimately parses to an empty tree — the first version of this
// probe reported that as decay at #430 in both modes, which is the shape of a wrong
// instrument, so the signal is now a CANARY: every 100 parses the same instance parses
// a fixed three-line snippet, and a canary that throws or comes back empty is the
// instance's death, measured rather than inferred.
//
// Run:
//   bun script/m14/tmp/scala-instance-lifetime.ts one|sweep|rotate|file [repoRoot] [limit]
//   BB_PROBE_ROOT=<tree>  measure another checkout's harness (a pinned replica), so the
//                         numbers are of committed content, not a shared working tree.
import fs from "node:fs"
import path from "node:path"

const ROOT = process.env.BB_PROBE_ROOT ?? "/home/ishaq2321/mcp/backbencher-brain"
const MODE = process.argv[2] ?? "one"
const REPO = process.argv[3] ?? "/home/ishaq2321/bb_tests/repositories/scala3"
const LIMIT = Number(process.argv[4] ?? "0")
const EXT = ".scala"
const CHUNK = 500 // engine.ts's own rotation rule, the one the differential does not use
const CANARY = "object Canary { def f(): Int = 1 }"
const CANARY_EVERY = 100
// Per-mode, so two modes run side by side without overwriting each other's evidence.
// `file` reads another mode's record by default (it is a follow-up, not a measurement),
// and BB_PROBE_ORACLE_LIST names any other one.
const ORACLE_THROWS = process.env.BB_PROBE_ORACLE_LIST ?? `/tmp/scala-lifetime-oracle-${MODE === "file" ? "one" : MODE}.json`

const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-scala.wasm")))

// The harness's own walk rule (differential.ts:12790): skip dot/node_modules/build/
// target, admit by extension. Char-scans, no regex (this repo's R2 policy).
const skippable = (name: string): boolean =>
  name.startsWith(".") || name === "node_modules" || name === "build" || name === "target"
const files: string[] = []
const scan = (d: string): void => {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!skippable(e.name)) scan(p) }
    else if (e.name.endsWith(EXT)) files.push(p)
  }
}
scan(REPO)
const sample = LIMIT > 0 ? files.slice(0, LIMIT) : files
const mk = (): any => { const p = new P(); p.setLanguage(grammar); return p }

interface Stats {
  ok: number; empty: number; threw: number; edges: number
  firstDecay: { i: number; f: string; kind: string } | null
  oracleThrows: { i: number; f: string; msg: string }[]
}
const blank = (): Stats => ({ ok: 0, empty: 0, threw: 0, edges: 0, firstDecay: null, oracleThrows: [] })

/** One pass over `list`. `oracle` false models the retry loop (parse only, no truth). */
function runPass(label: string, list: string[], parser: any, oracle: boolean, rotateEvery: number): { stats: Stats; parser: any } {
  const st = blank()
  let live = parser
  let since = 0
  const t0 = performance.now()
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && i % CANARY_EVERY === 0 && !st.firstDecay) {
      // The instance's own health, independent of any file's content.
      let bad: string | null = null
      try {
        const c = live.parse(CANARY)?.rootNode
        if (!c) bad = "canary returned no root"
        else if (c.childCount === 0) bad = `canary returned an EMPTY tree (root=${c.type})`
      } catch (e: any) { bad = `canary THREW ${String(e?.message ?? e).slice(0, 60)}` }
      if (bad) {
        st.firstDecay = { i, f: list[i], kind: `${bad} — the INSTANCE is dead, not this file` }
        console.log(`    !! FIRST DECAY [${label}] at #${i} ${path.relative(REPO, list[i])}: ${st.firstDecay.kind}`)
      }
    }
    if (rotateEvery > 0 && since >= rotateEvery) {
      try { live?.delete?.() } catch { /* best effort */ }
      live = mk()
      since = 0
    }
    let content: string
    try { content = fs.readFileSync(list[i], "utf8") } catch { st.threw++; since++; continue }
    let root: any = null
    try { root = live.parse(content)?.rootNode ?? null } catch (e: any) {
      st.threw++
      if (!st.firstDecay) {
        st.firstDecay = { i, f: list[i], kind: `parse THREW ${String(e?.message ?? e).slice(0, 60)}` }
        console.log(`    !! FIRST DECAY [${label}] at #${i} ${path.relative(REPO, list[i])}: ${st.firstDecay.kind}`)
      }
      since++
      continue
    }
    since++
    if (!root) { st.empty++; if (!st.firstDecay) { st.firstDecay = { i, f: list[i], kind: "null root" }; console.log(`    !! FIRST DECAY [${label}] at #${i}: null root`) } continue }
    // A poisoned instance can return an EMPTY tree (childCount 0): the harness calls
    // that a successful read, and the guard only notices when EVERY read is empty. The
    // legitimate case is a file with nothing to parse — this corpus holds a 0-byte
    // `empty-file.scala` AND a 1-byte `deathname.scala` (a lone newline) — so the test
    // is on the CONTENT, and it must not consume the one firstDecay slot the canary
    // needs: an empty tree for whitespace-only content is recorded in `empty` and
    // nothing else.
    if (root.childCount === 0 && content.trim().length === 0) { st.empty++; continue }
    if (root.childCount === 0) {
      // An empty tree for content that is NOT whitespace: this is the poisoned-instance
      // shape (the harness reads it as a successful, empty parse).
      st.empty++
      if (!st.firstDecay) {
        st.firstDecay = { i, f: list[i], kind: "EMPTY tree (childCount 0) for NON-empty content — an instance returning empty trees, not throwing" }
        console.log(`    !! FIRST DECAY [${label}] at #${i} ${path.relative(REPO, list[i])}: ${st.firstDecay.kind}`)
      }
      continue
    }
    st.ok++
    if (oracle) {
      try { st.edges += diff.deriveTreeEdges(root, "scala").length } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 160)
        st.oracleThrows.push({ i, f: list[i], msg })
        console.log(`    !! ORACLE THREW [${label}] at #${i} ${path.relative(REPO, list[i])}: ${msg}`)
      }
    }
    if ((i + 1) % 2000 === 0) {
      console.log(`    [${label}] ${i + 1}/${list.length} ok=${st.ok} empty=${st.empty} threw=${st.threw} edges=${st.edges} (${((performance.now() - t0) / 1000).toFixed(0)}s)`)
    }
  }
  return { stats: st, parser: live }
}

const line = (label: string, st: Stats, n: number): void => {
  console.log(`  ${label}: read=${st.ok + st.empty}/${n} ok=${st.ok} empty=${st.empty} threw=${st.threw} truthEdges=${st.edges} oracleThrows=${st.oracleThrows.length}`)
  if (st.firstDecay) console.log(`    first decay #${(st.firstDecay as any).i} ${path.relative(REPO, (st.firstDecay as any).f)} — ${(st.firstDecay as any).kind}`)
  else console.log(`    first decay: none — the instance survived all ${n} parse(s) of the pass (canary checked every ${CANARY_EVERY})`)
}

console.log(`scala3: ${files.length} ${EXT} file(s) discovered; measuring ${sample.length}; mode=${MODE}; harness=${ROOT}`)

if (MODE === "one") {
  const r = runPass("one", sample, mk(), true, 0)
  console.log(`\nONE INSTANCE, ONE PASS`)
  line("one", r.stats, sample.length)
  fs.writeFileSync(ORACLE_THROWS, JSON.stringify(r.stats.oracleThrows, null, 1) + "\n")
  if (r.stats.oracleThrows.length) console.log(`  wrote ${r.stats.oracleThrows.length} oracle throw(s) to ${ORACLE_THROWS}`)
  try { r.parser?.delete?.() } catch { /* best effort */ }
}

if (MODE === "sweep" || MODE === "rotate") {
  const rotate = MODE === "rotate" ? CHUNK : 0
  console.log(`\n${rotate ? `ROTATED (fresh Parser every ${rotate})` : "ONE INSTANCE"}: the harness's shape — 3 parse-only passes, then the measuring pass`)
  let parser = mk()
  const passes: Stats[] = []
  for (let p = 1; p <= 4; p++) {
    const oracle = p === 4 // the measuring pass is the last one; retries bypass the oracle
    const r = runPass(`pass${p}${oracle ? "+oracle" : ""}`, sample, parser, oracle, rotate)
    passes.push(r.stats)
    parser = r.parser
    line(`pass ${p}${oracle ? " (measuring)" : ""}`, r.stats, sample.length)
  }
  const measuring = passes[3]
  const verdicts = passes.map((s, i) => `p${i + 1}=${s.threw + s.empty === sample.length ? "ALL DEAD" : `read ${s.ok + s.empty}`}`)
  console.log(`\nVERDICT (${MODE}): ${verdicts.join(", ")}`)
  console.log(`  the measuring pass derived ${measuring?.edges ?? 0} truth edge(s); the guard fires on ZERO, so ${(measuring?.edges ?? 0) === 0 ? "this run reproduces the lane failure" : "this shape reads the lane"}`)
  if (passes[3]?.oracleThrows.length) {
    fs.writeFileSync(ORACLE_THROWS, JSON.stringify(passes[3].oracleThrows, null, 1) + "\n")
    console.log(`  and it hit ${passes[3].oracleThrows.length} ORACLE throw(s) — written to ${ORACLE_THROWS}`)
  }
  try { parser?.delete?.() } catch { /* best effort */ }
}

if (MODE === "file") {
  const throws: { i: number; f: string; msg: string }[] = JSON.parse(fs.readFileSync(ORACLE_THROWS, "utf8"))
  const first = throws[0]
  if (!first) { console.log("no recorded oracle throw — run `one` or `sweep` first"); process.exit(0) }
  console.log(`\nFILE-LEVEL REPRO: ${first.f}`)
  console.log(`  recorded message: ${first.msg}`)
  const p = mk()
  const content = fs.readFileSync(first.f, "utf8")
  const root = p.parse(content).rootNode
  console.log(`  parses alone: root=${root?.type} childCount=${root?.childCount} hasError=${root?.hasError}`)
  try {
    const edges = diff.deriveTreeEdges(root, "scala").length
    console.log(`  oracle on the fresh instance: OK, ${edges} edge(s) — NOT reproducible in isolation`)
  } catch (e: any) {
    console.log(`  oracle on the fresh instance: THREW again — ${String(e?.message ?? e).slice(0, 160)}`)
    console.log(`  => a file-dependent oracle defect, reproducible on one file and one parse`)
  }
  console.log(`  total recorded oracle throws in that run: ${throws.length} (${[...new Set(throws.map((t) => path.basename(t.f)))].slice(0, 6).join(", ")})`)
  try { p?.delete?.() } catch { /* best effort */ }
}
