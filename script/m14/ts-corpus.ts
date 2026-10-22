// TYPESCRIPT LANE — THE LANE'S OWN CORPUS ADMISSION WALK.
//
// WHY THIS FILE EXISTS AT ALL: the admission rule (git-tracked, extension from the router's one
// table, at most the gate's 1 MB cap, present on disk) is the DENOMINATOR'S rule. A second copy
// of it is a second copy of the denominator, and the fleet has already paid for that twice in
// this lane: a hand-written extension map, and a lane-named corpus directory that did not exist.
// ⇒⇒⇒ **THE FIX IS THAT THERE IS NO SECOND LIST — SO THE RULE LIVES ONCE, HERE, AND EVERY
// TYPESCRIPT-LANE INSTRUMENT THAT NEEDS A POPULATION IMPORTS IT.**
//
// The rule is the gate's own (`script/m14/incoming-gate.ts`): an immediate child of the corpus
// root that is a real git checkout is a repository; `git ls-files` gives the tracked paths; a
// path is admitted when its extension is in the ROUTER'S ONE TABLE (`extensionsFor`, the same
// function the gate calls); a tracked path that is not on disk is counted as ABSENT and not
// claimed; a file over the cap is counted as OVER-CAP and not admitted.
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { extensionsFor } from "./language-extensions"

export { extensionsFor }

/** THE GATE'S SIZE CAP. The engine's own line: above 1 MB it extracts structurally, not by AST. */
export const SIZE_CAP = 1024 * 1024

export interface ExtRow {
  tracked: number
  overCap: number
  absent: number
  admitted: number
}

export interface Admitted {
  files: string[]
  repos: Set<string>
  byExt: Map<string, ExtRow>
  overCap: number
  absent: number
  overCapLargest: number
  reposSeen: number
  reposNotGit: number
}

/**
 * ADMIT THE CORPUS ROOT. `exts` are the router's dotted spellings (".ts", ".tsx", …) —
 * `extensionsFor` returns them dotted, and this function uses them AS GIVEN: adding a second dot
 * here is how a census admits zero files while printing a table.
 */
export function admitCorpus(root: string, exts: string[]): Admitted {
  const out: Admitted = {
    files: [], repos: new Set(), byExt: new Map(),
    overCap: 0, absent: 0, overCapLargest: 0, reposSeen: 0, reposNotGit: 0,
  }
  const suffix = exts.map((e) => (e.startsWith(".") ? e : `.${e}`))
  const bump = (ext: string, key: keyof ExtRow) => {
    const row = out.byExt.get(ext) ?? { tracked: 0, overCap: 0, absent: 0, admitted: 0 }
    row[key]++
    out.byExt.set(ext, row)
  }
  let entries: string[]
  try { entries = readdirSync(root) } catch { return out }
  for (const name of entries.sort()) {
    const dir = join(root, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    out.reposSeen++
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) }
    catch { out.reposNotGit++; continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      const hit = suffix.find((s) => low.endsWith(s))
      if (!hit) continue
      const ext = hit.slice(1)
      bump(ext, "tracked")
      const abs = join(dir, rel)
      try {
        const size = statSync(abs).size
        if (size > SIZE_CAP) {
          out.overCap++
          out.overCapLargest = Math.max(out.overCapLargest, size)
          bump(ext, "overCap")
          continue
        }
      } catch { out.absent++; bump(ext, "absent"); continue }
      out.files.push(abs)
      out.repos.add(name)
      bump(ext, "admitted")
    }
  }
  out.files.sort()
  return out
}

/** A STRIDE over the admitted set — a sample that is not one repository's files. */
export function strideSample(files: string[], want: number): string[] {
  if (want <= 0 || files.length <= want) return files.slice(0, Math.max(0, want))
  const step = files.length / want
  const out: string[] = []
  for (let i = 0; i < want; i++) out.push(files[Math.floor(i * step)])
  return out
}

/** THE POPULATION LINE, in one string, so a page and a log print the SAME rule and the SAME digest. */
export function populationLine(admitted: Admitted): string {
  const per = [...admitted.byExt.entries()].sort()
    .map(([e, r]) => `${e} ${r.admitted}/${r.tracked}`).join(" ")
  return `parsed=${admitted.files.length}/${admitted.files.length} admitted=${admitted.files.length} ` +
    `repos=${admitted.repos.size} overCap=${admitted.overCap} absent=${admitted.absent} per-ext[${per}]`
}

/**
 * ⇒⇒⇒ **A COUNT IS NOT AN IDENTITY** (the dart lane's finding: an index cache keyed on a file count
 * and a max mtime served chunk 3's index to chunk 5). The population's identity is the SHA-256 of
 * its sorted file list, and that digest TRAVELS WITH EVERY NUMBER measured over it. Two runs that
 * print the same count but different digests are two different populations.
 *
 * The admission walk shells out to `git ls-files` once per repository (202 of them here), which
 * costs more than parsing a page of files. So the walk is measured ONCE and cached with its
 * digest; a later run reuses the cache only when the root, the extension list AND the cache's own
 * file list hash to the digest it recorded. A cache that cannot be verified is re-measured.
 */
export interface CachedAdmitted extends Admitted {
  digest: string
  root: string
  exts: string[]
}

export function populationDigest(files: string[], root: string): string {
  const h = createHash("sha256")
  h.update(`root:${root}\n`)
  for (const f of files) h.update(`${f}\n`)
  return h.digest("hex")
}

export function admitCorpusCached(root: string, exts: string[], cachePath: string): CachedAdmitted {
  const fresh = (a: Admitted): CachedAdmitted => ({
    ...a, root, exts, digest: populationDigest(a.files, root),
  })
  try {
    const prev = JSON.parse(readFileSync(cachePath, "utf8")) as any
    if (prev?.root === root && Array.isArray(prev?.exts) && prev.exts.join(",") === exts.join(",") &&
        Array.isArray(prev?.files) && prev.files.length > 0) {
      const rebuilt: Admitted = {
        files: prev.files, repos: new Set(prev.repos ?? []),
        byExt: new Map(Object.entries(prev.byExt ?? {})) as Map<string, ExtRow>,
        overCap: prev.overCap ?? 0, absent: prev.absent ?? 0,
        overCapLargest: prev.overCapLargest ?? 0,
        reposSeen: prev.reposSeen ?? 0, reposNotGit: prev.reposNotGit ?? 0,
      }
      const again = populationDigest(rebuilt.files, root)
      if (again === prev.digest) return fresh(rebuilt)
      console.log(`[corpus] cache digest MISMATCH (${String(prev.digest).slice(0, 12)} recorded, ${again.slice(0, 12)} recomputed) — re-measuring the admission walk`)
    }
  } catch { /* no cache, or an unreadable one: measure it */ }
  const measured = fresh(admitCorpus(root, exts))
  try {
    writeFileSync(cachePath, JSON.stringify({
      ...measured, repos: [...measured.repos], byExt: Object.fromEntries(measured.byExt),
    }, null, 2))
  } catch { /* a cache we cannot write is a cache we do not have */ }
  return measured
}
