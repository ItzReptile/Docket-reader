// Read/write queries shared by the review API and the memo.

import { sql } from "./db.ts";
import { cosine, mean } from "./vectors.ts";

export async function listDocuments() {
  return sql`
    select d.document_id, d.title, d.agency_id, d.docket_id, d.comment_end_date,
           (select count(*)::int from comments c where c.document_id = d.document_id) as comments
    from documents d order by d.document_id`;
}

export async function models(documentId: string): Promise<string[]> {
  const rows = await sql`
    select distinct e.model from extractions e join comments c using (comment_id)
    where c.document_id = ${documentId} order by 1`;
  return rows.map((r: { model: string }) => r.model);
}

export async function summary(documentId: string, model: string) {
  const [doc] = await sql`select * from documents where document_id = ${documentId}`;
  if (!doc) return null;
  const [counts] = await sql`
    select
      (select count(*)::int from comments where document_id = ${documentId}) as listed,
      (select count(*)::int from comments where document_id = ${documentId} and detail_fetched) as fetched,
      (select count(*)::int from comments where document_id = ${documentId} and detail_fetched and group_id is null) as attachment_only,
      (select count(*)::int from comment_groups where document_id = ${documentId}) as unique_texts,
      (select count(*)::int from comment_groups where document_id = ${documentId} and size > 1) as duplicate_groups,
      (select coalesce(sum(size), 0)::int from comment_groups where document_id = ${documentId} and size > 1) as in_duplicate_groups`;
  const [ex] = await sql`
    select count(*)::int as extracted,
           coalesce(sum(g.size), 0)::int as commenters_covered,
           coalesce(avg(e.seconds), 0)::float as avg_seconds
    from extractions e join comment_groups g on g.representative_id = e.comment_id
    where g.document_id = ${documentId} and e.model = ${model}`;
  const [q] = await sql`
    select count(*)::int as claims, count(*) filter (where cl.quote_ok)::int as verified
    from claims cl join comments c using (comment_id)
    where c.document_id = ${documentId} and cl.model = ${model}`;
  const stances = await sql`
    select e.stance, sum(g.size)::int as commenters, count(*)::int as unique_texts
    from extractions e join comment_groups g on g.representative_id = e.comment_id
    where g.document_id = ${documentId} and e.model = ${model}
    group by e.stance order by 2 desc`;
  const [args] = await sql`
    select count(*)::int as total,
           count(*) filter (where status = 'approved')::int as approved,
           count(*) filter (where status = 'rejected')::int as rejected
    from arguments where document_id = ${documentId} and model = ${model} and merged_into is null`;
  return { document: doc, model, ...counts, ...ex, quotes: q, stances, arguments: args };
}

/** Distinct arguments, ranked by how many commenters made them. */
export async function listArguments(documentId: string, model: string) {
  return sql`
    with ac as (
      select distinct cl.argument_id, cl.comment_id
      from claims cl where cl.model = ${model} and cl.quote_ok and cl.argument_id is not null
    )
    select a.id, a.label, a.status,
           count(ac.comment_id)::int as unique_comments,
           coalesce(sum(g.size), 0)::int as commenters,
           coalesce(sum(g.size) filter (where e.stance = 'support'), 0)::int as support,
           coalesce(sum(g.size) filter (where e.stance = 'oppose'), 0)::int as oppose,
           coalesce(sum(g.size) filter (where e.stance = 'mixed'), 0)::int as mixed,
           coalesce(sum(g.size) filter (where e.stance = 'unclear'), 0)::int as unclear
    from arguments a
    left join ac on ac.argument_id = a.id
    left join comments c on c.comment_id = ac.comment_id
    left join comment_groups g on g.id = c.group_id
    left join extractions e on e.comment_id = ac.comment_id and e.model = ${model}
    where a.document_id = ${documentId} and a.model = ${model} and a.merged_into is null
    group by a.id
    order by commenters desc, a.id`;
}

/** The verified quotes behind one argument, sliced from the original comment text. */
export async function argumentQuotes(argumentId: number) {
  const rows = await sql`
    select cl.id, cl.comment_id, cl.argument, cl.quote_start, cl.quote_end,
           c.body, c.organization, g.size as group_size, g.kind as group_kind, e.stance
    from claims cl
    join comments c using (comment_id)
    join comment_groups g on g.id = c.group_id
    left join extractions e on e.comment_id = cl.comment_id and e.model = cl.model
    where cl.argument_id = ${argumentId} and cl.quote_ok
    order by g.size desc, cl.comment_id`;
  return rows.map(({ body, ...r }: any) => ({ ...r, quote: (body as string).slice(r.quote_start, r.quote_end) }));
}

export async function commentDetail(commentId: string, model: string) {
  const [c] = await sql`
    select c.comment_id, c.document_id, c.posted_date, c.organization, c.body, c.attachment_count,
           g.id as group_id, g.size as group_size, g.kind as group_kind, g.representative_id
    from comments c left join comment_groups g on g.id = c.group_id
    where c.comment_id = ${commentId}`;
  if (!c) return null;
  const members = c.group_id
    ? (await sql`select comment_id from comments where group_id = ${c.group_id} order by comment_id limit 200`).map(
        (r: { comment_id: string }) => r.comment_id,
      )
    : [];
  const [extraction] = await sql`select stance, status, llm_calls, seconds from extractions where comment_id = ${c.representative_id ?? commentId} and model = ${model}`;
  const claims = await sql`
    select id, argument, quote, quote_ok, quote_error, quote_start, quote_end, argument_id
    from claims where comment_id = ${c.representative_id ?? commentId} and model = ${model} order by id`;
  return { ...c, members, extraction: extraction ?? null, claims };
}

export async function flaggedClaims(documentId: string, model: string) {
  return sql`
    select cl.id, cl.comment_id, cl.argument, cl.quote, cl.quote_error, g.size as group_size
    from claims cl join comments c using (comment_id) join comment_groups g on g.id = c.group_id
    where c.document_id = ${documentId} and cl.model = ${model} and not cl.quote_ok
    order by g.size desc, cl.comment_id`;
}

export async function attachmentOnly(documentId: string) {
  return sql`
    select comment_id, organization, attachment_count from comments
    where document_id = ${documentId} and detail_fetched and group_id is null
    order by comment_id`;
}

export async function updateArgument(id: number, patch: { label?: string; status?: string }) {
  const [row] = await sql`
    update arguments set
      label = coalesce(${patch.label ?? null}, label),
      status = coalesce(${patch.status ?? null}, status),
      updated_at = now()
    where id = ${id} returning id, label, status`;
  return row ?? null;
}

/** Fold `sourceIds` into `targetId`: their quotes now count toward the target. */
export async function mergeInto(targetId: number, sourceIds: number[]) {
  const sources = sourceIds.filter((id) => id !== targetId);
  if (sources.length === 0) return;
  await sql.begin(async (tx) => {
    await tx`update claims set argument_id = ${targetId} where argument_id in ${tx(sources)}`;
    await tx`update arguments set merged_into = ${targetId}, updated_at = now() where id in ${tx(sources)}`;
    const vectors = await tx`select embedding from claims where argument_id = ${targetId} and embedding is not null`;
    if (vectors.length) {
      const centre = mean(vectors.map((r: { embedding: number[] }) => r.embedding));
      await tx`update arguments set centroid = ${centre}, updated_at = now() where id = ${targetId}`;
    }
  });
}

/** Other arguments whose meaning is close to this one: candidates for a merge. */
export async function similarArguments(id: number, limit = 5) {
  const [self] = await sql`select document_id, model, centroid from arguments where id = ${id}`;
  if (!self) return [];
  const others = await sql`
    select id, label, status, centroid from arguments
    where document_id = ${self.document_id} and model = ${self.model} and merged_into is null and id <> ${id}`;
  return others
    .map((o: any) => ({ id: o.id, label: o.label, status: o.status, similarity: cosine(self.centroid, o.centroid) }))
    .sort((a: any, b: any) => b.similarity - a.similarity)
    .slice(0, limit);
}
