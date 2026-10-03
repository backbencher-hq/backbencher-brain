
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import type { UniversalSymbol, ParseResult } from "./types.js"

export interface FrameworkInfo {
  name: string
  confidence: number
  patterns: string[]
}

export type FrameworkDetector = (content: string, symbols: UniversalSymbol[]) => FrameworkInfo | undefined

export const detectors: FrameworkDetector[] = [
  detectReact,
  detectVue,
  detectNestjs,
  detectFastify,
  detectExpress,
  detectAngular,
  detectJestVitest,
  detectDrizzle,
  detectTypeorm,
  detectPrisma,
  detectNextjs,
  detectSvelte,
  detectNuxt,
  detectMongoose,
  detectSequelize,
  detectSolidjs,
  detectQwik,
  detectAstro,
  detectRemix,
  detectSveltekit,
  detectVite,
  detectTanstackQuery,
  detectZustand,
  detectTrpc,
]

export function detectFrameworks(content: string, symbols: UniversalSymbol[]): FrameworkInfo[] {
  const frameworks: FrameworkInfo[] = []
  for (const detector of detectors) {
    const info = detector(content, symbols)
    if (info) {
      frameworks.push(info)
    }
  }
  return frameworks.sort((a, b) => b.confidence - a.confidence)
}

function detectReact(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // React Detection
  const reactPatterns: string[] = []
  let reactConfidence = 0

  // Note: Framework detection uses content analysis which may match comments/strings
  // This is a limitation of the current approach but maintains compatibility
  if (content.includes("from 'react'") || content.includes('from "react"')) {
    reactConfidence += 0.4
    reactPatterns.push("react-import")
  }
  if (content.includes("useState") || content.includes("useEffect") || content.includes("useRef")) {
    reactConfidence += 0.3
    reactPatterns.push("hooks")
  }
  // Removed overly broad JSX regex that could match comments
  if (content.includes("JSX") || content.includes("tsx")) {
    reactConfidence += 0.2
    reactPatterns.push("jsx")
  }
  if (content.includes("React.Component") || content.includes("extends Component")) {
    reactConfidence += 0.2
    reactPatterns.push("class-component")
  }
  if (content.includes("React.FC") || content.includes(": FC<") || content.includes(": React.FC<")) {
    reactConfidence += 0.2
    reactPatterns.push("functional-component")
  }
  if (symbols.some((s) => s.decorators?.includes("memo") || s.decorators?.includes("forwardRef"))) {
    reactConfidence += 0.1
    reactPatterns.push("memo/forwardRef")
  }

  if (reactConfidence > 0) {
    return {
      name: "react",
      confidence: Math.min(reactConfidence, 1),
      patterns: reactPatterns,
    }
  }

  return undefined
}

function detectVue(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Vue Detection
  const vuePatterns: string[] = []
  let vueConfidence = 0

  if (content.includes("from 'vue'") || content.includes('from "vue"')) {
    vueConfidence += 0.4
    vuePatterns.push("vue-import")
  }
  if (content.includes("defineComponent") || content.includes("createApp") || content.includes("setup(")) {
    vueConfidence += 0.3
    vuePatterns.push("vue3-api")
  }
  if (
    content.includes("ref(") ||
    content.includes("reactive(") ||
    content.includes("computed(") ||
    content.includes("watch(")
  ) {
    vueConfidence += 0.2
    vuePatterns.push("composition-api")
  }
  // `@Component` alone is ambiguous — Angular uses the exact same decorator.
  // Only treat it as Vue options-API when a Vue import is present (the
  // `@Component` decorator comes from vue-class-component / vue-property-decorator,
  // both of which require importing 'vue'). Angular files must not be flagged.
  if (content.includes("Vue.extend") || (content.includes("@Component") && (content.includes("from 'vue'") || content.includes('from "vue"')))) {
    vueConfidence += 0.2
    vuePatterns.push("options-api")
  }
  if (content.includes("defineProps") || content.includes("defineEmits") || content.includes("defineExpose")) {
    vueConfidence += 0.3
    vuePatterns.push("script-setup")
  }

  if (vueConfidence > 0) {
    return {
      name: "vue",
      confidence: Math.min(vueConfidence, 1),
      patterns: vuePatterns,
    }
  }

  return undefined
}

function detectNestjs(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // NestJS Detection
  const nestPatterns: string[] = []
  let nestConfidence = 0

  const nestDecorators = [
    "Controller",
    "Injectable",
    "Module",
    "Get",
    "Post",
    "Put",
    "Delete",
    "Patch",
    "Guard",
    "Pipe",
    "Interceptor",
  ]
  for (const dec of nestDecorators) {
    if (content.includes(`@${dec}`)) {
      nestConfidence += 0.15
      nestPatterns.push(`@${dec}`)
    }
  }
  if (content.includes("@nestjs/common") || content.includes("@nestjs/core")) {
    nestConfidence += 0.3
    nestPatterns.push("nestjs-import")
  }

  if (nestConfidence > 0) {
    return {
      name: "nestjs",
      confidence: Math.min(nestConfidence, 1),
      patterns: nestPatterns,
    }
  }

  return undefined
}

function detectFastify(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Fastify Detection
  const fastifyPatterns: string[] = []
  let fastifyConfidence = 0

  if (
    content.includes("from 'fastify'") ||
    content.includes('from "fastify"') ||
    content.includes("require('fastify')") ||
    content.includes('require("fastify")')
  ) {
    fastifyConfidence += 0.4
    fastifyPatterns.push("fastify-import")
  }
  if (content.includes("fastify.get(") || content.includes("fastify.post(") || content.includes("fastify.route(")) {
    fastifyConfidence += 0.3
    fastifyPatterns.push("route-handlers")
  }
  if (content.includes("fastify.register(") || content.includes("fp(")) {
    fastifyConfidence += 0.2
    fastifyPatterns.push("plugins")
  }
  if (content.includes("FastifyRequest") || content.includes("FastifyReply")) {
    fastifyConfidence += 0.2
    fastifyPatterns.push("types")
  }

  if (fastifyConfidence > 0) {
    return {
      name: "fastify",
      confidence: Math.min(fastifyConfidence, 1),
      patterns: fastifyPatterns,
    }
  }

  return undefined
}

function detectExpress(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Express Detection
  const expressPatterns: string[] = []
  let expressConfidence = 0

  if (
    content.includes("from 'express'") ||
    content.includes('from "express"') ||
    content.includes("require('express')") ||
    content.includes('require("express")')
  ) {
    expressConfidence += 0.4
    expressPatterns.push("express-import")
  }
  if (content.includes("app.get(") || content.includes("app.post(") || content.includes("app.use(")) {
    expressConfidence += 0.3
    expressPatterns.push("route-handlers")
  }
  if (content.includes("req, res") || content.includes("req: Request") || content.includes("res: Response")) {
    expressConfidence += 0.2
    expressPatterns.push("request-response")
  }
  if (content.includes("express.Router()") || content.includes("Router()")) {
    expressConfidence += 0.2
    expressPatterns.push("router")
  }

  if (expressConfidence > 0) {
    return {
      name: "express",
      confidence: Math.min(expressConfidence, 1),
      patterns: expressPatterns,
    }
  }

  return undefined
}

function detectAngular(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Angular Detection
  const angularPatterns: string[] = []
  let angularConfidence = 0

  if (content.includes("@angular/core") || content.includes("@angular/common")) {
    angularConfidence += 0.4
    angularPatterns.push("angular-import")
  }
  const angularDecorators = ["Component", "NgModule", "Injectable", "Directive", "Pipe", "Input", "Output"]
  for (const dec of angularDecorators) {
    if (content.includes(`@${dec}(`)) {
      angularConfidence += 0.1
      angularPatterns.push(`@${dec}`)
    }
  }

  if (angularConfidence > 0) {
    return {
      name: "angular",
      confidence: Math.min(angularConfidence, 1),
      patterns: angularPatterns,
    }
  }

  return undefined
}

function detectJestVitest(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Jest/Vitest Detection
  const testPatterns: string[] = []
  let testConfidence = 0

  if (content.includes("describe(") && (content.includes("it(") || content.includes("test("))) {
    testConfidence += 0.5
    testPatterns.push("test-suite")
  }
  if (content.includes("expect(") && (content.includes(".toBe(") || content.includes(".toEqual("))) {
    testConfidence += 0.3
    testPatterns.push("assertions")
  }
  if (content.includes("beforeEach") || content.includes("afterEach") || content.includes("beforeAll")) {
    testConfidence += 0.1
    testPatterns.push("lifecycle")
  }
  if (content.includes("jest.mock") || content.includes("vi.mock") || content.includes("spyOn")) {
    testConfidence += 0.2
    testPatterns.push("mocking")
  }

  if (testConfidence > 0) {
    const testFramework = content.includes("vitest") ? "vitest" : "jest"
    return {
      name: testFramework,
      confidence: Math.min(testConfidence, 1),
      patterns: testPatterns,
    }
  }

  return undefined
}

function detectDrizzle(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Drizzle Detection
  const drizzlePatterns: string[] = []
  let drizzleConfidence = 0

  if (content.includes("from 'drizzle-orm'") || content.includes('from "drizzle-orm"')) {
    drizzleConfidence += 0.4
    drizzlePatterns.push("drizzle-import")
  }
  if (content.includes("pgTable(") || content.includes("mysqlTable(") || content.includes("sqliteTable(")) {
    drizzleConfidence += 0.4
    drizzlePatterns.push("table-definition")
  }
  if (content.includes("eq(") || content.includes("and(") || content.includes("or(") || content.includes("desc(")) {
    drizzleConfidence += 0.2
    drizzlePatterns.push("query-operators")
  }
  if (content.includes(".select(") || content.includes(".insert(") || content.includes(".update(")) {
    drizzleConfidence += 0.2
    drizzlePatterns.push("query-builder")
  }

  if (drizzleConfidence > 0) {
    return {
      name: "drizzle",
      confidence: Math.min(drizzleConfidence, 1),
      patterns: drizzlePatterns,
    }
  }

  return undefined
}

function detectTypeorm(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // TypeORM Detection
  const typeormPatterns: string[] = []
  let typeormConfidence = 0

  if (content.includes("from 'typeorm'") || content.includes('from "typeorm"')) {
    typeormConfidence += 0.4
    typeormPatterns.push("typeorm-import")
  }
  const typeormDecorators = [
    "Entity",
    "PrimaryGeneratedColumn",
    "Column",
    "OneToMany",
    "ManyToOne",
    "ManyToMany",
    "JoinColumn",
  ]
  for (const dec of typeormDecorators) {
    if (content.includes(`@${dec}`)) {
      typeormConfidence += 0.15
      typeormPatterns.push(`@${dec}`)
    }
  }
  if (content.includes("Repository<") || content.includes("DataSource")) {
    typeormConfidence += 0.2
    typeormPatterns.push("repository/datasource")
  }

  if (typeormConfidence > 0) {
    return {
      name: "typeorm",
      confidence: Math.min(typeormConfidence, 1),
      patterns: typeormPatterns,
    }
  }

  return undefined
}

function detectPrisma(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Prisma Detection
  const prismaPatterns: string[] = []
  let prismaConfidence = 0

  if (content.includes("@prisma/client") || content.includes("PrismaClient")) {
    prismaConfidence += 0.5
    prismaPatterns.push("prisma-client")
  }
  if (
    content.includes("prisma.") &&
    (content.includes(".findMany") || content.includes(".findUnique") || content.includes(".create"))
  ) {
    prismaConfidence += 0.3
    prismaPatterns.push("prisma-queries")
  }

  if (prismaConfidence > 0) {
    return {
      name: "prisma",
      confidence: Math.min(prismaConfidence, 1),
      patterns: prismaPatterns,
    }
  }

  return undefined
}

function detectNextjs(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Next.js Detection
  const nextPatterns: string[] = []
  let nextConfidence = 0

  if (content.includes("next/") || content.includes("from 'next'") || content.includes('from "next"')) {
    nextConfidence += 0.4
    nextPatterns.push("next-import")
  }
  if (
    content.includes("getServerSideProps") ||
    content.includes("getStaticProps") ||
    content.includes("getStaticPaths")
  ) {
    nextConfidence += 0.3
    nextPatterns.push("data-fetching")
  }
  if (content.includes("useRouter") || content.includes("next/router") || content.includes("next/navigation")) {
    nextConfidence += 0.2
    nextPatterns.push("routing")
  }

  if (nextConfidence > 0) {
    return {
      name: "nextjs",
      confidence: Math.min(nextConfidence, 1),
      patterns: nextPatterns,
    }
  }

  return undefined
}

function detectSvelte(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Svelte Detection
  const sveltePatterns: string[] = []
  let svelteConfidence = 0
  if (content.includes("from 'svelte'") || content.includes('from "svelte"')) {
    svelteConfidence += 0.4
    sveltePatterns.push("svelte-import")
  }
  if (content.includes("createEventDispatcher") || content.includes("onMount")) {
    svelteConfidence += 0.3
    sveltePatterns.push("svelte-lifecycle")
  }
  if (svelteConfidence > 0) {
    return { name: "svelte", confidence: Math.min(svelteConfidence, 1), patterns: sveltePatterns }
  }

  return undefined
}

function detectNuxt(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Nuxt Detection
  const nuxtPatterns: string[] = []
  let nuxtConfidence = 0
  if (content.includes("defineNuxtConfig") || content.includes("useNuxtApp") || content.includes("useAsyncData")) {
    nuxtConfidence += 0.5
    nuxtPatterns.push("nuxt-api")
  }
  if (nuxtConfidence > 0) {
    return { name: "nuxt", confidence: Math.min(nuxtConfidence, 1), patterns: nuxtPatterns }
  }

  return undefined
}

function detectMongoose(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Mongoose Detection
  const mongoosePatterns: string[] = []
  let mongooseConfidence = 0
  if (content.includes("from 'mongoose'") || content.includes("require('mongoose')")) {
    mongooseConfidence += 0.4
    mongoosePatterns.push("mongoose-import")
  }
  if (content.includes("new Schema(") || content.includes("mongoose.model(")) {
    mongooseConfidence += 0.4
    mongoosePatterns.push("mongoose-schema")
  }
  if (mongooseConfidence > 0) {
    return { name: "mongoose", confidence: Math.min(mongooseConfidence, 1), patterns: mongoosePatterns }
  }

  return undefined
}

function detectSequelize(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Sequelize Detection
  const sequelizePatterns: string[] = []
  let sequelizeConfidence = 0
  if (content.includes("from 'sequelize'") || content.includes("require('sequelize')")) {
    sequelizeConfidence += 0.4
    sequelizePatterns.push("sequelize-import")
  }
  if (content.includes("Model.init(") || content.includes("sequelize.define(")) {
    sequelizeConfidence += 0.4
    sequelizePatterns.push("sequelize-model")
  }
  if (sequelizeConfidence > 0) {
    return { name: "sequelize", confidence: Math.min(sequelizeConfidence, 1), patterns: sequelizePatterns }
  }

  return undefined
}

function detectSolidjs(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Solid.js Detection
  const solidPatterns: string[] = []
  let solidConfidence = 0
  if (content.includes("from 'solid-js'") || content.includes('from "solid-js"')) {
    solidConfidence += 0.4
    solidPatterns.push("solid-import")
  }
  if (content.includes("createSignal") || content.includes("createMemo") || content.includes("createResource")) {
    solidConfidence += 0.3
    solidPatterns.push("solid-primitives")
  }
  if (content.includes("onMount") || content.includes("onCleanup") || content.includes("createEffect")) {
    solidConfidence += 0.2
    solidPatterns.push("solid-lifecycle")
  }
  if (solidConfidence > 0) {
    return { name: "solid", confidence: Math.min(solidConfidence, 1), patterns: solidPatterns }
  }

  return undefined
}

function detectQwik(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Qwik Detection
  const qwikPatterns: string[] = []
  let qwikConfidence = 0
  if (content.includes("from '@builder.io/qwik'") || content.includes('from "@builder.io/qwik"')) {
    qwikConfidence += 0.4
    qwikPatterns.push("qwik-import")
  }
  if (content.includes("component$") || content.includes("useSignal") || content.includes("useStore")) {
    qwikConfidence += 0.3
    qwikPatterns.push("qwik-api")
  }
  if (content.includes("useTask$") || content.includes("useResource$") || content.includes("routeLoader$")) {
    qwikConfidence += 0.2
    qwikPatterns.push("qwik-lifecycle")
  }
  if (qwikConfidence > 0) {
    return { name: "qwik", confidence: Math.min(qwikConfidence, 1), patterns: qwikPatterns }
  }

  return undefined
}

function detectAstro(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Astro Detection
  const astroPatterns: string[] = []
  let astroConfidence = 0
  if (content.includes("from 'astro:") || content.includes('from "astro:')) {
    astroConfidence += 0.4
    astroPatterns.push("astro-import")
  }
  if (content.includes("Astro.props") || content.includes("Astro.request") || content.includes("Astro.url")) {
    astroConfidence += 0.3
    astroPatterns.push("astro-globals")
  }
  if (content.includes("getStaticPaths") || content.includes("defineConfig")) {
    astroConfidence += 0.2
    astroPatterns.push("astro-config")
  }
  if (astroConfidence > 0) {
    return { name: "astro", confidence: Math.min(astroConfidence, 1), patterns: astroPatterns }
  }

  return undefined
}

function detectRemix(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Remix Detection
  const remixPatterns: string[] = []
  let remixConfidence = 0
  if (content.includes("from '@remix-run/") || content.includes('from "@remix-run/')) {
    remixConfidence += 0.4
    remixPatterns.push("remix-import")
  }
  if (content.includes("useLoaderData") || content.includes("useActionData") || content.includes("useFetcher")) {
    remixConfidence += 0.3
    remixPatterns.push("remix-hooks")
  }
  if (
    content.includes("export const loader") ||
    content.includes("export const action") ||
    content.includes("export const meta")
  ) {
    remixConfidence += 0.3
    remixPatterns.push("remix-exports")
  }
  if (remixConfidence > 0) {
    return { name: "remix", confidence: Math.min(remixConfidence, 1), patterns: remixPatterns }
  }

  return undefined
}

function detectSveltekit(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // SvelteKit Detection
  const svelteKitPatterns: string[] = []
  let svelteKitConfidence = 0
  if (content.includes("from '$app/") || content.includes('from "$app/')) {
    svelteKitConfidence += 0.4
    svelteKitPatterns.push("sveltekit-import")
  }
  if (
    content.includes("export const load") ||
    content.includes("export const actions") ||
    content.includes("export const prerender")
  ) {
    svelteKitConfidence += 0.3
    svelteKitPatterns.push("sveltekit-exports")
  }
  if (content.includes("$page") || content.includes("$updated") || content.includes("goto")) {
    svelteKitConfidence += 0.2
    svelteKitPatterns.push("sveltekit-stores")
  }
  if (svelteKitConfidence > 0) {
    return { name: "sveltekit", confidence: Math.min(svelteKitConfidence, 1), patterns: svelteKitPatterns }
  }

  return undefined
}

function detectVite(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Vite Detection
  const vitePatterns: string[] = []
  let viteConfidence = 0
  if (content.includes("import.meta.env") || content.includes("import.meta.hot")) {
    viteConfidence += 0.3
    vitePatterns.push("vite-meta")
  }
  if (content.includes("defineConfig") && content.includes("vite")) {
    viteConfidence += 0.4
    vitePatterns.push("vite-config")
  }
  if (content.includes("from 'vite'") || content.includes('from "vite"')) {
    viteConfidence += 0.3
    vitePatterns.push("vite-import")
  }
  if (viteConfidence > 0) {
    return { name: "vite", confidence: Math.min(viteConfidence, 1), patterns: vitePatterns }
  }

  return undefined
}

function detectTanstackQuery(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // TanStack Query Detection
  const tanstackQueryPatterns: string[] = []
  let tanstackQueryConfidence = 0
  if (content.includes("from '@tanstack/react-query'") || content.includes('from "@tanstack/react-query"')) {
    tanstackQueryConfidence += 0.4
    tanstackQueryPatterns.push("tanstack-import")
  }
  if (content.includes("useQuery") || content.includes("useMutation") || content.includes("useQueryClient")) {
    tanstackQueryConfidence += 0.3
    tanstackQueryPatterns.push("tanstack-hooks")
  }
  if (content.includes("QueryClient") || content.includes("queryKey") || content.includes("invalidateQueries")) {
    tanstackQueryConfidence += 0.2
    tanstackQueryPatterns.push("tanstack-client")
  }
  if (tanstackQueryConfidence > 0) {
    return {
      name: "tanstack-query",
      confidence: Math.min(tanstackQueryConfidence, 1),
      patterns: tanstackQueryPatterns,
    }
  }

  return undefined
}

function detectZustand(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // Zustand Detection
  const zustandPatterns: string[] = []
  let zustandConfidence = 0
  if (content.includes("from 'zustand'") || content.includes('from "zustand"')) {
    zustandConfidence += 0.4
    zustandPatterns.push("zustand-import")
  }
  if (content.includes("create(") && content.includes("set") && content.includes("get")) {
    zustandConfidence += 0.3
    zustandPatterns.push("zustand-store")
  }
  if (content.includes("subscribeWithSelector") || content.includes("persist") || content.includes("devtools")) {
    zustandConfidence += 0.2
    zustandPatterns.push("zustand-middleware")
  }
  if (zustandConfidence > 0) {
    return { name: "zustand", confidence: Math.min(zustandConfidence, 1), patterns: zustandPatterns }
  }

  return undefined
}

function detectTrpc(content: string, symbols: UniversalSymbol[]): FrameworkInfo | undefined {
  // tRPC Detection
  const trpcPatterns: string[] = []
  let trpcConfidence = 0
  if (content.includes("from '@trpc/") || content.includes('from "@trpc/')) {
    trpcConfidence += 0.4
    trpcPatterns.push("trpc-import")
  }
  if (
    content.includes("createTRPCRouter") ||
    content.includes("publicProcedure") ||
    content.includes("protectedProcedure")
  ) {
    trpcConfidence += 0.4
    trpcPatterns.push("trpc-router")
  }
  if (content.includes("createTRPCClient") || content.includes("trpc.")) {
    trpcConfidence += 0.2
    trpcPatterns.push("trpc-client")
  }
  if (trpcConfidence > 0) {
    return { name: "trpc", confidence: Math.min(trpcConfidence, 1), patterns: trpcPatterns }
  }

  return undefined
}

