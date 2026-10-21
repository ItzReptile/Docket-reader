<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, type CommentDetail, type Label, type Stance } from "../api";
import { ui } from "../store";

const labels = ref<Label[]>([]);
const index = ref(0);
const comment = ref<CommentDetail | null>(null);
const stance = ref<Stance | null>(null);
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
  stance.value = l?.stance ?? null;
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
  <div class="panel wrap">
    <template v-if="!labels.length">
      <p>No eval sample yet. Run <code>bun run eval:sample FAA-2026-9178-0001</code> to pick comments to label.</p>
    </template>
    <template v-else-if="current && comment">
      <div class="head">
        <button :disabled="index === 0" @click="index--">← Prev</button>
        <strong>{{ index + 1 }} / {{ labels.length }}</strong>
        <button :disabled="index === labels.length - 1" @click="index++">Next →</button>
        <span class="muted">{{ done }} labeled · {{ current.commentId }}</span>
        <span v-if="saved" class="ok">saved</span>
      </div>
      <p class="muted hint">
        Label what <em>you</em> read, without looking at the model's answer. List each distinct argument the commenter
        makes, one per line, in your own words.
      </p>
      <div class="cols">
        <div class="text">{{ comment.body }}</div>
        <form @submit.prevent="save">
          <fieldset>
            <legend>Position on the rule as proposed</legend>
            <label v-for="s in ['support', 'oppose', 'mixed', 'unclear'] as const" :key="s">
              <input type="radio" :value="s" v-model="stance" /> {{ s }}
            </label>
          </fieldset>
          <label class="args">
            Arguments (one per line)
            <textarea v-model="text" rows="10" placeholder="e.g. Airlines should be required to carry epinephrine auto-injectors" />
          </label>
          <button class="primary" :disabled="!stance">Save and next</button>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wrap {
  padding: 16px 18px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hint {
  font-size: 13px;
}
.cols {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 18px;
}
.text {
  white-space: pre-wrap;
  line-height: 1.6;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  max-height: 60vh;
  overflow: auto;
}
form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
fieldset {
  border: 1px solid var(--line);
  border-radius: 8px;
  display: flex;
  gap: 14px;
}
.args {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ok {
  color: var(--ok);
}
</style>
