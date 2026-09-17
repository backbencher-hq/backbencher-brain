// M49 W21 (#850): per-file parse outcome for a groovy-surface sample, so two
// grammar builds can be compared SET-WISE (which files fixed, which regressed)
// instead of by headline counts — a headline can hide a fix and a break that
// cancel out. Usage:
//   bun script/m59/compare-groovy-grammar.ts --repo grails-core --out /tmp/x.json
//   bun script/m59/compare-groovy-grammar.ts --repo grails-core --list /tmp/subset.txt --out /tmp/x.json
//     `--list` restricts the run to an explicit file list (repo-relative, one
//     per line). It exists so a grammar change can be A/B'd on the BOUNDED set
//     it could possibly affect — the union of the two sides' failing sets plus
//     a deterministic clean control — instead of paying the whole 6,564-file
//     corpus twice, and so the reduced run is still reproducible from the list
//     rather than from whatever /tmp happened to hold.
//
// The criterion is the TREE'S OWN `rootNode.hasError`, not a hand-rolled walk.
// Measured reason (this is the instrument's own defect, found by disagreement):
// a walk that counts nodes whose `type === "ERROR"` flags **114 of these 454
// files that tree-sitter itself reports clean**. Each is a ZERO-WIDTH,
// UNNAMED, EMPTY-TEXT node sitting past the last line (EOF), present even on a
// second parse of identical source, and `tree-sitter parse` run from the
// vendored grammar prints no ERROR for those files at all — so it is a
// web-tree-sitter binding artifact, not a parse failure. Two counts are kept:
// the verdict (`hasError`) and the phantom tally, so the artifact stays visible
// rather than silently corrected.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { ASTEngine } from "../../src/ast/engine"

const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const REPO = `$HOME/fixtures/repositories/${arg("--repo", "grails-core")}`
const OUT = arg("--out", "/tmp/groovy-outcome.json")
const EXT = arg("--ext", "gradle")

async function main(): Promise<void> {
  const revision = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const wasmSha = createHash("sha256")
    .update(readFileSync("$HOME/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"))
    .digest("hex")
  const list = arg("--list", "")
  const files = list
    ? readFileSync(list, "utf8").trim().split("\n").map((s) => s.trim()).filter(Boolean)
    : execFileSync("git", ["-C", REPO, "ls-files", `*.${EXT}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
        .trim()
        .split("\n")
        .filter(Boolean)
        .sort()

  const per: Record<string, { errors: number; missing: number; rels: number; hasError: boolean }> = {}
  for (const file of files) {
    let src: string
    try {
      src = readFileSync(`${REPO}/${file}`, "utf8")
    } catch {
      continue
    }
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    let errors = 0
    let missing = 0
    if (root) {
      const stack: any[] = [root]
      while (stack.length) {
        const n = stack.pop()!
        if (n.type === "ERROR") errors++
        if (n.isMissing) missing++
        for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
      }
    }
    let rels = 0
    try {
      const res: any = await ASTEngine.parseFile(`${REPO}/${file}`, src)
      rels = (res.relationships ?? []).length
    } catch {
      /* recorded as 0 */
    }
    per[file] = { errors, missing, rels, hasError: root ? root.hasError : true }
  }
  writeFileSync(OUT, JSON.stringify({ repo: arg("--repo", "grails-core"), revision, wasmSha, ext: EXT, files: per }, null, 2))
  const failing = Object.entries(per).filter(([, v]) => v.errors > 0 || v.missing > 0).length
  const hasErr = Object.entries(per).filter(([, v]) => v.hasError).length
  const totalRels = Object.values(per).reduce((a, v) => a + v.rels, 0)
  console.log(
    `${Object.keys(per).length} *.${EXT} files · PARSE-FAILING(tree.hasError) ${hasErr} · ERROR/missing-walk ${failing} (phantom-only: ${failing - hasErr}) · relationships ${totalRels} · wasm ${wasmSha.slice(0, 12)} · -> ${OUT}`,
  )
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
