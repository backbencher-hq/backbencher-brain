// M11.12 ubiquitous-language corpus measurement: JSON, Markdown, XML, Bash,
// YAML, and Make are not the primary language of any evidence repo, but they
// appear as real files inside the clean evidence-eligible repositories. This
// harness measures them so every M11.12 language has representative
// real-project evidence (mirroring the acceptance criterion of issue #133).
// SQL has no clean real corpus on disk — documented as a planned acquisition
// in validation/m11/corpus-manifest.json.
process.env.BB_EMBEDDING_BATCH_LIMIT = "0"

const repos = {
  mojo: "$HOME/fixtures/repositories/mojo",
  powershell: "$HOME/fixtures/repositories/powershell",
  phpunit: "$HOME/fixtures/repositories/phpunit",
  luarocks: "$HOME/fixtures/repositories/luarocks",
  dplyr: "$HOME/fixtures/repositories/dplyr",
  terraform: "$HOME/fixtures/repositories/terraform",
  graphql_js: "$HOME/fixtures/repositories/graphql-js",
  vue_core: "$HOME/fixtures/repositories/vue-core",
}

const repositories = [
  { id: "json-graphql_js", path: repos.graphql_js, extensions: [".json"] },
  { id: "json-powershell", path: repos.powershell, extensions: [".json"] },
  { id: "json-terraform", path: repos.terraform, extensions: [".json"] },
  { id: "markdown-powershell", path: repos.powershell, extensions: [".md"] },
  { id: "markdown-dplyr", path: repos.dplyr, extensions: [".md"] },
  { id: "markdown-luarocks", path: repos.luarocks, extensions: [".md"] },
  { id: "markdown-terraform", path: repos.terraform, extensions: [".md"] },
  { id: "markdown-phpunit", path: repos.phpunit, extensions: [".md"] },
  { id: "xml-phpunit", path: repos.phpunit, extensions: [".xml"] },
  { id: "xml-powershell", path: repos.powershell, extensions: [".xml"] },
  { id: "bash-terraform", path: repos.terraform, extensions: [".sh"] },
  { id: "bash-powershell", path: repos.powershell, extensions: [".sh"] },
  { id: "bash-luarocks", path: repos.luarocks, extensions: [".sh"] },
  { id: "yaml-powershell", path: repos.powershell, extensions: [".yaml", ".yml"] },
  { id: "yaml-dplyr", path: repos.dplyr, extensions: [".yaml", ".yml"] },
  { id: "yaml-phpunit", path: repos.phpunit, extensions: [".yaml", ".yml"] },
  { id: "yaml-terraform", path: repos.terraform, extensions: [".yaml", ".yml"] },
  { id: "make-luarocks", path: repos.luarocks, makefiles: true },
  { id: "make-terraform", path: repos.terraform, makefiles: true },
]

const repoFilter = process.argv[2]
if (repoFilter && !repositories.some((r) => r.id === repoFilter)) {
  console.error(`[M11.12] unknown entry "${repoFilter}" (choose from: ${repositories.map((r) => r.id).join(", ")})`)
  process.exit(1)
}

async function measure(repo: (typeof repositories)[0]) {
  const result: Record<string, any> = { id: repo.id, path: repo.path }

  const discoveryStart = performance.now()
  let findArgs: string[]
  if (repo.makefiles) {
    // Makefiles have no extension — discover by basename.
    findArgs = ["find", repo.path, "-type", "f", "(",
      "-name", "Makefile", "-o", "-name", "GNUmakefile", "-o", "-name", "*.mk",
      ")", "!", "-path", "*/bin/*", "!", "-path", "*/obj/*", "!", "-path", "*/.git/*",
      "!", "-path", "*/node_modules/*", "!", "-path", "*/dist/*"]
  } else {
    const flags = repo.extensions.flatMap(ext => ["-name", `*${ext}`, "-o"]).slice(0, -1)
    findArgs = ["find", repo.path, "-type", "f", "(", ...flags, ")",
      "!", "-path", "*/bin/*", "!", "-path", "*/obj/*", "!", "-path", "*/.git/*",
      "!", "-path", "*/node_modules/*", "!", "-path", "*/dist/*"]
  }
  const find = Bun.spawn(findArgs, { stdout: "pipe", stderr: "pipe" })
  const files = (await new Response(find.stdout).text()).trim().split("\n").filter(Boolean).sort()
  await find.exited
  result.discoveryMs = performance.now() - discoveryStart
  result.candidateFiles = files.length

  const { getProjectId } = await import("../src/cli/index")
  const projectId = getProjectId(repo.path)
  result.projectId = projectId

  const { BrainDatabase } = await import("../src/brain/database")
  const db = await BrainDatabase.getRawInstance(projectId)
  result.dbPath = BrainDatabase.getDbPath(projectId)

  const indexStart = performance.now()
  const { indexProjectParallel } = await import("../src/ast/parallel-indexer")
  const stats = await indexProjectParallel(projectId, repo.path, {
    files,
    skipDiscovery: true,
    conflictMode: "replace",
    logger: { log: () => {}, write: () => {} },
  })
  const indexWallMs = performance.now() - indexStart

  result.index = {
    wallMs: Math.round(indexWallMs),
    stats: {
      totalFiles: stats.totalFiles,
      processedFiles: stats.processedFiles,
      successFiles: stats.successFiles,
      errorFiles: stats.errorFiles,
      timeoutFiles: stats.timeoutFiles,
      skippedFiles: stats.skippedFiles,
      symbolsExtracted: stats.symbolsExtracted,
      relationshipsFound: stats.relationshipsFound,
    },
  }

  // Per-subset counts: multiple ubiquitous entries share the same repo path,
  // so DB-wide totals would be cumulative across entries. Restrict the count
  // to exactly the files indexed by THIS run for honest per-language evidence.
  const subsetIds = (files as string[]).map((f) => {
    const rel = f.startsWith(repo.path + "/") ? f.slice(repo.path.length + 1) : f
    return `${projectId}:${rel}`
  })
  const ph = subsetIds.map(() => "?").join(",")
  const subsetFiles = (db.prepare(`SELECT COUNT(DISTINCT id) AS c FROM brain_file WHERE id IN (${ph})`).get(...subsetIds) as any)?.c ?? 0
  const subsetSyms = (db.prepare(`SELECT COUNT(*) AS c FROM brain_symbol WHERE file_id IN (${ph})`).get(...subsetIds) as any)?.c ?? 0
  // Relationships carry symbol ids (`${fileId}:name:line`), so subset them by
  // joining through the symbol's file_id rather than a dedicated file column.
  const subsetRels = (db.prepare(`
    SELECT COUNT(*) AS c FROM brain_relationship r
    WHERE EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id AND s.file_id IN (${ph}))
       OR EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.target_symbol_id AND s.file_id IN (${ph}))
  `).get(...subsetIds, ...subsetIds) as any)?.c ?? 0

  const postFiles = db.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(projectId) as any
  const postSyms = db.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId) as any
  const postRels = db.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ?").get(projectId) as any
  result.after = {
    files: subsetFiles,
    symbols: subsetSyms,
    relationships: subsetRels,
    // Project-wide totals for context (cumulative across shared-path entries).
    dbFiles: postFiles.c,
    dbSymbols: postSyms.c,
    dbRelationships: postRels.c,
  }

  const { statSync } = await import("fs")
  result.dbSizeBytes = statSync(result.dbPath).size

  const secs = indexWallMs / 1000
  result.throughput = {
    filesPerSec: Math.round((subsetFiles / secs) * 10) / 10,
    symbolsPerSec: Math.round((subsetSyms / secs) * 10) / 10,
  }

  return result
}

const outPath = "validation/m11/results/web-corpus-ubiquitous-observed.json"
const { readFileSync, existsSync } = await import("fs")
const evidence: any = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, "utf8"))
  : { timestamp: new Date().toISOString(), repositories: [] }
const runIds = new Set(repositories.filter((r) => !repoFilter || r.id === repoFilter).map((r) => r.id))
evidence.repositories = evidence.repositories.filter((r: any) => !runIds.has(r.id))
for (const repo of repositories) {
  if (repoFilter && repo.id !== repoFilter) continue
  console.error(`[M11.12] Indexing ${repo.id} (${repo.path})...`)
  try {
    const r = await measure(repo)
    evidence.repositories.push(r)
    console.error(`[M11.12] ${repo.id}: ${r.after.files} files, ${r.after.symbols} symbols, ${r.after.relationships} relationships, ${r.index.wallMs}ms wall`)
  } catch (e: any) {
    console.error(`[M11.12] ${repo.id} FAILED: ${e?.message}`)
    evidence.repositories.push({ id: repo.id, path: repo.path, error: e?.message })
  }
  await Bun.write(outPath, JSON.stringify(evidence, null, 2) + "\n")
}
console.log(`Evidence written to ${outPath}`)
