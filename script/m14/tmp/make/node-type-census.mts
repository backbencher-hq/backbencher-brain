/**
 * NODE-TYPE CENSUS — which of the grammar's 44 named types this corpus actually
 * produces, and how often.
 *
 * A completeness spec written from `node-types.json` alone is a reading of the
 * grammar. A spec written from this census is a reading of the LANGUAGE AS IT
 * OCCURS, which is the thing the analyzer actually has to survive. Where the two
 * disagree the interesting question is which declared types never fire — those
 * are the ones whose handling cannot be validated against anything real, and they
 * are the honest limit of this lane's evidence.
 *
 * Every declared type is reported, including the ones with count 0, so "44/44
 * classified" cannot be achieved by quietly dropping the unexercised ones.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"

const REPO = "<corpus-root>/backbencher-brain"
const SRC = "<corpus-root>/backbencher-brain/grammars/tree-sitter-make"
const OUT = "<corpus-root>/bb_tests/make/out"
const MAN = JSON.parse(readFileSync(`${OUT}/corpus-manifest.json`, "utf8"))
const REPOS = "<corpus-root>/bb_tests/repositories"

await Parser.init()
const parser = new Parser()
parser.setLanguage(await Language.load(`${REPO}/wasm/tree-sitter-make.wasm`))

const declared = [...new Set(
  JSON.parse(readFileSync(`${SRC}/src/node-types.json`, "utf8")).filter((x: any) => x.named).map((x: any) => x.type),
)].sort()

const counts: Record<string, number> = Object.create(null)
const filesWith: Record<string, number> = Object.create(null)
const fieldsSeen: Record<string, number> = Object.create(null)
const errorFiles: string[] = []
let totalNodes = 0
let anonTotal = 0

for (const f of MAN.fileList) {
  const abs = `${REPOS}/${f.repo}/${f.rel}`
  const content = readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  if (!tree) { errorFiles.push(`${f.repo}/${f.rel} (no tree)`); continue }
  const perFile = new Set<string>()
  let fileHasError = false
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    totalNodes++
    if (!n.isNamed) anonTotal++
    if (n.type === "ERROR" || n.isMissing) fileHasError = true
    if (n.isNamed) {
      counts[n.type] = (counts[n.type] ?? 0) + 1
      perFile.add(n.type)
    }
    for (const c of n.children) stack.push(c)
    for (let i = 1; i <= n.fieldCount; i++) {
      const fname = n.fieldNameForId(i)
      if (fname) {
        const child = n.childForFieldName(fname)
        if (child) fieldsSeen[fname] = (fieldsSeen[fname] ?? 0) + 1
      }
    }
  }
  if (fileHasError) errorFiles.push(`${f.repo}/${f.rel}`)
  for (const t of perFile) filesWith[t] = (filesWith[t] ?? 0) + 1
}

const neverFires = declared.filter((t) => !counts[t])
const undeclared = Object.keys(counts).filter((t) => !declared.includes(t))

const report = {
  corpus: { files: MAN.files, fileSetHash: MAN.fileSetHash },
  declaredNamedTypes: declared.length,
  observed: { totalNodes, namedNodes: totalNodes - anonTotal, anonymousNodes: anonTotal },
  counts, filesWith, fieldsSeen,
  neverFires,
  undeclaredTypesSeen: undeclared,
  filesWithParseError: errorFiles,
  coverage: {
    typesExercised: declared.length - neverFires.length,
    typesNeverExercised: neverFires.length,
    percentExercised: Number((((declared.length - neverFires.length) / declared.length) * 100).toFixed(1)),
  },
}
writeFileSync(`${OUT}/node-type-census.json`, JSON.stringify(report, null, 2) + "\n")

console.log(`declared named types : ${declared.length}`)
console.log(`exercised by corpus   : ${report.coverage.typesExercised} (${report.coverage.percentExercised}%)`)
console.log(`never fired          : ${neverFires.join(", ") || "(none)"}`)
console.log(`undeclared seen      : ${undeclared.join(", ") || "(none)"}`)
console.log(`nodes                : ${totalNodes} (${report.observed.namedNodes} named, ${anonTotal} anon)`)
console.log(`files with ERROR/MISSING: ${errorFiles.length}${errorFiles.length ? " -> " + errorFiles.slice(0, 5).join(", ") : ""}`)
console.log(`\nper-type (count / files):`)
for (const t of declared) console.log(`  ${t.padEnd(28)} ${String(counts[t] ?? 0).padStart(6)} / ${String(filesWith[t] ?? 0).padStart(3)}`)
