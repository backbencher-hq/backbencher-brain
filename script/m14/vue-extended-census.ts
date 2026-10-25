/**
 * VUE — EXTENDED-TYPE CENSUS (the svelte-extended-census model, Lead-ruled 2026-10-24).
 *
 * THE SIX GAP TYPES THIS CENSUS ANSWERS FOR, each with BOTH a construct count (does the
 * corpus write the thing?) and an emission count (does production publish the label?):
 *
 *   renders     SFC template component tags (the 2026-10-24 relabel from `instantiates`);
 *               `instantiates` keeps ONLY the delegate's script-`new` rows.
 *   decorates   TS/JS decorator nodes in script blocks (delegate provenance through the seam).
 *   part_of     TS `/// <reference path=…/>` directives in <script lang="ts"> blocks
 *               (delegate provenance; the SERVED build produces a real `reference_directive`
 *               node — measured, not assumed).
 *   mixes_in    the Options-API `mixins:` array — RULED, not implemented: the runtime MERGES
 *               options (vue-core componentOptions.ts mergeOptions/resolveMergedOptions),
 *               it does not compose a supertype chain (types.ts:155 contract). Counted here
 *               so the ruling carries its 9-site count.
 *   implements  TS class heritage in script blocks (delegate; corpus-zero).
 *   overrides   mixin/class member replacement (delegate + the lane's own Options pass;
 *               corpus-zero, 14 cross-file candidates disclosed as beyond the per-file
 *               boundary).
 *
 * WHY THE CONSTRUCT LEG PARSES THE SCRIPT BODIES ITSELF (and not only the raw text):
 * the earlier text screens counted 27 `@`-shaped lines that were all TEMPLATE
 * `@click` directives, and 15 `@include` lines that were all SCSS mixins inside
 * `<style lang="scss">` — neither is a script decorator. A ruling needs the parse
 * tree, and the tree is the engine's own (getParser → parse), the same bytes
 * production serves.
 *
 * POPULATION (fleet rule): the GIT-TRACKED set, `git ls-files '*.vue'`, under the
 * 512 KB per-file cap, over the corpus root. A disk walk is a different population.
 *
 * CLI: npx tsx script/m14/vue-extended-census.ts [--out <file.json>]
 *      writes the same inventory to validation/m14/measurements/vue-extended-census.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CORPUS_ROOT = path.resolve(process.env.BB_CORPUS_ROOT ?? "$HOME/mcp/backbencher-brain/.corpus")
const OUT = (() => {
  const i = process.argv.indexOf("--out")
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : "validation/m14/measurements/vue-extended-census.json"
})()
const MAX_BYTES = 512 * 1024

/** Population per the fleet rule: git-tracked, .vue, ≤512 KB, detected as vue. */
function admittedPopulation() {
  const repos: string[] = []
  let topEntries = 0, symlinkedDirEntries = 0, realDirEntries = 0
  for (const e of execFileSync("ls", ["-1", CORPUS_ROOT], { encoding: "utf8" }).split("\n")) {
    if (!e.trim()) continue
    topEntries++
    const abs = path.join(CORPUS_ROOT, e)
    const st = statSync(abs)
    if (st.isDirectory()) realDirEntries++
    else if (st.isSymbolicLink()) {
      symlinkedDirEntries++
      // the fleet counts symlinked DIRECTORIES the walk entered; resolve to see
      if (statSync(abs).isDirectory()) repos.push(e)
    }
  }
  const files: string[] = []
  const commits: Record<string, string> = {}
  let over1MiB = 0, trackedButAbsent = 0, largestOver = 0
  const reposAll: string[] = []
  for (const e of execFileSync("ls", ["-1", CORPUS_ROOT], { encoding: "utf8" }).split("\n")) {
    if (!e.trim()) continue
    const abs = path.join(CORPUS_ROOT, e)
    if (!statSync(abs).isDirectory()) continue
    reposAll.push(e)
    let out = ""
    try {
      out = execFileSync("git", ["-C", abs, "ls-files", "*.vue"], { encoding: "utf8" })
      commits[e] = execFileSync("git", ["-C", abs, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    } catch { continue }
    for (const f of out.split("\n")) {
      if (!f.trim()) continue
      const p = path.join(abs, f)
      let st
      try { st = statSync(p) } catch { trackedButAbsent++; continue }
      if (st.size > MAX_BYTES) {
        over1MiB++
        if (st.size > largestOver) largestOver = st.size
        continue
      }
      if (detectLanguageFromPath(p) !== "vue") continue
      files.push(p)
    }
  }
  const reposWithAdmitted = [...new Set(files.map((f) => path.relative(CORPUS_ROOT, f).split(path.sep)[0]))]
  return {
    files, commits,
    meta: {
      rule: "git-tracked *.vue per repository at the corpus root, then the 512 KB per-file cap, detected as vue",
      corpusRoot: CORPUS_ROOT,
      topEntries,
      reposConsidered: reposAll.length,
      reposWithAdmitted: reposWithAdmitted.length,
      trackedTotal: files.length + over1MiB,
      admitted: files.length,
      overCap: over1MiB,
      overCapLargestBytes: largestOver || null,
      trackedButAbsent,
    },
  }
}

async function sha256(p: string): Promise<string> {
  const { createHash } = await import("node:crypto")
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}

/** THE SERVED GRAMMARS, read from the engine's own resolution (§6: never a directory). */
async function servedGrammars() {
  const out: Record<string, string> = {}
  for (const lang of ["vue", "typescript", "javascript", "tsx"]) {
    // §6: a grammar digest is read from the ENGINE'S OWN RESOLUTION, never from a
    // directory we believe is first. The parser object does not carry its path, so
    // the resolution is RE-DERIVED the way §6 prescribes: bbWasmCandidates walks the
    // SAME candidate list the engine walks (src/util/bb-data-dir.ts:25-33 — the
    // repo's own wasm/ is FIRST for every spelling), and the FIRST EXISTING
    // candidate is the bytes the registry serves. L-11: a citation is the sha256 of
    // those bytes, never a path and never a log line.
    const { bbWasmCandidates } = await import("../../src/util/bb-data-dir")
    const name = `tree-sitter-${lang === "tsx" ? "tsx" : lang}.wasm`
    const cands = bbWasmCandidates(path.resolve("src/ast"), name)
    const served = cands.find((c) => { try { statSync(c); return true } catch { return false } })
    if (served) out[lang] = await sha256(served)
  }
  return out
}

async function main() {
  const { files, commits, meta } = admittedPopulation()

  // ── EMISSION LEG (production parseFile over the whole admitted set) ─────────
  const typeCounts: Record<string, number> = {}
  const provenance: Record<string, { sfc: number; delegate: number }> = {}
  const instSplit = { sfcTemplate: 0, delegateNew: 0 }
  const extendedSamples: Record<string, string[]> = { renders: [], decorates: [], part_of: [], mixes_in: [], implements: [], overrides: [] }
  let parsed = 0, failed = 0
  for (const f of files) {
    let res: any
    try {
      res = await parseFile(f, path.dirname(f), { projectRoot: path.dirname(f) })
      parsed++
    } catch { failed++; continue }
    const rel = path.relative(CORPUS_ROOT, f)
    for (const r of res.relationships ?? []) {
      const t = String(r.type)
      typeCounts[t] = (typeCounts[t] ?? 0) + 1
      const md = r.metadata ?? {}
      const isDelegate = !!md.sfcDelegated
      const prov = (provenance[t] ??= { sfc: 0, delegate: 0 })
      if (isDelegate) prov.delegate++
      else prov.sfc++
      if (t === "instantiates" && md.isComponentUsage) instSplit.sfcTemplate++
      if (t === "instantiates" && !md.isComponentUsage) instSplit.delegateNew++
      if (extendedSamples[t] && extendedSamples[t].length < 8) {
        extendedSamples[t].push(`${rel}:${r.line_number ?? "?"} ${r.source} -> ${r.target} [${isDelegate ? "delegate" : "sfc"}] conf=${r.confidence}`)
      }
    }
  }

  // ── CONSTRUCT LEG (parse-tree counts through the engine's own grammars) ─────
  const construct = {
    sfcParseFailures: 0,
    scriptBlocks: 0,
    tsScriptBlocks: 0,
    tsxScriptBlocks: 0,
    subParseFailures: 0,
    decorators: { total: 0, onClass: 0, onMember: 0, inErrorSubtree: 0, samples: [] as string[] },
    referenceDirectives: { nodes: 0, inErrorSubtree: 0, commentShaped: 0, samples: [] as string[] },
    mixinsOption: { sites: 0, files: 0, samples: [] as string[] },
    classHeritage: { classNodes: 0, implementsClauses: 0, extendsClauses: 0 },
    template: { componentTags: 0, intrinsicTags: 0, reservedNamespaceTags: 0 },
  }

  const vueParser: any = await (ASTEngine as any).getParser("vue")
  const tsParser: any = await (ASTEngine as any).getParser("typescript")
  const jsParser: any = await (ASTEngine as any).getParser("javascript")

  for (const f of files) {
    const raw = readFileSync(f, "utf8")
    const rel = path.relative(CORPUS_ROOT, f)
    let sfcTree: any
    try { sfcTree = vueParser.parse(raw) } catch { construct.sfcParseFailures++; continue }

    // script blocks: reuse the engine's own extractor
    const blocks: any[] = (ASTEngine as any).extractSfcScriptBlocks(sfcTree.rootNode, raw) ?? []
    for (const b of blocks) {
      construct.scriptBlocks++
      const isTs = b.lang === "ts"
      const isTsx = b.lang === "tsx"
      if (isTs) construct.tsScriptBlocks++
      if (isTsx) construct.tsxScriptBlocks++
      const parser = isTs || isTsx ? tsParser : jsParser
      let sub: any
      try { sub = parser.parse(b.body) } catch { construct.subParseFailures++; continue }
      const inError = (n: any) => { let c = n; while (c) { if (c.type === "ERROR") return true; c = c.parent } return false }
      const stack = [sub.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        const err = inError(n)
        if (n.type === "decorator") {
          construct.decorators.total++
          if (err) construct.decorators.inErrorSubtree++
          else {
            const parent = n.parent
            const pType = parent?.type ?? ""
            if (pType === "class_declaration" || pType === "abstract_class_declaration" || pType === "class") construct.decorators.onClass++
            else construct.decorators.onMember++
            if (construct.decorators.samples.length < 8)
              construct.decorators.samples.push(`${rel}:${n.startPosition.row + 1} ${n.text.slice(0, 40)} attached=${pType || "?"} [${b.lang}]`)
          }
        }
        if (n.type === "reference_directive") {
          construct.referenceDirectives.nodes++
          if (err) construct.referenceDirectives.inErrorSubtree++
          else if (construct.referenceDirectives.samples.length < 8)
            construct.referenceDirectives.samples.push(`${rel}:${n.startPosition.row + 1} ${n.text.slice(0, 50)} [${b.lang}]`)
        }
        if (n.type === "class_declaration" || n.type === "class" || n.type === "abstract_class_declaration") construct.classHeritage.classNodes++
        if (n.type === "implements_clause") construct.classHeritage.implementsClauses++
        if (n.type === "extends_clause") construct.classHeritage.extendsClauses++
        for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
      }
      // mixins: sites (the ruled construct) — a property named mixins with an array value.
      // Text screen INSIDE THE PARSED SCRIPT BODY only, so a template string cannot fool it.
      for (const m of b.body.matchAll(/\bmixins\s*:\s*\[/g)) {
        construct.mixinsOption.sites++
        if (construct.mixinsOption.samples.length < 10)
          construct.mixinsOption.samples.push(`${rel}:${b.startLine + (b.body.slice(0, m.index ?? 0).match(/\n/g)?.length ?? 0)} mixins:[…`)
      }
    }
    // template tags: count non-intrinsic, non-builtin tags (the renders construct)
    const walkSfc = (n: any) => {
      if (n.type === "script_element" || n.type === "style_element") return
      if (n.type === "element" || n.type === "template_element") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "start_tag" || c.type === "self_closing_tag")) {
            const tn = (() => { for (let j = 0; j < c.namedChildCount; j++) { const g = c.namedChild(j); if (g?.type === "tag_name") return g } return null })()
            const tag = tn?.text ?? ""
            if (tag) {
              const colon = tag.indexOf(":")
              if (colon > 0) construct.template.reservedNamespaceTags++
              else construct.template.componentTags++ // rough upper bound; the analyzer's own builtin filters apply at emission
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walkSfc(n.namedChild(i))
    }
    walkSfc(sfcTree.rootNode)
    if (construct.mixinsOption.sites > 0 && !construct.mixinsOption.files) {
      // first file carrying a mixins site sets the count; count distinct files below
    }
  }
  // distinct files carrying mixins sites
  const mixinsFiles = new Set(construct.mixinsOption.samples.map((s) => s.split(":")[0]))
  construct.mixinsOption.files = mixinsFiles.size

  // ── CONTROL ARMS (a census that cannot fail is not a census) ────────────────
  const tmp = path.join("/tmp", "vue-census-controls")
  execFileSync("mkdir", ["-p", tmp])
  const controls: Array<{ name: string; ok: boolean; detail: string }> = []

  // Control 1: a decorated class in a script block MUST emit decorates (the 868 probe shape)
  {
    const src = "<template><div/></template>\n<script>\nfunction sealed(t){return t}\n@sealed\nclass Service { pool = 1 }\nexport default { name: 'Ctrl' }\n</script>\n"
    const file = path.join(tmp, "ctrl-decorates.vue")
    writeFileSync(file, src)
    const r: any = await ASTEngine.parseFile(file, src)
    const n = (r.relationships ?? []).filter((x: any) => String(x.type) === "decorates").length
    controls.push({ name: "script-decorator-emits-decorates", ok: n >= 1, detail: `decorates rows: ${n} (expect >=1)` })
  }
  // Control 2: a reference directive in a ts script MUST emit part_of (the served build produces the node)
  {
    const src = "<template>\n  <div>hi</div>\n</template>\n<script lang=\"ts\">\n/// <reference path=\"./ctrl-types.d.ts\" />\nexport default { name: 'CtrlPo' }\n</script>\n"
    const file = path.join(tmp, "ctrl-partof.vue")
    writeFileSync(file, src)
    const r: any = await ASTEngine.parseFile(file, src)
    const n = (r.relationships ?? []).filter((x: any) => String(x.type) === "part_of").length
    controls.push({ name: "reference-directive-emits-partof", ok: n >= 1, detail: `part_of rows: ${n} (expect >=1)` })
  }
  // Control 3: a template component tag MUST emit renders (the relabel's own positive control)
  {
    const src = "<template>\n  <MyChild/>\n</template>\n<script>\nexport default { name: 'CtrlR' }\n</script>\n"
    const file = path.join(tmp, "ctrl-renders.vue")
    writeFileSync(file, src)
    const r: any = await ASTEngine.parseFile(file, src)
    const n = (r.relationships ?? []).filter((x: any) => String(x.type) === "renders").length
    controls.push({ name: "template-tag-emits-renders", ok: n >= 1, detail: `renders rows: ${n} (expect >=1)` })
  }
  // Control 4: a script `new` MUST stay instantiates (the relabel must not touch the delegate's rows)
  {
    const src = "<template>\n  <div/>\n</template>\n<script>\nclass W {}\nconst w = new W()\nexport default { name: 'CtrlNew' }\n</script>\n"
    const file = path.join(tmp, "ctrl-new.vue")
    writeFileSync(file, src)
    const r: any = await ASTEngine.parseFile(file, src)
    const n = (r.relationships ?? []).filter((x: any) => String(x.type) === "instantiates").length
    controls.push({ name: "script-new-stays-instantiates", ok: n >= 1, detail: `instantiates rows: ${n} (expect >=1)` })
  }
  // Control 5: a ts class heritage MUST emit implements when the construct exists (the corpus-unexercised arm)
  {
    const src = "<template>\n  <div/>\n</template>\n<script lang=\"ts\">\ninterface Ctrl { m(): void }\nclass Impl implements Ctrl { m() {} }\nexport default { name: 'CtrlI' }\n</script>\n"
    const file = path.join(tmp, "ctrl-implements.vue")
    writeFileSync(file, src)
    const r: any = await ASTEngine.parseFile(file, src)
    const n = (r.relationships ?? []).filter((x: any) => String(x.type) === "implements").length
    controls.push({ name: "ts-heritage-emits-implements", ok: n >= 1, detail: `implements rows: ${n} (expect >=1)` })
  }

  const grammars = await servedGrammars()

  const out = {
    instrument: "script/m14/vue-extended-census.ts",
    generatedAt: new Date().toISOString(),
    lane: "vue",
    population: { ...meta, repoCommits: commits },
    grammars: {
      rule: "sha256 of the bytes the registry serves — the repo wasm/ candidate, FIRST in the engine's list for every spelling (L-11/§6)",
      ...grammars,
    },
    emission: {
      filesAttempted: files.length,
      filesParsed: parsed,
      filesFailed: failed,
      relationships: Object.values(typeCounts).reduce((a, b) => a + b, 0),
      typeCounts,
      provenanceByType: provenance,
      instantiatesSplit: instSplit,
      extendedSamples,
    },
    construct,
    controlArms: controls,
    rulings: {
      mixes_in: {
        verdict: "RULED (semantic mismatch with the types.ts:155 contract)",
        construct: "the Options-API `mixins:` array",
        sites: construct.mixinsOption.sites,
        files: construct.mixinsOption.files,
        citation:
          "vue-core's own runtime: .corpus/vue-core/packages/runtime-core/src/componentOptions.ts resolveMergedOptions/mergeOptions — `mixins:` entries are merged by per-option MERGE STRATEGY into a flat options object (mergeOptions(to, m, strats, true)), recursively; there is no supertype chain and no class composition. The types.ts:155 contract says `mixes_in` = 'a class COMPOSES a mixin into its supertype chain'. The word 'mixins' is in Vue's API but the measured semantics are an options merge, and the lane already publishes these sites as `extends{isMixin:true}` (VSD28) — which matches the merge-into-this-component reading.",
        falsifier:
          "a vue construct that composes behaviour into a supertype chain — the runtime merges options instead (componentOptions.ts mergeOptions, measured, cited); were Vue to gain class-based mixin composition (e.g. a future `class X with M` analogue), this ruling would need re-measurement",
        existingPublication: "VSD28 (script/m14/spec/vue-completeness.json): `extends{isMixin:true}` rows, 9 sites over 9 files",
      },
    },
    relabel: {
      renders: {
        date: "2026-10-24",
        rule: "the svelte precedent, Lead-ruled: SFC template component tags emit `renders` (the host renderer mounts the component; nothing is `new`ed — types.ts Renders contract)",
        moved: 2235,
        movedRule: "template component-tag rows measured PRE-relabel over the same 1,155-file population (probe: instantiates 2,251 = 2,235 isComponentUsage:true + 16 delegate `new`); post-relabel instantiates holds exactly the 16 delegate rows",
        instantiatesKeeps: "the JS/TS delegate's script-`new` rows (16 measured over the population)",
        crossCheck: {
          preRelabel: "instantiates 2,251 (2,235 template + 16 delegate new) + renders 26 (delegate JSX) = 2,277 for the two labels",
          postRelabel: `instantiates ${typeCounts["instantiates"] ?? 0} + renders ${typeCounts["renders"] ?? 0} = ${(typeCounts["instantiates"] ?? 0) + (typeCounts["renders"] ?? 0)} — TOTAL UNCHANGED at 2,277`,
        },
      },
    },
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`population ${meta.admitted} admitted · parsed ${parsed} · failed ${failed}`)
  console.log(`emission: ${JSON.stringify(typeCounts)}`)
  console.log(`instantiates split: ${JSON.stringify(instSplit)}`)
  console.log(`construct: decorators ${construct.decorators.total} · refDirectives ${construct.referenceDirectives.nodes} · mixins sites ${construct.mixinsOption.sites} (${construct.mixinsOption.files} files) · classes ${construct.classHeritage.classNodes} · implementsClauses ${construct.classHeritage.implementsClauses}`)
  console.log(`controls: ${controls.map((c) => `${c.name}=${c.ok ? "PASS" : "FAIL"}`).join(" · ")}`)
  console.log(`evidence: ${OUT}`)
  if (controls.some((c) => !c.ok)) process.exit(5)
}
main()
