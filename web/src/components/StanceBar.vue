<script setup lang="ts">
import { computed } from "vue";
import { fmt } from "@/api";

const props = defineProps<{ support: number; oppose: number; mixed: number; unclear: number; legend?: boolean }>();

const COLORS = { support: "bg-emerald-500", oppose: "bg-rose-500", mixed: "bg-amber-400", unclear: "bg-zinc-300" } as const;

const parts = computed(() => {
  const total = props.support + props.oppose + props.mixed + props.unclear || 1;
  return (["support", "oppose", "mixed", "unclear"] as const)
    .map((k) => ({ k, n: props[k], pct: (100 * props[k]) / total, color: COLORS[k] }))
    .filter((p) => p.n > 0);
});
const title = computed(() => parts.value.map((p) => `${p.k} ${fmt(p.n)}`).join(" · "));
</script>

<template>
  <div>
    <div class="flex h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-muted" :title="title">
      <span v-for="p in parts" :key="p.k" :class="p.color" :style="{ width: p.pct + '%' }" />
    </div>
    <div v-if="legend" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span v-for="p in parts" :key="p.k" class="inline-flex items-center gap-1.5">
        <span class="size-2 rounded-full" :class="p.color" />{{ p.k }}
        <span class="font-medium text-foreground tabular-nums">{{ fmt(p.n) }}</span>
      </span>
    </div>
  </div>
</template>
