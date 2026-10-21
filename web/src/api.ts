export type Stance = "support" | "oppose" | "mixed" | "unclear";
export type Status = "pending" | "approved" | "rejected";

export interface DocumentRow {
  document_id: string;
  title: string;
  agency_id: string;
  comments: number;
}

export interface Summary {
  document: { document_id: string; title: string; docket_id: string; agency_id: string; summary: string | null };
  model: string;
  listed: number;
  fetched: number;
  attachment_only: number;
  unique_texts: number;
  duplicate_groups: number;
  in_duplicate_groups: number;
  extracted: number;
  commenters_covered: number;
  avg_seconds: number;
  quotes: { claims: number; verified: number };
  stances: { stance: Stance; commenters: number; unique_texts: number }[];
  arguments: { total: number; approved: number; rejected: number };
}

export interface Argument {
  id: number;
  label: string;
  status: Status;
  unique_comments: number;
  commenters: number;
  support: number;
  oppose: number;
  mixed: number;
  unclear: number;
}

export interface Quote {
  id: number;
  comment_id: string;
  argument: string;
  quote: string;
  group_size: number;
  group_kind: "single" | "exact" | "near";
  organization: string | null;
  stance: Stance | null;
}

export interface Similar {
  id: number;
  label: string;
  status: Status;
  similarity: number;
}

export interface CommentDetail {
  comment_id: string;
  posted_date: string;
  organization: string | null;
  body: string;
  attachment_count: number;
  group_size: number | null;
  group_kind: string | null;
  representative_id: string | null;
  members: string[];
  extraction: { stance: Stance; status: string; llm_calls: number; seconds: number } | null;
  claims: {
    id: number;
    argument: string;
    quote: string;
    quote_ok: boolean;
    quote_error: string | null;
    quote_start: number | null;
    quote_end: number | null;
  }[];
}

export interface Flagged {
  id: number;
  comment_id: string;
  argument: string;
  quote: string;
  quote_error: string;
  group_size: number;
}

export interface Memo {
  markdown: string;
  check: { citedIds: number; unknownIds: string[]; quotesChecked: number; quotesFailed: string[] };
}

export interface Label {
  commentId: string;
  stance: Stance | null;
  arguments: string[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const m = (model: string) => `?model=${encodeURIComponent(model)}`;

export const api = {
  documents: () => call<DocumentRow[]>("/documents"),
  models: (doc: string) => call<string[]>(`/documents/${doc}/models`),
  summary: (doc: string, model: string) => call<Summary>(`/documents/${doc}/summary${m(model)}`),
  arguments: (doc: string, model: string) => call<Argument[]>(`/documents/${doc}/arguments${m(model)}`),
  flagged: (doc: string, model: string) => call<Flagged[]>(`/documents/${doc}/flagged${m(model)}`),
  groups: (doc: string, model: string, limit = 8) => call<FormLetterGroup[]>(`/documents/${doc}/groups${m(model)}&limit=${limit}`),
  attachmentOnly: (doc: string) => call<AttachmentOnly[]>(`/documents/${doc}/attachment-only`),
  memo: (doc: string, model: string, includePending: boolean) =>
    call<Memo>(`/documents/${doc}/memo${m(model)}&includePending=${includePending}`),
  quotes: (id: number) => call<Quote[]>(`/arguments/${id}/quotes`),
  similar: (id: number) => call<Similar[]>(`/arguments/${id}/similar`),
  updateArgument: (id: number, patch: { label?: string; status?: Status }) =>
    call(`/arguments/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  merge: (targetId: number, sourceIds: number[]) =>
    call(`/arguments/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceIds }) }),
  comment: (id: string, model: string) => call<CommentDetail>(`/comments/${id}${m(model)}`),
  labels: () => call<{ documentId: string; comments: Label[] } | null>("/eval/labels"),
  saveLabel: (commentId: string, label: { stance: Stance; arguments: string[] }) =>
    call(`/eval/labels/${commentId}`, { method: "PUT", body: JSON.stringify(label) }),
};

export interface FormLetterGroup {
  id: number;
  size: number;
  kind: "exact" | "near";
  representative_id: string;
  organization: string | null;
  excerpt: string;
  stance: Stance | null;
}

export interface AttachmentOnly {
  comment_id: string;
  organization: string | null;
  attachment_count: number;
}

export const regsLink = (id: string) => `https://www.regulations.gov/comment/${id}`;

/** Plain-language name for a stance. */
export const STANCE_LABEL: Record<Stance, string> = {
  support: "Supports",
  oppose: "Opposes",
  mixed: "Mixed",
  unclear: "Unclear",
};

/** "Mostly opposes" / "Split", from commenter counts per stance. */
export function stanceSummary(c: Record<Stance, number>): { text: string; stance: Stance | null } {
  const total = c.support + c.oppose + c.mixed + c.unclear;
  if (!total) return { text: "No position", stance: null };
  const top = (Object.keys(STANCE_LABEL) as Stance[]).reduce((a, b) => (c[b] > c[a] ? b : a));
  const share = c[top] / total;
  if (share === 1) return { text: `All ${STANCE_LABEL[top].toLowerCase()}`, stance: top };
  if (share >= 0.6) return { text: `Mostly ${STANCE_LABEL[top].toLowerCase()}`, stance: top };
  return { text: "Split", stance: null };
}

export const STANCE_TEXT_COLOR: Record<Stance, string> = {
  support: "text-emerald-700",
  oppose: "text-rose-700",
  mixed: "text-amber-700",
  unclear: "text-muted-foreground",
};
export const fmt = (n: number) => n.toLocaleString("en-US");
export const count = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
