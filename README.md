# docket-reader

An open-source "AI worker" for one manual step of federal rulemaking: **reading the public comments on a proposed rule and drafting a summary of what people argued**, with every claim traceable to the exact words of a real comment, and a person approving the result.

It runs on a laptop: a local LLM through [Ollama](https://ollama.com), Postgres, and a small review UI.

## The problem

When a U.S. federal agency proposes a rule, anyone can comment on it at [Regulations.gov](https://www.regulations.gov). Before the rule is finalized, the agency has to consider those comments and respond to the significant ones in the final rule. Staff do this by hand: read every comment, notice that 400 of them are the same form letter, sort out which arguments were made and how often, and write it up.

A rule with a couple of thousand comments is days of reading. The judgment calls (which arguments are significant, how to respond) belong to people. The sorting and tallying is the part a machine can do, if a reviewer can trust it, which means every summarized argument has to point back to the words a real commenter wrote.

## What it does

```
Regulations.gov API
   │  1. fetch       pull every comment on one proposed rule into Postgres
   ▼
   │  2. group       exact and near-duplicate form letters → groups with counts      (plain code)
   ▼
   │  3. extract     local LLM reads each distinct text once: stance, arguments,     (LLM)
   │                 and a supporting quote for each argument
   ▼
   │  4. quote check every quote must appear word for word in its comment;            (plain code)
   │                 failures go back to the model with the reason, then get flagged
   ▼
   │  5. merge       the same argument in different words, across comments           (embeddings)
   ▼
   │  6. review      arguments ranked by how many people made them; approve, edit,   (person)
   │                 reject or merge; source quotes one click away
   ▼
   7. memo          Markdown draft built from approved arguments only; every claim    (plain code)
                    cites comment IDs that link to Regulations.gov
```

The LLM does one narrow job (step 3). Everything around it is ordinary code that checks its work.

## Why you can trust the output

- **Every quote is checked against the source.** `src/quotecheck.ts` looks for the model's quote in the comment it came from. It forgives only what doesn't change the words: letter case, extra spaces, curly vs. straight quote marks and dashes. A dropped word, a "fixed" typo, or a `...` splice fails. Very short quotes ("the rule") fail too, since they would match almost anything.
- **Failures get a second chance, then a flag.** A failed quote is sent back to the model with the reason ("not found word for word") and it can copy the real sentence or withdraw the point. If it still fails after two retries, the argument is kept but flagged, shown on its own tab, and left out of merging and the memo.
- **The model never writes comment IDs.** Code attaches the ID of the comment being read, so a citation can't point at the wrong comment.
- **The UI and memo show the comment's own text, not the model's copy.** Once a quote passes, its character offsets are stored, and everything downstream slices the original comment.
- **The memo is assembled by code.** Labels are ones a reviewer approved (or rewrote), quotes are slices of real comments, counts come from SQL. After building it, `verifyMemo()` re-checks that every cited ID exists and every quote is still found word for word.
- **Form letters count as people, not texts.** If 300 people sent the same letter, its arguments are "raised by 300 commenters", while the model reads it once.

## A real run

The FAA's proposed rule [FAA-2026-9178-0001](https://www.regulations.gov/document/FAA-2026-9178-0001), *Improving Emergency Medical Kit Efficacy and Flexibility in Commercial Airline Operations*, would replace the fixed list of items airlines must carry in their emergency medical kits with a performance-based standard. Its comment period closed on October 5, 2026. Many commenters asked the FAA to keep epinephrine (the drug in EpiPens) explicitly required.

Run on one desktop (RTX 3060 Ti, 8 GB) with `qwen3.5:4b`:

| | |
|---|---|
| Comments posted | 1,736 |
| Attachment-only (content in a PDF or Word file, not read) | 28 |
| Form letters | 328 comments in 53 groups; the largest was sent 136 times |
| Distinct texts the model read | 1,433 |
| Model time | about 60 minutes in total; median 2.3 s per text |
| Arguments extracted | 3,361, of which 3,360 passed the quote check (1 flagged for review) |
| Texts that needed a quote retry | 103 of 1,433 |
| Distinct arguments after merging | 457 |
| Fetch time | about 2 hours (one API request per comment, about 1,000 an hour) |

Where commenters stand on the rule as proposed (each copy of a form letter counts as one person): of the 1,708 commenters whose comments were read, 1,509 oppose it (88%), 91 are mixed (5%), 87 support it (5%) and 21 are unclear (1%).

The automatic merge leaves the top of the list as the same request in several wordings ("Mandate epinephrine availability on all aircraft", 617 commenters; "Require epinephrine to be included in emergency medical kits", 308; "Require epinephrine to be available on all flights", 232). It is conservative on purpose: an earlier, looser setting folded different points together. The review screen suggests similar arguments so a reviewer can merge them in a few clicks.

## Eval

**Method.** 26 comments were drawn at random from the 1,364 distinct texts with at least 10 words (`bun run eval:sample` draws 30 by default). The author labeled each one in the UI's *Eval labels* tab without seeing the model's answer: the commenter's position on the rule, and each distinct point they make, in their own words ([`eval/labels.json`](eval/labels.json)). `bun run eval` then runs the extractor fresh on each comment and scores it:

- **Quotes verified:** share of the model's quotes found word for word on the first try, and after retries.
- **Points found (recall):** share of the labeler's points the model also found.
- **Precision:** share of the model's verified points that match a labeled point.
- A model point "matches" a labeled point when their `nomic-embed-text` embeddings have cosine similarity ≥ 0.8, paired one to one. This is approximate: auditing the pairs turned up a few false matches and a few missed ones, so treat recall and precision as rough. Every pair is written to `eval/runs/` (gitignored, since it contains comment text) for checking by hand.

| Prompt | Quotes verified (1st try / after retry) | Points found (recall) | Precision | Stance matches label | Sec per comment |
|---|---|---|---|---|---|
| First version | 98% / 100% | 71% (42/59) | 64% | 38% (10/26) | 2.25 |
| Asks first (current) | 98% / 100% | 76% (45/59) | 67% | 85% (22/26) | 2.59 |

**What the eval caught.** The first prompt already said that wanting something the rule doesn't do is not support. Even so, the model read short requests such as "Please make EpiPens standard practice on airlines" as *support* for a rule that would not require them: 12 of its 16 stance misses were this pattern. The fix has the model first write one sentence on what the commenter asks for and whether the rule already does it, then choose a stance, with "mixed" taking precedence over "oppose" when the commenter says anything positive about the rule. On the full docket, the share of commenters marked as supporting the rule went from 36% to 5%, and the share opposing it from 52% to 88%.

**Read these numbers with care:**
- The fix was found by studying the misses on these same 26 comments, so the second row is optimistic. An unbiased number needs a fresh labeled sample.
- 24 of the 26 labels are "oppose", so stance accuracy here mostly measures whether the model catches opposition, not whether it recognizes support. As a separate check, the current prompt was run on 11 comments that say outright that they support the rule: 10 came back as support or mixed, 1 as oppose. Those 11 were not hand-labeled.
- One labeler, one docket, one model, 26 comments.

## How to run it

You need [Bun](https://bun.sh) 1.2+, Postgres 14+ and [Ollama](https://ollama.com).

```bash
git clone https://github.com/ItzReptile/Docket-reader docket-reader && cd docket-reader
bun install
cp .env.example .env          # then put your api.data.gov key in REGS_API_KEY
psql -U postgres -h localhost -f scripts/create-db.sql
ollama pull qwen3.5:4b
ollama pull nomic-embed-text
```

Get a free API key at [api.data.gov/signup](https://api.data.gov/signup/). The key allows about 1,000 requests an hour and each comment costs one request, so a 2,000-comment rule takes around two hours to fetch. The fetch is resumable.

Run the pipeline on a proposed rule (use the document ID from its Regulations.gov URL):

```bash
bun run pipeline FAA-2026-9178-0001
```

or one step at a time: `fetch`, `group`, `extract`, `merge`, then `memo`. Each takes the document ID; `bun run extract <id> --limit 20` is handy for a quick look.

Review in the browser:

```bash
bun run api      # http://localhost:3000
bun run web      # http://localhost:5173 (dev UI, proxies /api)
```

or `bun run build && bun start` to serve everything from port 3000. Approve arguments with the buttons or keys (`j`/`k` to move, `a` approve, `r` reject), then open the Memo tab and download the Markdown. `bun run memo <id>` writes the same file to `memos/`.

To score a model against your own labels: `bun run eval:sample <id>`, label the comments in the *Eval labels* tab, then `bun run eval <id>`.

### Using a hosted model instead

Set `LLM_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `LLM_MODEL` in `.env`. Any server that speaks the OpenAI chat-completions API with JSON-schema structured outputs works. The pipeline only talks to models through the small interface in `src/llm/types.ts`.

## Design notes

- **Local model by default.** Comments are public, but an agency running this would rather not send its review workflow to a third party, and a local model costs nothing per token. The default, `qwen3.5:4b`, uses about 3.3 GB of GPU memory and runs on an 8 GB consumer card.
- **Constrained output, thinking off.** Ollama's `format` option turns a JSON schema into a grammar, so replies always parse. `think: false` stops qwen3.5 from writing a long reasoning trace first, which multiplies the time per comment for no gain on this task.
- **The rule's own summary is in the prompt, and the model states the ask first.** The extractor gets the Federal Register abstract, and the JSON schema puts an `asks` field before `stance`. Fields are generated in order, so the model writes down what the commenter wants, and whether the rule already does it, before it judges their position (see the eval).
- **One short point per argument.** Each argument is a single request or a single reason in at most 15 words, so the same point made by different people embeds the same way and can be counted.
- **Form letters are found with plain code.** Normalized text for exact copies, then 5-word shingles and Jaccard similarity (≥ 0.5) for near copies, using an inverted index so only texts that share a phrase are compared. It is deterministic, fast and easy to explain. When a group grows between runs, the copy the model already read stays the group's representative, so no group is counted twice.
- **Merging uses embeddings, plus a person.** Arguments are embedded with `nomic-embed-text` and clustered greedily, biggest form letter first, at cosine ≥ 0.88. Two points from the same comment are never merged, since the model listed them separately. Automatic merging is conservative on purpose; the UI suggests similar arguments so the reviewer can merge the rest.
- **Postgres, no vector extension.** Embeddings are stored as `real[]` and compared in TypeScript; at a few thousand arguments that takes milliseconds. A much larger docket would move to pgvector with an index. Postgres rather than SQLite because the fetcher, the extractor and the review UI write at the same time.
- **TypeScript end to end.** Bun runs the scripts and the API (and provides the Postgres client), Elysia serves the API with validated request bodies, and Vue with [shadcn-vue](https://www.shadcn-vue.com) components renders the review UI.

## Limitations

- **Attachments are not read.** 28 comments on this docket put their content in a PDF or Word file, 21 of them from organizations. These are often the most detailed comments; the UI and memo list them for a person to read.
- **Ranked by count, not substance.** The list is ordered by how many people raised a point, but an agency has to answer significant points however many people made them. A single expert comment (a neurologist asking for seizure rescue medication in the kits, say) ranks below any form letter, so a reviewer still has to look down the list.
- **Stance is a judgment call.** Many commenters ask the FAA to "add" epinephrine to a rule that removes the required list, and some comments can't be read either way from the text ("this would save her life"). See the eval for how often the model agrees with a person.
- **Merging needs a reviewer.** 457 distinct arguments is a lot to review, and many are the same request in different words. The 0.88 cutoff was tuned on this one docket.
- **Near-duplicates are read through one copy.** A sentence that one sender added to a form letter is not read.
- **Fetching is slow.** The API's rate limit makes a 2,000-comment rule about two hours.
- **The eval is small.** One labeler, 26 comments, one docket and one model; see the caveats above.

## Data and privacy

Comment data is never committed. The repo ships the fetch script; everything downloaded lives in your local Postgres. The fetcher stores each comment's text and its organization, if one was given, and not the separate name fields. Comment text itself often ends with the writer's name, so treat the database as personal data. `memos/` and `eval/runs/` (which contain comment text) are gitignored. `eval/labels.json` holds only comment IDs and the labeler's own paraphrases.

## Tests

```bash
bun test         # quote check, form-letter grouping, the retry loop (with a fake model)
bun run typecheck
```

## License

MIT
