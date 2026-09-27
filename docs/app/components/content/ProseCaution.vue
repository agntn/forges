<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <ForgesCallout kind="caution" :title="title"><slot mdc-unwrap="p" /></ForgesCallout>
</template>
