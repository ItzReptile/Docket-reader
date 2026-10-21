<script setup lang="ts">
import { Bot, CircleHelp, Code2, User } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const steps = [
  { who: "code", title: "Fetch", text: "Every public comment on the rule is downloaded from Regulations.gov." },
  { who: "code", title: "Group form letters", text: "Identical and near-identical letters are grouped, so a letter sent by 300 people is read once but still counts as 300 people." },
  { who: "ai", title: "Extract", text: "A local AI model reads each distinct comment and lists the commenter's position and each argument, with a quote that backs it up." },
  { who: "code", title: "Check every quote", text: "Code looks for each quote, word for word, in the comment it came from. If it isn't there, the model gets two chances to fix it; after that the argument is flagged and kept out of the memo." },
  { who: "ai", title: "Merge", text: "The same point made in different words by different people is merged into one argument, with a count of how many people made it." },
  { who: "person", title: "Review", text: "You approve, reword, reject or merge arguments. Every quote is one click from the full comment." },
  { who: "code", title: "Memo", text: "A draft summary is assembled from approved arguments only. Every claim cites real comment IDs, and the memo re-checks its own citations." },
] as const;

const WHO = {
  code: { icon: Code2, label: "plain code", cls: "bg-sky-50 text-sky-800 border-sky-200" },
  ai: { icon: Bot, label: "AI", cls: "bg-violet-50 text-violet-800 border-violet-200" },
  person: { icon: User, label: "you", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
};
</script>

<template>
  <Sheet>
    <SheetTrigger as-child>
      <Button variant="ghost" size="sm"><CircleHelp /> How it works</Button>
    </SheetTrigger>
    <SheetContent class="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-md">
      <SheetHeader>
        <SheetTitle>How docket-reader works</SheetTitle>
        <SheetDescription>
          The AI does two narrow jobs. Plain code checks its work, and a person makes every call that matters.
        </SheetDescription>
      </SheetHeader>
      <ol class="space-y-4 overflow-y-auto px-4 pb-6">
        <li v-for="(s, i) in steps" :key="s.title" class="flex gap-3">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{{ i + 1 }}</span>
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ s.title }}</span>
              <Badge variant="outline" :class="WHO[s.who].cls"><component :is="WHO[s.who].icon" /> {{ WHO[s.who].label }}</Badge>
            </div>
            <p class="text-sm leading-relaxed text-muted-foreground">{{ s.text }}</p>
          </div>
        </li>
      </ol>
    </SheetContent>
  </Sheet>
</template>
