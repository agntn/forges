export default defineAppConfig({
  docus: {
    colorMode: "dark",
  },
  seo: {
    title: "@agntn/forges",
    description:
      "One TypeScript API over GitHub, GitLab, Gitea and GitBucket: repos, issues, pull requests, review threads, commits and CI in one shape.",
    schema: {
      type: "SoftwareApplication",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Node.js",
      price: 0,
      sameAs: ["https://github.com/agntn/forges", "https://npmx.dev/package/@agntn/forges"],
      organization: {
        name: "agntn",
        url: "https://agntn.dev",
        logo: "https://agntn.dev/icon-512.png",
        sameAs: ["https://github.com/agntn", "https://npmx.dev/org/agntn"],
      },
    },
  },
  header: {
    title: "@agntn/forges",
  },
  github: {
    url: "https://github.com/agntn/forges",
    branch: "main",
    rootDir: "docs",
  },
  /** The GitHub link comes from `github.url`; listing it here too doubles the icon in the footer. */
  socials: {
    npm: "https://npmx.dev/package/@agntn/forges",
  },
  ui: {
    colors: {
      primary: "rose",
      neutral: "slate",
    },
    button: {
      slots: {
        base: "h-9 rounded-lg px-3.5 text-sm leading-none font-medium cursor-pointer transition-colors",
      },
      compoundVariants: [
        {
          color: "primary",
          variant: "solid",
          class: "forges-primary-fill ring-0",
        },
        {
          color: "neutral",
          variant: "outline",
          class: "forges-neutral-outline ring-0",
        },
      ],
    },
    pageHeader: {
      slots: {
        root: "py-8 border-b border-muted",
        headline: "forges-eyebrow mb-3",
        title: "text-3xl sm:text-4xl font-medium tracking-tight text-highlighted",
        description: "text-base leading-7 text-muted",
      },
    },
    /** Nuxt UI truncates TOC entries; headings here are sentences, so let them wrap. */
    contentToc: {
      slots: {
        linkText: "whitespace-normal",
      },
    },
    contentSurround: {
      slots: {
        link: "rounded-xl forges-frame border-0 bg-default hover:bg-muted",
        linkLeadingIcon: "text-muted",
      },
    },
    prose: {
      callout: {
        slots: {
          base: "rounded-xl px-4 py-3.5",
        },
      },
      card: {
        slots: {
          base: "rounded-xl forges-frame border-0 p-5 bg-default hover:bg-muted",
          icon: "size-5 mb-3 text-muted transition-colors group-hover:text-primary",
          title: "text-sm font-medium",
          description: "text-sm text-muted",
        },
      },
      cardGroup: {
        base: "grid grid-cols-1 sm:grid-cols-2 gap-3 my-5 *:my-0",
      },
      table: {
        slots: {
          root: "rounded-xl forges-frame",
        },
      },
      pre: {
        slots: {
          header: "border-default bg-default",
          base: "border-default bg-muted",
        },
      },
    },
    pageHero: {
      slots: {
        title: "font-medium tracking-tight",
        description: "text-base leading-7 sm:text-lg",
      },
    },
  },
});
