// script/m55/lsp-wire.ts — the ONE stdio client M55 gates speak through.
//
// M55's truth rules are claims about what an editor RECEIVES, so the gates
// must drive the real server over the real wire. This module owns exactly
// that transport (plus the freshness check that keeps the leg honest): frames
// are parsed by BYTE length (string decoding corrupts multi-byte UTF-8 split
// across stdout chunks — found the hard way in the M42 live run), and a stale
// `dist` is rebuilt before the leg runs, because testing a bundle that does
// not contain the code under test is the silent misreport every gate here
// exists to prevent.
//
// Callers keep their own assertions; only the transport and the evidence
// conventions live here (one library rule, same as the feature-assertion core).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const M55_ROOT = path.resolve(import.meta.dirname ?? ".", "../..");
export const M55_SERVER = path.join(M55_ROOT, "dist/lsp/server.js");

/** Newest mtime of any `.ts` under `dir` (recursive). */
export function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(p));
    else if (entry.name.endsWith(".ts")) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

/** True when the compiled server is missing or predates any source file it
 *  bundles. Every source, not a hand-picked list: the first version of the
 *  T2 gate watched two files, so a `positions.ts` fix left dist stale and the
 *  wire leg reported the OLD behavior as if it were the new one. */
export function serverIsStale(): boolean {
  if (!existsSync(M55_SERVER)) return true;
  return newestSourceMtime(path.join(M55_ROOT, "src")) > statSync(M55_SERVER).mtimeMs;
}

export function ensureServerBuilt(): void {
  if (!serverIsStale()) return;
  console.log("  (dist missing or stale — building the server under test)");
  execFileSync("npx", ["tsup"], { cwd: M55_ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 420_000 });
}

export interface WireResponse {
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

/** A JSON-RPC client over the server's stdio, framing by Content-Length. */
export class StdioLsp {
  private child;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (v: WireResponse) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor(
    root: string,
    env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
    serverPath: string = M55_SERVER,
    cwdOverride: string = M55_ROOT,
  ) {
    this.child = spawn(process.execPath, [serverPath, "--dir", root], {
      cwd: cwdOverride,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = this.buffer.subarray(0, headerEnd).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
          this.buffer = this.buffer.subarray(headerEnd + 4);
          continue;
        }
        const len = parseInt(m[1]!, 10);
        if (this.buffer.length < headerEnd + 4 + len) return;
        const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + len).toString("utf8");
        this.buffer = this.buffer.subarray(headerEnd + 4 + len);
        let msg: any;
        try {
          msg = JSON.parse(body);
        } catch {
          continue;
        }
        if (typeof msg?.id === "number") {
          const entry = this.pending.get(msg.id);
          if (entry !== undefined) {
            this.pending.delete(msg.id);
            entry.resolve(msg as WireResponse);
          }
        }
      }
    });
    this.child.stderr!.on("data", () => {});
  }

  request(method: string, params: unknown, timeoutMs = 20_000): Promise<WireResponse> {
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    this.child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin!.write(body);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  notify(method: string, params: unknown): void {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params }));
    this.child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin!.write(body);
  }

  async initialize(root: string): Promise<any> {
    const init = await this.request("initialize", { processId: null, rootUri: `file://${root}`, capabilities: {} });
    this.notify("initialized", {});
    return init;
  }

  async dispose(): Promise<void> {
    try {
      this.child.stdin!.end();
    } catch {}
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        this.child!.kill("SIGKILL");
        resolve(null);
      }, 2000);
      this.child!.on("exit", () => {
        clearTimeout(t);
        resolve(null);
      });
    });
  }
}

/** A tiny check/mutant recorder shared by the M55 gates (same output shape as
 *  the rest of the repo's verifiers). */
export interface Recorder {
  check(label: string, ok: boolean, detail?: string): void;
  mutant(label: string, caught: boolean, detail?: string): void;
  counts(): { checks: number; passed: number; failures: string[]; mutantsCaught: number; mutantsTotal: number; negatives: number };
}

export function makeRecorder(): Recorder {
  let checks = 0;
  let passed = 0;
  let mutantsCaught = 0;
  let mutantsTotal = 0;
  let negatives = 0;
  const failures: string[] = [];
  return {
    check(label, ok, detail = "") {
      checks++;
      if (ok) passed++;
      else failures.push(detail ? `${label}: ${detail}` : label);
      console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
    },
    mutant(label, caught, detail = "") {
      mutantsTotal++;
      if (caught) mutantsCaught++;
      this.check(`${label} [mutant]`, caught, detail);
    },
    counts: () => ({ checks, passed, failures, mutantsCaught, mutantsTotal, negatives }),
  };
}
