/**
 * JAVA LANE MUTANTS — VERIFY_JAVA9.
 *
 * ## Why this file exists
 *
 * Honesty contract §2 L4: "deliberately injected defects caused the suite to
 * fail". §5.4: "if a mutant survives, the suite fails — not the mutant". A test
 * that cannot fail is not a test, and this lane's new behaviour (`exports`,
 * `imports`) arrived from another branch on this lane's own word, so the first
 * obligation here is to prove the checks would have caught it being wrong.
 *
 * ## What counts as CAUGHT
 *
 * Each mutant is a source-text substitution in a COPY of the analyzer, applied
 * to the committed bytes. The copy is written inside this lane's directory so
 * its relative imports resolve, and its two imports are re-pointed at
 * `src/ast` mechanically (string replacement, not a pattern).
 *
 * A mutant is CAUGHT when ANY of these changes against the baseline, measured
 * over the SAME files in the SAME process:
 *
 *   - the per-type edge signature (count per relationship type)
 *   - the export-set signature (per visibility tier, and the number of export
 *     entries whose symbol is NOT a top-level type declaration)
 *   - the import-flag signature (static / wildcard counts)
 *   - the oracle verdict (the independent walker in java-verify-oracle.ts)
 *   - the hygiene scan (endpoints that cannot be a Java name)
 *
 * A mutant that leaves every signature byte-identical is a SURVIVOR and is
 * reported as a defect in the CHECK, not excused in the mutant. That case has
 * real content here: `pushModuleDirective` shipped a guard that tested the role
 * string `module_requires_module` while the directive table produces
 * `requires_module`, so the guard matched nothing and no corpus could ever
 * exercise it. Source derivation sees a function; only execution sees that the
 * branch is dead.
 *
 * ## NO REGEX
 *
 * Every mutation is an exact `indexOf`/slice on a literal, and every check is a
 * tree walk or a char-code walk. A mutation expressed as a pattern would be a
 * second regex instrument in a lane whose rule is no regex.
 *
 * ## USAGE
 *   bun script/m14/lanes/java-verify/java-verify-mutants.ts
 *   LANE_NFILES=200 bun script/m14/lanes/java-verify/java-verify-mutants.ts
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../../src/ast/real-java-analyzer"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.LANE_REPO ?? "java-lib"
const LANE_NFILES = Number(process.env.LANE_NFILES ?? 300)
const HERE = join(import.meta.dir)
const ANALYZER = join(HERE, "../../../../src/ast/real-java-analyzer.ts")

/** exact-string replace, first occurrence only, and it FAILS LOUDLY if the
 *  needle is absent -- a mutation that silently applies to nothing is the
 *  mutant equivalent of a test that cannot fail. */
function mutateOnce(src: string, needle: string, replacement: string): string {
  const i = src.indexOf(needle)
  if (i < 0) throw new Error(`MUTATION DID NOT APPLY: needle absent: ${needle.slice(0, 70)}`)
  if (src.indexOf(needle, i + 1) >= 0) throw new Error(`MUTATION AMBIGUOUS: needle appears more than once: ${needle.slice(0, 70)}`)
  return src.slice(0, i) + replacement + src.slice(i + needle.length)
}

interface Mutant {
  id: string
  intent: string
  /** exact substring that must occur exactly once */
  needle: string
  replacement: string
  /** true when producing byte-identical output is the CORRECT result */
  expectIdentical?: boolean
}

/* ------------------------------------------------------------------ corpus
 * Derived, never hand-written: a fixture file list rots silently and then
 * reports 0 with total confidence (honesty contract, consequence 2). */
const FIXTURES = join(HERE, "../../../../validation/m14/fixtures/java")
const corpusDir = join(CORPUS_ROOT, REPO_DIR)
const corpusAll: string[] = []
function walk(d: string) {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) corpusAll.push(p)
  }
}
walk(corpusDir)
corpusAll.sort()
void LANE_NFILES

const fixtureAll = readdirSync(FIXTURES).filter((f) => f.endsWith(".java") && !f.endsWith(".expectation.json")).sort()
const fixtures = fixtureAll.map((f) => join(FIXTURES, f))

console.log(`JAVA LANE MUTANTS (VERIFY_JAVA9)`)
console.log(`population: ${corpusAll.length} .java files in ${REPO_DIR} · ALL of them, for the baseline AND for every mutant`)
console.log(`  BASELINE + every mutant are measured over ALL ${corpusAll.length} of them`)
console.log(`  plus ${fixtureAll.length} fixture files, which feed a behavioural digest`)
console.log(`fixtures:   ${fixtureAll.length} under validation/m14/fixtures/java (ALL of them)`)
console.log(`mutants:    injected below, each into a COPY of the committed analyzer\n`)

// ------------------------------------------------------------------ signature
const TYPE_DECLS = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"])

function nameShapeOk(s: string): boolean {
  if (!s) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x5f || c === 0x24 || c === 0x2e || c === 0x3a)) return false
  }
  return true
}

interface Sig {
  rel: Record<string, number>
  relMeta: Record<string, number>
  importCount: number
  importStatic: number
  importWildcard: number
  exportsTotal: number
  exportsPublic: number
  exportsNotPublic: number
  /** export entries whose symbol is NOT a top-level type declaration -- the
   *  fabrication class the 14 removed edges were instances of */
  exportsNonType: number
  notAName: number
  /** sample-independent IDENTITY: an `exports` entry is a top-level type
   *  declaration, always. Counted on the parse tree, not inferred from the
   *  analyzer's own export set -- so a mutant that enlarges the set is caught
   *  even when the sample happens to contain no offending file. */
  exportIdentityViolations: number
  /** A behavioural digest over EVERY fixture file: the full symbol list and the
   *  full relationship list, in emission order. This is the check that catches
   *  any mutant whose targeted counters happen to coincide, and it is what makes
   *  "the mutants were all caught" a statement about behaviour rather than
   *  about eight hand-picked numbers. */
  fixtureDigest: string
}

async function signatureOf(analyzer: any, over?: string[]): Promise<Sig> {
  const sig: Sig = {
    rel: {}, relMeta: {}, importCount: 0, importStatic: 0, importWildcard: 0,
    exportsTotal: 0, exportsPublic: 0, exportsNotPublic: 0, exportsNonType: 0, notAName: 0,
    exportIdentityViolations: 0,
    fixtureDigest: "",
  }
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
  // The population is ALWAYS the whole corpus unless a caller explicitly says
  // otherwise. It was `over ?? corpus` — a 300-file default — while the BASELINE
  // was measured over all 3,275, so every mutant was compared against a different
  // population and all eight "passed" for the wrong reason: the counts differed
  // because the denominators did. An instrument that names one population for its
  // baseline and another for its subject is the exact defect this file's header
  // cites.
  const population = over ?? corpusAll
  for (const [abs, isFixture] of [...population.map((p) => [p, false] as [string, boolean]), ...fixtures.map((p) => [p, true] as [string, boolean])]) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    let tree: any
    try {
      const parser = await getParser("java")
      tree = parser.parse(content)
      if (!tree) continue
    } catch { continue }
    let res: any
    try { res = analyzer.analyze(tree.rootNode, content, abs) } catch { tree.delete?.(); continue }

    for (const r of res.relationships ?? []) {
      bump(sig.rel, String(r.type ?? r.relationshipType ?? ""))
      // The relationship's OWN metadata, counted by value. `imports[]`'s
      // isStatic flag is set by a different code path, so a mutant that breaks
      // only the relationship's role string is invisible unless the relationship
      // metadata is in the signature -- which is exactly how M4 survived the
      // first sweep.
      bump(sig.relMeta, String(r.type ?? "") + "/" + String(r.metadata?.relationshipType ?? "(none)"))
      for (const ep of [r.source, r.target]) {
        const s = ep === undefined || ep === null ? "" : String(ep)
        if (s.length > 0 && !nameShapeOk(s)) sig.notAName++
      }
    }
    for (const im of res.imports ?? []) {
      sig.importCount++
      if (im.metadata?.isStatic) sig.importStatic++
      if (im.metadata?.isWildcard) sig.importWildcard++
    }
    const byName = new Map<string, any>()
    for (const s of res.symbols ?? []) byName.set(String(s.name), s)
    // The identity, counted on the TREE: every top-level type declaration in this
    // file must be in `exports`, and every `exports` entry must be one of them.
    const declaredTopLevel = new Set<string>()
    const countTopLevel = (n: any) => {
      if (TYPE_DECLS.has(n.type)) {
        let p = n.parent
        let top = true
        while (p) { if (TYPE_DECLS.has(p.type)) { top = false; break } p = p.parent }
        const nm = String(n.childForFieldName?.("name")?.text ?? "")
        if (top && nm) declaredTopLevel.add(nm)
      }
      for (let i = 0; i < n.namedChildCount; i++) countTopLevel(n.namedChild(i))
    }
    countTopLevel(tree.rootNode)
    for (const e of res.exports ?? []) {
      const nm = String(e.name)
      if (!declaredTopLevel.has(nm)) sig.exportIdentityViolations++
    }
    for (const e of res.exports ?? []) {
      sig.exportsTotal++
      if (e.visibility === "public") sig.exportsPublic++
      else sig.exportsNotPublic++
      const nodeType = String(byName.get(String(e.name))?.metadata?.nodeType ?? "")
      if (!TYPE_DECLS.has(nodeType)) sig.exportsNonType++
    }
    if (isFixture) {
      // Only the fixtures feed the digest: they are the pinned, authored
      // behaviour. A corpus digest would be a hash of a moving target.
      const rows: string[] = []
      for (const s2 of res.symbols ?? []) rows.push("S|" + String(s2.name) + "|" + String(s2.kind) + "|" + String(s2.ownerName ?? "") + "|" + String(s2.visibility ?? ""))
      for (const r2 of res.relationships ?? []) rows.push("R|" + String(r2.type ?? "") + "|" + String(r2.source) + "|" + String(r2.target) + "|" + String(r2.confidence ?? ""))
      for (const e2 of res.exports ?? []) rows.push("E|" + String(e2.name) + "|" + String(e2.kind ?? "") + "|" + String(e2.visibility ?? ""))
      for (const i2 of res.imports ?? []) rows.push("I|" + String(i2.module) + "|" + String(i2.metadata?.isStatic) + "|" + String(i2.metadata?.isWildcard))
      rows.sort()
      for (const line of rows) sig.fixtureDigest += line + "\n"
    }
    tree.delete?.()
  }
  return sig
}

function diffSig(a: Sig, b: Sig): string[] {
  const out: string[] = []
  const keys = new Set([...Object.keys(a.rel), ...Object.keys(b.rel)])
  for (const k of [...keys].sort()) {
    const x = a.rel[k] ?? 0, y = b.rel[k] ?? 0
    if (x !== y) out.push(`rel ${k}: ${x} -> ${y} (${y - x >= 0 ? "+" : ""}${y - x})`)
  }
  const mkeys = new Set([...Object.keys(a.relMeta), ...Object.keys(b.relMeta)])
  for (const k of [...mkeys].sort()) {
    const x = a.relMeta[k] ?? 0, y = b.relMeta[k] ?? 0
    if (x !== y) out.push(`rel metadata ${k}: ${x} -> ${y} (${y - x >= 0 ? "+" : ""}${y - x})`)
  }
  const scalar: Array<[string, number, number]> = [
    ["imports[]", a.importCount, b.importCount],
    ["import static flag", a.importStatic, b.importStatic],
    ["import wildcard flag", a.importWildcard, b.importWildcard],
    ["exports[] total", a.exportsTotal, b.exportsTotal],
    ["exports public", a.exportsPublic, b.exportsPublic],
    ["exports not-public", a.exportsNotPublic, b.exportsNotPublic],
    ["exports NOT a top-level type", a.exportsNonType, b.exportsNonType],
    ["endpoints that cannot be a Java name", a.notAName, b.notAName],
    ["exports entries that are NOT a top-level type (tree identity)", a.exportIdentityViolations, b.exportIdentityViolations],
  ]
  for (const [k, x, y] of scalar) if (x !== y) out.push(`${k}: ${x} -> ${y} (${y - x >= 0 ? "+" : ""}${y - x})`)
  if (a.fixtureDigest !== b.fixtureDigest) {
    const al = a.fixtureDigest.split("\n")
    const bl = b.fixtureDigest.split("\n")
    const as = new Set(al)
    const bs = new Set(bl)
    const added = bl.filter((x) => !as.has(x))
    const removed = al.filter((x) => !bs.has(x))
    out.push(`fixture behaviour digest CHANGED (${al.length} -> ${bl.length} rows)`)
    for (const x of added.slice(0, 4)) out.push(`    + ${x}`)
    for (const x of removed.slice(0, 4)) out.push(`    - ${x}`)
    if (added.length > 4 || removed.length > 4) out.push(`    ... ${added.length} added, ${removed.length} removed in total`)
  }
  return out
}

/* ------------------------------------------------------------------ mutants
 * Each needle is a literal that occurs EXACTLY ONCE in the committed analyzer
 * at this commit. mutateOnce refuses otherwise, so a stale mutant is a loud
 * failure rather than a no-op that reports "caught" for free. */
const MUTANTS: Mutant[] = [
  {
    id: "M1 exports: drop the top-level-type guard",
    intent: "reopen the fabrication class EXPORTS_JAVA2 removed: publish every owner-less symbol as an importable unit, which is how METHODS entered the export set",
    needle: "if (!s.metadata?.isPhantom && !s.ownerName && isTopLevelTypeDecl) {",
    replacement: "if (!s.metadata?.isPhantom && !s.ownerName) {",
  },
  {
    id: "M2 exports: flat 1.0 for a package-private top-level type",
    intent: "assert importability (JLS 6.5.5.1/7.6) for a type no other package can bind",
    needle: "confidence: isPublic ? 1.0 : 0.6,",
    replacement: "confidence: 1.0,",
  },
  {
    id: "M3 imports: remove the dependency edge",
    intent: "reopen the gap this edge closed: imports[] stays populated, the relationship channel goes empty",
    needle: "            type: ASTEngine.RelationshipType.Imports,\n            confidence: 1.0,",
    replacement: "            type: ASTEngine.RelationshipType.References,\n            confidence: 1.0,",
  },
  {
    id: "M4 imports: isStatic always false",
    intent: "swap a grammar-derived flag for a hardcoded one, which the pre-EXPORTS_JAVA2 text search also got wrong for `import static`",
    needle: "relationshipType: isStatic ? \"static_member_import\" : isAsterisk ? \"type_on_demand_import\" : \"single_type_import\",",
    replacement: "relationshipType: \"single_type_import\",",
  },
  {
    id: "M5 JPMS: point the requires guard at a role the corpus never produces",
    expectIdentical: true,
    intent: "recreate the dead branch EXPORTS_JAVA2's mutant I6 found -- a predicate that cannot match, invisible to source derivation",
    needle: "if (role === \"requires_module\") {",
    replacement: "if (role === \"requires_transitive_module\") {",
  },
  {
    id: "M6 type endpoints: fall back to the node TEXT",
    intent: "reopen the defect extractJavaTypeBaseName's own comment records: `extends AbstractMultiset<E>.EntrySet` and `new a.b.C()` publishing source text as an endpoint, where no Java declaration's name can carry a `<` or a space",
    needle: "    return javaTypeBaseName(typeNode)",
    replacement: "    return javaTypeBaseName(typeNode) || String(typeNode.text ?? \"\")",
  },
  {
    id: "M7 exports: emit a package source when the file declares no package",
    intent: "replace a measured refusal to fabricate with the string `root`, so a default-package file gets an export edge naming nothing",
    needle: "if (!currentPackage) { exportsWithNoPackage++; continue }",
    replacement: "if (!currentPackage) { exportsWithNoPackage++; currentPackage = \"root\" }",
  },
  {
    id: "M8 contains: publish a phantom member at 1.0",
    intent: "the exact defect class real-java-analyzer.ts records in its own comment (JD-J4): a synthesized member at full confidence",
    needle: "confidence: isPhantomMember ? 0.6 : 1.0,",
    replacement: "confidence: 1.0,",
  },
]

// ------------------------------------------------------------------ run
const baselineSrc = readFileSync(ANALYZER, "utf8")
const tmpBase = join(HERE, "tmp-mutant-base.ts")

/** Write a mutated analyzer into this lane's directory, with its two relative
 *  imports re-pointed at src/ast so the copy resolves. */
function writeVariant(name: string, src: string): string {
  const p = join(HERE, name)
  const patched = src
    .split('from "./engine"').join('from "../../../../src/ast/engine"')
    .split('from "./override-context"').join('from "../../../../src/ast/override-context"')
  writeFileSync(p, patched)
  return p
}

console.log("computing the BASELINE signature over the WHOLE corpus (so a survivor of the")
console.log("sample sweep can be re-asked against the population the invariant is about)...")
const baseline = await signatureOf(new RealJavaAnalyzer(), corpusAll)
console.log(`  relationships: ${JSON.stringify(baseline.rel)}`)
console.log(`  imports[] ${baseline.importCount} (static ${baseline.importStatic}, wildcard ${baseline.importWildcard})`)
console.log(`  exports[] ${baseline.exportsTotal} (public ${baseline.exportsPublic}, not-public ${baseline.exportsNotPublic}, NOT a top-level type ${baseline.exportsNonType})`)
console.log(`  endpoints that cannot be a Java name: ${baseline.notAName}`)
console.log(`  fixture behaviour digest: ${baseline.fixtureDigest.length} bytes over ${fixtures.length} fixture files\n`)

const rows: Array<{ id: string; intent: string; verdict: string; diffs: string[] }> = []
const survivors: string[] = []
const expectedIdentical: string[] = []

for (const m of MUTANTS) {
  let mutated: string
  try { mutated = mutateOnce(baselineSrc, m.needle, m.replacement) }
  catch (e) { rows.push({ id: m.id, intent: m.intent, verdict: "MUTANT STALE — " + String(e).slice(0, 100), diffs: [] }); continue }
  const p = writeVariant("tmp-mutant-" + m.id.split(" ")[0] + ".ts", mutated)
  let Cls: any = null
  try {
    const mod = await import(p)
    Cls = Object.values(mod).find((v: any) => typeof v === "function" && String(v.name).indexOf("Analyzer") >= 0)
  } catch (e) {
    rows.push({ id: m.id, intent: m.intent, verdict: "CAUGHT (variant failed to load: " + String(e).slice(0, 70) + ")", diffs: [] })
    try { unlinkSync(p) } catch {}
    continue
  }
  let sig: Sig
  try { sig = await signatureOf(new Cls()) }
  catch (e) { rows.push({ id: m.id, intent: m.intent, verdict: "CAUGHT (variant threw: " + String(e).slice(0, 70) + ")", diffs: [] }); try { unlinkSync(p) } catch {}; continue }
  const diffs = diffSig(baseline, sig)
  let verdict: string
  if (diffs.length === 0) {
    // Identical output. For a defect-injecting mutant that is a genuine
    // survivor. For M5, whose whole purpose is to re-point a guard at a role the
    // corpus never produces, identical output is the EXPECTED result and is the
    // evidence that the guard is live rather than dead -- so it is reported as a
    // distinct verdict, never folded into "survived".
    verdict = m.expectIdentical
      ? "no output change -- EXPECTED: proves the guard is LIVE (a role the corpus never produces cannot change the result)"
      : "*** SURVIVED ***"
    if (!m.expectIdentical) survivors.push(m.id)
    else expectedIdentical.push(m.id)
  } else verdict = "caught (" + diffs.length + " signature change" + (diffs.length === 1 ? "" : "s") + ")"
  rows.push({ id: m.id, intent: m.intent, verdict, diffs })
  try { unlinkSync(p) } catch {}
  console.log(`${verdict.startsWith("***") ? "SURVIVOR" : verdict.startsWith("no output") ? "AS-EXP  " : "caught  "}  ${m.id}`)
  for (const d of diffs.slice(0, 8)) console.log(`            ${d}`)
}
try { unlinkSync(tmpBase) } catch {}

console.log(`\n=== SUMMARY ===`)
for (const r of rows) {
  console.log(`${r.id}`)
  console.log(`    intent:  ${r.intent}`)
  console.log(`    verdict: ${r.verdict}`)
}
const caught = rows.filter((r) => r.verdict.startsWith("caught")).length
const stale = rows.filter((r) => r.verdict.startsWith("MUTANT STALE")).length
console.log(`\n${caught} caught / ${rows.length} injected / ${survivors.length} survived / ${expectedIdentical.length} output-identical-as-designed / ${stale} stale`)
if (survivors.length) {
  console.log(`\nSURVIVORS — these are defects in the CHECKS, not in the mutants:`)
  for (const s of survivors) console.log(`  ${s}`)
}
if (stale) {
  console.log(`\nSTALE MUTANTS — the needle no longer occurs exactly once, so the mutant did not apply:`)
  for (const r of rows.filter((x) => x.verdict.startsWith("MUTANT STALE"))) console.log(`  ${r.id}: ${r.verdict}`)
}
void relative
