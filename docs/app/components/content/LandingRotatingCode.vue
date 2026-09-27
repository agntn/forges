<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { platformInfo } from "../../utils/platforms";
import { tokens } from "../../utils/tokens";

const props = defineProps<{ sample: ForgeSample }>();
const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const { copied, copy } = useCopied();

const info = computed(() => platformInfo(props.sample.platform));

/** Every platform gets the same ten lines, so the file keeps one height while the sample walks. */
const lines = computed(() => {
  const { platform, owner, repo, baseURL, repository, pullRequests } = props.sample;
  const options = baseURL ? `, { baseURL: "${baseURL}" }` : "";
  const first = pullRequests.items[0]?.sourceBranch;
  return [
    'import { createProvider } from "@agntn/forges";',
    "",
    `// ${info.value?.envVars[0] ?? "a token"}, then ${info.value?.cli ?? "the CLI"}`,
    `const forge = await createProvider("${platform}"${options});`,
    "",
    `const repo = await forge.repos.get("${owner}", "${repo}");`,
    `const { items } = await forge.pullRequests.list("${owner}", "${repo}", { state: "open" });`,
    "",
    `repo.defaultBranch;      // "${repository.defaultBranch}"`,
    `items[0]?.sourceBranch;  // ${first === undefined ? "undefined, nothing open" : `"${first}"`}`,
  ];
});
</script>

<template>
  <section
    class="tool-console landing-file"
    aria-label="The same calls against one platform"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title file-name"
        ><span class="console-tag">File</span
        ><Transition name="forges-roll" mode="out-in"
          ><span :key="sample.platform" class="forges-roll-slot"
            >{{ sample.platform }}.ts</span
          ></Transition
        ></span
      >
      <span class="console-meta">{{ sample.host }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.platform" class="console-cursor" />
    </div>

    <div class="file-body">
      <p class="console-label console-rule-title">
        <span>Same calls <span aria-hidden="true">[ only the string changes ]</span></span>
        <span class="console-mark" aria-hidden="true" />
        <UButton
          color="neutral"
          variant="subtle"
          :icon="copied === 'file' ? 'i-lucide-check' : 'i-lucide-copy'"
          :label="copied === 'file' ? 'copied' : 'copy'"
          :aria-label="copied === 'file' ? 'Copied' : 'Copy the file'"
          @click="copy('file', lines.join('\n'))"
        />
      </p>
      <!-- prettier-ignore -->
      <pre class="console-snippet console-lines file-lines"><code><span v-for="(line, index) in lines" :key="index"><span class="file-code"><span v-for="(token, part) in tokens(line)" :key="part" :class="token.cls">{{ token.text }}</span></span></span></code></pre>
    </div>

    <footer class="console-footer console-footer-plain">
      <NuxtLink :to="info?.to ?? '/platforms'" class="file-link"
        ><span aria-hidden="true">→ </span>{{ info?.label ?? sample.platform
        }}<span> · {{ info?.to }}</span></NuxtLink
      >
      <div class="console-controls" aria-label="Sample platforms">
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-left"
          aria-label="Previous platform"
          @click="emit('step', -1)"
        />
        <span>Platform</span>
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-right"
          aria-label="Next platform"
          @click="emit('step', 1)"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-name :deep(.forges-roll-slot) {
  display: inline;
}
.file-body {
  padding: 14px 20px 16px;
}
.file-body > .console-rule-title {
  margin-bottom: 10px;
}
/* One line per code line whatever the sample: the number in its own column, a long value ends in an
   ellipsis there and never takes the number with it; copy hands out the whole line. */
.file-lines > code > span {
  display: grid;
  grid-template-columns: 2.25em minmax(0, 1fr);
  column-gap: 1em;
  padding-left: 0;
  text-indent: 0;
}
.file-lines > code > span::before {
  margin-right: 0;
}
.file-code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
}
.file-code :deep(*) {
  white-space: pre;
  overflow-wrap: normal;
}
.file-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.file-link > span:last-child {
  color: var(--ui-text-dimmed);
}
.file-link:hover {
  color: var(--console-accent);
}
.file-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 640px) {
  .file-body > .console-rule-title > .console-mark {
    display: none;
  }
}
@media (width < 400px) {
  .file-body {
    padding-inline: 14px;
  }
  .file-body > .console-rule-title > span:first-child > span {
    display: none;
  }
}
</style>
