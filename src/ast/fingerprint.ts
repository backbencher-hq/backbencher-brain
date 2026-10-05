// src/ast/fingerprint.ts — M23.P3
// Codebase identity for index portability.
//
// A project's brain DB is keyed by projectId = sha1(realpath). Moving the
// project on disk changes that id, which orphans the DB and silently makes
// `bb index` start from zero. To make indexes portable we record a stable
// **codebase fingerprint** — sha1 over the set of *relative* file paths that
// were actually indexed (plus git remote when present, so two checkouts that
// happen to share a path shape but belong to different repos are not confused).
//
// Crucially, the fingerprint is computed IDENTICALLY on both sides:
//   • checkout side  — walk the on-disk tree with the same filters discovery
//                      uses (.bbignore/.gitignore, skip patterns, size tiers,
//                      valid-extension gate), producing sorted relative paths;
//   • DB side         — read `relative_path` from brain_file, sorted.
// If the checkout's file set matches a previously indexed project's file set,
// the DB can be adopted instead of reindexing from zero.
import { createHash } from "crypto"
import { readFile, readdir, stat, open } from "fs/promises"
import { existsSync } from "fs"
import path from "node:path"
import { ParallelIndexerConfig, parallelIndexerCliSkipPatterns } from "./parallel-indexer"

/** sha1 of a sorted, de-duplicated relative-path set. */
export function relativePathFingerprint(sortedRel: string[]): string {
  return createHash("sha1")
    .update(Array.from(new Set(sortedRel)).sort().join("\n"))
    .digest("hex")
    .substring(0, 40)
}

/** Best-effort git identity (remote URL + HEAD). Never throws. */
export async function gitIdentity(root: string): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process")
    const run = (args: string[]): Promise<string> =>
      new Promise((resolve) => {
        execFile("git", ["-C", root, ...args], { timeout: 4000 }, (err, stdout) => {
          resolve(err ? "" : stdout.toString().trim())
        })
      })
    const remote = await run(["remote", "get-url", "origin"])
    const head = await run(["rev-parse", "HEAD"])
    if (!remote && !head) return null
    return `${remote || "(no-remote)"}|${head || "(no-head)"}`
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Checkout-side walk — MIRRORS discoverAndFilterFiles in parallel-indexer.ts so
// the fingerprint describes exactly the set that WOULD be indexed.
// ---------------------------------------------------------------------------

const FULL_AST_LIMIT = 1 * 1024 * 1024
const STRUCTURAL_LIMIT = 5 * 1024 * 1024
const structuralExtensions = new Set([".json", ".yaml", ".yml", ".toml", ".xml", ".xsd", ".dtd", ".md", ".proto"])
const largeSourceExtensions = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"])

const skipDirNames = new Set([".git", ".svn", ".hg", ".cache", ".nyc_output", ".venv", ".next", ".nuxt", ".svelte-kit", ".turbo"])
const compiledDirTokens = ["/perf/", "/Microbenchmarks/", "/wwwroot/", "/coverage/", "/node_modules/", "/dist/", "/build/", "/.git/", "/obj/", "/bin/", "/testData/"]

// Skipped regardless of language/extension.
//
// This list used to be a hand-maintained COPY, and it had drifted by 21 directory
// names discovery skips — including `generated`, `bower_components`, `out`, `bin`,
// `test`, `vendor`, `platforms` and `wwwroot`. The walk therefore counted files
// discovery would never index, so the two fingerprints disagreed on an UNCHANGED
// tree and every index looked permanently stale. Measured on a fixture with 6
// deliberately divergent files: walk 9, indexed 3.
//
// It is now DERIVED from the two lists discovery actually consults, rather than
// copied again — a third copy is exactly what rots. Note those two lists do not
// agree with each other either: `snapshot.json` is in the CLI skip list but not
// in `skipPatterns`, and `schema.json` is in `skipPatterns` but not the CLI list.
// So the union is used, because the question the walk has to answer is "will
// discovery index this?", and the honest answer is "no, if EITHER list says so".
const cliSkipPatterns: RegExp[] = Array.from(
  new Set([...ParallelIndexerConfig.skipPatterns, ...parallelIndexerCliSkipPatterns()]),
)

async function loadIgnores(root: string, ownPath: string, parentIg: any): Promise<any> {
  try {
    const ignore = (await import("ignore")).default
    const ig = ignore().add(parentIg)
    const entries = await readdir(ownPath, { withFileTypes: true })
    for (const name of [".gitignore", ".bbignore"]) {
      const f = entries.find((e) => e.isFile() && e.name === name)
      if (!f) continue
      try {
        const content = await readFile(path.join(ownPath, f.name), "utf8")
        ig.add(content)
      } catch {
        /* ignore read errors */
      }
    }
    return ig
  } catch {
    return parentIg
  }
}

const DEFAULT_IGNORE_PATTERNS = [
  "**/perf/**", "**/Microbenchmarks/**", "**/wwwroot/**", "**/testassets/**",
  "**/benchmarkapps/**", "**/coverage/**", "**/testData/**",
]

/**
 * The first line of a file, for shebang detection — and nothing more.
 *
 * Bounded so this can never read a large file into memory: the walk touches
 * every extensionless entry in a tree, and some of those are device nodes or
 * multi-gigabyte blobs. A shebang is on line 1, so 256 bytes is generous; a file
 * that opens with a BOM or whitespace before `#!` still fits.
 */
async function readShebang(p: string): Promise<string> {
  try {
    const fh = await open(p, "r")
    try {
      const buf = Buffer.alloc(256)
      const { bytesRead } = await fh.read(buf, 0, 256, 0)
      return buf.subarray(0, bytesRead).toString("utf8")
    } finally {
      await fh.close()
    }
  } catch {
    return ""
  }
}

async function walk(root: string, dir: string, ig: any, depth: number, rel: string[]): Promise<void> {
  if (depth > 50) return
  let entries: any[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  // Nested project boundary (mirror discovery).
  if (dir !== root && entries.some((e) => e.isDirectory() && e.name === ".git")) return
  const localIg = await loadIgnores(root, dir, ig)
  const { detectLanguageFromPath } = await import("./language-detection")
  const jobs: Promise<void>[] = []
  for (const entry of entries) {
    if (entry.isDirectory() && skipDirNames.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(root, fullPath)
    const withSlash = relativePath + (entry.isDirectory() ? "/" : "")
    // Deep-review fix (S3): discovery tests its skip patterns against
    // "/" + relativePath (the shouldSkip contract). Testing the bare
    // relativePath here let top-level dist/, build/, node_modules/ … leak into
    // the fingerprint while discovery skips them — so the fingerprint stopped
    // matching the indexed set and adoption silently never fired for repos
    // with root-level build dirs.
    const normPath = "/" + relativePath + (entry.isDirectory() ? "/" : "")
    if (compiledDirTokens.some((t) => normPath.includes(t))) continue
    if (localIg.ignores(withSlash)) continue
    if (entry.isDirectory()) {
      jobs.push(walk(root, fullPath, localIg, depth + 1, rel))
      continue
    }
    if (!entry.isFile()) continue
    // `detectLanguageFromPath` takes optional CONTENT, and content is REQUIRED to
    // resolve an EXTENSIONLESS file: `nvm`, `libexec/rbenv` and `rbenv-init` are
    // indexable only by their shebang — the whole reason the shebang rule exists
    // (M14 #277: measured over five bash corpora, 385 extensionless files carry
    // one and 97.7% parse clean).
    //
    // Passing no content made this walk MISS every one of them while discovery
    // indexed them, so the two fingerprints disagreed on a tree that had not
    // changed — measured walk=4 files vs index=5 rows, permanently. Every index
    // then looked stale forever and the "did anything change" signal became
    // meaningless.
    //
    // Only the first bytes are read, and only when the name carries no extension:
    // a recognised extension always wins, so sniffing those would be wasted I/O
    // on every file in the tree.
    const baseName = entry.name
    const hasExt = baseName.lastIndexOf(".") > 0
    let detected: string | null = null
    if (hasExt) {
      detected = detectLanguageFromPath(fullPath)
    } else {
      // A basename can be a language on its own (Rakefile, Makefile); that needs
      // no content. Otherwise fall back to the shebang.
      detected = detectLanguageFromPath(fullPath)
      if (!detected) detected = detectLanguageFromPath(fullPath, await readShebang(fullPath))
    }
    if (!detected) continue
    if (cliSkipPatterns.some((p) => p.test(normPath))) continue
    jobs.push(
      (async () => {
        try {
          const s = await stat(fullPath)
          if (s.size > STRUCTURAL_LIMIT) return
          rel.push(relativePath)
        } catch {
          /* skip */
        }
      })(),
    )
  }
  await Promise.all(jobs)
}

export interface CheckoutFingerprint {
  fingerprint: string
  fileCount: number
  git: string | null
}

/** Compute the stable codebase fingerprint for a checkout WITHOUT touching any DB. */
export async function computeCheckoutFingerprint(root: string): Promise<CheckoutFingerprint> {
  const { default: ignore } = await import("ignore")
  const ig = ignore().add(DEFAULT_IGNORE_PATTERNS)
  const rel: string[] = []
  await walk(root, root, ig, 0, rel)
  const sorted = Array.from(new Set(rel)).sort()
  const git = await gitIdentity(root)
  const fingerprint = createHash("sha1")
    .update(sorted.join("\n"))
    .update(git ?? "")
    .digest("hex")
    .substring(0, 40)
  return { fingerprint, fileCount: sorted.length, git }
}

/** Compute the fingerprint stored in an already-indexed DB (relative_path set). */
export function computeDbFingerprint(raw: any, git: string | null): string {
  const rows = raw.prepare("SELECT relative_path FROM brain_file").all() as Array<{ relative_path: string }>
  const sorted = rows.map((r) => String(r.relative_path)).sort()
  return createHash("sha1")
    .update(sorted.join("\n"))
    .update(git ?? "")
    .digest("hex")
    .substring(0, 40)
}

/**
 * Read the stored fingerprint from a project DB row. Returns undefined when
 * the DB predates M23.P3 (no fingerprint recorded) — the caller must then fall
 * back to computing it from brain_file. Busy/serialized-open safety: this is a
 * cheap SELECT on the caller's raw handle.
 */
export function readStoredFingerprint(raw: any, projectId: string): string | undefined {
  try {
    const row = raw.prepare(
      "SELECT codebase_fingerprint FROM brain_index_status WHERE project_id = ?",
    ).get(projectId) as { codebase_fingerprint: string | null } | undefined
    return row?.codebase_fingerprint ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Persist the checkout fingerprint + git identity into brain_index_status so
 * a later move can adopt this DB without re-walking every other project.
 */
export async function persistProjectFingerprint(
  projectId: string,
  projectPath: string,
): Promise<string> {
  try {
    const cf = await computeCheckoutFingerprint(projectPath)
    const { BrainDatabase } = await import("../brain/database")
    const raw = await BrainDatabase.getRawInstance(projectId)
    raw
      .prepare(
        `UPDATE brain_index_status SET codebase_fingerprint = ?, codebase_git = ?, time_updated = strftime('%s','now')*1000
         WHERE project_id = ?`,
      )
      .run(cf.fingerprint, cf.git ?? null, projectId)
    return cf.fingerprint
  } catch {
    return ""
  }
}