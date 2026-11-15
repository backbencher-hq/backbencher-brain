/**
 * OVERRIDES ENDPOINT SHAPE — why 71 of 71 override edges resolve to nothing.
 *
 * ## The finding this file adjudicates
 *
 * On vuejs at NFILES=400 the ambiguity census reports `overrides` 0.0%
 * within-both and 100.0% corpus-neither: 71 edges, and not one of them has a
 * source or a target that binds to a published symbol. That cannot be the usual
 * outgoing-analyzer caveat, because an overrides edge is built from IN-FILE data
 * by construction — `extractOverrideRelationships` looks the base class up with
 * `firstSymbolNamed` and abstains when it is absent.
 *
 * Two readings, and they need opposite fixes:
 *
 *   A. NAME SHAPE. The edge reads `Derived.member -> Base.member`, while the
 *      symbols it was derived from are published under some other spelling —
 *      `qualifiedName` may be a dotted chain, a namespace, or empty. If so the
 *      EDGE IS RIGHT and the CONSUMER'S KEY IS WRONG, which is a real defect and
 *      a rename, not a missing edge.
 *   B. MISSING DECLARATION. The named member does not exist as a symbol at all,
 *      so the arm paired names it never declared. That is a fabricated edge and
 *      it poisons bb_graph, bb_impact and bb_migrate.
 *
 * ## What this file prints, per file that emitted an overrides edge
 *
 *   - the edges, verbatim
 *   - every published symbol whose `name` equals the MEMBER half of an edge, with
 *     its kind, ownerName, qualifiedName and line, so the reader can see which
 *     spelling exists
 *   - a direct lookup of each edge endpoint under three candidate key spaces
 *     (bare name, qualifiedName, dotted owner.name), so the verdict is a
 *     measurement rather than an opinion about the naming convention
 *
 * ## No regex
 *
 * Dotted names are split on the literal "." character by `splitDotted`, which
 * compares one character. The construct this file is about is a NAME, and a
 * regular expression over a name is how an analyzer convinces itself of its own
 * convention.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../../../src/ast/real-typescript-analyzer"

const CORPUS_ROOT = process.env.BB_TS_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const CORPUS_DIR = process.env.BB_TS_REPO ?? "vuejs"
const DIR = join(CORPUS_ROOT, CORPUS_DIR)
const TARGETS = (process.env.BB_TS_FILES ?? "").split(",").filter(Boolean)

function splitDotted(s: string): string[] {
  return s.split(".")
}

interface EndpointVerdict {
  edge: string
  source: string
  target: string
  srcByName: number
  srcByQualified: number
  srcByDottedOwner: number
  tgtByName: number
  tgtByQualified: number
  tgtByDottedOwner: number
}

async function main(): Promise<void> {
  const parser = await getParser("typescript")
  let grand = 0
  const tally = {
    edges: 0, srcByName: 0, srcByQualified: 0, srcByDottedOwner: 0,
    tgtByName: 0, tgtByQualified: 0, tgtByDottedOwner: 0,
    bothByDottedOwner: 0, neitherAnywhere: 0,
  }

  for (const rel of TARGETS) {
    const f = join(DIR, rel)
    let content: string
    try { content = readFileSync(f, "utf8") } catch { console.log(`skip ${rel}: unreadable`); continue }
    const pr = await parser.parse(content, f)
    const res: any = new RealTypeScriptAnalyzer().analyze(pr.rootNode as any, content, f)
    const symbols: any[] = Array.isArray(res?.symbols) ? res.symbols : []
    const rels: any[] = Array.isArray(res?.relationships) ? res.relationships : []
    const ovr = rels.filter((r) => String(r?.type ?? "") === "overrides")
    if (ovr.length === 0) { console.log(`${rel}: no overrides edge emitted`); continue }

    console.log("=".repeat(100))
    console.log(`${rel}`)
    console.log(`  symbols ${symbols.length}  overrides edges ${ovr.length}`)
    console.log("-".repeat(100))

    // Three candidate key spaces. Built once, queried per endpoint.
    const byName = new Map<string, any[]>()
    const byQualified = new Map<string, any[]>()
    const byDottedOwner = new Map<string, any[]>()
    for (const s of symbols) {
      const n = String(s?.name ?? "")
      if (n.length > 0) {
        const a = byName.get(n) ?? []; a.push(s); byName.set(n, a)
      }
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0) {
        const a = byQualified.get(q) ?? []; a.push(s); byQualified.set(q, a)
      }
      const owner = String(s?.ownerName ?? "")
      if (n.length > 0 && owner.length > 0) {
        const d = `${owner}.${n}`
        const a = byDottedOwner.get(d) ?? []; a.push(s); byDottedOwner.set(d, a)
      }
    }

    const rows: EndpointVerdict[] = []
    for (const e of ovr) {
      const src = String(e?.source ?? "")
      const tgt = String(e?.target ?? "")
      const srcParts = splitDotted(src)
      const tgtParts = splitDotted(tgt)
      const memberSrc = srcParts.length > 1 ? srcParts[srcParts.length - 1] : src
      const memberTgt = tgtParts.length > 1 ? tgtParts[tgtParts.length - 1] : tgt
      const v: EndpointVerdict = {
        edge: `${src} -> ${tgt}`,
        source: src, target: tgt,
        srcByName: (byName.get(memberSrc) ?? []).length,
        srcByQualified: (byQualified.get(src) ?? []).length,
        srcByDottedOwner: (byDottedOwner.get(src) ?? []).length,
        tgtByName: (byName.get(memberTgt) ?? []).length,
        tgtByQualified: (byQualified.get(tgt) ?? []).length,
        tgtByDottedOwner: (byDottedOwner.get(tgt) ?? []).length,
      }
      rows.push(v)
      tally.edges++
      if (v.srcByName > 0) tally.srcByName++
      if (v.srcByQualified > 0) tally.srcByQualified++
      if (v.srcByDottedOwner > 0) tally.srcByDottedOwner++
      if (v.tgtByName > 0) tally.tgtByName++
      if (v.tgtByQualified > 0) tally.tgtByQualified++
      if (v.tgtByDottedOwner > 0) tally.tgtByDottedOwner++
      if (v.srcByDottedOwner > 0 && v.tgtByDottedOwner > 0) tally.bothByDottedOwner++
      if (v.srcByName === 0 && v.srcByQualified === 0 && v.srcByDottedOwner === 0 &&
          v.tgtByName === 0 && v.tgtByQualified === 0 && v.tgtByDottedOwner === 0) tally.neitherAnywhere++
    }

    console.log("  endpoint                                   name  qualified  dotted(owner.name)")
    for (const v of rows) {
      console.log(`    src ${v.source.padEnd(42)} ${String(v.srcByName).padStart(4)} ${String(v.srcByQualified).padStart(9)} ${String(v.srcByDottedOwner).padStart(17)}`)
      console.log(`    tgt ${v.target.padEnd(42)} ${String(v.tgtByName).padStart(4)} ${String(v.tgtByQualified).padStart(9)} ${String(v.tgtByDottedOwner).padStart(17)}`)
    }

    // The symbols the edges NAME, under whichever spelling exists.
    console.log("  symbols that share a member name with an edge")
    const shown = new Set<string>()
    for (const e of ovr) {
      for (const raw of [String(e?.source ?? ""), String(e?.target ?? "")]) {
        const parts = splitDotted(raw)
        const member = parts.length > 1 ? parts[parts.length - 1] : raw
        const owner = parts.length > 1 ? parts[parts.length - 2] : ""
        for (const s of byName.get(member) ?? []) {
          const key = `${member}|${String(s?.qualifiedName ?? "")}|${String(s?.ownerName ?? "")}`
          if (shown.has(key)) continue
          shown.add(key)
          console.log(`    name=${String(s?.name ?? "").padEnd(22)} kind=${String(s?.kind ?? "").padEnd(12)} owner=${String(s?.ownerName ?? "").padEnd(28)} qualified=${String(s?.qualifiedName ?? "")}   (edge owner: ${owner})`)
        }
      }
    }
  }

  console.log("=".repeat(100))
  console.log("AGGREGATE over the files examined")
  console.log(`  overrides edges                       ${tally.edges}`)
  console.log(`  source found by BARE name             ${tally.srcByName}`)
  console.log(`  source found by qualifiedName         ${tally.srcByQualified}`)
  console.log(`  source found by dotted owner.name     ${tally.srcByDottedOwner}`)
  console.log(`  target found by BARE name             ${tally.tgtByName}`)
  console.log(`  target found by qualifiedName         ${tally.tgtByQualified}`)
  console.log(`  target found by dotted owner.name     ${tally.tgtByDottedOwner}`)
  console.log(`  BOTH endpoints found by dotted form   ${tally.bothByDottedOwner}`)
  console.log(`  neither endpoint found anywhere       ${tally.neitherAnywhere}`)
  console.log("  A non-zero 'bare name' row means the MEMBER is published and only the")
  console.log("  dotted spelling fails to bind -> name-shape mismatch (consumer key wrong).")
  console.log("  A zero on every row for an endpoint means the DECLARATION is absent ->")
  console.log("  the arm paired names it never published, which is a fabricated edge.")
}

await main()
