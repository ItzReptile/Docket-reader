<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, count, fmt, type Argument, type Quote, type Similar, type Status } from "../api";
import { openComment, refresh, ui } from "../store";
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

async function saveLabel() {
  if (!selected.value || !draft.value.trim()) return;
  await api.updateArgument(selected.value.id, { label: draft.value.trim() });
  selected.value.label = draft.value.trim();
  editing.value = false;
}

async function mergeIntoSelected(sourceIds: number[]) {
  if (!selected.value || sourceIds.length === 0) return;
  await api.merge(selected.value.id, sourceIds);
  checked.value = new Set();
  const id = selected.value.id;
  await load();
  selectedId.value = null;
  selectedId.value = id; // reload quotes and suggestions
  refresh();
}

function toggle(id: number) {
  const s = new Set(checked.value);
  s.has(id) ? s.delete(id) : s.add(id);
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
</script>

<template>
  <div class="layout">
    <section class="list panel">
      <div class="toolbar">
        <button v-for="f in ['all', 'pending', 'approved', 'rejected'] as const" :key="f" :class="{ active: filter === f }" @click="filter = f">
          {{ f }}
        </button>
        <input v-model="search" placeholder="Search arguments" />
      </div>
      <div v-if="checked.size" class="mergebar">
        {{ checked.size }} checked
        <button class="primary" :disabled="!selected || checked.has(selected.id) && checked.size === 1"
          @click="mergeIntoSelected([...checked])">Merge into #{{ selected ? rank(selected) : "" }}</button>
        <button @click="checked = new Set()">Clear</button>
      </div>
      <ol>
        <li v-for="a in visible" :key="a.id" :class="{ selected: a.id === selectedId }" @click="selectedId = a.id">
          <input type="checkbox" :checked="checked.has(a.id)" @click.stop="toggle(a.id)" title="Check to merge" />
          <span class="rank">{{ rank(a) }}</span>
          <div class="body">
            <div class="label">{{ a.label }}</div>
            <div class="meta">
              <span><b>{{ count(a.commenters, "commenter") }}</b></span>
              <span class="muted">{{ fmt(a.unique_comments) }} distinct</span>
              <StanceBar v-bind="a" />
              <span v-if="a.status !== 'pending'" class="pill" :class="a.status">{{ a.status }}</span>
            </div>
          </div>
        </li>
      </ol>
      <p v-if="!visible.length" class="muted pad">Nothing here.</p>
    </section>

    <section v-if="selected" class="detail panel">
      <div class="head">
        <span class="muted">#{{ rank(selected) }}</span>
        <span class="pill" :class="selected.status">{{ selected.status }}</span>
      </div>
      <div v-if="!editing" class="title" @dblclick="(draft = selected.label), (editing = true)">{{ selected.label }}</div>
      <form v-else class="edit" @submit.prevent="saveLabel">
        <textarea v-model="draft" rows="2" />
        <button class="primary">Save</button>
        <button type="button" @click="editing = false">Cancel</button>
      </form>
      <div class="actions">
        <button class="approve" @click="setStatus('approved')" title="a">Approve</button>
        <button class="reject" @click="setStatus('rejected')" title="r">Reject</button>
        <button @click="(draft = selected.label), (editing = true)">Edit wording</button>
        <button v-if="selected.status !== 'pending'" @click="setStatus('pending')" title="p">Undo</button>
        <span class="muted keys">keys: j/k move · a approve · r reject</span>
      </div>
      <p>
        Raised by <b>{{ count(selected.commenters, "commenter") }}</b> in {{ count(selected.unique_comments, "distinct comment") }}.
        <span class="muted">
          support {{ fmt(selected.support) }} · oppose {{ fmt(selected.oppose) }} · mixed {{ fmt(selected.mixed) }} · unclear
          {{ fmt(selected.unclear) }}
        </span>
      </p>

      <div v-if="similar.length" class="similar">
        <h3>Similar arguments <span class="muted">(merge if they make the same point)</span></h3>
        <div v-for="s in similar" :key="s.id" class="sim">
          <span class="score">{{ s.similarity.toFixed(2) }}</span>
          <a href="#" @click.prevent="selectedId = s.id">{{ s.label }}</a>
          <button @click="mergeIntoSelected([s.id])">Merge into this</button>
        </div>
      </div>

      <h3>Source quotes <span class="muted">(verified word for word; click to see the full comment)</span></h3>
      <div v-for="q in showAllQuotes ? quotes : quotes.slice(0, 25)" :key="q.id" class="quote">
        <blockquote @click="openComment(q.comment_id, q.id)">{{ q.quote }}</blockquote>
        <div class="qmeta">
          <a href="#" @click.prevent="openComment(q.comment_id, q.id)">{{ q.comment_id }}</a>
          <span v-if="q.group_size > 1" class="pill form">form letter ×{{ fmt(q.group_size) }}</span>
          <span v-if="q.organization" class="pill">{{ q.organization }}</span>
          <span v-if="q.stance" class="muted">{{ q.stance }}</span>
          <span class="muted model">model wrote: {{ q.argument }}</span>
        </div>
      </div>
      <button v-if="quotes.length > 25 && !showAllQuotes" @click="showAllQuotes = true">Show all {{ quotes.length }} quotes</button>
    </section>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(380px, 1fr) minmax(420px, 1.1fr);
  gap: 16px;
  align-items: start;
}
.list {
  max-height: calc(100vh - 230px);
  overflow: auto;
}
.toolbar {
  display: flex;
  gap: 4px;
  padding: 10px;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--panel);
}
.toolbar input {
  flex: 1;
  min-width: 0;
  margin-left: 8px;
}
.mergebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--accent-soft);
}
ol {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
li:hover {
  background: var(--bg);
}
li.selected {
  background: var(--accent-soft);
}
li input {
  margin-top: 3px;
}
.rank {
  color: var(--muted);
  min-width: 22px;
  text-align: right;
}
.body {
  flex: 1;
  min-width: 0;
}
.label {
  line-height: 1.35;
}
.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  margin-top: 4px;
}
.meta .bar {
  width: 80px;
}
.pad {
  padding: 12px;
}
.detail {
  padding: 16px 18px;
  max-height: calc(100vh - 230px);
  overflow: auto;
}
.head {
  display: flex;
  gap: 8px;
  align-items: center;
}
.title {
  font-size: 18px;
  font-weight: 600;
  margin: 8px 0 12px;
  line-height: 1.35;
}
.edit {
  display: flex;
  gap: 6px;
  margin: 8px 0 12px;
}
.edit textarea {
  flex: 1;
}
.actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.keys {
  font-size: 12px;
  margin-left: auto;
}
h3 {
  font-size: 14px;
  margin: 18px 0 8px;
}
.similar .sim {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.similar .sim a {
  flex: 1;
}
.score {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  font-size: 13px;
}
.quote {
  margin-bottom: 12px;
}
.quote blockquote {
  cursor: pointer;
}
.qmeta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  margin-top: 4px;
}
.model {
  font-style: italic;
}
</style>
