// Minimal project instance for brain-core. The ported indexer calls
// Instance.provide({ directory, fn }) for directory-scoped execution; in the
// standalone core there is no ambient instance, so it is a direct passthrough.
export namespace Instance {
  export let directory: string | null = null

  export async function provide<T>(opts: { directory: string; fn: () => Promise<T> }): Promise<T> {
    directory = opts.directory
    try {
      return await opts.fn()
    } finally {
      directory = null
    }
  }
}
