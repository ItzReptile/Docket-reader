<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { api, fmt, regsLink, type CommentDetail } from "../api";
import { openComment, ui } from "../store";

const c = ref<CommentDetail | null>(null);

watch(
  () => ui.commentId,
  async (id) => {
    c.value = id ? await api.comment(id, ui.model) : null;
    await nextTick();
    document.querySelector(".drawer mark.focus")?.scrollIntoView({ block: "center" });
  },
);

// Claims are stored on the group's representative, so offsets only line up
// when we're looking at that exact comment.
const isRepresentative = computed(() => c.value && (!c.value.representative_id || c.value.representative_id === c.value.comment_id));

/** Split the body into plain and highlighted pieces using verified quote offsets. */
const pieces = computed(() => {
  if (!c.value) return [];
  const body = c.value.body ?? "";
  if (!isRepresentative.value) return [{ text: body, mark: false, focus: false }];
  const spans = c.value.claims
    .filter((x) => x.quote_ok && x.quote_start != null)
    .map((x) => ({ start: x.quote_start!, end: x.quote_end!, focus: x.id === ui.focusClaimId }))
    .sort((a, b) => a.start - b.start);
  const out: { text: string; mark: boolean; focus: boolean }[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue; // overlapping quote; keep the first
    if (s.start > at) out.push({ text: body.slice(at, s.start), mark: false, focus: false });
    out.push({ text: body.slice(s.start, s.end), mark: true, focus: s.focus });
    at = s.end;
  }
  out.push({ text: body.slice(at), mark: false, focus: false });
  return out;
});
</script>

<template>
  <div v-if="ui.commentId" class="backdrop" @click.self="ui.commentId = null">
    <aside class="drawer">
      <div class="head">
        <strong>{{ ui.commentId }}</strong>
        <a :href="regsLink(ui.commentId)" target="_blank">open on Regulations.gov</a>
        <span class="spacer" />
        <button @click="ui.commentId = null">Close</button>
      </div>
      <template v-if="c">
        <p class="muted small">
          Posted {{ new Date(c.posted_date).toLocaleDateString() }}
          <span v-if="c.organization"> · {{ c.organization }}</span>
          <span v-if="c.attachment_count"> · {{ c.attachment_count }} attachment(s), not read</span>
          <span v-if="c.extraction"> · model read it as <b>{{ c.extraction.stance }}</b> ({{ c.extraction.seconds.toFixed(1) }}s,
            {{ c.extraction.llm_calls }} call{{ c.extraction.llm_calls > 1 ? "s" : "" }})</span>
        </p>
        <p v-if="c.group_size && c.group_size > 1" class="group">
          <span class="pill form">form letter ×{{ fmt(c.group_size) }}</span>
          {{ c.group_kind === "exact" ? "Identical" : "Near-identical" }} text was sent by {{ fmt(c.group_size) }} commenters.
          <template v-if="!isRepresentative">
            The model read the representative copy,
            <a href="#" @click.prevent="openComment(c.representative_id!)">{{ c.representative_id }}</a>.
          </template>
        </p>
        <div class="text"><template v-for="(p, i) in pieces" :key="i"><mark v-if="p.mark" :class="{ focus: p.focus }">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></div>

        <h3 v-if="c.claims.length">What the model extracted</h3>
        <ul class="claims">
          <li v-for="x in c.claims" :key="x.id">
            <span :class="x.quote_ok ? 'ok' : 'bad'">{{ x.quote_ok ? "✓ verified" : "✗ flagged" }}</span>
            {{ x.argument }}
            <div v-if="!x.quote_ok" class="muted small">quote "{{ x.quote }}" — {{ x.quote_error }}</div>
          </li>
        </ul>

        <details v-if="c.members.length > 1">
          <summary>All {{ fmt(c.group_size ?? 0) }} comments in this group</summary>
          <p class="members">
            <a v-for="id in c.members" :key="id" href="#" @click.prevent="openComment(id)">{{ id }}</a>
          </p>
        </details>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 30, 40, 0.25);
  display: flex;
  justify-content: flex-end;
  z-index: 10;
}
.drawer {
  width: min(720px, 100%);
  height: 100%;
  overflow: auto;
  background: var(--panel);
  padding: 16px 22px;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.spacer {
  flex: 1;
}
.small {
  font-size: 13px;
}
.group {
  font-size: 14px;
}
.text {
  white-space: pre-wrap;
  line-height: 1.6;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
}
mark.focus {
  outline: 2px solid var(--accent);
  background: #ffe066;
}
h3 {
  font-size: 14px;
  margin: 18px 0 6px;
}
.claims {
  padding-left: 18px;
}
.claims li {
  margin-bottom: 6px;
}
.ok {
  color: var(--ok);
  font-size: 13px;
}
.bad {
  color: var(--bad);
  font-size: 13px;
}
.members {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 13px;
}
</style>
