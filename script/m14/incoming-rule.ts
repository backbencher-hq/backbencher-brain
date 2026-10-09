/**
 * THE INCOMING RULE, as an importable module.
 *
 * `incoming-gate.ts` is the arbiter: it discovers a population, walks it with the real
 * analyzer, and can exit non-zero. A census answers "why" about the same edges, and it must
 * count them the SAME way or the two numbers are about different questions. The rule
 * therefore lives here, imported by both, rather than being copied into a census — this
 * programme has already paid for copied rules twice (the kind-count vs declaration-count
 * ambiguity, and `incoming-check`'s published map that counted kinds).
 *
 * Everything in this file is PURE: it takes the key spaces it is given and returns an
 * outcome. Population discovery, parsing, scoping and reporting stay in the gate.
 */

/**
 * Metadata keys that mark an edge as naming something outside the corpus.
 *
 * An EXPLICIT list, not a heuristic, because "looks like a stdlib name" is exactly the
 * kind of inference that made `no-regex-gate.sh` report 187 where the truth was 5: a rule
 * that fires on shape convicts a correct analyzer. A lane must opt in, per key, and the
 * key must mean the same thing fleet-wide or the number is not comparable between lanes.
 *
 * `zigExternalRef` and `nimStdlibModule` are read from the committed analyzers:
 *   real-zig-analyzer.ts zigExternalReceiverPath — p30's numbers were RE-DERIVED on
 *     2026-10-09 and the citation below was stale in BOTH halves. Same draw rule as p30
 *     (`find <root> -name '*.zig' | sort | head -400`), one process per arm:
 *       marked edges           5,009 -> 4,688
 *       recoverable (leaf published)  2,189 -> 8,021
 *     and the gate's verdict on the marks was 565 marked edges = extOK 306 · extFAIL 259,
 *     where EVERY refuted claim has exactly ONE dot and every 2+ dot claim verifies
 *     (1 dot: 1 ok / 259 refuted · 2 dots: 223/0 · 3 dots: 60/0 · 4 dots: 21/0 · 5 dots: 1/0).
 *     So the mechanism is sound where the owner is itself qualified and over-reaches where
 *     the owner is a single segment the project may well publish — the lane's own
 *     `external-claim-audit.ts` names the declaration answering each refuted claim.
 *     Artifacts: validation/m14/fixtures/zig/measurements/{incoming-abc-400-p30.json,
 *     external-claim-audit*}; re-derivation in commit 41c5e4e43.
 *   real-nim-analyzer.ts  meta.nimStdlibModule, RE-DERIVED 2026-10-10 with
 *     `npx tsx validation/m14/fixtures/nim/external-marker-rederive.ts --sample 400` over the
 *     5,846-file nim corpus (400 parsed, production `parseFile`, production's per-project
 *     resolution scope): the marker ships on 365 edges in that draw, 100% of them `std/`-shaped,
 *     and **350 of the 809** `imports` edges declared nowhere in their own project are marked —
 *     43.3%, against the 13.6% the original sentence recorded (66 of 485).
 *
 *     THE TWO POPULATIONS ARE NOT THE SAME MEASUREMENT and must not be compared as one: the
 *     original was measured by the lane's own whole-corpus probe, which resolves a target
 *     against per-repo `.nim` stems AND whole-corpus symbol names; the re-derivation uses the
 *     PROJECT scope the gate's verdict is about, which is strictly narrower. Both halves of the
 *     original sentence moved, so it is replaced rather than amended — a citation that has been
 *     superseded twice in one session (zig, then nim) is the reason these cells carry dates.
 */
// The binding separator is a FAMILY constant (src/ast/types.ts) rather than a local copy: the
// analyzer spells a binding with it and this rule checks that spelling, so two definitions
// would be two rules and the arbiter's copy would be the one that mattered.
import { BINDING_SEP } from "../../src/ast/types"

export const EXTERNAL_KEYS = [
  "zigExternalRef",
  "nimStdlibModule",
  "isExternal",
  "isExternalTarget",
  "external",
  "externalRef",
  "isStdlib",
  "stdlibModule",
  "moduleNamingEdges",
  "markAsExternal",
  // dart: the first-heritage fallback in `real-dart-analyzer.ts`, which fires only where
  // NO evidence refutes the base (the base is a name this run cannot see) and only for a
  // member carrying the `@override` annotation. Named `isExternalBase` rather than one of
  // the generic spellings because it marks a BASE, not a target: the marked row still
  // names a member, and that member is still required to exist (see the Object retarget).
  "isExternalBase",
  // dart: `importOutsideProject`, the IMPORT/EXPORT claim — different in kind from every key
  // above, and handled by its own verification below. The others claim "the declaration this
  // target names is not in the population", which the key space itself can check (look the
  // owner up). This one claims "the FILE this specifier names is not in this project", which
  // no symbol lookup can check: a specifier is a path, so it is verified against the
  // project's own pubspec files and its admitted file list. Same rule, different evidence.
  "importOutsideProject",
]

/**
 * WHAT A MARKER CLAIMS — because "external" is not one claim, and one check cannot verify two.
 *
 *   owner        the target names a declaration whose OWNER the project does not publish.
 *                Verified by looking the owner up in the name table (`verifyExternalClaim`).
 *   projectFacts the target names a FILE the project does not contain (a package its
 *                pubspec files do not declare, an SDK library it does not carry, a scheme
 *                that is not a path at all). Verified against the project's own facts.
 *
 *   binding      the target names a BINDING — a local, parameter or lambda parameter — which
 *                the family contract publishes no symbol for (DARTD8). There is nothing to
 *                look up and nothing to find: verified against the TARGET'S OWN SPELLING
 *                (`BINDING_SEP` present, and the part after it non-empty), and refuted the
 *                moment the target names a declaration, because that is exactly the state the
 *                spelling exists to make impossible.
 *
 * The kind is decided by WHICH KEY marked the edge, not by the shape of the target: a
 * `package:` target could in principle carry either claim, and choosing the check by shape
 * would be guessing at what the analyzer meant.
 */
export type ExternalClaim =
  | { kind: "owner" | "projectFacts" | "binding" }
  // THE FILE CLAIM — "this target names an admitted FILE", checked against the project's own file
  // list. `candidates` is every spelling the loader's conventions produce, because which one the
  // loader will use is a property of the loader and not of the source (see `FILE_CLAIM_KEY`).
  | { kind: "projectFile"; candidates: string[] }
  // THE REFERENCE CLAIM — `<owner>/<repo>@<ref>` or `docker://…`, verified by the spelling and
  // refuted by the key space (see `REMOTE_REF_CLAIM_KEY`).
  | { kind: "remoteRef" }
  // BUCKET 3 — A DECLARED CAUSE, and deliberately NOT an external claim.
  //
  // `base` is the reason the analyzer states (`baseBeyondRunScope`'s value: the heritage base
  // this run could not reach) and `conflict` says the edge ALSO carries an external claim,
  // which is the one pairing the rule refuses outright.
  | { kind: "cause"; base: string | null; conflict: boolean }

/**
 * The marker key that means "the target names a BINDING, not a declaration".
 *
 * A third claim kind, because it is verifiable by NOTHING the other two use. `owner` and
 * `projectFacts` both ask the project about the thing the target DEPENDS ON; a binding claim
 * says the target has no dependency to find — the family contract publishes no locals,
 * parameters or lambda parameters as symbols (DARTD8), so the string can never name a
 * declaration, and the only thing to check is whether the SPELLING says so.
 *
 * The spelling is `<callable><BINDING_SEP><binding>` (`BINDING_SEP`, src/ast/types.ts). The
 * separator is U+0000, and it was `#` until 2026-10-09: `#` cannot appear in an IDENTIFIER, but
 * the tripwire below is over PUBLISHED KEYS, and nine of laptop B's 23 lanes publish keys that
 * contain it — a CSS ID selector is written `#sidebar`, a markdown label `code_block#2`, an HCL
 * address `aws#2.region`, a TOML key `units#2.name`. In each of those runs EVERY binding claim
 * was unverifiable, because a target carrying `#` could name a real declaration. U+0000 cannot
 * appear in a key structurally: keys are built from tree-sitter node text, and a NUL byte
 * terminates a source document rather than naming anything in it.
 *
 * So presence of the separator is a fact about the string, and "no published key contains the
 * separator" is a fact about the key space, asserted once per run (see `separatorFreeKeys` — a
 * population tripwire, not a per-edge lookup, because the key space is still being built while
 * the walk classifies).
 */
export const BINDING_CLAIM_KEY = "localBinding"

/** The marker key that means "the FILE is outside this project". Checked after the binding
 *  claim: both are specific, and an edge carrying both is verified on the binding spelling
 *  first because that one is a statement about the target itself. */
export const IMPORT_CLAIM_KEY = "importOutsideProject"

/**
 * THE FILE CLAIM: "the target names a FILE this project admits".
 *
 * A FIFTH claim kind, and it exists because the other four cannot accept one shape: a target that
 * is a relative FILE PATH with an extension. Measured on the yaml lane's `!include <path>` tag
 * applications (`functions: !include "s1/functions/functions.yaml"` in Hasura's metadata
 * testdata), the path is a real dependency on a real file, and every existing bucket REFUSES it:
 *
 *   owner       -> `targetOwner` is `s1/functions/functions`, which is not identifier-shaped, so
 *                  the claim is unverifiable (`verifyExternalClaim`), which blocks a PASS;
 *   cause       -> accepted only when the reason is an identifier EQUAL to the target's owner, so
 *                  a path is REFUTED rather than declared (`classifyEdge`);
 *   projectFacts-> `verifyImportClaim` reads `package:` and `dart:` payloads only;
 *   binding     -> `#`-spelled callables, nothing to do with a file's name.
 *
 * So this is the missing arbiter: the claim is checked against THE PROJECT'S OWN FILE LIST, which
 * the gate builds from the unsampled admitted corpus (`ProjectFacts.files`, repo-relative POSIX
 * paths). It is a claim about the PROJECT, so the project can and does refute it.
 *
 * CANDIDATES, NOT ONE PATH, and that is the honest shape rather than a convenience: a YAML
 * `!include` path is resolved by the LOADER, and the corpus contains two live conventions —
 * Hasura writes include paths relative to the INCLUDING FILE's directory
 * (`metadata/databases/databases.yaml` includes `s1/functions/functions.yaml`, and
 * `metadata/databases/s1/functions/functions.yaml` is the file), while pyyaml-include's test data
 * writes them relative to the REPO ROOT (`tests/data/0.yaml` includes
 * `tests/data/include.d/1.yaml`). Both were read off the corpus, not assumed. The analyzer cannot
 * know which loader will run, so it states the candidates and the project decides: VERIFIED when
 * ANY candidate is an admitted file (the dependency is confirmed and the spelling ambiguity is
 * irrelevant), REFUTED when NONE is (then the include names something this project does not have,
 * which is a finding, not a pass).
 *
 * WHAT KEEPS IT FROM BEING A LAUNDERING HOLE. It is read only where the target names NOTHING in
 * the key space, so it can never raise `resolved`; it is REFUTED by the project's own file list
 * rather than accepted from the analyzer's word; and the gate builds the same list for every lane
 * that admits the claim, from the same unsampled population the verdict is about.
 */
export const FILE_CLAIM_KEY = "importProjectFile"

/**
 * THE REFERENCE CLAIM: "the target is a REFERENCE, not a declaration" — verified by its SPELLING,
 * and refuted outright if the key space answers it.
 *
 * A SIXTH claim kind, and it exists because one shape is checkable by nothing the project owns but
 * is nevertheless checkable: a pinned reference to code that lives outside the corpus. MEASURED
 * over this corpus's workflow files: **7,265 remote action uses** (`actions/checkout@v6`,
 * `r-lib/actions/setup-r@v2`, `owner/repo/path@ref`) and **13 `docker://` images**. Their targets
 * have no identifier-shaped owner to look up (`targetOwner` splits on the last `.` and these have
 * none), and they name no file in the project, so every existing bucket reads them UNVERIFIABLE —
 * which blocks a PASS while telling nobody anything.
 *
 * The mechanism is the BINDING claim's (`BINDING_CLAIM_KEY`), applied to a different string, and it
 * is the same two-sided check:
 *
 *   1. THE SPELLING decides whether the claim is even admissible — a remote ref is
 *      `<owner>/<repo>[<subpath>]@<ref>` with no whitespace, a non-empty ref after the LAST `@`, at
 *      least one segment before it, and a docker ref is `docker://<image>`. A broken edge such as
 *      `Foo.Bar` cannot carry this claim, so it cannot be used to excuse one.
 *   2. THE KEY SPACE can REFUTE it: an edge marked this way whose target IS a published declaration
 *      is refuted rather than verified. "Nothing here answers this name" is the fact being claimed,
 *      and the population is the thing that knows.
 *
 * WHAT IT DOES NOT DO: it never raises `resolved` (it is read only where the target names nothing),
 * and it does not claim the referenced action EXISTS — nothing in this corpus can check a GitHub
 * repository. What it states, checkably, is that the target is a reference and not a declaration,
 * which is what makes the edge's own metadata honest instead of a gap wearing a marker.
 */
export const REMOTE_REF_CLAIM_KEY = "remoteRef"

/**
 * BUCKET 3'S MARKER: "the base this edge names is beyond THIS RUN's reach".
 *
 * A DIFFERENT CLAIM FROM `isExternalBase`, and the difference is the whole reason the column
 * exists. `isExternalBase` says "the population does not contain this" — a claim about the
 * PROJECT, which the arbiter verifies against the project's key space. `baseBeyondRunScope`
 * says "the run that wrote this edge could not look" — a claim about the RUN, which no lookup
 * in a bigger key space can confirm or deny: the gate HAVING the base is not evidence the
 * analyzer did.
 *
 * MEASURED 2026-10-09, per-file (production's population — `parallel-indexer.ts`
 * PROJECT_INDEX_EXTENSIONS names only `.sol`, so a `.dart` file is parsed with no context at
 * all): of the `isExternalBase` claims the arbiter examined, 16,894 were REFUTED and 10,731
 * verified. The refutations are not analyzer bugs — they are the analyzer being asked a
 * question only an index can answer, which is what the two-population split in
 * `docs/analyzers/real-dart-analyzer.md` records.
 *
 * WHAT KEEPS IT FROM BEING A LAUNDERING HOLE. Three properties, each one checkable by the
 * arbiter rather than by the analyzer that wrote it, and none of them a matter of trust:
 *
 *   1. It can NEVER raise `resolved`. It is read only where the target names NOTHING in the
 *      key space, so it can only ever re-label an edge that is already a gap.
 *   2. It is MUTUALLY EXCLUSIVE with every claim in `EXTERNAL_KEYS`. An edge carrying both is
 *      `causeRefuted` before the count is even read — "I could not see it" and "it is outside
 *      the population" are two different books on one edge, and that pair is what a lane would
 *      write to be verified AND excused at once.
 *   3. Its REASON is checked against its own target: `base` must be an identifier and must BE
 *      the target's owner, so the stated cause has to be the edge's own base rather than a
 *      sentence attached to whatever was convenient.
 *
 * The fourth property the contract requires — a SECOND IMPLEMENTATION agreeing that this base
 * really is unreachable — is not implemented here and is not claimed to be: it is the oracle
 * half of the bucket-3 contract, and until it exists the column is a reported, non-scoring
 * count rather than a verified one. Said here so the column cannot be read as stronger than it is.
 */
export const CAUSE_CLAIM_KEY = "baseBeyondRunScope"

export function externalClaimOf(rel: any): ExternalClaim | null {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return null
  // Checked FIRST, and it is the one claim whose evidence is the target's own spelling rather
  // than a lookup: an edge carrying it says "do not look this up, it is a binding". A lane
  // cannot launder a gap with it — the claim is refuted outright when the target names a
  // declaration (see `classifyEdge`).
  if (md[BINDING_CLAIM_KEY] === true) return { kind: "binding" }
  // The file claim is checked before the population claims, and the order is a decision: an edge
  // that says "this names an admitted file" is making a statement the project can CHECK, while
  // "this is outside the project" is the weaker, unverifiable-for-paths statement about the same
  // target. Routing to the checkable one is what keeps a lane from being excused by the weaker
  // marker it could attach to the same edge.
  if (md[REMOTE_REF_CLAIM_KEY] === true) return { kind: "remoteRef" }
  const fileClaim = md[FILE_CLAIM_KEY]
  if (typeof fileClaim === "string" && fileClaim.length > 0) {
    return { kind: "projectFile", candidates: [fileClaim] }
  }
  if (Array.isArray(fileClaim)) {
    const candidates = fileClaim.filter((c: any): c is string => typeof c === "string" && c.length > 0)
    if (candidates.length > 0) return { kind: "projectFile", candidates }
  }
  if (md[IMPORT_CLAIM_KEY] === true) return { kind: "projectFacts" }
  const cause = md[CAUSE_CLAIM_KEY]
  const hasCause = typeof cause === "string" && cause.length > 0
  for (const k of EXTERNAL_KEYS) {
    if (k === IMPORT_CLAIM_KEY) continue
    if (md[k] === true || (Array.isArray(md[k]) && md[k].length > 0)) {
      // BOTH BOOKS ON ONE EDGE. Reported as a CAUSE rather than as an external claim so the
      // conflict is visible in bucket 3's own column; the conflict flag is what the rule
      // refutes on, and it is refuted BEFORE the count is read (see `classifyEdge`).
      if (hasCause) return { kind: "cause", base: cause, conflict: true }
      return { kind: "owner" }
    }
  }
  if (hasCause) return { kind: "cause", base: cause, conflict: false }
  return null
}

/** Is this edge declared as naming something outside the corpus? */
export function isMarkedExternal(rel: any): boolean {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return false
  for (const k of EXTERNAL_KEYS) {
    if (md[k] === true) return true
    // `moduleNamingEdges` is an ARRAY of such flags on some lanes; presence counts.
    if (Array.isArray(md[k]) && md[k].length > 0) return true
  }
  return false
}

export type Outcome =
  | "resolved" | "ambBoth" | "ambDeclOnly" | "unresolved"
  | "externalVerified" | "externalRefuted" | "externalUnverified"
  // A BINDING's outcomes are their own, and are NOT the external ones. A verified binding is
  // not a resolution (nothing was resolved — there is nothing to resolve to) and not a gap
  // either (nothing is missing), so folding it into either column would misstate one of two
  // different things. The lane reports it in its own column, and `bindingRefuted` counts
  // against the lane exactly as `externalRefuted` does.
  | "bindingVerified" | "bindingRefuted" | "bindingUnverified"
  // BUCKET 3 speaks in its own outcomes for the same reason bindings do: a declared cause is
  // not a resolution (nothing was resolved) and not a gap (the reason is stated), so folding
  // it into either column would misstate one of two different things. It is reported in its
  // own column and NEVER raises `resolved`; `causeRefuted` is a claim-integrity defect and is
  // counted against the lane.
  | "causeDeclared" | "causeRefuted"

/**
 * IS THE TARGET SPELLED AS A BINDING? The one check whose evidence is the target itself.
 *
 * Measured before it was built (`validation/m14/fixtures/dart/local-read-phantom.ts`): a
 * function's own `counter`, published as the bare name, was bound by the store's own rule to
 * an unrelated class's field in another file, because `resolveRelationships` matches a target
 * by NAME and never reads this metadata. The separator is the fix's whole mechanism, so this
 * function's job is to make a spelling that lost it impossible to pass quietly:
 *
 *   bindingVerified    the target carries `BINDING_SEP` and names something after it.
 *   bindingRefuted     the target carries NO separator. A marked edge whose target could be a
 *                      declaration's name is the defect this round exists to remove, and
 *                      "refuted" is the outcome that counts against the lane.
 *   bindingUnverified  a separator with nothing after it (`run#`) — a spelling no producer in
 *                      this family writes, and one no binding can be read out of. Counted,
 *                      never merged into either of the other two.
 */
export function verifyBindingClaim(tgt: string): Outcome {
  const at = tgt.lastIndexOf(BINDING_SEP)
  if (at < 0) return "bindingRefuted"
  return at === tgt.length - 1 ? "bindingUnverified" : "bindingVerified"
}

/**
 * WHAT THE PROJECT ITSELF SAYS, for verifying an IMPORT claim.
 *
 * Built by the caller from the project's own files (never from the analyzer's opinion of
 * them), because a claim verified by its author is not verified:
 *   packages  every package name the project's `pubspec.yaml` files declare;
 *   files     every project-relative path the project ADMITS (tracked, present, under the
 *             analyzer's size cap) — the population, not the filesystem;
 *   sdkLib    whether the project carries an SDK at all (`sdk/lib`).
 */
export type ProjectFacts = {
  packages: Set<string>
  files: Set<string>
  sdkLib: boolean
}

/**
 * CAN THE PROJECT REFUTE AN IMPORT CLAIM?
 *
 * The analyzer refuses to turn a specifier into a path for two different reasons, and only
 * one of them is a claim: a package the checkout does not declare is OUTSIDE it, while a
 * declared package whose file is missing is a DANGLING INTERNAL reference — the analyzer
 * marks the first and not the second, and this function would refute the second if a lane
 * ever marked it, which is the point.
 *
 *   VERIFIED      the package is not declared here / the SDK file is not here. The project
 *                 has looked for what this import depends on and does not have it.
 *   REFUTED       the project DOES contain it, so "outside this project" is false and the
 *                 edge is reported as the defect it is (this is the check that catches an
 *                 analyzer resolving a path key it should have resolved already).
 *   UNVERIFIABLE  the target is not a `package:`/`dart:` specifier at all (another scheme,
 *                 or a shape neither side can turn into a path). Counted, never merged.
 */
/**
 * CAN THE PROJECT REFUTE A FILE CLAIM?
 *
 * VERIFIED    at least one candidate spelling is in the project's admitted file list, so the
 *             dependency the edge asserts is confirmed by evidence the analyzer never saw. The
 *             spelling ambiguity is dissolved rather than resolved: which loader convention the
 *             file will be read by does not change the fact that the project has the file.
 * REFUTED     no candidate is admitted: the project has looked for the file this edge depends on
 *             and does not have it. This is a finding about the edge, and it is counted.
 *
 * `verifyImportClaim` below is a DIFFERENT function on purpose — it answers package/SDK questions
 * from a lane's own conventions, and folding a path check into it would make one function two
 * rules, which is the shape this programme keeps paying for.
 */
export function verifyFileClaim(
  facts: ProjectFacts,
  candidates: string[],
): "externalVerified" | "externalRefuted" {
  for (const c of candidates) if (facts.files.has(c)) return "externalVerified"
  // A DIRECTORY the project fills COUNTS, and the reason is the dependency's own shape: a local
  // GitHub action (`./ci-actions/.github/actions/setup`, 501 of them in this corpus) is a DIRECTORY
  // — the thing that pulls its `action.yml` in is what the edge depends on — so an exact-file test
  // would refute every one of them while the project plainly has them. Admission is by PREFIX, and
  // the prefix is a whole path segment so `ci/x` cannot be satisfied by `ci/xy/z.yml`.
  //
  // Cost: one pass over the project's admitted files per candidate directory. Only edges that name
  // a directory reach it (nothing else does — a file candidate returns above), so this is bounded
  // by the local-action population rather than by the corpus.
  for (const c of candidates) {
    const prefix = c + "/"
    for (const f of facts.files) if (f.startsWith(prefix)) return "externalVerified"
  }
  return "externalRefuted"
}

/**
 * IS THE SPELLING A PINNED REFERENCE? The arbiter's half of the claim, and it reads the string
 * only — no corpus, no project, no analyzer.
 *
 *   `docker://hashicorp/terraform:1.9`      -> a container image
 *   `actions/checkout@v6`                  -> a pinned remote action
 *   `r-lib/actions/setup-r-dependencies@v2` -> a subpath inside a remote action's repository
 *
 * REFUSED, and each refusal is a shape a wrong edge could wear:
 * `./local/action` (a project path, which carries the FILE claim instead), a bare `Foo.Bar`
 * (no `/` before the `@`, so nothing about it is a reference), a URI with a scheme
 * (`https://x` — an external reference claims nothing about a project path and is verified by the
 * owner claim), whitespace anywhere, and an empty owner, repo or ref.
 */
export function verifyRemoteRefClaim(tgt: string): "externalVerified" | "externalUnverified" {
  if (tgt.startsWith("docker://")) return tgt.length > "docker://".length ? "externalVerified" : "externalUnverified"
  if (/\s/.test(tgt)) return "externalUnverified"
  if (tgt.includes("://")) return "externalUnverified"
  if (tgt.startsWith(".") || tgt.startsWith("/")) return "externalUnverified"
  const at = tgt.lastIndexOf("@")
  if (at <= 0 || at === tgt.length - 1) return "externalUnverified"
  const left = tgt.slice(0, at)
  const ref = tgt.slice(at + 1)
  if (ref.includes("/")) return "externalUnverified"
  if (!left.includes("/")) return "externalUnverified"
  for (const seg of left.split("/")) if (seg.length === 0) return "externalUnverified"
  return "externalVerified"
}

export function verifyImportClaim(
  facts: ProjectFacts,
  tgt: string,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  const raw = tgt.endsWith(":*") ? tgt.slice(0, -2) : tgt
  if (raw.startsWith("package:")) {
    const rest = raw.slice("package:".length)
    const slash = rest.indexOf("/")
    if (slash <= 0) return "externalUnverified"
    const pkg = rest.slice(0, slash)
    if (pkg.length === 0) return "externalUnverified"
    return facts.packages.has(pkg) ? "externalRefuted" : "externalVerified"
  }
  if (raw.startsWith("dart:")) {
    const lib = raw.slice("dart:".length)
    if (lib.length === 0) return "externalUnverified"
    // The SDK's layout, exactly as the analyzer resolves it. A project WITH the file is
    // refuted even if the analyzer's own `sdkLib` probe missed it — the file is the evidence.
    return facts.files.has(`sdk/lib/${lib}/${lib}.dart`) ? "externalRefuted" : "externalVerified"
  }
  return "externalUnverified"
}

/**
 * The owner segment of a qualified target: everything before the FINAL dot.
 *
 * `Object.hashCode` -> `Object`; `package:flutter/material.dart:*` -> a non-identifier,
 * which is the point of returning it rather than a cleaned-up guess.
 */
export function targetOwner(tgt: string): string | null {
  const dot = tgt.lastIndexOf(".")
  if (dot <= 0) return null
  return tgt.slice(0, dot)
}

/**
 * CAN THE POPULATION REFUTE THE CLAIM? An external marker is a claim the corpus can check,
 * and a gate that accepts it unverified is a gate that can be laundered: mark every
 * unresolved edge external and `unresolved` reads 0. So the claim is verified here.
 *
 *   VERIFIED   the target's OWNER is not published anywhere in the key space. The corpus
 *              has looked for the declaration this edge depends on and does not have it —
 *              that is what "outside the declared population" means, measured.
 *   REFUTED    the key space DOES publish the owner. The claim "this names something outside
 *              the corpus" is then false about the owner, and the edge is reported as what
 *              it is: unresolved. It is never counted clean.
 *   UNVERIFIABLE  the target has nothing identifier-shaped to look up (a module URI such
 *              as `package:flutter/material.dart:*`, a path, or a member spelling like
 *              `operator ==`). The index cannot confirm or deny, so this is a THIRD bucket —
 *              visible, counted, and deliberately not merged into either of the other two.
 *
 *              A BARE UNQUALIFIED NAME USED TO LAND HERE, AND THAT WAS WRONG. The old rule
 *              required a DOTTED owner (`targetOwner` = everything before the last dot), so
 *              a target with no dot could never be verified — and since a PASS requires
 *              `externalUnverified === 0`, a PASS was UNREACHABLE for every lane whose
 *              targets are bare names, however honest its marking. Three lanes proved it
 *              independently in one session: php (2,478 of 2,483 unresolved targets have no
 *              dot — 2,321 bare, 157 backslash-qualified), bash (every command is a bare
 *              name), fsharp. The lane cannot fix that by marking differently; the rule had
 *              to be fixed.
 *
 *              A bare name IS checkable, and by the same fact the owner lookup uses: the key
 *              space counts a symbol under BOTH its `name` and its `qualifiedName`
 *              (incoming-gate.ts `countKey`), so "does any declaration carry this name" is a
 *              question the population answers directly. Note what this can and cannot do:
 *              the claim is consulted only where `decls === 0` (classifyEdge), so for a bare
 *              target the direct lookup returns 0 by construction — this makes VERIFIED
 *              REACHABLE, it can never turn a resolved edge into anything else, and it cannot
 *              manufacture a REFUTED. The path/URI case is untouched and still unverifiable.
 *
 * Calibrated on this programme's own record: `docs/analyzers/INCOMING-WORKLIST.md` says an
 * unmarked external "counts against a lane, because a genuinely-external target and a
 * broken edge are otherwise indistinguishable". This keeps that standard and adds the
 * missing half — a marked one must still survive a lookup.
 */
export function verifyExternalClaim(
  declCount: Map<string, number>,
  tgt: string,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  const owner = targetOwner(tgt)
  // NO DOTTED OWNER: ask about the TARGET ITSELF when it is a plain identifier, and stay
  // unverifiable when it is not (a path or URI cannot be a published symbol's name, so a
  // lookup returning 0 would prove nothing about the claim).
  if (owner === null) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tgt)) return "externalUnverified"
    return (declCount.get(tgt) ?? 0) > 0 ? "externalRefuted" : "externalVerified"
  }
  // `:`, `/` or whitespace means the owner is not an identifier — a URI scheme, a path, or
  // a member spelling like `operator ==`. No published symbol can be keyed by it, so a
  // lookup would return 0 for a reason that has nothing to do with the claim.
  if (/[:/\s]/.test(owner)) return "externalUnverified"
  return (declCount.get(owner) ?? 0) > 0 ? "externalRefuted" : "externalVerified"
}

export type Classified = {
  outcome: Outcome
  /** how many declarations answer to the target IN THIS KEY SPACE */
  decls: number
  /** the distinct kinds among them, `|`-joined — empty when there are none */
  kinds: string
  /** WHICH evidence confirmed a verified external claim — reported so a lane can audit the
   *  mechanism that produced the number, not only the number. */
  verifiedBy?: "owner" | "target" | "projectFacts" | "binding" | "spelling"
}

/**
 * THE ONE RULE. Measurement and control both call this, because two copies of a counting
 * rule are two rules, and the copy the control runs is the one that stays correct.
 */
export function classifyEdge(
  declCount: Map<string, number>,
  kinds: Map<string, Set<string>>,
  tgt: string,
  claim: ExternalClaim | null,
  /** the project's own facts, for a `projectFacts` claim. Absent means the check could not
   *  be run at all, and the claim is then UNVERIFIABLE — never quietly accepted. */
  facts?: ProjectFacts,
): Classified {
  const decls = declCount.get(tgt) ?? 0
  const kindSet = kinds.get(tgt)
  const kindText = [...(kindSet ?? [])].sort().join("|")
  // A BINDING CLAIM IS CHECKED BEFORE THE COUNT, and that ordering is the whole point: the
  // claim says "this target names a binding, not a declaration", so the moment the key space
  // answers the target with a declaration the claim is FALSE — even though the edge would
  // otherwise read as a happy `resolved`. That is the defect measured in
  // `local-read-phantom.ts`: a bare local name, of which the project declares exactly one,
  // counted as resolved while naming a field of an unrelated class.
  if (claim !== null && claim.kind === "binding") {
    if (decls > 0) return { outcome: "bindingRefuted", decls, kinds: kindText }
    const outcome = verifyBindingClaim(tgt)
    return { outcome, decls, kinds: kindText, verifiedBy: outcome === "bindingVerified" ? "binding" : undefined }
  }
  // THE REFERENCE CLAIM, checked before the count for the binding claim's own reason: the claim says
  // "this is not a declaration", so a declaration that answers the target REFUTES it — even though
  // the edge would otherwise read as a happy `resolved`. The refutation is the interesting half:
  // it is what stops a lane from marking a name the project actually declares.
  if (claim !== null && claim.kind === "remoteRef") {
    if (decls > 0) return { outcome: "externalRefuted", decls, kinds: kindText }
    const outcome = verifyRemoteRefClaim(tgt)
    return {
      outcome, decls, kinds: kindText,
      verifiedBy: outcome === "externalVerified" ? "spelling" : undefined,
    }
  }
  if (claim !== null && claim.kind === "cause" && claim.conflict) {
    // The count is deliberately not consulted: the defect is in the EDGE's own metadata (it
    // claims to be both outside the population and beyond this run) and it is exactly as wrong
    // on a resolvable target as on an unresolvable one.
    return { outcome: "causeRefuted", decls, kinds: kindText }
  }
  if (decls === 0) {
    if (claim === null) return { outcome: "unresolved", decls, kinds: kindText }
    if (claim.kind === "cause") {
      // READ ONLY WHERE THE TARGET NAMES NOTHING — property 1 of `CAUSE_CLAIM_KEY`: a declared
      // cause can only re-label a gap, never turn one into a resolution, so this column cannot
      // move a resolution number in either direction. The two spelling checks are the arbiter's
      // (property 3): the reason must be identifier-shaped and must be the target's own owner.
      const shaped = typeof claim.base === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(claim.base)
      const owner = targetOwner(tgt)
      const consistent = shaped && owner === claim.base
      return { outcome: consistent ? "causeDeclared" : "causeRefuted", decls, kinds: kindText }
    }
    if (claim.kind === "projectFacts") {
      if (!facts) return { outcome: "externalUnverified", decls, kinds: kindText }
      const outcome = verifyImportClaim(facts, tgt)
      return { outcome, decls, kinds: kindText, verifiedBy: outcome === "externalVerified" ? "projectFacts" : undefined }
    }
    if (claim.kind === "projectFile") {
      // NO FACTS MEANS NO CHECK, and an unchecked claim is never clean — the same rule the
      // project-facts branch above states. This is what a lane sees when it emits the claim to a
      // caller that did not build a project's file list (a fixture runner, say), and it is the
      // honest reading: the claim may well be true, and nothing here can say so.
      if (!facts) return { outcome: "externalUnverified", decls, kinds: kindText }
      const outcome = verifyFileClaim(facts, claim.candidates)
      return { outcome, decls, kinds: kindText, verifiedBy: outcome === "externalVerified" ? "projectFacts" : undefined }
    }
    const outcome = verifyExternalClaim(declCount, tgt)
    // WHICH MECHANISM CONFIRMED IT, kept apart on purpose. A dotted target is verified
    // through its OWNER; a bare identifier through the TARGET itself (see
    // verifyExternalClaim). Sharing one label would let a control for one mechanism pass
    // while the other is broken — the failure this file's reference-spelling counter was
    // added to stop, recorded at `verifiedByRefSpelling` in incoming-gate.ts.
    const viaTarget = targetOwner(tgt) === null
    return {
      outcome, decls, kinds: kindText,
      verifiedBy: outcome === "externalVerified" ? (viaTarget ? "target" : "owner") : undefined,
    }
  }
  if (decls > 1) {
    return { outcome: (kindSet?.size ?? 0) > 1 ? "ambBoth" : "ambDeclOnly", decls, kinds: kindText }
  }
  return { outcome: "resolved", decls, kinds: kindText }
}

/**
 * ONE SCOPE'S TALLY. The gate reports two, because "resolved" is not a property of an edge
 * on its own — it is a property of an edge AGAINST A KEY SPACE, and the two key spaces
 * answer two different questions (see `PROJECT SCOPE` in `incoming-gate.ts`).
 */
export type Outcomes = {
  /** targets resolving to exactly one published declaration */
  resolved: number
  /** targets naming MORE THAN ONE published declaration — the number that matters */
  ambiguousByDecl: number
  /** the same targets, counted by DISTINCT KIND — incoming-check's metric, for comparison */
  ambiguousByKind: number
  /** targets naming nothing published and NOT declared external */
  unresolved: number
  /** targets naming nothing published but carrying an external marker — the claim, total */
  markedExternal: number
  /** of those: the owner is absent, so the claim survives */
  externalVerified: number
  /** of `externalVerified`: confirmed by the owner lookup */
  externalVerifiedByOwner: number
  /** of `externalVerified`: confirmed by the project's own pubspec files and file list */
  externalVerifiedByProjectFacts: number
  /** targets spelled as a BINDING (`<callable><BINDING_SEP><binding>`) and not naming a declaration */
  bindingVerified: number
  /** marked as a binding but spelled so it CAN name a declaration — counted against the lane */
  bindingRefuted: number
  /** a separator with nothing after it: countable, but no binding can be read out of it */
  bindingUnverified: number
  /** of those: the target has no identifier-shaped owner to check */
  externalUnverified: number
  /** of those: the key space publishes the owner, so the claim is FALSE and the edge is not clean */
  externalRefuted: number
  /** the colliding TARGET STRINGS, so the gap is a list a lane can act on */
  ambiguousNames: { name: string; declarations: number; kinds: string }[]
  unresolvedNames: { name: string; type: string }[]
  /**
   * BUCKET 3 — edges whose target names nothing in this key space and whose analyzer stated a
   * cause (`baseBeyondRunScope`) instead of claiming the base is outside the population.
   *
   * NOT A RESOLUTION AND NOT COUNTED AS ONE: nothing was resolved. Reported beside
   * `bindingVerified` for the same reason — a class of edges that is honest to emit, dishonest
   * to fold into a resolution number. See `CAUSE_CLAIM_KEY` for what it may and may not claim.
   */
  causeDeclared: number
  /**
   * A DECLARED CAUSE THE RULE REFUTES — its stated base is not an identifier, is not the
   * target's own owner, or the edge carries an external claim at the same time. Counted
   * against the lane, exactly as `bindingRefuted` and `externalRefuted` are, so bucket 3 cannot
   * be written onto edges whose stated reason does not check out.
   */
  causeRefuted: number
  /** the declared causes' spellings, so the bucket is a list a lane can audit and not just a
   *  number — capped like every other name list. */
  causeNames: { name: string; type: string }[]
  /**
   * THE REFUTED CLAIMS, BY NAME — its own list, and it is not a convenience.
   *
   * `externalRefuted` is the ONE column that says a claim is FALSE, and it is counted against the
   * lane, so a reader who sees `4` and cannot see WHICH four has exactly one available response:
   * re-run the whole lane hoping they appear. MEASURED 2026-10-09 on a whole riverpod run: the
   * report printed `extFAIL 4` and not one of the four names, because `unresolvedNames` is capped
   * at 25 and ordinary `unresolved` rows fill it first (and the worklist prints only four names per
   * type on top of that). A cap exists so one pathological name cannot produce a 40,000-line
   * report; it must not be able to swallow the outcome a lane has to ACT on. Filled only by
   * `externalRefuted`, so no other bucket can crowd it out.
   */
  refutedNames: { name: string; type: string }[]
}

export const emptyOutcomes = (): Outcomes => ({
  resolved: 0, ambiguousByDecl: 0, ambiguousByKind: 0, unresolved: 0,
  markedExternal: 0, externalVerified: 0, externalVerifiedByOwner: 0, externalVerifiedByProjectFacts: 0,
  externalUnverified: 0, externalRefuted: 0,
  bindingVerified: 0, bindingRefuted: 0, bindingUnverified: 0,
  causeDeclared: 0, causeRefuted: 0,
  ambiguousNames: [], unresolvedNames: [], refutedNames: [], causeNames: [],
})

/**
 * COUNT IT WHERE IT BELONGS — one rule, called once per scope, so the two columns can never
 * drift into being two rules.
 */
export function tally(out: Outcomes, c: Classified, tgt: string, label: string): void {
  switch (c.outcome) {
    case "resolved":
      out.resolved++
      break
    case "ambDeclOnly":
    case "ambBoth":
      out.ambiguousByDecl++
      if (c.outcome === "ambBoth") out.ambiguousByKind++
      if (out.ambiguousNames.length < 25) {
        out.ambiguousNames.push({ name: tgt, declarations: c.decls, kinds: c.kinds })
      }
      break
    case "externalVerified":
      out.markedExternal++
      out.externalVerified++
      if (c.verifiedBy === "projectFacts") out.externalVerifiedByProjectFacts++
      else out.externalVerifiedByOwner++
      break
    case "externalUnverified":
      out.markedExternal++
      out.externalUnverified++
      break
    case "bindingVerified":
      out.bindingVerified++
      break
    case "bindingUnverified":
      out.bindingUnverified++
      break
    case "bindingRefuted":
      // NOT `unresolved` (that column means "carries no claim at all") and NOT clean. It is
      // the one outcome that says the SPELLING is wrong, and the verdict counts it as bad.
      out.bindingRefuted++
      if (out.unresolvedNames.length < 25) {
        out.unresolvedNames.push({
          name: `${tgt}   [binding claim REFUTED — the target can name a declaration]`,
          type: label,
        })
      }
      break
    case "externalRefuted":
      // NOT `unresolved` (that column means "carries no external claim") and NOT clean
      // (that column means "names exactly one declaration"). It is its own thing, and
      // the verdict counts it as bad, so a lane cannot mark its way to a PASS.
      out.markedExternal++
      out.externalRefuted++
      // INTO ITS OWN LIST FIRST, so the cap below can never be the reason a refuted claim is
      // invisible. Both lists are kept: `unresolvedNames` goes to the worklist that orders by
      // type, and this one is printed whole by the report.
      if (out.refutedNames.length < 25) out.refutedNames.push({ name: tgt, type: label })
      if (out.unresolvedNames.length < 25) {
        out.unresolvedNames.push({
          name: `${tgt}   [external claim REFUTED — the population publishes ${targetOwner(tgt)}]`,
          type: label,
        })
      }
      break
    case "causeDeclared":
      // ITS OWN COLUMN, and never `resolved` — nothing was resolved. The lane reports it
      // beside `bindingVerified` so a reader sees how much of the graph rests on a stated
      // cause, which is the opposite of what folding it into a resolution number would do.
      out.causeDeclared++
      if (out.causeNames.length < 25) out.causeNames.push({ name: tgt, type: label })
      break
    case "causeRefuted":
      // A CLAIM-INTEGRITY DEFECT, counted against the lane like every other refuted claim: the
      // stated cause either does not name this edge's own base or the edge also claims to be
      // outside the population. It is NOT `unresolved` — that column means "carries no claim" —
      // and it is never clean.
      out.causeRefuted++
      if (out.refutedNames.length < 25) {
        out.refutedNames.push({ name: `${tgt}   [declared cause REFUTED]`, type: label })
      }
      if (out.unresolvedNames.length < 25) {
        out.unresolvedNames.push({
          name: `${tgt}   [declared cause REFUTED — the stated base is not this edge's own owner]`,
          type: label,
        })
      }
      break
    case "unresolved":
      out.unresolved++
      // NAME IT. A count a lane cannot resolve back to the things it counted leaves
      // the only response as re-running the whole lane hoping to see it again — and
      // it is not guaranteed to reproduce. This is the population rule applied to the
      // verdict itself, and it is capped per type so one pathological name (a
      // stdlib function used 40,000 times) cannot produce a 40,000-line report.
      if (out.unresolvedNames.length < 25) out.unresolvedNames.push({ name: tgt, type: label })
      break
  }
}
