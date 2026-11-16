/**
 * READ-ONLY PROBE — bash F5 disagreement adjudication.
 *
 * `differential.ts --sample N` ROTATES its draw (the log says so:
 * `[cold-pool] fsharp:bash: 1/30 fresh (rot 2, corpus 31)`), so two runs of the
 * same command legitimately disagree — which is a property of the harness, not
 * of the lane, and is exactly why adjudication needs a FIXED file set. This
 * probe runs the FULL pinned corpus and groups every disagreement by class, so
 * each class can be ruled or fixed rather than counted.
 *
 * It calls the same oracle the harness calls (imported, not reimplemented) and
 * the production `parseFile`, and it reports the SOURCE side of each
 * disagreement so a ruling can name the line.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, lstatSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveBashEdges, LANGS } from "../differential"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const REPO = process.argv[2] ?? "fsharp"
const dir = path.join(CORPUS_ROOT, REPO)

const files = execFileSync("git", ["-C", dir, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSyncBytes(path.join(process.cwd(), "wasm/tree-sitter-bash.wasm"))))

function readFileSyncBytes(p: string): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("node:fs").readFileSync(p)
}

const norm = (t: string) => t

interface Dis { kind: "MISSING" | "UNEXPLAINED"; label: string; from: string; target: string; file: string }

const dis: Dis[] = []
const symlinkedFiles: string[] = []
let truthTotal = 0
let covered = 0
let analyzerTotal = 0

for (const rel of files) {
  const abs = path.join(dir, rel)
  // BOTH SIDES MUST READ THE SAME BYTES. The first version of this probe read
  // the truth's input with `git show HEAD:<path>` and handed `parseFile` a
  // path, so `parseFile` read the WORKING TREE — and for a symlinked corpus
  // file those are different documents: `git show` returns the link TARGET
  // (`../httpd_SUITE_data/server_root/cgi-bin/printenv.sh`) while the file on
  // disk is the resolved CGI script. Truth and analyzer were therefore
  // describing two different files and the disagreements were fiction. It is
  // the `94d31f8b` lesson (a lane's identity is the bytes it read) arriving
  // through a symlink. The committed blob is read for the PIN; the bytes both
  // sides see are the ones on disk, and symlinks are counted and disclosed.
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  try {
    const st = lstatSync(abs)
    if (st.isSymbolicLink()) symlinkedFiles.push(rel)
  } catch {
    /* not a link */
  }
  const tree = parser.parse(text)
  if (!tree) continue
  const scriptName = rel.split("/").pop() ?? "script.sh"
  const truth = deriveBashEdges(tree.rootNode as any, scriptName)
  let rels: any[] = []
  try {
    const r: any = await parseFile(abs, dir)
    rels = r.relationships ?? []
  } catch {
    /* recorded as analyzer-empty below */
  }
  const normRels = rels.map((r: any) => ({
    label: String(r.type ?? r.relationshipType ?? ""),
    target: String(r.target ?? r.to ?? ""),
    from: String(r.source ?? r.from ?? ""),
  }))
  truthTotal += truth.length
  analyzerTotal += normRels.length
  for (const te of truth) {
    if (normRels.some((r) => r.label === te.label && norm(r.target) === norm(te.target))) covered++
    else dis.push({ kind: "MISSING", label: te.label, from: te.from, target: te.target, file: rel })
  }
  for (const r of normRels) {
    if (truth.some((te) => te.label === r.label && norm(te.target) === norm(r.target))) continue
    dis.push({ kind: "UNEXPLAINED", label: r.label, from: r.from, target: r.target, file: rel })
  }
  tree.delete?.()
}

console.log(`=== bash F5 adjudication over the FULL pinned corpus (${REPO}) ===`)
console.log(`symlinked corpus files (read as resolved on disk, both sides): ${symlinkedFiles.length}${symlinkedFiles.length ? ` -> ${symlinkedFiles.slice(0, 4).join(", ")}` : ""}`)
console.log(`files=${files.length} truth=${truthTotal} covered=${covered} (${((100 * covered) / Math.max(1, truthTotal)).toFixed(1)}%) analyzer-edges=${analyzerTotal}`)
console.log(`MISSING=${dis.filter((d) => d.kind === "MISSING").length} UNEXPLAINED=${dis.filter((d) => d.kind === "UNEXPLAINED").length}\n`)

const byLabel = new Map<string, { missing: number; unexplained: number; samples: string[] }>()
for (const d of dis) {
  const k = `${d.kind} ${d.label}`
  const row = byLabel.get(k) ?? { missing: 0, unexplained: 0, samples: [] }
  if (d.kind === "MISSING") row.missing++
  else row.unexplained++
  if (row.samples.length < 6) row.samples.push(`${d.file}  ${d.from} -> ${d.target}`)
  byLabel.set(k, row)
}
for (const [k, row] of [...byLabel.entries()].sort()) {
  console.log(`--- ${k}: missing=${row.missing} unexplained=${row.unexplained}`)
  for (const s of row.samples) console.log(`      ${s}`)
}
void LANGS
