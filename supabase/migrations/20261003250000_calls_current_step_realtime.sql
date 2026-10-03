-- Which step a call is on, payment-wait status, and Realtime row changes.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS current_step text;

COMMENT ON COLUMN public.calls.current_step IS
  'Agent floor step the call is on. Null until a step is recorded.';

ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_status_check CHECK (
  status IN ('in_progress', 'waiting_on_person', 'paid', 'waiting_on_payment')
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
