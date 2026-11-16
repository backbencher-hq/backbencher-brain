// Reproduce the F5 javascript-lane comparison semantics for the chain shape.
// The lane's truth = deriveTreeEdges(root, 'javascript') + deriveJavaScriptEdges(root).
// The analyzer-side filter: which labels get compared for javascript?
import { spawnSync } from "child_process"
const r = spawnSync("grep", ["-n", 'lang === "javascript"', "script/m14/differential.ts"], { cwd: "<corpus-root>/mcp/backbencher-brain", encoding: "utf8" })
console.log(r.stdout)
