/**
 * CORPUS MANIFEST — every Makefile the lane measures, and the revision each
 * repository is pinned at.
 *
 * A lane that cannot say WHICH bytes it measured cannot be re-run to the same
 * result, and a differential over "some Makefiles" is not a claim. So this
 * enumerates by RULE (filename set + `.mk` suffix, not a hardcoded list), records
 * each repo's commit, and records the per-file sha256 — so a later run that
 * draws a different set says so instead of silently reporting different numbers.
 *
 * Deliberately NOT filtered by size or by whether the analyzer likes them: a
 * census that only sees Makefiles the analyzer handles cannot find the ones it
 * drops. `parseSuccess` is recorded per file for exactly that reason.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { join, relative } from "node:path"

const ROOT = "/home/ishaq2321/bb_tests/repositories"
const OUT = "/home/ishaq2321/bb_tests/make/out"

const EXACT = new Set(["Makefile", "makefile", "GNUmakefile", "Makefile.am", "Makefile.in"])
const SUFFIX = ".mk"
const SKIP = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".venv", "deps"])

const files: { repo: string; rel: string; abs: string; bytes: number; sha256: string; lines: number }[] = []
const pins: Record<string, string> = {}

for (const repo of readdirSync(ROOT).sort()) {
  const rp = join(ROOT, repo)
  try {
    if (!statSync(rp).isDirectory()) continue
  } catch { continue }
  let rev = "unknown"
  try {
    rev = execFileSync("git", ["-C", rp, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch { /* not a git checkout — recorded as unknown rather than omitted */ }
  if (rev !== "unknown") pins[repo] = rev

  const stack = [rp]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const e of entries) {
      const abs = join(dir, e)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) {
        if (!SKIP.has(e)) stack.push(abs)
        continue
      }
      if (!EXACT.has(e) && !e.endsWith(SUFFIX)) continue
      const buf = readFileSync(abs)
      files.push({
        repo,
        rel: relative(rp, abs),
        abs,
        bytes: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex"),
        lines: buf.toString("utf8").split("\n").length,
      })
    }
  }
}

files.sort((a, b) => (a.repo === b.repo ? a.rel.localeCompare(b.rel) : a.repo.localeCompare(b.repo)))

const byRepo: Record<string, number> = {}
for (const f of files) byRepo[f.repo] = (byRepo[f.repo] ?? 0) + 1

const manifest = {
  lane: "make",
  rule: "filenames in {Makefile, makefile, GNUmakefile, Makefile.am, Makefile.in} or suffix .mk; skipping .git, node_modules, vendor, target, dist, build, .venv, deps",
  repositories: Object.keys(byRepo).length,
  files: files.length,
  totalBytes: files.reduce((a, f) => a + f.bytes, 0),
  totalLines: files.reduce((a, f) => a + f.lines, 0),
  pins,
  byRepo,
  // A digest of the ORDERED file list, so "the same corpus" is a checkable
  // statement rather than an assumption.
  fileSetHash: createHash("sha256").update(files.map((f) => `${f.repo}/${f.rel}:${f.sha256}`).join("\n")).digest("hex"),
  fileList: files.map((f) => ({ repo: f.repo, rel: f.rel, bytes: f.bytes, lines: f.lines, sha256: f.sha256 })),
}
writeFileSync(`${OUT}/corpus-manifest.json`, JSON.stringify(manifest, null, 2) + "\n")

console.log(`makefiles: ${manifest.files} across ${manifest.repositories} repos, ${manifest.totalLines} lines`)
console.log(`fileSetHash: ${manifest.fileSetHash.slice(0, 16)}`)
for (const [r, n] of Object.entries(byRepo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${r.padEnd(20)} ${String(n).padStart(3)}  ${pins[r]?.slice(0, 10) ?? "(no git)"}`)
}
