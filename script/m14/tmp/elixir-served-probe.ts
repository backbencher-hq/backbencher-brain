// ELIXIR lane — read the SERVED grammar the way §6 demands: from the resolver's own choice.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolveWasmAsset } from "../../../src/util/wasm"

const p = resolveWasmAsset("tree-sitter-elixir.wasm")
const bytes = readFileSync(p)
console.log("served path:", p)
console.log("served sha256:", createHash("sha256").update(bytes).digest("hex"))
console.log("bytes:", bytes.length)
