// Framework-Specific Intelligence Engine
// Deep pattern recognition for popular frameworks across all languages

import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

export namespace FrameworkIntelligence {

  /**
   * The two policy sets that decide what a LEGITIMATE primary framework looks like.
   *
   * They were local to `enhanceWithFrameworkIntelligence` until M60.R8 (CONV-OC-1) needed
   * them: the runtime half of the framework-surface rule reads the PUBLISHED payload, and
   * the published payload deliberately keeps a primary when nothing was detected —
   * `"unknown"`, or a pure-language name such as `"Dart"`. Without these lists the
   * instrument cannot tell that documented default from a fabricated framework, so it
   * convicted 1,000+ real corpus files for the pipeline's stated policy. Exported rather
   * than re-listed in the probe, because a second copy of a policy is a second policy.
   */
  export const PURE_LANGUAGE_PRIMARIES: ReadonlySet<string> = new Set([
    "JavaScript", "TypeScript", "Python", "Ruby", "Java", "C#", "C++", "C",
    "Go", "Rust", "SQL", "Dart", "Objective-C", "YAML", "JSON", "Lua",
    "R", "Haskell", "Scala", "Clojure", "Groovy", "Elixir", "PHP",
    "Swift", "Kotlin", "Erlang", "Bash", "unknown",
  ])
  export const TOOLING_DEFAULTS: ReadonlySet<string> = new Set([
    "stl", "win32", "POSIX", "Standard Library", "Standard C Library",
    "test-framework", "cmake",
  ])

  export interface FrameworkPattern {
    name: string
    framework: string
    language: string
    confidence: number
    description: string
    antiPattern?: boolean
    severity?: "info" | "warning" | "error"
    suggestion?: string
    examples: string[]
  }

  export interface ArchitecturalInsight {
    pattern: string
    category: "design_pattern" | "anti_pattern" | "framework_usage" | "performance" | "security"
    impact: "low" | "medium" | "high" | "critical"
    description: string
    location: ASTEngine.UniversalSymbol["range"]
    suggestions: string[]
  }

  export class FrameworkDetector {
    private patterns = new Map<string, FrameworkPattern[]>()
    private insights: ArchitecturalInsight[] = []

    constructor() {
      this.initializePatterns()
    }

    public analyzeFrameworkUsage(
      symbols: ASTEngine.UniversalSymbol[],
      relationships: ASTEngine.UniversalRelationship[],
      imports: ASTEngine.ImportInfo[],
      content: string,
      language: string
    ): {
      detectedFrameworks: string[]
      patterns: FrameworkPattern[]
      insights: ArchitecturalInsight[]
      architecturalScore: number
    } {
      const detectedFrameworks = this.detectFrameworks(imports, content, language)
      const patterns: FrameworkPattern[] = []
      this.insights = []

      // Analyze patterns for each detected framework
      for (const framework of detectedFrameworks) {
        const frameworkPatterns = this.analyzeFrameworkPatterns(
          framework,
          symbols,
          relationships,
          content,
          language
        )
        patterns.push(...frameworkPatterns)
      }

      // Generate architectural insights
      this.generateArchitecturalInsights(symbols, relationships, patterns, content)

      const architecturalScore = this.calculateArchitecturalScore(patterns, this.insights)

      return {
        detectedFrameworks,
        patterns,
        insights: this.insights,
        architecturalScore
      }
    }

    private detectFrameworks(imports: ASTEngine.ImportInfo[], content: string, language: string): string[] {
      const frameworks = new Set<string>()

      // Language-specific framework detection. Only languages that have a
      // dedicated detector below are routed here; every other language relies
      // on its own analyzer's detection (which is merged in enhanceWithFrameworkIntelligence)
      // and must NOT run a foreign language's detector (that would fabricate
      // detections, e.g. a CSS file containing the word "gradle" would be
      // flagged as Grails by the Groovy detector).
      switch (language) {
        case "typescript":
        case "javascript":
          this.detectJavaScriptFrameworks(imports, content, frameworks)
          break
        case "python":
          this.detectPythonFrameworks(imports, content, frameworks)
          break
        case "java":
          this.detectJavaFrameworks(imports, content, frameworks)
          break
        case "csharp":
        case "fsharp":
          this.detectDotNetFrameworks(imports, content, frameworks)
          break
        case "ruby":
          this.detectRubyFrameworks(imports, content, frameworks)
          break
        case "swift":
          this.detectSwiftFrameworks(imports, content, frameworks)
          break
        case "kotlin":
          this.detectKotlinFrameworks(imports, content, frameworks)
          break
        case "go":
          this.detectGoFrameworks(imports, content, frameworks)
          break
        case "rust":
          this.detectRustFrameworks(imports, content, frameworks)
          break
        case "lua":
          this.detectLuaFrameworks(imports, content, frameworks)
          break
        case "dart":
          this.detectDartFrameworks(imports, content, frameworks)
          break
        case "elixir":
          this.detectElixirFrameworks(imports, content, frameworks)
          break
        case "sql":
          this.detectSqlFrameworks(imports, content, frameworks)
          break
        case "scala":
          this.detectScalaFrameworks(imports, content, frameworks)
          break
        case "haskell":
          this.detectHaskellFrameworks(imports, content, frameworks)
          break
        case "erlang":
          this.detectErlangFrameworks(imports, content, frameworks)
          break
        case "c":
        case "cpp":
          this.detectCCppFrameworks(imports, content, frameworks)
          break
        case "groovy":
          this.detectGroovyFrameworks(imports, content, frameworks)
          break
        default:
          // php/perl/r/powershell/json/yaml/html/css/hcl/objective-c/graphql/
          // zig/svelte/vue/clojure/markdown/xml/makefile/bash: detection is
          // analyzer-owned; do not run foreign detectors here.
          break
      }

      return Array.from(frameworks)
    }

    private detectSqlFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // dbt (Jinja-templated SQL)
      if (
        content.includes("{{ config(") ||
        content.includes("{{ ref(") ||
        content.includes("{{ source(") ||
        content.includes("{% ") ||
        content.includes("materialized=") ||
        content.includes("{{ dbt_")
      ) {
        frameworks.add("dbt")
      }
      // Dialect hints in comments / CREATE statements
      if (/--\s*(postgres|postgresql)/i.test(content) || /postgresql/i.test(content.slice(0, 500))) frameworks.add("postgresql")
      if (/--\s*mysql/i.test(content) || /\bmysql\b/i.test(content.slice(0, 500))) frameworks.add("mysql")
    }
    private detectDartFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      if (this.hasImport(imports, "package:flutter") || content.includes("Flutter") || content.includes("Widget build") || content.includes("StatelessWidget") || content.includes("StatefulWidget") || content.includes("MaterialApp")) {
        frameworks.add("flutter")
        if (this.hasImport(imports, "package:flutter_bloc") || content.includes("BlocProvider") || content.includes("BlocBuilder")) frameworks.add("flutter-bloc")
        if (this.hasImport(imports, "package:riverpod") || content.includes("riverpod")) frameworks.add("riverpod")
        if (this.hasImport(imports, "package:provider") || content.includes("ChangeNotifierProvider")) frameworks.add("provider")
        if (this.hasImport(imports, "package:dio") || content.includes("Dio()")) frameworks.add("dio")
        if (content.includes("Get.put") || this.hasImport(imports, "package:get")) frameworks.add("getx")
      }
      if (this.hasImport(imports, "package:angular") || content.includes("@Component")) frameworks.add("angular-dart")
      if (this.hasImport(imports, "package:test") || content.includes("test(") || content.includes("expect(")) frameworks.add("dart-test")
    }

    private detectElixirFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      if (content.includes("use Phoenix") || content.includes("Phoenix.") || this.hasImport(imports, "phoenix")) {
        frameworks.add("phoenix")
        if (content.includes("Ecto.") || this.hasImport(imports, "ecto")) frameworks.add("ecto")
      }
      if (content.includes("Plug.") || this.hasImport(imports, "plug")) frameworks.add("plug")
      if (content.includes("defmodule") && content.includes("use ExUnit")) frameworks.add("exunit")
      if (content.includes("Broadway") || this.hasImport(imports, "broadway")) frameworks.add("broadway")
    }

    private detectScalaFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      if (this.hasImport(imports, "play.api") || content.includes("extends Controller")) frameworks.add("play")
      if (this.hasImport(imports, "akka") || content.includes("ActorSystem") || content.includes("ActorRef")) {
        frameworks.add("akka")
        if (content.includes("akka.http") || content.includes("Http()")) frameworks.add("akka-http")
      }
      if (this.hasImport(imports, "org.apache.spark") || content.includes("SparkSession")) frameworks.add("spark")
      if (content.includes("scalatest") || this.hasImport(imports, "org.scalatest")) frameworks.add("scalatest")
      if (this.hasImport(imports, "slick") || content.includes("TableQuery")) frameworks.add("slick")
    }

    private detectHaskellFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      if (this.hasImport(imports, "Yesod") || content.includes("mkYesod")) frameworks.add("yesod")
      if (this.hasImport(imports, "Servant") || content.includes(":>")) frameworks.add("servant")
      if (this.hasImport(imports, "Lens") || content.includes("makeLenses")) frameworks.add("lens")
      if (content.includes("import Test.") || content.includes("QuickCheck")) frameworks.add("hspec-quickcheck")
    }

    private detectErlangFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      if (content.includes("-behaviour(gen_server)") || content.includes("gen_server:") || content.includes("-behaviour(supervisor)")) frameworks.add("otp")
      if (content.includes("cowboy") || content.includes("cowboy_router")) frameworks.add("cowboy")
      if (content.includes("rebar3") || content.includes("rebar.config")) frameworks.add("rebar3")
      if (content.includes("meck:") || content.includes("eunit:") || content.includes("?assert")) frameworks.add("eunit")
    }

    private detectCCppFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      if (content.includes("#include <Q") || content.includes("QApplication") || content.includes("QWidget")) frameworks.add("qt")
      if (content.includes("#include <boost/") || content.includes("boost::")) frameworks.add("boost")
      if (content.includes("glfw") || content.includes("glut") || content.includes("GL/gl") || content.includes("#include <GL/")) frameworks.add("opengl")
      if (content.includes("unittest") || content.includes("gtest") || content.includes("catch2") || content.includes("doctest")) frameworks.add("test-framework")
      if (content.includes("cmake_minimum_required") || content.includes("project(")) frameworks.add("cmake")
    }

    private detectGroovyFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      if (content.includes("@Grab") || content.includes("grails") || content.includes("GrailsApp")) frameworks.add("grails")
      if (content.includes("gradle") || content.includes("buildscript")) frameworks.add("gradle")
      if (content.includes("spock.lang") || content.includes("expect:")) frameworks.add("spock")
    }


    private detectJavaScriptFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // React ecosystem
      if (this.hasImport(imports, "react") || content.includes("React.")) {
        frameworks.add("react")
        if (this.hasImport(imports, "next") || content.includes("getServerSideProps")) {
          frameworks.add("nextjs")
        }
        if (this.hasImport(imports, "gatsby")) {
          frameworks.add("gatsby")
        }
      }

      // Vue ecosystem
      if (this.hasImport(imports, "vue") || content.includes("createApp")) {
        frameworks.add("vue")
        if (this.hasImport(imports, "nuxt")) {
          frameworks.add("nuxtjs")
        }
      }

      // Angular
      if (this.hasImport(imports, "@angular/core") || content.includes("@Component")) {
        frameworks.add("angular")
      }

      // Node.js frameworks
      if (this.hasImport(imports, "express")) {
        frameworks.add("express")
      }
      if (this.hasImport(imports, "fastify")) {
        frameworks.add("fastify")
      }
      if (this.hasImport(imports, "koa")) {
        frameworks.add("koa")
      }

      // Testing frameworks
      if (this.hasImport(imports, "jest") || content.includes("describe(")) {
        frameworks.add("jest")
      }
      if (this.hasImport(imports, "mocha")) {
        frameworks.add("mocha")
      }

      // State management
      if (this.hasImport(imports, "redux") || this.hasImport(imports, "@reduxjs/toolkit")) {
        frameworks.add("redux")
      }
      if (this.hasImport(imports, "zustand")) {
        frameworks.add("zustand")
      }
    }

    private detectPythonFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // Web frameworks
      if (this.hasImport(imports, "django") || content.includes("from django")) {
        frameworks.add("django")
      }
      if (this.hasImport(imports, "flask") || content.includes("from flask")) {
        frameworks.add("flask")
      }
      if (this.hasImport(imports, "fastapi")) {
        frameworks.add("fastapi")
      }
      if (this.hasImport(imports, "tornado")) {
        frameworks.add("tornado")
      }

      // Data science
      if (this.hasImport(imports, "pandas")) {
        frameworks.add("pandas")
      }
      if (this.hasImport(imports, "numpy")) {
        frameworks.add("numpy")
      }
      if (this.hasImport(imports, "tensorflow") || this.hasImport(imports, "tf")) {
        frameworks.add("tensorflow")
      }
      if (this.hasImport(imports, "torch") || this.hasImport(imports, "pytorch")) {
        frameworks.add("pytorch")
      }

      // Testing
      if (this.hasImport(imports, "pytest") || content.includes("def test_")) {
        frameworks.add("pytest")
      }
    }

    private detectJavaFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // Spring ecosystem
      if (this.hasImport(imports, "org.springframework")) {
        frameworks.add("spring")
        if (content.includes("@SpringBootApplication")) {
          frameworks.add("spring-boot")
        }
        if (content.includes("@RestController")) {
          frameworks.add("spring-mvc")
        }
      }

      // Testing
      if (this.hasImport(imports, "org.junit")) {
        frameworks.add("junit")
      }
      if (this.hasImport(imports, "org.mockito")) {
        frameworks.add("mockito")
      }

      // Persistence
      if (this.hasImport(imports, "javax.persistence") || this.hasImport(imports, "jakarta.persistence")) {
        frameworks.add("jpa")
      }
      if (this.hasImport(imports, "org.hibernate")) {
        frameworks.add("hibernate")
      }
    }

    private detectDotNetFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // ASP.NET
      if (this.hasImport(imports, "Microsoft.AspNetCore") || content.includes("using Microsoft.AspNetCore")) {
        frameworks.add("aspnet-core")
      }

      // Entity Framework
      if (this.hasImport(imports, "Microsoft.EntityFrameworkCore")) {
        frameworks.add("entity-framework")
      }

      // Testing
      if (this.hasImport(imports, "Xunit") || content.includes("[Fact]")) {
        frameworks.add("xunit")
      }
      if (this.hasImport(imports, "NUnit")) {
        frameworks.add("nunit")
      }

      // LINQ
      if (content.includes("using System.Linq") || content.includes(".Where(") || content.includes(".Select(")) {
        frameworks.add("linq")
      }
    }

    private detectRubyFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // Rails
      if (content.includes("require 'rails'") || content.includes("class ApplicationController")) {
        frameworks.add("rails")
      }

      // Sinatra
      if (content.includes("require 'sinatra'")) {
        frameworks.add("sinatra")
      }

      // Hanami (#749 named it alongside Sinatra/RSpec as invisible entirely)
      if (content.includes("require 'hanami'")) {
        frameworks.add("hanami")
      }

      // Testing — require-level ONLY. The bare-`describe ` trigger that used to sit
      // beside this was measured FALSE 36/36 on ruby's pinned corpus: rack's test/
      // directory is minitest/spec (test/helper.rb requires
      // 'minitest/global_expectations/autorun'; the Gemfile and gemspec carry no
      // rspec at all), yet every one of its 36 `describe` files published
      // ["rspec"] through the published seam — the analyzer cannot be blamed, it
      // never reads `describe`; the trigger could not tell rspec from
      // minitest/spec, and minitest/spec won 36–0. A detection whose corpus
      // evidence is 0 true / 36 false is a false detector, and the fixture harness
      // cannot see it because framework-intelligence runs only in the published
      // seam — which is why the pin lives in framework-surface-probe.ts
      // (ruby/plain-describe-minitest, expectAbsent) rather than an m14 fixture.
      if (content.includes("require 'rspec'")) {
        frameworks.add("rspec")
      }
    }

    private detectPHPFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // Laravel
      if (content.includes("use Illuminate\\") || content.includes("Artisan::")) {
        frameworks.add("laravel")
      }

      // Symfony
      if (content.includes("use Symfony\\")) {
        frameworks.add("symfony")
      }

      // CodeIgniter
      if (content.includes("class CI_Controller") || content.includes("$this->load->")) {
        frameworks.add("codeigniter")
      }
    }

    private detectSwiftFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // iOS/macOS
      if (this.hasImport(imports, "UIKit")) {
        frameworks.add("uikit")
      }
      if (this.hasImport(imports, "SwiftUI")) {
        frameworks.add("swiftui")
      }
      if (this.hasImport(imports, "Combine")) {
        frameworks.add("combine")
      }
      // Server-side / async
      if (this.hasImport(imports, "NIO") || this.hasImport(imports, "NIOCore") || this.hasImport(imports, "NIOHTTP1") || content.includes("import NIO")) {
        frameworks.add("swift-nio")
      }
      if (this.hasImport(imports, "Vapor") || content.includes("Vapor")) {
        frameworks.add("vapor")
      }
      if (this.hasImport(imports, "XCTest") || content.includes("XCTest")) {
        frameworks.add("xctest")
      }
    }

    private detectKotlinFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // Android
      if (this.hasImport(imports, "android") || this.hasImport(imports, "androidx")) {
        frameworks.add("android")
      }

      // Coroutines
      if (this.hasImport(imports, "kotlinx.coroutines")) {
        frameworks.add("kotlin-coroutines")
      }

      // Spring Boot with Kotlin
      if (this.hasImport(imports, "org.springframework")) {
        frameworks.add("spring-kotlin")
      }
    }

    private detectGoFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // Web frameworks
      if (this.hasImport(imports, "gin-gonic/gin")) {
        frameworks.add("gin")
      }
      if (this.hasImport(imports, "gorilla/mux")) {
        frameworks.add("gorilla")
      }
      if (this.hasImport(imports, "echo")) {
        frameworks.add("echo")
      }
    }

    private detectRustFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
      // Web frameworks. Rust crate names use underscores (actix_web, axum),
      // not the hyphenated package names (actix-web) — check both forms.
      if (this.hasImport(imports, "actix_web") || this.hasImport(imports, "actix-web") || content.includes("#[actix_web::main]")) {
        frameworks.add("actix-web")
      }
      if (this.hasImport(imports, "axum") || content.includes("axum::")) {
        frameworks.add("axum")
      }
      if (this.hasImport(imports, "warp")) {
        frameworks.add("warp")
      }
      if (this.hasImport(imports, "rocket") || content.includes("#[rocket::")) {
        frameworks.add("rocket")
      }
      if (this.hasImport(imports, "poem")) {
        frameworks.add("poem")
      }

      // Async runtimes
      if (this.hasImport(imports, "tokio") || content.includes("#[tokio::main]")) {
        frameworks.add("tokio")
      }
      if (this.hasImport(imports, "async_std")) {
        frameworks.add("async-std")
      }

      // Parallelism
      if (this.hasImport(imports, "rayon") || content.includes("rayon::")) {
        frameworks.add("rayon")
      }

      // Serialization / other common crates
      if (this.hasImport(imports, "serde") || content.includes("#[derive(Serialize")) {
        frameworks.add("serde")
      }
      if (this.hasImport(imports, "clap")) {
        frameworks.add("clap")
      }
      if (this.hasImport(imports, "diesel")) {
        frameworks.add("diesel")
      }
      if (this.hasImport(imports, "sqlx")) {
        frameworks.add("sqlx")
      }
    }

      private detectLuaFrameworks(imports: ASTEngine.ImportInfo[], content: string, frameworks: Set<string>) {
        const mods = imports
          .map((i) => i.module)
          .filter((m): m is string => typeof m === "string")
        const has = (name: string) => mods.some((m) => m === name || m.startsWith(`${name}.`) || m.includes(`.${name}.`))

        if (content.includes("love.") || content.includes("love.load")) frameworks.add("Love2D")
        if (content.includes("ngx.") || content.includes("resty.") || has("resty")) frameworks.add("OpenResty")
        if (content.includes("game:GetService") || content.includes("Instance.new")) frameworks.add("Roblox")
        if (content.includes("lapis.Application") || has("lapis") || /require\s*\(?\s*["']lapis(?:[./][^"']*)?["']/.test(content)) {
          frameworks.add("Lapis")
        }
      }

    private analyzeFrameworkPatterns(
      framework: string,
      symbols: ASTEngine.UniversalSymbol[],
      relationships: ASTEngine.UniversalRelationship[],
      content: string,
      language: string
    ): FrameworkPattern[] {
      const patterns: FrameworkPattern[] = []
      const frameworkPatterns = this.patterns.get(framework) || []

      for (const pattern of frameworkPatterns) {
        if (this.detectPattern(pattern, symbols, relationships, content)) {
          patterns.push(pattern)
        }
      }

      return patterns
    }

    private detectPattern(
      pattern: FrameworkPattern,
      symbols: ASTEngine.UniversalSymbol[],
      relationships: ASTEngine.UniversalRelationship[],
      content: string
    ): boolean {
      // Pattern detection logic based on pattern name
      switch (pattern.name) {
        case "react-hooks-usage":
          return this.detectReactHooks(symbols, content)
        case "redux-store-structure":
          return this.detectReduxStore(symbols, relationships)
        case "django-model-relations":
          return this.detectDjangoModels(symbols, content)
        case "spring-dependency-injection":
          return this.detectSpringDI(symbols, content)
        case "rails-active-record":
          return this.detectRailsActiveRecord(symbols, content)
        case "swiftui-declarative":
          return this.detectSwiftUIPatterns(symbols, content)
        default:
          return false
      }
    }

    private detectReactHooks(symbols: ASTEngine.UniversalSymbol[], content: string): boolean {
      const hookPatterns = ["useState", "useEffect", "useContext", "useReducer", "useMemo", "useCallback"]
      return hookPatterns.some(hook => content.includes(hook))
    }

    private detectReduxStore(symbols: ASTEngine.UniversalSymbol[], relationships: ASTEngine.UniversalRelationship[]): boolean {
      const hasStore = symbols.some(s => s.name.includes("store") || s.name.includes("reducer"))
      const hasActions = symbols.some(s => s.name.includes("action") || s.name.includes("dispatch"))
      return hasStore && hasActions
    }

    private detectDjangoModels(symbols: ASTEngine.UniversalSymbol[], content: string): boolean {
      return symbols.some(s =>
        s.kind === ASTEngine.SymbolKind.Class &&
        (content.includes("models.Model") || content.includes("class Meta:"))
      )
    }

    private detectSpringDI(symbols: ASTEngine.UniversalSymbol[], content: string): boolean {
      const diAnnotations = ["@Autowired", "@Component", "@Service", "@Repository", "@Controller"]
      return diAnnotations.some(annotation => content.includes(annotation))
    }

    private detectRailsActiveRecord(symbols: ASTEngine.UniversalSymbol[], content: string): boolean {
      return symbols.some(s =>
        s.kind === ASTEngine.SymbolKind.Class &&
        content.includes("< ApplicationRecord")
      )
    }

    private detectSwiftUIPatterns(symbols: ASTEngine.UniversalSymbol[], content: string): boolean {
      const swiftuiPatterns = ["@State", "@Binding", "@ObservedObject", "@StateObject", "View"]
      return swiftuiPatterns.some(pattern => content.includes(pattern))
    }

    private generateArchitecturalInsights(
      symbols: ASTEngine.UniversalSymbol[],
      relationships: ASTEngine.UniversalRelationship[],
      patterns: FrameworkPattern[],
      content: string
    ) {
      // Analyze code complexity
      this.analyzeComplexity(symbols)

      // Check for anti-patterns
      this.detectAntiPatterns(symbols, relationships, content)

      // Analyze framework usage quality
      this.analyzeFrameworkUsageQuality(patterns, symbols)

      // Check for security issues
      this.analyzeSecurityPatterns(symbols, content)
    }

    private analyzeComplexity(symbols: ASTEngine.UniversalSymbol[]) {
      const functions = symbols.filter(s => s.kind === ASTEngine.SymbolKind.Function)

      for (const func of functions) {
        const complexity = func.metadata?.cyclomaticComplexity || 0

        if (complexity > 10) {
          this.insights.push({
            pattern: "high-complexity-function",
            category: "performance",
            impact: complexity > 20 ? "critical" : "high",
            description: `Function ${func.name} has high cyclomatic complexity (${complexity})`,
            location: func.range,
            suggestions: [
              "Break down into smaller functions",
              "Extract common logic into helper methods",
              "Consider using strategy pattern for complex conditionals"
            ]
          })
        }
      }
    }

    private detectAntiPatterns(
      symbols: ASTEngine.UniversalSymbol[],
      relationships: ASTEngine.UniversalRelationship[],
      content: string
    ) {
      // God class detection
      const classes = symbols.filter(s => s.kind === ASTEngine.SymbolKind.Class);
      const methodsByOwner = new Map<string, any[]>();
      for (const s of symbols) {
        if (s.kind === ASTEngine.SymbolKind.Method && s.ownerName) {
          let list = methodsByOwner.get(s.ownerName);
          if (!list) { list = []; methodsByOwner.set(s.ownerName, list); }
          list.push(s);
        }
      }
      for (const cls of classes) {
        const classMethods = methodsByOwner.get(cls.name) || [];

        if (classMethods.length > 20) {
          this.insights.push({
            pattern: "god-class",
            category: "anti_pattern",
            impact: "high",
            description: `Class ${cls.name} has too many methods (${classMethods.length})`,
            location: cls.range,
            suggestions: [
              "Split class into smaller, focused classes",
              "Apply Single Responsibility Principle",
              "Extract related methods into separate classes"
            ]
          })
        }
      }

      // Long parameter list
      const functions = symbols.filter(s => s.kind === ASTEngine.SymbolKind.Function)
      for (const func of functions) {
        const paramCount = func.parameters?.length || 0

        if (paramCount > 5) {
          this.insights.push({
            pattern: "long-parameter-list",
            category: "anti_pattern",
            impact: "medium",
            description: `Function ${func.name} has too many parameters (${paramCount})`,
            location: func.range,
            suggestions: [
              "Group related parameters into objects",
              "Use builder pattern for complex constructors",
              "Consider parameter objects or configuration objects"
            ]
          })
        }
      }
    }

    private analyzeFrameworkUsageQuality(patterns: FrameworkPattern[], symbols: ASTEngine.UniversalSymbol[]) {
      // Check for proper framework patterns usage
      const antiPatterns = patterns.filter(p => p.antiPattern)

      for (const antiPattern of antiPatterns) {
        this.insights.push({
          pattern: antiPattern.name,
          category: "framework_usage",
          impact: antiPattern.severity === `warning` ? "high" : "medium",
          description: antiPattern.description,
          location: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, // TODO: Get actual location
          suggestions: antiPattern.suggestion ? [antiPattern.suggestion] : []
        })
      }
    }

    private analyzeSecurityPatterns(symbols: ASTEngine.UniversalSymbol[], content: string) {
      // Check for potential security issues
      if (content.includes("eval(") || content.includes("Function(")) {
        this.insights.push({
          pattern: "dangerous-eval-usage",
          category: "security",
          impact: "critical",
          description: "Use of eval() or Function() constructor detected",
          location: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          suggestions: [
            "Avoid using eval() - use JSON.parse() for data parsing",
            "Use safer alternatives like computed properties",
            "Validate and sanitize all inputs"
          ]
        })
      }

      if (content.includes("innerHTML") && !content.includes("DOMPurify")) {
        this.insights.push({
          pattern: "xss-vulnerability",
          category: "security",
          impact: "high",
          description: "Potential XSS vulnerability through innerHTML usage",
          location: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          suggestions: [
            "Use textContent instead of innerHTML when possible",
            "Sanitize HTML content with libraries like DOMPurify",
            "Use template engines with automatic escaping"
          ]
        })
      }
    }

    private calculateArchitecturalScore(patterns: FrameworkPattern[], insights: ArchitecturalInsight[]): number {
      let score = 100

      // Deduct points for anti-patterns and issues
      for (const insight of insights) {
        switch (insight.impact) {
          case "critical":
            score -= 20
            break
          case "high":
            score -= 10
            break
          case "medium":
            score -= 5
            break
          case "low":
            score -= 2
            break
        }
      }

      // Add points for good patterns
      const goodPatterns = patterns.filter(p => !p.antiPattern)
      score += goodPatterns.length * 2

      return Math.max(0, Math.min(100, score))
    }

    private hasImport(imports: ASTEngine.ImportInfo[], module: string): boolean {
      return imports.some(imp => (imp.module || "").includes(module))
    }

    private initializePatterns() {
      // React patterns
      this.patterns.set("react", [
        {
          name: "react-hooks-usage",
          framework: "react",
          language: "javascript",
          confidence: 0.9,
          description: "Proper React Hooks usage for state management",
          examples: ["useState", "useEffect", "useContext"]
        },
        {
          name: "react-class-components",
          framework: "react",
          language: "javascript",
          confidence: 0.8,
          description: "Legacy class components detected",
          antiPattern: true,
          severity: "warning",
          suggestion: "Consider migrating to functional components with hooks",
          examples: ["class Component extends React.Component"]
        }
      ])

      // Redux patterns
      this.patterns.set("redux", [
        {
          name: "redux-store-structure",
          framework: "redux",
          language: "javascript",
          confidence: 0.9,
          description: "Well-structured Redux store with actions and reducers",
          examples: ["createStore", "combineReducers", "dispatch"]
        }
      ])

      // Django patterns
      this.patterns.set("django", [
        {
          name: "django-model-relations",
          framework: "django",
          language: "python",
          confidence: 0.9,
          description: "Django model relationships and field definitions",
          examples: ["models.Model", "ForeignKey", "ManyToManyField"]
        }
      ])

      // Spring patterns
      this.patterns.set("spring", [
        {
          name: "spring-dependency-injection",
          framework: "spring",
          language: "java",
          confidence: 0.9,
          description: "Proper Spring dependency injection usage",
          examples: ["@Autowired", "@Component", "@Service"]
        }
      ])

      // Rails patterns
      this.patterns.set("rails", [
        {
          name: "rails-active-record",
          framework: "rails",
          language: "ruby",
          confidence: 0.9,
          description: "Rails Active Record model definitions",
          examples: ["< ApplicationRecord", "has_many", "belongs_to"]
        }
      ])

      // SwiftUI patterns
      this.patterns.set("swiftui", [
        {
          name: "swiftui-declarative",
          framework: "swiftui",
          language: "swift",
          confidence: 0.9,
          description: "Declarative SwiftUI view definitions",
          examples: ["@State", "@Binding", "View"]
        }
      ])
    }
  }  // --------------------------------------------------------------------------
  // Primary-framework promotion
  // --------------------------------------------------------------------------
  // Analyzers set `metadata.framework` from their OWN detection list, which is
  // frequently empty or a pure-language name ("JavaScript", "SQL",
  // "unknown") while the real framework detection happens here in
  // FrameworkIntelligence. Without promotion, a Django file keeps
  // `framework = "unknown"` even though `detectedFrameworks = ["django"]`,
  // and an Express file keeps `framework = "JavaScript"`.
  //
  // Two categories:
  //   PURE_LANGUAGE_PRIMARIES — names analyzers emit when they found nothing
  //     specific. These are PROMOTABLE: if the merged list contains a real
  //     framework, the primary becomes the first real entry.
  //   TOOLING_DEFAULTS — standard-library / platform / tooling detections
  //     ("stl", "win32", "POSIX", "test-framework"...) that are not user
  //     frameworks. They never win promotion when a real framework exists,
  //     but may serve as a fallback primary when nothing real was found.
  //
  // Deliberate analyzer choices that are NOT in PURE_LANGUAGE_PRIMARIES — e.g.
  // HTML "HTML5", Vue "Vue", Svelte "Svelte", C "Standard C Library",
  // Bash "Bash Script", HCL "HCL/Terraform", Java "spring", PHP "Laravel",
  // Haskell "Servant" — are treated as real primaries and never overwritten.
  // The two policy sets are module-scope exports above (M60.R8): the rule they encode —
  // which primaries are honest defaults rather than framework claims — has to be readable
  // by the instruments that verify this function's output, or they will re-derive it and
  // convict the policy.

  // --------------------------------------------------------------------------
  // Detection canonicalization
  // --------------------------------------------------------------------------
  // Analyzers and FrameworkIntelligence use slightly different spellings for the
  // same framework (Java analyzer emits "spring_mvc", FI emits "spring-mvc";
  // analyzer emits "SwiftUI", FI emits "swiftui"). Without normalization the
  // detected list contains near-duplicates that pollute framework intelligence.
  // Canonical form: hyphenated slug. Case is deduplicated case-insensitively,
  // keeping the first (analyzer-preferred) casing.
  const FRAMEWORK_ALIASES: Record<string, string> = {
    spring_mvc: "spring-mvc",
    spring_data: "spring-data",
    spring_core: "spring-core",
    aspnet: "aspnet-core",
    entityframework: "entity-framework",
    aspnet_core: "aspnet-core",
    entity_framework: "entity-framework",
    expressjs: "express",
    fastifyjs: "fastify",
    reactjs: "react",
    vuejs: "vue",
    next_js: "nextjs",
    nextjs: "nextjs",
    "flutter-bloc": "flutter-bloc",
    kotlin_coroutines: "kotlin-coroutines",
    spring_kotlin: "spring-kotlin",
    actix_web: "actix-web",
    async_std: "async-std",
    "Play Framework": "play",
    "play framework": "play",
    gorilla_mux: "gorilla",
    gorillamux: "gorilla",
    // #932 — ONE framework, ONE name. The ruby lane publishes `"Ruby on Rails"`
    // (`RAILS_FRAMEWORK`, whose own header records that the two-spelling defect was
    // fixed on the patterns surface) while `detectRubyFrameworks` below adds the slug
    // `"rails"`, and `canonicalizeDetections` dedupes by ALIASED lowercase — `"rails"`
    // and `"ruby on rails"` are different keys, so both survived into one payload and a
    // consumer keying on the framework string saw two frameworks. MEASURED through
    // `ASTEngine.parseFile` on `require 'rails'` + an ActiveRecord subclass: the
    // published list read `["Ruby on Rails","rails"]`. The alias map is where this
    // repository already puts exactly this policy (swift's `swiftui` slug, the
    // `aspnet`/`entityframework` pairs), so the slug is canonicalised HERE rather than
    // in the detector: the detector's vocabulary may stay a slug table ("rspec",
    // "nunit", "linq" all live there), but the PUBLISHED list answers to one name.
    rails: "Ruby on Rails",
    "ruby on rails": "Ruby on Rails",
  }

  function canonicalizeDetections(detections: string[]): string[] {
    const seen = new Map<string, string>() // lowercased -> canonical display form
    for (const raw of detections) {
      const name = (raw || "").trim()
      if (!name) continue
      const aliased = FRAMEWORK_ALIASES[name.toLowerCase()] ?? name
      const lower = aliased.toLowerCase()
      if (!seen.has(lower)) seen.set(lower, aliased)
    }
    return Array.from(seen.values())
  }

  /**
   * Bring published pattern entries onto the published detection list. (M60.R8, CONV-OC-1)
   *
   * `frameworkPatterns[i].framework` is a claim ABOUT a detection, so it has to name one:
   * the family contract (real-csharp-analyzer.ts CONV-CS-2) is three keys that agree, and a
   * consumer that joins the two arrays by name is entitled to find every pattern's
   * framework in the list. The merge violated that in two measured ways, both on real
   * corpus files (70 of them, which no instrument had seen because the published half was
   * convicting 1,207 files for the no-detection default instead):
   *
   *   * SPELLING — the detector appends its own slug (`swiftui`) beside the analyzer's
   *     display name (`SwiftUI`), because the alias map that canonicalises the detection
   *     list was never applied to the appended pattern objects. Canonicalising through the
   *     same map and then matching case-insensitively onto the published spelling fixes it.
   *   * NOT A FRAMEWORK — dart's lane emits the SDK name `Dart` in both arrays, and the
   *     detection filter below removes it (a language is not a framework), leaving the
   *     patterns naming a framework the published list no longer carries. Such an entry is
   *     dropped rather than relabelled: relabelling would invent a claim about a framework
   *     that was not detected, and the pattern NAMES are still published in
   *     `metadata.patterns`, so no observation is lost.
   *
   * Returned as a pure function so it can be tested on its own — the probe drives it
   * directly, and a behaviour this load-bearing should not be reachable only through
   * `parseFile` on a real corpus file.
   */
  export function alignFrameworkPatterns<T extends { framework?: unknown }>(
    patterns: readonly T[],
    detections: readonly string[],
  ): T[] {
    // Published spelling per lowercased name — the detection list is already canonical.
    const displayOf = new Map<string, string>()
    for (const d of detections) {
      const n = String(d || "").trim()
      if (n && !displayOf.has(n.toLowerCase())) displayOf.set(n.toLowerCase(), n)
    }
    const out: T[] = []
    for (const p of patterns) {
      const raw = typeof p?.framework === "string" ? (p.framework as string) : ""
      if (!raw) continue
      const canonical = FRAMEWORK_ALIASES[raw.toLowerCase()] ?? raw
      const display = displayOf.get(canonical.toLowerCase()) ?? displayOf.get(raw.toLowerCase())
      if (!display) continue
      out.push(display === raw ? p : ({ ...(p as object), framework: display } as T))
    }
    return out
  }

  // Integration function to enhance analyzer results
  export function enhanceWithFrameworkIntelligence(
    result: Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> },
    content: string,
    language: string
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const detector = new FrameworkDetector()

    const analysis = detector.analyzeFrameworkUsage(
      result.symbols,
      result.relationships,
      result.imports,
      content,
      language
    )

    const prev = result.metadata || {}
    const found = new Set<string>([...(prev.detectedFrameworks || []), ...analysis.detectedFrameworks])
    const pats = [...(prev.frameworkPatterns || []), ...analysis.patterns]
    const allDetections = canonicalizeDetections(Array.from(found))
    // detectedFrameworks lists REAL frameworks/libraries only — pure language
    // names ("JavaScript", "SQL", "Bash") and tooling defaults ("stl",
    // "cmake") are filtered out so the list is actionable. The primary
    // `framework` may still be a language default when nothing real was found.
    const mergedDetections = allDetections.filter(
      (f) => !PURE_LANGUAGE_PRIMARIES.has(f) && !TOOLING_DEFAULTS.has(f)
    )

    // Promote the primary framework from the merged detection list. Promotion
    // considers ALL detections (including language defaults like "SQL") so a
    // plain SQL file keeps `framework = "SQL"` — only the emitted
    // detectedFrameworks list is filtered to real frameworks.
    let primaryFramework = prev.framework
    const isReal = (f: string) => !PURE_LANGUAGE_PRIMARIES.has(f) && !TOOLING_DEFAULTS.has(f)
    if (!primaryFramework || primaryFramework === "unknown") {
      // Missing primary: take the first real framework, else the first
      // detection (may be a tooling default like "stl" / "SQL").
      primaryFramework =
        allDetections.find(isReal) ??
        allDetections.find((f) => !TOOLING_DEFAULTS.has(f)) ??
        allDetections[0] ??
        "unknown"
    } else if (PURE_LANGUAGE_PRIMARIES.has(primaryFramework)) {
      // Analyzer emitted a pure-language name but a real framework exists.
      const real = allDetections.find(isReal)
      if (real) primaryFramework = real
    }
    // Otherwise keep the analyzer's deliberate value unchanged.

    // Canonicalize the primary through the same alias map used for the
    // detected list (e.g. Go analyzer emits "gorilla_mux", canonical "gorilla").
    if (primaryFramework) {
      primaryFramework = FRAMEWORK_ALIASES[primaryFramework.toLowerCase()] ?? primaryFramework
    }


    // Enhance metadata with framework intelligence
    result.metadata = {
      ...prev,
      framework: primaryFramework,
      detectedFrameworks: mergedDetections,
      // Aligned with the list this same object publishes, so the three keys are one claim.
      frameworkPatterns: alignFrameworkPatterns(pats, mergedDetections),
      architecturalInsights: analysis.insights,
      architecturalScore: analysis.architecturalScore,
      codeQuality: analysis.architecturalScore >= 80 ? "excellent" :
                   analysis.architecturalScore >= 60 ? "good" :
                   analysis.architecturalScore >= 40 ? "fair" : "poor"
    }

    return result
  }
}