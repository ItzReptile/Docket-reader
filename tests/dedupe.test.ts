import { describe, expect, test } from "bun:test";
import { groupDuplicates, isAttachmentOnly } from "../src/dedupe.ts";

const template =
  "I strongly urge the FAA to require that all commercial aircraft carry epinephrine auto-injectors " +
  "for both adults and children as part of their onboard emergency medical equipment. Severe allergic " +
  "reactions can occur without warning, even in individuals with no known history of allergies.";

describe("groupDuplicates", () => {
  test("exact copies (ignoring case and punctuation) form one group", () => {
    const groups = groupDuplicates([
      { id: "c1", text: template },
      { id: "c2", text: template.toUpperCase() },
      { id: "c3", text: template.replace(/\./g, "") },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe("exact");
    expect(groups[0]!.ids).toEqual(["c1", "c2", "c3"]);
  });

  test("a form letter with a personal line added is a near duplicate", () => {
    const groups = groupDuplicates([
      { id: "c1", text: template },
      { id: "c2", text: template },
      { id: "c3", text: "As a mother of a child with a peanut allergy, this matters to me. " + template },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe("near");
    expect(groups[0]!.representative).toBe("c1"); // the most-copied version
  });

  test("an already-read member stays the representative", () => {
    const items = [
      { id: "c1", text: template },
      { id: "c2", text: template },
      { id: "c3", text: "As a mother of a child with a peanut allergy, this matters to me. " + template },
    ];
    expect(groupDuplicates(items)[0]!.representative).toBe("c1");
    expect(groupDuplicates(items, 0.5, 25, new Set(["c3"]))[0]!.representative).toBe("c3");
  });

  test("different comments stay separate", () => {
    const groups = groupDuplicates([
      { id: "c1", text: template },
      { id: "c2", text: "Airlines already train crews well and the added cost of new kits would raise fares for everyone who flies regularly on short regional routes." },
      { id: "c3", text: "I support this." },
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.kind === "single")).toBe(true);
  });
});

describe("isAttachmentOnly", () => {
  test("detects 'see attached' stubs", () => {
    expect(isAttachmentOnly("See attached file(s)", 1)).toBe(true);
    expect(isAttachmentOnly("", 0)).toBe(true);
    expect(isAttachmentOnly("Please see the attached letter from our association.", 2)).toBe(true);
    expect(isAttachmentOnly(template, 1)).toBe(false);
  });
});
