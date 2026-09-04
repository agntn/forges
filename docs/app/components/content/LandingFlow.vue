<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { clip } from "../../utils/format";
import { PLATFORMS } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample; tick: number }>();

const W = 1200;
const H = 400;
const CALL = { x: 24, y: 120, w: 340, h: 160 };
const NODE = { x: 510, w: 200, h: 44, gap: 22 };
const RESULT = { x: 870, y: 20, w: 306, h: 360 };

const nodes = computed(() =>
  PLATFORMS.map((platform, index) => ({
    ...platform,
    y: 68 + index * (NODE.h + NODE.gap),
    active: platform.slug === props.sample.platform,
  })),
);

function curvePath(x1: number, y1: number, x2: number, y2: number) {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

const trunkPaths = computed(() =>
  nodes.value.map((node) => ({
    d: curvePath(CALL.x + CALL.w, CALL.y + CALL.h / 2, NODE.x, node.y + NODE.h / 2),
    active: node.active,
  })),
);

const branchPaths = computed(() =>
  nodes.value.map((node) => ({
    d: curvePath(NODE.x + NODE.w, node.y + NODE.h / 2, RESULT.x, RESULT.y + RESULT.h / 2),
    active: node.active,
  })),
);

const fields = computed(() => {
  const repo = props.sample.repository;
  return [
    { label: "fullName", value: clip(repo.fullName, 30) },
    { label: "defaultBranch", value: repo.defaultBranch },
    { label: "private", value: String(repo.private) },
    { label: "isFork", value: String(repo.isFork) },
    { label: "parent", value: repo.parent ? clip(repo.parent.fullName, 30) : "null" },
    { label: "url", value: clip(repo.url.replace(/^https?:\/\//u, ""), 30) },
  ];
});

const slug = computed(() => `${props.sample.owner}/${props.sample.repo}`);

/** Space Mono is about 0.62 em wide per glyph; shrink the slug until it fits the box. */
const slugFontSize = computed(() =>
  Math.min(22, Math.floor((CALL.w - 36) / (slug.value.length * 0.62))),
);
</script>

<template>
  <svg
    :viewBox="`0 0 ${W} ${H}`"
    class="forges-flow"
    role="img"
    aria-label="One repos.get call is routed to the platform's API and comes back as one Repository shape"
  >
    <g class="forges-flow-wires">
      <path
        v-for="(path, index) in trunkPaths"
        :key="`t${index}`"
        :d="path.d"
        :class="{ 'forges-flow-wire-dim': !path.active }"
      />
      <path
        v-for="(path, index) in branchPaths"
        :key="`b${index}`"
        :d="path.d"
        :class="{ 'forges-flow-wire-dim': !path.active }"
      />
    </g>
    <g :key="tick" class="forges-flow-pulses">
      <template v-for="(path, index) in trunkPaths" :key="`pt${index}`">
        <path v-if="path.active" :d="path.d" class="forges-flow-pulse" />
      </template>
      <template v-for="(path, index) in branchPaths" :key="`pb${index}`">
        <path v-if="path.active" :d="path.d" class="forges-flow-pulse forges-flow-pulse-late" />
      </template>
    </g>

    <g class="forges-flow-node">
      <rect :x="CALL.x" :y="CALL.y" :width="CALL.w" :height="CALL.h" rx="10" />
      <text :x="CALL.x + 18" :y="CALL.y + 30" class="forges-flow-label">
        repos.get(owner, repo)
      </text>
      <text
        :x="CALL.x + 18"
        :y="CALL.y + 72"
        class="forges-flow-domain forges-flow-accent"
        :style="{ fontSize: `${slugFontSize}px` }"
      >
        <tspan :key="slug" class="forges-derive">{{ slug }}</tspan>
      </text>
      <text :x="CALL.x + 18" :y="CALL.y + 104" class="forges-flow-mono">
        createProvider("{{ sample.platform }}")
      </text>
      <text :x="CALL.x + 18" :y="CALL.y + 130" class="forges-flow-label">
        {{ sample.host }} · {{ sample.live ? "live" : "sample" }}
      </text>
    </g>

    <g
      v-for="node in nodes"
      :key="node.slug"
      class="forges-flow-node"
      :class="{ 'forges-flow-dim': !node.active }"
    >
      <rect :x="NODE.x" :y="node.y" :width="NODE.w" :height="NODE.h" rx="7" />
      <text :x="NODE.x + 14" :y="node.y + 20" class="forges-flow-small">{{ node.label }}</text>
      <text :x="NODE.x + 14" :y="node.y + 35" class="forges-flow-label">{{ node.authHeader }}</text>
    </g>

    <g class="forges-flow-node">
      <rect :x="RESULT.x" :y="RESULT.y" :width="RESULT.w" :height="RESULT.h" rx="10" />
      <text :x="RESULT.x + 18" :y="RESULT.y + 28" class="forges-flow-label">Repository</text>
      <text
        :x="RESULT.x + RESULT.w - 18"
        :y="RESULT.y + 28"
        text-anchor="end"
        class="forges-flow-mono"
      >
        id "{{ sample.repository.id }}"
      </text>
      <line
        :x1="RESULT.x + 1"
        :x2="RESULT.x + RESULT.w - 1"
        :y1="RESULT.y + 44"
        :y2="RESULT.y + 44"
        class="forges-flow-rule"
      />
      <g v-for="(field, index) in fields" :key="`${slug}-${field.label}`" class="forges-derive">
        <text :x="RESULT.x + 18" :y="RESULT.y + 70 + index * 52" class="forges-flow-label">
          {{ field.label }}
        </text>
        <text :x="RESULT.x + 18" :y="RESULT.y + 90 + index * 52" class="forges-flow-title">
          {{ field.value }}
        </text>
      </g>
    </g>
  </svg>
</template>
