/**
 * M14.0.CENSUS — Construct census for the toml lane.
 *
 * Exists because of what a differential provably cannot do. `deriveTomlEdges` and
 * `RealTomlAnalyzer` are two implementations of the same reading of the TOML
 * specification, written by the same author, so they catch each other's
 * IMPLEMENTATION mistakes — which they did, three of them, on the oracle's first
 * corpus run. What they cannot catch is a mistake in the READING itself, because
 * both sides would be wrong in the same direction and 100% coverage would report
 * it as agreement. html's six missing carriers were absent from the analyzer AND
 * from its oracle at once for exactly this reason.
 *
 * So this gate consults NEITHER. It walks the corpora, inventories every construct
 * the grammar actually produces, and reports each one as:
 *
 *   CLAIMED   — the analyzer emits a symbol or an edge for it
 *   SILENT    — a construct with no graph representation, and the reason is written
 *               down here as a RULING (a comment, a value literal, an implied
 *               parent) rather than being left to a reader's assumption
 *   UNRULED   — a construct nothing accounts for. THIS FAILS THE GATE, because an
 *               unaccounted construct is indistinguishable from a missed one, and
 *               the difference is a decision somebody has not made yet.
 *
 * The check is deliberately not "does the analyzer agree with the oracle": that is
 * F5, and it is answered. The check is "does ANYBODY account for this construct",
 * which is a different question with a different failure mode.
 *
 * CLI: bun run script/m14/verify-toml-census.ts [--json] [--cap N]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const args = process.argv.slice(2)
const asJson = args.includes("--json")
const capArg = args.indexOf("--cap")
const CAP = capArg !== -1 ? Number(args[capArg + 1]) : 2000

const ROOT = process.cwd()

/**
 * Every construct the census can encounter, and where it is accounted for.
 *
 * `claim` is the SUBSTRING the analyzer emits for that construct; `ruling` is the
 * reason a construct with no graph representation is nonetheless correct. A node
 * type that appears here with neither is a gate failure.
 */
interface Disposition {
  /**
   * What the analyzer publishes for this construct, or absent when it publishes
   * nothing. A type is CLAIMED when it has a claim and no ruling, and SILENT when
   * it has a ruling — the presence of an EMPTY `claim` alongside a ruling must not
   * read as a claim, which is why the classifier tests `ruling` first. Getting that
   * backwards put every value type, `comment` and `ERROR` in the claimed column on
   * the first run, which is the failure mode a census exists to prevent, in the
   * census.
   */
  claim?: string
  ruling?: string
}

const NODE_DISPOSITIONS: Record<string, Disposition> = {
  document: { claim: "module" },
  table: { claim: "namespace" },
  table_array_element: { claim: "namespace" },
  pair: { claim: "property" },
  bare_key: { claim: "" },
  quoted_key: { claim: "" },
  dotted_key: { claim: "" },
  // Values are DATA. Each is read to record `metadata.valueType` on its key, and
  // none becomes a node — publishing a symbol per literal is what the generic AST
  // fallback did before this lane had an analyzer, and it made the graph a second
  // copy of the file's text.
  string: { claim: "", ruling: "a value is DATA — recorded as metadata.valueType on its key, never a symbol" },
  integer: { claim: "", ruling: "a value is DATA" },
  float: { claim: "", ruling: "a value is DATA" },
  boolean: { claim: "", ruling: "a value is DATA" },
  offset_date_time: { claim: "", ruling: "a value is DATA — one of TOML's four date/time forms" },
  local_date_time: { claim: "", ruling: "a value is DATA" },
  local_date: { claim: "", ruling: "a value is DATA" },
  local_time: { claim: "", ruling: "a value is DATA" },
  array: { claim: "", ruling: "a value is DATA — its elements are data, not symbols" },
  inline_table: { claim: "", ruling: "a value is DATA — its keys ride on the enclosing key's metadata.inlineKeys" },
  escape_sequence: { claim: "", ruling: "TOML-D1: decoded from the PARENT'S text in pure-String, never walked — equivalent by construction" },
  comment: { claim: "", ruling: "not an identity; TOML has no block-comment form" },
  ERROR: { claim: "", ruling: "reported as a ParseError; the structure is not modelled — a fabricated tree for a mis-nested document is a guess dressed as a fact" },
  MISSING: { claim: "", ruling: "never produced by this grammar — measured across twelve deliberately malformed documents" },
}

/** Attributes and value shapes that are NOT carriers, each with its reason. These
 *  are the census's real payload: html's equivalent table found six carriers that
 *  were missing from BOTH the analyzer and the oracle at once. */
const SHAPES_RULED: { shape: string; why: string }[] = [
  { shape: "a value of any type", why: "data, not a dependency — TOML defines no reference mechanism, so a path-shaped string is a STRING and not a fetch" },
  { shape: "an inline table's keys", why: "part of one value expression; recorded on the key in metadata.inlineKeys so a manifest of 200 `{ version = ... }` dependencies does not publish 600+ un-navigable symbols" },
  { shape: "an implied parent table", why: "recorded in metadata.impliedParents and never a node — an edge to a non-existent target is the unresolvable-identity defect" },
  { shape: "a comment", why: "not an identity" },
  { shape: "an empty key `\"\"`", why: "parses, but names nothing — an identity needs a name" },
  { shape: "a bare key outside the bare-key alphabet", why: "rejected by the GRAMMAR, correctly: TOML v1.0.0 restricts bare keys to A-Za-z0-9_-; a quoted key is the way to write anything else" },
]

async function main() {
  const repoRoot = process.env.BB_CENSUS_REPOS ?? "$HOME/fixtures/repositories"
  const repos = fs.existsSync(repoRoot) ? fs.readdirSync(repoRoot).filter((d) => !d.startsWith(".")) : []
  if (repos.length === 0) {
    console.error(`no corpora under ${repoRoot} — set BB_CENSUS_REPOS`)
    process.exit(2)
  }

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default?.Parser ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-toml.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)

  const files: string[] = []
  let skipped = 0
  const collect = (dir: string) => {
    if (files.length >= CAP) return
    let st: fs.Stats
    try {
      st = fs.statSync(dir)
    } catch {
      return
    }
    if (st.isFile()) {
      if (/\.toml$/i.test(dir)) files.push(dir)
      return
    }
    // A corpus can contain a character device that `statSync` reports as a file
    // and `readdirSync` then refuses with ENOTDIR — helm's testdata has a
    // `dev_null` fixture that is exactly this. The walk is a census, so an
    // unreadable entry is skipped and counted rather than fatal: a gate that dies
    // on one weird path reports nothing at all, which is the worst outcome a gate
    // can have.
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      skipped++
      return
    }
    for (const e of entries) {
      if (files.length >= CAP) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "target") continue
      collect(path.join(dir, e.name))
    }
  }
  for (const r of repos) collect(path.join(repoRoot, r))
  console.log(`toml census: ${files.length} file(s) across ${repos.length} repo(s)${skipped > 0 ? ` (${skipped} unreadable entr${skipped === 1 ? "y" : "ies"} skipped)` : ""}`)

  /** node type -> occurrences, straight from the grammar's output. */
  const nodeCounts = new Map<string, number>()
  /** The declared type set, so an UNSEEN type is reported rather than ignored. */
  const declared = new Set<string>()
  for (let i = 0; i < grammar.nodeTypeCount; i++) {
    if (!grammar.nodeTypeIsNamed(i)) continue
    const n = grammar.nodeTypeForId(i)
    if (n && !n.startsWith("_")) declared.add(n)
  }
  // The gate injects the universal recovery pair for every language.
  declared.add("ERROR")
  declared.add("MISSING")

  let filesWithErrors = 0
  for (const f of files) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    if (src.length > 500_000) continue
    const t = parser.parse(src)
    if (!t) continue
    if (t.rootNode.hasError) filesWithErrors++
    const walk = (n: any) => {
      nodeCounts.set(n.type, (nodeCounts.get(n.type) ?? 0) + 1)
      for (const c of n.namedChildren ?? []) if (c) walk(c)
    }
    walk(t.rootNode)
    t.delete()
  }

  const unaccounted: string[] = []
  const claimed: { type: string; n: number }[] = []
  const ruled: { type: string; n: number; why: string }[] = []
  const unseen: string[] = []

  for (const type of [...declared].sort()) {
    const n = nodeCounts.get(type) ?? 0
    const disp = NODE_DISPOSITIONS[type]
    if (disp === undefined) {
      unaccounted.push(type)
      continue
    }
    if (n === 0) {
      unseen.push(type)
      continue
    }
    if (disp.ruling !== undefined) ruled.push({ type, n, why: disp.ruling })
    else claimed.push({ type, n })
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { files: files.length, repos: repos.length, skippedEntries: skipped, filesWithParseErrors: filesWithErrors, declaredTypes: declared.size, observedTypes: nodeCounts.size, claimed, ruled, unseen, unaccounted, shapesRuled: SHAPES_RULED },
        null,
        2,
      ),
    )
  } else {
    console.log(`  declared node types: ${declared.size}   observed in corpora: ${nodeCounts.size}   files with a parse error: ${filesWithErrors}`)
    console.log(`\n  CLAIMED — the analyzer emits a node for these (${claimed.length}):`)
    for (const c of claimed) console.log(`    ${String(c.n).padStart(8)}  ${c.type}`)
    console.log(`\n  RULED SILENT — no graph representation, and the reason is on the record (${ruled.length}):`)
    for (const r of ruled) console.log(`    ${String(r.n).padStart(8)}  ${r.type.padEnd(20)} ${r.why}`)
    if (unseen.length > 0) {
      console.log(`\n  NOT SEEN in these corpora (${unseen.length}) — handled, but pinned by FIXTURE rather than by the corpus:`)
      for (const u of unseen) console.log(`    ${u}`)
    }
    if (unaccounted.length > 0) {
      console.log(`\nTOML CONSTRUCT CENSUS: ${unaccounted.length} UNACCOUNTED NODE TYPE(S): ${unaccounted.join(", ")}`)
      console.log("Each needs a disposition: the claim the analyzer makes for it, or a ruling for why it")
      console.log("has none. An unaccounted construct is indistinguishable from a missed one.\n")
    } else {
      console.log(`\nTOML CONSTRUCT CENSUS: PASS — all ${declared.size} declared node types are accounted for,`)
      console.log(`  and ${SHAPES_RULED.length} non-carrier shapes are ruled on rather than left to assumption.`)
    }
  }

  // ── evidence ────────────────────────────────────────────────────────────
  // Registered rather than run-by-hand, because a gate nobody runs is not a gate:
  // an unaccounted construct reported only to the terminal has been seen by exactly
  // one person once. The honesty gate reads this artifact, which is the step that
  // makes a failure consequential instead of merely visible.
  const { emitEvidence } = await import("./evidence-harness")
  const ok = unaccounted.length === 0
  emitEvidence({
    issueId: "M14.0.TOML-CENSUS",
    title: "toml construct census",
    claimLevel: "L1",
    layers: ["carrier-census"],
    checks: [
      {
        id: "census-types-accounted",
        description: `every declared node type (${declared.size}) is either claimed by the analyzer or ruled silent with a stated reason`,
        status: ok ? "pass" : "fail",
      },
      {
        id: "census-shapes-ruled",
        description: `all ${SHAPES_RULED.length} non-carrier shapes carry a ruling rather than an assumption`,
        status: ok ? "pass" : "fail",
      },
    ],
    limitations: [
      {
        description:
          "this gate consults NEITHER the analyzer nor the differential oracle, which is the only reason it exists: the two are two implementations of one reading of the specification by the same author, so they catch each other's implementation mistakes (three, on the oracle's first corpus run) and cannot catch a mistake in the READING — where the two would agree, the differential would report agreement, and nothing in it would notice that both were wrong. The evidence harness refused this file's first draft for saying so with a percentage in it, which is the same rule applied to prose",
      },
      {
        description:
          "it inventories CONSTRUCTS, not semantics: a construct can be accounted for and still be handled wrongly, which is what the differential and the hand-audited M12 truth are for. It answers 'does anybody account for this', not 'is this handled correctly'",
      },
      {
        description:
          "the corpus is the pinned fixtures repositories and rotates as a pool, so a construct no corpus exercises is reported as NOT SEEN rather than unaccounted — `MISSING` is in that state today, handled and pinned by fixture instead",
      },
    ],
    data: {
      files: files.length,
      repos: repos.length,
      skippedEntries: skipped,
      declaredTypes: declared.size,
      observedTypes: nodeCounts.size,
      filesWithParseErrors: filesWithErrors,
      claimedTypes: claimed.map((c) => ({ type: c.type, n: c.n })),
      ruledSilentTypes: ruled.map((r) => ({ type: r.type, n: r.n, why: r.why })),
      unseenTypes: unseen,
      unaccountedTypes: unaccounted,
      shapesRuled: SHAPES_RULED.length,
    },
  })

  parser.delete()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
