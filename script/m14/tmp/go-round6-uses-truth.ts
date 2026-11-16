// go lane — ROUND 6, step 3: a TRUTH derivation for the `uses` surface.
//
// THE HOLE, and the last big one. `uses` is the lane's READ surface and it is
// the only remaining label with no oracle: 79,584 edges across the three new
// corpora, 85% of them one rule (`go_selector_use`). Round 5 found a defect on
// this surface by reading the analyzer; nothing in the repository could find it.
//
// THREE SUB-SURFACES, measured separately so a red row is attributable:
//
//   go_selector_use      68,038  a field ACCESS: `s.cfg` names the field `cfg`.
//                                   Excluded: a selector that is a call's callee
//                                   (the calls edge owns it), a WRITE position
//                                   (assignment LHS, inc/dec), and a channel
//                                   send/receive operand (the channel edge owns
//                                   it, so a member channel gets one row not two).
//   identifier_usage     10,537  a bare VALUE read of a name visible in the
//                                   file: a package-scope var/const/func. The
//                                   rule with the longest exclusion list, and
//                                   the one derived LAST here — see the note at
//                                   the bottom of this header.
//   go_channel_operation  1,009  a send or receive on a channel, named by the
//                                   channel's declared leaf, with a direction.
//
// GO12-CLASS DISCIPLINE. The analyzer's bare-read pass keeps a LEXICAL SCOPE
// STACK and applies ten exclusion predicates. An oracle that copied those
// predicates would be the analyzer's own logic run twice, which proves nothing —
// the C5 collusion pattern. So this derivation is written from Go's semantics
// and the grammar's FIELDS, and the two are allowed to disagree. Where they
// disagree, the disagreement is a finding to be adjudicated, and a finding this
// instrument cannot produce is a class this round has not looked at.
//
// Run: bun script/m14/tmp/go-round6-uses-truth.ts [--repo <name>] [--files N]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import type { Node } from "web-tree-sitter"

export interface UsesTruth {
  label: string
  /** the analyzer's relationshipType: go_selector_use | identifier_usage | go_channel_operation */
  rt: string
  from: string
  target: string
  line: number
  direction?: string
}

// ────────────────────────────────────────────────────────── shared helpers

/** The nearest enclosing function/method name — the source of a body-scoped edge. */
// GOD14: everything above used to be a SECOND, independent implementation of the
// `uses` derivation in this file, which is how a lane ends up auditing two things
// that are not the same thing. It went stale the moment GOD11/GOD12/GOD13 landed in
// the gated copy and then reported 1,947 disagreements on go-tools — every one of
// them the analyzer being RIGHT and this copy being loose, because the analyzer had
// been taught package-scope-initializer attribution and range-variable shadowing
// and this file had not. That is the third time this exact split has cost the go
// lane: the first put two latent ReferenceErrors into 8b0e2113 (a typo and an
// undefined regex, both invisible until a rotating draw reached the branch), the
// second was differential.ts losing the oracles entirely. One implementation, read
// from the place the gate reads it, so a probe can never disagree with the gate
// about anything except the analyzer.
import { deriveGoUses } from "../differential"

const arg = (n: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${n}=`))
  if (eq) return eq.slice(n.length + 1)
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}
if (import.meta.main) {
  const REPO = arg("--repo") ?? "<corpus-root>/bb_tests/repositories/go-tools"
  const LIMIT = Number(arg("--files") ?? 0)
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "vendor" || e.name === "node_modules") continue
        walk(path.join(d, e.name))
      } else if (e.isFile() && e.name.endsWith(".go")) files.push(path.join(d, e.name))
    }
  }
  walk(REPO)
  files.sort()
  const read = LIMIT > 0 ? files.slice(0, LIMIT) : files
  const { RealGoAnalyzer } = await import("../../../src/ast/real-go-analyzer")
  const analyzer = new RealGoAnalyzer()

  const RT = ["go_selector_use", "identifier_usage", "go_channel_operation"]
  const stat: Record<string, { truth: number; analyzer: number; matched: number }> = {}
  for (const k of RT) stat[k] = { truth: 0, analyzer: 0, matched: 0 }
  const missingByClass = new Map<string, number>()
  const extraByClass = new Map<string, number>()
  const missingSamples: string[] = []
  const extraSamples: string[] = []
  let skips = 0

  for (const f of read) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(REPO, f)
    let tree: any
    try {
      const parser = await ASTEngine.getParser("go" as any)
      tree = parser.parse(src)
    } catch { skips++; continue }
    if (!tree?.rootNode) continue
    const res: any = await analyzer.analyze(tree.rootNode, src, f)
    const truth = deriveGoUses(tree.rootNode)

    const got = new Set<string>()
    for (const r of res.relationships ?? []) {
      if (String(r.type ?? r.relationshipType ?? "") !== "uses") continue
      const rt = String((r.metadata ?? {}).relationshipType ?? "")
      if (!RT.includes(rt)) continue
      // The channel edge's identity includes its DIRECTION, which is metadata
      // rather than part of the (source,target) pair.
      const dir = String((r.metadata ?? {}).operationType ?? "")
      const k = `${rt}|${r.source}|${r.target}${rt === "go_channel_operation" ? "|" + dir : ""}`
      if (!got.has(k)) { got.add(k); stat[rt].analyzer++ }
    }
    const truthKeys = new Set(truth.map((t) => `${t.rt}|${t.from}|${t.target}${t.rt === "go_channel_operation" ? "|" + (t.direction ?? "") : ""}`))
    for (const t of truth) {
      stat[t.rt].truth++
      const k = `${t.rt}|${t.from}|${t.target}${t.rt === "go_channel_operation" ? "|" + (t.direction ?? "") : ""}`
      if (got.has(k)) { stat[t.rt].matched++; continue }
      const cls = `${t.rt}|MISSING`
      missingByClass.set(cls, (missingByClass.get(cls) ?? 0) + 1)
      if (missingSamples.length < 40) missingSamples.push(`${rel}:${t.line} ${t.from}->${t.target} [${t.rt}]`)
    }
    for (const k of got) {
      if (truthKeys.has(k)) continue
      const cls = `${k.split("|")[0]}|EXTRA`
      extraByClass.set(cls, (extraByClass.get(cls) ?? 0) + 1)
      if (extraSamples.length < 40) extraSamples.push(`${rel} ${k}`)
    }
  }
  const rows = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${String(v).padStart(7)}  ${k}`).join("\n")
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0)
  const perSurface = Object.fromEntries(RT.map((k) => [k, {
    truth: stat[k].truth,
    analyzer: stat[k].analyzer,
    matched: stat[k].matched,
    MISSING: stat[k].truth - stat[k].matched,
    missingPct: pct(stat[k].truth - stat[k].matched, stat[k].truth),
    UNEXPLAINED: stat[k].analyzer - stat[k].matched,
    coveragePct: pct(stat[k].matched, stat[k].truth),
  }]))
  console.log(JSON.stringify({
    repo: REPO,
    filesListed: files.length,
    filesRead: read.length,
    parseSkips: skips,
    perSurface,
    missingByClass: rows(missingByClass) || "    (none)",
    extraByClass: rows(extraByClass) || "    (none)",
    missingSamples,
    extraSamples,
  }, null, 2))
}
