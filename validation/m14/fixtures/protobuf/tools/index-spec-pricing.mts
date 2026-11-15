/**
 * PRICE THE PROTobuf INDEX SPEC — condition 1 of the landing: what does indexing add to production,
 * and does it REACH the edges the arm exists for?
 *
 * Two questions, measured together because either alone is misleading:
 *   1. COST: how long does building a protobuf index take, over the corpus' .proto files, and how
 *      many names does it produce?
 *   2. REACH: with the Solidity default spec (what an entry in PROJECT_INDEX_EXTENSIONS would use
 *      TODAY, since `specByLang` has no protobuf entry) do the candidates the walk builds appear in
 *      `symbolNames`? With a protobuf-shaped spec, do they?
 *
 * A low ceiling from a rule that GUESSES is a ruling; one that reaches an EXISTING declaration is a
 * fix. This measures which one an index spec would buy, before anything is landed.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const mod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const wasm = path.join(ROOT, "wasm", "tree-sitter-protobuf.wasm")

/** A protobuf-shaped spec: the declaration kinds protobuf has, and a name resolver that JOINS THE
 *  PACKAGE, because that is the spelling `resolveViaImports` builds as its candidate. */
const PROTOBUF_SPEC = {
  // `memberNodes` and `baseNodes` are REQUIRED by the builder (`spec.memberNodes.includes(...)`),
  // so a spec that lists only `typeNodes` throws rather than indexing nothing. protobuf has no
  // members and no bases in the index's sense: a field is not a member of a TYPE the way a method is,
  // and protobuf has no inheritance at all — which is exactly why its `extends`/`implements` columns
  // are empty and why those two arrays are empty here rather than borrowed from Solidity.
  typeNodes: { message: "class", enum: "enum", service: "interface" },
  memberNodes: [] as string[],
  baseNodes: [] as string[],
  /**
   * THE GRAMMAR DOES NOT PUT A DECLARATION'S NAME IN A `name` FIELD: `message Foo { }` is a
   * `message` node whose FIRST named child is `message_name` (`enum`/`rpc`/`service` behave the
   * same). The generic extractor reads `childForFieldName("name")`, which returns undefined for all
   * of them — so a spec that only listed `typeNodes` would index the right SHAPE and hold NOTHING,
   * which is what the first run of this probe measured (0 names, twice).
   *
   * The package is JOINED because that is the spelling the walk builds as its candidate:
   * `hashicorp.consul.internal.common.EnterpriseMeta`, not `EnterpriseMeta`.
   */
  nameResolver: (n: any) => {
    const own = (n.namedChildren ?? []).find((c: any) => String(c.type).endsWith("_name"))?.text
      ?? n.childForFieldName("name")?.text ?? ""
    if (own.length === 0) return ""
    // THE `package` NODE IS A **SIBLING** OF THE DECLARATION, NOT AN ANCESTOR: a `.proto` file is
    // `source_file > (syntax, package, import…, message…)`, so walking `n.parent` upward NEVER sees
    // it and the first version of this resolver produced bare names — which is why the candidate
    // `hashicorp.consul.internal.common.EnterpriseMeta` read ABSENT while the index held 6,377 names.
    // The package is read from the ROOT's own children.
    let root: any = n
    while (root.parent !== null && root.parent !== undefined) root = root.parent
    const pkgs: string[] = []
    for (const c of root.namedChildren ?? []) {
      if (c.type !== "package") continue
      const t = String(c.text ?? "").replace(/^\s*package\s+/, "").replace(/;\s*$/, "").trim()
      if (t.length > 0) pkgs.push(t)
    }
    return pkgs.length > 0 ? `${pkgs.join(".")}.${own}` : own
  },
}

const repos: { dir: string; protos: string[] }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const protos: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".proto")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    protos.push(abs)
  }
  protos.sort()
  if (protos.length > 0) repos.push({ dir, protos })
}

let totalFiles = 0, totalMsSolidity = 0, totalMsProto = 0
let namesSolidity = 0, namesProto = 0, allProtoNames = new Set<string>()
const rows: string[] = []
for (const { dir, protos } of repos) {
  const t0 = Date.now()
  const a = await mod.buildProjectIndexFromDisk(wasm, protos, mod.SOLIDITY_DECLARATION_SPEC)
  const msA = Date.now() - t0
  const t1 = Date.now()
  const b = await mod.buildProjectIndexFromDisk(wasm, protos, PROTOBUF_SPEC)
  const msB = Date.now() - t1
  totalFiles += protos.length; totalMsSolidity += msA; totalMsProto += msB
  namesSolidity += a.symbolNames.size; namesProto += b.symbolNames.size
  for (const n of b.symbolNames) allProtoNames.add(n)
  if (rows.length < 8 || protos.length > 20) {
    rows.push(`  ${path.basename(dir).padEnd(24)} ${String(protos.length).padStart(5)} protos · solidity-spec ${String(a.symbolNames.size).padStart(6)} names ${String(msA).padStart(6)}ms · protobuf-spec ${String(b.symbolNames.size).padStart(6)} names ${String(msB).padStart(6)}ms · types ${b.typeKinds.size}`)
  }
}
console.log(`protobuf index-spec pricing — corpus whole population, ${repos.length} repos, ${totalFiles} .proto files`)
for (const r of rows) console.log(r)
console.log(`\nCOST: solidity default ${totalMsSolidity}ms total (${Math.round(totalMsSolidity / Math.max(1, totalFiles))}ms/file) · protobuf spec ${totalMsProto}ms total (${Math.round(totalMsProto / Math.max(1, totalFiles))}ms/file)`)
console.log(`NAMES: solidity default ${namesSolidity} · protobuf spec ${namesProto}`)

// THE FALSIFIER'S CANDIDATES: the shapes the walk builds and discards.
const candidates = [
  "hashicorp.consul.internal.common.EnterpriseMeta",
  "hashicorp.consul.internal.configentry.EnterpriseMeta",
]
const negatives = [
  "xds.data.orca.v3.OrcaLoadReport", "sls.asfd.asfd.JsonFormat", "sls.asfd.asfd.CustomType",
  "grpc.testing.duplicate.EchoRequest", "grpc.testing.duplicate.EchoResponse",
  "github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo",
]
console.log(`\nREACH — the falsifier's candidates in the protobuf-spec key space:`)
for (const c of candidates) console.log(`  ${c}: ${allProtoNames.has(c) ? "PRESENT" : "absent"}`)
console.log(`\nNEGATIVE CONTROL — declared NOWHERE, must stay absent:`)
for (const n of negatives) console.log(`  ${n}: ${allProtoNames.has(n) ? "PRESENT (over-reaching!)" : "absent (correct)"}`)
