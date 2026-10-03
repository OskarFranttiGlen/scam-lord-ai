-- Metering caps from src/api/feature-limits.ts (TEST_TIER_LIMITS).
-- max_premium_llm_requests stays null.

INSERT INTO public.product_usage_limits (
  product_title,
  max_monthly_exports,
  max_monthly_llm_requests
)
VALUES
  ('Free', 2, 45),
  ('Pro', 3, 100),
  ('Pro+', 10, 1000)
ON CONFLICT (product_title) DO NOTHING;
