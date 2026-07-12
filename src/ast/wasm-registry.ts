// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
// Lazily loads tree-sitter grammar WASM files so Bun.build embeds them as Uint8Array.
// In dev mode, imports return metadata blobs — registry stays empty, resolveWasm() handles filesystem paths.

let _registry: Record<string, Uint8Array> | null = null
let _loading: Promise<void> | null = null

export function isRegistryLoaded(): boolean {
  return _registry !== null
}

export async function ensureRegistry(): Promise<void> {
  if (_registry) return
  if (_loading) return _loading

  // Only load static imports in compiled binary (Bun embeds WASM as real Uint8Array)
  // In dev mode, imports return metadata blobs (115 bytes), not real WASM
  // BUG FIX: BB_POOL_WORKER_PATH is a Bun.build compile-time define (bare identifier),
  // NOT a globalThis property. Using globalThis.BB_POOL_WORKER_PATH always returns
  // undefined → registry never loaded → Kotlin/Swift/Lua files hang on fs.readFileSync.
  if (typeof (BB_POOL_WORKER_PATH as any) === "undefined") {
    return
  }

  _loading = (async () => {
    const registry: Record<string, Uint8Array> = {}

    const read = async (mod: any, key: string) => {
      try {
        const val = mod.default
        if (typeof val === "string") {
          registry[key] = new Uint8Array(await Promise.race([
            Bun.file(val).bytes(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
          ]))
        } else if (val instanceof Uint8Array) {
          registry[key] = val
        } else if (ArrayBuffer.isView(val)) {
          registry[key] = new Uint8Array((val as ArrayBufferView).buffer)
        }
      } catch {}
    }

    // Load all WASM grammars with a 30s total timeout.
    // If timeout fires, proceed with whatever grammars loaded.
    await Promise.race([
      Promise.allSettled([
      import("web-tree-sitter/tree-sitter.wasm").then((m) => read(m, "tree-sitter.wasm")),
      import("tree-sitter-javascript/tree-sitter-javascript.wasm").then((m) => read(m, "tree-sitter-javascript/tree-sitter-javascript.wasm")),
      import("tree-sitter-typescript/tree-sitter-typescript.wasm").then((m) => read(m, "tree-sitter-typescript/tree-sitter-typescript.wasm")),
      import("tree-sitter-typescript/tree-sitter-tsx.wasm").then((m) => read(m, "tree-sitter-typescript/tree-sitter-tsx.wasm")),
      import("tree-sitter-bash/tree-sitter-bash.wasm").then((m) => read(m, "tree-sitter-bash/tree-sitter-bash.wasm")),
      import("tree-sitter-powershell/tree-sitter-powershell.wasm").then((m) => read(m, "tree-sitter-powershell/tree-sitter-powershell.wasm")),
      import("tree-sitter-python/tree-sitter-python.wasm").then((m) => read(m, "tree-sitter-python/tree-sitter-python.wasm")),
      import("tree-sitter-rust/tree-sitter-rust.wasm").then((m) => read(m, "tree-sitter-rust/tree-sitter-rust.wasm")),
      import("tree-sitter-go/tree-sitter-go.wasm").then((m) => read(m, "tree-sitter-go/tree-sitter-go.wasm")),
      import("tree-sitter-groovy/tree-sitter-groovy.wasm").then((m) => read(m, "tree-sitter-groovy/tree-sitter-groovy.wasm")),
      import("tree-sitter-json/tree-sitter-json.wasm").then((m) => read(m, "tree-sitter-json/tree-sitter-json.wasm")),
      import("tree-sitter-c/tree-sitter-c.wasm").then((m) => read(m, "tree-sitter-c/tree-sitter-c.wasm")),
      import("tree-sitter-cpp/tree-sitter-cpp.wasm").then((m) => read(m, "tree-sitter-cpp/tree-sitter-cpp.wasm")),
      import("tree-sitter-css/tree-sitter-css.wasm").then((m) => read(m, "tree-sitter-css/tree-sitter-css.wasm")),
      import("tree-sitter-html/tree-sitter-html.wasm").then((m) => read(m, "tree-sitter-html/tree-sitter-html.wasm")),
      import("tree-sitter-java/tree-sitter-java.wasm").then((m) => read(m, "tree-sitter-java/tree-sitter-java.wasm")),
      import("tree-sitter-objc/tree-sitter-objc.wasm").then((m) => read(m, "tree-sitter-objc/tree-sitter-objc.wasm")),
      import("tree-sitter-php/tree-sitter-php.wasm").then((m) => read(m, "tree-sitter-php/tree-sitter-php.wasm")),
      import("tree-sitter-ruby/tree-sitter-ruby.wasm").then((m) => read(m, "tree-sitter-ruby/tree-sitter-ruby.wasm")),
      import("tree-sitter-dart/tree-sitter-dart.wasm").then((m) => read(m, "tree-sitter-dart/tree-sitter-dart.wasm")),
      import("tree-sitter-elixir/tree-sitter-elixir.wasm").then((m) => read(m, "tree-sitter-elixir/tree-sitter-elixir.wasm")),
      import("tree-sitter-fsharp/tree-sitter-fsharp.wasm").then((m) => read(m, "tree-sitter-fsharp/tree-sitter-fsharp.wasm")),
      import("tree-sitter-haskell/tree-sitter-haskell.wasm").then((m) => read(m, "tree-sitter-haskell/tree-sitter-haskell.wasm")),
      import("tree-sitter-scala/tree-sitter-scala.wasm").then((m) => read(m, "tree-sitter-scala/tree-sitter-scala.wasm")),
      import("tree-sitter-svelte/tree-sitter-svelte.wasm").then((m) => read(m, "tree-sitter-svelte/tree-sitter-svelte.wasm")),
      import("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm").then((m) => read(m, "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm")),
      // === Built-from-source WASM (no pre-built .wasm in npm package) ===
      // Built with tree-sitter-cli 0.26.9 — compatible with web-tree-sitter 0.25.10 for these grammars.
      // yaml, vue, graphql, zig, xml, markdown excluded — external scanner ABI issues.
      import("../../wasm-built/tree-sitter-SQL.wasm.js.js").then((m) => read(m, "tree-sitter-sql/tree-sitter-sql.wasm")),
      import("../../wasm-built/tree-sitter-perl.wasm.js.js").then((m) => read(m, "tree-sitter-perl/tree-sitter-perl.wasm")),
      import("../../wasm-built/tree-sitter-kotlin.wasm.js.js").then((m) => read(m, "tree-sitter-kotlin/tree-sitter-kotlin.wasm")),
      import("../../wasm-built/tree-sitter-swift.wasm.js.js").then((m) => read(m, "tree-sitter-swift/tree-sitter-swift.wasm")),
      import("../../wasm-built/tree-sitter-lua.wasm.js.js").then((m) => read(m, "tree-sitter-lua/tree-sitter-lua.wasm")),
      import("../../wasm-built/tree-sitter-toml.wasm.js.js").then((m) => read(m, "tree-sitter-toml/tree-sitter-toml.wasm")),
      // tree-sitter-clean — on npm (v1.0.0) but ships no .wasm; built from grammar source
      import("../../wasm-built/tree-sitter-clean.wasm.js.js").then((m) => read(m, "tree-sitter-clean/tree-sitter-clean.wasm")),
      // tree-sitter-clojure — built from grammar.js (no npm package)
      import("tree-sitter-clojure/tree-sitter-clojure.wasm").then((m) => read(m, "tree-sitter-clojure/tree-sitter-clojure.wasm")),
      // erlang — WASM from @lumis-sh/wasm-erlang; registered under both keys
      // so engine's try/catch for the primary path resolves in compiled mode
      import("@lumis-sh/wasm-erlang/tree-sitter-erlang.wasm").then((m) => {
        read(m, "@lumis-sh/wasm-erlang/tree-sitter-erlang.wasm")
        read(m, "tree-sitter-erlang/tree-sitter-erlang.wasm")
      }),
    ]),
    new Promise<void>((resolve) => setTimeout(resolve, 60000))
    ])

    _registry = registry
  })()
  return _loading
}

export function getWasm(name: string): Uint8Array | undefined {
  if (!_registry) return undefined

  // Exact match
  if (_registry[name]) return _registry[name]

  // Match by suffix (e.g. name ending with registry key)
  for (const key of Object.keys(_registry)) {
    if (name.endsWith(key)) return _registry[key]
  }

  // Match by wasm filename only (last path component)
  const basename = name.split("/").pop() || name
  for (const key of Object.keys(_registry)) {
    const keyBase = key.split("/").pop() || key
    if (basename === keyBase) return _registry[key]
  }

  // Match by package name prefix (e.g. "tree-sitter-kotlin/" matches keys starting with that)
  const pkg = name.split("/")[0]
  for (const key of Object.keys(_registry)) {
    if (key.startsWith(pkg + "/") || key.startsWith(pkg + ".")) return _registry[key]
  }

  return undefined
}

export function listWasm(): string[] {
  return _registry ? Object.keys(_registry) : []
}
