// Score a model against the hand labels.
//   bun run eval FAA-2026-9178-0001 [--model qwen3.5:4b] [--match 0.8]
//
// For every labeled comment, the extractor runs fresh (nothing is read from or
// written to the pipeline tables) and we measure:
//   - seconds per comment (wall clock, including quote retries)
//   - quote check: share of quotes verified on the model's first try, and after retries
//   - stance accuracy against the label
//   - argument recall: share of labeled arguments the model also found, and
//     precision: share of the model's verified arguments that match a label.
//     "Match" = cosine similarity of nomic-embed-text vectors >= --match,
//     paired one-to-one, best pairs first. Every pair is written to
//     eval/runs/ so the matching can be audited by hand.

import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { config } from "../src/config.ts";
import { sql } from "../src/db.ts";
import { chatModel, embedder } from "../src/llm/index.ts";
import { extractComment } from "../src/extract.ts";
import { ruleInfo } from "../src/pipeline/extract.ts";
import { cosine } from "../src/vectors.ts";
import { readLabels } from "./labels.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { model: { type: "string" }, match: { type: "string", default: "0.8" } },
});
const documentId = positionals[0];
if (!documentId) throw new Error("usage: bun run eval <document id> [--model name]");
const model = values.model ?? config.llmModel;
const matchAt = Number(values.match);

const file = await readLabels();
const labeled = (file?.comments ?? []).filter((c) => c.stance !== null);
if (!file || file.documentId !== documentId || labeled.length === 0) {
  throw new Error("No labels for this document. Run eval:sample, then label comments in the UI.");
}

const llm = chatModel(model);
const emb = embedder();
const rule = await ruleInfo(documentId);

/** Greedy one-to-one matching: take the most similar pair, remove both, repeat. */
function match(a: number[][], b: number[][]) {
  const pairs: { i: number; j: number; sim: number }[] = [];
  a.forEach((x, i) => b.forEach((y, j) => pairs.push({ i, j, sim: cosine(x, y) })));
  pairs.sort((p, q) => q.sim - p.sim);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: typeof pairs = [];
  for (const p of pairs) {
    if (p.sim < matchAt || usedA.has(p.i) || usedB.has(p.j)) continue;
    usedA.add(p.i);
    usedB.add(p.j);
    out.push(p);
  }
  return out;
}

const rows = [];
let firstTry = 0;
let firstTotal = 0;
try {
  for (const [n, label] of labeled.entries()) {
    const [c] = await sql`select body from comments where comment_id = ${label.commentId}`;
    const r = await extractComment(llm, rule, label.commentId, c.body);
    // n === 0 includes loading the model into memory; reported separately.
    const verified = r.claims.filter((x) => x.quoteOk);
    const [labelVecs, modelVecs] = await Promise.all([
      label.arguments.length ? emb.embed(label.arguments) : [],
      verified.length ? emb.embed(verified.map((x) => x.argument)) : [],
    ]);
    const pairs = match(labelVecs, modelVecs);
    firstTry += r.firstTryPassed;
    firstTotal += r.proposed;
    rows.push({
      commentId: label.commentId,
      seconds: r.seconds,
      coldStart: n === 0,
      llmCalls: r.llmCalls,
      stance: { label: label.stance, model: r.stance },
      quotes: { kept: r.claims.length, verified: verified.length, firstTry: r.firstTryPassed },
      labelArguments: label.arguments,
      modelArguments: r.claims.map((x) => ({ argument: x.argument, quote: x.quote, verified: x.quoteOk, error: x.quoteError })),
      matches: pairs.map((p) => ({ label: label.arguments[p.i], model: verified[p.j]!.argument, similarity: +p.sim.toFixed(3) })),
    });
    console.log(
      `  ${label.commentId} ${r.seconds.toFixed(1)}s stance ${r.stance}/${label.stance} ` +
        `args matched ${pairs.length}/${label.arguments.length} label, ${pairs.length}/${verified.length} model`,
    );
  }
} finally {
  await llm.unload?.();
  await sql.close();
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const warm = rows.filter((r) => !r.coldStart);
const secs = warm.map((r) => r.seconds).sort((a, b) => a - b);
const labelArgs = sum(rows.map((r) => r.labelArguments.length));
const modelArgs = sum(rows.map((r) => r.quotes.verified));
const matched = sum(rows.map((r) => r.matches.length));
const kept = sum(rows.map((r) => r.quotes.kept));

const summary = {
  model,
  provider: config.llmProvider,
  date: new Date().toISOString().slice(0, 10),
  comments: rows.length,
  secondsPerComment: +(sum(secs) / (secs.length || 1)).toFixed(2),
  secondsMedian: +(secs[Math.floor(secs.length / 2)] ?? 0).toFixed(2),
  coldStartSeconds: +(rows.find((r) => r.coldStart)?.seconds ?? 0).toFixed(1),
  quoteFirstTry: +(firstTry / (firstTotal || 1)).toFixed(3),
  quoteFinal: +(modelArgs / (kept || 1)).toFixed(3),
  stanceAccuracy: +(rows.filter((r) => r.stance.label === r.stance.model).length / rows.length).toFixed(3),
  argumentRecall: +(matched / (labelArgs || 1)).toFixed(3),
  argumentPrecision: +(matched / (modelArgs || 1)).toFixed(3),
  labelArguments: labelArgs,
  modelArguments: modelArgs,
  matchThreshold: matchAt,
};

await mkdir(new URL("./runs/", import.meta.url), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await Bun.write(new URL(`./runs/${model.replace(/[:/]/g, "_")}-${stamp}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 2));

// results.json keeps only the numbers (no comment text), one entry per model.
const resultsUrl = new URL("./results.json", import.meta.url);
const results: (typeof summary)[] = (await Bun.file(resultsUrl).exists()) ? await Bun.file(resultsUrl).json() : [];
await Bun.write(resultsUrl, JSON.stringify([...results.filter((r) => r.model !== model), summary], null, 2) + "\n");

const p = (x: number) => `${(100 * x).toFixed(0)}%`;
console.log("\n| Model | Quotes verified (1st try / after retry) | Arguments found (recall) | Precision | Stance accuracy | Sec/comment |");
console.log("|---|---|---|---|---|---|");
console.log(
  `| ${model} | ${p(summary.quoteFirstTry)} / ${p(summary.quoteFinal)} | ${p(summary.argumentRecall)} (${matched}/${labelArgs}) | ` +
    `${p(summary.argumentPrecision)} | ${p(summary.stanceAccuracy)} | ${summary.secondsPerComment} |`,
);
