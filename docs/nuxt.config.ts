import { resolve } from "node:path";
import { forgesTheme } from "./shiki-theme";

/** Bundled from the checkout's sources: no dist/ needed, their imports resolve from the root. */
const librarySource = resolve(import.meta.dirname, "../src");

export default defineNuxtConfig({
  extends: ["docus"],
  alias: {
    "@agntn/forges": resolve(librarySource, "index.ts"),
  },
  devtools: { enabled: false },
  telemetry: false,
  site: {
    url: "https://forges.agntn.dev",
    name: "@agntn/forges",
  },
  /** The explorer has no markdown twin, so agents get the page itself, not a `/raw` 404. */
  agentDiscovery: {
    excludePrefixes: { extend: ["/explorer"] },
  },
  /** Docus lists `content/` only and leaves app routes out, so the explorer comes from here. */
  sitemap: {
    sources: ["/api/__sitemap__/pages"],
  },
  /** Spelled out, or agent discovery piles every page into one list and titles the landing `/`. */
  llms: {
    sections: [
      {
        title: "Guide",
        contentCollection: "docs",
        contentFilters: [{ field: "path", operator: "LIKE", value: "/guide%" }],
      },
      {
        title: "Platforms",
        contentCollection: "docs",
        contentFilters: [{ field: "path", operator: "LIKE", value: "/platforms%" }],
      },
      {
        title: "Explorer",
        links: [
          {
            title: "Explorer",
            href: "https://forges.agntn.dev/explorer",
            description:
              "Read a repository, its issues, pull requests, commits, CI runs and review threads on GitHub, GitLab or Gitea through the docs worker, in the normalized shape.",
          },
        ],
      },
    ],
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
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  /** Nuxt's own prerender option; `nitro.prerender` is deprecated since 4.6. */
  prerender: {
    crawlLinks: true,
    routes: ["/", "/explorer", "/sitemap.xml", "/robots.txt", "/llms.txt", "/llms-full.txt"],
    ignore: ["/api"],
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
      { name: "Figtree", provider: "local", weights: [400, 500] },
      { name: "Fira Code", provider: "local", weights: [400, 500] },
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
            default: forgesTheme,
            light: forgesTheme,
            dark: forgesTheme,
          },
        },
      },
    },
  },
});
