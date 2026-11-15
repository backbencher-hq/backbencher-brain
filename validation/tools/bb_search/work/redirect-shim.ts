// Preload shim for Phase-A gate runs: redirect evidence writes into this
// owner's validation area so no shared evidence file is rewritten by an audit.
import * as fs from "node:fs"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const DEST = ROOT + "/validation/tools/bb_search/gates/evidence"
const remap = (p: any): any => {
  if (typeof p !== "string") return p
  for (const sub of ["validation/m13/", "validation/m15/"]) {
    const marker = ROOT + "/" + sub
    const i = p.indexOf(marker)
    if (i !== -1) {
      const rest = p.slice(i + marker.length)
      const out = DEST + "/" + sub.replace(/\//g, "_") + rest
      fs.mkdirSync(out.slice(0, out.lastIndexOf("/")), { recursive: true })
      return out
    }
  }
  return p
}
const origWrite = fs.writeFileSync
;(fs as any).writeFileSync = (p: any, ...rest: any[]) => origWrite(remap(p), ...rest)
console.error("[redirect-shim] active")
