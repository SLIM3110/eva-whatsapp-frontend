import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { getTodayStartUTC, toUAETime } from '@/lib/uaeTime';
import { toFriendly, toRaw } from '@/lib/templateUtils';
import {
  MessageSquare, Clock, Wifi, WifiOff, FileText, Plus, Edit2, Trash2, Loader2, QrCode, Pause, Play, AlertCircle
} from 'lucide-react';

const BACKEND_URL = 'https://api.evaintelligencehub.online';

const AgentDashboard = () => {
  const { user, profile, refreshProfile } = useAuth();

  // Stats
  const [stats, setStats] = useState({ sentToday: 0, pending: 0, templates: 0 });
  const [pendingContacts, setPendingContacts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [sendingPaused, setSendingPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  // WhatsApp connection
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [preparingQR, setPreparingQR] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);

  // UI
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: '', body: '' });
  const [editTemplate, setEditTemplate] = useState<any>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const autoStartedRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = profile?.whatsapp_session_status === 'connected';
  const hasInstance = !!(profile?.green_api_instance_id);

  // ── Data fetch ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user) return;
    const todayStart = getTodayStartUTC();

    const [messagesRes, pendingRes, templatesRes, profileRes] = await Promise.all([
      supabase.from('messages_log').select('id', { count: 'exact' }).eq('agent_id', user.id).gte('sent_at', todayStart),
      supabase.from('owner_contacts').select('*').eq('assigned_agent', user.id).eq('message_status', 'pending').order('created_at', { ascending: true }).limit(10),
      supabase.from('message_templates').select('*').eq('created_by', user.id),
      supabase.from('profiles').select('sending_paused').eq('id', user.id).single(),
    ]);

    setSendingPaused(profileRes.data?.sending_paused ?? false);
    setStats({
      sentToday: messagesRes.count || 0,
      pending: pendingRes.data?.length || 0,
      templates: templatesRes.data?.length || 0,
    });
    setPendingContacts(pendingRes.data || []);
    setTemplates(templatesRes.data || []);
    setLoading(false);
  }, [user]);

  // 30s auto-refresh
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Auto-start QR on load if instance is assigned but not connected ──
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!user || !profile) return;
    if (!hasInstance) return;                              // no instance assigned → skip
    if (profile.whatsapp_session_status === 'connected') return; // already connected → skip
    autoStartedRef.current = true;

    supabase.from('api_settings').select('whatsapp_backend_url, whatsapp_api_key').eq('id', 1).single()
      .then(({ data: settings }) => {
        const url = settings?.whatsapp_backend_url || BACKEND_URL;
        const key = settings?.whatsapp_api_key || '';
        startSession(url, key);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  // ── Session / polling ─────────────────────────────────────────
  const startSession = async (url: string, key: string) => {
    setConnecting(true);
    setQrCode(null);
    setPreparingQR(false);
    try {
      const res = await fetch(`${url}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ agentId: user?.id }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        toast.error(`WhatsApp backend error: ${data.message || `HTTP ${res.status}`}`);
        setConnecting(false);
        return;
      }

      if (data.status === 'already_connected') {
        setConnecting(false);
        await supabase.from('profiles').update({ whatsapp_session_status: 'connected' }).eq('id', user?.id);
        await refreshProfile();
        toast.success('WhatsApp already connected!');
        return;
      }

      if (data.qrCode) {
        setQrCode(data.qrCode);
      } else {
        setPreparingQR(true);
      }
      startPolling(url, key);
    } catch {
      toast.error('Failed to connect to WhatsApp backend');
      setConnecting(false);
      setPreparingQR(false);
    }
  };

  const startPolling = (url: string, key: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    const startTime = Date.now();
    const TIMEOUT_MS = 60_000;

    pollIntervalRef.current = setInterval(async () => {
      const elapsed = Date.now() - startTime;
      try {
        const res = await fetch(`${url}/api/session/status?agentId=${user?.id}`, {
          headers: { 'x-api-key': key },
        });
        const data = await res.json();

        if (data.status === 'connected') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setQrCode(null);
          setPreparingQR(false);
          setConnecting(false);
          await supabase.from('profiles').update({ whatsapp_session_status: 'connected' }).eq('id', user?.id);
          await refreshProfile();
          toast.success('WhatsApp connected!');
        } else if (data.qrCode) {
          setQrCode(data.qrCode);
          setPreparingQR(false);
        } else if (elapsed >= TIMEOUT_MS) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setQrCode(null);
          setPreparingQR(false);
          setConnecting(false);
          toast.error('Could not generate QR code. Please try again.');
        }
      } catch {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setQrCode(null);
        setPreparingQR(false);
        setConnecting(false);
      }
    }, 3000);
  };

  // Cleanup on unmount
  useEffect(() => () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); }, []);

  const requestQR = async () => {
    const { data: settings } = await supabase.from('api_settings').select('whatsapp_backend_url, whatsapp_api_key').eq('id', 1).single();
    const url = settings?.whatsapp_backend_url || BACKEND_URL;
    const key = settings?.whatsapp_api_key || '';
    startSession(url, key);
  };

  const disconnect = async () => {
    const { data: settings } = await supabase.from('api_settings').select('whatsapp_backend_url, whatsapp_api_key').eq('id', 1).single();
    const url = settings?.whatsapp_backend_url || BACKEND_URL;
    const key = settings?.whatsapp_api_key || '';
    try {
      await fetch(`${url}/api/session/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ agentId: user?.id }),
      });
    } catch { /* ignore */ }
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    await supabase.from('profiles').update({ whatsapp_session_status: 'disconnected' }).eq('id', user?.id);
    await refreshProfile();
    autoStartedRef.current = false;
    toast.success('WhatsApp disconnected');
  };

  const togglePause = async (pause: boolean) => {
    setTogglingPause(true);
    try {
      const { data: settings } = await supabase.from('api_settings').select('whatsapp_backend_url, whatsapp_api_key').eq('id', 1).single();
      const url = settings?.whatsapp_backend_url || BACKEND_URL;
      const key = settings?.whatsapp_api_key || '';
      const endpoint = pause ? '/api/session/pause' : '/api/session/resume';
      await fetch(`${url}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ agentId: user?.id }),
      });
      await supabase.from('profiles').update({ sending_paused: pause }).eq('id', user?.id);
      setSendingPaused(pause);
      toast.success(pause ? 'Sending paused' : 'Sending resumed');
    } catch {
      toast.error('Failed to update sending status');
    }
    setTogglingPause(false);
  };

  // ── Queue actions ─────────────────────────────────────────────
  const cancelContact = async (id: string) => {
    const { error } = await supabase.from('owner_contacts').update({ message_status: 'cancelled' }).eq('id', id);
    if (error) { toast.error('Failed to cancel'); return; }
    toast.success('Contact cancelled');
    setPendingContacts(prev => prev.filter(c => c.id !== id));
    setStats(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1) }));
  };

  // ── Template actions ──────────────────────────────────────────
  const saveTemplate = async () => {
    if (!newTemplate.name || !newTemplate.body) return;
    const { error } = await supabase.from('message_templates').insert({
      template_name: newTemplate.name,
      body: toRaw(newTemplate.body),
      created_by: user!.id,
    });
    if (error) toast.error('Failed to save template');
    else {
      toast.success('Template created');
      setNewTemplate({ name: '', body: '' });
      setTemplateDialogOpen(false);
      fetchData();
    }
  };

  const updateTemplate = async () => {
    if (!editTemplate) return;
    const { error } = await supabase.from('message_templates').update({
      template_name: editTemplate.template_name,
      body: toRaw(editTemplate.body),
    }).eq('id', editTemplate.id);
    if (error) toast.error('Failed to update template');
    else {
      toast.success('Template updated');
      setEditDialogOpen(false);
      setEditTemplate(null);
      fetchData();
    }
  };

  const deleteTemplate = async (id: string, isDefault: boolean) => {
    if (isDefault) { toast.error('Cannot delete the EVA Default template'); return; }
    const { error } = await supabase.from('message_templates').delete().eq('id', id);
    if (error) toast.error('Failed to delete');
    else { toast.success('Template deleted'); fetchData(); }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>;

  return (
    <div className="space-y-8">

      {/* ── Stats cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">WhatsApp Status</CardTitle>
            {isConnected ? <Wifi className="w-5 h-5 text-green-600" /> : <WifiOff className="w-5 h-5 text-destructive" />}
          </CardHeader>
          <CardContent>
            <div className={`flex items-center gap-2 ${isConnected ? 'text-green-600' : 'text-destructive'}`}>
              <span className={`w-4 h-4 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-2xl font-bold">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sent Today</CardTitle>
            <MessageSquare className="w-5 h-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{stats.sentToday} <span className="text-lg text-muted-foreground">of 50</span></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending in Queue</CardTitle>
            <Clock className="w-5 h-5 text-accent" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-accent">{stats.pending}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sending Status</CardTitle>
            <FileText className="w-5 h-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${sendingPaused ? 'text-yellow-600' : 'text-green-600'}`}>
              {sendingPaused ? 'Paused' : 'Running'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── WhatsApp Connection ─────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><QrCode className="w-5 h-5" /> WhatsApp Connection</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-center gap-4">

          {/* No instance assigned */}
          {!hasInstance ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-10 h-10 text-muted-foreground" />
              <p className="text-base font-medium text-muted-foreground">WhatsApp not configured</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Your administrator needs to assign a WhatsApp instance to your account before you can connect.
              </p>
            </div>

          ) : isConnected ? (
            <>
              <Badge className="bg-green-600 text-white text-lg px-6 py-2">Connected</Badge>
              {sendingPaused ? (
                <Button onClick={() => togglePause(false)} disabled={togglingPause} size="lg"
                  className="bg-green-600 hover:bg-green-700 text-white text-base px-8 py-6 h-auto">
                  {togglingPause ? <Loader2 className="animate-spin mr-2 w-5 h-5" /> : <Play className="w-5 h-5 mr-2" />}
                  Sending Paused — click to resume
                </Button>
              ) : (
                <Button onClick={() => togglePause(true)} disabled={togglingPause} size="lg"
                  className="bg-yellow-500 hover:bg-yellow-600 text-white text-base px-8 py-6 h-auto">
                  {togglingPause ? <Loader2 className="animate-spin mr-2 w-5 h-5" /> : <Pause className="w-5 h-5 mr-2" />}
                  Sending Active — click to pause
                </Button>
              )}
              <p className="text-sm text-muted-foreground text-center">
                Your WhatsApp is active. Messages will send automatically between 9am and 7pm.
              </p>
              <Button variant="destructive" size="sm" onClick={disconnect}>Disconnect</Button>
            </>

          ) : connecting && !qrCode && !preparingQR ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="animate-spin w-10 h-10 text-primary" />
              <p className="text-base font-medium text-muted-foreground">Connecting your WhatsApp...</p>
            </div>

          ) : qrCode ? (
            <>
              <img src={qrCode} alt="WhatsApp QR Code" className="border rounded-lg" style={{ width: 256, height: 256 }} />
              <p className="text-sm font-medium text-center">Scan this code with your WhatsApp app to start sending</p>
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="animate-spin w-4 h-4" /> Waiting for scan — keep this page open
              </div>
            </>

          ) : preparingQR ? (
            <div className="bg-muted rounded-lg flex items-center justify-center border-2 border-dashed" style={{ width: 256, height: 256 }}>
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="animate-spin w-6 h-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center px-4">Session initialising — QR code will appear shortly</p>
              </div>
            </div>

          ) : (
            <>
              <div className="bg-muted rounded-lg flex items-center justify-center border-2 border-dashed" style={{ width: 256, height: 256 }}>
                <p className="text-sm text-muted-foreground text-center px-4">Scan this code with your WhatsApp to connect</p>
              </div>
              <Button onClick={requestQR} disabled={connecting}>
                {connecting ? <Loader2 className="animate-spin mr-2" /> : null}
                Request QR Code
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Pending Queue ───────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Pending Queue (Next 10)</CardTitle></CardHeader>
        <CardContent>
          {pendingContacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pending contacts</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Owner Name</TableHead><TableHead>Number</TableHead><TableHead>Message Preview</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pendingContacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.owner_name}</TableCell>
                    <TableCell className="font-mono text-sm">{c.number_1}</TableCell>
                    <TableCell className="max-w-[300px]">
                      <button onClick={() => setExpandedMsg(expandedMsg === c.id ? null : c.id)} className="text-left text-sm hover:text-primary">
                        {expandedMsg === c.id ? c.generated_message : (c.generated_message?.slice(0, 80) + (c.generated_message?.length > 80 ? '...' : ''))}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => cancelContact(c.id)}>
                        Cancel
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Templates ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Message Templates</CardTitle>
          <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create New Template</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Template</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <Input placeholder="Template name" value={newTemplate.name} onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })} />
                <Textarea placeholder="Hi [Owner Name], I'm [Agent Name] from EVA..." rows={5} value={newTemplate.body} onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  Placeholders: [Owner Name], [Agent Name], [Building Name], [Unit Number]
                </p>
              </div>
              <DialogFooter><Button onClick={saveTemplate}>Save Template</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No templates yet</p>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => (
                <div key={t.id} className="flex items-start justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{t.template_name} {t.is_default && <Badge variant="secondary" className="ml-2 text-xs">Default</Badge>}</p>
                    <p className="text-sm text-muted-foreground mt-1">{toFriendly(t.body).slice(0, 80)}{toFriendly(t.body).length > 80 ? '...' : ''}</p>
                  </div>
                  <div className="flex gap-1 ml-4">
                    <Button variant="ghost" size="icon" onClick={() => { setEditTemplate({ ...t, body: toFriendly(t.body) }); setEditDialogOpen(true); }}><Edit2 className="w-4 h-4" /></Button>
                    {!t.is_default && <Button variant="ghost" size="icon" onClick={() => deleteTemplate(t.id, t.is_default)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Template Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Template</DialogTitle></DialogHeader>
          {editTemplate && (
            <div className="space-y-4">
              <Input value={editTemplate.template_name} onChange={(e) => setEditTemplate({ ...editTemplate, template_name: e.target.value })} />
              <Textarea rows={5} value={editTemplate.body} onChange={(e) => setEditTemplate({ ...editTemplate, body: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                Placeholders: [Owner Name], [Agent Name], [Building Name], [Unit Number]
              </p>
            </div>
          )}
          <DialogFooter><Button onClick={updateTemplate}>Update Template</Button></DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default AgentDashboard;
