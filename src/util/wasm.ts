import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { bbWasmCandidates, bbWasmDirs } from "./bb-data-dir"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)


let _wtsModule: any = null
let _wasmRegistry: Record<string, Uint8Array> = {}
let _wasiShimInstalled = false

// WASI preview1 stub. Bun has no node:wasi, and web-tree-sitter's emscripten
// import object lacks the wasi_snapshot_preview1 functions that tree-sitter
// language wasms (built with wasi-libc) import statically — so instantiation
// fails with "import function wasi_snapshot_preview1:clock_time_get must be
// callable". We inject the standard preview1 surface into every instantiate
// call. Most functions are never invoked; the pointer-based ones write into
// the wasm memory when they are.
function installWasiShim(): void {
  if (_wasiShimInstalled) return
  _wasiShimInstalled = true

  // The last-patched imports object. tree-sitter's core and language wasms
  // share one memory object, so this stays valid for both.
  let currentImports: any = null

  const memOf = (): WebAssembly.Memory | undefined => currentImports?.env?.memory
  const view = (): DataView | null => {
    const mem = memOf()
    return mem ? new DataView(mem.buffer) : null
  }
  const writeInt32 = (ptr: number, value: number) => {
    const v = view()
    if (v && Number.isFinite(ptr)) v.setInt32(ptr, value, true)
  }
  const writeBigInt = (ptr: number, value: bigint) => {
    const v = view()
    if (v && Number.isFinite(ptr)) v.setBigUint64(ptr, value, true)
  }

  const wasi: Record<string, (...args: any[]) => number | void> = {
    clock_time_get: (_clockId: number, _precisionPtr: number, timePtr: number) => {
      writeBigInt(timePtr, BigInt(Date.now()) * 1_000_000n)
      return 0
    },
    proc_exit: () => {},
    fd_write: (_fd: number, _iov: number, _iovcnt: number, pnum: number) => {
      writeInt32(pnum, 0)
      return 0
    },
    fd_read: () => -1,
    fd_close: () => 0,
    fd_seek: () => -1,
    fd_fdstat_get: () => -1,
    fd_fdstat_set_flags: () => -1,
    fd_prestat_get: () => -1,
    fd_prestat_dir_name: () => -1,
    fd_sync: () => -1,
    random_get: (buf: number, len: number) => {
      const v = view()
      if (v) for (let i = 0; i < len; i++) v.setUint8(buf + i, Math.floor(Math.random() * 256))
      return 0
    },
    environ_get: () => 0,
    environ_sizes_get: (countPtr: number, sizePtr: number) => {
      writeInt32(countPtr, 0)
      writeInt32(sizePtr, 0)
      return 0
    },
    args_get: () => 0,
    args_sizes_get: (countPtr: number, sizePtr: number) => {
      writeInt32(countPtr, 0)
      writeInt32(sizePtr, 0)
      return 0
    },
    sched_yield: () => 0,
    poll_oneoff: () => 0,
    path_open: () => -1,
    path_filestat_get: () => -1,
    path_filestat_set_times: () => -1,
    path_create_directory: () => -1,
    path_remove_directory: () => -1,
    path_unlink_file: () => -1,
    path_rename: () => -1,
    path_link: () => -1,
    path_symlink: () => -1,
    path_readlink: () => -1,
    path_filestat_set_size: () => -1,
    clock_res_get: (_clockId: number, resPtr: number) => {
      writeBigInt(resPtr, 1_000_000n)
      return 0
    },
  }

  const patchImports = (imports: any): any => {
    if (!imports || typeof imports !== "object") return imports
    currentImports = imports
    if (imports.wasi_snapshot_preview1) {
      imports.wasi_snapshot_preview1 = { ...imports.wasi_snapshot_preview1, ...wasi }
    }
    return imports
  }

  const origInstantiate = WebAssembly.instantiate
  const origInstantiateStreaming = WebAssembly.instantiateStreaming
  ;(WebAssembly as any).instantiate = async (bytes: Uint8Array | ArrayBuffer, imports?: any) => {
    if (imports) imports = patchImports(imports)
    return origInstantiate.call(WebAssembly, bytes, imports)
  }
  ;(WebAssembly as any).instantiateStreaming = async (resp: Response | PromiseLike<Response>, imports?: any) => {
    if (imports) imports = patchImports(imports)
    return origInstantiateStreaming.call(WebAssembly, resp, imports)
  }
}

// Try to load WASM into registry on first use
function tryLoadWasm(name: string): void {
  if (_wasmRegistry[name]) return

  const paths = bbWasmCandidates(dirname(fileURLToPath(import.meta.url)), name)

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
  const dirs = bbWasmDirs(__dirname)
  for (const wasmDir of dirs) {
    if (existsSync(wasmDir)) {
      try {
        const files = (await import("node:fs")).readdirSync(wasmDir)
        for (const f of files) {
          if (f.endsWith(".wasm") && !_wasmRegistry[f]) {
            try {
              _wasmRegistry[f] = new Uint8Array(readFileSync(join(wasmDir, f)))
            } catch {}
          }
        }
      } catch {}
    }
  }
}

export async function loadWebTreeSitter() {
  if (!_wtsModule) {
    installWasiShim()
    _wtsModule = await import("web-tree-sitter")
    const initFn = _wtsModule.default?.init || _wtsModule.init
    if (initFn) {
      // Found live (M61 fork-leg investigation, 2026-09-15): init() with no
      // args lets web-tree-sitter's emscripten glue resolve the CORE wasm as a
      // bare relative path ("open 'tree-sitter.wasm'"), which resolves against
      // the PROCESS CWD. In the bundled server the editors spawn (cwd = the
      // user's workspace) that open fails -> unhandledRejection -> the
      // reindex pipeline completes with indexed: 0 and every file stays stale
      // forever (fork legs 87/88: "marker never returns fresh"). The repo-dev
      // layout masked it: web-tree-sitter stayed external, so the same-dir
      // file resolved via real node_modules paths regardless of cwd.
      //
      // Fix: resolve the core from OUR cwd-independent candidate dirs (the
      // same registry the grammar loader uses) and hand it to the glue both
      // as bytes (wasmBinary) and as an absolute locateFile — either alone
      // removes the cwd dependence; together they also cover a glue version
      // that ignores one of the two hooks.
      const coreName = "tree-sitter.wasm"
      const coreBytes = hasWasmInRegistry(coreName)
      const coreAbs = resolveWasmAsset(coreName)
      const initOptions: Record<string, unknown> = {}
      if (coreBytes) initOptions.wasmBinary = coreBytes
      if (coreAbs !== coreName) initOptions.locateFile = () => coreAbs
      await initFn(initOptions)
    }
  }
  return _wtsModule
}

export function resolveWasmAsset(name: string): string {
  const wasmName = name.split("/").pop() || name

  const paths = bbWasmCandidates(dirname(fileURLToPath(import.meta.url)), wasmName)
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
  const paths = bbWasmCandidates(dirname(fileURLToPath(import.meta.url)), wasmName)
  for (const p of paths) {
    if (existsSync(p)) {
      try { const data = new Uint8Array(readFileSync(p)); _wasmRegistry[wasmName] = data; return data } catch {}
    }
  }
  return undefined
}

export function isWasmRegistryLoaded(): boolean {
  return false
}


// Auto-load WASM on module init
(function _autoLoadWasm() {
  const dirs = bbWasmDirs(__dirname)
  for (const wasmDir of dirs) {
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
  }
})()
