-- 008: Server-side music import pipeline (перенос треков с других площадок).
-- import_jobs records one import per public link or uploaded export file;
-- import_items keeps the honest per-track outcome (matched against the
-- licensed SONORA catalog or not found). Fully additive, owner-only via RLS.
CREATE TABLE public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'deezer', 'apple', 'spotify', 'youtube', 'yandex', 'vk',
    'soundcloud', 'jamendo', 'file_generic'
  )),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 2048),
  source_label TEXT CHECK (source_label IS NULL OR length(source_label) <= 200),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  artist TEXT CHECK (artist IS NULL OR length(artist) <= 200),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  album TEXT CHECK (album IS NULL OR length(album) <= 300),
  matched_provider TEXT CHECK (matched_provider IS NULL OR matched_provider IN ('jamendo', 'audius')),
  matched_provider_track_id TEXT CHECK (matched_provider_track_id IS NULL OR length(matched_provider_track_id) BETWEEN 1 AND 64),
  matched_title TEXT,
  matched_artist TEXT,
  matched_audio_url TEXT,
  matched_artwork_url TEXT,
  matched_license_url TEXT,
  matched_source_url TEXT,
  match_status TEXT NOT NULL DEFAULT 'not_found' CHECK (match_status IN ('matched', 'not_found', 'error')),
  playlist_track_id TEXT
);

CREATE INDEX import_jobs_user_created_idx
  ON public.import_jobs (user_id, created_at DESC);
CREATE INDEX import_items_job_position_idx
  ON public.import_items (job_id, position);

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own import jobs"
  ON public.import_jobs FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can create their own import jobs"
  ON public.import_jobs FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update their own import jobs"
  ON public.import_jobs FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can delete their own import jobs"
  ON public.import_jobs FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Import items follow job ownership (no direct user_id column).
CREATE POLICY "Users can read items of their own import jobs"
  ON public.import_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.import_jobs j
    WHERE j.id = job_id AND j.user_id = (SELECT auth.uid())
  ));
CREATE POLICY "Users can create items for their own import jobs"
  ON public.import_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.import_jobs j
    WHERE j.id = job_id AND j.user_id = (SELECT auth.uid())
  ));
CREATE POLICY "Users can update items of their own import jobs"
  ON public.import_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.import_jobs j
    WHERE j.id = job_id AND j.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.import_jobs j
    WHERE j.id = job_id AND j.user_id = (SELECT auth.uid())
  ));
CREATE POLICY "Users can delete items of their own import jobs"
  ON public.import_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.import_jobs j
    WHERE j.id = job_id AND j.user_id = (SELECT auth.uid())
  ));

-- Storage note: matched_audio_url only ever holds URLs from SONORA's licensed
-- catalog providers (Jamendo/Audius). Preview or protected URLs from other
-- platforms are intentionally never persisted.
