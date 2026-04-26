import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Mail, Plus, Send, Users, RefreshCw, AlertCircle } from 'lucide-react';

const API_BASE = 'https://api.evaintelligencehub.online';
const API_KEY = 'EVAIntelligenceHub2024SecretKey99';

const apiFetch = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || json.message || 'Request failed');
  return json;
};

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    sent: 'bg-green-600 text-white',
    sending: 'bg-blue-500 text-white',
    scheduled: 'bg-amber-500 text-white',
  };
  return map[status] || 'bg-muted text-muted-foreground';
};

const EmailCampaigns = () => {
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);
  const [loadingAudiences, setLoadingAudiences] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Create campaign modal
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [creating, setCreating] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignFrom, setCampaignFrom] = useState('EVA Real Estate <campaigns@evadxb.com>');
  const [campaignReplyTo, setCampaignReplyTo] = useState('');
  const [campaignHtml, setCampaignHtml] = useState('');
  const [campaignAudienceId, setCampaignAudienceId] = useState('');

  // Create audience modal
  const [showCreateAudience, setShowCreateAudience] = useState(false);
  const [creatingAudience, setCreatingAudience] = useState(false);
  const [audienceName, setAudienceName] = useState('');

  // Send confirmation
  const [sendTarget, setSendTarget] = useState<any>(null);
  const [sending, setSending] = useState(false);

  // Sync contacts modal
  const [syncTarget, setSyncTarget] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchBroadcasts = useCallback(async () => {
    setLoadingBroadcasts(true);
    try {
      const data = await apiFetch('/api/email/broadcasts');
      setBroadcasts(data.broadcasts || []);
      setApiError(null);
    } catch (e: any) {
      setApiError(e.message);
    } finally {
      setLoadingBroadcasts(false);
    }
  }, []);

  const fetchAudiences = useCallback(async () => {
    setLoadingAudiences(true);
    try {
      const data = await apiFetch('/api/email/audiences');
      setAudiences(data.audiences || []);
    } catch (e: any) {
      console.error('Failed to load audiences:', e.message);
    } finally {
      setLoadingAudiences(false);
    }
  }, []);

  useEffect(() => {
    fetchBroadcasts();
    fetchAudiences();
  }, [fetchBroadcasts, fetchAudiences]);

  const createCampaign = async () => {
    if (!campaignName || !campaignSubject || !campaignFrom || !campaignHtml || !campaignAudienceId) {
      toast.error('Please fill in all required fields');
      return;
    }
    setCreating(true);
    try {
      await apiFetch('/api/email/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          name: campaignName,
          subject: campaignSubject,
          from: campaignFrom,
          replyTo: campaignReplyTo || undefined,
          html: campaignHtml,
          audienceId: campaignAudienceId,
        }),
      });
      toast.success('Campaign created successfully');
      setShowCreateCampaign(false);
      setCampaignName(''); setCampaignSubject(''); setCampaignHtml(''); setCampaignAudienceId(''); setCampaignReplyTo('');
      fetchBroadcasts();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const createAudience = async () => {
    if (!audienceName.trim()) { toast.error('Please enter an audience name'); return; }
    setCreatingAudience(true);
    try {
      await apiFetch('/api/email/audiences', {
        method: 'POST',
        body: JSON.stringify({ name: audienceName }),
      });
      toast.success('Audience created');
      setShowCreateAudience(false);
      setAudienceName('');
      fetchAudiences();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingAudience(false);
    }
  };

  const sendBroadcast = async () => {
    if (!sendTarget) return;
    setSending(true);
    try {
      await apiFetch('/api/email/broadcasts/' + sendTarget.id + '/send', { method: 'POST' });
      toast.success('Campaign is sending!');
      setSendTarget(null);
      fetchBroadcasts();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };

  const syncContacts = async () => {
    if (!syncTarget) return;
    setSyncing(true);
    try {
      const data = await apiFetch('/api/email/audiences/' + syncTarget.id + '/sync-contacts', { method: 'POST' });
      toast.success('Synced ' + (data.synced || 0) + ' contacts from owner list');
      setSyncTarget(null);
      fetchAudiences();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Mail className="w-6 h-6" /> Email Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Send newsletters and campaigns via Resend</p>
        </div>
        <Button onClick={() => setShowCreateCampaign(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Campaign
        </Button>
      </div>

      {/* API not configured warning */}
      {apiError && apiError.includes('RESEND_API_KEY') && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">Resend API key not configured</p>
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                  Add <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">RESEND_API_KEY=your_key</code> to the backend <code>.env</code> file and restart the server.
                  Get your key at <strong>resend.com/api-keys</strong>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="audiences">Audiences</TabsTrigger>
        </TabsList>

        {/* ── Campaigns Tab ─────────────────────────────────── */}
        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">All Campaigns</CardTitle>
              <Button variant="ghost" size="sm" onClick={fetchBroadcasts} disabled={loadingBroadcasts}>
                <RefreshCw className={`w-4 h-4 ${loadingBroadcasts ? 'animate-spin' : ''}`} />
              </Button>
            </CardHeader>
            <CardContent>
              {loadingBroadcasts ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin w-6 h-6 text-primary" /></div>
              ) : broadcasts.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No campaigns yet. Create your first one.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {broadcasts.map((b: any) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">{b.subject}</TableCell>
                        <TableCell>
                          <Badge className={statusBadge(b.status)}>{b.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.created_at ? new Date(b.created_at).toLocaleDateString('en-GB') : '—'}
                        </TableCell>
                        <TableCell>
                          {b.status === 'draft' && (
                            <Button size="sm" onClick={() => setSendTarget(b)}>
                              <Send className="w-3 h-3 mr-1" /> Send Now
                            </Button>
                          )}
                          {b.status === 'sent' && (
                            <span className="text-sm text-muted-foreground">Delivered</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audiences Tab ─────────────────────────────────── */}
        <TabsContent value="audiences" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">Contact Audiences</CardTitle>
              <Button size="sm" onClick={() => setShowCreateAudience(true)}>
                <Plus className="w-4 h-4 mr-2" /> New Audience
              </Button>
            </CardHeader>
            <CardContent>
              {loadingAudiences ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin w-6 h-6 text-primary" /></div>
              ) : audiences.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No audiences yet. Create one to start adding contacts.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audiences.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {a.created_at ? new Date(a.created_at).toLocaleDateString('en-GB') : '—'}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setSyncTarget(a)}>
                            <RefreshCw className="w-3 h-3 mr-1" /> Sync Owner Contacts
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Create Campaign Modal ──────────────────────────── */}
      <Dialog open={showCreateCampaign} onOpenChange={o => { if (!creating) setShowCreateCampaign(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Campaign Name <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. April Owner Newsletter" value={campaignName} onChange={e => setCampaignName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Audience <span className="text-destructive">*</span></Label>
                <Select value={campaignAudienceId} onValueChange={setCampaignAudienceId}>
                  <SelectTrigger><SelectValue placeholder="Select audience" /></SelectTrigger>
                  <SelectContent>
                    {audiences.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Subject Line <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Property Market Update — April 2026" value={campaignSubject} onChange={e => setCampaignSubject(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>From <span className="text-destructive">*</span></Label>
                <Input placeholder="Name <email@domain.com>" value={campaignFrom} onChange={e => setCampaignFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Reply-To <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input placeholder="reply@evadxb.com" value={campaignReplyTo} onChange={e => setCampaignReplyTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>HTML Content <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="<html><body><h1>Hello!</h1><p>Your email content here...</p></body></html>"
                value={campaignHtml}
                onChange={e => setCampaignHtml(e.target.value)}
                className="font-mono text-xs min-h-[200px]"
              />
              <p className="text-xs text-muted-foreground">Paste your full HTML email content above.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateCampaign(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createCampaign} disabled={creating}>
              {creating ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <Plus className="w-4 h-4 mr-2" />}
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Audience Modal ──────────────────────────── */}
      <Dialog open={showCreateAudience} onOpenChange={o => { if (!creatingAudience) setShowCreateAudience(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Audience</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Audience Name</Label>
              <Input placeholder="e.g. Dubai Property Owners" value={audienceName} onChange={e => setAudienceName(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateAudience(false)} disabled={creatingAudience}>Cancel</Button>
            <Button onClick={createAudience} disabled={creatingAudience}>
              {creatingAudience ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send Confirmation Modal ────────────────────────── */}
      <Dialog open={!!sendTarget} onOpenChange={o => { if (!sending && !o) setSendTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send Campaign</DialogTitle></DialogHeader>
          {sendTarget && (
            <div className="py-2 space-y-2">
              <p className="text-sm">Send <span className="font-semibold">{sendTarget.name}</span> now?</p>
              <p className="text-sm text-muted-foreground">This will immediately deliver the campaign to all contacts in the selected audience. This cannot be undone.</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendTarget(null)} disabled={sending}>Cancel</Button>
            <Button onClick={sendBroadcast} disabled={sending}>
              {sending ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <Send className="w-4 h-4 mr-2" />}
              Send Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sync Contacts Confirmation ─────────────────────── */}
      <Dialog open={!!syncTarget} onOpenChange={o => { if (!syncing && !o) setSyncTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Sync Owner Contacts</DialogTitle></DialogHeader>
          {syncTarget && (
            <div className="py-2 space-y-2">
              <p className="text-sm">Sync all contacts from the <strong>owner_contacts</strong> table into <span className="font-semibold">{syncTarget.name}</span>?</p>
              <p className="text-sm text-muted-foreground">Existing contacts will be skipped. Only new emails will be added.</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSyncTarget(null)} disabled={syncing}>Cancel</Button>
            <Button onClick={syncContacts} disabled={syncing}>
              {syncing ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Sync Contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmailCampaigns;
