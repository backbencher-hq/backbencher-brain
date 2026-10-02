import type { ASTEngine } from "./engine"

export class TaintAnalyzer {
  static enrichSymbols(symbols: ASTEngine.UniversalSymbol[], content: string, language: string) {
    for (const symbol of symbols) {
      if (symbol.range.startIndex !== undefined && symbol.range.endIndex !== undefined) {
        const snippet = content.slice(symbol.range.startIndex, symbol.range.endIndex)

        const sources = this.extractSources(snippet, language)
        if (sources.length > 0) {
          symbol.taintSources = symbol.taintSources ? [...symbol.taintSources, ...sources] : sources
        }

        const sinks = this.extractSinks(snippet, language)
        if (sinks.length > 0) {
          symbol.taintSinks = symbol.taintSinks ? [...symbol.taintSinks, ...sinks] : sinks
        }

        // Final deduplication
        if (symbol.taintSources) {
          symbol.taintSources = Array.from(new Set(symbol.taintSources.map((s) => s.snippet))).map(
            (snippet) => symbol.taintSources!.find((s) => s.snippet === snippet)!,
          )
        }
        if (symbol.taintSinks) {
          symbol.taintSinks = Array.from(new Set(symbol.taintSinks.map((s) => s.snippet))).map(
            (snippet) => symbol.taintSinks!.find((s) => s.snippet === snippet)!,
          )
        }
      }
    }
  }

  private static extractSources(snippet: string, language: string): { type: string; snippet: string }[] {
    const sources: { type: string; snippet: string }[] = []

    // 1. Universal Web/API Request Data (Multi-Language)
    if (
      /(?:req\.body|req\.query|req\.params|req\.headers|req\.cookies|request\.json|request\.args|request\.form|request\.files|\$_GET|\$_POST|\$_REQUEST|\$_COOKIE|\$_FILES|Request\.Query|Request\.Form|\[FromBody\]|\[FromQuery\]|params\[|request\.body|request\.url|request\.uri|URLSession\.shared)/i.test(
        snippet,
      )
    ) {
      sources.push({ type: "user_input", snippet: "Web Request Data" })
    }

    // 2. Universal Environment & CLI Input (Multi-Language)
    if (
      /(?:process\.env|os\.environ|sys\.argv|System\/getenv|getenv\(|Sys\.getenv|std::env::args|getArgs|getEnv|commandArgs|command-line-args|\$1|\$2|\$@|\$\*)/.test(
        snippet,
      )
    ) {
      sources.push({ type: "user_input", snippet: "Environment / CLI Argument" })
    }

    // 3. Universal Interactive Console Input (Multi-Language)
    if (
      /(?:prompt\(|readLine|Scanner\(|input\(|scanf\(|gets\(|cin\s*>>|stdin\.readLineSync|io\.read|getLine)/.test(
        snippet,
      )
    ) {
      sources.push({ type: "user_input", snippet: "Interactive Console Input" })
    }

    // 4. Universal Database/Storage Reads (Multi-Language)
    if (
      // `\.Query\s*\(`, `\.QueryRow\s*\(`, `\.Exec\s*\(` — see the sink rule's
      // comment. Requiring the call is what stops `req.query` from being read as
      // a database READ; the same property read was previously classified as both
      // a `database_read` source and a `sql_injection` sink.
      /(?:db\.query|db\.find|findOne\(|findAll\(|select\(|\.Exec\s*\(|\.QueryRow\s*\(|\.Query\s*\(|ExecuteReader|executeQuery)/i.test(
        snippet,
      )
    ) {
      sources.push({ type: "database_read", snippet: "Database Query Result" })
    }

    // 5. Universal File Reads (Multi-Language)
    if (
      /(?:fs\.readFileSync|fs\.readFile|fs\.createReadStream|open\(|File\.ReadAllText|File\.ReadAllBytes|ioutil\.ReadFile|os\.ReadFile|file_get_contents|fopen\(|File\.open)/.test(
        snippet,
      )
    ) {
      sources.push({ type: "file_system", snippet: "File System Read" })
    }

    // 6. Extracted Credentials / Sensitive Secrets
    if (
      /(?:password|passwd|pwd|secret|token|api_key|apikey|access_token|auth_token|client_secret|session_id|jwt|private_key|ssh_key|certificate|ssn|credit_card|cc_number)/i.test(
        snippet,
      )
    ) {
      sources.push({ type: "sensitive_data", snippet: "Extracted Sensitive Credentials or PII" })
    }

    // 7. Framework-specific Request bindings
    if (language === "java" || language === "kotlin") {
      if (
        /(?:HttpServletRequest|request\.getParameter|@RequestParam|@RequestBody|@PathVariable|@RequestHeader|@CookieValue)/.test(
          snippet,
        )
      ) {
        sources.push({ type: "user_input", snippet: "Java/Spring Web Request Context" })
      }
    } else if (language === "go") {
      if (/(?:r\.URL\.Query|r\.FormValue|r\.Body|r\.PostFormValue|c\.Bind|c\.Param|c\.Query)/.test(snippet)) {
        sources.push({ type: "user_input", snippet: "Go HTTP Request" })
      }
    } else if (language === "rust") {
      if (/(?:req\.query|req\.body|Query\(|Json\(|Path\()/.test(snippet)) {
        sources.push({ type: "user_input", snippet: "Rust Axum/Actix Request" })
      }
    } else if (language === "php") {
      if (/(?:php\:\/\/input|file_get_contents\('php\:\/\/input'\))/.test(snippet)) {
        sources.push({ type: "user_input", snippet: "PHP Raw Input Stream" })
      }
    } else if (language === "elixir") {
      if (/(?:conn\.params|conn\.query_params|conn\.body_params)/.test(snippet)) {
        sources.push({ type: "user_input", snippet: "Elixir Plug/Phoenix Conn" })
      }
    } else if (language === "scala") {
      if (/(?:request\.getQueryString|request\.body|request\.headers)/.test(snippet)) {
        sources.push({ type: "user_input", snippet: "Scala Play Request" })
      }
    } else if (language === "lua") {
      if (/(?:ngx\.req\.get_uri_args|ngx\.req\.get_post_args)/.test(snippet)) {
        sources.push({ type: "user_input", snippet: "Lua Nginx Request" })
      }
    }

    // Deduplicate
    return Array.from(new Set(sources.map((s) => s.snippet))).map(
      (snippet) => sources.find((s) => s.snippet === snippet)!,
    )
  }

  private static extractSinks(
    snippet: string,
    language: string,
  ): { type: string; snippet: string; vulnerability_type: string }[] {
    const sinks: { type: string; snippet: string; vulnerability_type: string }[] = []

    // 1. SQL Injection Sinks (Universal)
    //
    // The bare-receiver alternatives REQUIRE A CALL — `\.Query\s*\(` rather
    // than `\.Query\b`. Without the paren, the `/i` flag made `\.Query\b` match
    // the property access in `req.query`, which is the single most common
    // web-framework request accessor there is. Measured with the fix-differential
    // oracle (script/m15/security-oracle.ts): `req.query` alone was classified as
    // BOTH a `database_read` SOURCE and a `database_write`/`sql_injection` SINK,
    // so `export function render(el, req) { el.innerHTML = req.query }` — a file
    // with no database call in it — produced a `sql_injection` finding.
    //
    // Requiring the call keeps every real database call (`.Query(`, `.Exec(`,
    // `.QueryRow(`) and drops the property read. `db\.query` is listed
    // separately above and is unaffected.
    if (
      /(?:db\.query|db\.execute|\bexecute\b|executeQuery|mysql_query|execute_query|query_row|\.Exec\s*\(|\.QueryRow\s*\(|\.Query\s*\(|ExecuteReader|ExecuteScalar|ExecuteNonQuery|sp_executesql|EXECUTE\s+IMMEDIATE)/i.test(
        snippet,
      )
    ) {
      sinks.push({ type: "database_write", snippet: "Raw SQL Execution", vulnerability_type: "sql_injection" })
    }

    // 2. Command Injection Sinks (Universal)
    if (
      /(?:\bexec\(|\bspawn\(|\bexecSync|\bspawnSync|\bsystem\(|os\.system|subprocess\.|exec\.Command|Runtime\.getRuntime\(\)\.exec|Process\.Start|shell_exec\(|passthru\(|popen\(|os\.execute|io\.popen|System\.cmd|System\.Process|clojure\.java\.shell\/sh|system2\()/.test(
        snippet,
      ) ||
      (language === "ruby" && /(?:Kernel\.exec|`.*`)/.test(snippet))
    ) {
      sinks.push({
        type: "shell_execution",
        snippet: "System Command Execution",
        vulnerability_type: "command_injection",
      })
    }

    // 3. Path Traversal Sinks (Universal)
    if (
      /(?:fs\.readFile|fs\.writeFile|\bopen\(|File\.ReadAllText|File\.WriteAllText|ioutil\.ReadFile|os\.ReadFile|file_get_contents|\bfopen\(|File\.open|fs\.unlink|fs\.rmdir)/.test(
        snippet,
      )
    ) {
      sinks.push({ type: "file_system", snippet: "File System Operation", vulnerability_type: "path_traversal" })
    }

    // 4. XSS / Output Sinks (Universal)
    if (
      /(?:res\.send|res\.html|res\.write|innerHTML|document\.write|\becho |\bprint\s+|<script>|dangerouslySetInnerHTML)/.test(
        snippet,
      )
    ) {
      sinks.push({ type: "http_response", snippet: "Raw HTTP/HTML Output", vulnerability_type: "xss" })
    }

    // 5. Code Injection Sinks (Universal)
    if (/(?:\beval\(|\bexec\(|loadstring\(|Code\.eval_string|Function\()/.test(snippet)) {
      sinks.push({ type: "code_execution", snippet: "Dynamic Code Evaluation", vulnerability_type: "code_injection" })
    }

    // 6. Insecure Deserialization (Universal)
    if (
      /(?:pickle\.loads|pickle\.load|yaml\.load|marshal\.load|ObjectInputStream|readObject|unserialize\(|JSON\.parse|JSON\.parseObject|Bson\.parse)/.test(
        snippet,
      )
    ) {
      sinks.push({
        type: "deserialization",
        snippet: "Object Deserialization",
        vulnerability_type: "insecure_deserialization",
      })
    }

    // 7. SSRF / Outbound HTTP (Universal)
    if (
      /(?:fetch\(|axios\.|requests\.get|requests\.post|urllib\.request|http\.Get|http\.Post|curl_exec|HttpClient|RestTemplate|WebClient|Net::HTTP)/.test(
        snippet,
      )
    ) {
      sinks.push({ type: "network_request", snippet: "Outbound Network Request", vulnerability_type: "ssrf" })
    }

    // 8. Open Redirects / Header Manipulation (Universal)
    if (/(?:res\.redirect|res\.set|res\.header|header\(|Location:|Redirect\()/.test(snippet)) {
      sinks.push({
        type: "http_response",
        snippet: "HTTP Redirect / Header Setup",
        vulnerability_type: "open_redirect",
      })
    }

    // 9. Weak Cryptography / Hashing (Universal)
    if (
      /(?:md5\(|sha1\(|crypto\.createHash\("md5"\)|hashlib\.md5\(|MessageDigest\.getInstance\("MD5"\)|MD5\.Create|Digest::MD5)/i.test(
        snippet,
      )
    ) {
      sinks.push({ type: "cryptography", snippet: "Weak Hashing Function", vulnerability_type: "weak_crypto" })
    }

    // Deduplicate
    return Array.from(new Set(sinks.map((s) => s.snippet))).map((snippet) => sinks.find((s) => s.snippet === snippet)!)
  }
}
