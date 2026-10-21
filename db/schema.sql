-- docket-reader schema. Safe to run more than once.
--
-- The pipeline fills these tables in order:
--   documents/comments  <- fetch    (Regulations.gov API)
--   comment_groups      <- group    (plain code: exact + near-duplicate form letters)
--   extractions/claims  <- extract  (LLM + quote check)
--   arguments           <- merge    (embeddings)
-- and the review UI edits arguments.status / label / merged_into.

create table if not exists documents (
  document_id      text primary key,          -- e.g. FAA-2026-9178-0001
  object_id        text not null,              -- internal id the comments API filters on
  docket_id        text not null,
  agency_id        text not null,
  title            text not null,
  comment_end_date timestamptz,
  fetched_at       timestamptz
);
-- The rule's abstract from the Federal Register, given to the model as context.
alter table documents add column if not exists summary text;

create table if not exists comments (
  comment_id       text primary key,           -- e.g. FAA-2026-9178-0057
  document_id      text not null references documents on delete cascade,
  posted_date      timestamptz,
  -- Organization name if the commenter gave one. Personal names are not stored.
  organization     text,
  body             text,                       -- plain text; null until the detail is fetched
  attachment_count int not null default 0,
  detail_fetched   boolean not null default false,
  group_id         int
);
create index if not exists comments_document_idx on comments (document_id);

create table if not exists comment_groups (
  id                serial primary key,
  document_id       text not null references documents on delete cascade,
  representative_id text not null references comments,   -- the one comment the LLM reads
  size              int not null,                         -- how many comments share this text
  kind              text not null check (kind in ('single', 'exact', 'near'))
);

-- One LLM pass over one group representative.
create table if not exists extractions (
  comment_id   text not null references comments on delete cascade,
  model        text not null,
  stance       text not null check (stance in ('support', 'oppose', 'mixed', 'unclear')),
  -- ok: every quote verified. flagged: some quote still failed after retries.
  status       text not null check (status in ('ok', 'flagged', 'empty')),
  llm_calls    int not null,
  seconds      real not null,
  created_at   timestamptz not null default now(),
  primary key (comment_id, model)
);

-- One argument found in one comment, with the quote that backs it up.
create table if not exists claims (
  id           serial primary key,
  comment_id   text not null references comments on delete cascade,
  model        text not null,
  argument     text not null,
  quote        text not null,
  quote_ok     boolean not null,
  quote_error  text,              -- why the quote check failed, if it did
  quote_start  int,               -- character offsets of the quote in comments.body
  quote_end    int,
  embedding    real[],            -- nomic-embed-text vector of `argument`
  argument_id  int
);
create index if not exists claims_comment_idx on claims (comment_id);
create index if not exists claims_argument_idx on claims (argument_id);

-- The same argument merged across comments. This is what a reviewer approves.
create table if not exists arguments (
  id           serial primary key,
  document_id  text not null references documents on delete cascade,
  model        text not null,
  label        text not null,      -- reviewer-editable summary of the argument
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  merged_into  int references arguments,
  centroid     real[] not null,
  updated_at   timestamptz not null default now()
);
create index if not exists arguments_document_idx on arguments (document_id, model);
