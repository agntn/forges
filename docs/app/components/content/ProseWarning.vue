<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <ForgesCallout kind="warning" :title="title"><slot mdc-unwrap="p" /></ForgesCallout>
</template>
