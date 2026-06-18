'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

export function TwoFactorForm() {
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);

  const isEnabled = (user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled ?? false;

  const handleToggle = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const res = await fetch('/api/auth/two-factor/toggle', {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Failed to update');
      }

      const data = await res.json();
      await refreshProfile();

      if (data.twoFactorEnabled) {
        toast.success('Two-factor authentication enabled');
      } else {
        toast.success('Two-factor authentication disabled');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-slate-900/40 border-slate-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <ShieldCheck className="size-4 text-primary" />
          Two-factor authentication
        </CardTitle>
        <CardDescription className="text-slate-400">
          Add an extra layer of security to your account. When enabled, you&apos;ll
          be asked for a one-time code sent to your email after signing in with
          your password.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="space-y-1">
            <Label htmlFor="2fa-toggle" className="text-slate-200">
              Require OTP on login
            </Label>
            <p className="text-xs text-slate-500">
              {isEnabled
                ? 'A verification code will be sent to your email each time you sign in.'
                : 'You will only need your password to sign in.'}
            </p>
          </div>
          <Button
            id="2fa-toggle"
            variant={isEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={handleToggle}
            disabled={loading}
            className="ml-4 shrink-0"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isEnabled ? (
              'Disable'
            ) : (
              'Enable'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
