<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api, fmt, type DocumentRow, type Summary } from "./api";
import { ui } from "./store";
import ArgumentsTab from "./components/ArgumentsTab.vue";
import FlaggedTab from "./components/FlaggedTab.vue";
import MemoTab from "./components/MemoTab.vue";
import LabelTab from "./components/LabelTab.vue";
import CommentDrawer from "./components/CommentDrawer.vue";

const documents = ref<DocumentRow[]>([]);
const models = ref<string[]>([]);
const summary = ref<Summary | null>(null);
const tab = ref<"arguments" | "flagged" | "memo" | "label">("arguments");
const error = ref("");

onMounted(async () => {
  try {
    documents.value = await api.documents();
    ui.doc = documents.value[0]?.document_id ?? "";
  } catch (e) {
    error.value = `Can't reach the API. Is "bun run api" running? (${(e as Error).message})`;
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

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
</script>

<template>
  <header>
    <div class="top">
      <strong class="brand">docket-reader</strong>
      <select v-model="ui.doc" v-if="documents.length > 1">
        <option v-for="d in documents" :key="d.document_id" :value="d.document_id">{{ d.document_id }}</option>
      </select>
      <span class="spacer" />
      <label class="muted" v-if="models.length">
        model
        <select v-model="ui.model">
          <option v-for="m in models" :key="m">{{ m }}</option>
        </select>
      </label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="summary">
      <h1>
        <a :href="`https://www.regulations.gov/document/${summary.document.document_id}`" target="_blank">{{
          summary.document.document_id
        }}</a>
        {{ summary.document.title }}
      </h1>
      <div class="stats">
        <div><b>{{ fmt(summary.listed) }}</b><span>comments posted</span></div>
        <div><b>{{ fmt(summary.unique_texts) }}</b><span>distinct texts</span></div>
        <div>
          <b>{{ fmt(summary.in_duplicate_groups) }}</b><span>in {{ fmt(summary.duplicate_groups) }} form-letter groups</span>
        </div>
        <div><b>{{ fmt(summary.attachment_only) }}</b><span>attachment-only, not read</span></div>
        <div>
          <b>{{ pct(summary.quotes.verified, summary.quotes.claims) }}</b>
          <span>quotes verified ({{ fmt(summary.quotes.verified) }}/{{ fmt(summary.quotes.claims) }})</span>
        </div>
        <div>
          <b>{{ fmt(summary.arguments.approved) }}/{{ fmt(summary.arguments.total) }}</b><span>arguments approved</span>
        </div>
      </div>
    </template>
    <nav>
      <button :class="{ active: tab === 'arguments' }" @click="tab = 'arguments'">Arguments</button>
      <button :class="{ active: tab === 'flagged' }" @click="tab = 'flagged'">
        Flagged quotes<span v-if="summary"> ({{ fmt(summary.quotes.claims - summary.quotes.verified) }})</span>
      </button>
      <button :class="{ active: tab === 'memo' }" @click="tab = 'memo'">Memo</button>
      <button :class="{ active: tab === 'label' }" @click="tab = 'label'">Eval labels</button>
    </nav>
  </header>

  <main v-if="ui.doc && ui.model">
    <ArgumentsTab v-if="tab === 'arguments'" />
    <FlaggedTab v-else-if="tab === 'flagged'" />
    <MemoTab v-else-if="tab === 'memo'" />
    <LabelTab v-else />
  </main>
  <main v-else-if="!error" class="muted">
    No extracted documents yet. Run the pipeline first (see the README).
  </main>

  <CommentDrawer />
</template>

<style scoped>
header {
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  padding: 12px 24px 0;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand {
  font-size: 15px;
  letter-spacing: 0.02em;
}
.spacer {
  flex: 1;
}
h1 {
  font-size: 19px;
  font-weight: 600;
  margin: 10px 0;
  line-height: 1.35;
}
h1 a {
  font-weight: 500;
  margin-right: 6px;
  text-decoration: none;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin-bottom: 12px;
}
.stats div {
  display: flex;
  flex-direction: column;
}
.stats b {
  font-size: 18px;
}
.stats span {
  font-size: 12px;
  color: var(--muted);
}
nav {
  display: flex;
  gap: 4px;
}
nav button {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 8px 12px;
  background: none;
}
nav button.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
  background: none;
}
main {
  padding: 20px 24px;
}
.error {
  color: var(--bad);
}
</style>
