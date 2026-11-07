/**
 * Verify the Evidence Atlas datasets. This is the gate that can fail.
 *
 * The datasets are composed by `script/hero/generate-hero-data.ts` from verbatim
 * bb CLI responses (bb_analyze dependencies + bb_impact) against the local index;
 * the composition embeds the input response digests and a self digest over the
 * whole document. This verifier re-derives the self digest from the evidence
 * document, cross-checks the render document against it, and refuses placeholder,
 * hand-edited or out-of-sync data.
 *
 * Run: npx tsx script/atlas/verify-atlas.ts
 */
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const REPO = path.resolve(import.meta.dirname, "../..")
const DATA = path.join(REPO, "website/src/data/atlas")
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

let failures = 0
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`)
  if (!ok) failures += 1
}

const evidence = JSON.parse(fs.readFileSync(path.join(DATA, "hero-data.generated.json"), "utf8"))
const render = JSON.parse(fs.readFileSync(path.join(DATA, "hero-map.generated.json"), "utf8"))

check("evidence schema is the living-graph dataset", evidence.schema === "bb-living-graph/2", String(evidence.schema))
check("render schema version is 2", render.v === 2, String(render.v))
check("no placeholder digest", typeof render.digest === "string" && !/placeholder/i.test(render.digest), String(render.digest))
check("no placeholder answer copy", !/placeholder/i.test(JSON.stringify(render.answer ?? {})), "answer copy mentions placeholder")

const body = JSON.stringify({
  ...evidence,
  provenance: { ...evidence.provenance, digests: { ...evidence.provenance.digests, self: undefined } },
})
const recomputed = sha256(body)
check("self digest recomputes from the evidence document", recomputed === evidence.provenance?.digests?.self, `${recomputed} vs ${evidence.provenance?.digests?.self}`)
check("render digest equals evidence self digest", render.digest === evidence.provenance?.digests?.self, `${render.digest} vs ${evidence.provenance?.digests?.self}`)

const tools = evidence.provenance?.tools ?? []
check("provenance names both bb tools with response digests",
  tools.length === 2 && tools.every((t: { tool?: string; sha256?: string }) => /^bb_/.test(String(t.tool)) && /^[0-9a-f]{64}$/.test(String(t.sha256))),
  JSON.stringify(tools.map((t: { tool?: string }) => t.tool)))

const modules = evidence.provenance?.map?.modules
const importEdges = evidence.provenance?.map?.importEdges
check("map counts agree with provenance", render.nodes?.length === modules && render.edges?.length === importEdges,
  `render ${render.nodes?.length}/${render.edges?.length} vs provenance ${modules}/${importEdges}`)
check("render contains no invented cluster ids", render.nodes.every((n: { c: number }) => Number.isInteger(n.c) && n.c >= 0 && n.c < render.clusters.length))
check("every edge references real nodes", render.edges.every((e: { a: number; b: number }) => e.a >= 0 && e.a < render.nodes.length && e.b >= 0 && e.b < render.nodes.length))

const counted = render.answer?.counted ?? {}
check("answer numbers are integers", ["dependents", "direct", "files", "hops"].every((k) => Number.isInteger(counted[k])), JSON.stringify(counted))
const chips = render.answer?.chips ?? []
check("answer chips carry file:line and a tier", chips.length >= 2 && chips.every((c: { file?: string; line?: number; tier?: string }) => !!c.file && Number.isInteger(c.line) && !!c.tier), JSON.stringify(chips.map((c: { file?: string }) => c.file)))

if (failures > 0) {
  console.error(`\nATLAS GATE: FAILED (${failures} check${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log(`\nATLAS GATE: VERIFIED — ${render.nodes.length} modules, ${render.edges.length} import edges, digest ${render.digest.slice(0, 16)}…`)
