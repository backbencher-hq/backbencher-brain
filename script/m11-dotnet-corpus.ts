// M11.09 corpus measurement scope: this harness measures indexing correctness
// and throughput, not ML embedding latency. Embeddings are generated lazily in
// the background by the indexer (async queue) but for a measurement run they
// are skipped entirely so wall time reflects parser+store work only and memory
// stays bounded on multi-hour runs. The async embedding queue is the product
// behavior for normal indexing — this env override is harness-scoped.
process.env.BB_EMBEDDING_BATCH_LIMIT = "0"

const repositories = [
  { id: "roslyn", path: "$HOME/roslyn", extensions: [".cs"] },
  { id: "fsharp", path: "$HOME/fixtures/repositories/fsharp", extensions: [".fs", ".fsi", ".fsx"] },
]

// Optional CLI arg: `bun script/m11-dotnet-corpus.ts fsharp` runs one repo,
// reusing and merging into the existing evidence file (incremental re-runs).
const repoFilter = process.argv[2]
if (repoFilter && !repositories.some((r) => r.id === repoFilter)) {
  console.error(`[M11.09] unknown repo "${repoFilter}" (choose from: ${repositories.map((r) => r.id).join(", ")})`)
  process.exit(1)
}

async function measure(repo: typeof repositories[0]) {
  const result: Record<string, any> = { id: repo.id, path: repo.path }

  // Discover source files
  const discoveryStart = performance.now()
  const flags = repo.extensions.flatMap(ext => ["-name", `*${ext}`, "-o"]).slice(0, -1)
  const find = Bun.spawn(
    ["find", repo.path, "-type", "f", "(", ...flags, ")",
     "!", "-path", "*/bin/*", "!", "-path", "*/obj/*", "!", "-path", "*/.git/*",
     "!", "-path", "*/node_modules/*", "!", "-path", "*/dist/*"],
    { stdout: "pipe", stderr: "pipe" }
  )
  const files = (await new Response(find.stdout).text()).trim().split("\n").filter(Boolean).sort()
  await find.exited
  result.discoveryMs = performance.now() - discoveryStart
  result.candidateFiles = files.length

  // Setup project brain
  const { getProjectId } = await import("../src/cli/index")
  const projectId = getProjectId(repo.path)
  result.projectId = projectId

  const { BrainDatabase } = await import("../src/brain/database")
  const db = await BrainDatabase.getRawInstance(projectId)
  result.dbPath = BrainDatabase.getDbPath(projectId)

  // Pre-index counts
  const preFiles = db.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(projectId) as any
  const preSyms = db.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId) as any
  result.before = { files: preFiles.c, symbols: preSyms.c }

  // Peak RSS tracking
  let peakRss = 0
  const rssTimer = setInterval(() => { peakRss = Math.max(peakRss, process.resourceUsage().maxRSS) }, 2000)

  // Index
  const indexStart = performance.now()
  const cpuStart = process.cpuUsage()
  const { indexProjectParallel } = await import("../src/ast/parallel-indexer")
  const stats = await indexProjectParallel(projectId, repo.path, {
    files,
    skipDiscovery: true,
    conflictMode: "replace",
    logger: { log: () => {}, write: () => {} },
  })
  const indexWallMs = performance.now() - indexStart
  const cpuDelta = process.cpuUsage(cpuStart)
  clearInterval(rssTimer)
  peakRss = Math.max(peakRss, process.resourceUsage().maxRSS)

  result.index = {
    wallMs: Math.round(indexWallMs),
    userCpuMs: Math.round(cpuDelta.user / 1000),
    systemCpuMs: Math.round(cpuDelta.system / 1000),
    peakRssMB: Math.round(peakRss / 1024),
    stats: {
      totalFiles: stats.totalFiles,
      processedFiles: stats.processedFiles,
      successFiles: stats.successFiles,
      errorFiles: stats.errorFiles,
      timeoutFiles: stats.timeoutFiles,
      skippedFiles: stats.skippedFiles,
      symbolsExtracted: stats.symbolsExtracted,
      relationshipsFound: stats.relationshipsFound,
      importsFound: stats.importsFound,
    },
  }

  // Post-index counts
  const postFiles = db.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(projectId) as any
  const postSyms = db.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId) as any
  const postRels = db.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ?").get(projectId) as any
  const postImports = db.prepare("SELECT COUNT(*) AS c FROM brain_import WHERE project_id = ?").get(projectId) as any
  result.after = { files: postFiles.c, symbols: postSyms.c, relationships: postRels.c, imports: postImports.c }

  // DB size
  const { statSync } = await import("fs")
  result.dbSizeBytes = statSync(result.dbPath).size

  // Throughput
  const secs = indexWallMs / 1000
  result.throughput = {
    filesPerSec: Math.round(postFiles.c / secs * 10) / 10,
    symbolsPerSec: Math.round(postSyms.c / secs * 10) / 10,
    relationshipsPerSec: Math.round(postRels.c / secs * 10) / 10,
  }

  return result
}

const outPath = "validation/m11/results/dotnet-corpus-observed.json"
const { readFileSync, existsSync } = await import("fs")
// Reuse existing evidence for incremental single-repo runs: keep prior repo
// measurements, replace only the selected repo's entry.
const evidence: any = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, "utf8"))
  : { timestamp: new Date().toISOString(), repositories: [] }
if (repoFilter) evidence.repositories = evidence.repositories.filter((r: any) => r.id !== repoFilter)
for (const repo of repositories) {
  if (repoFilter && repo.id !== repoFilter) continue
  console.error(`[M11.09] Indexing ${repo.id} (${repo.path})...`)
  try {
    const r = await measure(repo)
    evidence.repositories.push(r)
    console.error(`[M11.09] ${repo.id}: ${r.after.files} files, ${r.after.symbols} symbols, ${r.after.relationships} relationships, ${r.index.wallMs}ms wall`)
  } catch (e: any) {
    console.error(`[M11.09] ${repo.id} FAILED: ${e?.message}`)
    evidence.repositories.push({ id: repo.id, path: repo.path, error: e?.message })
  }
  // Write incrementally after each repo so a crash never loses completed measurements.
  await Bun.write(outPath, JSON.stringify(evidence, null, 2) + "\n")
}
console.log(`Evidence written to ${outPath}`)
