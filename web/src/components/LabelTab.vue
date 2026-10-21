<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, CircleCheck } from "@lucide/vue";
import { api, type CommentDetail, type Label as LabelRow, type Stance } from "@/api";
import { ui } from "@/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

const labels = ref<LabelRow[]>([]);
const index = ref(0);
const comment = ref<CommentDetail | null>(null);
const stance = ref<Stance | undefined>(undefined);
const text = ref("");
const saved = ref(false);

async function load() {
  const file = await api.labels();
  labels.value = file?.comments ?? [];
  const firstOpen = labels.value.findIndex((l) => l.stance === null);
  index.value = firstOpen === -1 ? 0 : firstOpen;
}
load();

const current = computed(() => labels.value[index.value] ?? null);
const done = computed(() => labels.value.filter((l) => l.stance !== null).length);

watch(current, async (l) => {
  saved.value = false;
  comment.value = l ? await api.comment(l.commentId, ui.model) : null;
  stance.value = l?.stance ?? undefined;
  text.value = l?.arguments.join("\n") ?? "";
});

async function save() {
  if (!current.value || !stance.value) return;
  const args = text.value.split("\n").map((s) => s.trim()).filter(Boolean);
  await api.saveLabel(current.value.commentId, { stance: stance.value, arguments: args });
  current.value.stance = stance.value;
  current.value.arguments = args;
  saved.value = true;
  if (index.value < labels.value.length - 1) index.value++;
}
</script>

<template>
  <Card v-if="!labels.length">
    <CardHeader>
      <CardTitle>Eval labels</CardTitle>
      <CardDescription>
        No eval sample yet. Run <code>bun run eval:sample FAA-2026-9178-0001</code> to pick the comments to label.
      </CardDescription>
    </CardHeader>
  </Card>

  <Card v-else-if="current && comment">
    <CardHeader class="gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <CardTitle>Label comment {{ index + 1 }} of {{ labels.length }}</CardTitle>
        <span class="font-mono text-xs text-muted-foreground">{{ current.commentId }}</span>
        <span v-if="saved" class="inline-flex items-center gap-1 text-xs text-emerald-700"><CircleCheck class="size-3.5" /> saved</span>
        <div class="ml-auto flex gap-1">
          <Button size="icon-sm" variant="outline" :disabled="index === 0" @click="index--"><ChevronLeft /></Button>
          <Button size="icon-sm" variant="outline" :disabled="index === labels.length - 1" @click="index++"><ChevronRight /></Button>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <Progress class="h-1.5" :model-value="(100 * done) / labels.length" />
        <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ done }}/{{ labels.length }} labeled</span>
      </div>
      <CardDescription>
        Label what <em>you</em> read, without looking at the model's answer. List each distinct argument the commenter makes, one per
        line, in your own words.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
      <div class="max-h-[60vh] overflow-y-auto rounded-lg border bg-background p-4 text-sm leading-7 whitespace-pre-wrap">{{ comment.body }}</div>
      <form class="space-y-5" @submit.prevent="save">
        <div class="space-y-2">
          <Label>Position on the rule as proposed</Label>
          <RadioGroup v-model="stance" class="grid grid-cols-2 gap-2">
            <Label
              v-for="s in ['support', 'oppose', 'mixed', 'unclear'] as const"
              :key="s"
              class="flex cursor-pointer items-center gap-2 rounded-lg border p-3 font-normal capitalize has-data-[state=checked]:border-primary"
            >
              <RadioGroupItem :value="s" /> {{ s }}
            </Label>
          </RadioGroup>
        </div>
        <div class="space-y-2">
          <Label for="args">Arguments, one per line</Label>
          <Textarea id="args" v-model="text" rows="9" placeholder="e.g. Airlines should be required to carry epinephrine auto-injectors" />
        </div>
        <Button type="submit" class="w-full" :disabled="!stance">Save and next</Button>
      </form>
    </CardContent>
  </Card>
</template>
