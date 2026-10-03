-- Two-way SMS (docs/SPEC.md, Text): one text conversation per tenancy, stored as a calls row
-- with channel 'text'. The model message history and agent state live on the row so each
-- inbound text can resume the same ToolLoopAgent conversation.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS conversation jsonb;

COMMENT ON COLUMN public.calls.conversation IS
  'Text channel: { messages, state } for the agent (model messages and call state). Null for calls.';

CREATE UNIQUE INDEX IF NOT EXISTS calls_one_text_per_tenancy_idx
  ON public.calls (tenancy_id)
  WHERE channel = 'text';
