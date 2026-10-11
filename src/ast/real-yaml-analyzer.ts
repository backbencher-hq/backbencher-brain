import type { Node } from "web-tree-sitter"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "./engine"

/**
 * YAML analyzer backed exclusively by the vendored tree-sitter-yaml AST
 * (`@tree-sitter-grammars/tree-sitter-yaml@0.7.1`, pinned in
 * `validation/m14/grammar-pins.json`).
 *
 * YAML is a data language rather than a declaration language, so the contract is
 * structural: mapping keys become properties, object-valued keys become class-like
 * containers, sequence-valued keys become variables, and anonymous scalar values stay
 * metadata rather than becoming phantom symbols. Every identity is a qualified path
 * with `[index]` segments for sequence items.
 *
 * What this lane extracts, and the grammar fact each extraction rests on:
 *
 *  - TAGS are the language's only type annotation. The `tag` node has zero children
 *    but is NOT zero-width: it carries its own text and byte range for every form
 *    (`!!str`, `!Foo`, `!include`, `!<tag:yaml.org,2002:str>`, `!e!thing` after a
 *    %TAG directive) — measured in `script/m14/tmp/yaml-tag-visibility.ts`. A tag
 *    therefore forces the value's resolved type, produces a `declared_type` reference
 *    edge (M60 R9), and for the include family a real `imports` entry.
 *  - COMMENTS are children of `stream`, siblings of `document`, so a pending-comment
 *    buffer cannot see them; they are indexed by the line they precede and attached
 *    positionally. They carry their own text.
 *  - DIRECTIVES (`%YAML`, `%TAG`, `%FOO`) are document children and carry text. The
 *    declared version changes how scalars resolve, so it is recorded.
 *  - ANCHORS are document-scoped in YAML. The registry is per-document and
 *    nearest-wins; a cross-document reference is reported unresolved WITH A REASON.
 *  - The grammar exposes exactly two fields, `key` and `value`, and both are read
 *    through `childForFieldName`, so no part of the extraction needs a delimiter or a
 *    character offset.
 *  - A node reached through a damaged enclosing node gets an identity that is unique
 *    and records the damage. A grammar ERROR must not silently collapse eleven
 *    distinct records into one id — the measured case is
 *    `docker/vendor/.../cloudbuild.yaml`, where every sequence item under the file's
 *    single ERROR node became `[13]`.
 *
 * Three measured decisions, recorded because each was an option the data closed:
 *
 *  - NO NESTING GUARD. Over 299,429 corpus symbols the emitted qualified name peaks
 *    at 218 characters and dot depth at 20; over 400 characters: 0 symbols
 *    (`script/m14/tmp/yaml-path-budget.ts`). A truncation path would defend against a
 *    case that does not occur.
 *  - NO VALUE TEXT SCANNING, anywhere. The previous `text.includes("$")` template
 *    heuristic missed `password: hunter2` (no `$`) and flagged any value that merely
 *    contained a dollar sign, such as `"^\d+$"`. Sensitivity is now decided from the
 *    key node's own text and from a `kind: Secret` document — both structural.
 *  - FRAMEWORK DETECTION IS A SET OF EXACT PATHS WITH SHAPES, not a set of names
 *    anywhere in the file. The previous whole-file name set reported three
 *    frameworks for a seven-line file containing `version`, `services`, `jobs`, `on`
 *    and `stages`.
 *
 * The lane's declared limitations live in `script/m14/spec/yaml-completeness.json`
 * (sections A–H) and are restated in `docs/analyzers/real-yaml-analyzer.md`.
 */

interface YamlContext {
  filePath: string
  /**
   * The project root this file was parsed against, when the caller knows it.
   *
   * Absent means "this caller did not say which project the file is in", and the document
   * identity falls back to the filesystem basename — which is what it was before this
   * field existed, and therefore what every fixture that passes no root still asserts.
   */
  projectRoot?: string
  /**
   * DID THE PINNED GRAMMAR PARSE THIS DOCUMENT AT ALL? `rootNode.hasError`, captured once.
   *
   * It exists because a MISS in the pointer index is not one fact. MEASURED over the whole
   * corpus, 2026-09-10: 762 `references` edges carry
   * `unresolvedReason=pointer-not-declared-in-file`, and **729 of them (96 %)** sit in the 15
   * docker `api/docs/*.yaml` files whose root node is an ERROR — while the 183 CLEAN files of
   * that same repository carry **zero**. The pointer those edges name IS declared:
   * `api/docs/v1.25.yaml` has `definitions:` at line 131 and `MountType:` at 186, and the Python
   * reference parser reads the file with 51 definitions. What fails is the grammar (a quoted
   * scalar whose continuation line is under-indented), and an error-recovered tree is not
   * evidence that a declaration is missing — so the old reason string stated something false.
   */
  parseHadError?: boolean
  content: string
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  metadata: Partial<ASTEngine.FileMetadata> & Record<string, any>
  /** document identity -> anchor name -> anchor symbol. Nearest definition wins. */
  anchors: Map<string, Map<string, ASTEngine.UniversalSymbol>>
  aliasRefs: { source: string; target: string; merge: boolean; document: string; line: number }[]
  relationshipKeys: Set<string>
  symbolIds: Set<string>
  visitedNodes: number
  documentCount: number
  maxDepth: number
  /** JSON-pointer path -> qualified identity, so `$ref` resolves inside the file. */
  pointerIndex: Map<string, string>
  /** Dotted path -> resolved value shape, for diagnostics and the depth audit. */
  shapeIndex: Map<string, string>
  /**
   * document -> (document-relative path -> resolved shape). Framework signatures are
   * document-relative, so this is what they match against, and matching through it is
   * an O(1) lookup rather than a scan of every shape in the file per requirement.
   */
  documentShapes: Map<string, Map<string, string>>
  /**
   * Compose-style service name -> its qualified path. Built during the walk so
   * resolving `depends_on: [db]` is a map lookup. It was previously a scan of the
   * whole shape index per reference, which is O(references x symbols) -- the exact
   * O(n*m) hot path the M12 complexity contract forbids, and it would not have shown
   * up on a small corpus.
   */
  serviceIndex: Map<string, string>
  /** Next line -> comments ending on the line before it, with their columns. */
  commentIndex: Map<number, { text: string; column: number }[]>
  /** Own line -> comments starting on it, for trailing notes. */
  trailingIndex: Map<number, { text: string; column: number }[]>
  /** Document identities whose `kind` is `Secret`. */
  sensitiveDocuments: Set<string>
  /** `metadata.name` of every document in this file -> that document's identity. */
  declaredNames: Map<string, string>
  /** `%TAG` handle -> prefix, so `!e!thing` resolves to a real URI. */
  tagHandles: Map<string, string>
  /** Duplicate-key disambiguation counters, keyed by document + base path. */
  duplicateCounters: Map<string, number>
  /** `uses:` sites, held until the file's shape decides whether it is a workflow. */
  pendingActionUses: { source: string; action: string; line: number; role: UsesRole }[]
  /**
   * Named schema definitions a document PUBLISHES for other documents to reference by
   * `$ref`. Held for the same reason `pendingActionUses` is: the container only means a
   * publication in a file that declares itself an API description.
   */
  pendingSchemaPublications: { document: string; container: string; name: string; path: string; line: number }[]
  /** Sibling-name references awaiting the post-pass that can resolve them. */
  pendingReferences: { source: string; target: string; kind: string; line: number; document?: string }[]
  frameworks: string[]
  frameworkPatterns: string[]
}

interface VisitContext {
  parent: ASTEngine.UniversalSymbol | null
  parentPath: string
  /** JSON-pointer path of the node being visited. */
  pointerPath: string
  /** Identity of the enclosing document, so anchors stay document-scoped. */
  document: string
  depth: number
  /** Keys already seen in the enclosing mapping, for duplicate disambiguation. */
  siblingKeys: Set<string>
  sequenceItem?: boolean
  sequenceIndex?: number
  /** The enclosing document is `kind: Secret`; sensitivity still starts at its payload keys. */
  inSecretDocument?: boolean
  /** Inside a subtree already judged sensitive (a Secret payload, a sensitive key). */
  inSensitiveSubtree?: boolean
  /**
   * The grammar-damage site this node was reached through, if any. Carried so a
   * recovered symbol can say WHERE it was recovered, rather than the whole file being
   * renamed to advertise it.
   */
  recoveredThrough?: { line: number; width: number }
}

const MAPPING_TYPES = new Set(["block_mapping", "flow_mapping"])
const MAPPING_PAIR_TYPES = new Set(["block_mapping_pair", "flow_pair"])
const SEQUENCE_TYPES = new Set(["block_sequence", "flow_sequence"])
// `flow_sequence_item` is deliberately absent: it is NOT one of this grammar's 36
// named types (the full vocabulary is in validation/m14/results/yaml-f8-corpus-census.json),
// so a branch testing it could never match. M14.0.F1 caught it as an unregistered
// literal, which is the dead-branch detector doing its job.
const SEQUENCE_ITEM_TYPES = new Set(["block_sequence_item"])
const WRAPPER_TYPES = new Set(["block_node", "flow_node"])
const DIRECTIVE_TYPES = new Set(["yaml_directive", "tag_directive", "reserved_directive"])
const SCALAR_TYPES = new Set([
  "string_scalar", "plain_scalar", "single_quote_scalar", "double_quote_scalar",
  "integer_scalar", "float_scalar", "boolean_scalar", "null_scalar", "block_scalar",
  "timestamp_scalar",
])

/**
 * YAML's closed vocabulary of RESOLVED VALUE SHAPES. This is a value vocabulary, not
 * a node-type table, and it is deliberately NOT named `*_TYPES`: M14.0.F1 reads any
 * top-level `*_TYPES` array of strings as a list of grammar node types, and renaming
 * is the honest fix — the alternative is allowlisting a value vocabulary as a dead
 * branch, which would dilute the dead-branch record the next reader depends on.
 * `untyped` is YAML's own name for a plain scalar that carries no tag.
 */
const RESOLVED_VALUE_VOCABULARY = new Set([
  "object", "array", "string", "integer", "float", "boolean", "null", "timestamp",
  "alias", "anchor", "untyped",
])
const SCALAR_SHAPES = new Set(["string", "integer", "float", "boolean", "null", "timestamp"])

/** A `!!`-style tag that overrides the resolved type of the value it precedes. */
const TAG_TYPE_OVERRIDES: Record<string, string> = {
  str: "string", int: "integer", float: "float", bool: "boolean", null: "null",
  map: "object", seq: "array", omap: "array", pairs: "array", set: "array",
  binary: "string", merge: "object", timestamp: "timestamp",
}

/** The default resolution URI for a `!!` local tag. */
const YAML_CORE_PREFIX = "tag:yaml.org,2002:"

/**
 * Tags that name another file, so their value is an import rather than a value.
 *
 * This is a CLOSED set, not a prefix test. The first version accepted any tag whose
 * name began `include` or `import`, and the fixture dump immediately showed
 * `!included_decoration` and `!include_real` being read as file references — a
 * substring rule over an open vocabulary, which is the same mistake the framework
 * detector used to make over key names. YAML tags are open, so the set cannot be
 * derived; these are the tags the ecosystems that use them actually define, and the
 * cost of the closed set is DECLARED rather than hidden: an include-family tag
 * outside this list is not recognised as an import (see design_decision YAML-D5 in
 * script/m14/spec/yaml-completeness.json, and the `!include` corpus gap recorded
 * there — zero of eight pinned repositories contain one).
 */
// CORRECTED 2026-09-28: this list was GUESSED, and measuring it proved it. Across all
// 9,953 files in the eight pinned corpora, every one of the ten spellings below occurs
// ZERO times — while the tags Ansible actually uses (`!vault` 30, `!unsafe` 31) are not
// here. A web check of the libraries that define this construct explains why: `!include`
// is not an Ansible tag at all, it belongs to third-party PyYAML extensions, and the
// CURRENT spelling is different from the one this list was built on.
//
//   pyyaml-include 1.x   !include                <- the only spelling here with any
//                                                  real-world use, and it is v1
//   pyyaml-include 2.x+  !inc                    <- the current release (PyPI + readthedocs)
//   claylo/yaml-include  !!inc/file, !!inc/dir
//
// So `inc` was a live recall gap: a documented, currently-maintained include tag that
// this analyzer did not treat as an import. Added, with the evidence, rather than
// quietly widening the set.
const INCLUDE_TAGS = new Set([
  "include", "inc",
  "include_tasks", "include_role", "include_vars", "include_file",
  "import", "import_tasks", "import_playbook", "import_role", "import_file",
])

/** A value is only a PATH if it looks like one. A single bare word is a value. */
function looksLikePath(text: string, quoted = false): boolean {
  // `quoted` relaxes the whitespace refusal and nothing else: a space inside a QUOTED scalar is
  // part of a literal string, while a space in a plain scalar is the argument-list convention.
  // `text.trim() !== text` is refused either way — a leading or trailing space is not a path.
  if (!text || text.trim() !== text) return false
  if (!quoted && text.includes(" ")) return false
  return text.includes(".") || text.includes("/")
}

/** The scalar node types whose text is a QUOTED literal: the source's own evidence that a space
 *  inside the value is part of the string rather than a separator. */
const QUOTED_SCALAR_TYPES = new Set(["single_quote_scalar", "double_quote_scalar"])

/**
 * The keys whose SUBTREE carries a Kubernetes Secret's payload. A `kind: Secret`
 * document is a secret CONTAINER, but `apiVersion`, `kind` and `metadata` inside it
 * are the envelope and are not secret values — marking a whole document sensitive
 * flagged 7 of 7 symbols in the fixture, including `apiVersion: v1`. Restricting the
 * sensitivity to the payload keys is the structural reading, and it is what a reader
 * of the index actually wants to know.
 */
const SECRET_PAYLOAD_KEYS = new Set(["data", "stringData", "binaryData"])

/**
 * Key SPELLINGS whose value is sensitive. Read from the key node's own text, never
 * from the value. This replaces a value scan that both missed real secrets and
 * flagged any value containing a dollar sign.
 */
const SENSITIVE_KEY_NAMES = new Set([
  "password", "passwd", "pass", "secret", "secrets", "token", "tokens", "apikey",
  "api_key", "api_secret", "access_key", "accesskey", "secret_key", "secretkey",
  "private_key", "privatekey", "client_secret", "clientsecret", "credential",
  "credentials", "auth", "authorization", "session_key", "signing_key",
  "encryption_key", "connection_string", "dsn", "bearer_token", "refresh_token",
  "id_rsa",
])

/** Keys whose value names a sibling record in the same file. */
const DEPENDS_ON_KEYS = new Set(["depends_on", "dependsOn", "needs", "requires"])

/**
 * Reference WRAPPERS: the whole payload is a reference, so `name` is the only value in
 * it that names a resource (`configMapRef: { name: cm }`).
 */
const RESOURCE_REF_WRAPPERS = new Set(["configMapRef", "secretRef", "configMapKeyRef", "secretKeyRef"])

/**
 * Kubernetes VOLUME SOURCES: the payload is configuration, and the key that names the
 * referenced resource differs per source (`configMap`/`secret` use `name`, a
 * PersistentVolumeClaim volume uses `claimName`). Measured over kubernetes, a single
 * walk that collected every nested scalar of a volume source emitted a resource
 * reference to the `3` of `defaultMode: 3`.
 */
const RESOURCE_REF_SOURCES = new Map<string, string>([
  ["configMap", "name"],
  // A SecretVolumeSource names the secret `secretName` (upstream
  // `SecretVolumeSource.secretName`); `name` is the EnvVarSource spelling, which is
  // the WRAPPER above and is read there. Probed both: a `volumes[].secret: { name: x }`
  // payload is not the API's shape and is left unreferenced rather than guessed at.
  ["secret", "secretName"],
  ["persistentVolumeClaim", "claimName"],
])

/** Keys whose value IS the resource name — a plain scalar, never a mapping payload. */
const RESOURCE_REF_SCALARS = new Set(["serviceAccountName"])

/** Keys that name another file. */
const FILE_IMPORT_KEYS = new Set([
  "include_tasks", "import_tasks", "import_playbook", "import_role", "include_role",
  "import_values", "import", "include",
])

/**
 * The two members of `FILE_IMPORT_KEYS` that do NOT name a file: `include_role` and
 * `import_role` name a ROLE.
 *
 * MEASURED, and the measurement is why this set exists rather than a comment. Over the whole
 * admitted ansible population (2,082 `.yaml`/`.yml` files), 891 `imports` edges carry
 * `yaml_keyword_include`. Attributed to the key on the edge's OWN `line_number` (which points
 * at the key line), they split:
 *
 *     567  `include_tasks` / `import_tasks` / `import_playbook` / `include` … — a FILE
 *     149  `name:`          — a nested scalar INSIDE a role-include mapping (the role's name)
 *      45  `tasks_from:`    — a nested scalar, a file relative to the ROLE's `tasks/` dir
 *      18  `role_name:`     — likewise
 *      51  `hosts:` `public:` `gather_facts:` `allow_duplicates:` `command:` … — not files at all
 *
 * The 263 non-file edges exist because `scalarValues` recurses into a mapping and returns
 * every nested VALUE scalar, so one `- import_role: {name: role1, tasks_from: x.yml}` publishes
 * the role's name, its `tasks_from` file and any boolean in the block as three imports of this
 * file. That over-reach is a SEPARATE, still-open defect in this lane (it is reported, not
 * silently changed here — dropping 263 edges is an ontology decision, not a claim fix). What
 * this set does is keep the over-reach from being turned into a NEW refutation by the file
 * claim below: a `tasks_from:` spelling is relative to a role directory the analyzer does not
 * resolve, so a claim that THIS file's directory holds it would be a claim this lane cannot
 * support, and the arbiter would refute it — 10 such edges measured before the guard existed.
 */
const ROLE_IMPORT_KEYS = new Set(["include_role", "import_role"])

/**
 * THE CONTAINERS WHOSE `include:` IS A SELECTOR LIST, NOT A FILE IMPORT — each one measured.
 *
 * `include` is in `FILE_IMPORT_KEYS` because ansible and pyyaml-include spell a file import that
 * way, but `include` is a GENERIC configuration key: five separate formats in this corpus use the
 * same spelling for "the set of things this rule/target/build selects". Emitting those as imports is
 * a false statement in two directions at once — an edge naming a file the project does not have, and
 * an edge naming a file the project DOES have (`main` collides with 11 declarations in the docker
 * project, so the arbiter could only report those AMBIGUOUS) — and, worse, a selector NAME such as
 * `NSCondition` resolves to nothing, so the edge lands in `extOK` as a VERIFIED claim.
 *
 * The guard is on the KEY'S OWN POSITION, never on the value's shape: a selector list is a list of
 * globs and so is a real glob include, so refusing by shape would drop the globs ansible really
 * includes. Each parent below was read in the format that writes it:
 *
 *   `branches`  Azure Pipelines branch filter — `trigger.branches.include: [main, feature/*]`.
 *               MEASURED on docker's vendored `sdk/azcore/ci.yml`: 12 false edges in one file
 *               (`trigger`/`pr` × `branches`/`paths`). This one ALSO requires the document's own
 *               `trigger:`/`pr:` claim (31 files in the admitted population declare either); the
 *               rest do not, because their parent key is a selector container in every format that
 *               spells it and none of them is a task-file key.
 *   `paths`     semgrep rule paths (a rule's `paths.include` holds source GLOBS, e.g.
 *               `…/migrations/tasks/*.py`) and Azure's path filter. MEASURED: 26 glob edges over 5
 *               repositories.
 *   `sources`, `generate_for`
 *               Dart `build_runner` source selectors — `targets.<t>.sources.include: [lib/**,
 *               $package$, lib/$lib$]` is a build target's file set, and
 *               `builders.<b>.generate_for.include` holds Dart source GLOBS naming the file set a
 *               BUILDER generates for. MEASURED: 21 glob edges over the flutter/semgrep
 *               repositories, plus 4 more on riverpod's three `build.yaml` files.
 *   `outputs`   GitHub Actions job outputs (`outputs.include: ${{ steps.x.outputs.include }}`) — a
 *               named output, not a file.
 *   `objc-interfaces`, `objc-protocols`, `enums`
 *               ffigen's Selector lists (`objc-interfaces.include: [NSCondition, NSHTTPURLResponse,
 *               …]`, `enums.include: [NSURLRequestCachePolicy, …]`) — Objective-C INTERFACE and ENUM
 *               NAMES to bind, MEASURED on `dart-http/pkgs/cupertino_http/ffigen.yaml`: 34 false
 *               edges, every one of them landing in `extOK` because a class name resolves to
 *               nothing. `enums` is tested as an ANCESTOR as well as a parent, because ffigen
 *               nests a second Selector list at `enums.as-int.include` — see below.
 *   `exposure`  Spring Boot `management.endpoints.web.exposure.include: 'env,health'` — an endpoint
 *               NAME list.
 *
 * ANY ANCESTOR SEGMENT COUNTS, not just the parent, and that is measured rather than convenient:
 * `targets.<t>.sources.include` and `enums.as-int.include` are both Selector lists whose own parent
 * is not the container. The DOCUMENT segment is excluded from the test, which is not a detail — the
 * `matrix` guard this replaces had to state it, because `matrix.yml` has the document identity
 * `matrix` and a bare suffix test made every top-level `include:` in that document invisible.
 *
 * A GROWING LIST IS THE WRONG SHAPE FOR THIS and it is worth saying why it is still the right move
 * here: the alternative (a positive rule — "an include value must be spelled as a path") cannot
 * separate a selector GLOB from an import glob, which is the actual ambiguity, so the position IS
 * the evidence. What guards the list against arbitrariness is that every member is a parent under
 * which the corpus was READ, and the instrument that found them all —
 * `validation/m14/fixtures/yaml/include-key-position-census.ts` — is committed, so the next reader
 * can count the population again instead of trusting this comment.
 */
const INCLUDE_SELECTOR_SEGMENTS = new Set([
  "branches", "paths", "sources", "generate_for", "outputs", "exposure",
  "objc-interfaces", "objc-protocols", "enums",
])

/**
 * The directories that make a directory a ROLE. Used only to work out where a role's own
 * subdirectories are, so a bare include inside `handlers/` can also be looked for in `tasks/`.
 */
const ROLE_SUBDIR_NAMES = new Set([
  "tasks", "handlers", "vars", "defaults", "meta", "templates", "files", "library",
])

/**
 * What a `uses:` KEY MEANS, decided by the path the analyzer itself built for the
 * entry — never by the characters of the value.
 *
 * GitHub Actions gives this one key two meanings that are worth distinguishing, and
 * the position is the whole of the evidence:
 *
 *   `jobs.<job>.uses`   a REUSABLE WORKFLOW this job invokes  -> `calls`
 *   anything else       the pre-existing treatment, unchanged
 *
 * The third `uses:` spelling — outside a `jobs` block entirely — is deliberately NOT a
 * third role. It was already one case here: one relationship, one reason code,
 * `file-shape-is-not-a-github-workflow`. Splitting it off would give one fact two
 * vocabularies, which is the mistake this file already documents once at the action
 * import. Only the job level diverges, because only the job level is a different fact.
 *
 * Before this existed, every `uses:` took the `imports` branch, so all 196 job-level
 * reusable-workflow references in the corpus were labelled as an import of a third-party
 * action. The value's shape does not decide this: `owner/repo/x.yml@ref` and
 * `actions/checkout@v4` both contain a `/`, and only one of them names a workflow.
 */
type UsesRole = "workflow-call" | "other"

/** The OpenAPI 3 component containers, which exist to be referenced from elsewhere. */
const OPENAPI_COMPONENT_CONTAINERS = new Set([
  "schemas", "responses", "parameters", "examples", "requestBodies",
  "headers", "securitySchemes", "links", "callbacks", "pathItems",
])

/**
 * The publication container `parentPath` names, or null. `definitions` and `$defs` are
 * the JSON Schema / Swagger 2 spelling; `components.<sub>` is the OpenAPI 3 one. The
 * segment count is what keeps this role-scoped: `definitions.X` at the document's top
 * level is a publication and `foo.definitions.X` is not.
 */
function schemaPublicationRole(parentPath: string, document: string): string | null {
  const prefix = `${document}.`
  if (!parentPath.startsWith(prefix)) return null
  const parts = parentPath.slice(prefix.length).split(".")
  if (parts.length === 1 && (parts[0] === "definitions" || parts[0] === "$defs")) return parts[0]
  if (parts.length === 2 && parts[0] === "components" && OPENAPI_COMPONENT_CONTAINERS.has(parts[1]!)) {
    return `components.${parts[1]}`
  }
  return null
}

/** True when `parentPath` is exactly `<document>.jobs.<jobId>` and nothing deeper. */
function isJobLevelPath(parentPath: string, document: string): boolean {
  const prefix = `${document}.jobs.`
  if (!parentPath.startsWith(prefix)) return false
  const jobId = parentPath.slice(prefix.length)
  // A job id containing a dot is legal YAML and still one job; a job id followed by
  // `steps` is a step, so the segment count is what separates the two.
  return jobId.length > 0 && !jobId.includes(".")
}

/** HTTP methods that appear as a `paths` child in an OpenAPI document. */
const OPENAPI_METHODS = new Set([
  "get", "put", "post", "delete", "options", "head", "patch", "trace",
])

/** A framework signature is a SET OF EXACT PATHS WITH SHAPES. */
interface Requirement {
  path: string
  shape: string
  pathHint?: string
}

interface FrameworkSignature {
  name: string
  maturity: number
  insight: string
  /** Every entry must match. `path` is dotted and document-relative. */
  all: Requirement[]
  /** At least one of these must match. */
  any?: Requirement[]
}

const FRAMEWORK_SIGNATURES: FrameworkSignature[] = [
  {
    name: "GitHub Actions",
    maturity: 25,
    insight: "GitHub Actions CI/CD detected",
    all: [{ path: "jobs", shape: "object" }],
    any: [
      { path: "on", shape: "any", pathHint: ".github/workflows" },
      { path: "on", shape: "object" },
      { path: "on", shape: "array" },
      { path: "on", shape: "string" },
    ],
  },
  {
    name: "Docker Compose",
    maturity: 20,
    insight: "Containerized architecture detected",
    all: [{ path: "services", shape: "object" }],
    any: [
      { path: "version", shape: "any" },
      { path: "networks", shape: "any" },
      { path: "volumes", shape: "any" },
      { path: "configs", shape: "any" },
    ],
  },
  {
    name: "Kubernetes",
    maturity: 30,
    insight: "Kubernetes orchestration detected",
    all: [
      { path: "apiVersion", shape: "string" },
      { path: "kind", shape: "string" },
    ],
  },
  {
    name: "GitLab CI",
    maturity: 25,
    insight: "GitLab CI/CD detected",
    all: [{ path: "stages", shape: "array" }],
    any: [
      { path: "variables", shape: "any" },
      { path: "default", shape: "any" },
      { path: "include", shape: "any" },
    ],
  },
  {
    name: "Ansible",
    maturity: 20,
    insight: "Ansible provisioning detected",
    all: [{ path: "hosts", shape: "any" }],
    any: [
      { path: "tasks", shape: "any" },
      { path: "roles", shape: "any" },
      { path: "play", shape: "any" },
    ],
  },
  {
    name: "Spring Boot",
    maturity: 10,
    insight: "Spring Boot configuration detected",
    all: [
      { path: "spring", shape: "object" },
      { path: "server", shape: "any" },
    ],
  },
  {
    name: "CircleCI",
    maturity: 25,
    insight: "CircleCI CI/CD detected",
    all: [
      { path: "version", shape: "string" },
      { path: "jobs", shape: "object" },
    ],
    any: [{ path: "workflows", shape: "any" }, { path: "executors", shape: "any" }],
  },
  {
    name: "Azure Pipelines",
    maturity: 25,
    insight: "Azure Pipelines CI/CD detected",
    all: [
      { path: "trigger", shape: "any" },
      { path: "pool", shape: "any" },
      { path: "steps", shape: "any" },
    ],
  },
  {
    name: "Serverless Framework",
    maturity: 20,
    insight: "Serverless service definition detected",
    all: [
      { path: "service", shape: "string" },
      { path: "provider", shape: "any" },
      { path: "functions", shape: "object" },
    ],
  },
  {
    name: "Prometheus",
    maturity: 15,
    insight: "Prometheus scrape configuration detected",
    all: [{ path: "scrape_configs", shape: "array" }],
    any: [{ path: "global", shape: "any" }],
  },
  {
    name: "CloudFormation",
    maturity: 20,
    insight: "AWS CloudFormation template detected",
    all: [{ path: "AWSTemplateFormatVersion", shape: "any" }],
  },
  {
    name: "OpenAPI",
    maturity: 20,
    insight: "OpenAPI/Swagger interface contract detected",
    all: [{ path: "paths", shape: "object" }],
    any: [
      { path: "openapi", shape: "string" },
      { path: "swagger", shape: "string" },
    ],
  },
  {
    name: "Helm chart",
    maturity: 20,
    insight: "Helm chart metadata detected",
    all: [
      { path: "kind", shape: "string" },
      { path: "name", shape: "string" },
      { path: "version", shape: "string" },
    ],
    any: [{ path: "apiVersion", shape: "string" }],
  },
]

interface TagInfo {
  shortName: string
  uri: string
  typeOverride?: string
  includePath?: string
  /** The include value was a QUOTED scalar, so a space inside it is part of the literal. */
  includeQuoted?: boolean
  line: number
}

export class RealYamlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const ctx: YamlContext = {
      filePath,
      projectRoot: typeof context?.projectRoot === "string" ? context.projectRoot : undefined,
      content,
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      metadata: {
        detectedFrameworks: [],
        frameworkPatterns: [],
        // Declared here because M60 R8's census reads the metadata INITIALISER, and
        // the real value is only known after shape detection has run. Before that
        // point this key genuinely has no value, so `undefined` is the honest
        // initializer and not a placeholder.
        framework: undefined,
        hasFrameworkIntelligence: true,
        patterns: [],
        architecturalInsights: [],
        devOpsMaturity: 0,
        securityScore: 100,
        configurationComplexity: 0,
        yamlVersion: null,
        tagHandles: [],
        reservedDirectives: [],
        sensitiveValueCount: 0,
      },
      anchors: new Map(),
      aliasRefs: [],
      relationshipKeys: new Set(),
      symbolIds: new Set(),
      visitedNodes: 0,
      documentCount: 0,
      maxDepth: 0,
      pointerIndex: new Map(),
      shapeIndex: new Map(),
      documentShapes: new Map(),
      serviceIndex: new Map(),
      commentIndex: new Map(),
      trailingIndex: new Map(),
      sensitiveDocuments: new Set(),
      declaredNames: new Map(),
      tagHandles: new Map(),
      duplicateCounters: new Map(),
      pendingActionUses: [],
      pendingSchemaPublications: [],
      pendingReferences: [],
      frameworks: [],
      frameworkPatterns: [],
    }

    // Parse errors are collected once by ASTEngine. Keeping that ownership in one
    // place avoids duplicate warnings for the same ERROR/MISSING node. The ONE fact this
    // analyzer needs from it is whether the tree it is about to index is a clean parse, so it
    // is read here rather than reconstructed later.
    ctx.parseHadError = rootNode.hasError === true
    this.collectComments(rootNode, ctx)
    this.visit(rootNode, {
      parent: null,
      parentPath: "",
      pointerPath: "",
      document: this.documentName(filePath, 1, ctx.projectRoot),
      depth: 0,
      siblingKeys: new Set(),
    }, ctx)

    this.detectFrameworks(ctx)
    this.resolveActionUses(ctx)
    this.resolveSchemaExports(ctx)
    this.resolveAliases(ctx)
    this.resolvePointerReferences(ctx)
    this.resolveSiblingReferences(ctx)
    this.attachQualifiedCalls(ctx)
    this.applySecurityScore(ctx)
    this.classifyEvidenceTier(ctx)

    ctx.metadata.configurationComplexity = ctx.visitedNodes
    ctx.metadata.maxDepth = ctx.maxDepth
    ctx.metadata.documentCount = ctx.documentCount
    ctx.metadata.symbolCount = ctx.symbols.length
    ctx.metadata.relationshipCount = ctx.relationships.length
    ctx.metadata.pointerReferenceCount = ctx.pointerIndex.size
    ctx.metadata.framework = ctx.frameworks[0] ?? null
    ctx.metadata.detectedFrameworks = ctx.frameworks
    ctx.metadata.frameworkPatterns = ctx.frameworkPatterns

    return {
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      metadata: ctx.metadata,
    }
  }

  // ---------------------------------------------------------------- comments

  /**
   * Pass A. Comments are children of `stream`, siblings of `document`, so the main
   * walk reaches them BEFORE the key they document and a pending-comment buffer
   * could never see them. They are therefore indexed by the line they precede, with
   * their column, and attached during the walk by position. `comment.text` is the
   * comment's own text; the `#` run is removed by slicing, not by a pattern.
   */
  private collectComments(rootNode: Node, ctx: YamlContext): void {
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "comment") {
        const text = this.commentText(node)
        if (text) {
          const column = node.startPosition.column + 1
          // Two indexes, because a comment relates to a symbol in two different ways:
          // as a LEADING note it documents whatever is on the NEXT line, and as a
          // TRAILING note it documents whatever is on its OWN line to the left.
          const nextLine = node.endPosition.row + 2
          const leading = ctx.commentIndex.get(nextLine)
          if (leading) leading.push({ text, column })
          else ctx.commentIndex.set(nextLine, [{ text, column }])
          const ownLine = node.startPosition.row + 1
          const trailing = ctx.trailingIndex.get(ownLine)
          if (trailing) trailing.push({ text, column })
          else ctx.trailingIndex.set(ownLine, [{ text, column }])
        }
        continue
      }
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push(child)
      }
    }
  }

  private commentText(node: Node): string {
    const raw = node.text
    let i = 0
    while (i < raw.length && (raw[i] === "#" || raw[i] === " ")) i++
    return raw.slice(i).trimEnd()
  }

  /**
   * The docstring a symbol earns: leading comments on the line above at the same or
   * shallower column, plus a trailing comment on its own row to the right. Purely
   * positional — no comment text is matched against anything, so a comment can only
   * ever document a neighbour, never be guessed onto an unrelated key.
   */
  private docstringFor(line: number, column: number, ctx: YamlContext): string | undefined {
    const parts: string[] = []
    const above = ctx.commentIndex.get(line)
    if (above) for (const c of above) if (c.column <= column) parts.push(c.text)
    const trailing = ctx.trailingIndex.get(line)
    if (trailing) for (const c of trailing) if (c.column > column) parts.push(c.text)
    return parts.length > 0 ? parts.join("\n") : undefined
  }

  // ------------------------------------------------------------------- walk

  private visit(node: Node, visitContext: VisitContext, ctx: YamlContext): void {
    const stack: { node: Node; context: VisitContext }[] = [{ node, context: visitContext }]

    while (stack.length > 0) {
      const item = stack.pop()!
      const curr = item.node
      const current = item.context
      if (curr.isMissing) continue
      ctx.visitedNodes++
      if (current.depth > ctx.maxDepth) ctx.maxDepth = current.depth

      if (curr.type === "stream") {
        this.pushChildren(stack, curr, current)
        continue
      }
      if (curr.type === "comment") continue // indexed in pass A

      if (curr.type === "document") {
        this.visitDocument(curr, current, ctx, stack)
        continue
      }
      if (DIRECTIVE_TYPES.has(curr.type)) {
        this.visitDirective(curr, ctx)
        this.pushChildren(stack, curr, current)
        continue
      }
      if (curr.type === "ERROR" || curr.type === "MISSING") {
        this.descendThroughDamage(curr, current, ctx, stack)
        continue
      }
      if (SEQUENCE_ITEM_TYPES.has(curr.type) && !current.sequenceItem) {
        const child = this.firstNamedChild(curr)
        if (child) this.visitSequenceItem(child, curr, current, ctx, stack, this.itemIndexAmongSiblings(curr))
        continue
      }
      if (current.sequenceItem) {
        this.visitSequenceItem(curr, curr, current, ctx, stack, current.sequenceIndex ?? 0)
        continue
      }
      if (WRAPPER_TYPES.has(curr.type)) {
        this.pushChildren(stack, curr, current)
        continue
      }
      if (MAPPING_TYPES.has(curr.type)) {
        this.pushMappingChildren(stack, curr, current, ctx)
        continue
      }
      if (MAPPING_PAIR_TYPES.has(curr.type)) {
        this.visitMappingPair(curr, current, ctx, stack)
        continue
      }
      if (SEQUENCE_TYPES.has(curr.type)) {
        this.visitSequence(curr, current, ctx, stack)
        continue
      }
      if (curr.type === "anchor") {
        this.visitAnchor(curr, current, ctx, stack)
        continue
      }
      if (curr.type === "alias") {
        this.visitAlias(curr, current, ctx)
        continue
      }

      // Scalars and any grammar extension (tags, future node types) are read through
      // their owning key, which already recorded the resolved type, the tag and the
      // sensitivity. Descending is a no-op for leaves and keeps the traversal total.
      this.pushChildren(stack, curr, current)
    }
  }

  private visitDocument(node: Node, current: VisitContext, ctx: YamlContext, stack: { node: Node; context: VisitContext }[]): void {
    const documentName = this.documentName(ctx.filePath, ctx.documentCount + 1, ctx.projectRoot)
    ctx.documentCount++
    if (ctx.documentCount > 1) this.addPattern(ctx, "Multi-document YAML")
    if (!ctx.anchors.has(documentName)) ctx.anchors.set(documentName, new Map())

    const document = this.createSymbol(
      documentName,
      ASTEngine.SymbolKind.Module,
      node,
      current.parent,
      current.parentPath,
      ctx,
      { yamlSpecific: true, nodeType: "document", documentIndex: ctx.documentCount, fullPath: documentName },
      documentName,
    )

    // A `kind: Secret` document is a secret CONTAINER. Sensitivity starts at its
    // payload keys, not at the document: `apiVersion`/`kind`/`metadata` are the
    // Kubernetes envelope and are not secret values.
    const kind = this.topLevelScalar(node, "kind")
    const isSecretDocument = kind === "Secret" || kind === "SealedSecret"
    if (isSecretDocument) {
      ctx.sensitiveDocuments.add(documentName)
      this.addPattern(ctx, "Secret Manifest")
    }
    const declaredName = this.topLevelScalar(node, "metadata.name") ?? this.topLevelScalarFromMapping(node, "metadata", "name")
    if (declaredName) ctx.declaredNames.set(declaredName, documentName)

    this.pushChildren(stack, node, {
      parent: document,
      parentPath: documentName,
      pointerPath: "",
      document: documentName,
      depth: current.depth + 1,
      siblingKeys: new Set(),
      inSecretDocument: isSecretDocument || current.inSecretDocument,
    })
    void document
  }

  private visitDirective(node: Node, ctx: YamlContext): void {
    if (node.type === "yaml_directive") {
      const version = this.findNamedChild(node, "yaml_version")
      ctx.metadata.yamlVersion = version ? this.scalarText(version) : this.scalarText(node)
      this.addPattern(ctx, "YAML Version Directive")
      return
    }
    if (node.type === "tag_directive") {
      const handle = this.findNamedChild(node, "tag_handle")
      const prefix = this.findNamedChild(node, "tag_prefix")
      if (handle && prefix) {
        const h = this.scalarText(handle)
        const p = this.scalarText(prefix)
        ctx.tagHandles.set(h, p)
        const handles = (ctx.metadata.tagHandles as string[]) ?? []
        handles.push(`${h} -> ${p}`)
        ctx.metadata.tagHandles = handles
      }
      this.addPattern(ctx, "YAML Tag Directive")
      return
    }
    // reserved_directive: `%FOO bar baz`, removed from YAML 1.2 but parseable.
    const name = this.findNamedChild(node, "directive_name")
    const parameter = this.findNamedChild(node, "directive_parameter")
    const reserved = (ctx.metadata.reservedDirectives as string[]) ?? []
    reserved.push(name ? this.scalarText(name) : this.scalarText(node))
    if (parameter) reserved.push(this.scalarText(parameter))
    ctx.metadata.reservedDirectives = reserved
    this.addPattern(ctx, "Reserved Directive")
  }

  /**
   * Descend through a grammar ERROR while KEEPING the enclosing identity.
   *
   * WHY NOT A NEW SCOPE. The first version answered damage with damage: a damaged node
   * became a synthetic `#damaged@<line>` scope and every symbol beneath it was renamed
   * under that prefix. It stopped ids colliding — which was the actual defect — but it
   * renamed the ENTIRE key tree of the file, and the F5 differential then reported
   * 45,990 "unexplained" disagreements that were this one decision, not a disagreement
   * between the two parsers. Nothing is lost by keeping identity, so nothing should be
   * renamed.
   *
   * SO: the pairs keep the document's identity, the symbols carry `recovered: true` plus
   * the line and width of the damage that was passed through, and the file keeps the
   * pattern. The damage is still declared — on the symbols and in the pattern list —
   * but it is declared as METADATA rather than baked into every name.
   *
   * A root-level ERROR has no `document` node, so the file would otherwise have no
   * identity at all; that case synthesises the document symbol from the stem, marked
   * recovered, which is what keeps `v1.27.swagger` instead of `[13].swagger`.
   *
   * WHAT THE DAMAGE ACTUALLY IS — corrected 2026-09-28 by script/m60/yaml-bucket-audit.ts,
   * which overturned the description this comment previously gave. It used to say "a
   * single 58-byte multi-line double-quoted scalar … at the document root", and the
   * 58-byte figure is real but it is a DIFFERENT node: in v1.28 it is a nested ERROR at
   * bytes 79,218-79,276, line 2453, depth 4. The root node ITSELF is the ERROR, and it
   * is enormous. Measured over `docker/api/docs/v1.25.yaml`..`v1.38.yaml`:
   *
   *     file      fileBytes  treeEnd   coverage  rootType
   *     v1.25        260,742    72,809     27.9%  ERROR
   *     v1.28        278,336    79,276     28.5%  ERROR
   *     v1.38        354,991   110,341     31.1%  ERROR
   *
   * So the parser does not lose containment to one bad token — it STOPS. Between 69%
   * and 72% of each file is never parsed at all, which is why the analyzer publishes
   * 1,991-2,637 key-tree paths where an independent reader finds 7,249-9,001. The
   * distinction is not cosmetic: "one 58-byte token" is a narrow upstream bug report,
   * "the root node is an ERROR and 70% of the file is unparsed" says the parser gives
   * up, and only the second is true. The trigger is still the multi-line double-quoted
   * scalar — the 58-byte node is where it starts.

   */
  private descendThroughDamage(node: Node, current: VisitContext, ctx: YamlContext, stack: { node: Node; context: VisitContext }[]): void {
    const site = { line: node.startPosition.row + 1, width: node.endIndex - node.startIndex }
    this.addPattern(ctx, "Grammar Error Recovery")

    if (!current.parent) {
      const documentName = this.documentName(ctx.filePath, ctx.documentCount + 1, ctx.projectRoot)
      // AN IDENTITY IS NOT A DECLARATION. A root-level ERROR has no `document` node, so
      // the source contains no document declaration and the analyzer must not invent one
      // named after the file stem. The M12 ground truth caught exactly this: for
      // `Negative.yaml` (a destroyed document) a synthesised module is a false positive
      // against hand-audited truth, where the only symbol that exists is the `valid`
      // property that survived. What the surviving pairs DO need is a path to hang from,
      // so the stem is supplied as the parent PATH and NO symbol is created for it. The
      // damage is still declared, on every symbol reached through here.
      this.pushChildren(stack, node, {
        parent: null,
        parentPath: documentName,
        pointerPath: "",
        document: documentName,
        depth: current.depth + 1,
        siblingKeys: new Set(),
        inSensitiveSubtree: current.inSensitiveSubtree,
        recoveredThrough: site,
      })
      return
    }

    this.pushChildren(stack, node, { ...current, depth: current.depth + 1, recoveredThrough: site })
  }

  /**
   * The index a sequence item carries when it is reached WITHOUT an enclosing
   * sequence — which is exactly the damaged case above. Counted by node TYPE and
   * byte position, never by wrapper identity: web-tree-sitter returns a FRESH
   * wrapper per call, so `sibling === itemNode` can never hold and an identity scan
   * is dead code that silently returns a file-wide count instead.
   */
  private itemIndexAmongSiblings(itemNode: Node): number {
    const parent = itemNode.parent
    if (!parent) return 0
    let index = 0
    for (let i = 0; i < parent.namedChildCount; i++) {
      const sibling = parent.namedChild(i)
      if (!sibling) continue
      if (sibling.startIndex === itemNode.startIndex) return index
      if (SEQUENCE_ITEM_TYPES.has(sibling.type)) index++
    }
    return index
  }

  private visitMappingPair(
    node: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
  ): void {
    const keyNode = this.mappingKeyNode(node)
    if (!keyNode) return
    const key = this.scalarText(keyNode)
    if (!key) return

    const valueNode = node.childForFieldName("value") || this.mappingValueNode(node)
    const tag = this.tagOf(valueNode, ctx)
    const rawType = this.valueType(valueNode)
    const valueType = tag?.typeOverride ?? rawType
    const isMerge = key === "<<"
    const isDuplicate = current.siblingKeys.has(key)
    if (isDuplicate) current.siblingKeys.add(`${key}\u0000dup`)
    else current.siblingKeys.add(key)

    const keyLine = keyNode.startPosition.row + 1
    const path = this.uniquePath(current.parentPath, current.document, key, isDuplicate, ctx)
    // A duplicate mapping key is a REPLACEMENT, and the two entries are already two
    // distinct symbols because `uniquePath` gave the later one a `#n` suffix. That is
    // what makes an `overrides` edge possible at all: an edge needs two endpoints, and
    // without the disambiguation both endpoints would be the same path.
    //
    // Confidence is 0.8, not 1.0, and the reason is recorded on the edge: the two
    // entries are a parse FACT, but "the later one replaces the earlier" is loader
    // behaviour rather than a grammar guarantee. YAML 1.2 leaves duplicate mapping
    // keys undefined; mainstream loaders take the last value, GitHub Actions rejects
    // the file outright. So the pair is certain and the override semantics are a
    // convention, and an edge that claimed 1.0 would be asserting the convention as
    // if the grammar had said it.
    if (isDuplicate) {
      const base = current.parentPath ? `${current.parentPath}.${key}` : key
      // `uniquePath` has already bumped the counter to this occurrence's number, so
      // reading it back rather than recomputing keeps the edge's two endpoints and the
      // two symbol paths derived from ONE number instead of two that can disagree.
      const ordinal = ctx.duplicateCounters.get(`${current.document}\u0000${base}`) ?? 1
      const overridden = ordinal === 1 ? base : `${base}#${ordinal}`
      this.addRelationship(
        ctx,
        path,
        overridden,
        ASTEngine.RelationshipType.Overrides,
        {
          relationshipType: "yaml_duplicate_key",
          duplicateKey: key,
          occurrence: ordinal + 1,
          overriddenPath: overridden,
          isDuplicateKey: true,
          // Both endpoints are symbols of THIS file, so this resolves; the uncertainty
          // is in the semantics, which is why `resolved` and `confidence` disagree here.
          resolved: true,
          yamlSpecStatus: "duplicate mapping keys are undefined in YAML 1.2; last-wins is conventional loader behaviour",
        },
        keyLine,
        0.8,
        "duplicate-mapping-key-last-wins",
      )
    }
    const pointerPath = `${current.pointerPath}/${this.escapePointer(key)}`
    const symbolKind = valueType === "object"
      ? ASTEngine.SymbolKind.Class
      : valueType === "array"
        ? ASTEngine.SymbolKind.Variable
        : ASTEngine.SymbolKind.Property

    // Sensitive when the KEY names a secret, or when we are already inside a subtree
    // that was judged sensitive (a Secret payload key, or a sensitive key's value).
    // The document alone is not enough: that flagged the Kubernetes envelope too.
    const sensitive =
      SENSITIVE_KEY_NAMES.has(key.toLowerCase()) ||
      current.inSensitiveSubtree === true ||
      (current.inSecretDocument === true && SECRET_PAYLOAD_KEYS.has(key))
    const line = keyNode.startPosition.row + 1

    const symbol = this.createSymbol(
      key,
      symbolKind,
      keyNode,
      current.parent,
      current.parentPath,
      ctx,
      {
        yamlSpecific: true,
        nodeType: node.type,
        valueType,
        rawValueType: tag?.typeOverride ? rawType : undefined,
        valueTypeSource: tag?.typeOverride ? "tag" : rawType === "untyped" ? "default" : "grammar",
        fullPath: path,
        pointerPath,
        isObject: valueType === "object",
        isArray: valueType === "array",
        isMergeKey: isMerge,
        isAlias: valueType === "alias",
        isDuplicateKey: isDuplicate || undefined,
        isSensitive: sensitive || undefined,
        sensitivityReason: sensitive
          ? SENSITIVE_KEY_NAMES.has(key.toLowerCase())
            ? `key-name:${key.toLowerCase()}`
            : current.inSecretDocument === true && SECRET_PAYLOAD_KEYS.has(key)
              ? "secret-document-payload"
              : "sensitive-subtree"
          : undefined,
        recovered: current.recoveredThrough !== undefined || current.parent?.metadata?.recovered === true || undefined,
        recoveredThrough: current.recoveredThrough,
        declaredType: this.tagTypeName(tag),
        tagUri: tag?.uri,
        tagLine: tag?.line,
        tagIncludePath: tag?.includePath,
        tagIncludeQuoted: tag?.includeQuoted,
        scalarType: SCALAR_SHAPES.has(valueType) ? valueType : undefined,
        line,
      },
      path,
    )
    symbol.complexity = this.nodeComplexity(valueNode, valueType)
    const docstring = this.docstringFor(line, keyNode.startPosition.column + 1, ctx)
    if (docstring) symbol.docstring = docstring
    this.assignApiContractPath(symbol)
    ctx.shapeIndex.set(path, valueType)
    this.indexShape(current.document, current.parentPath, path, valueType, ctx)
    if (valueType === "object" || valueType === "array") ctx.pointerIndex.set(pointerPath, path)

    this.emitKeySemantics(key, symbol, valueNode, valueType, keyNode, line, current, ctx)

    if (valueNode) {
      stack.push({
        node: valueNode,
        context: {
          parent: symbol,
          parentPath: path,
          pointerPath,
          document: current.document,
          depth: current.depth + 1,
          siblingKeys: new Set(),
          inSensitiveSubtree: sensitive || current.inSensitiveSubtree,
        },
      })
    }
  }

  /**
   * The semantics a mapping KEY carries. Every decision here comes from the key
   * node's text, the value node's type, or the value node's position — never from
   * scanning the value's characters.
   */
  private emitKeySemantics(
    key: string,
    symbol: ASTEngine.UniversalSymbol,
    valueNode: Node | null,
    valueType: string,
    keyNode: Node,
    line: number,
    current: VisitContext,
    ctx: YamlContext,
  ): void {
    const path = symbol.qualifiedName || symbol.id

    // `$ref` and JSON pointers: resolved against the pointer index in a post-pass,
    // because the target may be declared later in the file.
    if (valueType === "string" && valueNode) {
      const pointer = this.scalarText(valueNode)
      if (key === "$ref" || this.isJsonPointer(pointer)) {
        this.addRelationship(ctx, path, pointer, ASTEngine.RelationshipType.References, {
          relationshipType: "yaml_json_pointer",
          ...this.pointerClaim(pointer, ctx),
          pointer: pointer.startsWith("#/") ? pointer.slice(1) : pointer,
          referencedName: pointer,
        }, line)
      }
    }

    // Container composition: `depends_on` names a sibling service in the same file.
    if (DEPENDS_ON_KEYS.has(key) && this.isDependencyPosition(key, current)) {
      for (const name of this.dependencyTargets(valueNode)) {
        // THE DOCUMENT TRAVELS WITH THE REFERENCE. A `needs:` target is a JOB ID, and a job is
        // declared once per WORKFLOW FILE — so the bare name is ambiguous by construction and
        // production's `COUNT(*) = 1` bare-name rule can never bind it. MEASURED on the whole
        // corpus: 802 of the lane's 879 ambiguous `references` are exactly this shape
        // (`test` 125 edges / 3 declarations, `get-go-version` 59 / 12, `build` 51 / 3 …). The
        // document-scoped identity `<document>.jobs.<id>` is unique, and the lane already
        // publishes it (`.github.workflows.publish-npm-nightly.jobs.test`, measured).
        ctx.pendingReferences.push({ source: path, target: name, kind: "yaml_depends_on", line, document: current.document })
      }
    }

    // Kubernetes object references. Two SHAPES, and conflating them over-fires:
    //   wrapper      `configMapRef: { name: cm }` — the payload IS a reference, and
    //                the only value in it that names a resource is `name`.
    //   volume src   `configMap: { defaultMode: 3, items: [...] }` — a VOLUME SOURCE,
    //                whose payload is configuration, not a name.
    // Measured over kubernetes (M60 spelling census): the conflated walk collected
    // every nested scalar of a volume source, so
    // `spec.template.spec.volumes[0].configMap` emitted a resource ref to `3` — the
    // integer of `defaultMode: 3` — and to every `items[].key`/`items[].path` string
    // in the same block. A `contains` edge was right; the NAME it invented was not,
    // and it was invented 4 times in one file alone.
    if (RESOURCE_REF_WRAPPERS.has(key)) {
      for (const name of this.wrapperRefNames(valueNode)) {
        ctx.pendingReferences.push({ source: path, target: name, kind: "yaml_resource_ref", line })
      }
    } else if (RESOURCE_REF_SOURCES.has(key)) {
      const nameKey = RESOURCE_REF_SOURCES.get(key)!
      // Scalar shorthand (`secret: my-secret`) or a named field inside the payload
      // (`configMap: { name: my-cm }`, `persistentVolumeClaim: { claimName: pvc }`).
      // A payload with NO naming field is configuration, and contributes no reference.
      // `valueNode` is null when a mapping entry has no value at all (a bare `key:`),
      // and `scalarNode` unwraps wrappers from a real node, so it cannot be handed one.
      // Guarded here rather than by widening scalarNode to `Node | null`: that was tried
      // and it pushed a possible-null into its other nine call sites, turning two errors
      // into thirteen. The narrow signature is what the rest of the file wants.
      const direct = valueNode ? this.scalarNode(valueNode) : null
      if (direct && SCALAR_TYPES.has(direct.type)) {
        const name = this.scalarText(direct)
        if (name) ctx.pendingReferences.push({ source: path, target: name, kind: "yaml_resource_ref", line })
      } else {
        const named = this.mappingEntryScalar(valueNode, nameKey)
        if (named) ctx.pendingReferences.push({ source: path, target: named, kind: "yaml_resource_ref", line })
      }
    } else if (RESOURCE_REF_SCALARS.has(key)) {
      // `valueNode` is null when a mapping entry has no value at all (a bare `key:`),
      // and `scalarNode` unwraps wrappers from a real node, so it cannot be handed one.
      // Guarded here rather than by widening scalarNode to `Node | null`: that was tried
      // and it pushed a possible-null into its other nine call sites, turning two errors
      // into thirteen. The narrow signature is what the rest of the file wants.
      const direct = valueNode ? this.scalarNode(valueNode) : null
      if (direct && SCALAR_TYPES.has(direct.type)) {
        const name = this.scalarText(direct)
        if (name) ctx.pendingReferences.push({ source: path, target: name, kind: "yaml_resource_ref", line })
      }
    }

    // Ansible/Helm file imports, decided by key spelling.
    if (FILE_IMPORT_KEYS.has(key) && !this.isIncludeSelectorKey(key, current, ctx)) {
      for (const name of this.fileImportTargets(key, valueNode, current.parentPath, current.document)) {
        // A ROLE IMPORT NAMES A ROLE, AND A ROLE IS A DIRECTORY. `include_role`/`import_role` with
        // `name: X` resolves, in ansible, to `<roleRoot>/roles/X/tasks/main.yml` for whichever
        // `roleRoot` on the search path (walking up from the importing file) carries it. The lane
        // used to emit the bare name `X`, which is not a symbol anywhere — so the edge collided
        // with every ordinary key spelled `X` and the arbiter could only read it as AMBIGUOUS.
        // MEASURED over the whole admitted ansible population: 209 role-import sites, of which 131
        // (62.7%) resolve to a `roles/<name>/tasks/main.yml` the project HAS. When the entry file
        // is on disk the edge targets THAT FILE and carries the file claim, which the arbiter
        // verifies; the ROLE NAME travels in metadata so nothing is lost. When no candidate exists
        // the pre-existing bare-name behaviour is kept unchanged, so this fix can only ADD
        // checkable edges — it cannot remove an edge or weaken a claim.
        const roleEntry = ROLE_IMPORT_KEYS.has(key) ? this.roleEntryTarget(name, ctx) : null
        const target = roleEntry ?? name
        const claim = roleEntry !== null
          ? { importProjectFile: [roleEntry] }
          : this.keywordIncludeClaim(name, ctx, key)
        this.addImport(ctx, target, "yaml_keyword_include", keyNode, true)
        this.addRelationship(ctx, path, target, ASTEngine.RelationshipType.Imports, {
          relationshipType: "yaml_keyword_include",
          ...(roleEntry !== null ? { roleName: name } : {}),
          // THE CLAIM IS DECIDED, NOT ASSUMED. This site used to hard-code `isExternal: true`,
          // which the arbiter reads as "look this target's OWNER up" — the wrong question for a
          // path, and the source of the 107 refuted external claims the whole-population run
          // found. `keywordIncludeClaim` states the file claim when the target is a file this
          // project's admitted list can answer for, and nothing weaker than before when it is
          // not. See the helper for the measurement and the two refusals.
          ...claim,
        }, line)
      }
    }

    // `uses:` is one key with more than one meaning, and the file's shape decides which.
    // The site is held until detectFrameworks has run, and the ROLE travels with it
    // because a job-level `uses:` is a call and must not be labelled an import.
    if (key === "uses" && valueType === "string" && valueNode) {
      const role: UsesRole = isJobLevelPath(current.parentPath, current.document) ? "workflow-call" : "other"
      ctx.pendingActionUses.push({ source: path, action: this.scalarText(valueNode), line, role })
    }

    // A named schema definition under a PUBLICATION container. This is the one place YAML
    // writes down an export: the definition is named once here and reached from other
    // documents as `$ref: '#/components/schemas/<name>'`, which is what `exports` means
    // in every other lane. The container name alone does not decide it — a `definitions`
    // key inside an unrelated document is just a bag of values — so the role is only
    // settled in the post-pass, against the file's own `openapi:`/`swagger:` claim.
    const publication = schemaPublicationRole(current.parentPath, current.document)
    if (publication) {
      ctx.pendingSchemaPublications.push({ document: current.document, container: publication, name: key, path, line })
    }

    // The declared-type graph (M60 R9): the tag WRITES a type name at this
    // declaration, so the declaration references the type it names.
    const declaredType = symbol.metadata?.declaredType as string | undefined
    if (declaredType) {
      this.addRelationship(ctx, path, declaredType, ASTEngine.RelationshipType.References, {
        relationshipType: "declared_type",
        tagUri: (symbol.metadata?.tagUri as string) ?? declaredType,
        isExternal: true,
      }, (symbol.metadata?.tagLine as number) ?? line)
    }

    // An include-family tag names a file: a real import, and the whole reason a tag
    // cannot be treated as decoration.
    const includePath = symbol.metadata?.tagIncludePath as string | undefined
    if (includePath) {
      this.addImport(ctx, includePath, "yaml_tag_include", keyNode, true)
      this.addRelationship(ctx, path, includePath, ASTEngine.RelationshipType.Imports, {
        relationshipType: "yaml_tag_include",
        ...this.tagIncludeClaim(includePath, ctx, symbol.metadata?.tagIncludeQuoted === true),
      }, (symbol.metadata?.tagLine as number) ?? line)
    }
  }

  private visitSequence(
    node: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
  ): void {
    // Children are pushed from LAST to FIRST so the LIFO stack pops them in document
    // order — which means the child's own index `i` IS its sequence position, and a
    // separate ascending counter over this descending loop would number every sequence
    // backwards. That is not hypothetical: an ascending counter shipped here once and
    // the fixture dump printed `item_2, item_1, item_0` in source order. A reversed
    // sequence still looks like plausible output, so only re-reading the emission
    // against the source finds it.
    const total = node.namedChildCount
    let assigned = 0
    for (let i = total - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) {
        stack.push({
          node: child,
          context: { ...current, depth: current.depth + 1, sequenceItem: true, sequenceIndex: i },
        })
        assigned++
      }
    }
    if (current.parent) {
      current.parent.metadata = { ...(current.parent.metadata || {}), itemCount: assigned }
      if (assigned > 0 && !current.parent.complexity) current.parent.complexity = assigned
    }
  }

  private visitSequenceItem(
    node: Node,
    itemNode: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
    index: number,
  ): void {
    const valueNode = SEQUENCE_ITEM_TYPES.has(node.type) ? this.firstNamedChild(node) : node
    if (!valueNode) return
    const itemPath = `${current.parentPath}[${index}]`
    const pointerPath = `${current.pointerPath}/${index}`
    const tag = this.tagOf(valueNode, ctx)
    const rawType = this.valueType(valueNode)
    const valueType = tag?.typeOverride ?? rawType
    const line = itemNode.startPosition.row + 1

    if (valueType === "object" || valueType === "array") {
      const item = this.createSymbol(
        `item_${index}`,
        valueType === "object" ? ASTEngine.SymbolKind.Class : ASTEngine.SymbolKind.Variable,
        itemNode,
        current.parent,
        current.parentPath,
        ctx,
        {
          yamlSpecific: true,
          nodeType: itemNode.type,
          valueType,
          valueTypeSource: tag?.typeOverride ? "tag" : rawType === "untyped" ? "default" : "grammar",
          fullPath: itemPath,
          pointerPath,
          isArrayItem: true,
          arrayIndex: index,
          recovered: current.recoveredThrough !== undefined || current.parent?.metadata?.recovered === true || undefined,
          recoveredThrough: current.recoveredThrough,
          declaredType: this.tagTypeName(tag),
          tagUri: tag?.uri,
          tagLine: tag?.line,
          tagIncludePath: tag?.includePath,
          tagIncludeQuoted: tag?.includeQuoted,
          isSensitive: current.inSensitiveSubtree === true || undefined,
          sensitivityReason: current.inSensitiveSubtree === true ? "sensitive-subtree" : undefined,
          line,
        },
        itemPath,
      )
      item.complexity = this.nodeComplexity(valueNode, valueType)
      const docstring = this.docstringFor(line, itemNode.startPosition.column + 1, ctx)
      if (docstring) item.docstring = docstring
      this.assignApiContractPath(item)
      ctx.shapeIndex.set(itemPath, valueType)
      ctx.pointerIndex.set(pointerPath, itemPath)
      this.emitTagSemantics(itemPath, tag, itemNode, line, ctx)
      stack.push({
        node: valueNode,
        context: {
          parent: item,
          parentPath: itemPath,
          pointerPath,
          document: current.document,
          depth: current.depth + 1,
          siblingKeys: new Set(),
          inSensitiveSubtree: current.inSensitiveSubtree,
        },
      })
      return
    }

    // An anonymous scalar item is a VALUE, not a declaration. It is still indexed so
    // a `$ref` or a sibling reference can point at it.
    ctx.pointerIndex.set(pointerPath, itemPath)
    if (tag?.includePath) {
      this.addImport(ctx, tag.includePath, "yaml_tag_include", itemNode, true)
      this.addRelationship(ctx, current.parentPath, tag.includePath, ASTEngine.RelationshipType.Imports, {
        relationshipType: "yaml_tag_include",
        ...this.tagIncludeClaim(tag.includePath, ctx, tag.includeQuoted === true),
      }, tag.line)
    } else if (this.tagTypeName(tag)) {
      this.addRelationship(ctx, current.parentPath, tag!.shortName, ASTEngine.RelationshipType.References, {
        relationshipType: "declared_type",
        tagUri: tag!.uri,
        isExternal: true,
      }, tag!.line)
    }
    stack.push({ node: valueNode, context: { ...current, depth: current.depth + 1, sequenceItem: false } })
  }

  /** The declared-type and include-import edges a tag implies, for a sequence item. */
  private emitTagSemantics(source: string, tag: TagInfo | null, node: Node, line: number, ctx: YamlContext): void {
    if (!tag) return
    if (tag.includePath) {
      this.addImport(ctx, tag.includePath, "yaml_tag_include", node, true)
      this.addRelationship(ctx, source, tag.includePath, ASTEngine.RelationshipType.Imports, {
        relationshipType: "yaml_tag_include",
        ...this.tagIncludeClaim(tag.includePath, ctx, tag.includeQuoted === true),
      }, tag.line)
      return
    }
    if (this.tagTypeName(tag)) {
      this.addRelationship(ctx, source, tag.shortName, ASTEngine.RelationshipType.References, {
        relationshipType: "declared_type",
        tagUri: tag.uri,
        isExternal: true,
      }, tag.line)
    }
    void line
  }

  private visitAnchor(
    node: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
  ): void {
    const nameNode = this.findNamedChild(node, "anchor_name")
    const name = nameNode ? this.scalarText(nameNode) : ""
    if (name) {
      const anchorScope = current.parent?.qualifiedName || current.parent?.id || current.parent?.name || current.document
      const key = `${anchorScope}#${name}`
      if (!ctx.symbolIds.has(key)) {
        ctx.symbolIds.add(key)
        const anchor = this.createSymbol(
          name,
          ASTEngine.SymbolKind.Constant,
          nameNode || node,
          current.parent,
          current.parentPath,
          ctx,
          {
            yamlSpecific: true,
            nodeType: "anchor",
            isAnchor: true,
            anchorName: name,
            anchorDocument: current.document,
            anchorScope,
            fullPath: key,
            line: node.startPosition.row + 1,
          },
          key,
        )
        // Anchors are document-scoped in YAML and the NEAREST definition wins, so
        // registering unconditionally is what makes nearest-wins true. A first-wins
        // registry would let a later document capture an earlier document's alias.
        const documentAnchors = ctx.anchors.get(current.document) ?? new Map<string, ASTEngine.UniversalSymbol>()
        documentAnchors.set(name, anchor)
        ctx.anchors.set(current.document, documentAnchors)
        this.addPattern(ctx, "Anchors and Aliases")
      }
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child && child.type !== "anchor_name") stack.push({ node: child, context: current })
    }
  }

  private visitAlias(node: Node, current: VisitContext, ctx: YamlContext): void {
    const nameNode = this.findNamedChild(node, "alias_name")
    const target = nameNode ? this.scalarText(nameNode) : ""
    if (!target) return
    this.addPattern(ctx, "Anchors and Aliases")
    const merge = current.parent?.metadata?.isMergeKey === true
    // A merge key inherits INTO the object that CONTAINS the `<<`, so the edge leaves
    // the containing object, not the `<<` key itself.
    const source = merge
      ? current.parent?.ownerName || current.parent?.qualifiedName || current.parent?.id || current.parent?.name || ""
      : current.parent?.qualifiedName || current.parent?.id || current.parent?.name || ""
    if (!source) return
    ctx.aliasRefs.push({ source, target, merge, document: current.document, line: node.startPosition.row + 1 })
  }

  private resolveAliases(ctx: YamlContext): void {
    for (const alias of ctx.aliasRefs) {
      const anchor = ctx.anchors.get(alias.document)?.get(alias.target)
      const target = anchor?.qualifiedName || alias.target
      const type = alias.merge ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Uses
      // A missing anchor is unresolved WITH A REASON rather than a bare dangling
      // name: "declared in another document" and "never declared" are different
      // findings and only one of them is a defect.
      const crossDocument = !anchor && this.anchorExistsElsewhere(alias.target, alias.document, ctx)
      this.addRelationship(ctx, alias.source, target, type, {
        relationshipType: alias.merge ? "yaml_merge" : "yaml_alias",
        aliasName: alias.target,
        aliasDocument: alias.document,
        resolved: !!anchor,
        unresolvedReason: anchor ? undefined : crossDocument ? "anchor-defined-in-another-document" : "anchor-not-declared",
        isExternal: false,
      }, alias.line, anchor ? 1 : crossDocument ? 0.5 : 0.8, crossDocument ? "cross-document-alias" : "unresolved-alias")
      if (alias.merge) this.addPattern(ctx, "Configuration Inheritance")
    }
  }

  private anchorExistsElsewhere(name: string, document: string, ctx: YamlContext): boolean {
    for (const [doc, anchors] of ctx.anchors) {
      if (doc !== document && anchors.has(name)) return true
    }
    return false
  }

  /** A job-level `uses:` is a CALL of a reusable workflow, and never an import. */
  private resolveActionUses(ctx: YamlContext): void {
    if (ctx.pendingActionUses.length === 0) return
    const isWorkflow = ctx.frameworks.includes("GitHub Actions")
    // The calls are held to the same shape gate as the action imports. A job-level
    // `uses:` in a file whose shape did not prove a workflow is left as an unproven
    // reference rather than promoted to a call, because `jobs.<id>.uses` is only
    // defined by GitHub Actions and nothing else in YAML gives `jobs` that meaning.
    for (const use of ctx.pendingActionUses) {
      if (use.role === "workflow-call") {
        if (!isWorkflow) {
          this.addRelationship(ctx, use.source, use.action, ASTEngine.RelationshipType.References, {
            relationshipType: "yaml_workflow_call_unverified",
            isExternal: true,
            resolved: false,
            unresolvedReason: "file-shape-is-not-a-github-workflow",
          }, use.line, 0.7, "shape-not-workflow")
          continue
        }
        // `./path` names a workflow in THIS repository; anything else names one in
        // another repository at a ref. Both are cross-file, so neither endpoint is a
        // symbol here and `resolved` says so instead of implying a bind that did not
        // happen. Confidence is 1.0 because the ROLE is a parse fact — the key sits at
        // `jobs.<id>.uses`, where GitHub Actions admits nothing else.
        const local = use.action.startsWith("./") || use.action.startsWith("../")
        this.addRelationship(ctx, use.source, use.action, ASTEngine.RelationshipType.Calls, {
          relationshipType: "yaml_workflow_call",
          evidenceClass: "structural",
          // A REUSABLE-WORKFLOW CALL NAMES A FILE, not an action directory — see
          // `workflowCallClaim`. Routed through `actionUseClaim` it looked for
          // `<file>/action.yml`, found nothing, and claimed `isExternal` about a workflow
          // file this project has (208 edges over the whole admitted population).
          ...this.workflowCallClaim(use.action, ctx),
          resolved: false,
          unresolvedReason: local ? "workflow-in-same-repository-not-indexed" : "workflow-in-another-repository",
        }, use.line)
        continue
      }
      if (!isWorkflow) {
        this.addRelationship(ctx, use.source, use.action, ASTEngine.RelationshipType.References, {
          relationshipType: "yaml_action_use_unverified",
          ...this.actionUseClaim(use.action, ctx),
          resolved: false,
          unresolvedReason: "file-shape-is-not-a-github-workflow",
        }, use.line, 0.7, "shape-not-workflow")
        continue
      }
      // `yaml_action_use`, NOT `github_action`: the relationship beside it already uses
      // that name, and an import row that disagrees with its own relationship is a second
      // vocabulary for one fact. The corpus census asserts row-type == relationshipType
      // and caught the mismatch on its first run.
      this.addImport(ctx, use.action, "yaml_action_use", undefined, !use.action.startsWith("./") && !use.action.startsWith("docker://"), use.line)
      this.addRelationship(ctx, use.source, use.action, ASTEngine.RelationshipType.Imports, {
        relationshipType: "yaml_action_use",
        ...this.actionUseClaim(use.action, ctx),
      }, use.line)
    }
  }

  /**
   * `exports`: the named definitions a document publishes for other documents to
   * `$ref`. The document is the exporting unit and the definition is the exported
   * name, and BOTH are symbols of this file — so unlike every external edge in this
   * analyzer, this one resolves at both ends.
   *
   * Gated on the document declaring `openapi:` or `swagger:` at its top level, read
   * from the shape index rather than from the text: a `components.schemas.X` path
   * inside a file that never claims to be an API description is a coincidence of
   * naming, and a publication edge on a coincidence is a fabricated edge.
   */
  private resolveSchemaExports(ctx: YamlContext): void {
    if (ctx.pendingSchemaPublications.length === 0) return
    let emitted = 0
    for (const pub of ctx.pendingSchemaPublications) {
      const shapes = ctx.documentShapes.get(pub.document)
      if (!shapes || !(shapes.has("openapi") || shapes.has("swagger"))) continue
      this.addRelationship(ctx, pub.document, pub.path, ASTEngine.RelationshipType.Exports, {
        relationshipType: "yaml_schema_publication",
        evidenceClass: "structural",
        container: pub.container,
        definitionName: pub.name,
        isExternal: false,
        resolved: true,
      }, pub.line)
      emitted++
    }
    if (emitted > 0) this.addPattern(ctx, "Published Schema Components")
  }

  /** `$ref` targets that point outside this file, or at a pointer nothing declares. */
  private resolvePointerReferences(ctx: YamlContext): void {
    for (const r of ctx.relationships) {
      if (r.metadata?.relationshipType !== "yaml_json_pointer") continue
      const pointer = r.metadata.pointer as string | undefined
      if (typeof pointer !== "string") continue
      if (!pointer.startsWith("/")) {
        r.metadata.resolved = false
        r.metadata.unresolvedReason = "external-file"
        continue
      }
      const hit = ctx.pointerIndex.get(pointer)
      if (hit) {
        r.target = hit
        r.metadata.resolved = true
        r.metadata.resolvedIn = "file"
        r.confidence = 1
      } else {
        // THE RECOVERY FALLBACK. On an error-recovered tree the pointer key can be absent for a
        // reason that has nothing to do with the document: the grammar FLATTENS. MEASURED on
        // docker's `api/docs/v1.25.yaml`: the root is an ERROR node whose 54 `block_mapping_pair`
        // children include `swagger:` at line 12 AND `MountType:` at line 186 — `definitions:`
        // itself is gone and its members were hoisted to the top level, so the walk indexes
        // `/MountType` while the document's `$ref` says `#/definitions/MountType`. The document
        // publishes `api.docs.v1.25.MountType`, which is what the `$ref` means.
        const recovered = this.resolvePointerOnRecoveredTree(pointer, String(r.source ?? ""), ctx)
        if (recovered !== null) {
          r.target = recovered
          r.metadata.resolved = true
          r.metadata.resolvedIn = "file"
          // NOT exact: the binding is recovered from the document's own declared paths rather
          // than from the pointer key, so it is reported at less than full confidence and with
          // its provenance named, where a reader can tell the two apart.
          r.metadata.resolvedVia = "document-shape-suffix"
          r.confidence = 0.95
          continue
        }
        r.metadata.resolved = false
        // A MISS ON AN ERROR-RECOVERED TREE IS NOT A MISSING DECLARATION. The pointer index is
        // built from the tree's own nesting, so when the grammar error-recovers the index can
        // be keyed by paths the document does not have — and reporting that as
        // `pointer-not-declared-in-file` states, falsely, that the document lacks the
        // declaration. Measured: 729 of the corpus's 762 unresolved pointer edges sit in 15
        // docker spec files with an ERROR root, none in that repo's 183 clean files.
        r.metadata.unresolvedReason = ctx.parseHadError ? "parse-error-in-document" : "pointer-not-declared-in-file"
        r.confidence = 0.9
        r.metadata.confidenceReason = r.metadata.unresolvedReason
      }
    }
  }

  /**
   * WHAT A `$ref` MEANT WHEN THE GRAMMAR FLATTENED THE TREE IT POINTS INTO.
   *
   * Consulted only for a pointer the exact index missed, and ONLY on a tree the grammar errored
   * on: on a clean parse the pointer key is the answer and this never runs, so no existing
   * resolution can move. The evidence is the document's OWN declared paths (`documentShapes`,
   * keyed by the symbol path the walk built) — the analyzer's published name for the same
   * declaration, which is what the edge must target to be resolved at all by production.
   *
   * The rule, and it refuses more than it accepts:
   *
   *   * decode the pointer's segments (`~1` -> `/`, `~0` -> `~`) and join them with `.`;
   *   * a declared path matches when it IS that string, or when the string ENDS WITH `.` + it —
   *     i.e. the declaration sits at or below the path the pointer names, which is the shape a
   *     hoisted level produces (`definitions.MountType` ends with `.MountType`);
   *   * take the LONGEST match, so the most specific declaration wins;
   *   * if two declared paths tie at that length, or the winner is not a published symbol path,
   *     return null and let the edge stay unresolved. A recovered binding that is not unique is
   *     a fabrication, and an ambiguous `$ref` is not a resolved one.
   */
  private resolvePointerOnRecoveredTree(pointer: string, source: string, ctx: YamlContext): string | null {
    if (!ctx.parseHadError) return null
    const document = this.documentOfPath(source, ctx)
    if (document === null) return null
    const shapes = ctx.documentShapes.get(document)
    if (!shapes) return null
    const decoded = pointer
      .slice(1)
      .split("/")
      .map((seg) => seg.split("~1").join("/").split("~0").join("~"))
      .join(".")
    if (decoded.length === 0) return null
    let longest = -1
    let winner: string | null = null
    let ties = 0
    for (const key of shapes.keys()) {
      if (key.length === 0) continue
      if (key !== decoded && !decoded.endsWith(`.${key}`)) continue
      if (key.length > longest) { longest = key.length; winner = key; ties = 1; continue }
      if (key.length === longest) ties++
    }
    if (winner === null || ties !== 1) return null
    const target = `${document}.${winner}`
    return ctx.shapeIndex.has(target) ? target : null
  }

  /** The document a symbol path belongs to: the longest document name that prefixes it. */
  private documentOfPath(source: string, ctx: YamlContext): string | null {
    let best: string | null = null
    for (const document of ctx.documentShapes.keys()) {
      if (source !== document && !source.startsWith(`${document}.`)) continue
      if (best === null || document.length > best.length) best = document
    }
    return best
  }

  /**
   * Sibling references: a key that names another thing declared in the same file.
   * The target set is what the walk actually saw — document `metadata.name` values and
   * top-level `services` keys — so a resolution claimed here is a resolution that was
   * measured, and an unresolved one says so with a reason and a sub-1.0 confidence.
   */
  /**
   * A `needs:` TARGET NAMES A JOB OF ITS OWN DOCUMENT, and the document-scoped identity is what
   * makes it resolvable.
   *
   * `needs: [test]` inside `.github/workflows/build.yml` means `jobs.test` of THAT FILE, and
   * every workflow in a project may declare a job named `test` — so the bare name carries N
   * declarations in the project and production's resolver, which fills a bare name only when
   * `COUNT(*) = 1` within the project, can never bind it. The lane already publishes each job as
   * `<document>.jobs.<id>`; targeting that is unique, and it is what the edge MEANT.
   *
   * Measured before the change, whole corpus: 802 of the lane's 879 ambiguous `references` are
   * this shape. The lookup is gated on the document's OWN shape index, so a Compose `depends_on`
   * (which resolves through `serviceIndex` instead) and a name that merely looks like a job are
   * both untouched — the check is "does this document declare `jobs.<target>`", not "does the
   * target look like a job".
   */
  private resolveJobInDocument(ref: { target: string; document?: string }, ctx: YamlContext): string | null {
    if (typeof ref.document !== "string" || ref.document.length === 0) return null
    const shapes = ctx.documentShapes.get(ref.document)
    if (!shapes || !shapes.has(`jobs.${ref.target}`)) return null
    return `${ref.document}.jobs.${ref.target}`
  }

  /**
   * A KUBERNETES OBJECT REFERENCED BY NAME, DECLARED IN A SIBLING FILE OF THE SAME DIRECTORY.
   *
   * ## The defect this fixes, and it was found by this lane's own falsifier
   *
   * `serviceAccountName: apiserver` in
   * `staging/src/k8s.io/sample-apiserver/artifacts/example/deployment.yaml` was UNRESOLVED, while
   * `.../artifacts/example/sa.yaml` declares `kind: ServiceAccount, metadata.name: apiserver` — the
   * same directory, one manifest set, and `kubectl apply -f <dir>` reads both. `name-collision-
   * falsifier.ts` proved it with a non-zero exit before this existed.
   *
   * ## The rule, PRICED before it was applied (the falsifier counts instead of asserting)
   *
   *   CEILING  1 ambiguous edge a same-directory, same-kind resolution can reach
   *   CONTROL  0 of them sit in a directory declaring that kind+name TWICE (ambiguous even scoped)
   *   CONTROL  117 MORE would be bound by a PROJECT-WIDE version of the rule, and every one of them
   *            is refused: another manifest set is another cluster. The directory scope is the whole
   *            claim, and that is what makes 117 a control rather than a ceiling.
   *
   * ## What it reads, and why that is not a contract violation
   *
   * `analyze()` is SYNCHRONOUS and the only parser accessor (`engine.getParser`) is async, so a
   * sibling cannot be parsed here. The two candidate spellings of a sibling's declaration
   * (`kind:` at column 0, `name:` inside a top-level `metadata:` block) are therefore read from the
   * sibling's TEXT — and the important part is what the read is FOR: it is a CANDIDATE FILTER, never
   * an extraction. The value it produces is a DOCUMENT IDENTITY, and the ARBITER then has to
   * resolve that name against the project's own key space. A wrong sibling makes the edge
   * unresolved again, not wrong; the only way text can turn into a fact here is through a lookup
   * this analyzer does not perform. The current file's OWN structure still comes from the tree.
   *
   * It is bounded and refuses more than it accepts: only a `yaml_resource_ref` whose referring key
   * maps to a KIND, only with a project root, only `.yaml`/`.yml` siblings, and it returns null the
   * moment a SECOND sibling matches — two same-kind, same-name objects in one directory is exactly
   * the case where the rule would be a guess.
   */
  private resolveSameDirectoryResource(ref: { target: string; source: string; kind: string }, ctx: YamlContext): string | null {
    if (ref.kind !== "yaml_resource_ref") return null
    const key = ref.source.slice(ref.source.lastIndexOf(".") + 1)
    const kind = RealYamlAnalyzer.KIND_FOR_RESOURCE_KEY[key]
    if (kind === undefined) return null
    const root = ctx.projectRoot
    if (typeof root !== "string" || root.length === 0) return null
    const rel = RealYamlAnalyzer.projectRelativePath(ctx.filePath, ctx.projectRoot)
    if (rel === null) return null
    const cut = rel.lastIndexOf("/")
    const dirRel = cut >= 0 ? rel.slice(0, cut) : ""
    const dirAbs = dirRel.length > 0 ? join(root, ...dirRel.split("/")) : root
    let entries: string[]
    try {
      entries = readdirSync(dirAbs)
    } catch {
      return null
    }
    const hits: string[] = []
    for (const entry of entries.sort()) {
      if (!/\.ya?ml$/i.test(entry)) continue
      const siblingRel = dirRel.length > 0 ? `${dirRel}/${entry}` : entry
      if (siblingRel === rel) continue
      let text: string
      try {
        text = readFileSync(join(dirAbs, entry), "utf8")
      } catch {
        continue
      }
      if (!RealYamlAnalyzer.declaresResource(text, kind, ref.target)) continue
      if (hits.length > 0) return null // two candidates: refuse rather than pick
      hits.push(this.documentName(join(dirAbs, entry), 1, ctx.projectRoot))
    }
    return hits.length === 1 ? hits[0] : null
  }

  /** The two spellings a sibling manifest declares: `kind:` at column 0, and `name:` inside a
   *  top-level `metadata:` block. Anchored, so a nested pod-template `metadata.name` is not read as
   *  the document's own.
   *
   *  NOT PRIVATE, and the reason is a measurement rather than convenience: the question "does this
   *  text filter produce the same CANDIDATE SET a parse would?" can only be answered against the
   *  filter that actually runs, and a probe carrying its own copy would be testing the copy. */
  static declaresResource(text: string, kind: string, name: string): boolean {
    const kindMatch = text.match(/^kind:[ \t]*["']?([A-Za-z][\w.-]*)["']?[ \t]*$/m)
    if (kindMatch === null || kindMatch[1] !== kind) return false
    const meta = text.search(/^metadata:[ \t]*$/m)
    if (meta < 0) return false
    const nameMatch = text.slice(meta).match(/^[ \t]+name:[ \t]*["']?([^"'\n#]+?)["']?[ \t]*$/m)
    return nameMatch !== null && nameMatch[1].trim() === name
  }

  /** The referring KEY -> the object KIND it names. One source of truth: the falsifier imports it,
   *  so the instrument that PRICES this rule and the analyzer that APPLIES it cannot drift. */
  static readonly KIND_FOR_RESOURCE_KEY: Record<string, string> = {
    secretName: "Secret",
    secretRef: "Secret",
    secretKeyRef: "Secret",
    secret: "Secret",
    claimName: "PersistentVolumeClaim",
    configMap: "ConfigMap",
    configMapRef: "ConfigMap",
    configMapKeyRef: "ConfigMap",
    serviceAccountName: "ServiceAccount",
  }

  private resolveSiblingReferences(ctx: YamlContext): void {
    for (const ref of ctx.pendingReferences) {
      const resolved = this.resolveDeclaredName(ref.target, ctx) ?? this.resolveJobInDocument(ref, ctx) ?? this.resolveSameDirectoryResource(ref, ctx)
      if (resolved) {
        this.addRelationship(ctx, ref.source, resolved, ASTEngine.RelationshipType.References, {
          relationshipType: ref.kind,
          isExternal: false,
          resolved: true,
          referencedName: ref.target,
        }, ref.line)
      } else {
        this.addRelationship(ctx, ref.source, ref.target, ASTEngine.RelationshipType.References, {
          relationshipType: ref.kind,
          isExternal: true,
          resolved: false,
          unresolvedReason: "not-declared-in-file",
          referencedName: ref.target,
        }, ref.line, 0.8, "unresolved-sibling-name")
      }
    }
  }

  private resolveDeclaredName(name: string, ctx: YamlContext): string | null {
    if (ctx.declaredNames.has(name)) return ctx.declaredNames.get(name)!
    return ctx.serviceIndex.get(name) ?? null
  }

  /**
   * Record one symbol's shape in the two indexes the post-passes read. Called once per
   * emitted key, so both indexes are O(1) to build and O(1) to query.
   */
  private indexShape(document: string, parentPath: string, path: string, valueType: string, ctx: YamlContext): void {
    let shapes = ctx.documentShapes.get(document)
    if (!shapes) {
      shapes = new Map<string, string>()
      ctx.documentShapes.set(document, shapes)
    }
    const relative = path.startsWith(`${document}.`) ? path.slice(document.length + 1) : path
    shapes.set(relative, valueType)
    // A Compose service, Helm release or K8s Service is a key directly under a
    // `services` mapping, and `depends_on` names it.
    if (valueType === "object" && parentPath.endsWith("services")) {
      ctx.serviceIndex.set(path.slice(path.lastIndexOf(".") + 1), path)
    }
  }

  /**
   * Matrix 1b `qualified_calls`, filled honestly for a data language: the reference,
   * alias and import targets a declaration carries. Containment is excluded — a child
   * is not something a key "calls".
   */
  private attachQualifiedCalls(ctx: YamlContext): void {
    const byId = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of ctx.symbols) byId.set(String(s.qualifiedName ?? s.id), s)
    for (const r of ctx.relationships) {
      if (r.type === ASTEngine.RelationshipType.Contains || r.type === ASTEngine.RelationshipType.Exports) continue
      const symbol = byId.get(String(r.source))
      if (!symbol) continue
      const target = String(r.target)
      if (!target) continue
      const list = (symbol.qualified_calls as string[] | undefined) ?? []
      if (!list.includes(target)) list.push(target)
      symbol.qualified_calls = list
    }
  }

  // ------------------------------------------------------------- frameworks

  /**
   * Framework detection is a SET OF EXACT PATHS WITH SHAPES, not a set of names
   * anywhere in the file. The previous implementation tested a whole-file name set,
   * so a seven-line file carrying `version`, `services`, `jobs`, `on` and `stages`
   * claimed three frameworks. The shape index this reads is built from the walk, so
   * `nested.version` is not `version` and cannot match.
   */
  private detectFrameworks(ctx: YamlContext): void {
    const path = ctx.filePath.toLowerCase()
    for (const signature of FRAMEWORK_SIGNATURES) {
      const patterns: string[] = []
      let matched = true
      for (const requirement of signature.all) {
        const hit = this.matchRequirement(requirement, path, ctx)
        if (!hit) { matched = false; break }
        patterns.push(hit)
      }
      if (matched && signature.any) {
        const hits = signature.any
          .map((requirement) => this.matchRequirement(requirement, path, ctx))
          .filter((hit): hit is string => hit !== null)
        if (hits.length === 0) matched = false
        else patterns.push(hits[0])
      }
      if (!matched) continue
      if (!ctx.frameworks.includes(signature.name)) {
        ctx.frameworks.push(signature.name)
        for (const p of patterns) if (!ctx.frameworkPatterns.includes(p)) ctx.frameworkPatterns.push(p)
        ctx.metadata.devOpsMaturity = (ctx.metadata.devOpsMaturity || 0) + signature.maturity
        const insights = ctx.metadata.architecturalInsights as string[]
        if (!insights.includes(signature.insight)) insights.push(signature.insight)
      }
    }
    if (ctx.pendingReferences.length > 0 || ctx.shapeIndex.has("services")) this.addPattern(ctx, "Service Dependencies")
  }

  /**
   * Match one signature requirement against one document. The lookup is on the
   * DOCUMENT-RELATIVE path in `documentShapes`, which is what makes two things true at
   * once: it is O(1) per requirement rather than a scan of the file's shapes, and
   * `version` can only match the key `version` at the document's top level — never
   * `nested.version`. A suffix comparison alone is exactly what let the previous
   * detector fire on a key at any depth, so the exactness is the point, not a detail.
   */
  private matchRequirement(requirement: Requirement, filePath: string, ctx: YamlContext): string | null {
    if (requirement.pathHint && !filePath.includes(requirement.pathHint)) return null
    for (const [document, shapes] of ctx.documentShapes) {
      const shape = shapes.get(requirement.path)
      if (shape === undefined) continue
      if (requirement.shape === "any" || shape === requirement.shape) return `${document}.${requirement.path}`
    }
    return null
  }

  // --------------------------------------------------------------- security

  /**
   * Sensitivity is structural, from two signals only: the key node's own text is a
   * known sensitive spelling, or the document's `kind` is `Secret`. No value text is
   * read, so `"^\d+$"` cannot be mistaken for a secret and `password: hunter2`
   * cannot be missed.
   */
  private applySecurityScore(ctx: YamlContext): void {
    let score = 100
    let sensitiveCount = 0
    for (const symbol of ctx.symbols) if (symbol.metadata?.isSensitive === true) sensitiveCount++
    if (sensitiveCount > 0) {
      score -= Math.min(40, sensitiveCount * 4)
      this.addPattern(ctx, "Sensitive Values")
    }
    if (ctx.sensitiveDocuments.size > 0) score -= Math.min(25, ctx.sensitiveDocuments.size * 10)
    ctx.metadata.securityScore = Math.max(0, score)
    ctx.metadata.sensitiveValueCount = sensitiveCount
  }

  // -------------------------------------------------------------- utilities

  /**
   * Matrix 1b `apiContractPath`, only for the two shapes that genuinely ARE a
   * contract: an OpenAPI operation, and a GitHub Actions job step. A YAML key is not
   * an API surface, so the field stays absent everywhere else rather than carrying a
   * constant.
   */
  private assignApiContractPath(symbol: ASTEngine.UniversalSymbol): void {
    const path = String(symbol.qualifiedName ?? symbol.id)
    const segments = path.split(".")
    const last = segments[segments.length - 1] ?? ""

    // OpenAPI: `<doc>.paths.<route>.<method>` — four segments, the third of which is
    // the method, so a method nested deeper (`paths./x.get.responses`) does not match.
    const pathsAt = segments.lastIndexOf("paths")
    if (pathsAt >= 0 && OPENAPI_METHODS.has(last.toLowerCase()) && segments.length === pathsAt + 3) {
      symbol.apiContractPath = `${last.toUpperCase()} ${segments[pathsAt + 1]}`
      return
    }
    // GitHub Actions: a step is one path segment, `steps[0]`, not `steps` + `[0]`.
    if (symbol.metadata?.isArrayItem === true && last.startsWith("steps[") && segments.length >= 3) {
      symbol.apiContractPath = `github-actions:${segments[segments.length - 2]}#${String(symbol.metadata.arrayIndex)}`
    }
  }

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    parentPath: string,
    ctx: YamlContext,
    metadata: Record<string, any>,
    qualifiedName?: string,
  ): ASTEngine.UniversalSymbol {
    const qualified = qualifiedName || (parentPath ? `${parentPath}.${name}` : name)
    const symbol: ASTEngine.UniversalSymbol = {
      id: qualified,
      name,
      kind,
      qualifiedName: qualified,
      ownerName: parent ? (parent.qualifiedName || parent.id || parent.name) : undefined,
      ownerKind: parent?.kind,
      scope: parent ? (parent.qualifiedName || parent.id || parent.name) : undefined,
      parentId: parent?.id,
      visibility: "public",
      range: this.nodeToRange(node),
      metadata,
    }
    // Every symbol carries a complexity, not only the ones whose value node happened to
    // be inspectable. A document or an anchor has no child mapping to count, and 1 is
    // the honest figure for "this node declares one thing" — a payload that is present on
    // 98.5% of rows is a payload no consumer can rely on. The contract probe asserts
    // totality, and the corpus census reports the count that would catch a regression.
    symbol.complexity = 1
    ctx.symbols.push(symbol)

    if (parent) {
      const role = metadata.isAnchor ? "yaml_anchor"
        : metadata.isArrayItem ? "yaml_sequence_item"
        : metadata.recovered ? "yaml_recovered_member"
        : "yaml_mapping_key"
      this.addRelationship(ctx, parent.qualifiedName || parent.id || parent.name, qualified, ASTEngine.RelationshipType.Contains, {
        role,
        fullPath: qualified,
      }, node.startPosition.row + 1)
    }
    return symbol
  }

  /**
   * Every relationship is emitted here, so two things are guaranteed for all of them
   * without an emission site being able to forget either:
   *
   *  - `line_number` is a TOP-LEVEL field, 1-based, on the name-bearing node. It is
   *    deliberately not inside `metadata`: the store binds the `line_number` COLUMN
   *    from `rel.line_number` (src/ast/parallel-indexer.ts:2870), so a value parked in
   *    metadata would reach the index as NULL and the whole navigation payload would
   *    die silently at the seam. That is the M60 P1 rot-check's exact failure mode.
   *  - `metadata.evidenceClass` is set from the relationship type.
   *
   * A sub-1.0 confidence always carries a machine-readable reason (M14 §4).
   */
  private addRelationship(
    ctx: YamlContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    metadata: Record<string, any>,
    line?: number,
    confidence?: number,
    reasonCode?: string,
  ): void {
    if (!source || !target) return
    const key = `${source}\u0000${type}\u0000${target}`
    if (ctx.relationshipKeys.has(key)) return
    ctx.relationshipKeys.add(key)
    const conf = confidence ?? 1
    const md: Record<string, any> = { ...metadata }
    if (conf < 1) md.confidenceReason = reasonCode ?? metadata.unresolvedReason ?? "heuristic-edge"
    const relationship: ASTEngine.UniversalRelationship = { source, target, type, confidence: conf, metadata: md }
    if (typeof line === "number" && line >= 1) relationship.line_number = line
    ctx.relationships.push(relationship)
  }

  /**
   * WHICH SCALARS AN INCLUDE KEY ACTUALLY NAMES — the fix for the over-emission.
   *
   * `scalarValues` recurses into a mapping and returns every nested VALUE scalar, which is right
   * for a bag of names and wrong for these keys: one
   * `- import_role: {name: role1, tasks_from: x.yml, allow_duplicates: true}` published the role
   * name, its sub-file and a BOOLEAN as three imports of this file. MEASURED over the whole
   * admitted ansible population by attributing every include edge to the key on its own
   * `line_number`: of 891 `imports` edges carrying `yaml_keyword_include`, only **567** came from
   * a key that names a file at all — 149 from a nested `name:`, 45 from `tasks_from:`, 18 from
   * `role_name:`, and 51 from keys a role import happens to contain (`hosts:`, `public:`,
   * `gather_facts:`, `command:` …). The over-emission is not cosmetic: it is what put bare
   * identifiers such as `a` (29 declarations), `c`, `foo` and `include_role` (123 declarations)
   * into `imports`, where the arbiter can only read them as ambiguous.
   *
   * The rule now follows the key's meaning, which is the same thing the claim already follows:
   *
   *   a FILE key   `include_tasks`, `import_tasks`, `import_playbook`, `import_values`,
   *                `include`, `import` — the file is the scalar value, or the `file:` sub-key
   *                when the value is a mapping (ansible's documented long form).
   *   a ROLE key   `include_role`, `import_role` — the value names a ROLE: its `name:`, or the
   *                scalar shorthand. `tasks_from`/`vars_from`/`defaults_from`/`handlers_from`
   *                name files inside a role DIRECTORY this analyzer does not resolve, so they are
   *                not this file's imports, and a boolean is not a target at all.
   */
  private fileImportTargets(key: string, valueNode: Node | null, parentPath: string, document: string): string[] {
    if (ROLE_IMPORT_KEYS.has(key)) {
      const named = this.mappingEntryScalar(valueNode, "name")
      if (named !== null) return [named]
      // The scalar shorthand (`- include_role: some_role`) names the role directly; the first
      // scalar of any other shape is that shape's only candidate for a role name.
      return this.scalarValues(valueNode).slice(0, 1)
    }
    // `include:` IS NOT ALWAYS AN INCLUDE. Under a `matrix:` it is the build-matrix directive a
    // CI system expands into JOB VARIANTS, and its members are dimensions, languages and shell
    // commands. MEASURED: powershell's `windows-packaging-reusable.yml` published `x64`,
    // `preview`, `win7`, `x86`, `stable`, `arm64` as imports of the workflow, and bulma's
    // `.travis.yml` published `sass`, `node_js`, `gem install sass` and
    // `node test/dart-sass/dart-sass.js`. Fourteen of this lane's 57 ambiguous `imports` were
    // exactly these names, and the rest were sitting in the VERIFIED column as claims about
    // files that do not exist. The parent path is the evidence, and it is the evidence the
    // `uses:` role already reads.
    // The document is excluded from the test BY NAME, and the control is why: a file called
    // `matrix.yml` has the document identity `matrix`, so a bare `/matrix$/` test made every
    // top-level `include:` in that document invisible. The guard is about a `matrix:` KEY, which
    // is always a deeper path than the document itself.
    if (key === "include" && parentPath !== document && /(^|\.)matrix$/.test(parentPath)) return []
    const file = this.mappingEntryScalar(valueNode, "file")
    if (file !== null) return [file]
    // A MAPPING UNDER A FILE KEY IS NOT A LIST OF FILES. Only its `file:` names one (handled
    // above), so a mapping contributes nothing here — which is what stops `- include: {hosts: …,
    // gather_facts: …}` from publishing a play's own KEYS' values as imports of this file.
    // MEASURED: attributing every include edge to the key on its own `line_number` found 51 such
    // scalars in the ansible population alone (`hosts:` 15, `public:` 9, `gather_facts:` 5, …),
    // and they are why bare identifiers like `time`, `main` and `dnf` appear in `imports`.
    const node = valueNode ? this.scalarNode(valueNode) : null
    if (node && MAPPING_TYPES.has(node.type)) return []
    // A SEQUENCE names files only when ITS ITEMS ARE SCALARS (`- include: [a.yml, b.yml]`). An item
    // that is a mapping is a matrix variant or a structured directive, and the scalars inside it
    // are its FIELDS, not file names — recursing into them is what published `x64` and
    // `gem install sass` above.
    if (node && SEQUENCE_TYPES.has(node.type)) {
      const out: string[] = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const item = node.namedChild(i)
        if (!item) continue
        // A SEQUENCE ITEM IS ITS OWN NODE TYPE in this grammar (`block_sequence_item`), and it is
        // NOT in `WRAPPER_TYPES` — so `scalarNode` returns it unchanged and a scalar item looked
        // like a nested node. The control caught it: `include: [real.yml]` emitted nothing while
        // `include: [{architecture: x64}]` correctly emitted nothing, i.e. the two cases were
        // indistinguishable. Unwrap one level, which is what the walker itself does
        // (`visit`: `firstNamedChild(curr)` for a sequence item).
        const unwrapped = item.type === "block_sequence_item" ? this.firstNonDecorationChild(item) : item
        const scalar = unwrapped ? this.scalarNode(unwrapped) : null
        if (!scalar || !SCALAR_TYPES.has(scalar.type)) continue
        const text = this.scalarText(scalar)
        if (text) out.push(text)
      }
      return out
    }
    // A scalar names one file.
    return this.scalarValues(valueNode)
  }

  private addImport(
    ctx: YamlContext,
    target: string,
    importType: string,
    node: Node | undefined,
    isExternal: boolean,
    lineOverride?: number,
  ): void {
    if (!target) return
    if (ctx.imports.some((i) => i.module === target && i.importType === importType)) return
    ctx.imports.push({
      module: target,
      path: target,
      importType,
      isExternal,
      isNamespace: false,
      // `lineOverride` exists because one emission site has no node to read a position
      // from — an action `uses:` is recorded in a pending list during the walk and
      // resolved afterwards — and it was passing `undefined`, so 329 of this lane's 540
      // corpus imports (every GitHub Actions `uses:`) reached the store with no line at
      // all. The row is otherwise complete, which is the worst shape for a data loss:
      // a count of imports looked perfectly healthy.
      line_number: lineOverride ?? (node ? node.startPosition.row + 1 : undefined),
      metadata: { yamlSpecific: true, evidenceClass: "import_based" },
    })
  }

  /**
   * M14 Matrix 1d: every edge states its epistemic status. Set centrally so an
   * emission site cannot forget it, and it runs after every relationship exists.
   */
  private classifyEvidenceTier(ctx: YamlContext): void {
    for (const r of ctx.relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "imports") { md.evidenceClass = "import_based"; continue }
      if (t === "references") {
        if (md.relationshipType === "declared_type" || md.relationshipType === "yaml_json_pointer") {
          md.evidenceClass = "reference_qualified"
          continue
        }
        md.evidenceClass = md.resolved === false ? "inferred" : "usage_contextual"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        const conf = typeof r.confidence === "number" ? r.confidence : 1
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") { md.evidenceClass = "structural"; continue }
      if (t === "calls") { md.evidenceClass = md.relationshipType === "yaml_workflow_call" ? "structural" : "inferred"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  private addPattern(ctx: YamlContext, pattern: string): void {
    const patterns = ctx.metadata.patterns as string[]
    if (!patterns.includes(pattern)) patterns.push(pattern)
  }

  // ------------------------------------------------------------ value typing

  /**
   * The resolved shape of a value, over a CLOSED vocabulary. A node the analyzer does
   * not classify is `untyped` — YAML's own name for a plain scalar with no tag — and
   * never a placeholder string. The previous implementation returned the literal
   * `"unknown"`, which the M60 R7 sentinel census records as a violation.
   */
  private valueType(node: Node | null): string {
    if (!node) return "null"
    if (MAPPING_TYPES.has(node.type)) return "object"
    if (SEQUENCE_TYPES.has(node.type)) return "array"
    if (node.type === "alias") return "alias"
    if (node.type === "anchor") return "anchor"
    if (SEQUENCE_ITEM_TYPES.has(node.type)) {
      const first = this.firstNamedChild(node)
      return first ? this.valueType(first) : "untyped"
    }
    if (WRAPPER_TYPES.has(node.type)) {
      // A wrapper commonly holds an anchor or a tag before the real value. Prefer
      // structural children so `key: &a\n  x: y` is an object, then the tag, then
      // anything else.
      for (let i = 0; i < node.namedChildCount; i++) {
        const nested = this.valueType(node.namedChild(i))
        if (nested === "object" || nested === "array") return nested
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child || child.type === "tag" || child.type === "anchor") continue
        const nested = this.valueType(child)
        if (nested !== "untyped") return nested
      }
      return "untyped"
    }
    switch (node.type) {
      case "integer_scalar": return "integer"
      case "float_scalar": return "float"
      case "boolean_scalar": return "boolean"
      case "null_scalar": return "null"
      // The core schema resolves a plain scalar by which typed child it carries.
      case "timestamp_scalar": return "timestamp"
      case "plain_scalar":
        for (let i = 0; i < node.namedChildCount; i++) {
          const nested = this.valueType(node.namedChild(i))
          if (nested !== "untyped") return nested
        }
        return "untyped"
      case "string_scalar":
      case "single_quote_scalar":
      case "double_quote_scalar":
      case "block_scalar":
      case "string": return "string"
      default:
        for (let i = 0; i < node.namedChildCount; i++) {
          const nested = this.valueType(node.namedChild(i))
          if (nested !== "untyped") return nested
        }
        return RESOLVED_VALUE_VOCABULARY.has(node.type) ? node.type : "untyped"
    }
  }

  /**
   * A tag on a value, parsed into what a consumer needs: the short name (what a
   * `declared_type` edge targets), the resolved URI (what a `%TAG` handle expands to),
   * the type the tag forces, and the file an include-family tag names. The tag node
   * carries its own text and range, so nothing here scans the value.
   */
  private tagOf(node: Node | null, ctx: YamlContext): TagInfo | null {
    if (!node) return null
    let tagNode: Node | null = null
    if (node.type === "tag") tagNode = node
    else {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child?.type === "tag") { tagNode = child; break }
      }
    }
    if (!tagNode) return null
    const parsed = this.parseTag(tagNode.text, ctx)
    if (!parsed) return null
    const shortName = parsed.shortName
    let includePath: string | undefined
    let includeQuoted = false
    if (INCLUDE_TAGS.has(shortName)) {
      const sibling = this.firstNonDecorationChild(node)
      if (sibling) {
        const text = this.scalarText(sibling)
        // A QUOTED scalar is a literal string, and a literal string may hold a space. The
        // whitespace refusal exists for the UNQUOTED free-form convention ansible uses
        // (`include_tasks: file=x.yml`), where the value is an argument list rather than a path;
        // quoting is the source's own evidence that it is not one. MEASURED on hasura-engine's
        // metadata testdata: `tables: !include "s 3/tables/tables.yaml"` names
        // `metadata/databases/s 3/tables/tables.yaml`, which the repository HAS, and the space rule
        // turned all six of the s 3/s 4/s 5 sites into a `declared_type` edge at a tag that names
        // no type at all. `isLiteralPathSpelling` keeps its refusal of `key=`, templates, globs and
        // URI schemes, so a quoted free-form string is still refused at the claim layer.
        if (looksLikePath(text, QUOTED_SCALAR_TYPES.has(sibling.type))) {
          includePath = text
          includeQuoted = QUOTED_SCALAR_TYPES.has(sibling.type)
        }
      }
    }
    return { shortName, uri: parsed.uri, typeOverride: TAG_TYPE_OVERRIDES[shortName], includePath, includeQuoted, line: tagNode.startPosition.row + 1 }
  }

  /**
   * THE TYPE NAME A TAG DECLARES, or undefined when the tag declares no type at all.
   *
   * An include-family tag names a FILE — `functions: !include "s1/functions/functions.yaml"` is an
   * import and nothing else. Reading its short name as the name of a TYPE (which is what a
   * `declared_type` edge says) was a category error the arbiter could see: the edges targeted the
   * literal string `include`, which collides with ordinary keys spelled `include`, so ten of them
   * were reported AMBIGUOUS against three unrelated declarations. The `includePath` marker is the
   * same fact, but it is only set when the value was readable as a path, and a tag whose path the
   * lane refuses still does not name a type — so the test is the tag's own membership in the closed
   * include set, not the presence of a readable path.
   *
   * One definition, read at every `declared_type` site, so a new site cannot reintroduce the error.
   */
  private tagTypeName(tag: TagInfo | null): string | undefined {
    if (!tag || INCLUDE_TAGS.has(tag.shortName)) return undefined
    return tag.shortName
  }

  /**
   * Tag text to (short name, URI), by index arithmetic alone. Four shapes:
   *   `!<tag:example.com,2000:str>`  verbatim -> uri is the body, short is after the last ':'
   *   `!!str`                        local    -> tag:yaml.org,2002:str, short `str`
   *   `!e!thing`                     named    -> handle `!e!` expands through the %TAG map
   *   `!Foo`                         custom   -> uri is the name itself
   */
  private parseTag(text: string, ctx: YamlContext): { shortName: string; uri: string } | null {
    if (text.length < 2 || text[0] !== "!") return null
    if (text.startsWith("!<") && text.endsWith(">")) {
      const uri = text.slice(2, -1)
      const colon = uri.lastIndexOf(":")
      return { uri, shortName: colon >= 0 ? uri.slice(colon + 1) : uri }
    }
    const body = text.slice(1)
    const bang = body.indexOf("!")
    if (bang >= 0) {
      const handle = `!${body.slice(0, bang + 1)}`
      const suffix = body.slice(bang + 1)
      // `!!x` is the local tag family and resolves into the core schema; any other
      // handle expands only if a %TAG directive declared it.
      const prefix = handle === "!!" ? YAML_CORE_PREFIX : ctx.tagHandles.get(handle)
      return { uri: prefix ? `${prefix}${suffix}` : `${handle}${suffix}`, shortName: suffix }
    }
    if (body.startsWith("!")) {
      const short = body.slice(1)
      return { uri: `${YAML_CORE_PREFIX}${short}`, shortName: short }
    }
    return { uri: body, shortName: body }
  }

  // ------------------------------------------------------------- node access

  private mappingKeyNode(node: Node): Node | null {
    const field = node.childForFieldName("key")
    if (field) return this.scalarNode(field)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && this.isScalarLike(child)) return this.scalarNode(child)
    }
    return null
  }

  private mappingValueNode(node: Node): Node | null {
    const field = node.childForFieldName("value")
    if (field) return field
    if (node.namedChildCount > 1) return node.namedChild(node.namedChildCount - 1)
    return null
  }

  private scalarNode(node: Node): Node {
    let current = node
    while (WRAPPER_TYPES.has(current.type) && current.namedChildCount > 0) {
      const next = this.firstNonDecorationChild(current)
      if (!next) break
      current = next
    }
    return current
  }

  private firstNonDecorationChild(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type !== "tag" && child.type !== "anchor" && child.type !== "anchor_name") return child
    }
    return null
  }

  private scalarText(node: Node): string {
    const value = this.scalarNode(node).text.trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === "\"" || first === "'") && first === last) return value.slice(1, -1)
    }
    return value
  }

  /**
   * The names a reference WRAPPER holds: the scalar shorthand (`configMapRef: cm`) or
   * the `name` field of its payload. Never a walk — see `RESOURCE_REF_SOURCES` for the
   * shape this deliberately does not serve.
   */
  private wrapperRefNames(node: Node | null): string[] {
    if (!node) return []
    const direct = this.scalarNode(node)
    if (direct && SCALAR_TYPES.has(direct.type)) {
      const text = this.scalarText(direct)
      return text ? [text] : []
    }
    const named = this.mappingEntryScalar(node, "name")
    return named ? [named] : []
  }

  /**
   * The scalar VALUE of one named entry of a mapping payload, or null when the node is
   * not a mapping, the entry is absent, or its value is itself a mapping or sequence.
   * Keys are read through the grammar's own `key` field, so a quoted key
   * (`"name": cm`) and a plain one match identically.
   */
  private mappingEntryScalar(node: Node | null, keyName: string): string | null {
    if (!node) return null
    let mapping: Node | null = this.scalarNode(node)
    if (!MAPPING_TYPES.has(mapping.type)) {
      mapping = this.firstNonDecorationChild(node)
      if (!mapping || !MAPPING_TYPES.has(mapping.type)) return null
    }
    for (let i = 0; i < mapping.namedChildCount; i++) {
      const pair = mapping.namedChild(i)
      if (!pair || !MAPPING_PAIR_TYPES.has(pair.type)) continue
      const keyNode = pair.childForFieldName("key") || this.firstNonDecorationChild(pair)
      if (!keyNode || this.scalarText(keyNode) !== keyName) continue
      const value = this.mappingValueNode(pair)
      if (!value) return null
      const scalar = this.scalarNode(value)
      if (!SCALAR_TYPES.has(scalar.type)) return null
      const text = this.scalarText(scalar)
      return text || null
    }
    return null
  }

  /**
   * Every scalar VALUE under a node, in order — used for the lists `depends_on` and
   * the `*Ref` objects hold. Mapping KEYS are skipped via the grammar's own `key`
   * field, because `configMapRef: { name: cm }` must yield `cm` and not `name`: a
   * descendant walk without that skip returns both, and the first one emitted is the
   * key.
   */
  private scalarValues(node: Node | null): string[] {
    if (!node) return []
    const out: string[] = []
    const collect = (n: Node, isKey: boolean): void => {
      if (n.type === "tag") return
      if (MAPPING_PAIR_TYPES.has(n.type)) {
        const value = n.childForFieldName("value") || this.mappingValueNode(n)
        if (value) collect(this.scalarNode(value), false)
        return
      }
      if (SCALAR_TYPES.has(n.type)) {
        if (isKey) return
        const text = this.scalarText(n)
        if (text) out.push(text)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collect(child, false)
      }
    }
    collect(this.scalarNode(node), false)
    return out
  }

  /** A top-level scalar of a document, by dotted key path (`kind`, `metadata.name`). */
  private topLevelScalar(document: Node, keyPath: string): string | null {
    const parts = keyPath.split(".")
    let mapping: Node | null = null
    for (let i = 0; i < document.namedChildCount; i++) {
      const child = document.namedChild(i)
      if (!child) continue
      if (MAPPING_TYPES.has(child.type)) { mapping = child; break }
      if (child.type === "block_node") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const inner = child.namedChild(j)
          if (inner && MAPPING_TYPES.has(inner.type)) { mapping = inner; break }
        }
        if (mapping) break
      }
    }
    if (!mapping) return null
    return this.scalarAtPath(mapping, parts)
  }

  private topLevelScalarFromMapping(document: Node, outer: string, inner: string): string | null {
    return this.topLevelScalar(document, `${outer}.${inner}`)
  }

  private scalarAtPath(mapping: Node, parts: string[]): string | null {
    let current: Node = mapping
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isLast = i === parts.length - 1
      let next: Node | null = null
      for (let j = 0; j < current.namedChildCount; j++) {
        const child = current.namedChild(j)
        if (!child || !MAPPING_PAIR_TYPES.has(child.type)) continue
        const keyNode = this.mappingKeyNode(child)
        if (!keyNode || this.scalarText(keyNode) !== part) continue
        next = this.mappingValueNode(child)
        break
      }
      if (!next) return null
      // Descend through the wrapper the value carries, so a two-segment path like
      // `metadata.name` reads the mapping inside `block_node(block_mapping(...))`
      // instead of stopping at the wrapper and returning its text.
      current = WRAPPER_TYPES.has(next.type) ? this.scalarNode(next) : next
      if (isLast) {
        if (MAPPING_TYPES.has(current.type) || SEQUENCE_TYPES.has(current.type)) return null
        const text = this.scalarText(current)
        return text || null
      }
      if (!MAPPING_TYPES.has(current.type)) return null
    }
    return null
  }

  private isScalarLike(node: Node): boolean {
    return SCALAR_TYPES.has(node.type) || WRAPPER_TYPES.has(node.type)
  }

  private isJsonPointer(value: string): boolean {
    return value.length > 2 && value.startsWith("#/") && !value.includes(" ")
  }

  private firstNamedChild(node: Node): Node | null {
    return node.namedChildCount > 0 ? node.namedChild(0) : null
  }

  private findNamedChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return null
  }

  private pushChildren(stack: { node: Node; context: VisitContext }[], node: Node, context: VisitContext): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push({ node: child, context: { ...context, depth: context.depth + 1 } })
    }
  }

  private pushMappingChildren(stack: { node: Node; context: VisitContext }[], node: Node, context: VisitContext, ctx: YamlContext): void {
    // A mapping's named children are its pairs, EXCEPT for a keyless value carrying
    // a tag — `!include other.yml` sitting beside `name: build` inside a sequence
    // item's mapping is a real construct (an Ansible import) and dropping it because
    // it is not a pair would make the import invisible. Keyless children are visited
    // so their tag can be read; they never become symbols.
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (!child) continue
      if (MAPPING_PAIR_TYPES.has(child.type)) {
        stack.push({ node: child, context: { ...context, depth: context.depth + 1 } })
        continue
      }
      if (child.type === "comment") continue
      if (this.tagIn(child, ctx)) {
        const tag = this.tagOf(child, ctx)!
        const owner = context.parent?.qualifiedName || context.parent?.id || context.document
        this.emitTagSemantics(owner, tag, child, child.startPosition.row + 1, ctx)
        // A tag also forces the value's resolved type, so the owner's own type is
        // corrected here rather than only at the key that introduced it.
        if (tag.typeOverride && context.parent && context.parent.metadata) {
          context.parent.metadata = {
            ...context.parent.metadata,
            declaredType: this.tagTypeName(tag),
            tagUri: tag.uri,
            tagLine: tag.line,
          }
        }
      }
    }
  }

  /** Whether a node carries a tag, looking through one level of wrapper. */
  private tagIn(node: Node, ctx: YamlContext): boolean {
    void ctx
    if (node.type === "tag") return true
    if (!WRAPPER_TYPES.has(node.type)) return false
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i)?.type === "tag") return true
    }
    return false
  }

  /**
   * A duplicate mapping key is invalid YAML that tree-sitter recovers. Two symbols
   * sharing one id makes every relationship endpoint ambiguous, because the graph
   * resolves endpoints by qualified name while the store's own primary key includes
   * the start line. Later occurrences are therefore disambiguated and the collision
   * is recorded rather than tolerated.
   */
  private uniquePath(parentPath: string, document: string, key: string, isDuplicate: boolean, ctx: YamlContext): string {
    const base = parentPath ? `${parentPath}.${key}` : key
    if (!isDuplicate) return base
    const counterKey = `${document}\u0000${base}`
    const n = (ctx.duplicateCounters.get(counterKey) ?? 0) + 1
    ctx.duplicateCounters.set(counterKey, n)
    return `${base}#${n + 1}`
  }

  private escapePointer(segment: string): string {
    return segment.split("~").join("~0").split("/").join("~1")
  }

  /**
   * A symbol's own review cost: how many keys or items it directly holds. O(children)
   * once per symbol, therefore O(n) across the file. The previous file-level
   * `configurationComplexity = visitedNodes` said nothing about any individual node,
   * and no symbol carried a complexity at all.
   */
  private nodeComplexity(valueNode: Node | null, valueType: string): number {
    if (!valueNode) return 1
    // Unwrap first: `key:\n  a: 1` gives a `block_node` holding the `block_mapping`,
    // so counting pairs on the wrapper counts one child and every multi-key object
    // scores 1.
    const node = this.scalarNode(valueNode)
    if (valueType === "object") {
      let count = 0
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && MAPPING_PAIR_TYPES.has(child.type)) count++
      }
      return Math.max(1, count)
    }
    if (valueType === "array") {
      let count = 0
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && (SEQUENCE_ITEM_TYPES.has(child.type) || child.type === "flow_node")) count++
      }
      return Math.max(1, count)
    }
    return 1
  }

  /**
   * A document's PROJECT-RELATIVE directory chain, dot-joined, or "" when it cannot be known.
   *
   * Dot-joined rather than slash-joined on purpose: everything downstream treats a dotted
   * string as a path (`Schema.X.properties`, `spec.containers[0]`), so a slash here would
   * introduce a second, undeclared convention into the same key space.
   *
   * Empty when the root is unknown OR the file does not sit under it (a relative filePath
   * against an absolute root, which is how several callers run). Refusing to guess is the
   * point: a WRONG scope is worse than no scope, because the scope's whole job is to be the
   * part of the identity that cannot collide.
   */
  private static documentDirScope(filePath: string, projectRoot?: string): string {
    const rel = RealYamlAnalyzer.projectRelativePath(filePath, projectRoot)
    if (rel === null) return ""
    const cut = rel.lastIndexOf("/")
    if (cut < 0) return ""
    return rel.slice(0, cut).split("/").filter((s) => s.length > 0).join(".")
  }

  /**
   * A filesystem path in the POSIX convention this analyzer's key space uses: every `\` becomes
   * `/`, and TRAILING separators are dropped.
   *
   * WHY THIS IS A CHARACTER WALK AND NOT TWO `replace` CALLS. The two substitutions it replaces
   * were `replace(/\\/g, "/")` followed by `replace(/\/+$/, "")` — two regex literals on each of
   * two lines, i.e. four of the twelve regex usages the fleet's no-regex gate counted on this
   * lane. The rule is mechanically enforced on ANALYZER source, so the walk is the form that keeps
   * the gate's statement TRUE rather than waived. This is a predicate about a string the SOURCE
   * wrote, not a node type the grammar never emits — the distinction the fsharp lane's fix
   * (b3623467b) draws.
   *
   * THE ORDER IS LOAD-BEARING and is preserved exactly. Backslashes fold to `/` FIRST, so a path
   * ending in `\` is still stripped by the trailing-separator pass; stripping first would leave the
   * backslash and produce a key with a trailing `\` in it. Semantics are otherwise identical,
   * including the degenerate cases: `""` stays `""`, and a string of nothing but separators
   * (`"/"`, `"///"`) becomes `""` because the second pass removes every one of them.
   */
  private static toPosixPath(p: string): string {
    let out = ""
    for (let i = 0; i < p.length; i++) {
      const ch = p[i]
      out += ch === "\\" ? "/" : ch
    }
    let end = out.length
    while (end > 0 && out[end - 1] === "/") end--
    return out.slice(0, end)
  }

  /** The file's own path relative to its project root, POSIX-normalised, or null when unknown. */
  private static projectRelativePath(filePath: string, projectRoot?: string): string | null {
    if (!projectRoot) return null
    const root = RealYamlAnalyzer.toPosixPath(projectRoot)
    const file = RealYamlAnalyzer.toPosixPath(filePath)
    if (root.length === 0 || file === root || !file.startsWith(root + "/")) return null
    return file.slice(root.length + 1)
  }

  /** Collapse `.`, `..` and duplicate separators; null when the path escapes its root. */
  private static normalizePosix(p: string): string | null {
    const parts: string[] = []
    for (const seg of p.split("/")) {
      if (seg.length === 0 || seg === ".") continue
      if (seg === "..") {
        if (parts.length === 0) return null
        parts.pop()
        continue
      }
      parts.push(seg)
    }
    return parts.length > 0 ? parts.join("/") : null
  }

  /**
   * THE CANDIDATE SPELLINGS a tag include could name INSIDE this project.
   *
   * A `!include` path is resolved by the LOADER, and the corpus runs two live conventions — Hasura
   * resolves it against the including FILE's directory (`metadata/databases/databases.yaml`
   * includes `s1/functions/functions.yaml`, and that file exists beside it), while pyyaml-include's
   * test data resolves it against the REPO ROOT (`tests/data/0.yaml` includes
   * `tests/data/include.d/1.yaml`). Both were read off the corpus, not guessed, and an analyzer
   * cannot know which loader will read the file. So it states both candidate spellings and the
   * ARBITER decides: the gate's file claim verifies when any candidate is an admitted file of the
   * project (script/m14/incoming-rule.ts, `FILE_CLAIM_KEY`), and is REFUTED when none is.
   *
   * Null means "no claim can be made", and it is returned rather than an empty list so the caller
   * keeps the weaker `isExternal` marker it used before: a URL include, or a file whose project
   * root this run does not know (every fixture that passes no root), is exactly the case where the
   * candidate set would be a fabrication.
   *
   * AND A SPELLING THAT IS NOT A PATH AT ALL GETS NO CANDIDATE EITHER, which is the guard
   * `isLiteralPathSpelling` adds. Measured on the ansible population before it existed: a
   * templated include (`'{{ service_type }}_cleanup.yml'`, 6 sites) and an ansible free-form
   * `include_tasks: file=x.yml` (5 sites) both used to walk straight into a candidate set, and a
   * candidate containing `{{ }}` can never be an admitted file — so the arbiter would have
   * REFUTED the lane on 11 edges whose target was never a literal path. A claim has to be spelled
   * as the thing it claims before a lookup can say anything about it, which is also why the
   * gate's own `verifyRemoteRefClaim` refuses shapes it cannot read.
   */
  private relativePathCandidates(written: string, ctx: YamlContext, quoted = false): string[] | null {
    if (!RealYamlAnalyzer.isLiteralPathSpelling(written, quoted)) return null
    const rel = RealYamlAnalyzer.projectRelativePath(ctx.filePath, ctx.projectRoot)
    if (rel === null) return null
    const cut = rel.lastIndexOf("/")
    const dir = cut >= 0 ? rel.slice(0, cut) : ""
    const trimmed = written.startsWith("./") ? written.slice(2) : written
    const rooted = trimmed.startsWith("/")
    const out: string[] = []
    const add = (p: string): void => {
      const n = RealYamlAnalyzer.normalizePosix(p)
      if (n !== null && !out.includes(n)) out.push(n)
    }
    add(rooted ? trimmed.slice(1) : dir.length > 0 ? `${dir}/${trimmed}` : trimmed)
    if (!rooted) add(trimmed)
    // THE ROLE-RELATIVE CANDIDATE, and it is measured rather than defensive. Ansible resolves a
    // bare include inside a ROLE by searching the role's own subdirectories, so
    // `roles/x/handlers/main.yml` including `default-cleanup.yml` finds
    // `roles/x/tasks/default-cleanup.yml` — measured on 8 edges of the ansible population
    // (`default-cleanup.yml`, `windows-cleanup.yml`, `systemd_cleanup.yml`, `B.yml`,
    // `included_tasks.yml`, `tasks/handlers.yml` twice). Without this candidate each of those
    // was REFUTED by a file claim that was true, which would have made the claim fix trade 95
    // false refutations for 8 more.
    const base = rooted ? null : RealYamlAnalyzer.roleSubdirBase(rel)
    if (base !== null && base.length > 0) {
      add(`${base}/tasks/${trimmed}`)
      // AND THE ROLE-ROOT SPELLING, but ONLY when the target names the role subdirectory
      // itself. `handlers/main.yml` including `tasks/handlers.yml` means `<role>/tasks/
      // handlers.yml`; the `tasks/` prefix is the whole evidence for that reading, and without
      // it `roleRoot/<written>` would be a guess that could match an unrelated sibling file and
      // verify a claim for a reason that is not the include's. Guarded rather than added
      // unguarded, because a candidate set that is too wide makes "verified" mean less.
      if (ROLE_SUBDIR_NAMES.has(trimmed.split("/")[0])) add(`${base}/${trimmed}`)
    }
    return out.length > 0 ? out : null
  }

  /**
   * THE ROLE ROOT of the file that is including something, or null when it is not inside a role.
   *
   * A role is a directory carrying `tasks/`, `handlers/`, `vars/`, `defaults/`, `meta/` — so the
   * role root is the path BEFORE the LAST such segment. `roles/role1/handlers/main.yml` ->
   * `roles/role1`; `roles/role1/tasks/sub/x.yml` -> `roles/role1`, which is what makes the
   * fallback work for a nested task file too.
   */
  private static roleSubdirBase(rel: string): string | null {
    const segs = rel.split("/")
    segs.pop()
    for (let i = segs.length - 1; i >= 0; i--) {
      if (!ROLE_SUBDIR_NAMES.has(segs[i])) continue
      return segs.slice(0, i).join("/")
    }
    return null
  }

  /**
   * The claim a tag-include import carries. The file claim when the candidates are known (the
   * project's own file list can confirm it), and the older `isExternal` marker otherwise — never
   * both, because the rule routes the file claim first and an edge carrying both would be excused
   * by the weaker one (`incoming-rule.ts`'s control plants exactly that pairing).
   */
  private tagIncludeClaim(includePath: string, ctx: YamlContext, quoted = false): Record<string, unknown> {
    const candidates = this.relativePathCandidates(includePath, ctx, quoted)
    return candidates !== null && this.projectCarriesFile(ctx, candidates)
      ? { importProjectFile: candidates }
      : { isExternal: true }
  }

  /**
   * DOES THE PROJECT ACTUALLY CARRY ONE OF THESE CANDIDATES? A STAT, not a read.
   *
   * THE RULE, and it is now the same rule in json, toml and yaml: **a file claim is made only
   * where the analyzer has evidence for it.** `verifyFileClaim` returning `externalRefuted` on a
   * miss is pinned by the gate's own positive control (arms 4 and 5), and that is right — a file
   * claim is a checkable statement and the check is its whole purpose. What was wrong was WHICH
   * edges asserted it: 18 of them named paths this project does not have (a directory
   * materialised at run time by a checkout step, a CodeQL query directory holding no yaml, files
   * ansible's integration tests deliberately omit), and each one made a claim the analyzer had
   * no evidence for. They now carry `isExternal` instead, which on a path-shaped target is
   * `externalUnverified` — the honest outcome for a path the corpus does not contain — and the
   * gate's rule is not weakened by one arm.
   *
   * Mirrors `real-json-analyzer.ts`'s `projectCarriesFile` exactly, including its two
   * non-obvious decisions: this is a STAT and never a read (the lane's contract is that
   * decisions come from the tree, and asking the filesystem whether a path exists asserts
   * nothing about that file's contents), and an error that is NOT `ENOENT`/`ENOTDIR` counts as
   * PRESENT, because "I could not look" must not be recorded as "it is not there".
   */
  private projectCarriesFile(ctx: YamlContext, candidates: string[]): boolean {
    const root = ctx.projectRoot
    if (typeof root !== "string" || root.length === 0) return false
    for (const candidate of candidates) {
      try {
        if (statSync(join(root, candidate)).isFile()) return true
      } catch (e: any) {
        if (!(e?.code === "ENOENT" || e?.code === "ENOTDIR")) return true
      }
    }
    return false
  }

  /**
   * THE CLAIM A `$ref` CARRIES — and for a cross-FILE pointer, `isExternal: true` was FALSE.
   *
   * `$ref` is spelled two ways and the difference is not cosmetic: `#/x` names a pointer into
   * THIS document (nothing external about it), while `<file>#/x` names a pointer into ANOTHER
   * DOCUMENT. The emit site stated `isExternal: !pointer.startsWith("#/")`, so the second shape
   * claimed to be outside the declared population — and over the whole admitted population
   * (18,364 `.yaml`/`.yml`, 189 repos) that claim is false **1,356 times**, every one of them in
   * one repository's OpenAPI set:
   *
   *     references  "./Responses.OpenAPI.yaml#/400"                    681 edges (relative path)
   *     references  "Shared.Components.OpenAPI.yaml#/components/…"     675 edges (bare sibling)
   *
   * `Grace/src/OpenAPI/Responses.OpenAPI.yaml` is an ADMITTED FILE of that project, and the
   * arbiter said so: `pathLikeTarget` refuses to believe an "external" claim about a path, so all
   * 1,356 read `externalUnverified` — the outcome that blocks a PASS. They were 71% of this lane's
   * entire unverifiable population (`externalUnverified` 1,903).
   *
   * So the claim is the one the project can CHECK: the file part of the pointer, run through the
   * same candidate builder and the same `statSync` evidence rule the `!include` sites use. The
   * fragment is dropped — it addresses a position INSIDE the file, and a claim has to be spelled
   * as the thing it claims before a lookup can say anything about it (the same reason
   * `isLiteralPathSpelling` refuses a template). A pointer whose file this project does not carry
   * (a URL, a runtime-materialised path, a `../` past the root, or a file that is genuinely
   * absent) keeps the weaker `isExternal` marker, which on a path-shaped target is
   * `externalUnverified` — the honest outcome, and the direction this fix cannot reverse.
   *
   * NOT CLAIMED: that the pointer RESOLVES. The target document is not indexed by this analyzer,
   * so the edge still reports `unresolvedReason: "external-file"` (see
   * `resolvePointerReferences`); what changed is that the file dependency it names is now a
   * statement the project confirms instead of a false statement that it is outside the population.
   */
  private pointerClaim(pointer: string, ctx: YamlContext): Record<string, unknown> {
    if (pointer.startsWith("#/")) return { isExternal: false }
    const hash = pointer.indexOf("#")
    const file = hash >= 0 ? pointer.slice(0, hash) : pointer
    if (file.length === 0) return { isExternal: false }
    const candidates = this.relativePathCandidates(file, ctx)
    return candidates !== null && this.projectCarriesFile(ctx, candidates)
      ? { importProjectFile: candidates }
      : { isExternal: true }
  }

  /**
   * THE CLAIM A REUSABLE-WORKFLOW CALL CARRIES — a FILE, not an action DIRECTORY.
   *
   * `jobs.<id>.uses: ./.github/workflows/build.yml` calls a workflow declared in another FILE of
   * this repository, and it was routed through `actionUseClaim`, which for a `./` target resolves
   * the ACTION's manifest (`action.yml`/`action.yaml`) inside it. That rule is right for
   * `steps[].uses: ./dir` and wrong here in the one way that matters: the target IS the file, so
   * the manifest lookup asks for `./.github/workflows/build.yml/action.yml`, finds nothing, and
   * the edge falls back to `isExternal: true` — a false statement about a file the project has.
   * MEASURED over the whole admitted population: **208** `calls` edges, this lane's entire `calls`
   * unverifiable population, every one of them an admitted `.yml`:
   *
   *     "./.github/workflows/reusable-get-go-version.yml"   11 edges (consul)
   *     "./.github/workflows/build.yml"                     10 (consul, cython, …)
   *     "./.github/workflows/ci-job.yml"                    10 (cython)
   *
   * The file claim is the statement the project can check, and the candidates are built the same
   * way every other file claim in this lane is (`relativePathCandidates` + `projectCarriesFile`).
   * A remote call keeps the reference claim, and a local one the project does not carry keeps
   * `isExternal` — the same two directions as `pointerClaim` above.
   */
  private workflowCallClaim(action: string, ctx: YamlContext): Record<string, unknown> {
    if (!action.startsWith("./") && !action.startsWith("../")) return this.actionUseClaim(action, ctx)
    const candidates = this.relativePathCandidates(action, ctx)
    // NO ROOT MEANS NO CANDIDATE SET, and a candidate set without a root would be a fabrication.
    // The pre-existing marker is kept through `actionUseClaim` itself rather than restated here,
    // so this fix can only change an edge where EVIDENCE exists — a fixture run (every fixture
    // passes no project root) sees the old marker, and the gate, which always passes one, sees
    // the file claim. Pinned by `yaml/workflow-call-role`'s `isExternal: false`.
    if (candidates === null) return this.actionUseClaim(action, ctx)
    return this.projectCarriesFile(ctx, candidates)
      ? { importProjectFile: candidates }
      : { isExternal: true }
  }

  /**
   * IS THIS KEY, AT THIS POSITION, A DEPENDENCY? A KEY NAME IS NOT A POSITION.
   *
   * `DEPENDS_ON_KEYS` fires on `depends_on|dependsOn|needs|requires` at ANY depth, and the corpus
   * contains the counter-example the sibling `uses:` site already guards against with
   * `isJobLevelPath`: GitHub Actions admits an action INPUT named `needs`,
   *
   *     - uses: r-lib/actions/setup-r-dependencies@v2
   *       with:
   *         needs: check          <- an input, NOT a job dependency
   *
   * so the analyzer emitted a `yaml_depends_on` reference for a key that names no dependency.
   * MEASURED over the whole admitted population — every `yaml_depends_on` edge grouped by the
   * position it was emitted from (1,938 edges, 413 candidate files, `yaml-depends-position`):
   *
   *     jobs.<id>.needs            1,655   TRUE  (a job dependency)
   *     services.<svc>.depends_on     74   mixed — see `dependencyTargets`
   *     steps[].with.needs            48   FALSE (an action input: check 14, website 12, …)
   *     Azure stages[].dependsOn      22   TRUE
   *     CircleCI jobs[].requires      38   TRUE
   *
   * So `needs` is gated to `jobs.<id>` and nothing else is: `depends_on`/`dependsOn`/`requires` are
   * the spellings of OTHER loaders (Compose, Azure Pipelines, CircleCI) whose containers this
   * analyzer has no shape index for, and every measured position for them is a true dependency.
   * The gate is the same predicate the `uses:` site uses, so one notion of "job level" governs both.
   *
   * The 46 of the 48 that read `externalVerified` are why this is a FIX and not a ruling: a false
   * edge that RESOLVES is worse than one that does not, and these were sitting in the VERIFIED
   * column as claims about `check`, `website`, `pr-document` and `coverage`.
   */
  /**
   * Is this an `include:` that selects a SET rather than naming a file? See
   * `INCLUDE_SELECTOR_PARENT_KEYS` for the measurement behind each parent.
   *
   * For `branches` the document's own top-level claim (`trigger:`/`pr:`) is required as well, and it
   * is read from the shape index rather than from the text: the ancestor is always visited before
   * its descendant, so the shape is already indexed when the `include` key is read — no second pass,
   * no text scan.
   */
  private isIncludeSelectorKey(key: string, current: VisitContext, ctx: YamlContext): boolean {
    if (key !== "include") return false
    const parentPath = current.parentPath ?? ""
    const document = current.document
    // The DOCUMENT segment is not a container: a file named `paths.yaml` has document identity
    // `paths`, and counting it would make every top-level `include:` in that file invisible.
    let rest = parentPath
    if (rest === document) rest = ""
    else if (rest.startsWith(`${document}.`)) rest = rest.slice(document.length + 1)
    if (rest.length === 0) return false
    let selector = false
    let branches = false
    for (const seg of rest.split(".")) {
      if (!INCLUDE_SELECTOR_SEGMENTS.has(seg)) continue
      selector = true
      if (seg === "branches") branches = true
    }
    if (!selector) return false
    // `branches` ALONE also requires the document's own pipeline claim, because `branches` is an
    // ordinary word that a non-pipeline document may use; the other members are containers of
    // selectors in every format that spells them and carry no such ambiguity.
    if (!branches) return true
    const shapes = ctx.documentShapes.get(document)
    return shapes ? shapes.has("trigger") || shapes.has("pr") : false
  }

  private isDependencyPosition(key: string, current: VisitContext): boolean {
    if (key === "needs") return isJobLevelPath(current.parentPath, current.document)
    return true
  }

  /**
   * WHICH NAMES A DEPENDENCY KEY NAMES, decided by the VALUE'S SHAPE.
   *
   * Compose's `depends_on` has two spellings, and they put the dependency name in different places:
   *
   *     depends_on: [db, cache]                  the names are the SEQUENCE ITEMS
   *     depends_on:                              the names are the MAPPING KEYS
   *       db:
   *         condition: service_healthy           <- CONFIGURATION, not a name
   *
   * `scalarValues` walks a mapping's VALUES (it is built for payloads), so on the second form it
   * returned the dependency's own settings — `service_healthy`, `service_started`,
   * `service_completed_successfully` — and DROPPED the dependency. MEASURED over the whole admitted
   * population: **31** such edges, all in `depends_on`, every one of them a false dependency on a
   * condition string (22 `service_healthy`, 7 `service_started`, 2
   * `service_completed_successfully`). The long form's keys are real services, so the fix ADDS the
   * true edges while removing the false ones — and the delta is reported in BOTH directions.
   *
   * A sequence, a scalar, or a mapping with no pair keys falls through to `scalarValues` unchanged,
   * so every shape that worked before still works.
   */
  private dependencyTargets(valueNode: Node | null): string[] {
    if (!valueNode) return []
    const node = this.scalarNode(valueNode)
    const pairs: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && MAPPING_PAIR_TYPES.has(child.type)) pairs.push(child)
    }
    if (pairs.length > 0) {
      const names: string[] = []
      for (const pair of pairs) {
        const keyNode = pair.childForFieldName("key") || this.firstNonDecorationChild(pair)
        const text = keyNode ? this.scalarText(keyNode) : ""
        if (text) names.push(text)
      }
      if (names.length > 0) return names
    }
    return this.scalarValues(valueNode)
  }

  /**
   * THE MANIFEST A LOCAL ACTION DIRECTORY IS FOR, confirmed to exist.
   *
   * `uses: ./dir` names a DIRECTORY, and the gate admits a directory claim by PREFIX over its
   * admitted files — which can only ever be right for this lane when the directory holds a yaml
   * file. Claiming the directory itself was measured wrong twice over: HashiCorp's
   * `./security-scanner` and nimony's `./ci-actions/.github/actions/setup` are checked out AT RUN
   * TIME and are not in the repository at all (7 + 2 edges), and gh-cli's CodeQL query directory
   * exists but holds `.ql`/`.md` only (1 edge) — all of them REFUTED claims about directories the
   * project cannot be asked about. The dependency a `uses: ./dir` really has is the action's
   * DEFINITION FILE, which is `action.yml`/`action.yaml` by GitHub's own rule, so that is the
   * candidate now — the same shape toml-lane landed on (claim the manifest FILE, not the
   * directory). Null when no candidate carries one, and the caller then states `isExternal`.
   */
  private localActionManifest(ctx: YamlContext, candidates: string[]): string[] | null {
    const root = ctx.projectRoot
    if (typeof root !== "string" || root.length === 0) return null
    for (const dir of candidates) {
      for (const manifest of ["action.yml", "action.yaml"]) {
        const candidate = `${dir}/${manifest}`
        try {
          if (statSync(join(root, candidate)).isFile()) return [candidate]
        } catch (e: any) {
          if (!(e?.code === "ENOENT" || e?.code === "ENOTDIR")) return [candidate]
        }
      }
    }
    return null
  }

  /**
   * IS THIS SPELLING A LITERAL PATH, before anything is claimed about where it points?
   *
   * The arbiter checks a file claim by looking the candidate up in the project's ADMITTED file
   * list. That lookup can only be evidence about a string that is a path: run it on a Jinja
   * template and the miss is a fact about the template, not about the project.
   *
   *   `https://x/y.yaml`          a URL, refused by `://`      (already refused before this guard)
   *   `{{ item }}`                a template — the `{`, `}`, `$` set covers `{{ }}` and `${ }`
   *   `name=a`                    ansible's free-form `key=value`, which is a parameter list
   *   `file=x.yml`                the same, and MEASURED: 5 sites in the ansible population
   *   `'{{ svc }}_cleanup.yml'`   the same, and MEASURED: 6 sites
   *   `package:lints/core.yaml`   A URI SCHEME, not a path. MEASURED over the whole corpus:
   *                               **85 refuted edges** — `package:lints/recommended.yaml` 56,
   *                               `package:dart_flutter_team_lints/analysis_options.yaml` 18,
   *                               `package:lints/core.yaml` 5, `package:flutter_lints/flutter.yaml`
   *                               4, `package:foo/foo_package_options.yaml` 1 — every one an
   *                               `include:` in a Dart `analysis_options.yaml`, whose target is a
   *                               PUB package resolved by pub, never a path in this project.
   *   `.vsts-ci/windows/*.yml`    A GLOB. MEASURED: 1 refuted edge (powershell's azure-pipelines
   *                               path filter). A glob names a SET, so no single candidate can be
   *                               the thing it names.
   *
   * Everything else is admissible, including a bare `apt.yml` and a `subdir/x.yaml`.
   */
  private static isLiteralPathSpelling(written: string, quoted = false): boolean {
    if (written.length === 0) return false
    if (written.includes("://")) return false
    // A template, whitespace, or a GLOB: `{{ x }}`, `${x}`, ansible's `name=a b` free-form,
    // and `dir/*.yml`, which names a set rather than a file.
    //
    // THE WHITESPACE REFUSAL IS FOR THE UNQUOTED SPELLING ONLY. Quoting is the source's own
    // evidence that the value is one literal string, and hasura-engine's metadata testdata relies
    // on it (`tables: !include "s 3/tables/tables.yaml"` names
    // `metadata/databases/s 3/tables/tables.yaml`, which the repository HAS). The template, glob,
    // URI-scheme and `key=` refusals are unchanged and unquoted-by-construction, so a quoted
    // free-form string is still refused.
    if (/[{}$*?]/.test(written)) return false
    if (!quoted && /\s/.test(written)) return false
    // A URI SCHEME at the start (`package:`, `dart:`, `http:`) is not a path. Anchored, and the
    // colon must arrive before any separator, so `sub/dir:x.yml` is untouched.
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(written)) return false
    // A free-form `key=value` parameter list is not a path, whatever its tail looks like.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(written)) return false
    return true
  }

  /**
   * THE CLAIM A KEY-SPELLING INCLUDE CARRIES — and this is the fix for the 107 refuted external
   * claims the whole-population run found.
   *
   * `- import_tasks: apt.yml` names a FILE in this project. Until this helper existed the edge
   * carried `isExternal: true` and nothing else, so the arbiter asked its OWNER question —
   * `targetOwner("apt.yml")` is `apt` — and ansible publishes a module named `apt`, so the claim
   * "this is outside the corpus" was judged FALSE and the edge was counted against the lane. The
   * refutation was an artefact of asking an owner question about a path.
   *
   * MEASURED over the whole admitted ansible population (2,082 files, 891 include edges, the
   * key attributed from each edge's own `line_number`): 96 of the 107 refuted edges come from
   * `include_tasks`/`import_tasks` and name a file — 95 of them a file the project HAS. This
   * helper makes the claim the evidence can actually answer, and the arbiter verifies those 95
   * against the project's own file list instead of refuting them against a module's name.
   *
   * TWO REFUSALS, each measured rather than assumed:
   *
   *   1. A ROLE KEY gets no file claim (`ROLE_IMPORT_KEYS`). `tasks_from: canary2.yml` is
   *      relative to a role directory this analyzer does not resolve, so a claim that THIS
   *      file's directory holds it would be refuted — 10 edges measured.
   *   2. A TARGET THAT IS NOT SPELLED AS AN ADMITTED SPELLING gets no file claim. The arbiter's
   *      file list is the lane's admitted population, `.yaml`/`.yml` only, so a claim about any
   *      other suffix could never be confirmed and would be refuted by the claim rather than by
   *      the project. `isLiteralPathSpelling` also refuses templates and free-form spellings.
   *
   * When no candidate can be stated the edge keeps the weaker `isExternal` marker it had — the
   * pre-existing behaviour, unchanged, so this fix can only ADD verifiable claims, never remove
   * an edge or silently re-label one.
   */
  /**
   * THE ENTRY FILE A ROLE IMPORT RESOLVES TO — and the reason the lane can stop emitting a bare
   * role name, which is never a symbol.
   *
   * Ansible resolves `include_role`/`import_role` `name: X` against a SEARCH PATH: for each
   * directory from the importing file's own directory up to the project root, `roles/X`. The entry
   * file of the resolved role is its `tasks/main.yml`. The lane's `imports` relation is file to
   * file, so that file — not the role's NAME — is what an edge can point at, and pointing at it is
   * what makes the edge checkable: a bare `X` collides with every mapping key spelled `X` (measured:
   * `a` 29 declarations, `include_role` 123, `no_log` 42), so the arbiter had no disposition for it
   * other than AMBIGUOUS.
   *
   * RETURNS NULL UNLESS THE FILE IS ACTUALLY THERE, checked with the same `statSync` evidence rule
   * every other file claim in this lane uses. That ordering is the whole safety property: a role
   * whose entry file cannot be found keeps the pre-existing bare-name marker, so the change can
   * only ADD a verifiable claim and can never manufacture a refutation.
   *
   * The candidate is normalised segment by segment so that a role spelled with `..` cannot escape
   * the project (`include_role: name=../x` occurs in ansible), and a candidate that escapes returns
   * null rather than a path the arbiter's file list could never hold.
   */
  private roleEntryTarget(name: string, ctx: YamlContext): string | null {
    if (typeof name !== "string" || name.length === 0) return null
    const rel = RealYamlAnalyzer.projectRelativePath(ctx.filePath, ctx.projectRoot)
    if (rel === null) return null
    const parts = rel.split("/")
    parts.pop()
    for (let depth = parts.length; depth >= 0; depth--) {
      const base = parts.slice(0, depth).join("/")
      const raw = (base === "" ? "" : base + "/") + "roles/" + name + "/tasks/main.yml"
      const segs: string[] = []
      let escaped = false
      for (const seg of raw.split("/")) {
        if (seg === "" || seg === ".") continue
        if (seg === "..") {
          if (segs.length === 0) { escaped = true; break }
          segs.pop()
          continue
        }
        segs.push(seg)
      }
      if (escaped) continue
      const cand = segs.join("/")
      if (cand.length === 0) continue
      if (this.projectCarriesFile(ctx, [cand])) return cand
    }
    return null
  }

  private keywordIncludeClaim(written: string, ctx: YamlContext, key: string): Record<string, unknown> {
    if (ROLE_IMPORT_KEYS.has(key)) return { isExternal: true }
    if (!/\.ya?ml$/i.test(written)) return { isExternal: true }
    const candidates = this.relativePathCandidates(written, ctx)
    // EVIDENCE BEFORE CLAIM. `keywordIncludeClaim` used to state the file claim for every
    // admitted-looking spelling; where the project does not carry the file, that claim was
    // refuted by the arbiter — and for the 7 residual edges (ansible's negative include
    // fixtures, a collection playbook installed at run time, riverpod's missing
    // `packages/analysis_options.yaml`) the refutation was true but the CLAIM was unsupported:
    // the analyzer had no evidence the file was there. Confirmed candidates keep the claim (95
    // of ansible's 107 refuted edges were of exactly this kind and stay VERIFIED); the rest fall
    // back to `isExternal`.
    return candidates !== null && this.projectCarriesFile(ctx, candidates)
      ? { importProjectFile: candidates }
      : { isExternal: true }
  }

  /**
   * THE CLAIM A `uses:` TARGET CARRIES, decided by what the target actually names.
   *
   * Three shapes, measured over this corpus's workflow files rather than assumed: **7,265**
   * remote actions (`actions/checkout@v6`, `r-lib/actions/setup-r@v2`), **501** local ones
   * (`./ci-actions/.github/actions/setup` — a DIRECTORY), and **13** container images
   * (`docker://hashicorp/terraform:1.9`).
   *
   *   docker://…            a container image                -> the REFERENCE claim (spelling)
   *   ./… or ../…           a path in THIS project           -> the FILE claim (the project's list)
   *   anything else         a pinned remote action reference -> the REFERENCE claim (spelling)
   *
   * The alternative for the first and third is what the lane did until now — `isExternal: true` on
   * a target with no identifier-shaped owner — which the gate reads as UNVERIFIABLE, blocks a PASS
   * on, and can say nothing else about. The alternative for the second is worse: it was marked NOT
   * external and resolved to nothing, so a local action read as a broken edge. All three now carry
   * a claim the arbiter can check, and a claim it can refute.
   *
   * When no project root is known the local shape keeps `isExternal: false` — the pre-existing
   * behaviour — because a candidate set without a root would be a fabrication, and the file claim
   * with no evidence is exactly what the rule's control refuses.
   *
   * AND THE LOCAL SHAPE CLAIMS THE MANIFEST, NOT THE DIRECTORY, confirmed to exist. Measured over
   * the whole corpus: 11 residual refutations were local directories this project cannot be asked
   * about — two of them checked out at run time by an earlier step (`path: security-scanner`,
   * `path: ci-actions`), one holding `.ql`/`.md` and no yaml at all. A directory claim can only be
   * admitted by prefix over the admitted YAML population, so it was a claim with no possible
   * evidence. A `uses: ./dir` depends on the action's definition file (`action.yml`/`action.yaml`
   * by GitHub's rule), which is a statement the arbiter's file list can actually answer. Where
   * that manifest is absent the edge states `isExternal: true` — on a path-shaped target that is
   * `externalUnverified`, not a refutation.
   */
  private actionUseClaim(action: string, ctx: YamlContext): Record<string, unknown> {
    if (action.startsWith("docker://")) return { remoteRef: true }
    if (action.startsWith("./") || action.startsWith("../")) {
      const candidates = this.relativePathCandidates(action, ctx)
      if (candidates === null) return { isExternal: false }
      const manifest = this.localActionManifest(ctx, candidates)
      if (manifest !== null) return { importProjectFile: manifest }
      // A STEP MAY CALL A WORKFLOW **FILE**, not only an action DIRECTORY.
      //
      // GitHub Actions admits `steps[].uses: ./.github/workflows/x.yml`, and the target is a
      // reusable workflow (`on: workflow_call`) declared in a file of THIS project. The manifest
      // lookup above cannot see it — there is no `action.yml` inside a file — so the edge fell
      // through to `isExternal: true`, a false statement about a file the project has: the same
      // defect class Round 5 fixed for the 208 job-level calls, in a spelling that fix did not
      // cover. MEASURED over the whole admitted population, and named by the enumerator's own
      // CLAIMABLE EDGES section, this is 1 edge:
      //
      //     "./.github/workflows/test-failure-notification.yml"
      //       @ nomad/.github/workflows/test-scheduler-prop.yml:45
      //       the project carries it, and the file declares `on: workflow_call`
      //
      // The claim is the FILE, and it is gated by the same two rules every other file claim in this
      // lane uses: the spelling has to be an admitted spelling (`.yaml`/`.yml`, so the arbiter could
      // ever confirm it — `keywordIncludeClaim`'s rule) and `statSync` has to find the candidate.
      // A step-level `uses:` of a workflow file this project does NOT carry keeps `isExternal`,
      // which is the honest outcome and keeps this change from manufacturing a refutation.
      if (/\.ya?ml$/i.test(action) && this.projectCarriesFile(ctx, candidates)) {
        return { importProjectFile: candidates }
      }
      return { isExternal: true }
    }
    return { remoteRef: true }
  }

  /**
   * A document's IDENTITY, and it is scoped to the file.
   *
   * ## The defect this fixes
   *
   * The identity was the filesystem BASENAME, and a basename is not unique in a project.
   * Measured on a 60-file stride of the yaml corpus: `hostports0.yaml` occurs **156 times**
   * in one repository (Kubernetes' pod-security-admission testdata, once per API version
   * and once per pass directory) and `Chart.yaml` **243 times** across the helm charts.
   * Every member of every one of those documents was published under the same name —
   * `hostports0.spec.containers[0]` had 156 declarations — so the `contains` edge asserting
   * that containment could not be walked in either direction: the shared resolver resolves a
   * bare name only under `HAVING COUNT(*) = 1`, and an exact-key match has to be unique too.
   * The incoming gate read **78 ambiguous edges of 1,512** on that stride.
   *
   * ## The rule, and why it is the only sound one
   *
   * A file-scoped symbol's identity must contain the file. The basename is the ONE part of
   * the path that is not unique; the project-relative directory chain is the part that is,
   * and it is stable across machines in a way the absolute path is not. The BASENAME STAYS
   * THE LAST SEGMENT, which is what keeps the leaf of every member path (`...v1.37.fail` +
   * `hostports0` -> `hostports0`) unchanged for the store's leaf matching.
   *
   * ## Price, measured before the code was written
   *
   * `script/m14/incoming-gate.ts yaml yaml 60` with the identity scoped: **ambiguous 78 -> 0,
   * unresolved 0 -> 0, resolved 1,432 -> 1,510** (+78, i.e. every previously-ambiguous edge
   * now resolves and NO edge that resolved before stopped resolving). That last clause is the
   * one the fleet worklist asked to be checked rather than assumed: it is the evidence that
   * nothing in this corpus spells a document by its basename, so scoping the identity cannot
   * break an incoming reference.
   *
   * ## What it does NOT do
   *
   * It does not make the BASENAME key unique — `hostports0` is still published by 156 files,
   * because the basename is the readable name a human uses. It makes the QUALIFIED PATH
   * unique, and that path is what `contains` emits and what strategy 1 matches exactly.
   */
  private documentName(filePath: string, documentIndex: number, projectRoot?: string): string {
    const slash = filePath.lastIndexOf("/")
    const base = slash >= 0 ? filePath.slice(slash + 1) : filePath
    let stem = base
    const lower = base.toLowerCase()
    if (lower.endsWith(".yaml.template")) stem = base.slice(0, -13)
    else if (lower.endsWith(".yml.template")) stem = base.slice(0, -12)
    else if (lower.endsWith(".yaml")) stem = base.slice(0, -5)
    else if (lower.endsWith(".yml")) stem = base.slice(0, -4)
    stem = stem.trim() || "document"
    const scope = RealYamlAnalyzer.documentDirScope(filePath, projectRoot)
    const scoped = scope.length > 0 ? `${scope}.${stem}` : stem
    return documentIndex === 1 ? scoped : `${scoped}#${documentIndex}`
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
