import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart3, Loader2, Clock } from 'lucide-react';

type DateRange = '24h' | '7d' | '30d' | 'all';

type AgentStats = {
  id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  admin_id: string | null;
  sent: number;
  failed: number;
  replied: number;
  pending: number;
};

type AdminGroup = {
  id: string;
  first_name: string;
  last_name: string;
  agents: AgentStats[];
};

const dateRangeStart = (range: DateRange): string | null => {
  if (range === 'all') return null;
  const d = new Date();
  if (range === '24h') {
    d.setHours(d.getHours() - 24);
  } else {
    d.setDate(d.getDate() - (range === '7d' ? 7 : 30));
  }
  return d.toISOString();
};

const Analytics = () => {
  const { user, profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const isAdmin      = profile?.role === 'admin' || isSuperAdmin;

  const [range, setRange]       = useState<DateRange>('30d');
  const [loading, setLoading]   = useState(true);
  const [groups, setGroups]     = useState<AdminGroup[]>([]);
  const [ungrouped, setUngrouped] = useState<AgentStats[]>([]);

  const fetchData = useCallback(async () => {
    if (!user || !isAdmin) return;
    setLoading(true);

    const since = dateRangeStart(range);

    const baseAgentsQ = supabase
      .from('profiles')
      .select('id, first_name, last_name, is_active, admin_id, role')
      .eq('role', 'agent');

    const [agentsRes, adminsRes] = await Promise.all([
      isSuperAdmin ? baseAgentsQ : baseAgentsQ.eq('admin_id', user.id),
      isSuperAdmin
        ? supabase.from('profiles').select('id, first_name, last_name').in('role', ['admin', 'super_admin'] as any)
        : Promise.resolve({ data: null }),
    ]);

    const agentList = agentsRes.data || [];
    const adminList = adminsRes.data || [];

    if (agentList.length === 0) { setGroups([]); setUngrouped([]); setLoading(false); return; }

    const agentIds = agentList.map((a: any) => a.id);

    // Fetch contact stats per agent
    let contactsQuery = supabase
      .from('owner_contacts')
      .select('assigned_agent, message_status, reply_count, sent_at')
      .in('assigned_agent', agentIds);
    if (since) contactsQuery = contactsQuery.gte('sent_at', since);

    const { data: contacts } = await contactsQuery;
    const rows = contacts || [];

    // Pending contacts don't have sent_at — fetch separately (no date filter)
    const { data: pendingRows } = await supabase
      .from('owner_contacts')
      .select('assigned_agent')
      .in('assigned_agent', agentIds)
      .eq('message_status', 'pending');

    const pendingByAgent = (pendingRows || []).reduce<Record<string, number>>((acc, r: any) => {
      acc[r.assigned_agent] = (acc[r.assigned_agent] || 0) + 1;
      return acc;
    }, {});

    const statsByAgent = agentList.reduce<Record<string, AgentStats>>((acc, a: any) => {
      acc[a.id] = { id: a.id, first_name: a.first_name, last_name: a.last_name, is_active: a.is_active, admin_id: a.admin_id, sent: 0, failed: 0, replied: 0, pending: pendingByAgent[a.id] || 0 };
      return acc;
    }, {});

    for (const r of rows) {
      const s = statsByAgent[r.assigned_agent];
      if (!s) continue;
      if (r.message_status === 'sent')   s.sent++;
      if (r.message_status === 'failed') s.failed++;
      if ((r.reply_count || 0) > 0)      s.replied++;
    }

    const statsArr = Object.values(statsByAgent);

    if (isSuperAdmin) {
      const adminMap = Object.fromEntries(adminList.map((a: any) => [a.id, a]));
      const groupMap: Record<string, AdminGroup> = {};
      const noAdmin: AgentStats[] = [];

      for (const agent of statsArr) {
        if (agent.admin_id && adminMap[agent.admin_id]) {
          if (!groupMap[agent.admin_id]) {
            const adm = adminMap[agent.admin_id];
            groupMap[agent.admin_id] = { id: adm.id, first_name: adm.first_name, last_name: adm.last_name, agents: [] };
          }
          groupMap[agent.admin_id].agents.push(agent);
        } else {
          noAdmin.push(agent);
        }
      }
      setGroups(Object.values(groupMap));
      setUngrouped(noAdmin);
    } else {
      setUngrouped(statsArr);
      setGroups([]);
    }

    setLoading(false);
  }, [user, isAdmin, isSuperAdmin, range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const AgentCard = ({ agent }: { agent: AgentStats }) => {
    const total       = agent.sent + agent.failed;
    const successRate = total > 0 ? Math.round((agent.sent / total) * 100) : 0;
    const replyRate   = agent.sent > 0 ? Math.round((agent.replied / agent.sent) * 100) : 0;
    const etaMins     = agent.pending * 3;
    const etaDisplay  = etaMins < 60
      ? `~${etaMins}m`
      : `~${Math.floor(etaMins / 60)}h ${etaMins % 60}m`;

    return (
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{agent.first_name} {agent.last_name}</p>
            </div>
            <Badge className={agent.is_active ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'}>
              {agent.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-muted-foreground text-xs">Total Sent</p>
              <p className="text-2xl font-bold text-green-600">{agent.sent}</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-muted-foreground text-xs">Pending</p>
              <p className="text-2xl font-bold">{agent.pending}</p>
              {agent.pending > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" /> {etaDisplay} to clear
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Send success rate</span>
              <span className="font-medium text-foreground">{successRate}%</span>
            </div>
            <Progress value={successRate} className="h-2" />
            <p className="text-xs text-muted-foreground">{agent.sent} sent · {agent.failed} failed</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Response rate</span>
              <span className="font-medium text-foreground">{replyRate}%</span>
            </div>
            <Progress value={replyRate} className="h-2" />
            <p className="text-xs text-muted-foreground">{agent.replied} replied out of {agent.sent} sent</p>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (!isAdmin) return (
    <p className="text-muted-foreground text-sm p-8">Access restricted to admins.</p>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5" /> Analytics
        </h2>
        <Select value={range} onValueChange={v => setRange(v as DateRange)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin w-8 h-8 text-primary" />
        </div>
      ) : (
        <>
          {isSuperAdmin && groups.map(group => (
            <div key={group.id} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {group.first_name} {group.last_name}'s Team
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.agents.map(a => <AgentCard key={a.id} agent={a} />)}
              </div>
            </div>
          ))}

          {ungrouped.length > 0 && (
            <div className="space-y-3">
              {isSuperAdmin && ungrouped.length > 0 && (
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Unassigned</h3>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ungrouped.map(a => <AgentCard key={a.id} agent={a} />)}
              </div>
            </div>
          )}

          {groups.length === 0 && ungrouped.length === 0 && (
            <p className="text-muted-foreground text-sm">No agents found.</p>
          )}
        </>
      )}
    </div>
  );
};

export default Analytics;
