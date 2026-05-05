import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

type Kpis = {
  users: number;
  connected: number;
  sent_lifetime: number;
  pending: number;
  last_send: string | null;
  new_7d: number;
  dau_7d: number;
};

type DayRow      = { day: string; sent: number; failed: number; cancelled: number; pending: number };
type StatusRow   = { message_status: string; n: number };
type UserRow     = {
  id: string;
  name: string;
  email: string;
  conn: string;
  paused: boolean;
  sent: number;
  last_send: string | null;
  last_login: string | null;
  created_at: string;
};
type BatchRow    = {
  id: string;
  upload_date: string;
  batch_name: string | null;
  total_contacts: number | null;
  sent_count: number | null;
  pending_count: number | null;
  completed_at: string | null;
  uploaded_by_email: string | null;
};
type IORow       = { day: string; incoming: number; outgoing: number };
type SignupRow   = { week: string; signups: number };
type Readyz      = {
  ok: boolean;
  stalled: boolean;
  last_send_at: string | null;
  last_send_age_hrs: number | null;
  pending: number;
  connected: number;
  total_active: number;
  in_business_hours: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
};
const hoursSince = (s: string | null | undefined) => {
  if (!s) return null;
  return Math.floor((Date.now() - new Date(s).getTime()) / 3.6e6);
};

const STATUS_COLOR: Record<string, string> = {
  sent: '#16a34a', failed: '#dc2626', cancelled: '#9ca3af',
  pending: '#f59e0b', duplicate: '#3949ab', replied: '#0277bd',
  wants_report: '#6d4c41', interested_sell: '#0ea5e9', interested_rent: '#7c3aed',
  opted_out: '#475569',
};

// ── Component ─────────────────────────────────────────────────────────────────

const OpsDashboard = () => {
  const { profile } = useAuth();

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kpis,       setKpis]       = useState<Kpis | null>(null);
  const [throughput, setThroughput] = useState<DayRow[]>([]);
  const [statusMix,  setStatusMix]  = useState<StatusRow[]>([]);
  const [users,      setUsers]      = useState<UserRow[]>([]);
  const [batches,    setBatches]    = useState<BatchRow[]>([]);
  const [io,         setIo]         = useState<IORow[]>([]);
  const [signups,    setSignups]    = useState<SignupRow[]>([]);
  const [readyz,     setReadyz]     = useState<Readyz | null>(null);

  const isSuperAdmin = profile?.role === 'super_admin';

  const loadAll = useCallback(async () => {
    setRefreshing(true);

    // 1. KPIs — single round trip to Supabase via parallel selects
    const [
      profilesRes,
      connectedRes,
      logsRes,
      pendingRes,
      lastSendRes,
      new7dRes,
      dau7dRes,
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('whatsapp_session_status', 'connected'),
      supabase.from('messages_log').select('*', { count: 'exact', head: true }).eq('delivery_status', 'sent'),
      supabase.from('owner_contacts').select('*', { count: 'exact', head: true }).eq('message_status', 'pending'),
      supabase.from('messages_log').select('sent_at').eq('delivery_status', 'sent').order('sent_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('last_login', new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);

    setKpis({
      users:         profilesRes.count  ?? 0,
      connected:     connectedRes.count ?? 0,
      sent_lifetime: logsRes.count      ?? 0,
      pending:       pendingRes.count   ?? 0,
      last_send:     lastSendRes.data?.sent_at ?? null,
      new_7d:        new7dRes.count     ?? 0,
      dau_7d:        dau7dRes.count     ?? 0,
    });

    // 2. Throughput last 30 days — fetch raw rows, bucket client-side.
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const ocRes = await supabase
      .from('owner_contacts')
      .select('message_status, sent_at, created_at')
      .or(`sent_at.gte.${since30},created_at.gte.${since30}`)
      .limit(20000);
    const byDay: Record<string, DayRow> = {};
    (ocRes.data || []).forEach((r: any) => {
      const ts = r.sent_at || r.created_at;
      if (!ts) return;
      const day = new Date(ts).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { day, sent: 0, failed: 0, cancelled: 0, pending: 0 };
      if      (r.message_status === 'sent')      byDay[day].sent++;
      else if (r.message_status === 'failed')    byDay[day].failed++;
      else if (r.message_status === 'cancelled') byDay[day].cancelled++;
      else if (r.message_status === 'pending')   byDay[day].pending++;
    });
    setThroughput(Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)));

    // 3. Status doughnut
    const allRes = await supabase.from('owner_contacts').select('message_status').limit(20000);
    const counts: Record<string, number> = {};
    (allRes.data || []).forEach((r: any) => {
      counts[r.message_status] = (counts[r.message_status] || 0) + 1;
    });
    setStatusMix(
      Object.entries(counts)
        .map(([message_status, n]) => ({ message_status, n }))
        .sort((a, b) => b.n - a.n)
    );

    // 4. Per-user delivery
    const profileRes = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, whatsapp_session_status, sending_paused, last_login, created_at');
    const allLogs = await supabase
      .from('messages_log')
      .select('agent_id, sent_at')
      .eq('delivery_status', 'sent');
    const sentByAgent: Record<string, { count: number; last: string }> = {};
    (allLogs.data || []).forEach((r: any) => {
      const agg = sentByAgent[r.agent_id] || { count: 0, last: '' };
      agg.count++;
      if (!agg.last || r.sent_at > agg.last) agg.last = r.sent_at;
      sentByAgent[r.agent_id] = agg;
    });
    setUsers(
      (profileRes.data || [])
        .map((p: any) => ({
          id:         p.id,
          name:       `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email,
          email:      p.email,
          conn:       p.whatsapp_session_status,
          paused:     !!p.sending_paused,
          sent:       sentByAgent[p.id]?.count || 0,
          last_send:  sentByAgent[p.id]?.last  || null,
          last_login: p.last_login,
          created_at: p.created_at,
        }))
        .sort((a, b) => b.sent - a.sent || (b.created_at || '').localeCompare(a.created_at || ''))
    );

    // 5. Recent batches (filtered to non-archived if column exists; falls back gracefully)
    let batchQuery = supabase
      .from('batches')
      .select('id, batch_name, upload_date, total_contacts, sent_count, pending_count, completed_at, uploaded_by, is_archived')
      .order('upload_date', { ascending: false })
      .limit(20);
    let batchRes = await batchQuery;
    // If is_archived column missing, refetch without the filter.
    if (batchRes.error && /is_archived/.test(batchRes.error.message || '')) {
      batchRes = await supabase
        .from('batches')
        .select('id, batch_name, upload_date, total_contacts, sent_count, pending_count, completed_at, uploaded_by')
        .order('upload_date', { ascending: false })
        .limit(20);
    }
    const visible = (batchRes.data || []).filter((b: any) => !b.is_archived);
    const uploaderIds = Array.from(new Set(visible.map((b: any) => b.uploaded_by).filter(Boolean)));
    let uploaderMap: Record<string, string> = {};
    if (uploaderIds.length) {
      const upRes = await supabase.from('profiles').select('id, email').in('id', uploaderIds);
      uploaderMap = Object.fromEntries((upRes.data || []).map((p: any) => [p.id, p.email]));
    }
    setBatches(
      visible.map((b: any) => ({
        id:                b.id,
        upload_date:       b.upload_date,
        batch_name:        b.batch_name,
        total_contacts:    b.total_contacts,
        sent_count:        b.sent_count,
        pending_count:     b.pending_count,
        completed_at:      b.completed_at,
        uploaded_by_email: uploaderMap[b.uploaded_by] || null,
      }))
    );

    // 6. Incoming vs outgoing — last 14 days
    const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
    const [incRes, outRes] = await Promise.all([
      supabase.from('incoming_messages').select('received_at').gte('received_at', since14).limit(20000),
      supabase.from('messages_log').select('sent_at, delivery_status').gte('sent_at', since14).eq('delivery_status', 'sent').limit(20000),
    ]);
    const ioMap: Record<string, IORow> = {};
    (incRes.data || []).forEach((r: any) => {
      const day = new Date(r.received_at).toISOString().slice(0, 10);
      if (!ioMap[day]) ioMap[day] = { day, incoming: 0, outgoing: 0 };
      ioMap[day].incoming++;
    });
    (outRes.data || []).forEach((r: any) => {
      const day = new Date(r.sent_at).toISOString().slice(0, 10);
      if (!ioMap[day]) ioMap[day] = { day, incoming: 0, outgoing: 0 };
      ioMap[day].outgoing++;
    });
    setIo(Object.values(ioMap).sort((a, b) => a.day.localeCompare(b.day)));

    // 7. Signups by week
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const supRes = await supabase
      .from('profiles')
      .select('created_at')
      .gte('created_at', since90);
    const wkMap: Record<string, number> = {};
    (supRes.data || []).forEach((r: any) => {
      const d = new Date(r.created_at);
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const week = monday.toISOString().slice(0, 10);
      wkMap[week] = (wkMap[week] || 0) + 1;
    });
    setSignups(
      Object.entries(wkMap)
        .map(([week, signups]) => ({ week, signups }))
        .sort((a, b) => a.week.localeCompare(b.week))
    );

    // 8. Backend readyz (best effort)
    try {
      const r = await fetch('/api/health/readyz');
      if (r.ok || r.status === 503) setReadyz(await r.json());
    } catch {
      // ignore — backend may be unreachable from the SPA origin
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (isSuperAdmin) loadAll();
    else setLoading(false);
  }, [isSuperAdmin, loadAll]);

  // ── Guard ──────────────────────────────────────────────────────

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          This page is restricted to super admins.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const lastSendAge = hoursSince(kpis?.last_send);
  const stalled = readyz?.stalled ?? (lastSendAge != null && lastSendAge > 6);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Operations</h1>
          <p className="text-sm text-muted-foreground">Live system health, throughput, and queue state.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Status banner */}
      {stalled ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="flex-1 text-sm">
              <strong className="text-destructive">Outbound sending appears stalled.</strong>{' '}
              Last successful send was {lastSendAge ?? '—'} hours ago.
              {readyz && (
                <span className="ml-1">
                  Connected agents: <strong>{readyz.connected}</strong>, pending in queue: <strong>{readyz.pending}</strong>.
                </span>
              )}
              {' '}Check `/api/health/readyz` and PM2 logs on the droplet.
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900">
          <CardContent className="py-3 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <div className="text-sm text-emerald-900 dark:text-emerald-200">
              Outbound healthy. Last send {lastSendAge ?? 0} h ago.
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Kpi label="Total users"      value={fmt(kpis?.users)}        sub={`+${fmt(kpis?.new_7d)} new in 7d`} />
        <Kpi label="Connected"        value={`${fmt(kpis?.connected)} / ${fmt(kpis?.users)}`} sub={`${fmt(kpis?.dau_7d)} active in 7d`} />
        <Kpi label="Sent (lifetime)"  value={fmt(kpis?.sent_lifetime)} />
        <Kpi label="Pending in queue" value={fmt(kpis?.pending)} />
        <Kpi label="Last successful send" value={fmtDate(kpis?.last_send)} />
        <Kpi label="Hours since last send" value={lastSendAge == null ? '—' : String(lastSendAge)} sub={stalled ? 'stalled' : 'recent'} />
      </div>

      {/* Throughput + status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Daily outbound — last 30 days</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={throughput}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar stackId="a" dataKey="sent"      fill={STATUS_COLOR.sent} />
                <Bar stackId="a" dataKey="failed"    fill={STATUS_COLOR.failed} />
                <Bar stackId="a" dataKey="cancelled" fill={STATUS_COLOR.cancelled} />
                <Bar stackId="a" dataKey="pending"   fill={STATUS_COLOR.pending} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Queue mix</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusMix} dataKey="n" nameKey="message_status" outerRadius={90}>
                  {statusMix.map((s) => (
                    <Cell key={s.message_status} fill={STATUS_COLOR[s.message_status] || '#888'} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Per-user delivery */}
      <Card>
        <CardHeader><CardTitle className="text-base">Per-user delivery</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead>Last send</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.conn === 'connected' ? 'default' : 'secondary'}>
                      {u.conn}
                    </Badge>
                    {u.paused && <Badge variant="outline" className="ml-2">paused</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(u.sent)}</TableCell>
                  <TableCell className="text-xs">{u.last_send ? fmtDate(u.last_send) : '—'}</TableCell>
                  <TableCell className="text-xs">{u.last_login ? fmtDate(u.last_login) : '—'}</TableCell>
                  <TableCell className="text-xs">{fmtDate(u.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent batches + I/O */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent batches (last 20, archived hidden)</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => {
                  const stuck = (b.sent_count ?? 0) === 0 && (b.total_contacts ?? 0) > 0;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs">{(b.upload_date || '').slice(0, 10)}</TableCell>
                      <TableCell className="text-sm">
                        {b.batch_name || '—'}
                        {stuck && <Badge variant="destructive" className="ml-2">0 sent</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.uploaded_by_email || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(b.total_contacts)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(b.sent_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(b.pending_count)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Incoming vs outgoing — last 14 days</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={io}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="incoming" stroke="#0277bd" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="outgoing" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Signups */}
      <Card>
        <CardHeader><CardTitle className="text-base">Signups by week — last 90 days</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={signups}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="signups" fill="#1e88e5" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

// ── Tiny KPI tile ─────────────────────────────────────────────────────────────

const Kpi = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Card>
    <CardContent className="py-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1 leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent>
  </Card>
);

export default OpsDashboard;
