<script lang="ts" setup>
import { PLATFORMS } from "../../utils/platforms";

/**
 * Overrides the Docus template of the same name with an instrument: the bar with the section as a
 * tag and the hatched mark, the ruler, the page in the body, the resources in the footer. Takumi
 * reads no CSS variables, so the palette from app.css is repeated as literals.
 */
const { title, description, headline } = defineProps<{
  title?: string;
  description?: string;
  headline?: string;
}>();

const { name: siteName } = useSiteConfig();

/** A platform page shows the platform's facts. The description would arrive with its commas stripped. */
const entry = PLATFORMS.find((row) => row.label === title);

const subtitle = entry
  ? `Header ${entry.authHeader}. Anonymous reads ${entry.anonymousReads}. Threads over ${entry.threads.split(",")[0]}.`
  : (description ?? "").slice(0, 160);

/** Each chip is one whole string, since Takumi drops static text sitting next to an interpolation. */
const chips = entry
  ? [`createProvider("${entry.key}")`, ...entry.envVars.slice(0, 2)]
  : ["repos", "issues", "pullRequests", "threads", "ciRuns"];

const LINE = "#262c35";
const CORNER = "#5b636d";
</script>

<template>
  <div
    class="w-full h-full flex px-[56px] py-[52px]"
    style="background-color: #0b0d10; font-family: &quot;Figtree&quot;; color: #d5e4ee"
  >
    <div
      class="absolute top-0 left-0 w-[900px] h-[520px]"
      style="
        background-image: radial-gradient(
          ellipse at top left,
          rgba(252, 211, 77, 0.14) 0%,
          rgba(252, 211, 77, 0.04) 45%,
          transparent 70%
        );
      "
    />
    <p
      class="absolute m-0 top-[36px] left-[48px] text-[18px]"
      :style="{ fontFamily: 'Fira Code', color: CORNER }"
    >
      +
    </p>
    <p
      class="absolute m-0 bottom-[36px] right-[48px] text-[18px]"
      :style="{ fontFamily: 'Fira Code', color: CORNER }"
    >
      +
    </p>

    <div
      class="flex flex-col w-full h-full"
      :style="{ border: `1px solid ${LINE}`, backgroundColor: 'rgba(11, 13, 16, 0.6)' }"
    >
      <!-- Bar: the section as a boxed tag, the package, the hatched mark. -->
      <div
        class="flex items-center justify-between px-[28px] h-[64px]"
        :style="{ backgroundColor: '#11141a', borderBottom: `1px solid ${LINE}` }"
      >
        <div class="flex items-center">
          <p
            class="m-0 px-[10px] py-[3px] text-[16px] tracking-[0.1em] uppercase"
            :style="{
              fontFamily: 'Fira Code',
              color: '#fcd34d',
              border: '1px solid rgba(252, 211, 77, 0.55)',
            }"
          >
            {{ headline || "Guide" }}
          </p>
          <p
            class="m-0 ml-[16px] text-[20px]"
            style="font-family: &quot;Fira Code&quot;; color: #f0f4f8"
          >
            {{ siteName }}
          </p>
        </div>
        <div
          class="w-[48px] h-[10px]"
          style="
            background-image: repeating-linear-gradient(
              135deg,
              #5b636d 0px,
              #5b636d 1.5px,
              transparent 1.5px,
              transparent 5px
            );
          "
        />
      </div>
      <!-- Ruler: a tick every 12 px under the bar. -->
      <div
        class="w-full h-[6px]"
        style="
          background-image: repeating-linear-gradient(
            90deg,
            #3a424d 0px,
            #3a424d 1px,
            transparent 1px,
            transparent 12px
          );
        "
      />

      <div class="flex-1 flex flex-col justify-center px-[28px]">
        <h1
          v-if="title"
          class="m-0 mb-[20px] text-[60px] font-medium leading-[1.06] tracking-[-0.03em] w-full max-w-[960px]"
          style="color: #f0f4f8"
        >
          {{ title.slice(0, 60) }}
        </h1>
        <p
          v-if="subtitle"
          class="m-0 text-[26px] leading-[1.4] w-full max-w-[920px]"
          style="color: #8a97a5"
        >
          {{ subtitle }}
        </p>
      </div>

      <!-- Footer: the tools as boxed identifiers, the site on the right. -->
      <div
        class="flex items-center justify-between px-[28px] h-[60px]"
        :style="{ borderTop: `1px solid ${LINE}` }"
      >
        <div class="flex items-center">
          <p
            v-for="tool in chips"
            :key="tool"
            class="m-0 mr-[10px] px-[8px] py-[3px] text-[14px]"
            :style="{
              fontFamily: 'Fira Code',
              color: '#a5b0bc',
              border: `1px solid ${LINE}`,
              whiteSpace: 'nowrap',
            }"
          >
            {{ tool }}
          </p>
        </div>
        <p
          class="m-0 text-[15px]"
          style="font-family: &quot;Fira Code&quot;; color: #7d8590; white-space: nowrap"
        >
          forges.agntn.dev
        </p>
      </div>
    </div>
  </div>
</template>
