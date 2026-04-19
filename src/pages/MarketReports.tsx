import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FileBarChart2, Loader2, Plus, X, Download, Trash2, ExternalLink } from 'lucide-react';
import { toUAETime } from '@/lib/uaeTime';

type ReportType = 'single' | 'multi';

const daysUntil = (iso: string): number => {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

const MarketReports = () => {
  const { user, profile } = useAuth();

  // ── Generate form state ───────────────────────────────────────
  const [reportType, setReportType]       = useState<ReportType>('single');
  const [communities, setCommunities]     = useState<string[]>(['']);
  const [reportPeriod, setReportPeriod]   = useState('');
  const [agentName, setAgentName]         = useState('');
  const [agentContact, setAgentContact]   = useState('');
  const [csvFile, setCsvFile]             = useState<File | null>(null);
  const [locationNotes, setLocationNotes] = useState('');
  const [serviceChargePsf, setServiceChargePsf] = useState('');
  const [agentInstruction, setAgentInstruction] = useState('');
  const [imageFile, setImageFile]               = useState<File | null>(null);
  const [imagePrompt, setImagePrompt]           = useState('');
  const [generating, setGenerating]       = useState(false);
  const [successResult, setSuccessResult] = useState<{ report_url: string; report_id: string; expires_at: string } | null>(null);

  // ── History state ─────────────────────────────────────────────
  const [reports, setReports]   = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  // Pre-fill agent fields from profile
  useEffect(() => {
    if (profile) {
      setAgentName(`${profile.first_name || ''} ${profile.last_name || ''}`.trim());
      setAgentContact((profile as any).email || (profile as any).phone || '');
    }
  }, [profile]);

  const fetchHistory = useCallback(async () => {
    setHistLoading(true);
    const { data } = await supabase
      .from('market_reports')
      .select('*')
      .order('created_at', { ascending: false });
    setReports(data || []);
    setHistLoading(false);
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ── Community helpers ─────────────────────────────────────────
  const addCommunity = () => {
    if (communities.length < 4) setCommunities(prev => [...prev, '']);
  };

  const removeCommunity = (i: number) => {
    setCommunities(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateCommunity = (i: number, val: string) => {
    setCommunities(prev => prev.map((c, idx) => idx === i ? val : c));
  };

  // ── Submit ────────────────────────────────────────────────────
  const handleGenerate = async () => {
    const filledCommunities = communities.filter(c => c.trim());
    if (!filledCommunities.length) { toast.error('Enter at least one community name'); return; }
    if (!reportPeriod.trim())      { toast.error('Enter a report period'); return; }
    if (!agentName.trim())         { toast.error('Enter agent name'); return; }
    if (!csvFile)                  { toast.error('Upload a Property Monitor CSV export'); return; }

    setGenerating(true);
    setSuccessResult(null);

    const form = new FormData();
    form.append('report_type', reportType);
    filledCommunities.forEach((c, i) => form.append(`community_${i}`, c));
    form.append('community_count', String(filledCommunities.length));
    form.append('report_period', reportPeriod);
    form.append('agent_name', agentName);
    form.append('agent_contact', agentContact);
    form.append('csv_file', csvFile);
    if (locationNotes.trim())      form.append('location_notes', locationNotes);
    if (imageFile)                 form.append('image_file', imageFile);
    if (imagePrompt.trim())        form.append('image_prompt', imagePrompt);
    if (serviceChargePsf !== '')   form.append('service_charge_psf', serviceChargePsf);
    if (agentInstruction.trim())   form.append('agent_instruction', agentInstruction);
    if (user)                      form.append('agent_id', user.id);

    try {
      const res = await fetch('https://api.evaintelligencehub.online/market-reports/generate', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Generation failed');
      setSuccessResult(json);
      fetchHistory();
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate report');
    }
    setGenerating(false);
  };

  // ── Delete ────────────────────────────────────────────────────
  const deleteReport = async (id: string) => {
    setDeletingId(id);
    const { error } = await supabase.from('market_reports').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete report');
    } else {
      toast.success('Report deleted');
      fetchHistory();
    }
    setDeletingId(null);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <FileBarChart2 className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">Market Reports</h1>
      </div>

      <Tabs defaultValue="generate">
        <TabsList>
          <TabsTrigger value="generate">Generate Report</TabsTrigger>
          <TabsTrigger value="history">Report History</TabsTrigger>
        </TabsList>

        {/* ── Generate Tab ───────────────────────────────────────── */}
        <TabsContent value="generate" className="mt-4">
          <Card>
            <CardHeader><CardTitle>New Market Report</CardTitle></CardHeader>
            <CardContent className="space-y-5">

              {/* Report Type toggle */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Report Type</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={reportType === 'single' ? 'default' : 'outline'}
                    onClick={() => { setReportType('single'); setCommunities(prev => [prev[0] || '']); }}
                  >
                    Single Community
                  </Button>
                  <Button
                    type="button"
                    variant={reportType === 'multi' ? 'default' : 'outline'}
                    onClick={() => setReportType('multi')}
                  >
                    Multi-Area Comparison
                  </Button>
                </div>
              </div>

              {/* Community Name(s) */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {reportType === 'multi' ? 'Community Names (up to 4)' : 'Community Name'}
                </label>
                <div className="space-y-2">
                  {communities.map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={c}
                        onChange={e => updateCommunity(i, e.target.value)}
                        placeholder={reportType === 'multi' ? `Community ${i + 1}` : 'e.g. Mudon Al Ranim'}
                      />
                      {reportType === 'multi' && communities.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeCommunity(i)}>
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {reportType === 'multi' && communities.length < 4 && (
                    <Button type="button" variant="outline" size="sm" onClick={addCommunity}>
                      <Plus className="w-4 h-4 mr-1" /> Add Community
                    </Button>
                  )}
                </div>
              </div>

              {/* Report Period */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Report Period</label>
                <Input
                  value={reportPeriod}
                  onChange={e => setReportPeriod(e.target.value)}
                  placeholder="e.g. Q1 2025"
                />
              </div>

              {/* Agent Name */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Agent Name</label>
                <Input value={agentName} onChange={e => setAgentName(e.target.value)} />
              </div>

              {/* Agent Contact */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Agent Contact</label>
                <Input value={agentContact} onChange={e => setAgentContact(e.target.value)} placeholder="Email or phone number" />
              </div>

              {/* Service Charge */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Service Charge (AED/sqft/year) — optional</label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={serviceChargePsf}
                  onChange={e => setServiceChargePsf(e.target.value)}
                  placeholder="e.g. 18"
                />
                <p className="text-xs text-muted-foreground">
                  Enter the community's annual service charge per sqft. Used to calculate net yield in the report.
                </p>
              </div>

              {/* CSV Upload */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Property Monitor CSV Export</label>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={e => setCsvFile(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground">
                  Export your data from Property Monitor and upload here. The report will be generated from this data.
                </p>
              </div>

              {/* Location Notes */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Agent Observations (optional)</label>
                <Textarea
                  value={locationNotes}
                  onChange={e => setLocationNotes(e.target.value)}
                  placeholder="e.g. Park-facing units in Phase 3 consistently achieve the strongest prices..."
                  rows={3}
                />
              </div>

              {/* Agent Instruction */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Additional instructions for Gemini (optional)</label>
                <Textarea
                  value={agentInstruction}
                  onChange={e => setAgentInstruction(e.target.value)}
                  placeholder="e.g. Mention that Phase 3 is the only phase with direct park access. Highlight that corner units here sell faster than anywhere else in the community."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Tell Gemini anything specific you want included or emphasised in the report narrative.
                </p>
              </div>

              {/* Image Upload */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Optional: Add an image to personalise the report</label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={e => { setImageFile(e.target.files?.[0] || null); if (!e.target.files?.[0]) setImagePrompt(''); }}
                />
              </div>

              {/* Image Prompt — only shown if image uploaded */}
              {imageFile && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tell Gemini how to use this image</label>
                  <Textarea
                    value={imagePrompt}
                    onChange={e => setImagePrompt(e.target.value)}
                    placeholder="e.g. Place this image on the cover page as a hero shot of the community"
                    rows={2}
                  />
                </div>
              )}

              {/* Submit */}
              <div className="space-y-3 pt-1">
                <Button onClick={handleGenerate} disabled={generating} className="w-full sm:w-auto">
                  {generating
                    ? <><Loader2 className="animate-spin w-4 h-4 mr-2" /> Generating...</>
                    : <><FileBarChart2 className="w-4 h-4 mr-2" /> Generate Report</>}
                </Button>
                {generating && (
                  <p className="text-sm text-muted-foreground animate-pulse">
                    Generating your report — this takes 20–30 seconds...
                  </p>
                )}
              </div>

              {/* Success card */}
              {successResult && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
                  <p className="font-semibold text-green-800">Report ready!</p>
                  <p className="text-sm text-green-700">
                    Report available for 30 days
                    {successResult.expires_at ? ` (expires ${toUAETime(successResult.expires_at)})` : ''}.
                  </p>
                  <Button asChild size="sm" className="bg-green-700 hover:bg-green-800 text-white">
                    <a href={successResult.report_url} target="_blank" rel="noopener noreferrer">
                      <Download className="w-4 h-4 mr-2" /> Download Report
                    </a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History Tab ────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Report History</CardTitle></CardHeader>
            <CardContent>
              {histLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="animate-spin w-6 h-6 text-primary" />
                </div>
              ) : reports.length === 0 ? (
                <p className="text-muted-foreground text-sm">No reports generated yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Community</TableHead>
                      <TableHead>Report Type</TableHead>
                      <TableHead>Agent</TableHead>
                      <TableHead>Generated</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {reports.map(r => {
                        const days = r.expires_at ? daysUntil(r.expires_at) : null;
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.community_name || '—'}</TableCell>
                            <TableCell>
                              {r.report_type === 'multi'
                                ? <Badge className="bg-amber-500 text-white">Comparison</Badge>
                                : <Badge className="bg-green-600 text-white">Single</Badge>}
                            </TableCell>
                            <TableCell>{r.agent_name || '—'}</TableCell>
                            <TableCell className="text-sm">{r.created_at ? toUAETime(r.created_at) : '—'}</TableCell>
                            <TableCell className="text-sm">
                              {days === null ? '—' : (
                                <span className={days <= 3 ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                                  {days <= 0 ? 'Expired' : `Expires in ${days} day${days === 1 ? '' : 's'}`}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {r.report_url && (
                                  <Button size="sm" variant="outline" asChild>
                                    <a href={r.report_url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="w-3 h-3 mr-1" /> Download
                                    </a>
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={deletingId === r.id}
                                  onClick={() => deleteReport(r.id)}
                                >
                                  {deletingId === r.id
                                    ? <Loader2 className="animate-spin w-3 h-3" />
                                    : <><Trash2 className="w-3 h-3 mr-1" /> Delete</>}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MarketReports;
