// Dart `uses` bare-read truth divergence — the bucket classifier for the one named residual.
//
// WHAT THIS IS: the differential's dart draws show MISSING + UNEXPLAINED rows concentrated in the
// `uses` label (60-file draw: proxicall MISSING 500 / unexplained 1,331 · dart-http MISSING 321 /
// unexplained 428). This instrument re-runs the SAME comparison over the SAME drawn files, using the
// differential's OWN exported truth functions (`deriveDartEdges`, `deriveDartBareUses`, `normTarget`)
// and the SAME analyzer invocation (with a project index built the same way), then puts every
// divergent row in a NAMED bucket:
//
//   B1 binding-spelling normTarget miss  — the analyzer's local-read convention publishes
//        `<callable>\u0000<binding>`; `normTarget` splits on `::`/`.` only, so that target can never
//        equal the truth's bare `<binding>`. One local read therefore costs BOTH a MISSING (truth row)
//        and an UNEXPLAINED (analyzer row).
//   B2 declaration-position truth over-derivation — truth row whose site the analyzer's stronger
//        declaration/write gates suppress (truth mirror is weaker: it has no `declName`-equivalent
//        for every grammar shape).
//   B3 truth over-broad by design — truth counts a read at a position that is not a read of the
//        named value (a declared name, a write, a label, a field-initializer target).
//   B4 genuine analyzer miss — a real read position where the analyzer emitted no row at all (and no
//        binding row for the same name, so B1 does not explain it).
//   B5 analyzer extra / truth under-derives — the mirror of B2–B4 on the analyzer side: a `uses` row
//        the truth does not derive (named by its target shape).
//
// The position-attributed walker (`locateReads`) is a MIRROR of `deriveDartBareUses`'s identifier arm
// with positions kept; CONTROL: its row identity set must equal `deriveDartBareUses`'s set, else the
// mirror is wrong and the run fails (exit 3) rather than publishing mis-bucketed counts.
//
// Lane-owned instrument; reads the differential module but never edits it. Scope: the exact files
// named in a `BB_F5_SHOW_FILES=1` scoped differential log (pass `--log=`), so the buckets describe the
// SAME measurement whose hashes were pinned.
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"
import { BINDING_SEP } from "../../src/ast/types"
import { normTarget, deriveDartEdges, deriveDartBareUses } from "./differential"
import { buildProjectIndexStreaming, buildResolutionTables, DART_DECLARATION_SPEC } from "../../src/ast/project-index"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const WORK = path.join(ROOT, ".tmp-dartwork")
const arg = (name: string, fallback?: string): string | undefined => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : fallback
}
const LOG = arg("log")
const REPO_FILTER = arg("repo")
if (!LOG) {
  console.error("usage: bun run script/m14/dart-uses-divergence.ts --log=<BB_F5_SHOW_FILES differential log> [--repo=proxicall]")
  process.exit(2)
}
// The same clones the draws measured (workspace-local, clean at the pins).
const CORPUS = path.join(WORK, "corpus")
const logText = readFileSync(LOG, "utf8")
// The log prints one block per lane: "  [cold-pool] <repo>:dart: N/M fresh (rot …)" then "[file] <rel>".
const lanes: { repo: string; files: string[] }[] = []
{
  let cur: { repo: string; files: string[] } | null = null
  for (const line of logText.split("\n")) {
    const cp = /\[cold-pool\] ([\w.-]+):dart:/.exec(line)
    if (cp) { cur = { repo: cp[1], files: [] }; lanes.push(cur); continue }
    const fm = /^\s+\[file\] (.+)$/.exec(line)
    if (fm && cur) cur.files.push(fm[1].trim())
  }
}
const chosen = lanes.filter((l) => (REPO_FILTER ? l.repo === REPO_FILTER : true))
if (chosen.length === 0 || chosen.some((l) => l.files.length === 0)) {
  console.error("classifier: log carries no per-lane [file] lists; rerun the draw with BB_F5_SHOW_FILES=1")
  process.exit(2)
}

// ---- truth mirror with POSITIONS (only for the row-set control and the B2/B3 buckets) -----------
const DECL_PARENTS = new Set([
  "formal_parameter", "constructor_param", "function_signature", "method_signature",
  "getter_signature", "setter_signature", "type_alias", "label", "initialized_identifier",
  "static_final_declaration", "class_definition", "enum_declaration", "mixin_declaration",
  "extension_declaration", "extension_type_declaration", "representation_declaration", "enum_constant",
])
const LINK_PARENTS = new Set(["unconditional_assignable_selector", "conditional_assignable_selector", "cascade_selector", "selector"])
function locateReads(root: any, symbols: any[]): { target: string; line: number; parentType: string }[] {
  const out: { target: string; line: number; parentType: string }[] = []
  const membersByOwner = new Map<string, Set<string>>()
  for (const s of symbols ?? []) {
    if (!s || typeof s.name !== "string" || !s.ownerName) continue
    let set = membersByOwner.get(s.ownerName)
    if (!set) { set = new Set(); membersByOwner.set(s.ownerName, set) }
    set.add(s.name)
  }
  const topLevelValues = new Set<string>()
  for (const s of symbols ?? []) {
    if (!s || typeof s.name !== "string" || s.ownerName) continue
    if (["variable", "constant", "function", "property"].includes(s.kind)) topLevelValues.add(s.name)
  }
  const hasType = (node: any, type: string): boolean => {
    const st: any[] = [node]
    while (st.length) { const x = st.pop()!; if (x.type === type) return true; for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) st.push(c) } }
    return false
  }
  const firstIdentifier = (node: any): any => {
    const st: any[] = [node]
    while (st.length) { const x = st.pop()!; if (x.type === "identifier") return x; for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) st.push(c) } }
    return null
  }
  const declaredName = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    const pt = p.type
    if (pt !== "initialized_variable_definition" && pt !== "static_final_declaration") return false
    let eqIdx = -1, myIdx = -1
    for (let i = 0; i < p.childCount; i++) {
      const c = p.child(i)
      if (!c) continue
      if (!c.isNamed && c.text === "=" && eqIdx === -1) eqIdx = i
      if (c.isNamed && c.startIndex === n.startIndex && c.endIndex === n.endIndex) myIdx = i
    }
    if (myIdx === -1) return false
    if (eqIdx === -1) return true
    return myIdx < eqIdx
  }
  const isWrite = (n: any): boolean => {
    let p: any = n.parent, guard = 0
    while (p && guard++ < 16) {
      if (p.type === "assignment_expression") {
        let opText: string | null = null
        for (let i = 0; i < p.childCount; i++) { const c = p.child(i); if (c && !c.isNamed && c.text.includes("=")) { opText = c.text; break } }
        if (opText !== "=") return false
        const lhs = p.namedChild(0)
        return !!lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex
      }
      if (["function_body", "block", "class_body", "program", "declaration"].includes(p.type)) return false
      p = p.parent
    }
    return false
  }
  const collectLocals = (node: any, out: Set<string>): void => {
    const w: any[] = [node]
    while (w.length) {
      const m = w.pop()!
      if (m.type === "identifier" && declaredName(m)) out.add(m.text)
      if (["formal_parameter", "constructor_param", "simple_formal_parameter", "super_formal_parameter", "catch_clause_parameter", "catch_parameters"].includes(m.type)) {
        const id = m.namedChildren.find((c: any) => c.type === "identifier")
        if (id) out.add(id.text)
      }
      if (m.type === "for_loop_parts") {
        for (let k = 0; k < m.childCount; k++) {
          const c = m.child(k)
          if (c && !c.isNamed && c.text === "in") {
            for (let j = 0; j < k; j++) { const pc = m.child(j); if (pc && pc.isNamed && pc.type === "identifier") out.add(pc.text) }
            break
          }
        }
      }
      if (m.type === "variable_pattern") { const id = firstIdentifier(m); if (id) out.add(id.text) }
      if (m.type === "constant_pattern") {
        // Structural descent only (record/list/map to a destructuring declaration or for-in head);
        // case TESTS never bind. Mirrors deriveDartBareUses's collectLocals branch exactly.
        let p: any = m.parent
        let g = 0
        let binding = false
        while (p && g++ < 8) {
          const t = p.type
          if (t === "pattern_variable_declaration" || t === "for_loop_parts") { binding = true; break }
          if (t !== "record_pattern" && t !== "list_pattern" && t !== "map_pattern" && t !== "constant_pattern" && t !== "variable_pattern") break
          p = p.parent
        }
        if (binding) { const id = firstIdentifier(m); if (id) out.add(id.text) }
      }
      for (let i = m.namedChildCount - 1; i >= 0; i--) { const c = m.namedChild(i); if (c) w.push(c) }
    }
  }
  const enclosingClass = (n: any): string | null => {
    let p: any = n.parent, guard = 0
    while (p && guard++ < 64) {
      if (["class_definition", "enum_declaration", "extension_type_declaration"].includes(p.type)) return p.childForFieldName?.("name")?.text ?? null
      if (p.type === "extension_declaration" || p.type === "mixin_declaration") { const id = firstIdentifier(p); return id ? id.text : null }
      p = p.parent
    }
    return null
  }
  const walk = (n: any, locals: Set<string>): void => {
    const t = n.type
    let childLocals = locals
    if (t === "function_body" || t === "function_expression_body" || t === "block") {
      const bound = new Set<string>()
      collectLocals(n, bound)
      const sig = n.previousNamedSibling
      if (sig) collectLocals(sig, bound)
      if (bound.size > 0) { childLocals = new Set(locals); for (const nm of bound) childLocals.add(nm) }
    }
    // DT2 mirror (constructor initializer lists read the constructor's parameters; the body's
    // previousNamedSibling is `initializers`, not the signature, so the body branch cannot bind them).
    if (t === "initializers") {
      const par = n.parent
      if (par) {
        for (let k = 0; k < par.namedChildCount; k++) {
          const sib = par.namedChild(k)
          if (sib && (sib.type === "constructor_signature" || sib.type === "method_signature" || sib.type === "function_signature")) {
            const bound = new Set<string>()
            collectLocals(sib, bound)
            if (bound.size > 0) { childLocals = new Set(locals); for (const nm of bound) childLocals.add(nm) }
            break
          }
        }
      }
    }
    if (t === "identifier") {
      const txt = n.text
      const pt = n.parent ? n.parent.type : ""
      const nx = n.nextNamedSibling
      const nextIsCall = !!nx && nx.type === "selector" && hasType(nx, "argument_part")
      const owner = enclosingClass(n)
      const isMember = !!owner && (membersByOwner.get(owner)?.has(txt) ?? false)
      const isLabelish = pt === "labeled_statement" || pt === "break_statement" || pt === "continue_statement"
      let isFieldTarget = false
      if (pt === "field_initializer" && n.parent) {
        const first = n.parent.namedChild(0)
        isFieldTarget = !!first && first.startIndex === n.startIndex && first.endIndex === n.endIndex
      }
      if (txt !== "this" && txt !== "super" && !LINK_PARENTS.has(pt) && !DECL_PARENTS.has(pt) && !declaredName(n) && !nextIsCall && !isWrite(n) && !isLabelish && !isFieldTarget) {
        if (locals.has(txt) || (!locals.has(txt) && isMember) || (!isMember && topLevelValues.has(txt))) {
          out.push({ target: txt, line: n.startPosition.row + 1, parentType: pt })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, childLocals) }
  }
  walk(root, new Set())
  return out
}

type Div = {
  dir: "MISSING" | "UNEXPLAINED"
  file: string
  from: string
  target: string
  line?: number
  bucket: string
  detail: string
}

const allDiverge: Div[] = []
const totals = { truthUses: 0, analyzerUses: 0, covered: 0, missing: 0, unexplained: 0 }

const parser = await getParser("dart")
for (const lane of chosen) {
  const repoRoot = path.join(CORPUS, lane.repo)
  const allFiles = execFileSync("git", ["-C", repoRoot, "ls-files", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\n").filter(Boolean).map((f) => path.join(repoRoot, f))
  const wasm = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")
  console.log(`[${lane.repo}] building project index over ${allFiles.length} files (same builder the differential uses)`)
  const projectIndex = await buildProjectIndexStreaming(wasm, allFiles, DART_DECLARATION_SPEC)
  buildResolutionTables(projectIndex)
  const analyzer = new RealDartAnalyzer()
  let controlBad = 0
  for (const rel of lane.files) {
    const abs = path.join(repoRoot, rel)
    let content = ""
    try { content = readFileSync(abs, "utf8") } catch { continue }
    const tree = parser.parse(content)
    const root = tree?.rootNode
    if (!root) continue
    const result: any = await analyzer.analyze(root, content, rel, { projectIndex })
    const bareTruth: any[] = deriveDartBareUses(root, result?.symbols ?? [])
    const truthUses: any[] = [...deriveDartEdges(root), ...bareTruth]
      .filter((e: any) => e.label === "uses")
    const analyzerUses: any[] = (result?.relationships ?? []).filter((r: any) => r.type === "uses")
    // CONTROL: position-attributed mirror must reproduce the exported truth's row identity set.
    const mirror = locateReads(root, result?.symbols ?? [])
    // CONTROL is against the BARE oracle only: the mirror re-implements deriveDartBareUses, while
    // deriveDartEdges' uses rows (qualified member reads) are a different derivation the mirror
    // deliberately does not cover.
    const bareSet = new Set(bareTruth.map((e: any) => normTarget(String(e.target))))
    const mirrorSet = new Set(mirror.map((e) => normTarget(e.target)))
    if (bareSet.size !== mirrorSet.size || [...bareSet].some((x) => !mirrorSet.has(x))) {
      controlBad++
      const onlyTruth = [...bareSet].filter((x) => !mirrorSet.has(x)).slice(0, 4)
      if (process.env.BB_UD_DEBUG) {
        // For each truth-only target, show every identifier site of that name: the gates' AND-shape
        // is what decides, so the three inputs (locals, isMember/owner, parentType) are printed.
        for (const t of onlyTruth) {
          const sites: string[] = []
          const st: any[] = [root]
          while (st.length) {
            const x = st.pop()!
            if (x.type === "identifier" && x.text === t) {
              sites.push(`line ${x.startPosition.row + 1} parent=${x.parent?.type}`)
            }
            for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) st.push(c) }
          }
          console.log(`[debug] ${rel}: '${t}' truth-only; identifier sites: ${sites.join(" | ") || "NONE"}`)
        }
      }
      const onlyMirror = [...mirrorSet].filter((x) => !bareSet.has(x)).slice(0, 4)
      console.log(`[control] ${rel}: truth-only ${JSON.stringify(onlyTruth)} mirror-only ${JSON.stringify(onlyMirror)}`)
    }
    const tgtSet = new Set(truthUses.map((te: any) => normTarget(String(te.target))))
    for (const te of truthUses) {
      totals.truthUses++
      const nt = normTarget(String(te.target))
      const hit = analyzerUses.some((r: any) => normTarget(String(r.target)) === nt)
      if (hit) { totals.covered++; continue }
      totals.missing++
      // B1: a binding-spelled analyzer row for the SAME leaf explains the truth's bare row.
      const bindHit = analyzerUses.find((r: any) => {
        const rt = String(r.target)
        const i = rt.indexOf(BINDING_SEP)
        return i > 0 && normTarget(rt.slice(i + 1)) === nt
      })
      if (bindHit) {
        allDiverge.push({ dir: "MISSING", file: rel, from: String(te.from ?? ""), target: String(te.target), bucket: "B1_binding_spelling", detail: `analyzer ${bindHit.type} -> ${String(bindHit.target).replace(BINDING_SEP, "<BINDING_SEP>")}` })
        continue
      }
      // Position-attributed: if the mirror site's parent is a declaration/write shape, the TRUTH is
      // the side that over-derived; else the analyzer genuinely emitted nothing for a read.
      const sites = mirror.filter((m) => normTarget(m.target) === nt)
      const declLike = sites.filter((m) => DECL_PARENTS.has(m.parentType) || m.parentType === "variable_pattern")
      if (sites.length > 0 && declLike.length === sites.length) {
        allDiverge.push({ dir: "MISSING", file: rel, from: String(te.from ?? ""), target: String(te.target), line: sites[0].line, bucket: "B2_declaration_position", detail: `site parent ${sites[0].parentType}` })
      } else {
        allDiverge.push({ dir: "MISSING", file: rel, from: String(te.from ?? ""), target: String(te.target), line: sites[0]?.line, bucket: "B4_genuine_analyzer_miss", detail: sites.length ? `read site parent ${sites[0].parentType}` : "no position-attributed site (mirror divergence)" })
      }
    }
    for (const r of analyzerUses) {
      totals.analyzerUses++
      const rt = String(r.target)
      const nt = normTarget(rt)
      const hit = truthUses.some((te: any) => {
        const tt = String(te.target)
        return normTarget(tt) === nt || tt.includes(nt)
      })
      if (hit) continue
      totals.unexplained++
      const sep = rt.indexOf(BINDING_SEP)
      if (sep > 0) {
        const leaf = normTarget(rt.slice(sep + 1))
        const paired = tgtSet.has(leaf)
        allDiverge.push({ dir: "UNEXPLAINED", file: rel, from: String(r.source ?? ""), line: r.line_number, target: rt, bucket: "B1_binding_spelling", detail: paired ? `truth has bare '${leaf}' row (paired MISSING)` : `no truth row for leaf '${leaf}'` })
        continue
      }
      // Analyzer row with no truth: the truth under-derives this read — name the shape.
      const leaf = normTarget(rt)
      const shape = ["constructor", "new", "call"].includes(leaf) ? "construct_or_call_leaf" : leaf.length > 24 ? "qualified_or_long" : "bare_or_member"
      allDiverge.push({ dir: "UNEXPLAINED", file: rel, from: String(r.source ?? ""), line: r.line_number, target: rt, bucket: "B5_truth_under_derives", detail: shape })
    }
  }
  if (controlBad > 0) {
    console.error(`CONTROL FAILED: position mirror disagreed with deriveDartBareUses on ${controlBad}/${lane.files.length} file(s) — buckets are NOT published (exit 3)`)
    process.exit(3)
  }
}

const byBucket = new Map<string, Div[]>()
for (const d of allDiverge) {
  const key = `${d.dir}:${d.bucket}`
  let arr = byBucket.get(key)
  if (!arr) byBucket.set(key, (arr = []))
  arr.push(d)
}
console.log(`draw: ${chosen.reduce((n, l) => n + l.files.length, 0)} file(s) over ${chosen.map((l) => l.repo).join("+")}; truth uses ${totals.truthUses}, analyzer uses ${totals.analyzerUses}, covered ${totals.covered}, MISSING ${totals.missing}, UNEXPLAINED ${totals.unexplained}`)
console.log(`closure: covered + MISSING = truth (${totals.covered + totals.missing} = ${totals.truthUses}); analyzer = covered-or-explained + UNEXPLAINED`)
for (const key of [...byBucket.keys()].sort()) {
  const rows = byBucket.get(key)!
  console.log(`\n${key}  ${rows.length} row(s)`)
  const seen = new Set<string>()
  let shown = 0
  for (const r of rows) {
    const k = `${r.from}|${normTarget(r.target)}`
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`    ${r.file}:${r.line ?? "?"} ${r.from || "(bare)"} -> ${r.target.replace(BINDING_SEP, "<BINDING_SEP>")}   [${r.detail}]`)
    if (++shown >= 3) break
  }
}
