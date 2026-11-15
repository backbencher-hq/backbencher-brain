// Bun type declarations for non-Bun environments
declare const Bun: {
  hash(data: string | Uint8Array): number
  file(path: string): {
    exists(): boolean
    text(): Promise<string>
    bytes(): Promise<Uint8Array>
    json(): Promise<any>
    stream(): AsyncIterable<Uint8Array>
    writer(): any
    readonly size: number
    readonly lastModified: number
    readonly type: string
  }
  write(path: string, data: any): Promise<number>
  gzipSync(data: Uint8Array): Uint8Array
  gunzipSync(data: Uint8Array): Uint8Array
  spawn(args: any): any
  serve(options: any): any
  env: Record<string, string | undefined>
  main: string
  argv: string[]
  nanoseconds(): number
  sleep(ms: number): Promise<void>
  deflateSync(data: Uint8Array): Uint8Array
  inflateSync(data: Uint8Array): Uint8Array
  inspect(value: any): string
  readableStreamToText(stream: any): Promise<string>
  readableStreamToJSON(stream: any): Promise<any>
  readableStreamToArray(stream: any): Promise<any[]>
}

declare const BB_POOL_WORKER_PATH: string | undefined

declare function gzipSync(data: Uint8Array): Uint8Array
