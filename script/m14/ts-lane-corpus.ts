/**
 * Shared corpus selectors for the DERIV_EXPORTS_TS lane instruments.
 *
 * Every predicate here is string arithmetic. The lane's hard rule is zero
 * regular expressions in its analyzer, census scripts and oracle: a regex over
 * source text matches comments and string literals and breaks on the next
 * grammar version. Four lane scripts (ts-deriv-oracle-audit,
 * ts-ontology-census, ts-r7-endpoint-probe, ts-type-mention-label-probe)
 * each carried their own `/\.(ts|tsx|mts|cts)$/` and `/\.d\.ts$/`, which is
 * both a rule violation and five copies of one fact that can drift apart.
 *
 * `admittedTypeScriptFiles` is the population: it is DERIVED from
 * `git ls-files`, never hand-written, so a file added beside the script is
 * counted rather than silently missed (honesty contract §"Rule: an instrument
 * must declare the population it covered").
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/** Extensions `language-detection.ts` routes to the typescript analyzer. */
export const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"] as const

/** True when `rel` ends in a TypeScript extension. */
export const isTsSource = (rel: string): boolean => {
  for (const e of TS_EXTS) if (rel.endsWith(e)) return true
  return false
}

/** True for an ambient declaration file. `.d.ts`, `.d.mts`, `.d.cts`. */
export const isDeclarationFile = (rel: string): boolean => {
  for (const e of TS_EXTS) if (rel.endsWith(`.d${e}`)) return true
  return false
}

/** Git-tracked paths of a corpus repo, sorted, or [] when it is not a repo. */
export const gitTracked = (dir: string): string[] => {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    return []
  }
}

/** The pinned commit of a corpus repo, for a reproducible citation. */
export const gitRev = (dir: string): string => {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

export type Admitted = {
  repo: string
  repoDir: string
  rev: string
  /** total tracked TypeScript files, before any size filter — the denominator */
  trackedTs: number
  /** tracked TypeScript files that are ambient declarations */
  trackedDeclaration: number
  /** every admitted path */
  all: string[]
  /** admitted paths with ambient declarations removed */
  implementation: string[]
}
/**
 * Derive the census population from the repository itself.
 *
 * @param corpusRoot  BB_CORPUS_ROOT, or the programme default
 * @param repoName    directory name under corpusRoot
 * @param maxBytes    per-file size cap; production has one, so the census
 *                    reports how many files it dropped rather than hiding them
 * @param limit       0 = whole population; N = first N after sorting
 */
export const admittedTypeScriptFiles = (
  corpusRoot: string,
  repoName: string,
  maxBytes: number,
  limit: number,
): Admitted => {
  const repoDir = path.join(corpusRoot, repoName)
  const tracked = gitTracked(repoDir)
  let trackedTs = 0
  let trackedDeclaration = 0
  const implementation: string[] = []
  for (const rel of tracked.sort()) {
    if (!isTsSource(rel)) continue
    trackedTs++
    if (isDeclarationFile(rel)) {
      trackedDeclaration++
      continue
    }
    const abs = path.join(repoDir, rel)
    try {
      if (fs.statSync(abs).size > maxBytes) continue
    } catch {
      continue
    }
    implementation.push(abs)
  }
  const sliced = limit > 0 ? implementation.slice(0, limit) : implementation
  return {
    repo: repoName,
    repoDir,
    rev: gitRev(repoDir),
    trackedTs,
    trackedDeclaration,
    all: sliced,
    implementation,
  }
}

/**
 * Has this ParseResult come from the REGEX fallback rather than the analyzer?
 *
 * MEASURED, not inferred. `parseFile` (src/ast/pool-worker.ts:1213-1232) wraps
 * its whole body in a try/catch and, on ANY failure — including
 * `Language.load failed for <lang>` — returns `extractFallback(...)`, whose
 * relationships come from `extractBasicRelationships`: three `/g` regexes over
 * the raw source lines. Those rows look like analyzer output. They carry
 * `metadata.method === "regex"` and a confidence of 0.4/0.5/0.6, and they
 * fabricate `calls this -> <name>` from any `name(` in the text.
 *
 * This lane measured what that costs. Running this lane's own census from a
 * git worktree with no `node_modules` produced
 *
 *   calls 3,360 (confidence 0.5:3219, 0.4:141)   instantiates 9 (0.6:9)
 *   uses/contains/imports/references/exports/extends/implements/overrides  0
 *
 * on 1,069 files — a plausible-looking, entirely fabricated census. The real
 * analyzer emitted 3,369 edges' worth of `calls` and 0 of the other nine types
 * on the same files; the fallback emitted 141 `calls` and 9 `instantiates` and
 * nothing else, and the two are indistinguishable in the return value except by
 * this stamp. `script/m14/firing-check-v2.mjs` avoids it only because it calls
 * `getParser` itself instead of `parseFile`.
 *
 * So every lane instrument asserts on it rather than trusting the count.
 */
export const isFallbackResult = (res: unknown): boolean => {
  const rels = (res as { relationships?: { metadata?: Record<string, unknown> }[] } | null | undefined)?.relationships
  if (!Array.isArray(rels)) return false
  for (const r of rels) if (r?.metadata?.method === "regex") return true
  return false
}

/** Throw unless every sampled result came from the analyzer, naming the first
 *  offender. A census that measured the fallback must fail, not print. */
export const assertNoFallback = (results: { file: string; fallback: boolean }[]): void => {
  const bad = results.filter((r) => r.fallback)
  if (!bad.length) return
  const names = bad.slice(0, 5).map((r) => r.file)
  throw new Error(
    `${bad.length} of ${results.length} sampled files came from pool-worker's REGEX ` +
      `extractFallback, not from the analyzer — the census would measure the wrong ` +
      `instrument. First: ${names.join(", ")}. Usual cause: no node_modules/tree-sitter-*.wasm ` +
      `reachable from this checkout.`,
  )
}
