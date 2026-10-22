/**
 * CLOJURE LANE — THE REMEDY CENSUS ✓✓.
 *
 * ## WHY THIS EXISTS
 *
 * **THE OWNER's RULE: THE GRAMMARS CAN BE CLONED, FIXED, WORKED ON AND TESTED, SO WE ACHIEVE ALL
 * THE RELATIONSHIP TYPES; A LANE OWNS THE GRAMMAR FOR ITS LANGUAGE THE WAY IT OWNS THE ANALYZER;
 * WHERE A TYPE IS NOT ACHIEVABLE AS THINGS STAND, GET THE GRAMMAR, FIX IT, AND GET ALL-OUT-OF-ALL
 * INSTEAD OF RULING** ⇒ ⇒ `grammar-absence` IS NO LONGER A TERMINAL CLASS: IT IS A REMEDY
 * DISPOSITION, AND THE LADDER IS:
 *
 *   R1  bump the npm grammar package to a build whose inventory HAS the construct
 *   R2  clone + PATCH the grammar source, `tree-sitter generate`, `tree-sitter build --wasm`
 *   R3  implement the construct with an EXISTING node type (no grammar change at all)
 *
 * **⇒ A RULING MUST NAME WHICH RUNG WAS UNAVAILABLE AND WHY, AND A RUNG THAT IS MERELY HARD IS NOT
 * A REASON ✓✓.** And the verification is a MEASUREMENT: the new build against the old one over the
 * ADMITTED POPULATION, and a behavioural fixture.
 *
 * **⇒ THIS INSTRUMENT IS THE POPULATION LEG ✓✓**: it counts, over the WHOLE admitted population,
 * the forms each of the four ruled types would need — with the PRODUCTION parser and the grammar
 * the analyzer actually uses ⇒ ⇒ a construct that EXISTS in the corpus is measurable, and a
 * construct that does NOT exist is not ruled by argument but by COUNT ✓✓.
 *
 * ## WHAT IT COUNTS
 *
 *   mixes_in   — the MIXIN forms: a `defmixin` head (a form whose head symbol is `defmixin`), and
 *                the `defprotocol`/`extend-type`/`extend-protocol`/`reify` forms around it;
 *   decorates  — the METADATA carriers: a `meta_lit`/`old_meta_lit` node, and the form it is
 *                attached to (the metadata DECORATES that form);
 *   renders    — the RENDERING forms: a tagged literal (`tagged_or_ctor_lit`), and a keyword-led
 *                vector (the hiccup shape) — counted SEPARATELY, because they are different shapes;
 *   part_of    — the PART-WHOLE forms: the `ns` form and its `:require`/`:use`/`:import` clauses,
 *                and `deftype`/`defrecord` (a type's members are `contains`, not `part_of`).
 *
 * ## NO REGEX OVER SOURCE TEXT
 *
 * Every reading is a NODE (its type, its head symbol, its children) ⇒ ⇒ the counts are the
 * grammar's own shapes, not text patterns ✓✓.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-remedy-census.ts \
 *     --out validation/m14/measurements/clojure-remedy-census.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { getParser } from "../../src/ast/engine"

const argv = process.argv.slice(2)
const argOf = (n: string, d: string): string => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : d }
const ROOT = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const OUT = argOf("--out", "validation/m14/measurements/clojure-remedy-census.json")
const CR = path.resolve(ROOT)

/** THE ADMITTED POPULATION — THE GATE's OWN RULE ✓✓ (a real git checkout + `git ls-files` + the
 *  lane's extension list + the 1 MB cap), so the census and the arm see the same files ✓✓. */
const EXTS = ["clj", "cljs", "cljc", "edn"]
const SIZE_CAP = 1024 * 1024
function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch { return [] }
}
const files: string[] = []
const repos = new Map<string, number>()
for (const repo of readdirSync(CR).sort()) {
  const repoDir = path.join(CR, repo)
  let st: any
  try { st = statSync(repoDir) } catch { continue }
  if (!st.isDirectory()) continue
  let n = 0
  for (const rel of gitTracked(repoDir)) {
    const ext = rel.split(".").pop()?.toLowerCase() ?? ""
    if (!EXTS.includes(ext)) continue
    const abs = path.join(repoDir, rel)
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    if (size > SIZE_CAP) continue
    files.push(abs)
    n++
  }
  if (n > 0) repos.set(repo, n)
}
files.sort()

/** THE PRODUCTION's OWN PARSER ✓✓ — the grammar the analyzer itself uses. */
const parser = await getParser("clojure" as any)

type Hit = { file: string; line: number; form: string }
const counts: Record<string, number> = {}
const hits: Record<string, Hit[]> = {}
const bump = (k: string, h: Hit) => { counts[k] = (counts[k] ?? 0) + 1; const l = hits[k] ?? (hits[k] = []); if (l.length < 25) l.push(h) }

/** THE HEAD SYMBOL of a form — the execution head's TEXT, read from the node ✓✓ (the grammar's own
 *  shape, not a text pattern over the file). */
function headText(node: any): string {
  // THE HEAD OF A FORM — the first NAMED child (the `(` is anonymous) ✓✓ — and it must be a
  // symbol node (`sym_lit` in the wired grammar) for the form to be a call ✓✓.
  const head = node?.namedChild?.(0)
  if (!head) return ""
  if (head.type !== "sym_lit") return ""
  return String(head.text ?? "").replace(/^'/, "")
}
const lineOf = (n: any): number => Number(n?.startPosition?.row ?? 0) + 1

for (const f of files) {
  let content = ""
  try { content = readFileSync(f, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(content) } catch { continue }
  if (!tree) continue
  const rel = path.relative(CR, f)
  const walk = (n: any, prev: any) => {
    const t = n?.type
    // ── THE MIXIN FORMS ──────────────────────────────────────────────────────
    if (t === "list_lit") {
      const head = headText(n)
      if (head === "defmixin") bump("mixes_in.defmixin", { file: rel, line: lineOf(n), form: content.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 160)).split("\n")[0]! })
      if (head === "defprotocol") bump("mixes_in.defprotocol", { file: rel, line: lineOf(n), form: head })
      if (head === "extend-type" || head === "extend-protocol") bump("mixes_in.extend", { file: rel, line: lineOf(n), form: head })
      if (head === "reify") bump("mixes_in.reify", { file: rel, line: lineOf(n), form: head })
      if (head === "defrecord" || head === "deftype") bump("implements.defrecord_or_deftype", { file: rel, line: lineOf(n), form: head })
    }
    // ── THE METADATA CARRIERS — the `decorates` CANDIDATE ────────────────────
    if (t === "meta_lit" || t === "old_meta_lit") {
      bump("decorates.metadata_carrier", { file: rel, line: lineOf(n), form: content.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 120)).split("\n")[0]! })
      // THE FORM THE METADATA IS ATTACHED TO — the next named sibling ✓✓.
      const p = n?.parent
      if (p) {
        const kids: any[] = []
        for (let i = 0; i < p.namedChildCount; i++) { const c = p.namedChild(i); if (c) kids.push(c) }
        const idx = kids.findIndex((c) => c.id === n.id)
        if (idx >= 0 && kids[idx + 1]) {
          bump("decorates.metadata_attached_to_a_form", { file: rel, line: lineOf(n), form: kids[idx + 1]!.type })
        }
      }
    }
    // ── THE RENDERING FORMS ──────────────────────────────────────────────────
    if (t === "tagged_or_ctor_lit") bump("renders.tagged_literal", { file: rel, line: lineOf(n), form: content.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 120)).split("\n")[0]! })
    if (t === "vec_lit") {
      const first = n?.namedChild?.(0)
      if (first && first.type === "kwd_lit") bump("renders.keyword_led_vector", { file: rel, line: lineOf(n), form: content.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 120)).split("\n")[0]! })
    }
    // ── THE PART-WHOLE FORMS ─────────────────────────────────────────────────
    if (t === "list_lit") {
      const head = headText(n)
      if (head === "ns") bump("part_of.ns_form", { file: rel, line: lineOf(n), form: head })
    }
    for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
      const c = n.namedChild(i)
      if (c) walk(c, n)
    }
  }
  walk(tree.rootNode, null)
}

const report = {
  instrument: "script/m14/clojure-remedy-census.ts",
  question: "the FOUR RULED TYPES, counted over the WHOLE admitted population — is the construct there, so that a remedy can be IMPLEMENTED and MEASURED?",
  population: { files: files.length, repos: Object.fromEntries([...repos].sort()), root: CR, rule: "the GATE's own rule: a real git checkout + `git ls-files` + the lane's extension list {clj,cljs,cljc,edn} + the 1 MB cap" },
  grammar: { package: "tree-sitter-clojure", wiredWasm: "wasm/tree-sitter-clojure.wasm", wiredSha256: createHash("sha256").update(readFileSync("wasm/tree-sitter-clojure.wasm")).digest("hex") },
  counts,
  hits,
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`THE REMEDY CENSUS — ${files.length} admitted file(s) ✓✓`)
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`JSON: ${OUT}`)
