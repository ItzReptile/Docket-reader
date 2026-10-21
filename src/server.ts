// Step 6: the review API (Elysia on Bun). The Vue UI in web/ calls these routes.
// `bun run build` puts the UI in web/dist and this server serves it too.

import { Elysia, t } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { existsSync } from "node:fs";
import { config } from "./config.ts";
import { buildMemo } from "./memo.ts";
import * as q from "./queries.ts";
import { readLabels, writeLabel } from "../eval/labels.ts";

const model = (m?: string) => m || config.llmModel;
const Status = t.Union([t.Literal("pending"), t.Literal("approved"), t.Literal("rejected")]);

const api = new Elysia({ prefix: "/api" })
  .get("/documents", () => q.listDocuments())
  .get("/documents/:id/models", ({ params }) => q.models(params.id))
  .get("/documents/:id/summary", async ({ params, query, status }) => {
    return (await q.summary(params.id, model(query.model))) ?? status(404, "unknown document");
  })
  .get("/documents/:id/arguments", ({ params, query }) => q.listArguments(params.id, model(query.model)))
  .get("/documents/:id/flagged", ({ params, query }) => q.flaggedClaims(params.id, model(query.model)))
  .get("/documents/:id/attachment-only", ({ params }) => q.attachmentOnly(params.id))
  .get("/documents/:id/memo", async ({ params, query }) =>
    buildMemo(params.id, model(query.model), { includePending: query.includePending === "true" }),
  )
  .get("/arguments/:id/quotes", ({ params }) => q.argumentQuotes(Number(params.id)))
  .get("/arguments/:id/similar", ({ params }) => q.similarArguments(Number(params.id)))
  .patch(
    "/arguments/:id",
    async ({ params, body, status }) => (await q.updateArgument(Number(params.id), body)) ?? status(404, "unknown argument"),
    { body: t.Object({ label: t.Optional(t.String({ minLength: 1 })), status: t.Optional(Status) }) },
  )
  .post("/arguments/:id/merge", async ({ params, body }) => {
    await q.mergeInto(Number(params.id), body.sourceIds);
    return { ok: true };
  }, { body: t.Object({ sourceIds: t.Array(t.Number(), { minItems: 1 }) }) })
  .get("/comments/:id", async ({ params, query, status }) => {
    return (await q.commentDetail(params.id, model(query.model))) ?? status(404, "unknown comment");
  })
  // Hand-labeling for the eval (see eval/README in the main README).
  .get("/eval/labels", () => readLabels())
  .put("/eval/labels/:commentId", ({ params, body }) => writeLabel(params.commentId, body), {
    body: t.Object({
      stance: t.Union([t.Literal("support"), t.Literal("oppose"), t.Literal("mixed"), t.Literal("unclear")]),
      arguments: t.Array(t.String()),
    }),
  });

const app = new Elysia().use(api);
if (existsSync("web/dist")) {
  app.use(await staticPlugin({ assets: "web/dist", prefix: "/", indexHTML: true }));
}
app.listen(config.port);
console.log(`review API on http://localhost:${config.port}`);
