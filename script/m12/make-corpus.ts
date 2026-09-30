/**
 * The Make lane's corpus, in ONE place.
 *
 * All three `script/m12/make-*` gates need the same input, and all three used to
 * name a fixed list of repositories that includes `elixir` — a checkout that is
 * NOT on this machine. Every one of them therefore died on
 * `fatal: cannot change to '.../repositories/elixir'` before measuring
 * anything, and a gate that dies before it measures is indistinguishable from a
 * gate that passes. That is how three Make gates sat in the repo, unread, for
 * as long as the lane existed.
 *
 * The list is still preferred-order (a named repo is used when present, because
 * a pinned revision is better evidence than an anonymous one), but a missing
 * checkout is now SKIPPED and recorded rather than fatal, and if none of the
 * named repositories are present the enumerator falls back to the same by-RULE
 * sweep the lane's manifest uses. Which repositories were actually used is
 * returned to the caller so it can be written into the artifact: a substituted
 * input has to be visible, or the artifact is describing a corpus nobody ran.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"

export const REPOS_ROOT = "$HOME/fixtures/repositories"

/** Preferred, in order. Each is used when the checkout is present. */
export const PREFERRED_REPOS = [
  "elixir", "cabal", "luarocks", "terraform", "cython", "tree-sitter-clean",
  "tf-aws-components", "consul", "boundary", "luvit", "kong", "vault", "nomad",
  "waypoint", "packer", "perl5", "terragrunt", "Matrix", "torrentinim",
]

const EXACT = new Set(["Makefile", "makefile", "GNUmakefile", "Makefile.am", "Makefile.in"])
const SKIP = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".venv", "deps"])

export interface CorpusEntry { repo: string; abs: string; via: "pinned-checkout" | "rule-sweep" }

/**
 * Tracked Makefiles in a checkout.
 *
 * The pathspec is DELIBERATELY EMPTY. This used to pass `'*.mk' Makefile
 * GNUmakefile makefile`, and a bare pathspec like `Makefile` is matched by git
 * against the path from the ROOT: it matches `./Makefile` and nothing under a
 * directory. So `tf-aws-components` reported ONE Makefile when it has 53 -- its
 * root `Makefile` -- and `boundary` one when it has 10. The lane's M12 corpus gate
 * was therefore measuring 14 of the 100 files the differential measures, and the
 * 13 "missing repositories" it recorded were mostly repositories that were present
 * and full. That is what a pathspec looks like when nobody reads the count against
 * a corpus the same lane pins at 100.
 *
 * Listing everything and filtering with the SAME rule the by-RULE sweep uses (an
 * exact basename, or a `.mk` suffix) keeps ONE definition of "a Makefile" in the
 * lane instead of two that disagree.
 */
function trackedMakefiles(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").filter(Boolean)
      .filter((f) => {
        const base = f.slice(f.lastIndexOf("/") + 1)
        return EXACT.has(base) || base.endsWith(".mk")
      })
      .map((f) => `${dir}/${f}`)
  } catch {
    return []
  }
}

function sweepMakefiles(root: string, cap: number): CorpusEntry[] {
  const out: CorpusEntry[] = []
  for (const repo of readdirSync(root).sort()) {
    const rp = `${root}/${repo}`
    try { if (!statSync(rp).isDirectory()) continue } catch { continue }
    const stack = [rp]
    while (stack.length && out.length < cap) {
      const dir = stack.pop()!
      let entries: string[]
      try { entries = readdirSync(dir) } catch { continue }
      for (const e of entries) {
        const abs = `${dir}/${e}`
        let st: any
        try { st = statSync(abs) } catch { continue }
        if (st.isDirectory()) { if (!SKIP.has(e)) stack.push(abs); continue }
        if (EXACT.has(e) || e.endsWith(".mk")) { out.push({ repo, abs, via: "rule-sweep" }); if (out.length >= cap) break }
      }
    }
    if (out.length >= cap) break
  }
  return out
}

/**
 * Every Makefile the lane measures, with the repositories actually used.
 * `maxFiles` caps the rule-sweep so a large checkout cannot turn a gate into a
 * long job; the cap is returned so the artifact can disclose it.
 */
export function makeCorpus(maxFiles = 400): { files: CorpusEntry[]; repos: string[]; missing: string[]; cap: number; via: "pinned" | "rule-sweep" } {
  const files: CorpusEntry[] = []
  const repos: string[] = []
  const missing: string[] = []
  for (const repo of PREFERRED_REPOS) {
    const dir = `${REPOS_ROOT}/${repo}`
    try { if (!statSync(dir).isDirectory()) { missing.push(repo); continue } } catch { missing.push(repo); continue }
    const listed = trackedMakefiles(dir)
    if (listed.length === 0) { missing.push(`${repo} (no tracked Makefiles)`); continue }
    repos.push(repo)
    for (const abs of listed) {
      files.push({ repo, abs, via: "pinned-checkout" })
      if (files.length >= maxFiles) return { files, repos, missing, cap: maxFiles, via: "pinned" }
    }
  }
  if (files.length === 0) {
    const swept = sweepMakefiles(REPOS_ROOT, maxFiles)
    for (const e of swept) files.push(e)
    for (const r of new Set(swept.map((e) => e.repo))) repos.push(r)
    return { files, repos, missing, cap: maxFiles, via: "rule-sweep" }
  }
  return { files, repos, missing, cap: maxFiles, via: "pinned" }
}
