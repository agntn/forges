<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { platformInfo } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample }>();

const info = computed(() => platformInfo(props.sample.platform));
const fileName = computed(() => `${props.sample.platform}.ts`);
const envVar = computed(() => info.value?.envVars[0] ?? "a token");
const cli = computed(() => info.value?.cli ?? "the CLI");
const options = computed(() =>
  props.sample.baseURL ? `, { baseURL: "${props.sample.baseURL}" }` : "",
);
const first = computed(() => props.sample.pullRequests.items[0]);
</script>

<template>
  <div class="forges-frame overflow-hidden rounded-xl">
    <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
      <span class="font-mono text-[10px] font-bold text-primary">TS</span>
      <span class="text-sm text-default">
        <Transition name="forges-roll" mode="out-in">
          <span :key="fileName">{{ fileName }}</span>
        </Transition>
      </span>
    </div>
    <pre
      class="forges-rotating"
    ><code><span class="tok-kw">import</span> { createProvider } <span class="tok-kw">from</span> <span class="tok-str">"@agntn/forges"</span>;

<span class="tok-cm">// <Transition name="forges-roll" mode="out-in"><span :key="envVar" class="forges-roll-slot">{{ envVar }}</span></Transition>, then <Transition name="forges-roll" mode="out-in"><span :key="cli" class="forges-roll-slot">{{ cli }}</span></Transition></span>
<span class="tok-kw">const</span> forge = <span class="tok-fn">createProvider</span>(<span class="tok-str">"<Transition name="forges-roll" mode="out-in"><span :key="sample.platform" class="forges-roll-slot">{{ sample.platform }}</span></Transition>"</span><Transition name="forges-roll" mode="out-in"><span :key="options" class="forges-roll-slot">{{ options }}</span></Transition>);

<span class="tok-kw">const</span> repo = <span class="tok-kw">await</span> forge.repos.<span class="tok-fn">get</span>(<span class="tok-str">"<Transition name="forges-roll" mode="out-in"><span :key="sample.owner" class="forges-roll-slot">{{ sample.owner }}</span></Transition>"</span>, <span class="tok-str">"<Transition name="forges-roll" mode="out-in"><span :key="sample.repo" class="forges-roll-slot">{{ sample.repo }}</span></Transition>"</span>);
<span class="tok-kw">const</span> { items } = <span class="tok-kw">await</span> forge.pullRequests.<span class="tok-fn">list</span>(repo.owner.login, repo.name, { state: <span class="tok-str">"open"</span> });

repo.defaultBranch;      <span class="tok-cm">// "<Transition name="forges-roll" mode="out-in"><span :key="sample.repository.defaultBranch" class="forges-roll-slot">{{ sample.repository.defaultBranch }}</span></Transition>"</span>
items[0]?.sourceBranch;  <span class="tok-cm">// "<Transition name="forges-roll" mode="out-in"><span :key="first?.sourceBranch ?? 'none'" class="forges-roll-slot">{{ first?.sourceBranch ?? "" }}</span></Transition>", same PullRequest shape from <Transition name="forges-roll" mode="out-in"><span :key="sample.platform" class="forges-roll-slot">{{ info?.label ?? sample.platform }}</span></Transition></span></code></pre>
  </div>
</template>
