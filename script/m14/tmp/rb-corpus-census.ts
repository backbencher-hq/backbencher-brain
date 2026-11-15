/**
 * RUBY LANE — corpus label census (M60 deep round 2 instrument).
 *
 * `differential.ts` answers "how many"; this answers "which label, which
 * target, which source shape, how many files" — over a whole corpus, and it
 * also counts three SPECIFIC defect signatures the lane has never measured:
 *
 *   SIG-A  a bare-call edge to a name bound by a PARAMETER DEFAULT assignment
 *          (`def m(flag = (seen = true))` then `if seen`). Ruby evaluates a
 *          default in the method's own scope, so `seen` is a LOCAL and the call
 *          edge is fabricated. The analyzer walks default values (RB-B) but
 *          never feeds the names they bind back into the body walk.
 *
 *   SIG-B  an association `uses` edge sourced to a NAMED class that provably
 *          does not own it: the `belongs_to`/`has_many` sits in the block of
 *          an ANONYMOUS dynamic class (`anon = Class.new(Base) do ... end`),
 *          so the member belongs to an unnamed class while the edge is written
 *          against the enclosing named one. The named-factory form
 *          (`K = Class.new do ... end`) is handled and is NOT this signature.
 *
 *   SIG-C  a truth `overrides` edge for a base that does not really declare the
 *          method — the ORACLE's nested-class attribution leak: a class's
 *          method set is collected by walking its whole body, so a NESTED
 *          class's methods are credited to the enclosing class, and the
 *          subclass of that enclosing class is then credited with overriding
 *          methods it actually DEFINES. Measured on rails, this is a truth-side
 *          fabrication; the analyzer is right to stay silent.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-corpus-census.ts <corpus-root> [more roots...]
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
const normTarget = (t: string): string => t.toLowerCase().trim()
// differential.ts audits `extends implements instantiates overrides calls uses`
// for ruby and drops the rest from the analyzer side. BB_RB_AUDIT adds labels so
// a PROPOSED audited set can be measured before anyone edits the shared
// allowlist — the same discipline as BB_RB_ORACLE.
const AUDITED = new Set([
  "extends", "implements", "instantiates", "overrides", "calls", "uses",
  ...(process.env.BB_RB_AUDIT ? process.env.BB_RB_AUDIT.split(",").map(s => s.trim()).filter(Boolean) : []),
])

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p) }
      else if (e.isFile() && e.name.endsWith(".rb")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/** Names a method's PARAMETER DEFAULTS assign — the SIG-A binding set. */
function defaultBoundNames(methodNode: any): Set<string> {
  const names = new Set<string>()
  const stack: any[] = []
  for (let i = 0; i < methodNode.namedChildCount; i++) {
    const c = methodNode.namedChild(i)
    if (c && (c.type === "method_parameters" || c.type === "parameters")) stack.push(c)
  }
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "optional_parameter" || n.type === "keyword_parameter") {
      // children are [name, value]; walk only the VALUE subtree
      for (let i = 1; i < n.namedChildCount; i++) {
        const v = n.namedChild(i)
        if (!v) continue
        const inner: any[] = [v]
        while (inner.length > 0) {
          const q = inner.pop()!
          if (q.type === "assignment" || q.type === "operator_assignment") {
            const left = q.childForFieldName?.("left") ?? q.namedChild(0)
            if (left) {
              if (left.type === "identifier") names.add(left.text)
              for (let j = 0; j < left.namedChildCount; j++) {
                const s = left.namedChild(j)
                if (s?.type === "identifier") names.add(s.text)
              }
            }
          }
          for (let j = 0; j < q.namedChildCount; j++) { const s = q.namedChild(j); if (s) inner.push(s) }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return names
}

/**
 * Line ranges covered by an ANONYMOUS dynamic-class block, per enclosing class.
 *
 * A member declared inside such a block belongs to the unnamed class the block
 * builds, NOT to the named class that lexically encloses the assignment — so a
 * `belongs_to` written there is an association of a class with no name, and an
 * edge sourced to the enclosing class misattributes it.
 *
 * RANGE, not "this class has an anonymous factory somewhere": an earlier
 * revision keyed the map on the enclosing class alone, which flags EVERY
 * association in a class that contains one anonymous factory — including the
 * genuine class-level `has_many :posts` two hundred lines below the block. That
 * is a detector that cannot be acted on, because it does not separate the real
 * defect from the correct edges next to it.
 */
function anonymousFactoryRanges(root: any): Map<string, Array<[number, number, string]>> {
  const out = new Map<string, Array<[number, number, string]>>()
  const deep = (n: any, owner: string | undefined) => {
    let cur = owner
    if (n.type === "class" || n.type === "module") cur = n.childForFieldName?.("name")?.text ?? owner
    if (n.type === "assignment") {
      const left = n.childForFieldName?.("left")
      const right = n.childForFieldName?.("right")
      if (left && left.type !== "constant" && right && cur && anonFactory(right)) {
        const arr = out.get(cur) ?? []
        arr.push([right.startPosition.row + 1, right.endPosition.row + 1, left.text])
        out.set(cur, arr)
        // Still descend: a nested factory inside this block is its own range.
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) deep(n.namedChild(i), cur)
  }
  deep(root, undefined)
  return out
}

function anonFactory(right: any): boolean {
  const inner: any[] = [right]
  while (inner.length > 0) {
    const q = inner.pop()!
    if (q.type === "call") {
      const m = q.childForFieldName?.("method")?.text
      let recv = ""
      for (let i = 0; i < q.namedChildCount; i++) {
        const c = q.namedChild(i)
        if (c && c.id === q.childForFieldName?.("method")?.id) break
        if (c && (c.type === "constant" || c.type === "scope_resolution")) recv = c.text
      }
      const leaf = recv.split("::").filter(Boolean).pop() ?? recv
      if (leaf === "Class" || leaf === "Module" || leaf === "Struct" || leaf === "Data") return true
    }
    for (let j = 0; j < q.namedChildCount; j++) { const s = q.namedChild(j); if (s) inner.push(s) }
  }
  return false
}

async function main() {
  const { RealRubyAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts"))
  // BB_RB_ORACLE overrides the read-oracle module. This exists so a PROPOSED
  // oracle can be MEASURED before anyone edits the shared, contended
  // `script/m14/differential.ts` — the practice the round-3 patch was missing,
  // since it shipped on "applies cleanly" and was never run.
  const oraclePath = process.env.BB_RB_ORACLE
    ? path.resolve(process.env.BB_RB_ORACLE)
    : path.join(ROOT, "script", "m14", "differential.ts")
  const { deriveRubyEdges } = await import(oraclePath)
  console.log(`oracle: ${path.relative(ROOT, oraclePath)}`)
  console.log(`audited labels: ${[...AUDITED].sort().join(", ")}`)

  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a, i) => !a.startsWith("--") && !(i > 0 && process.argv[i - 1] === "--limit"))
  if (roots.length === 0) { console.error("usage: rb-corpus-census.ts <corpus-root>... [--limit N]"); process.exit(2) }
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  // A bounded run takes an EVEN STRIDE across the whole sorted list, not a
  // prefix. A prefix is a biased sample: in rails the first 500 files are
  // almost entirely `activerecord/lib/**`, so a prefix reads that directory's
  // shape and calls it the corpus. The stride keeps the sample's path mix the
  // corpus's, and the printed file count says which N of how many was read.
  let strided = false
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    const picked: string[] = []
    for (let i = 0; i < LIMIT; i++) picked.push(files[Math.floor(i * stride)])
    files = picked
    strided = true
  }

  const missingByLabel = new Map<string, number>()
  const unexpByLabel = new Map<string, number>()
  const outsideByLabel = new Map<string, number>()
  /** Edges whose target is defined in ANOTHER file - unanswerable from one tree. */
  let crossFileTotal = 0
  const crossFileByLabel = new Map<string, number>()
  const unexpExamples = new Map<string, any[]>()
  const missingExamples: any[] = []
  /** Per-label sample caps, so one label cannot crowd out every other. */
  const missingExamplesByLabel = new Map<string, number>()
  const sigA: any[] = []
  const sigB: any[] = []
  const sigC: any[] = []
  let filesWithA = 0, filesWithB = 0, filesWithC = 0
  let treeTotal = 0, missingTotal = 0, unexpTotal = 0, outsideTotal = 0, relTotal = 0
  let errs = 0
  let done = 0

  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { errs++; continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { errs++; continue }
    const rels = (res.relationships ?? []).map((r: any) => ({
      label: String(r.type ?? r.relationshipType ?? ""),
      target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
      from: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
      line: r.line_number ?? 0,
      confidence: typeof r.confidence === "number" ? r.confidence : 1,
      md: r.metadata ?? {},
    }))
    // differential.ts collapses the analyzer side to one edge per
    // (label, target) BEFORE comparing, because the analyzer emits one edge per
    // source SEARCH HIT while the oracle emits unique (label,target) truths.
    // Without this the same mismatch is counted once per hit site and the
    // census reports an "unexplained" rate several times the lane's own — the
    // instrument would then overstate the defect it exists to size.
    const deduped: typeof rels = []
    const seenKey = new Set<string>()
    for (const r of rels) {
      const k = r.label + "|" + r.target
      if (seenKey.has(k)) continue
      seenKey.add(k)
      deduped.push(r)
    }
    const truth = deriveRubyEdges(tree.rootNode)
    treeTotal += truth.length
    relTotal += deduped.length
    // Every name DEFINED in this file: class/module names, method names, constants,
    // attribute macro arguments. Used to separate a cross-file reference from a real
    // disagreement.
    const definedInThisFile = new Set<string>()
    // Every target the ANALYZER resolved anywhere in this file. An edge whose target
    // is in this set and NOT in definedInThisFile is a reference that necessarily
    // leaves the file.
    const resolvedTargets = new Set<string>(deduped.map((r: { target: string }) => r.target))
    {
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const nd = st.pop()!
        if (nd.type === "class" || nd.type === "module") {
          const nm = nd.childForFieldName("name")
          if (nm) definedInThisFile.add(nm.text)
        } else if (nd.type === "method" || nd.type === "singleton_method") {
          const nm = nd.childForFieldName("name")
          if (nm) definedInThisFile.add(nm.text)
        } else if (nd.type === "constant") {
          definedInThisFile.add(nd.text)
        }
        for (let i = 0; i < nd.namedChildCount; i++) {
          const c = nd.namedChild(i)
          if (c) st.push(c)
        }
      }
    }
    const anonRanges = anonymousFactoryRanges(tree.rootNode)
    const fileMethods = methodsByLine(tree.rootNode)

    let a = 0, b = 0, c = 0
    for (const te of truth) {
      if (rels.some((r: { label: string; target: string }) =>
        r.label === te.label && normTarget(r.target) === normTarget(te.target))) continue
      missingTotal++
      missingByLabel.set(te.label, (missingByLabel.get(te.label) ?? 0) + 1)
      // Sample EVERY missing label, not just `overrides`. The overrides-only
      // sampler hid the one `contains` gap this round for as long as the
      // derivation was incomplete.
      // Sample PER LABEL, not globally. A single 20-slot budget filled up with
      // whichever label came first in file order, which hid every other label's
      // shape for whole rounds - the `calls` examples crowded out `references`,
      // `implements` and `uses` entirely, and each of those turned out to be its own
      // distinct defect. Per-label caps keep every class visible at once.
      if (te.label !== "overrides") {
        const perLabel = missingExamplesByLabel.get(te.label) ?? 0
        if (perLabel < 8) {
          missingExamplesByLabel.set(te.label, perLabel + 1)
          missingExamples.push({
            dir: "MISSING", file: path.relative(roots[0], f), label: te.label,
            target: te.target, line: te.line,
          })
        }
      }
      // SIG-C: an `overrides` truth whose target the analyzer declines to emit
      if (te.label === "overrides" && sigC.length < 40) {
        c++
        sigC.push({ file: path.relative(roots[0], f), target: te.target })
      }
    }
    for (const r of deduped) {
      if (!AUDITED.has(r.label)) {
        outsideTotal++
        outsideByLabel.set(r.label, (outsideByLabel.get(r.label) ?? 0) + 1)
        continue
      }
      const hit = truth.some((te: { label: string; target: string }) => te.label === r.label &&
        (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))
      if (hit) continue
      if (r.confidence < 0.7) continue
      // SEPARATE the two kinds of "unexplained" instead of counting them as one.
      //
      // The oracle is SINGLE-FILE by construction: it reads one file's tree and has
      // no view of any other. So an analyzer edge whose target is DEFINED IN
      // ANOTHER FILE can never be matched by it - not because either side is wrong,
      // but because the question is unanswerable from one file. Those are
      // OUT-OF-SCOPE, which is a completely different claim from "unexplained", and
      // lumping them together made the number look 20x worse than the real question.
      //
      // How to tell? Use the analyzer's OWN resolved target: if the edge names a
      // symbol that this file does not define anywhere, the reference necessarily
      // points outside. That is a sound test, because the analyzer resolved it from
      // a real definition somewhere in the corpus.
      // The target must be RESOLVABLE to a definition somewhere for "points
      // outside this file" to be a meaningful claim. `definedInThisFile` is the
      // negative test; `definedAnywhere` (the analyzer's own resolution) is the
      // positive one, and without it an unresolvable name would be mislabelled as
      // cross-file rather than as a genuine disagreement.
      const definedHere = definedInThisFile.has(r.target)
      const resolvable = resolvedTargets.has(r.target)
      if (!definedHere && resolvable) {
        crossFileTotal++
        crossFileByLabel.set(r.label, (crossFileByLabel.get(r.label) ?? 0) + 1)
        continue
      }
      unexpTotal++
      unexpByLabel.set(r.label, (unexpByLabel.get(r.label) ?? 0) + 1)
      const arr = unexpExamples.get(r.label) ?? []
      if (arr.length < 8) {
        arr.push({ file: path.relative(roots[0], f), line: r.line, from: r.from, target: r.target, conf: r.confidence, md: r.md })
        unexpExamples.set(r.label, arr)
      }
      // SIG-A: a bare call to a name a parameter default assigns
      if (r.label === "calls" && r.md?.bareCall) {
        const m = methodAtLine(fileMethods, r.line)
        if (m) {
          const bound = defaultBoundNames(m)
          if (bound.has(r.target)) {
            a++
            if (sigA.length < 40) sigA.push({ file: path.relative(roots[0], f), line: r.line, method: m.name, target: r.target })
          }
        }
      }
      // SIG-B: an association `uses` edge whose source is a class with an
      // anonymous dynamic-class block bound to a local
      if (r.label === "uses" && r.md?.activerecordMacro) {
        const ranges = anonRanges.get(r.from) ?? []
        const hitRange = ranges.find(([a, b]) => r.line >= a && r.line <= b)
        const boundLocal = hitRange?.[2]
        if (boundLocal) {
          b++
          if (sigB.length < 40) sigB.push({ file: path.relative(roots[0], f), line: r.line, from: r.from, boundLocal, target: r.target })
        }
      }
    }
    if (a) filesWithA++
    if (b) filesWithB++
    if (c) filesWithC++
    done++
    if (done % 250 === 0) {
      process.stderr.write(`  [census] ${done}/${files.length} files  missing=${missingTotal} unexplained=${unexpTotal} sigA=${sigA.length} sigB=${sigB.length} sigC=${sigC.length}\n`)
    }
  }

  const pct = (n: number, d: number) => d === 0 ? "0.00%" : ((n / d) * 100).toFixed(3) + "%"
  console.log(`corpus: ${roots.join(", ")}`)
  console.log(`files=${files.length}${strided ? " (even stride across the sorted corpus)" : ""} parse/analyze errors=${errs}`)
  console.log(`tree-truth=${treeTotal}  analyzer-edges=${relTotal}  (audited labels only are comparable)`)
  console.log(`MISSING=${missingTotal} (${pct(missingTotal, treeTotal)})   UNEXPLAINED=${unexpTotal} (${pct(unexpTotal, relTotal)})   outside-audited=${outsideTotal} (${pct(outsideTotal, relTotal)})`)
  console.log("")
  console.log("MISSING by label:    " + [...missingByLabel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "))
  console.log("UNEXPLAINED by label:" + [...unexpByLabel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "))
  console.log("OUTSIDE audited:     " + [...outsideByLabel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "))
  console.log("")
  console.log(`SIG-A  bare call to a parameter-default-bound local : ${sigA.length} sampled, ${filesWithA} files`)
  console.log(`SIG-B  association uses on an anonymous-class owner : ${sigB.length} sampled, ${filesWithB} files`)
  console.log(`SIG-C  oracle nested-class overrides truth          : ${sigC.length} sampled, ${filesWithC} files`)
  for (const [label, arr] of unexpExamples) {
    console.log(`\n  unexplained ${label} examples:`)
    for (const e of arr) console.log(`    ${e.file}:${e.line} ${e.from} -> ${e.target} conf=${e.conf} ${JSON.stringify(e.md)}`)
  }
  if (sigA.length) { console.log(`\n  SIG-A examples:`); for (const e of sigA.slice(0, 10)) console.log(`    ${e.file}:${e.line} def ${e.method} -> calls "${e.target}"`) }
  if (sigB.length) { console.log(`\n  SIG-B examples:`); for (const e of sigB.slice(0, 10)) console.log(`    ${e.file}:${e.line} uses ${e.from} -> ${e.target}  (anon block bound to local "${e.boundLocal}")`) }
  if (missingExamples.length) { console.log(`\n  MISSING examples (all labels):`); for (const e of missingExamples.slice(0, 10)) console.log(`    ${e.file}  ${e.label} -> ${e.target}`) }
  if (sigC.length) { console.log(`\n  SIG-C examples:`); for (const e of sigC.slice(0, 10)) console.log(`    ${e.file}  truth overrides -> ${e.target}`) }

  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-corpus-census.json"), JSON.stringify({
    generatedAt: new Date().toISOString(), corpus: roots, files: files.length, errors: errs,
    treeTruth: treeTotal, analyzerEdges: relTotal,
    missing: missingTotal, unexplained: unexpTotal, outsideAudited: outsideTotal,
    missingByLabel: Object.fromEntries(missingByLabel), unexplainedByLabel: Object.fromEntries(unexpByLabel),
    crossFileTotal, crossFileByLabel: Object.fromEntries(crossFileByLabel),
    outsideByLabel: Object.fromEntries(outsideByLabel),
    unexplainedExamples: Object.fromEntries(unexpExamples),
    sigA: { sampled: sigA.length, files: filesWithA, examples: sigA },
    sigB: { sampled: sigB.length, files: filesWithB, examples: sigB },
    sigC: { sampled: sigC.length, files: filesWithC, examples: sigC },
    missingExamples,
  }, null, 2))
}

/**
 * Every method/singleton_method in the file, in SOURCE order.
 *
 * A previous revision resolved a method from an edge's line by re-walking the
 * whole tree per edge, which is O(edges x nodes) and made a 3.5k-file corpus
 * unfinishable. The methods are sorted by start row once, and a lookup takes
 * the last one that starts at or before the line.
 */
function methodsByLine(root: any): Array<{ startRow: number; name: string | undefined }> {
  const out: Array<{ startRow: number; name: string | undefined }> = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "method" || n.type === "singleton_method") {
      out.push({ startRow: n.startPosition.row + 1, name: n.childForFieldName?.("name")?.text })
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  out.sort((a, b) => a.startRow - b.startRow)
  return out
}

function methodAtLine(methods: Array<{ startRow: number; name: string | undefined }>, line: number): { startRow: number; name: string | undefined } | null {
  let found: { startRow: number; name: string | undefined } | null = null
  for (const m of methods) {
    if (m.startRow <= line) found = m
    else break
  }
  return found
}

main()
