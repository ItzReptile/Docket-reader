<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { marked } from "marked";
import { api, type Memo } from "../api";
import { ui } from "../store";

const memo = ref<Memo | null>(null);
const includePending = ref(false);
const raw = ref(false);

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
  <div v-if="memo" class="memo">
    <div class="bar panel">
      <span :class="passed ? 'ok' : 'bad'">
        {{ passed ? "✓" : "✗" }} {{ memo.check.citedIds }} comment IDs cited, {{ memo.check.unknownIds.length }} unknown ·
        {{ memo.check.quotesChecked }} quotes re-checked, {{ memo.check.quotesFailed.length }} failed
      </span>
      <span class="spacer" />
      <label><input type="checkbox" v-model="includePending" /> include unreviewed arguments</label>
      <button @click="raw = !raw">{{ raw ? "Rendered" : "Markdown" }}</button>
      <button class="primary" @click="download">Download .md</button>
    </div>
    <pre v-if="raw" class="panel doc">{{ memo.markdown }}</pre>
    <article v-else class="panel doc" v-html="html" />
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.spacer {
  flex: 1;
}
.ok {
  color: var(--ok);
}
.bad {
  color: var(--bad);
}
.doc {
  padding: 8px 32px 24px;
  max-width: 900px;
  line-height: 1.55;
}
pre.doc {
  white-space: pre-wrap;
  font-size: 13px;
  padding-top: 20px;
}
.doc :deep(blockquote) {
  white-space: normal;
  margin: 8px 0;
}
.doc :deep(table) {
  border-collapse: collapse;
}
.doc :deep(td),
.doc :deep(th) {
  border: 1px solid var(--line);
  padding: 4px 10px;
}
</style>
