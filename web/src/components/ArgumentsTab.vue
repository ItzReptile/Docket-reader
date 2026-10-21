<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, GitMerge, Pencil, Quote as QuoteIcon, Search, Undo2, Users, X } from "@lucide/vue";
import { api, count, fmt, type Argument, type Quote, type Similar, type Status } from "@/api";
import { openComment, refresh, ui } from "@/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import StanceBar from "./StanceBar.vue";

const args = ref<Argument[]>([]);
const filter = ref<Status | "all">("all");
const search = ref("");
const selectedId = ref<number | null>(null);
const checked = ref<Set<number>>(new Set());
const quotes = ref<Quote[]>([]);
const similar = ref<Similar[]>([]);
const showAllQuotes = ref(false);
const editing = ref(false);
const draft = ref("");

async function load() {
  args.value = await api.arguments(ui.doc, ui.model);
  if (!args.value.some((a) => a.id === selectedId.value)) selectedId.value = args.value[0]?.id ?? null;
}
watch(() => [ui.doc, ui.model, ui.version], load, { immediate: true });

const counts = computed(() => ({
  all: args.value.length,
  pending: args.value.filter((a) => a.status === "pending").length,
  approved: args.value.filter((a) => a.status === "approved").length,
  rejected: args.value.filter((a) => a.status === "rejected").length,
}));
const visible = computed(() =>
  args.value.filter(
    (a) =>
      (filter.value === "all" || a.status === filter.value) &&
      (!search.value || a.label.toLowerCase().includes(search.value.toLowerCase())),
  ),
);
const selected = computed(() => args.value.find((a) => a.id === selectedId.value) ?? null);
const rank = (a: Argument) => args.value.indexOf(a) + 1;

watch(selectedId, async (id) => {
  editing.value = false;
  showAllQuotes.value = false;
  quotes.value = [];
  similar.value = [];
  if (id == null) return;
  [quotes.value, similar.value] = await Promise.all([api.quotes(id), api.similar(id)]);
});

async function setStatus(status: Status) {
  if (!selected.value) return;
  await api.updateArgument(selected.value.id, { status });
  selected.value.status = status;
  refresh();
}

function startEdit() {
  if (!selected.value) return;
  draft.value = selected.value.label;
  editing.value = true;
}

async function saveLabel() {
  if (!selected.value || !draft.value.trim()) return;
  await api.updateArgument(selected.value.id, { label: draft.value.trim() });
  selected.value.label = draft.value.trim();
  editing.value = false;
}

async function mergeIntoSelected(sourceIds: number[]) {
  if (!selected.value || sourceIds.length === 0) return;
  const id = selected.value.id;
  await api.merge(id, sourceIds);
  checked.value = new Set();
  await load();
  selectedId.value = null;
  selectedId.value = id; // reload quotes and suggestions
  refresh();
}

function setChecked(id: number, on: boolean) {
  const s = new Set(checked.value);
  on ? s.add(id) : s.delete(id);
  checked.value = s;
}

// Keyboard: j/k move, a approve, r reject, p back to pending.
function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const list = visible.value;
  const i = list.findIndex((a) => a.id === selectedId.value);
  if (e.key === "j" && i < list.length - 1) selectedId.value = list[i + 1]!.id;
  else if (e.key === "k" && i > 0) selectedId.value = list[i - 1]!.id;
  else if (e.key === "a") setStatus("approved");
  else if (e.key === "r") setStatus("rejected");
  else if (e.key === "p") setStatus("pending");
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

const statusClass: Record<Status, string> = {
  pending: "",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};
</script>

<template>
  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <!-- Ranked list -->
    <Card class="gap-0 py-0">
      <div class="space-y-3 border-b p-3">
        <Tabs v-model="filter">
          <TabsList class="w-full">
            <TabsTrigger v-for="f in ['all', 'pending', 'approved', 'rejected'] as const" :key="f" :value="f" class="capitalize">
              {{ f }} <span class="text-muted-foreground tabular-nums">{{ counts[f] }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div class="relative">
          <Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" placeholder="Search arguments" class="pl-8" />
        </div>
        <div v-if="checked.size" class="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <span>{{ checked.size }} checked</span>
          <Button size="sm" class="ml-auto" :disabled="!selected || checked.has(selected.id)" @click="mergeIntoSelected([...checked])">
            <GitMerge /> Merge into #{{ selected ? rank(selected) : "" }}
          </Button>
          <Button size="sm" variant="ghost" @click="checked = new Set()">Clear</Button>
        </div>
      </div>
      <ScrollArea class="h-[calc(100vh-430px)] min-h-96">
        <ol>
          <li
            v-for="a in visible"
            :key="a.id"
            class="flex cursor-pointer gap-3 border-b border-l-2 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/60"
            :class="a.id === selectedId ? 'border-l-primary bg-muted' : 'border-l-transparent'"
            @click="selectedId = a.id"
          >
            <Checkbox
              class="mt-0.5"
              :model-value="checked.has(a.id)"
              @update:model-value="(v) => setChecked(a.id, v === true)"
              @click.stop
              aria-label="Check to merge"
            />
            <span class="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{{ rank(a) }}</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="line-clamp-2 text-sm leading-snug">{{ a.label }}</p>
              <div class="flex items-center gap-3 text-xs text-muted-foreground">
                <span class="inline-flex items-center gap-1 font-medium text-foreground">
                  <Users class="size-3.5" /> {{ fmt(a.commenters) }}
                </span>
                <span>{{ count(a.unique_comments, "distinct comment") }}</span>
                <StanceBar class="w-16" v-bind="a" />
                <Badge v-if="a.status !== 'pending'" variant="outline" :class="statusClass[a.status]" class="ml-auto capitalize">
                  {{ a.status }}
                </Badge>
              </div>
            </div>
          </li>
        </ol>
        <p v-if="!visible.length" class="p-6 text-center text-sm text-muted-foreground">Nothing here.</p>
      </ScrollArea>
    </Card>

    <!-- Selected argument -->
    <Card v-if="selected" class="gap-0 py-0">
      <CardHeader class="gap-3 border-b py-4">
        <div class="flex items-center gap-2">
          <Badge variant="secondary">#{{ rank(selected) }}</Badge>
          <Badge variant="outline" class="capitalize" :class="statusClass[selected.status]">{{ selected.status }}</Badge>
          <span class="ml-auto hidden text-xs text-muted-foreground md:inline">
            <kbd class="rounded border bg-muted px-1">j</kbd>/<kbd class="rounded border bg-muted px-1">k</kbd> move ·
            <kbd class="rounded border bg-muted px-1">a</kbd> approve · <kbd class="rounded border bg-muted px-1">r</kbd> reject
          </span>
        </div>
        <h2 v-if="!editing" class="text-lg leading-snug font-semibold" @dblclick="startEdit">{{ selected.label }}</h2>
        <form v-else class="space-y-2" @submit.prevent="saveLabel">
          <Textarea v-model="draft" rows="3" />
          <div class="flex gap-2">
            <Button size="sm" type="submit">Save wording</Button>
            <Button size="sm" variant="ghost" type="button" @click="editing = false">Cancel</Button>
          </div>
        </form>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" class="bg-emerald-600 text-white hover:bg-emerald-700" @click="setStatus('approved')"><Check /> Approve</Button>
          <Button size="sm" variant="destructive" @click="setStatus('rejected')"><X /> Reject</Button>
          <Button size="sm" variant="outline" @click="startEdit"><Pencil /> Edit wording</Button>
          <Button v-if="selected.status !== 'pending'" size="sm" variant="ghost" @click="setStatus('pending')"><Undo2 /> Undo</Button>
        </div>
      </CardHeader>

      <ScrollArea class="h-[calc(100vh-560px)] min-h-80">
        <CardContent class="space-y-6 py-4">
          <section class="grid grid-cols-2 gap-3">
            <div class="rounded-lg border p-3">
              <div class="text-xs text-muted-foreground">Raised by</div>
              <div class="text-xl font-semibold tabular-nums">{{ count(selected.commenters, "commenter") }}</div>
            </div>
            <div class="rounded-lg border p-3">
              <div class="text-xs text-muted-foreground">Distinct comments</div>
              <div class="text-xl font-semibold tabular-nums">{{ fmt(selected.unique_comments) }}</div>
            </div>
            <div class="col-span-2">
              <div class="mb-1.5 text-xs text-muted-foreground">Overall position of those commenters</div>
              <StanceBar v-bind="selected" legend />
            </div>
          </section>

          <section v-if="similar.length" class="space-y-2">
            <h3 class="text-sm font-medium">Similar arguments <span class="font-normal text-muted-foreground">merge if they make the same point</span></h3>
            <div v-for="s in similar" :key="s.id" class="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Badge variant="secondary" class="tabular-nums">{{ s.similarity.toFixed(2) }}</Badge>
              <button class="min-w-0 flex-1 text-left text-sm hover:underline" @click="selectedId = s.id">{{ s.label }}</button>
              <Button size="sm" variant="outline" @click="mergeIntoSelected([s.id])"><GitMerge /> Merge</Button>
            </div>
          </section>

          <Separator />

          <section class="space-y-3">
            <h3 class="text-sm font-medium">
              Source quotes
              <span class="font-normal text-muted-foreground">verified word for word · click one to read the whole comment</span>
            </h3>
            <button
              v-for="q in showAllQuotes ? quotes : quotes.slice(0, 25)"
              :key="q.id"
              class="block w-full rounded-lg border bg-background p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
              @click="openComment(q.comment_id, q.id)"
            >
              <div class="flex gap-2">
                <QuoteIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p class="text-sm leading-relaxed">{{ q.quote }}</p>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-2 pl-6 text-xs text-muted-foreground">
                <span class="font-mono text-foreground">{{ q.comment_id }}</span>
                <Badge v-if="q.group_size > 1" variant="outline" class="border-amber-200 bg-amber-50 text-amber-800">
                  form letter ×{{ fmt(q.group_size) }}
                </Badge>
                <Badge v-if="q.organization" variant="outline">{{ q.organization }}</Badge>
                <span v-if="q.stance" class="capitalize">{{ q.stance }}</span>
              </div>
              <p class="mt-1 pl-6 text-xs text-muted-foreground italic">Model's wording: {{ q.argument }}</p>
            </button>
            <Button v-if="quotes.length > 25 && !showAllQuotes" variant="outline" class="w-full" @click="showAllQuotes = true">
              Show all {{ quotes.length }} quotes
            </Button>
          </section>
        </CardContent>
      </ScrollArea>
    </Card>
  </div>
</template>
