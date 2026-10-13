// A sky node: the whole store, plus two endpoints. "Flying" is this file.
//
// A node has NO notion of a primary, a leader, or a cluster. It accepts writes
// while completely alone, and when it can reach a peer it exchanges snapshots.
// If it never reaches one, it still works; if it reaches one twice, nothing
// breaks, because merge is idempotent.
import { createServer, type Server } from "node:http"
import { Lattice, type Fact } from "./lattice.ts"

export interface SkyNode { node: Lattice; server: Server; port: number; close(): Promise<void> }

export async function startNode(name: string, port: number): Promise<SkyNode> {
  const node = new Lattice(name)
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x")
    const send = (code: number, body: unknown) => {
      const b = JSON.stringify(body)
      res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(b) })
      res.end(b)
    }
    if (req.method === "GET" && url.pathname === "/snapshot") {
      return send(200, { node: name, facts: node.snapshot() })
    }
    if (req.method === "POST" && url.pathname === "/merge") {
      let raw = ""
      req.on("data", (c) => { raw += c })
      req.on("end", () => {
        try {
          const body = JSON.parse(raw) as { facts: Fact[] }
          const changed = node.merge(body.facts ?? [])
          // Answer with OUR snapshot so one round trip syncs BOTH ways.
          return send(200, { node: name, changed, facts: node.snapshot() })
        } catch (e) {
          return send(400, { error: String(e) })
        }
      })
      return
    }
    if (req.method === "GET" && url.pathname === "/get") {
      return send(200, { key: url.searchParams.get("key"), value: node.get(url.searchParams.get("key") ?? "") })
    }
    if (req.method === "PUT" && url.pathname === "/set") {
      let raw = ""
      req.on("data", (c) => { raw += c })
      req.on("end", () => {
        try {
          const { key, value } = JSON.parse(raw) as { key: string; value: unknown }
          return send(200, { ok: true, fact: node.set(key, value) })
        } catch (e) { return send(400, { error: String(e) }) }
      })
      return
    }
    send(404, { error: "no such path", paths: ["GET /snapshot", "POST /merge", "GET /get?key=", "PUT /set"] })
  })
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r))
  return {
    node, server, port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

/** One exchange, both directions. This is what happens when two devices meet. */
export async function sync(a: SkyNode, b: SkyNode): Promise<{ aChanged: number; bChanged: number }> {
  const post = async (target: SkyNode, facts: Fact[]) => {
    const res = await fetch(`http://127.0.0.1:${target.port}/merge`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ facts }),
    })
    return (await res.json()) as { changed: number; facts: Fact[] }
  }
  const back = await post(b, a.node.snapshot())
  const aChanged = a.node.merge(back.facts)
  return { aChanged, bChanged: back.changed }
}
