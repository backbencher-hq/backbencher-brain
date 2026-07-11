// Stub — WASM utilities that the backbencher engine expects

let _wtsModule: any = null

export async function ensureWasmRegistry() {}

export async function loadWebTreeSitter() {
  if (!_wtsModule) {
    _wtsModule = await import("web-tree-sitter")
    await _wtsModule.default.init()
  }
  return _wtsModule
}

export function resolveWasmAsset(name: string): string {
  return name
}

export function hasWasmInRegistry(_name: string): boolean {
  return false
}

export function isWasmRegistryLoaded(): boolean {
  return true
}
