<script setup lang="ts">
import { ref, watch } from "vue";
import { api, fmt, type Flagged } from "../api";
import { openComment, ui } from "../store";

const rows = ref<Flagged[]>([]);
watch(() => [ui.doc, ui.model, ui.version], async () => (rows.value = await api.flagged(ui.doc, ui.model)), { immediate: true });
</script>

<template>
  <div class="panel wrap">
    <p class="muted">
      These arguments came with a quote that could not be found word for word in the comment, even after the model was
      asked to fix it. They are left out of the merged arguments and the memo. Open the comment to judge them yourself.
    </p>
    <table v-if="rows.length">
      <thead>
        <tr><th>Comment</th><th>Argument the model claimed</th><th>Quote it gave</th><th>Why it failed</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>
            <a href="#" @click.prevent="openComment(r.comment_id)">{{ r.comment_id }}</a>
            <div v-if="r.group_size > 1" class="pill form">×{{ fmt(r.group_size) }}</div>
          </td>
          <td>{{ r.argument }}</td>
          <td class="q">"{{ r.quote }}"</td>
          <td class="err">{{ r.quote_error }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>No flagged quotes.</p>
  </div>
</template>

<style scoped>
.wrap {
  padding: 16px 18px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th,
td {
  text-align: left;
  vertical-align: top;
  padding: 8px;
  border-bottom: 1px solid var(--line);
}
th {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}
.q {
  font-style: italic;
  max-width: 420px;
}
.err {
  color: var(--bad);
}
</style>
