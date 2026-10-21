<script setup lang="ts">
import { Info } from "@lucide/vue";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

defineProps<{ label: string; value: string; note?: string; help: string; progress?: number }>();
</script>

<template>
  <Card size="sm">
    <CardContent>
      <div class="flex items-center gap-1 text-xs text-muted-foreground">
        {{ label }}
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="ml-auto rounded-full text-muted-foreground/70 hover:text-foreground" :aria-label="`What is ${label}?`">
              <Info class="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent class="max-w-64 text-xs leading-relaxed">{{ help }}</TooltipContent>
        </Tooltip>
      </div>
      <div class="mt-1 text-2xl font-semibold tabular-nums"><slot>{{ value }}</slot></div>
      <div v-if="note" class="text-xs text-muted-foreground">{{ note }}</div>
      <Progress v-if="progress !== undefined" class="mt-2 h-1.5" :model-value="progress" />
    </CardContent>
  </Card>
</template>
