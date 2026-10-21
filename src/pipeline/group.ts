// Step 2: collapse form letters into groups so the LLM reads each text once.

import { sql } from "../db.ts";
import { groupDuplicates, isAttachmentOnly } from "../dedupe.ts";

export async function groupComments(documentId: string, threshold = 0.5) {
  const rows: { comment_id: string; body: string | null; attachment_count: number }[] = await sql`
    select comment_id, body, attachment_count from comments
    where document_id = ${documentId} and detail_fetched`;

  const readable = rows.filter((r) => !isAttachmentOnly(r.body, r.attachment_count));
  const groups = groupDuplicates(
    readable.map((r) => ({ id: r.comment_id, text: r.body! })),
    threshold,
  );

  const skipped = rows.filter((r) => !readable.includes(r)).map((r) => r.comment_id);

  await sql.begin(async (tx) => {
    await tx`update comments set group_id = null, attachment_only = false where document_id = ${documentId} and detail_fetched`;
    if (skipped.length) await tx`update comments set attachment_only = true where comment_id in ${tx(skipped)}`;
    await tx`delete from comment_groups where document_id = ${documentId}`;
    for (const g of groups) {
      const [row] = await tx`
        insert into comment_groups (document_id, representative_id, size, kind)
        values (${documentId}, ${g.representative}, ${g.ids.length}, ${g.kind})
        returning id`;
      await tx`update comments set group_id = ${row.id} where comment_id in ${tx(g.ids)}`;
    }
  });

  const multi = groups.filter((g) => g.ids.length > 1);
  console.log(`${rows.length} comments with text fetched`);
  console.log(`  ${rows.length - readable.length} attachment-only (not analyzed)`);
  console.log(`  ${groups.length} unique texts to analyze`);
  console.log(`  ${multi.length} duplicate groups covering ${multi.reduce((n, g) => n + g.ids.length, 0)} comments`);
  for (const g of multi.slice(0, 5)) console.log(`    ${g.ids.length} x ${g.kind} (e.g. ${g.representative})`);
}
