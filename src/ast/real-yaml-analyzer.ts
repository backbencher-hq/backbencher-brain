import type { Node } from "web-tree-sitter"
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
  pendingReferences: { source: string; target: string; kind: string; line: number }[]
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
function looksLikePath(text: string): boolean {
  if (!text || text.includes(" ")) return false
  return text.includes(".") || text.includes("/")
}

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
  line: number
}

export class RealYamlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const ctx: YamlContext = {
      filePath,
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
    // place avoids duplicate warnings for the same ERROR/MISSING node.
    this.collectComments(rootNode, ctx)
    this.visit(rootNode, {
      parent: null,
      parentPath: "",
      pointerPath: "",
      document: this.documentName(filePath, 1),
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
    const documentName = this.documentName(ctx.filePath, ctx.documentCount + 1)
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
      const documentName = this.documentName(ctx.filePath, ctx.documentCount + 1)
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
        declaredType: tag?.shortName,
        tagUri: tag?.uri,
        tagLine: tag?.line,
        tagIncludePath: tag?.includePath,
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
          isExternal: !pointer.startsWith("#/"),
          pointer: pointer.startsWith("#/") ? pointer.slice(1) : pointer,
          referencedName: pointer,
        }, line)
      }
    }

    // Container composition: `depends_on` names a sibling service in the same file.
    if (DEPENDS_ON_KEYS.has(key)) {
      for (const name of this.scalarValues(valueNode)) {
        ctx.pendingReferences.push({ source: path, target: name, kind: "yaml_depends_on", line })
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
    if (FILE_IMPORT_KEYS.has(key)) {
      for (const name of this.scalarValues(valueNode)) {
        this.addImport(ctx, name, "yaml_keyword_include", keyNode, true)
        this.addRelationship(ctx, path, name, ASTEngine.RelationshipType.Imports, {
          relationshipType: "yaml_keyword_include",
          isExternal: true,
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
        isExternal: true,
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
          declaredType: tag?.shortName,
          tagUri: tag?.uri,
          tagLine: tag?.line,
          tagIncludePath: tag?.includePath,
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
        isExternal: true,
      }, tag.line)
    } else if (tag?.shortName) {
      this.addRelationship(ctx, current.parentPath, tag.shortName, ASTEngine.RelationshipType.References, {
        relationshipType: "declared_type",
        tagUri: tag.uri,
        isExternal: true,
      }, tag.line)
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
        isExternal: true,
      }, tag.line)
      return
    }
    if (tag.shortName) {
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
          isExternal: !local,
          resolved: false,
          unresolvedReason: local ? "workflow-in-same-repository-not-indexed" : "workflow-in-another-repository",
        }, use.line)
        continue
      }
      if (!isWorkflow) {
        this.addRelationship(ctx, use.source, use.action, ASTEngine.RelationshipType.References, {
          relationshipType: "yaml_action_use_unverified",
          isExternal: true,
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
        isExternal: !use.action.startsWith("./") && !use.action.startsWith("docker://"),
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
        r.metadata.resolved = false
        r.metadata.unresolvedReason = "pointer-not-declared-in-file"
        r.confidence = 0.9
        r.metadata.confidenceReason = "pointer-not-declared-in-file"
      }
    }
  }

  /**
   * Sibling references: a key that names another thing declared in the same file.
   * The target set is what the walk actually saw — document `metadata.name` values and
   * top-level `services` keys — so a resolution claimed here is a resolution that was
   * measured, and an unresolved one says so with a reason and a sub-1.0 confidence.
   */
  private resolveSiblingReferences(ctx: YamlContext): void {
    for (const ref of ctx.pendingReferences) {
      const resolved = this.resolveDeclaredName(ref.target, ctx)
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
    if (INCLUDE_TAGS.has(shortName)) {
      const sibling = this.firstNonDecorationChild(node)
      if (sibling) {
        const text = this.scalarText(sibling)
        if (looksLikePath(text)) includePath = text
      }
    }
    return { shortName, uri: parsed.uri, typeOverride: TAG_TYPE_OVERRIDES[shortName], includePath, line: tagNode.startPosition.row + 1 }
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
            declaredType: tag.shortName,
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

  private documentName(filePath: string, documentIndex: number): string {
    const slash = filePath.lastIndexOf("/")
    const base = slash >= 0 ? filePath.slice(slash + 1) : filePath
    let stem = base
    const lower = base.toLowerCase()
    if (lower.endsWith(".yaml.template")) stem = base.slice(0, -13)
    else if (lower.endsWith(".yml.template")) stem = base.slice(0, -12)
    else if (lower.endsWith(".yaml")) stem = base.slice(0, -5)
    else if (lower.endsWith(".yml")) stem = base.slice(0, -4)
    stem = stem.trim() || "document"
    return documentIndex === 1 ? stem : `${stem}#${documentIndex}`
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
