/**
 * HCL WHOLE-POPULATION EXTENDED-TYPE CENSUS — the instrument the four extended values
 * (`part_of`, `mixes_in`, `decorates`, `renders`) are adjudicated from.
 *
 * WHY A SEPARATE INSTRUMENT FROM `construct-census.mts`: that census decides the TEN canonical
 * types (grammar vocabulary + corpus keyword space + construct counts). The extended values are
 * different questions — `part_of` is "does any construct SPLICE another file's members into this
 * one", `mixes_in` is "is any construct a member-set composition with no conformance", `decorates`
 * is "is anything an APPLIED CALLABLE on a declaration", `renders` is "does anything render a
 * DECLARATION" — and each is decided by counting the constructs that could be it and reading the
 * contract against them. This instrument counts those constructs over the WHOLE admitted
 * population and runs the PRODUCTION path (`engine.parseFile`) over every file that carries an
 * `include` block, so the emitted `part_of` rows are counted rather than predicted.
 *
 * POPULATION (the campaign's rule — it must be the gate's own): git-tracked `.tf` / `.tfvars` /
 * `.hcl` / `.tofu` under `BB_CORPUS_ROOT` (default `$HOME/fixtures/repositories`),
 * under the engine's own 1 MiB admission cap. The same rule `incoming-gate.ts` applies for the
 * lane's router table `tf,hcl,tfvars,tofu`, which is why the count here (9,329 files / 16 repos)
 * is the number the whole-population arm must reproduce.
 *
 * WHAT EACH READING IS FOR (no ruling is argued here; the spec cites these numbers):
 *   part_of     include blocks and their `path` forms: literal vs computed vs absent; each
 *               literal path resolved against the tracked tree (present / absent from the
 *               population — absence is NOT knowable in a pure AST pass, so it is counted as the
 *               arm's unresolved wall); and the part_of edges the production path emits over the
 *               files that carry includes.
 *   mixes_in    `dynamic` blocks, `for_each` attribute sites, `lifecycle` / `provisioner` blocks,
 *               module blocks with a source, and the variable/output surface a module exposes
 *               (the members a caller does NOT acquire: they stay namespaced `module.NAME.*`).
 *   decorates   `validation`, `precondition` / `postcondition` blocks and `depends_on` attribute
 *               sites — assertions and ordering metadata attached to declarations.
 *   renders     `templatefile()` / `templatestring()` / `template_dir()` call sites and
 *               `template_file` / `template_dir` resources, plus template node counts.
 *
 * Usage:
 *   npx tsx script/m14/hcl-extended-census.ts
 *   BB_CORPUS_ROOT=… BB_HCL_EXT_OUT=… npx tsx script/m14/hcl-extended-census.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SIZE_CAP = 1024 * 1024
const EXTENSIONS = [".tf", ".tfvars", ".hcl", ".tofu"]
const OUT = process.env.BB_HCL_EXT_OUT ?? path.join(ROOT, "validation/m14/fixtures/hcl/extended-census.current.json")

const { parseFile, getParser } = await import(`${ROOT}/src/ast/engine.ts`)
const parser = await getParser("hcl")

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
const textOf = (n: any): string => n.text ?? ""
const walk = (n: any, fn: (x: any) => void): void => {
  const st = [n]
  while (st.length) { const x = st.pop(); fn(x); const cs = kids(x); for (let i = cs.length - 1; i >= 0; i--) st.push(cs[i]) }
}
const findChild = (n: any, pred: (x: any) => boolean): any | null => kids(n).find(pred) ?? null
const unquote = (s: string): string => s.replace(/^"+|"+$/g, "")

function discover(): { files: string[]; repos: string[] } {
  const found: string[] = []
  const repos: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    let any = false
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!EXTENSIONS.some((x) => low.endsWith(x))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs); any = true
    }
    if (any) repos.push(name)
  }
  found.sort()
  return { files: found, repos }
}

/** A block's type identifier and its string labels, from the grammar's own children. */
function blockHeader(n: any): { type: string; labels: string[] } | null {
  if (n.type !== "block") return null
  const cs = kids(n)
  const id = cs.find((x: any) => x.type === "identifier")
  if (!id) return null
  const labels = cs.filter((x: any) => x.type === "string_lit" || x.type === "quoted_template").map((x: any) => unquote(textOf(x)))
  return { type: textOf(id), labels }
}

/** The block's `body` attributes by key (first occurrence wins, like the analyzer). */
function attrsOf(blockNode: any): Map<string, any> {
  const out = new Map<string, any>()
  const body = findChild(blockNode, (n: any) => n.type === "body")
  if (!body) return out
  for (const c of kids(body)) {
    if (c.type !== "attribute") continue
    const k = findChild(c, (x: any) => x.type === "identifier")
    if (k && !out.has(textOf(k))) out.set(textOf(k), c)
  }
  return out
}

/**
 * The ROOT a value expression is read from: `var.settings` → "var", `local.x` → "local",
 * a collection literal → "collection_value", a call → "function_call", anything else →
 * "other". This is a fact about WHERE the value comes from — a declaration's VALUE is not a
 * member SET, which is the distinction `mixes_in` turns on.
 */
function expressionRoot(attrNode: any): string {
  const expr = findChild(attrNode, (n: any) => n.type === "expression")
  if (!expr) return "missing_expression"
  const value = kids(expr)[0]
  if (!value) return "empty_expression"
  if (value.type === "variable_expr") {
    const id = findChild(value, (n: any) => n.type === "identifier")
    return `variable_root:${id ? textOf(id) : "?"}`
  }
  return value.type
}

/** A single literal string value, or null when the expression is computed. */
function literalPath(attrNode: any): string | null {
  const expr = findChild(attrNode, (n: any) => n.type === "expression")
  if (!expr) return null
  const COMPUTED = new Set(["template_interpolation", "function_call", "variable_expr", "get_attr", "index", "legacy_index", "splat", "attr_splat", "full_splat", "for_expr", "conditional", "binary_operation", "unary_operation"])
  let computed = false
  walk(expr, (x) => { if (COMPUTED.has(x.type)) computed = true })
  if (computed) return null
  let lit: string | null = null
  walk(expr, (x) => { if (lit === null && x.type === "template_literal") lit = textOf(x) })
  return lit
}

const { files } = discover()
// The admitted-extension set of the whole population, per repository, so a written path can be
// answered "is the file this path names inside the admitted population at all?".
const admitted = new Set(files)
const out: any = {
  instrument: "script/m14/hcl-extended-census.ts",
  corpusRoot: CR,
  admissionRule: "git ls-files per git checkout under the corpus root; extensions tf,tfvars,hcl,tofu; 1 MiB cap (the engine's own FULL_AST_LIMIT)",
  population: { files: files.length, repos: discover().repos.length, extensions: EXTENSIONS, sizeCap: SIZE_CAP },
  part_of: {
    includeBlocks: 0,
    noPathAttribute: 0,
    literalPath: 0,
    computedPath: 0,
    literalPresentInPopulation: 0,
    literalAbsentFromPopulation: 0,
    targetFilesOutsideAdmittedExtensions: 0,
    emittedPartOfEdges: null as number | null,
    emittedEdgeFiles: 0,
    emittedFiles: 0,
    includeFiles: [] as string[],
    samples: [] as string[],
    absentSamples: [] as string[],
    computedSamples: [] as string[],
  },
  mixes_in: {
    dynamicBlocks: 0,
    dynamicWithContentBlockChildren: 0,
    dynamicForEachValueRoots: {} as Record<string, number>,
    forEachAttributeSites: 0,
    forEachValueRoots: {} as Record<string, number>,
    lifecycleBlocks: 0,
    provisionerBlocks: 0,
    moduleBlocksWithSource: 0,
    moduleBlocksWithProvidersArgument: 0,
    variableBlocks: 0,
    outputBlocks: 0,
  },
  instantiates: {
    resourceOrDataBlocks: 0,
    distinctResourceTypeLabels: 0,
    labelsDeclaredAsAnAddress: 0,
    labelsDeclaredByKind: {} as Record<string, number>,
    sitesWithCollidingLabel: 0,
    collisionSamples: [] as string[],
    labelsDeclaredAsABlockType: 0,
    targetLabelSamples: [] as string[],
    declaredAddressSamples: [] as string[],
    _why: "the CONSTRUCT occurs but the RELATION binds nothing: no resource/data type label is a declaration in the corpus (a provider type is declared by a provider binary, in no repository)",
  },
  decorates: {
    validationBlocks: 0,
    preconditionOrPostconditionBlocks: 0,
    dependsOnAttributeSites: 0,
    appliedCallableCandidateSites: 0,
    appliedCallableNote: "no HCL construct applies a callable TO a declaration; counted to state the zero as a measurement",
  },
  renders: {
    templatefileCallees: 0,
    templatestringCallees: 0,
    templateDirCallees: 0,
    templateFileOrDirResources: 0,
    quotedTemplateNodes: 0,
    heredocTemplateNodes: 0,
  },
  parse: { filesVisited: 0, parseFailed: 0 },
}

const includeFiles = new Set<string>()
const declaredAddresses = new Set<string>()
const declaringKind = new Map<string, string>()
const resourceTypeLabels = new Map<string, number>()
const blockTypesSeen = new Set<string>()
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { out.parse.parseFailed++; continue }
  let root: any
  try { root = parser.parse(src, f).rootNode } catch { out.parse.parseFailed++; continue }
  out.parse.filesVisited++
  const rel = f.slice(CR.length + 1)
  const dir = path.dirname(f)
  const collectAddress = (h: { type: string; labels: string[] }): string => {
    if (h.type === "resource" || h.type === "data") {
      if (h.labels.length >= 2) return `${h.labels[0]}.${h.labels[1]}`
      if (h.labels.length === 1) return h.labels[0]
      return h.type
    }
    if (h.type === "variable" || h.type === "output" || h.type === "module" || h.type === "provider") {
      return h.labels[0] ?? h.type
    }
    return h.labels.length > 0 ? `${h.type}.${h.labels.join(".")}` : h.type
  }
  walk(root, (n) => {
    if (n.type === "block") {
      const h = blockHeader(n)
      if (!h) return
      const attrs = attrsOf(n)
      if (h.type === "include") {
        includeFiles.add(rel)
        out.part_of.includeBlocks++
        const p = attrs.get("path")
        if (!p) { out.part_of.noPathAttribute++; return }
        const lit = literalPath(p)
        if (lit === null) {
          out.part_of.computedPath++
          if (out.part_of.computedSamples.length < 10) out.part_of.computedSamples.push(`${rel}:${p.startPosition.row + 1} ${textOf(p).slice(0, 80).split("\n").join(" ")}`)
          return
        }
        out.part_of.literalPath++
        const target = path.resolve(dir, lit)
        if (existsSync(target) && admitted.has(target)) {
          out.part_of.literalPresentInPopulation++
          if (out.part_of.samples.length < 10) out.part_of.samples.push(`${rel}: path="${lit}" -> present`)
        } else {
          out.part_of.literalAbsentFromPopulation++
          if (!EXTENSIONS.some((e) => target.toLowerCase().endsWith(e))) out.part_of.targetFilesOutsideAdmittedExtensions++
          if (out.part_of.absentSamples.length < 10) out.part_of.absentSamples.push(`${rel}: path="${lit}" -> absent from the admitted population`)
        }
      }
      if (h.type === "dynamic") {
        out.mixes_in.dynamicBlocks++
        // Does the generated block's own `content` block DECLARE nested members (the loop-over-a-
        // block shape), or is the member set taken from somewhere else (a composer)?
        const content = findChild(n, (x: any) => x.type === "body") ? findChild(findChild(n, (x: any) => x.type === "body"), (x: any) => x.type === "block") : null
        if (content) {
          const cbody = findChild(content, (x: any) => x.type === "body")
          const hasBlock = cbody ? kids(cbody).some((x: any) => x.type === "block") : false
          if (hasBlock) out.mixes_in.dynamicWithContentBlockChildren++
        }
        const fe = attrsOf(n).get("for_each")
        if (fe) {
          const root = expressionRoot(fe)
          out.mixes_in.dynamicForEachValueRoots[root] = (out.mixes_in.dynamicForEachValueRoots[root] ?? 0) + 1
        }
      }
      if (h.type === "lifecycle") out.mixes_in.lifecycleBlocks++
      if (h.type === "provisioner") out.mixes_in.provisionerBlocks++
      if (h.type === "validation") out.decorates.validationBlocks++
      if (h.type === "precondition" || h.type === "postcondition") out.decorates.preconditionOrPostconditionBlocks++
      if (h.type === "module" && attrs.has("source")) out.mixes_in.moduleBlocksWithSource++
      if (h.type === "module" && attrs.has("providers")) out.mixes_in.moduleBlocksWithProvidersArgument++
      if (h.type === "variable") out.mixes_in.variableBlocks++
      if (h.type === "output") out.mixes_in.outputBlocks++
      // `instantiates` census: every resource/data block, its TYPE label, and whether the label is
      // a DECLARATION in the corpus (the only thing that could bind the relation).
      const addr = collectAddress(h)
      declaredAddresses.add(addr)
      if (!declaringKind.has(addr)) declaringKind.set(addr, `${h.type} @ ${rel}:${n.startPosition.row + 1}`)
      if (h.type === "resource" || h.type === "data") {
        out.instantiates.resourceOrDataBlocks++
        const label = h.labels[0]
        if (label) {
          resourceTypeLabels.set(label, (resourceTypeLabels.get(label) ?? 0) + 1)
          if (out.instantiates.targetLabelSamples.length < 10) out.instantiates.targetLabelSamples.push(`${rel}:${n.startPosition.row + 1} ${h.type} "${label}"`)
        }
      }
      blockTypesSeen.add(h.type)
      if (h.type === "resource" && h.labels[0] === "template_file") out.renders.templateFileOrDirResources++
      if (h.type === "data" && (h.labels[0] === "template_file" || h.labels[0] === "template_dir")) out.renders.templateFileOrDirResources++
    }
    if (n.type === "attribute") {
      const k = findChild(n, (x: any) => x.type === "identifier")
      if (k) {
        const key = textOf(k)
        if (key === "for_each") {
          out.mixes_in.forEachAttributeSites++
          const root = expressionRoot(n)
          out.mixes_in.forEachValueRoots[root] = (out.mixes_in.forEachValueRoots[root] ?? 0) + 1
        }
        if (key === "depends_on") out.decorates.dependsOnAttributeSites++
      }
    }
    if (n.type === "function_call") {
      const id = findChild(n, (x: any) => x.type === "identifier" || x.type === "get_attr")
      const name = id ? textOf(id) : ""
      if (name === "templatefile") out.renders.templatefileCallees++
      if (name === "templatestring") out.renders.templatestringCallees++
      if (name === "template_dir") out.renders.templateDirCallees++
    }
    if (n.type === "quoted_template") out.renders.quotedTemplateNodes++
    if (n.type === "heredoc_template") out.renders.heredocTemplateNodes++
  })
}
out.part_of.includeFiles = [...includeFiles].sort()

// THE PRODUCTION PATH, over the files that carry an include: the emitted rows are COUNTED, not
// predicted. Only those files — the whole corpus through parseFile is the arm's job, not this
// instrument's.
let emitted = 0
let emittedFilesWithEdges = 0
for (const rel of out.part_of.includeFiles) {
  const abs = path.join(CR, rel)
  let src: string
  try { src = readFileSync(abs, "utf8") } catch { continue }
  try {
    const res: any = await parseFile(abs, src)
    if (res?.metadata?.fallback === true) continue
    out.part_of.emittedFiles++
    let inThisFile = 0
    for (const r of res.relationships ?? []) {
      if ((r.relationshipType ?? r.type) === "part_of") { emitted++; inThisFile++ }
    }
    if (inThisFile > 0) emittedFilesWithEdges++
  } catch { /* a file the engine refuses contributes no rows; counted by the arm, not here */ }
}
out.part_of.emittedPartOfEdges = emitted
out.part_of.emittedEdgeFiles = emittedFilesWithEdges
// THE `instantiates` DERIVATION: a resource/data type label is bindable only if it is a DECLARATION
// in the corpus. Both readings are counted so the corpus-unexercised `_why` is a measurement rather
// than a claim: 0 of the labels is an address, and 0 of them is even a declared block type.
out.instantiates.distinctResourceTypeLabels = resourceTypeLabels.size
let collidingSites = 0
for (const [label, count] of resourceTypeLabels) if (declaredAddresses.has(label)) collidingSites += count
out.instantiates.sitesWithCollidingLabel = collidingSites
for (const label of resourceTypeLabels.keys()) {
  if (declaredAddresses.has(label)) {
    out.instantiates.labelsDeclaredAsAnAddress++
    const decl = declaringKind.get(label) ?? "?"
    const kind = decl.split(" ")[0]
    out.instantiates.labelsDeclaredByKind[kind] = (out.instantiates.labelsDeclaredByKind[kind] ?? 0) + 1
    if (out.instantiates.collisionSamples.length < 12) out.instantiates.collisionSamples.push(`${label} -> declared by ${decl}`)
    if (out.instantiates.declaredAddressSamples.length < 10) out.instantiates.declaredAddressSamples.push(label)
  }
  if (blockTypesSeen.has(label)) out.instantiates.labelsDeclaredAsABlockType++
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(JSON.stringify({ population: out.population, part_of: { includeBlocks: out.part_of.includeBlocks, noPathAttribute: out.part_of.noPathAttribute, literalPath: out.part_of.literalPath, computedPath: out.part_of.computedPath, literalPresentInPopulation: out.part_of.literalPresentInPopulation, literalAbsentFromPopulation: out.part_of.literalAbsentFromPopulation, emittedPartOfEdges: out.part_of.emittedPartOfEdges, emittedEdgeFiles: out.part_of.emittedEdgeFiles, emittedFiles: out.part_of.emittedFiles, includeFiles: out.part_of.includeFiles.length }, mixes_in: out.mixes_in, instantiates: out.instantiates, decorates: out.decorates, renders: out.renders, parse: out.parse }, null, 2))
if (out.part_of.emittedPartOfEdges !== out.part_of.literalPath) {
  console.error(`CONTROL FAILED: the production path emitted ${out.part_of.emittedPartOfEdges} part_of edge(s) over ${out.part_of.includeFiles.length} include file(s) but ${out.part_of.literalPath} literal path site(s) were counted. One edge per literal site is the contract; a mismatch means the census and the analyzer disagree and neither number can be cited.`)
  process.exit(3)
}
console.log(`CONTROL: emitted ${out.part_of.emittedPartOfEdges} part_of edges = ${out.part_of.literalPath} literal include path sites — exact, so the split's classes are counts of the same population.`)
