// File Discovery — Walk project directory, filter brain_file, respect .gitignore/.bbignore
// Ported from backbencher's parallel-indexer.ts discoverAndFilterFiles()

import { readdir, stat } from "fs/promises"
import { existsSync, readFileSync } from "fs"
import { join, relative, extname } from "path"
import ignoreModule from "ignore"
// eslint-disable-next-line
const ignore: any = (ignoreModule as any).default || ignoreModule
import type { Database as SqliteDb } from "better-sqlite3"
import { createLogger } from "../util/log.js"

const log = createLogger("discover")

// ============================================================================
// CONFIGURATION
// ============================================================================

export const EXTENSIONS = new Set([
  // Web
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".html", ".css", ".scss", ".sass", ".json", ".yaml", ".yml",
  ".svelte", ".vue", ".graphql", ".gql",
  // Systems
  ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".rs", ".go", ".zig",
  // JVM
  ".java", ".kt", ".kts", ".scala", ".sc", ".groovy", ".gsp",
  // Scripting
  ".py", ".pyw", ".rb", ".php", ".lua", ".pl", ".pm", ".t",
  ".ex", ".exs", ".erl", ".hrl",
  // Functional
  ".hs", ".lhs", ".clj", ".cljs", ".cljc", ".edn", ".icl", ".dcl",
  // Mobile
  ".swift", ".dart",
  // Enterprise
  ".cs", ".csx", ".fs", ".fsi", ".fsx",
  // Data
  ".r", ".sql",
  // Shell
  ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".psd1",
  // Infra
  ".tf", ".tfvars", ".tofu", ".hcl",
  // Apple
  ".m", ".mm",
])

export const SKIP_PATTERNS = [
  /\/node_modules\//, /\/vendor\//, /\/bower_components\//,
  /\/__pycache__\//, /\/\.venv\//, /\/venv\//, /\/env\//,
  /\/dist\//, /\/build\//, /\/out\//, /\/target\//,
  /\/\.next\//, /\/\.nuxt\//, /\/\.svelte-kit\//,
  /\/coverage\//, /\/\.nyc_output\//,
  /\/\.cache\//, /\/\.turbo\//,
  /\/\.git\//, /\/\.svn\//, /\/\.hg\//,
  /\/\.gradle\//, /\/\.idea\//, /\/\.vs\//, /\/\.vscode\//,
  /\/Pods\//, /\/\.dart_tool\//, /\/\.pub-cache\//,
  /\/_build\//, /\/deps\//, /\/\.stack-work\//,
  /\/\.tox\//, /\/\.pytest_cache\//, /\/\.terraform\//,
  /\/bin\//, /\/obj\//, /\/storybook-static\//,
  /\/tree-sitter-clean\//, /\/\.bb_backups\//,
  /\/android\/build\//, /\/ios\/build\//,
  /\/\.expo\//, /\/platforms\//,
  /\/__generated__\//i, /\/generated\//i, /\/gen\//,
  /.*\.min\./, /.*-min\./, /.*\.bundle\./, /.*\.chunk\./,
  /.*\.map$/, /.*\.d\.ts$/,
  /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/, /bun\.lockb$/,
  /openapi\.json$/, /swagger\.json$/, /schema\.json$/,
  /\/perf\//, /\/Microbenchmarks\//, /\/wwwroot\//,
  /\/testassets\//, /\/benchmarkapps\//, /\/test\//,
  /.*\.(generated|Generated|gen|Gen)\./i,
  /.*\.g\.(cs|ts|js|fs)$/i,
]

export const MAX_FILE_SIZE = 1 * 1024 * 1024 // 1MB full AST
export const STRUCTURAL_LIMIT = 5 * 1024 * 1024 // 5MB structural only

// ============================================================================
// FILE DISCOVERY
// ============================================================================

export interface DiscoveryOptions {
  extensions?: Set<string>
  skipPatterns?: RegExp[]
  maxFileSize?: number
  excludePatterns?: string[]
  filesOverride?: string[]
}

export async function discoverFiles(
  projectPath: string,
  db: SqliteDb,
  options: DiscoveryOptions = {},
): Promise<string[]> {
  const exts = options.extensions || EXTENSIONS
  const skips = options.skipPatterns || SKIP_PATTERNS
  const maxSize = options.maxFileSize || MAX_FILE_SIZE

  // Get existing file records for incremental check
  const existingRecords = db.prepare(
    "SELECT path, last_modified, size_bytes FROM brain_file WHERE project_id = (SELECT project_id FROM index_status LIMIT 1)"
  ).all() as { path: string; last_modified: number; size_bytes: number }[]

  const existingStats = new Map(
    existingRecords.map((f) => [f.path, { mtime: f.last_modified, size: f.size_bytes }])
  )

  const brain_file: string[] = []
  const foundPaths = new Set<string>()
  let skipped = 0

  function shouldSkip(filePath: string): boolean {
    return skips.some((p) => p.test(filePath))
  }

  function hasValidExtension(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    if (filePath.endsWith("source")) return true
    return exts.has(ext)
  }

  async function processFile(fullPath: string): Promise<void> {
    try {
      const fileStat = await stat(fullPath)
      foundPaths.add(fullPath)

      if (fileStat.size > STRUCTURAL_LIMIT) {
        skipped++
        return
      }

      const existing = existingStats.get(fullPath)
      const mtimeMs = Math.floor(fileStat.mtimeMs)

      if (existing && Math.floor(existing.mtime) === mtimeMs && existing.size === fileStat.size) {
        skipped++
        return
      }

      brain_file.push(fullPath)
    } catch {
      // Skip on stat error
    }
  }

  // Load .gitignore and .bbignore patterns
  let rootIg = ignore()
  const gitignorePath = join(projectPath, ".gitignore")
  const bbignorePath = join(projectPath, ".bbignore")

  if (existsSync(gitignorePath)) {
    try { rootIg.add(readFileSync(gitignorePath, "utf8")) } catch {}
  }
  if (existsSync(bbignorePath)) {
    try { rootIg.add(readFileSync(bbignorePath, "utf8")) } catch {}
  }

  // CLI exclude patterns
  if (options.excludePatterns && options.excludePatterns.length > 0) {
    rootIg.add(options.excludePatterns)
  }

  // Walk the directory tree
  async function walk(dir: string, ig: any, depth: number): Promise<void> {
    if (depth > 50) return

    try {
      const entries = await readdir(dir, { withFileTypes: true })

      // Stop at nested .git (project boundary)
      if (dir !== projectPath && entries.some((e) => e.isDirectory() && e.name === ".git")) {
        return
      }

      // Parse local ignore brain_file
      let localIg = ig
      const localGitignore = entries.find((e) => e.isFile() && e.name === ".gitignore")
      const localBbignore = entries.find((e) => e.isFile() && e.name === ".bbignore")

      if (localGitignore) {
        try {
          const content = readFileSync(join(dir, ".gitignore"), "utf8")
          localIg = ignore().add(ig).add(content)
        } catch {}
      }
      if (localBbignore) {
        try {
          const content = readFileSync(join(dir, ".bbignore"), "utf8")
          localIg = localIg.add(content)
        } catch {}
      }

      const promises: Promise<void>[] = []

      for (const entry of entries) {
        // Skip hidden directories
        if (entry.name.startsWith(".")) {
          if (entry.isDirectory()) continue
        }

        const fullPath = join(dir, entry.name)
        const relativePath = relative(projectPath, fullPath)

        // Fast path: skip common directories
        if (
          relativePath.includes("/node_modules/") ||
          relativePath.includes("/dist/") ||
          relativePath.includes("/build/") ||
          relativePath.includes("/.git/") ||
          relativePath.includes("/coverage/") ||
          relativePath.includes("/obj/") ||
          relativePath.includes("/bin/") ||
          relativePath.includes("/perf/") ||
          relativePath.includes("/testData/")
        ) continue

        if (shouldSkip(fullPath)) continue
        if (localIg.ignores(relativePath + (entry.isDirectory() ? "/" : ""))) continue

        if (entry.isDirectory()) {
          promises.push(walk(fullPath, localIg, depth + 1))
        } else if (entry.isFile() && hasValidExtension(fullPath)) {
          promises.push(processFile(fullPath))
        }
      }

      await Promise.all(promises)
    } catch {
      // Skip directories we can't read
    }
  }

  // If brain_file override is provided, only process those
  if (options.filesOverride && options.filesOverride.length > 0) {
    for (const f of options.filesOverride) {
      await processFile(f)
    }
  } else {
    await walk(projectPath, rootIg, 0)
  }

  // Cleanup stale brain_file (in DB but not on disk)
  if (!options.filesOverride || options.filesOverride.length === 0) {
    const staleFiles = existingRecords.filter((record) => !foundPaths.has(record.path))
    if (staleFiles.length > 0) {
      log.debug("cleaning up stale brain_file", { count: staleFiles.length })
      // Cascade delete will be handled by the storage module
    }
  }

  log.info("file discovery complete", {
    found: brain_file.length,
    skipped,
    total: brain_file.length + skipped,
  })

  return brain_file
}
