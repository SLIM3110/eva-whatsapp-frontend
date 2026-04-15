import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getTodayStartUTC, toUAETime } from '@/lib/uaeTime';
import { toast } from 'sonner';
import { MessageSquare, Users, AlertTriangle, Copy, Loader2, UserPlus, Trash2, Plus, Wifi, WifiOff, Pause, Play, RefreshCw } from 'lucide-react';

const BACKEND_URL = 'https://api.evaintelligencehub.online';

const AdminDashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({ totalSent: 0, activeAgents: 0, failedToday: 0 });
  const [agents, setAgents] = useState<any[]>([]);
  const [failedMessages, setFailedMessages] = useState<any[]>([]);
  const [disconnectedAgents, setDisconnectedAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [newBlacklistNumber, setNewBlacklistNumber] = useState('');
  const [failedModalOpen, setFailedModalOpen] = useState(false);
  const [togglingAgent, setTogglingAgent] = useState<string | null>(null);
  const [togglingAll, setTogglingAll] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);

  const getSettings = async () => {
    const { data } = await supabase.from('api_settings').select('whatsapp_backend_url, whatsapp_api_key').eq('id', 1).single();
    return { url: data?.whatsapp_backend_url || BACKEND_URL, key: data?.whatsapp_api_key || '' };
  };

  const fetchData = useCallback(async () => {
    const todayStart = getTodayStartUTC();

    const [sentRes, agentsRes] = await Promise.all([
      supabase.from('messages_log').select('id', { count: 'exact' }).gte('sent_at', todayStart),
      supabase.from('profiles').select('*').eq('role', 'agent'),
    ]);

    const agentData = agentsRes.data || [];

    const agentIds = agentData.map(a => a.id);

    let agentMsgCounts: Record<string, number> = {};
    let agentPendingCounts: Record<string, number> = {};
    let failed: any[] = [];

    if (agentIds.length > 0) {
      const [agentMessages, pendingContacts] = await Promise.all([
        supabase
          .from('messages_log')
          .select('agent_id, sent_at, delivery_status, number_used, contact_id, message_text')
          .in('agent_id', agentIds)
          .gte('sent_at', todayStart),
        supabase
          .from('owner_contacts')
          .select('assigned_agent')
          .in('assigned_agent', agentIds)
          .eq('message_status', 'pending'),
      ]);

      (agentMessages.data || []).forEach(m => {
        agentMsgCounts[m.agent_id] = (agentMsgCounts[m.agent_id] || 0) + 1;
        if (m.delivery_status === 'failed') {
          const agent = agentData.find(a => a.id === m.agent_id);
          failed.push({ ...m, agent_name: agent ? `${agent.first_name} ${agent.last_name}` : 'Unknown' });
        }
      });

      (pendingContacts.data || []).forEach(c => {
        agentPendingCounts[c.assigned_agent] = (agentPendingCounts[c.assigned_agent] || 0) + 1;
      });
    }

    setStats({
      totalSent: sentRes.count || 0,
      activeAgents: agentData.filter(a => a.is_active).length,
      failedToday: failed.length,
    });

    setAgents(agentData.map(a => ({
      ...a,
      sentToday: agentMsgCounts[a.id] || 0,
      pendingCount: agentPendingCounts[a.id] || 0,
    })));

    setFailedMessages(failed.slice(0, 50));
    setDisconnectedAgents(agentData.filter(a => a.whatsapp_session_status !== 'connected'));
    setLoading(false);
  }, []);

  // Auto-refresh every 30s
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const generateCode = async () => {
    setGenerating(true);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const { error } = await supabase.from('activation_codes').insert({ code, created_by: user!.id });
    if (error) {
      const code2 = Math.floor(100000 + Math.random() * 900000).toString();
      const { error: e2 } = await supabase.from('activation_codes').insert({ code: code2, created_by: user!.id });
      if (e2) toast.error('Failed to generate code');
      else setGeneratedCode(code2);
    } else {
      setGeneratedCode(code);
    }
    setGenerating(false);
  };

  const addToBlacklist = () => {
    if (newBlacklistNumber.trim()) {
      setBlacklist(prev => [...prev, newBlacklistNumber.trim()]);
      setNewBlacklistNumber('');
      toast.success('Number added to blacklist');
    }
  };

  const removeFromBlacklist = (num: string) => {
    setBlacklist(prev => prev.filter(n => n !== num));
  };

  const toggleAgentPause = async (agentId: string, pause: boolean) => {
    setTogglingAgent(agentId);
    try {
      const { url, key } = await getSettings();
      const endpoint = pause ? '/api/session/pause' : '/api/session/resume';
      await fetch(`${url}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ agentId }),
      });
      await supabase.from('profiles').update({ sending_paused: pause }).eq('id', agentId);
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, sending_paused: pause } : a));
      toast.success(pause ? 'Agent paused' : 'Agent resumed');
    } catch {
      toast.error('Failed to update agent status');
    }
    setTogglingAgent(null);
  };

  const pauseAll = async () => {
    setTogglingAll(true);
    try {
      const { url, key } = await getSettings();
      const agentIds = agents.map(a => a.id);
      await Promise.all(agentIds.map(id =>
        fetch(`${url}/api/session/pause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({ agentId: id }),
        }).catch(() => {})
      ));
      if (agentIds.length > 0) {
        await supabase.from('profiles').update({ sending_paused: true }).in('id', agentIds);
      }
      setAgents(prev => prev.map(a => ({ ...a, sending_paused: true })));
      toast.success('All agents paused');
    } catch {
      toast.error('Failed to pause all agents');
    }
    setTogglingAll(false);
  };

  const resumeAll = async () => {
    setTogglingAll(true);
    try {
      const { url, key } = await getSettings();
      const agentIds = agents.map(a => a.id);
      await Promise.all(agentIds.map(id =>
        fetch(`${url}/api/session/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({ agentId: id }),
        }).catch(() => {})
      ));
      if (agentIds.length > 0) {
        await supabase.from('profiles').update({ sending_paused: false }).in('id', agentIds);
      }
      setAgents(prev => prev.map(a => ({ ...a, sending_paused: false })));
      toast.success('All agents resumed');
    } catch {
      toast.error('Failed to resume all agents');
    }
    setTogglingAll(false);
  };

  const retryAllFailed = async () => {
    setRetryingAll(true);
    const todayStart = getTodayStartUTC();
    try {
      // Get failed contact IDs from today's messages
      const { data: failedLogs } = await supabase
        .from('messages_log')
        .select('contact_id')
        .gte('sent_at', todayStart)
        .eq('delivery_status', 'failed');

      const contactIds = (failedLogs || []).map(m => m.contact_id).filter(Boolean);
      if (contactIds.length > 0) {
        await supabase.from('owner_contacts').update({ message_status: 'pending' }).in('id', contactIds);
      }
      toast.success(`${contactIds.length} failed contacts reset to pending`);
      setFailedModalOpen(false);
      fetchData();
    } catch {
      toast.error('Failed to retry');
    }
    setRetryingAll(false);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>;

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Messages Today</CardTitle>
            <MessageSquare className="w-5 h-5 text-primary" />
          </CardHeader>
          <CardContent><p className="text-3xl font-bold text-primary">{stats.totalSent}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Agents</CardTitle>
            <Users className="w-5 h-5 text-accent" />
          </CardHeader>
          <CardContent><p className="text-3xl font-bold text-accent">{stats.activeAgents}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed Messages Today</CardTitle>
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-3xl font-bold text-destructive">{stats.failedToday}</p>
            {stats.failedToday > 0 && (
              <Button size="sm" variant="outline" onClick={() => setFailedModalOpen(true)}>View</Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Sendout Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle>Agent Sendout Status</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={pauseAll} disabled={togglingAll}>
              {togglingAll ? <Loader2 className="animate-spin mr-1 w-4 h-4" /> : <Pause className="w-4 h-4 mr-1" />}
              Pause All
            </Button>
            <Button size="sm" variant="outline" onClick={resumeAll} disabled={togglingAll}>
              {togglingAll ? <Loader2 className="animate-spin mr-1 w-4 h-4" /> : <Play className="w-4 h-4 mr-1" />}
              Resume All
            </Button>
            <Button size="sm" variant="ghost" onClick={fetchData}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-muted-foreground text-sm">No agents registered</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Sent Today</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.first_name} {a.last_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {a.whatsapp_session_status === 'connected'
                          ? <><Wifi className="w-4 h-4 text-green-600" /><span className="text-green-600 text-sm">Connected</span></>
                          : <><WifiOff className="w-4 h-4 text-destructive" /><span className="text-destructive text-sm">Disconnected</span></>
                        }
                      </div>
                    </TableCell>
                    <TableCell>{a.sentToday} of 50</TableCell>
                    <TableCell>{a.pendingCount}</TableCell>
                    <TableCell>
                      {a.sending_paused
                        ? <Badge className="bg-yellow-500 text-white">Paused</Badge>
                        : <Badge className="bg-green-600 text-white">Running</Badge>
                      }
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={togglingAgent === a.id}
                          onClick={() => toggleAgentPause(a.id, true)}
                        >
                          {togglingAgent === a.id ? <Loader2 className="animate-spin w-3 h-3" /> : <Pause className="w-3 h-3 mr-1" />}
                          Pause
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={togglingAgent === a.id}
                          onClick={() => toggleAgentPause(a.id, false)}
                        >
                          {togglingAgent === a.id ? <Loader2 className="animate-spin w-3 h-3" /> : <Play className="w-3 h-3 mr-1" />}
                          Resume
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Health */}
        <Card>
          <CardHeader><CardTitle className="text-base">System Health</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Disconnected Agents</p>
              {disconnectedAgents.length === 0 ? (
                <p className="text-sm text-green-600">All agents connected</p>
              ) : (
                <div className="space-y-2">
                  {disconnectedAgents.map(a => (
                    <div key={a.id} className="flex items-center justify-between text-xs p-2 rounded border bg-destructive/5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3 text-destructive" />
                        <span>{a.first_name} {a.last_name}</span>
                      </div>
                      <span className="text-muted-foreground">Needs reconnect</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Salem Engine Summary */}
        <Card>
          <CardHeader><CardTitle className="text-base">Salem Engine</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-4">Sequence stage breakdown</p>
            <div className="space-y-2">
              {['Day 1', 'Day 3', 'Day 7', 'Completed', 'Paused'].map(stage => (
                <div key={stage} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{stage}</span>
                  <Badge variant="secondary">0</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <Button onClick={generateCode} disabled={generating} size="sm">
              {generating ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Generate Code
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Generate activation codes for new users and manage system settings from here.</p>

            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium">Salem Blacklist</p>
              <div className="flex gap-2">
                <Input placeholder="Enter phone number" value={newBlacklistNumber} onChange={e => setNewBlacklistNumber(e.target.value)} />
                <Button size="sm" onClick={addToBlacklist}><Plus className="w-4 h-4" /></Button>
              </div>
              {blacklist.length === 0 ? (
                <p className="text-sm text-muted-foreground">No blacklisted numbers</p>
              ) : (
                <div className="space-y-1">
                  {blacklist.map(num => (
                    <div key={num} className="flex items-center justify-between text-sm p-2 rounded border">
                      <span className="font-mono">{num}</span>
                      <Button variant="ghost" size="icon" onClick={() => removeFromBlacklist(num)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generated Code Modal */}
      <Dialog open={!!generatedCode} onOpenChange={() => setGeneratedCode(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Activation Code Generated</DialogTitle></DialogHeader>
          <div className="text-center space-y-4">
            <p className="text-4xl font-mono font-bold tracking-widest text-primary">{generatedCode}</p>
            <p className="text-sm text-muted-foreground">Share this code with the user to activate their account</p>
            <Button onClick={() => { navigator.clipboard.writeText(generatedCode!); toast.success('Copied!'); }} className="w-full">
              <Copy className="w-4 h-4 mr-2" /> Copy Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Failed Messages Modal */}
      <Dialog open={failedModalOpen} onOpenChange={setFailedModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Failed Messages Today ({failedMessages.length})</DialogTitle>
              <Button onClick={retryAllFailed} disabled={retryingAll} size="sm" className="mr-6">
                {retryingAll ? <Loader2 className="animate-spin mr-1 w-4 h-4" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                Retry All
              </Button>
            </div>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-2 mt-2">
            {failedMessages.length === 0 ? (
              <p className="text-muted-foreground text-sm">No failed messages</p>
            ) : (
              failedMessages.map(m => (
                <div key={m.id} className="text-xs p-3 rounded border bg-destructive/5">
                  <p className="font-medium">{m.agent_name}</p>
                  <p className="text-muted-foreground">{m.number_used} • {toUAETime(m.sent_at)}</p>
                  <p className="mt-1 text-foreground/70 line-clamp-2">{m.message_text}</p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;
