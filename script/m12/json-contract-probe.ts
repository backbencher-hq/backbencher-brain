/**
 * M12 JSON contract probe — asserts the analyzer's semantic contract directly on
 * the PRODUCTION `parseFile` output, independent of any differential facts.
 *
 * The bash lane's probe exists because bash shipped a 26/36 contract and 3 checks
 * that were passing VACUOUSLY (asserted against an endpoint nothing emitted). JSON
 * ships with no probe at all, and it is offered on the website, so the first thing
 * this lane owes is an instrument that can fail.
 *
 * Reads only the production entry point, so a defect that lives between the
 * analyzer and the index — a dropped field, a filtered metadata key — is caught
 * here rather than being invisible to a probe that calls the analyzer directly.
 *
 * Writes: validation/m12/results/json-contract.json
 */
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const FIX = "validation/m12/fixtures/json"

const checks: { name: string; pass: boolean; detail: string }[] = []
const check = (name: string, pass: boolean, detail = "") => { checks.push({ name, pass, detail }) }

const basic = await parseFile(`${FIX}/Basic.json`, FIX) as any
const schema = await parseFile(`${FIX}/Schema.json`, FIX) as any
const dup = await parseFile(`${FIX}/Duplicate.json`, FIX) as any
const invalid = await parseFile(`${FIX}/Invalid.json`, FIX) as any

const rels = (r: any) => (r.relationships ?? []) as any[]
const syms = (r: any) => (r.symbols ?? []) as any[]
const names = (r: any) => syms(r).map((s: any) => String(s.name))
const has = (r: any, t: string, src: string, tgt: string) =>
  rels(r).some((x: any) => String(x.type).toLowerCase() === t && String(x.source) === src && String(x.target) === tgt)

// --- identity -------------------------------------------------------------------
// The module is the file's basename WITHOUT its extension (`Basic.json` -> `Basic`),
// which is what the analyzer emits and differs from bash, which keeps the extension
// (`Deploy.sh`). Both are self-consistent; the divergence is recorded, not asserted here.
check("module is the file's own basename", names(basic).includes("Basic"), `got: ${names(basic).filter((n) => syms(basic).find((s: any) => s.name === n)?.kind === "module").join(", ") || names(basic).slice(0, 3).join(", ")}`)
check("no 'global' owner symbol", !names(basic).includes("global"), "the phantom endpoint no symbol can resolve to")
check("top-level property is owned by the module", syms(basic).find((s: any) => s.name === "name")?.ownerName === "Basic", `ownerName=${syms(basic).find((s: any) => s.name === "name")?.ownerName}`)

// --- CONTAINMENT: the load-bearing invariant -------------------------------------
// Every pair in the file is contained by the object it is written in, and a `contains`
// edge with no line cannot be acted on by any consumer.
{
  const cs = rels(basic).filter((x: any) => String(x.type).toLowerCase() === "contains")
  check("contains edges are emitted", cs.length >= 7, `${cs.length} contains edges`)
  const noLine = cs.filter((x: any) => !(typeof x.line_number === "number" && x.line_number > 0))
  check(
    "EVERY contains edge carries a positive line_number",
    noLine.length === 0,
    `${noLine.length} of ${cs.length} have none` + (noLine.length ? ` e.g. ${noLine[0].source} -> ${noLine[0].target}` : ""),
  )
  check("nested object is contained by its parent", // The source is the parent SYMBOL's name (`nested`), NOT its qualified path
  // (`Basic.nested`). This expectation was written from the analyzer's output
  // rather than from the contract, so it encoded the bug it was meant to catch —
  // which is the same failure this probe exists to prevent, one level down.
  rels(basic).some((x: any) => String(x.type).toLowerCase() === "contains" && String(x.source) === "nested" && String(x.target) === "inner"))
  check("array-valued key is contained", has(basic, "contains", "Basic", "list"))
  check("scalar-valued key is contained", has(basic, "contains", "Basic", "count"))
  check("null-valued key is contained", has(basic, "contains", "Basic", "nothing"))
}

// --- every relationship, not just contains ----------------------------------------
{
  const all = rels(basic)
  const noLine = all.filter((x: any) => !(typeof x.line_number === "number" && x.line_number > 0))
  check("EVERY relationship carries a positive line_number", noLine.length === 0, `${noLine.length} of ${all.length} have none`)
  const declared = new Set(names(basic))
  // The analyzer qualifies a CONTAINMENT SOURCE with a dotted path (`Basic.nested`)
  // while the symbol itself is named by its bare key (`nested`) with an ownerName.
  // bash satisfies this invariant by making the source the OWNING SYMBOL's name, so
  // this is a real divergence and the check stays: an edge whose source is not a
  // symbol name cannot be resolved to a node by any consumer.
  const badSrc = all.filter((x: any) => !declared.has(String(x.source)))
  check("EVERY relationship source is a declared symbol", badSrc.length === 0, `${badSrc.length} do not resolve: ${[...new Set(badSrc.map((x: any) => x.source))].join(", ")}`)
}

// --- symbol kinds must follow the VALUE's shape, not an ad-hoc rule --------------
{
  const kindOf = (r: any, n: string) => syms(r).find((s: any) => s.name === n)?.kind
  check("string-valued key is a property", kindOf(basic, "name") === "property", `got ${kindOf(basic, "name")}`)
  check("object-valued key is a class/object", kindOf(basic, "nested") === "class", `got ${kindOf(basic, "nested")}`)
  // A JSON array is a LEAF: it has no named children, and the analyzer emits no
  // `contains` edges for its elements, so there is nothing for it to contain. The
  // kind that means "container with named children" is Class; everything else is a
  // Property. Emitting `variable` for an array imports a shell-shaped distinction
  // JSON does not have.
  check("array-valued key is a leaf (property), not a shell-style 'variable'", kindOf(basic, "list") === "property", `got ${kindOf(basic, "list")}`)
  check("the array really is a leaf (no contains edges for its elements)", rels(basic).filter((x: any) => String(x.target).match(/^\d+$/)).length === 0, "elements are positional, not named")
  check("boolean-valued key is a property", kindOf(basic, "flag") === "property", `got ${kindOf(basic, "flag")}`)
  check("number-valued key is a property", kindOf(basic, "count") === "property", `got ${kindOf(basic, "count")}`)
}

// --- JSON Schema: $ref is the load-bearing edge ----------------------------------
check("schema module is detected", schema.framework === "JSON Schema", `framework=${schema.framework}`)
check("$schema key is present as a symbol", names(schema).includes("$schema"))
check("$ref resolves to its target", has(schema, "references", "schema.definitions.Leaf.properties.child.$ref", "schema.definitions.Leaf") || rels(schema).some((x: any) => String(x.type).toLowerCase() === "references" && String(x.target).endsWith("definitions.Leaf")), rels(schema).filter((x: any) => String(x.type).toLowerCase() === "references").map((x: any) => `${x.source} -> ${x.target}`).join(" | "))
{
  const rs = rels(schema).filter((x: any) => String(x.type).toLowerCase() === "references")
  check("at least one references edge is emitted", rs.length >= 1, `${rs.length}`)
  check("an internal $ref is not marked external", rs.every((x: any) => x.metadata?.isExternal === false), JSON.stringify(rs.map((x: any) => x.metadata?.isExternal)))
}

// --- duplicate keys must not collide ---------------------------------------------
{
  const dupNames = names(dup)
  const dupCount = (n: string) => dupNames.filter((x) => x === n).length
  check("a repeated key in DIFFERENT objects is two distinct symbols", dupCount("dup") === 2, `${dupCount("dup")} symbol(s) named "dup"`)
  const owners = syms(dup).filter((s: any) => s.name === "dup").map((s: any) => s.ownerName)
  check("the two 'dup' symbols have different owners", new Set(owners).size === owners.length, owners.join(" | "))
}

// --- invalid input ---------------------------------------------------------------
check("invalid JSON reports a syntax error", (invalid.errors?.length ?? 0) >= 1, `errors=${invalid.errors?.length ?? 0}`)
check("invalid JSON still yields its module", names(invalid).includes("Invalid"))

// --- no regex, no source-text parsing --------------------------------------------
// The hard requirement for this lane. Scanned with comments stripped, because the
// bash lane's equivalent scanner matched its own `/* 0-9 */` comment and the check
// contradicted its own stated contract.
{
  const source = readFileSync("src/ast/real-json-analyzer.ts", "utf8")
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  const ctor = (codeOnly.match(/new\s+RegExp\s*\(/g) ?? []).length
  const method = (codeOnly.match(/\.(?:test|match|replace|exec|search|split|matchAll|replaceAll)\s*\(\s*\//g) ?? []).length
  const delim = /(?:^|[^\w])\/(?:[^/\n]*)\/[dgimsuy]*(?:\.|\s*[);,])/m.test(codeOnly)
  check("analyzer source has NO regex literals", ctor === 0 && method === 0 && !delim, `ctor=${ctor} methodUses=${method} delimiter=${delim}`)
  // Deliberately narrow. An earlier version of this check banned `.trim()`, which
  // was WRONG: trimming a tree NODE's text is structural, and the analyzer must
  // touch `node.text` to read a value. What it must never do is read the FILE as
  // text, so that is the whole assertion.
  check("analyzer never reads the file as text", !/readFileSync|readFile|content\s*\.match\(/.test(codeOnly), "structure must come from the tree; node.text is fine, the file body is not")
}

const passed = checks.filter((c) => c.pass).length
const result = { analyzer: "json", checks, passed: passed === checks.length, total: checks.length }
writeFileSync(`${ROOT}/validation/m12/results/json-contract.json`, JSON.stringify(result, null, 2) + "\n")
for (const c of checks) console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.name}${c.detail ? " :: " + c.detail : ""}`)
console.log(`\njson contract: ${passed}/${checks.length}`)
process.exitCode = passed === checks.length ? 0 : 1
