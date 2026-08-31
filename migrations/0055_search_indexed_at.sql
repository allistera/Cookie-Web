-- When a row was last successfully pushed to Meilisearch. A row whose
-- updated_at is newer than this drifted — it exists in Postgres and cannot be
-- found — which is what the weekly sweep repairs. NULL means never indexed.

BEGIN;

ALTER TABLE public.documents ADD COLUMN search_indexed_at timestamptz;
ALTER TABLE public.messages ADD COLUMN search_indexed_at timestamptz;

-- Partial indexes: the sweep only ever asks for drifted rows.
CREATE INDEX documents_search_drift_idx ON public.documents (updated_at)
  WHERE search_indexed_at IS NULL OR search_indexed_at < updated_at;
CREATE INDEX messages_search_drift_idx ON public.messages (updated_at)
  WHERE search_indexed_at IS NULL OR search_indexed_at < updated_at;

COMMIT;
