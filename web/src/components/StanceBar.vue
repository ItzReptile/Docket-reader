<script setup lang="ts">
import { computed } from "vue";
import { fmt } from "../api";

const props = defineProps<{ support: number; oppose: number; mixed: number; unclear: number }>();
const parts = computed(() => {
  const total = props.support + props.oppose + props.mixed + props.unclear || 1;
  return (["support", "oppose", "mixed", "unclear"] as const)
    .map((k) => ({ k, n: props[k], pct: (100 * props[k]) / total }))
    .filter((p) => p.n > 0);
});
const title = computed(() => parts.value.map((p) => `${p.k} ${fmt(p.n)}`).join(" · "));
</script>

<template>
  <div class="bar" :title="title">
    <span v-for="p in parts" :key="p.k" :class="p.k" :style="{ width: p.pct + '%' }" />
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--line);
  min-width: 60px;
}
.support {
  background: var(--support);
}
.oppose {
  background: var(--oppose);
}
.mixed {
  background: var(--mixed);
}
.unclear {
  background: var(--unclear);
}
</style>
