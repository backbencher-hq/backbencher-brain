/**
 * XML GRAMMAR CORPUS HEALTH A/B — VENDORED into this repository.
 *
 * Every XML-family file in the pinned corpus, parsed by two wasms, counting ERROR
 * and MISSING nodes per file. This is the safety gate for a grammar repair: a
 * repair is only admissible if the corpus-wide damage it removes is larger than the
 * damage it introduces. It reports the per-file DELTA and names every regression
 * individually, because "net better" is not the same claim as "no worse anywhere".
 *
 * WHY IT MOVED. The probe and the pre-repair wasm it needs both lived in a sibling
 * worktree, so the A/B claim in the docs and in `grammars/tree-sitter-xml/PIN.md`
 * was not reproducible from a clone — and this particular probe had already been
 * caught dead once for exactly that reason. Its own comment records it: the
 * pre-repair arm pointed at `wasm/tree-sitter-xml.wasm`, which holds the PATCHED
 * build, so the arm compared the patched grammar against itself and reported
 * "improved 0, regressed 0, unchanged 8888" — a clean result from a comparison that
 * could not fail. The gate that found both original grammar defects had gone dead
 * while still reporting green, and the only symptom was a number that had stopped
 * moving.
 *
 * Both arms are now pinned inside the repository:
 *   - pre-repair bytes: `validation/m12/grammar/tree-sitter-xml.PRE-REPAIR.wasm`,
 *     sha256 50ad134273834d5efe37d8fe4f93aa4367b95a91be05dc08a6dc894c7ecdb9c1,
 *     50,008 bytes — the bytes the wired wasm had before the two repairs;
 *   - patched bytes: `wasm/tree-sitter-xml.wasm`, the sha256 the lane's grammar pin
 *     records.
 *
 * Usage:
 *   npx tsx script/m12/xml-grammar-corpus-ab.mts [--repos DIR]
 *   XML_AB_SIDES="wired (pre-repair),patched (M60 xml lane)" to select arms.
 */
/**
 * XML GRAMMAR CORPUS HEALTH A/B — every XML-family file in the pinned repos,
 * parsed by two wasms, counting ERROR / MISSING nodes per file.
 *
 * This is the safety gate for a grammar repair: a repair is only admissible if
 * the corpus-wide damage it removes is larger than the damage it introduces. It
 * reports, per file, the DELTA, and names every regression individually, because
 * "net better" is not the same claim as "no worse anywhere".
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import { dirname, join, resolve as pathResolve } from "node:path"
import { fileURLToPath } from "url"
import { Parser, Language } from "web-tree-sitter"

// The REPO ROOT. This file lives in `script/m12/`, so two levels up is the root —
// and getting that wrong produced `script/validation/...`, which is the kind of
// near-miss that reads as a missing file rather than a wrong base.
const ROOT_HERE = pathResolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

const REPOS = process.env.XML_CORPUS_ROOT ?? "$HOME/fixtures/xml/repos"
const OUT = process.env.XML_AB_OUT ?? join(ROOT_HERE, "validation", "m12", "results")
const EXTS = ["*.xml", "*.xsd", "*.dtd", "*.xsl", "*.xslt", "*.svg", "*.rng"]
const MAX_BYTES = Number(process.env.XML_MAX_BYTES || "4000000")

const SIDES: { label: string; file: string }[] = [
  // The PRE-REPAIR arm must point at the preserved pre-repair bytes, NOT at
  // `wasm/tree-sitter-xml.wasm`. That path holds the PATCHED build — the wired
  // wasm was replaced when the two grammar repairs were installed — so the arm
  // was comparing the patched grammar against itself and reporting
  // "improved 0, regressed 0, unchanged 8888": a clean result from a comparison
  // that could not fail.
  //
  // The gate that found BOTH original grammar defects had therefore gone dead
  // while still reporting green, and the only symptom was a number that had
  // stopped moving. The pre-repair bytes are preserved and pinned
  // (`50ad134273834d5ef…`, 50,008 B, `validation/m14/grammar-pins.json` lane xml
  // copies[0]), so the comparison is one path away from being live.
  { label: "wired (pre-repair)", file: join(ROOT_HERE, "validation", "m12", "grammar", "tree-sitter-xml.PRE-REPAIR.wasm") },
  { label: "patched (M60 xml lane)", file: join(ROOT_HERE, "wasm", "tree-sitter-xml.wasm") },
]
const SPEC = process.env.XML_AB_SIDES // "wired,patched" to override

await Parser.init()
const loaded: any[] = []
const filesToCheck = SPEC ? SPEC.split(",") : SIDES.map((s) => s.label)
for (const s of SIDES) {
  if (!filesToCheck.includes(s.label)) continue
  const lang = await Language.load(s.file)
  const p = new Parser()
  p.setLanguage(lang)
  loaded.push({ label: s.label, file: s.file, parser: p, bytes: statSync(s.file).size })
}

const files: { repo: string; rel: string; abs: string; bytes: number }[] = []
for (const repo of ["grails-core", "docx4j", "libxml2", "maven", "cxf", "libxslt"]) {
  const dir = join(REPOS, repo)
  let list: string[] = []
  try { list = execFileSync("git", ["-C", dir, "ls-files", ...EXTS], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { continue }
  for (const rel of list) {
    const abs = join(dir, rel)
    let bytes = 0
    try { bytes = statSync(abs).size } catch { continue }
    if (bytes > MAX_BYTES) continue
    files.push({ repo, rel, abs, bytes })
  }
}

const health = (root: any) => {
  let e = 0, m = 0, n = 0
  const st = [root]
  while (st.length) {
    const x = st.pop()!
    n++
    if (x.isError) e++
    if (x.isMissing) m++
    for (let i = 0; i < x.childCount; i++) st.push(x.child(i))
  }
  return { e, m, n }
}

const rows: any[] = []
const improved: string[] = []
const regressed: string[] = []
const perSide: Record<string, { files: number; clean: number; errorFiles: number; errorNodes: number; missingNodes: number; nodes: number; bytes: number }> = {}
for (const l of loaded) perSide[l.label] = { files: 0, clean: 0, errorFiles: 0, errorNodes: 0, missingNodes: 0, nodes: 0, bytes: 0 }

for (const f of files) {
  let src: string
  try { src = readFileSync(f.abs, "utf8") } catch { continue }
  const h: Record<string, any> = {}
  for (const l of loaded) {
    const tree = l.parser.parse(src)
    const r = health(tree.rootNode)
    tree.delete()
    h[l.label] = r
    const s = perSide[l.label]
    s.files++; s.nodes += r.n; s.bytes += f.bytes
    s.errorNodes += r.e; s.missingNodes += r.m
    if (r.e || r.m) s.errorFiles++; else s.clean++
  }
  const base = h[loaded[0].label]
  const cand = h[loaded[1].label]
  const delta = (cand.e + cand.m) - (base.e + base.m)
  const id = `${f.repo}/${f.rel}`
  if (delta < 0) improved.push(`${id}  ${base.e}E/${base.m}M -> ${cand.e}E/${cand.m}M`)
  if (delta > 0) regressed.push(`${id}  ${base.e}E/${base.m}M -> ${cand.e}E/${cand.m}M`)
  if (rows.length < 100000) rows.push({ file: id, bytes: f.bytes, ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, `${v.e}E/${v.m}M`])), delta })
}

const result = {
  generatedAt: new Date().toISOString(),
  sides: loaded.map((l) => ({ label: l.label, file: l.file, bytes: l.bytes })),
  corpus: { files: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0), extensions: EXTS, maxBytes: MAX_BYTES },
  perSide,
  improved: improved.length,
  regressed: regressed.length,
  unchanged: files.length - improved.length - regressed.length,
  improvedSample: improved.slice(0, 120),
  regressedSample: regressed.slice(0, 120),
}
writeFileSync(`${OUT}/grammar-corpus-ab.json`, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
