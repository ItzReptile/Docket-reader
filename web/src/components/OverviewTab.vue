<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowRight, FileWarning, Mail, Paperclip, ShieldAlert, ShieldCheck, Users } from "@lucide/vue";
import {
  api,
  count,
  fmt,
  regsLink,
  stanceSummary,
  STANCE_LABEL,
  STANCE_TEXT_COLOR,
  type Argument,
  type AttachmentOnly,
  type FormLetterGroup,
  type Stance,
  type Summary,
} from "@/api";
import { openArgument, openComment, ui } from "@/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import StanceBar from "./StanceBar.vue";

const props = defineProps<{ summary: Summary }>();

const args = ref<Argument[]>([]);
const groups = ref<FormLetterGroup[]>([]);
const attachments = ref<AttachmentOnly[]>([]);

watch(
  () => [ui.doc, ui.model, ui.version],
  async () => {
    [args.value, groups.value, attachments.value] = await Promise.all([
      api.arguments(ui.doc, ui.model),
      api.groups(ui.doc, ui.model, 6),
      api.attachmentOnly(ui.doc),
    ]);
  },
  { immediate: true },
);

const stance = computed(() => {
  const c = { support: 0, oppose: 0, mixed: 0, unclear: 0 } as Record<Stance, number>;
  for (const s of props.summary.stances) c[s.stance] = s.commenters;
  return c;
});
const people = computed(() => Object.values(stance.value).reduce((a, b) => a + b, 0));
const pct = (n: number) => (people.value ? Math.round((100 * n) / people.value) : 0);

const top = computed(() => args.value.filter((a) => a.status !== "rejected").slice(0, 8));
const maxCommenters = computed(() => Math.max(1, ...top.value.map((a) => a.commenters)));

const review = computed(() => {
  const a = props.summary.arguments;
  return { ...a, pending: a.total - a.approved - a.rejected, done: a.total ? (100 * (a.approved + a.rejected)) / a.total : 0 };
});
const flagged = computed(() => props.summary.quotes.claims - props.summary.quotes.verified);

function startReview() {
  ui.argumentFilter = "pending";
  ui.tab = "arguments";
}
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Where people stand -->
    <Card class="lg:col-span-2">
      <CardHeader>
        <CardTitle>Where commenters stand</CardTitle>
        <CardDescription>On the rule as proposed. Each copy of a form letter counts as one person.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-lg leading-snug">
          <span class="font-semibold">{{ count(people, "commenter") }}</span> read so far.
          <template v-if="people">
            <span :class="STANCE_TEXT_COLOR.oppose" class="font-semibold">{{ pct(stance.oppose) }}% oppose</span> it as proposed and
            <span :class="STANCE_TEXT_COLOR.support" class="font-semibold">{{ pct(stance.support) }}% support</span> it{{
              stance.mixed ? `; ${pct(stance.mixed)}% are mixed` : ""
            }}.
          </template>
        </p>
        <StanceBar class="[&>div:first-child]:h-3" v-bind="stance" legend />
      </CardContent>
    </Card>

    <!-- Review progress -->
    <Card>
      <CardHeader>
        <CardTitle>Review progress</CardTitle>
        <CardDescription>Only approved arguments go into the memo.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Progress :model-value="review.done" class="h-2" />
        <div class="grid grid-cols-3 text-center">
          <div>
            <div class="text-xl font-semibold tabular-nums">{{ fmt(review.pending) }}</div>
            <div class="text-xs text-muted-foreground">to review</div>
          </div>
          <div>
            <div class="text-xl font-semibold text-emerald-700 tabular-nums">{{ fmt(review.approved) }}</div>
            <div class="text-xs text-muted-foreground">approved</div>
          </div>
          <div>
            <div class="text-xl font-semibold text-rose-700 tabular-nums">{{ fmt(review.rejected) }}</div>
            <div class="text-xs text-muted-foreground">rejected</div>
          </div>
        </div>
        <Button class="w-full" :disabled="!review.pending" @click="startReview">
          {{ review.pending ? "Review the next argument" : "All arguments reviewed" }} <ArrowRight />
        </Button>
      </CardContent>
    </Card>

    <!-- Top arguments -->
    <Card class="lg:col-span-2">
      <CardHeader>
        <CardTitle>Most common arguments</CardTitle>
        <CardDescription>Ranked by how many people made them. Click one to see the quotes behind it.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-1">
        <button
          v-for="(a, i) in top"
          :key="a.id"
          class="group block w-full rounded-lg px-2 py-2 text-left hover:bg-muted/60"
          @click="openArgument(a.id)"
        >
          <div class="flex items-baseline gap-3">
            <span class="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{{ i + 1 }}</span>
            <span class="min-w-0 flex-1 text-sm leading-snug group-hover:underline">{{ a.label }}</span>
            <Badge v-if="a.status === 'approved'" variant="outline" class="border-emerald-200 bg-emerald-50 text-emerald-700">approved</Badge>
            <span class="shrink-0 text-sm font-semibold tabular-nums">{{ fmt(a.commenters) }}</span>
          </div>
          <div class="mt-1.5 flex items-center gap-3 pl-7">
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary/70" :style="{ width: (100 * a.commenters) / maxCommenters + '%' }" />
            </div>
            <span
              class="w-28 shrink-0 text-right text-xs"
              :class="stanceSummary(a).stance ? STANCE_TEXT_COLOR[stanceSummary(a).stance!] : 'text-muted-foreground'"
            >
              {{ stanceSummary(a).text }}
            </span>
          </div>
        </button>
        <p v-if="!top.length" class="py-6 text-center text-sm text-muted-foreground">No arguments yet. Run the extract and merge steps.</p>
      </CardContent>
    </Card>

    <!-- Needs a person -->
    <Card>
      <CardHeader>
        <CardTitle>Needs a person</CardTitle>
        <CardDescription>What the tool could not handle on its own.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4 text-sm">
        <div class="flex gap-3">
          <Paperclip class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0 space-y-1.5">
            <p>
              <span class="font-semibold">{{ count(attachments.length, "comment") }}</span> only in an attachment (PDF or Word),
              which this tool doesn't read.
            </p>
            <div class="flex flex-wrap gap-1">
              <Button v-for="c in attachments.slice(0, 6)" :key="c.comment_id" as="a" :href="regsLink(c.comment_id)" target="_blank" size="xs" variant="outline">
                {{ c.organization ?? c.comment_id }}
              </Button>
              <span v-if="attachments.length > 6" class="self-center text-xs text-muted-foreground">+{{ attachments.length - 6 }} more in the memo</span>
            </div>
          </div>
        </div>
        <div class="flex gap-3">
          <ShieldAlert v-if="flagged" class="mt-0.5 size-4 shrink-0 text-rose-600" />
          <ShieldCheck v-else class="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <div class="space-y-1.5">
            <p v-if="flagged">
              <span class="font-semibold">{{ count(flagged, "argument") }}</span> whose quote failed the word-for-word check.
            </p>
            <p v-else>Every quote passed the word-for-word check.</p>
            <Button v-if="flagged" size="xs" variant="outline" @click="ui.tab = 'flagged'">Look at flagged quotes</Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Form letters -->
    <Card class="lg:col-span-3">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><Mail class="size-4" /> Form-letter campaigns</CardTitle>
        <CardDescription>
          Groups of comments that share the same text. The model reads each one once; every copy still counts as a person.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="groups.length" class="grid gap-3 md:grid-cols-2">
          <button
            v-for="g in groups"
            :key="g.id"
            class="rounded-lg border p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
            @click="openComment(g.representative_id)"
          >
            <div class="mb-2 flex items-center gap-2">
              <Badge variant="outline" class="border-amber-200 bg-amber-50 text-amber-800"><Users /> {{ fmt(g.size) }} people</Badge>
              <span class="text-xs text-muted-foreground">{{ g.kind === "exact" ? "identical text" : "near-identical text" }}</span>
              <span v-if="g.stance" class="ml-auto text-xs" :class="STANCE_TEXT_COLOR[g.stance]">{{ STANCE_LABEL[g.stance] }}</span>
            </div>
            <p class="line-clamp-3 text-sm leading-relaxed text-muted-foreground">"{{ g.excerpt }}…"</p>
          </button>
        </div>
        <p v-else class="flex items-center gap-2 text-sm text-muted-foreground"><FileWarning class="size-4" /> No form letters found.</p>
      </CardContent>
    </Card>
  </div>
</template>
