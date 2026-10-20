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
  /**
   * THE `owner` CLAIM MAY CARRY ITS SPECIFIER, because a specifier is what makes the claim CHECKABLE against
   * the project's own module space. Analyzers were already publishing `metadata.externalSpecifier` on these
   * edges and NOTHING read it — so a claim true of the symbol key space could be false of the project, which
   * is exactly the hole this field closes (see `projectModuleNames`).
   */
  | { kind: "owner"; specifier?: string }
  /**
   * THE `module:item` CLAIM — a language whose import spelling names a MODULE and an ITEM with a colon
   * (`pathlib:Path`, `xml.sax.handler:ContentHandler`), which no existing kind can verify: `namespace`
   * needs dots, `owner` hits the colon, `importPath` needs a dotted capitalised leaf.
   *
   * IT IS `moduleNamespace` AND NOT A FLAG ON `owner` because the VERIFICATION DIFFERS: where an `owner`
   * claim is answered through the TARGET, this one is answered through a MODULE PATH — a directory/file
   * space, not a declaration space. Sharing a kind would let a control for one pass while the other broke.
   *
   * THE VERDICT IS A PURE FUNCTION OF THE PROJECT'S ADMITTED FILE LIST and can therefore be refuted by a
   * run — the property that decides whether a claim may exist at all. It is nonetheless VERIFY-NEVER-REFUTE
   * in production: the module present in the project's module space becomes `externalUnverified` (`ext?`),
   * so `extFAIL` cannot rise by construction and a project-absolute import can never be laundered external.
   */
  | { kind: "moduleNamespace"; module: string }
  | { kind: "projectFacts" } | { kind: "binding" }
  // THE IMPORTED-BINDING CLAIM (2026-10-19): the target is a local name bound by an import of
  // `specifier`; verified from the run's own import edges (see IMPORTED_BINDING_CLAIM_KEY).
  // The position discriminator distinguishes a TARGET-position claim (the edge's target IS the
  // imported binding) from a RECEIVER-position claim (the target is a MEMBER LEAF and the receiver
  // ROOT is the imported binding; JS receiver-position contract 2026-10-19). Same evidence kind,
  // same binding column — one mechanism, one verification, one column.
  | { kind: "importedBinding"; specifier: string; binding: string; position?: "target" | "receiver" }
  // THE IMPORTED-NAME CLAIM: the target is a name this file imports from `specifier` (no local alias).
  | { kind: "importedName"; specifier: string; name: string }
  // THE EXPORT-SURFACE CLAIM: an exports row names the export surface, not a declaration.
  | { kind: "exportSurface"; surface: "default"; form: string; localName?: string }
  | { kind: "exportSurface"; surface: "moduleExports"; property: string; form: string }
  // THE FILE CLAIM — "this target names an admitted FILE", checked against the project's own file
  // list. `candidates` is every spelling the loader's conventions produce, because which one the
  // loader will use is a property of the loader and not of the source (see `FILE_CLAIM_KEY`).
  | { kind: "projectFile"; candidates: string[] }
  // THE REFERENCE CLAIM — `<owner>/<repo>@<ref>` or `docker://…`, verified by the spelling and
  // refuted by the key space (see `REMOTE_REF_CLAIM_KEY`).
  | { kind: "remoteRef" }
  // THE NAMESPACE CLAIM — the target's ROOT is a language namespace, and `roots` IS the analyzer's
  // declared list. Checked against that list INSTEAD of the symbol table; see NAMESPACE_CLAIM_KEY
  // for the four required properties and the four lanes' measurements that produced the design.
  | { kind: "namespace"; roots: string[]; strictAbsent?: boolean; slash?: boolean }
  // THE PACKAGE-SCOPE CLAIM — the target names a member of a DEPENDENCY THIS PROJECT DECLARES, and
  // the claim is about the project's own MANIFEST (go.mod's require lines, package.json,
  // pyproject/requirements, Cargo.toml, composer.json, pubspec.yaml). It exists because the fleet
  // measured that the biggest un-resolvable wall is a VOCABULARY wall, not a typing wall: the dart
  // lane priced 84.9% of its 16,395 unresolved `uses` rows as "members of types the PROJECT DOES
  // NOT DECLARE" (only 155 = 0.9% addressable by any evidence class), and the C++ lane's bucket D
  // (122,227 rows) is the same class. For those rows there is no declaration for any evidence class
  // to point at — the only true statement available is "this name belongs to a package the project
  // depends on", and THAT is a project fact.
  | { kind: "packageScope"; package: string; name: string; position?: "target" | "receiver" }
  // THE OWNER-MEMBER-ABSENCE CLAIM: a verifiable statement that a known owner type declares no
  // member of the row's target name. Checked against the caller's ownerMembers evidence, never the
  // claim's own word; read only where the name model has nothing (decls === 0).
  | { kind: "ownerMemberAbsent"; owner: string; member: string }
  // THE SOURCE-PATH CLAIM — evidence is the WRITTEN SOURCE STRING as the document spells it, and the
  // verdict is the inverse of a file claim: a candidate the project admits REFUTES it.
  | { kind: "sourcePath"; sources: string[] }
  // THE MODULE-PATH IMPORT CLAIM (task-168) — SYNTHESIZED BY THIS RULING LAYER, not carried by the
  // analyzer. An `imports` edge whose target is a DOTTED MODULE PATH ending in a TYPE name
  // (`java.util.List`, `org.grails.compiler.injection.GrailsASTUtils`) names a package/module, and the
  // arbiter's refutation key for it is the OWNER — everything before the last dot, i.e. a PACKAGE PATH,
  // which a project almost never declares as a symbol. So the claim is VERIFIABLE rather than assumed:
  // `verifyExternalClaim` checks the owner against the project key space, and a project that DOES declare
  // it refutes the claim, which is exactly the safety net this layer exists to provide.
  //
  // WHY HERE AND NOT IN THE ANALYZER: deciding this needs the PROJECT key space, and a per-file analyzer
  // does not have it. The java analyzer documents the same refusal in `markExternalTargets` — "they are
  // *probably* the platform types, and 'probably' is what this marker must not say".
  //
  // NARROWED DELIBERATELY TO A CAPITALISED LEAF, so that lowercase module paths other lanes emit
  // (`os.path`, `json.parser`) are untouched: those lanes' key spaces can declare a module symbol of the
  // same name, which would REFUTE the claim and turn a resolution gap into a new clause-4 defect.
  | { kind: "importPath" }
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

/**
 * THE IMPORTED-BINDING CLAIM — "this target is a local name bound by an import of `specifier`".
 *
 * A distinct claim kind from `binding`, because its EVIDENCE differs: a local binding is verified by
 * the target's own spelling (`BINDING_SEP`), while an imported binding is verified by the RUN'S OWN
 * IMPORT EVIDENCE — the file's import edge publishes the local names it binds
 * (`metadata.importedBindings`), and the arbiter checks the claimed name against that list. The use
 * edge's own word is NOT accepted as evidence (claim + evidence from one author is not a check).
 *
 * Outcomes are the binding family's (`bindingVerified`/`bindingRefuted`/`bindingUnverified`): an
 * imported binding is still NOT a resolution — nothing was resolved to a declaration — so it lands in
 * `bindOK` and never in `resolved`. REFUTED when the key space answers the name (then the import
 * claim is false and a real resolution should have happened) and when the file's import evidence does
 * not bind that name; UNVERIFIED when no evidence was built for the run.
 */
export const IMPORTED_BINDING_CLAIM_KEY = "importedBinding"

/**
 * THE EXPORT-SURFACE CLAIMS — `defaultExport` and `moduleExports` (2026-10-19, JS lane contract
 * `JAVASCRIPT-EXPORTS-CLAIM-CONTRACT.md`). An `exports` row can name an export SURFACE rather than
 * a declaration: ESM's public name is the literal `default` (`export default …`), and CommonJS's
 * surface is the property written on `module.exports`/`exports`. Neither names a declaration, so
 * neither can resolve by name — treating the identifier beside `export default` as a public name
 * fabricates one (JD-J14's family; measured 2,759 statements / 2,755 files corpus-wide).
 *
 * The claim is verified from the EXTERNAL key space, not from the claim's own word: the target must
 * BE `default` (or the claimed property), the form must be one the family defines, a named/alias/
 * expression default must carry a localName the run's declarations can see, and a moduleExports
 * property must NOT be a name the project declares (a real declaration wins). Outcomes ride the
 * BINDING family (nothing resolves; the claim asserts a surface) with
 * `verifiedBy: "exportSurface"` — counted in `bindOK`, NEVER in `resolved`.
 */
/**
 * THE IMPORTED-NAME CLAIM — "this target names a NAME imported from `specifier`" (2026-10-19).
 *
 * The mirror of the imported-binding claim for languages whose imports bring a NAME into scope
 * without a local-binding spelling (`from module import Item` — the row's target IS the imported
 * name, e.g. python's `Optional`, a dart SDK type, a C++ symbol). Evidence is the file's OWN import
 * evidence: an `imports` edge whose module/specifier is `specifier` and whose item name is the
 * target. Verified from THAT map, never from the row's own word; outcomes ride the binding family
 * (nothing resolves to a declaration — the name is an import binding) and NEVER raise `resolved`.
 */
export const IMPORTED_NAME_CLAIM_KEY = "importedName"

export const DEFAULT_EXPORT_CLAIM_KEY = "defaultExport"
export const MODULE_EXPORTS_CLAIM_KEY = "moduleExports"
/** The forms the analyzer may state; a form outside these sets is REFUTED (never a blanket excuse). */
export const DEFAULT_EXPORT_FORMS = ["named-declaration", "export-alias", "expression", "anonymous"]
export const MODULE_EXPORTS_FORMS = ["module-exports-object", "exports-object", "module-exports-binding", "module-exports-expression", "deep-member-assignment"]

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

/**
 * THE NAMESPACE CLAIM — the capability four lanes measured as missing, built from the authorized
 * design (`docs/analyzers/HANDOFF.md:654-668`, "THE DESIGN FOR THE MISSING CLAIM KIND"):
 *
 *   *"A namespace claim — 'this target's ROOT is a language namespace, not a declaration' —
 *    carrying the analyzer's root list as its evidence, so the verifier checks the root against
 *    THAT list and never against the symbol table."*
 *
 * WHY IT EXISTS. `verifyExternalClaim` verifies externality by NOT FINDING the target
 * (`decls === 0`) and refutes by finding one (`decls > 0`), and `classifyEdge` reaches the
 * verifier only inside the `decls === 0` branch — so a claim is either unfalsifiable or refuted
 * the moment the project happens to ship the thing. Four lanes converged on that wall with
 * measured counts: toml 10 · yaml 833 · protobuf 2,621 (37 of whose declared-namespace claims
 * were REFUTED, which is why that fix was reverted) · hcl 65,771. **A builtin NAMESPACE and a
 * project DECLARATION can share a spelling, and the owner test cannot tell them apart**
 * (HANDOFF:648-655, where the same claim was measured to add "29 false externalities").
 *
 * THE FOUR PROPERTIES THE DESIGN REQUIRES, each implemented rather than described:
 *
 *   1. REFUTABLE. A target whose ROOT is not in the declared list reads `externalRefuted` — the
 *      property that stops this becoming the laundering vector this file's own docstring warns
 *      about ("mark every unresolved edge external and `unresolved` reads 0"). The check NEVER
 *      consults the symbol table: the list is the sole authority, so a project that ships
 *      `google.protobuf` cannot refute a claim that does not list it, and a target whose root the
 *      analyzer did not declare cannot be sheltered by the claim.
 *   2. THE LIST IS PART OF THE CLAIM. `metadata.languageNamespace` is a non-empty array of root
 *      strings on the edge itself, so widening it is a visible, reviewable act by the lane — a
 *      reviewer diffs one array, not an opaque boolean.
 *   3. A DISTINCT CLAIM KIND (`kind: "namespace"`), not a flag on the external marker, so a
 *      reader can see WHICH mechanism verified what (`verifiedBy: "namespace"`).
 *   4. CROSS-TABBED LIKE ANY OTHER CLAIM — it flows through the same `ExternalClaim` union, the
 *      same `classifyEdge`, the same ambiguous-edge disposition table and the same counters, and
 *      it is counted in `extOK` / `extFAIL` exactly as the other kinds are.
 *
 * IT IS ADDITIVE: `externalClaimOf` returns this kind ONLY when the key is present, and no
 * analyzer emitted it before hcl adopted it, so a lane that does not use it is behaviourally
 * unchanged — which is what makes a fleet-level file safe to extend for one lane.
 */
export const NAMESPACE_CLAIM_KEY = "languageNamespace"

/**
 * THE NAMESPACE POLICY MARKER (`languageNamespacePolicy === "strict-absent"`, 2026-10-19).
 *
 * The cpp lane's own pre-committed falsifier fired on its first citation arm: `std::move` claims
 * displaced 12,883 name-model resolutions (duckdb declares its own `move` in namespace duckdb, so the
 * name model bound a project declaration while the source spelling says `std::move`). The decoy
 * reading is correct, but the discipline is not re-scoped after the fact: a claim may not displace a
 * NAME-MODEL answer. So the lane emits this marker beside `languageNamespace`, and the arbiter then
 * honors the namespace claim ONLY where the run declares nothing for the target (`decls === 0`,
 * the imported-name precedent) — otherwise the claim falls through and the name model keeps its
 * answer. The rule is LANE-SCOPED by the marker, so java/C/dart/python citation arms are untouched.
 */
export const NAMESPACE_POLICY_KEY = "languageNamespacePolicy"

/**
 * THE SLASH-SEPARATOR OPT-IN (`languageNamespaceSlash === true`, 2026-10-19).
 *
 * Go module paths are written with `/` (`encoding/json`, `io/ioutil`), and `namespaceMatchOf` splits
 * on `.`/`::`/`:` only — so no namespace claim could cite a Go path (measured:
 * `namespaceMatchOf("encoding/json", ["encoding"]) === null`). A GLOBAL separator change would alter
 * every existing lane's namespace matching (accepted java/c/python/dart/cpp citation arms are
 * records we do not want to disturb), so this is OPT-IN: only a claim carrying this marker splits on
 * `/`. Without it every other lane is byte-identical. Safety stays the lane's: CLOSED stdlib root
 * set, imports-only emission — no shape heuristic ("no dot => stdlib" would claim project-internal
 * paths; measured `internal/util`).
 */
export const NAMESPACE_SLASH_KEY = "languageNamespaceSlash"

/**
 * THE PACKAGE-SCOPE CLAIM KEY (`packageScope = {package, name}`, 2026-10-20).
 *
 * WHAT IT STATES: "this target is a member of the DEPENDENCY named `package`, and this project
 * declares that dependency." The evidence is the PROJECT's own manifest, not the analyzer's word
 * and not a lane-maintained vocabulary — so the claim is REFUTABLE by the checkout: a name from a
 * package the project does not depend on cannot be claimed, and the arbiter says so.
 *
 * WHY IT EXISTS, MEASURED: the fleet's largest un-resolvable class is a VOCABULARY wall, not a
 * typing wall. The dart lane priced 84.9% of its 16,395 unresolved `uses` rows as "members of types
 * the PROJECT DOES NOT DECLARE" — only 155 (0.9%) is addressable by any evidence class, because for
 * the other 84.9% there is NO DECLARATION for an evidence class to point at. The C++ lane's bucket D
 * (122,227 rows of 614,081) is the same class. The only true statement available for those rows is
 * "this name belongs to a package this project depends on", and the manifest is what can check it.
 *
 * WHY IT IS NOT THE NAMESPACE CLAIM: a namespace claim cites a CLOSED list the lane maintains (a
 * stdlib's roots) — a statement about the LANGUAGE. A package-scope claim cites the CHECKOUT's own
 * dependency list — a statement about the PROJECT. The difference is precisely where the laundering
 * risk lives: a vocabulary that grows to cover whatever the corpus contains can claim anything,
 * while a manifest can only confirm what the project itself declared.
 *
 * THE FOUR PROPERTIES (the namespace claim's own requirements, applied here):
 *   1. The claim is a DISTINCT KIND, never a flag on the generic external marker, so a reader can
 *      see WHICH mechanism verified what (`verifiedBy: "packageScope"`).
 *   2. The LIST IS PART OF THE CLAIM — `package` names the dependency, and the manifest must
 *      contain it. A claim with no package is not a claim.
 *   3. It is read ONLY where the name model has nothing (`decls === 0`), exactly like
 *      `importedName` — a claim may never displace a name-model answer.
 *   4. It is REFUTABLE by the project: a dependency the manifest does not declare REFUTES the
 *      claim, and the row is counted as the defect it is.
 */
export const PACKAGE_SCOPE_CLAIM_KEY = "packageScope"

/**
 * THE OWNER-MEMBER-ABSENCE CLAIM (`ownerMemberAbsent = {owner, member}`, 2026-10-19).
 *
 * The shape it exists for: a calls/uses row carries `metadata.owner` (the receiver type is known),
 * production's owner channel DECLINES it (no member of that name is declared under the owner, or the
 * member lookup is ambiguous), and the row therefore stays NULL — an honest wall. But "this owner
 * type declares no member with this name" is a fact the project CAN verify: the gate builds
 * `ownerMembers` from the run's own symbols. VERIFIED when the owner is in that map and the member is
 * not; REFUTED when the project does declare the member (the claim is then false and the row goes to
 * the failure column); UNVERIFIABLE when the owner is unknown (a claim about a type nobody declared
 * cannot be checked here). It is a claim, never a resolution: it rides the external/binding family
 * and cannot raise `resolved`, and it is read only where the name model has nothing (`decls === 0`),
 * so it can never displace a real binding.
 */
export const OWNER_MEMBER_ABSENT_CLAIM_KEY = "ownerMemberAbsent"

/**
 * THE `source-path` CLAIM — "nothing the project ADMITS resolves to this written source string".
 *
 * WHY IT EXISTS. The same SHAPE blocked three lanes independently: protobuf's 581 unresolved module paths,
 * yaml's 229 path-shaped rows, toml's 10 (`"./dependency"`). A path is a FILE, not a namespace, so the
 * namespace claim cannot reach any of them; `importProjectFile` cannot either, because it verifies only when
 * the file IS admitted and finds nothing here. MEASURED full-population: toml 299 path-shaped unresolved
 * (127 distinct) and protobuf 1,555 (243 distinct), with **0 would-be-refuted** in either lane under the most
 * generous match — `std`'s risk number, not toml's dotted class's 100%.
 *
 * IT IS REFUTABLE BY A RUN, which is the property that decides whether a claim may exist at all: the verdict
 * is a pure function of the project's ADMITTED FILE LIST, so an independent actor adds the file and the claim
 * flips. Demonstrated against `verifyFileClaim` before a line of this was written: with no such file admitted
 * → `externalRefuted`; add the file → `externalVerified`.
 *
 * POLARITY: the INVERSE of `FILE_CLAIM_KEY`. A candidate resolving in `facts.files` → `externalRefuted`;
 * nothing resolving → `externalVerified`; **absent `facts` → `externalUnverified`, never quietly accepted.**
 * This is a distinct kind, not a flag (property 3): `verifiedBy: "sourcePath"` says which mechanism spoke.
 *
 * BARE NAMES ARE NOT REACHABLE BY CONSTRUCTION and must never be: the key is attached only to a target
 * containing `/` (or a scheme), so `"dependency"` / `"SubProjectB"` style single segments stay `unresolved` —
 * yaml's shape rule exists for exactly that reason.
 */
export const SOURCE_PATH_CLAIM_KEY = "sourcePathClaim"

/** The candidates a written source string resolves to, cheapest-first: the string, `./`-stripped, basename. */
export function sourcePathCandidates(src: string): string[] {
  const out: string[] = []
  const push = (v: string) => { const t = v.trim(); if (t.length > 0 && !out.includes(t)) out.push(t) }
  push(src)
  push(src.replace(/^\.\//, ""))
  push(src.replace(/^\.\.\//, ""))
  const segs = src.split("/").filter((x) => x.length > 0 && x !== "." && x !== "..")
  if (segs.length > 0) { push(segs.join("/")); push(segs[segs.length - 1]) }
  return out
}

/** The ROOT of a target: its first dot-segment, which is the thing a namespace claim names. */
export function namespaceRootOf(tgt: string): string {
  const dot = tgt.indexOf(".")
  return (dot > 0 ? tgt.slice(0, dot) : tgt).trim()
}

/**
 * DOES THE TARGET BELONG TO A DECLARED NAMESPACE? — the PROTOBUF-FACING EXTENSION of the claim kind
 * (protobuf is its second adopter; task-19).
 *
 * A single-segment ROOT check is exact for hcl, whose namespaces are `count`, `each`, `self`, `path`,
 * `terraform`. It is not usable as-is for protobuf, and the measurement says why: the lane's external
 * surface is `google.protobuf.*` (904 of its 971 unresolved `uses`), but the ROOT of
 * `google.protobuf.Timestamp` is `google` — so a root-only list would have to declare `google`, and
 * `google` is a namespace projects use for their OWN packages. MEASURED whole-corpus: of 3,608 `uses`
 * targets not declared in their own file, **2,637 (73.1%) ARE declared elsewhere in the same project**
 * (`k8s.*` 810, `controller.*` 441, `docker.*` 187, and 534 under `google.*` alone). Declaring
 * `google` would certify every one of those as external — the hcl lane's "29 false externalities"
 * mistake at 18x the scale, in the opposite direction from the one property 1 guards.
 *
 * So an entry may be a MULTI-SEGMENT namespace, matched on SEGMENT BOUNDARIES against the target's
 * leading segments, longest entry first:
 *
 *   entry `google.protobuf`  ·  `google.protobuf.Timestamp`  -> match
 *   entry `google.protobuf`  ·  `google.api.Annotations`     -> NO match (a neighbouring namespace
 *                                                              is never certified by this entry)
 *   entry `count`            ·  `count.index`                -> match (identical to the root check)
 *   entry `count`            ·  `counter.x`                  -> NO match (a boundary, not prefix text)
 *
 * A target matching NO entry is still `externalRefuted` — property 1 is untouched: the claim carries
 * the namespaces it certifies, and anything outside them is refused rather than sheltered.
 */
export function namespaceMatchOf(tgt: string, roots: readonly string[], opts?: { slash?: boolean }): string | null {
  if (tgt.length === 0 || roots.length === 0) return null
  // SPLIT ON `::` AS WELL AS `.`, because a language namespace is not always dotted. Rust spells a
  // namespace `std::fs`, `core::fmt`, `alloc::vec`; with a dot-only split those targets yielded ONE
  // segment (`std::fs`) and no root could ever match, so `languageNamespace` was structurally
  // unreachable for the lane. Measured by rust's lane: 233 `std::` import rows sat unresolved behind
  // this single line, and the priced win was imports unresolved 863 -> 630, extOK 797 -> 1,030.
  //
  // THE PRE-REGISTERED FALSIFIER, agreed before the change: **any `extFAIL` on the rows this newly
  // reaches REFUTES the emission rule.** A namespace claim must be verified by the project, and a
  // claim that turns out refuted is a false statement the gate must catch, not a recall improvement.
  // This is additive and cannot reach a call edge: a call's target is a bare leaf, which has no
  // separator at all and is refused as vacuous by the lanes that measured it (rust, go, toml, yaml).
  // COLON-AWARE SPLIT (2026-10-19, python lane measurement): a module:item target (`pathlib:Path`,
  // `__future__:annotations`) has no dot before the item, so a dot/`::`-only split produced ONE
  // segment and no root could match — measured on python's arm 40,419 ext? rows: the python-stdlib
  // citation vocabulary reached only 116 rows under the old split, and **+11,167 rows, ALL imports**
  // with `:` in the separator set. `::` is matched before `:` so rust's `std::fs` still splits
  // correctly. A claim that cannot reach the rows it cites is a citation nobody can use.
  // THE SLASH OPT-IN (go stdlib multi-segment imports, 2026-10-19): only a claim that declares
  // `languageNamespaceSlash` splits on `/`; every other lane's matching stays byte-identical.
  const segs = opts?.slash === true ? tgt.split(/\/|\.|::|:/) : tgt.split(/\.|::|:/)
  for (let n = segs.length; n >= 1; n--) {
    const cand = segs.slice(0, n).join(".")
    if (roots.includes(cand)) return cand
  }
  return null
}

export function externalClaimOf(rel: any): ExternalClaim | null {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return null
  // Checked FIRST, and it is the one claim whose evidence is the target's own spelling rather
  // than a lookup: an edge carrying it says "do not look this up, it is a binding". A lane
  // cannot launder a gap with it — the claim is refuted outright when the target names a
  // declaration (see `classifyEdge`).
  if (md[BINDING_CLAIM_KEY] === true) return { kind: "binding" }
  // THE IMPORTED-BINDING CLAIM, read before every generic marker for the binding claim's reason:
  // it is a specific, checkable statement about the target (a local name bound by an import), and
  // falling through to `owner` would route it to a verification that cannot see the evidence.
  const impBinding = md[IMPORTED_BINDING_CLAIM_KEY]
  if (
    impBinding !== null && typeof impBinding === "object" &&
    typeof (impBinding as any).specifier === "string" && (impBinding as any).specifier.length > 0 &&
    typeof (impBinding as any).binding === "string" && (impBinding as any).binding.length > 0
  ) {
    return { kind: "importedBinding", specifier: String((impBinding as any).specifier), binding: String((impBinding as any).binding) }
  }
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
  // THE EXPORT-SURFACE CLAIMS, read before the population claims for the imported-binding claim's
  // reason: they are specific, checkable statements about an `exports` row, and falling through to
  // `owner` would route them to a verification that cannot see the surface evidence.
  const defaultExp = md[DEFAULT_EXPORT_CLAIM_KEY]
  if (defaultExp !== null && typeof defaultExp === "object" && typeof (defaultExp as any).form === "string") {
    return {
      kind: "exportSurface", surface: "default", form: String((defaultExp as any).form),
      localName: typeof (defaultExp as any).localName === "string" && (defaultExp as any).localName.length > 0
        ? String((defaultExp as any).localName) : undefined,
    }
  }
  const moduleExp = md[MODULE_EXPORTS_CLAIM_KEY]
  if (moduleExp !== null && typeof moduleExp === "object" &&
      typeof (moduleExp as any).property === "string" && typeof (moduleExp as any).form === "string") {
    return {
      kind: "exportSurface", surface: "moduleExports",
      property: String((moduleExp as any).property), form: String((moduleExp as any).form),
    }
  }
  // THE RECEIVER-POSITION CLAIM (2026-10-19): `metadata.receiverImport {specifier, binding}` on a row
  // whose TARGET is a member leaf and whose receiver ROOT is a file import binding. It routes to the
  // imported-binding verification with the position discriminator — same evidence, same bindOK column.
  const recvImp = md.receiverImport
  if (
    recvImp !== null && typeof recvImp === "object" &&
    typeof (recvImp as any).specifier === "string" && (recvImp as any).specifier.length > 0 &&
    typeof (recvImp as any).binding === "string" && (recvImp as any).binding.length > 0
  ) {
    return {
      kind: "importedBinding", specifier: String((recvImp as any).specifier),
      binding: String((recvImp as any).binding), position: "receiver",
    }
  }
  // THE IMPORTED-NAME CLAIM: `metadata.importedName {specifier, name}`.
  const impName = md[IMPORTED_NAME_CLAIM_KEY]
  if (
    impName !== null && typeof impName === "object" &&
    typeof (impName as any).specifier === "string" && (impName as any).specifier.length > 0 &&
    typeof (impName as any).name === "string" && (impName as any).name.length > 0
  ) {
    return { kind: "importedName", specifier: String((impName as any).specifier), name: String((impName as any).name) }
  }
  // THE PACKAGE-SCOPE CLAIM, read BEFORE the namespace claim: it makes a statement the PROJECT's
  // OWN MANIFEST can check, and routing such an edge to the namespace claim (a lane-maintained
  // vocabulary) or to the generic owner marker would let a lane be excused by the very mechanism
  // this claim exists to replace — and would make a CHECKOUT-fact verifiable by a LANE's list.
  const pkgScope = md[PACKAGE_SCOPE_CLAIM_KEY]
  if (
    pkgScope !== null && typeof pkgScope === "object" &&
    typeof (pkgScope as any).package === "string" && (pkgScope as any).package.trim().length > 0 &&
    typeof (pkgScope as any).name === "string" && (pkgScope as any).name.trim().length > 0
  ) {
    return {
      kind: "packageScope",
      package: String((pkgScope as any).package).trim(),
      name: String((pkgScope as any).name).trim(),
      ...((pkgScope as any).position === "receiver" ? { position: "receiver" as const } : {}),
    }
  }
  // THE NAMESPACE CLAIM, read before the population claims for the file claim's own reason: it
  // makes a statement the LIST can check, and routing such an edge to the weaker `owner` marker
  // would let a lane be excused by the very mechanism this claim exists to replace.
  const nsRoots = md[NAMESPACE_CLAIM_KEY]
  if (Array.isArray(nsRoots)) {
    const roots = nsRoots
      .filter((r: any): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r: string) => r.trim())
    if (roots.length > 0) {
      return {
        kind: "namespace", roots,
        ...(md[NAMESPACE_POLICY_KEY] === "strict-absent" ? { strictAbsent: true } : {}),
        ...(md[NAMESPACE_SLASH_KEY] === true ? { slash: true } : {}),
      }
    }
  }
  const srcPaths = md[SOURCE_PATH_CLAIM_KEY]
  if (Array.isArray(srcPaths)) {
    const sources = srcPaths
      .filter((v: any): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v: string) => v.trim())
    if (sources.length > 0) return { kind: "sourcePath", sources }
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
      // A `module:item` claim is read BEFORE the generic owner claim: its verification is against a MODULE
      // PATH, not a declaration, so it must not fall through to `verifyExternalClaim`.
      if (md.externalReason === "module-namespace") {
        const spec = typeof (md as any).externalSpecifier === "string" ? String((md as any).externalSpecifier) : ""
        const mod = spec.length > 0 ? spec : String(md[FILE_CLAIM_KEY] ?? "").split(":")[0]
        if (mod.length > 0) return { kind: "moduleNamespace", module: mod }
      }
      return {
        kind: "owner",
        specifier: typeof (md as any).externalSpecifier === "string" ? String((md as any).externalSpecifier) : undefined,
      }
    }
  }
  if (hasCause) return { kind: "cause", base: cause, conflict: false }
  // THE OWNER-MEMBER-ABSENCE CLAIM — read late (every explicit analyzer claim above wins) because it
  // is about a row the other mechanisms have nothing to say about.
  const oma = md[OWNER_MEMBER_ABSENT_CLAIM_KEY]
  if (
    oma !== null && typeof oma === "object" &&
    typeof (oma as any).owner === "string" && (oma as any).owner.length > 0 &&
    typeof (oma as any).member === "string" && (oma as any).member.length > 0
  ) {
    return { kind: "ownerMemberAbsent", owner: String((oma as any).owner), member: String((oma as any).member) }
  }
  // THE MODULE-PATH IMPORT CLAIM — checked LAST, so every explicit analyzer claim above wins, and only
  // where the edge carries no claim at all. See `importPath` in the claim union for the why and the
  // deliberate capitalised-leaf narrowing.
  if (rel?.type === "imports" || rel?.type === "brain_import") {
    const t = String(rel?.target ?? "")
    if (DOTTED_MODULE_TYPE.test(t)) return { kind: "importPath" }
  }
  return null
}

/** A DOTTED MODULE PATH ENDING IN A TYPE NAME — `java.util.List`, `a.b.C`. Not a path, not a URL. */
export const DOTTED_MODULE_TYPE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*\.[A-Z][A-Za-z0-9_$]*$/

/**
 * RESERVED PLATFORM NAMESPACES — packages a language platform reserves to itself, and therefore a
 * CITATION when an external claim names one.
 *
 * WHY THIS EXISTS, MEASURED. The owner check refutes a claim when `declCount[targetOwner(target)] > 0`,
 * and `targetOwner("java.util")` is `"java"` — the first SEGMENT of a package path. On scala3 the corpus
 * declares a test file whose public class is literally `java` (`tests/pos/t11788b/java.java`), so 20
 * imports of `java.util.*` were charged `extFAIL` against a lane whose claim was TRUE, plus 4 on
 * `java.io.*`. That is a category error: the segments of a package path are NAMESPACES, not declaration
 * owners. Where the namespace is reserved by the language spec the claim needs no lookup at all.
 *
 * CITATIONS: JLS §6.1 ("The Java programming language reserves package names beginning with `java.` /
 * `javax.` for the platform") and the JPMS spec's platform module names; `sun.*` / `com.sun.*` are the
 * JDK's own internal packages (JEP 260). A project symbol that merely shares the first segment cannot
 * falsify a claim about a reserved namespace, so these verify WITHOUT a lookup.
 *
 * WHY NOT EVERY PACKAGE PATH: an arbitrary dotted lowercase path may name a project's own package
 * (measured on the same arm: kotlinx-coroutines' module-info imports its own `kotlinx.*` packages, and
 * those claims ARE false, so refuting them is correct). Loosening all package paths would launder
 * exactly that class. Only reserved namespaces become citations.
 */
export const RESERVED_PLATFORM_NAMESPACES: readonly string[] = ["java.", "javax.", "jdk.", "sun.", "com.sun."]

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
 * VERIFY AN IMPORTED-NAME CLAIM from the run's own import evidence: the edge's file must have an
 * import of `specifier` that brings `name` into scope (the gate records module→names from the
 * analyzer's imports edges). The target must be the claimed name and name-shaped. No project-
 * declaration refutation: an imported name occupies its file's name scope (the decoy class).
 */
export function verifyImportedNameClaim(
  claim: { specifier: string; name: string },
  tgt: string,
  facts?: ProjectFacts,
  edgeFile?: string,
): Outcome {
  if (tgt !== claim.name) return "bindingRefuted"
  if (!/^[A-Za-z_$][\w$]*$/.test(claim.name)) return "bindingRefuted"
  if (!facts || !facts.importsByFile || !edgeFile || edgeFile.length === 0) return "bindingUnverified"
  const perFile =
    facts.importsByFile.get(edgeFile) ?? facts.importsByFile.get(edgeFile.replace(/\\/g, "/"))
  if (!perFile) return "bindingRefuted"
  const names = perFile.get(claim.specifier)
  if (!names) return "bindingRefuted"
  return names.has(claim.name) ? "bindingVerified" : "bindingRefuted"
}

/**
 * VERIFY AN IMPORTED-BINDING CLAIM from the run's own import evidence.
 *
 * VERIFIED   the edge's file has an import of `specifier` that publishes `binding` among the local
 *            names it binds (the analyzer's own parse, recorded on the IMPORTS edge, not on the use
 *            edge that makes the claim).
 * REFUTED    the file's import evidence exists but does not bind that name (or imports nothing of
 *            that specifier): the claim is false and the row must not be excused.
 * UNVERIFIED no evidence was built for the run (caller without import facts) — counted, never clean.
 *
 * A file-level lookup with a normalized fallback, because the caller's keys are absolute paths and a
 * platform separator must not decide a verdict.
 */
/**
 * VERIFY A DEFAULT-EXPORT SURFACE CLAIM. The public name of an ESM default export is the literal
 * `default` — never the local identifier beside it (JD-J14's fabricated-public-name family). The
 * claim is checked against evidence the CLAIM DOES NOT SUPPLY: the target must BE `default`, the
 * form must be one the family defines, and every form that names a local binding (`named-declaration`
 * / `export-alias` / `expression`) must carry a localName the run's declarations can SEE. An
 * `anonymous` default (literal / object / call / anonymous fn) has no local binding, so its form is
 * the whole evidence.
 */
export function verifyDefaultExportClaim(
  claim: { form: string; localName?: string },
  tgt: string,
  declCount: Map<string, number>,
): Outcome {
  if (tgt !== "default") return "bindingRefuted" // a fabricated public name
  if (!DEFAULT_EXPORT_FORMS.includes(claim.form)) return "bindingRefuted"
  if (claim.form === "anonymous") return "bindingVerified"
  if (!claim.localName || claim.localName.length === 0) return "bindingRefuted"
  // A LOCALNAME IS NOT A PUBLISHED DECLARATION, SO THE NAME MODEL MAY NOT REFUTE IT (measured): the
  // first rule required the localName to be visible in the run's declarations and the JS arm measured
  // **24 refutations → clause 4 FAIL** — precisely the expression form (`const cfg = …; export default
  // cfg`) because local declarations are not published symbols (the fleet rule: a local is not a
  // project declaration). The claim's PUBLIC assertion is the target (`default`, never the
  // local identifier), and its form; the localName is evidence of the internal binding, not a
  // name-model question. Absence of a localName where the form requires one still refutes.
  void declCount
  return "bindingVerified"
}

/**
 * VERIFY A COMMONJS EXPORT-SURFACE CLAIM. The surface is the property written on
 * `module.exports`/`exports`; the claim is refuted when the target is not that property, when the
 * form is not one the family defines, when the property is not a name, or when the PROJECT declares
 * the name — a real declaration wins over a surface label. Dotted properties are allowed for
 * `module.exports.a.b = …` (the `deep-member-assignment` form).
 */
export function verifyModuleExportsClaim(
  claim: { property: string; form: string },
  tgt: string,
  declCount: Map<string, number>,
): Outcome {
  if (tgt !== claim.property) return "bindingRefuted"
  if (!MODULE_EXPORTS_FORMS.includes(claim.form)) return "bindingRefuted"
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(claim.property)) return "bindingRefuted"
  // NO PROJECT-DECLARATION REFUTATION (2026-10-19, measured): the first rule refuted the claim
  // whenever ANY project declaration answered the name, and the JS whole-population arm measured
  // **245 such refutations → clause 4 FAIL**. The rule was wrong for module-isolated languages: in
  // JS each FILE is a module, so a name declared in ANOTHER file cannot be the target of this
  // file's `module.exports` property — the cross-file declaration is a name-model coincidence, the
  // decoy class. (A same-file declaration is already excluded by the analyzer's emission gate, so
  // the only cases this rule saw were cross-file.) The claim is verified on its own shape — target
  // equals property, a defined CJS form, identifier/dotted spelling — the same authority the ESM
  // `default` claim uses, and the arbiter's name model is not consulted for a surface assertion.
  void declCount
  return "bindingVerified"
}

export function verifyImportedBindingClaim(
  claim: { specifier: string; binding: string },
  facts?: ProjectFacts,
  edgeFile?: string,
): Outcome {
  if (!facts || !facts.importsByFile || !edgeFile || edgeFile.length === 0) return "bindingUnverified"
  const perFile =
    facts.importsByFile.get(edgeFile) ??
    facts.importsByFile.get(edgeFile.replace(/\\/g, "/"))
  if (!perFile) return "bindingRefuted"
  const bound = perFile.get(claim.specifier)
  if (!bound) return "bindingRefuted"
  return bound.has(claim.binding) ? "bindingVerified" : "bindingRefuted"
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
  /**
   * IMPORTED-BINDING EVIDENCE, built by the caller from the run's OWN import edges (the analyzer
   * publishes `metadata.importedBindings` on them): file -> specifier -> local names bound.
   * The arbiter verifies an `importedBinding` claim against THIS map rather than against the
   * analyzer's word on the use edge — the claim and its evidence must not come from the same
   * author. Absent means the caller built no evidence and every imported-binding claim is
   * UNVERIFIABLE (never quietly accepted).
   */
  importsByFile?: Map<string, Map<string, Set<string>>>
  /**
   * OWNER-MEMBER EVIDENCE, built by the caller from the run's OWN symbols (ownerName -> the member
   * names the project declares under that owner). The `ownerMemberAbsent` claim states a verifiable
   * ABSENCE ("this owner type does not declare this member"), and this map is what decides it:
   * present owner + absent member = VERIFIED; present member = REFUTED; unknown owner = UNVERIFIABLE
   * (never quietly accepted). Absent map means the caller built no evidence and every such claim is
   * unverifiable.
   */
  ownerMembers?: Map<string, Set<string>>
  /**
   * PACKAGE-SCOPE EVIDENCE, built by the caller from the project's own MANIFEST (go.mod's `require`
   * lines, package.json dependencies, pyproject/requirements, Cargo.toml, composer.json,
   * pubspec.yaml): the set of DEPENDENCY NAMES the project declares. The `packageScope` claim says
   * "this name belongs to this dependency", and this map is what decides it: the dependency IS in
   * the manifest = VERIFIED; the dependency is NOT = REFUTED (the claim is then false — the project
   * does not depend on it); no map at all = UNVERIFIABLE (never quietly accepted).
   *
   * WHY IT IS ITS OWN KIND AND NOT A NAMESPACE CLAIM: a namespace claim cites a CLOSED vocabulary
   * the LANE maintains (a stdlib's roots), which is a statement about the LANGUAGE. A package-scope
   * claim cites the PROJECT's own manifest, which is a statement about the CHECKOUT — and the
   * difference is exactly where the laundering risk lives. A namespace list grows to cover whatever
   * the corpus contains; a manifest is the project's own declaration, so a name from a package the
   * project does not depend on CANNOT be claimed. The dart lane's 320 unlisted rows (JsonKey 210,
   * JsonValue 44, JsonSerializable 19, freezed 9, staticIconProvider 6, useResult 6, TestOn 14,
   * internal 3, JS 2, GenerateMocks 2, experimental 1, Default 2) are the worked example: they are
   * third-party PACKAGE annotations, and the manifest is what can verify them.
   */
  packageDependencies?: Set<string>
  /**
   * PER-FILE MANIFEST EVIDENCE — the dependency names declared by THE MANIFEST THAT GOVERNS THE FILE,
   * keyed by the file's repo-relative POSIX path (the same keying as `files`).
   *
   * WHY IT EXISTS, MEASURED 2026-10-20. A repo-level manifest set is the wrong question in a
   * MONOREPO, and the corpus is full of monorepos: 843 tracked `package.json` files, 414
   * `pubspec.yaml`, 744 `Cargo.toml`, 222 `pom.xml` and 395 `build.gradle` files live in SUBDIRECTORIES,
   * while only 38 / 3 / 4 / 2 / 2 repos carry one at the ROOT. A file in `packages/foo/` is governed by
   * `packages/foo/package.json`, not by the repository root's — so a claim checked against the root's
   * manifest is checked against the WRONG manifest, and a dependency the package genuinely declares can
   * read REFUTED (which counts AGAINST the lane) while a dependency only the ROOT declares can read
   * VERIFIED (which is the monorepo's laundering).
   *
   * THE NEAREST-ANCESTOR RULE: the manifest that governs a file is the first one found walking UP from
   * the file's own directory to the repository root. A repo with no manifest anywhere above a file leaves
   * that file with no entry, and the claim is then UNVERIFIABLE — never quietly accepted, exactly as a
   * repo with no manifest at all is today.
   *
   * IT IS OPTIONAL AND ADDITIVE. Absent map = the caller built no per-file evidence, and the claim falls
   * back to the repo-level `packageDependencies` — so no existing caller changes behaviour.
   */
  packageDependenciesByFile?: Map<string, Set<string>>
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
/**
 * CAN THE PROJECT'S MANIFEST CONFIRM A PACKAGE-SCOPE CLAIM?
 *
 * VERIFIED      the dependency the claim names IS in the project's manifest. The project has
 *                declared it, so "this name belongs to that dependency" is confirmed by the
 *                checkout's own evidence — not by the analyzer's word and not by a lane's list.
 * REFUTED       the dependency is NOT in the manifest. The claim is then FALSE (the project does
 *                not depend on it) and the row is counted as the defect it is. This is the check
 *                that makes the claim safe: a vocabulary can grow to cover anything, a manifest
 *                cannot.
 * UNVERIFIABLE  no manifest evidence was built at all. Never quietly accepted — the row lands in
 *                the unverified column and stays visible.
 */
export function verifyPackageScopeClaim(
  facts: ProjectFacts,
  dependency: string,
  /**
   * THE FILE THE CLAIM IS ABOUT, when the caller knows it. The evidence is then the manifest that
   * GOVERNS THAT FILE (the nearest ancestor manifest), not the repository root's — which is the only
   * correct question in a monorepo, where 843 tracked `package.json` files live in subdirectories and a
   * root-only manifest describes a different package than the one the file belongs to.
   *
   * FALL-THROUGH IS DELIBERATE: no per-file entry for this file (the caller built no per-file evidence,
   * or the file has no governing manifest above it) falls back to the repo-level set, which is the
   * behaviour every caller had before this parameter existed.
   */
  edgeFile?: string,
): "externalVerified" | "externalRefuted" {
  const deps = facts.packageDependencies
  if (deps === undefined && facts.packageDependenciesByFile === undefined) return "externalUnverified"
  let scope: Set<string> | undefined = deps
  if (facts.packageDependenciesByFile !== undefined) {
    // A PER-FILE MAP, WHEN IT EXISTS, IS AUTHORITATIVE. It was built by walking UP from each file to
    // its nearest ancestor manifest, so a file it does NOT cover has NO GOVERNING MANIFEST above it —
    // a MEASURED absence, and the claim is then UNVERIFIABLE rather than judged by the root's list.
    // (A file in a repo whose ROOT has a manifest IS covered, by the root's manifest — the
    // single-package case is unchanged.)
    if (edgeFile === undefined) return "externalUnverified"
    const perFile = facts.packageDependenciesByFile.get(edgeFile) ??
      facts.packageDependenciesByFile.get(edgeFile.replace(/\\/g, "/"))
    if (perFile === undefined) return "externalUnverified"
    scope = perFile
  }
  if (scope === undefined) return "externalUnverified"
  const want = dependency.trim().toLowerCase()
  if (want.length === 0) return "externalUnverified"
  for (const d of scope) {
    const norm = d.trim().toLowerCase()
    if (norm.length === 0) continue
    // EXACT OR SCOPE-EXACT: a manifest names `json_annotation` (dart), `org.slf4j` (maven) or
    // `github.com/pkg/errors` (go). The claim names the same thing, and the two spellings that
    // differ are the SCOPED ones — so a scoped name matches when the manifest's name is its
    // prefix at a PATH BOUNDARY (`json_annotation` vs `json_annotation/freezed`), never inside a
    // longer word (`json` must not match `jsonc`).
    if (norm === want) return "externalVerified"
    if (norm.startsWith(want + "/") || want.startsWith(norm + "/")) return "externalVerified"
  }
  return "externalRefuted"
}

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
  // A MISS REFUTES, AND THAT IS DELIBERATE HERE — the gate's own control pins it (arms 4 and 5:
  // "a file claim with no candidate" and "a directory with nothing under it" MUST refute, or the
  // gate refuses to report any lane). Returning `unverified` on a miss was tried on 2026-10-09 to
  // remove yaml's 103 refutations and the control caught it: expected 6 REFUTED, got 4. The
  // control is right and the experiment was wrong — a file claim is a statement the project can
  // check, and this function's whole job is that check.
  //
  // The 103 ARE STILL FALSE STATEMENTS and the defect is UPSTREAM OF HERE: yaml attaches a file
  // claim only when it can build candidates, and falls back to `isExternal: true` otherwise, so a
  // literal path it cannot resolve arrives as an EXTERNAL NAME claim and `verifyExternalClaim`
  // refutes it through the file's stem (`setup.yml` -> owner `setup`, which a declaration
  // publishes). That is a lane-side fix — mark an unresolvable literal path as a file claim with
  // the literal candidate, or as unverifiable — recorded in the handoff rather than forced here.
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
/**
 * DOES THIS TARGET NAME A FILE? Then its stem is not an owner and the claim cannot be refuted by
 * looking one up.
 *
 * Measured on yaml's whole 1,416,614-edge population: **113 external claims were reported REFUTED**
 * and every one was an `!include` of a file — `setup.yml`, `apt.yml`, `handlers.yml`, `fail.yml`,
 * `./security-scanner`, `package:dart_flutter_team_lints/analysis_options.yaml`,
 * `testns.testcoll.default_collection_playbook.yml`. The gate took the owner of `setup.yml` (which
 * `targetOwner` returns as `setup`), found a published declaration named `setup`, and reported the
 * claim "this names something outside the corpus" as FALSE. **The claim was true.** A symbol called
 * `setup` does not make the file `setup.yml` internal; the check invented a refutation out of a
 * filename, and a refutation is the one outcome the programme treats as a false statement the graph
 * makes about another repository.
 *
 * The test is an EXTENSION SHORTLIST rather than a "looks like a filename" heuristic, and that is a
 * deliberate retreat after two failed attempts (recorded so the next reader does not retry them):
 *   * "the segment after the final dot contains a dot" — false for every real filename, whose final
 *     dot IS the extension (`setup.yml` -> `yml`).
 *   * "the segment after the FIRST dot is short and alphanumeric" — true for `setup.yml` (-> `yml`)
 *     AND for `Object.hashCode` (-> `hashCode`), so it silently stopped refuting real qualified
 *     names. A trade in the wrong direction: it would hide genuine refutations to remove false ones.
 * A shortlist is honest about being a shortlist: the tokens here are file extensions, an unknown
 * one leaves the old behaviour in place, and extending the list is a one-word change with no risk of
 * swallowing an identifier.
 */
const FILE_EXTENSIONS = new Set([
  "yml", "yaml", "json", "jsonl", "ndjson", "toml", "ini", "cfg", "conf", "env", "properties",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "mts", "cts", "dart", "py", "pyi", "rb", "go", "rs",
  "java", "kt", "kts", "scala", "groovy", "clj", "cljs", "ex", "exs", "erl", "hrl", "hs", "ml",
  "fs", "fsi", "fsx", "cs", "vb", "php", "pl", "pm", "lua", "jl", "nim", "zig", "swift", "m", "mm",
  "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat",
  "cmd", "sql", "graphql", "gql", "proto", "tf", "tfvars", "hcl", "mk", "make", "css", "scss",
  "sass", "less", "html", "htm", "xml", "xsl", "xslt", "xsd", "dtd", "md", "mdx", "rst", "txt",
  "csv", "tsv", "lock", "mod", "sum", "gradle", "sbt", "pom", "dockerfile", "editorconfig",
  "gitignore", "gitattributes", "icl", "dcl", "r", "rmd", "tex", "bib",
])
/**
 * IS THIS TARGET A `<module>:<member>` SPELLING RATHER THAN A PATH OR A URI?
 *
 * THE DEFECT THIS EXISTS TO FIX. `pathLikeTarget` refuses any target containing `:`, so every
 * `<module>:<member>` target -- python's `argparse:*` and `pydantic:BaseModel`, typescript's
 * `vue:cloneVNode`, java's `import_declaration_mention` paths -- was classified path-like and pushed to
 * `ext?` ("a claim no check can reach") BEFORE any lookup, no matter what evidence the analyzer attached.
 * Measured consequence: python's stdlib claims were TRUE and unreadable (117 edges in `ext?` while 268
 * stayed unresolved), and typescript's imports read 0 resolved on 669 edges because 79% of them are
 * spelled this way.
 *
 * THE SHAPE IS UNAMBIGUOUS, which is why it can be separated without guessing: the part after the LAST
 * colon is `*` or a single identifier, and nothing that is genuinely a path or a URI produces that --
 * a URL leaves `//host/...` (fails the identifier test), a Windows drive leaves `\path` (fails it), and
 * a bare drive letter leaves nothing at all. A module part may contain `@`, `/` or `.` (scoped packages,
 * dotted python modules), so the module half is NOT constrained to an identifier.
 */
export function moduleMemberTarget(tgt: string): boolean {
  const i = tgt.lastIndexOf(":")
  if (i <= 0 || i === tgt.length - 1) return false
  const member = tgt.slice(i + 1)
  if (member !== "*" && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(member)) return false
  const mod = tgt.slice(0, i)
  if (mod.length === 0) return false
  // THE MODULE HALF MAY NOT ITSELF CONTAIN A COLON.
  //
  // The gate's own positive control caught this in the first version of this predicate, which is
  // exactly what a control is for: the plant is `package:flutter/material.dart:*`, a Flutter ASSET URI
  // carrying a `:*` suffix. It has a clean `*` member, so the member test alone accepted it, the target
  // stopped being path-shaped, and it came back `externalVerified` -- a URI verified as an external
  // module. The control failed the run rather than printing a clean lane, which is the behaviour that
  // makes the number worth reading.
  // A genuine `<module>:<member>` target has EXACTLY ONE colon: `argparse:*`, `pydantic:BaseModel`,
  // `vue:cloneVNode`, `@scope/pkg:Name`. A URI (`package:…`, `dart:…/…`, `https:…`) has one in its
  // scheme and more in the body, and its path half is not a module name. So the module half must be
  // colon-free.
  if (mod.includes(":")) return false
  // AND THE MODULE HALF MUST LOOK LIKE A MODULE, NOT LIKE A NAMESPACE PREFIX.
  //
  // MEASURED REGRESSION, mine: with only the tests above, `xsl:template` was accepted as `<module>:<member>`
  // (module `xsl`, member `template`) -- but an XML namespace prefix is NOT a module. That turned xml's
  // prefix-spelled `references`/`uses` targets into external CLAIMS instead of letting them resolve, and the
  // regenerated matrix lost xml its last wholly-done cell (xml references 3/22 and imports 3/14 unresolved).
  // The fleet number moved 183 -> 172 on the strength of that one predicate.
  //
  // The discriminator is the ONE thing a namespace prefix never has: a package separator. A real module
  // spelling is `argparse:*` (a `*` member, the unambiguous shape), or it carries a dot, a slash or a scope
  // marker -- `django.apps:AppConfig`, `@scope/pkg:Name`, `java.util:List`. A bare single-segment module with
  // an identifier member (`xsl:template`, `vue:cloneVNode`) is indistinguishable from a namespace prefix by
  // shape, and guessing wrong costs a lane a cell, so it keeps the OLD path-shaped behaviour.
  if (member === "*") return true
  return mod.includes(".") || mod.includes("/") || mod.includes("@")
}

export function pathLikeTarget(tgt: string): boolean {
  // A `<module>:<member>` target is NOT a path, and refusing it on its colon sent every one of them to
  // `ext?` before any evidence was read. See `moduleMemberTarget` above for the measured cost.
  if (moduleMemberTarget(tgt)) return false
  // a path separator or a URI scheme needs no extension to be recognisable
  if (tgt.includes("/") || tgt.includes("\\") || tgt.includes(":")) return true
  const dot = tgt.lastIndexOf(".")
  if (dot <= 0 || dot === tgt.length - 1) return false
  const ext = tgt.slice(dot + 1).toLowerCase()
  if (ext.length === 0 || ext.length > 12) return false
  return FILE_EXTENSIONS.has(ext)
}

/** A URI with a scheme (`https:`, `file:`, `dart:`) — as opposed to a Windows drive letter. */
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
/** Is this path-shaped target one of the project's OWN admitted files? Suffix match, separator-
 *  normalised, because a target is written project-relative while the admitted list may be absolute. */
export function pathTargetInProject(facts: ProjectFacts, tgt: string): boolean {
  const norm = tgt.replace(/\\/g, "/").replace(/^\.\//, "").trim()
  if (norm === "" || norm.endsWith("/")) return false
  for (const f of facts.files) {
    const nf = f.replace(/\\/g, "/")
    if (nf === norm || nf.endsWith(`/${norm}`)) return true
  }
  return false
}

export function verifyExternalClaim(
  declCount: Map<string, number>,
  tgt: string,
  /** THE PROJECT'S ADMITTED FILES. Without them a path can only be refused; with them, case 1 below
   *  becomes an ANSWER about the case that is actually measurable. */
  facts?: ProjectFacts,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  // A FILE TARGET IS NOT A NAME CLAIM — but it is still a QUESTION, and refusing to ask it was a
  // CLASSIFIER BUG rather than a bar that is too strict.
  //
  // The old rule returned `externalUnverified` for every path-like target, because looking them up once
  // manufactured 113 false refutations. **THE TRADE WAS RIGHT ABOUT THE CASE IT FEARED AND WRONG ABOUT
  // THE CASE IT CREATED**: an INTERNAL file reference — a yaml `embed.yml` sitting beside the file that
  // refers to it — was classified EXTERNAL AND UNVERIFIABLE, so an edge that is provably resolvable read
  // as "a claim no check can reach", and since a PASS requires `externalUnverified === 0` the lane could
  // never get there. Measured before this fix: **yaml 711 of 742 `externalUnverified` are path-like,
  // 95.8%**, and 3 of 3 sampled targets exist in the corpus beside their referring files.
  //
  // THE SPLIT IS THREE-WAY, AND ONLY CASE 1 IS A REFUTATION — the 113 false refutations came from
  // treating EVERY path as case 1:
  //   1  a path that IS in the project's admitted file list -> the marker is provably wrong, the file
  //                                                            is HERE -> REFUTED (evidence, not a guess)
  //   2  a path that exists NOWHERE in the corpus           -> genuinely outside OR dangling; the
  //                                                            corpus cannot tell those apart, so it
  //                                                            stays a REFUSAL — recorded, never silence
  //   3  a URI with a scheme                                -> genuinely external, UNCHANGED
  //
  // AND THE `ext?` THAT REMAINS IS NOT A DEAD END FOR BARE NAMES. The comment further down this file
  // claims the strict condition was unreachable for lanes whose targets are bare names (php 2,478 of
  // 2,483; bash every command). THAT COMMENT WAS STALE WHEN IT WAS WRITTEN: it describes a rule that no
  // longer exists. A clean bare name IS looked up directly today and cannot land in `ext?` unless it
  // carries whitespace or braces — asserted in this gate's own control at
  // `incoming-gate.ts` ("a bare identifier the key space does not publish did not verify as external").
  // A MODULE-MEMBER CLAIM IS VERIFIABLE. The claim is "this module is not declared by this project", and
  // there IS evidence for that: a project file carrying the module as a path segment, or a published
  // symbol spelled as the module. Both spellings are tried because a module written `ansible.errors` is a
  // dotted PATH convention while `@scope/pkg` is a slash one -- the rule reads the spelling, not a language.
  if (moduleMemberTarget(tgt)) {
    // A MODULE-MEMBER CLAIM IS VERIFIED, NEVER REFUTED FROM PROJECT-WIDE EVIDENCE.
    //
    // The first version of this branch DID refute, using two project-wide tests: a published symbol named
    // as the module, or any project path with the module as a segment. The python lane measured what that
    // produced and every single refutation was a FALSE POSITIVE -- 18 distinct targets / 21 edges:
    //
    //   typing:Any :List :Optional ...  (16 edges) refuted because a project owns `util/typing.py` (which
    //     publishes a module symbol named `typing`) and `test/typing/` (a directory). But PYTHON SHADOWING
    //     IS SCOPED TO THE IMPORTING FILE's directory and sys.path: a `typing.py` under `sqlalchemy/util/`
    //     does not make `from typing import Any` in `sqlalchemy/testing/suite/` import it.
    //   logging:* (1 edge) refuted by DIRECTORIES in Go vendored code -- not a Python module at all.
    //   array:*  (1 edge) refuted by `postgresql/array.py` (a different module) and unrelated dirs.
    //
    // THE MEASUREMENT CANNOT EXPRESS THE QUESTION: `verifyExternalClaim` is not given the importing file,
    // so project-wide adjacency is the only test available, and project-wide adjacency is not shadowing.
    // A false refutation is a false statement in the opposite direction -- it asserts the PROJECT owns a
    // module it does not -- so it is not an acceptable error to trade. Refutation here needs the importing
    // file (and, for python, sys.path roots); until this function is given one, the honest answer is to
    // VERIFY the claim and record the limitation rather than manufacture a refutation.
    return "externalVerified"
  }
  // A RESERVED PLATFORM NAMESPACE IS A CITATION, AND IT MUST BE READ BEFORE THE PATH-LIKE TEST.
  // (JLS §6.1 / JPMS; see RESERVED_PLATFORM_NAMESPACES.) Second measured defect in this area, found by
  // the java lane's post-fix residual split (2026-10-19): reserved dotted targets whose LAST SEGMENT
  // looks like a file extension -- `java.io.File`, `java.util.concurrent.locks.Lock`,
  // `java.nio.file.Path` -- were refused by `pathLikeTarget` BEFORE this citation branch ran, leaving
  // **243** whole-population rows in `ext?` that the refiner fix (`ebbf68b04`) could not reach. A
  // package path is not a file path simply because its leaf name ends in `.File`: the reserved
  // namespace prefix is decisive. Measured defect history: `java.util` was also refuted by a scala3
  // test file declaring `class java`, charging 24 true claims as extFAIL against a lane.
  const reservedPlatform = RESERVED_PLATFORM_NAMESPACES.some((ns) => {
    const bare = ns.endsWith(".") ? ns.slice(0, -1) : ns
    return tgt === bare || (tgt.length > ns.length && tgt.startsWith(ns))
  })
  if (reservedPlatform) return "externalVerified"
  if (pathLikeTarget(tgt)) {
    if (URI_SCHEME.test(tgt) && !WINDOWS_DRIVE.test(tgt)) return "externalUnverified"
    if (facts) return pathTargetInProject(facts, tgt) ? "externalRefuted" : "externalUnverified"
    return "externalUnverified"
  }
  const owner = targetOwner(tgt)
  // NO DOTTED OWNER: ask about the TARGET ITSELF when it is a plain identifier, and stay
  // unverifiable when it is not (a path or URI cannot be a published symbol's name, so a
  // lookup returning 0 would prove nothing about the claim).
  if (owner === null) {
    // A PUBLISHED NAME MAY CARRY A SIGIL — this test was a JavaScript-identifier test, and it
    // silently disabled the check for every sigiled language. Found by css-lane, which measured the
    // consequence on css's whole population: of 5,641 dotless custom-property reads, ALL 5,641
    // returned `externalUnverified`, including 4,665 naming a property declared nowhere in the
    // population and 138 naming one declared in another corpus project. Its control is what makes it
    // undeniable — `--pico-color` read `externalUnverified` WHETHER OR NOT the key space declared
    // it, and a refusal that returns the same verdict for a true and a false claim is not a safety
    // property, it is a refusal to look.
    //
    // The premise the old test rested on ("a path or URI cannot be a published symbol's name, so a
    // lookup returning 0 would prove nothing") is CORRECT and is already enforced upstream:
    // `pathLikeTarget` above refuses a path separator, a URI scheme, or a known file extension
    // before this line is reached. What remained to refuse here is not a path but GARBAGE — a
    // whitespace-bearing snippet, a brace or quote fragment — and that is now the whole test. A css
    // custom property (`--pico-color`), a class (`.btn`) and an id (`#main`) are published names in
    // their language and must be looked up like any other.
    if (/[\s{}`<>"']/.test(tgt)) return "externalUnverified"
    return (declCount.get(tgt) ?? 0) > 0 ? "externalRefuted" : "externalVerified"
  }
  // `:`, `/` or whitespace means the owner is not an identifier — a URI scheme, a path, or
  // a member spelling like `operator ==`. No published symbol can be keyed by it, so a
  // lookup would return 0 for a reason that has nothing to do with the claim.
  if (/[:/\s]/.test(owner)) return "externalUnverified"
  return (declCount.get(owner) ?? 0) > 0 ? "externalRefuted" : "externalVerified"
}

/**
 * WHAT AN AMBIGUOUS EDGE'S CLAIM AMOUNTS TO.
 *
 * `contradicted` and `ownFileSilent` are the two halves of what the first version called, wrongly,
 * `refuted`. The distinction is SCOPE, and it was found by reading the PRODUCER rather than the count:
 *
 *   `real-css-analyzer.ts:115` — "CSS-D16: `var(--x)` reads marked `isExternalTarget` because
 *   **THIS FILE** declares no `--x`", and `:1347` — "the external marker on a read **this file cannot
 *   see**". So css's claim is a **PER-FILE** statement. The arbiter verifies it against the **PROJECT**
 *   key space, and on css **all 180** of its ambiguous edges came back `contradicted` — the target
 *   declared somewhere in the project, which is a DIFFERENT question from the one the analyzer asked.
 *
 * **A PER-FILE CLAIM CANNOT BE REFUTED BY ANOTHER FILE'S DECLARATION.** So the two cases must be
 * counted apart:
 *
 *   `contradicted`  — the EDGE'S OWN FILE declares the target. A declaration answering to a claim of
 *                     externality is a refutation under BOTH scope readings, so this one is solid.
 *   `ownFileSilent` — only ANOTHER file declares it. The claim is TRUE at its own-file scope; whether
 *                     it is true at PROJECT scope depends on what the individual MARKER means, and that
 *                     is NOT settled (see below), so it is reported as NOT a refutation.
 *
 * AND THE REMAINING OPEN QUESTION IS NAMED RATHER THAN ASSUMED. The generic kind covers markers of
 * different scope: `isExternalTarget` (css) says "my file cannot see this", while `isStdlib` /
 * `stdlibModule` / `nimStdlibModule` say something about the NAME'S ORIGIN, which a project declaring a
 * same-named symbol does not falsify either. **`verifyExternalClaim` asks "does the project declare the
 * target?" — a question about this project's declarations — for claims that are not about this
 * project's declarations.** Settling that needs a per-MARKER scope table, which does not exist yet.
 * Until it does, `ownFileSilent` is reported as a class with its count and NOT as a failure.
 */
export type AmbiguousClaimDisposition =
  | "verified" | "unverified" | "refuted" | "contradicted" | "ownFileSilent" | "notApplicable"

export type Classified = {
  outcome: Outcome
  /** how many declarations answer to the target IN THIS KEY SPACE */
  decls: number
  /**
   * RESOLVED, BUT AMONG A COLLISION — the third outcome the gate could not express.
   *
   * The programme's bar asks whether a relationship is REAL. Production writes a row for every
   * type with a `LIMIT 1` statement, so it never reaches an "N candidates" state — but the
   * indexer's own comment on `resolveTargetStmt` says what that binding costs:
   *
   *     the statement picks between them by `s.id` alone, which is `${fileId}:${name}:${line}`
   *     compared as TEXT — so it is the LEXICOGRAPHICALLY smallest line that wins, NOT the
   *     intended symbol
   *
   * with a measured control arm recording **37,318 of 49,729 ambiguous edges bound to the WRONG
   * symbol**. So "a declaration was found" and "the declaration the edge meant was found" are
   * different facts, and a lane reporting only `resolved` will hide the second.
   *
   * `true` on a `resolved` outcome whose target has more than one declaration in the key space.
   * It is reported in its own column, never folded into `resolved` or into `ambiguous`.
   *
   * IT IS AN UPPER BOUND, NOT A COUNT OF ARBITRARY PICKS — and that distinction is a correction to
   * this flag's own first version, made after measuring make (`contains` 1,106 resolved, 143 flagged,
   * 12.9%). BOTH resolvers put the edge's own file SECOND in their ORDER BY:
   *
   *     resolveContainsTargetStmt  ORDER BY (s.file_id = ?) DESC, (s.line_start = ?) DESC, …
   *     resolveTargetStmt          ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC, …
   *
   * so a collision is DETERMINATE whenever the edge's own file declares that name exactly once —
   * the preference picks it and no tie-break is involved. This flag cannot see that, because
   * `classifyEdge` is handed a name-keyed count and no file. It fires on "the PROJECT has more than
   * one", which is a superset of "the choice was arbitrary".
   *
   * SO READ IT AS: "this many resolved edges belong to a name that collides somewhere in the
   * project". The subset that is genuinely arbitrary is bounded above by this and is only known by
   * reading the store (edge `line_number` against symbol `line_start`; hcl-lane's
   * `store-binding-truth.mts` is the working example). A lane must not treat the number as a defect
   * count, and must not treat 0 as proof that every pick was determined — 0 does mean no colliding
   * name was involved at all, which is the strongest reading available here.
   */
  boundAmongCollision?: boolean
  /** the distinct kinds among them, `|`-joined — empty when there are none */
  kinds: string
  /** WHICH evidence confirmed a verified external claim — reported so a lane can audit the
   *  mechanism that produced the number, not only the number. */
  verifiedBy?: "owner" | "target" | "projectFacts" | "binding" | "spelling" | "namespace" | "sourcePath" | "ownerChannel" | "importEvidence" | "exportSurface"
  /**
   * WHAT A CLAIM SAYS ABOUT A TARGET THAT NAMES TWO OR MORE DECLARATIONS — recorded WITH ITS KIND,
   * and deliberately NOT allowed to move the outcome. See `claimDispositionOnAmbiguous`.
   *
   * THE KIND IS PART OF THE FACT, not decoration: the first version of this field reported a bare
   * disposition, and on scss it printed "714 unverifiable" — a label that mixes a `cause` (which is
   * not a claim to be external at all, so "unverifiable" is a category error) with a `projectFile`
   * claim whose candidate did not resolve. **Two different things under one word is how a disclosure
   * becomes a misleading claim**, so the kind travels with the disposition and the report groups by it.
   */
  claimOnAmbiguous?: { kind: string; disposition: AmbiguousClaimDisposition }
}

/**
 * WHICH LABEL GOES THROUGH THE `containsLike` RULE — the only type whose binding statement
 * differs, so it is the one type `classifyEdge` must be told about.
 *
 * THIS FUNCTION EXISTS BECAUSE THE RULE HAD NO CONTROL, and it is worth writing down what that
 * cost. `fa2dc27e8` added the caller's test as `e.label === "contains" || e.type === "contains"`,
 * where the second operand reads a FIELD THE CALLER'S OWN STRUCT DOES NOT HAVE — a typecheck error
 * (TS2339) that sat at HEAD while every lane's control stayed green, because `selfTest` planted
 * cases for every claim kind and NOT ONE for `containsLike`. The label comparison happened to
 * short-circuit first, so the behaviour was right by luck; nothing in the instrument could say so.
 * A rule that carries ~97,800 whole-corpus edges (arm7's `contains` ambiguous column, the exact
 * number this rule exists to reclassify) and is asserted by nothing is a rule that is one
 * refactor away from being off.
 *
 * So the caller's test lives here, in the module that owns the classification, and `selfTest`
 * asserts THIS function rather than re-spelling the comparison: the control now fails if the rule
 * stops being applied to `contains`, and it cannot pass by testing a copy the gate does not call.
 */
export function isContainsEdge(label: string): boolean {
  return label === "contains"
}

/**
 * WHAT A CLAIM WOULD SAY ABOUT AN AMBIGUOUS TARGET — computed WITHOUT letting it change the outcome.
 *
 * `classifyEdge` reads a claim only where the target names NOTHING, apart from `binding`, `remoteRef`
 * and a conflicting `cause` — those three are checked BEFORE the count, because a declaration that
 * answers them REFUTES them. So a `projectFile`, `projectFacts` or non-conflicting `cause` claim riding
 * on a target that names TWO OR MORE declarations was **never read at all**: not refuted, not verified,
 * not counted.
 *
 * scss-lane measured what that costs a reader: **693 of its ambiguous edges carry a claim**, its
 * printed `references` row read **1,499** where the claim-aware count is **787**, and the lane sized its
 * repairable work roughly **30% high** — with nothing in the output saying so.
 *
 * THE CLAIM IS NOT ALLOWED TO CHANGE THE OUTCOME HERE, and that is the decision rather than an
 * omission. An edge can genuinely be BOTH ambiguous and file-shaped: the target names two declarations
 * AND names a file that exists. Subtracting the claim from the ambiguity column would HIDE a real
 * collision rather than resolve it, which is the laundering shape this programme refuses everywhere
 * else. So the outcome is untouched and the FACT is recorded, so the column can finally be read for
 * what it is. The disposition is computed through the SAME verifiers the `decls === 0` branch uses, so
 * there is one rule and not two.
 */
function claimDispositionOnAmbiguous(
  declCount: Map<string, number>, tgt: string, claim: ExternalClaim | null, facts?: ProjectFacts,
  /** does the EDGE'S OWN FILE declare the target? `undefined` means the caller could not say, and the
   *  disposition then stays `contradicted` only if the project does — never a claim of refutation. */
  ownFileDeclares?: boolean,
): { kind: string; disposition: AmbiguousClaimDisposition } | undefined {
  // `declCount` is read to STATE THE BRANCH INVARIANT rather than to verify anything: every caller
  // reaches here from `decls > 1`, and if that ever stops being true the kind below is wrong.
  const decls = declCount.get(tgt) ?? 0
  if (claim === null) return undefined
  const map = (o: Outcome): AmbiguousClaimDisposition =>
    o === "externalVerified" ? "verified" : o === "externalRefuted" ? "refuted" : "unverified"
  // A `cause` IS NOT A CLAIM TO BE EXTERNAL. It says why an edge could not reach its base, it can only
  // re-label a gap, and it has nothing to verify against an ambiguous target. (The conflicting form was
  // already settled before the count and never reaches here.)
  if (claim.kind === "cause") return { kind: "cause", disposition: "notApplicable" }
  if (claim.kind === "sourcePath") {
    // PROPERTY 4, cross-tabbed: an ambiguous edge carrying a source-path claim reports which way the
    // ADMITTED FILE LIST settled it — the same discipline every other kind follows.
    const files = (facts as { files?: Set<string> } | undefined)?.files
    let admitted = false
    for (const src of claim.sources) {
      for (const cand of sourcePathCandidates(src)) if (files !== undefined && files.has(cand)) admitted = true
    }
    return { kind: "sourcePath", disposition: admitted ? "refuted" : "verified" }
  }
  if (claim.kind === "packageScope") {
    // PROPERTY 4, cross-tabbed like every other claim: an ambiguous edge carrying a package-scope
    // claim reports which way the MANIFEST settled it, exactly as the other kinds report theirs —
    // never merged into the raw column. The disposition is attached HERE, because this branch
    // returns before the shared cross-tab block and an ambiguous package-claimed edge would
    // otherwise report no disposition at all.
    const disposition: AmbiguousClaimDisposition = facts
      ? (verifyPackageScopeClaim(facts, claim.package, edgeFile) === "externalVerified" ? "verified" : "refuted")
      : "unverified"
    return { kind: "packageScope", disposition }
  }
  if (claim.kind === "namespace") {
    // PROPERTY 4, cross-tabbed: an ambiguous edge carrying a namespace claim reports which way the
    // LIST settled it, exactly as the other kinds report theirs — never merged into the raw column.
    return {
      kind: "namespace",
      disposition: namespaceMatchOf(tgt, claim.roots) !== null ? "verified" : "refuted",
    }
  }
  if (claim.kind === "projectFacts") {
    return { kind: "projectFacts", disposition: facts ? map(verifyImportClaim(facts, tgt)) : "unverified" }
  }
  if (claim.kind === "projectFile") {
    // A FILE CLAIM CAN GENUINELY VERIFY ON AN AMBIGUOUS TARGET: the target may name files AND collide
    // with declarations, and the claim is about a FILE. So this one is really run.
    return {
      kind: "projectFile",
      disposition: facts ? map(verifyFileClaim(facts, claim.candidates)) : "unverified",
    }
  }
  // ── THE GENERIC EXTERNAL MARKER ON A TARGET THAT NAMES DECLARATIONS ────────────────────────────
  //
  // THE PREVIOUS VERSION CALLED ALL OF THESE `contradicted` AND THAT WAS WRONG FOR A REASON THE PRODUCER
  // STATES PLAINLY. `real-css-analyzer.ts:115` — "CSS-D16: `var(--x)` reads marked `isExternalTarget`
  // because **THIS FILE** declares no `--x`". The claim is PER-FILE; the check below is PROJECT-scoped.
  // On css **all 180** ambiguous edges came back contradicted against a claim that was, at its own scope,
  // TRUE. **A per-file claim cannot be refuted by another file's declaration**, so the two cases are
  // counted apart and only the own-file one is a refutation under both readings.
  //
  // And the residual question is NAMED, not assumed: some generic markers (`isStdlib`, `stdlibModule`,
  // `nimStdlibModule`) are about a NAME'S ORIGIN, which this project declaring a same-named symbol does
  // not falsify either. `verifyExternalClaim` asks a question about THIS PROJECT'S DECLARATIONS, for
  // claims that are not about this project's declarations. A per-MARKER scope table would settle it and
  // does not exist — so `ownFileSilent` is reported with its count and NOT as a failure.
  if (decls <= 1) {
    // THE INVARIANT BROKE — this is not the branch it documents, so the honest answer is UNKNOWN.
    return { kind: String((claim as { kind?: string }).kind ?? "external"), disposition: "unverified" }
  }
  const kind = String((claim as { kind?: string }).kind ?? "external")
  if (ownFileDeclares === true) return { kind, disposition: "contradicted" }
  return { kind, disposition: "ownFileSilent" }
}

/**
 * THE ONE RULE. Measurement and control both call this, because two copies of a counting
 * rule are two rules, and the copy the control runs is the one that stays correct.
 */
/**
 * THE PROJECT'S OWN MODULE NAMES — every directory basename and every file stem in the admitted file list.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A `ProjectIndex` LOOKUP. A claim verified against the SYMBOL key space is
 * making a statement about DECLARATIONS, and a package/directory name is not a declaration. So this is true and
 * still wrong: "the project key space does not answer `grace_generated_openapi_probe`" — because that name is a
 * DIRECTORY, the symbols live inside it, and the edge is labelled external while it imports the project's OWN
 * generated code. Measured by python's lane over 10,649 claimed edges: **1,131 (10.6%) are this shape**, and the
 * first form of its falsifier returned 0 only because the sample repos had no top-level package — A ZERO OVER AN
 * EMPTY SET IS NOT A ZERO.
 *
 * LANGUAGE-AGNOSTIC ON PURPOSE. The same shape exists elsewhere (java's `org.`/`com.` where "in a multi-module
 * build `com.acme` IS project source"). Deriving from the FILE LIST rather than a manifest means the check needs
 * no per-language fact source and covers every lane at once.
 *
 * CACHED ON THE FACTS OBJECT because `classifyEdge` runs once per edge and a fleet has ~10^6 of them; rebuilding
 * this set per call would be O(files) per edge. `ProjectFacts` is stable for a run, so a WeakMap is exact.
 */
const MODULE_NAMES_CACHE = new WeakMap<ProjectFacts, Set<string>>()
function projectModuleNames(facts: ProjectFacts): Set<string> {
  const hit = MODULE_NAMES_CACHE.get(facts)
  if (hit) return hit
  const names = new Set<string>()
  for (const f of facts.files) {
    const slash = f.lastIndexOf("/")
    const base = slash >= 0 ? f.slice(slash + 1) : f
    const dot = base.lastIndexOf(".")
    if (dot > 0) names.add(base.slice(0, dot))
    if (slash > 0) {
      const dir = f.slice(0, slash)
      const dSlash = dir.lastIndexOf("/")
      names.add(dSlash >= 0 ? dir.slice(dSlash + 1) : dir)
    }
  }
  MODULE_NAMES_CACHE.set(facts, names)
  return names
}

export function classifyEdge(
  declCount: Map<string, number>,
  kinds: Map<string, Set<string>>,
  tgt: string,
  claim: ExternalClaim | null,
  /** the project's own facts, for a `projectFacts` claim. Absent means the check could not
   *  be run at all, and the claim is then UNVERIFIABLE — never quietly accepted. */
  facts?: ProjectFacts,
  /**
   * IS THIS EDGE RESOLVED BY A DIFFERENT STATEMENT? `contains` is.
   *
   * Production's `resolveContainsTargetStmt` (`parallel-indexer.ts`) is
   *     WHERE s.project_id = ? AND s.name = ?
   *     ORDER BY (s.file_id = ?) DESC, (s.line_start = ?) DESC, ... LIMIT 1
   * — it prefers the edge's OWN FILE, then its own line, and returns exactly ONE row or none. So a
   * `contains` edge has no "N candidates" state: it binds, or the name is absent. Classifying it by
   * DECLARATION COUNT therefore reports collisions production does not have, and xml-lane measured
   * the size of that gap: the gate's count model reads **94.1% ambiguous** where the real store
   * binds **98.4%, 97.9% of it same-file**.
   *
   * `true` means "the project holds at least one declaration of this name, so production's LIMIT 1
   * binds it" — reported as `resolved`, which is what it is. The resolver that chose WHICH row is
   * deterministic and disclosed here rather than modelled in full: file first, then line, then
   * declaration, then language, then id. An unmodelled ordering can pick a different row, but it
   * cannot fail to pick one, and "ambiguous" was never the alternative.
   */
  containsLike?: boolean,
  /** DOES THE EDGE'S OWN FILE DECLARE THE TARGET? Needed because a per-file claim cannot be
   *  refuted by another file's declaration — see `claimDispositionOnAmbiguous`. `undefined` means the
   *  caller cannot say, and the disposition then never claims a refutation on that basis. */
  ownFileDeclares?: boolean,
  /**
   * THE OWNER CHANNEL'S VERDICT for a row that states its receiver (`metadata.owner`) — the rule
   * `member-owner-resolution.ts` runs in production, modelled in `script/m14/owner-channel.ts`.
   *
   * WHY IT OVERRIDES THE NAME COUNT. Production WITHDRAWS the name-based binding for every
   * calls/uses row carrying an owner and re-binds only through this channel, so the name count is
   * not merely less precise for those rows — it measures a binding production deliberately removed.
   * `resolved` here means the channel found exactly one declaration (owner, same-kind duplicate or
   * a unique ancestor); `declined` means the store leaves the row NULL, and an unresolved row whose
   * name happens to be unique must read `unresolved`, not `resolved`.
   *
   * `undefined` means the row is not the channel's input (no owner, or not calls/uses) and every
   * branch below behaves exactly as before it existed.
   */
  ownerChannel?: { outcome: "resolved" | "declined" },
  /**
   * THE EDGE'S OWN FILE, for claims whose evidence is FILE-SCOPED. Only the imported-binding claim
   * reads it (the file decides whether an import of the claim's specifier binds the claim's name).
   * `undefined` means the caller did not pass it and the claim is UNVERIFIED — never accepted from
   * the edge's own word.
   */
  edgeFile?: string,
): Classified {
  const decls = declCount.get(tgt) ?? 0
  if (containsLike === true && decls >= 1) {
    const ks = kinds.get(tgt)
    // NOTE: production prefers the edge's OWN FILE here, which is a stronger tie-break than the
    // general statement's — so a collision is still flagged, and the flag reads "more than one
    // declaration in the project answers to this name", which is exactly what the reviewer needs.
    return { outcome: "resolved", decls, kinds: [...(ks ?? [])].sort().join("|"), boundAmongCollision: decls > 1 }
  }
  const kindSet = kinds.get(tgt)
  const kindText = [...(kindSet ?? [])].sort().join("|")
  // ── THE INFERRED `importPath` CLAIM IS A LAST-RESORT, AND IT MAY NOT OUTLIVE ITS OWN PREMISE ────
  // `externalClaimOf` synthesizes it for an `imports` edge whose target is dotted-and-capitalised when
  // the ANALYZER claimed nothing. The inference says "this names a module path outside the project".
  // A project whose own key space ANSWERS that path refutes the inference, and the row must then be
  // classified on its evidence like any unclaimed edge — NOT charged as a refuted claim against a lane
  // that never made one. MEASURED consequence of not doing this: java's whole-repository
  // graphql-java arm (`import static graphql.Scalars.GraphQLString;`) read extFAIL 440, failing
  // clause 4 on an inference while the lane claimed nothing at all; the same rows verified at cap-50
  // only because the sampled project did not carry the declaration.
  if (claim !== null && claim.kind === "importPath") {
    const owner = targetOwner(tgt)
    const answered = (declCount.get(tgt) ?? 0) > 0 || (owner !== null && (declCount.get(owner) ?? 0) > 0)
    if (answered) claim = null
  }
  // ── THE OWNER CHANNEL IS CHECKED FIRST, BEFORE EVEN THE CLAIMS, because in production it runs
  // LAST and WINS: `claimOwnerCarryingTargets` withdraws the name binding for every calls/uses row
  // carrying `metadata.owner`, then the channel re-binds it. A row it resolves therefore HAS a
  // target_symbol_id no matter what any earlier strategy or marker said — so the gate must report
  // the resolution first and let every other branch below be reachable only for a row the channel
  // DECLINES. Modeling it below the claim branches would let a claim marker hide a resolution
  // production holds.
  if (ownerChannel !== undefined && ownerChannel.outcome === "resolved") {
    return { outcome: "resolved", decls, kinds: kindText, verifiedBy: "ownerChannel" }
  }
  // A DECLINE does not fall through to the count model: the store withdrew the name binding, so the
  // row is NULL in production even when its name is unique here. It still falls through the CLAIM
  // branches (a decliner keeps its declared marker, unverified-but-stated), and the tail below reads
  // `channelDeclined` to return `unresolved` instead of a name-based `resolved`.
  const channelDeclined = ownerChannel !== undefined && ownerChannel.outcome === "declined"
  // THE EXPORT-SURFACE CLAIMS ARE THE SOLE AUTHORITY FOR THEIR EDGES (2026-10-19): an exports row
  // naming `default` or a CommonJS property names a SURFACE, not a declaration, so a name-model
  // "resolution" for it would be a fabricated public name (the JD-J14 family). Verified from the
  // run's key space + the claim's shape, never from the claim's own word alone; rides the BINDING
  // family and NEVER raises `resolved`.
  if (claim !== null && claim.kind === "exportSurface") {
    const outcome = claim.surface === "default"
      ? verifyDefaultExportClaim(claim, tgt, declCount)
      : verifyModuleExportsClaim(claim, tgt, declCount)
    const disposition: AmbiguousClaimDisposition =
      outcome === "bindingVerified" ? "verified" : outcome === "bindingUnverified" ? "unverified" : "refuted"
    return {
      outcome, decls, kinds: kindText,
      verifiedBy: outcome === "bindingVerified" ? "exportSurface" : undefined,
      ...(decls > 1 ? { claimOnAmbiguous: { kind: "exportSurface", disposition } } : {}),
    }
  }
  // THE IMPORTED-NAME CLAIM IS A WALL-CLASS CONVERTER, NOT A DISPLACER (python arm measurement
  // 2026-10-19): it may only SPEAK FOR A ROW THE NAME MODEL HAS NOTHING TO SAY ABOUT (declCount === 0).
  // When the row already has a declaration answer (decls > 0) the name model / an external marker
  // owns the classification and the claim falls through — otherwise the claim column eats verified
  // external claims (measured: python extOK −16,277) and re-labels rows that already had answers.
  // The claim's own evidence still decides when it does apply; it never resolves to a declaration.
  if (claim !== null && claim.kind === "importedName" && decls === 0) {
    const outcome = verifyImportedNameClaim(claim, tgt, facts, edgeFile)
    const disposition: AmbiguousClaimDisposition =
      outcome === "bindingVerified" ? "verified" : outcome === "bindingUnverified" ? "unverified" : "refuted"
    return {
      outcome, decls, kinds: kindText,
      verifiedBy: outcome === "bindingVerified" ? "importEvidence" : undefined,
      ...(decls > 1 ? { claimOnAmbiguous: { kind: "importedName", disposition } } : {}),
    }
  }
  // THE IMPORTED-BINDING CLAIM IS THE SOLE AUTHORITY FOR ITS EDGES (2026-10-19), and it is checked
  // BEFORE every count-based branch for the namespace claim's reason: a file-scoped import binding
  // OCCUPIES its file's name, so a same-named declaration elsewhere in the project is not the
  // target of this edge — that coincidence is exactly the name-model decoy class. The claim is
  // verified from the run's own import edges and REFUTED only when that evidence contradicts it
  // (the file does not bind the name / imports another specifier / no evidence). Counting a claim
  // on a name the key space also declares as REFUTED (the first version) re-introduced the decoy
  // class from the other side and measured 389/1,299 refutations on a cap-50 smoke — fixed here.
  if (claim !== null && claim.kind === "importedBinding") {
    let outcome = verifyImportedBindingClaim(claim, facts, edgeFile)
    // RECEIVER-POSITION ADDITIONS (JS contract): the target must be a MEMBER LEAF, distinct from the
    // binding itself, and name-shaped. Chain purity is the analyzer's emission duty (the arbiter
    // cannot re-check it from edges); these three checks are the parts of the statement edges can
    // refute.
    if (claim.position === "receiver" && outcome === "bindingVerified") {
      if (tgt === claim.binding) outcome = "bindingRefuted"
      else if (!/^[A-Za-z_$][\w$]*$/.test(tgt)) outcome = "bindingRefuted"
    }
    const disposition: AmbiguousClaimDisposition =
      outcome === "bindingVerified" ? "verified" : outcome === "bindingUnverified" ? "unverified" : "refuted"
    return {
      outcome, decls, kinds: kindText,
      verifiedBy: outcome === "bindingVerified" ? "importEvidence" : undefined,
      ...(decls > 1 ? { claimOnAmbiguous: { kind: "importedBinding", disposition } } : {}),
    }
  }
  // THE PACKAGE-SCOPE CLAIM IS THE SOLE AUTHORITY FOR ITS EDGES, and it is checked before every
  // count-based branch for the same reason the namespace claim is: the claim makes a statement the
  // PROJECT'S MANIFEST can check, so the check must be the manifest's verdict and never the symbol
  // table's.
  //
  // IT NEVER DISPLACES A NAME-MODEL ANSWER: with `decls > 0` the row keeps its declaration answer
  // and the claim falls through — the same rule the `strict-absent` namespace claim follows, and the
  // same reason the cpp lane's pre-committed falsifier fired (a claim that displaced 12,883
  // name-model resolutions was a false claim). A claim may not win where the project already has an
  // answer.
  //
  // AND IT IS FAIL-CLOSED IN BOTH DIRECTIONS: no manifest evidence = UNVERIFIABLE (never quietly
  // accepted); a dependency the manifest does not declare = REFUTED (the claim is false, and the row
  // is counted as the defect it is).
  if (claim !== null && claim.kind === "packageScope" && decls === 0) {
    if (!facts) return { outcome: "externalUnverified", decls, kinds: kindText }
    const outcome = verifyPackageScopeClaim(facts, claim.package, edgeFile)
    return {
      outcome,
      decls,
      kinds: kindText,
      verifiedBy: outcome === "externalVerified" ? "packageScope" : undefined,
    }
  }
  // THE NAMESPACE CLAIM IS THE SOLE AUTHORITY FOR ITS EDGES, checked before every count-based
  // branch because the design's whole point is that the ROOT is checked against the LIST and never
  // against the symbol table (property 1). Refutable by construction: a root the analyzer did not
  // declare reads `externalRefuted`, so the claim can never become a blanket excuse.
  // A `strict-absent` namespace claim (cpp citation narrowing) may not displace a name-model
  // answer: with decls > 0 the row keeps its declaration answer and the claim falls through.
  if (claim !== null && claim.kind === "namespace" && !(claim.strictAbsent === true && decls > 0)) {
    const listed = namespaceMatchOf(tgt, claim.roots, { slash: claim.slash === true }) !== null
    // PROPERTY 4 — CROSS-TABBED LIKE ANY OTHER CLAIM. This branch returns before the shared
    // cross-tab block, because the claim is the sole authority for the OUTCOME and returning early
    // is the point; the disposition therefore has to be attached HERE, or an ambiguous
    // namespace-claimed edge would report no disposition at all. Found by the refutation test's
    // arm E — which is why that arm exists.
    const disposition: AmbiguousClaimDisposition = listed ? "verified" : "refuted"
    return {
      outcome: listed ? "externalVerified" : "externalRefuted",
      decls,
      kinds: kindText,
      verifiedBy: listed ? "namespace" : undefined,
      ...(decls > 1 ? { claimOnAmbiguous: { kind: "namespace", disposition } } : {}),
    }
  }
  // THE SOURCE-PATH CLAIM, checked before every count-based branch for the namespace claim's reason: the
  // LIST OF ADMITTED FILES is the sole authority, and the polarity is inverted — a candidate the project
  // admits REFUTES this claim. Absent facts means the check could not be run at all: `externalUnverified`,
  // never a quiet acceptance.
  if (claim !== null && claim.kind === "sourcePath") {
    if (facts === undefined || facts === null) {
      return { outcome: "externalUnverified", decls, kinds: kindText }
    }
    let admitted: string | null = null
    const files = (facts as { files?: Set<string> }).files
    for (const src of claim.sources) {
      for (const cand of sourcePathCandidates(src)) {
        if (files !== undefined && files.has(cand)) { admitted = cand; break }
      }
      if (admitted !== null) break
    }
    const disposition: AmbiguousClaimDisposition = admitted === null ? "verified" : "refuted"
    return {
      outcome: admitted === null ? "externalVerified" : "externalRefuted",
      decls,
      kinds: kindText,
      verifiedBy: admitted === null ? "sourcePath" : undefined,
      ...(decls > 1 ? { claimOnAmbiguous: { kind: "sourcePath", disposition } } : {}),
    }
  }
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
  // THE OWNER-MEMBER-ABSENCE CLAIM — a WALL-CLASS converter, like the imported-name narrowing:
  // it may speak only where the name model has nothing (decls === 0) so it cannot displace a binding.
  // The target must be the claimed member; the fact is checked in the caller's evidence map.
  if (claim !== null && claim.kind === "ownerMemberAbsent" && decls === 0) {
    if (tgt !== claim.member) return { outcome: "externalRefuted", decls, kinds: kindText }
    if (!facts || !facts.ownerMembers) return { outcome: "externalUnverified", decls, kinds: kindText }
    const members = facts.ownerMembers.get(claim.owner)
    if (members === undefined) return { outcome: "externalUnverified", decls, kinds: kindText }
    if (members.has(claim.member)) return { outcome: "externalRefuted", decls, kinds: kindText }
    return { outcome: "externalVerified", decls, kinds: kindText, verifiedBy: "ownerMembers" }
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
    if (claim.kind === "moduleNamespace") {
      // NO FACTS MEANS NO CHECK, exactly as the projectFile branch states: an unchecked claim is never clean.
      if (!facts) return { outcome: "externalUnverified", decls, kinds: kindText }
      // THE ROOT, not the whole module path: `xml.sax.handler` is contained in `xml`. Splitting on `.` as well
      // as `/` is what makes a dotted module findable in a directory space; the FIRST segment is the root.
      const root = claim.module.split(/[./\\]/)[0]
      const present = root.length > 0 && projectModuleNames(facts).has(root)
      return {
        outcome: present ? "externalUnverified" : "externalVerified",
        decls, kinds: kindText,
        verifiedBy: present ? undefined : "projectFacts",
      }
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
    // `facts` IS PASSED THROUGH: it is what lets a path-shaped target be ANSWERED (case 1 = the file is
    // in the project, so the external marker is provably wrong) instead of only refused. Where the
    // caller built no file list, the verdict is the old refusal — unchanged, never quietly accepted.
    let outcome = verifyExternalClaim(declCount, tgt, facts)
    // THE PROJECT-ABSOLUTE REFINER. A claim can be TRUE of the symbol key space and FALSE of the project: a
    // package/module root is a DIRECTORY, not a declaration, so the key space cannot answer it and the claim
    // verifies while the edge names the project's own code. FAIL-CLOSED, NEVER REFUTED — the verdict becomes
    // `externalUnverified` (`ext?`), so `extFAIL` cannot rise by construction and a claim that later proves
    // wrong is visible as unverified rather than laundering a gap into a verified external.
    if (outcome === "externalVerified" && facts && claim.kind === "owner" && claim.specifier) {
      const root = claim.specifier.split(/[.:/\\]/)[0]
      // RESERVED PLATFORM NAMESPACES ARE NOT PROJECT LAYOUT (measured by the java lane, 2026-10-19).
      // The refiner's job is to demote a claim when the specifier's ROOT is a directory the project
      // carries — `src/main/java` is such a directory in essentially every java checkout, so
      // `java.util.List` (specifier `java.util`, root `java`) was demoted to `ext?` even though the
      // reserved-namespace citation (`4fb712046`) had already verified it. Measured cost: 15,419
      // reserved-prefixed targets + 19,540 bare targets whose files import a `java.*` root, i.e. the
      // dominant mass of java's 36,281 `ext?` rows. The project-absolute rule is right in general —
      // a layout directory named `java` is not a declaration — so the narrow fix is to EXEMPT the
      // reserved platforms, whose precedence is already the rule, and to leave a non-reserved root
      // that really is a project module (e.g. `kotlinx`) demoting exactly as before.
      const reservedSpecifier = RESERVED_PLATFORM_NAMESPACES.some((ns) => {
        const bare = ns.endsWith(".") ? ns.slice(0, -1) : ns
        return claim.specifier === bare || claim.specifier!.startsWith(ns)
      })
      if (!reservedSpecifier && root.length > 0 && projectModuleNames(facts).has(root)) outcome = "externalUnverified"
    }
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
  if (channelDeclined) {
    // The store WITHDREW this row's name binding and then declined to re-bind it: NULL in
    // production, so the name count must not be allowed to call it resolved.
    return { outcome: "unresolved", decls, kinds: kindText }
  }
  if (decls > 1) {
    // THE CLAIM IS READ ON THIS PATH FOR THE FIRST TIME — to RECORD it, never to move the outcome.
    return {
      outcome: (kindSet?.size ?? 0) > 1 ? "ambBoth" : "ambDeclOnly",
      decls, kinds: kindText,
      claimOnAmbiguous: claimDispositionOnAmbiguous(declCount, tgt, claim, facts, ownFileDeclares),
    }
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
  /**
   * OF `resolved`: how many resolved while MORE THAN ONE declaration answered to the name, so the
   * row production wrote was chosen by a tie-break rather than determined by the edge. Never added
   * to `resolved` or to `ambiguousByDecl` — it is a property OF the resolved ones.
   */
  resolvedAmongCollision: number
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
  /**
   * HOW MANY NAMES THE CAP DISCARDED, per bucket — because a capped list that does not say how much it
   * dropped cannot be read as a worklist.
   *
   * scss-lane measured the consequence directly: `imports` 297 → 25, `references` **1,501 → 25**,
   * `exports` 983 → **25** — every type over 25 listed exactly 25 names — while the worklist header
   * said only "counts sampled per type", which tells a reader that a type's ABSENCE is not a zero but
   * **never says how many names are hidden.** A lane sizing its work from that list reads 25 against
   * 1,501 and cannot tell the difference.
   *
   * The cap stays: it is what stops one pathological name (a stdlib function used 40,000 times) from
   * producing a 40,000-line report, and that is a real protection. What changes is that the omission is
   * COUNTED and printed beside the list, so the list stops being silently partial. This is the same
   * remedy as the marker table's `⋯ OMITTED` row, applied to the other table that has a cap.
   */
  namesOmitted: { ambiguous: number; unresolved: number; refuted: number; cause: number }
  /**
   * OF `ambiguousByDecl`: how many ALSO carry a claim, **grouped by claim KIND and disposition** — the
   * disclosure scss-lane's measurement made necessary. `amb(decl)` and "carries a verified file claim"
   * are not exclusive, so the column is not wrong; it is simply unreadable on its own, and a lane
   * sizing its repairable work from it reads roughly 30% high. A separate block rather than a column,
   * because TABLE 1 is parsed positionally by `residual-gate.ts`.
   *
   * GROUPED BY KIND, because the first version was not and printed "714 unverifiable" on scss — a word
   * covering both a `cause` (not an external claim at all) and a `projectFile` claim that did not
   * resolve. Two things under one word is a disclosure that misleads.
   */
  ambiguousWithClaim: Record<string, { verified: number; unverified: number; refuted: number; contradicted: number; ownFileSilent: number; notApplicable: number }>
}

/**
 * THE NAME CAP, NAMED ONCE. It was a bare `25` written in EIGHT places across `tally`, which is the
 * "one rule, two spellings" hazard this programme keeps paying for — and worse here, because a bare
 * literal in eight places cannot be grepped as a rule and cannot be reported as one.
 */
export const NAME_CAP = 25

export const emptyOutcomes = (): Outcomes => ({
  resolved: 0, resolvedAmongCollision: 0, ambiguousByDecl: 0, ambiguousByKind: 0, unresolved: 0,
  markedExternal: 0, externalVerified: 0, externalVerifiedByOwner: 0, externalVerifiedByProjectFacts: 0,
  externalUnverified: 0, externalRefuted: 0,
  bindingVerified: 0, bindingRefuted: 0, bindingUnverified: 0,
  causeDeclared: 0, causeRefuted: 0,
  ambiguousNames: [], unresolvedNames: [], refutedNames: [], causeNames: [],
  namesOmitted: { ambiguous: 0, unresolved: 0, refuted: 0, cause: 0 },
  ambiguousWithClaim: {},
})

/**
 * PUSH, OR COUNT WHAT WAS DROPPED. Every call site goes through this so a capped list can never again
 * be silently partial: either the entry is kept, or the bucket's omission counter is incremented and
 * the caller can print the difference.
 *
 * AND A DUPLICATE IS NOT A NAME. `tally` is called once per SCOPE, so the same target legitimately
 * arrives again for every project that contains it — measured on the CLEAN lane, the smallest corpus in
 * the programme: `force` printed three times in a row, `offside` three times, `SP.callProcess` and
 * `World` and `StdEnv:*` twice each. The cap was therefore spending itself on repeats, and "25
 * collected" was not 25 names. A worklist exists to name the things to work on; the same name twice is
 * not a second thing. De-duplication does NOT count as an omission — the name is already represented —
 * so `namesOmitted` continues to mean "distinct names that did not fit", which is the number a reader
 * needs.
 */
function keep<T extends { name: string }>(
  out: Outcomes, bucket: keyof Outcomes["namesOmitted"], list: T[], entry: T,
): void {
  if (list.some((e) => e.name === entry.name)) return
  if (list.length < NAME_CAP) list.push(entry)
  else out.namesOmitted[bucket]++
}

/**
 * COUNT IT WHERE IT BELONGS — one rule, called once per scope, so the two columns can never
 * drift into being two rules.
 */
export function tally(out: Outcomes, c: Classified, tgt: string, label: string): void {
  switch (c.outcome) {
    case "resolved":
      out.resolved++
      // THE THIRD OUTCOME, counted where it is created. A resolved edge whose name has more than
      // one declaration in this key space is only AS resolved as production's tie-break — see
      // `Classified.boundAmongCollision`.
      if (c.boundAmongCollision === true) out.resolvedAmongCollision++
      break
    case "ambDeclOnly":
    case "ambBoth":
      out.ambiguousByDecl++
      if (c.outcome === "ambBoth") out.ambiguousByKind++
      // THE CLAIM-CARRYING SHARE OF THIS COLUMN, counted where the outcome is counted and GROUPED BY
      // CLAIM KIND. A REFUTED claim here is the one a lane must look at first: the target names two or
      // more declarations AND the edge claimed to be external — the refutation shape `extFAIL` exists
      // for, which until now was read by nothing and reported as ordinary ambiguity.
      if (c.claimOnAmbiguous) {
        const { kind, disposition } = c.claimOnAmbiguous
        const bucket = out.ambiguousWithClaim[kind] ??
          (out.ambiguousWithClaim[kind] = { verified: 0, unverified: 0, refuted: 0, contradicted: 0, ownFileSilent: 0, notApplicable: 0 })
        bucket[disposition]++
      }
      keep(out, "ambiguous", out.ambiguousNames, { name: tgt, declarations: c.decls, kinds: c.kinds })
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
      keep(out, "unresolved", out.unresolvedNames, {
        name: `${tgt}   [binding claim REFUTED — the target can name a declaration]`,
        type: label,
      })
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
      keep(out, "refuted", out.refutedNames, { name: tgt, type: label })
      keep(out, "unresolved", out.unresolvedNames, {
        name: `${tgt}   [external claim REFUTED — the population publishes ${targetOwner(tgt)}]`,
        type: label,
      })
      break
    case "causeDeclared":
      // ITS OWN COLUMN, and never `resolved` — nothing was resolved. The lane reports it
      // beside `bindingVerified` so a reader sees how much of the graph rests on a stated
      // cause, which is the opposite of what folding it into a resolution number would do.
      out.causeDeclared++
      keep(out, "cause", out.causeNames, { name: tgt, type: label })
      break
    case "causeRefuted":
      // A CLAIM-INTEGRITY DEFECT, counted against the lane like every other refuted claim: the
      // stated cause either does not name this edge's own base or the edge also claims to be
      // outside the population. It is NOT `unresolved` — that column means "carries no claim" —
      // and it is never clean.
      out.causeRefuted++
      keep(out, "refuted", out.refutedNames, { name: `${tgt}   [declared cause REFUTED]`, type: label })
      keep(out, "unresolved", out.unresolvedNames, {
        name: `${tgt}   [declared cause REFUTED — the stated base is not this edge's own owner]`,
        type: label,
      })
      break
    case "unresolved":
      out.unresolved++
      // NAME IT. A count a lane cannot resolve back to the things it counted leaves
      // the only response as re-running the whole lane hoping to see it again — and
      // it is not guaranteed to reproduce. This is the population rule applied to the
      // verdict itself, and it is capped per type so one pathological name (a
      // stdlib function used 40,000 times) cannot produce a 40,000-line report.
      keep(out, "unresolved", out.unresolvedNames, { name: tgt, type: label })
      break
  }
}
