import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import evaLogo from '@/assets/eva-logo.jpg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error(error.message);
    } else {
      await supabase.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', (await supabase.auth.getUser()).data.user?.id);
      navigate('/');
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.endsWith('@evadxb.com')) {
      toast.error('Only @evadxb.com email addresses are allowed.');
      return;
    }
    setResetLoading(true);
    // NOTE: https://app.evaintelligencehub.online/reset-password must be added
    // to Supabase Authentication > URL Configuration > Redirect URLs.
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: 'https://app.evaintelligencehub.online/reset-password',
    });
    if (error) {
      toast.error(error.message);
    } else {
      setResetSent(true);
    }
    setResetLoading(false);
  };

  const handleForgotClose = (open: boolean) => {
    setForgotOpen(open);
    if (!open) {
      setResetEmail('');
      setResetSent(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardHeader className="text-center space-y-4 pb-2">
          <img src={evaLogo} alt="EVA Real Estate" className="mx-auto h-20 object-contain" />
          <CardTitle className="text-2xl font-bold text-primary">Welcome Back</CardTitle>
          <CardDescription>Sign in to EVA Intelligence Hub</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@evadxb.com"
                required
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                className="mt-1"
              />
              <div className="text-right mt-1">
                <button
                  type="button"
                  onClick={() => setForgotOpen(true)}
                  className="text-sm text-primary hover:underline"
                >
                  Forgot your password?
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="animate-spin mr-2" /> : null}
              Sign In
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-4">
            Don't have an account?{' '}
            <Link to="/signup" className="text-primary font-medium hover:underline">
              Sign Up
            </Link>
          </p>
        </CardContent>
      </Card>

      <Dialog open={forgotOpen} onOpenChange={handleForgotClose}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset your password</DialogTitle>
            <DialogDescription>
              Enter your @evadxb.com email and we'll send you a reset link.
            </DialogDescription>
          </DialogHeader>
          {resetSent ? (
            <p className="text-sm text-center text-green-600 py-4">
              Password reset link sent. Check your email.
            </p>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4 mt-2">
              <Input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="you@evadxb.com"
                required
              />
              <Button type="submit" className="w-full" disabled={resetLoading}>
                {resetLoading ? <Loader2 className="animate-spin mr-2" /> : null}
                Send Reset Link
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Login;
