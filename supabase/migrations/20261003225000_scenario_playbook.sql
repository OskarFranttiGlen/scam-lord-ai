-- Scenario playbook (Oct 2026): scheduled repair windows and closing satisfaction.

ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS appointment_label text;

COMMENT ON COLUMN public.maintenance_requests.appointment_label IS
  'Spoken appointment window when status is scheduled, e.g. Thursday between 9 and 12.';

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS satisfaction_score smallint
    CHECK (satisfaction_score IS NULL OR (satisfaction_score >= 1 AND satisfaction_score <= 5));

COMMENT ON COLUMN public.calls.satisfaction_score IS
  'Closing check-in score 1–5 from record_closing_feedback.';
