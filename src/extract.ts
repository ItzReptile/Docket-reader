// Step 3: ask the LLM what one comment argues, then hold it to its quotes.
//
// The model returns { stance, arguments: [{ argument, quote }] } as JSON that
// matches EXTRACTION_SCHEMA. Every quote then goes through checkQuote(). Quotes
// that fail are sent back once or twice with the reason ("not found word for
// word") and the model gets a chance to copy the real sentence. Whatever still
// fails is kept but marked quote_ok = false, so a reviewer sees it as flagged
// and the memo leaves it out.
//
// Note what the model is NOT asked for: the comment ID. Code attaches it, so a
// citation can never point at the wrong comment.

import { checkQuote } from "./quotecheck.ts";
import type { ChatModel, Message } from "./llm/index.ts";

export type Stance = "support" | "oppose" | "mixed" | "unclear";

export interface Claim {
  argument: string;
  quote: string;
  quoteOk: boolean;
  quoteError?: string;
  start?: number;
  end?: number;
}

export interface Extraction {
  stance: Stance;
  claims: Claim[];
  llmCalls: number;
  seconds: number;
  /** Quotes that passed on the model's first try, before any retry. */
  firstTryPassed: number;
  /** Arguments the model proposed before any retry (the first-try denominator). */
  proposed: number;
}

export interface RuleInfo {
  documentId: string;
  agencyId: string;
  title: string;
  summary: string | null;
}

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    // Written before the stance (fields are generated in order), so the model
    // states what the commenter wants before judging it against the rule.
    asks: { type: "string" },
    stance: { type: "string", enum: ["support", "oppose", "mixed", "unclear"] },
    arguments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          argument: { type: "string" },
          quote: { type: "string" },
        },
        required: ["argument", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["asks", "stance", "arguments"],
  additionalProperties: false,
};

const FIX_SCHEMA = {
  type: "object",
  properties: {
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          quote: { type: "string" },
        },
        required: ["number", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["fixes"],
  additionalProperties: false,
};

function systemPrompt(rule: RuleInfo) {
  return `You read public comments sent to a U.S. federal agency about a proposed rule and record what each commenter argues.

Proposed rule: "${rule.title}" (${rule.documentId}, ${rule.agencyId}).
${rule.summary ? `What the rule proposes: ${rule.summary}\n` : ""}
For the comment you are given, return JSON with:
- asks: one sentence on what the commenter wants the agency to do, and whether the rule as proposed already does it. Write "nothing specific" if they ask for nothing.
- stance: the commenter's position on the rule as proposed. Judge it against what the rule actually does, not the topic in general. Sharing the rule's general goal (safety, better care, lower cost) is not support if what they ask for is something the rule does not do.
  support = wants it finalized, or says it is good as proposed.
  oppose = wants it withdrawn, rejects its main approach, or asks for a requirement the rule as proposed would not impose.
  mixed = welcomes the rule, its approach or some of its parts, and also objects to or asks to change something. If the commenter says anything positive about the rule itself, choose mixed rather than oppose.
  unclear = the position can't be told, or the comment is off topic.
- arguments: each distinct point the commenter makes. A point is either a request (what they want the agency to do) or a reason, concern or piece of evidence. List a request and each reason behind it as separate points. Short comments count too: "Please require X, it could save a life" makes two points. Usually 1 to 5. Use an empty list only if the comment makes no point at all.
  - argument: one point in at most 15 words, in your own words, phrased so it would read the same for any commenter making it. Good: "Extend the compliance deadline for small businesses". Good: "Small businesses cannot afford the new reporting software". Bad: "The rule fails to extend the deadline, which hurts small businesses because software is expensive" (that is two points). State it directly: never start with "The commenter", and never name anyone.
  - quote: the sentence (or two adjacent sentences) from the comment that makes this point, copied exactly, character for character. Do not fix spelling or grammar, do not shorten it with "...", and do not paraphrase.`;
}

// Long comments are read in chunks so the prompt stays well inside the context window.
const CHUNK_CHARS = 8000;

export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (current && current.length + para.length + 2 > size) {
      chunks.push(current);
      current = "";
    }
    // A single paragraph longer than the limit gets hard-split.
    for (let i = 0; i < para.length; i += size) {
      const piece = para.slice(i, i + size);
      if (current && current.length + piece.length + 2 > size) {
        chunks.push(current);
        current = "";
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

type Raw = { asks: string; stance: Stance; arguments: { argument: string; quote: string }[] };

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
    }
  }
}

export async function extractComment(
  llm: ChatModel,
  rule: RuleInfo,
  commentId: string,
  body: string,
  maxFixRounds = 2,
): Promise<Extraction> {
  const started = performance.now();
  let llmCalls = 0;
  const stances: Stance[] = [];
  const claims: Claim[] = [];
  let firstTryPassed = 0;
  let proposed = 0;

  for (const chunk of chunkText(body)) {
    const messages: Message[] = [
      { role: "system", content: systemPrompt(rule) },
      { role: "user", content: `Comment ${commentId}:\n"""\n${chunk}\n"""` },
    ];
    llmCalls++;
    const { data, raw } = await withRetry(() => llm.json<Raw>(messages, EXTRACTION_SCHEMA));
    stances.push(data.stance);

    const found: Claim[] = data.arguments
      .filter((a) => a.argument.trim())
      .map((a) => ({ argument: cleanArgument(a.argument), quote: a.quote.trim(), quoteOk: false }));
    for (const c of found) verify(body, c);
    firstTryPassed += found.filter((c) => c.quoteOk).length;
    proposed += found.length;

    // Send failed quotes back with the reason, in the same conversation.
    messages.push({ role: "assistant", content: raw });
    for (let round = 0; round < maxFixRounds; round++) {
      // An empty quote means the model already withdrew that argument.
      const failed = found.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => !c.quoteOk && c.quote !== "");
      if (failed.length === 0) break;
      messages.push({
        role: "user",
        content:
          "These quotes could not be found word for word in the comment:\n" +
          failed.map(({ c, n }) => `${n}. argument: ${c.argument}\n   quote: ${c.quote}\n   problem: ${c.quoteError}`).join("\n") +
          "\n\nFor each number, copy the sentence from the comment that makes the point exactly as it is written in the comment. " +
          "If the comment does not actually make that point, return an empty quote for it.",
      });
      llmCalls++;
      const fix = await withRetry(() => llm.json<{ fixes: { number: number; quote: string }[] }>(messages, FIX_SCHEMA));
      messages.push({ role: "assistant", content: fix.raw });
      for (const { number, quote } of fix.data.fixes) {
        const claim = found[number - 1];
        if (!claim || claim.quoteOk) continue;
        if (!quote.trim()) {
          claim.quoteError = "model withdrew the argument (no supporting sentence)";
          claim.quote = "";
          continue;
        }
        claim.quote = quote.trim();
        verify(body, claim);
      }
    }
    // An argument the model itself withdrew is dropped, not flagged.
    claims.push(...found.filter((c) => c.quote !== ""));
  }

  const stance = stances.every((s) => s === stances[0]) ? stances[0]! : "mixed";
  return {
    stance,
    claims,
    llmCalls,
    seconds: (performance.now() - started) / 1000,
    firstTryPassed,
    proposed,
  };
}

/**
 * Small models often write "The commenter argues that X" despite the prompt.
 * That shared prefix makes unrelated arguments look alike to the embedding
 * model, so strip it and keep just X.
 */
export function cleanArgument(text: string): string {
  const s = text
    .trim()
    .replace(/^(the |this |one )?(commenter|commentor|comment|writer|author|submitter)s? (strongly )?(argues|believes|states|says|claims|thinks|feels|fears|worries|warns|notes|suggests|asserts|contends|expresses|urges|requests|asks|wants|recommends|proposes|insists|maintains|stresses|points out|emphasizes|highlights|is concerned|is worried)( that)?[:,]?\s+/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function verify(body: string, claim: Claim) {
  const r = checkQuote(body, claim.quote);
  if (r.ok) {
    claim.quoteOk = true;
    claim.quoteError = undefined;
    claim.start = r.start;
    claim.end = r.end;
  } else {
    claim.quoteOk = false;
    claim.quoteError = r.error;
  }
}
