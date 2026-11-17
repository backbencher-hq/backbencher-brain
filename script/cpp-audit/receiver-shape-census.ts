/**
 * C++ LANE AUDIT — how much of the receiver-typing wall is on this corpus, and how much an
 * owner-qualified target could address.
 *
 * THE QUESTION (wall W1-C/W11). The wall ledger prices receiver typing at 370,246 + 83,169 rows over
 * the whole population, and the analyzer says it "will not invent" a receiver type. Before writing
 * any inference, the lane needs the local shape of the wall: of the calls/uses rows whose TARGET is
 * a member leaf (a name some class declares as a member), how many already carry `metadata.owner`
 * (the three implemented shapes), and how many do not.
 *
 * WHAT IT MEASURES, from the analyzer's own output only:
 *   memberLeafs   — every leaf name that ANY symbol carries as a member (`ownerName` set)
 *   memberRows    — calls/uses rows whose target is such a leaf → the wall's local population
 *   ownedRows     — of those, rows that already carry `metadata.owner`
 *   unownedRows   — the remainder = the inference target
 * and, for the unowned rows, the SOURCE symbol's owner: a row emitted from a class member (the
 * source has an `ownerName`) is the case where the enclosing class is known and a receiver-typed
 * shape is at least conceivable; a file-scope source has no such anchor.
 *
 * It does NOT claim which inference is correct, and it does not attempt resolution. It sizes the
 * work. A row counted here is a row whose target is a member LEAF somewhere — that is necessary, not
 * sufficient, for owner qualification.
 *
 * Usage: bun run script/cpp-audit/receiver-shape-census.ts [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CORPUS = ["fmt", "nlohmann-json"]
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h", ".ipp", ".inl", ".cu"])

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules" || e === "build" || e === "third_party") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (st.isFile() && EXTS.has(extname(e))) out.push(p)
  }
}

interface Row {
  type: string
  source: string
  target: string
  metadata?: Record<string, unknown>
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json")
  const files: string[] = []
  for (const repo of CORPUS) walk(join(process.cwd(), ".cpp-corpus", repo), files)

  const recs: Array<{ symbols: any[]; rels: Row[] }> = []
  for (const f of files.sort()) {
    const buf = readFileSync(f)
    if (buf.length > 1_000_000) continue // the lane's own cap
    const res: any = await ASTEngine.parseFile(f, buf.toString("utf8"))
    if (res?.language !== "cpp") continue
    recs.push({ symbols: res.symbols ?? [], rels: (res.relationships ?? []) as Row[] })
  }

  // Member leaves: every name published with an ownerName (method/property/ctor/...).
  const memberLeafs = new Set<string>()
  const sourceOwners = new Map<string, Set<string>>()
  for (const r of recs) {
    for (const s of r.symbols) {
      if (typeof s.ownerName === "string" && s.ownerName.length > 0) memberLeafs.add(String(s.name))
      const o = s.ownerName
      if (typeof o === "string" && o.length > 0) {
        if (!sourceOwners.has(String(s.name))) sourceOwners.set(String(s.name), new Set())
        sourceOwners.get(String(s.name))!.add(o)
      }
    }
  }

  let callUseRows = 0
  let memberRows = 0
  let ownedRows = 0
  let unownedFromMember = 0
  let unownedFromFileScope = 0
  const unownedSamples: string[] = []
  const samples: string[] = []
  for (const r of recs) {
    for (const rel of r.rels) {
      if (rel.type !== "calls" && rel.type !== "uses") continue
      callUseRows++
      if (!memberLeafs.has(String(rel.target))) continue
      memberRows++
      const owned = typeof rel.metadata?.owner === "string"
      if (owned) {
        ownedRows++
        if (samples.length < 6) samples.push(`${rel.type} ${rel.source} -> ${rel.target} owner=${rel.metadata?.owner}`)
        continue
      }
      const srcOwners = sourceOwners.get(String(rel.source))
      if (srcOwners && srcOwners.size > 0) unownedFromMember++
      else unownedFromFileScope++
      if (unownedSamples.length < 8) unownedSamples.push(`${rel.type} ${rel.source} -> ${rel.target}`)
    }
  }

  const out = {
    corpus: { roots: CORPUS, files: recs.length },
    memberLeafNames: memberLeafs.size,
    callUseRows,
    memberLeafRows: memberRows,
    alreadyOwned: ownedRows,
    unowned: memberRows - ownedRows,
    unownedFromAClassMember: unownedFromMember,
    unownedFromFileScope: unownedFromFileScope,
    samples,
    unownedSamples,
  }
  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
    return
  }
  const pct = (a: number, b: number) => (b === 0 ? "0.0%" : `${((100 * a) / b).toFixed(1)}%`)
  console.log("=== receiver-shape census (analyzer output only) ===")
  console.log(`files parsed                : ${recs.length}`)
  console.log(`distinct member leaf names  : ${memberLeafs.size}`)
  console.log(`calls+uses rows             : ${callUseRows}`)
  console.log(`  target is a member leaf   : ${memberRows} (${pct(memberRows, callUseRows)} of calls+uses)`)
  console.log(`    already carry owner     : ${ownedRows} (${pct(ownedRows, memberRows)} of member rows)`)
  console.log(`    no owner                : ${out.unowned}`)
  console.log(`      emitted from a class member (owner anchor known): ${unownedFromMember}`)
  console.log(`      emitted from file scope (no anchor)             : ${unownedFromFileScope}`)
  for (const s of samples) console.log(`   owned: ${s}`)
  for (const s of unownedSamples) console.log(`   unowned: ${s}`)
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
