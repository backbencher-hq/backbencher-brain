// script/m60/find-grammar-provenance.ts — identify an UNVERSIONED shipped grammar by
// byte-identity against the published artifacts.
//
// WHY. Nineteen lanes shipped a grammar whose version was recorded NOWHERE — not in the
// analyzer doc, not in a spec file, not in a registry. Two consequences, both measured:
//
//   1. The grammar survey could not compare those lanes to upstream at all, so they never
//      appeared in its "a candidate grammar is ahead" shortlist. `powershell` was the
//      second-worst lane in the tree at 32.9% of its corpus failing to parse, and nobody
//      could ask whether a newer grammar would help. It was 3 releases behind. Establishing
//      that took one `npm pack` and one `sha256sum`.
//
//   2. The runtime migration (M63) has to rebuild 20 grammars from source, and "which
//      version are we on" is the first question a rebuild asks. A lane with no version is a
//      lane that cannot be rebuilt.
//
// So the method is worth automating, and it is worth automating HONESTLY: the answer is a
// HASH MATCH or it is nothing. This instrument never infers a version from a file size, a
// date, or a doc's prose, and when nothing matches it says so — because "this artifact is a
// local build of unknown ancestry" is a real and important answer, and a near-miss reported
// as a match would be worse than no answer.
//
// WHAT IT DOES, per lane:
//   - derives candidate npm package names from the engine's own grammar asset, the survey's
//     discovered candidates, and a small declared alias table for the known divergences
//     (`tree-sitter-c_sharp` -> `tree-sitter-c-sharp`, and so on);
//   - walks that package's published versions newest-first;
//   - downloads each tarball, extracts ONLY the `.wasm`, and compares sha256 against the
//     bytes the product actually loads;
//   - reports EXACT matches, and otherwise reports the closest by BYTE LENGTH clearly
//     labelled as a lead and not a match.
//
// It is offline-safe in the sense that it never mutates the repository: it writes one
// artifact and touches no grammar, no wasm, and no declaration site. Deciding what to do
// with an answer is a human's job, recorded in the `Parser:` line.
//
// Usage:
//   bun run script/m60/find-grammar-provenance.ts                    # every unversioned lane
//   bun run script/m60/find-grammar-provenance.ts --lane powershell  # one lane
//   bun run script/m60/find-grammar-provenance.ts --all              # including versioned lanes
//   bun run script/m60/find-grammar-provenance.ts --max-versions 8   # widen the version walk
//   bun run script/m60/find-grammar-provenance.ts --json
//
// Writes: validation/m60/results/G-PROVENANCE.json   (a measurement, not a claim)

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const argv = process.argv.slice(2)
const argValue = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const AS_JSON = argv.includes("--json")
const ALL = argv.includes("--all")
const ONLY = argValue("--lane")
const MAX_VERSIONS = parseInt(argValue("--max-versions", "6")!, 10)
const SURVEY = path.join(ROOT, "validation", "m60", "grammar-survey.json")
const OUT = path.join(ROOT, "validation", "m60", "results", "G-PROVENANCE.json")
const WASM_DIR = path.join(ROOT, "wasm")

const survey = JSON.parse(readFileSync(SURVEY, "utf8"))

/**
 * Where the engine's grammar asset name is NOT the npm package name. Declared, not
 * guessed: an undeclared divergence here produces a confident "no match found" for a lane
 * that is in fact perfectly traceable, which is the failure mode this instrument most needs
 * to avoid.
 */
const PACKAGE_ALIASES: Record<string, string[]> = {
  "tree-sitter-c_sharp": ["tree-sitter-c-sharp"],
  // tsx ships inside the typescript package; the engine's own chain says so.
  "tree-sitter-tsx": ["tree-sitter-typescript"],
  // Community grammars are published under the grammars scope, not unscoped.
  "tree-sitter-xml": ["@tree-sitter-grammars/tree-sitter-xml", "tree-sitter-xml"],
  "tree-sitter-yaml": ["@tree-sitter-grammars/tree-sitter-yaml", "tree-sitter-yaml"],
  "tree-sitter-toml": ["@tree-sitter-grammars/tree-sitter-toml", "tree-sitter-toml"],
  "tree-sitter-hcl": ["@tree-sitter-grammars/tree-sitter-hcl", "tree-sitter-hcl"],
  "tree-sitter-graphql": ["tree-sitter-graphql"],
  "tree-sitter-svelte": ["tree-sitter-svelte"],
  "tree-sitter-r": ["tree-sitter-r", "r-lib/tree-sitter-r"],
  "tree-sitter-markdown": ["tree-sitter-markdown", "@tree-sitter-grammars/tree-sitter-markdown"],
  "tree-sitter-zig": ["tree-sitter-zig"],
  "tree-sitter-html": ["tree-sitter-html"],
  "tree-sitter-json": ["tree-sitter-json"],
  "tree-sitter-lua": ["tree-sitter-lua", "@tree-sitter-grammars/tree-sitter-lua"],
  "tree-sitter-vue": ["tree-sitter-vue"],
  "tree-sitter-kotlin": ["tree-sitter-kotlin", "@tree-sitter-grammars/tree-sitter-kotlin"],
  "tree-sitter-bash": ["tree-sitter-bash"],
  "tree-sitter-ruby": ["tree-sitter-ruby"],
  "tree-sitter-java": ["tree-sitter-java"],
}

/**
 * Redistributor collections: packages that ship a prebuilt wasm for MANY grammars.
 * Tried before per-language packages because that is where most of our unversioned
 * bytes actually came from. `tree-sitter-wasms@0.1.13` alone accounts for 12 of the 46
 * wasms the product loads.
 */
const COLLECTIONS = [{ package: "tree-sitter-wasms", versions: ["0.1.13", "0.1.12", "0.1.11"] }]

/**
 * Index a collection ONCE: download each version, hash every wasm inside, and keep a
 * sha256 -> "package@version/file" map. Fetched once for the whole run and matched
 * against every lane, because the collection is the same bytes for all of them.
 */
const collectionIndex = (): Map<string, string> => {
  const idx = new Map<string, string>()
  for (const col of COLLECTIONS) {
    for (const v of col.versions) {
      const dir = mkdtempSync(path.join(tmpdir(), "bb-coll-"))
      const ex = mkdtempSync(path.join(tmpdir(), "bb-colx-"))
      try {
        if (!sh("npm", ["pack", `${col.package}@${v}`, "--pack-destination", dir], dir)) continue
        const tgz = readdirSync(dir).filter((f) => f.endsWith(".tgz"))
        if (!tgz.length) continue
        // Exit code deliberately ignored: `tar` warns on these archives while
        // extracting them perfectly, and gating on its exit code is how the first
        // version reported "no match" for a lane whose bytes match exactly.
        sh("tar", ["xzf", path.join(dir, tgz[0]), "-C", ex])
        const walk = (d: string): void => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) walk(p)
            else if (e.name.endsWith(".wasm")) {
              idx.set(createHash("sha256").update(readFileSync(p)).digest("hex"), `${col.package}@${v}/${e.name}`)
            }
          }
        }
        walk(ex)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(ex, { recursive: true, force: true })
      }
    }
  }
  return idx
}

function sh(cmd: string, args: string[], cwd?: string): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd, timeout: 120_000 })
  } catch {
    return null
  }
}

const npmVersions = (pkg: string): string[] => {
  const out = sh("npm", ["view", pkg, "time", "--json"])
  if (!out) return []
  try {
    const t = JSON.parse(out) as Record<string, string>
    // Newest first, excluding the lifecycle keys.
    return Object.keys(t)
      .filter((k) => k !== "created" && k !== "modified")
      .sort((a, b) => Date.parse(t[b]) - Date.parse(t[a]))
  } catch {
    return []
  }
}

/**
 * Download one tarball, extract ONLY its .wasm, and return {file, bytes, sha256}.
 *
 * The extraction's EXIT CODE IS NOT THE EVIDENCE — the extracted file is. `tar xzf`
 * exits non-zero on this tarball (npm's archive carries entries that make GNU tar warn)
 * while extracting perfectly, and the first version of this helper returned null on a
 * non-zero exit and so reported "no match" for a lane whose bytes match EXACTLY. That is
 * the most dangerous failure this instrument has: it does not look like a bug, it looks
 * like a finding. So the tarball is extracted unconditionally and the RESULT is inspected
 * for the artifact, and only its absence counts as failure.
 */
function wasmFromTarball(pkg: string, version: string): { file: string; bytes: number; sha256: string } | null {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-prov-"))
  const extract = mkdtempSync(path.join(tmpdir(), "bb-prov-x-"))
  try {
    if (!sh("npm", ["pack", `${pkg}@${version}`, "--pack-destination", dir], dir)) return null
    const tgz = readdirSync(dir).filter((f) => f.endsWith(".tgz"))
    if (!tgz.length) return null
    sh("tar", ["xzf", path.join(dir, tgz[0]), "-C", extract]) // exit code deliberately ignored
    let found: { file: string; bytes: number; sha256: string } | null = null
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith(".wasm") && !found) {
          const b = readFileSync(p)
          found = { file: e.name, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") }
        }
      }
    }
    walk(extract)
    return found
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(extract, { recursive: true, force: true })
  }
}

type LaneResult = Record<string, any>
const results: LaneResult[] = []
process.stderr.write("  indexing redistributor collections (one download each)...\n")
const COLL_INDEX = collectionIndex()
process.stderr.write(`  collection index: ${COLL_INDEX.size} distinct wasm sha256\n`)

const targets = ONLY
  ? survey.rows.filter((r: any) => r.lane === ONLY)
  : survey.rows.filter((r: any) => ALL || !r.declared.versionKnown)

for (const row of targets as any[]) {
  if (!row.shipped?.present) {
    results.push({ lane: row.lane, status: "no-artifact", reason: "lane ships no wasm (generic or alias)" })
    continue
  }
  const shippedSha = row.shipped.sha256 as string
  const shippedBytes = row.shipped.bytes as number
  const asset = String(row.wasmChain?.[0] ?? row.engineAsset ?? "")
  const assetBase = (asset.includes("/") ? asset.slice(asset.lastIndexOf("/") + 1) : asset).replace(/\.wasm$/, "")

  const packages = new Set<string>()
  if (PACKAGE_ALIASES[assetBase]) for (const p of PACKAGE_ALIASES[assetBase]) packages.add(p)
  else packages.add(assetBase)
  for (const c of row.candidates ?? []) if (c.package) packages.add(c.package)
  // The REDISTRIBUTOR COLLECTION goes FIRST, and that ordering is the whole lesson of
  // this instrument's first run. `tree-sitter-wasms` ships prebuilt wasms for 36
  // grammars, and 12 of the 46 we load are byte-identical to its 0.1.13 build —
  // including SEVEN of the eighteen unversioned lanes (html, java, json, toml, tsx,
  // vue, zig). A probe that only asks each language's own npm package finds almost
  // nothing here and reports "no match", which reads as a finding rather than as the
  // blind spot it is. Provenance for a vendored grammar is TWO-dimensional: which
  // collection built these bytes, and which grammar version it was built against.
  // the collection is consulted through COLL_INDEX below, not packed per lane

  process.stderr.write(`  ${row.lane.padEnd(13)} `)
  let match: LaneResult | null = null
  const leads: Array<Record<string, unknown>> = []
  let examined = 0

  // Collection first, from the ONE-TIME index — no download on this path at all. The
  // first version re-packed the 36-wasm collection for every lane, and the run was
  // still going after nine minutes; the collection is the same bytes for every lane, so
  // it is fetched once and matched against all of them.
  const coll = COLL_INDEX.get(shippedSha)
  if (coll) {
    const slash = coll.lastIndexOf("/")
    const pkgAndV = coll.slice(0, slash)
    const at = pkgAndV.lastIndexOf("@")
    match = {
      package: pkgAndV.slice(0, at),
      version: pkgAndV.slice(at + 1),
      provenanceKind: "redistributor-collection",
      wasmFile: coll.slice(slash + 1),
      bytes: shippedBytes,
      sha256: shippedSha,
      note: "these bytes are a REDISTRIBUTOR BUILD. The collection version is exact; the underlying grammar version is not stated by the collection and must not be inferred from it.",
    }
    examined++
  }
  for (const pkg of match ? [] : packages) {
    if (match) break
    const versionList = npmVersions(pkg).slice(0, MAX_VERSIONS)
    for (const v of versionList) {
      examined++
      const w = wasmFromTarball(pkg, v)
      if (!w) continue
      if (w.sha256 === shippedSha) {
        match = { package: pkg, version: v, provenanceKind: "language-package", wasmFile: w.file, bytes: w.bytes, sha256: w.sha256 }
        break
      }
      // A near-miss on size is a LEAD, never a match. Reporting it as a match is the one
      // thing this instrument must never do.
      if (Math.abs(w.bytes - shippedBytes) / Math.max(w.bytes, shippedBytes) < 0.02) {
        leads.push({ package: pkg, version: v, bytes: w.bytes, byteDelta: w.bytes - shippedBytes, sha256: w.sha256 })
      }
    }
  }

  results.push(
    match
      ? { lane: row.lane, status: "identified", ...match, shippedBytes, versionsExamined: examined }
      : {
          lane: row.lane,
          status: "no-match",
          shippedSha256: shippedSha,
          shippedBytes,
          packagesTried: [...packages],
          versionsExamined: examined,
          leads: leads.sort((a, b) => Math.abs(a.byteDelta as number) - Math.abs(b.byteDelta as number)).slice(0, 3),
          conclusion:
            "No published artifact matches these bytes. The shipped wasm is therefore a LOCAL build, a fork, a vendored prebuild, or a redistributor's package — and its version cannot be recovered by hash. That is a finding, not a dead end: it must be recorded as `local build of unrecorded provenance`, and the source has to be found by reading the analyzer doc and the vendored grammar rather than by matching bytes.",
        },
  )
  process.stderr.write(`${match ? `IDENTIFIED ${(match as any).package}@${(match as any).version}` : "no match"}\n`)
}

const identified = results.filter((r) => r.status === "identified")
const unmatched = results.filter((r) => r.status === "no-match")

const report = {
  schemaVersion: 1,
  instrument: "m60-find-grammar-provenance",
  question: "which published artifact are the bytes we ship?",
  method:
    "For each lane with no declared version, derive candidate npm packages from the engine's own grammar asset plus a declared alias table, walk that package's versions newest-first, and compare the sha256 of the extracted .wasm against the bytes the product loads. A version is reported ONLY on an exact sha256 match. A same-size artifact is recorded as a lead and never as a match.",
  limits: [
    "Identifies against the PUBLISHED artifact only. A wasm that is a local build of a published version will not match, and is reported as `no-match` — correctly, because its bytes are not upstream's.",
    "A version window of --max-versions (default 6) is walked per package. A lane pinned to something older than that reports no-match rather than a false negative being read as an absence.",
    "Reads no declaration site and writes none. Recording an answer is a separate, human act in the analyzer's `Parser:` line, so a measurement can never quietly become a claim.",
  ],
  counts: { examined: results.length, identified: identified.length, noMatch: unmatched.length },
  identified: identified.map((r) => ({ lane: r.lane, package: r.package, version: r.version, provenanceKind: r.provenanceKind ?? null, sha256: r.sha256 })),
  noMatch: unmatched.map((r) => ({ lane: r.lane, packagesTried: r.packagesTried, leads: r.leads })),
  results,
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`\ngrammar provenance — ${report.counts.examined} lane(s): ${report.counts.identified} identified, ${report.counts.noMatch} unmatched\n`)
  for (const r of results) {
    if (r.status === "identified") console.log(`  ${r.lane.padEnd(13)} ${r.package}@${r.version}${(r.provenanceKind ?? "").includes("collection") ? "  [COLLECTION BUILD]" : ""}   sha ${r.sha256.slice(0, 16)}…  (${r.versionsExamined} version(s) examined)`)
    else if (r.status === "no-match") console.log(`  ${r.lane.padEnd(13)} NO MATCH over ${r.packagesTried.join(", ")} — ${r.versionsExamined} version(s) examined; ${r.leads.length} size-lead(s)`)
    else console.log(`  ${r.lane.padEnd(13)} ${r.reason}`)
  }
  console.log(`\n  written to ${path.relative(ROOT, OUT)}`)
  console.log(`  ${report.counts.identified} of these become \`Parser:\` lines; the ${report.counts.noMatch} unmatched need their source read, not a hash.`)
}
