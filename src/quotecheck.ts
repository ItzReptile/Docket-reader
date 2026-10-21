// Step 4: the quote check. Plain code, no AI.
//
// Every argument the model extracts must come with a quote, and the quote must
// appear word for word in the comment it came from. This is the guarantee the
// whole tool rests on: a reviewer can trust that each argument was really made,
// because the words are right there in the source.
//
// Matching ignores only what doesn't change the words: letter case, runs of
// whitespace, and curly-vs-straight quote marks and dashes. A dropped comma, a
// fixed typo or a "..." splice all fail. When a quote passes we keep the character
// offsets of the match, and everything downstream (UI, memo) shows that slice of
// the original comment, never the model's copy of it.

export const MIN_WORDS = 4;
export const MAX_WORDS = 80;

export type QuoteResult =
  | { ok: true; start: number; end: number }
  | { ok: false; error: string };

const FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "`": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
  "‐": "-", "‑": "-", "–": "-", "—": "-", "‒": "-", "―": "-", "−": "-",
  "…": "...",
};

/** Canonical form for matching, plus a map from each output char to its source index. */
function canon(text: string): { s: string; map: number[] } {
  let s = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = s.length > 0;
      continue;
    }
    if (pendingSpace) {
      s += " ";
      map.push(i);
      pendingSpace = false;
    }
    for (const c of (FOLD[ch] ?? ch).toLowerCase()) {
      s += c;
      map.push(i);
    }
  }
  return { s, map };
}

/** Strip wrapper quote marks and trailing punctuation the model tends to add or drop. */
function trimQuote(quote: string): string {
  return quote
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .replace(/[\s.,;:!?]+$/, "")
    .trim();
}

export function checkQuote(comment: string, quote: string): QuoteResult {
  const q = trimQuote(quote);
  const words = q.split(/\s+/).filter(Boolean).length;
  const body = canon(comment);
  const needle = canon(q).s;

  if (words === 0) return { ok: false, error: "empty quote" };

  const at = body.s.indexOf(needle);
  if (at === -1) {
    if (/\.\.\.|…/.test(q)) return { ok: false, error: 'not found; quotes must not be shortened with "..."' };
    return { ok: false, error: "not found word for word in the comment" };
  }

  // A tiny quote ("the rule") is found in almost any comment, so it proves nothing.
  // The exception is a comment that is itself that short.
  const wholeComment = needle.length >= body.s.replace(/[\s.,;:!?]+$/, "").length;
  if (words < MIN_WORDS && !wholeComment) {
    return { ok: false, error: `too short to verify (under ${MIN_WORDS} words)` };
  }
  if (words > MAX_WORDS) return { ok: false, error: `too long (over ${MAX_WORDS} words); quote only the key sentence` };

  return { ok: true, start: body.map[at]!, end: body.map[at + needle.length - 1]! + 1 };
}
