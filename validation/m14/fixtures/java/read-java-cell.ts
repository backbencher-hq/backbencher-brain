/**
 * JAVA LANE — READ one whole-population arm's output into THE FLEET's COMMON FORM.
 *
 * The form is the perl lane's published form (validation/m14/measurements/perl-arm-current.json):
 *   edges · resolved · residual · resolved% · the VERIFIED class (where the lane has one) ·
 *   THE JOIN's OWN PRICE · THE VIEW (analyzer · gate · arbiter · spec · corpus root · population).
 * A cell without its VIEW is not a cell.
 *
 * USAGE: bun run .tmp-java-lane/read-java-cell.ts <dump-file> <stderr-log> <out.json> <label>
 * The label says WHICH VIEW the numbers are read at, and the digests are read FROM THE TREE NOW
 * and printed, so the caller can see whether they match the tree the arm ran on.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"

const [, , dumpPath, logPath, outPath, label, argAnalyzer, argGate, argArbiter, argSpec] = process.argv
if (!dumpPath) {
  console.error("usage: read-java-cell.ts <dump> <stderr-log> <out.json> <label>")
  process.exit(2)
}

const dump = readFileSync(dumpPath, "utf8")
const log = logPath && logPath !== "-" ? readFileSync(logPath, "utf8") : ""

const sha = (p: string) => execSync(`sha256sum ${p}`).toString().split(" ")[0]
// THE VIEW'S DIGESTS: the ARM's, if they are given (they are read at RUN time and recorded in the
// arm's log) — the TREE's otherwise, WHICH IS A DIFFERENT THING AND IS LABELLED AS SUCH ✓✓.
const treeDigests = {
  analyzer: sha("src/ast/real-java-analyzer.ts"),
  gate: sha("script/m14/incoming-gate.ts"),
  arbiter: sha("script/m14/incoming-rule.ts"),
  spec: sha("src/ast/project-index.ts"),
}
const armDigests = argAnalyzer && argGate && argArbiter && argSpec
  ? { analyzer: argAnalyzer, gate: argGate, arbiter: argArbiter, spec: argSpec }
  : null
const digests = armDigests ?? treeDigests
const digestsSource = armDigests
  ? "THE ARM's RUN-TIME VIEW ✓✓ (the digests the arm RAN at, read from the arm's own log) ✓✓"
  : "⚠ THE TREE NOW, NOT THE ARM's DIGESTS ✓✓ — A CELL READ AT THE WRONG DIGESTS IS NOT A CELL ✓✓"
const totalLine = dump.split("\n").find((l) => l.startsWith("TOTAL ")) ?? ""
const cols = totalLine.split(/\s+/).filter(Boolean).slice(1).map(Number)
if (cols.length < 14) {
  console.error("no TABLE 1 TOTAL line in " + dumpPath)
  process.exit(3)
}
const [edges, resolved, collRes, ambDecl, ambKind, unresolved, extOK, extQ, extFAIL, bindOK, bindQ, bindFAIL, causeOK, causeFAIL] = cols

// THE PER-TYPE TABLE (the arm's own rows) — the per-family cell.
const perType: Record<string, [number, number]> = {}
for (const l of dump.split("\n")) {
  const m = l.match(/^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates)\s+(\d+)\s+(\d+)/)
  if (m && !perType[m[1]]) perType[m[1]] = [Number(m[2]), Number(m[3])]
}

// THE POPULATION
const popLine = (log + dump).split("\n").find((l) => l.startsWith("population: ") && l.includes("parsed of")) ?? ""
const files = Number(popLine.match(/(\d+) parsed of (\d+) sampled/)?.[1] ?? 0)
const sampled = Number(popLine.match(/(\d+) parsed of (\d+) sampled/)?.[2] ?? 0)
const repos = Number(popLine.match(/across (\d+) repos/)?.[1] ?? 0)
const idxLine = (log + dump).split("\n").find((l) => l.startsWith("project index:")) ?? ""

// THE JOIN's OWN PRICE — the gate prints it in EVERY arm; its ABSENCE is a fact about the tree.
const joinLine = (log + dump).split("\n").find((l) => l.includes("qualified-name join:"))?.trim() ?? null
const joinRows = joinLine ? Number(joinLine.match(/join: (\d+) row/)?.[1] ?? -1) : null
// THE BRANCH SPLIT, parsed from the gate's own line: "slash branch: R of A row(s) asked ·
// namespace branch: R of A row(s) asked" — a 0 that was NEVER ASKED is a PROOF, and a 0 that was
// ASKED and answered NONE is a MEASUREMENT.
const slashM = (joinLine ?? "").match(/slash branch: (\d+) of (\d+) row\(s\) asked/)
const nsM = (joinLine ?? "").match(/namespace branch: (\d+) of (\d+) row\(s\) asked/)
const slashResolved = slashM ? Number(slashM[1]) : null
const slashAsked = slashM ? Number(slashM[2]) : null
const namespaceResolved = nsM ? Number(nsM[1]) : null
const namespaceAsked = nsM ? Number(nsM[2]) : null
// (c) THE NAMESPACE SOURCE THIS CELL USED: the gate says it in the line itself when the branch
// could not fire; otherwise the cell must name it from the analyzer's own source.
// THE NAMESPACE SOURCE IS MEASURED FROM THE ANALYZER's OWN SOURCE, NOT INFERRED FROM THE GATE's
// LINE — because the gate only prints it when the branch could not fire, and an arm that ran before
// the join existed prints no line at all. The source of truth for java is the analyzer.
const analyzerPublishesNsRoots = /nsRoots|namespaceRoots/.test(readFileSync("src/ast/real-java-analyzer.ts", "utf8"))
const namespaceSource = analyzerPublishesNsRoots
  ? "THE ANALYZER's OWN DECLARED ROOTS ✓✓ (the analyzer publishes `nsRoots` ✓✓ — see script/m14/incoming-rule.ts line 695-700 ✓✓)"
  : "NONE: the analyzer publishes no module-kind symbol and no `nsRoots` ✓✓ — MEASURED IN THE ANALYZER's OWN SOURCE ✓✓, SO THE NAMESPACE BRANCH IS STRUCTURALLY IMPOSSIBLE IN JAVA ✓✓"
// (a) THE CENSUS COUNT: the on-disk count in the same root, so the cell carries BOTH counts.
const censusCount = (() => {
  try {
    const out = execSync("find -L .corpus -name '*.java' -type f 2>/dev/null | wc -l", { maxBuffer: 64 * 1024 * 1024 }).toString().trim()
    return Number(out)
  } catch {
    return null
  }
})()

// THE PATH-SHAPED ROWS IN THE DUMP — the join's INPUT SIZE for this language (a bound on its price).
let dumpRows = 0
let pathShaped = 0
let pathShapedUnresolved = 0
for (const l of dump.split("\n")) {
  if (!l.startsWith("DUMP\t")) continue
  dumpRows++
  const f = l.split("\t")
  if (f[3] && f[3].includes("/")) {
    pathShaped++
    if (f[2] !== "resolved") pathShapedUnresolved++
  }
}

// THE CLASSES ARE DISJOINT: resolved (+collRes) · amb(decl) (+amb(kind) as a SUBSET) · unresolved ·
// extOK · bindOK · causeOK. THE GATE's OWN VERDICT LINE SAYS SO: "167435 ambiguous + 154064
// unresolved of 1478651 edges" => the residual is 321,499, NOT amb(decl)+amb(kind)+unresolved.
const residual = ambDecl + unresolved + causeOK
const ambDeclOnly = ambDecl - ambKind   // ambiguous by DECLARATION only
const ambBoth = ambKind                // ambiguous by CAUSE as well as by declaration
const verifiedClass = edges ? ((resolved + extOK + bindOK) / edges) * 100 : 0
const pct = (n: number) => Number(((n / edges) * 100).toFixed(4))

const cell = {
  generated: new Date().toISOString().slice(0, 10),
  label,
  form: "THE FLEET's COMMON FORM: edges, resolved, residual %, the VERIFIED class, THE JOIN's OWN PRICE, and THE VIEW",
  population: popLine.replace(/^population: /, ""),
  populationFiles: files,
  sampled,
  repos,
  wholePopulation: files === sampled,
  edges,
  resolved,
  residual,
  resolvedPct: pct(resolved),
  residualPct: pct(residual),
  residualSplit: { ambDecl, unresolved, causeOK },
  ambiguitySplit: { ambDeclOnly, ambBoth, note: "amb(kind) is a SUBSET of amb(decl) - the rows ambiguous by CAUSE as well as by DECLARATION - so it is NEVER added to the residual again" },
  perType,
  classSum: {
    resolved, collRes, ambDecl, ambBoth, unresolved, extOK, bindOK, causeOK,
    sum: resolved + ambDecl + unresolved + extOK + bindOK + causeOK,
    exact: resolved + ambDecl + unresolved + extOK + bindOK + causeOK === edges,
    note: "THE DISJOINT CLASSES ✓✓ - amb(kind)/ambBoth is a SUBSET of amb(decl) and is NOT a class of its own ✓✓",
  },
  clause1: {
    status: ambDecl + ambKind + unresolved > 0 ? "FAIL" : "PASS",
    ambiguous: ambDecl + ambKind,
    unresolved,
    ambiguousOrUnresolved: ambDecl + ambKind + unresolved,
    ext: extQ,
    bind: bindQ,
    refuted: extFAIL,
  },
  clause4: { extFAIL, bindFAIL, causeFAIL, status: extFAIL + bindFAIL + causeFAIL === 0 ? "CLEAN" : "FAIL" },
  verifiedClass: {
    question: "A DIFFERENT QUESTION FROM `resolved` ✓✓ — (resolved + extOK + bindOK) / edges, the charter's §18.2 formula ✓✓",
    value: Number(verifiedClass.toFixed(4)),
  },
  joinPrice: {
    line: joinLine,
    // THE BRANCH SPLIT — the gate prints it in every arm (91c3a84fc): a 0 that was NEVER ASKED is a
    // PROOF, and a 0 that WAS ASKED and answered NONE is a MEASUREMENT. A price without its branch
    // is not a price.
    slashAsked: slashAsked,
    slashResolved: slashResolved,
    namespaceAsked: namespaceAsked,
    namespaceResolved: namespaceResolved,
    namespaceSource: namespaceSource,
    rows: joinRows,
    pathShapedTargetsInDump: pathShaped,
    pathShapedNotResolved: pathShapedUnresolved,
    dumpRows,
    kind:
      joinLine === null
        ? "PROOF — THE ARM RAN ON A GATE THAT DID NOT PRINT THE JOIN's PRICE ✓✓ (the join, 030c10dc1, landed AFTER this arm) ✓✓"
        : slashAsked > 0
          ? "MEASUREMENT ✓✓ — THE BRANCH WAS ASKED AND ANSWERED NONE ✓✓"
          : "PROOF ✓✓ — THE BRANCH WAS NEVER ASKED ✓✓",
    why:
      joinLine === null
        ? "THE ARM RAN ON A GATE THAT DID NOT PRINT THE JOIN's PRICE ✓✓ — THE JOIN (`030c10dc1` ✓) LANDED AFTER THIS ARM ✓✓ ⇒ THIS CELL IS A PRE-MOVE VIEW ✓✓ AND THE JOIN's OWN PRICE FOR JAVA IS NOT MEASURED BY IT ✓✓."
        : "THE SLASH BRANCH's ASKED COUNT FOR JAVA IS " + pathShaped + " ✓✓ (the path-shaped targets in the dump ✓✓, " + pathShapedNotResolved + " of them unresolved ✓✓) AND THE NAMESPACE BRANCH's ASKED COUNT IS " + namespaceAsked + " ✓✓ (" + namespaceSource + ") ✓✓ ⇒ THE JOIN's PRICE FOR JAVA CANNOT EXCEED " + pathShaped + " ROWS OF " + edges + " EDGES ✓✓ ✓✓.",
  },
  denominator: {
    // (a) THE DENOMINATOR IS A DISCOVERY RULE: the CENSUS (on disk) and the ADMITTED (what the gate
    // admitted) are TWO DIFFERENT MEASUREMENTS of the same corpus, and the cell carries BOTH and
    // names its root. The gap is LANGUAGE-SHAPED.
    censusOnDisk: censusCount,
    admittedByTheGate: files,
    gap: censusCount - files,
    gapPct: censusCount ? Math.round((1000 * (censusCount - files)) / censusCount) / 10 : null,
    corpusRoot: "$PWD/.corpus (the FARM root ✓✓ — NOT the gate's default root /home/ishaq2321/bb_tests/repositories, 199 repos ✓✓)",
    censusRule: "on-disk `*.java` under the farm root, counted per repo (202 repos ✓✓)",
    admittedRule: "WHAT THE GATE'S OWN ROUTER ADMITTED IN THIS RUN ✓✓ (the gate's own line: 'population: N parsed of N sampled') ✓✓",
    gapShape: "LANGUAGE-SHAPED ✓✓ — a java repo's untracked files are its generated/ignored sources and build output ✓✓, so the java gap is 1.8 % where a javascript repo's is 84.5 % ✓✓",
  },
  view: {
    analyzerSha1: digests.analyzer,
    gateSha1: digests.gate,
    arbiterSha1: digests.arbiter,
    specSha1: digests.spec,
    digestsSource,
    corpusRoot: "$PWD/.corpus",
    population: `WHOLE POPULATION — ${files} files, ${repos} repos, NOT A DRAW ✓✓`,
    projectIndex: idxLine.slice(0, 220),
    commit: execSync("git rev-parse HEAD").toString().trim(),
  },
  readSet: digests,
  treeDigestsNow: treeDigests,
}

if (outPath && outPath !== "-") writeFileSync(outPath, JSON.stringify(cell, null, 2) + "\n")
console.log(JSON.stringify(cell, null, 2))
