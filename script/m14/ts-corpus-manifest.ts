#!/usr/bin/env bun
// TYPESCRIPT LANE — THE CORPUS MANIFEST, so the whole-population numbers are reproducible from the tree.
//
// ## Why this file exists
//
// The lane's whole-population declaration cites 17,689 files / 42 repos, measured on the `.corpus`
// FARM (a symlink farm over the shared corpus). That farm no longer exists: `$PWD/.corpus` was
// re-provisioned as the JavaScript lane's 22 cloned repositories (3,231 `.ts` + 626 `.tsx`), and a
// run against it today measures a DIFFERENT population under the same label — the exact defect the
// fleet's honesty contract bans. The declaration's arm log (`.tmp-ts/arm-patched-served.log`) is
// also absent, so the number could not be re-derived at all.
//
// A population is a NUMBER PLUS THE RULE THAT PRODUCED IT, and a rule over a shared, machine-local
// corpus is only reproducible if every repository's revision is recorded. This file records them:
//
//   · the ROOT POLICY (which root the numbers were measured on, and that the other root is a
//     different population — the gate's own header says the two are not comparable),
//   · every repository that admits at least one TypeScript-family file: its git HEAD, its tracked
//     TS-family count, its admitted/over-cap/absent counts under the lane's admission rule,
//   · the population digest (the `ts-corpus.ts` function every lane instrument imports),
//   · and the SELF-CORPUS (this repository, which the owner authorised as a corpus): its HEAD and
//     tracked TypeScript count, measured by `git ls-files` through the same extension table.
//
// `--check` compares the current corpus with the committed manifest and exits non-zero on a
// population change — a stale manifest must be a loud verdict, never a silent one.
//
// Usage:
//   BB_CORPUS_ROOT=$HOME/bb_tests/repositories bun run script/m14/ts-corpus-manifest.ts [--out path] [--check]
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { admitCorpus, populationDigest, extensionsFor, SIZE_CAP } from "./ts-corpus"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.env.HOME ?? "", "bb_tests/repositories")
const OUT = (() => {
  const i = process.argv.indexOf("--out")
  return i >= 0 ? resolve(process.argv[i + 1]) : join(REPO, "validation/m14/instruments/typescript/corpus-manifest.json")
})()
const CHECK = process.argv.includes("--check")
const EXTS = extensionsFor("typescript")

const gitHead = (dir: string): string | null => {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}
const gitTracked = (dir: string): string[] => {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
}

const admitted = admitCorpus(ROOT, EXTS)
const suffix = EXTS.map((e) => (e.startsWith(".") ? e : `.${e}`))
const repos: Array<Record<string, unknown>> = []
for (const repo of [...admitted.repos].sort()) {
  const dir = join(ROOT, repo)
  const tracked = gitTracked(dir)
  let trackedTs = 0
  for (const rel of tracked) {
    const low = rel.toLowerCase()
    if (suffix.some((s) => low.endsWith(s))) trackedTs++
  }
  repos.push({
    repo,
    gitHead: gitHead(dir),
    trackedTsFamily: trackedTs,
    admitted: admitted.files.filter((f) => f.includes(`${join(ROOT, repo)}`) || f.startsWith(join(ROOT, repo))).length,
  })
}

// THE SELF-CORPUS. This repository is TypeScript and the owner authorised it as a corpus; its HEAD
// and its own tracked `.ts` count are recorded so a self-corpus arm names the revision it measured.
const selfTracked = gitTracked(REPO)
const selfTs = selfTracked.filter((rel) => {
  const low = rel.toLowerCase()
  return suffix.some((s) => low.endsWith(s))
})

const totals = {
  repos: repos.length,
  reposSeen: admitted.reposSeen,
  reposNotGit: admitted.reposNotGit,
  admitted: admitted.files.length,
  overCap: admitted.overCap,
  absent: admitted.absent,
  overCapLargest: admitted.overCapLargest,
  populationDigest: populationDigest(admitted.files, ROOT),
  extensions: EXTS,
  sizeCap: SIZE_CAP,
}

const doc = {
  schemaVersion: 1,
  lane: "typescript",
  purpose: "the whole-population numbers of the typescript lane are reproducible from this manifest",
  rootPolicy: {
    measuredOn: ROOT,
    default: join(process.env.HOME ?? "", "bb_tests/repositories"),
    rule: "BB_CORPUS_ROOT selects the root. The DEFAULT root and the (now deleted) .corpus FARM are DIFFERENT POPULATIONS and their rates are not comparable — incoming-gate.ts prints which root it walked for exactly this reason.",
    note: "The declaration recorded 17,689 files / 42 repos on the FARM. That farm no longer exists: $PWD/.corpus is now the JavaScript lane's 22 cloned repositories. The numbers regenerated from this manifest are measured on the root named in `measuredOn`.",
  },
  admissionRule: {
    source: "script/m14/ts-corpus.ts admitCorpus — the gate's own rule, imported rather than re-implemented",
    tracked: "git ls-files",
    extensions: EXTS,
    sizeCap: SIZE_CAP,
  },
  generatedAt: new Date().toISOString(),
  totals,
  repos,
  selfCorpus: {
    path: REPO,
    gitHead: gitHead(REPO),
    trackedTsFamily: selfTs.length,
    extensions: EXTS,
    note: "the owner authorised this repository as a corpus; a self-corpus arm records the HEAD it measured",
  },
}

const text = JSON.stringify(doc, null, 2) + "\n"
if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`NO MANIFEST at ${OUT} — an absent manifest is not a pass`)
    process.exit(2)
  }
  const prev = JSON.parse(readFileSync(OUT, "utf8"))
  const diffs: string[] = []
  if (prev.totals?.admitted !== totals.admitted) diffs.push(`admitted ${prev.totals?.admitted} -> ${totals.admitted}`)
  if (prev.totals?.populationDigest !== totals.populationDigest) diffs.push(`digest ${String(prev.totals?.populationDigest).slice(0, 12)} -> ${String(totals.populationDigest).slice(0, 12)}`)
  // THE SELF-CORPUS HEAD IS DELIBERATELY NOT COMPARED (2026-11-18). A manifest
  // committed INSIDE the repository can never name the HEAD that contains it — the
  // commit that records the manifest moves the HEAD past it, so the check was
  // structurally unable to pass at any HEAD and turned a population guarantee into a
  // permanently-red gate. Measured: after every single commit the verdict was
  // "MANIFEST STALE — self HEAD <previous> -> <current>", which is the exact
  // "gate that teaches its readers to ignore it" failure this lane has been closing.
  //
  // What the self-corpus guarantee actually needs is that a PROBE RECORDS the
  // revision it measured, and it does: `ts-self-corpus-probe.ts` prints the HEAD in
  // its own report and the manifest's `selfCorpus` block stays as that record. The
  // POPULATION is what must not drift silently, and that is still checked two ways —
  // `totals.admitted` and the population digest over the external root, plus every
  // repository's own HEAD. A self-corpus whose FILE COUNT moved is still caught,
  // because `selfCorpus.trackedTsFamily` is compared below.
  if (prev.selfCorpus?.trackedTsFamily !== doc.selfCorpus.trackedTsFamily)
    diffs.push(`self tracked .ts-family ${prev.selfCorpus?.trackedTsFamily} -> ${doc.selfCorpus.trackedTsFamily}`)
  const prevByRepo = new Map((prev.repos ?? []).map((r: any) => [r.repo, r.gitHead]))
  for (const r of repos) if (prevByRepo.get(r.repo) !== r.gitHead) diffs.push(`${r.repo} HEAD ${prevByRepo.get(r.repo)} -> ${r.gitHead}`)
  if (diffs.length > 0) {
    console.error(`MANIFEST STALE — the corpus changed since the manifest was written (${diffs.length} difference(s)):`)
    for (const d of diffs.slice(0, 40)) console.error(`  ${d}`)
    process.exit(1)
  }
  console.log(`manifest OK — ${totals.admitted} admitted files across ${totals.repos} repos, digest ${String(totals.populationDigest).slice(0, 16)}`)
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, text)
console.log(`wrote ${OUT}`)
console.log(`  root: ${ROOT}`)
console.log(`  admitted: ${totals.admitted} files across ${totals.repos} repos (${totals.reposSeen} dirs seen, ${totals.reposNotGit} not git)`)
console.log(`  over cap ${totals.overCap} · absent ${totals.absent} · digest ${String(totals.populationDigest).slice(0, 16)}`)
console.log(`  self-corpus: ${doc.selfCorpus.trackedTsFamily} tracked .ts-family files at ${doc.selfCorpus.gitHead}`)
