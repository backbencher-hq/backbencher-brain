import * as Log from "../tool/brain-log"

const log = Log.create({ service: "cross-language-migration" })

export namespace CrossLanguageMigrationAssistant {
  export type MigrationUnsupportedReason = "unknown-library" | "ambiguous-mapping" | "unsupported-target" | "same-language" | "missing-symbol"

  export interface LibraryEquivalence {
    source: string
    target: string | null
    confidence: number // 0-1; confidence below 0.5 is never a supported mapping
    notes?: string
    status: "supported" | "uncertain"
    unsupportedReason?: MigrationUnsupportedReason
    /**
     * Where this claim comes from. `indexed-import` is an observed import in
     * the index; `name-heuristic` is a guess from the symbol's name. Only the
     * first kind is evidence, and only the first kind moves effort or risk.
     */
    provenance?: "indexed-import" | "name-heuristic"
  }

  export interface MigrationRisk {
    level: "Low" | "Medium" | "High" | "Critical"
    factors: string[]
  }

  export interface MigrationRelationshipEvidence {
    id: string
    relationshipType: string
    sourceSymbolId: string | null
    targetSymbolId: string | null
    /** The name the indexer recorded for an endpoint that is not an indexed symbol. */
    sourceExternal: string | null
    targetExternal: string | null
    sourceFile: string
    targetFile: string
    /**
     * The line the relationship occurs on, 1-based, as stored by the indexer.
     * Null when the indexer recorded none — 490 of 5228 cobra rows — and that
     * absence is reported rather than filled with a zero.
     */
    line: number | null
    /**
     * The indexer's own 0–1 confidence for this relationship. This REPLACES the
     * constant 0.8 the bridge used to fabricate: measured 6 distinct values on
     * cobra and 4 on flask. It is a confidence, not a coupling strength, and the
     * field is named for what the index actually stores.
     */
    confidence: number | null
    /** True when the indexer marked this edge as crossing a language boundary. */
    isCrossLanguage: boolean
    /** How the boundary is bridged, as recorded ("name-resolution", …). */
    bridgeMechanism: string | null
    isCrossFile: boolean
    /**
     * False when either endpoint is not an indexed symbol. Such an edge cannot be
     * located, so it is not charged as migration work; the count is reported
     * instead of silently inflating the total.
     */
    endpointsResolved: boolean
    /**
     * False for a structural edge (`contains`, `exports`) that records nesting
     * or declaration rather than an integration point. Shown as evidence, not
     * charged as work — see {@link isStructuralRelationship}.
     */
    isIntegrationPoint: boolean
    /**
     * True when the edge's files look like test code. A migrating engineer needs
     * this split: measured, 55.3% of a cobra plan's evidence is test callers, and
     * a flat per-edge cost makes that dominate the headline number.
     */
    isTestEvidence: boolean
  }

  export interface MigrationPlan {
    componentName: string
    /** The exact indexed symbol this plan is about; disambiguates a shared name. */
    symbolId: string
    /** The file that symbol is defined in, taken from the plan's own symbol. */
    sourceFile: string
    sourceLanguage: string
    targetLanguage: string
    /** Libraries backed by an indexed import. The only kind that is evidence. */
    dependencies: LibraryEquivalence[]
    /** Name-based guesses. Explicitly NOT evidence; excluded from effort/risk. */
    inferredDependencies: LibraryEquivalence[]
    dependencyProvenance: {
      indexedImports: number
      nameHeuristics: number
      /**
       * Whether the index can supply library evidence for this component at all.
       * The index does not record per-file imports, so this is `unavailable` in
       * practice; it is stated rather than reported as "no dependencies".
       */
      importEvidence: "available" | "unavailable"
      note: string
    }
    relationshipEvidence: MigrationRelationshipEvidence[]
    evidenceBreakdown: {
      total: number
      /** Resolved, non-test edges: the integration points a port must satisfy. */
      production: number
      /** Resolved edges whose files are test code. */
      test: number
      /** Edges with an endpoint that is not an indexed symbol; not charged. */
      unresolvable: number
      /** Containment/export edges: shown as evidence, not charged as work. */
      structural: number
      /** Edges the indexer marked as crossing a language boundary. */
      crossLanguage: number
      /** Of the resolved edges, how many carry a line. */
      withLine: number
      /** Of the resolved edges, how many carry a stored confidence. */
      withConfidence: number
    }
    effortEstimateHours: number
    complexityScore: number // 1-10
    riskAssessment: MigrationRisk
    strategySteps: string[]
  }
  // A hardcoded knowledge base of polyglot equivalents for migration
  const BASE_POLYGLOT_LIBRARY_DICTIONARY: Record<
    string,
    Record<string, Record<string, { target: string; notes?: string }>>
  > = {
    typescript: {
      python: {
        express: { target: "fastapi", notes: "Use FastAPI for async, type-safe route handling." },
        nestjs: { target: "fastapi", notes: "Consider FastAPI + Dependency Injector." },
        "drizzle-orm": { target: "sqlalchemy", notes: "SQLAlchemy 2.0 provides similar type-safe ORM capabilities." },
        typeorm: { target: "sqlalchemy", notes: "SQLAlchemy is the pythonic equivalent." },
        jest: { target: "pytest", notes: "Standard python testing framework. Use unittest.mock for mocking." },
        axios: { target: "requests", notes: "Or httpx if async is required." },
        react: { target: "dash/streamlit", notes: "For web UI in Python, though architecture differs heavily." },
      },
      go: {
        express: { target: "gin / fiber", notes: "Gin is a fast, similar unopinionated router." },
        nestjs: { target: "go-kit", notes: "Microservice toolkit." },
        "drizzle-orm": { target: "gorm / ent", notes: "GORM is the most popular Go ORM." },
        jest: { target: "testing", notes: "Use Go's built-in testing package." },
        axios: { target: "net/http", notes: "Use the standard library." },
      },
      dart: {
        flutter: { target: "react-native", notes: "React Native + Expo is the closest cross-platform equivalent." },
        "flutter/material": { target: "@radix-ui/react + tailwind", notes: "Material → shadcn/ui component library." },
        bloc: { target: "zustand / redux toolkit", notes: "Zustand is the closest lightweight state manager to Cubit." },
        cubit: { target: "zustand store", notes: "Zustand stores map closest to Cubit pattern." },
        equatable: { target: "zod", notes: "Zod provides value equality + schema validation." },
        freezed: { target: "zod + immer", notes: "Freezed's immutable data classes → Zod schemas + Immer." },
        dio: { target: "axios / fetch", notes: "Dio HTTP client maps to Axios or native fetch." },
        provider: { target: "react context + hooks", notes: "Provider pattern → React Context + useReducer." },
        get_it: { target: "tsyringe / inversify", notes: "Service locator → DI container." },
        mockito: { target: "jest mocks / vitest", notes: "Standard JS testing mocks." },
      },
      javascript: {
        express: { target: "express", notes: "Same framework; remove type annotations." },
        "drizzle-orm": { target: "drizzle-orm", notes: "Drizzle works in JS; use JSDoc for types." },
        jest: { target: "jest", notes: "Jest works without TypeScript." },
        axios: { target: "axios", notes: "Axios works in plain JS." },
        prisma: { target: "prisma", notes: "Prisma works with JS; use JSDoc." },
        next: { target: "next", notes: "Next.js supports plain JS." },
      },
    },
    dart: {
      typescript: {
        "react-native": { target: "flutter", notes: "Flutter is the Dart-native cross-platform framework." },
        expo: { target: "flutter", notes: "Expo → Flutter for cross-platform development." },
        "zustand": { target: "cubit / bloc", notes: "Zustand stores → Cubit for state management." },
        "redux toolkit": { target: "bloc", notes: "Redux → BLoC pattern with streams." },
        zod: { target: "equatable / freezed", notes: "Schema validation → Equatable + Freezed." },
        axios: { target: "dio", notes: "HTTP client → Dio package." },
        "react context": { target: "provider / inherited_widget", notes: "Context → Provider/InheritedWidget." },
        tailwind: { target: "flutter/material", notes: "Utility CSS → Material Design widgets." },
        "shadcn/ui": { target: "flutter/material", notes: "Component library → Material/Cupertino widgets." },
        prisma: { target: "drift / floor", notes: "ORM → Drift (SQLite) or Floor." },
        "drizzle-orm": { target: "drift", notes: "Type-safe SQL → Drift for Dart." },
        "next.js": { target: "flutter web", notes: "Web framework → Flutter Web." },
      },
      python: {
        flutter: { target: "dash / streamlit / flet", notes: "Flet is the closest Flutter-like Python framework." },
        "flutter/material": { target: "nicegui / textual", notes: "Material → NiceGUI or Textual for rich UI." },
        bloc: { target: "dependency_injector + streams", notes: "Use DI + asyncio streams for BLoC pattern." },
        cubit: { target: "pydantic + asyncio", notes: "Pydantic models + async state management." },
        equatable: { target: "pydantic", notes: "Pydantic provides value equality + validation like Equatable." },
        freezed: { target: "pydantic + dataclasses", notes: "Pydantic dataclasses match Freezed's immutable data." },
        dio: { target: "httpx / aiohttp", notes: "httpx is the modern async HTTP client for Python." },
        provider: { target: "fastapi dependencies", notes: "FastAPI DI system ≈ Provider pattern." },
        get_it: { target: "dependency_injector", notes: "Service locator → Dependency Injector." },
        mockito: { target: "pytest-mock / unittest.mock", notes: "Standard Python mocking." },
        drift: { target: "sqlalchemy / sqlmodel", notes: "Drift → SQLAlchemy + SQLModel for type safety." },
        shelf: { target: "flask / fastapi", notes: "Shelf → Flask or FastAPI for HTTP servers." },
      },
      go: {
        flutter: { target: "fyne / gio", notes: "Fyne or Gio for cross-platform UI in Go." },
        bloc: { target: "go-kit + channels", notes: "Go-kit services + channels for BLoC-like streams." },
        dio: { target: "net/http + resty", notes: "Resty is a clean HTTP client for Go." },
        equatable: { target: "cmpopts / go-cmp", notes: "go-cmp for deep equality comparison." },
        shelf: { target: "gin / chi", notes: "Gin or Chi for HTTP servers in Go." },
        drift: { target: "gorm / ent", notes: "GORM or Ent for type-safe database access." },
        provider: { target: "wire", notes: "Google Wire for compile-time DI." },
        mockito: { target: "gomock / testify", notes: "Testify mock for Go testing." },
      },
      javascript: {
        flutter: { target: "react + react-native", notes: "React/React Native is the JS cross-platform equivalent." },
        "flutter/material": { target: "@mui/material / shadcn/ui", notes: "Material → MUI or shadcn/ui components." },
        bloc: { target: "redux / zustand", notes: "Redux or Zustand for state management." },
        cubit: { target: "zustand", notes: "Zustand stores are the closest JS equivalent to Cubits." },
        dio: { target: "axios / fetch", notes: "Axios or native fetch for HTTP." },
        equatable: { target: "lodash.isEqual / fast-deep-equal", notes: "Deep equality utilities." },
        drift: { target: "knex / drizzle-orm", notes: "Knex or Drizzle for type-safe SQL." },
        shelf: { target: "express", notes: "Express is the standard JS HTTP server." },
        provider: { target: "react context", notes: "React Context provides similar dependency injection." },
        mockito: { target: "jest mocks / sinon", notes: "Jest or Sinon for mocking." },
        freezed: { target: "immer + zod", notes: "Immer for immutability, Zod for validation." },
        get_it: { target: "tsyringe / awilix", notes: "Service locator → DI container." },
        go_router: { target: "react-router / next.js", notes: "GoRouter → React Router or Next.js routing." },
        riverpod: { target: "tanstack query / zustand", notes: "Riverpod → TanStack Query or Zustand." },
        hive: { target: "localforage / idb-keyval", notes: "Hive → localforage or IndexedDB." },
        shared_preferences: { target: "localStorage / zustand persist", notes: "SharedPreferences → localStorage." },
        flutter_secure_storage: { target: "node:crypto / keytar", notes: "Secure storage → crypto or keytar." },
        intl: { target: "date-fns / dayjs / Intl", notes: "intl → date-fns, dayjs, or native Intl API." },
        // Flutter widget → React/HTML mappings (from real ProxiCall call data)
        Text: { target: "<Text> / <p>", notes: "Flutter Text → React Native Text or HTML <p>." },
        Column: { target: "flexDirection: column", notes: "Flutter Column → flexbox column layout." },
        Row: { target: "flexDirection: row", notes: "Flutter Row → flexbox row layout." },
        Container: { target: "<View> / <div>", notes: "Container → View (RN) or div (web)." },
        Scaffold: { target: "SafeAreaView + NavigationContainer", notes: "Scaffold → navigation structure." },
        setState: { target: "useState / setState", notes: "setState → useState hook or store update." },
        MaterialApp: { target: "<NavigationContainer>", notes: "MaterialApp → React Navigation container." },
        emit: { target: "store.dispatch / emit", notes: "Bloc emit → Redux dispatch or event emitter." },
        Padding: { target: "padding style", notes: "Padding → CSS padding or RN style." },
        Expanded: { target: "flex: 1", notes: "Expanded → flex: 1 in flexbox." },
        Icon: { target: "<Icon> / lucide-react", notes: "Flutter Icon → React Native Icon or lucide-react." },
        Center: { target: "justifyContent/alignItems center", notes: "Center → flexbox centering." },
        BoxDecoration: { target: "borderRadius + boxShadow", notes: "BoxDecoration → CSS border/box-shadow." },
        SizedBox: { target: "width/height style", notes: "SizedBox → fixed dimensions in CSS/RN." },
        Card: { target: "<Card> / <Paper>", notes: "Flutter Card → MUI Card or Paper component." },
        ListView: { target: "<FlatList> / overflow-y", notes: "ListView → FlatList (RN) or scrollable div." },
        GestureDetector: { target: "onClick / onPress", notes: "GestureDetector → click/touch handlers." },
        CircularProgressIndicator: { target: "<ActivityIndicator> / spinner", notes: "Progress → ActivityIndicator or CSS spinner." },
      },
    },
    python: {
      typescript: {
        fastapi: { target: "nestjs / express", notes: "NestJS for similar decorator-driven DI, Express for minimal." },
        flask: { target: "express", notes: "Express is the closest minimal equivalent." },
        sqlalchemy: { target: "drizzle-orm / prisma", notes: "Drizzle provides excellent type safety." },
        requests: { target: "axios / fetch", notes: "Native fetch is recommended in modern TS." },
        pytest: { target: "jest / vitest", notes: "Vitest for fast, native TS execution." },
      },
      dart: {
        fastapi: { target: "shelf + shelf_router", notes: "Shelf with routers for FastAPI-like patterns." },
        flask: { target: "shelf", notes: "Shelf is the minimal Dart HTTP server." },
        sqlalchemy: { target: "drift / floor", notes: "Drift is the type-safe SQLite ORM for Dart." },
        requests: { target: "dio / http", notes: "Dio is the standard Dart HTTP client." },
        pytest: { target: "test / flutter_test", notes: "Dart's built-in test package." },
        pydantic: { target: "equatable / freezed", notes: "Equatable for value equality, Freezed for data classes." },
        celery: { target: "flutter_isolate / workmanager", notes: "Background task processing in Dart." },
        django: { target: "serverpod / shelf + ORM", notes: "Serverpod is a modern full-stack Dart server framework." },
        numpy: { target: "ml_linalg / scidart", notes: "SciDart for numerical computing in Dart." },
        pandas: { target: "dataframe / quiver", notes: "Quiver data structures for data manipulation." },
      },
      go: {
        fastapi: { target: "gin / fiber", notes: "Gin with middleware for FastAPI-like patterns." },
        flask: { target: "gin / echo", notes: "Gin or Echo for minimal HTTP servers." },
        sqlalchemy: { target: "gorm / ent", notes: "GORM is the standard Go ORM." },
        requests: { target: "net/http + resty", notes: "Resty wraps net/http with a clean API." },
        pytest: { target: "testing + testify", notes: "Go's built-in testing with testify assertions." },
        pydantic: { target: "go-playground/validator", notes: "Struct tag validation in Go." },
        django: { target: "beego / buffalo", notes: "Beego or Buffalo for full-stack Go web." },
        numpy: { target: "gonum", notes: "Gonum for numerical computing in Go." },
        pandas: { target: "gota / dataframe", notes: "Gota provides DataFrame operations in Go." },
      },
      javascript: {
        fastapi: { target: "express + joi", notes: "Express with Joi validation for FastAPI-like patterns." },
        flask: { target: "express", notes: "Express is the standard JS minimal server." },
        sqlalchemy: { target: "knex / sequelize", notes: "Knex or Sequelize for database ORM." },
        requests: { target: "axios / node-fetch", notes: "Axios for HTTP requests." },
        pytest: { target: "jest / mocha", notes: "Jest is the standard JS testing framework." },
        pydantic: { target: "joi / yup", notes: "Joi or Yup for schema validation." },
        django: { target: "nestjs / adonis", notes: "NestJS or Adonis for full-stack JS frameworks." },
        numpy: { target: "math.js / ndarray", notes: "math.js for numerical computing." },
        pandas: { target: "danfo.js / arquero", notes: "Danfo.js provides DataFrame operations." },
      },
    },
    go: {
      typescript: {
        gin: { target: "express / fastify", notes: "Express or Fastify for HTTP servers." },
        echo: { target: "express", notes: "Echo → Express for minimal routing." },
        gorm: { target: "drizzle-orm / prisma", notes: "Drizzle for type-safe database access." },
        "net/http": { target: "express / hono", notes: "Standard lib → Express or Hono." },
        "testing": { target: "jest / vitest", notes: "Go testing → Jest or Vitest." },
        testify: { target: "jest + chai", notes: "Testify → Jest with Chai assertions." },
        ent: { target: "prisma", notes: "Ent → Prisma for code-first ORM." },
        wire: { target: "tsyringe / inversify", notes: "Wire → Tsyringe for compile-time DI." },
        fyne: { target: "react + electron", notes: "Fyne → Electron + React for desktop." },
        gonum: { target: "math.js / tensorflow.js", notes: "Gonum → math.js for numeric computing." },
      },
      python: {
        gin: { target: "fastapi / flask", notes: "Gin → FastAPI for similar performance." },
        gorm: { target: "sqlalchemy / sqlmodel", notes: "GORM → SQLAlchemy 2.0." },
        "net/http": { target: "requests / httpx", notes: "Standard lib → httpx." },
        testify: { target: "pytest", notes: "Testify → pytest." },
        wire: { target: "dependency_injector", notes: "Wire → Dependency Injector." },
        fyne: { target: "flet / tkinter", notes: "Fyne → Flet for cross-platform UI." },
        gonum: { target: "numpy / scipy", notes: "Gonum → NumPy for numeric computing." },
        ent: { target: "sqlalchemy", notes: "Ent → SQLAlchemy for code-first ORM." },
      },
      dart: {
        gin: { target: "shelf", notes: "Gin → Shelf for HTTP servers in Dart." },
        gorm: { target: "drift / floor", notes: "GORM → Drift for type-safe SQLite." },
        "net/http": { target: "dio / http", notes: "Standard lib → Dio HTTP client." },
        testify: { target: "test / flutter_test", notes: "Testify → Dart test package." },
        wire: { target: "get_it / injectable", notes: "Wire → get_it with injectable." },
        fyne: { target: "flutter", notes: "Fyne → Flutter for cross-platform UI." },
        gonum: { target: "scidart / ml_linalg", notes: "Gonum → SciDart for numeric computing." },
        ent: { target: "drift", notes: "Ent → Drift for code-first database." },
      },
      javascript: {
        gin: { target: "express / fastify", notes: "Gin → Express or Fastify." },
        gorm: { target: "knex / sequelize", notes: "GORM → Knex or Sequelize." },
        "net/http": { target: "express / node:http", notes: "Standard lib → Express or native http." },
        testify: { target: "jest / mocha", notes: "Testify → Jest." },
        wire: { target: "tsyringe / awilix", notes: "Wire → Awilix or Tsyringe." },
        fyne: { target: "electron + react", notes: "Fyne → Electron for desktop apps." },
        gonum: { target: "math.js / ml.js", notes: "Gonum → math.js." },
        ent: { target: "prisma / objection", notes: "Ent → Prisma or Objection.js." },
      },
    },
    javascript: {
      typescript: {
        express: { target: "express + @types/express", notes: "Add type definitions for Express middleware." },
        lodash: { target: "lodash + @types/lodash / native", notes: "Add types or use native Array methods." },
        moment: { target: "date-fns / luxon", notes: "Modern date libraries with native TS support." },
        axios: { target: "axios / native fetch", notes: "Axios has TS types; native fetch is built-in." },
        jest: { target: "jest / vitest", notes: "Jest works with ts-jest; Vitest is faster for ESM." },
        dotenv: { target: "dotenv", notes: "Use dotenv with process.env typing." },
        cors: { target: "cors + @types/cors", notes: "Add type definitions for CORS middleware." },
        firebase: { target: "firebase-admin", notes: "Firebase Admin SDK has full TS support." },
        uuid: { target: "uuid + @types/uuid / crypto.randomUUID", notes: "Native crypto.randomUUID() in modern TS." },
        stripe: { target: "stripe + @types/stripe", notes: "Stripe SDK has full TS types." },
      },
      dart: {
        firebase: { target: "firebase_dart / cloud_firestore", notes: "Firebase has first-class Dart/Flutter SDKs." },
        stripe: { target: "flutter_stripe / stripe_sdk", notes: "Stripe has official Flutter/Dart packages." },
        axios: { target: "dio / http", notes: "Dio is the most popular Dart HTTP client." },
        lodash: { target: "collection / quiver", notes: "Use dart:collection or Quiver for utility functions." },
        moment: { target: "intl / jiffy", notes: "Jiffy is a Dart date library inspired by Moment.js." },
        jest: { target: "flutter_test / test", notes: "Use Flutter's test framework or the test package." },
        dotenv: { target: "flutter_dotenv", notes: "flutter_dotenv loads .env files in Dart/Flutter." },
        cors: { target: "shelf_cors", notes: "shelf_cors middleware for Dart Shelf servers." },
        uuid: { target: "uuid / crypto", notes: "Use the uuid package or dart:math Random." },
        bcrypt: { target: "bcrypt / crypto", notes: "Use bcrypt package or dart:convert for hashing." },
        jsonwebtoken: { target: "dart_jsonwebtoken / jose", notes: "JOSE package for JWT in Dart." },
        // Node.js/Express → Dart Shelf/Serverpod mappings (from real ProxiCall JS call data)
        request: { target: "dio.get / shelf.Request", notes: "supertest request → Dio or Shelf Request." },
        "pool.query": { target: "drift / postgres", notes: "pg Pool → Drift (SQLite) or postgres package." },
        "jest.fn": { target: "Mockito / mocktail", notes: "Jest mocks → Mockito or mocktail." },
        "logger.error": { target: "logging / logger", notes: "Winston/console → Dart logging package." },
        "res.status().json": { target: "shelf.Response.ok()", notes: "Express response → Shelf Response." },
        "JSON.stringify": { target: "jsonEncode", notes: "JSON.stringify → dart:convert jsonEncode." },
        "Date.now": { target: "DateTime.now()", notes: "Date.now → DateTime.now()." },
        passport: { target: "firebase_auth / supabase_auth", notes: "Passport → Firebase Auth or Supabase Auth." },
        multer: { target: "shelf_multipart / file_picker", notes: "Multer → shelf_multipart or file_picker." },
        "socket.io": { target: "web_socket_channel", notes: "Socket.io → web_socket_channel." },
        bull: { target: "flutter_isolate / workmanager", notes: "Bull → background isolates." },
        winston: { target: "logging", notes: "Winston → Dart logging." },
        helmet: { target: "shelf_security", notes: "Helmet → shelf_security headers." },
        nodemailer: { target: "mailer / flutter_email_sender", notes: "Nodemailer → mailer package." },
        express: { target: "shelf + shelf_router", notes: "Full Express → Shelf + shelf_router + middleware." },
      },
      python: {
        express: { target: "fastapi / flask", notes: "FastAPI for async, Flask for minimal HTTP servers." },
        axios: { target: "requests / httpx", notes: "Requests for sync, httpx for async HTTP." },
        lodash: { target: "builtins / toolz", notes: "Python's itertools + toolz for functional utilities." },
        moment: { target: "arrow / pendulum", notes: "Arrow or Pendulum for date handling." },
        jest: { target: "pytest + pytest-mock", notes: "Pytest with mock for testing." },
        dotenv: { target: "python-dotenv", notes: "python-dotenv loads .env files." },
        firebase: { target: "firebase-admin-python", notes: "Firebase Admin SDK for Python." },
        stripe: { target: "stripe-python", notes: "Official Stripe Python SDK." },
        uuid: { target: "uuid / secrets", notes: "uuid module or secrets.token_hex()." },
        bcrypt: { target: "bcrypt / passlib", notes: "Passlib for password hashing." },
        jsonwebtoken: { target: "pyjwt / authlib", notes: "PyJWT or Authlib for JWT." },
        cors: { target: "flask-cors / fastapi middleware", notes: "Built-in CORS middleware in FastAPI/Flask." },
      },
      go: {
        express: { target: "gin / echo", notes: "Gin or Echo for HTTP servers." },
        axios: { target: "net/http + resty", notes: "Resty wraps net/http with a clean API." },
        lodash: { target: "samber/lo / thx", notes: "lo is a Lodash-style Go utility library." },
        moment: { target: "now / carbon", notes: "Carbon for date/time in Go." },
        jest: { target: "testing + testify", notes: "Go's built-in testing with testify." },
        dotenv: { target: "godotenv / viper", notes: "godotenv or Viper for env config." },
        firebase: { target: "firebase-admin-go", notes: "Firebase Admin SDK for Go." },
        stripe: { target: "stripe-go", notes: "Official Stripe Go SDK." },
        uuid: { target: "google/uuid", notes: "Google's UUID package for Go." },
        bcrypt: { target: "golang.org/x/crypto/bcrypt", notes: "Standard bcrypt in x/crypto." },
        jsonwebtoken: { target: "golang-jwt/jwt", notes: "JWT package for Go." },
        cors: { target: "gin-cors / rs/cors", notes: "CORS middleware for Go." },
      },
    },
    kotlin: {
      typescript: {
        ktor: { target: "express / fastify", notes: "Ktor → Express or Fastify for HTTP servers." },
        "android jetpack": { target: "react-native / expo", notes: "Jetpack → React Native for cross-platform." },
        room: { target: "drizzle-orm / prisma", notes: "Room DB → Drizzle or Prisma." },
        coroutines: { target: "async/await + rxjs", notes: "Coroutines → native async/await + RxJS." },
        retrofit: { target: "axios / fetch", notes: "Retrofit → Axios or native fetch." },
        dagger: { target: "tsyringe / inversify", notes: "Dagger → Tsyringe for DI." },
        compose: { target: "react + tailwind", notes: "Jetpack Compose → React + Tailwind CSS." },
        mockk: { target: "jest mocks / sinon", notes: "MockK → Jest mocks." },
      },
      python: { ktor: { target: "fastapi", notes: "Ktor → FastAPI." }, compose: { target: "flet", notes: "Flet for cross-platform." } },
      dart: { ktor: { target: "shelf", notes: "Ktor → Shelf." }, compose: { target: "flutter", notes: "Compose → Flutter." }, room: { target: "drift", notes: "Room → Drift." } },
      go: { ktor: { target: "gin", notes: "Ktor → Gin." }, coroutines: { target: "goroutines", notes: "Coroutines → goroutines." } },
      javascript: { ktor: { target: "express", notes: "Ktor → Express." } },
      swift: { compose: { target: "swiftui", notes: "Compose → SwiftUI." }, ktor: { target: "vapor", notes: "Ktor → Vapor." }, room: { target: "coredata", notes: "Room → CoreData." }, coroutines: { target: "swift concurrency", notes: "Coroutines → async/await." } },
      java: { ktor: { target: "spring boot", notes: "Ktor → Spring Boot." }, compose: { target: "javafx", notes: "Compose → JavaFX." } },
      rust: { ktor: { target: "actix", notes: "Ktor → Actix." } },
    },
    swift: {
      typescript: {
        vapor: { target: "express / fastify", notes: "Vapor → Express or Fastify." },
        swiftui: { target: "react + tailwind", notes: "SwiftUI → React + Tailwind." },
        coredata: { target: "drizzle-orm / prisma", notes: "CoreData → type-safe ORM." },
        combine: { target: "rxjs / signals", notes: "Combine → RxJS or Preact signals." },
        alamofire: { target: "axios / fetch", notes: "Alamofire → Axios or fetch." },
        swiftlint: { target: "eslint + prettier", notes: "SwiftLint → ESLint + Prettier." },
      },
      python: { swiftui: { target: "flet", notes: "Flet." }, vapor: { target: "fastapi", notes: "Vapor → FastAPI." } },
      dart: { swiftui: { target: "flutter", notes: "SwiftUI → Flutter." }, vapor: { target: "shelf", notes: "Vapor → Shelf." } },
      go: { vapor: { target: "gin", notes: "Vapor → Gin." } },
      javascript: { vapor: { target: "express", notes: "Vapor → Express." } },
      kotlin: { swiftui: { target: "compose", notes: "SwiftUI → Compose." } },
    },
    rust: {
      typescript: {
        actix: { target: "express / fastify", notes: "Actix → Express or Fastify." },
        diesel: { target: "drizzle-orm / prisma", notes: "Diesel → Drizzle or Prisma." },
        tokio: { target: "async/await + rxjs", notes: "Tokio → native async + RxJS." },
        serde: { target: "zod + class-transformer", notes: "Serde → Zod + class-transformer." },
        reqwest: { target: "axios / fetch", notes: "Reqwest → Axios or fetch." },
        clap: { target: "commander / yargs", notes: "Clap → Commander or Yargs." },
        yew: { target: "react + tailwind", notes: "Yew → React + Tailwind." },
      },
      python: { actix: { target: "fastapi", notes: "Actix → FastAPI." }, diesel: { target: "sqlalchemy", notes: "Diesel → SQLAlchemy." } },
      dart: { actix: { target: "shelf", notes: "Actix → Shelf." }, yew: { target: "flutter", notes: "Yew → Flutter." } },
      go: { actix: { target: "gin", notes: "Actix → Gin." } },
      javascript: { actix: { target: "express", notes: "Actix → Express." } },
    },
    ruby: {
      typescript: {
        rails: { target: "nestjs / next.js", notes: "Rails → NestJS for API, Next.js for full-stack." },
        rspec: { target: "jest / vitest", notes: "RSpec → Jest or Vitest." },
        devise: { target: "next-auth / clerk", notes: "Devise → NextAuth or Clerk." },
        sidekiq: { target: "bullmq / temporal", notes: "Sidekiq → BullMQ or Temporal." },
        activerecord: { target: "drizzle-orm / prisma", notes: "ActiveRecord → Drizzle or Prisma." },
        puma: { target: "express / fastify", notes: "Puma → Express or Fastify." },
      },
      python: { rails: { target: "django / fastapi", notes: "Rails → Django or FastAPI." } },
      dart: { rails: { target: "serverpod / shelf", notes: "Rails → Serverpod or Shelf + ORM." } },
      go: { rails: { target: "beego / buffalo", notes: "Rails → Beego." } },
      javascript: { rails: { target: "nestjs / adonis", notes: "Rails → NestJS or Adonis." } },
    },
    csharp: {
      typescript: {
        "asp.net": { target: "nestjs / express", notes: "ASP.NET → NestJS or Express." },
        "entity framework": { target: "drizzle-orm / prisma", notes: "EF Core → Drizzle or Prisma." },
        linq: { target: "lodash / rxjs operators", notes: "LINQ → Lodash chains or RxJS operators." },
        xunit: { target: "jest / vitest", notes: "xUnit → Jest or Vitest." },
        blazor: { target: "next.js + react", notes: "Blazor → Next.js + React." },
        mediatr: { target: "nestjs cqrs / ts-pattern", notes: "MediatR → NestJS CQRS." },
      },
      python: { "asp.net": { target: "fastapi", notes: "ASP.NET → FastAPI." } },
      dart: { "asp.net": { target: "shelf", notes: "ASP.NET → Shelf." }, blazor: { target: "flutter", notes: "Blazor → Flutter." } },
      go: { "asp.net": { target: "gin", notes: "ASP.NET → Gin." } },
      javascript: { "asp.net": { target: "express", notes: "ASP.NET → Express." } },
    },
    php: {
      typescript: {
        laravel: { target: "nestjs / adonis", notes: "Laravel → NestJS or AdonisJS." },
        symfony: { target: "nestjs / express", notes: "Symfony → NestJS or Express." },
        eloquent: { target: "drizzle-orm / prisma", notes: "Eloquent → Drizzle or Prisma." },
        phpunit: { target: "jest / vitest", notes: "PHPUnit → Jest or Vitest." },
        composer: { target: "npm / yarn / pnpm", notes: "Composer → npm/yarn/pnpm." },
        artisan: { target: "nestjs cli / nx", notes: "Artisan → NestJS CLI or Nx." },
      },
      python: { laravel: { target: "django", notes: "Laravel → Django." } },
      dart: { laravel: { target: "serverpod / shelf", notes: "Laravel → Serverpod or Shelf." } },
      go: { laravel: { target: "beego", notes: "Laravel → Beego." } },
      javascript: { laravel: { target: "adonis / nestjs", notes: "Laravel → AdonisJS." } },
    },
    java: {
      typescript: {
        spring: { target: "nestjs", notes: "Spring Boot → NestJS with decorators." },
        hibernate: { target: "drizzle-orm / prisma", notes: "Hibernate → Drizzle or Prisma." },
        maven: { target: "npm / yarn", notes: "Maven → npm/yarn." },
        junit: { target: "jest / vitest", notes: "JUnit → Jest or Vitest." },
        jackson: { target: "zod + class-transformer", notes: "Jackson → Zod serialization." },
        lombok: { target: "typescript decorators", notes: "Lombok → TS decorators + compiler options." },
        javafx: { target: "electron + react", notes: "JavaFX → Electron + React." },
        rxjava: { target: "rxjs", notes: "RxJava → RxJS." },
      },
      kotlin: { spring: { target: "spring boot + kotlin", notes: "Native Kotlin Spring." } },
      dart: { spring: { target: "serverpod / shelf", notes: "Spring → Serverpod or Shelf." } },
      python: { spring: { target: "django / fastapi", notes: "Spring → Django or FastAPI." } },
      go: { spring: { target: "go-kit / beego", notes: "Spring → Go-kit." } },
    },
    scala: {
      typescript: {
        akka: { target: "nestjs + rxjs", notes: "Akka → NestJS + RxJS for actor model." },
        play: { target: "express / fastify", notes: "Play Framework → Express or Fastify." },
        slick: { target: "drizzle-orm", notes: "Slick → Drizzle for type-safe DB." },
        scalatest: { target: "jest", notes: "ScalaTest → Jest." },
        cats: { target: "fp-ts / effect", notes: "Cats → fp-ts or Effect-TS." },
        zio: { target: "effect", notes: "ZIO → Effect-TS." },
      },
      java: { akka: { target: "spring + reactor", notes: "Akka → Spring WebFlux." } },
      kotlin: { akka: { target: "ktor + coroutines", notes: "Akka → Ktor + coroutines." } },
      dart: { play: { target: "shelf", notes: "Play → Shelf." } },
    },
    elixir: {
      typescript: {
        phoenix: { target: "nestjs + socket.io", notes: "Phoenix → NestJS + WebSockets." },
        ecto: { target: "drizzle-orm", notes: "Ecto → Drizzle for type-safe queries." },
        exunit: { target: "jest", notes: "ExUnit → Jest." },
        plug: { target: "express middleware", notes: "Plug → Express middleware." },
        absinthe: { target: "apollo-server / graphql-yoga", notes: "Absinthe → Apollo Server." },
      },
      dart: { phoenix: { target: "shelf + web_socket_channel", notes: "Phoenix → Shelf + WebSockets." } },
      go: { phoenix: { target: "gin + gorilla", notes: "Phoenix → Gin + Gorilla WebSocket." } },
      python: { phoenix: { target: "fastapi + websockets", notes: "Phoenix → FastAPI + websockets." } },
    },
    haskell: {
      typescript: {
        yesod: { target: "express + zod", notes: "Yesod → Express + Zod for type safety." },
        persistent: { target: "drizzle-orm", notes: "Persistent → Drizzle." },
        hspec: { target: "jest", notes: "HSpec → Jest." },
        warp: { target: "express / fastify", notes: "Warp → Express or Fastify." },
        lens: { target: "immer / optics-ts", notes: "Lens → Immer or optics-ts." },
      },
      scala: { yesod: { target: "http4s", notes: "Yesod → http4s." } },
      rust: { warp: { target: "actix / warp", notes: "Warp → Actix or Rust warp." } },
    },
    clojure: {
      typescript: {
        ring: { target: "express", notes: "Ring → Express middleware." },
        pedestal: { target: "nestjs", notes: "Pedestal → NestJS." },
        "core.async": { target: "rxjs", notes: "core.async → RxJS." },
        spec: { target: "zod", notes: "clojure.spec → Zod." },
        reagent: { target: "react", notes: "Reagent → React." },
      },
      dart: { ring: { target: "shelf", notes: "Ring → Shelf." } },
    },
    erlang: {
      typescript: {
        cowboy: { target: "express / fastify", notes: "Cowboy → Express or Fastify." },
        otp: { target: "nestjs microservices", notes: "OTP → NestJS microservices." },
        eunit: { target: "jest", notes: "EUnit → Jest." },
        rebar3: { target: "npm / yarn", notes: "Rebar3 → npm." },
      },
      elixir: { cowboy: { target: "phoenix", notes: "Cowboy → Phoenix." } },
      go: { otp: { target: "go-kit + goroutines", notes: "OTP → Go-kit + goroutines." } },
    },
    groovy: {
      typescript: {
        grails: { target: "nestjs", notes: "Grails → NestJS." },
        spock: { target: "jest", notes: "Spock → Jest." },
        gradle: { target: "npm / yarn", notes: "Gradle → npm." },
      },
      java: { grails: { target: "spring boot", notes: "Grails → Spring Boot." } },
      kotlin: { grails: { target: "ktor", notes: "Grails → Ktor." } },
    },
    lua: {
      typescript: {
        luvit: { target: "node.js", notes: "Luvit → Node.js." },
        busted: { target: "jest", notes: "Busted → Jest." },
        luasocket: { target: "net / ws", notes: "LuaSocket → Node net/ws." },
        torch: { target: "tensorflow.js", notes: "Torch → TensorFlow.js." },
      },
      python: { torch: { target: "pytorch", notes: "Torch → PyTorch." } },
    },
    perl: {
      typescript: {
        mojolicious: { target: "express", notes: "Mojolicious → Express." },
        dancer: { target: "express", notes: "Dancer → Express." },
        dbix: { target: "drizzle-orm", notes: "DBIx → Drizzle." },
        testmore: { target: "jest", notes: "Test::More → Jest." },
        cpan: { target: "npm", notes: "CPAN → npm." },
      },
      python: { mojolicious: { target: "flask", notes: "Mojolicious → Flask." } },
    },
    r: {
      typescript: {
        shiny: { target: "next.js + react", notes: "Shiny → Next.js + React." },
        ggplot2: { target: "d3.js / observable plot", notes: "ggplot2 → D3.js or Observable Plot." },
        dplyr: { target: "arquero / danfo.js", notes: "dplyr → Arquero or Danfo.js." },
        caret: { target: "tensorflow.js / ml.js", notes: "caret → TensorFlow.js." },
        plumber: { target: "express", notes: "Plumber → Express." },
      },
      python: { tidyverse: { target: "pandas + plotly", notes: "Tidyverse → Pandas + Plotly." } },
    },
    zig: {
      typescript: {
        zap: { target: "express / fastify", notes: "Zap → Express or Fastify." },
        "std.http": { target: "express", notes: "std.http → Express." },
        zigtest: { target: "jest", notes: "Zig test → Jest." },
      },
      c: { zap: { target: "libuv + http-parser", notes: "Zap → libuv + http-parser." } },
      rust: { zig: { target: "rust", notes: "Zig → Rust for similar systems focus." } },
    },
    c: {
      typescript: {
        libuv: { target: "node.js native addon", notes: "libuv → Node.js native modules." },
        openssl: { target: "node:crypto", notes: "OpenSSL → Node crypto module." },
        "pthread": { target: "worker_threads", notes: "pthreads → Worker Threads." },
        cmake: { target: "tsup / esbuild", notes: "CMake → tsup/esbuild for builds." },
        gtk: { target: "electron + react", notes: "GTK → Electron + React." },
      },
      cpp: { gtk: { target: "qt / gtkmm", notes: "GTK → Qt or gtkmm." } },
      rust: { gtk: { target: "gtk-rs", notes: "GTK → gtk-rs." } },
    },
    cpp: {
      typescript: {
        qt: { target: "electron + react", notes: "Qt → Electron + React." },
        boost: { target: "lodash + rxjs", notes: "Boost → Lodash + RxJS." },
        catch2: { target: "jest", notes: "Catch2 → Jest." },
        cmake: { target: "tsup / nx", notes: "CMake → tsup/Nx for builds." },
        grpc: { target: "grpc-js", notes: "gRPC → @grpc/grpc-js." },
        protobuf: { target: "protobuf-ts", notes: "Protobuf → protobuf-ts." },
      },
      c: { qt: { target: "gtk", notes: "Qt → GTK." } },
      rust: { qt: { target: "tauri + gtk-rs", notes: "Qt → Tauri or gtk-rs." } },
    },
    fsharp: {
      typescript: {
        giraffe: { target: "express", notes: "Giraffe → Express." },
        saturn: { target: "nestjs", notes: "Saturn → NestJS." },
        "type providers": { target: "zod + codegen", notes: "Type Providers → Zod + code generation." },
        expecto: { target: "jest", notes: "Expecto → Jest." },
        fable: { target: "typescript", notes: "Fable compiles F# to JS — can stay in same ecosystem." },
      },
      csharp: { giraffe: { target: "asp.net", notes: "Giraffe → ASP.NET." } },
    },
    objectivec: {
      typescript: {
        cocoa: { target: "electron + react", notes: "Cocoa → Electron + React." },
        coredata: { target: "prisma / drizzle", notes: "CoreData → Prisma." },
        afnetworking: { target: "axios", notes: "AFNetworking → Axios." },
        xctest: { target: "jest", notes: "XCTest → Jest." },
      },
      swift: { cocoa: { target: "swiftui", notes: "Cocoa → SwiftUI." } },
      cpp: { cocoa: { target: "qt", notes: "Cocoa → Qt." } },
    },
    bash: {
      typescript: {
        awk: { target: "lodash / streams", notes: "awk → Lodash chains or Node streams." },
        sed: { target: "replace-in-file / regex", notes: "sed → String.replace or replace-in-file." },
        grep: { target: "grep-url / ripgrep npm", notes: "grep → ripgrep npm package." },
        curl: { target: "axios / node-fetch", notes: "curl → Axios or fetch." },
        jq: { target: "zod + JSON.parse", notes: "jq → Zod + JSON.parse for JSON processing." },
      },
      python: { awk: { target: "pandas", notes: "awk → Pandas for data processing." } },
    },
    powershell: {
      typescript: {
        "invoke-webrequest": { target: "axios / fetch", notes: "Invoke-WebRequest → Axios." },
        "export-csv": { target: "papaparse / json2csv", notes: "Export-CSV → PapaParse." },
        pester: { target: "jest", notes: "Pester → Jest." },
        psreadline: { target: "readline / inquirer", notes: "PSReadLine → Readline or Inquirer." },
      },
      bash: { "invoke-webrequest": { target: "curl", notes: "Invoke-WebRequest → curl." } },
    },
    svelte: {
      typescript: {
        svelte: { target: "react + zustand", notes: "Svelte stores → Zustand." },
        sveltekit: { target: "next.js", notes: "SvelteKit → Next.js." },
        "svelte motion": { target: "framer-motion", notes: "Svelte Motion → Framer Motion." },
      },
      vue: { svelte: { target: "vue + pinia", notes: "Svelte → Vue + Pinia." } },
    },
    vue: {
      typescript: {
        vue: { target: "react", notes: "Vue → React." },
        pinia: { target: "zustand", notes: "Pinia → Zustand." },
        nuxt: { target: "next.js", notes: "Nuxt → Next.js." },
        vuetify: { target: "mui / shadcn/ui", notes: "Vuetify → MUI or shadcn/ui." },
      },
      svelte: { vue: { target: "svelte", notes: "Vue → Svelte." } },
    },
  }

  // Direct migration paths supplement rather than replace the base language maps.
  const DIRECT_POLYGLOT_LIBRARY_DICTIONARY: Record<
    string,
    Record<string, Record<string, { target: string; notes?: string }>>
  > = {
    swift: {
      kotlin: { swiftui: { target: "compose", notes: "SwiftUI → Compose." }, vapor: { target: "ktor", notes: "Vapor → Ktor." }, coredata: { target: "room", notes: "CoreData → Room." }, combine: { target: "coroutines flow", notes: "Combine → Kotlin Flow." } },
      go: { vapor: { target: "gin", notes: "Vapor → Gin." } },
      rust: { vapor: { target: "actix", notes: "Vapor → Actix." } },
    },
    go: {
      rust: { gin: { target: "actix", notes: "Gin → Actix." }, gorm: { target: "diesel / sqlx", notes: "GORM → Diesel or SQLx." }, goroutines: { target: "tokio tasks", notes: "goroutines → Tokio tasks." }, "net/http": { target: "actix / warp", notes: "net/http → Actix or Warp." } },
      java: { gin: { target: "spring boot", notes: "Gin → Spring Boot." } },
      elixir: { gin: { target: "phoenix", notes: "Gin → Phoenix." }, goroutines: { target: "otp processes", notes: "Goroutines → OTP processes." } },
      swift: { gin: { target: "vapor", notes: "Gin → Vapor." } },
    },
    rust: {
      go: { actix: { target: "gin", notes: "Actix → Gin." }, diesel: { target: "gorm", notes: "Diesel → GORM." }, tokio: { target: "goroutines", notes: "Tokio → goroutines." } },
      cpp: { actix: { target: "boost.asio + beast", notes: "Actix → Boost.ASIO + Beast." }, cargo: { target: "cmake + conan", notes: "Cargo → CMake + Conan." } },
      java: { actix: { target: "spring webflux", notes: "Actix → Spring WebFlux." } },
    },
    ruby: {
      python: { rails: { target: "django", notes: "Rails → Django." }, rspec: { target: "pytest", notes: "RSpec → pytest." }, activerecord: { target: "sqlalchemy", notes: "ActiveRecord → SQLAlchemy." }, sidekiq: { target: "celery", notes: "Sidekiq → Celery." }, devise: { target: "django-allauth", notes: "Devise → django-allauth." } },
      go: { rails: { target: "beego / buffalo", notes: "Rails → Beego or Buffalo." } },
      elixir: { rails: { target: "phoenix", notes: "Rails → Phoenix." } },
    },
    php: {
      java: { laravel: { target: "spring boot", notes: "Laravel → Spring Boot." }, symfony: { target: "spring", notes: "Symfony → Spring." }, eloquent: { target: "hibernate / jpa", notes: "Eloquent → Hibernate/JPA." }, composer: { target: "maven / gradle", notes: "Composer → Maven/Gradle." } },
      go: { laravel: { target: "beego", notes: "Laravel → Beego." } },
      python: { laravel: { target: "django", notes: "Laravel → Django." } },
    },
    cpp: {
      rust: { qt: { target: "tauri + egui", notes: "Qt → Tauri or egui." }, boost: { target: "tokio + serde", notes: "Boost → Tokio + Serde." }, cmake: { target: "cargo", notes: "CMake → Cargo." }, catch2: { target: "cargo test", notes: "Catch2 → cargo test." } },
      go: { qt: { target: "fyne", notes: "Qt → Fyne." } },
      java: { qt: { target: "javafx", notes: "Qt → JavaFX." } },
      c: { cpp: { target: "c", notes: "C++ → C; remove classes, use structs + function pointers." } },
    },
    c: {
      rust: { gtk: { target: "gtk-rs", notes: "GTK → gtk-rs." }, makefile: { target: "cargo", notes: "Make → Cargo." }, libuv: { target: "tokio", notes: "libuv → Tokio." } },
      go: { libuv: { target: "goroutines + net", notes: "libuv → goroutines + net." } },
      zig: { gtk: { target: "zig-gtk / capy", notes: "GTK → Zig GTK bindings or Capy." }, makefile: { target: "zig build", notes: "Make → zig build." } },
    },
    java: {
      kotlin: { spring: { target: "spring boot + kotlin", notes: "Spring → Kotlin Spring." }, hibernate: { target: "exposed / ktorm", notes: "Hibernate → Exposed or KtORM." }, maven: { target: "gradle.kts", notes: "Maven → Gradle Kotlin DSL." }, javafx: { target: "compose desktop", notes: "JavaFX → Compose Desktop." } },
      scala: { spring: { target: "play / akka", notes: "Spring → Play or Akka." } },
      go: { spring: { target: "go-kit", notes: "Spring → Go-kit." } },
      csharp: { spring: { target: "asp.net", notes: "Spring → ASP.NET." } },
    },
    scala: {
      kotlin: { akka: { target: "ktor + coroutines", notes: "Akka → Ktor + coroutines." }, cats: { target: "arrow-kt", notes: "Cats → Arrow-kt." }, zio: { target: "kotlinx.coroutines", notes: "ZIO → kotlinx.coroutines." }, play: { target: "ktor", notes: "Play → Ktor." } },
      java: { akka: { target: "spring webflux", notes: "Akka → Spring WebFlux." } },
      haskell: { cats: { target: "cats", notes: "Scala Cats → Haskell base/foundation." }, zio: { target: "effectful / polysemy", notes: "ZIO → effectful." } },
    },
    haskell: {
      rust: { warp: { target: "warp / actix", notes: "Warp → Rust warp or Actix." }, persistent: { target: "diesel / sqlx", notes: "Persistent → Diesel." }, hspec: { target: "cargo test", notes: "HSpec → cargo test." }, lens: { target: "serde + derive", notes: "Lens → Serde derives." } },
      scala: { yesod: { target: "http4s", notes: "Yesod → http4s." } },
      elixir: { yesod: { target: "phoenix", notes: "Yesod → Phoenix." } },
    },
    elixir: {
      go: { phoenix: { target: "gin + channels", notes: "Phoenix → Gin + Go channels." }, ecto: { target: "gorm", notes: "Ecto → GORM." }, otp: { target: "go-kit + goroutines", notes: "OTP → Go-kit + goroutines." } },
      rust: { phoenix: { target: "actix + tokio", notes: "Phoenix → Actix + Tokio." } },
      ruby: { phoenix: { target: "rails + actioncable", notes: "Phoenix → Rails + ActionCable." } },
    },
    zig: {
      c: { zig: { target: "c", notes: "Zig → C (zig cc produces C-compatible output)." }, "std.http": { target: "libuv + http-parser", notes: "std.http → libuv." } },
      rust: { zig: { target: "rust", notes: "Zig → Rust for stronger safety guarantees." } },
    },
    r: {
      python: { tidyverse: { target: "pandas + plotly", notes: "Tidyverse → Pandas + Plotly." }, shiny: { target: "dash / streamlit", notes: "Shiny → Dash or Streamlit." }, caret: { target: "scikit-learn", notes: "caret → scikit-learn." }, ggplot2: { target: "plotly / seaborn", notes: "ggplot2 → Plotly or Seaborn." } },
      julia: { tidyverse: { target: "dataframes.jl", notes: "Tidyverse → DataFrames.jl." } },
    },
  }

  // The indexer emits a fixed set of language labels (see
  // `DetectedLanguage` in src/ast/language-detection.ts). Measured against that
  // set, this map previously recognized 30 of 46 labels: a real `objective-c`,
  // `tsx` or `nim` symbol was planned as if in a language this file holds no
  // dictionary rows for, and a user asking for target `C++` was told the target
  // was unsupported even though `cpp` is a dictionary key.
  //
  // Both spellings are registered for every hyphenated name because
  // `normalizeMigrationLanguage` folds `-` and spaces to `_` BEFORE the lookup.
  // The pre-fold form is kept too so the map is readable as a contract rather
  // than as a set of keys that only happen to be reachable.
  const MIGRATION_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
    ts: "typescript", typescript: "typescript", tsx: "typescript", "typescriptreact": "typescript",
    js: "javascript", javascript: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", python: "python", pyw: "python", pyi: "python",
    rb: "ruby", ruby: "ruby", erlang: "erlang", elixir: "elixir", ex: "elixir", exs: "elixir",
    cs: "csharp", csharp: "csharp", c_sharp: "csharp", "c#": "csharp",
    objc: "objectivec", "objective-c": "objectivec", objectivec: "objectivec",
    "objective_c": "objectivec", "objective_cpp": "objectivec", "objective-c++": "objectivec",
    fs: "fsharp", fsharp: "fsharp", "f#": "fsharp", fsi: "fsharp", fsx: "fsharp",
    ps: "powershell", powershell: "powershell", ps1: "powershell",
    c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp", hxx: "cpp",
    rs: "rust", rust: "rust", go: "go", golang: "go", zig: "zig", nim: "nim",
    java: "java", kt: "kotlin", kotlin: "kotlin", kts: "kotlin",
    scala: "scala", sc: "scala", groovy: "groovy", gradle: "groovy",
    swift: "swift", dart: "dart", php: "php", lua: "lua", pl: "perl", perl: "perl",
    hs: "haskell", haskell: "haskell", clj: "clojure", clojure: "clojure", cljs: "clojure",
    sh: "bash", bash: "bash", zsh: "bash", shell: "bash", shellcheck: "bash",
    // Markup, config, query and schema languages. They carry no importable
    // library surface, so they are recognized (a plan must not claim the
    // component is in an unknown language) but they resolve to no mappings and
    // are refused below, with the refusal naming them as non-migratable.
    html: "html", xml: "xml", css: "css", scss: "css", sass: "css", less: "css",
    vue: "vue", svelte: "svelte", json: "json", jsonc: "json",
    yaml: "yaml", yml: "yaml", toml: "toml", hcl: "hcl", tf: "hcl", tfvars: "hcl",
    markdown: "markdown", md: "markdown", sql: "sql", proto: "protobuf", protobuf: "protobuf",
    "protocol_buffer": "protobuf", "protocol-buffer": "protobuf", "protocol buffer": "protobuf",
    make: "make", mk: "make", makefile: "make", clean: "clean",
    // `vb` and `vbnet` are recognized so the refusal is precise, but this file
    // holds no VB rows; see the non-migratable set below.
    vb: "vb", vbnet: "vb",
  }

  const SUPPORTED_MIGRATION_LANGUAGES = new Set([
    ...Object.keys(BASE_POLYGLOT_LIBRARY_DICTIONARY),
    ...Object.keys(DIRECT_POLYGLOT_LIBRARY_DICTIONARY),
  ].map((language) => language.toLowerCase()))

  // Languages the indexer emits that are real files with real symbols but hold
  // no importable library surface. A migration plan for one of these is
  // nonsense — you do not port a YAML document to Go — so they are refused with
  // a stated reason instead of being planned as an unknown language.
  const NON_MIGRATABLE_LANGUAGES: Readonly<Record<string, string>> = {
    html: "an HTML document, not migratable program logic",
    xml: "an XML document, not migratable program logic",
    css: "a stylesheet, not migratable program logic",
    json: "a JSON document, not migratable program logic",
    yaml: "a YAML document, not migratable program logic",
    toml: "a TOML document, not migratable program logic",
    hcl: "an HCL configuration, not migratable program logic",
    markdown: "a Markdown document, not migratable program logic",
    make: "a makefile, not migratable program logic",
    sql: "a SQL script, not migratable program logic",
    protobuf: "an IDL schema, not migratable program logic",
    clean: "a Clean function, not migratable program logic",
    vb: "Visual Basic, which holds no library-equivalence rows in this tool",
    nim: "Nim, which holds no library-equivalence rows in this tool",
    proto: "an IDL schema, not migratable program logic",
  }

  function normalizeMigrationLanguage(language: string): string | null {
    // Fold to a single `_`-separated form, then look up the folded form, the
    // raw form, and the form with separators stripped. All three are needed:
    // `objective-c` and `objective_c` are the same language, and a label like
    // `c++` never normalizes to a dictionary key by folding alone.
    const raw = String(language ?? "").trim().toLowerCase()
    if (!raw) return null
    const folded = raw.replace(/[\s-]+/g, "_")
    for (const candidate of [folded, raw, folded.replace(/_/g, "")]) {
      const canonical = MIGRATION_LANGUAGE_ALIASES[candidate]
      if (canonical) return canonical
    }
    const canonical = MIGRATION_LANGUAGE_ALIASES[folded] ?? folded.replace(/_/g, "")
    return SUPPORTED_MIGRATION_LANGUAGES.has(canonical) ? canonical : null
  }

  /**
   * Resolve a symbol's own language label to a dictionary key, and say plainly
   * when it has none. The previous form fell back to the RAW label, which is how
   * a plan came to claim `src: "yaml"` with a dependency list and an effort
   * estimate — a language this file holds no rows for at all.
   */
  export interface SourceLanguageResolution {
    /** Dictionary key, or null when this tool holds no data for the language. */
    language: string | null
    /** The label exactly as the index stored it, for error messages. */
    label: string
    /** Set when `language` is null; safe to show a user. */
    reason: string | null
  }

  export function resolveSourceLanguage(label: string): SourceLanguageResolution {
    const raw = String(label ?? "").trim()
    const canonical = normalizeMigrationLanguage(raw)
    // The non-migratable check runs on the CANONICAL name, not the raw label:
    // the alias map resolves `yaml`/`SQL`/`CSS` to themselves, so checking the
    // raw label first let every one of them through as a plannable language.
    if (canonical) {
      const nonMigratable = NON_MIGRATABLE_LANGUAGES[canonical]
      if (nonMigratable) return { language: null, label: raw, reason: `source language "${raw}" is ${nonMigratable}` }
      return { language: canonical, label: raw, reason: null }
    }
    const folded = raw.toLowerCase().replace(/[\s-]+/g, "_")
    const nonMigratable = NON_MIGRATABLE_LANGUAGES[folded] ?? NON_MIGRATABLE_LANGUAGES[folded.replace(/_/g, "")]
    return {
      language: null,
      label: raw,
      reason: nonMigratable
        ? `source language "${raw}" is ${nonMigratable}`
        : `no library-equivalence data is registered for source language "${raw}"`,
    }
  }

  const POLYGLOT_LIBRARY_DICTIONARY = Object.fromEntries(
    [...new Set([...Object.keys(BASE_POLYGLOT_LIBRARY_DICTIONARY), ...Object.keys(DIRECT_POLYGLOT_LIBRARY_DICTIONARY)])].map(
      (sourceLanguage) => {
        const baseTargets = BASE_POLYGLOT_LIBRARY_DICTIONARY[sourceLanguage] ?? {}
        const directTargets = DIRECT_POLYGLOT_LIBRARY_DICTIONARY[sourceLanguage] ?? {}
        const targets = Object.fromEntries(
          [...new Set([...Object.keys(baseTargets), ...Object.keys(directTargets)])].map((targetLanguage) => [
            targetLanguage,
            { ...(baseTargets[targetLanguage] ?? {}), ...(directTargets[targetLanguage] ?? {}) },
          ]),
        )
        return [sourceLanguage, targets]
      },
    ),
  ) as Record<string, Record<string, Record<string, { target: string; notes?: string }>>>

  export type MigrationRefusalReason =
    | "missing-symbol"
    | "unsupported-target"
    | "same-language"
    | "unsupported-source"
    | "ambiguous-symbol"

  export interface MigrationRefusal {
    reason: MigrationRefusalReason
    /** A sentence safe to show a user. No fabrication, no internal jargon. */
    detail: string
    /** Every symbol the requested name matched, for the ambiguity case. */
    candidates?: Array<{ id: string; name: string; language: string; file: string }>
  }

  export type MigrationOutcome =
    | { ok: true; plan: MigrationPlan }
    | { ok: false; refusal: MigrationRefusal }

  // ── the planner's input ────────────────────────────────────────────────────
  // A narrow view of the index, produced by
  // `loadMigrationContext` (src/intelligence/migration/migration-source.ts).
  // Deliberately not the whole project: the previous input was every symbol and
  // every relationship in the repository, loaded and reconstructed per call.
  export interface MigrationSourceRelationship {
    id: string
    sourceSymbolId: string | null
    targetSymbolId: string | null
    sourceExternal?: string | null
    targetExternal?: string | null
    type: string
    confidence?: number | null
    line?: number | null
    isCrossLanguage?: boolean
    bridgeMechanism?: string | null
    isCrossFile?: boolean
    /** Convenience for the legacy adapter: endpoint file paths. */
    sourceFile?: string
    targetFile?: string
  }

  export interface MigrationSource {
    /** Symbols whose name matches a requested name (case-insensitive). */
    symbols: Array<{ id: string; name: string; type?: string; language: string; file: string }>
    relationships: MigrationSourceRelationship[]
    nameById?: Map<string, string>
    fileById?: Map<string, string>
  }

  /**
   * Adapt the generic cross-language analysis shape into a `MigrationSource`.
   *
   * Kept so callers holding a `PolyglotProjectAnalysis` — the fixtures in
   * script/m20/verify-migration-mappings.ts among them — keep working. The
   * engine itself no longer goes through this path; it uses the bounded loader.
   */
  export function migrationSourceFromAnalysis(analysis: any): MigrationSource {
    const nameById = new Map<string, string>()
    const fileById = new Map<string, string>()
    const symbols = (analysis?.crossLanguageSymbols ?? []).map((s: any) => {
      nameById.set(s.id, s.name)
      fileById.set(s.id, s.definitions?.[0]?.filePath ?? "unknown")
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        language: String(s.languages?.[0] ?? "unknown"),
        file: s.definitions?.[0]?.filePath ?? "unknown",
        metadata: s.metadata,
      }
    })
    const relationships: MigrationSourceRelationship[] = (analysis?.crossLanguageRelationships ?? []).map((r: any) => ({
      id: r.id,
      sourceSymbolId: r.source?.symbolId ?? null,
      targetSymbolId: r.target?.symbolId ?? null,
      type: String(r.type),
      confidence: Number.isFinite(r.strength) ? r.strength : null,
      line: null,
      isCrossLanguage: false,
      bridgeMechanism: null,
      isCrossFile: (r.source?.filePath ?? "") !== (r.target?.filePath ?? ""),
      sourceFile: r.source?.filePath,
      targetFile: r.target?.filePath,
    }))
    return { symbols: symbols as any, relationships, nameById, fileById }
  }

  /**
   * Canonicalize a module specifier to the name the dictionary is keyed by.
   *
   * THE SHAPE OF THE PROBLEM. A dictionary key is a name in the SOURCE
   * ecosystem's own vocabulary: `net/http` for Go, `flutter/material` for Dart,
   * `socket.io` for npm, `asgiref` for Python. An import specifier is whatever
   * the source file happens to write. Collapsing one to the other without
   * knowing the language gets it wrong in both directions, and the dictionary
   * audit measured all three failures:
   *
   *   "net/http"           -> "net"            (Go subpath is the package)
   *   "package:flutter/material.dart" -> "flutter"  (Dart subpath is the widget set)
   *   "socket.io"          -> rejected         (a real npm package with a dot)
   *   "@nestjs/core"       -> "core"           (the scope is the framework)
   *   "node:fs"            -> rejected         (a builtin, not a dependency)
   *   "@types/node"        -> rejected         (a type stub, not a runtime dep)
   *
   * So this is language-aware. The rules that differ:
   *
   *  - Go, Dart, Rust, Java, C#, PHP, Ruby, Perl: a dotted or slashed path IS
   *    the package name. `net/http`, `package:flutter/material.dart`, `com.squareup…`
   *  - Python, R, Elixir, Haskell, Scala, Clojure: the FIRST dotted segment is
   *    the module. `asgiref`, `ggplot2`.
   *  - JavaScript/TypeScript: npm scope rules — `@scope/name` collapses to the
   *    scope (the dictionary is keyed by framework), everything else keeps its
   *    first path segment but KEEPS dots, so `socket.io` survives.
   *
   * `language` is the SOURCE language, normalized. It is optional so that a
   * caller with no language gets the JavaScript/npm rules, which are the
   * strictest about scope and the most common case in the corpus.
   */
  export interface CanonicalPackage {
    name: string | null
    /** Why it is not a library, when it is not one. */
    excluded?: "node-builtin" | "type-only" | "relative" | "malformed" | "absolute"
  }

  /** Languages where a dotted/slashed path is itself the package name. */
  const PATH_NAMED_LANGUAGES: ReadonlySet<string> = new Set([
    "go", "rust", "java", "csharp", "php", "ruby", "perl", "swift", "kotlin", "cpp", "c",
    // Clojure namespaces are dotted paths, not modules: `(require '[core.async])`
    // names `core.async` in full. Taking the first segment turned it into `core`,
    // which is not a namespace and matches no row.
    "clojure",
  ])
  /** Languages where the first dotted segment is the module. */
  const DOTTED_MODULE_LANGUAGES: ReadonlySet<string> = new Set([
    "python", "r", "elixir", "haskell", "scala", "erlang", "julia", "lua",
  ])

  export function canonicalPackageName(specifier: string, language?: string | null): CanonicalPackage {
    let raw = String(specifier ?? "").trim().replace(/^["']|["']$/g, "")
    if (!raw) return { name: null, excluded: "malformed" }
    if (raw.startsWith("node:")) return { name: null, excluded: "node-builtin" }
    if (raw.startsWith(".") || raw.startsWith("./") || raw.startsWith("../")) return { name: null, excluded: "relative" }
    if (raw.startsWith("/")) return { name: null, excluded: "absolute" }

    // `package:flutter/material.dart` is Dart's canonical spelling.
    if (raw.startsWith("package:")) raw = raw.slice("package:".length)

    const lang = normalizeMigrationLanguage(language ?? "") ?? "javascript"

    if (lang === "dart") {
      // `package:<package>/<library>.dart` — the PACKAGE is the first segment, so
      // `package:bloc/bloc.dart` is the `bloc` package. The subpath names a
      // LIBRARY inside it, not a package, which is why the `flutter/material`
      // dictionary row can never be selected by an import: both it and the
      // `flutter` row canonicalize to `flutter`. Choosing between them needs
      // library-level granularity the lookup does not have.
      const first = raw.split("/")[0]
      return first ? { name: first } : { name: null, excluded: "malformed" }
    }

    if (PATH_NAMED_LANGUAGES.has(lang)) {
      const withoutExt = raw
      // A Java/Kotlin/C# fully-qualified name is not an import at all; it is a
      // type reference, and nothing in the dictionary is keyed by one.
      if (/^(?:java|javax|com|org|net|io)\./.test(withoutExt) && lang !== "go") {
        const first = withoutExt.split(/[./]/)[0]
        return first ? { name: first } : { name: null, excluded: "malformed" }
      }
      // Go stdlib and module paths keep every segment.
      return withoutExt ? { name: withoutExt } : { name: null, excluded: "malformed" }
    }

    if (DOTTED_MODULE_LANGUAGES.has(lang)) {
      const first = raw.split(".")[0]
      return first ? { name: first } : { name: null, excluded: "malformed" }
    }

    // JavaScript / TypeScript and the default.
    if (raw.startsWith("@types/")) return { name: null, excluded: "type-only" }
    const segments = raw.split("/")
    if (raw.startsWith("@")) {
      if (segments.length < 2 || !segments[0] || !segments[1]) return { name: null, excluded: "malformed" }
      const scope = segments[0].slice(1)
      if (scope === "types" || scope.startsWith("types-")) return { name: null, excluded: "type-only" }
      return { name: scope }
    }
    // Keep dots: `socket.io`, `lodash.merge` and `underscore.string` are real
    // package names. Only strip a path, which is how a subpath import names a
    // package that is already known by its first segment.
    const name = segments[0]
    if (!name) return { name: null, excluded: "malformed" }
    return { name }
  }

  /**
   * The package named by a `node_modules/...` path, canonicalized the same way.
   * Previously this returned the whole scoped path, so a package seen here and
   * through an import produced two different names.
   */
  export function packageFromNodeModulesPath(filePath: string, language?: string | null): CanonicalPackage {
    const match = String(filePath ?? "").match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    if (!match) return { name: null, excluded: "malformed" }
    return canonicalPackageName(match[1], language ?? "javascript")
  }

  /** Test-shaped evidence, so the effort split is visible instead of implied. */
  const TEST_PATH = /(?:^|\/)(?:tests?|spec|specs|__tests__|testing)\/|(?:_test|_spec|\.test|\.spec|Test|Tests|Spec)\.[A-Za-z0-9]+$|_(?:test|tests|spec)\.[A-Za-z0-9]+$/

  export function isTestPath(filePath: string): boolean {
    const p = String(filePath ?? "")
    if (!p || p === "unknown") return false
    return TEST_PATH.test(p)
  }

  /**
   * Is this relationship an integration point a port must satisfy, or a
   * structural edge that records nesting?
   *
   * Measured on cobra: 2401 `calls`, 831 `uses`, 805 `references`, 284
   * `instantiates`, 200 `imports` — and 792 `contains` plus 8 `exports`. That
   * last pair is ~15% of all edges and none of it is work a migrating engineer
   * does: `contains` is emitted by the indexer as an auto-generated ownership
   * edge ("owner contains member") whose `line_number` is the MEMBER'S
   * DECLARATION LINE, not a call site (see the M59/#821 comment at the emit
   * site in parallel-indexer.ts). Billing 2 hours to "update the place that
   * contains this function" is billing for nothing.
   *
   * `exports` is likewise declarative: it records that a symbol is exported.
   *
   * Everything else — `calls`, `uses`, `references`, `imports`, `instantiates`,
   * `extends`, `implements`, `overrides`, and any type this list has not seen —
   * is an integration point. An UNKNOWN type is charged, not waved through:
   * guessing that a new kind is structural would understate the work.
   */
  const STRUCTURAL_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set(["contains", "exports"])

  export function isStructuralRelationship(relationshipType: string): boolean {
    return STRUCTURAL_RELATIONSHIP_TYPES.has(String(relationshipType ?? "").trim().toLowerCase())
  }

  /**
   * Analyzes a component (symbol) in the AST and generates a deep migration plan
   * to a target language, mapping dependencies and calculating risk/effort.
   *
   * Use this rather than {@link generateMigrationPlan} when the caller needs to
   * tell the user WHY nothing was produced. `generateMigrationPlan` collapses
   * every refusal to `null`, which is why the batch path used to re-derive the
   * reason from a second, independent lookup.
   */
  export async function planMigration(
    symbolName: string,
    targetLanguage: string,
    source: MigrationSource,
  ): Promise<MigrationOutcome> {
    log.debug(`planMigration: '${symbolName}' -> '${targetLanguage}'`)

    // 1. Resolve the component. A name that matches several symbols is NOT
    // silently collapsed to the first one: measured on a two-file fixture, the
    // previous `find` returned a confident plan for whichever symbol happened to
    // be first and never mentioned the other.
    const wanted = String(symbolName ?? "").trim().toLowerCase()
    const matches = source.symbols.filter((s) => String(s.name).toLowerCase() === wanted)
    if (matches.length === 0) {
      return { ok: false, refusal: { reason: "missing-symbol", detail: `no indexed symbol named "${symbolName}"` } }
    }
    if (matches.length > 1) {
      // Two shapes of collision, only one of which is a real ambiguity.
      //
      // SAME FILE, different case: Go and many other languages treat `Execute`
      // and `execute` as one component in one file. Measured on cobra: five such
      // pairs, all in one file. Refusing there is noise — the caller asked for
      // one component in one file and there is only one component in one file.
      // An exact-case match resolves it unambiguously.
      const files = new Set(matches.map((s) => s.file))
      const exact = matches.filter((s) => s.name === String(symbolName ?? "").trim())
      if (files.size === 1 && exact.length === 1) {
        log.debug(`planMigration: resolved case-variant name '${symbolName}' to '${exact[0].name}' in ${[...files][0]}`)
        return buildPlan(exact[0], targetLanguage, source)
      }
      const candidates = matches.map((s) => ({ id: s.id, name: s.name, language: s.language, file: s.file }))
      return {
        ok: false,
        refusal: {
          reason: "ambiguous-symbol",
          detail:
            files.size === 1
              ? `"${symbolName}" matches ${matches.length} indexed symbols in one file (${candidates.map((c) => c.name).join(", ")}); none matches the requested spelling exactly, so this is a genuine collision — re-run against the exact spelling`
              : `"${symbolName}" matches ${matches.length} indexed symbols (${candidates.map((c) => c.file).join(", ")}); re-run against one file's symbol id or rename to disambiguate`,
          candidates,
        },
      }
    }
    return buildPlan(matches[0], targetLanguage, source)
  }

  /**
   * Build the plan for an already-resolved symbol. Split out of
   * {@link planMigration} so that a case-variant name resolved inside one file
   * takes exactly the same path as an exact match — a resolution rule that only
   * worked on the happy path would be a second implementation of the planner.
   */
  function buildPlan(
    symbol: { id: string; name: string; type?: string; language: string; file: string; metadata?: any },
    targetLanguage: string,
    source: MigrationSource,
  ): MigrationOutcome {
    const resolvedSource = resolveSourceLanguage(symbol.language)
    if (!resolvedSource.language) {
      return { ok: false, refusal: { reason: "unsupported-source", detail: resolvedSource.reason ?? "unsupported source language" } }
    }
    const sourceLanguage = resolvedSource.language

    const normalizedTargetLanguage = normalizeMigrationLanguage(targetLanguage)
    if (!normalizedTargetLanguage) {
      return { ok: false, refusal: { reason: "unsupported-target", detail: `no migration data is registered for target language "${String(targetLanguage ?? "").trim()}"` } }
    }
    if (sourceLanguage === normalizedTargetLanguage) {
      return { ok: false, refusal: { reason: "same-language", detail: `source and target are both ${sourceLanguage}` } }
    }
    if (!hasMigrationRoute(sourceLanguage, normalizedTargetLanguage)) {
      return {
        ok: false,
        refusal: {
          reason: "unsupported-target",
          detail: `no library-equivalence data is registered for ${sourceLanguage} → ${normalizedTargetLanguage}; this tool has no migration route between them`,
        },
      }
    }

    // 2. Relationship evidence, scoped to this symbol's ids. Every field is one
    //    the indexer actually stored; nothing is synthesised. The previous path
    //    wrote `strength: 0.8` for every edge while the row's real
    //    `confidence`, `line_number`, `is_cross_language` and `bridge_mechanism`
    //    went unread.
    const nameById = source.nameById ?? new Map<string, string>()
    const fileById = source.fileById ?? new Map<string, string>()
    const relationshipEvidence = [...new Map(
      source.relationships
        .filter((r) => r.sourceSymbolId === symbol.id || r.targetSymbolId === symbol.id)
        .map((r) => {
          const sourceFile = r.sourceFile ?? (r.sourceSymbolId ? fileById.get(r.sourceSymbolId) : undefined) ?? "unknown"
          const targetFile = r.targetFile ?? (r.targetSymbolId ? fileById.get(r.targetSymbolId) : undefined) ?? "unknown"
          const id = String(r.id || [r.sourceSymbolId ?? "", r.targetSymbolId ?? "", r.type, sourceFile, targetFile].join("|"))
          const endpointsResolved = Boolean(r.sourceSymbolId) && Boolean(r.targetSymbolId)
          const entry: MigrationRelationshipEvidence = {
            id,
            relationshipType: String(r.type),
            sourceSymbolId: r.sourceSymbolId ?? null,
            targetSymbolId: r.targetSymbolId ?? null,
            sourceExternal: r.sourceExternal ?? null,
            targetExternal: r.targetExternal ?? null,
            sourceFile,
            targetFile,
            line: typeof r.line === "number" ? r.line : null,
            confidence: typeof r.confidence === "number" ? r.confidence : null,
            isCrossLanguage: r.isCrossLanguage === true,
            bridgeMechanism: r.bridgeMechanism ?? null,
            isCrossFile: r.isCrossFile ?? (sourceFile !== targetFile),
            endpointsResolved,
            isIntegrationPoint: !isStructuralRelationship(r.type),
            isTestEvidence: isTestPath(sourceFile) || isTestPath(targetFile),
          }
          return [id, entry] as const
        }),
    ).values()].sort((a, b) => a.id.localeCompare(b.id))

    // 3. Split dependencies by PROVENANCE before mapping them.
    const { evidenced, inferred, evidenceAvailable } = extractSourceDependencies(symbol as any, relationshipEvidence)

    const dependencies: LibraryEquivalence[] = evidenced.map((lib) => toEquivalence(lib, sourceLanguage, normalizedTargetLanguage, "indexed-import"))
    const inferredDependencies: LibraryEquivalence[] = inferred.map((lib) => toEquivalence(lib, sourceLanguage, normalizedTargetLanguage, "name-heuristic"))

    // 4. Effort and risk, from measured quantities only.
    //
    //    An edge whose endpoint is not an indexed symbol cannot be located, so it
    //    is not charged: you cannot schedule work against an edge with no
    //    endpoint. Measured 9 such edges in a single cobra plan, previously
    //    billed at 2 hours each. Test-shaped edges ARE charged — a port does have
    //    to update its callers — but the split is reported, because 55.3% of a
    //    cobra plan's evidence is test code and an undifferentiated number is
    //    not interpretable.
    // Charged = resolvable AND an integration point. Two separate reasons an edge
    // is not billed: an endpoint that is not an indexed symbol (it cannot be
    // located), and a structural edge (it records nesting, not a call to update).
    const structural = relationshipEvidence.filter((e) => !e.isIntegrationPoint)
    const integration = relationshipEvidence.filter((e) => e.isIntegrationPoint)
    const charged = integration.filter((e) => e.endpointsResolved)
    const breakdown = {
      total: relationshipEvidence.length,
      production: charged.filter((e) => !e.isTestEvidence).length,
      test: charged.filter((e) => e.isTestEvidence).length,
      // Within the INTEGRATION points only. This used to be
      // `total - integration.length`, which is the structural count — so
      // `unresolvable` and `structural` always reported the same number and the
      // breakdown double-counted. The corpus suite caught it; the visible symptom
      // was "2 structural, 2 unresolvable" on a plan with one of each.
      unresolvable: integration.length - charged.length,
      structural: structural.length,
      crossLanguage: relationshipEvidence.filter((e) => e.isCrossLanguage).length,
      withLine: charged.filter((e) => e.line != null).length,
      withConfidence: charged.filter((e) => e.confidence != null).length,
    }

    const missingMappings = dependencies.filter((d) => d.confidence < 0.5).length
    let effortEstimateHours = 4
    effortEstimateHours += charged.length * 2
    effortEstimateHours += missingMappings * 6

    const riskFactors: string[] = []
    let riskLevel: MigrationRisk["level"] = "Low"
    let complexityScore = 2

    if (charged.length > 5) {
      riskFactors.push(`High coupling: ${charged.length} resolvable integration points (${breakdown.production} production, ${breakdown.test} test).`)
      complexityScore += 3
      riskLevel = "High"
    }
    if (missingMappings > 0) {
      riskFactors.push(`${missingMappings} indexed import${missingMappings === 1 ? "" : "s"} have no registered equivalence to ${normalizedTargetLanguage}; each needs its own research.`)
      complexityScore += 2
      if (riskLevel === "Low") riskLevel = "Medium"
    }
    if (breakdown.crossLanguage > 0) {
      const mechanisms = [...new Set(relationshipEvidence.filter((e) => e.isCrossLanguage).map((e) => e.bridgeMechanism).filter(Boolean))]
      riskFactors.push(`${breakdown.crossLanguage} integration point${breakdown.crossLanguage === 1 ? "" : "s"} cross a language boundary${mechanisms.length ? ` (bridged by ${mechanisms.join(", ")})` : ""}; each must keep working after the port.`)
      complexityScore += 1
      if (riskLevel === "Low") riskLevel = "Medium"
    }
    if (breakdown.structural > 0) {
      // Not a risk of the CODE and not a limit of the index: an accounting
      // statement, so a reader comparing two plans knows they are comparable.
      riskFactors.push(`${breakdown.structural} structural relationship${breakdown.structural === 1 ? "" : "s"} (containment or export) recorded but not charged; only integration points are billed.`)
    }
    if (breakdown.unresolvable > 0) {
      // Not a risk of the CODE — a limit of what the index can see. Stated as
      // such, and it does not move the band.
      riskFactors.push(
        breakdown.unresolvable === 1
          ? "1 indexed relationship has an endpoint that is not an indexed symbol, so the port cannot be scoped from it."
          : `${breakdown.unresolvable} indexed relationships have an endpoint that is not an indexed symbol, so the port cannot be scoped from them.`,
      )
    }

    // The index does not record per-file imports, so a component's LIBRARY
    // dependencies are unknown rather than empty. That is a different thing from
    // a component with no libraries, and it belongs in the risk field, not only
    // in a note nobody reads.
    if (!evidenceAvailable) {
      riskFactors.push("Library dependencies are UNKNOWN, not empty: the index does not record the imports this component performs. Resolve them before estimating.")
    }

    // Data-shaped detection now works on data the index actually holds: the
    // raw `symbol_type` plus the component's own name. The previous guard
    // required the `CrossLanguageSymbolType.DATABASE_ENTITY` enum value, which
    // the bridge never wrote — measured 0 of 2988 flask symbols, so the Critical
    // band was unreachable.
    const symbolType = String(symbol.type ?? "").toLowerCase()
    const isDataCarrier =
      symbolType === "database_entity" ||
      (/(?:class|struct|interface|type|table|enum)/.test(symbolType) &&
        /(?:^|[_\-.])(?:table|schema|migration|migrate|entity|model|dao|repository|repo)(?:$|[_\-.])/i.test(symbol.name))
    if (isDataCarrier) {
      riskFactors.push(`Data-shaped component (${symbolType} "${symbol.name}"): schema and stored-state migration are likely in scope.`)
      complexityScore += 4
      riskLevel = "Critical"
    }

    if (riskFactors.length === 0) {
      riskFactors.push("Standard component migration with well-understood bounds.")
    }

    // 5. Strategy steps, in the NORMALIZED language names. The previous text
    //    interpolated the raw request argument, so a request for `C++` scaffolded
    //    "a new C++ module" in a plan whose targetLanguage read `cpp`.
    const strategySteps = [
      `Step 1: Scaffold new ${normalizedTargetLanguage} module/package for ${symbol.name}.`,
      dependencies.some((d) => d.confidence > 0.5)
        ? `Step 2: Install target equivalent dependencies: ${dependencies.filter((d) => d.confidence > 0.5).map((d) => d.target).join(", ")}.`
        : evidenceAvailable
          ? "Step 2: No indexed import maps to a registered target equivalent — resolve the library substitutions before scaffolding."
          : "Step 2: The index carries no import evidence for this component — read its imports and resolve library substitutions before scaffolding.",
      `Step 3: Port the core domain logic from ${sourceLanguage} to ${normalizedTargetLanguage}.`,
      breakdown.production > 0
        ? `Step 4: Update ${breakdown.production} production call site${breakdown.production === 1 ? "" : "s"} to the new implementation.`
        : "Step 4: No production call sites are indexed for this component.",
      breakdown.test > 0 ? `Step 5: Update ${breakdown.test} test call site${breakdown.test === 1 ? "" : "s"} and confirm coverage.` : "Step 5: No test call sites are indexed for this component.",
      `Step 6: Deprecate and remove the original ${sourceLanguage} implementation.`,
    ]

    log.debug(`buildPlan: produced plan for '${symbol.name}' -> ${normalizedTargetLanguage}`)

    return {
      ok: true,
      plan: {
        componentName: symbol.name,
        symbolId: symbol.id,
        sourceFile: symbol.file,
        sourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        dependencies,
        inferredDependencies,
        dependencyProvenance: {
          indexedImports: evidenced.length,
          nameHeuristics: inferred.length,
          importEvidence: evidenceAvailable ? "available" : "unavailable",
          note: evidenceAvailable
            ? "`dependencies` is derived from indexed imports. `inferredDependencies` holds name-based guesses that are NOT evidence and do not affect effort or risk."
            : "No indexed import evidence is available for this component, so `dependencies` is empty and the component's library dependencies are UNKNOWN. `inferredDependencies` holds name-based guesses that are NOT evidence and do not affect effort or risk.",
        },
        relationshipEvidence,
        evidenceBreakdown: breakdown,
        effortEstimateHours,
        complexityScore: Math.min(10, complexityScore),
        riskAssessment: { level: riskLevel, factors: riskFactors },
        strategySteps,
      },
    }
  }

  /**
   * Null-returning wrapper kept for callers that only need "did it work".
   * Accepts either a `MigrationSource` or a `PolyglotProjectAnalysis`.
   * Prefer {@link planMigration} when the reason matters.
   */
  export async function generateMigrationPlan(
    symbolName: string,
    targetLanguage: string,
    input: MigrationSource | any,
  ): Promise<MigrationPlan | null> {
    const source: MigrationSource = Array.isArray((input as any)?.symbols) ? (input as MigrationSource) : migrationSourceFromAnalysis(input)
    const outcome = await planMigration(symbolName, targetLanguage, source)
    return outcome.ok ? outcome.plan : null
  }
  // --- INTERNAL UTILS ---

  /**
   * Separate the component's libraries by where the claim comes from.
   *
   * `evidenced` — packages the index actually shows this component using:
   * a node_modules relationship endpoint. These are claims about the code.
   *
   * `inferred` — name-substring guesses. Real signal about which ecosystem a
   * component probably lives in, but NOT evidence about this code, so they never
   * appear in `dependencies`.
   *
   * `evidenceAvailable` — whether any evidenced package was found AT ALL. The
   * index does not record per-file imports, so this is normally false, and the
   * difference between "this component has no libraries" and "we cannot see this
   * component's libraries" has to survive into the plan.
   */
  function extractSourceDependencies(
    symbol: { id: string; name: string; type?: string; language?: string; file?: string; metadata?: any },
    relationships: MigrationRelationshipEvidence[],
  ): { evidenced: string[]; inferred: string[]; evidenceAvailable: boolean } {
    const evidenced = new Set<string>()
    const inferred = new Set<string>()

    // 1. Imports carried on the symbol itself, when a caller supplies them. The
    //    production loader does not (the index has no per-symbol import record),
    //    which is exactly why this must not be assumed present.
    const rawImports = Array.isArray(symbol?.metadata?.imports) ? symbol.metadata.imports : []
    for (const entry of rawImports) {
      const { name, excluded } = canonicalPackageName(String(entry ?? ""), symbol?.language)
      if (name) evidenced.add(name)
      else if (excluded) log.debug(`canonicalPackageName: excluded import "${entry}" (${excluded})`)
    }

    // 2. Third-party packages at a relationship endpoint, canonicalized through
    //    the SAME function as (1). Round 1 used two different rules on the two
    //    sources, so one package produced two different library names.
    for (const relationship of relationships) {
      for (const side of [relationship.sourceFile, relationship.targetFile]) {
        const { name } = packageFromNodeModulesPath(side, symbol?.language)
        if (name) evidenced.add(name)
      }
    }

    // 3. Name heuristics, kept but labelled as guesses. The unconditional
    //    test-framework entry is gone: it is what told a Go service to adopt
    //    `jest`, at confidence 0, for +6h and a forced Medium risk band.
    const sourceLanguage = normalizeMigrationLanguage(symbol?.language ?? "")
    const typeStr = String(symbol?.type ?? "").toLowerCase()
    const nameStr = String(symbol?.name ?? "").toLowerCase()

    if (sourceLanguage === "typescript" || sourceLanguage === "javascript") {
      if (typeStr.includes("api") || nameStr.includes("controller") || nameStr.includes("router")) inferred.add("express")
      if (typeStr.includes("entity") || typeStr.includes("model") || nameStr.includes("repo")) inferred.add("drizzle-orm")
      if (nameStr.includes("client") || nameStr.includes("fetch")) inferred.add("axios")
    } else if (sourceLanguage === "python") {
      if (typeStr.includes("api") || nameStr.includes("api") || nameStr.includes("route")) inferred.add("fastapi")
      if (typeStr.includes("entity") || typeStr.includes("model")) inferred.add("sqlalchemy")
    }

    return {
      evidenced: [...evidenced],
      inferred: [...inferred].filter((name) => !evidenced.has(name)),
      evidenceAvailable: evidenced.size > 0,
    }
  }

  function toEquivalence(
    lib: string,
    sourceLang: string,
    targetLang: string,
    provenance: "indexed-import" | "name-heuristic",
  ): LibraryEquivalence {
    const mapping = lookupEquivalence(sourceLang, targetLang, lib)
    if (provenance === "name-heuristic") {
      // A guess that HAPPENS to match a dictionary row must still be a guess.
      // Returning the row's `supported` status and its authoritative prose
      // ("GORM is the most popular Go ORM.") is how a name match became a
      // confident-looking mapping with no observation behind it. The row's
      // target is kept — it is the answer the caller wants — but the claim is
      // uncertain and the note says where it came from.
      return {
        source: lib,
        target: mapping?.target ?? null,
        confidence: 0,
        status: "uncertain",
        provenance,
        unsupportedReason: mapping ? "ambiguous-mapping" : "unknown-library",
        notes: mapping
          ? `Name-based guess, not an observed import. If this component really uses ${lib}, the registered ${targetLang} equivalent is ${mapping.target}${mapping.notes ? ` (${mapping.notes})` : ""} — unverified.`
          : "Name-based guess, not an observed import; no equivalence is claimed and this does not contribute to effort or risk.",
      }
    }
    if (mapping) {
      return { source: lib, target: mapping.target, confidence: 0.9, status: "supported", provenance, notes: mapping.notes }
    }
    // Reached only for an evidenced package with no registered row: the
    // name-heuristic case returned above. This branch used to re-test
    // `provenance === "name-heuristic"` in a ternary whose false arm was
    // unreachable; removing `@ts-nocheck` from this file surfaced it, which is
    // the checker's first dividend and the reason the pragma is gone.
    return {
      source: lib,
      target: null,
      confidence: 0,
      status: "uncertain",
      provenance,
      unsupportedReason: "unknown-library",
      notes: "No evidence-backed equivalence is registered; custom research is required.",
    }
  }

  /**
   * Every (source, target, library) row in the dictionary, flattened.
   *
   * Exposed so the knowledge base can be AUDITED rather than trusted. Until this
   * existed nothing had ever read the dictionary except the lookup, and the
   * audit immediately found rows that could not fire: `net/http` canonicalized
   * to `net`, `package:flutter/material.dart` to `flutter`, `socket.io` to
   * nothing at all. A dictionary nobody reads is how a dead row survives.
   *
   * This reports the dictionary as MERGED, which is the form the lookup actually
   * uses, so a merge that drops a row is visible here.
   */
  export interface MigrationDictionaryRow {
    sourceLanguage: string
    targetLanguage: string
    library: string
    /** The target the mapping names, as written in the dictionary. */
    target: string
    notes?: string
  }

  export function migrationDictionaryRows(): MigrationDictionaryRow[] {
    const out: MigrationDictionaryRow[] = []
    for (const [sourceLanguage, targetMap] of Object.entries(POLYGLOT_LIBRARY_DICTIONARY)) {
      for (const [targetLanguage, libraryMap] of Object.entries(targetMap ?? {})) {
        for (const [library, entry] of Object.entries(libraryMap ?? {})) {
          out.push({
            sourceLanguage,
            targetLanguage,
            library,
            target: (entry as { target: string }).target,
            notes: (entry as { notes?: string }).notes,
          })
        }
      }
    }
    return out.sort((a, b) =>
      `${a.sourceLanguage}|${a.targetLanguage}|${a.library}`.localeCompare(`${b.sourceLanguage}|${b.targetLanguage}|${b.library}`),
    )
  }

  /**
   * Does this file hold ANY equivalence row for the source→target pair?
   *
   * `normalizeMigrationLanguage` accepts any of the 30 dictionary languages as a
   * target, whether or not that language is a reachable target from the source.
   * A typescript→zig request therefore produced a "plan" in which every mapping
   * was null — technically honest, practically useless, and it charged the +6h
   * unsupported-mapping allowance for a pair the tool has no data about at all.
   */
  export function hasMigrationRoute(sourceLanguage: string, targetLanguage: string): boolean {
    const targets = POLYGLOT_LIBRARY_DICTIONARY[String(sourceLanguage ?? "").toLowerCase()]
    return !!targets && Object.prototype.hasOwnProperty.call(targets, String(targetLanguage ?? "").toLowerCase())
  }

  function lookupEquivalence(
    sourceLang: string,
    targetLang: string,
    libName: string,
  ): { target: string; notes?: string } | null {
    const sl = sourceLang.toLowerCase()
    const tl = targetLang.toLowerCase()
    const dict = POLYGLOT_LIBRARY_DICTIONARY[sl]
    if (dict && dict[tl] && dict[tl][libName.toLowerCase()]) {
      return dict[tl][libName.toLowerCase()]
    }
    return null
  }
}
