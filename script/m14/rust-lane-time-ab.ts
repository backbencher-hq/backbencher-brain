/** Lane payload/latency A-B: production parseFile over the pinned corpus, N
 *  repeats, MINIMUM reported per repeat set (the least contention-contaminated
 *  estimator on a shared machine). Read-only; writes nothing. */
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
async function main() {
  const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/ripgrep"
  // `../../`, not `../../../`: this file lives at script/m14/, and the third
  // level resolved to the PARENT of the repo. The committed version of this file
  // carried `../../../src/...` and died with ERR_MODULE_NOT_FOUND from its own
  // committed path, so the payload/latency table in the lane doc could not have
  // been produced by running the file as committed. Found by running it.
  const { detectLanguageFromPath } = await import("../../src/ast/language-detection")
  const { parseFile } = await import("../../src/ast/pool-worker")
  const tracked = execFileSync("git", ["-C", CR, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
  const files: string[] = []
  for (const rel of tracked) {
    const abs = path.join(CR, rel)
    if (!statSync(abs).isFile() || statSync(abs).size > 512 * 1024) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "rust") continue
    files.push(abs)
  }
  const REPEATS = Number(process.argv[2] ?? "3")
  const best: number[] = []
  let rels = 0, syms = 0, bytes = 0
  for (let r = 0; r < REPEATS; r++) {
    const t0 = Date.now()
    rels = 0; syms = 0; bytes = 0
    for (let i = 0; i < files.length; i += 8) {
      const batch = files.slice(i, i + 8)
      await Promise.all(batch.map(async (abs) => {
        const res: any = await parseFile(abs, CR)
        rels += (res.relationships ?? []).length
        syms += (res.symbols ?? []).length
        for (const x of res.relationships ?? []) bytes += Buffer.byteLength(JSON.stringify(x))
      }))
    }
    best.push(Date.now() - t0)
  }
  console.log(`files=${files.length} repeats=${REPEATS} wallMs=[${best.join(", ")}] min=${Math.min(...best)} symbols=${syms} relationships=${rels} relationshipKiB=${(bytes / 1024).toFixed(1)} msPerFile=${(Math.min(...best) / files.length).toFixed(2)}`)
}
main()
