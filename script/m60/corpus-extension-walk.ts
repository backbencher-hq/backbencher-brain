// script/m60/corpus-extension-walk.ts — THE ONE DEFINITION of "the extensions this corpus carries and what the
// router does with each", shared by `unrouted-extension-census.ts` (the measurement) and
// `unrouted-extension-gate.ts` (the enforcement).
//
// WHY A MODULE AND NOT TWO WALKS. The census prices refused keys; the gate refuses on refused keys. If each
// owned its own walk they could disagree — and both directions of disagreement are defects: a gate that walks
// a LARGER population fails on keys the census never measured, and a gate that walks a SMALLER one silently
// passes over exactly the regrowth it exists to catch. The house has been bitten by duplicated definitions
// before (`test-classification.ts`'s header records two detectors that disagreed), so this is the single
// definition, moved verbatim from the census, with the census importing it instead of keeping its copy.
//
// IMPORT-SAFE: everything here is a definition. No I/O runs at import time, which is what lets both scripts
// (and any future gate) share it without triggering each other's runs.
//
// THE POPULATION, stated once: for each git repository directly under `corpusRoot`, every TRACKED file
// (`git ls-files`, the same admission the census documents); a file over the cap is counted but never
// bucketed; a file the router refuses (`detectLanguageFromPath(rel) === null` — the walk's own admission test,
// which IS the router's, see the census's single-gate assertion) lands in `buckets` under its last-dot
// extension, lowercased.
import { execFileSync } from "node:child_process"
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs"
import path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

/** The same cap the census declares: files larger than this are counted as over-cap and never bucketed. */
export const FILE_CAP = 1024 * 1024

export type WalkFile = { repo: string; rel: string; abs: string; size: number; text: boolean }

/**
 * TEXT vs BINARY, decided PER FILE from the bytes. Moved verbatim from the census, whose header explains the
 * rule's version history: the hint-byte test alone (a NUL, or >5% non-printable control characters) called
 * `.png` TEXT because the PNG signature's leading `0x89` is not a control byte and a small image can hold no
 * NUL in its first 4 KB; UTF-8 validity is the missing discriminator. A truncated multi-byte sequence at the
 * 4 KB window's edge is not evidence of binary, so the tail is trimmed before the verdict.
 *
 * The rule VERSION (`TEXT_RULE_VERSION`) stays in the census: it versions the census's checkpoint rows, not
 * this function.
 */
export const looksText = (abs: string): boolean => {
  try {
    const fd = openSync(abs, "r")
    const buf = Buffer.alloc(4096)
    const n = readSync(fd, buf, 0, 4096, 0)
    closeSync(fd)
    if (n === 0) return true // an empty file carries no bytes that say "binary"
    let bad = 0
    for (let i = 0; i < n; i++) {
      const c = buf[i]
      if (c === 0) return false
      if (c < 9 || (c > 13 && c < 32) || c === 127) bad++
    }
    if (bad / n >= 0.05) return false
    for (let trim = 0; trim <= 3 && trim < n; trim++) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, n - trim))
        return true
      } catch {
        // try a shorter window: the cut may be mid-sequence, which is not evidence of binary
      }
    }
    return false
  } catch {
    return false
  }
}

/** The key a file is bucketed under: everything after the last dot, lowercased, `"(none)"` if there is none. */
export const extensionOf = (rel: string): string => {
  const base = rel.split("/").pop() ?? rel
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot).toLowerCase() : "(none)"
}

/**
 * EXTENSION-SHAPED, or a FILENAME FRAGMENT. Taking everything after the last dot is right for an extension and
 * wrong for a name that merely contains dots, spaces or punctuation — and this corpus has **58 such keys**:
 * `.nvmrc from source` and `.sh with --install should install the default` (a shell test suite's descriptive
 * filenames), `.0_darwin_amd64_sha256sum`, `.jsongenerator$converter`, `.outline_extracted`. Each was published
 * as an "extension" of its own, and **twelve of them landed in the fixable class**, where the join against the
 * fleet's rulings then proposed them for routing.
 *
 * The shape test cannot decide what a real extension is — `.bash-completion` is seventeen characters and real —
 * so it FILTERS NOTHING: the files stay counted, the row is LABELLED, and the actionable class is reported
 * separately so a fragment is never a work item. A rule that dropped them would have traded an over-count for
 * an invisible population.
 */
export const EXTENSION_SHAPE = /^\.[A-Za-z0-9_+-]{1,16}$/
export const isExtensionShaped = (ext: string): boolean => ext === "(none)" || EXTENSION_SHAPE.test(ext)

export type ExtensionWalk = {
  /** Refused files per extension (each ≤ the cap): the population the census measures and the gate refuses on. */
  buckets: Map<string, WalkFile[]>
  /** Extensions the router accepted somewhere in the corpus. Rows for these are re-admissions, not refusals. */
  routedExts: Set<string>
  /** EVERY extension's population, routed or not — the denominator the refusals are a share of. */
  allExts: Map<string, { files: number; bytes: number }>
  /** Files of `settledExtensions`, collected whether or not the router accepts them (the census's settled ledger). */
  settledFiles: Map<string, WalkFile[]>
  /** Refused files ≤ the cap, i.e. `sum(buckets)`. Over-cap refusals are in `overCap`, never here. */
  counted: number
  /** Files over the cap, not counted and not bucketed (matches the census's declared rule). */
  overCap: number
  overCapByExt: Map<string, number>
  reposWalked: string[]
  /** Every tracked file considered, admitted or refused — so a reader can see the walk's denominator. */
  filesScanned: number
  /**
   * Tracked files that `statSync` could not reach — MISSING FROM THE CHECKOUT, not absent from the population.
   * Measured at 22,861 on 2026-10-12, concentrated in three partially-materialized `pb-*` repos, and counted
   * HERE rather than passed over in silence: a census that says "all files" while skipping 22,861 of them is
   * the class of overstatement this programme keeps refusing.
   */
  trackedButNotOnDisk: number
}

/**
 * Walk the corpus. `detectText` controls the per-file `looksText` call: the census records text/binary for
 * every file it budgets (its rows are text-sensitive), while the gate walks WITHOUT it and sniffs only the
 * few files of keys it must triage — so `file.text === false` under `detectText: false` means NOT MEASURED,
 * never "binary". Nothing else differs between the two callers: the same cap, the same admission test, the
 * same bucketing rule.
 */
export function walkCorpus(opts: {
  corpusRoot: string
  /** Extensions whose files are collected regardless of the router's verdict (see ExtensionWalk.settledFiles). */
  settledExtensions?: readonly string[]
  detectText: boolean
  fileCapBytes?: number
  onRepo?: (name: string, soFar: { counted: number; refusedKeys: number }) => void
}): ExtensionWalk {
  const cap = opts.fileCapBytes ?? FILE_CAP
  const settledExtensions = opts.settledExtensions ?? []
  const routedExts = new Set<string>()
  const buckets = new Map<string, WalkFile[]>()
  const allExts = new Map<string, { files: number; bytes: number }>()
  const settledFiles = new Map<string, WalkFile[]>()
  const overCapByExt = new Map<string, number>()
  const reposWalked: string[] = []
  let counted = 0
  let overCap = 0
  let filesScanned = 0
  let trackedButNotOnDisk = 0

  const text = (abs: string): boolean => (opts.detectText ? looksText(abs) : false)

  for (const name of readdirSync(opts.corpusRoot).sort()) {
    const dir = path.join(opts.corpusRoot, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    reposWalked.push(name)
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let size = 0
      try {
        size = statSync(abs).size
      } catch {
        trackedButNotOnDisk++
        continue
      }
      filesScanned++
      const ext = extensionOf(rel)
      if (size > cap) {
        overCap++
        overCapByExt.set(ext, (overCapByExt.get(ext) ?? 0) + 1)
        continue
      }
      const tally = allExts.get(ext) ?? { files: 0, bytes: 0 }
      tally.files++
      tally.bytes += size
      allExts.set(ext, tally)
      if (settledExtensions.includes(ext)) {
        const pool = settledFiles.get(ext) ?? []
        pool.push({ repo: name, rel, abs, size, text: text(abs) })
        settledFiles.set(ext, pool)
      }
      if (detectLanguageFromPath(rel)) {
        routedExts.add(ext)
        continue
      }
      const f: WalkFile = { repo: name, rel, abs, size, text: text(abs) }
      const list = buckets.get(ext)
      if (list) list.push(f)
      else buckets.set(ext, [f])
      counted++
    }
    opts.onRepo?.(name, { counted, refusedKeys: buckets.size })
  }

  return { buckets, routedExts, allExts, settledFiles, counted, overCap, overCapByExt, reposWalked, filesScanned, trackedButNotOnDisk }
}

/**
 * THE SINGLE-GATE ASSERTION, shared so the census and the gate assert the IDENTICAL rule instead of two
 * copies: every file bucketed here must also be refused by the walk's own admission test, because that test
 * IS the router (`parallel-indexer.ts` — `hasValidExtension(p) === (detectLanguageFromPath(p) !== null)`).
 * A future edit that gave a caller its own allowlist would make these two disagree, and the caller would be
 * describing the wrong gate while still producing a table.
 */
export function routerDisagreements(
  buckets: Map<string, WalkFile[]>,
  perBucket = 3,
): { filesChecked: number; disagreements: Array<{ ext: string; rel: string }> } {
  const disagreements: Array<{ ext: string; rel: string }> = []
  let filesChecked = 0
  for (const [ext, files] of buckets) {
    for (const f of files.slice(0, perBucket)) {
      if (detectLanguageFromPath(f.rel) !== null) disagreements.push({ ext, rel: f.rel })
      filesChecked++
    }
  }
  return { filesChecked, disagreements }
}
