-- User favorites are separate from listening events so the library is stable and queryable.
CREATE TABLE public.user_favorites (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX user_favorites_track_idx ON public.user_favorites (track_id);
CREATE INDEX listening_events_user_track_time_idx ON public.listening_events (user_id, track_id, occurred_at DESC);
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own favorites" ON public.user_favorites FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can add their own favorites" ON public.user_favorites FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can remove their own favorites" ON public.user_favorites FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
