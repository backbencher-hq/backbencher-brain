// CONTROL for the `degraded` test: the gate counts a fallback as degraded when
// `result.fallback === true` OR `metadata.analysisVersion === "2.0-basic-fallback"`. If neither can
// fire on this lane's extension, then `degraded 0` on yaml is SILENCE, not a reading — which is
// exactly the false negative the markdown finding warns about (its run read `degraded 2` while 9,057
// files fell back). This drives the fallback path deliberately with a >1 MB document, which
// `pool-worker` answers structurally (`FULL_AST_LIMIT`), and checks the gate's own predicate fires.
const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const r: any = await parseFile(`${REPO}/.tmp-yaml/control-big.yml`, REPO, { projectRoot: REPO } as any)
const gatePredicate = r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback"
console.log(`fallback                    : ${r.fallback}`)
console.log(`metadata.analysisVersion    : ${r.metadata?.analysisVersion}`)
console.log(`symbols ${r.symbols?.length} · relationships ${r.relationships?.length}`)
console.log(gatePredicate
  ? "CONTROL PASS — the gate's own `degraded` predicate FIRES on a fallback result, so `degraded 0` on a walk is a READING and not silence."
  : "CONTROL FAIL — the gate's predicate did NOT fire on a fallback result; `degraded 0` cannot be trusted on this lane.")
