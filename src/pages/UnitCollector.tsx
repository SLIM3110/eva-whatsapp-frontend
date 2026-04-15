import { useState, useCallback, useEffect } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { toUAETime } from '@/lib/uaeTime';
import { Upload, Loader2, Eye, ArrowLeft, X, RefreshCw } from 'lucide-react';

const PHONE_KEYWORDS = ['mobile', 'phone', 'number', 'tel', 'contact', 'whatsapp', 'cell', 'mob'];
const PHONE_EXACT_NORMALIZED = ['mobile1','mobile2','mobile3','mobile_1','mobile_2','mobile_3','mobile1','mobile2','mobile3'];

const isPhoneColumn = (header: string) => {
  const h = header.toLowerCase().replace(/[\s_]/g, '');
  if (PHONE_EXACT_NORMALIZED.includes(h)) return true;
  return PHONE_KEYWORDS.some(kw => header.toLowerCase().includes(kw));
};

const cleanPhone = (raw: string): string | null => {
  if (!raw) return null;
  let num = String(raw).replace(/[\s\-\(\)\+]/g, '');
  if (!/^\d+$/.test(num)) return null;
  if (num.startsWith('0')) num = '971' + num.slice(1);
  if (num.startsWith('5') && num.length === 9) num = '971' + num;
  return num.length >= 10 ? num : null;
};

type ParsedRow = { owner_name: string; building_name: string; unit_number: string; phone: string };
type ColumnMapping = { phoneColumns: string[]; nameColumn: string | null; buildingColumn: string | null };

const parseFileToRows = async (file: File): Promise<{ rows: ParsedRow[]; mapping: ColumnMapping }> => {
  const ext = file.name.split('.').pop()?.toLowerCase();

  let rawHeaders: string[] = [];
  let data: Record<string, string>[] = [];

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (jsonData.length === 0) throw new Error('Excel file is empty');
    rawHeaders = Object.keys(jsonData[0]).map(h => String(h).trim());
    data = jsonData.map(row =>
      Object.fromEntries(rawHeaders.map(h => [h, String(row[h] ?? '').trim()]))
    );
  } else {
    // CSV
    const text = await file.text();
    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
    });
    if (result.errors.length > 0) throw new Error(`CSV parse error: ${result.errors[0].message}`);
    rawHeaders = result.meta.fields || [];
    data = result.data;
  }

  const headers = rawHeaders.map(h => h.toLowerCase());

  const phoneColIndexes = rawHeaders.map((h, i) => isPhoneColumn(h) ? i : -1).filter(i => i >= 0);
  if (phoneColIndexes.length === 0) {
    throw new Error(
      'No phone number columns detected. Your file must have at least one column with mobile, phone, or number in the header.'
    );
  }

  const nameColIdx = headers.findIndex(h => h.includes('name') || h.includes('owner'));
  const buildingColIdx = headers.findIndex(h => h.includes('building') || h.includes('tower') || h.includes('property'));
  const unitColIdx = headers.findIndex(h => h.includes('unit') || h.includes('apartment') || h.includes('flat'));

  const mapping: ColumnMapping = {
    phoneColumns: phoneColIndexes.map(i => rawHeaders[i]),
    nameColumn: nameColIdx >= 0 ? rawHeaders[nameColIdx] : null,
    buildingColumn: buildingColIdx >= 0 ? rawHeaders[buildingColIdx] : null,
  };

  const contacts: ParsedRow[] = [];
  for (const row of data) {
    const vals = rawHeaders.map(h => (row[h] || '').trim());
    const ownerName = nameColIdx >= 0 ? (vals[nameColIdx] || 'Unknown') : 'Unknown';
    const buildingName = buildingColIdx >= 0 ? (vals[buildingColIdx] || '') : '';
    const unitNumber = unitColIdx >= 0 ? (vals[unitColIdx] || '') : '';

    for (const idx of phoneColIndexes) {
      const cleaned = cleanPhone(vals[idx] || '');
      if (cleaned) {
        contacts.push({ owner_name: ownerName, building_name: buildingName, unit_number: unitNumber, phone: cleaned });
      }
    }
  }

  return { rows: contacts, mapping };
};

const getBatchStatus = (b: any): { label: string; variant: string } => {
  if (b.cancelledCount > 0 && b.pending_count === 0 && b.sent_count === 0) return { label: 'Cancelled', variant: 'secondary' };
  if (b.sent_count >= b.total_contacts && b.total_contacts > 0) return { label: 'Completed', variant: 'default' };
  if (b.pending_count > 0) return { label: 'Active', variant: 'default' };
  return { label: 'Completed', variant: 'default' };
};

const UnitCollector = () => {
  const { user, profile } = useAuth();
  const [batchName, setBatchName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileMapping, setFileMapping] = useState<ColumnMapping | null>(null);
  const [fileMappingPreview, setFileMappingPreview] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);
  const [viewingBatch, setViewingBatch] = useState<string | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const [cancelBatchId, setCancelBatchId] = useState<string | null>(null);
  const [cancellingBatch, setCancellingBatch] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  const fetchData = useCallback(async () => {
    if (!user) return;
    const promises: any[] = [
      supabase.from('message_templates').select('*'),
      isAdmin
        ? supabase.from('batches').select('*').order('upload_date', { ascending: false })
        : supabase.from('batches').select('*').eq('uploaded_by', user.id).order('upload_date', { ascending: false }),
      supabase.from('profiles').select('id, first_name, last_name, role'),
    ];

    const [templatesRes, batchesRes, allProfilesRes] = await Promise.all(promises);
    setTemplates(templatesRes.data || []);
    const allProfiles = allProfilesRes.data || [];
    setAgents(allProfiles.filter((p: any) => p.role === 'agent'));
    const profileMap = Object.fromEntries(allProfiles.map((p: any) => [p.id, p]));

    const rawBatches = batchesRes.data || [];

    // Fetch failed + cancelled counts per batch
    const batchIds = rawBatches.map((b: any) => b.id);
    let failedCounts: Record<string, number> = {};
    let cancelledCounts: Record<string, number> = {};

    if (batchIds.length > 0) {
      const [failedRes, cancelledRes] = await Promise.all([
        supabase.from('owner_contacts').select('uploaded_batch_id').in('uploaded_batch_id', batchIds).eq('message_status', 'failed'),
        supabase.from('owner_contacts').select('uploaded_batch_id').in('uploaded_batch_id', batchIds).eq('message_status', 'cancelled'),
      ]);
      (failedRes.data || []).forEach((r: any) => {
        failedCounts[r.uploaded_batch_id] = (failedCounts[r.uploaded_batch_id] || 0) + 1;
      });
      (cancelledRes.data || []).forEach((r: any) => {
        cancelledCounts[r.uploaded_batch_id] = (cancelledCounts[r.uploaded_batch_id] || 0) + 1;
      });
    }

    setBatches(rawBatches.map((b: any) => ({
      ...b,
      uploader: profileMap[b.uploaded_by] || null,
      failedCount: failedCounts[b.id] || 0,
      cancelledCount: cancelledCounts[b.id] || 0,
    })));

    const defaultTpl = templatesRes.data?.find((t: any) => t.is_default);
    if (defaultTpl) setSelectedTemplate(defaultTpl.id);
    setLoading(false);
  }, [isAdmin, user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setFileMapping(null);
    setFileMappingPreview(false);
    setParsedRows(null);
    setParseError(null);

    if (!f) return;

    try {
      const { rows, mapping } = await parseFileToRows(f);
      setParsedRows(rows);
      setFileMapping(mapping);
      setFileMappingPreview(true);
    } catch (err: any) {
      setParseError(err.message);
      toast.error(err.message);
    }
  };

  const substituteTemplate = (template: string, row: ParsedRow, agentName: string) => {
    return template
      .replace(/\{\{owner_name\}\}/g, row.owner_name || '')
      .replace(/\{\{building_name\}\}/g, row.building_name || '')
      .replace(/\{\{unit_number\}\}/g, row.unit_number || '')
      .replace(/\{\{agent_first_name\}\}/g, agentName);
  };

  const handleUpload = async () => {
    if (!batchName || !file || !selectedTemplate) {
      toast.error('Please fill all required fields');
      return;
    }
    if (parseError) {
      toast.error('Fix file issues before uploading');
      return;
    }

    setUploading(true);
    try {
      let rows = parsedRows;
      if (!rows) {
        const { rows: r } = await parseFileToRows(file);
        rows = r;
      }
      if (!rows || rows.length === 0) { toast.error('File is empty or has no valid phone numbers'); setUploading(false); return; }

      const template = templates.find(t => t.id === selectedTemplate);
      if (!template) { toast.error('Template not found'); setUploading(false); return; }

      const { data: settings } = await supabase.from('api_settings').select('gemini_api_key').eq('id', 1).single();

      const totalContacts = rows.length;
      const { data: batch, error: batchError } = await supabase.from('batches').insert({
        batch_name: batchName,
        uploaded_by: user!.id,
        total_contacts: totalContacts,
        pending_count: totalContacts,
      }).select().single();
      if (batchError) throw batchError;

      const agentName = profile?.first_name || '';

      // Generate template variations
      const templateVariations: string[] = [template.body];
      const numVariations = Math.min(5, rows.length);
      if (settings?.gemini_api_key && rows.length > 0) {
        for (let v = 1; v < numVariations; v++) {
          try {
            await new Promise(r => setTimeout(r, 4500));
            const geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${settings.gemini_api_key}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: `You are making a very slight variation of a WhatsApp message template to avoid spam detection. Only change 1-2 words maximum — for example swap "Hi" with "Hello", "reaching out" with "getting in touch", etc. Do NOT change any placeholder variables like {{owner_name}} or {{building_name}}. Do NOT change the meaning or structure. Return only the message text.\n\nTemplate: ${template.body}` }] }],
                }),
              }
            );
            const geminiData = await geminiRes.json();
            const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (aiText) templateVariations.push(aiText.trim());
          } catch { /* use existing variations */ }
        }
      }

      const contactInserts: any[] = rows.map((row, i) => ({
        uploaded_batch_id: batch.id,
        owner_name: row.owner_name,
        building_name: row.building_name || batchName,
        unit_number: row.unit_number || '',
        number_1: row.phone,
        number_2: '',
        assigned_agent: user!.id,
        generated_message: substituteTemplate(templateVariations[i % templateVariations.length], row, agentName),
      }));

      const { error: insertError } = await supabase.from('owner_contacts').insert(contactInserts);
      if (insertError) throw insertError;

      toast.success(`${contactInserts.length} contacts added`);
      setBatchName('');
      setFile(null);
      setFileMapping(null);
      setFileMappingPreview(false);
      setParsedRows(null);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    }
    setUploading(false);
  };

  const viewContacts = async (batchId: string) => {
    setViewingBatch(batchId);
    setLoadingContacts(true);
    const [contactsRes, profilesRes] = await Promise.all([
      supabase.from('owner_contacts').select('*').eq('uploaded_batch_id', batchId),
      supabase.from('profiles').select('id, first_name, last_name'),
    ]);
    const profileMap = Object.fromEntries((profilesRes.data || []).map(p => [p.id, p]));
    setContacts((contactsRes.data || []).map(c => ({
      ...c,
      agent_profile: profileMap[c.assigned_agent] || null,
    })));
    setLoadingContacts(false);
  };

  const cancelBatch = async (batchId: string) => {
    setCancellingBatch(true);
    try {
      const { error } = await supabase
        .from('owner_contacts')
        .update({ message_status: 'cancelled' })
        .eq('uploaded_batch_id', batchId)
        .eq('message_status', 'pending');
      if (error) throw error;
      toast.success('Batch cancelled — all pending messages cancelled');
      setCancelBatchId(null);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel batch');
    }
    setCancellingBatch(false);
  };

  const cancelContact = async (id: string) => {
    const { error } = await supabase.from('owner_contacts').update({ message_status: 'cancelled' }).eq('id', id);
    if (error) { toast.error('Failed to cancel'); return; }
    setContacts(prev => prev.map(c => c.id === id ? { ...c, message_status: 'cancelled' } : c));
    toast.success('Contact cancelled');
  };

  const retryContact = async (id: string) => {
    const { error } = await supabase.from('owner_contacts').update({ message_status: 'pending' }).eq('id', id);
    if (error) { toast.error('Failed to retry'); return; }
    setContacts(prev => prev.map(c => c.id === id ? { ...c, message_status: 'pending' } : c));
    toast.success('Contact reset to pending');
  };

  const filteredContacts = contacts.filter(c => {
    if (filterStatus && filterStatus !== 'all' && c.message_status !== filterStatus) return false;
    if (filterAgent && filterAgent !== 'all' && c.assigned_agent !== filterAgent) return false;
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent': return <Badge className="bg-green-600 text-white">Sent</Badge>;
      case 'failed': return <Badge variant="destructive">Failed</Badge>;
      case 'cancelled': return <Badge className="bg-gray-500 text-white">Cancelled</Badge>;
      default: return <Badge variant="secondary">Pending</Badge>;
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>;

  if (viewingBatch) {
    const batch = batches.find(b => b.id === viewingBatch);
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setViewingBatch(null)}><ArrowLeft className="w-4 h-4 mr-2" /> Back to Batches</Button>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle>Contacts — {batch?.batch_name}</CardTitle>
            <div className="flex gap-2 flex-wrap">
              {isAdmin && (
                <Select value={filterAgent} onValueChange={setFilterAgent}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Filter agent" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Agents</SelectItem>
                    {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Filter status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loadingContacts ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin w-6 h-6 text-primary" /></div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Owner</TableHead><TableHead>Building</TableHead><TableHead>Number</TableHead>
                  {isAdmin && <TableHead>Agent</TableHead>}
                  <TableHead>Message</TableHead><TableHead>Status</TableHead><TableHead>Sent At</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredContacts.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{c.owner_name}</TableCell>
                      <TableCell>{c.building_name}</TableCell>
                      <TableCell className="font-mono text-sm">{c.number_1}</TableCell>
                      {isAdmin && <TableCell>{c.agent_profile ? `${c.agent_profile.first_name} ${c.agent_profile.last_name}` : ''}</TableCell>}
                      <TableCell className="max-w-[200px]">
                        <button onClick={() => setExpandedMsg(expandedMsg === c.id ? null : c.id)} className="text-left text-sm hover:text-primary">
                          {expandedMsg === c.id ? c.generated_message : (c.generated_message?.slice(0, 60) + (c.generated_message?.length > 60 ? '...' : ''))}
                        </button>
                      </TableCell>
                      <TableCell>{getStatusBadge(c.message_status)}</TableCell>
                      <TableCell className="text-sm">{c.sent_at ? toUAETime(c.sent_at) : ''}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {c.message_status === 'failed' && (
                            <Button size="sm" variant="outline" onClick={() => retryContact(c.id)}>
                              <RefreshCw className="w-3 h-3 mr-1" /> Retry
                            </Button>
                          )}
                          {c.message_status === 'pending' && (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancelContact(c.id)}>
                              <X className="w-3 h-3 mr-1" /> Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Upload Form */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> Upload New Batch</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Batch Name</label>
            <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Enter batch name" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">File (CSV or Excel)</label>
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Accepts .csv and .xlsx files. Must contain at least one column with mobile, phone, or number in the header.
              Multiple phone columns (mobile 1, mobile 2, mobile 3) are supported.
            </p>
          </div>

          {/* Column mapping preview */}
          {fileMapping && fileMappingPreview && !parseError && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm space-y-1">
              <p className="font-semibold text-blue-800">Detected column mapping:</p>
              <p className="text-blue-700">Phone columns: <span className="font-mono">{fileMapping.phoneColumns.join(', ')}</span></p>
              <p className="text-blue-700">Name column: <span className="font-mono">{fileMapping.nameColumn || 'none detected'}</span></p>
              <p className="text-blue-700">Building column: <span className="font-mono">{fileMapping.buildingColumn || 'none detected'}</span></p>
              {parsedRows && <p className="text-blue-700">Valid contacts found: <span className="font-semibold">{parsedRows.length}</span></p>}
            </div>
          )}

          {parseError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {parseError}
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Template</label>
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.template_name}{t.is_default ? ' (Default)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleUpload} disabled={uploading || !!parseError} className="w-full sm:w-auto">
            {uploading ? <Loader2 className="animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload and Generate Messages
          </Button>
        </CardContent>
      </Card>

      {/* Active Batches */}
      <Card>
        <CardHeader><CardTitle>{isAdmin ? 'Active Batches' : 'Your Batches'}</CardTitle></CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No batches uploaded yet</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Batch Name</TableHead>
                  {isAdmin && <TableHead>Uploaded By</TableHead>}
                  <TableHead>Date (UAE)</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Cancelled</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {batches.map(b => {
                    const bStatus = getBatchStatus(b);
                    const pct = b.total_contacts > 0 ? (b.sent_count / b.total_contacts) * 100 : 0;
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.batch_name}</TableCell>
                        {isAdmin && <TableCell>{b.uploader?.first_name} {b.uploader?.last_name}</TableCell>}
                        <TableCell className="text-sm">{toUAETime(b.upload_date)}</TableCell>
                        <TableCell>{b.total_contacts}</TableCell>
                        <TableCell className="text-green-600 font-medium">{b.sent_count}</TableCell>
                        <TableCell>{b.pending_count}</TableCell>
                        <TableCell className="text-destructive">{b.failedCount}</TableCell>
                        <TableCell className="text-muted-foreground">{b.cancelledCount}</TableCell>
                        <TableCell className="w-28">
                          <div className="space-y-1">
                            <Progress value={pct} className="h-2" />
                            <p className="text-xs text-muted-foreground">{Math.round(pct)}%</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            bStatus.label === 'Active' ? 'bg-green-600 text-white' :
                            bStatus.label === 'Cancelled' ? 'bg-gray-500 text-white' :
                            'bg-blue-600 text-white'
                          }>
                            {bStatus.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            <Button variant="ghost" size="sm" onClick={() => viewContacts(b.id)}>
                              <Eye className="w-4 h-4 mr-1" /> View
                            </Button>
                            {b.pending_count > 0 && (
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setCancelBatchId(b.id)}>
                                <X className="w-4 h-4 mr-1" /> Cancel
                              </Button>
                            )}
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

      {/* Cancel Batch Confirmation Modal */}
      <Dialog open={!!cancelBatchId} onOpenChange={() => setCancelBatchId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel Batch?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {cancelBatchId && (() => {
              const b = batches.find(b => b.id === cancelBatchId);
              return `Cancel this batch? ${b?.pending_count || 0} pending messages will not be sent.`;
            })()}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelBatchId(null)}>Keep Batch</Button>
            <Button variant="destructive" onClick={() => cancelBatch(cancelBatchId!)} disabled={cancellingBatch}>
              {cancellingBatch ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : null}
              Yes, Cancel Batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UnitCollector;
