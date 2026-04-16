-- ============================================================
-- Migration: Add SECURITY DEFINER RPC for account activation
-- Bypasses RLS so activation works regardless of session timing
-- ============================================================

CREATE OR REPLACE FUNCTION public.activate_account_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_row public.activation_codes%ROWTYPE;
BEGIN
  -- Must be called by an authenticated user
  IF auth.uid() IS NULL THEN
    RETURN 'unauthenticated';
  END IF;

  -- Look up the code (bypass RLS via SECURITY DEFINER)
  SELECT * INTO v_code_row
  FROM public.activation_codes
  WHERE code = p_code;

  -- Code doesn't exist at all
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  -- Code was already used
  IF v_code_row.is_used THEN
    RETURN 'already_used';
  END IF;

  -- Mark the code as used
  UPDATE public.activation_codes
  SET
    is_used  = true,
    used_by  = auth.uid(),
    used_at  = now()
  WHERE id = v_code_row.id;

  -- Activate the caller's profile
  UPDATE public.profiles
  SET is_active = true
  WHERE id = auth.uid();

  RETURN 'success';
END;
$$;

-- Grant execute to any authenticated user
GRANT EXECUTE ON FUNCTION public.activate_account_code(TEXT) TO authenticated;
