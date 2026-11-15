// STORE-SCOPE PROBE (yaml) — do the STORE and the MODEL publish the same document scope?
//
// WHY IT EXISTS. `a82e4134d` fixed `pool-worker.ts`'s `contextFor(filePath)`, which returned an
// analyze context ONLY when a project index existed for the extension — and `indexCache` is null
// unless the worker was handed indexes (dart alone). So production handed every other language NO
// context and no `projectRoot`, while the gate and every census passed one explicitly. yaml is one
// of the five lanes that read `projectRoot`, so before that commit this lane published one
// spelling to the MODEL and another to the STORE: an unscoped document identity
// (`main.spec.containers`) in the graph, a scoped one (`test.integration.targets.apt.tasks.main…`)
// in every number this lane has reported.
//
// `script/m14/probe-projectroot-scope.mts` is the fleet control, and it copies `.json` files only.
// This is the yaml lane's version of the same probe, and it goes one step further: it reads the
// store's names back AND parses the same files through the analyzer with an explicit root, then
// compares the two sets. The fleet probe answers "is there a scope"; this answers "do the two
// layers agree", which is the claim the lane's numbers need.
//
// It passes NO context of its own to the indexing entry point, so a scope can only appear if the
// WORKER supplied a root.
//
//   npx tsx validation/m14/fixtures/yaml/store-scope-probe.ts
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

const REPO_ROOT = process.env.BB_REPO || path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SRC = path.join(CR, "ansible")
const SUBDIR = "test/integration/targets/apt/tasks"
if (!existsSync(path.join(SRC, SUBDIR))) { console.error(`corpus subdir not found: ${SRC}/${SUBDIR}`); process.exit(2) }

const root = mkdtempSync(path.join(tmpdir(), "bb-yaml-scope-"))
const projectRoot = path.join(root, "proj")
let copied = 0
const copiedRel: string[] = []
try {
  const dir = path.join(SRC, SUBDIR)
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).slice(0, 6)) {
    const dst = path.join(projectRoot, SUBDIR, f)
    mkdirSync(path.dirname(dst), { recursive: true })
    copyFileSync(path.join(dir, f), dst)
    copied++
    copiedRel.push(`${SUBDIR}/${f}`)
  }
  if (copied === 0) { console.error("no files copied — refusing to measure"); process.exit(2) }

  process.env.BB_DATA_DIR = path.join(root, ".bb-data")
  const { indexProjectParallel, discoverIndexableFiles } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
  const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
  const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)
  const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)

  const eligible = new Set(await discoverIndexableFiles(projectRoot))
  console.log(`probe — ansible/${SUBDIR}: ${copied} copied, ${eligible.size} indexer-eligible`)
  if (eligible.size === 0) { console.error("the indexer admits NONE of the copied .yml files — refusing to measure"); process.exit(2) }

  const PID = getProjectId(projectRoot)
  await indexProjectParallel(PID as any, projectRoot, {})
  const raw = await BrainDatabase.getRawInstance(PID as any)
  const rows = raw.prepare("SELECT name, qualified_name FROM brain_symbol WHERE project_id = ? ORDER BY qualified_name").all(PID) as Array<{ name: string; qualified_name: string | null }>
  if (rows.length === 0) { console.error(`BROKEN STORE: 0 symbols for ${PID} — refusing a verdict from an empty store.`); process.exit(2) }
  const storeNames = new Set(rows.map((r) => String(r.qualified_name ?? "")).filter((q) => q.length > 0))

  // THE SAME FILES, through the analyzer with an explicit root — the layer every number in this
  // lane's reports was measured on.
  const modelNames = new Set<string>()
  for (const rel of copiedRel) {
    const r = await parseFile(path.join(projectRoot, rel), projectRoot, { projectRoot } as any)
    for (const s of r?.symbols ?? []) {
      const q = String((s as any).qualifiedName ?? "")
      if (q.length > 0) modelNames.add(q)
    }
  }

  const scopeToken = SUBDIR.split("/").join(".")
  const storeScoped = [...storeNames].filter((q) => q.includes(scopeToken))
  const modelScoped = [...modelNames].filter((q) => q.includes(scopeToken))
  console.log(`  store symbols ${rows.length}   qualified names ${storeNames.size}   carrying the file's own scope: ${storeScoped.length}`)
  console.log(`  model names ${modelNames.size}   carrying the same scope: ${modelScoped.length}`)
  for (const q of [...storeNames].slice(0, 6)) console.log(`    store: ${q}`)

  const missingInStore = [...modelNames].filter((q) => !storeNames.has(q))
  const missingInModel = [...storeNames].filter((q) => !modelNames.has(q))
  console.log(`\n  names the model has and the store does not: ${missingInStore.length}`)
  for (const q of missingInStore.slice(0, 5)) console.log(`    ${q}`)
  console.log(`  names the store has and the model does not: ${missingInModel.length}`)
  for (const q of missingInModel.slice(0, 5)) console.log(`    ${q}`)

  const scopedOk = storeScoped.length > 0
  const agree = missingInStore.length === 0 && missingInModel.length === 0
  console.log(`\nVERDICT: store is ${scopedOk ? "SCOPED" : "UNSCOPED"}; layers ${agree ? "AGREE name-for-name" : "DISAGREE"}`)
  console.log(`  A scope can only appear here if the WORKER supplied a root: this probe passes no context.`)
  process.exit(scopedOk && agree ? 0 : 1)
} finally {
  rmSync(root, { recursive: true, force: true })
}
