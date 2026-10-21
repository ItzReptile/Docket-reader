<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CircleCheck, CircleX, ExternalLink, Paperclip, Users } from "@lucide/vue";
import { api, fmt, regsLink, type CommentDetail } from "@/api";
import { openComment, ui } from "@/store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const c = ref<CommentDetail | null>(null);

watch(
  () => ui.commentId,
  async (id) => {
    c.value = id ? await api.comment(id, ui.model) : null;
    await nextTick();
    document.querySelector("[data-comment-text] mark.focus")?.scrollIntoView({ block: "center" });
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

const open = computed({
  get: () => ui.commentId !== null,
  set: (v) => {
    if (!v) ui.commentId = null;
  },
});
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent class="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
      <SheetHeader class="border-b">
        <SheetTitle class="font-mono">{{ ui.commentId }}</SheetTitle>
        <SheetDescription v-if="c" class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Posted {{ new Date(c.posted_date).toLocaleDateString("en-US", { dateStyle: "medium" }) }}</span>
          <span v-if="c.organization">{{ c.organization }}</span>
          <span v-if="c.attachment_count" class="inline-flex items-center gap-1"><Paperclip class="size-3.5" /> {{ c.attachment_count }} attachment(s), not read</span>
        </SheetDescription>
        <div class="flex flex-wrap gap-2 pt-2">
          <Button v-if="ui.commentId" as="a" size="sm" variant="outline" :href="regsLink(ui.commentId)" target="_blank">
            Open on Regulations.gov <ExternalLink />
          </Button>
          <Badge v-if="c?.extraction" variant="secondary">
            read as {{ c.extraction.stance }} · {{ c.extraction.seconds.toFixed(1) }}s · {{ c.extraction.llm_calls }} LLM call{{ c.extraction.llm_calls > 1 ? "s" : "" }}
          </Badge>
        </div>
      </SheetHeader>

      <div v-if="c" class="flex-1 space-y-5 overflow-y-auto p-4">
        <Alert v-if="c.group_size && c.group_size > 1" class="border-amber-200 bg-amber-50 text-amber-900">
          <Users />
          <AlertDescription class="text-amber-900">
            {{ c.group_kind === "exact" ? "Identical" : "Near-identical" }} text was sent by {{ fmt(c.group_size) }} commenters.
            <template v-if="!isRepresentative">
              The model read the representative copy,
              <button class="underline" @click="openComment(c.representative_id!)">{{ c.representative_id }}</button>.
            </template>
          </AlertDescription>
        </Alert>

        <div data-comment-text class="rounded-lg border bg-background p-4 text-sm leading-7 whitespace-pre-wrap"><template v-for="(p, i) in pieces" :key="i"><mark v-if="p.mark" :class="{ focus: p.focus }">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></div>

        <section v-if="c.claims.length" class="space-y-2">
          <h3 class="text-sm font-medium">What the model extracted</h3>
          <div v-for="x in c.claims" :key="x.id" class="flex gap-2 rounded-lg border p-3 text-sm">
            <CircleCheck v-if="x.quote_ok" class="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <CircleX v-else class="mt-0.5 size-4 shrink-0 text-rose-600" />
            <div class="space-y-1">
              <p>{{ x.argument }}</p>
              <p v-if="!x.quote_ok" class="text-xs text-muted-foreground">
                Quote "{{ x.quote }}" failed: {{ x.quote_error }}
              </p>
            </div>
          </div>
        </section>

        <details v-if="c.members.length > 1" class="text-sm">
          <summary class="cursor-pointer font-medium">All {{ fmt(c.group_size ?? 0) }} comments in this group</summary>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <Button v-for="id in c.members" :key="id" size="xs" variant="outline" class="font-mono" @click="openComment(id)">{{ id }}</Button>
          </div>
        </details>
      </div>
    </SheetContent>
  </Sheet>
</template>
