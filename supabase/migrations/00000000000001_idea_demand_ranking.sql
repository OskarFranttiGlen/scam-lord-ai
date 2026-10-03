-- Idea Demand Ranking (ADR 0036, copied from docs/adr/schema.sql).
-- These views run as the owner (security_invoker = false).
-- idea_demand and idea_evidence stay SECURITY INVOKER and read stripe
-- through the views, so anon and authenticated get no grants on stripe.

-- ---------------------------------------------------------------
-- 1. Revenue per subscription, then per customer
-- ---------------------------------------------------------------
CREATE VIEW public.subscription_mrr
WITH (security_invoker = false)
AS
SELECT
  s._raw_data->>'id'                                          AS subscription_id,
  s._raw_data->>'customer'                                    AS customer_id,
  s._raw_data->>'status'                                      AS status,
  s._raw_data->'cancellation_details'->>'feedback'            AS cancel_feedback,
  nullif(trim(s._raw_data->'cancellation_details'->>'comment'), '') AS cancel_comment,
  sum(
    (i->'price'->>'unit_amount')::numeric / 100
    * coalesce((i->>'quantity')::numeric, 1)
    * CASE i->'price'->'recurring'->>'interval'
        WHEN 'month' THEN 1
        WHEN 'year'  THEN 1.0 / 12
        WHEN 'week'  THEN 52.0 / 12
        WHEN 'day'   THEN 365.0 / 12
      END
    / coalesce((i->'price'->'recurring'->>'interval_count')::numeric, 1)
  ) AS mrr
FROM stripe.subscriptions s
CROSS JOIN LATERAL jsonb_array_elements(s._raw_data->'items'->'data') i
GROUP BY 1, 2, 3, 4, 5;

CREATE VIEW public.customer_mrr
WITH (security_invoker = false)
AS
SELECT
  customer_id,
  coalesce(sum(mrr) FILTER (WHERE status IN ('active', 'trialing', 'past_due')), 0) AS active_mrr,
  coalesce(sum(mrr) FILTER (WHERE status = 'canceled'), 0)                         AS lost_mrr
FROM public.subscription_mrr
GROUP BY customer_id;

-- Lost MRR that cited missing features but left no comment (shown as one figure).
CREATE VIEW public.unattributed_lost_mrr
WITH (security_invoker = false)
AS
SELECT coalesce(sum(mrr), 0) AS amount, count(*) AS cancellations
FROM public.subscription_mrr
WHERE status = 'canceled'
  AND cancel_feedback = 'missing_features'
  AND cancel_comment IS NULL;

-- ---------------------------------------------------------------
-- 2. Feedback and ideas
-- ---------------------------------------------------------------
CREATE TABLE public.feedback_items (
  id          text PRIMARY KEY,          -- e.g. 'sub_...' for cancellations, 'gh_...' for forum posts
  source      text NOT NULL CHECK (source IN ('cancellation', 'forum', 'in_app')),
  customer_id text,                      -- Stripe customer id; null = unlinked (mentions only)
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cancellation comments are copied in from Stripe. Only ones with a comment.
-- On an empty stripe schema this inserts nothing.
INSERT INTO public.feedback_items (id, source, customer_id, body)
SELECT subscription_id, 'cancellation', customer_id, cancel_comment
FROM public.subscription_mrr
WHERE status = 'canceled' AND cancel_comment IS NOT NULL
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.feature_ideas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text       text NOT NULL UNIQUE,       -- same idea typed twice reuses its scores
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- 3. The join table. One Noul per Feature Idea and Feedback Item.
-- ---------------------------------------------------------------
CREATE TABLE public.feature_ideas_feedback_items_join (
  idea_id          uuid NOT NULL REFERENCES public.feature_ideas (id) ON DELETE CASCADE,
  feedback_item_id text NOT NULL REFERENCES public.feedback_items (id) ON DELETE CASCADE,
  noul             real NOT NULL CHECK (noul BETWEEN 0 AND 1),
  model            text NOT NULL,        -- e.g. 'jev-1.13.0', so results can be re-scored later
  scored_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, feedback_item_id)
);

CREATE INDEX feature_ideas_feedback_items_join_feedback_item_id_idx
  ON public.feature_ideas_feedback_items_join (feedback_item_id);

-- ---------------------------------------------------------------
-- 4. The ranking. One row per Feature Idea, recomputed for any cutoff.
-- ---------------------------------------------------------------
CREATE FUNCTION public.idea_demand(cutoff real DEFAULT 0.5)
RETURNS TABLE (
  idea_id           uuid,
  idea              text,
  active_mrr_asking numeric,
  lost_mrr_asking   numeric,
  active_spread     numeric,
  lost_spread       numeric,
  customers_asking  int,
  total_asks        int,
  unlinked_mentions int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO public
AS $$
  WITH kept AS (
    SELECT m.idea_id, f.customer_id, m.noul
    FROM public.feature_ideas_feedback_items_join m
    JOIN public.feedback_items f ON f.id = m.feedback_item_id
    WHERE m.noul >= cutoff
  ),
  per_customer AS (
    SELECT idea_id, customer_id, max(noul) AS p, count(*) AS asks
    FROM kept
    WHERE customer_id IS NOT NULL
    GROUP BY idea_id, customer_id
  ),
  unlinked AS (
    SELECT idea_id, count(*) AS n
    FROM kept
    WHERE customer_id IS NULL
    GROUP BY idea_id
  )
  SELECT
    i.id,
    i.text,
    coalesce(sum(pc.p * c.active_mrr), 0),
    coalesce(sum(pc.p * c.lost_mrr), 0),
    coalesce(sqrt(sum(c.active_mrr ^ 2 * pc.p * (1 - pc.p))), 0),
    coalesce(sqrt(sum(c.lost_mrr ^ 2 * pc.p * (1 - pc.p))), 0),
    count(pc.customer_id)::int,
    coalesce(sum(pc.asks), 0)::int,
    coalesce(max(u.n), 0)::int
  FROM public.feature_ideas i
  LEFT JOIN per_customer pc ON pc.idea_id = i.id
  LEFT JOIN public.customer_mrr c ON c.customer_id = pc.customer_id
  LEFT JOIN unlinked u ON u.idea_id = i.id
  GROUP BY i.id, i.text;
$$;

CREATE FUNCTION public.idea_evidence(p_idea_id uuid, cutoff real DEFAULT 0.5)
RETURNS TABLE (
  feedback_item_id text,
  source text,
  customer_id text,
  body text,
  noul real,
  active_mrr numeric,
  lost_mrr numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO public
AS $$
  SELECT f.id, f.source, f.customer_id, f.body, m.noul,
         coalesce(c.active_mrr, 0), coalesce(c.lost_mrr, 0)
  FROM public.feature_ideas_feedback_items_join m
  JOIN public.feedback_items f ON f.id = m.feedback_item_id
  LEFT JOIN public.customer_mrr c ON c.customer_id = f.customer_id
  WHERE m.idea_id = p_idea_id AND m.noul >= cutoff
  ORDER BY m.noul DESC;
$$;

-- ---------------------------------------------------------------
-- Access
-- authenticated can read. No write policy for authenticated or anon.
-- service_role writes, and it bypasses RLS.
-- ---------------------------------------------------------------

ALTER TABLE public.feedback_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_ideas_feedback_items_join ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read feedback items"
  ON public.feedback_items
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can read feature ideas"
  ON public.feature_ideas
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can read feature idea matches"
  ON public.feature_ideas_feedback_items_join
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.feedback_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.feature_ideas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.feature_ideas_feedback_items_join FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.feedback_items TO authenticated;
GRANT SELECT ON TABLE public.feature_ideas TO authenticated;
GRANT SELECT ON TABLE public.feature_ideas_feedback_items_join TO authenticated;

GRANT ALL ON TABLE public.feedback_items TO service_role;
GRANT ALL ON TABLE public.feature_ideas TO service_role;
GRANT ALL ON TABLE public.feature_ideas_feedback_items_join TO service_role;

REVOKE ALL ON TABLE public.subscription_mrr FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_mrr FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.unattributed_lost_mrr FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.subscription_mrr TO authenticated, service_role;
GRANT SELECT ON TABLE public.customer_mrr TO authenticated, service_role;
GRANT SELECT ON TABLE public.unattributed_lost_mrr TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.idea_demand(real) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.idea_evidence(uuid, real) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.idea_demand(real) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.idea_evidence(uuid, real) TO authenticated, service_role;
