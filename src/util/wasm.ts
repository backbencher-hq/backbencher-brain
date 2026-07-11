// Stub — WASM utilities from backbencher
export async function ensureWasmRegistry() {}
export function resolveWasmAsset(name: string): string { return name }
export async function loadWebTreeSitter() { return (await import("web-tree-sitter")).default }
export function hasWasmInRegistry(name: string): boolean { return false }
export function isWasmRegistryLoaded(): boolean { return true }
