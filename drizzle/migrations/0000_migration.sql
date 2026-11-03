CREATE TABLE public.queue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX queue_events_place_idx ON public.queue_events(place_id, created_at DESC);
GRANT SELECT, INSERT ON public.queue_events TO anon, authenticated;
GRANT ALL ON public.queue_events TO service_role;
ALTER TABLE public.queue_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read events" ON public.queue_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert events" ON public.queue_events FOR INSERT TO anon, authenticated
  WITH CHECK (kind IN ('entrada','saida') AND length(place_id) BETWEEN 3 AND 40);