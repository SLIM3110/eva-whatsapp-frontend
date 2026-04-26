-- New signups should be active by default — activation-code flow has been removed.
-- Existing inactive users are flipped to active so no one is stranded by the prior flow.
ALTER TABLE public.profiles ALTER COLUMN is_active SET DEFAULT true;
UPDATE public.profiles SET is_active = true WHERE is_active = false;
