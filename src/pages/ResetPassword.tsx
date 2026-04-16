import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import evaLogo from '@/assets/eva-logo.jpg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

// IMPORTANT — Supabase dashboard setup required:
//   1. Authentication > URL Configuration > Site URL:
//      https://app.evaintelligencehub.online
//   2. Authentication > URL Configuration > Redirect URLs:
//      https://app.evaintelligencehub.online/reset-password
// Without these settings the reset email will point to the wrong URL.

const ResetPassword = () => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    // 1. Register the PASSWORD_RECOVERY listener FIRST so we never miss the event.
    //    With Supabase v2 PKCE flow the client exchanges the ?code= param asynchronously;
    //    the event fires once that exchange completes.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        setSessionReady(true);
      }
    });

    // 2. Immediately call getSession() as well.
    //    If the PKCE code exchange already finished before this component mounted
    //    (i.e. the PASSWORD_RECOVERY event fired before the listener above was
    //    registered), the session will already be stored and getSession() returns it.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (session) {
        setSessionReady(true);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    toast.success('Password updated successfully.');
    // Sign out the recovery session so AuthRoute on /login doesn't redirect to dashboard.
    await supabase.auth.signOut();
    setTimeout(() => navigate('/login'), 2000);
  };

  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardHeader className="text-center space-y-4 pb-2">
          <img src={evaLogo} alt="EVA Real Estate" className="mx-auto h-20 object-contain" />
          <CardTitle className="text-2xl font-bold text-primary">Set New Password</CardTitle>
          <CardDescription>Enter your new password below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">New Password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Confirm New Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your new password"
                required
                className="mt-1"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="animate-spin mr-2" /> : null}
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
