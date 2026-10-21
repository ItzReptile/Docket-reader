// Step 1: pull a proposed rule's public comments from the Regulations.gov v4 API.
//
// The list endpoint only returns comment IDs and dates, so every comment costs one
// more request for its detail (the actual text). With a free api.data.gov key
// (1,000 requests/hour) a 2,000-comment rule takes a bit over two hours. The run is
// resumable: comments whose detail is already stored are skipped.

import { config } from "../config.ts";
import { sql } from "../db.ts";

const API = "https://api.regulations.gov/v4";
const minGapMs = 3_600_000 / config.regsRequestsPerHour;
let lastRequestAt = 0;

type Json = Record<string, any>;

async function get(path: string, params: Record<string, string | number> = {}): Promise<Json> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("api_key", config.regsApiKey);

  for (let attempt = 1; ; attempt++) {
    // Space requests evenly so a long run never hits the hourly limit.
    const wait = lastRequestAt + minGapMs - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch(url);
    if (res.ok) return (await res.json()) as Json;

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 8) throw new Error(`${res.status} from ${path} after ${attempt} tries`);
      const backoffMs = res.status === 429 ? 5 * 60_000 : 10_000 * attempt;
      console.warn(`  ${res.status} on ${path}; waiting ${Math.round(backoffMs / 1000)}s`);
      await Bun.sleep(backoffMs);
      continue;
    }
    throw new Error(`${res.status} from ${path}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** Comment text comes back as light HTML. Turn it into plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The lastModifiedDate filter wants Eastern time as "YYYY-MM-DD HH:MM:SS". */
function toEastern(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** The rule's abstract, from the Federal Register API (free, no key). */
async function federalRegisterAbstract(frDocNum: string | null): Promise<string | null> {
  if (!frDocNum) return null;
  const res = await fetch(`https://www.federalregister.gov/api/v1/documents/${frDocNum}.json?fields[]=abstract`);
  if (!res.ok) return null;
  return ((await res.json()) as Json).abstract ?? null;
}

async function saveDocument(documentId: string) {
  const { data } = await get(`/documents/${documentId}`);
  const a = data.attributes;
  const summary = await federalRegisterAbstract(a.frDocNum);
  await sql`
    insert into documents (document_id, object_id, docket_id, agency_id, title, comment_end_date, summary)
    values (${documentId}, ${a.objectId}, ${a.docketId}, ${a.agencyId}, ${a.title}, ${a.commentEndDate}, ${summary})
    on conflict (document_id) do update set
      title = excluded.title, comment_end_date = excluded.comment_end_date, summary = excluded.summary`;
  console.log(`${documentId}: ${a.title}`);
  return a.objectId as string;
}

/**
 * List every comment ID on the document. The API serves at most 20 pages of 250
 * (5,000 results) per query, so bigger dockets are walked in windows: sort by
 * lastModifiedDate and restart from the last date seen.
 */
async function listComments(documentId: string, objectId: string) {
  let since: string | undefined;
  let total = 0;
  for (;;) {
    let lastModified: string | undefined;
    for (let page = 1; page <= 20; page++) {
      const params: Record<string, string | number> = {
        "filter[commentOnId]": objectId,
        "page[size]": 250,
        "page[number]": page,
        sort: "lastModifiedDate,documentId",
      };
      if (since) params["filter[lastModifiedDate][ge]"] = since;
      const res = await get("/comments", params);
      const rows = res.data.map((c: Json) => ({
        comment_id: c.id,
        document_id: documentId,
        posted_date: c.attributes.postedDate,
      }));
      if (rows.length) await sql`insert into comments ${sql(rows)} on conflict (comment_id) do nothing`;
      total += rows.length;
      lastModified = res.data.at(-1)?.attributes.lastModifiedDate;
      if (page === 1 && !since) console.log(`  ${res.meta.totalElements} comments listed by the API`);
      if (!res.meta.hasNextPage) return total;
    }
    if (!lastModified) return total;
    since = toEastern(lastModified); // windows overlap by design; inserts ignore repeats
  }
}

async function fetchDetail(commentId: string) {
  const res = await get(`/comments/${commentId}`, { include: "attachments" });
  const a = res.data.attributes;
  const attachments = res.data.relationships?.attachments?.data?.length ?? 0;
  await sql`
    update comments set
      body = ${htmlToText(a.comment ?? "")},
      organization = ${a.organization || null},
      attachment_count = ${attachments},
      posted_date = ${a.postedDate},
      detail_fetched = true
    where comment_id = ${commentId}`;
}

export async function fetchComments(documentId: string, opts: { limit?: number; skipList?: boolean } = {}) {
  const objectId = await saveDocument(documentId);
  if (!opts.skipList) {
    const listed = await listComments(documentId, objectId);
    console.log(`  stored ${listed} comment IDs`);
  }

  const todo = await sql`
    select comment_id from comments
    where document_id = ${documentId} and not detail_fetched
    order by comment_id
    limit ${opts.limit ?? 1_000_000}`;
  const hours = (todo.length / config.regsRequestsPerHour).toFixed(1);
  console.log(`  fetching ${todo.length} comment details (about ${hours} h at ${config.regsRequestsPerHour}/h)`);

  let done = 0;
  for (const { comment_id } of todo) {
    try {
      await fetchDetail(comment_id);
    } catch (err) {
      console.warn(`  skipped ${comment_id}: ${(err as Error).message}`);
    }
    if (++done % 50 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
  }
  await sql`update documents set fetched_at = now() where document_id = ${documentId}`;
}
