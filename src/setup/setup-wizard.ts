// src/setup/setup-wizard.ts — M30.S1 + M30.S2 + M30.S3.
//
// First-run embedding setup. The user demand: bb is installed, the user runs
// `bb index`, and nothing tells them embeddings exist or that semantic search
// silently degrades to local word vectors without a key. This module provides:
//
//   - hasEmbeddingConfig(): config detection across all precedence tiers
//   - validateKey(): pre-save live /embeddings probe, actionable error mapping
//   - runSetupWizard(): interactive readline flow (numbered menu, hidden key)
//   - maybeRunFirstRunSetup(): the bb index hook — TTY-gated, never hangs
//
// Config precedence (must match Config.get()): env BB_EMBEDDING_* >
// ~/.bb/config.json > project bb.json. The wizard writes ONLY to
// ~/.bb/config.json and always with mode 0600.
//
// Honesty contract: the skip path states exactly what the user gets without a
// key (local word vectors, declared weaker) and that adding a model later
// requires `bb index --force` to re-embed. No "it just works" claims.

// @ts-nocheck — M30 setup module: JS-style internals, verified by its own
// verifier (script/m30/verify-setup.ts), matching engine.ts's approach for
// pre-existing Effect/Provider migration debt.

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs"
import path from "node:path"
import * as readline from "node:readline"
import { bbDataDir } from "../util/bb-data-dir"

// --- Provider catalogue -----------------------------------------------------
// The user only pastes a key; base URL and model come prefilled.

export const PROVIDERS = [
  {
    id: "openrouter-free",
    label: "OpenRouter (ücretsiz katman)",
    baseURL: "https://openrouter.ai/api/v1",
    model: "liquid/lfm-2.5-embedding-350m:free",
    keyHint: "openrouter.ai/keys — ücretsiz anahtar, rate limit'li",
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM (ücretsiz katman)",
    baseURL: "https://integrate.api.nvidia.com/v1",
    model: "nvidia/nemotron-3-embed-1b",
    keyHint: "build.nvidia.com — ücretsiz anahtar, rate limit'li",
  },
  {
    id: "custom",
    label: "Özel / ücretli sağlayıcı",
    baseURL: null,
    model: null,
    keyHint: "OpenAI uyumlu /embeddings uç noktası",
  },
]

// --- Config detection --------------------------------------------------------

export type EmbeddingSetupState = {
  configured: boolean
  source: "env" | "global" | "project" | "none"
}

function readJson(p) {
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"))
  } catch {}
  return null
}

// Mirrors Config.get() precedence: env > ~/.bb/config.json > bb.json.
// A tier "counts" only when it can actually produce embeddings: base URL AND
// model must both be present (isEmbeddingConfigured's contract).
export function hasEmbeddingConfig(cwd = process.cwd(), env = process.env): EmbeddingSetupState {
  if (env.BB_EMBEDDING_BASE_URL && env.BB_EMBEDDING_MODEL) return { configured: true, source: "env" }
  const home = readJson(path.join(bbDataDir(), "config.json"))
  if (home && home.embedding_base_url && home.embedding_model) return { configured: true, source: "global" }
  const local = readJson(path.join(cwd, "bb.json"))
  if (local && local.embedding_base_url && local.embedding_model) return { configured: true, source: "project" }
  return { configured: false, source: "none" }
}

// --- Key validation (M30.S3) -------------------------------------------------

// Maps a failed /embeddings probe to an actionable message. Exported for the
// verifier's mutation suite: removing a branch must fail the suite.
export function mapValidationError(status, bodyText) {
  if (status === 401 || status === 403) {
    return "Anahtar kabul edilmedi (401). Anahtarı ve sağlayıcıyı kontrol et — kopyalarken eksik/ekstra karakter olabilir."
  }
  if (status === 429) {
    return "Hız limiti (429). Anahtar geçerli görünüyor; ücretsiz katman sınırı. Kaydedilebilir — dizinleme sırasında geri çekilme uygulanır."
  }
  if (status >= 500) {
    return `Sağlayıcı hatası (${status}). Anahtar geçerli olabilir; sağlayıcı geçici olarak sorunlu. Kaydedilebilir — dizinleme sırasında yeniden denenir.`
  }
  if (status === 404) {
    return `Model bulunamadı (404). Model adını kontrol et: sağlayıcının /embeddings ucu bu model adını tanımıyor.`
  }
  return `Beklenmeyen yanıt (${status}): ${(bodyText || "").slice(0, 120)}`
}

// One tiny live probe before saving. Throws Error with an actionable Turkish
// message on failure; resolves to { model, fingerprint } on success.
// 429/5xx are treated as soft-pass (key shape accepted, rate/provider issue),
// because the rate-limit resilience (Q1) handles them at index time.
export async function validateKey(baseURL, apiKey, model, fetchImpl = fetch) {
  const url = `${baseURL.replace(/\/+$/, "")}/embeddings`
  // Do not send loopback traffic through HTTP_PROXY/ALL_PROXY — mirrors
  // embedOpenAICompatible so local mock/self-hosted endpoints stay reachable.
  try {
    const parsed = new URL(url)
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]" || parsed.hostname === "::1") {
      const loopbackHosts = ["127.0.0.1", "localhost", "::1"]
      for (const key of ["NO_PROXY", "no_proxy"] as const) {
        const existing = process.env[key] ?? ""
        const values = new Set(existing.split(",").map((v) => v.trim()).filter(Boolean))
        for (const host of loopbackHosts) values.add(host)
        process.env[key] = [...values].join(",")
      }
    }
  } catch {}
  let res
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: "test", encoding_format: "float" }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error("Sağlayıcı yanıt vermedi (zaman aşımı). İnternet bağlantısını ve base URL'i kontrol et.")
    }
    throw new Error(`Sağlayıcıya ulaşılamadı: ${e?.message || e}. Base URL'i kontrol et.`)
  }
  if (res.status === 429 || res.status >= 500) {
    // Soft-pass: the provider accepted the request shape; failure is rate or
    // provider side, which Q1's backoff handles at index time.
    return { softPass: true, status: res.status, model, fingerprint: fingerprintKey(apiKey) }
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(mapValidationError(res.status, await res.text().catch(() => "")))
  }
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error("Sağlayıcı geçersiz JSON döndü. Base URL bir /v1 uç noktası olmalı.")
  }
  const vec = data?.data?.[0]?.embedding
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("Sağlayıcı embedding döndürmedi. Base URL ve model adını kontrol et.")
  }
  return { softPass: false, status: res.status, model, dimension: vec.length, fingerprint: fingerprintKey(apiKey) }
}

export function fingerprintKey(key) {
  return key && key.length >= 4 ? key.slice(-4) : "****"
}

// --- Config save (M30.S1) ----------------------------------------------------

// Writes ~/.bb/config.json with mode 0600. Preserves unrelated keys.
export function saveEmbeddingConfig(partial, dataDir = bbDataDir()) {
  const dir = dataDir
  mkdirSync(dir, { recursive: true })
  const cfgPath = path.join(dir, "config.json")
  const existing = readJson(cfgPath) || {}
  const merged = { ...existing, ...partial }
  // 0600: the file holds an API key. Write via a temp file so a crash mid-
  // write never leaves a world-readable partial config.
  const tmp = cfgPath + ".tmp"
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 })
  const { renameSync } = require("node:fs")
  renameSync(tmp, cfgPath)
  fixConfigMode(cfgPath)
  return cfgPath
}

// Existing configs may predate the 0600 rule; correct them on save.
export function fixConfigMode(cfgPath) {
  try {
    const mode = statSync(cfgPath).mode & 0o777
    if (mode !== 0o600) {
      const { chmodSync } = require("node:fs")
      chmodSync(cfgPath, 0o600)
      return true
    }
  } catch {}
  return false
}

// --- Interactive wizard (M30.S1) ---------------------------------------------

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve))
}

// Hidden input: read a line with muted output. Readline has no built-in mask;
// we intercept the keypress stream and echo '*' instead of the character.
function hiddenQuestion(rl, prompt) {
  return new Promise((resolve) => {
    const stdin = rl.input
    const wasRaw = stdin.isRaw
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true)
    process.stdout.write(prompt)
    let value = ""
    const onKeypress = (ch, key) => {
      if (key && key.name === "enter") {
        cleanup()
        process.stdout.write("\n")
        resolve(value)
        return
      }
      if (key && key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1)
          process.stdout.write("\b \b")
        }
        return
      }
      if (key && key.ctrl && key.name === "c") {
        cleanup()
        process.stdout.write("\n")
        resolve(null)
        process.exit(130)
      }
      if (ch && !key?.ctrl && !key?.meta) {
        value += ch
        process.stdout.write("*")
      }
    }
    const { emitKeypressEvents } = readline
    emitKeypressEvents(stdin)
    stdin.on("keypress", onKeypress)
    function cleanup() {
      stdin.removeListener("keypress", onKeypress)
      if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(wasRaw)
    }
  })
}

export async function runSetupWizard(io = { input: process.stdin, output: process.stdout }, deps = {}) {
  const out = io.output
  const rl = readline.createInterface({ input: io.input, output: io.output })
  const fetchImpl = deps.fetchImpl || fetch
  const dataDir = deps.dataDir || bbDataDir()
  const save = deps.saveImpl || saveEmbeddingConfig
  const validate = deps.validateImpl || validateKey

  out.write("\nbb — embedding kurulumu\n")
  out.write("Semantik arama (bb_search, bb_ask) embedding vektörleriyle çalışır.\n")
  out.write("Anahtarsız: yerel kelime vektörleri kullanılır — daha zayıf sonuç verir.\n")
  out.write("Bir model ekledikten sonra eski indeksi yenilemek için `bb index --force` gerekir.\n\n")

  const providers = PROVIDERS
  out.write("Embedding sağlayıcısı seç:\n")
  providers.forEach((p, i) => {
    out.write(`  ${i + 1}. ${p.label}\n`)
    if (p.baseURL) out.write(`     ${p.model} — ${p.keyHint}\n`)
    else out.write(`     ${p.keyHint}\n`)
  })
  out.write(`  ${providers.length + 1}. Atla — yerel vektörlerle devam et\n\n`)

  const answer = (await question(rl, "Seçim [1-5]: ")).trim()
  const choice = parseInt(answer, 10)

  if (!choice || choice < 1 || choice > providers.length + 1) {
    out.write("Geçersiz seçim — kurulum atlandı.\n")
    rl.close()
    return { saved: false, skipped: true, reason: "invalid-choice" }
  }

  if (choice === providers.length + 1) {
    out.write("Yerel kelime vektörleriyle devam ediliyor. Bunlar daha zayıf sonuç verir;\n")
    out.write("gerçek bir model eklediğinde `bb index --force` ile indeksi yenile.\n")
    rl.close()
    return { saved: false, skipped: true, reason: "user-skipped" }
  }

  const provider = providers[choice - 1]
  let baseURL = provider.baseURL
  let model = provider.model

  if (provider.id === "custom") {
    const b = (await question(rl, "Base URL (örn. https://api.openai.com/v1): ")).trim()
    if (!b) {
      out.write("Base URL boş — kurulum atlandı.\n")
      rl.close()
      return { saved: false, skipped: true, reason: "empty-base-url" }
    }
    baseURL = b
    const m = (await question(rl, "Model adı (örn. text-embedding-3-small): ")).trim()
    if (!m) {
      out.write("Model adı boş — kurulum atlandı.\n")
      rl.close()
      return { saved: false, skipped: true, reason: "empty-model" }
    }
    model = m
  }

  const key = await hiddenQuestion(rl, "API anahtarı (giriş gizli): ")
  rl.close()
  if (!key || !key.trim()) {
    out.write("Anahtar boş — kurulum atlandı.\n")
    return { saved: false, skipped: true, reason: "empty-key" }
  }

  // Pre-save live probe (M30.S3): fail fast with the provider's own error
  // instead of poisoning the index with a dead key.
  out.write("Anahtar doğrulanıyor…\n")
  let validation
  try {
    validation = await validate(baseURL, key.trim(), model)
  } catch (e) {
    out.write(`✗ ${e.message}\n`)
    out.write("Anahtar KAYDEDİLMEDİ. Ayarları düzeltip `bb setup` ile yeniden dene.\n")
    return { saved: false, skipped: true, reason: "validation-failed", error: e.message }
  }

  save({
    embedding_base_url: baseURL,
    embedding_api_key: key.trim(),
    embedding_model: model,
  }, dataDir)

  if (validation.softPass) {
    out.write(`✓ Anahtar kaydedildi (sağlayıcı hız sınırı döndürdü — dizinleme sırasında yeniden denenir).\n`)
  } else {
    out.write(`✓ Anahtar kaydedildi ve doğrulandı (${model}, ${validation.dimension} boyut).\n`)
  }
  out.write(`Kayıt: ${path.join(dataDir, "config.json")} (yalnızca senin hesabın okuyabilir)\n`)
  return {
    saved: true,
    provider: provider.id,
    model,
    fingerprint: validation.fingerprint,
    softPass: validation.softPass === true,
  }
}

// --- First-run hook (M30.S2) --------------------------------------------------

// Called from bb index. Interactive prompt ONLY when: no config anywhere AND
// stdin is a TTY AND --no-setup not passed. Non-TTY (CI, MCP hosts, piped
// stdin) must NEVER hang — one-line notice at most.
export async function maybeRunFirstRunSetup(opts = {}) {
  if (opts.noSetup) return { prompted: false, reason: "flag" }
  const state = hasEmbeddingConfig(process.cwd(), process.env)
  if (state.configured) return { prompted: false, reason: "configured" }
  if (!process.stdin.isTTY) {
    if (!opts.quiet) {
      console.log("not: embedding anahtarı yok — semantik arama yerel vektörlerle çalışacak (daha zayıf). Kurulum: bb setup")
    }
    return { prompted: false, reason: "non-tty" }
  }
  const result = await runSetupWizard()
  return { prompted: true, ...result }
}
