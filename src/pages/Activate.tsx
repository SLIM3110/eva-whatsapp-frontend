import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';

const Activate = () => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const handleActivate = async () => {
    if (code.length !== 6) return;

    const trimmedCode = code.trim();

    console.log('[Activate] Attempting activation:', {
      code: trimmedCode,
      userId: user?.id ?? 'null — no session!',
    });

    if (!user) {
      toast.error('Your session has expired — please log in again');
      navigate('/login');
      return;
    }

    setLoading(true);

    // Single atomic RPC call with SECURITY DEFINER — bypasses RLS entirely
    const { data, error } = await supabase.rpc('activate_account_code', {
      p_code: trimmedCode,
    });

    console.log('[Activate] RPC result:', { data, error });

    if (error) {
      console.error('[Activate] RPC error:', error);
      toast.error('Activation failed — please try again');
      setLoading(false);
      return;
    }

    if (data === 'unauthenticated') {
      toast.error('Your session has expired — please log in again');
      navigate('/login');
      setLoading(false);
      return;
    }

    if (data === 'invalid') {
      toast.error('Invalid code — please check and try again');
      setLoading(false);
      return;
    }

    if (data === 'already_used') {
      toast.error('This code has already been used');
      setLoading(false);
      return;
    }

    // data === 'success'
    await refreshProfile();
    toast.success('Code activated successfully');
    navigate('/');
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold text-primary">Account Activation</CardTitle>
          <CardDescription className="text-base">
            Your account is pending activation. Please enter your 6 digit activation code provided by your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6">
          <InputOTP maxLength={6} value={code} onChange={(value) => setCode(value)}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <Button onClick={handleActivate} className="w-full" disabled={loading || code.length !== 6}>
            {loading ? <Loader2 className="animate-spin mr-2" /> : null}
            Activate Account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Activate;
