/**
 * script/m14/tmp/elixir-grammar-ab.ts
 *
 * The elixir lane's wired grammar is a 2024 prebuilt (`tree-sitter-wasms@0.1.13`
 * -> tree-sitter-elixir ^0.1.1), and the machine holds a newer upstream source +
 * wasm (`tree-sitter-elixir@0.3.5`). "Pin the best grammar" is a question about
 * measured parse behaviour, so this probe runs both grammars over every
 * git-tracked .ex/.exs file of the lane's two pinned corpora and records, per
 * file and per grammar:
 *
 *   - ERROR node count and MISSING token count (damage),
 *   - a named-node shape digest (structure + field names, positions/text excluded),
 *   - a leaf-token digest (every leaf's type+text, so "shape changed" can be told
 *     apart from "content lost").
 *
 * Writes validation/m14/results/archive/elixir-grammar-ab.json. Changes nothing.
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const HOME = process.env.HOME ?? ""
const REPOS = "/home/ishaq2321/bb_tests/repositories"
const OUT = path.join(ROOT, "validation/m14/results/archive/elixir-grammar-ab.json")

const GRAMMARS = [
  {
    label: "incumbent-2024-prebuilt",
    file: path.join(HOME, ".bun/install/cache/tree-sitter-wasms@0.1.13@@@1/out/tree-sitter-elixir.wasm"),
    provenance:
      "tree-sitter-wasms@0.1.13/out wasm — the build the repo's wasm/ carried until this round (byte-identical; the swap to 0.3.5 happened in this round, so the incumbent is pinned here by its own local copy)",
  },
  { label: "upstream-0.3.5", file: path.join(HOME, ".bun/install/cache/tree-sitter-elixir@0.3.5@@@1/tree-sitter-elixir.wasm"), provenance: "npm tree-sitter-elixir@0.3.5 tarball wasm (now wired at wasm/tree-sitter-elixir.wasm)" },
]
const CORPUS = [
  { repo: "elixir", role: "primary" },
  { repo: "phoenix", role: "second" },
]

const sha256Text = (s: string) => createHash("sha256").update(s).digest("hex")

/**
 * Ordered, position-free serialization: every node's type, the field name its
 * parent gave it, and the ordered children — leaf text included. Two trees
 * serialize equal iff they have the same nesting, the same types, the same
 * field assignments and the same tokens. (The first draft of this probe hashed
 * SORTED multisets, which would call two differently-nested trees "identical";
 * that is exactly the kind of vacuous agreement this repo's audits exist to
 * refuse, so the digest is order-sensitive here.)
 */
function serialize(node: any, field: string): string {
  if (node.childCount === 0) return `${node.type}\u0001${node.text}`
  let s = `(${node.type}${field ? `[${field}]` : ""}`
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c) continue
    s += " " + serialize(c, node.fieldNameForChild(i) ?? "")
  }
  return s + ")"
}

function shapeOf(root: any): { named: string; leaves: string; errors: number; missing: number } {
  const leaves: string[] = []
  let errors = 0
  let missing = 0
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "ERROR") errors++
    if (n.isMissing) missing++
    if (n.childCount === 0) leaves.push(`${n.type}\u0001${n.text}`)
    else for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return {
    named: sha256Text(serialize(root, "")),
    leaves: sha256Text(leaves.sort().join("\n")),
    errors,
    missing,
  }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

  const langs: Record<string, any> = {}
  for (const g of GRAMMARS) {
    const buf = fs.readFileSync(g.file)
    langs[g.label] = { grammar: await Language.load(buf), sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length }
  }

  const rows: any[] = []
  const perGrammar: Record<string, any> = {}
  for (const g of GRAMMARS) perGrammar[g.label] = { files: 0, damagedFiles: 0, errorNodes: 0, missingTokens: 0, parseFailures: 0 }

  for (const c of CORPUS) {
    const dir = path.join(REPOS, c.repo)
    const head = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim()
    const files = execSync("git ls-files '*.ex' '*.exs'", { cwd: dir }).toString().trim().split("\n").filter(Boolean)
    console.log(`${c.repo}@${head.slice(0, 8)}: ${files.length} tracked .ex/.exs`)
    for (const rel of files) {
      let src: string
      try {
        src = fs.readFileSync(path.join(dir, rel), "utf8")
      } catch {
        continue
      }
      const row: any = { repo: c.repo, file: rel }
      for (const g of GRAMMARS) {
        const parser = new ParserClass()
        parser.setLanguage(langs[g.label].grammar)
        let shaped: any
        try {
          const tree = parser.parse(src)
          shaped = shapeOf(tree.rootNode)
          tree.delete?.()
        } catch (e: any) {
          perGrammar[g.label].parseFailures++
          row[g.label] = { crash: String(e?.message ?? e) }
          continue
        }
        parser.delete?.()
        row[g.label] = shaped
        const st = perGrammar[g.label]
        st.files++
        st.errorNodes += shaped.errors
        st.missingTokens += shaped.missing
        if (shaped.errors > 0 || shaped.missing > 0) st.damagedFiles++
      }
      rows.push(row)
    }
  }

  const adjudication: any = { files: rows.length, bothParsed: 0, agree: 0, shapeChanged: 0, leavesChanged: 0, newDamage: [], repaired: [], stillDamaged: [], crashed: [] }
  // NOTE ON THE COMPARISON DIRECTION: "candidate" below is GRAMMARS[1] (upstream
  // 0.3.5) and "incumbent" is GRAMMARS[0] (the prebuilt the round replaced).
  for (const r of rows) {
    const a = r[GRAMMARS[0].label]
    const b = r[GRAMMARS[1].label]
    if (!a || !b || a.crash || b.crash) {
      adjudication.crashed.push({ repo: r.repo, file: r.file, wired: a?.crash, candidate: b?.crash })
      continue
    }
    adjudication.bothParsed++
    const damaged = (s: any) => s.errors > 0 || s.missing > 0
    if (!damaged(a) && damaged(b)) adjudication.newDamage.push({ repo: r.repo, file: r.file, candidate: b })
    if (damaged(a) && !damaged(b)) adjudication.repaired.push({ repo: r.repo, file: r.file, wired: a })
    if (damaged(a) && damaged(b)) adjudication.stillDamaged.push({ repo: r.repo, file: r.file, wired: a, candidate: b })
    if (a.named !== b.named) adjudication.shapeChanged++
    else adjudication.agree++
    if (a.leaves !== b.leaves) adjudication.leavesChanged++
  }

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    question: "is the elixir lane's former wired grammar (the 2024 tree-sitter-wasms prebuilt) or upstream 0.3.5 the better grammar for this lane's corpora?",
    method: {
      corpora: CORPUS,
      files: "git ls-files '*.ex' '*.exs' per repo",
      damage: "ERROR nodes and MISSING tokens counted over all children (not named children only)",
      shapeDigest: "sha256 over the multiset of `type[field]` labels of named nodes — structure and field names, text and positions excluded",
      leafDigest: "sha256 over the multiset of leaf `type\\u0001text` — distinguishes re-shaping from content loss",
    },
    grammars: GRAMMARS.map((g) => ({ label: g.label, file: path.relative(ROOT, g.file), provenance: g.provenance, sha256: langs[g.label].sha256, bytes: langs[g.label].bytes })),
    perGrammar,
    adjudication,
    rows,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

  console.log("\nper grammar:")
  for (const g of GRAMMARS) {
    const s = perGrammar[g.label]
    console.log(`  ${g.label.padEnd(16)} files=${s.files} damaged=${s.damagedFiles} ERROR=${s.errorNodes} MISSING=${s.missingTokens} crashes=${s.parseFailures}`)
  }
  console.log("\nadjudication:")
  console.log(`  both parsed: ${adjudication.bothParsed}, shapes identical: ${adjudication.agree}, shape-changed: ${adjudication.shapeChanged}, leaf-multiset changed: ${adjudication.leavesChanged}`)
  console.log(`  new damage under candidate: ${adjudication.newDamage.length}, repaired: ${adjudication.repaired.length}, damaged under both: ${adjudication.stillDamaged.length}, crashed: ${adjudication.crashed.length}`)
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
