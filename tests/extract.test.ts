import { describe, expect, test } from "bun:test";
import { chunkText, cleanArgument, extractComment } from "../src/extract.ts";
import type { ChatModel, Message } from "../src/llm/index.ts";

describe("cleanArgument", () => {
  test("strips 'the commenter argues that' boilerplate", () => {
    expect(cleanArgument("The commenter argues that kits often lack epinephrine.")).toBe("Kits often lack epinephrine.");
    expect(cleanArgument("Commenter believes the rule is too weak")).toBe("The rule is too weak");
    expect(cleanArgument("Airlines should carry epinephrine")).toBe("Airlines should carry epinephrine");
  });
});

describe("chunkText", () => {
  test("keeps short text whole and splits long text on paragraphs", () => {
    expect(chunkText("short")).toEqual(["short"]);
    const para = "x".repeat(600);
    const chunks = chunkText(Array(5).fill(para).join("\n\n"), 1300);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 1300)).toBe(true);
  });
});

/** A fake model that replays scripted replies, to test the retry loop without Ollama. */
function scripted(replies: object[]): ChatModel & { seen: Message[][] } {
  const seen: Message[][] = [];
  return {
    model: "fake",
    seen,
    async json<T>(messages: Message[]) {
      seen.push([...messages]);
      const next = replies.shift();
      if (!next) throw new Error("no more replies");
      return { data: next as T, raw: JSON.stringify(next) };
    },
  };
}

const rule = { documentId: "X-1", agencyId: "X", title: "Test rule", summary: null };
const body = "Airlines must carry epinephrine auto-injectors on every flight. My daughter nearly died at 30,000 feet.";

describe("extractComment", () => {
  test("a bad quote is sent back with the reason, and the fixed quote is accepted", async () => {
    const llm = scripted([
      { stance: "oppose", arguments: [{ argument: "Require auto-injectors", quote: "Airlines should carry auto-injectors" }] },
      { fixes: [{ number: 1, quote: "Airlines must carry epinephrine auto-injectors on every flight." }] },
    ]);
    const r = await extractComment(llm, rule, "X-1-0001", body);
    expect(r.llmCalls).toBe(2);
    expect(r.firstTryPassed).toBe(0);
    expect(r.claims[0]!.quoteOk).toBe(true);
    expect(llm.seen[1]!.at(-1)!.content).toContain("not found word for word");
  });

  test("a quote that never verifies is kept but flagged", async () => {
    const llm = scripted([
      { stance: "oppose", arguments: [{ argument: "Require kits", quote: "made up words here" }] },
      { fixes: [{ number: 1, quote: "still made up words" }] },
      { fixes: [{ number: 1, quote: "made up again, sorry" }] },
    ]);
    const r = await extractComment(llm, rule, "X-1-0001", body);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]!.quoteOk).toBe(false);
  });

  test("an argument the model withdraws is dropped", async () => {
    const llm = scripted([
      { stance: "unclear", arguments: [{ argument: "Something unsupported", quote: "not in the text at all" }] },
      { fixes: [{ number: 1, quote: "" }] },
    ]);
    const r = await extractComment(llm, rule, "X-1-0001", body);
    expect(r.claims).toHaveLength(0);
  });
});
