<script setup lang="ts">
import { ref, watch } from "vue";
import { ShieldCheck } from "@lucide/vue";
import { api, fmt, type Flagged } from "@/api";
import { openComment, ui } from "@/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const rows = ref<Flagged[]>([]);
watch(() => [ui.doc, ui.model, ui.version], async () => (rows.value = await api.flagged(ui.doc, ui.model)), { immediate: true });
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Flagged quotes</CardTitle>
      <CardDescription>
        Arguments whose quote could not be found word for word in the comment, even after the model was asked to fix it.
        They are left out of merging and the memo. Open the comment to judge them yourself.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Table v-if="rows.length">
        <TableHeader>
          <TableRow>
            <TableHead class="w-44">Comment</TableHead>
            <TableHead>Argument the model claimed</TableHead>
            <TableHead>Quote it gave</TableHead>
            <TableHead class="w-56">Why it failed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in rows" :key="r.id" class="align-top">
            <TableCell class="space-y-1">
              <Button variant="link" size="sm" class="h-auto p-0 font-mono" @click="openComment(r.comment_id)">{{ r.comment_id }}</Button>
              <Badge v-if="r.group_size > 1" variant="outline" class="border-amber-200 bg-amber-50 text-amber-800">×{{ fmt(r.group_size) }}</Badge>
            </TableCell>
            <TableCell class="whitespace-normal">{{ r.argument }}</TableCell>
            <TableCell class="whitespace-normal text-muted-foreground italic">"{{ r.quote }}"</TableCell>
            <TableCell class="whitespace-normal text-rose-700">{{ r.quote_error }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div v-else class="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
        <ShieldCheck class="size-8 text-emerald-600" />
        Every extracted quote was found word for word in its comment.
      </div>
    </CardContent>
  </Card>
</template>
