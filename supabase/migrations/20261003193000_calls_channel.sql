-- A conversation with a tenant happens on one channel: the outbound collection call,
-- a callback to the same number, or a text thread. See docs/SPEC.md (Text, Callback).

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'outbound_call'
    CHECK (channel IN ('outbound_call', 'callback', 'text'));

COMMENT ON COLUMN public.calls.channel IS
  'outbound_call, callback, or text. One text conversation per tenancy.';

CREATE INDEX IF NOT EXISTS calls_tenancy_channel_idx
  ON public.calls (tenancy_id, channel, created_at DESC);
