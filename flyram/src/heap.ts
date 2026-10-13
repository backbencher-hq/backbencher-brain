// THE REMOTE HEAP — the RAM that isn't in the laptop.
//
// Every page is addressed by (region, offset). A client asks for a page and gets
// bytes back. The heap itself keeps only page ids and lengths, so the REMOTE side
// can be as dumb as a file or a bucket; what makes this "memory" rather than
// "storage" is the PAGE FAULT PATH: the client never sees a load instruction, it
// sees a missing page and fetches it.
import { createServer, type Server } from "node:http"

export interface HeapServer { port: number; pages: Map<string, Buffer>; close(): Promise<void>; faults: number }

export async function startHeap(port: number, initial: Record<string, number> = {}): Promise<HeapServer> {
  const pages = new Map<string, Buffer>()
  for (const [id, len] of Object.entries(initial)) pages.set(id, Buffer.alloc(len, id.length))
  let faults = 0
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x")
    const send = (code: number, body: Buffer | string, type = "application/octet-stream") => {
      res.writeHead(code, { "content-type": type, "content-length": Buffer.byteLength(body as any) })
      res.end(body)
    }
    if (url.pathname === "/page") {
      faults++
      const id = url.searchParams.get("id") ?? ""
      const p = pages.get(id)
      if (!p) return send(404, "no such page", "text/plain")
      return send(200, p)
    }
    if (url.pathname === "/stats") return send(200, JSON.stringify({ pages: pages.size, faults }), "application/json")
    send(404, "no such path", "text/plain")
  })
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r))
  return { port, pages, faults: 0, close: () => new Promise<void>((r) => server.close(() => r())) }
}
