// Form-letter detection with plain code, no AI.
//
// Exact duplicates: same text after normalizing case, punctuation and whitespace.
// Near duplicates: the same template with a sentence or two changed. Each text is
// cut into overlapping 5-word "shingles"; two texts whose shingle sets overlap by at
// least `threshold` (Jaccard similarity) are linked, and linked texts form a group.

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shingles(normalized: string, k = 5): Set<string> {
  const words = normalized.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
}

export interface Item {
  id: string;
  text: string;
}

export interface Group {
  ids: string[];
  representative: string; // the member the LLM will read
  kind: "single" | "exact" | "near";
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]!]!;
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

/**
 * @param threshold Jaccard similarity needed to call two texts the same letter.
 * @param minWords  Texts shorter than this only group on exact matches; short
 *                  comments share 5-word runs by chance too often.
 */
export function groupDuplicates(items: Item[], threshold = 0.5, minWords = 25): Group[] {
  // 1. Exact duplicates collapse to one "variant" each.
  const variants = new Map<string, string[]>(); // normalized text -> comment ids
  for (const item of items) {
    const key = normalize(item.text);
    const ids = variants.get(key) ?? [];
    ids.push(item.id);
    variants.set(key, ids);
  }
  const texts = [...variants.keys()];
  const sets = texts.map((t) => (t.split(" ").length >= minWords ? shingles(t) : new Set<string>()));

  // 2. Find near-duplicate variants. An inverted index (shingle -> variants that
  // contain it) means we only compare texts that share at least one shingle.
  const index = new Map<string, number[]>();
  sets.forEach((set, i) => {
    for (const s of set) {
      const list = index.get(s) ?? [];
      list.push(i);
      index.set(s, list);
    }
  });
  const uf = new UnionFind(texts.length);
  sets.forEach((set, i) => {
    if (set.size === 0) return;
    const shared = new Map<number, number>();
    for (const s of set) {
      for (const j of index.get(s)!) if (j > i) shared.set(j, (shared.get(j) ?? 0) + 1);
    }
    for (const [j, n] of shared) {
      const sim = n / (set.size + sets[j]!.size - n);
      if (sim >= threshold) uf.union(i, j);
    }
  });

  // 3. Collect groups. The representative is the most-copied variant (the
  // template itself, usually), so the LLM reads the text most people sent.
  const byRoot = new Map<number, number[]>();
  texts.forEach((_, i) => {
    const root = uf.find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), i]);
  });

  const groups: Group[] = [];
  for (const members of byRoot.values()) {
    const ids = members.flatMap((i) => variants.get(texts[i]!)!).sort();
    const top = members.reduce((best, i) =>
      variants.get(texts[i]!)!.length > variants.get(texts[best]!)!.length ? i : best,
    );
    const kind = ids.length === 1 ? "single" : members.length === 1 ? "exact" : "near";
    groups.push({ ids, representative: [...variants.get(texts[top]!)!].sort()[0]!, kind });
  }
  return groups.sort((a, b) => b.ids.length - a.ids.length);
}

/** Comments whose real content is in a PDF/Word attachment we do not read. */
export function isAttachmentOnly(body: string | null, attachmentCount: number): boolean {
  const text = (body ?? "").trim();
  if (text.length === 0) return true;
  return attachmentCount > 0 && text.length < 300 && /attach|enclos|see (the )?(file|letter|document)/i.test(text);
}
