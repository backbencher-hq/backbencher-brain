import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)


let _wtsModule: any = null
let _wasmRegistry: Record<string, Uint8Array> = {}

// Try to load WASM into registry on first use
function tryLoadWasm(name: string): void {
  if (_wasmRegistry[name]) return
  
  const paths = [
    // Development: project wasm/ directory
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "wasm", name),
    // Production: ~/.bb/wasm/
    join(homedir(), ".bb", "wasm", name),
  ]
  
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        _wasmRegistry[name] = new Uint8Array(readFileSync(p))
        return
      } catch {}
    }
  }
}

export async function ensureWasmRegistry() {
  const wasmDir = join(__dirname, "..", "..", "wasm")
  if (existsSync(wasmDir)) {
    const files = (await import("node:fs")).readdirSync(wasmDir)
    for (const f of files) {
      if (f.endsWith(".wasm")) {
        try {
          _wasmRegistry[f] = new Uint8Array(readFileSync(join(wasmDir, f)))
        } catch {}
      }
    }
  }
  // Also check ~/.bb/wasm
  const homeWasm = join(homedir(), ".bb", "wasm")
  if (existsSync(homeWasm)) {
    const files = (await import("node:fs")).readdirSync(homeWasm)
    for (const f of files) {
      if (f.endsWith(".wasm") && !_wasmRegistry[f]) {
        try {
          _wasmRegistry[f] = new Uint8Array(readFileSync(join(homeWasm, f)))
        } catch {}
      }
    }
  }
}

export async function loadWebTreeSitter() {
  if (!_wtsModule) {
    _wtsModule = await import("web-tree-sitter")
    await _wtsModule.default.init()
  }
  return _wtsModule
}

export function resolveWasmAsset(name: string): string {
  const wasmName = name.split("/").pop() || name
  
  const paths = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "wasm", wasmName),
    join(homedir(), ".bb", "wasm", wasmName),
    join("$HOME/mcp/backbencher-brain/wasm", wasmName),
  ]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return name
}

export function hasWasmInRegistry(name: string): Uint8Array | undefined {
  const wasmName = name.split("/").pop() || name
  tryLoadWasm(wasmName)
  if (_wasmRegistry[wasmName]) return _wasmRegistry[wasmName]
  // Also try the full name as key
  if (_wasmRegistry[name]) return _wasmRegistry[name]
  // Direct file read as fallback
  const wasmDir = join(require("node:os").homedir(), ".bb", "wasm")
  const localDir = join(__dirname, "..", "..", "wasm")
  for (const dir of [wasmDir, localDir]) {
    const path = join(dir, wasmName)
    if (existsSync(path)) {
      try { const data = new Uint8Array(readFileSync(path)); _wasmRegistry[wasmName] = data; return data } catch {}
    }
  }
  return undefined
}

export function isWasmRegistryLoaded(): boolean {
  return false
}


// Auto-load WASM on module init
(function _autoLoadWasm() {
  const wasmDir = join(__dirname, "..", "..", "wasm")
  if (existsSync(wasmDir)) {
    try {
      const files = readdirSync(wasmDir)
      for (const f of files) {
        if (f.endsWith(".wasm") && !_wasmRegistry[f]) {
          try { _wasmRegistry[f] = new Uint8Array(readFileSync(join(wasmDir, f))) } catch {}
        }
      }
    } catch {}
  }
  const homeWasm = join(homedir(), ".bb", "wasm")
  if (existsSync(homeWasm)) {
    try {
      const files = readdirSync(homeWasm)
      for (const f of files) {
        if (f.endsWith(".wasm") && !_wasmRegistry[f]) {
          try { _wasmRegistry[f] = new Uint8Array(readFileSync(join(homeWasm, f))) } catch {}
        }
      }
    } catch {}
  }
})()
