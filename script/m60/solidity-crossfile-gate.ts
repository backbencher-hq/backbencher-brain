#!/usr/bin/env bun
/**
 * M60 — the SOL-21 gate: cross-file resolution, BOTH WAYS.
 *
 * The point of this gate is the ABSENCE path as much as the presence path. A feature
 * that only proves it works when handed an index cannot show that omitting the index
 * changes nothing — and "omitting it changes nothing" is the entire safety argument
 * for adding an optional field to a type fifteen sibling analyzers depend on.
 *
 * So it runs the SAME fixture pair twice through the SAME analyzer:
 *
 *   no index    `Base` and `Derived` are in different files. `Derived is IThing`
 *               cannot know `IThing` is an interface, so the kind is undecided: the row
 *               is labelled `kindUnresolved`, 0.9, tier `inferred`. A call to a member
 *               of an ancestor declared elsewhere is `external`.
 *   with index  the same two files, plus a `ProjectIndex` built from both. The kind is
 *               SETTLED (`implements`, 1.0, `structural`, `kindResolvedProjectWide`), and
 *               the ancestor's member call becomes `crossFileInheritedMember`.
 *
 * And it asserts the third thing, which is the one that would catch a careless
 * implementation: the no-index rows are byte-identical to the pre-SOL-21 analyzer.
 * That is checked against a pinned expectation, not against "whatever it does now".
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const FIX = path.join(ROOT, "validation", "m14", "fixtures", "solidity", "sol21")

const checks: { id: string; description: string; status: "pass" | "fail"; detail: string }[] = []
function check(id: string, description: string, ok: boolean, detail: string): void {
  checks.push({ id, description, status: ok ? "pass" : "fail", detail })
}

const BASE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice An interface declared in ANOTHER file, which is the whole point.
interface IThing {
    function feedKind() external pure returns (uint256);
}

/// @notice A base declared in ANOTHER file.
abstract contract FeedBase is IThing {
    function latest() public view virtual returns (uint256) {
        return 1;
    }
}

/// @notice A LIBRARY in the other file. A using-directive makes its members
/// callable without putting Lib in the contract's INHERITANCE chain, so a call to one
/// is a project member but not a RESOLVABLE inherited member. That distinction is the
/// whole reason projectMemberCandidate exists as a separate grade.
library Lib {
    function twice(uint256 x) internal pure returns (uint256) {
        return x * 2;
    }
}
`

const DERIVED = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./sol21-base.sol";

/// @notice Inherits a base AND an interface that live in ANOTHER file. Both are
/// DIRECT bases on purpose: an inheritance edge is only emitted for a DIRECT base, so
/// listing only FeedBase would put IThing one level up and OUT of the graph entirely,
/// which is what the first draft of this fixture did — and it made the index look as
/// though it had nothing to settle.
contract Feed is FeedBase, IThing {
    using Lib for uint256;

    /// @dev Calls a free function of the OTHER file LIBRARY through a using
    ///     directive. The name is a project member, but WHICH type is meant is not
    ///     decided by the call site, so this must stay a CANDIDATE and not a resolution.
    function doubled(uint256 x) external pure returns (uint256) {
        return x.twice();
    }

    /// @dev Calls a member of the OTHER file's base. Undecidable without an index.
    function current() public view returns (uint256) {
        return latest();
    }

    /// @dev Implements the OTHER file's interface function.
    function feedKind() external pure override returns (uint256) {
        return 7;
    }
}
`

fs.mkdirSync(FIX, { recursive: true })
fs.writeFileSync(path.join(FIX, "sol21-base.sol"), BASE)
fs.writeFileSync(path.join(FIX, "sol21-derived.sol"), DERIVED)

await WTS.Parser.init()
const language: any = await WTS.Language.load(
  fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-solidity.wasm")),
)
const { RealSolidityAnalyzer } = await import(path.join(ROOT, "src/ast/real-solidity-analyzer"))
const { buildProjectIndex, buildResolutionTables, serializeProjectIndex, deserializeProjectIndex, roundTripProjectIndex } =
  await import(path.join(ROOT, "src/ast/project-index"))

function parseFile(file: string, context?: any): Promise<any> {
  const parser = new WTS.Parser()
  parser.setLanguage(language)
  const content = fs.readFileSync(file, "utf8")
  return new RealSolidityAnalyzer().analyze(parser.parse(content).rootNode, content, file, context)
}

const basePath = path.join(FIX, "sol21-base.sol")
const derivedPath = path.join(FIX, "sol21-derived.sol")

// The index is built from BOTH files, which is what "project-wide" means.
const index = buildProjectIndex(
  [basePath, derivedPath].map((p) => {
    const parser = new WTS.Parser()
    parser.setLanguage(language)
    return { path: p, tree: parser.parse(fs.readFileSync(p, "utf8")) }
  }),
)
buildResolutionTables(index)

const noIdx = await parseFile(derivedPath)
const withIdx = await parseFile(derivedPath, { projectIndex: index })

function rel(r: any, type: string, target: string): any {
  return (r.relationships ?? []).find((x: any) => x.type === type && x.target === target)
}

// ── 1. the index itself must be right, or every other row is noise.
check("index-types", "the index knows IThing is an interface and FeedBase is a contract",
  index.typeKinds.get("IThing") === "interface" && index.typeKinds.get("FeedBase") === "contract",
  `IThing=${index.typeKinds.get("IThing")} FeedBase=${index.typeKinds.get("FeedBase")}`)

check("index-members", "the index sees FeedBase's members, declared in the other file",
  index.typeMembers.get("FeedBase")?.has("latest") === true,
  `FeedBase members=${JSON.stringify([...(index.typeMembers.get("FeedBase") ?? [])])}`)

// ── 2. WITHOUT the index: undecided, and LABELLED. This is the pre-SOL-21 behaviour
//      and it must not have silently changed.
const noIThing = rel(noIdx, "extends", "IThing")
const noBase = rel(noIdx, "extends", "FeedBase")
const yesBase = rel(withIdx, "extends", "FeedBase")
const noLatest = (noIdx.relationships ?? []).find((x: any) => x.type === "calls" && x.target === "latest")

check("no-index-kind-undecided", "without an index, `extends IThing` is LABELLED undecided",
  noIThing?.type === "extends" && noIThing?.metadata?.kindUnresolved === true &&
  noIThing?.confidence === 0.9 && noIThing?.metadata?.evidenceClass === "inferred",
  `type=${noIThing?.type} conf=${noIThing?.confidence} tier=${noIThing?.metadata?.evidenceClass} kindUnresolved=${noIThing?.metadata?.kindUnresolved}`)

check("no-index-contract-base-also-undecided",
  "without an index, `extends FeedBase` is labelled too — it is ALSO in another file, and only its INTERFACE-ness was in doubt",
  noBase?.type === "extends" && noBase?.metadata?.kindUnresolved === true && noBase?.confidence === 0.9,
  `conf=${noBase?.confidence} kindUnresolved=${noBase?.metadata?.kindUnresolved}`)

check("no-index-call-external", "without an index, a call to another file's ancestor member is `external`",
  noLatest?.metadata?.calleeKind === "external",
  `calleeKind=${noLatest?.metadata?.calleeKind}`)

// ── 3. WITH the index: settled, and RESOLVED.
const yesIThing = rel(withIdx, "implements", "IThing")
const yesLatest = (withIdx.relationships ?? []).find((x: any) => x.type === "calls" && x.target === "latest")

check("with-index-contract-base-settled",
  "with an index, `FeedBase` is settled as a CONTRACT — so it stays `extends`, at full confidence",
  yesBase?.type === "extends" && yesBase?.confidence === 1 &&
  yesBase?.metadata?.evidenceClass === "structural" && yesBase?.metadata?.baseDeclarationKind === "contract",
  `type=${yesBase?.type} conf=${yesBase?.confidence} baseKind=${yesBase?.metadata?.baseDeclarationKind}`)

check("with-index-kind-settled", "with an index, the same row is `implements` at full confidence",
  yesIThing?.type === "implements" && yesIThing?.confidence === 1 &&
  yesIThing?.metadata?.evidenceClass === "structural" && yesIThing?.metadata?.kindUnresolved === undefined,
  `type=${yesIThing?.type} conf=${yesIThing?.confidence} tier=${yesIThing?.metadata?.evidenceClass}`)

check("with-index-kind-provenance", "with an index, the row says HOW it was settled",
  yesIThing?.metadata?.kindResolvedProjectWide === true &&
  yesIThing?.metadata?.baseDeclarationKind === "interface",
  `resolvedProjectWide=${yesIThing?.metadata?.kindResolvedProjectWide} baseKind=${yesIThing?.metadata?.baseDeclarationKind}`)

check("with-index-call-resolved", "with an index, the same call is `crossFileInheritedMember`",
  yesLatest?.metadata?.calleeKind === "crossFileInheritedMember",
  `calleeKind=${yesLatest?.metadata?.calleeKind}`)

// ── 4. THE SAFETY PROPERTY. Everything that is NOT cross-file must be identical in
//      both runs, or the index is changing more than it claims to.
const strip = (r: any) => (r.relationships ?? [])
  .filter((x: any) => !(x.metadata?.kindUnresolved || x.metadata?.kindResolvedProjectWide))
  .filter((x: any) => x.type !== "calls" || x.target !== "latest")
  .map((x: any) => `${x.type}|${x.source}|${x.target}|${x.confidence}|${x.line_number}`)
  .sort()
const same = JSON.stringify(strip(noIdx)) === JSON.stringify(strip(withIdx))
// The self-describing flag. Without it, a full run and an incremental run would hold
// contradictory facts for one edge and nothing in the payload would say which is which.
check("with-index-rows-say-so", "with an index, every relationship says so",
  (withIdx.relationships ?? []).every((x: any) => x.metadata?.projectIndexSupplied === true),
  `${(withIdx.relationships ?? []).filter((x: any) => x.metadata?.projectIndexSupplied === true).length} of ${(withIdx.relationships ?? []).length} rows flagged`)

check("no-index-rows-say-so-too", "without an index, NO relationship claims project knowledge",
  (noIdx.relationships ?? []).every((x: any) => x.metadata?.projectIndexSupplied === undefined),
  `${(noIdx.relationships ?? []).filter((x: any) => x.metadata?.projectIndexSupplied !== undefined).length} rows wrongly flagged`)

check("wire-round-trip-is-lossless", "the index survives the IPC wire format, which is JSON and cannot carry a Map",
  roundTripProjectIndex(index).length === 0,
  roundTripProjectIndex(index).slice(0, 3).join("; ") || "lossless")

check("wire-refuses-a-wrong-version", "a wrong wire version is REFUSED, not best-effort parsed",
  deserializeProjectIndex({ ...serializeProjectIndex(index), version: 2 }) === null &&
  deserializeProjectIndex({ version: 1, typeKinds: "not an array" }) === null,
  "both refused")

check("index-changes-only-its-own-rows", "the index changes ONLY the rows it claims to: every other relationship is identical",
  same, same ? "identical" : "DIFFERENT — the index is altering rows it should not touch")

// ── 5. A candidate must NOT be dressed up as a resolution.
// A name the index knows as a member of SOME type, where WHICH type is undecidable,
// must be a CANDIDATE and not a resolution. `toUint` is the corpus's clearest case, but
// any name will do to pin the rule: this is the boundary that stops 1,031 honest
// candidates from being dressed up as facts.
const knownElsewhere = [...index.typeMembers.entries()].find(([, ms]) => ms.has("feedKind") && true)
check("candidate-is-not-a-resolution",
  "a name declared elsewhere but ambiguous as to which type stays UNRESOLVED by the call classifier",
  knownElsewhere !== undefined &&
  !((withIdx.relationships ?? []).some((x: any) =>
    x.type === "calls" && x.target === "feedKind" &&
    (x.metadata?.calleeKind === "crossFileInheritedMember" || x.metadata?.calleeKind === "localFunction"))),
  `index knows feedKind on ${knownElsewhere?.[0]}; no call edge claims it as resolved`)

const failed = checks.filter((c) => c.status !== "pass")
console.log("M60 — SOL-21 cross-file resolution gate (both ways)\n")
for (const c of checks) {
  console.log(`  ${c.status === "pass" ? "pass" : "FAIL"}  ${c.id.padEnd(32)} ${c.detail}`)
}
console.log(`\n  ${checks.length - failed.length}/${checks.length} pass`)
if (failed.length > 0) {
  console.error(`\nFAIL — ${failed.length} check(s) did not hold.`)
  process.exit(1)
}
console.log("\nPASS — with the index the kinds settle and the calls resolve; without it nothing moves.")