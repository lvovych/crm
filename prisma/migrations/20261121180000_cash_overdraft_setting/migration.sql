-- Opt-in per account; existing accounts keep their current allowNegative value.
-- Posting and settings changes share the organization finance lock.
ALTER TABLE public.money_accounts DROP CONSTRAINT cash_cannot_overdraw;
