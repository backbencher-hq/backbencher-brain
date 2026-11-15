/**
 * SVELTE — PAYLOAD WITH `projectRoot`, the configuration the lane's own payload check CANNOT see.
 *
 * `script/m14/svelte-payload-latency.ts:79` calls `parseFile(f.abs, f.dir)` with NO context, so
 * `context.projectRoot` is undefined there and every rule in `publishResolutionClaims` returns
 * before touching an edge. Its two arms are therefore byte-identical BY CONSTRUCTION — measured:
 * relationships 25,432 · bytes 5,762,924 in BOTH arms — and that is a statement about the check's
 * configuration, not about the claims.
 *
 * Production DOES pass a root (`pool-worker.ts` `contextFor` → `{ projectRoot: root }`), and the
 * arbiter does too. So the byte cost of the claims is measured HERE, in that configuration, with
 * the same discovery (`git ls-files`, `.svelte`, ≤512 KiB) and the same `JSON.stringify(rels)`
 * denominator.
 *
 * READ-ONLY.
 * CLI: bun run validation/m14/fixtures/svelte/payload-with-root.ts [repo]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const repo = process.argv[2] ?? "shadcn-svelte"
const dir = path.join(process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories", repo)
const MAX_BYTES = 512 * 1024
const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
const files: string[] = []
for (const rel of tracked) {
  if (!rel.endsWith(".svelte")) continue
  const abs = path.join(dir, rel)
  try {
    if (statSync(abs).size > MAX_BYTES) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "svelte") continue
  } catch {
    continue
  }
  files.push(abs)
}
let relationships = 0
let symbols = 0
let bytes = 0
let claimed = 0
let i = 0
const t0 = Date.now()
const work = async (): Promise<void> => {
  while (true) {
    const k = i++
    if (k >= files.length) return
    let r: any
    try {
      r = await parseFile(files[k], dir, { projectRoot: dir } as any)
    } catch {
      continue
    }
    symbols += (r?.symbols ?? []).length
    const rels = r?.relationships ?? []
    relationships += rels.length
    bytes += Buffer.byteLength(JSON.stringify(rels), "utf8")
    for (const rel of rels) {
      const md = rel?.metadata ?? {}
      if (md.sourcePathClaim !== undefined || md.importProjectFile !== undefined || md.isExternal === true) claimed++
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => work()))
console.log(`repo ${repo} · files ${files.length} · relationships ${relationships} · symbols ${symbols} · bytes ${bytes} (${(bytes / 1024).toFixed(1)} KiB) · claim-bearing edges ${claimed} · ms ${Date.now() - t0}`)
