/**
 * HCL CORPUS DIFFERENTIAL — the REAL analyzer vs an INDEPENDENT second-opinion
 * reference extractor written directly from the grammar, over every
 * .tf/.tfvars/.hcl/.tofu file in the pinned repos.
 *
 * The oracle uses a DIFFERENT algorithm from the analyzer on purpose, so a
 * disagreement is a real finding and not the same bug counted twice:
 *   analyzer : recursive descent; path runs read from any node's children;
 *              loopVars from for_intro + dynamic `iterator`; object keys
 *              excluded via the grammar's `key` FIELD.
 *   oracle   : flat pre-order sweep; a precomputed set of subtree byte-ranges
 *              that must never yield a reference (object keys, for_intro,
 *              for_cond, dynamic-iterator scopes), matched by byte offset.
 *
 * Also measures, per the lane formula: recall, precision, relationships carrying
 * a line, empty/sentinel names, properties without an owner, duplicate
 * (scope,name) identities, and symbol-free files with a legitimacy verdict.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { execFileSync } from "node:child_process"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "<corpus-root>/backbencher-brain/src/ast/real-hcl-analyzer"

const REPOS = "<corpus-root>/bb_tests/hcl/repos"
/** Mirrors the analyzer's set — but it is re-derived here from the same language
 *  semantics, and the differential's job is to CATCH a disagreement, so it is
 *  written out rather than imported. */
const BUILTIN_ROOTS = new Set(["count", "each", "self", "path", "terraform"])
const OUT = "<corpus-root>/bb_tests/hcl/out"
const EXT = /\.(tf|tfvars|hcl|tofu)$/i

const parser = await ASTEngine.getParser("hcl")
const analyzer = new RealHclAnalyzer()
type N = any

/**
 * Subtree byte-ranges that must never yield a reference.
 *
 * `for_intro` is NOT one of them: `[for d in data.x.y : d.z]` has its real
 * reference (`data.x.y`) INSIDE for_intro, next to the loop-variable
 * declaration that must be ignored. Only the loop-variable identifiers are
 * suppressed, and they are suppressed by NAME over the whole enclosing
 * for-expression (declaration + result + condition) — which is the scope HCL
 * itself gives them.
 *
 * `for_cond` is NOT one of them either: the `if …` tail of a for-expression is
 * an ordinary expression over ordinary references (`if contains(local.zones,
 * subnet.az)` really does read `local.zones`). Suppressing it loses 29 real
 * references; measured, then removed.
 */
function loopVarScopes(root: N): { vars: Set<string>; start: number; end: number }[] {
  const out: { vars: Set<string>; start: number; end: number }[] = []
  const stack: N[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "for_expr" || n.type === "for_tuple_expr" || n.type === "for_object_expr") {
      const vars = new Set<string>()
      for (let i = 0; i < n.namedChildCount; i++) {
        const intro = n.namedChild(i)
        if (intro?.type !== "for_intro") continue
        for (let j = 0; j < intro.namedChildCount; j++) {
          const id = intro.namedChild(j)
          if (id?.type === "identifier") vars.add(id.text)
        }
      }
      if (vars.size > 0) out.push({ vars, start: n.startIndex, end: n.endIndex })
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

function suppressionRanges(root: N): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const stack: N[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "object_elem") {
      const k = n.childForFieldName?.("key")
      if (k) out.push({ start: k.startIndex, end: k.endIndex })
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * Each `dynamic` block's loop local, scoped to THAT block's own body — never to
 * the enclosing block. Both the `iterator` attribute and the label default
 * (Terraform names the local after the block's own label when `iterator` is
 * absent). Scoping per-block rather than per-enclosing-subtree is what stops one
 * block's binding from silencing a SIBLING's reads: a resource carrying
 * `dynamic "assume_role"` and `dynamic "vpc"` must keep publishing `vpc.*`.
 */
function dynamicIterators(root: N): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = []
  const stack: N[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "block") {
      let isDynamic = false
      let firstLabel: string | null = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "identifier" && c.text === "dynamic") isDynamic = true
        else if (c.type === "string_lit" && firstLabel === null) {
          const lit = c.namedChildren.find((x: N) => x.type === "template_literal")
          if (lit) firstLabel = lit.text
        }
      }
      if (isDynamic) {
        const body = n.namedChildren.find((c: N) => c.type === "body")
        if (body) {
          let name: string | null = null
          for (const a of body.namedChildren) {
            if (a.type !== "attribute") continue
            const k = a.namedChildren.find((c: N) => c.type === "identifier")
            if (k?.text !== "iterator") continue
            const e = a.namedChildren.find((c: N) => c.type === "expression")
            const ve = e?.namedChild(0)
            if (ve?.type !== "variable_expr") continue
            const id = ve.namedChildren.find((c: N) => c.type === "identifier")
            if (id) {
              name = id.text
              break
            }
          }
          if (name === null && firstLabel) name = firstLabel
          if (name) out.push({ name, start: body.startIndex, end: body.endIndex })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

function oracleReferences(
  root: N,
  suppressed: { start: number; end: number }[],
  iters: { name: string; start: number; end: number }[],
  loopScopes: { vars: Set<string>; start: number; end: number }[],
) {
  const found = new Map<string, number>()
  const stack: N[] = [root]
  const suppressedAt = (i: number) => suppressed.some((r) => i >= r.start && i < r.end)
  const loopVarAt = (i: number, name: string) =>
    loopScopes.some((s) => i >= s.start && i < s.end && s.vars.has(name))
  while (stack.length) {
    const n = stack.pop()!
    // MAXIMAL CONSECUTIVE runs over ALL children. Reading only named children
    // walks over the operator token of `var.a + var.b` and welds the operands
    // into `var.a.var.b` — the same defect the analyzer had, which would make
    // the instrument report the analyzer's correct split as 476 spurious edges.
    for (let i = 0; i < n.childCount; i++) {
      const first = n.child(i)
      if (!first || (first.type !== "variable_expr" && first.type !== "get_attr")) continue
      const parts: string[] = []
      let anchor: N = first
      let j = i
      for (; j < n.childCount; j++) {
        const c = n.child(j)
        if (!c || (c.type !== "variable_expr" && c.type !== "get_attr")) break
        const id = c.namedChildren.find((x: N) => x.type === "identifier")
        if (!id) break
        parts.push(id.text)
      }
      if (parts.length >= 2 && !suppressedAt(anchor.startIndex) && !loopVarAt(anchor.startIndex, parts[0])) {
        const path = parts.join(".")
        // `some`, never `find`: one file may bind the SAME dynamic-local name in
        // SEVERAL blocks — packer's `dynamic "tag"` appears once per builder, and
        // boundary's `dynamic "ingress"` twice in one file. `find` returns ONE
        // scope, so a run sitting in any block other than that one leaked the
        // local as a reference (measured: 10 of the 12 residual misses, e.g.
        // `ingress.key` reported against the wrong block's byte range). `some`
        // asks the only question that matters — is this run inside ANY block
        // that binds this name?
        const binds = (x: { name: string }) => path === x.name || path.startsWith(x.name + ".")
        const idx = anchor.startIndex
        const inScope = iters.some((x) => binds(x) && idx >= x.start && idx < x.end)
        if (!inScope) {
          if (!found.has(path)) found.set(path, anchor.startPosition.row + 1)
        }
      }
      i = j - 1
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return found
}

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walkFiles(p)
    else if (EXT.test(e)) yield p
  }
}

const missSamples: { file: string; ref: string; line: number }[] = []
const spurSamples: { file: string; ref: string; line: number }[] = []
const emptyNameSamples: { file: string; line: number; name: string }[] = []
const ownerlessSamples: { file: string; line: number; name: string }[] = []
const dupSamples: { file: string; key: string; lines: number[] }[] = []
const symbolFreeNonTrivial: string[] = []

const T = {
  files: 0,
  symbols: 0,
  relationships: 0,
  references: 0,
  uses: 0,
  contains: 0,
  oracleRefs: 0,
  missed: 0,
  spurious: 0,
  mislabelled: 0,
  filesWithMiss: 0,
  filesWithSpurious: 0,
  unknownKind: 0,
  emptyName: 0,
  sentinelName: 0,
  memberWithoutOwner: 0,
  symbolFree: 0,
  symbolFreeNonTrivial: 0,
  lineBearing: 0,
  relTotal: 0,
  dupSymbolNames: 0,
  rootSymbols: 0,
  filesWithRoot: 0,
}

const perRepo: any[] = []

for (const d of readdirSync(REPOS)
  .filter((x) => {
    try {
      return statSync(join(REPOS, x)).isDirectory()
    } catch {
      return false
    }
  })
  .sort()) {
  let rev = "unknown"
  try {
    rev = execFileSync("git", ["-C", join(REPOS, d), "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12)
  } catch {}
  const R = { repo: d, rev, ...Object.fromEntries(Object.keys(T).map((k) => [k, 0])) }

  for (const f of walkFiles(join(REPOS, d))) {
    const src = readFileSync(f, "utf8")
    if (src.length > 4_000_000) continue
    R.files++
    const rel = relative(REPOS, f)
    const tree = parser.parse(src)
    const res = analyzer.analyze(tree.rootNode as any, src, rel)

    const got = new Map<string, number>()
    const gotLabel = new Map<string, string>()
    for (const r of res.relationships) {
      if (r.type === "references" || r.type === "uses") {
        if (r.type === "references") R.references++
        else R.uses++
        if (!got.has(r.target)) got.set(r.target, (r as any).line_number ?? -1)
        gotLabel.set(r.target, r.type as string)
      } else if (r.type === "contains") R.contains++
      R.relTotal++
      if ((r as any).line_number != null) R.lineBearing++
    }
    R.symbols += res.symbols.length
    R.relationships += res.relationships.length

    const roots = res.symbols.filter((s) => s.metadata?.hclRoot === true)
    R.rootSymbols += roots.length
    if (roots.length === 1) R.filesWithRoot++

    for (const s of res.symbols) {
      if (!s.name || s.name.trim() === "") {
        R.emptyName++
        if (emptyNameSamples.length < 40) emptyNameSamples.push({ file: rel, line: s.range.startLine, name: s.name })
      } else if (s.name === "unknown") {
        R.sentinelName++
      }
      if (s.kind === "property" && !s.ownerName) {
        R.memberWithoutOwner++
        if (ownerlessSamples.length < 40) ownerlessSamples.push({ file: rel, line: s.range.startLine, name: s.name })
      }
    }
    if (res.symbols.length === 0 || res.symbols.every((s) => s.metadata?.hclRoot)) {
      R.symbolFree++
      const stripped = src
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").replace(/\/\/.*$/, "").trim())
        .filter((l) => l.length > 0)
      const legit =
        stripped.length === 0 ||
        stripped.every((l) => /^[A-Za-z_][A-Za-z0-9_\-]*\s*=/.test(l)) ||
        stripped.every((l) => /^[[{]/.test(l))
      if (!legit) {
        R.symbolFreeNonTrivial++
        if (symbolFreeNonTrivial.length < 30)
          symbolFreeNonTrivial.push(`${rel}\n${src.split("\n").slice(0, 12).map((l, i) => `   ${String(i + 1).padStart(4)} | ${l}`).join("\n")}`)
      }
    }

    const seen = new Map<string, number[]>()
    for (const s of res.symbols) {
      if (s.metadata?.hclRoot) continue
      const k = `${s.scope ?? ""}|${s.name}`
      if (!seen.has(k)) seen.set(k, [])
      seen.get(k)!.push(s.range.startLine)
    }
    for (const [k, lines] of seen) {
      if (lines.length > 1) {
        R.dupSymbolNames += lines.length - 1
        if (dupSamples.length < 30) dupSamples.push({ file: rel, key: k, lines })
      }
    }

    const want = oracleReferences(
      tree.rootNode as any,
      suppressionRanges(tree.rootNode as any),
      dynamicIterators(tree.rootNode as any),
      loopVarScopes(tree.rootNode as any),
    )
    R.oracleRefs += want.size
    let miss = 0
    let spur = 0
    for (const [ref, line] of want) {
      if (!got.has(ref)) {
        miss++
        R.missed++
        if (missSamples.length < 300) missSamples.push({ file: rel, ref, line })
      } else if (BUILTIN_ROOTS.has(ref.split(".")[0]) !== (gotLabel.get(ref) === "uses")) {
        // The edge is present but carries the WRONG label: a builtin published as
        // `references` claims a declaration that does not exist, and a project
        // address published as `uses` claims it is a global. Both are contract
        // violations, so both are counted — not tolerated because the target
        // happens to match.
        R.mislabelled++
        if (missSamples.length < 300) missSamples.push({ file: rel, ref: `${ref} [LABEL]`, line })
      }
    }
    for (const [ref, line] of got) {
      if (!want.has(ref)) {
        spur++
        R.spurious++
        if (spurSamples.length < 300) spurSamples.push({ file: rel, ref, line })
      }
    }
    if (miss) R.filesWithMiss++
    if (spur) R.filesWithSpurious++
    tree.delete?.()
  }
  for (const k of Object.keys(T)) R[k] += T[k] ? 0 : 0
  for (const k of Object.keys(T)) T[k] += R[k] as number
  perRepo.push(R)
  process.stderr.write(
    `  ${d}@${rev.slice(0, 7)}: files=${R.files} refs=${R.references} oracle=${R.oracleRefs} MISS=${R.missed} SPUR=${R.spurious} line=${R.lineBearing}/${R.relTotal} empty=${R.emptyName} dup=${R.dupSymbolNames} rootOK=${R.filesWithRoot}\n`,
  )
}

const recall = T.oracleRefs === 0 ? 0 : (T.oracleRefs - T.missed) / T.oracleRefs
const precision = T.references === 0 ? 0 : (T.references - T.spurious) / T.references

writeFileSync(
  `${OUT}/corpus-differential.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      method: "real analyzer vs independent flat-sweep grammar oracle",
      grand: T,
      recall: Number(recall.toFixed(6)),
      precision: Number(precision.toFixed(6)),
      perRepo,
      missSamples,
      spurSamples,
      emptyNameSamples,
      ownerlessSamples,
      dupSamples,
      symbolFreeNonTrivial,
    },
    null,
    2,
  ) + "\n",
)

console.log("\n================= HCL CORPUS DIFFERENTIAL =================")
console.log(`files              ${T.files}`)
console.log(`symbols            ${T.symbols}   (root module symbols: ${T.rootSymbols}, files with exactly one root: ${T.filesWithRoot})`)
console.log(`relationships      ${T.relationships} (contains=${T.contains} references=${T.references})`)
console.log(`oracle refs        ${T.oracleRefs}`)
console.log(`MISSED             ${T.missed}    recall    ${(recall * 100).toFixed(3)}%`)
console.log(`SPURIOUS           ${T.spurious}    precision ${(precision * 100).toFixed(3)}%`)
console.log(`files w/ miss      ${T.filesWithMiss}      files w/ spurious ${T.filesWithSpurious}`)
console.log(`LINE-BEARING REL   ${T.lineBearing}/${T.relTotal}  ${T.relTotal === 0 ? 0 : ((T.lineBearing / T.relTotal) * 100).toFixed(2)}%`)
console.log(`empty names        ${T.emptyName}    sentinel "unknown" names ${T.sentinelName}`)
console.log(`properties w/o owner ${T.memberWithoutOwner}`)
console.log(`duplicate identities ${T.dupSymbolNames}`)
console.log(`symbol-free files  ${T.symbolFree}  (non-trivial: ${T.symbolFreeNonTrivial})`)
const tally = (arr: any[]) => {
  const m = new Map<string, number>()
  for (const x of arr) m.set(x.ref, (m.get(x.ref) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
}
console.log(`\ntop MISSED:`)
for (const [k, v] of tally(missSamples)) console.log(`   ${v}  ${k}`)
console.log(`\ntop SPURIOUS:`)
for (const [k, v] of tally(spurSamples)) console.log(`   ${v}  ${k}`)
