/**
 * PROBE — would a CLOSED, LANGUAGE-DEFINED name set answer part of the C lane's residual?
 *
 * Read-only. Reproduces the incoming gate's population (`.c`, stride 400) and classifies every
 * emitted edge with the GATE'S OWN `classifyEdge` (imported, never re-implemented), then asks the
 * one question TABLE 1 cannot: for the edges that read `unresolved`, WHAT is the target, and is it
 * a name the ISO C standard defines in a header OUTSIDE any corpus (so the claim "not in the run"
 * is a fact about the LANGUAGE, not a guess about the corpus)?
 *
 * Buckets an unresolved edge by its target's provenance:
 *   stdlibC   the target is in the ISO C standard library set (functions + the macros callers use)
 *   posix     the target is in the POSIX.1 set (read/write/open/close/...)
 *   windows   the target is in the Win32 API set (CloseHandle/GetStdHandle/...)
 *   ownFile   the EDGE'S OWN FILE declares the name (so the count model failed it for a collision)
 *   runDecl   another file IN THE RUN declares it
 *   headerTok no file in the run declares it, but a `.h` of the SAME repo mentions the token
 *   nowhere   nothing in the run and no header token
 *
 * Usage: bun run validation/m14/fixtures/c/probe-c-residual.ts [maxFiles] [--repo=r1,r2] [--verbose]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1_000_000
const argv = process.argv.slice(2)
const MAX = Number(argv.find((a) => !a.startsWith("--")) ?? 400)
const REPO_ARG = argv.find((a) => a.startsWith("--repo="))
const ONLY = REPO_ARG ? new Set(REPO_ARG.slice(7).split(",").map((s) => s.trim()).filter(Boolean)) : undefined
const VERBOSE = argv.includes("--verbose")

// ---------------------------------------------------------------- THE THREE CLOSED SETS (probe copy)
const C_STDLIB = new Set([
  "abort", "abs", "acos", "acosf", "acosl", "asctime", "asin", "asinf", "asinl", "assert", "atan",
  "atan2", "atan2f", "atan2l", "atanf", "atanl", "atexit", "atof", "atoi", "atol", "atoll", "bsearch",
  "btowc", "calloc", "cbrt", "cbrtf", "cbrtl", "ceil", "ceilf", "ceill", "clearerr", "clock",
  "copysign", "copysignf", "copysignl", "cos", "cosf", "cosh", "coshf", "coshl", "cosl", "ctime",
  "difftime", "div", "exit", "exp", "exp2", "exp2f", "exp2l", "expf", "expl", "expm1", "expm1f",
  "expm1l", "fabs", "fabsf", "fabsl", "fclose", "fdim", "fdimf", "fdiml", "feof", "ferror", "fflush",
  "fgetc", "fgetpos", "fgets", "fgetwc", "fgetws", "floor", "floorf", "floorl", "fmax", "fmaxf",
  "fmaxl", "fmin", "fminf", "fminl", "fmod", "fmodf", "fmodl", "fopen", "fprintf", "fputc", "fputs",
  "fputwc", "fputws", "fread", "free", "freopen", "frexp", "frexpf", "frexpl", "fscanf", "fseek",
  "fsetpos", "ftell", "fwide", "fwprintf", "fwrite", "fwscanf", "getc", "getchar", "getenv", "gets",
  "getwc", "getwchar", "gmtime", "hypot", "hypotf", "hypotl", "ilogb", "ilogbf", "ilogbl", "imaxabs",
  "imaxdiv", "isalnum", "isalpha", "isblank", "iscntrl", "isdigit", "isgraph", "islower", "isprint",
  "ispunct", "isspace", "isupper", "iswalnum", "iswalpha", "iswblank", "iswcntrl", "iswdigit",
  "iswgraph", "iswlower", "iswprint", "iswpunct", "iswspace", "iswupper", "iswxdigit", "isxdigit",
  "labs", "ldexp", "ldexpf", "ldexpl", "ldiv", "llabs", "lldiv", "localeconv", "localtime", "log",
  "log10", "log10f", "log10l", "log1p", "log1pf", "log1pl", "log2", "log2f", "log2l", "logb",
  "logbf", "logbl", "logf", "logl", "longjmp", "lrint", "lrintf", "lrintl", "lround", "lroundf",
  "lroundl", "malloc", "mblen", "mbrlen", "mbrtowc", "mbsinit", "mbsrtowcs", "mbstowcs", "mbtowc",
  "memchr", "memcmp", "memcpy", "memmove", "memset", "mktime", "modf", "modff", "modfl", "nan",
  "nanf", "nanl", "nearbyint", "nearbyintf", "nearbyintl", "nextafter", "nextafterf", "nextafterl",
  "nexttoward", "nexttowardf", "nexttowardl", "offsetof", "perror", "pow", "powf", "powl", "printf",
  "putc", "putchar", "puts", "putwc", "putwchar", "qsort", "raise", "rand", "realloc", "remainder",
  "remainderf", "remainderl", "remove", "remquo", "remquof", "remquol", "rename", "rewind", "rint",
  "rintf", "rintl", "round", "roundf", "roundl", "scalbln", "scalblnf", "scalblnl", "scalbn",
  "scalbnf", "scalbnl", "scanf", "setbuf", "setjmp", "setlocale", "setvbuf", "signal", "sin", "sinf",
  "sinh", "sinhf", "sinhl", "sinl", "snprintf", "sprintf", "sqrt", "sqrtf", "sqrtl", "srand",
  "sscanf", "strcat", "strchr", "strcmp", "strcoll", "strcpy", "strcspn", "strerror", "strftime",
  "strlen", "strncat", "strncmp", "strncpy", "strpbrk", "strrchr", "strspn", "strstr", "strtod",
  "strtof", "strtoimax", "strtok", "strtol", "strtold", "strtoll", "strtoul", "strtoull", "strtoumax",
  "strxfrm", "swprintf", "swscanf", "system", "tan", "tanf", "tanh", "tanhf", "tanhl", "tanl",
  "tgamma", "tgammaf", "tgammal", "time", "tmpfile", "tmpnam", "tolower", "toupper", "towctrans",
  "towlower", "towupper", "trunc", "truncf", "truncl", "ungetc", "ungetwc", "va_arg", "va_copy",
  "va_end", "va_start", "vfprintf", "vfscanf", "vfwprintf", "vfwscanf", "vprintf", "vscanf",
  "vsnprintf", "vsprintf", "vsscanf", "vswprintf", "vswscanf", "vwprintf", "vwscanf", "wcrtomb",
  "wcscat", "wcschr", "wcscmp", "wcscoll", "wcscpy", "wcscspn", "wcsftime", "wcslen", "wcsncat",
  "wcsncmp", "wcsncpy", "wcspbrk", "wcsrchr", "wcsspn", "wcsstr", "wcstod", "wcstof", "wcstoimax",
  "wcstok", "wcstol", "wcstold", "wcstoll", "wcstombs", "wcstoul", "wcstoull", "wcstoumax",
  "wcsxfrm", "wctob", "wctomb", "wctrans", "wctype", "wmemchr", "wmemcmp", "wmemcpy", "wmemmove",
  "wmemset", "wprintf", "wscanf",
])
const POSIX = new Set([
  "access", "alarm", "bind", "chdir", "chmod", "chown", "close", "closedir", "connect",
  "dup", "dup2", "execl", "execle", "execlp", "execv", "execve", "execvp", "fchmod", "fchown",
  "fcntl", "fdopen", "fork", "fstat", "fsync", "ftruncate", "getcwd", "getegid", "geteuid",
  "getgid", "getgroups", "gethostname", "getopt", "getpgid", "getpid", "getppid", "getpwnam",
  "getpwuid", "gettimeofday", "getuid", "gmtime_r", "ioctl", "isatty", "kill", "killpg", "link",
  "listen", "localtime_r", "lseek", "lstat", "mkdir", "mkfifo", "mmap", "mount", "munmap",
  "nanosleep", "open", "opendir", "pause", "pipe", "poll", "pthread_create", "pthread_detach",
  "pthread_exit", "pthread_join", "pthread_mutex_destroy", "pthread_mutex_init", "pthread_mutex_lock",
  "pthread_mutex_unlock", "pthread_self", "read", "readdir", "readlink", "recv", "recvfrom",
  "rmdir", "select", "send", "sendto", "setenv", "setgid", "setpgid", "setsid", "setsockopt",
  "setuid", "shutdown", "sigaction", "sigaddset", "sigdelset", "sigemptyset", "sigfillset",
  "sigismember", "socket", "stat", "strdup", "strerror_r", "strptime",
  "symlink", "sysconf", "umask", "uname", "unlink", "utime", "wait", "waitpid", "write",
])
const WINDOWS = new Set([
  "CloseHandle", "CreateEvent", "CreateFile", "CreateFileA", "CreateFileW", "CreateMutex",
  "CreateProcess", "CreateThread", "DeleteCriticalSection", "EnterCriticalSection",
  "GetCurrentProcess", "GetCurrentProcessId", "GetCurrentThreadId", "GetEnvironmentVariable",
  "GetLastError", "GetModuleHandle", "GetProcAddress", "GetStdHandle", "GetSystemTime",
  "GetSystemTimeAsFileTime", "GetTickCount", "GetTickCount64", "InitializeCriticalSection",
  "LeaveCriticalSection", "LocalFree", "MultiByteToWideChar", "QueryPerformanceCounter",
  "QueryPerformanceFrequency", "ReleaseMutex", "SetEvent", "SetLastError", "Sleep", "TerminateProcess",
  "WideCharToMultiByte", "WaitForSingleObject", "WriteFile", "lstrlen", "lstrlenA", "lstrlenW",
  "wsprintf", "wsprintfA", "wsprintfW",
])

const ontology = (t: string): string | null =>
  ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"].includes(t) ? t : null

type Discovered = { files: string[]; admitted: string[]; total: number; repos: Set<string> }
function discover(): Discovered {
  const found: string[] = []
  const repos = new Set<string>()
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], admitted: [], total: 0, repos } }
  for (const name of entries.sort()) {
    if (ONLY && !ONLY.has(name)) continue
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!/\.c$/i.test(rel)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs); repos.add(name)
    }
  }
  const total = found.length
  let files = found
  if (MAX > 0 && total > MAX) {
    const stride = Math.max(1, Math.floor(total / MAX))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, admitted: found, total, repos }
}

const headerTokCache = new Map<string, Set<string>>()
function headerTokens(repoDir: string): Set<string> {
  const hit = headerTokCache.get(repoDir)
  if (hit) return hit
  const toks = new Set<string>()
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { /* repo facts unavailable: the bucket stays empty and is disclosed */ }
  for (const rel of tracked) {
    if (!/\.(h|hpp|hxx|inc)$/i.test(rel)) continue
    const abs = path.join(repoDir, rel)
    let text: string
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) toks.add(m[0])
  }
  headerTokCache.set(repoDir, toks)
  return toks
}

const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

const { files, admitted, total, repos } = discover()
console.log(`probe — c residual classification`)
console.log(`population: ${files.length} of ${total} .c files (stride sample), ${repos.size} repos`)
console.log(`admitted (unsampled): ${admitted.length}\n`)

type Pending = { label: string; tgt: string; claim: ReturnType<typeof externalClaimOf>; repo: string; srcFile: string; md: any; line: number | null }
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const ownFileNames = new Map<string, Set<string>>()
const pending: Pending[] = []
const empty: string[] = []
let parsed = 0
let failed = 0

const t0 = Date.now()
for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.symbols.length === 0 && r.relationships.length === 0) empty.push(f)
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const own = new Set<string>()
  ownFileNames.set(f, own)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    own.add(name)
    const bump = (k: string) => {
      pDecl!.set(k, (pDecl!.get(k) ?? 0) + 1)
      let ks = pKinds!.get(k)
      if (!ks) pKinds!.set(k, (ks = new Set()))
      ks.add(kind)
    }
    bump(name)
    const q = String((s as any)?.qualifiedName ?? "")
    if (q && q !== name) bump(q)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = ontology(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? "")
    if (!tgt) continue
    pending.push({
      label, tgt, claim: externalClaimOf(rel), repo, srcFile: f, md: (rel as any)?.metadata ?? {},
      line: Number((rel as any)?.line_number ?? 0) || null,
    })
  }
}
console.log(`parsed ${parsed}, failed ${failed}, empty-result ${empty.length}, edges ${pending.length} (${Math.round((Date.now() - t0) / 1000)}s)\n`)

type Bucket = Record<string, number>
const byType = new Map<string, Bucket>()
const unresTargets = new Map<string, Map<string, number>>()
const samples: string[] = []
const markedBySet = { stdlibC: 0, posix: 0, windows: 0, other: 0 }
const markedTargets = new Map<string, number>()
const resolvedByOutcome = new Map<string, number>()

for (const e of pending) {
  const decl = projectDecl.get(e.repo)!
  const kinds = projectKinds.get(e.repo)!
  const ownFileDeclares = ownFileNames.get(e.srcFile)?.has(e.tgt) ?? false
  const c = classifyEdge(decl, kinds, e.tgt, e.claim, undefined, e.label === "contains", ownFileDeclares)
  resolvedByOutcome.set(c.outcome, (resolvedByOutcome.get(c.outcome) ?? 0) + 1)
  const decls = decl.get(e.tgt) ?? 0
  const isUnres = c.outcome === "unresolved"
  let b = byType.get(e.label)
  if (!b) byType.set(e.label, (b = { edges: 0, amb: 0, unres: 0, stdlibC: 0, posix: 0, windows: 0, ownFile: 0, runDecl: 0, headerTok: 0, nowhere: 0 }))
  b.edges++
  if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") { b.amb++; continue }
  if (!isUnres) continue
  b.unres++
  if (C_STDLIB.has(e.tgt)) { b.stdlibC++; markedBySet.stdlibC++; markedTargets.set(`stdlibC\t${e.tgt}`, (markedTargets.get(`stdlibC\t${e.tgt}`) ?? 0) + 1) }
  else if (POSIX.has(e.tgt)) { b.posix++; markedBySet.posix++; markedTargets.set(`posix\t${e.tgt}`, (markedTargets.get(`posix\t${e.tgt}`) ?? 0) + 1) }
  else if (WINDOWS.has(e.tgt)) { b.windows++; markedBySet.windows++; markedTargets.set(`windows\t${e.tgt}`, (markedTargets.get(`windows\t${e.tgt}`) ?? 0) + 1) }
  else { markedBySet.other++; markedTargets.set(`other\t${e.tgt}`, (markedTargets.get(`other\t${e.tgt}`) ?? 0) + 1) }
  let prov: string
  if (ownFileDeclares) { b.ownFile++; prov = "ownFile" }
  else if (decls > 0) { b.runDecl++; prov = "runDecl" }
  else if (headerTokens(e.repo).has(e.tgt)) { b.headerTok++; prov = "headerTok" }
  else { b.nowhere++; prov = "nowhere" }
  let m = unresTargets.get(prov)
  if (!m) unresTargets.set(prov, (m = new Map()))
  m.set(e.tgt, (m.get(e.tgt) ?? 0) + 1)
  if (samples.length < 800 && (C_STDLIB.has(e.tgt) || POSIX.has(e.tgt))) {
    samples.push(`${path.relative(CR, e.srcFile)}:${e.line} ${e.label} -> ${e.tgt} md=${JSON.stringify(e.md)}`)
  }
}

console.log(`OUTCOMES (gate's own classifier): ${[...resolvedByOutcome].sort().map(([k, n]) => `${k}=${n}`).join(" ")}\n`)
console.log(`type          edges    amb      unres    | stdlibC  posix    windows  other    | ownFile runDecl headerTok nowhere`)
for (const [label, b] of byType) {
  console.log(`${label.padEnd(13)} ${String(b.edges).padEnd(8)} ${String(b.amb).padEnd(8)} ${String(b.unres).padEnd(8)} | ${String(b.stdlibC).padEnd(8)} ${String(b.posix).padEnd(8)} ${String(b.windows).padEnd(8)} ${String(b.other).padEnd(8)} | ${b.ownFile} ${b.runDecl} ${b.headerTok} ${b.nowhere}`)
}
const sum = (k: string) => [...byType.values()].reduce((a, b) => a + (b[k] as number), 0)
console.log(`${"TOTAL".padEnd(13)} ${String(sum("edges")).padEnd(8)} ${String(sum("amb")).padEnd(8)} ${String(sum("unres")).padEnd(8)} | ${String(sum("stdlibC")).padEnd(8)} ${String(sum("posix")).padEnd(8)} ${String(sum("windows")).padEnd(8)} ${String(sum("other")).padEnd(8)} | ${sum("ownFile")} ${sum("runDecl")} ${sum("headerTok")} ${sum("nowhere")}`)
console.log(`\nmarkable by set (unresolved edges whose target is in the closed set): stdlibC=${markedBySet.stdlibC} posix=${markedBySet.posix} windows=${markedBySet.windows} other=${markedBySet.other}`)

console.log(`\nTOP UNRESOLVED TARGETS BY PROVENANCE`)
for (const [prov, m] of unresTargets) {
  const arr = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  console.log(`  ${prov} — ${arr.length} distinct target(s), ${arr.reduce((a, b) => a + b[1], 0)} edges`)
  console.log(`     ${arr.slice(0, VERBOSE ? 400 : 40).map(([t, n]) => `${t}(${n})`).join(" ")}`)
}
console.log(`\nTOP MARKABLE TARGETS (unresolved, in a closed set)`)
for (const [k, n] of [...markedTargets].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(`  ${String(n).padStart(6)}  ${k}`)
console.log(`\nSAMPLE MARKABLE EDGES (file:line type -> target)`)
for (const s of samples.slice(0, 40)) console.log(`  ${s}`)
console.log(`\nEMPTY-RESULT FILES: ${empty.length}`)
for (const f of empty.slice(0, 10)) console.log(`  ${path.relative(CR, f)}`)
