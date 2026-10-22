// Step 7: draft the summary memo.
//
// The memo is assembled by code from reviewed pieces; no LLM writes into it.
// Argument labels were approved (or edited) by a person, quotes are slices of the
// original comments, and comment IDs come from the database. After building it,
// verifyMemo() re-checks every cited ID and every quote against the database.

import { sql } from "./db.ts";
import { checkQuote } from "./quotecheck.ts";
import { argumentQuotes, attachmentOnly, listArguments, summary } from "./queries.ts";

const link = (id: string) => `[${id}](https://www.regulations.gov/comment/${id})`;
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "0%");
const fmt = (n: number) => n.toLocaleString("en-US");
const count = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
// YYYY-MM-DD. Regulations.gov deadlines are 11:59 PM Eastern, which is already the next day in UTC.
const day = (d: Date, timeZone?: string) => d.toLocaleDateString("en-CA", { timeZone });

export interface MemoCheck {
  citedIds: number;
  unknownIds: string[];
  quotesChecked: number;
  quotesFailed: string[];
}

export async function buildMemo(documentId: string, model: string, opts: { includePending?: boolean } = {}) {
  const s = await summary(documentId, model);
  if (!s) throw new Error(`${documentId} is not in the database`);
  const d = s.document;
  const all = await listArguments(documentId, model);
  const chosen = all.filter((a: any) => a.status === "approved" || (opts.includePending && a.status === "pending"));
  const shownQuotes: { commentId: string; quote: string }[] = [];

  const out: string[] = [];
  out.push(`# Draft summary of public comments`);
  out.push("");
  out.push(`**Proposed rule:** ${d.title}  `);
  out.push(
    `**Document:** [${d.document_id}](https://www.regulations.gov/document/${d.document_id}) · ` +
      `Docket ${d.docket_id} · ${d.agency_id}` +
      (d.comment_end_date ? ` · Comment period closed ${day(new Date(d.comment_end_date), "America/New_York")}` : ""),
  );
  out.push("");
  out.push(
    `> **Draft for staff review.** Generated ${day(new Date())} by docket-reader. ` +
      (opts.includePending
        ? "This draft includes arguments a reviewer has NOT yet approved; they are marked (unreviewed). "
        : "Every argument below was approved by a reviewer. ") +
      "Every quote was checked word for word against the comment it cites, and every comment ID links to the comment on Regulations.gov.",
  );
  out.push("");

  // Key findings: a few sentences filled in from the numbers, for a reader who
  // stops here. Still no model-written text: labels are reviewer-approved.
  const people = s.stances.reduce((n: number, r: any) => n + r.commenters, 0);
  const share = (stance: string) => s.stances.find((r: any) => r.stance === stance)?.commenters ?? 0;
  const largest = (
    await sql`select size, representative_id from comment_groups where document_id = ${documentId} order by size desc limit 1`
  )[0];
  out.push(`## Key findings`);
  out.push("");
  if (people) {
    out.push(
      `- Of ${count(people, "commenter")} whose comments were read, ${pct(share("oppose"), people)} oppose the rule as proposed, ` +
        `${pct(share("support"), people)} support it, ${pct(share("mixed"), people)} are mixed and ${pct(share("unclear"), people)} are unclear.`,
    );
  }
  if (chosen.length) {
    const top = chosen.slice(0, 3).map((a: any, i: number) => `"${a.label.replace(/\.$/, "")}" (${count(a.commenters, "commenter")}, §${i + 1})`);
    out.push(`- The most common ${chosen.length === 1 ? "argument is" : "arguments are"} ${top.join("; ")}.`);
  }
  if (s.duplicate_groups) {
    out.push(
      `- ${count(s.in_duplicate_groups, "comment")} (${pct(s.in_duplicate_groups, s.fetched - s.attachment_only)} of those read) came from ${count(s.duplicate_groups, "form-letter campaign")}` +
        (largest && largest.size > 1 ? `; the largest was sent ${fmt(largest.size)} times (e.g. ${link(largest.representative_id)}).` : "."),
    );
  }
  if (s.attachment_only) {
    out.push(`- ${count(s.attachment_only, "comment")} put their content in an attachment this tool does not read; a person should read them (Appendix B).`);
  }
  out.push("");

  out.push(`## At a glance`);
  out.push("");
  out.push(`| | |`);
  out.push(`|---|---|`);
  out.push(`| Comments posted | ${fmt(s.listed)} |`);
  out.push(`| Comments with text, analyzed | ${fmt(s.fetched - s.attachment_only)} |`);
  out.push(`| Attachment-only comments, not analyzed | ${fmt(s.attachment_only)} (Appendix B) |`);
  out.push(`| Distinct texts after grouping form letters | ${fmt(s.unique_texts)} |`);
  out.push(`| Form-letter groups | ${fmt(s.duplicate_groups)} groups covering ${fmt(s.in_duplicate_groups)} comments |`);
  out.push(`| Extraction model | ${model}; ${fmt(s.quotes.verified)} of ${fmt(s.quotes.claims)} quotes verified (${pct(s.quotes.verified, s.quotes.claims)}) |`);
  out.push("");
  const totalStance = s.stances.reduce((n: number, r: any) => n + r.commenters, 0);
  out.push(
    `**Overall position** (commenters; each copy of a form letter counts): ` +
      s.stances.map((r: any) => `${r.stance} ${fmt(r.commenters)} (${pct(r.commenters, totalStance)})`).join(" · ") +
      ".",
  );
  out.push("");

  out.push(`## Arguments raised, ranked by number of commenters`);
  out.push("");
  if (chosen.length === 0) {
    out.push("_No arguments have been approved yet. Approve arguments in the review UI, then export again._");
    out.push("");
  }
  const appendixA: string[] = [];
  for (const [i, a] of chosen.entries()) {
    const quotes = await argumentQuotes(a.id);
    const tag = a.status === "pending" ? " (unreviewed)" : "";
    out.push(`### ${i + 1}. ${a.label}${tag}`);
    out.push("");
    const positions = (["support", "oppose", "mixed", "unclear"] as const)
      .filter((k) => a[k] > 0)
      .map((k) => `${k} ${fmt(a[k])}`)
      .join(" · ");
    out.push(`Raised by **${count(a.commenters, "commenter")}** (${count(a.unique_comments, "distinct comment")}). Their overall position: ${positions}.`);
    out.push("");

    // Up to three example quotes, each from a different comment.
    const seen = new Set<string>();
    for (const q of quotes) {
      if (seen.size >= 3) break;
      if (seen.has(q.comment_id)) continue;
      seen.add(q.comment_id);
      const who = q.group_size > 1 ? ` (form letter sent by ${fmt(q.group_size)} commenters)` : q.organization ? ` (${q.organization})` : "";
      out.push(`> "${q.quote.replace(/\s+/g, " ")}"  `);
      out.push(`> — ${link(q.comment_id)}${who}`);
      out.push("");
      shownQuotes.push({ commentId: q.comment_id, quote: q.quote });
    }
    const ids: string[] = [...new Set<string>(quotes.map((q: any) => q.comment_id))];
    const shown = ids.slice(0, 8).map(link).join(", ");
    out.push(`Cited comments: ${shown}${ids.length > 8 ? `, and ${ids.length - 8} more (Appendix A)` : ""}.`);
    out.push("");
    appendixA.push(
      `**${i + 1}. ${a.label}**  \n` +
        quotes
          .filter((q: any, j: number, arr: any[]) => arr.findIndex((x) => x.comment_id === q.comment_id) === j)
          .map((q: any) => (q.group_size > 1 ? `${q.comment_id} (+${q.group_size - 1} copies)` : q.comment_id))
          .join(", "),
    );
  }

  out.push(`## Appendix A: every comment cited, by argument`);
  out.push("");
  out.push("Form-letter groups are listed by one representative comment; Appendix C lists every copy.");
  out.push("");
  out.push(appendixA.join("\n\n") || "_None._");
  out.push("");

  const attach = await attachmentOnly(documentId);
  out.push(`## Appendix B: what this draft does not cover`);
  out.push("");
  out.push(
    `- **${fmt(attach.length)} comments whose content is only in an attachment** (PDF/Word), which this tool does not read. ` +
      `These often come from organizations and need a person to read them:`,
  );
  out.push("");
  out.push(attach.map((r: any) => (r.organization ? `${r.comment_id} (${r.organization})` : r.comment_id)).join(", ") || "_None._");
  out.push("");
  const notChosen = all.length - chosen.length;
  out.push(`- ${fmt(notChosen)} merged arguments not included (not approved, or rejected by the reviewer).`);
  out.push(`- ${fmt(s.quotes.claims - s.quotes.verified)} extracted arguments whose quotes failed the word-for-word check were left out.`);
  out.push(`- Near-duplicate form letters are analyzed through one representative copy, so a sentence that only one sender added to a form letter is not read.`);
  out.push("");

  const groups = await sql`
    select g.id, g.size, g.kind, g.representative_id, array_agg(c.comment_id order by c.comment_id) as ids
    from comment_groups g join comments c on c.group_id = g.id
    where g.document_id = ${documentId} and g.size > 1
    group by g.id order by g.size desc`;
  out.push(`## Appendix C: form-letter groups`);
  out.push("");
  for (const g of groups) {
    out.push(`<details><summary>${fmt(g.size)} comments, ${g.kind === "exact" ? "identical" : "near-identical"} text, e.g. ${g.representative_id}</summary>`);
    out.push("");
    out.push(g.ids.join(", "));
    out.push("");
    out.push(`</details>`);
    out.push("");
  }
  if (groups.length === 0) out.push("_None._");

  const markdown = out.join("\n");
  const check = await verifyMemo(markdown, documentId, shownQuotes);
  return { markdown, check };
}

/** Independently re-check the finished memo against the database. */
export async function verifyMemo(
  markdown: string,
  documentId: string,
  quotes: { commentId: string; quote: string }[],
): Promise<MemoCheck> {
  const [doc] = await sql`select docket_id from documents where document_id = ${documentId}`;
  const pattern = new RegExp(`\\b${doc.docket_id.replace(/[-]/g, "\\-")}-\\d{4,}\\b`, "g");
  const cited = [...new Set(markdown.match(pattern) ?? [])].filter((id) => id !== documentId);
  const known = new Set<string>(
    cited.length
      ? (await sql`select comment_id from comments where document_id = ${documentId} and comment_id in ${sql(cited)}`).map(
          (r: { comment_id: string }) => r.comment_id,
        )
      : [],
  );
  const unknownIds = cited.filter((id) => !known.has(id));

  const quotesFailed: string[] = [];
  for (const q of quotes) {
    const [c] = await sql`select body from comments where comment_id = ${q.commentId}`;
    if (!c || !checkQuote(c.body, q.quote).ok) quotesFailed.push(`${q.commentId}: ${q.quote.slice(0, 60)}`);
  }
  return { citedIds: cited.length, unknownIds, quotesChecked: quotes.length, quotesFailed };
}
