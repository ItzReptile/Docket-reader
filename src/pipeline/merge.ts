// Step 5: merge the same argument made in different words across comments.
//
// Each verified claim's argument sentence is embedded with nomic-embed-text.
// Claims are then clustered greedily: walk them from the biggest form-letter group
// down, and put each one in the closest existing cluster if its cosine similarity
// to that cluster's centre is at least `threshold`, otherwise start a new cluster.
// Biggest-first means the common phrasings seed the clusters.
//
// "Raised by N commenters" counts people, not texts: a claim from a form letter
// sent 300 times counts 300.

import { sql } from "../db.ts";
import { config } from "../config.ts";
import { embedder } from "../llm/index.ts";
import { cosine } from "../vectors.ts";

type ClaimRow = { id: number; argument: string; embedding: number[] | null; size: number };

export async function embedClaims(documentId: string, model: string) {
  const missing: { id: number; argument: string }[] = await sql`
    select cl.id, cl.argument from claims cl join comments c using (comment_id)
    where c.document_id = ${documentId} and cl.model = ${model} and cl.quote_ok and cl.embedding is null`;
  const emb = embedder();
  for (let i = 0; i < missing.length; i += 64) {
    const batch = missing.slice(i, i + 64);
    const vectors = await emb.embed(batch.map((c) => c.argument));
    for (let j = 0; j < batch.length; j++) {
      await sql`update claims set embedding = ${vectors[j]!} where id = ${batch[j]!.id}`;
    }
  }
  if (missing.length) console.log(`embedded ${missing.length} arguments with ${config.embedModel}`);
}

export async function mergeArguments(
  documentId: string,
  opts: { model?: string; threshold?: number; force?: boolean } = {},
) {
  const model = opts.model ?? config.llmModel;
  const threshold = opts.threshold ?? 0.8;

  const [reviewed] = await sql`
    select count(*)::int as n from arguments
    where document_id = ${documentId} and model = ${model} and status <> 'pending'`;
  if (reviewed.n > 0 && !opts.force) {
    throw new Error(`${reviewed.n} arguments were already reviewed. Re-merging would discard that work; pass --force to do it anyway.`);
  }

  await embedClaims(documentId, model);
  const claims: ClaimRow[] = await sql`
    select cl.id, cl.argument, cl.embedding, g.size
    from claims cl
    join comments c using (comment_id)
    join comment_groups g on g.id = c.group_id
    where c.document_id = ${documentId} and cl.model = ${model} and cl.quote_ok
    order by g.size desc, cl.id`;

  const clusters: { members: ClaimRow[]; centre: number[] }[] = [];
  for (const claim of claims) {
    const v = claim.embedding!;
    let best = -1;
    let bestSim = threshold;
    clusters.forEach((cl, i) => {
      const sim = cosine(v, cl.centre);
      if (sim >= bestSim) {
        best = i;
        bestSim = sim;
      }
    });
    if (best === -1) {
      clusters.push({ members: [claim], centre: v });
    } else {
      // Running mean: the centre moves a little toward each new member.
      const cl = clusters[best]!;
      cl.members.push(claim);
      const n = cl.members.length;
      cl.centre = cl.centre.map((x, i) => x + (v[i]! - x) / n);
    }
  }

  await sql.begin(async (tx) => {
    await tx`update claims set argument_id = null where model = ${model}
             and comment_id in (select comment_id from comments where document_id = ${documentId})`;
    await tx`update arguments set merged_into = null where document_id = ${documentId} and model = ${model}`;
    await tx`delete from arguments where document_id = ${documentId} and model = ${model}`;
    for (const cl of clusters) {
      // Label with the member phrasing closest to the cluster centre.
      const label = cl.members.reduce((a, b) => (cosine(a.embedding!, cl.centre) >= cosine(b.embedding!, cl.centre) ? a : b)).argument;
      const [row] = await tx`
        insert into arguments (document_id, model, label, centroid)
        values (${documentId}, ${model}, ${label}, ${cl.centre})
        returning id`;
      await tx`update claims set argument_id = ${row.id} where id in ${tx(cl.members.map((m) => m.id))}`;
    }
  });
  console.log(`merged ${claims.length} verified arguments into ${clusters.length} distinct arguments (threshold ${threshold})`);
}
