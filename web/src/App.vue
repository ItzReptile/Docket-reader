<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ExternalLink, FileText } from "@lucide/vue";
import { api, fmt, type DocumentRow, type Summary } from "@/api";
import { ui } from "@/store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import ArgumentsTab from "@/components/ArgumentsTab.vue";
import CommentSheet from "@/components/CommentSheet.vue";
import FlaggedTab from "@/components/FlaggedTab.vue";
import HowItWorks from "@/components/HowItWorks.vue";
import LabelTab from "@/components/LabelTab.vue";
import MemoTab from "@/components/MemoTab.vue";
import OverviewTab from "@/components/OverviewTab.vue";
import StatCard from "@/components/StatCard.vue";

const documents = ref<DocumentRow[]>([]);
const models = ref<string[]>([]);
const summary = ref<Summary | null>(null);
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
const pending = computed(() => (summary.value ? summary.value.arguments.total - summary.value.arguments.approved - summary.value.arguments.rejected : 0));
const closed = computed(() => {
  const d = summary.value?.document as { comment_end_date?: string } | undefined;
  return d?.comment_end_date ? new Date(d.comment_end_date).toLocaleDateString("en-US", { dateStyle: "medium" }) : null;
});
</script>

<template>
  <TooltipProvider :delay-duration="150">
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
            <HowItWorks />
            <Select v-if="documents.length > 1" v-model="ui.doc">
              <SelectTrigger class="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="d in documents" :key="d.document_id" :value="d.document_id">{{ d.document_id }}</SelectItem>
              </SelectContent>
            </Select>
            <Select v-if="models.length" v-model="ui.model">
              <SelectTrigger class="w-44"><span class="text-muted-foreground">Model</span><SelectValue /></SelectTrigger>
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
              <span>Proposed rule · Docket {{ summary.document.docket_id }}</span>
              <span v-if="closed">· Comment period closed {{ closed }}</span>
            </div>
            <h1 class="max-w-4xl text-2xl font-semibold tracking-tight text-balance">{{ summary.document.title }}</h1>
            <p v-if="summary.document.summary" class="max-w-4xl text-sm leading-relaxed text-muted-foreground">
              {{ summary.document.summary }}
            </p>
            <a
              class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              :href="`https://www.regulations.gov/document/${summary.document.document_id}`"
              target="_blank"
            >
              {{ summary.document.document_id }} on Regulations.gov <ExternalLink class="size-3.5" />
            </a>
          </section>

          <section class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Comments posted"
              :value="fmt(summary.listed)"
              help="Every comment the agency posted publicly for this rule on Regulations.gov."
            />
            <StatCard
              label="Distinct texts"
              :value="fmt(summary.unique_texts)"
              note="after grouping form letters"
              help="What is left after identical and near-identical form letters are collapsed. The model reads each distinct text once."
            />
            <StatCard
              label="Form letters"
              :value="fmt(summary.in_duplicate_groups)"
              :note="`comments in ${fmt(summary.duplicate_groups)} campaigns`"
              help="Comments that share a template with at least one other comment. Each copy still counts as one person in every total."
            />
            <StatCard
              label="Attachment-only"
              :value="fmt(summary.attachment_only)"
              note="not read, need a person"
              help="Comments whose content is only in a PDF or Word attachment. This tool doesn't read attachments, so a person should. They are listed in the memo."
            />
            <StatCard
              label="Quotes verified"
              :value="`${pct(summary.quotes.verified, summary.quotes.claims).toFixed(1)}%`"
              :progress="pct(summary.quotes.verified, summary.quotes.claims)"
              help="Share of extracted arguments whose supporting quote was found word for word in the comment. The rest are flagged and left out of the memo."
            />
            <StatCard
              label="Arguments approved"
              value=""
              :progress="pct(summary.arguments.approved, summary.arguments.total)"
              help="Merged arguments a reviewer has approved. Only approved arguments go into the memo."
            >
              {{ fmt(summary.arguments.approved) }}<span class="text-base text-muted-foreground">/{{ fmt(summary.arguments.total) }}</span>
            </StatCard>
          </section>

          <Tabs v-model="ui.tab" class="gap-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="arguments">
                Review arguments
                <Badge v-if="pending" variant="secondary" class="ml-1 tabular-nums">{{ fmt(pending) }}</Badge>
              </TabsTrigger>
              <TabsTrigger value="flagged">
                Flagged quotes
                <Badge v-if="flagged" variant="destructive" class="ml-1 tabular-nums">{{ fmt(flagged) }}</Badge>
              </TabsTrigger>
              <TabsTrigger value="memo">Memo</TabsTrigger>
              <TabsTrigger value="label">Eval labels</TabsTrigger>
            </TabsList>
            <TabsContent value="overview"><OverviewTab :summary="summary" /></TabsContent>
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
      <Toaster position="bottom-right" rich-colors />
    </div>
  </TooltipProvider>
</template>
