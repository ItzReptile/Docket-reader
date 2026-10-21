<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { marked } from "marked";
import { Download, ShieldAlert, ShieldCheck } from "@lucide/vue";
import { api, type Memo } from "@/api";
import { ui } from "@/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const memo = ref<Memo | null>(null);
const includePending = ref(false);
const view = ref("rendered");

watch(
  () => [ui.doc, ui.model, ui.version, includePending.value],
  async () => (memo.value = await api.memo(ui.doc, ui.model, includePending.value)),
  { immediate: true },
);

const html = computed(() => (memo.value ? (marked.parse(memo.value.markdown) as string) : ""));
const passed = computed(() => memo.value && !memo.value.check.unknownIds.length && !memo.value.check.quotesFailed.length);

function download() {
  if (!memo.value) return;
  const url = URL.createObjectURL(new Blob([memo.value.markdown], { type: "text/markdown" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${ui.doc}-comment-summary.md` });
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div v-if="memo" class="space-y-4">
    <Card size="sm">
      <CardContent class="flex flex-wrap items-center gap-4">
        <div class="flex items-center gap-2 text-sm" :class="passed ? 'text-emerald-700' : 'text-rose-700'">
          <ShieldCheck v-if="passed" class="size-4" />
          <ShieldAlert v-else class="size-4" />
          <span>
            {{ memo.check.citedIds }} comment IDs cited, {{ memo.check.unknownIds.length }} unknown ·
            {{ memo.check.quotesChecked }} quotes re-checked, {{ memo.check.quotesFailed.length }} failed
          </span>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <Checkbox id="pending" :model-value="includePending" @update:model-value="(v) => (includePending = v === true)" />
          <Label for="pending" class="text-sm font-normal">Include unreviewed arguments</Label>
        </div>
        <Tabs v-model="view">
          <TabsList>
            <TabsTrigger value="rendered">Rendered</TabsTrigger>
            <TabsTrigger value="markdown">Markdown</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" @click="download"><Download /> Download .md</Button>
      </CardContent>
    </Card>
    <Card>
      <CardContent>
        <pre v-if="view === 'markdown'" class="text-xs leading-relaxed whitespace-pre-wrap">{{ memo.markdown }}</pre>
        <article v-else class="prose prose-sm max-w-none prose-blockquote:font-normal prose-blockquote:not-italic" v-html="html" />
      </CardContent>
    </Card>
  </div>
</template>
