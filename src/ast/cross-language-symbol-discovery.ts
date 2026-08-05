// Cross-Language Symbol Discovery Engine
// Discovers and correlates symbols across ALL 26 languages
// NO STONE LEFT UNTURNED - Every API, service, model, config is traced!

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "symbol-discovery" })

export namespace CrossLanguageSymbolDiscovery {
  /**
   * PHASE 1: SYMBOL DISCOVERY
   * Discovers ALL cross-language symbols with precision
   */
  export async function discoverCrossLanguageSymbols(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    log.info("🔍 Starting Symbol Discovery across ALL languages")

    const discoveredSymbols: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const symbolCorrelator = new SymbolCorrelator(fileResults)

    // STEP 1: 🌐 API ENDPOINT DISCOVERY - Find ALL API endpoints
    const apiEndpoints = await discoverAPIEndpoints(fileResults)
    log.info("🔗 API endpoints discovered", { count: apiEndpoints.length })

    // STEP 2: 🏗️ DATA MODEL DISCOVERY - Find ALL data models/schemas
    const dataModels = await discoverDataModels(fileResults)
    log.info("📊 Data models discovered", { count: dataModels.length })

    // STEP 3: 🎛️ SERVICE DISCOVERY - Find ALL services/microservices
    const services = await discoverServices(fileResults)
    log.info("🏢 Services discovered", { count: services.length })

    // STEP 4: 🗄️ DATABASE ENTITY DISCOVERY - Find ALL database entities
    const databaseEntities = await discoverDatabaseEntities(fileResults)
    log.info("💾 Database entities discovered", { count: databaseEntities.length })

    // STEP 5: 📨 MESSAGE TYPE DISCOVERY - Find ALL message/event types
    const messageTypes = await discoverMessageTypes(fileResults)
    log.info("💌 Message types discovered", { count: messageTypes.length })

    // STEP 6: ⚙️ CONFIGURATION DISCOVERY - Find ALL configuration symbols
    const configurations = await discoverConfigurations(fileResults)
    log.info("🔧 Configurations discovered", { count: configurations.length })

    // STEP 7: 📚 SHARED LIBRARY DISCOVERY - Find ALL shared libraries/modules
    const sharedLibraries = await discoverSharedLibraries(fileResults)
    log.info("📖 Shared libraries discovered", { count: sharedLibraries.length })

    // STEP 8: 🧬 SYMBOL CORRELATION - Correlate symbols across languages
    const correlatedSymbols = await symbolCorrelator.correlateSymbols([
      ...apiEndpoints,
      ...dataModels,
      ...services,
      ...databaseEntities,
      ...messageTypes,
      ...configurations,
      ...sharedLibraries,
    ])

    log.info("🚀 SYMBOL DISCOVERY COMPLETE!", {
      totalSymbols: correlatedSymbols.length,
      byType: {
        apiEndpoints: correlatedSymbols.filter(
          (s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.API_ENDPOINT,
        ).length,
        dataModels: correlatedSymbols.filter(
          (s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL,
        ).length,
        services: correlatedSymbols.filter((s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.SERVICE)
          .length,
        databaseEntities: correlatedSymbols.filter(
          (s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.DATABASE_ENTITY,
        ).length,
        messageTypes: correlatedSymbols.filter(
          (s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.MESSAGE_TYPE,
        ).length,
        configurations: correlatedSymbols.filter(
          (s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.CONFIGURATION,
        ).length,
        sharedLibraries: correlatedSymbols.filter(
          (s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.SHARED_LIBRARY,
        ).length,
      },
    })

    return correlatedSymbols
  }

  // ======================== API ENDPOINT DISCOVERY ========================

  /**
   * Discovers API endpoints across ALL web frameworks and languages
   */
  async function discoverAPIEndpoints(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const endpointPatterns = new APIEndpointPatterns(fileResults)

    for (const [filePath, result] of fileResults) {
      const language = result.language

      // Language-specific endpoint discovery
      switch (language) {
        case "javascript":
        case "typescript":
          endpoints.push(...endpointPatterns.discoverJavaScriptEndpoints(result, filePath))
          break
        case "python":
          endpoints.push(...endpointPatterns.discoverPythonEndpoints(result, filePath))
          break
        case "java":
          endpoints.push(...endpointPatterns.discoverJavaEndpoints(result, filePath))
          break
        case "csharp":
        case "fsharp":
          endpoints.push(...endpointPatterns.discoverCSharpEndpoints(result, filePath))
          break
        case "go":
        case "graphql":
        case "groovy":
        case "objective-c":
        case "hcl":
          endpoints.push(...endpointPatterns.discoverGoEndpoints(result, filePath))
          break
        case "rust":
          endpoints.push(...endpointPatterns.discoverRustEndpoints(result, filePath))
          break
        case "php":
        case "perl":
        case "powershell":
          break
        case "ruby":
          endpoints.push(...endpointPatterns.discoverRubyEndpoints(result, filePath))
          break
        case "kotlin":
          endpoints.push(...endpointPatterns.discoverKotlinEndpoints(result, filePath))
          break
        case "scala":
          endpoints.push(...endpointPatterns.discoverScalaEndpoints(result, filePath))
          break
        case "swift":
          endpoints.push(...endpointPatterns.discoverSwiftEndpoints(result, filePath))
          break
        case "dart":
          endpoints.push(...endpointPatterns.discoverDartEndpoints(result, filePath))
          break
        case "elixir":
        case "erlang":
          endpoints.push(...endpointPatterns.discoverElixirEndpoints(result, filePath))
          break
        case "clojure":
        case "clean":
          endpoints.push(...endpointPatterns.discoverClojureEndpoints(result, filePath))
          break
        case "cpp":
          endpoints.push(...endpointPatterns.discoverCppEndpoints(result, filePath))
          break
        case "c":
          endpoints.push(...endpointPatterns.discoverCEndpoints(result, filePath))
          break
        case "haskell":
          endpoints.push(...endpointPatterns.discoverHaskellEndpoints(result, filePath))
          break
        case "lua":
          endpoints.push(...endpointPatterns.discoverLuaEndpoints(result, filePath))
          break
        case "r":
          endpoints.push(...endpointPatterns.discoverREndpoints(result, filePath))
          break
        case "json":
          endpoints.push(...endpointPatterns.discoverJsonEndpoints(result, filePath))
          break
        case "yaml":
        case "zig":
        case "yml":
          endpoints.push(...endpointPatterns.discoverYamlEndpoints(result, filePath))
          break
        case "sql":
          endpoints.push(...endpointPatterns.discoverSQLEndpoints(result, filePath))
          break
        case "bash":
        case "sh":
          endpoints.push(...endpointPatterns.discoverBashEndpoints(result, filePath))
          break
        case "html":
        case "css":
          // These typically don't define API endpoints, but they might contain configuration or forms
          // handled in other discovery phases
          break
      }
    }

    return endpoints
  }

  // ======================== DATA MODEL DISCOVERY ========================

  /**
   * Discovers data models, schemas, and structures across ALL languages
   */
  async function discoverDataModels(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const modelPatterns = new DataModelPatterns()

    for (const [filePath, result] of fileResults) {
      const language = result.language

      // Discover language-specific data models
      switch (language) {
        case "javascript":
        case "typescript":
          models.push(...modelPatterns.discoverTypeScriptModels(result, filePath))
          break
        case "python":
          models.push(...modelPatterns.discoverPythonModels(result, filePath))
          break
        case "java":
          models.push(...modelPatterns.discoverJavaModels(result, filePath))
          break
        case "csharp":
        case "fsharp":
          models.push(...modelPatterns.discoverCSharpModels(result, filePath))
          break
        case "go":
        case "graphql":
        case "groovy":
        case "objective-c":
        case "hcl":
          models.push(...modelPatterns.discoverGoModels(result, filePath))
          break
        case "rust":
          models.push(...modelPatterns.discoverRustModels(result, filePath))
          break
        case "kotlin":
          models.push(...modelPatterns.discoverKotlinModels(result, filePath))
          break
        case "scala":
          models.push(...modelPatterns.discoverScalaModels(result, filePath))
          break
        case "swift":
          models.push(...modelPatterns.discoverSwiftModels(result, filePath))
          break
        case "dart":
          models.push(...modelPatterns.discoverDartModels(result, filePath))
          break
        case "elixir":
        case "erlang":
          models.push(...modelPatterns.discoverElixirModels(result, filePath))
          break
        case "haskell":
          models.push(...modelPatterns.discoverHaskellModels(result, filePath))
          break
        case "clojure":
        case "clean":
          models.push(...modelPatterns.discoverClojureModels(result, filePath))
          break
        case "json":
          models.push(...modelPatterns.discoverJsonSchemas(result, filePath))
          break
        case "yaml":
          models.push(...modelPatterns.discoverYamlSchemas(result, filePath))
          break
      }
    }

    return models
  }

  // ======================== PATTERN DETECTION CLASSES ========================

  /**
   * API endpoint detection across ALL frameworks
   */
  class APIEndpointPatterns {
    private fileResults: Map<string, ASTEngine.ParseResult>

    constructor(fileResults: Map<string, ASTEngine.ParseResult>) {
      this.fileResults = fileResults
    }

    discoverJavaScriptEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Express.js patterns - COMPLETE IMPLEMENTATION
      const expressPatterns = [
        // Basic route methods
        /app\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /router\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Express with middleware
        /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*[^,]*,\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+)/g,

        // Express route parameters and wildcards
        /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*:[^'"`]*|[^'"`]*\*[^'"`]*)['"`]/g,
      ]

      // Fastify patterns - COMPLETE IMPLEMENTATION
      const fastifyPatterns = [
        // Basic Fastify routes
        /fastify\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Fastify with options
        /fastify\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*{[^}]*}/g,

        // Fastify register routes
        /fastify\.register\s*\(\s*(?:async\s+)?function\s*\([^)]*\)\s*{[\s\S]*?\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // NestJS patterns - COMPLETE IMPLEMENTATION
      const nestjsPatterns = [
        // Basic decorators
        /@(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/g,
        /@(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(\s*\)/g, // No path specified

        // Controller-level routing
        /@Controller\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/g,

        // Method decorators with multiple parameters
        /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*{[^}]*}\s*\)/g,
      ]

      // Koa.js patterns
      const koaPatterns = [
        /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /app\.use\s*\(\s*router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Hapi.js patterns
      const hapiPatterns = [
        /server\.route\s*\(\s*{\s*method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*path\s*:\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Next.js API routes (file-based routing) - ENHANCED
      if (filePath.includes("/api/") && (filePath.endsWith(".js") || filePath.endsWith(".ts"))) {
        const routePath = this.extractNextJSRoute(filePath)

        // Check for specific HTTP methods in the file
        const content = this.fileResults.get(filePath)?.rawContent || ""
        const httpMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"]

        for (const method of httpMethods) {
          if (
            new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}|const\\s+${method}\\s*=|${method}\\s*:`).test(
              content,
            )
          ) {
            endpoints.push(this.createEndpointSymbol(routePath, method, filePath, "javascript", "Next.js"))
          }
        }
      }

      // Apply all patterns using the applyPatterns method
      this.applyPatterns(
        [...expressPatterns, ...fastifyPatterns, ...nestjsPatterns, ...koaPatterns, ...hapiPatterns],
        result.symbols,
        endpoints,
        filePath,
        "javascript",
      )

      // ADDITIONAL: Search for GraphQL endpoints
      this.detectGraphQLEndpoints(result, filePath, endpoints)

      // ADDITIONAL: Search for Socket.io endpoints
      this.detectSocketIOEndpoints(result, filePath, endpoints)

      return endpoints
    }

    /**
     * GraphQL endpoint detection
     */
    private detectGraphQLEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // GraphQL server patterns
      const graphqlPatterns = [
        /\/graphql|\/api\/graphql|\/query/g,
        /ApolloServer|express-graphql|graphql-yoga/g,
        /typeDefs|resolvers/g,
      ]

      for (const pattern of graphqlPatterns) {
        if (pattern.test(content)) {
          endpoints.push(this.createEndpointSymbol("/graphql", "POST", filePath, "javascript", "GraphQL"))
          break // Only add one GraphQL endpoint per file
        }
      }
    }

    /**
     * Socket.io endpoint detection
     */
    private detectSocketIOEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // Socket.io server patterns
      if (/socket\.io|io\.|io\(/g.test(content)) {
        // Extract socket event handlers
        const eventPatterns = [/\.on\s*\(\s*['"`]([^'"`]+)['"`]/g, /socket\.emit\s*\(\s*['"`]([^'"`]+)['"`]/g]

        for (const pattern of eventPatterns) {
          let match
          while ((match = pattern.exec(content)) !== null) {
            const eventName = match[1]
            endpoints.push(
              this.createEndpointSymbol(`/socket/${eventName}`, "SOCKET", filePath, "javascript", "Socket.io"),
            )
          }
        }
      }
    }

    discoverPythonEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Flask patterns - COMPLETE IMPLEMENTATION
      const flaskPatterns = [
        // Basic Flask routes
        /@app\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*methods\s*=\s*\[['"`](\w+)['"`]\]/g,
        /@app\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g, // Default GET method

        // Flask method decorators
        /@app\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Flask Blueprint routes
        /@bp\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*methods\s*=\s*\[['"`](\w+)['"`]\]/g,
        /@blueprint\.route\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Flask-RESTful resources
        /api\.add_resource\s*\(\s*\w+\s*,\s*['"`]([^'"`]+)['"`]/g,

        // Flask with multiple methods
        /@app\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*methods\s*=\s*\[(.*?)\]/g,
      ]

      // Django patterns - COMPLETE IMPLEMENTATION
      const djangoPatterns = [
        // Django URL patterns
        /path\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*views\.(\w+)/g,
        /url\s*\(\s*r?['"`]\^?([^'"`$]+)\$?['"`]\s*,\s*views\.(\w+)/g,

        // Django rest_framework patterns
        /path\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\.as_view\(\)/g,

        // Django class-based views
        /re_path\s*\(\s*r?['"`]([^'"`]+)['"`]\s*,\s*(\w+)\.as_view/g,

        // Django include patterns
        /path\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*include\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Django admin patterns
        /admin\.site\.urls|admin\/|\/admin\//g,
      ]

      // FastAPI patterns - COMPLETE IMPLEMENTATION
      const fastapiPatterns = [
        // Basic FastAPI decorators
        /@app\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // FastAPI with response models
        /@app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*response_model\s*=\s*\w+/g,

        // FastAPI with status codes
        /@app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*status_code\s*=\s*\d+/g,

        // FastAPI APIRouter
        /@router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // FastAPI dependencies
        /@app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*dependencies\s*=\s*\[/g,
      ]

      // Tornado patterns
      const tornadoPatterns = [/\(\s*r?['"`]([^'"`]+)['"`]\s*,\s*(\w+Handler)\s*\)/g, /Application\s*\(\s*\[(.*?)\]/g]

      // Sanic patterns
      const sanicPatterns = [
        /@app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /@bp\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Quart patterns (async Flask)
      const quartPatterns = [
        /@app\.route\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /@app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Apply all patterns using the applyPatterns method
      this.applyPatterns(
        [
          ...flaskPatterns,
          ...djangoPatterns,
          ...fastapiPatterns,
          ...tornadoPatterns,
          ...sanicPatterns,
          ...quartPatterns,
        ],
        result.symbols,
        endpoints,
        filePath,
        "python",
      )

      // ADDITIONAL: Search for GraphQL endpoints in Python
      this.detectPythonGraphQLEndpoints(result, filePath, endpoints)

      // ADDITIONAL: Search for Celery tasks
      this.detectCeleryTasks(result, filePath, endpoints)

      return endpoints
    }

    /**
     * Python GraphQL endpoint detection
     */
    private detectPythonGraphQLEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // Python GraphQL frameworks
      if (/graphene|strawberry|ariadne|graphql-core/g.test(content)) {
        // Check for GraphQL schema definitions
        if (/Schema|Query|Mutation|Subscription/g.test(content)) {
          endpoints.push(this.createEndpointSymbol("/graphql", "POST", filePath, "python", "GraphQL"))
        }
      }
    }

    /**
     * Celery task detection
     */
    private detectCeleryTasks(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // Celery task patterns
      const celeryPatterns = [/@celery\.task|@app\.task|@shared_task/g, /\.delay\s*\(|\.apply_async\s*\(/g]

      for (const pattern of celeryPatterns) {
        if (pattern.test(content)) {
          // Extract task function names
          const taskPattern = /@(?:celery\.task|app\.task|shared_task)[\s\S]*?def\s+(\w+)/g
          let match

          while ((match = taskPattern.exec(content)) !== null) {
            const taskName = match[1]
            endpoints.push(this.createEndpointSymbol(`/task/${taskName}`, "TASK", filePath, "python", "Celery"))
          }
          break
        }
      }
    }

    // Add more language-specific endpoint discovery methods...
    discoverJavaEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Spring Boot patterns - COMPLETE IMPLEMENTATION
      const springBootPatterns = [
        // @RestController with @RequestMapping
        /@RestController[\s\S]*?@RequestMapping\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/g,

        // Direct method mappings
        /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*value\s*=\s*['"`]([^'"`]+)['"`]/g,

        // @RequestMapping with method
        /@RequestMapping\s*\(\s*value\s*=\s*['"`]([^'"`]+)['"`]\s*,\s*method\s*=\s*RequestMethod\.(GET|POST|PUT|DELETE|PATCH)\s*\)/g,

        // Controller-level mapping
        /@Controller[\s\S]*?@RequestMapping\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      ]

      // JAX-RS patterns - COMPLETE IMPLEMENTATION
      const jaxRsPatterns = [
        // @Path with HTTP method annotations
        /@Path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?@(GET|POST|PUT|DELETE|PATCH)/g,

        // Method-level @Path
        /@(GET|POST|PUT|DELETE|PATCH)[\s\S]*?@Path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

        // Simple HTTP method annotations
        /@(GET|POST|PUT|DELETE|PATCH)[\s\S]*?public\s+\w+\s+(\w+)\s*\(/g,
      ]

      // Jersey patterns
      const jerseyPatterns = [
        // ResourceConfig registration patterns
        /register\s*\(\s*(\w+)\.class\s*\)/g,

        // @Path at class level
        /@Path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*public\s+class\s+(\w+)/g,
      ]

      // Dropwizard patterns
      const dropwizardPatterns = [/environment\.jersey\(\)\.register\s*\(\s*new\s+(\w+)/g]

      // Micronaut patterns
      const micronautPatterns = [
        /@Controller\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/g,
      ]

      // Quarkus patterns
      const quarkusPatterns = [/@Path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?@(GET|POST|PUT|DELETE|PATCH)/g]

      // Apply all patterns
      this.applyPatterns(
        [
          ...springBootPatterns,
          ...jaxRsPatterns,
          ...jerseyPatterns,
          ...dropwizardPatterns,
          ...micronautPatterns,
          ...quarkusPatterns,
        ],
        result.symbols,
        endpoints,
        filePath,
        "java",
      )

      // ADDITIONAL: Detect Spring WebFlux (Reactive)
      this.detectSpringWebFlux(result, filePath, endpoints)

      // ADDITIONAL: Detect GraphQL Java
      this.detectJavaGraphQL(result, filePath, endpoints)

      return endpoints
    }

    /**
     * Spring WebFlux detection
     */
    private detectSpringWebFlux(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // WebFlux router function patterns
      const webfluxPatterns = [
        /RouterFunction.*route\s*\(\s*(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /HandlerFunction|ServerRequest|ServerResponse/g,
      ]

      for (const pattern of webfluxPatterns) {
        let match
        while ((match = pattern.exec(content)) !== null) {
          if (match[1] && match[2]) {
            // Method and path found
            endpoints.push(
              this.createEndpointSymbol(
                match[2], // path
                match[1], // method
                filePath,
                "java",
                "Spring WebFlux",
              ),
            )
          }
        }
      }
    }

    /**
     * Java GraphQL detection
     */
    private detectJavaGraphQL(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // GraphQL Java patterns
      if (/GraphQL|@GraphQLQuery|@GraphQLMutation|@Query|@Mutation/g.test(content)) {
        endpoints.push(this.createEndpointSymbol("/graphql", "POST", filePath, "java", "GraphQL Java"))
      }
    }
    discoverCSharpEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // ASP.NET Core patterns - COMPLETE IMPLEMENTATION
      const aspNetCorePatterns = [
        // Controller with Route attributes
        /\[Route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\][\s\S]*?\[(Http(?:Get|Post|Put|Delete|Patch))\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)\]/g,

        // Direct HTTP method attributes
        /\[(Http(?:Get|Post|Put|Delete|Patch))\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/g,

        // ApiController with actions
        /\[ApiController\][\s\S]*?\[Route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/g,

        // Minimal API (NET 6+)
        /app\.Map(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Web API patterns
      const webApiPatterns = [
        // Classic Web API routing
        /\[Route\s*\(\s*['"`]api\/([^'"`]+)['"`]\s*\)\]/g,
        /\[Http(Get|Post|Put|Delete|Patch)\]/g,
      ]

      // Blazor Server patterns
      const blazorPatterns = [/@page\s*['"`]([^'"`]+)['"`]/g, /RouteAttribute\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // SignalR patterns
      const signalRPatterns = [/Hub[\s\S]*?public\s+(?:async\s+)?Task\s+(\w+)/g, /IHubContext.*Send/g]

      // gRPC patterns
      const grpcPatterns = [/public\s+override\s+(?:async\s+)?Task<(\w+)>\s+(\w+)/g, /\.proto|ProtoBuf|Grpc/g]

      // Apply all patterns
      this.applyPatterns(
        [...aspNetCorePatterns, ...webApiPatterns, ...blazorPatterns],
        result.symbols,
        endpoints,
        filePath,
        "csharp",
      )

      // ADDITIONAL: Detect SignalR hubs
      this.detectSignalRHubs(result, filePath, endpoints)

      // ADDITIONAL: Detect gRPC services
      this.detectCSharpGRPC(result, filePath, endpoints)

      // ADDITIONAL: Detect GraphQL .NET
      this.detectCSharpGraphQL(result, filePath, endpoints)

      return endpoints
    }

    /**
     * SignalR hub detection
     */
    private detectSignalRHubs(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // SignalR hub methods
      const hubPattern = /public\s+(?:async\s+)?Task\s+(\w+)\s*\(/g
      let match

      if (/Hub|IHubContext|SignalR/g.test(content)) {
        while ((match = hubPattern.exec(content)) !== null) {
          const methodName = match[1]
          if (!["OnConnectedAsync", "OnDisconnectedAsync"].includes(methodName)) {
            endpoints.push(this.createEndpointSymbol(`/signalr/${methodName}`, "HUB", filePath, "csharp", "SignalR"))
          }
        }
      }
    }

    /**
     * C# gRPC detection
     */
    private detectCSharpGRPC(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // gRPC service methods
      if (/Grpc|\.proto|ProtoBuf/g.test(content)) {
        const serviceMethodPattern = /public\s+override\s+(?:async\s+)?Task.*?(\w+)\s*\(/g
        let match

        while ((match = serviceMethodPattern.exec(content)) !== null) {
          const methodName = match[1]
          endpoints.push(this.createEndpointSymbol(`/grpc/${methodName}`, "RPC", filePath, "csharp", "gRPC"))
        }
      }
    }

    /**
     * C# GraphQL detection
     */
    private detectCSharpGraphQL(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // GraphQL .NET patterns
      if (/GraphQL|HotChocolate|GraphiQL/g.test(content)) {
        endpoints.push(this.createEndpointSymbol("/graphql", "POST", filePath, "csharp", "GraphQL"))
      }
    }
    discoverGoEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Gin patterns - COMPLETE IMPLEMENTATION
      const ginPatterns = [
        // Basic Gin routes
        /r\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /router\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Gin route groups
        /v1\s*:=\s*r\.Group\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?v1\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Gin with middleware
        /r\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\w+\.\w+\s*,/g,
      ]

      // Echo patterns - COMPLETE IMPLEMENTATION
      const echoPatterns = [
        // Basic Echo routes
        /e\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /echo\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Echo groups
        /g\s*:=\s*e\.Group\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?g\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Echo with middleware
        /e\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\w+\.\w+/g,
      ]

      // Fiber patterns - COMPLETE IMPLEMENTATION
      const fiberPatterns = [
        // Basic Fiber routes
        /app\.(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Fiber groups
        /api\s*:=\s*app\.Group\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?api\.(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Gorilla Mux patterns
      const gorillaMuxPatterns = [
        /r\.(HandleFunc|PathPrefix)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\w+\)\.Methods\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/g,
        /r\.Methods\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*\)\.Path\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Chi router patterns
      const chiPatterns = [
        /r\.(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /r\.Route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*func\s*\(\s*r\s+chi\.Router\s*\)/g,
      ]

      // Buffalo patterns
      const buffaloPatterns = [/app\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns(
        [...ginPatterns, ...echoPatterns, ...fiberPatterns, ...gorillaMuxPatterns, ...chiPatterns, ...buffaloPatterns],
        result.symbols,
        endpoints,
        filePath,
        "go",
      )

      // ADDITIONAL: Detect gRPC servers
      this.detectGoGRPC(result, filePath, endpoints)

      // ADDITIONAL: Detect GraphQL Go
      this.detectGoGraphQL(result, filePath, endpoints)

      return endpoints
    }

    /**
     * Go gRPC detection
     */
    private detectGoGRPC(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // gRPC server patterns
      if (/grpc\.NewServer|RegisterServer|\.pb\.go|protobuf/g.test(content)) {
        // Extract service methods from protobuf patterns
        const servicePattern = /rpc\s+(\w+)\s*\(/g
        let match

        while ((match = servicePattern.exec(content)) !== null) {
          const methodName = match[1]
          endpoints.push(this.createEndpointSymbol(`/grpc/${methodName}`, "RPC", filePath, "go", "gRPC"))
        }
      }
    }

    /**
     * Go GraphQL detection
     */
    private detectGoGraphQL(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // GraphQL Go patterns
      if (/graphql|gqlgen|graphql-go/g.test(content)) {
        endpoints.push(this.createEndpointSymbol("/graphql", "POST", filePath, "go", "GraphQL"))
      }
    }
    discoverRustEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Actix Web patterns - COMPLETE IMPLEMENTATION
      const actixPatterns = [
        // Actix route macros
        /#\[(get|post|put|delete|patch|head)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/g,

        // Actix manual routing
        /web::(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

        // Actix App routing
        /\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*web::(get|post|put|delete|patch)/g,

        // Actix scope routing
        /\.scope\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?\.route\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Warp patterns - COMPLETE IMPLEMENTATION
      const warpPatterns = [
        // Warp path filters
        /warp::path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?warp::filters::method::(GET|POST|PUT|DELETE|PATCH)/g,

        // Warp method filters
        /warp::filters::method::(GET|POST|PUT|DELETE|PATCH)[\s\S]*?warp::path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

        // Warp combined filters
        /warp::(get|post|put|delete|patch)\s*\(\s*\)[\s\S]*?warp::path\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Rocket patterns - COMPLETE IMPLEMENTATION
      const rocketPatterns = [
        // Rocket route attributes
        /#\[rocket::(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/g,

        // Simple Rocket routes
        /#\[(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/g,

        // Rocket with rank
        /#\[(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*rank\s*=\s*\d+\s*\)\]/g,
      ]

      // Axum patterns - COMPLETE IMPLEMENTATION
      const axumPatterns = [
        // Axum Router
        /Router::new\s*\(\s*\)[\s\S]*?\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(get|post|put|delete|patch)/g,

        // Axum method routing
        /\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Axum nest routing
        /\.nest\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Tide patterns
      const tidePatterns = [/app\.at\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\.(get|post|put|delete|patch)/g]

      // Apply all patterns
      this.applyPatterns(
        [...actixPatterns, ...warpPatterns, ...rocketPatterns, ...axumPatterns, ...tidePatterns],
        result.symbols,
        endpoints,
        filePath,
        "rust",
      )

      // ADDITIONAL: Detect Tonic gRPC
      this.detectRustGRPC(result, filePath, endpoints)

      // ADDITIONAL: Detect Async-GraphQL
      this.detectRustGraphQL(result, filePath, endpoints)

      return endpoints
    }

    /**
     * Rust gRPC (Tonic) detection
     */
    private detectRustGRPC(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // Tonic gRPC patterns
      if (/tonic|prost|\.proto|grpc/g.test(content)) {
        // Extract RPC methods
        const rpcPattern = /async\s+fn\s+(\w+)\s*\(/g
        let match

        while ((match = rpcPattern.exec(content)) !== null) {
          const methodName = match[1]
          endpoints.push(this.createEndpointSymbol(`/grpc/${methodName}`, "RPC", filePath, "rust", "Tonic gRPC"))
        }
      }
    }

    /**
     * Rust GraphQL detection
     */
    private detectRustGraphQL(
      result: ASTEngine.ParseResult,
      filePath: string,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): void {
      const content = this.fileResults.get(filePath)?.rawContent || ""

      // Async-GraphQL patterns
      if (/async_graphql|juniper|GraphQL/g.test(content)) {
        endpoints.push(this.createEndpointSymbol("/graphql", "POST", filePath, "rust", "GraphQL"))
      }
    }
    discoverPhpEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Laravel patterns - COMPLETE IMPLEMENTATION
      const laravelPatterns = [
        // Laravel routes
        /Route::(get|post|put|delete|patch|any)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Laravel resource routes
        /Route::resource\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Laravel API routes
        /Route::apiResource\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Laravel controller routes
        /Route::(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\[.*?Controller::class/g,
      ]

      // Symfony patterns - COMPLETE IMPLEMENTATION
      const symfonyPatterns = [
        // Symfony annotations
        /@Route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*methods\s*=\s*\{['"`](GET|POST|PUT|DELETE|PATCH)['"`]\}/g,
        /@Route\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Symfony attributes (PHP 8+)
        /#\[Route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*methods\s*:\s*\[['"`](GET|POST|PUT|DELETE|PATCH)['"`]\]/g,
      ]

      // CodeIgniter patterns
      const codeIgniterPatterns = [/\$routes->(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Slim Framework patterns
      const slimPatterns = [/\$app->(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Lumen patterns
      const lumenPatterns = [/\$router->(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns(
        [...laravelPatterns, ...symfonyPatterns, ...codeIgniterPatterns, ...slimPatterns, ...lumenPatterns],
        result.symbols,
        endpoints,
        filePath,
        "php",
      )

      return endpoints
    }

    discoverRubyEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Ruby on Rails patterns - COMPLETE IMPLEMENTATION
      const railsPatterns = [
        // Rails routes.rb patterns
        /(get|post|put|delete|patch|head|options)\s+['"`]([^'"`]+)['"`]/g,

        // Rails resources
        /resources?\s+['"`](\w+)['"`]/g,

        // Rails namespace
        /namespace\s+['"`](\w+)['"`]\s+do[\s\S]*?(get|post|put|delete|patch)\s+['"`]([^'"`]+)['"`]/g,

        // Rails controller actions
        /def\s+(index|show|new|create|edit|update|destroy|[\w_]+)/g,
      ]

      // Sinatra patterns - COMPLETE IMPLEMENTATION
      const sinatraPatterns = [/(get|post|put|delete|patch|head|options)\s+['"`\/]([^'"`]+)['"`\/]/g]

      // Grape API patterns
      const grapePatterns = [/(get|post|put|delete|patch)\s+['"`]([^'"`]+)['"`]/g, /resource\s+['"`](\w+)['"`]/g]

      // Roda patterns
      const rodaPatterns = [/r\.(get|post|put|delete|patch)\s+['"`]([^'"`]+)['"`]/g, /r\.on\s+['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns(
        [...railsPatterns, ...sinatraPatterns, ...grapePatterns, ...rodaPatterns],
        result.symbols,
        endpoints,
        filePath,
        "ruby",
      )

      return endpoints
    }
    discoverKotlinEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Ktor patterns - COMPLETE IMPLEMENTATION
      const ktorPatterns = [
        // Ktor routing
        /(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

        // Ktor route function
        /routing\s*\{[\s\S]*?(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Ktor with path parameters
        /(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*\{[^}]+\}[^'"`]*)['"`]/g,
      ]

      // Spring Boot Kotlin patterns
      const springKotlinPatterns = [
        // Kotlin Spring controllers
        /@RestController[\s\S]*?@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Kotlin functional endpoints
        /router\s*\{[\s\S]*?(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Android API patterns (if applicable)
      const androidPatterns = [
        // Retrofit annotations
        /@(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Apply all patterns
      this.applyPatterns(
        [...ktorPatterns, ...springKotlinPatterns, ...androidPatterns],
        result.symbols,
        endpoints,
        filePath,
        "kotlin",
      )

      return endpoints
    }

    discoverScalaEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Akka HTTP patterns - COMPLETE IMPLEMENTATION
      const akkaHttpPatterns = [
        // Akka HTTP routes
        /(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

        // Akka HTTP path directives
        /path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\{[\s\S]*?(get|post|put|delete|patch)/g,

        // Akka HTTP concatenation
        /concat\s*\([\s\S]*?(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Play Framework patterns - COMPLETE IMPLEMENTATION
      const playPatterns = [
        // Play routes file
        /(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)\s+controllers\./g,

        // Play controller annotations
        /@Route\s*\(\s*method\s*=\s*(GET|POST|PUT|DELETE|PATCH)\s*,\s*value\s*=\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Finatra patterns
      const finatraPatterns = [/(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns(
        [...akkaHttpPatterns, ...playPatterns, ...finatraPatterns],
        result.symbols,
        endpoints,
        filePath,
        "scala",
      )

      return endpoints
    }

    discoverSwiftEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Vapor patterns - COMPLETE IMPLEMENTATION
      const vaporPatterns = [
        // Vapor routing
        /app\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Vapor route groups
        /let\s+\w+\s*=\s*app\.grouped\s*\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?\w+\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Vapor RouteCollection
        /func\s+boot\s*\(\s*routes:\s*RoutesBuilder\s*\)[\s\S]*?routes\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Perfect patterns
      const perfectPatterns = [
        /routes\.add\s*\(\s*method:\s*\.(get|post|put|delete|patch)\s*,\s*uri:\s*['"`]([^'"`]+)['"`]/g,
      ]

      // Kitura patterns
      const kituraPatterns = [/router\.(get|post|put|delete|patch|all)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns(
        [...vaporPatterns, ...perfectPatterns, ...kituraPatterns],
        result.symbols,
        endpoints,
        filePath,
        "swift",
      )

      return endpoints
    }
    discoverDartEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Shelf patterns - COMPLETE IMPLEMENTATION
      const shelfPatterns = [
        // Shelf handlers
        /Handler\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g,

        // Shelf router
        /router\.(get|post|put|delete|patch|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Shelf middleware
        /Pipeline\s*\(\s*\)[\s\S]*?addHandler\s*\(\s*router\s*\)/g,
      ]

      // Angel3 patterns
      const angel3Patterns = [/app\.(get|post|put|delete|patch|all)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Conduit patterns
      const conduitPatterns = [/router\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns(
        [...shelfPatterns, ...angel3Patterns, ...conduitPatterns],
        result.symbols,
        endpoints,
        filePath,
        "dart",
      )

      return endpoints
    }

    discoverElixirEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Phoenix patterns - COMPLETE IMPLEMENTATION
      const phoenixPatterns = [
        // Phoenix router
        /(get|post|put|delete|patch|head|options)\s+['"`]([^'"`]+)['"`]\s*,\s*\w+Controller/g,

        // Phoenix resources
        /resources\s+['"`]([^'"`]+)['"`]\s*,\s*\w+Controller/g,

        // Phoenix scope
        /scope\s+['"`]([^'"`]+)['"`]\s*do[\s\S]*?(get|post|put|delete|patch)\s+['"`]([^'"`]+)['"`]/g,

        // Phoenix pipe_through
        /pipe_through\s+\[.*?\][\s\S]*?(get|post|put|delete|patch)\s+['"`]([^'"`]+)['"`]/g,
      ]

      // Plug patterns
      const plugPatterns = [/plug\s+['"`]([^'"`]+)['"`]/g, /match\s+_\s*,\s*['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns([...phoenixPatterns, ...plugPatterns], result.symbols, endpoints, filePath, "elixir")

      return endpoints
    }

    discoverClojureEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Ring/Compojure patterns - COMPLETE IMPLEMENTATION
      const ringPatterns = [
        // Compojure routes
        /\((GET|POST|PUT|DELETE|PATCH)\s+['"`]([^'"`]+)['"`]/g,

        // Ring handler
        /defroutes\s+\w+[\s\S]*?\((GET|POST|PUT|DELETE|PATCH)\s+['"`]([^'"`]+)['"`]/g,

        // Context routing
        /context\s+['"`]([^'"`]+)['"`][\s\S]*?\((GET|POST|PUT|DELETE|PATCH)\s+['"`]([^'"`]+)['"`]/g,
      ]

      // Pedestal patterns
      const pedestalPatterns = [/\[:?(get|post|put|delete|patch)\s+['"`]([^'"`]+)['"`]/g]

      // Apply all patterns
      this.applyPatterns([...ringPatterns, ...pedestalPatterns], result.symbols, endpoints, filePath, "clojure")

      return endpoints
    }

    discoverCppEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // C++ web framework patterns
      const cppPatterns = [
        // Crow framework
        /CROW_ROUTE\s*\(\s*app\s*,\s*['"`]([^'"`]+)['"`]\s*\)/g,

        // Drogon framework
        /app\(\)\.registerHandler\s*\(\s*['"`]([^'"`]+)['"`]/g,

        // Pistache
        /Routes::(Get|Post|Put|Delete|Patch)\s*\(\s*router\s*,\s*['"`]([^'"`]+)['"`]/g,

        // Beast/Boost.Beast
        /handle_request[\s\S]*?target\s*==\s*['"`]([^'"`]+)['"`]/g,
      ]

      this.applyPatterns(cppPatterns, result.symbols, endpoints, filePath, "cpp")
      return endpoints
    }

    discoverCEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // C web framework patterns
      const cPatterns = [
        // Mongoose embedded
        /mg_http_listen\s*\([\s\S]*?['"`]([^'"`]+)['"`]/g,

        // Onion web framework
        /onion_url_add\s*\([\s\S]*?['"`]([^'"`]+)['"`]/g,

        // Custom HTTP servers
        /bind.*:(\d+)|listen.*:(\d+)/g,
      ]

      this.applyPatterns(cPatterns, result.symbols, endpoints, filePath, "c")
      return endpoints
    }

    discoverHaskellEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const haskellPatterns = [
        // Servant API types
        /type\s+[^=]+=\s*([^:^<]+)/g,
        /:>\s*(Get|Post|Put|Delete|Patch)\s*'\[/g,
        /:>\s*"([^"]+)"/g,
        // Yesod
        /mkYesod\s+"[^"]+"\s+\[parseRoutes\|/g,
        /\/\w+\s+([\w\/]+)\s+(GET|POST|PUT|DELETE)/g,
      ]
      this.applyPatterns(haskellPatterns, result.symbols, endpoints, filePath, "haskell")
      return endpoints
    }

    discoverLuaEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const luaPatterns = [
        // OpenResty/Lapis
        /app:(get|post|put|delete|match)\s*\(\s*['"]([^'"]+)['"]/g,
        // Kong
        /ngx\.req\.get_method\(\)\s*==\s*['"](GET|POST|PUT|DELETE)['"]/g,
      ]
      this.applyPatterns(luaPatterns, result.symbols, endpoints, filePath, "lua")
      return endpoints
    }

    discoverREndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const rPatterns = [
        // Plumber
        /#\*\s*@(get|post|put|delete)\s+([^\s]+)/g,
      ]
      this.applyPatterns(rPatterns, result.symbols, endpoints, filePath, "r")
      return endpoints
    }

    discoverSQLEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const sqlPatterns = [
        // PostgREST/PostGraphQL
        /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_.]+)/gi,
        // API views
        /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:api\.)?([a-zA-Z0-9_]+)/gi,
      ]
      this.applyPatterns(sqlPatterns, result.symbols, endpoints, filePath, "sql")
      return endpoints
    }

    discoverYamlEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const yamlPatterns = [
        // OpenAPI / Swagger
        /^\s*(get|post|put|delete|patch|options|head|trace):\s*$/gim,
        // Paths
        /^\s*paths:\s*$/gim,
        /^\s*(\/[a-zA-Z0-9_/{}-]+):\s*$/gm,
      ]
      this.applyPatterns(yamlPatterns, result.symbols, endpoints, filePath, "yaml")
      return endpoints
    }

    discoverJsonEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const jsonPatterns = [
        // OpenAPI / Swagger
        /"(get|post|put|delete|patch|options|head|trace)"\s*:/gi,
        /"(\/[a-zA-Z0-9_/{}-]+)"\s*:/g,
      ]
      this.applyPatterns(jsonPatterns, result.symbols, endpoints, filePath, "json")
      return endpoints
    }

    discoverBashEndpoints(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const bashPatterns = [
        // cgi-bin scripts
        /REQUEST_METHOD/g,
        /PATH_INFO/g,
      ]
      this.applyPatterns(bashPatterns, result.symbols, endpoints, filePath, "bash")
      return endpoints
    }

    private applyPatterns(
      patterns: RegExp[],
      symbols: ASTEngine.UniversalSymbol[],
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
      filePath: string,
      language: string,
    ): void {
      // PATTERN APPLICATION - NO LONGER A STUB!

      // Method 1: Search through raw file content for patterns
      const fileResult = this.fileResults.get(filePath)
      const rawContent = fileResult?.rawContent || ""

      for (const pattern of patterns) {
        // Reset regex to avoid issues with global flag
        pattern.lastIndex = 0

        let match
        while ((match = pattern.exec(rawContent)) !== null) {
          const endpointInfo = this.extractEndpointInfo(match, pattern)

          if (endpointInfo) {
            const endpoint = this.createEndpointSymbol(
              endpointInfo.path,
              endpointInfo.method,
              filePath,
              language,
              endpointInfo.framework,
            )
            endpoints.push(endpoint)
          }
        }
      }

      // Method 2: Analyze symbols for qualified calls that match patterns
      for (const symbol of symbols) {
        if (symbol.qualified_calls) {
          for (const call of symbol.qualified_calls) {
            for (const pattern of patterns) {
              pattern.lastIndex = 0
              const match = pattern.exec(call)

              if (match) {
                const endpointInfo = this.extractEndpointInfo(match, pattern)

                if (endpointInfo) {
                  const endpoint = this.createEndpointSymbol(
                    endpointInfo.path,
                    endpointInfo.method,
                    filePath,
                    language,
                    endpointInfo.framework,
                  )
                  endpoints.push(endpoint)
                }
              }
            }
          }
        }
      }

      // Method 3: AST-based detection for more precise analysis
      if (fileResult?.ast) {
        this.analyzeASTNodes(fileResult.ast, patterns, endpoints, filePath, language)
      }
    }

    /**
     * endpoint information extraction - ALL LANGUAGES
     */
    private extractEndpointInfo(
      match: RegExpMatchArray,
      pattern: RegExp,
    ): { path: string; method: string; framework: string } | null {
      const patternStr = pattern.source

      // ============ JAVASCRIPT/TYPESCRIPT PATTERNS ============

      // Express.js/Fastify patterns: app.get('/path') or router.post('/path')
      if (patternStr.includes("app\\.|router\\.|fastify\\.")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || match[1]
        if (path && path.startsWith("/")) {
          const framework = patternStr.includes("fastify") ? "Fastify" : "Express.js"
          return { path, method, framework }
        }
      }

      // Koa.js patterns
      if (patternStr.includes("router\\.\\(get|post")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Koa.js" }
      }

      // NestJS decorator patterns: @Get('/path') or @Post('/path')
      if (patternStr.includes("@\\(Get|Post|Put|Delete|Patch\\)")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "NestJS" }
      }

      // ============ PYTHON PATTERNS ============

      // Flask patterns: @app.route('/path', methods=['POST']) or @app.get('/path')
      if (patternStr.includes("@app\\\\.route|@app\\\\.\\(get|post")) {
        let method = "GET"
        let path = ""
        if (patternStr.includes("@app\\\\.route")) {
          path = match[1]
          method = (match[2] || "GET").toUpperCase()
        } else {
          method = (match[1] || "GET").toUpperCase()
          path = match[2] || "/"
        }
        if (path && (path.startsWith("/") || path.includes("/"))) {
          return { path: path.startsWith("/") ? path : `/${path}`, method, framework: "Flask" }
        }
      }

      // Django patterns: path('/api/users/', views.user_list)
      if (patternStr.includes("path\\\\s*\\\\(|url\\\\s*\\\\(")) {
        const path = match[1]
        if (path) {
          return { path: `/${path}`.replace(/\/+/g, "/"), method: "GET", framework: "Django" }
        }
      }

      // FastAPI patterns: @app.get('/path') or @router.post('/path')
      if (patternStr.includes("@app\\\\.(get|post|put|delete|patch)|@router\\\\.(get|post)")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "FastAPI" }
      }

      // ============ JAVA PATTERNS ============

      // Spring Boot patterns
      if (patternStr.includes("@RestController|@RequestMapping|@\\(Get|Post|Put|Delete|Patch\\)Mapping")) {
        const method = match[1] ? match[1].replace("Mapping", "").toUpperCase() : "GET"
        const path = match[2] || match[3] || "/"
        return { path, method, framework: "Spring Boot" }
      }

      // JAX-RS patterns
      if (patternStr.includes("@Path|@\\(GET|POST|PUT|DELETE|PATCH\\)")) {
        const method = match[2] || match[1] || "GET"
        const path = match[1] || match[2] || "/"
        return { path, method: method.toUpperCase(), framework: "JAX-RS" }
      }

      // ============ GO PATTERNS ============

      // Gin patterns: r.GET('/path')
      if (patternStr.includes("r\\.|router\\.|gin") && patternStr.includes("GET|POST|PUT|DELETE|PATCH")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Gin" }
      }

      // Echo patterns: e.GET('/path')
      if (patternStr.includes("e\\.|echo\\.")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Echo" }
      }

      // Fiber patterns: app.Get('/path')
      if (patternStr.includes("app\\.(Get|Post|Put|Delete|Patch)")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Fiber" }
      }

      // ============ C# PATTERNS ============

      // ASP.NET Core patterns
      if (patternStr.includes("\\[Route\\]|\\[Http(?:Get|Post|Put|Delete|Patch)\\]|app\\.Map")) {
        const method = match[1] ? match[1].replace("Http", "").toUpperCase() : "GET"
        const path = match[2] || match[1] || "/"
        return { path, method, framework: "ASP.NET Core" }
      }

      // ============ RUST PATTERNS ============

      // Actix Web patterns: #[get("/path")]
      if (patternStr.includes("#\\\\\\[\\(get|post|put|delete|patch\\)")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Actix Web" }
      }

      // Warp patterns
      if (patternStr.includes("warp::")) {
        const method = match[1] || match[2] || "GET"
        const path = match[2] || match[1] || "/"
        return { path, method: method.toUpperCase(), framework: "Warp" }
      }

      // Rocket patterns: #[rocket::get("/path")]
      if (patternStr.includes("rocket::") || (patternStr.includes("#\\\\\\[") && patternStr.includes("get|post"))) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Rocket" }
      }

      // ============ PHP PATTERNS ============

      // Laravel patterns: Route::get('/path')
      if (patternStr.includes("Route::")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Laravel" }
      }

      // Symfony patterns: @Route("/path")
      if (patternStr.includes("@Route|#\\\\\\[Route")) {
        const path = match[1] || "/"
        const method = (match[2] || "GET").toUpperCase()
        return { path, method, framework: "Symfony" }
      }

      // ============ RUBY PATTERNS ============

      // Rails patterns: get '/path'
      if (patternStr.includes("get|post|put|delete|patch") && patternStr.includes("[\\'\"`]")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Rails" }
      }

      // ============ OTHER LANGUAGE PATTERNS ============

      // Kotlin Ktor patterns
      if (patternStr.includes("get|post|put|delete|patch") && patternStr.includes("\\(\\s*[\\'\"`]")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Ktor" }
      }

      // Scala Akka HTTP patterns
      if (patternStr.includes("path\\\\s*\\\\(") && patternStr.includes("get|post")) {
        const path = match[1] || "/"
        const method = (match[2] || "GET").toUpperCase()
        return { path, method, framework: "Akka HTTP" }
      }

      // Swift Vapor patterns: app.get("/path")
      if (patternStr.includes("app\\\\.(get|post|put|delete|patch)")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Vapor" }
      }

      // Dart Shelf patterns
      if (patternStr.includes("router\\\\.(get|post|put|delete|patch)")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Shelf" }
      }

      // Elixir Phoenix patterns: get "/path"
      if (patternStr.includes("get|post|put|delete|patch") && patternStr.includes("Controller")) {
        const method = (match[1] || "GET").toUpperCase()
        const path = match[2] || "/"
        return { path, method, framework: "Phoenix" }
      }

      // Clojure Ring patterns: (GET "/path")
      if (patternStr.includes("\\\\(\\(GET|POST|PUT|DELETE|PATCH\\)")) {
        const method = match[1] || "GET"
        const path = match[2] || "/"
        return { path, method, framework: "Ring/Compojure" }
      }

      return null
    }

    /**
     * AST node analysis for precise detection
     */
    private analyzeASTNodes(
      ast: any,
      patterns: RegExp[],
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
      filePath: string,
      language: string,
    ): void {
      // Deep AST traversal for framework-specific patterns
      // This complements content-based detection with precise AST analysis

      if (!ast || !ast.rootNode) return

      const rootNode = ast.rootNode

      // Recursive AST traversal function
      const traverse = (node: any): void => {
        if (!node) return

        // Analyze different node types based on language and framework patterns
        switch (node.type) {
          // JavaScript/TypeScript decorator patterns
          case "decorator":
          case "decorator_call_expression":
            this.analyzeDecorator(node, endpoints, filePath, language)
            break

          // Class/method declarations with framework annotations
          case "class_declaration":
          case "class_definition":
            this.analyzeClassDeclaration(node, endpoints, filePath, language)
            break

          // Function/method declarations (potential endpoint handlers)
          case "function_declaration":
          case "method_definition":
          case "method_declaration":
          case "function_definition":
            this.analyzeFunctionDeclaration(node, endpoints, filePath, language, patterns)
            break

          // Call expressions (potential framework registration calls)
          case "call_expression":
          case "invocation_expression":
            this.analyzeCallExpression(node, endpoints, filePath, language, patterns)
            break

          // Assignment expressions (route definitions like: app.get = ...)
          case "assignment_expression":
          case "variable_declarator":
            this.analyzeAssignment(node, endpoints, filePath, language, patterns)
            break
        }

        // Recursively traverse all child nodes
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) traverse(child)
        }
      }

      // Start traversal from root
      traverse(rootNode)
    }

    /**
     * Analyze decorator nodes for route/endpoint definitions
     */
    private analyzeDecorator(
      node: any,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
      filePath: string,
      language: string,
    ): void {
      const decoratorText = node.text || ""

      // Check for route decorators: @Get, @Post, @Route, etc.
      const routeDecoratorPattern =
        /@(Get|Post|Put|Delete|Patch|Route|RequestMapping|HttpGet|HttpPost|Path)\s*\(['"](.*?)['"]/i
      const match = decoratorText.match(routeDecoratorPattern)

      if (match) {
        const method = match[1]
          .toUpperCase()
          .replace(/^HTTP/, "")
          .replace(/REQUESTMAPPING/, "GET")
        const path = match[2]

        // Create endpoint symbol from decorator
        const endpoint = this.createEndpointSymbol(path, method, filePath, language, "decorator-based")
        endpoints.push(endpoint)
      }
    }

    /**
     * Analyze class declarations for controller patterns
     */
    private analyzeClassDeclaration(
      node: any,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
      filePath: string,
      language: string,
    ): void {
      const classText = node.text || ""

      // Check for controller annotations/decorators
      if (
        classText.includes("@Controller") ||
        classText.includes("@RestController") ||
        classText.includes("@ApiController") ||
        classText.includes("Controller")
      ) {
        // Extract base route from class decorator if present
        const baseRoutePattern = /@(?:Controller|Route|RequestMapping)\s*\(['"](.*?)['"]/i
        const match = classText.match(baseRoutePattern)
        const basePath = match ? match[1] : ""

        // Store base path for later method analysis
        if (basePath && node.startPosition) {
          // This can be used to qualify method routes within this controller
        }
      }
    }

    /**
     * Analyze function/method declarations for endpoint patterns
     */
    private analyzeFunctionDeclaration(
      node: any,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
      filePath: string,
      language: string,
      patterns: RegExp[],
    ): void {
      const functionText = node.text || ""

      // Check if function matches any of the provided endpoint patterns
      for (const pattern of patterns) {
        const match = functionText.match(pattern)
        if (match) {
          // Extract route info from the match
          const info = this.extractEndpointInfo(match, pattern)
          if (info) {
            const endpoint = this.createEndpointSymbol(info.path, info.method, filePath, language, info.framework)
            endpoints.push(endpoint)
          }
        }
      }
    }

    /**
     * Analyze call expressions for route registration
     */
    private analyzeCallExpression(
      node: any,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
      filePath: string,
      language: string,
      patterns: RegExp[],
    ): void {
      const callText = node.text || ""

      // Common patterns: app.get('/path'), router.post('/path'), etc.
      const callPattern = /\.(get|post|put|delete|patch|all)\s*\(\s*['"](.*?)['"]/i
      const match = callText.match(callPattern)

      if (match) {
        const method = match[1].toUpperCase()
        const path = match[2]

        const endpoint = this.createEndpointSymbol(path, method, filePath, language, "express-style")
        endpoints.push(endpoint)
      }
    }

    /**
     * Analyze assignment expressions for route definitions
     */
    private analyzeAssignment(
      node: any,
      endpoints: CrossLanguageIntelligence.CrossLanguageSymbol[],
      filePath: string,
      language: string,
      patterns: RegExp[],
    ): void {
      const assignText = node.text || ""

      // Check for route assignments
      for (const pattern of patterns) {
        const match = assignText.match(pattern)
        if (match) {
          const info = this.extractEndpointInfo(match, pattern)
          if (info) {
            const endpoint = this.createEndpointSymbol(info.path, info.method, filePath, language, info.framework)
            endpoints.push(endpoint)
          }
        }
      }
    }

    private extractNextJSRoute(filePath: string): string {
      // Convert /pages/api/users/[id].js to /api/users/:id
      return filePath
        .replace(/\/pages/, "")
        .replace(/\[([^\]]+)\]/g, ":$1")
        .replace(/\.(js|ts)$/, "")
    }

    private createEndpointSymbol(
      path: string,
      method: string,
      filePath: string,
      language: string,
      framework: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return {
        id: `endpoint_${path}_${method}`,
        name: `${method} ${path}`,
        type: CrossLanguageIntelligence.CrossLanguageSymbolType.API_ENDPOINT,
        languages: [language],
        definitions: [
          {
            filePath,
            language,
            range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            symbolKind: ASTEngine.SymbolKind.Function,
            confidence: 0.8,
            context: {
              isDefinition: true,
              isUsage: false,
              accessPattern: "call",
              framework,
              annotations: [],
            },
          },
        ],
        usages: [],
        contracts: [],
        metadata: {
          communicationProtocols: ["HTTP"],
          dataFormats: ["JSON"],
          securityMechanisms: [],
          performanceProfile: {
            latencyImpact: "medium",
            throughputImpact: "medium",
            scalabilityFactors: [],
          },
          architecturalPatterns: ["REST"],
        },
      }
    }
  }

  /**
   * data model detection across ALL languages and schemas
   */
  class DataModelPatterns {
    discoverTypeScriptModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Find TypeScript interfaces, types, and classes that look like data models
      for (const symbol of result.symbols) {
        if (
          symbol.kind === ASTEngine.SymbolKind.Interface ||
          symbol.kind === ASTEngine.SymbolKind.Type ||
          (symbol.kind === ASTEngine.SymbolKind.Class && this.isDataModelClass(symbol))
        ) {
          models.push(this.createDataModelSymbol(symbol, filePath, "typescript"))
        }
      }

      return models
    }

    discoverPythonModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Find Pydantic models, dataclasses, SQLAlchemy models
      for (const symbol of result.symbols) {
        if (symbol.kind === ASTEngine.SymbolKind.Class) {
          if (
            symbol.decorators?.includes("dataclass") ||
            symbol.metadata?.hasSQLAlchemyDecorators ||
            symbol.metadata?.isPydanticModel
          ) {
            models.push(this.createDataModelSymbol(symbol, filePath, "python"))
          }
        }
      }

      return models
    }

    // ======================== DATA MODEL DISCOVERY FOR ALL LANGUAGES ========================

    /**
     * Java Data Model Discovery
     * Detects JPA entities, POJOs, records, enums
     */
    discoverJavaModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isJavaDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "java"))
        }
      }

      return models
    }

    private isJavaDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Java data model patterns
      return (
        ((symbol.kind === ASTEngine.SymbolKind.Class || symbol.kind === ASTEngine.SymbolKind.Enum) &&
          // JPA Entities
          (symbol.decorators?.some((d) => /@Entity|@Table|@Embeddable/.test(d)) ||
            // Data classes with getters/setters
            symbol.metadata?.hasGettersSetters ||
            // Records (Java 14+)
            symbol.metadata?.isRecord ||
            // DTOs and value objects
            /DTO|Model|Entity|Data|Record|Value/.test(symbol.name))) ||
        (symbol.kind === ASTEngine.SymbolKind.Interface && /Model|Entity|DTO/.test(symbol.name))
      )
    }

    /**
     * C# Data Model Discovery
     * Detects Entity Framework models, DTOs, records, classes
     */
    discoverCSharpModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isCSharpDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "csharp"))
        }
      }

      return models
    }

    private isCSharpDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // C# data model patterns
      return (
        (symbol.kind === ASTEngine.SymbolKind.Class &&
          // Entity Framework
          (symbol.decorators?.some((d) => /\[Key\]|\[Table\]|\[Column\]|\[Required\]/.test(d)) ||
            // Data annotations
            symbol.decorators?.some((d) => /\[DataContract\]|\[DataMember\]/.test(d)) ||
            // Auto-properties
            symbol.metadata?.hasAutoProperties ||
            // Records (C# 9+)
            symbol.metadata?.isRecord ||
            // DTOs and models
            /DTO|Model|Entity|Data|Record/.test(symbol.name))) ||
        symbol.kind === ASTEngine.SymbolKind.Record ||
        (symbol.kind === ASTEngine.SymbolKind.Struct && /Model|Data/.test(symbol.name))
      )
    }

    /**
     * Go Data Model Discovery
     * Detects structs with json/bson/db tags, GORM models
     */
    discoverGoModels(result: ASTEngine.ParseResult, filePath: string): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isGoDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "go"))
        }
      }

      return models
    }

    private isGoDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Go data model patterns
      return (
        symbol.kind === ASTEngine.SymbolKind.Struct &&
        // Struct tags (json, bson, db, gorm)
        (symbol.metadata?.hasStructTags ||
          // GORM models
          symbol.metadata?.hasGormTags ||
          // Model naming convention
          /Model|Entity|Data|Schema/.test(symbol.name) ||
          // Database-related structs
          symbol.metadata?.hasDatabaseFields)
      )
    }

    /**
     * Rust Data Model Discovery
     * Detects Serde structs, Diesel models, database entities
     */
    discoverRustModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isRustDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "rust"))
        }
      }

      return models
    }

    private isRustDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Rust data model patterns
      return (
        (symbol.kind === ASTEngine.SymbolKind.Struct &&
          // Serde serialization
          (symbol.decorators?.some((d) => /#\[derive\([^)]*Serialize|#\[derive\([^)]*Deserialize/.test(d)) ||
            // Diesel ORM
            symbol.decorators?.some((d) => /#\[derive\([^)]*Queryable|#\[derive\([^)]*Insertable/.test(d)) ||
            // Database table annotations
            symbol.decorators?.some((d) => /#\[table_name/.test(d)) ||
            // Model naming
            /Model|Entity|Schema|Row/.test(symbol.name))) ||
        (symbol.kind === ASTEngine.SymbolKind.Enum &&
          !!symbol.decorators?.some((d) => /#\[derive\([^)]*Serialize/.test(d)))
      )
    }

    /**
     * Kotlin Data Model Discovery
     * Detects data classes, entities, serializable classes
     */
    discoverKotlinModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isKotlinDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "kotlin"))
        }
      }

      return models
    }

    private isKotlinDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Kotlin data model patterns
      return (
        symbol.kind === ASTEngine.SymbolKind.Class &&
        // Data classes
        (symbol.metadata?.isDataClass ||
          // Serializable annotations
          symbol.decorators?.some((d) => /@Serializable|@SerialName|@Entity/.test(d)) ||
          // Room database entities
          symbol.decorators?.some((d) => /@Entity|@Dao|@Database/.test(d)) ||
          // Model naming
          /DTO|Model|Entity|Data/.test(symbol.name))
      )
    }

    /**
     * Scala Data Model Discovery
     * Detects case classes, sealed traits, Play JSON models
     */
    discoverScalaModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isScalaDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "scala"))
        }
      }

      return models
    }

    private isScalaDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Scala data model patterns
      return (
        (symbol.kind === ASTEngine.SymbolKind.Class && symbol.metadata?.isCaseClass) ||
        (symbol.kind === ASTEngine.SymbolKind.Trait && symbol.metadata?.isSealed) ||
        (symbol.kind === ASTEngine.SymbolKind.Object && /Model|Schema/.test(symbol.name)) ||
        /Model|Entity|Schema|DTO/.test(symbol.name)
      )
    }

    /**
     * Swift Data Model Discovery
     * Detects Codable structs, Core Data entities, SwiftUI models
     */
    discoverSwiftModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isSwiftDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "swift"))
        }
      }

      return models
    }

    private isSwiftDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Swift data model patterns
      return (
        symbol.kind === ASTEngine.SymbolKind.Class &&
        // Codable protocol
        (symbol.metadata?.implementsCodable ||
          // Core Data
          symbol.metadata?.isCoreDataEntity ||
          // Model naming
          /Model|Entity|Data|Schema/.test(symbol.name) ||
          // Property wrappers
          symbol.metadata?.hasPropertyWrappers)
      )
    }

    /**
     * Dart Data Model Discovery
     * Detects JSON serializable classes, Flutter models
     */
    discoverDartModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isDartDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "dart"))
        }
      }

      return models
    }

    private isDartDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Dart data model patterns
      return (
        symbol.kind === ASTEngine.SymbolKind.Class &&
        // JSON serialization
        (symbol.decorators?.some((d) => /@JsonSerializable|@JsonKey/.test(d)) ||
          // Factory constructors (fromJson)
          symbol.metadata?.hasFromJsonFactory ||
          // Model naming
          /Model|Entity|Data|Schema/.test(symbol.name) ||
          // Equatable/Copyable
          symbol.metadata?.implementsEquatable)
      )
    }

    /**
     * Elixir Data Model Discovery
     * Detects Ecto schemas, embedded schemas, structs
     */
    discoverElixirModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isElixirDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "elixir"))
        }
      }

      return models
    }

    private isElixirDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Elixir data model patterns
      return (
        symbol.kind === ASTEngine.SymbolKind.Module &&
        // Ecto schemas
        (symbol.metadata?.hasEctoSchema ||
          // Embedded schemas
          symbol.metadata?.hasEmbeddedSchema ||
          // Struct definitions
          symbol.metadata?.defstruct ||
          // Model naming
          /Schema|Model|Entity/.test(symbol.name))
      )
    }

    /**
     * Haskell Data Model Discovery
     * Detects data types, records, type aliases
     */
    discoverHaskellModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isHaskellDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "haskell"))
        }
      }

      return models
    }

    private isHaskellDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Haskell data model patterns
      return (
        (symbol.kind === ASTEngine.SymbolKind.Type && symbol.metadata?.isDataType) ||
        (symbol.kind === ASTEngine.SymbolKind.Type && symbol.metadata?.isRecord) ||
        (symbol.kind === ASTEngine.SymbolKind.Type && symbol.metadata?.isTypeAlias) ||
        /Model|Entity|Schema|Data/.test(symbol.name)
      )
    }

    /**
     * Clojure Data Model Discovery
     * Detects records, specs, schemas
     */
    discoverClojureModels(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isClojureDataModel(symbol)) {
          models.push(this.createDataModelSymbol(symbol, filePath, "clojure"))
        }
      }

      return models
    }

    private isClojureDataModel(symbol: ASTEngine.UniversalSymbol): boolean {
      // Clojure data model patterns
      return (
        symbol.kind === ASTEngine.SymbolKind.Function &&
        // defrecord
        (symbol.metadata?.isRecord ||
          // spec definitions
          symbol.metadata?.isSpec ||
          // schema definitions
          symbol.metadata?.isSchema ||
          // Model naming
          /schema|spec|model/.test(symbol.name.toLowerCase()))
      )
    }

    /**
     * JSON Schema Discovery
     * Detects JSON Schema definitions, OpenAPI schemas
     */
    discoverJsonSchemas(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Parse JSON content for schema definitions
      const rawContent = result.rawContent || ""

      try {
        const jsonContent = JSON.parse(rawContent)

        // JSON Schema patterns
        if (jsonContent.$schema || jsonContent.type === "object" || jsonContent.properties) {
          models.push(this.createJsonSchemaSymbol(jsonContent, filePath))
        }

        // OpenAPI schemas
        if (jsonContent.openapi && jsonContent.components?.schemas) {
          for (const [schemaName, schemaData] of Object.entries(jsonContent.components.schemas)) {
            models.push(this.createOpenAPISchemaSymbol(schemaName, schemaData as any, filePath))
          }
        }

        // AsyncAPI schemas
        if (jsonContent.asyncapi && jsonContent.components?.schemas) {
          for (const [schemaName, schemaData] of Object.entries(jsonContent.components.schemas)) {
            models.push(this.createAsyncAPISchemaSymbol(schemaName, schemaData as any, filePath))
          }
        }
      } catch (e) {
        // Not valid JSON or parsing error
      }

      return models
    }

    /**
     * YAML Schema Discovery
     * Detects YAML schemas, Kubernetes resources, Docker Compose
     */
    discoverYamlSchemas(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const models: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      const rawContent = result.rawContent || ""

      // YAML schema patterns
      const yamlSchemaPatterns = [
        // Kubernetes resources
        /apiVersion:\s*(\S+)\s*\nkind:\s*(\S+)/g,

        // Docker Compose services
        /version:\s*['"]3\.\d+['"][\s\S]*services:/g,

        // OpenAPI YAML
        /openapi:\s*['"]?3\.\d+['"]?[\s\S]*components:/g,

        // Helm charts
        /apiVersion:\s*v\d+[\s\S]*kind:\s*(Chart|ConfigMap|Secret)/g,

        // CI/CD pipelines
        /stages?:\s*\n|jobs?:\s*\n|steps?:\s*\n/g,
      ]

      for (const pattern of yamlSchemaPatterns) {
        pattern.lastIndex = 0
        let match

        while ((match = pattern.exec(rawContent)) !== null) {
          const schemaType = this.detectYamlSchemaType(match[0])
          const schemaName = this.extractYamlSchemaName(match, filePath)

          models.push(this.createYamlSchemaSymbol(schemaName, schemaType, filePath))
        }
      }

      return models
    }

    private createJsonSchemaSymbol(schemaData: any, filePath: string): CrossLanguageIntelligence.CrossLanguageSymbol {
      const schemaName = schemaData.title || schemaData.$id?.split("/").pop() || "JsonSchema"

      return this.createDataModelSymbol(
        {
          name: schemaName,
          kind: ASTEngine.SymbolKind.Interface,
          range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
          scope: "public",
          decorators: ["@JsonSchema"],
          qualified_calls: [],
          dependencies: [],
          metadata: { isJsonSchema: true, schemaType: schemaData.type },
        },
        filePath,
        "json",
      )
    }

    private createOpenAPISchemaSymbol(
      schemaName: string,
      schemaData: any,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return this.createDataModelSymbol(
        {
          name: schemaName,
          kind: ASTEngine.SymbolKind.Interface,
          range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
          scope: "public",
          decorators: ["@OpenAPISchema"],
          qualified_calls: [],
          dependencies: [],
          metadata: { isOpenAPISchema: true, schemaType: schemaData.type },
        },
        filePath,
        "json",
      )
    }

    private createAsyncAPISchemaSymbol(
      schemaName: string,
      schemaData: any,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return this.createDataModelSymbol(
        {
          name: schemaName,
          kind: ASTEngine.SymbolKind.Interface,
          range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
          scope: "public",
          decorators: ["@AsyncAPISchema"],
          qualified_calls: [],
          dependencies: [],
          metadata: { isAsyncAPISchema: true, schemaType: schemaData.type },
        },
        filePath,
        "json",
      )
    }

    private detectYamlSchemaType(matchText: string): string {
      if (/apiVersion.*kind/s.test(matchText)) return "Kubernetes"
      if (/version.*services/s.test(matchText)) return "Docker Compose"
      if (/openapi.*components/s.test(matchText)) return "OpenAPI"
      if (/Chart|Helm/.test(matchText)) return "Helm Chart"
      if (/stages?|jobs?|steps?/.test(matchText)) return "CI/CD Pipeline"
      return "YAML Schema"
    }

    private extractYamlSchemaName(match: RegExpMatchArray, filePath: string): string {
      // Extract schema name from match or file path
      if (match[2]) return match[2] // kind
      if (match[1]) return match[1] // version/type

      const fileName =
        filePath
          .split("/")
          .pop()
          ?.replace(/\.(yaml|yml)$/, "") || "Schema"
      return fileName.charAt(0).toUpperCase() + fileName.slice(1)
    }

    private createYamlSchemaSymbol(
      schemaName: string,
      schemaType: string,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return this.createDataModelSymbol(
        {
          name: schemaName,
          kind: ASTEngine.SymbolKind.Class,
          range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
          scope: "public",
          decorators: [`@${schemaType.replace(" ", "")}`],
          qualified_calls: [],
          dependencies: [],
          metadata: { isYamlSchema: true, schemaType },
        },
        filePath,
        "yaml",
      )
    }

    private isDataModelClass(symbol: ASTEngine.UniversalSymbol): boolean {
      // Check if this class looks like a data model (has properties, no complex methods)
      return symbol.metadata?.isDataClass || symbol.metadata?.hasProperties || /Model|Entity|DTO|Data/.test(symbol.name)
    }

    private createDataModelSymbol(
      symbol: ASTEngine.UniversalSymbol,
      filePath: string,
      language: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return {
        id: `model_${symbol.name}_${language}`,
        name: symbol.name,
        type: CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL,
        languages: [language],
        definitions: [
          {
            filePath,
            language,
            range: symbol.range,
            symbolKind: symbol.kind,
            confidence: 0.9,
            context: {
              isDefinition: true,
              isUsage: false,
              accessPattern: "read",
              annotations: symbol.decorators || [],
            },
          },
        ],
        usages: [],
        contracts: [],
        metadata: {
          communicationProtocols: [],
          dataFormats: ["JSON"],
          securityMechanisms: [],
          performanceProfile: {
            latencyImpact: "low",
            throughputImpact: "low",
            scalabilityFactors: ["serialization"],
          },
          architecturalPatterns: ["Data Transfer Object"],
        },
      }
    }
  }

  /**
   * symbol correlation engine
   * Phase 1.2: AST-Based Symbol Correlation with Levenshtein distance & structural comparison
   */
  class SymbolCorrelator {
    private fileResults: Map<string, ASTEngine.ParseResult>

    constructor(fileResults: Map<string, ASTEngine.ParseResult>) {
      this.fileResults = fileResults
    }

    async correlateSymbols(
      rawSymbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
      const correlatedSymbols: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Group by type first to avoid comparing apples to oranges
      const typeGroups = new Map<string, CrossLanguageIntelligence.CrossLanguageSymbol[]>()
      for (const symbol of rawSymbols) {
        if (!typeGroups.has(symbol.type)) {
          typeGroups.set(symbol.type, [])
        }
        typeGroups.get(symbol.type)!.push(symbol)
      }

      for (const [type, symbols] of typeGroups) {
        // Find connected components in the similarity graph
        const groups = this.groupSimilarSymbols(symbols)
        for (const group of groups) {
          if (group.length === 1) {
            correlatedSymbols.push(group[0])
          } else {
            correlatedSymbols.push(this.mergeSymbols(group))
          }
        }
      }

      return correlatedSymbols
    }

    private groupSimilarSymbols(
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): CrossLanguageIntelligence.CrossLanguageSymbol[][] {
      const groups: CrossLanguageIntelligence.CrossLanguageSymbol[][] = []
      const used = new Set<string>()

      for (let i = 0; i < symbols.length; i++) {
        if (used.has(symbols[i].id)) continue

        const currentGroup = [symbols[i]]
        used.add(symbols[i].id)

        for (let j = i + 1; j < symbols.length; j++) {
          if (used.has(symbols[j].id)) continue

          const confidence = this.calculateCorrelationConfidence(symbols[i], symbols[j])
          if (confidence >= 0.75) {
            // Adjusted to 75% for AST correlation
            // similarity threshold
            currentGroup.push(symbols[j])
            used.add(symbols[j].id)
          }
        }
        groups.push(currentGroup)
      }

      return groups
    }

    private calculateCorrelationConfidence(
      s1: CrossLanguageIntelligence.CrossLanguageSymbol,
      s2: CrossLanguageIntelligence.CrossLanguageSymbol,
    ): number {
      let score = 0
      let totalWeight = 0

      // 1. Name Similarity (Weight: 4) - Reduced weight in favor of structure
      const nameScore = this.calculateNameSimilarity(s1.name, s2.name)
      score += nameScore * 4
      totalWeight += 4

      // 2. Exact Name Match Bonus (Weight: 2)
      if (this.normalizeName(s1.name) === this.normalizeName(s2.name)) {
        score += 1 * 2
        totalWeight += 2
      }

      // 3. Endpoint Path Match (Weight: 5)
      if (s1.type === CrossLanguageIntelligence.CrossLanguageSymbolType.API_ENDPOINT) {
        const path1 = this.extractEndpointPath(s1.name)
        const path2 = this.extractEndpointPath(s2.name)
        if (path1 && path2) {
          const pathMatch = path1 === path2 ? 1 : this.calculateNameSimilarity(path1, path2)
          score += pathMatch * 5
          totalWeight += 5
        }
      }

      // 4. AST Structural Similarity (Weight: 6) - NEW: Deep AST comparison
      if (
        s1.type === CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL ||
        s1.type === CrossLanguageIntelligence.CrossLanguageSymbolType.DATABASE_ENTITY ||
        s1.type === CrossLanguageIntelligence.CrossLanguageSymbolType.MESSAGE_TYPE
      ) {
        const structureScore = this.calculateASTStructuralSimilarity(s1, s2)
        if (structureScore > 0) {
          score += structureScore * 6
          totalWeight += 6
        }
      }

      return totalWeight === 0 ? 0 : score / totalWeight
    }

    /**
     * Compares actual AST properties between cross-language symbols
     */
    private calculateASTStructuralSimilarity(
      s1: CrossLanguageIntelligence.CrossLanguageSymbol,
      s2: CrossLanguageIntelligence.CrossLanguageSymbol,
    ): number {
      // Get the AST nodes for both symbols from the first available definition
      const def1 = s1.definitions[0]
      const def2 = s2.definitions[0]

      if (!def1 || !def2) return 0

      const file1Result = this.fileResults.get(def1.filePath)
      const file2Result = this.fileResults.get(def2.filePath)

      if (!file1Result || !file2Result) return 0

      // Find the actual AST UniversalSymbols
      const astSymbol1 = this.findUniversalSymbol(file1Result.symbols, s1.name)
      const astSymbol2 = this.findUniversalSymbol(file2Result.symbols, s2.name)

      if (!astSymbol1 || !astSymbol2) return 0

      // Calculate structural match based on properties
      const props1 = this.extractProperties(astSymbol1)
      const props2 = this.extractProperties(astSymbol2)

      if (props1.length === 0 || props2.length === 0) return 0

      // Compare properties (intersection over union of property names)
      const propNames1 = new Set(props1.map((p) => this.normalizeName(p.name)))
      const propNames2 = new Set(props2.map((p) => this.normalizeName(p.name)))

      let intersection = 0
      for (const p of propNames1) {
        if (propNames2.has(p)) intersection++
      }

      const union = propNames1.size + propNames2.size - intersection

      return union === 0 ? 0 : intersection / union
    }

    private findUniversalSymbol(
      symbols: ASTEngine.UniversalSymbol[],
      name: string,
    ): ASTEngine.UniversalSymbol | undefined {
      for (const sym of symbols) {
        if (sym.name === name || this.normalizeName(sym.name) === this.normalizeName(name)) {
          return sym
        }
        if (sym.children && sym.children.length > 0) {
          const found = this.findUniversalSymbol(sym.children, name)
          if (found) return found
        }
      }
      return undefined
    }

    private extractProperties(symbol: ASTEngine.UniversalSymbol): ASTEngine.UniversalSymbol[] {
      const props: ASTEngine.UniversalSymbol[] = []

      if (symbol.children) {
        for (const child of symbol.children) {
          if (child.kind === ASTEngine.SymbolKind.Property || child.kind === ASTEngine.SymbolKind.Variable) {
            props.push(child)
          }
        }
      }
      return props
    }

    private calculateNameSimilarity(name1: string, name2: string): number {
      const n1 = this.normalizeName(name1)
      const n2 = this.normalizeName(name2)

      if (!n1 || !n2) return 0
      if (n1 === n2) return 1

      const distance = this.levenshteinDistance(n1, n2)
      const maxLength = Math.max(n1.length, n2.length)

      return Math.max(0, 1 - distance / maxLength)
    }

    private normalizeName(name: string): string {
      // Convert snake_case or kebab-case to camelCase
      let camel = name.replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
      // Lowercase the first letter
      camel = camel.charAt(0).toLowerCase() + camel.slice(1)
      return camel.replace(/controller|service|model|entity|dto|repository|manager|api/gi, "").toLowerCase()
    }

    private extractEndpointPath(name: string): string {
      const match = name.match(/(?:GET|POST|PUT|DELETE|PATCH)\s+(.+)/i)
      if (match) {
        return match[1].replace(/\/$/, "") // Remove trailing slash
      }
      return name
    }

    private levenshteinDistance(a: string, b: string): number {
      if (a.length === 0) return b.length
      if (b.length === 0) return a.length

      const matrix = []

      for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i]
      }

      for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j
      }

      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1]
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1, // substitution
              Math.min(
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j] + 1, // deletion
              ),
            )
          }
        }
      }

      return matrix[b.length][a.length]
    }

    private mergeSymbols(
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      const merged = symbols[0]

      // Merge languages, definitions, and usages
      merged.languages = Array.from(new Set(symbols.flatMap((s) => s.languages)))
      merged.definitions = symbols.flatMap((s) => s.definitions)
      merged.usages = symbols.flatMap((s) => s.usages)
      merged.contracts = symbols.flatMap((s) => s.contracts || [])

      return merged
    }
  }

  // ======================== IMPLEMENTATION ========================

  /**
   * Service Discovery - Finds ALL services across ALL languages
   */
  async function discoverServices(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    const services: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const servicePatterns = new ServicePatterns()

    for (const [filePath, result] of fileResults) {
      const language = result.language || "unknown"

      // Detect services based on file patterns and content
      const serviceIndicators = [
        // Microservice patterns
        filePath.includes("service") || filePath.includes("microservice"),
        filePath.includes("server.") || filePath.includes("app."),
        filePath.includes("main.") && ["go", "rust", "java", "csharp"].includes(language),

        // Framework-specific main files
        filePath.includes("index.js") || filePath.includes("app.py") || filePath.includes("Application.java"),

        // Docker/deployment indicators
        filePath.includes("Dockerfile") || filePath.includes("docker-compose"),

        // Configuration indicators
        filePath.includes("config") && (filePath.includes(".json") || filePath.includes(".yaml")),
      ]

      if (serviceIndicators.some((indicator) => indicator)) {
        const service = servicePatterns.createServiceSymbol(result, filePath, language)
        if (service) {
          services.push(service)
        }
      }
    }

    return services
  }

  /**
   * Database Entity Discovery - ALL ORM patterns
   */
  async function discoverDatabaseEntities(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    const entities: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const dbPatterns = new DatabaseEntityPatterns()

    for (const [filePath, result] of fileResults) {
      // Database file patterns
      if (
        filePath.includes("model") ||
        filePath.includes("entity") ||
        filePath.includes("schema") ||
        filePath.includes("migration")
      ) {
        entities.push(...dbPatterns.discoverEntitiesInFile(result, filePath))
      }

      // Language-specific ORM patterns
      entities.push(...dbPatterns.discoverLanguageSpecificEntities(result, filePath))
    }

    return entities
  }

  /**
   * Message Type Discovery - ALL messaging patterns
   */
  async function discoverMessageTypes(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    const messageTypes: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const messagePatterns = new MessageTypePatterns()

    for (const [filePath, result] of fileResults) {
      // Event/Message file patterns
      if (
        filePath.includes("event") ||
        filePath.includes("message") ||
        filePath.includes("queue") ||
        filePath.includes("topic") ||
        filePath.includes("kafka") ||
        filePath.includes("rabbitmq")
      ) {
        messageTypes.push(...messagePatterns.discoverMessageTypesInFile(result, filePath))
      }

      // Protocol buffer files
      if (filePath.endsWith(".proto")) {
        messageTypes.push(...messagePatterns.discoverProtobufMessages(result, filePath))
      }

      // GraphQL schema files
      if (filePath.includes("schema") && filePath.includes("graphql")) {
        messageTypes.push(...messagePatterns.discoverGraphQLTypes(result, filePath))
      }
    }

    return messageTypes
  }

  /**
   * Configuration Discovery - ALL config patterns
   */
  async function discoverConfigurations(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    const configurations: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const configPatterns = new ConfigurationPatterns()

    for (const [filePath, result] of fileResults) {
      // Configuration file patterns
      const isConfigFile = [
        filePath.includes("config"),
        filePath.includes("settings"),
        filePath.includes(".env"),
        filePath.endsWith(".json") && !filePath.includes("package.json"),
        filePath.endsWith(".yaml") || filePath.endsWith(".yml"),
        filePath.endsWith(".toml"),
        filePath.endsWith(".ini"),
        filePath.includes("docker-compose"),
        filePath.includes("kubernetes") || filePath.includes("k8s"),
      ].some((pattern) => pattern)

      if (isConfigFile) {
        configurations.push(...configPatterns.discoverConfigurationsInFile(result, filePath))
      }
    }

    return configurations
  }

  /**
   * Shared Library Discovery - ALL module patterns
   */
  async function discoverSharedLibraries(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageIntelligence.CrossLanguageSymbol[]> {
    const libraries: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
    const libraryPatterns = new SharedLibraryPatterns()

    for (const [filePath, result] of fileResults) {
      // Library/module patterns
      const isLibraryFile = [
        filePath.includes("lib/") || filePath.includes("libs/"),
        filePath.includes("utils/") || filePath.includes("util/"),
        filePath.includes("helpers/") || filePath.includes("common/"),
        filePath.includes("shared/") || filePath.includes("core/"),
        filePath.includes("components/") && !filePath.includes("page"),
        filePath.includes("modules/") || filePath.includes("packages/"),

        // Language-specific patterns
        filePath.endsWith(".so") || filePath.endsWith(".dll") || filePath.endsWith(".dylib"),
        filePath.includes("node_modules/") && filePath.includes("package.json"),
        filePath.includes("vendor/") || filePath.includes("third_party/"),

        // Package definition files
        filePath.includes("package.json") ||
          filePath.includes("Cargo.toml") ||
          filePath.includes("pom.xml") ||
          filePath.includes("requirements.txt"),
      ].some((pattern) => pattern)

      if (isLibraryFile) {
        libraries.push(...libraryPatterns.discoverLibrariesInFile(result, filePath))
      }
    }

    return libraries
  }

  // ======================== PATTERN CLASSES ========================

  /**
   * Service Pattern Detection
   */
  class ServicePatterns {
    createServiceSymbol(
      result: ASTEngine.ParseResult,
      filePath: string,
      language: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol | null {
      // Determine service name from file path and content
      const serviceName = this.extractServiceName(filePath, result)
      if (!serviceName) return null

      return {
        id: `service_${serviceName}_${language}`,
        name: serviceName,
        type: CrossLanguageIntelligence.CrossLanguageSymbolType.SERVICE,
        languages: [language],
        definitions: [
          {
            filePath,
            language,
            range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            symbolKind: ASTEngine.SymbolKind.Module,
            confidence: 0.8,
            context: {
              isDefinition: true,
              isUsage: false,
              accessPattern: "service",
              annotations: [],
            },
          },
        ],
        usages: [],
        contracts: [],
        metadata: {
          communicationProtocols: this.detectServiceProtocols(result),
          dataFormats: ["JSON"],
          securityMechanisms: [],
          performanceProfile: {
            latencyImpact: "medium",
            throughputImpact: "medium",
            scalabilityFactors: ["horizontal"],
          },
          architecturalPatterns: ["Microservice"],
        },
      }
    }

    private extractServiceName(filePath: string, result: ASTEngine.ParseResult): string | null {
      // Extract from file path
      const pathParts = filePath.split("/")
      let serviceName = pathParts[pathParts.length - 1].replace(/\.(js|ts|py|java|go|rs|php|rb)$/, "")

      if (serviceName === "index" || serviceName === "main" || serviceName === "app") {
        // Look for parent directory name
        serviceName = pathParts[pathParts.length - 2] || "unknown-service"
      }

      return serviceName === "unknown-service" ? null : serviceName
    }

    private detectServiceProtocols(result: ASTEngine.ParseResult): string[] {
      const protocols: string[] = []

      // Detect HTTP/REST
      if (
        result.symbols.some((s) =>
          s.qualified_calls?.some((call) => /express|fastify|flask|django|spring|gin|actix/.test(call)),
        )
      ) {
        protocols.push("HTTP")
      }

      // Detect gRPC
      if (result.symbols.some((s) => s.qualified_calls?.some((call) => /grpc|protobuf/.test(call)))) {
        protocols.push("gRPC")
      }

      // Detect WebSocket
      if (result.symbols.some((s) => s.qualified_calls?.some((call) => /websocket|socket\.io/.test(call)))) {
        protocols.push("WebSocket")
      }

      return protocols.length > 0 ? protocols : ["HTTP"]
    }
  }

  /**
   * Database Entity Pattern Detection
   */
  class DatabaseEntityPatterns {
    discoverEntitiesInFile(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const entities: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        const language = result.language || "unknown"
        if (this.isEntitySymbol(symbol, language)) {
          entities.push(this.createEntitySymbol(symbol, filePath, language))
        }
      }

      return entities
    }

    discoverLanguageSpecificEntities(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const entities: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      switch (result.language) {
        case "python":
          // Django models, SQLAlchemy
          entities.push(...this.discovePythonORMEntities(result, filePath))
          break
        case "java":
          // JPA entities, Hibernate
          entities.push(...this.discoverJavaORMEntities(result, filePath))
          break
        case "csharp":
        case "fsharp":
          // Entity Framework
          entities.push(...this.discoverCSharpORMEntities(result, filePath))
          break
        case "javascript":
        case "typescript":
          // Sequelize, TypeORM, Prisma
          entities.push(...this.discoverJavaScriptORMEntities(result, filePath))
          break
      }

      return entities
    }

    private isEntitySymbol(symbol: ASTEngine.UniversalSymbol, language: string): boolean {
      // Check for entity-like patterns
      return (
        symbol.kind === ASTEngine.SymbolKind.Class &&
        (/Model|Entity|Table|Schema/.test(symbol.name) ||
          symbol.decorators?.some((d) => /Entity|Table|Model/.test(d)) ||
          symbol.metadata?.isORMEntity)
      )
    }

    private createEntitySymbol(
      symbol: ASTEngine.UniversalSymbol,
      filePath: string,
      language: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return {
        id: `entity_${symbol.name}_${language}`,
        name: symbol.name,
        type: CrossLanguageIntelligence.CrossLanguageSymbolType.DATABASE_ENTITY,
        languages: [language],
        definitions: [
          {
            filePath,
            language,
            range: symbol.range,
            symbolKind: symbol.kind,
            confidence: 0.9,
            context: {
              isDefinition: true,
              isUsage: false,
              accessPattern: "persist",
              annotations: symbol.decorators || [],
            },
          },
        ],
        usages: [],
        contracts: [],
        metadata: {
          communicationProtocols: ["Database"],
          dataFormats: ["SQL", "JSON"],
          securityMechanisms: ["data_validation", "access_control"],
          performanceProfile: {
            latencyImpact: "high",
            throughputImpact: "high",
            scalabilityFactors: ["database_scaling", "indexing"],
          },
          architecturalPatterns: ["Active Record", "Data Mapper"],
        },
      }
    }

    // ======================== ORM ENTITY DETECTION ========================

    /**
     * Python ORM Entity Detection
     * Detects Django models, SQLAlchemy models, Pydantic models
     */
    private discovePythonORMEntities(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const entities: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isPythonORMEntity(symbol, result.rawContent || "")) {
          entities.push(this.createEntitySymbol(symbol, filePath, "python"))
        }
      }

      return entities
    }

    private isPythonORMEntity(symbol: ASTEngine.UniversalSymbol, rawContent: string): boolean {
      if (symbol.kind !== ASTEngine.SymbolKind.Class) return false

      // Django models
      if (/models\.Model|django\.db\.models/.test(rawContent)) {
        return (
          /Model$/.test(symbol.name) ||
          symbol.metadata?.inheritsFrom?.includes("Model") ||
          /CharField|IntegerField|TextField|DateTimeField/.test(rawContent)
        )
      }

      // SQLAlchemy models
      if (/declarative_base|SQLAlchemy|Column|Integer|String|DateTime/.test(rawContent)) {
        return (
          symbol.decorators?.some((d) => /@declarative_base|@table/.test(d)) ||
          symbol.metadata?.hasSQLAlchemyColumns ||
          /Column\s*\(|Table\s*\(/m.test(rawContent)
        )
      }

      // Pydantic models
      if (/pydantic|BaseModel/.test(rawContent)) {
        return (
          symbol.metadata?.inheritsFrom?.includes("BaseModel") || /Field\s*\(|validator|root_validator/.test(rawContent)
        )
      }

      // Peewee models
      if (/peewee|Model\.select/.test(rawContent)) {
        return symbol.metadata?.inheritsFrom?.includes("Model")
      }

      return false
    }

    /**
     * Java ORM Entity Detection
     * Detects JPA entities, Hibernate models, MyBatis mappers
     */
    private discoverJavaORMEntities(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const entities: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isJavaORMEntity(symbol, result.rawContent || "")) {
          entities.push(this.createEntitySymbol(symbol, filePath, "java"))
        }
      }

      return entities
    }

    private isJavaORMEntity(symbol: ASTEngine.UniversalSymbol, rawContent: string): boolean {
      if (symbol.kind !== ASTEngine.SymbolKind.Class) return false

      // JPA/Hibernate entities
      const jpaAnnotations = /@Entity|@Table|@Column|@Id|@GeneratedValue|@OneToMany|@ManyToOne|@JoinColumn/
      if (jpaAnnotations.test(rawContent)) {
        return (
          symbol.decorators?.some((d) => jpaAnnotations.test(d)) ||
          /javax\.persistence|jakarta\.persistence|org\.hibernate/.test(rawContent)
        )
      }

      // MyBatis mappers
      if (/@Mapper|@Select|@Insert|@Update|@Delete/.test(rawContent)) {
        return symbol.decorators?.some((d) => /@Mapper/.test(d)) || symbol.name.endsWith("Mapper")
      }

      // Spring Data repositories
      if (/Repository|CrudRepository|JpaRepository/.test(rawContent)) {
        return (
          /Repository$/.test(symbol.name) ||
          symbol.metadata?.implementsInterface?.some((i: string) => /Repository/.test(i))
        )
      }

      return false
    }

    /**
     * C# ORM Entity Detection
     * Detects Entity Framework models, Dapper models
     */
    private discoverCSharpORMEntities(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const entities: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isCSharpORMEntity(symbol, result.rawContent || "")) {
          entities.push(this.createEntitySymbol(symbol, filePath, "csharp"))
        }
      }

      return entities
    }

    private isCSharpORMEntity(symbol: ASTEngine.UniversalSymbol, rawContent: string): boolean {
      if (symbol.kind !== ASTEngine.SymbolKind.Class) return false

      // Entity Framework Core
      const efAnnotations = /\[Key\]|\[Table\(|\[Column\(|\[Required\]|\[ForeignKey\(|\[Index\(/
      if (efAnnotations.test(rawContent)) {
        return (
          symbol.decorators?.some((d) => efAnnotations.test(d)) ||
          /Microsoft\.EntityFrameworkCore|System\.ComponentModel\.DataAnnotations/.test(rawContent)
        )
      }

      // DbContext
      if (/DbContext|DbSet</.test(rawContent)) {
        return (
          symbol.name.endsWith("Context") ||
          symbol.metadata?.inheritsFrom?.includes("DbContext") ||
          /DbSet<\w+>/.test(rawContent)
        )
      }

      // Dapper models (convention-based)
      if (/Dapper|SqlConnection|Query</.test(rawContent)) {
        return /Model$|Entity$|DTO$/.test(symbol.name) || symbol.metadata?.hasAutoProperties
      }

      return false
    }

    /**
     * JavaScript/TypeScript ORM Entity Detection
     * Detects Sequelize, TypeORM, Prisma, Mongoose models
     */
    private discoverJavaScriptORMEntities(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const entities: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isJavaScriptORMEntity(symbol, result.rawContent || "")) {
          entities.push(this.createEntitySymbol(symbol, filePath, result.language || "unknown"))
        }
      }

      return entities
    }

    private isJavaScriptORMEntity(symbol: ASTEngine.UniversalSymbol, rawContent: string): boolean {
      // Sequelize models
      if (/sequelize\.define|DataTypes\.|Model\.init/.test(rawContent)) {
        return (
          symbol.kind === ASTEngine.SymbolKind.Class ||
          (symbol.kind === ASTEngine.SymbolKind.Variable && /Model/.test(symbol.name))
        )
      }

      // TypeORM entities
      const typeormDecorators = /@Entity|@Column|@PrimaryGeneratedColumn|@OneToMany|@ManyToOne|@JoinColumn/
      if (typeormDecorators.test(rawContent)) {
        return (
          symbol.decorators?.some((d) => typeormDecorators.test(d)) ||
          (symbol.kind === ASTEngine.SymbolKind.Class && /Entity$/.test(symbol.name))
        )
      }

      // Prisma models (schema file or generated client)
      if (/prisma\.schema|@prisma\/client|PrismaClient/.test(rawContent)) {
        return (
          /model\s+\w+/.test(rawContent) ||
          symbol.name.endsWith("Model") ||
          /findMany|findUnique|create|update|delete/.test(rawContent)
        )
      }

      // Mongoose models
      if (/mongoose\.Schema|mongoose\.model|Schema\.Types/.test(rawContent)) {
        return (
          (symbol.kind === ASTEngine.SymbolKind.Variable && /Schema|Model/.test(symbol.name)) ||
          /new Schema\(/.test(rawContent)
        )
      }

      // MikroORM entities
      if (/@Entity|@Property|@PrimaryKey|@OneToMany|@ManyToOne/.test(rawContent) && /mikro-orm/.test(rawContent)) {
        return !!symbol.decorators?.some((d) => /@Entity|@Property/.test(d))
      }

      return false
    }
  }

  /**
   * Message Type Pattern Detection
   */
  class MessageTypePatterns {
    discoverMessageTypesInFile(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const messageTypes: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      for (const symbol of result.symbols) {
        if (this.isMessageType(symbol)) {
          messageTypes.push(this.createMessageTypeSymbol(symbol, filePath, result.language || "unknown"))
        }
      }

      return messageTypes
    }

    /**
     * Protobuf Message Discovery
     * Parses .proto files for message definitions with complete type intelligence
     */
    discoverProtobufMessages(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const messages: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
      const content = result.rawContent || ""

      // Parse protobuf message definitions
      const messagePattern = /message\s+(\w+)\s*\{([^}]*)\}/g
      let match

      while ((match = messagePattern.exec(content)) !== null) {
        const messageName = match[1]
        const messageBody = match[2]

        // Parse fields within the message
        const fields = this.parseProtobufFields(messageBody)

        // Parse nested types
        const nestedTypes = this.parseProtobufNestedTypes(messageBody)

        messages.push({
          id: `protobuf_${messageName}`,
          name: messageName,
          type: CrossLanguageIntelligence.CrossLanguageSymbolType.MESSAGE_TYPE,
          languages: ["protobuf"], // Can be used across many languages
          definitions: [
            {
              filePath,
              language: "protobuf",
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
              symbolKind: ASTEngine.SymbolKind.Class,
              confidence: 1.0,
              context: {
                isDefinition: true,
                isUsage: false,
                accessPattern: "definition",
                annotations: [],
              },
            },
          ],
          usages: [],
          contracts: [
            {
              type: "ProtobufMessage",
              schema: {
                messageName,
                fields,
                nestedTypes,
              },
              version: this.extractProtobufSyntax(content),
            },
          ],
          metadata: {
            communicationProtocols: ["gRPC", "HTTP/2"],
            dataFormats: ["Protobuf", "Binary"],
            securityMechanisms: ["type_safety", "schema_validation"],
            performanceProfile: {
              latencyImpact: "low",
              throughputImpact: "high",
              scalabilityFactors: ["binary_serialization", "backward_compatibility"],
            },
            architecturalPatterns: ["Schema-First Design", "Contract-First API"],
            isProtobufMessage: true,
            fields,
            nestedTypes,
          },
        })

        // Add nested types as separate symbols
        for (const nestedType of nestedTypes) {
          messages.push({
            id: `protobuf_${messageName}_${nestedType.name}`,
            name: `${messageName}.${nestedType.name}`,
            type: CrossLanguageIntelligence.CrossLanguageSymbolType.MESSAGE_TYPE,
            languages: ["protobuf"],
            definitions: [
              {
                filePath,
                language: "protobuf",
                range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                symbolKind: ASTEngine.SymbolKind.Class,
                confidence: 1.0,
                context: {
                  isDefinition: true,
                  isUsage: false,
                  accessPattern: "nested_definition",
                  annotations: [],
                },
              },
            ],
            usages: [],
            contracts: [
              {
                type: "ProtobufNestedMessage",
                schema: nestedType,
                version: this.extractProtobufSyntax(content),
              },
            ],
            metadata: {
              communicationProtocols: ["gRPC"],
              dataFormats: ["Protobuf"],
              securityMechanisms: ["type_safety"],
              performanceProfile: {
                latencyImpact: "low",
                throughputImpact: "high",
                scalabilityFactors: ["nested_serialization"],
              },
              architecturalPatterns: ["Nested Types"],
              isProtobufNestedType: true,
              parentMessage: messageName,
            },
          })
        }
      }

      // Parse service definitions (gRPC services)
      const servicePattern = /service\s+(\w+)\s*\{([^}]*)\}/g
      while ((match = servicePattern.exec(content)) !== null) {
        const serviceName = match[1]
        const serviceBody = match[2]

        // Parse RPC methods
        const rpcMethods = this.parseProtobufRPCMethods(serviceBody)

        messages.push({
          id: `protobuf_service_${serviceName}`,
          name: serviceName,
          type: CrossLanguageIntelligence.CrossLanguageSymbolType.SERVICE,
          languages: ["protobuf"],
          definitions: [
            {
              filePath,
              language: "protobuf",
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
              symbolKind: ASTEngine.SymbolKind.Interface,
              confidence: 1.0,
              context: {
                isDefinition: true,
                isUsage: false,
                accessPattern: "service_definition",
                annotations: [],
              },
            },
          ],
          usages: [],
          contracts: [
            {
              type: "ProtobufService",
              schema: {
                serviceName,
                methods: rpcMethods,
              },
              version: this.extractProtobufSyntax(content),
            },
          ],
          metadata: {
            communicationProtocols: ["gRPC"],
            dataFormats: ["Protobuf"],
            securityMechanisms: ["tls", "authentication"],
            performanceProfile: {
              latencyImpact: "low",
              throughputImpact: "very_high",
              scalabilityFactors: ["streaming", "multiplexing"],
            },
            architecturalPatterns: ["gRPC Service", "Contract-First API"],
            isProtobufService: true,
            rpcMethods,
          },
        })
      }

      return messages
    }

    /**
     * GraphQL Schema Discovery
     * Parses GraphQL schema files with complete type system intelligence
     */
    discoverGraphQLTypes(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const types: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
      const content = result.rawContent || ""

      // Parse GraphQL type definitions
      const typePattern = /type\s+(\w+)(?:\s+implements\s+([^{]+))?\s*\{([^}]*)\}/g
      let match

      while ((match = typePattern.exec(content)) !== null) {
        const typeName = match[1]
        const implements_ =
          match[2]
            ?.trim()
            .split(/\s*&\s*/)
            .filter(Boolean) || []
        const typeBody = match[3]

        // Parse fields
        const fields = this.parseGraphQLFields(typeBody)

        types.push({
          id: `graphql_type_${typeName}`,
          name: typeName,
          type: CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL,
          languages: ["graphql"],
          definitions: [
            {
              filePath,
              language: "graphql",
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
              symbolKind: ASTEngine.SymbolKind.Class,
              confidence: 1.0,
              context: {
                isDefinition: true,
                isUsage: false,
                accessPattern: "type_definition",
                annotations: [],
              },
            },
          ],
          usages: [],
          contracts: [
            {
              type: "GraphQLType",
              schema: {
                typeName,
                fields,
                implements: implements_,
              },
              version: "GraphQL",
            },
          ],
          metadata: {
            communicationProtocols: ["HTTP", "WebSocket"],
            dataFormats: ["JSON"],
            securityMechanisms: ["query_depth_limiting", "query_complexity_analysis"],
            performanceProfile: {
              latencyImpact: "medium",
              throughputImpact: "medium",
              scalabilityFactors: ["query_optimization", "resolver_efficiency"],
            },
            architecturalPatterns: ["Schema-First GraphQL", "Type System"],
            isGraphQLType: true,
            fields,
            implements: implements_,
          },
        })
      }

      // Parse input types
      const inputPattern = /input\s+(\w+)\s*\{([^}]*)\}/g
      while ((match = inputPattern.exec(content)) !== null) {
        const inputName = match[1]
        const inputBody = match[2]
        const fields = this.parseGraphQLFields(inputBody)

        types.push({
          id: `graphql_input_${inputName}`,
          name: inputName,
          type: CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL,
          languages: ["graphql"],
          definitions: [
            {
              filePath,
              language: "graphql",
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
              symbolKind: ASTEngine.SymbolKind.Class,
              confidence: 1.0,
              context: {
                isDefinition: true,
                isUsage: false,
                accessPattern: "input_definition",
                annotations: [],
              },
            },
          ],
          usages: [],
          contracts: [
            {
              type: "GraphQLInputType",
              schema: { inputName, fields },
              version: "GraphQL",
            },
          ],
          metadata: {
            communicationProtocols: ["HTTP"],
            dataFormats: ["JSON"],
            securityMechanisms: ["input_validation"],
            performanceProfile: {
              latencyImpact: "low",
              throughputImpact: "medium",
              scalabilityFactors: ["input_validation"],
            },
            architecturalPatterns: ["Input Validation"],
            isGraphQLInputType: true,
            fields,
          },
        })
      }

      // Parse enum types
      const enumPattern = /enum\s+(\w+)\s*\{([^}]*)\}/g
      while ((match = enumPattern.exec(content)) !== null) {
        const enumName = match[1]
        const enumBody = match[2]
        const values = this.parseGraphQLEnumValues(enumBody)

        types.push({
          id: `graphql_enum_${enumName}`,
          name: enumName,
          type: CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL,
          languages: ["graphql"],
          definitions: [
            {
              filePath,
              language: "graphql",
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
              symbolKind: ASTEngine.SymbolKind.Enum,
              confidence: 1.0,
              context: {
                isDefinition: true,
                isUsage: false,
                accessPattern: "enum_definition",
                annotations: [],
              },
            },
          ],
          usages: [],
          contracts: [
            {
              type: "GraphQLEnumType",
              schema: { enumName, values },
              version: "GraphQL",
            },
          ],
          metadata: {
            communicationProtocols: ["HTTP"],
            dataFormats: ["JSON"],
            securityMechanisms: ["type_safety"],
            performanceProfile: {
              latencyImpact: "low",
              throughputImpact: "low",
              scalabilityFactors: [],
            },
            architecturalPatterns: ["Type Safety"],
            isGraphQLEnumType: true,
            values,
          },
        })
      }

      return types
    }

    private isMessageType(symbol: ASTEngine.UniversalSymbol): boolean {
      return (
        /Event|Message|Command|Query|Notification/.test(symbol.name) ||
        !!symbol.decorators?.some((d) => /Event|Message/.test(d))
      )
    }

    private createMessageTypeSymbol(
      symbol: ASTEngine.UniversalSymbol,
      filePath: string,
      language: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return {
        id: `message_${symbol.name}_${language}`,
        name: symbol.name,
        type: CrossLanguageIntelligence.CrossLanguageSymbolType.MESSAGE_TYPE,
        languages: [language],
        definitions: [
          {
            filePath,
            language,
            range: symbol.range,
            symbolKind: symbol.kind,
            confidence: 0.8,
            context: {
              isDefinition: true,
              isUsage: false,
              accessPattern: "publish",
              annotations: symbol.decorators || [],
            },
          },
        ],
        usages: [],
        contracts: [],
        metadata: {
          communicationProtocols: ["Message Queue", "Event Bus"],
          dataFormats: ["JSON", "Protobuf"],
          securityMechanisms: ["message_signing", "encryption"],
          performanceProfile: {
            latencyImpact: "low",
            throughputImpact: "high",
            scalabilityFactors: ["async_processing", "partitioning"],
          },
          architecturalPatterns: ["Event Sourcing", "CQRS", "Pub/Sub"],
        },
      }
    }
    // ======================== PROTOBUF & GRAPHQL PARSING HELPERS ========================

    /**
     * Parse Protobuf field definitions from message body
     */
    private parseProtobufFields(
      messageBody: string,
    ): Array<{ name: string; type: string; number: number; optional: boolean }> {
      const fields: Array<{ name: string; type: string; number: number; optional: boolean }> = []
      const fieldPattern = /(optional|required|repeated)?\s*(\w+)\s+(\w+)\s*=\s*(\d+);/g

      let match
      while ((match = fieldPattern.exec(messageBody)) !== null) {
        const modifier = match[1]
        const type = match[2]
        const name = match[3]
        const number = parseInt(match[4])

        fields.push({
          name,
          type,
          number,
          optional: modifier === "optional" || !modifier, // proto3 fields are optional by default
        })
      }

      return fields
    }

    /**
     * Parse Protobuf nested type definitions
     */
    private parseProtobufNestedTypes(messageBody: string): Array<{ name: string; type: string; fields?: any[] }> {
      const nestedTypes: Array<{ name: string; type: string; fields?: any[] }> = []

      // Parse nested messages
      const nestedMessagePattern = /message\s+(\w+)\s*\{([^}]*)\}/g
      let match

      while ((match = nestedMessagePattern.exec(messageBody)) !== null) {
        const nestedName = match[1]
        const nestedBody = match[2]
        const nestedFields = this.parseProtobufFields(nestedBody)

        nestedTypes.push({
          name: nestedName,
          type: "message",
          fields: nestedFields,
        })
      }

      // Parse nested enums
      const nestedEnumPattern = /enum\s+(\w+)\s*\{([^}]*)\}/g
      while ((match = nestedEnumPattern.exec(messageBody)) !== null) {
        const enumName = match[1]
        const enumBody = match[2]
        const enumValues = this.parseProtobufEnumValues(enumBody)

        nestedTypes.push({
          name: enumName,
          type: "enum",
          fields: enumValues,
        })
      }

      return nestedTypes
    }

    /**
     * Parse Protobuf enum values
     */
    private parseProtobufEnumValues(enumBody: string): Array<{ name: string; value: number }> {
      const values: Array<{ name: string; value: number }> = []
      const valuePattern = /(\w+)\s*=\s*(\d+);/g

      let match
      while ((match = valuePattern.exec(enumBody)) !== null) {
        values.push({
          name: match[1],
          value: parseInt(match[2]),
        })
      }

      return values
    }

    /**
     * Parse Protobuf RPC method definitions
     */
    private parseProtobufRPCMethods(
      serviceBody: string,
    ): Array<{ name: string; inputType: string; outputType: string; streaming: { input: boolean; output: boolean } }> {
      const methods: Array<{
        name: string
        inputType: string
        outputType: string
        streaming: { input: boolean; output: boolean }
      }> = []
      const rpcPattern = /rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)/g

      let match
      while ((match = rpcPattern.exec(serviceBody)) !== null) {
        methods.push({
          name: match[1],
          inputType: match[3],
          outputType: match[5],
          streaming: {
            input: !!match[2],
            output: !!match[4],
          },
        })
      }

      return methods
    }

    /**
     * Extract Protobuf syntax version
     */
    private extractProtobufSyntax(content: string): string {
      const syntaxMatch = /syntax\s*=\s*["']([^"']+)["'];/.exec(content)
      return syntaxMatch?.[1] || "proto2"
    }

    /**
     * Parse GraphQL field definitions
     */
    private parseGraphQLFields(
      typeBody: string,
    ): Array<{ name: string; type: string; arguments?: any[]; directives?: string[] }> {
      const fields: Array<{ name: string; type: string; arguments?: any[]; directives?: string[] }> = []

      // Remove comments
      const cleanBody = typeBody.replace(/#[^\n]*/g, "")

      // Parse field definitions
      const fieldPattern = /(\w+)(?:\s*\(([^)]*)\))?\s*:\s*([^@\n]+)(?:\s*@([^\n]*))?/g

      let match
      while ((match = fieldPattern.exec(cleanBody)) !== null) {
        const fieldName = match[1]
        const argsString = match[2]
        const fieldType = match[3].trim()
        const directivesString = match[4]

        // Parse arguments
        const fieldArgs = argsString ? this.parseGraphQLArguments(argsString) : []

        // Parse directives
        const directives = directivesString ? directivesString.split(/\s+@/).filter(Boolean) : []

        fields.push({
          name: fieldName,
          type: fieldType,
          arguments: fieldArgs,
          directives,
        })
      }

      return fields
    }

    /**
     * Parse GraphQL field arguments
     */
    private parseGraphQLArguments(argsString: string): Array<{ name: string; type: string; defaultValue?: string }> {
      const args: Array<{ name: string; type: string; defaultValue?: string }> = []
      const argPattern = /(\w+)\s*:\s*([^,=]+)(?:\s*=\s*([^,]+))?/g

      let match
      while ((match = argPattern.exec(argsString)) !== null) {
        args.push({
          name: match[1],
          type: match[2].trim(),
          defaultValue: match[3]?.trim(),
        })
      }

      return args
    }

    /**
     * Parse GraphQL enum values
     */
    private parseGraphQLEnumValues(enumBody: string): string[] {
      const values: string[] = []

      // Remove comments and extract enum values
      const cleanBody = enumBody.replace(/#[^\n]*/g, "")
      const valuePattern = /(\w+)/g

      let match
      while ((match = valuePattern.exec(cleanBody)) !== null) {
        const value = match[1].trim()
        if (value && !values.includes(value)) {
          values.push(value)
        }
      }

      return values
    }
  }

  /**
   * Configuration Pattern Detection
   */
  class ConfigurationPatterns {
    discoverConfigurationsInFile(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const configurations: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Create configuration symbol based on file type
      const configName = this.extractConfigName(filePath)
      if (configName) {
        configurations.push(this.createConfigurationSymbol(configName, filePath, result.language || "unknown"))
      }

      return configurations
    }

    private extractConfigName(filePath: string): string | null {
      const fileName = filePath.split("/").pop() || ""

      if (fileName.includes("docker-compose")) return "docker-compose"
      if (fileName.includes("kubernetes") || fileName.includes("k8s")) return "kubernetes"
      if (fileName.includes(".env")) return "environment"
      if (fileName.includes("config")) return "application-config"
      if (fileName.includes("settings")) return "settings"

      return null
    }

    private createConfigurationSymbol(
      name: string,
      filePath: string,
      language: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol {
      return {
        id: `config_${name}`,
        name,
        type: CrossLanguageIntelligence.CrossLanguageSymbolType.CONFIGURATION,
        languages: [language],
        definitions: [
          {
            filePath,
            language,
            range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            symbolKind: ASTEngine.SymbolKind.Variable,
            confidence: 1.0,
            context: {
              isDefinition: true,
              isUsage: false,
              accessPattern: "read",
              annotations: [],
            },
          },
        ],
        usages: [],
        contracts: [],
        metadata: {
          communicationProtocols: [],
          dataFormats: ["JSON", "YAML", "INI"],
          securityMechanisms: ["secret_management", "encryption"],
          performanceProfile: {
            latencyImpact: "low",
            throughputImpact: "low",
            scalabilityFactors: [],
          },
          architecturalPatterns: ["Configuration Management", "Infrastructure as Code"],
        },
      }
    }
  }

  /**
   * Shared Library Pattern Detection
   */
  class SharedLibraryPatterns {
    discoverLibrariesInFile(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const libraries: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      // Detect different types of libraries
      if (filePath.includes("package.json")) {
        libraries.push(...this.discoverNpmLibraries(result, filePath))
      } else if (filePath.includes("Cargo.toml")) {
        libraries.push(...this.discoverCargoLibraries(result, filePath))
      } else if (filePath.includes("pom.xml")) {
        libraries.push(...this.discoverMavenLibraries(result, filePath))
      } else if (filePath.includes("requirements.txt")) {
        libraries.push(...this.discoverPythonLibraries(result, filePath))
      }

      return libraries
    }

    /**
     * NPM Library Discovery
     * Parses package.json dependencies with deep intelligence
     */
    private discoverNpmLibraries(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const libraries: CrossLanguageIntelligence.CrossLanguageSymbol[] = []

      try {
        const content = result.rawContent || ""
        const packageJson = JSON.parse(content)

        // Parse dependencies
        const allDependencies = {
          ...(packageJson.dependencies || {}),
          ...(packageJson.devDependencies || {}),
          ...(packageJson.peerDependencies || {}),
          ...(packageJson.optionalDependencies || {}),
        }

        for (const [libName, version] of Object.entries(allDependencies)) {
          const libType = this.classifyNpmLibrary(libName as string)

          libraries.push({
            id: `npm_${libName}`,
            name: libName as string,
            type: CrossLanguageIntelligence.CrossLanguageSymbolType.SHARED_LIBRARY,
            languages: ["javascript", "typescript"],
            definitions: [
              {
                filePath,
                language: "json",
                range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                symbolKind: ASTEngine.SymbolKind.Module,
                confidence: 1.0,
                context: {
                  isDefinition: true,
                  isUsage: false,
                  accessPattern: "import",
                  annotations: [],
                },
              },
            ],
            usages: [],
            contracts: [],
            metadata: {
              communicationProtocols: libType.protocols,
              dataFormats: libType.dataFormats,
              securityMechanisms: libType.security,
              performanceProfile: {
                latencyImpact: libType.performance,
                throughputImpact: libType.performance,
                scalabilityFactors: [libType.category],
              },
              architecturalPatterns: [libType.category],
              version: version as string,
              packageManager: "npm",
              category: libType.category,
              isDevDependency: !!packageJson.devDependencies?.[libName],
            },
          })
        }
      } catch (e) {
        // Not a valid package.json or parsing error
      }

      return libraries
    }

    /**
     * Cargo Library Discovery
     * Parses Cargo.toml dependencies with Rust ecosystem intelligence
     */
    private discoverCargoLibraries(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const libraries: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
      const content = result.rawContent || ""

      // Parse TOML-style dependencies
      const dependencySections = [
        /\[dependencies\]([\s\S]*?)(?=\n\[|\n$|$)/g,
        /\[dev-dependencies\]([\s\S]*?)(?=\n\[|\n$|$)/g,
        /\[build-dependencies\]([\s\S]*?)(?=\n\[|\n$|$)/g,
      ]

      for (const sectionRegex of dependencySections) {
        let match
        while ((match = sectionRegex.exec(content)) !== null) {
          const sectionContent = match[1]

          // Extract crate names and versions
          const cratePattern =
            /^(\w+(?:-\w+)*)\s*=\s*["']([^"']+)["']|^(\w+(?:-\w+)*)\s*=\s*\{[^}]*version\s*=\s*["']([^"']+)["']/gm

          let crateMatch
          while ((crateMatch = cratePattern.exec(sectionContent)) !== null) {
            const crateName = crateMatch[1] || crateMatch[3]
            const version = crateMatch[2] || crateMatch[4]

            if (crateName) {
              const crateType = this.classifyRustCrate(crateName)

              libraries.push({
                id: `cargo_${crateName}`,
                name: crateName,
                type: CrossLanguageIntelligence.CrossLanguageSymbolType.SHARED_LIBRARY,
                languages: ["rust"],
                definitions: [
                  {
                    filePath,
                    language: "toml",
                    range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                    symbolKind: ASTEngine.SymbolKind.Module,
                    confidence: 1.0,
                    context: {
                      isDefinition: true,
                      isUsage: false,
                      accessPattern: "extern_crate",
                      annotations: [],
                    },
                  },
                ],
                usages: [],
                contracts: [],
                metadata: {
                  communicationProtocols: crateType.protocols,
                  dataFormats: crateType.dataFormats,
                  securityMechanisms: crateType.security,
                  performanceProfile: {
                    latencyImpact: crateType.performance,
                    throughputImpact: crateType.performance,
                    scalabilityFactors: [crateType.category],
                  },
                  architecturalPatterns: [crateType.category],
                  version: version || "unknown",
                  packageManager: "cargo",
                  category: crateType.category,
                },
              })
            }
          }
        }
      }

      return libraries
    }

    /**
     * Maven Library Discovery
     * Parses pom.xml dependencies with Java ecosystem intelligence
     */
    private discoverMavenLibraries(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const libraries: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
      const content = result.rawContent || ""

      // Parse Maven dependencies from XML
      const dependencyPattern = /<dependency>([\s\S]*?)<\/dependency>/g
      let match

      while ((match = dependencyPattern.exec(content)) !== null) {
        const dependencyXml = match[1]

        // Extract groupId, artifactId, version
        const groupIdMatch = /<groupId>(.*?)<\/groupId>/.exec(dependencyXml)
        const artifactIdMatch = /<artifactId>(.*?)<\/artifactId>/.exec(dependencyXml)
        const versionMatch = /<version>(.*?)<\/version>/.exec(dependencyXml)
        const scopeMatch = /<scope>(.*?)<\/scope>/.exec(dependencyXml)

        if (groupIdMatch && artifactIdMatch) {
          const groupId = groupIdMatch[1]
          const artifactId = artifactIdMatch[1]
          const version = versionMatch?.[1] || "unknown"
          const scope = scopeMatch?.[1] || "compile"

          const libName = `${groupId}:${artifactId}`
          const libType = this.classifyMavenLibrary(groupId, artifactId)

          libraries.push({
            id: `maven_${artifactId}`,
            name: libName,
            type: CrossLanguageIntelligence.CrossLanguageSymbolType.SHARED_LIBRARY,
            languages: ["java"],
            definitions: [
              {
                filePath,
                language: "xml",
                range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                symbolKind: ASTEngine.SymbolKind.Module,
                confidence: 1.0,
                context: {
                  isDefinition: true,
                  isUsage: false,
                  accessPattern: "import",
                  annotations: [],
                },
              },
            ],
            usages: [],
            contracts: [],
            metadata: {
              communicationProtocols: libType.protocols,
              dataFormats: libType.dataFormats,
              securityMechanisms: libType.security,
              performanceProfile: {
                latencyImpact: libType.performance,
                throughputImpact: libType.performance,
                scalabilityFactors: [libType.category],
              },
              architecturalPatterns: [libType.category],
              version,
              packageManager: "maven",
              category: libType.category,
              scope,
              groupId,
              artifactId,
            },
          })
        }
      }

      return libraries
    }

    /**
     * Python Library Discovery
     * Parses requirements.txt and setup.py with Python ecosystem intelligence
     */
    private discoverPythonLibraries(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.CrossLanguageSymbol[] {
      const libraries: CrossLanguageIntelligence.CrossLanguageSymbol[] = []
      const content = result.rawContent || ""

      if (filePath.endsWith("requirements.txt") || filePath.endsWith("requirements-dev.txt")) {
        // Parse requirements.txt format
        const lines = content.split("\n")

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-")) {
            // Parse package name and version specifier
            const match = /^([a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9])([>=<~!]+.*)?$/.exec(trimmed)
            if (match) {
              const packageName = match[1]
              const versionSpec = match[2] || ""

              const packageType = this.classifyPythonPackage(packageName)

              libraries.push({
                id: `pip_${packageName}`,
                name: packageName,
                type: CrossLanguageIntelligence.CrossLanguageSymbolType.SHARED_LIBRARY,
                languages: ["python"],
                definitions: [
                  {
                    filePath,
                    language: "text",
                    range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                    symbolKind: ASTEngine.SymbolKind.Module,
                    confidence: 1.0,
                    context: {
                      isDefinition: true,
                      isUsage: false,
                      accessPattern: "import",
                      annotations: [],
                    },
                  },
                ],
                usages: [],
                contracts: [],
                metadata: {
                  communicationProtocols: packageType.protocols,
                  dataFormats: packageType.dataFormats,
                  securityMechanisms: packageType.security,
                  performanceProfile: {
                    latencyImpact: packageType.performance,
                    throughputImpact: packageType.performance,
                    scalabilityFactors: [packageType.category],
                  },
                  architecturalPatterns: [packageType.category],
                  versionSpec,
                  packageManager: "pip",
                  category: packageType.category,
                },
              })
            }
          }
        }
      } else if (filePath.endsWith("setup.py") || filePath.endsWith("pyproject.toml")) {
        // Parse setup.py or pyproject.toml dependencies
        const requiresPattern = /(?:requires|dependencies)\s*=\s*\[([\s\S]*?)\]/g
        let match

        while ((match = requiresPattern.exec(content)) !== null) {
          const requiresContent = match[1]
          const packagePattern = /["']([^"'>=<~!]+)[^"']*["']/g

          let packageMatch
          while ((packageMatch = packagePattern.exec(requiresContent)) !== null) {
            const packageName = packageMatch[1]
            const packageType = this.classifyPythonPackage(packageName)

            libraries.push({
              id: `pip_${packageName}`,
              name: packageName,
              type: CrossLanguageIntelligence.CrossLanguageSymbolType.SHARED_LIBRARY,
              languages: ["python"],
              definitions: [
                {
                  filePath,
                  language: filePath.endsWith(".toml") ? "toml" : "python",
                  range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                  symbolKind: ASTEngine.SymbolKind.Module,
                  confidence: 1.0,
                  context: {
                    isDefinition: true,
                    isUsage: false,
                    accessPattern: "import",
                    annotations: [],
                  },
                },
              ],
              usages: [],
              contracts: [],
              metadata: {
                communicationProtocols: packageType.protocols,
                dataFormats: packageType.dataFormats,
                securityMechanisms: packageType.security,
                performanceProfile: {
                  latencyImpact: packageType.performance,
                  throughputImpact: packageType.performance,
                  scalabilityFactors: [packageType.category],
                },
                architecturalPatterns: [packageType.category],
                packageManager: "pip",
                category: packageType.category,
              },
            })
          }
        }
      }

      return libraries
    }

    // ======================== LIBRARY CLASSIFICATION METHODS ========================

    /**
     * Classify NPM libraries by type and characteristics
     */
    private classifyNpmLibrary(libName: string): {
      category: string
      protocols: string[]
      dataFormats: string[]
      security: string[]
      performance: string
    } {
      // Web frameworks
      if (["express", "fastify", "koa", "hapi", "nestjs"].includes(libName)) {
        return {
          category: "Web Framework",
          protocols: ["HTTP", "HTTPS"],
          dataFormats: ["JSON", "HTML"],
          security: ["cors", "helmet"],
          performance: "high",
        }
      }

      // React/Vue/Angular
      if (["react", "vue", "@angular/core", "svelte"].includes(libName)) {
        return {
          category: "Frontend Framework",
          protocols: ["HTTP"],
          dataFormats: ["JSON", "HTML"],
          security: ["xss_protection"],
          performance: "medium",
        }
      }

      // Database libraries
      if (["mongoose", "sequelize", "typeorm", "prisma", "pg", "mysql2", "sqlite3"].includes(libName)) {
        return {
          category: "Database ORM",
          protocols: ["Database"],
          dataFormats: ["SQL", "JSON"],
          security: ["sql_injection_protection"],
          performance: "medium",
        }
      }

      // HTTP clients
      if (["axios", "fetch", "superagent", "got", "node-fetch"].includes(libName)) {
        return {
          category: "HTTP Client",
          protocols: ["HTTP", "HTTPS"],
          dataFormats: ["JSON", "XML"],
          security: ["tls"],
          performance: "high",
        }
      }

      // Testing frameworks
      if (["jest", "mocha", "chai", "cypress", "@testing-library/react"].includes(libName)) {
        return {
          category: "Testing Framework",
          protocols: [],
          dataFormats: ["JSON"],
          security: [],
          performance: "low",
        }
      }

      // Build tools
      if (["webpack", "rollup", "parcel", "vite", "gulp"].includes(libName)) {
        return {
          category: "Build Tool",
          protocols: [],
          dataFormats: ["JavaScript", "CSS"],
          security: [],
          performance: "build_time",
        }
      }

      // Default classification
      return {
        category: "Utility Library",
        protocols: [],
        dataFormats: ["JSON"],
        security: [],
        performance: "low",
      }
    }

    /**
     * Classify Rust crates by type and characteristics
     */
    private classifyRustCrate(crateName: string): {
      category: string
      protocols: string[]
      dataFormats: string[]
      security: string[]
      performance: string
    } {
      // Web frameworks
      if (["actix-web", "warp", "rocket", "axum", "tide"].includes(crateName)) {
        return {
          category: "Web Framework",
          protocols: ["HTTP", "HTTPS"],
          dataFormats: ["JSON"],
          security: ["memory_safety"],
          performance: "very_high",
        }
      }

      // Async runtime
      if (["tokio", "async-std", "smol"].includes(crateName)) {
        return {
          category: "Async Runtime",
          protocols: ["TCP", "UDP"],
          dataFormats: [],
          security: ["memory_safety"],
          performance: "very_high",
        }
      }

      // Serialization
      if (["serde", "serde_json", "bincode", "postcard"].includes(crateName)) {
        return {
          category: "Serialization",
          protocols: [],
          dataFormats: ["JSON", "Binary"],
          security: ["type_safety"],
          performance: "high",
        }
      }

      // Database
      if (["diesel", "sqlx", "rusqlite", "mongodb"].includes(crateName)) {
        return {
          category: "Database ORM",
          protocols: ["Database"],
          dataFormats: ["SQL", "BSON"],
          security: ["sql_injection_protection", "memory_safety"],
          performance: "high",
        }
      }

      // HTTP clients
      if (["reqwest", "hyper", "surf", "ureq"].includes(crateName)) {
        return {
          category: "HTTP Client",
          protocols: ["HTTP", "HTTPS"],
          dataFormats: ["JSON"],
          security: ["tls", "memory_safety"],
          performance: "very_high",
        }
      }

      // Default
      return {
        category: "System Library",
        protocols: [],
        dataFormats: [],
        security: ["memory_safety"],
        performance: "high",
      }
    }

    /**
     * Classify Maven libraries by group and artifact ID
     */
    private classifyMavenLibrary(
      groupId: string,
      artifactId: string,
    ): {
      category: string
      protocols: string[]
      dataFormats: string[]
      security: string[]
      performance: string
    } {
      // Spring Framework
      if (groupId.startsWith("org.springframework")) {
        if (artifactId.includes("web") || artifactId.includes("mvc")) {
          return {
            category: "Web Framework",
            protocols: ["HTTP", "HTTPS"],
            dataFormats: ["JSON", "XML"],
            security: ["csrf_protection", "authentication"],
            performance: "medium",
          }
        }
        return {
          category: "Enterprise Framework",
          protocols: [],
          dataFormats: ["JSON"],
          security: ["dependency_injection"],
          performance: "medium",
        }
      }

      // JPA/Hibernate
      if (groupId === "org.hibernate" || groupId === "javax.persistence" || groupId === "jakarta.persistence") {
        return {
          category: "Database ORM",
          protocols: ["Database"],
          dataFormats: ["SQL"],
          security: ["sql_injection_protection"],
          performance: "medium",
        }
      }

      // Testing
      if (groupId === "org.junit.jupiter" || groupId === "org.mockito") {
        return {
          category: "Testing Framework",
          protocols: [],
          dataFormats: [],
          security: [],
          performance: "test_only",
        }
      }

      // Jackson JSON
      if (groupId === "com.fasterxml.jackson.core") {
        return {
          category: "JSON Processing",
          protocols: [],
          dataFormats: ["JSON"],
          security: ["deserialization_protection"],
          performance: "high",
        }
      }

      // Apache Commons
      if (groupId === "org.apache.commons") {
        return {
          category: "Utility Library",
          protocols: [],
          dataFormats: [],
          security: [],
          performance: "medium",
        }
      }

      // Default
      return {
        category: "Java Library",
        protocols: [],
        dataFormats: ["JSON"],
        security: [],
        performance: "medium",
      }
    }

    /**
     * Classify Python packages by name and characteristics
     */
    private classifyPythonPackage(packageName: string): {
      category: string
      protocols: string[]
      dataFormats: string[]
      security: string[]
      performance: string
    } {
      // Web frameworks
      if (["django", "flask", "fastapi", "tornado", "sanic", "quart"].includes(packageName)) {
        return {
          category: "Web Framework",
          protocols: ["HTTP", "HTTPS"],
          dataFormats: ["JSON", "HTML"],
          security: ["csrf_protection", "sql_injection_protection"],
          performance: "medium",
        }
      }

      // Data science
      if (["pandas", "numpy", "scipy", "matplotlib", "seaborn", "plotly"].includes(packageName)) {
        return {
          category: "Data Science",
          protocols: [],
          dataFormats: ["CSV", "JSON", "Parquet"],
          security: [],
          performance: "high",
        }
      }

      // Machine learning
      if (["tensorflow", "torch", "scikit-learn", "keras", "transformers"].includes(packageName)) {
        return {
          category: "Machine Learning",
          protocols: [],
          dataFormats: ["Tensor", "HDF5"],
          security: [],
          performance: "high",
        }
      }

      // Database
      if (["sqlalchemy", "psycopg2", "pymongo", "redis", "elasticsearch"].includes(packageName)) {
        return {
          category: "Database Driver",
          protocols: ["Database"],
          dataFormats: ["SQL", "JSON", "BSON"],
          security: ["sql_injection_protection"],
          performance: "medium",
        }
      }

      // HTTP clients
      if (["requests", "httpx", "aiohttp", "urllib3"].includes(packageName)) {
        return {
          category: "HTTP Client",
          protocols: ["HTTP", "HTTPS"],
          dataFormats: ["JSON", "XML"],
          security: ["tls"],
          performance: "medium",
        }
      }

      // Testing
      if (["pytest", "unittest", "mock", "coverage"].includes(packageName)) {
        return {
          category: "Testing Framework",
          protocols: [],
          dataFormats: [],
          security: [],
          performance: "test_only",
        }
      }

      // Default
      return {
        category: "Python Library",
        protocols: [],
        dataFormats: ["JSON"],
        security: [],
        performance: "medium",
      }
    }
  }
}
