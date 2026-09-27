<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <ForgesCallout kind="note" :title="title"><slot mdc-unwrap="p" /></ForgesCallout>
</template>
