// THE HOLE PROBE — run this to check the bounded descent end to end, through `parseFile`.
//   npx tsx validation/m14/fixtures/scss/recovery-cap-probe.mts
// Expected on the pathological file: ~13 s, 30 symbols, 37 relationships, `fallback: false`, and a
// disclosure on a RELATIONSHIP's metadata (symbol metadata does not survive `parseFile`):
//   {cap: 10000, errorNodes: 1, errorChildren: 43808, visited: 10000, skipped: 33808}
// Before the bound this call returned 0 symbols / 0 relationships after the engine aborted at 120 s.
import { parseFile } from "../../../../src/ast/pool-worker"
const F = "/home/ishaq2321/bb_tests/repositories/bulma/docs/vendor/fontawesome-free-6.5.2-web/scss/_variables.scss"
const t = Date.now()
const r: any = await parseFile(F, "/home/ishaq2321/bb_tests/repositories/bulma", { projectRoot: "/home/ishaq2321/bb_tests/repositories/bulma" } as any)
console.log(`HOLE FILE through parseFile: ${Date.now() - t}ms | symbols ${(r.symbols ?? []).length} rels ${(r.relationships ?? []).length} | fallback ${r.fallback === true}`)
const caps = (r.relationships ?? []).map((x: any) => x.metadata?.scssRecoveryCap ?? x.metadata?.cssRecoveryCap).filter(Boolean)
console.log("disclosure:", JSON.stringify(caps))
