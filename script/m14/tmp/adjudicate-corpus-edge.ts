// Adjudication probe — is an F5 `missing`/`unexplained` sample a ROTATION artifact
// (the drawn file set changed, so the baseline has no opinion) or a REGRESSION
// (the same file, the same edge, emitted before and not now)?
//
// It reads only the analyzer under `--root=` (the thing on trial) and prints; the
// author adjudicates. `--label=` filters, `--from=` narrows to one source.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "<corpus-root>/mcp/backbencher-brain"
const ABS = process.argv.find((a) => a.startsWith("--abs="))?.slice("--abs=".length) ?? ""
const LABEL = process.argv.find((a) => a.startsWith("--label="))?.slice("--label=".length)
const FROM = process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length)

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const text = readFileSync(ABS, "utf8")
  const lines = text.split("\n")
  const res: any = await ASTEngine.parseFile(ABS, text)
  const rels: any[] = res?.relationships ?? []
  const hit = rels.filter(
    (r) => (!LABEL || r.type === LABEL) && (!FROM || String(r.source).includes(FROM)),
  )
  console.log(
    `root=${ROOT}  file=${path.basename(ABS)}  relationships=${rels.length}  matching=${hit.length}  (label=${LABEL ?? "*"} from=${FROM ?? "*"})`,
  )
  for (const r of hit) {
    const ln = typeof r.line_number === "number" ? r.line_number : null
    const src = ln ? (lines[ln - 1] ?? "").trim().slice(0, 70) : ""
    console.log(
      `  ${String(r.type).padEnd(13)} ${String(r.source).padEnd(24)} -> ${String(r.target).padEnd(26)} line=${String(ln).padStart(3)} | ${src}`,
    )
  }
}

main()
