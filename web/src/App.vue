<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ExternalLink, FileText } from "@lucide/vue";
import { api, fmt, type DocumentRow, type Summary } from "@/api";
import { ui } from "@/store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import ArgumentsTab from "@/components/ArgumentsTab.vue";
import FlaggedTab from "@/components/FlaggedTab.vue";
import MemoTab from "@/components/MemoTab.vue";
import LabelTab from "@/components/LabelTab.vue";
import CommentSheet from "@/components/CommentSheet.vue";

const documents = ref<DocumentRow[]>([]);
const models = ref<string[]>([]);
const summary = ref<Summary | null>(null);
const tab = ref("arguments");
const error = ref("");

onMounted(async () => {
  try {
    documents.value = await api.documents();
    ui.doc = documents.value[0]?.document_id ?? "";
  } catch (e) {
    error.value = (e as Error).message;
  }
});

watch(
  () => ui.doc,
  async (doc) => {
    if (!doc) return;
    models.value = await api.models(doc);
    if (!models.value.includes(ui.model)) ui.model = models.value[0] ?? "";
  },
);

watch(
  () => [ui.doc, ui.model, ui.version],
  async () => {
    if (ui.doc && ui.model) summary.value = await api.summary(ui.doc, ui.model);
  },
);

const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);
const flagged = computed(() => (summary.value ? summary.value.quotes.claims - summary.value.quotes.verified : 0));
const closed = computed(() => {
  const d = summary.value?.document as { comment_end_date?: string } | undefined;
  return d?.comment_end_date ? new Date(d.comment_end_date).toLocaleDateString("en-US", { dateStyle: "medium" }) : null;
});
</script>

<template>
  <div class="min-h-screen bg-muted/40">
    <header class="border-b bg-background">
      <div class="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-6">
        <div class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <FileText class="size-4" />
        </div>
        <div class="leading-tight">
          <div class="text-sm font-semibold">docket-reader</div>
          <div class="text-xs text-muted-foreground">Public comment review</div>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <Select v-if="documents.length > 1" v-model="ui.doc">
            <SelectTrigger class="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="d in documents" :key="d.document_id" :value="d.document_id">{{ d.document_id }}</SelectItem>
            </SelectContent>
          </Select>
          <span v-if="models.length" class="text-xs text-muted-foreground">Model</span>
          <Select v-if="models.length" v-model="ui.model">
            <SelectTrigger class="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="m in models" :key="m" :value="m">{{ m }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
      <Alert v-if="error" variant="destructive">
        <AlertTitle>Can't reach the API</AlertTitle>
        <AlertDescription>Start it with <code>bun run api</code>, then reload. ({{ error }})</AlertDescription>
      </Alert>

      <template v-if="summary">
        <section class="space-y-2">
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{{ summary.document.agency_id }}</Badge>
            <span>Docket {{ summary.document.docket_id }}</span>
            <span v-if="closed">· Comment period closed {{ closed }}</span>
          </div>
          <h1 class="max-w-4xl text-2xl font-semibold tracking-tight">{{ summary.document.title }}</h1>
          <a
            class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            :href="`https://www.regulations.gov/document/${summary.document.document_id}`"
            target="_blank"
          >
            {{ summary.document.document_id }} on Regulations.gov <ExternalLink class="size-3.5" />
          </a>
        </section>

        <section class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Card size="sm">
            <CardContent>
              <div class="text-xs text-muted-foreground">Comments posted</div>
              <div class="mt-1 text-2xl font-semibold tabular-nums">{{ fmt(summary.listed) }}</div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div class="text-xs text-muted-foreground">Distinct texts</div>
              <div class="mt-1 text-2xl font-semibold tabular-nums">{{ fmt(summary.unique_texts) }}</div>
              <div class="text-xs text-muted-foreground">after grouping form letters</div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div class="text-xs text-muted-foreground">Form letters</div>
              <div class="mt-1 text-2xl font-semibold tabular-nums">{{ fmt(summary.in_duplicate_groups) }}</div>
              <div class="text-xs text-muted-foreground">comments in {{ fmt(summary.duplicate_groups) }} groups</div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div class="text-xs text-muted-foreground">Attachment-only</div>
              <div class="mt-1 text-2xl font-semibold tabular-nums">{{ fmt(summary.attachment_only) }}</div>
              <div class="text-xs text-muted-foreground">not read, need a person</div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div class="text-xs text-muted-foreground">Quotes verified</div>
              <div class="mt-1 text-2xl font-semibold tabular-nums">
                {{ pct(summary.quotes.verified, summary.quotes.claims).toFixed(1) }}%
              </div>
              <Progress class="mt-2 h-1.5" :model-value="pct(summary.quotes.verified, summary.quotes.claims)" />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div class="text-xs text-muted-foreground">Arguments approved</div>
              <div class="mt-1 text-2xl font-semibold tabular-nums">
                {{ fmt(summary.arguments.approved) }}<span class="text-base text-muted-foreground">/{{ fmt(summary.arguments.total) }}</span>
              </div>
              <Progress class="mt-2 h-1.5" :model-value="pct(summary.arguments.approved, summary.arguments.total)" />
            </CardContent>
          </Card>
        </section>

        <Tabs v-model="tab" class="gap-4">
          <TabsList>
            <TabsTrigger value="arguments">Arguments</TabsTrigger>
            <TabsTrigger value="flagged">
              Flagged quotes
              <Badge v-if="flagged" variant="destructive" class="ml-1">{{ fmt(flagged) }}</Badge>
            </TabsTrigger>
            <TabsTrigger value="memo">Memo</TabsTrigger>
            <TabsTrigger value="label">Eval labels</TabsTrigger>
          </TabsList>
          <TabsContent value="arguments"><ArgumentsTab /></TabsContent>
          <TabsContent value="flagged"><FlaggedTab /></TabsContent>
          <TabsContent value="memo"><MemoTab /></TabsContent>
          <TabsContent value="label"><LabelTab /></TabsContent>
        </Tabs>
      </template>

      <Card v-else-if="!error && documents.length === 0">
        <CardContent class="py-10 text-center text-sm text-muted-foreground">
          No documents yet. Run <code>bun run pipeline &lt;document id&gt;</code> first (see the README).
        </CardContent>
      </Card>
    </main>

    <CommentSheet />
  </div>
</template>
