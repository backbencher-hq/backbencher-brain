import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

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

export async function ensureWasmRegistry() {}

export async function loadWebTreeSitter() {
  if (!_wtsModule) {
    _wtsModule = await import("web-tree-sitter")
    await _wtsModule.default.init()
  }
  return _wtsModule
}

export function resolveWasmAsset(name: string): string {
  // Return path to WASM file
  const wasmName = name.split("/").pop() || name
  tryLoadWasm(wasmName)
  const devPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "wasm", wasmName)
  if (existsSync(devPath)) return devPath
  return name
}

export function hasWasmInRegistry(name: string): Uint8Array | undefined {
  const wasmName = name.split("/").pop() || name
  tryLoadWasm(wasmName)
  return _wasmRegistry[wasmName]
}

export function isWasmRegistryLoaded(): boolean {
  return true
}
