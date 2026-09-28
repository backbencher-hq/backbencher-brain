// The enumerable surface the M60 pin contract asks for: id-order, type-set and
// field-set digests through web-tree-sitter, with the id / named / anonymous
// vocabularies recorded separately. Measured over a corpus rich enough to reach
// every field, not read out of a file.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"
import { join } from "node:path"

const CORPUS = "$HOME/fixtures/repositories"
const OUT = "$HOME/fixtures/out/lua-surface-digest.json"
const BUILDS: Array<[string, string]> = [
  ["wired", resolveWasmAsset("tree-sitter-lua.wasm")],
  ["npm-0.4.1", "$HOME/fixtures/grammars/npm-0.4.1.wasm"],
  ["tswasms-0.1.13", "$HOME/fixtures/grammars/tswasms-0.1.13-lua.wasm"],
]

async function main(): Promise<void> {
  const mod: any = await loadWebTreeSitter()
  await parseFile(join(CORPUS, "luvit", "init.lua"), CORPUS)

  // A corpus rich enough to reach every field: kong + luvit + the grammar's own
  // test files, which are adversarial by construction.
  const files: string[] = []
  for (const repo of ["kong", "luvit", "tree-sitter-lua"]) {
    const root = join(CORPUS, repo)
    let list = ""
    try { list = execFileSync("git", ["-C", root, "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 1 << 28 }) } catch { continue }
    for (const rel of list.trim().split("\n").filter(Boolean)) files.push(join(root, rel))
  }

  const results: any[] = []
  for (const [label, p] of BUILDS) {
    const lang: any = await mod.Language.load(p)
    const parser = new mod.Parser()
    parser.setLanguage(lang)
    const named = new Set<string>()
    const anon = new Set<string>()
    const fields = new Set<string>()
    const idOrder: number[] = []
    for (const f of files) {
      let src: string
      try { src = readFileSync(f, "utf8") } catch { continue }
      if (!src.trim()) continue
      const tree = parser.parse(src)
      const stack = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()
        if (n.isNamed) named.add(n.type); else anon.add(n.type)
        idOrder.push(n.id)
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c) continue
          const fn = typeof n.fieldNameForChild === "function" ? n.fieldNameForChild(i) : null
          if (fn) fields.add(fn)
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
      }
      try { tree.delete() } catch {}
    }
    const sha = (s: string) => createHash("sha256").update(s).digest("hex")
    const sorted = (s: Set<string>) => [...s].sort()
    // A per-file TREE digest (type+field sequence), which IS a property of the
    // build. The node-id order collected above is NOT: measured, three parses of
    // ONE build over one file produced three different id digests, because
    // web-tree-sitter allocates ids from a bump allocator that does not reset
    // between trees. The first version of this probe reported an
    // `idOrderDigest DIFFERS` between two builds that build identical trees,
    // and that difference was pure allocation noise. The digest is kept in the
    // artifact under a name that says it is not evidence.
    const structByFile: Record<string, string> = {}
    {
      const sp = new mod.Parser()
      sp.setLanguage(lang)
      for (const f of files) {
        let src: string
        try { src = readFileSync(f, "utf8") } catch { continue }
        if (!src.trim()) continue
        const tr = sp.parse(src)
        const parts: string[] = []
        const st = [tr.rootNode]
        while (st.length) {
          const n = st.pop()
          parts.push(n.type + (n.isNamed ? "" : "(anon)"))
          for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) st.push(c) }
        }
        structByFile[f] = createHash("sha256").update(parts.join("|")).digest("hex")
        try { tr.delete() } catch {}
      }
    }
    results.push({
      label,
      corpusFiles: files.length,
      abiVersion: lang.abiVersion ?? null,
      declaredFieldCount: lang.fieldCount ?? null,
      idOrderDigest_NOT_EVIDENCE: sha(idOrder.join(",")),
      idOrderLength: idOrder.length,
      treeDigestPerFile: structByFile,
      typeSetDigest: sha(sorted(named).join("\n")),
      namedTypeCount: named.size,
      fieldSetDigest: sha(sorted(fields).join("\n")),
      observedFieldCount: fields.size,
      anonymousVocabularyDigest: sha(sorted(anon).join("\n")),
      anonymousCount: anon.size,
      namedTypes: sorted(named),
      fields: sorted(fields),
    })
  }

  mkdirSync(join(OUT, ".."), { recursive: true })
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n")

  const [wired, npmBuild, old] = results
  console.log(`corpus: ${wired.corpusFiles} files\n`)
  console.log("=== surface comparison ===")
  for (const r of results) {
    console.log(`  ${r.label.padEnd(18)} abi=${r.abiVersion} namedTypes=${r.namedTypeCount} fields=${r.observedFieldCount} (declared ${r.declaredFieldCount}) anon=${r.anonymousCount} nodeIds=${r.idOrderLength}`)
  }
  console.log()
  console.log("=== wired vs npm-0.4.1 ===")
  for (const k of ["typeSetDigest", "fieldSetDigest", "anonymousVocabularyDigest"]) {
    console.log(`  ${k.padEnd(28)} ${wired[k] === npmBuild[k] ? "IDENTICAL" : "DIFFERS"}`)
  }
  {
    const keys = Object.keys(wired.treeDigestPerFile)
    const diff = keys.filter((k) => wired.treeDigestPerFile[k] !== npmBuild.treeDigestPerFile[k])
    console.log(`  per-file TREE digest over ${keys.length} files: ${diff.length === 0 ? "IDENTICAL on every file" : `DIFFERS on ${diff.length} files`}`)
    for (const d of diff.slice(0, 5)) console.log(`      ${d.replace("$HOME/fixtures/repositories/", "")}`)
  }
  console.log(`  idOrderDigest (NOT evidence — parse allocation noise): ${wired.idOrderDigest_NOT_EVIDENCE === npmBuild.idOrderDigest_NOT_EVIDENCE ? "same" : "differs, and that is expected"}`)
  const fOnly = npmBuild.fields.filter((f: string) => !wired.fields.includes(f))
  const fWired = wired.fields.filter((f: string) => !npmBuild.fields.includes(f))
  const tOnly = npmBuild.namedTypes.filter((t: string) => !wired.namedTypes.includes(t))
  const tWired = wired.namedTypes.filter((t: string) => !npmBuild.namedTypes.includes(t))
  console.log(`  fields only in npm-0.4.1: ${fOnly.join(", ") || "none"}`)
  console.log(`  fields only in wired:     ${fWired.join(", ") || "none"}`)
  console.log(`  types only in npm-0.4.1:  ${tOnly.join(", ") || "none"}`)
  console.log(`  types only in wired:      ${tWired.join(", ") || "none"}`)
  console.log()
  console.log("=== wired vs tswasms-0.1.13 (the falsification target) ===")
  for (const k of ["typeSetDigest", "fieldSetDigest"]) {
    console.log(`  ${k.padEnd(28)} ${wired[k] === old[k] ? "IDENTICAL" : "DIFFERS"}`)
  }
  {
    const keys = Object.keys(wired.treeDigestPerFile)
    const diff = keys.filter((k) => wired.treeDigestPerFile[k] !== old.treeDigestPerFile[k])
    console.log(`  per-file TREE digest: ${diff.length === 0 ? "IDENTICAL" : `DIFFERS on ${diff.length} of ${keys.length} files`}`)
  }
  console.log(`  fields only in tswasms: ${old.fields.filter((f: string) => !wired.fields.includes(f)).join(", ") || "none"}`)
  console.log(`  fields only in wired:   ${wired.fields.filter((f: string) => !old.fields.includes(f)).join(", ") || "none"}`)
  console.log(`\nwrote ${OUT}`)
}
main()
