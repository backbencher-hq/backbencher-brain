// Verification probe: every defect the research record named, re-measured against the
// rewritten analyzer, plus each new capability. Each case prints the specific claim
// under test and whether the emission supports it, so a regression is visible as a
// FAIL line rather than as a diff someone has to notice.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

interface Case {
  id: string
  claim: string
  src: string
  /** Returns true when the emission satisfies the claim. */
  check: (r: any) => { ok: boolean; detail: string }
}

const CASES: Case[] = [
  {
    id: "Y1-tag-type-override",
    claim: "`!!str 7` is a STRING, not the integer underneath it",
    src: "tagged: !!str 7\nnum: 5\n",
    check: (r) => {
      const t = r.symbols.find((s: any) => s.name === "tagged")
      const n = r.symbols.find((s: any) => s.name === "num")
      const edge = r.relationships.find((e: any) => e.metadata?.relationshipType === "declared_type" && String(e.target) === "str")
      return {
        ok: t?.metadata?.valueType === "string" && n?.metadata?.valueType === "integer" && !!edge,
        detail: `tagged=${t?.metadata?.valueType} num=${n?.metadata?.valueType} declaredTypeEdge=${edge ? `${edge.source}->${edge.target} tagUri=${edge.metadata.tagUri}` : "MISSING"}`,
      }
    },
  },
  {
    id: "Y1b-tag-uri-resolves-core",
    claim: "`!!str` expands to the core-schema URI, not the literal `!!str`",
    src: "tagged: !!str 7\n",
    check: (r) => {
      const t = r.symbols.find((s: any) => s.name === "tagged")
      return { ok: t?.metadata?.tagUri === "tag:yaml.org,2002:str", detail: `tagUri=${t?.metadata?.tagUri}` }
    },
  },
  {
    id: "Y1c-tag-named-handle",
    claim: "a %TAG handle expands: `!e!thing` -> tag:example.com,2000:thing",
    src: "%TAG !e! tag:example.com,2000:\n---\nx: !e!thing 1\n",
    check: (r) => {
      const t = r.symbols.find((s: any) => s.name === "x")
      return { ok: t?.metadata?.tagUri === "tag:example.com,2000:thing" && t?.metadata?.declaredType === "thing", detail: `tagUri=${t?.metadata?.tagUri} declaredType=${t?.metadata?.declaredType} yamlVersion=${r.metadata?.yamlVersion}` }
    },
  },
  {
    id: "Y1d-tag-verbatim",
    claim: "a verbatim tag `!<...>` resolves",
    src: "t: !<tag:example.com,2000:str> 7\n",
    check: (r) => {
      const t = r.symbols.find((s: any) => s.name === "t")
      return { ok: t?.metadata?.tagUri === "tag:example.com,2000:str", detail: `tagUri=${t?.metadata?.tagUri} declaredType=${t?.metadata?.declaredType}` }
    },
  },
  {
    id: "Y2-tag-file-include-item",
    claim: "a sequence item that IS a tagged file reference is a real import",
    src: "tasks:\n- !include other.yml\n",
    check: (r) => ({
      ok: r.imports.some((i: any) => i.module === "other.yml"),
      detail: `imports=${JSON.stringify(r.imports.map((i: any) => `${i.importType}:${i.module}`))}`,
    }),
  },
  {
    id: "Y2b-tag-file-include-key",
    claim: "`key: !include other.yml` is a real import",
    src: "steps:\n- include: !include tasks.yml\n",
    check: (r) => ({
      ok: r.imports.some((i: any) => i.module === "tasks.yml"),
      detail: `imports=${JSON.stringify(r.imports.map((i: any) => `${i.importType}:${i.module}`))}`,
    }),
  },
  {
    id: "Y2c-keyword-include",
    claim: "`include_tasks: other.yml` is an import decided by KEY SPELLING, no tag needed",
    src: "tasks:\n  - name: a\n    include_tasks: sub/tasks.yml\n",
    check: (r) => ({
      ok: r.imports.some((i: any) => i.module === "sub\/tasks.yml"),
      detail: `imports=${JSON.stringify(r.imports.map((i: any) => `${i.importType}:${i.module}`))}`,
    }),
  },
  {
    id: "Y3-duplicate-keys",
    claim: "two `child:` keys get distinct identities AND distinct contains edges",
    src: "root:\n  child: 1\n  child: 2\n",
    check: (r) => {
      const ids = r.symbols.map((s: any) => s.id)
      const dup = ids.length !== new Set(ids).size
      const contains = r.relationships.filter((e: any) => e.type === "contains" && String(e.source) === "probe.root" && String(e.target).includes("root.child"))
      return { ok: !dup && contains.length === 2, detail: `ids=${JSON.stringify(ids.filter((i: string) => i.includes("child")))} containsEdges=${contains.length} duplicateFlag=${r.symbols.filter((s: any) => s.metadata?.isDuplicateKey).length}` }
    },
  },
  {
    id: "Y4-anchor-document-scope",
    claim: "an alias in document 2 does NOT bind document 1's same-named anchor",
    src: "--- &a\n  x: 1\n--- &b\n  <<: *a\n  y: 2\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.type === "extends")
      return {
        ok: e?.metadata?.resolved === false && e?.metadata?.unresolvedReason === "anchor-defined-in-another-document" && e?.confidence < 1 && !!e?.metadata?.confidenceReason,
        detail: `target=${e?.target} conf=${e?.confidence} resolved=${e?.metadata?.resolved} reason=${e?.metadata?.unresolvedReason} evidenceClass=${e?.metadata?.evidenceClass}`,
      }
    },
  },
  {
    id: "Y4b-anchor-same-document-resolves",
    claim: "an alias in the SAME document as its anchor still resolves at confidence 1",
    src: "base: &b\n  a: 1\nd:\n  <<: *b\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.type === "extends")
      return { ok: e?.metadata?.resolved === true && e?.confidence === 1, detail: `target=${e?.target} conf=${e?.confidence} resolved=${e?.metadata?.resolved}` }
    },
  },
  {
    id: "Y5-framework-path-scoping",
    claim: "the same key names NESTED under one key claim NO framework",
    src: "nested:\n  version: 2\n  services: {}\n  jobs: {}\n  on: push\n  stages: []\n",
    check: (r) => ({ ok: (r.metadata?.detectedFrameworks ?? []).length === 0, detail: `frameworks=${JSON.stringify(r.metadata?.detectedFrameworks)}` }),
  },
  {
    id: "Y5b-framework-real-workflow",
    claim: "a real GitHub Actions workflow IS detected",
    src: "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
    check: (r) => ({ ok: (r.metadata?.detectedFrameworks ?? []).includes("GitHub Actions"), detail: `frameworks=${JSON.stringify(r.metadata?.detectedFrameworks)} primary=${r.metadata?.framework}` }),
  },
  {
    id: "Y5c-r8-contract-keys",
    claim: "the R8 contract keys are all present: framework, detectedFrameworks, frameworkPatterns, hasFrameworkIntelligence",
    src: "version: 2\nservices:\n  web:\n    image: nginx\n",
    check: (r) => {
      const m = r.metadata ?? {}
      return {
        ok: "framework" in m && Array.isArray(m.detectedFrameworks) && Array.isArray(m.frameworkPatterns) && m.hasFrameworkIntelligence === true,
        detail: `framework=${m.framework} detected=${JSON.stringify(m.detectedFrameworks)} patterns=${JSON.stringify(m.frameworkPatterns)} has=${m.hasFrameworkIntelligence}`,
      }
    },
  },
  {
    id: "Y6-secret-structural",
    claim: "`password: hunter2` is sensitive WITHOUT any dollar sign",
    src: "db:\n  password: hunter2\n  user: admin\n",
    check: (r) => {
      const p = r.symbols.find((s: any) => s.name === "password")
      return { ok: p?.metadata?.isSensitive === true && r.metadata?.securityScore < 100, detail: `isSensitive=${p?.metadata?.isSensitive} reason=${p?.metadata?.sensitivityReason} securityScore=${r.metadata?.securityScore}` }
    },
  },
  {
    id: "Y6b-no-false-secret",
    claim: "`re: \"^\\\\d+$\"` is NOT flagged as a secret (the old `$` scan flagged it)",
    src: 're: "^\\\\d+$"\npasswordless: true\n',
    check: (r) => {
      const flagged = r.symbols.filter((s: any) => s.metadata?.isSensitive === true).map((s: any) => s.name)
      return { ok: !flagged.includes("re"), detail: `flagged=${JSON.stringify(flagged)}` }
    },
  },
  {
    id: "Y6c-secret-document",
    claim: "a `kind: Secret` document marks its PAYLOAD sensitive and NOT the Kubernetes envelope",
    src: "apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\nstringData:\n  pw: x\n",
    check: (r) => {
      const pw = r.symbols.find((s: any) => s.name === "pw")
      const envelope = r.symbols.filter((s: any) => ["apiVersion", "kind", "metadata", "name"].includes(s.name) && s.metadata?.isSensitive === true).map((s: any) => s.name)
      return {
        // `stringData` itself carries `secret-document-payload`; its children carry
        // `sensitive-subtree`, which is the more precise answer — a key is sensitive
        // because it is INSIDE the payload, not because it names the payload.
        ok: pw?.metadata?.isSensitive === true && pw?.metadata?.sensitivityReason === "sensitive-subtree" && envelope.length === 0,
        detail: `pw.reason=${pw?.metadata?.sensitivityReason} sensitiveEnvelopeKeys=${JSON.stringify(envelope)} sensitiveCount=${r.metadata?.sensitiveValueCount}`,
      }
    },
  },
  {
    id: "Y6d-include-tag-closed-set",
    claim: "a tag whose name merely CONTAINS include/import is not a file reference",
    src: "steps:\n- !included_decoration free text\n- !include_real value\n",
    check: (r) => ({
      ok: r.imports.length === 0,
      detail: `imports=${JSON.stringify(r.imports.map((i: any) => i.module))} declaredTypeEdges=${r.relationships.filter((e: any) => e.metadata?.relationshipType === "declared_type").length}`,
    }),
  },
  {
    id: "Y6e-include-value-must-be-path-shaped",
    claim: "a real include tag with a NON-path value is not an import",
    src: "steps:\n- !include value\n",
    check: (r) => ({
      ok: r.imports.length === 0,
      detail: `imports=${JSON.stringify(r.imports.map((i: any) => i.module))}`,
    }),
  },
  {
    id: "Y7-comment-docstring",
    claim: "a comment above a key becomes that key's docstring",
    src: "# the port to bind\nport: 8080\n# the host name\nhost: localhost\n",
    check: (r) => {
      const p = r.symbols.find((s: any) => s.name === "port")
      const h = r.symbols.find((s: any) => s.name === "host")
      return { ok: p?.docstring === "the port to bind" && h?.docstring === "the host name", detail: `port.doc=${JSON.stringify(p?.docstring)} host.doc=${JSON.stringify(h?.docstring)}` }
    },
  },
  {
    id: "Y7b-comment-nested-and-trailing",
    claim: "a nested comment attaches to the nested key, and a trailing comment is kept",
    src: "top: 1\n# about the nested block\ndb:\n  # about the port\n  port: 5432  # the db port\n",
    check: (r) => {
      const d = r.symbols.find((s: any) => s.name === "db")
      const p = r.symbols.find((s: any) => s.name === "port")
      return { ok: d?.docstring === "about the nested block" && typeof p?.docstring === "string" && p.docstring.includes("the db port"), detail: `db.doc=${JSON.stringify(d?.docstring)} port.doc=${JSON.stringify(p?.docstring)}` }
    },
  },
  {
    id: "Y7c-comment-not-misattached",
    claim: "a file-level comment does not become the docstring of an unrelated later key",
    src: "# file banner\n\nname: thing\n",
    check: (r) => {
      const n = r.symbols.find((s: any) => s.name === "thing")
      return { ok: !n?.docstring, detail: `name.doc=${JSON.stringify(n?.docstring)}` }
    },
  },
  {
    id: "Y8-line-on-every-relationship",
    claim: "EVERY relationship carries a 1-based line_number",
    src: "a: &anc\n  k: 1\nb:\n  <<: *anc\nc:\n  d: 1\n",
    check: (r) => {
      const withLine = r.relationships.filter((e: any) => typeof e.line_number === "number" && e.line_number >= 1).length
      return { ok: withLine === r.relationships.length, detail: `${withLine}/${r.relationships.length} carry a 1-based line_number` }
    },
  },
  {
    id: "Y9-evidence-class-on-every-relationship",
    claim: "EVERY relationship carries metadata.evidenceClass from the closed vocabulary",
    src: "a:\n  b: 1\nc: !!str 2\n",
    check: (r) => {
      const vocabulary = new Set(["structural", "usage_contextual", "import_based", "reference_qualified", "inferred"])
      const missing = r.relationships.filter((e: any) => !vocabulary.has(e.metadata?.evidenceClass))
      return { ok: missing.length === 0, detail: `${r.relationships.length - missing.length}/${r.relationships.length} classified; missing=${JSON.stringify(missing.map((e: any) => `${e.type}->${e.target}`))}` }
    },
  },
  {
    id: "Y10-gh-actions-uses-import",
    claim: "a workflow step's `uses:` is an import, and a non-workflow's `uses:` is not",
    src: "name: ci\non: push\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: ./local-action\n",
    check: (r) => {
      const mods = r.imports.map((i: any) => i.module)
      return { ok: mods.includes("actions/checkout@v4") && mods.includes("./local-action"), detail: `imports=${JSON.stringify(r.imports.map((i: any) => `${i.importType}:${i.module}:ext=${i.isExternal}`))}` }
    },
  },
  {
    id: "Y10b-nonworkflow-uses-not-import",
    claim: "`uses:` outside a workflow is a reference with a reason, not an import",
    src: "uses: something\nother: 1\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.metadata?.relationshipType === "yaml_action_use_unverified")
      return { ok: r.imports.length === 0 && e?.metadata?.resolved === false, detail: `imports=${r.imports.length} edge=${e ? `${e.source}->${e.target} reason=${e.metadata.unresolvedReason} conf=${e.confidence}` : "MISSING"}` }
    },
  },
  {
    id: "Y11-directive-recorded",
    claim: "`%YAML 1.1` is recorded, not dropped",
    src: "%YAML 1.1\n---\na: 1\n",
    check: (r) => ({ ok: r.metadata?.yamlVersion === "1.1", detail: `yamlVersion=${r.metadata?.yamlVersion} patterns=${JSON.stringify(r.metadata?.patterns)}` }),
  },
  {
    id: "Y11b-reserved-directive",
    claim: "a reserved directive is recorded, not dropped",
    src: "%FOO bar baz\n---\na: 1\n",
    check: (r) => ({ ok: (r.metadata?.reservedDirectives ?? []).length > 0, detail: `reserved=${JSON.stringify(r.metadata?.reservedDirectives)}` }),
  },
  {
    id: "Y13-complexity-per-symbol",
    claim: "a symbol carries its own complexity, and a big node scores above a leaf",
    src: "big:\n  a: 1\n  b: 2\n  c: 3\nleaf: 1\nseq:\n  - 1\n  - 2\n  - 3\n  - 4\n",
    check: (r) => {
      const big = r.symbols.find((s: any) => s.name === "big")
      const leaf = r.symbols.find((s: any) => s.name === "leaf")
      const seq = r.symbols.find((s: any) => s.name === "seq")
      return { ok: big?.complexity === 3 && leaf?.complexity === 1 && seq?.complexity === 4, detail: `big=${big?.complexity} leaf=${leaf?.complexity} seq=${seq?.complexity}` }
    },
  },
  {
    id: "Y13b-qualified-calls",
    claim: "a declaration carrying references records them in qualified_calls",
    src: "defs:\n  Thing: {}\nuse:\n  $ref: \"#/defs/Thing\"\n",
    check: (r) => {
      const ref = r.symbols.find((s: any) => s.name === "$ref")
      return { ok: Array.isArray(ref?.qualified_calls) && ref.qualified_calls.length > 0, detail: `$ref.qualified_calls=${JSON.stringify(ref?.qualified_calls)}` }
    },
  },
  {
    id: "Y13c-openapi-api-contract-path",
    claim: "an OpenAPI operation carries an apiContractPath of `METHOD /route`",
    src: "swagger: \"2.0\"\npaths:\n  /tasks:\n    get:\n      responses:\n        \"200\": {}\n",
    check: (r) => {
      const op = r.symbols.find((s: any) => s.qualifiedName?.endsWith(".get"))
      return { ok: op?.apiContractPath === "GET /tasks", detail: `get.apiContractPath=${op?.apiContractPath}` }
    },
  },
  {
    id: "Y13d-gh-actions-step-api-contract-path",
    claim: "a workflow step carries `github-actions:<job>#<n>`",
    src: "on: push\njobs:\n  build:\n    steps:\n      - run: echo hi\n",
    check: (r) => {
      const step = r.symbols.find((s: any) => s.apiContractPath?.startsWith("github-actions:"))
      return { ok: !!step, detail: `step.apiContractPath=${step?.apiContractPath}` }
    },
  },
  {
    id: "Y17-json-pointer-resolves-in-file",
    claim: "`$ref: \"#/definitions/Thing\"` resolves to the real symbol in the same file",
    src: "definitions:\n  Thing:\n    type: object\nuse:\n  $ref: \"#/definitions/Thing\"\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.metadata?.relationshipType === "yaml_json_pointer")
      return { ok: e?.metadata?.resolved === true && String(e?.target) === "probe.definitions.Thing", detail: `target=${e?.target} resolved=${e?.metadata?.resolved} conf=${e?.confidence}` }
    },
  },
  {
    id: "Y17b-json-pointer-escaped-key",
    claim: "a pointer through a `/`-bearing key resolves (JSON-pointer escaping)",
    src: "paths:\n  /tasks:\n    get: {}\nschema:\n  $ref: \"#/paths/~1tasks/get\"\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.metadata?.relationshipType === "yaml_json_pointer")
      return { ok: e?.metadata?.resolved === true, detail: `target=${e?.target} resolved=${e?.metadata?.resolved}` }
    },
  },
  {
    id: "Y17c-json-pointer-unresolved-is-honest",
    claim: "a pointer nothing declares is unresolved WITH a reason and a sub-1.0 confidence",
    src: "use:\n  $ref: \"#/definitions/Missing\"\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.metadata?.relationshipType === "yaml_json_pointer")
      return { ok: e?.metadata?.resolved === false && !!e?.metadata?.unresolvedReason && e.confidence < 1 && !!e?.metadata?.confidenceReason, detail: `reason=${e?.metadata?.unresolvedReason} conf=${e?.confidence} confReason=${e?.metadata?.confidenceReason}` }
    },
  },
  {
    id: "Y25-refs-narrowed",
    claim: "a string starting `#` that is NOT a pointer is not a reference",
    src: "note: \"# just a hash\"\nreal: \"#/a/b\"\n",
    check: (r) => {
      const refs = r.relationships.filter((x: any) => x.metadata?.relationshipType === "yaml_json_pointer")
      return { ok: refs.length === 1 && String(refs[0].source).endsWith("real"), detail: `jsonPointerEdges=${refs.length} sources=${JSON.stringify(refs.map((e: any) => e.source))}` }
    },
  },
  {
    id: "DEPENDS-compose",
    claim: "`depends_on` resolves to a sibling service in the same file",
    src: "version: \"3\"\nservices:\n  web:\n    image: nginx\n    depends_on:\n      - db\n  db:\n    image: postgres\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.metadata?.relationshipType === "yaml_depends_on")
      return { ok: e?.metadata?.resolved === true && String(e?.target) === "probe.services.db", detail: `target=${e?.target} resolved=${e?.metadata?.resolved} conf=${e?.confidence}` }
    },
  },
  {
    id: "DEPENDS-unresolved-honest",
    claim: "`depends_on` naming an absent service is unresolved with a reason",
    src: "services:\n  web:\n    depends_on:\n      - ghost\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.metadata?.relationshipType === "yaml_depends_on")
      return { ok: e?.metadata?.resolved === false && e.confidence < 1, detail: `reason=${e?.metadata?.unresolvedReason} conf=${e?.confidence}` }
    },
  },
  {
    id: "K8S-resource-ref",
    claim: "`configMapRef.name` resolves to a ConfigMap declared in the same stream",
    src: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\n---\napiVersion: v1\nkind: Pod\nspec:\n  configMapRef:\n    name: cm\n",
    check: (r) => {
      const e = r.relationships.find((x: any) => x.metadata?.relationshipType === "yaml_resource_ref")
      return { ok: e?.metadata?.resolved === true, detail: `target=${e?.target} resolved=${e?.metadata?.resolved} docs=${r.metadata?.documentCount}` }
    },
  },
  {
    id: "Y0-error-no-collision",
    claim: "an unterminated flow sequence does NOT collapse distinct items onto one id",
    src: "steps:\n- name: a\n  image: x\n- name: b\n  image: y\nargs: [\n  'unterminated\n",
    check: (r) => {
      const ids = r.symbols.map((s: any) => s.id)
      return { ok: ids.length === new Set(ids).size, detail: `symbols=${ids.length} unique=${new Set(ids).size} recoveredScopes=${r.symbols.filter((s: any) => s.metadata?.recovered).length} patterns=${JSON.stringify(r.metadata?.patterns)}` }
    },
  },
  {
    id: "Y0b-error-is-declared",
    claim: "the recovery is DECLARED, not silent",
    src: "steps:\n- name: a\nargs: [\n  'unterminated\n",
    check: (r) => ({ ok: (r.metadata?.patterns ?? []).includes("Grammar Error Recovery"), detail: `patterns=${JSON.stringify(r.metadata?.patterns)}` }),
  },
  {
    id: "R7-no-unknown-sentinel",
    claim: "no symbol metadata carries the literal `unknown`",
    src: "a: 1\nb: [1, 2]\nc: {d: 1}\n",
    check: (r) => {
      const hits: string[] = []
      for (const s of r.symbols) {
        for (const [k, v] of Object.entries(s.metadata ?? {})) if (String(v) === "unknown") hits.push(`${s.id}.${k}`)
        for (const [k, v] of Object.entries(s.metadata ?? {})) if (Array.isArray(v)) for (const x of v) if (String(x) === "unknown") hits.push(`${s.id}.${k}`)
      }
      return { ok: hits.length === 0, detail: hits.length === 0 ? "clean" : `hits=${JSON.stringify(hits)}` }
    },
  },
  {
    id: "ANCHOR-merge-sequence",
    claim: "`<<: [*a, *b]` yields one extends edge per merged anchor",
    src: "a: &a\n  x: 1\nb: &b\n  y: 2\nd:\n  <<: [*a, *b]\n",
    check: (r) => {
      const ext = r.relationships.filter((x: any) => x.type === "extends")
      return { ok: ext.length === 2 && ext.every((e: any) => e.metadata?.resolved === true), detail: `extends=${ext.length} targets=${JSON.stringify(ext.map((e: any) => e.target))}` }
    },
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))

  let passed = 0
  let failed = 0
  const failures: string[] = []
  for (const c of CASES) {
    const tree = parser.parse(c.src)
    let result: any
    try {
      result = await new mod.RealYamlAnalyzer().analyze(tree.rootNode, c.src, "probe.yaml")
    } catch (e: any) {
      failed++
      failures.push(`${c.id}: THREW ${e?.message}`)
      console.log(`FAIL  ${c.id}\n      threw: ${e?.message}`)
      continue
    }
    const verdict = c.check(result)
    if (verdict.ok) {
      passed++
      console.log(`ok    ${c.id}\n      ${verdict.detail}`)
    } else {
      failed++
      failures.push(`${c.id}: ${verdict.detail}`)
      console.log(`FAIL  ${c.id}\n      claim: ${c.claim}\n      got:   ${verdict.detail}`)
    }
  }
  console.log(`\n=== ${passed} passed, ${failed} failed, ${CASES.length} total ===`)
  if (failures.length > 0) {
    console.log("\nfailures:")
    for (const f of failures) console.log(`  - ${f}`)
  }
}
main()
