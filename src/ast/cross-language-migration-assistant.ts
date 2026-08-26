// @ts-nocheck — large static polyglot mapping dataset
import { CrossLanguageIntelligence } from "./cross-language-intelligence"
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
    sourceFile: string
    targetFile: string
    strength: number
  }

  export interface MigrationPlan {
    componentName: string
    sourceLanguage: string
    targetLanguage: string
    dependencies: LibraryEquivalence[]
    relationshipEvidence: MigrationRelationshipEvidence[]
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

  const MIGRATION_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
    ts: "typescript", typescript: "typescript", js: "javascript", javascript: "javascript",
    py: "python", python: "python", rb: "ruby", ruby: "ruby", cs: "csharp", csharp: "csharp",
    c_sharp: "csharp", objc: "objectivec", "objective-c": "objectivec", objectivec: "objectivec",
    fs: "fsharp", fsharp: "fsharp", ps: "powershell", powershell: "powershell",
  }
  const SUPPORTED_MIGRATION_LANGUAGES = new Set([
    ...Object.keys(BASE_POLYGLOT_LIBRARY_DICTIONARY),
    ...Object.keys(DIRECT_POLYGLOT_LIBRARY_DICTIONARY),
  ].map((language) => language.toLowerCase()))
  function normalizeMigrationLanguage(language: string): string | null {
    const normalized = String(language ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
    const canonical = MIGRATION_LANGUAGE_ALIASES[normalized] ?? normalized.replace(/_/g, "")
    return SUPPORTED_MIGRATION_LANGUAGES.has(canonical) ? canonical : null
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

  /**
   * Analyzes a component (symbol) in the AST and generates a deep migration plan
   * to a target language, mapping dependencies and calculating risk/effort.
   */
  export async function generateMigrationPlan(
    symbolName: string,
    targetLanguage: string,
    analysis: CrossLanguageIntelligence.PolyglotProjectAnalysis,
  ): Promise<MigrationPlan | null> {
    log.info(`🚀 Initializing Migration Assistant for '${symbolName}' to '${targetLanguage}'...`)

    // 1. Find the component in the AST
    const symbol = analysis.crossLanguageSymbols.find((s) => s.name.toLowerCase() === symbolName.toLowerCase())
    if (!symbol) {
      log.warn(`⚠️ Symbol '${symbolName}' not found in cross-language intelligence.`)
      return null
    }

    const sourceLanguage = normalizeMigrationLanguage(symbol.languages[0] || "") || String(symbol.languages[0] || "unknown").trim().toLowerCase()
    const normalizedTargetLanguage = normalizeMigrationLanguage(targetLanguage)
    if (!normalizedTargetLanguage) {
      log.warn(`⚠️ Unsupported target language '${targetLanguage}'.`)
      return null
    }
    if (sourceLanguage === normalizedTargetLanguage) {
      log.warn(`⚠️ Source and target languages are the same (${sourceLanguage}). No migration needed.`)
      return null
    }

    // 2. Analyze Component Dependencies & Relationships
    // Relationship evidence is symbol-scoped, not file-scoped. A file can
    // contain several components; counting every relationship touching that
    // file silently charges one migration for its unrelated neighbors.
    const symbolIds = new Set([
      symbol.id,
      ...(symbol.definitions ?? []).map((definition) => definition.symbolId).filter(Boolean),
    ])
    const relatedRels = analysis.crossLanguageRelationships.filter(
      (relationship) => symbolIds.has(relationship.source.symbolId ?? "") || symbolIds.has(relationship.target.symbolId ?? ""),
    )
    const relationshipEvidence = [...new Map(
      relatedRels.map((relationship) => {
        const id = String(relationship.id || [
          relationship.source.symbolId ?? "",
          relationship.target.symbolId ?? "",
          relationship.type,
          relationship.source.filePath,
          relationship.target.filePath,
        ].join("|"))
        return [id, {
          id,
          relationshipType: String(relationship.type),
          sourceSymbolId: relationship.source.symbolId ?? null,
          targetSymbolId: relationship.target.symbolId ?? null,
          sourceFile: relationship.source.filePath,
          targetFile: relationship.target.filePath,
          strength: Number.isFinite(relationship.strength) ? relationship.strength : 0,
        }]
      }),
    ).values()].sort((a, b) => a.id.localeCompare(b.id))

    // Extract dependencies based on metadata or infer from relationships
    // For God-Mode we will mock some inferred libraries if none are present in AST metadata,
    // to demonstrate the dictionary mapping capability.
    const inferredSourceLibs = extractSourceDependencies(symbol, relatedRels)

    // 3. Find Equivalent Libraries
    const dependencies: LibraryEquivalence[] = inferredSourceLibs.map((lib) => {
      const mapping = lookupEquivalence(sourceLanguage, normalizedTargetLanguage, lib)
      if (mapping) {
        return { source: lib, target: mapping.target, confidence: 0.9, status: "supported", notes: mapping.notes }
      }
      return { source: lib, target: null, confidence: 0, status: "uncertain", unsupportedReason: "unknown-library", notes: "No evidence-backed equivalence is registered; custom research is required." }
    })

    // 4. Estimate Effort and Risk
    // Effort: Base hours + per relationship + per missing mapping
    let effortEstimateHours = 4 // Base setup
    effortEstimateHours += relationshipEvidence.length * 2 // 2 hours per unique indexed relationship

    const missingMappings = dependencies.filter((d) => d.confidence < 0.5).length
    effortEstimateHours += missingMappings * 6 // 6 hours per unknown dependency

    // Risk Assessment
    const riskFactors: string[] = []
    let riskLevel: MigrationRisk["level"] = "Low"
    let complexityScore = 2

    if (relationshipEvidence.length > 5) {
      riskFactors.push(`High coupling: Component has ${relationshipEvidence.length} unique indexed relationships.`)
      complexityScore += 3
      riskLevel = "High"
    }

    if (missingMappings > 0) {
      riskFactors.push(`Missing library equivalents: ${missingMappings} dependencies have no known 1:1 mapping.`)
      complexityScore += 2
      riskLevel = riskLevel === "Low" ? "Medium" : riskLevel
    }

    if (symbol.type === CrossLanguageIntelligence.CrossLanguageSymbolType.DATABASE_ENTITY) {
      riskFactors.push(`Data migration required: Moving database entities involves schema and state migration.`)
      complexityScore += 4
      riskLevel = "Critical"
    }

    if (riskFactors.length === 0) {
      riskFactors.push("Standard component migration with well-understood bounds.")
    }

    // 5. Generate Strategy Steps
    const strategySteps = [
      `Step 1: Scaffold new ${targetLanguage} module/package for ${symbol.name}.`,
      `Step 2: Install target equivalent dependencies: ${
        dependencies
          .filter((d) => d.confidence > 0.5)
          .map((d) => d.target)
          .join(", ") || "N/A"
      }.`,
      `Step 3: Port the core domain logic from ${sourceLanguage} to ${targetLanguage}.`,
      `Step 4: Update ${relationshipEvidence.length} cross-language integration points to point to the new implementation.`,
      `Step 5: Write unit tests using target language framework to match original coverage.`,
      `Step 6: Deprecate and remove the original ${sourceLanguage} implementation.`,
    ]

    log.info(`✅ Migration Plan generated for '${symbolName}'!`)

    return {
      componentName: symbol.name,
      sourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      dependencies,
      relationshipEvidence,
      effortEstimateHours,
      complexityScore: Math.min(10, complexityScore),
      riskAssessment: {
        level: riskLevel,
        factors: riskFactors,
      },
      strategySteps,
    }
  }

  // --- INTERNAL UTILS ---

  function extractSourceDependencies(
    symbol: CrossLanguageIntelligence.CrossLanguageSymbol,
    relationships: CrossLanguageIntelligence.CrossLanguageRelationship[],
  ): string[] {
    const libs = new Set<string>()

    // 1. Extract genuine metadata imports from AST if present
    if (symbol.metadata && (symbol.metadata as any).imports) {
      const imports = (symbol.metadata as any).imports as string[]
      imports.forEach((i) => libs.add(i.split("/")[0]))
    }

    // 2. Extract from external dependencies in relationship targets
    relationships.forEach((rel) => {
      if (rel.target.filePath.includes("node_modules") && rel.target.filePath.includes("node_modules")) {
        const parts = rel.target.filePath.split("node_modules/")
        if (parts[1]) libs.add(parts[1].split("/")[0])
      }
    })

    // 3. Fallback Heuristics for demonstration where AST is sparse
    const typeStr = (symbol.type || "").toLowerCase()
    const nameStr = symbol.name.toLowerCase()

    if (symbol.languages[0]?.toLowerCase() === "typescript") {
      if (typeStr.includes("api") || nameStr.includes("controller") || nameStr.includes("router")) {
        libs.add("express")
      }
      if (typeStr.includes("entity") || typeStr.includes("model") || nameStr.includes("repo")) {
        libs.add("drizzle-orm")
      }
      if (nameStr.includes("client") || nameStr.includes("fetch")) {
        libs.add("axios")
      }
    } else if (symbol.languages[0]?.toLowerCase() === "python") {
      if (typeStr.includes("api") || nameStr.includes("api") || nameStr.includes("route")) {
        libs.add("fastapi")
      }
      if (typeStr.includes("entity") || nameStr.includes("model")) {
        libs.add("sqlalchemy")
      }
    }

    // Add jest/pytest universally as a dependency to map
    libs.add(symbol.languages[0]?.toLowerCase() === "python" ? "pytest" : "jest")

    return Array.from(libs)
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
