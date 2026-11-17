/**
 * C++ LANE AUDIT — how much of the receiver-typing wall is on this corpus, and how much an
 * owner-qualified target could address.
 *
 * THE QUESTION (wall W1-C/W11). The wall ledger prices receiver typing at 370,246 + 83,169 rows over
 * the whole population, and the analyzer says it "will not invent" a receiver type. Before writing
 * any inference, the lane needs the local shape of the wall: of the calls/uses rows whose TARGET is
 * a member leaf (a name some class declares as a member), how many carry `metadata.owner`, and how
 * many do not.
 *
 * THE BASELINE IS NOW ZERO-OWNED WITH THE INDEX OFF, AND THAT IS THE POINT OF RE-RUNNING IT. When
 * this probe was written (NEXT-WORK §14.17) the DEFAULT analyzer emitted `metadata.owner` on 0 of
 * 35,605 member-leaf rows, and 20,580 of the unowned rows were emitted from a class member — the
 * population an enclosing-class anchor could address. The local arm (NEXT-WORK §14.18) now attaches
 * the owner for the index-free shapes, so `alreadyOwned` on a default run IS the conversion count,
 * and the remaining buckets are what the arm did not convert and why.
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
 * IT ALSO INDEPENDENTLY RE-CHECKS THE CLAIM, which is the part a census can do and an emission
 * cannot: for every owned row, the file that emitted it must publish a CALLABLE member (method,
 * constructor or destructor) with that name under that owner. `ownedUnverifiedInFile` must be 0;
 * `ownedNonCallRows` must be 0 (the local arm emits on `calls` only). A census that only counted
 * owners would repeat the emission's own mistake if the emission were wrong.
 *
 * It does NOT claim which inference is correct for the UNOWNED rows, and it does not attempt
 * resolution. It sizes the work. A row counted here for the unowned buckets is a row whose target is
 * a member LEAF somewhere — that is necessary, not sufficient, for owner qualification.
 *
 * Usage: bun run script/cpp-audit/receiver-shape-census.ts [--json]
 *        [--repos=fmt,nlohmann-json]   named repos under .cpp-corpus/ (the default pair)
 *        [--root=.cpp-corpus/.corpus]  a whole corpus root; every direct subdirectory is a repo
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const argOf = (f: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`${f}=`))
  return hit ? hit.slice(f.length + 1) : null
}
const DEFAULT_CORPUS_ROOT = join(process.cwd(), ".cpp-corpus")
const ROOT_ARG = argOf("--root")
const REPOS_ARG = argOf("--repos")
/**
 * THE POPULATION. Default = the two pinned repos the evidence artifact was measured on. `--repos=`
 * selects other named repos under `.cpp-corpus/`. `--root=` selects a WHOLE corpus root (every
 * direct subdirectory is a repository) — used for the reconstructed whole-population corpus, whose
 * repositories live under `.cpp-corpus/.corpus/` so the wall instruments' `repoOf` marker holds.
 */
const CORPUS_ROOTS: string[] = (() => {
  if (ROOT_ARG) {
    const abs = resolve(ROOT_ARG)
    let entries: string[] = []
    try { entries = readdirSync(abs) } catch { return [] }
    return entries
      .filter((e) => {
        try { return statSync(join(abs, e)).isDirectory() } catch { return false }
      })
      .map((e) => join(abs, e))
  }
  const names = REPOS_ARG ? REPOS_ARG.split(",").map((x) => x.trim()).filter(Boolean) : ["fmt", "nlohmann-json"]
  return names.map((r) => join(DEFAULT_CORPUS_ROOT, r))
})()
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
  for (const root of CORPUS_ROOTS) walk(root, files)

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
  // The local arm's conversion, split by the SHAPE the emission used. `metadata.qualified` is the
  // only shape witness a row carries: a bare callee repeats the target, `this->m()` writes
  // `this.<m>`, and any other spelling is an owner from a different arm (the index shapes, when a
  // caller passes a complete index — this probe never does).
  let ownedBareImplicit = 0
  let ownedThis = 0
  let ownedOther = 0
  let ownedNonCallRows = 0
  let ownedUnverifiedInFile = 0
  const ownedUnverifiedSamples: string[] = []
  const unownedSamples: string[] = []
  const samples: string[] = []

  // Per-file callable members, from the SAME symbol table the post-pass uses but derived here
  // independently: the audit asks "does the emitting FILE publish this member on this class", not
  // "did the emission's own bookkeeping agree with itself".
  const callableMembersByFile: Array<Map<string, Set<string>>> = recs.map((r) => {
    const table = new Map<string, Set<string>>()
    for (const s of r.symbols) {
      const owner = typeof s.ownerName === "string" ? String(s.ownerName).trim() : ""
      if (owner === "" || owner === "global") continue
      const kind = String(s.kind)
      if (kind !== "method" && kind !== "constructor") continue
      const name = String(s.name ?? "")
      if (name === "") continue
      let set = table.get(owner)
      if (set === undefined) {
        set = new Set()
        table.set(owner, set)
      }
      set.add(name)
    }
    return table
  })

  for (let ri = 0; ri < recs.length; ri++) {
    const r = recs[ri]
    for (const rel of r.rels) {
      if (rel.type !== "calls" && rel.type !== "uses") continue
      callUseRows++
      if (!memberLeafs.has(String(rel.target))) continue
      memberRows++
      const owner = typeof rel.metadata?.owner === "string" ? (rel.metadata!.owner as string) : ""
      if (owner !== "") {
        ownedRows++
        if (rel.type !== "calls") ownedNonCallRows++
        const qualified = typeof rel.metadata?.qualified === "string" ? (rel.metadata!.qualified as string) : ""
        if (qualified === String(rel.target)) ownedBareImplicit++
        // `this.` covers the plain and the template spelling (`this.Get<Idx>`), since the
        // qualified name is built from the receiver's SOURCE text: a `this->Get<Idx>()` call
        // carries `qualified = "this.Get<Idx>"`, not the leaf.
        else if (qualified.startsWith("this.")) ownedThis++
        else {
          ownedOther++
          if (samples.length < 6) samples.push(`${rel.type} ${rel.source} -> ${rel.target} owner=${owner} (qualified="${qualified}")`)
        }
        if (callableMembersByFile[ri].get(owner)?.has(String(rel.target)) !== true) {
          ownedUnverifiedInFile++
          if (ownedUnverifiedSamples.length < 8) {
            ownedUnverifiedSamples.push(`${rel.type} ${rel.source} -> ${rel.target} owner=${owner} qualified="${qualified}"`)
          }
        }
        continue
      }
      const srcOwners = sourceOwners.get(String(rel.source))
      if (srcOwners && srcOwners.size > 0) unownedFromMember++
      else unownedFromFileScope++
      if (unownedSamples.length < 8) unownedSamples.push(`${rel.type} ${rel.source} -> ${rel.target}`)
    }
  }

  const out = {
    corpus: { roots: CORPUS_ROOTS.map((r) => r.replace(`${process.cwd()}/`, "")), files: recs.length },
    memberLeafNames: memberLeafs.size,
    callUseRows,
    memberLeafRows: memberRows,
    alreadyOwned: ownedRows,
    ownedBareImplicit,
    ownedThis,
    ownedOther,
    ownedNonCallRows,
    ownedUnverifiedInFile,
    unowned: memberRows - ownedRows,
    unownedFromAClassMember: unownedFromMember,
    unownedFromFileScope: unownedFromFileScope,
    samples,
    unownedSamples,
    ownedUnverifiedSamples,
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
  console.log(`    carry owner             : ${ownedRows} (${pct(ownedRows, memberRows)} of member rows)`)
  console.log(`      bare implicit-this    : ${ownedBareImplicit}`)
  console.log(`      this-> receiver       : ${ownedThis}`)
  console.log(`      other spelling        : ${ownedOther}`)
  console.log(`      claim re-checked by the emitting file's own symbols: ${ownedRows - ownedUnverifiedInFile}/${ownedRows} verified, ${ownedUnverifiedInFile} unverified`)
  console.log(`      emitted on a non-calls row (must be 0): ${ownedNonCallRows}`)
  console.log(`    no owner                : ${out.unowned}`)
  console.log(`      emitted from a class member (owner anchor known): ${unownedFromMember}`)
  console.log(`      emitted from file scope (no anchor)             : ${unownedFromFileScope}`)
  for (const s of samples) console.log(`   owned: ${s}`)
  for (const s of ownedUnverifiedSamples) console.log(`   UNVERIFIED: ${s}`)
  for (const s of unownedSamples) console.log(`   unowned: ${s}`)
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
