/**
 * RECEIVER-COORDINATE PROBE — is the receiver's TYPE the disambiguating
 * coordinate for `uses`/`calls`, and how many EDGES would it move?
 *
 * ## Why this file exists
 *
 * `ambiguity-split.ts` classified 7,108 of this lane's 7,586 ambiguous `uses`
 * edges as B2 (`scope-not-modelled`) and 4 as B1 (`spelling-available`), and
 * measured B1 by testing exactly ONE coordinate: `source + "." + target`.
 *
 * That coordinate is right for `contains` (pass 26 fixed 3,261 edges with it,
 * because the source IS the owner) and wrong for a field read. For `p.x` the
 * enclosing function says nothing about which `x` is meant; the TYPE OF `p`
 * does. So "B1 is empty for `uses`" is a statement about the probe, not about
 * the edges — and this file is the probe that asks the other question.
 *
 * ## The question, in a form that can fail
 *
 * For each field access `recv.member` where `recv` binds to a single-path
 * declared type `T` in the same file, and `T.member` is a PUBLISHED qualified
 * name of that file: does spelling the target `T.member` move the edge out of
 * the ambiguous bucket?
 *
 * It can, and it can backfire — a qualified target that binds NOWHERE is
 * unresolved rather than ambiguous, and the gate counts both. So the file
 * reports the full partition, not just the wins:
 *
 *   wins         bare member ambiguous, `T.member` binds to exactly 1 decl
 *   breaks       bare member ambiguous, `T.member` binds to 0 decls
 *   nochange     `T.member` is as ambiguous as the bare member, or the
 *                receiver's type is not single-path
 *
 * ## Independence
 *
 * The tree walk is this file's own recursion. It never calls the analyzer's
 * edge builder, so it cannot inherit the analyzer's notion of a target. The
 * published names come from production `parseFile`, because "what is
 * published" is a store question this lane must answer from the store.
 *
 * ## The two denominators, both reported
 *
 * `rawOccurrences` counts the field accesses as written. `edgesAsPublished`
 * counts them under the analyzer's OWN dedup key, `${source}->${target}`, so
 * the edge figure is comparable with the gate's. Raw syntax and published
 * edges are not the same population and a rate quoted over the wrong one is a
 * finding about the wrong thing.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/receiver-coordinate-probe.mts [maxFiles]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/zig"
const MAX = Number(process.argv[2] ?? 200)
const REPOS = (process.env.ZIG_REPOS ?? "zig,ghostty,mold,eastwood,duckdb,oven").split(",")

await Parser.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const language: any = await Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-zig.wasm`))
const parser = new Parser()
parser.setLanguage(language)

function draw(n: number): string[] {
  const all: string[] = []
  for (const repo of REPOS) {
    const stack = [`${CR}/${repo}`]
    while (stack.length) {
      const d = stack.pop()!
      let ents: string[]
      try { ents = readdirSync(d) } catch { continue }
      for (const e of ents) {
        const p = `${d}/${e}`
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { if (e !== ".git") stack.push(p) }
        else if (e.endsWith(".zig")) all.push(p.slice(CR.length + 1))
      }
    }
  }
  all.sort()
  const stride = Math.max(1, Math.floor(all.length / n))
  const out: string[] = []
  for (let i = 0; out.length < n && i < all.length; i += stride) out.push(all[i])
  return out
}

const rel = draw(MAX).map((f) => `${CR}/${f}`)

// --- global publication index, built from PRODUCTION parseFile over the draw ---
const pubName = new Map<string, string[]>() // bare name -> [file]
const pubQn = new Map<string, string[]>() // qualifiedName -> [file]
let symbols = 0
for (const f of rel) {
  const r: any = await parseFile(f, "zig")
  for (const s of (r?.symbols ?? [])) {
    symbols++
    if (s.name) (pubName.get(s.name) ?? pubName.set(s.name, []).get(s.name)!).push(f)
    if (s.qualifiedName) (pubQn.get(s.qualifiedName) ?? pubQn.set(s.qualifiedName, []).get(s.qualifiedName)!).push(f)
  }
}
const resolvesTo = (t: string): number => (pubName.get(t)?.length ?? 0) + (pubQn.get(t)?.length ?? 0)

let rawOccurrences = 0, withType = 0, typeNotSinglePath = 0
const keyBare = new Set<string>() // `${source}->${member}` — the analyzer's own key
const keyQual = new Set<string>() // `${source}->${T.member}`
let wins = 0, breaks = 0, sameAmbiguity = 0, winsList: any[] = [], breaksList: any[] = []

for (const f of rel) {
  const tree = parser.parse(readFileSync(f, "utf8"))
  if (!tree) continue
  const r: any = await parseFile(f, "zig")
  const fileQns = new Set<string>()
  for (const s of (r?.symbols ?? [])) if (s.qualifiedName) fileQns.add(s.qualifiedName)

  const bind = new Map<string, string | null>() // receiver -> single-path type, or null = present but not a path
  const fnStack: string[] = []
  const visit = (n: any, fn: string) => {
    let here = fn
    if (n.type === "function_declaration" || n.type === "function_signature" || n.type === "function_declaration_proto") {
      const id = n.childForFieldName?.("name") ?? n.namedChild?.(0)
      if (id && id.type === "identifier") here = String(id.text)
    }
    if (n.type === "variable_declaration" || n.type === "container_field" || n.type === "parameter") {
      const id = n.namedChild(0), ty = n.namedChild(1)
      if (id && ty && id.type === "identifier") {
        if (ty.type === "identifier") bind.set(String(id.text), String(ty.text))
        else if (ty.type === "field_expression") {
          const segs: string[] = []
          let cur = ty, ok = true, h = 0
          while (cur && h++ < 32) {
            const last = cur.namedChild(cur.namedChildCount - 1)
            if (!last || last.type !== "identifier") { ok = false; break }
            segs.push(String(last.text))
            const b = cur.namedChild(0)
            if (!b) { ok = false; break }
            if (b.type === "identifier") { segs.push(String(b.text)); break }
            if (b.type !== "field_expression") { ok = false; break }
            cur = b
          }
          bind.set(String(id.text), ok ? segs.reverse().join(".") : null)
        }
      }
    }
    if (n.type === "field_expression" && n.namedChildCount >= 2) {
      const leaf = n.namedChild(n.namedChildCount - 1)
      const base = n.namedChild(0)
      if (leaf && leaf.type === "identifier" && base && base.type === "identifier") {
        const member = String(leaf.text)
        const recv = String(base.text)
        rawOccurrences++
        const src = here || "(global)"
        keyBare.add(`${src}->${member}`)
        const t = bind.get(recv)
        if (t === undefined) {
          // no declared type: the bare leaf is all the corpus says
        } else if (t === null) {
          typeNotSinglePath++
        } else {
          withType++
          const cand = `${t}.${member}`
          keyQual.add(`${src}->${cand}`)
          const bareN = resolvesTo(member)
          const candN = resolvesTo(cand)
          if (candN === 1 && bareN > 1) { wins++; if (winsList.length < 40) winsList.push({ cand, member, bareDecls: bareN, file: f.slice(CR.length + 1) }) }
          else if (candN === 0 && bareN > 1) { breaks++; if (breaksList.length < 40) breaksList.push({ cand, member, bareDecls: bareN, file: f.slice(CR.length + 1) }) }
          else sameAmbiguity++
        }
      }
    }
    for (let c = 0; c < n.childCount; c++) visit(n.child(c), here)
  }
  visit(tree.rootNode, "(global)")
}

const out = {
  tool: "zig-receiver-coordinate-probe",
  population: `${rel.length} stride-sampled .zig files of 3834 admitted, ${symbols} production symbols`,
  files: rel.length,
  rawOccurrences,
  receiverTypeSinglePath: withType,
  receiverTypePresentNotAPath: typeNotSinglePath,
  edgesAsPublished_bareKey: keyBare.size,
  edgesIfQualified_keyQual: keyQual.size,
  partition: {
    wins_bareAmbiguous_qualifiedBindsExactlyOne: wins,
    breaks_bareAmbiguous_qualifiedBindsNothing: breaks,
    noChange: sameAmbiguity,
  },
  winsList, breaksList,
}
writeFileSync("validation/m14/fixtures/zig/measurements/receiver-coordinate-probe.json", JSON.stringify(out, null, 2))
console.log(JSON.stringify({ ...out, winsList: winsList.slice(0, 10), breaksList: breaksList.slice(0, 6) }, null, 2))
