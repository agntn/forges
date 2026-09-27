<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { PLATFORMS, PROVIDER_PLATFORMS, type PlatformInfo } from "../../utils/platforms";
import { ROSTER_CLASS, ROSTER_TABLE_UI } from "../../utils/roster";

interface Row extends PlatformInfo {
  /** What `createProvider()` gets: the key, plus a baseURL when the platform borrows a provider. */
  readonly provider: string;
}

const rows: Row[] = PLATFORMS.map((platform) => ({
  ...platform,
  provider: platform.slug === platform.key ? platform.key : `${platform.key} + baseURL`,
}));

/** Empty until a header is clicked: the rows then keep the order of the platform pages. */
const sorting = ref<{ id: string; desc: boolean }[]>([]);

const roster = useTemplateRef<HTMLElement>("roster");
useRosterFlip(
  () => roster.value,
  () => sorting.value,
);

const columns: TableColumn<Row>[] = [
  {
    accessorKey: "label",
    header: "Platform",
    sortingFn: "text",
    meta: { class: { th: "w-[9.5rem]" } },
  },
  {
    accessorKey: "provider",
    header: "Provider",
    sortingFn: "text",
    meta: { class: { th: "w-[10rem]" } },
  },
  { accessorKey: "blurb", header: "About", enableSorting: false },
  {
    accessorKey: "authHeader",
    header: "Auth header",
    sortingFn: "text",
    meta: { class: { th: "w-[13rem]" } },
  },
];

const order = computed(() => {
  const [first] = sorting.value;
  if (first === undefined) return "page order";
  const label = columns.find(
    (column) => "accessorKey" in column && column.accessorKey === first.id,
  )?.header;
  return `by ${String(label).toLowerCase()} ${first.desc ? "descending" : "ascending"}`;
});
</script>

<template>
  <section ref="roster" class="roster not-prose my-6" aria-label="Platforms">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header :class="ROSTER_CLASS.bar">
      <span :class="ROSTER_CLASS.title">platforms()</span>
      <span :class="ROSTER_CLASS.meta"
        >{{ PLATFORMS.length }} platforms · {{ PROVIDER_PLATFORMS.length }} classes ·
        {{ order }}</span
      >
    </header>
    <div class="roster-ruler" aria-hidden="true" />
    <UTable
      v-model:sorting="sorting"
      :data="rows"
      :columns="columns"
      :get-row-id="(row) => row.slug"
      :ui="ROSTER_TABLE_UI"
    >
      <template #label-header="{ column }"
        ><RosterSort :column="column" label="Platform"
      /></template>
      <template #provider-header="{ column }"
        ><RosterSort :column="column" label="Provider"
      /></template>
      <template #authHeader-header="{ column }"
        ><RosterSort :column="column" label="Auth header"
      /></template>
      <template #label-cell="{ row }">
        <NuxtLink :to="row.original.to" :class="[ROSTER_CLASS.name, 'items-center']">
          <UIcon :name="row.original.icon" class="size-3.5 flex-none" aria-hidden="true" />
          <span class="truncate">{{ row.original.label }}</span>
        </NuxtLink>
      </template>
      <template #provider-cell="{ row }">
        <span :class="ROSTER_CLASS.id">{{ row.original.provider }}</span>
      </template>
      <template #blurb-cell="{ row }">
        <span :class="ROSTER_CLASS.about">{{ row.original.blurb }}</span>
      </template>
      <template #authHeader-cell="{ row }">
        <span :class="ROSTER_CLASS.count"
          ><span :class="ROSTER_CLASS.leader" aria-hidden="true" /><span
            class="whitespace-nowrap text-highlighted"
            >{{ row.original.authHeader }}</span
          ></span
        >
      </template>
    </UTable>
    <footer :class="ROSTER_CLASS.footer">
      <span>same ten resources on each / same shapes back</span>
      <NuxtLink to="/guide/custom" :class="ROSTER_CLASS.meta" class="hover:text-(--console-accent)"
        >→ your own provider</NuxtLink
      >
    </footer>
  </section>
</template>
