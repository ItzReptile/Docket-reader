import { describe, expect, test } from "bun:test";
import { decodeEntities, htmlToText } from "../src/pipeline/fetch.ts";

describe("htmlToText", () => {
  test("decodes named, decimal and hex entities", () => {
    expect(htmlToText("they didn&rsquo;t have it &mdash; &ldquo;ever&rdquo;")).toBe("they didn’t have it — “ever”");
    expect(htmlToText("caf&eacute; &#233; &#xE9;")).toBe("café é é");
  });

  test("turns breaks and paragraphs into newlines and strips tags", () => {
    expect(htmlToText("<p>One<br/>two</p><p><b>Three</b></p>")).toBe("One\ntwo\n\nThree");
  });

  test("decodes once, so an escaped entity stays literal", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("AT&T &unknown; stays")).toBe("AT&T &unknown; stays");
  });
});
