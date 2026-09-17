import { resolve } from "node:path";

/** Bundled from the checkout's sources: a deploy needs neither dist/ nor the root node_modules. */
const librarySource = resolve(import.meta.dirname, "../src");

export default defineNuxtConfig({
  extends: ["docus"],
  /** The repo root is its own pnpm workspace; Nuxt must not treat it as this site's. */
  workspaceDir: import.meta.dirname,
  alias: {
    "@agntn/forges": resolve(librarySource, "index.ts"),
  },
  devtools: { enabled: false },
  telemetry: false,
  site: {
    url: "https://forges.agntn.dev",
    name: "@agntn/forges",
  },
  llms: {
    domain: "https://forges.agntn.dev",
  },
  /** Docus pages define their own OG images; the alt text is the one thing they leave unset. */
  ogImage: {
    defaults: {
      alt: "@agntn/forges: one TypeScript API over GitHub, GitLab, Gitea and GitBucket",
    },
  },
  icon: {
    clientBundle: {
      icons: [
        "lucide:arrow-right",
        "lucide:arrow-up-right",
        "lucide:book-open",
        "lucide:bot",
        "lucide:check",
        "lucide:chevron-left",
        "lucide:chevron-right",
        "lucide:circle-dot",
        "lucide:copy",
        "lucide:external-link",
        "lucide:file-diff",
        "lucide:file-text",
        "lucide:folder-git-2",
        "lucide:git-commit-horizontal",
        "lucide:git-pull-request",
        "lucide:key-round",
        "lucide:library",
        "lucide:loader-circle",
        "lucide:message-square",
        "lucide:messages-square",
        "lucide:play-circle",
        "lucide:plus",
        "lucide:search-code",
        "lucide:server",
        "lucide:shield-alert",
        "lucide:terminal",
        "lucide:user",
        "lucide:x",
        "simple-icons:codeberg",
        "simple-icons:forgejo",
        "simple-icons:gitea",
        "simple-icons:github",
        "simple-icons:gitlab",
        "simple-icons:npm",
        "vscode-icons:file-type-js",
        "vscode-icons:file-type-typescript",
        "vscode-icons:file-type-json",
        "vscode-icons:file-type-shell",
      ],
    },
  },
  colorMode: {
    preference: "dark",
  },
  /** Docus links /favicon.ico without shipping one; the icons and manifest are cut from public/favicon.svg. */
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
      meta: [
        { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#0b0d10" },
        { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#eef1f4" },
        { name: "apple-mobile-web-app-title", content: "forges" },
        { name: "author", content: "oritwoen" },
        { property: "og:locale", content: "en_US" },
      ],
    },
  },
  /** Docus ships an MCP endpoint that needs the Cloudflare Agents SDK on Workers. The docs do not need it. */
  mcp: {
    enabled: false,
  },
  nitro: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-09-03",
    prerender: {
      crawlLinks: true,
      routes: ["/", "/explorer", "/sitemap.xml", "/robots.txt", "/llms.txt", "/llms-full.txt"],
      ignore: ["/api"],
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  compatibilityDate: "2026-09-03",
  /** In production the response cache lives in KV, so it survives isolates. */
  $production: {
    nitro: {
      storage: {
        cache: {
          driver: "cloudflare-kv-binding",
          binding: "CACHE",
        },
      },
    },
  },
  /** Fonts live in public/fonts and app/assets/fonts.css, which is the only place nuxt-og-image reads them from. */
  css: ["~/assets/fonts.css"],
  fonts: {
    families: [
      { name: "Space Grotesk", provider: "local", weights: [400, 500, 600] },
      { name: "Space Mono", provider: "local", weights: [400, 700] },
    ],
  },
  content: {
    database: {
      type: "d1",
      bindingName: "DB",
    },
    build: {
      markdown: {
        highlight: {
          theme: {
            default: "github-light",
            light: "github-light",
            dark: "poimandres",
          },
        },
      },
    },
  },
});
