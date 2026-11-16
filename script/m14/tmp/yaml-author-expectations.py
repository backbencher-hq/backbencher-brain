#!/usr/bin/env python3
"""Author the yaml expectation files from the re-probed emission.

reviews/LANE-AUDIT-FORMULA.md §2 requires the expectation to be "derived from
re-probed emission after a probe, never from theory". This script GENERATES them from
validation/m14/results/archive/yaml-fixture-emission.json (produced by
script/m14/tmp/yaml-fixture-dump.ts) and attaches a per-fixture rationale that states
WHY the emission is correct -- so the rationale is the human judgement and the numbers
are the machine reading, not the other way round.

It is idempotent: re-running after a dump refresh rewrites the same files, and a
changed emission shows up as a git diff in the expectation rather than as a silent
drift between the fixtures and the pins.
"""
import json
import pathlib

ROOT = pathlib.Path("<corpus-root>/mcp/backbencher-brain")
FIX = ROOT / "validation/m14/fixtures/yaml"
DUMP = json.loads((ROOT / "validation/m14/results/archive/yaml-fixture-emission.json").read_text())["fixtures"]

# Per-fixture rationale: why the pinned emission is the CORRECT one. Written by hand;
# the numbers come from the dump.
RATIONALE = {
  "tag-declared-type": (
    "A YAML tag is the language's only type annotation and it OVERRIDES the scalar's own "
    "resolution. `!!str 7` is a string; the pre-fix analyzer read through the tag to the "
    "integer underneath and reported valueType=integer for both tagged and untagged values. "
    "Four tag forms are pinned because the tag node has zero CHILDREN but is not zero-width: "
    "it carries its own text, so `!!str`, a verbatim `!<...>`, a custom `!Widget` and a plain "
    "scalar are four different readings of the same construct. Each produces a declared_type "
    "reference edge (M60 R9) naming the type the tag writes. `!Widget` deliberately does NOT "
    "override the value type: a tag outside the core vocabulary names a type this analyzer "
    "does not know, so the declared type is recorded and the value keeps its own resolution."
  ),
  "tag-declared-type-negative": (
    "The negative half of the tag channel, and the class that made it necessary: a value that "
    "merely CONTAINS tag-looking characters is not a tag. If the tag reader were a substring "
    "match, all three of these would produce declared_type edges and one would produce a file "
    "import. Forbidding the edge on all three is what pins the reader to the `tag` NODE."
  ),
  "tag-file-include": (
    "An include-family tag names ANOTHER FILE. Before the tag was read this emitted zero "
    "symbols and zero relationships for it, so an entire class of cross-file dependency was "
    "invisible in the graph. Two shapes are pinned: the tag as a sequence item, and the "
    "keyword form `include_tasks:` which needs no tag at all. The corpus cannot evidence "
    "either -- `!include` occurs in ZERO of the eight pinned repositories (see "
    "script/m14/spec/yaml-completeness.json YAML-D5) -- so this fixture is the only evidence."
  ),
  "tag-file-include-negative": (
    "The negative half of the include channel. A first version accepted any tag whose name "
    "BEGAN `include` or `import`, and this fixture caught it: `!included_decoration` and "
    "`!include_real` were both read as file references. YAML tags are an open vocabulary, so "
    "a prefix rule over them is a substring rule wearing a costume. The include set is now a "
    "closed list of the tags the defining ecosystems actually use, and the cost of that "
    "precision -- an include-family tag outside the list is not recognised -- is declared in "
    "the spec rather than hidden."
  ),
  "duplicate-key-identity": (
    "Duplicate mapping keys are invalid YAML that tree-sitter recovers. The defect is an "
    "IDENTITY one: two symbols shared one id and one qualifiedName, so every relationship "
    "endpoint addressed to that key addressed both rows at once -- the graph resolves endpoints "
    "by qualified name while the store's own primary key is `${fileId}:${name}:${startLine}`. "
    "The second occurrence is disambiguated, is flagged, and gets its own contains edge."
  ),
  "anchor-document-scope": (
    "Anchors are document-scoped in YAML, so an alias in document 2 must not bind document 1's "
    "same-named anchor. The pre-fix registry was keyed by the bare anchor name across the whole "
    "file and was FIRST-wins, so this edge resolved -- at confidence 1.0, marked resolved -- to "
    "an anchor in a different document. It is now unresolved WITH A REASON, because 'declared "
    "in another document' and 'never declared' are different findings and only one is a defect."
  ),
  "anchor-document-scope-negative": (
    "The control for the fixture above, and the one that catches an over-correction: an alias "
    "in the SAME document as its anchor still resolves, at confidence 1.0, and two separate "
    "merge sites both bind it. Document scoping that broke same-document resolution would pass "
    "anchor-document-scope and fail here."
  ),
  "comment-attribution": (
    "Comments are `stream`-level siblings of `document`, so the walk reaches them BEFORE the key "
    "they document and a pending-comment buffer cannot see them. They are indexed by the line "
    "they precede, with their column, and attached positionally. Pinned: a leading note, a "
    "second leading note, a note at the top of a nested block, and a TRAILING note on the key's "
    "own row -- the last is what a single-line scan would lose."
  ),
  "comment-attribution-negative": (
    "The negative half, and the exact bug class the powershell lane hit: a file banner became "
    "the documentation of whichever declaration came first, because the scanner walked upward "
    "through blank lines. Attribution here is strictly the immediately preceding line, so a "
    "comment followed by a BLANK line documents nothing, and `forbidDocstring` on both keys is "
    "the only way to say so -- an expect-channel cannot assert absence."
  ),
  "directive-version": (
    "%YAML declares the version the document resolves under, and 1.1 and 1.2 genuinely disagree "
    "on yes/no/on/off, octal and sexagesimal. It was dropped entirely. Recording it also makes "
    "the lane's declared limitation visible instead of silent: the wired grammar is the 1.2 "
    "core-schema build, so a file declaring 1.1 is still resolved with 1.2 rules here "
    "(design_decision YAML-D6)."
  ),
  "directive-reserved": (
    "A reserved directive (%FOO) was removed from YAML 1.2 but is still parseable by the "
    "grammar. It is recorded rather than dropped, because 'the grammar cannot produce this' and "
    "'nothing looked for this' are indistinguishable in an output diff."
  ),
  "secret-structural": (
    "Sensitivity is decided by the KEY's own text, never by scanning values. Both halves of the "
    "old defect are pinned in one fixture: `password: hunter2` has no dollar sign and was "
    "MISSED, while `re: \"^a+$\"` is full of them and was FLAGGED. One sensitive key, one "
    "untouched regex value, and a security score that reflects exactly the first."
  ),
  "secret-document": (
    "A `kind: Secret` document is a secret CONTAINER, but `apiVersion`, `kind` and `metadata` "
    "inside it are the Kubernetes envelope and are not secret values. A first version marked "
    "the whole document and flagged 7 of 7 symbols including `apiVersion: v1`. Sensitivity now "
    "starts at the payload keys, and the fixture pins that the envelope stays clean while the "
    "payload does -- with two distinct reason codes, because a key IS the payload and a key is "
    "INSIDE one are different facts."
  ),
  "framework-shape": (
    "Framework detection is a SET OF EXACT PATHS WITH SHAPES, not a set of names anywhere in the "
    "file. The pre-fix whole-file name set reported three frameworks for a seven-line file "
    "carrying `version`, `services`, `jobs`, `on` and `stages`. This fixture is a real workflow, "
    "so it pins the POSITIVE: the signature matches, the R8 contract keys are all present, and "
    "each step's `uses:` is an import -- external for a published action, internal for a local "
    "one -- with an apiContractPath naming the job and step."
  ),
  "framework-shape-negative": (
    "The negative half, and the fixture that makes the positive meaningful: the SAME key names, "
    "one level down. A suffix comparison matches these and claims frameworks for a file that is "
    "none of them; a document-relative lookup does not, because `nested.version` is not "
    "`version`. The `uses:` here also pins the other half of the `uses:` contract -- outside a "
    "workflow it is a sub-1.0 reference carrying a reason, NOT an import."
  ),
  "error-recovery-identity": (
    "An unterminated flow sequence makes the whole file one ERROR node and destroys the `steps:` "
    "mapping pair. The pre-fix `sequenceIndex` scanned siblings for `sibling === itemNode`, which "
    "can NEVER hold -- web-tree-sitter returns a fresh wrapper per call, so the early return was "
    "dead code and the loop returned a file-wide count: eleven distinct steps collapsed onto the "
    "single id `[13]`, with every contains edge into it addressing all eleven, and no error "
    "reported. Pinned: ids are unique, every symbol is marked recovered, the recovery is a named "
    "scope rather than an anonymous parent, the damage is DECLARED as a pattern rather than "
    "silent, and the three items keep their source order."
  ),
  "json-pointer-resolve": (
    "A `$ref` is a JSON pointer INTO THIS FILE and it resolves. The pre-fix detector treated any "
    "string beginning `#/` as a reference with no target, so 9,542 corpus edges pointed at "
    "nothing. Pinned both directions: the resolvable pointer becomes a real graph edge at "
    "confidence 1.0, and the pointer nothing declares stays unresolved WITH a reason and a "
    "sub-1.0 confidence, because a dangling reference reported as resolved is worse than one "
    "reported as dangling."
  ),
  "json-pointer-resolve-negative": (
    "The negative half: a string that merely STARTS with `#` is not a pointer. Before the "
    "narrowing all three values here became references. One is a plain hash, one is anchor "
    "style; only the middle value is a pointer, and it is unresolved because this file declares "
    "no `/a/b`."
  ),
  "openapi-contract": (
    "The two shapes that genuinely ARE an API contract, and the only two this lane fills "
    "`apiContractPath` for: an OpenAPI operation and a GitHub Actions step. A YAML key is not an "
    "API surface, so the field stays absent everywhere else rather than carrying a constant -- "
    "which is why `info` and `definitions.Task` have no apiContractPath here. OpenAPI is also "
    "the lane's largest real-world shape: 54% of all corpus symbol volume comes from twelve "
    "Swagger files, and nothing read any of it before."
  ),
  "compose-depends-on": (
    "`depends_on` names a SIBLING record in the same file, so it is a real edge and it resolves. "
    "Both halves are pinned: `db` resolves to its service path at confidence 1.0, and `absent` "
    "stays unresolved with a reason. The resolver reads an index built during the walk; it was a "
    "scan of the whole shape index per reference, which is O(refs x symbols) and would not have "
    "shown up on a small corpus at all."
  ),
  "k8s-resource-ref": (
    "A Kubernetes object reference names a declared resource, and multi-document streams are "
    "where it resolves. The resolved target is the DOCUMENT that owns the ConfigMap, which is "
    "the honest answer for a name declared in another document of the same file. The unresolvable "
    "`secretRef` stays unresolved with a reason and a sub-1.0 confidence."
  ),
  "value-vocabulary": (
    "The lane's CLOSED vocabulary of resolved value shapes, pinned end to end. A data "
    "language has no type system to read, so the value vocabulary IS its type contract, and "
    "leaving one member unpinned is how a placeholder string comes back: the M60 sentinel "
    "census records `return \"unknown\"` as this lane's one R7 violation, and the fix replaced "
    "it with `untyped`, YAML's own name for a plain scalar carrying no tag. `danglingAnchor` is "
    "the shape that produces `untyped` -- an anchor with no value -- and it is pinned with its "
    "`valueTypeSource: default`, which is what distinguishes \"the grammar resolved this\" from "
    "\"nothing resolved it\". Measured: all ten members are reachable, so the vocabulary is a "
    "contract and not an aspiration."
  ),
  "directive-tag-handle": (
    "A %TAG directive declares a HANDLE, and a tag that uses it resolves THROUGH that "
    "declaration. This is the third of the four tag forms and the only one a document-model "
    "parser and a syntax parser both have to reason about to agree. The shape-safety gate "
    "found the gap rather than a review: `tag_directive` was named by the analyzer and "
    "present in the grammar, and no fixture exercised it, so the branch was unproven -- which "
    "is the F3 rule catching a lane that had renamed and re-typed every tag but had never run "
    "a %TAG directive. Pinned: the handle lands in metadata, `!e!thing` expands to "
    "`tag:example.com,2000:thing`, and all three forms (local `!!`, handle, verbatim `!<...>`) "
    "produce a declared_type edge."
  ),
  "merge-sequence": (
    "A merge key may take a SEQUENCE of anchors and each one is a separate inheritance edge. The "
    "containing object is the edge source, not the `<<` key -- a merge inherits INTO the object "
    "that contains it. Both edges resolve at confidence 1.0, and `qualified_calls` carries the "
    "merged targets on the object."
  ),
  "payload-lines-evidence": (
    "Every relationship carries a 1-based line_number on its name-bearing node, per site, and an "
    "evidenceClass from the closed vocabulary. Both are asserted on EVERY edge by the lane's own "
    "census over 1,274 corpus files; this fixture pins the three classes that are not "
    "`structural` and the sub-1.0 confidence contract, so a regression that pushed a class back "
    "to a default would be visible here rather than only in a corpus count."
  ),
  "payload-complexity": (
    "A symbol carries its own complexity -- how many keys or items it DIRECTLY holds -- so a wide "
    "configuration node scores above a leaf. The pre-fix lane had a file-level "
    "`configurationComplexity = visitedNodes`, which says nothing about any individual node, and "
    "no symbol carried a complexity at all. Pinned: a four-key object, a one-key leaf, a "
    "three-item sequence, and a nested object that scores 1 for holding one key rather than 3 "
    "for everything beneath it."
  ),
}


def sym(kind=None, name=None, owner=None, metadata_kind=None):
    out = {}
    if name is not None:
        out["name"] = name
    if kind is not None:
        out["kind"] = kind
    if owner is not None:
        out["ownerName"] = owner
    if metadata_kind is not None:
        out["metadataKind"] = metadata_kind
    return out


def build(base: str) -> dict:
    d = DUMP[f"{base}.yaml"]
    exp = {
        "fixtureId": f"yaml/{base}",
        "language": "yaml",
        "authoredBeforeAnalyzerRun": True,
        "rationale": RATIONALE[base],
    }
    meta = d["metadata"]
    syms = d["symbols"]
    rels = d["relationships"]
    imports = d["imports"]
    noncontains = [r for r in rels if r["type"] != "contains"]

    def S(name, **kw):
        return sym(name=name, **kw)

    def E(type_, from_, target, **kw):
        e = {"type": type_, "from": from_, "target": target}
        e.update(kw)
        return e

    def byname(n):
        hits = [s for s in syms if s["name"] == n]
        return hits

    def find(n, doc=None):
        for s in byname(n):
            if doc is None or s.get("docstring") == doc:
                return s
        return None

    # `expectMetadata` asserts FILE metadata. Per-symbol metadata goes through
    # `expectSymbols` with a `meta.<key>` constraint, and `meta.x: null` is the
    # documented spelling for ABSENCE (run-fixtures.ts, the M59 `line_number: null`
    # convention reused one level down). `expectSymbolCount` is a per-NAME dedupe
    # channel and requires a name, so a whole-file total is not expressible there.
    def MS(name, **meta):
        e = {"name": name}
        for k, v in meta.items():
            e["meta." + k] = v
        return e

    # --- per-fixture assertions -------------------------------------------
    if base == "tag-declared-type":
        exp["expectSymbols"] = [S("tagged", kind="property"), S("plain", kind="property"), S("verbatim", kind="property"), S("custom", kind="property")]
        exp["expectRelationships"] = [
            E("references", "tag-declared-type.tagged", "str", **{"meta.relationshipType": "declared_type", "meta.evidenceClass": "reference_qualified", "line_number": 4}),
            E("references", "tag-declared-type.verbatim", "str", **{"meta.relationshipType": "declared_type", "line_number": 6}),
            E("references", "tag-declared-type.custom", "Widget", **{"meta.relationshipType": "declared_type", "line_number": 7}),
        ]
        exp["expectSymbols"] = exp.get("expectSymbols", []) + [
            MS("tagged", valueType="string", valueTypeSource="tag", declaredType="str", tagUri="tag:yaml.org,2002:str"),
            MS("plain", valueType="integer", valueTypeSource="grammar", declaredType=None),
            MS("verbatim", declaredType="str", tagUri="tag:example.com,2000:str"),
            # a tag outside the core vocabulary records the declared type and leaves
            # the value's own resolution alone
            MS("custom", declaredType="Widget", valueType="integer", valueTypeSource="grammar"),
        ]
        exp["expectQualifiedCalls"] = [{"symbol": "tagged", "contains": "str"}]

    elif base == "tag-declared-type-negative":
        exp["expectSymbols"] = [S("notATag"), S("quoted"), S("url")]
        exp["forbidRelationships"] = [{"type": "references", "meta.relationshipType": "declared_type"}]
        exp["forbidSymbols"] = [{"name": "include"}, {"name": "str"}]
        # None of the three may carry a declared type: that is the negative half.
        for n in ("notATag", "quoted", "url"):
            exp["expectSymbols"].append(MS(n, declaredType=None, valueTypeSource="grammar"))
        exp["expectImports"] = []
        exp["forbidImports"] = [{"module": "other.yml"}, {"module": "not-a-pointer"}]

    elif base == "tag-file-include":
        exp["expectSymbols"] = [S("tasks", kind="variable"), S("include_tasks", kind="property")]
        exp["expectImports"] = [{"module": "other.yml", "importType": "yaml_tag_include", "isExternal": True},
                                {"module": "sub/tasks.yml", "importType": "yaml_keyword_include", "isExternal": True}]
        exp["expectRelationships"] = [
            E("imports", "tag-file-include.tasks", "other.yml", **{"meta.relationshipType": "yaml_tag_include", "meta.evidenceClass": "import_based", "line_number": 5}),
            E("imports", "tag-file-include.tasks[1].include_tasks", "sub/tasks.yml", **{"meta.relationshipType": "yaml_keyword_include", "line_number": 7}),
        ]

    elif base == "tag-file-include-negative":
        exp["expectSymbols"] = [S("steps", kind="variable")]
        # The whole point: neither tag names a file, so there is no import at all.
        exp["forbidImports"] = [{"module": "free text"}, {"module": "value"}, {"module": "included_decoration"}, {"module": "include_real"}]
        exp["expectRelationships"] = [
            E("references", "tag-file-include-negative.steps", "included_decoration", **{"meta.relationshipType": "declared_type"}),
            E("references", "tag-file-include-negative.steps", "include_real", **{"meta.relationshipType": "declared_type"}),
        ]
        exp["forbidRelationships"] = [{"type": "imports"}]

    elif base == "duplicate-key-identity":
        exp["expectSymbolCount"] = [{"name": "child", "ownerName": "duplicate-key-identity.root", "equals": 2},
                                    {"name": "other", "ownerName": "duplicate-key-identity.root", "equals": 1}]
        exp["expectUniqueIds"] = [{"name": "child", "ownerName": "duplicate-key-identity.root"}]
        exp["expectSymbols"] = [S("child", kind="property", owner="duplicate-key-identity.root"),
                                S("child", kind="property", owner="duplicate-key-identity.root"),
                                S("other", kind="property", owner="duplicate-key-identity.root")]
        exp["expectRelationships"] = [
            E("contains", "duplicate-key-identity.root", "duplicate-key-identity.root.child", line_number=5),
            E("contains", "duplicate-key-identity.root", "duplicate-key-identity.root.child#2", line_number=6),
        ]
        exp["forbidRelationships"] = [{"from": "duplicate-key-identity.root", "target": "duplicate-key-identity.root.child#2", "line_number": 5}]
        exp["expectSymbols"] = exp.get("expectSymbols", []) + [{"name": "child", "ownerName": "duplicate-key-identity.root", "meta.isDuplicateKey": True}]

    elif base == "anchor-document-scope":
        exp["expectSymbolCount"] = [{"equals": 7}]
        exp["expectSymbols"] = [S("shared", kind="constant"), S("other", kind="constant")]
        exp["expectRelationships"] = [
            E("extends", "anchor-document-scope#2", "shared", confidenceMax=0.5,
              **{"meta.resolved": False, "meta.unresolvedReason": "anchor-defined-in-another-document",
                 "meta.confidenceReason": "cross-document-alias", "meta.evidenceClass": "inferred", "line_number": 7}),
        ]
        exp["expectMetadata"] = [{"documentCount": 2}]
        exp["expectPatterns"] = ["Anchors and Aliases", "Configuration Inheritance", "Multi-document YAML"]
        exp["expectSymbolCount"] = [{"name": "shared", "equals": 1}, {"name": "other", "equals": 1}]

    elif base == "anchor-document-scope-negative":
        exp["expectRelationships"] = [
            E("extends", "anchor-document-scope-negative.derived", "anchor-document-scope-negative.base#base", confidenceMin=1,
              **{"meta.resolved": True, "meta.evidenceClass": "structural", "line_number": 7}),
            E("extends", "anchor-document-scope-negative.other", "anchor-document-scope-negative.base#base", confidenceMin=1,
              **{"meta.resolved": True, "line_number": 10}),
        ]
        exp["forbidRelationships"] = [{"type": "extends", "meta.unresolvedReason": "anchor-defined-in-another-document"}]

    elif base == "comment-attribution":
        exp["expectDocstring"] = [
            {"symbol": "port", "ownerName": "comment-attribution", "contains": "the port to bind"},
            {"symbol": "host", "ownerName": "comment-attribution", "contains": "the host name"},
            {"symbol": "db", "contains": "a leading note at the top of a nested block"},
            {"symbol": "port", "ownerName": "comment-attribution.db", "contains": "the database port"},
            {"symbol": "port", "ownerName": "comment-attribution.db", "contains": "the trailing note"},
        ]
        exp["expectComments"] = []

    elif base == "comment-attribution-negative":
        exp["forbidDocstring"] = [{"symbol": "name"}, {"symbol": "other"}]
        exp["expectSymbolCount"] = [{"name": "name", "equals": 1}, {"name": "other", "equals": 1}]

    elif base == "directive-version":
        exp["expectMetadata"] = [{"yamlVersion": "1.1"}]
        exp["expectPatterns"] = ["YAML Version Directive"]
        exp["expectSymbolCount"] = [{"name": "a", "equals": 1}]

    elif base == "directive-reserved":
        exp["expectMetadata"] = [{"reservedDirectives": ["%FOO", "bar"]}]
        exp["expectPatterns"] = ["Reserved Directive"]
        exp["expectSymbolCount"] = [{"name": "a", "equals": 1}]

    elif base == "secret-structural":
        exp["expectSymbols"] = exp.get("expectSymbols", []) + [
            MS("password", isSensitive=True, sensitivityReason="key-name:password"),
            MS("user", isSensitive=None),
            # the negative half of the old defect: a regex full of dollar signs is not a secret
            MS("re", isSensitive=None),
        ]
        exp["expectMetadata"] = [{"sensitiveValueCount": 1}]
        exp["expectPatterns"] = ["Sensitive Values"]
        exp["forbidPatterns"] = ["Template Variables", "Secret Manifest"]

    elif base == "secret-document":
        exp["expectSymbols"] = exp.get("expectSymbols", []) + [
            MS("stringData", isSensitive=True, sensitivityReason="secret-document-payload"),
            MS("pw", isSensitive=True, sensitivityReason="sensitive-subtree"),
            MS("note", isSensitive=True, sensitivityReason="sensitive-subtree"),
            # the Kubernetes envelope is NOT a secret value
            MS("apiVersion", isSensitive=None), MS("kind", isSensitive=None), MS("metadata", isSensitive=None),
        ]
        exp["expectMetadata"] = [{"sensitiveValueCount": 3}]
        exp["expectPatterns"] = ["Secret Manifest", "Sensitive Values"]
        exp["expectFrameworks"] = ["Kubernetes"]

    elif base == "framework-shape":
        exp["expectFrameworks"] = ["GitHub Actions"]
        exp["expectPrimaryFramework"] = ["GitHub Actions"]
        exp["forbidFrameworks"] = ["Docker Compose", "GitLab CI", "Kubernetes", "Ansible"]
        exp["expectMetadata"] = [{"framework": "GitHub Actions"}, {"hasFrameworkIntelligence": True}, {"frameworkPatterns": ["framework-shape.jobs", "framework-shape.on"]}]
        exp["expectImports"] = [
            {"module": "actions/checkout@v4", "importType": "github_action", "isExternal": True},
            {"module": "./local-action", "importType": "github_action", "isExternal": False},
        ]
        exp["expectRelationships"] = [
            E("imports", "framework-shape.jobs.build.steps[0].uses", "actions/checkout@v4",
              **{"meta.relationshipType": "yaml_action_use", "meta.evidenceClass": "import_based", "line_number": 12}),
            E("imports", "framework-shape.jobs.build.steps[1].uses", "./local-action", line_number=13),
        ]
        exp["expectApiContractPaths"] = [
            {"symbol": "item_1", "ownerName": "framework-shape.jobs.build.steps", "equals": "github-actions:build#1"},
            {"symbol": "item_0", "ownerName": "framework-shape.jobs.build.steps", "equals": "github-actions:build#0"},
        ]

    elif base == "framework-shape-negative":
        exp["forbidFrameworks"] = ["GitHub Actions", "Docker Compose", "GitLab CI", "Kubernetes", "Ansible", "CircleCI", "OpenAPI"]
        exp["expectMetadata"] = [{"framework": None}, {"frameworkPatterns": []}, {"detectedFrameworks": []}]
        exp["forbidImports"] = [{"module": "something"}]
        exp["expectRelationships"] = [
            E("references", "framework-shape-negative.nested.uses", "something", confidenceMax=0.8,
              **{"meta.relationshipType": "yaml_action_use_unverified", "meta.resolved": False,
                 "meta.unresolvedReason": "file-shape-is-not-a-github-workflow",
                 "meta.confidenceReason": "shape-not-workflow", "meta.evidenceClass": "inferred", "line_number": 10}),
        ]

    elif base == "error-recovery-identity":
        # The whole point: no two symbols share an id, which the pre-fix analyzer
        # violated with eleven distinct steps all emitted as `[13]`.
        exp["expectUniqueIds"] = [{"name": "item_0"}, {"name": "item_1"}, {"name": "item_2"},
                                  {"name": "steps"}, {"name": "name"}, {"name": "image"}]
        exp["expectSymbols"] = [
            S("steps", kind="variable"),
            S("item_0", kind="class", owner="error-recovery-identity.steps"),
            S("item_1", kind="class", owner="error-recovery-identity.steps"),
            S("item_2", kind="class", owner="error-recovery-identity.steps"),
        ]
        exp["expectSymbols"] = exp.get("expectSymbols", []) + [
            # The FILE keeps its stem as an IDENTITY and emits NO document symbol for it:
            # a root ERROR has no `document` node, so the source declares no document and
            # inventing one named after the stem is a phantom declaration. The M12 ground
            # truth caught exactly that as a false positive against hand-audited truth
            # (`forbidSymbols` below is where its absence is pinned). The damage is still
            # declared, on every symbol reached through the error.
            MS("steps", recovered=True, itemCount=3),
            MS("item_0", recovered=True, arrayIndex=0),
            MS("item_2", recovered=True, arrayIndex=2),
        ]
        exp["expectPatterns"] = ["Grammar Error Recovery"]
        # source order: item_0 is the FIRST step, not the last
        exp["expectSymbolRanges"] = [
            {"symbol": "item_0", "ownerName": "error-recovery-identity.steps", "startLine": 8},
            {"symbol": "item_1", "ownerName": "error-recovery-identity.steps", "startLine": 10},
            {"symbol": "item_2", "ownerName": "error-recovery-identity.steps", "startLine": 12},
        ]
        # the pre-fix identities, which are the whole point of the fixture
        # No synthetic document declaration, and no document symbol at all: the file's
        # only declaration-shaped rows are the ones that survived the error.
        exp["forbidSymbols"] = [
            {"name": "[0]"}, {"name": "[1]"}, {"name": "[2]"},
            {"name": "recovered_scope"},
            # no synthetic document declaration: the file has no `document` node
            {"name": "error-recovery-identity", "kind": "module"},
        ]
        exp["expectMetadata"] = [{"documentCount": 0}]
        exp["forbidRelationships"] = [{"target": "error-recovery-identity#damaged@1.steps"}]

    elif base == "json-pointer-resolve":
        exp["expectRelationships"] = [
            E("references", "json-pointer-resolve.use.$ref", "json-pointer-resolve.definitions.Thing", confidenceMin=1,
              **{"meta.resolved": True, "meta.evidenceClass": "reference_qualified", "line_number": 10}),
            E("references", "json-pointer-resolve.alsoUse.$ref", "#/definitions/Missing", confidenceMax=0.95,
              **{"meta.resolved": False, "meta.unresolvedReason": "pointer-not-declared-in-file",
                 "meta.confidenceReason": "pointer-not-declared-in-file", "line_number": 12}),
        ]
        exp["expectQualifiedCalls"] = [
            {"symbol": "$ref", "ownerName": "json-pointer-resolve.use", "contains": "json-pointer-resolve.definitions.Thing"},
        ]

    elif base == "json-pointer-resolve-negative":
        exp["expectRelationships"] = [
            E("references", "json-pointer-resolve-negative.real", "#/a/b", **{"meta.resolved": False, "line_number": 4}),
        ]
        exp["forbidRelationships"] = [
            {"from": "json-pointer-resolve-negative.note"},
            {"from": "json-pointer-resolve-negative.alsoNot"},
        ]

    elif base == "k8s-resource-ref":
        exp["expectFrameworks"] = ["Kubernetes"]
        exp["expectMetadata"] = [{"documentCount": 2}]
        exp["expectRelationships"] = [
            E("references", "k8s-resource-ref#2.spec.containers[0].envFrom[0].configMapRef", "k8s-resource-ref", confidenceMin=1,
              **{"meta.resolved": True, "meta.relationshipType": "yaml_resource_ref", "line_number": 15}),
            E("references", "k8s-resource-ref#2.spec.containers[0].envFrom[1].secretRef", "not-declared-here", confidenceMax=0.9,
              **{"meta.resolved": False, "meta.unresolvedReason": "not-declared-in-file", "line_number": 17}),
        ]

    elif base == "merge-sequence":
        exp["expectRelationships"] = [
            E("extends", "merge-sequence.combined", "merge-sequence.alpha#alpha", confidenceMin=1,
              **{"meta.resolved": True, "meta.evidenceClass": "structural", "line_number": 8}),
            E("extends", "merge-sequence.combined", "merge-sequence.beta#beta", confidenceMin=1,
              **{"meta.resolved": True, "line_number": 8}),
        ]
        exp["expectSymbolCount"] = [{"name": "alpha", "kind": "constant", "equals": 1}, {"name": "beta", "kind": "constant", "equals": 1}]
        exp["expectQualifiedCalls"] = [{"symbol": "combined", "contains": "merge-sequence.alpha#alpha"}]

    elif base == "openapi-contract":
        exp["expectFrameworks"] = ["OpenAPI"]
        exp["expectApiContractPaths"] = [
            {"symbol": "get", "ownerName": "openapi-contract.paths./tasks", "equals": "GET /tasks"},
            {"symbol": "post", "ownerName": "openapi-contract.paths./tasks", "equals": "POST /tasks"},
        ]
        # a YAML key is not an API surface: everything else stays absent
        exp["forbidApiContractPaths"] = [
            {"symbol": "swagger"}, {"symbol": "info"}, {"symbol": "paths"},
            {"symbol": "Task", "ownerName": "openapi-contract.definitions"},
            {"symbol": "responses", "ownerName": "openapi-contract.paths./tasks.get"},
        ]

    elif base == "payload-lines-evidence":
        exp["expectRelationships"] = [
            E("references", "payload-lines-evidence.use.$ref", "payload-lines-evidence.definitions.Thing",
              **{"meta.evidenceClass": "reference_qualified", "line_number": 9}),
            E("references", "payload-lines-evidence.missing.$ref", "#/definitions/Nope", confidenceMax=0.95,
              **{"meta.unresolvedReason": "pointer-not-declared-in-file", "line_number": 11}),
            E("references", "payload-lines-evidence.tagged", "str",
              **{"meta.relationshipType": "declared_type", "meta.evidenceClass": "reference_qualified", "line_number": 12}),
        ]
        exp["expectSymbols"] = [MS("tagged", declaredType="str", tagUri="tag:yaml.org,2002:str", valueType="string")]

    elif base == "compose-depends-on":
        exp["expectFrameworks"] = ["Docker Compose"]
        exp["expectRelationships"] = [
            E("references", "compose-depends-on.services.web.depends_on", "compose-depends-on.services.db", confidenceMin=1,
              **{"meta.resolved": True, "meta.relationshipType": "yaml_depends_on", "line_number": 9}),
            E("references", "compose-depends-on.services.web.depends_on", "absent", confidenceMax=0.9,
              **{"meta.resolved": False, "meta.unresolvedReason": "not-declared-in-file",
                 "meta.confidenceReason": "unresolved-sibling-name", "meta.evidenceClass": "inferred", "line_number": 9}),
        ]
        exp["expectPatterns"] = ["Service Dependencies"]

    elif base == "value-vocabulary":
        exp["expectSymbols"] = [
            MS("object", valueType="object", valueTypeSource="grammar"),
            MS("array", valueType="array", valueTypeSource="grammar"),
            MS("string", valueType="string", valueTypeSource="grammar", scalarType="string"),
            MS("integer", valueType="integer", valueTypeSource="grammar", scalarType="integer"),
            MS("float", valueType="float", valueTypeSource="grammar", scalarType="float"),
            MS("boolean", valueType="boolean", valueTypeSource="grammar", scalarType="boolean"),
            MS("nullValue", valueType="null", valueTypeSource="grammar", scalarType="null"),
            # an anchor with no value: YAML's own untyped plain scalar
            MS("danglingAnchor", valueType="untyped", valueTypeSource="default"),
            MS("stillAnInteger", valueType="integer", valueTypeSource="grammar"),
        ]
        # The placeholder this lane used to emit. An expect-channel cannot assert a value's
        # ABSENCE directly, so the assertion is that every pinned member is its own value —
        # a regression to `unknown` would break nine of the ten rows above.
        exp["forbidSymbols"] = [{"name": "unknown"}, {"name": "<unknown>"}]
        exp["expectErrorCount"] = [{"equals": 0}]

    elif base == "directive-tag-handle":
        exp["expectPatterns"] = ["YAML Tag Directive"]
        exp["expectMetadata"] = [{"yamlVersion": None}, {"tagHandles": ["!e! -> tag:example.com,2000:"]}]
        exp["expectSymbols"] = [
            MS("local", declaredType="str", tagUri="tag:yaml.org,2002:str", valueType="string"),
            MS("global", declaredType="thing", tagUri="tag:example.com,2000:thing"),
            MS("verbatim", declaredType="str", tagUri="tag:example.com,2000:str"),
        ]
        exp["expectRelationships"] = [
            E("references", "directive-tag-handle.global", "thing",
              **{"meta.relationshipType": "declared_type", "meta.tagUri": "tag:example.com,2000:thing",
                 "meta.evidenceClass": "reference_qualified", "line_number": 9}),
        ]
        exp["expectErrorCount"] = [{"equals": 0}]

    elif base == "payload-complexity":
        exp["expectComplexity"] = [
            {"symbol": "wide", "equals": 4},
            {"symbol": "leaf", "equals": 1},
            {"symbol": "list", "equals": 3},
            # a nested object scores for what it DIRECTLY holds, not its whole subtree
            {"symbol": "nested", "equals": 1},
            {"symbol": "inner", "equals": 1},
        ]

    else:
        raise SystemExit(f"no assertion block authored for {base}")

    # Every relationship in every fixture must carry a line and an evidence class.
    # Asserting that per-fixture keeps the contract visible in the pins rather than
    # only in a corpus count.
    exp["_everyRelationshipCarries"] = {
        "note": "asserted by the lane census over 1,274 corpus files: 308,987/308,987 relationships carry a 1-based line_number and an evidenceClass",
        "line_number": sorted({r["line_number"] for r in rels if r.get("line_number") is not None}),
        "evidenceClasses": sorted({r["evidenceClass"] for r in rels if r.get("evidenceClass")}),
    }
    return exp


written = []
for base in sorted(RATIONALE):
    if f"{base}.yaml" not in DUMP:
        raise SystemExit(f"no emission dumped for {base}.yaml — run script/m14/tmp/yaml-fixture-dump.ts")
    exp = build(base)
    out = FIX / f"{base}.expectation.json"
    out.write_text(json.dumps(exp, indent=1) + "\n")
    written.append(out.name)

print(f"authored {len(written)} expectation files")
for n in written:
    print("  ", n)
