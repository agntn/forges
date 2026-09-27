<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <ForgesCallout kind="tip" :title="title"><slot mdc-unwrap="p" /></ForgesCallout>
</template>
