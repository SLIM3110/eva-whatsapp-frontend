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
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { toUAETime } from '@/lib/uaeTime';
import { Upload, Loader2, Eye, ArrowLeft, X, RefreshCw } from 'lucide-react';

// ── Phone number utilities ────────────────────────────────────────────────────

const looksLikePhone = (val: string): boolean => {
  if (!val) return false;
  let str = String(val).trim();
  if (/^[\d.]+[eE][+\-]?\d+$/.test(str)) {
    try { str = String(Math.round(Number(str))); } catch { return false; }
  }
  const cleaned = str.replace(/[\s\-\(\)\.\+\/\|]/g, '');
  const digits = cleaned.startsWith('00') ? cleaned.slice(2) : cleaned;
  return /^\d{8,15}$/.test(digits);
};

const isPhoneColumn = (header: string, sampleValues: string[]): boolean => {
  const norm = header.toLowerCase().replace(/[\s_\-]/g, '');
  const keywords = ['mobile','phone','number','tel','contact','whatsapp','cell','mob','fax','num'];
  if (keywords.some(kw => norm.includes(kw))) return true;
  // Fall back to content analysis — if 60%+ of non-empty values look like phone numbers
  const nonEmpty = sampleValues.filter(v => v?.trim());
  if (nonEmpty.length === 0) return false;
  return nonEmpty.filter(looksLikePhone).length / nonEmpty.length >= 0.6;
};

const cleanPhone = (raw: string): string | null => {
  if (!raw) return null;
  let str = String(raw).trim();
  // Handle Excel scientific notation e.g. 9.71504046276E+11
  if (/^[\d.]+[eE][+\-]?\d+$/.test(str)) {
    try { str = String(Math.round(Number(str))); } catch { return null; }
  }
  let num = str.replace(/[\s\-\(\)\.\+\/\|]/g, '');
  if (num.startsWith('00')) num = num.slice(2);
  if (!/^\d+$/.test(num)) return null;
  // UAE-specific normalisation
  if (num.startsWith('00971')) num = '971' + num.slice(5);
  // Strip stray leading zero after country code: 9710504576568 → 971504576568
  else if (/^9710\d{9}$/.test(num)) num = '971' + num.slice(4);
  else if (num.startsWith('0') && num.length === 10) num = '971' + num.slice(1);
  else if (/^[5-9]\d{8}$/.test(num)) num = '971' + num;
  // International E.164: 8–15 digits
  if (num.length < 8 || num.length > 15) return null;
  return num;
};

// ── Types ─────────────────────────────────────────────────────────────────────

type ParsedRow = { owner_name: string; building_name: string; unit_number: string; phone: string };
type ColumnMapping = {
  phoneColumns: string[];
  nameColumn: string | null;
  buildingColumn: string | null;
};

// ── File parser ───────────────────────────────────────────────────────────────

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
  const phoneColIndexes = rawHeaders.map((h, i) => {
    const sampleValues = data.slice(0, 30).map(row => String(row[rawHeaders[i]] ?? ''));
    return isPhoneColumn(h, sampleValues) ? i : -1;
  }).filter(i => i >= 0);

  if (phoneColIndexes.length === 0) {
    throw new Error(
      'No phone number columns detected. Your file must have at least one column with mobile, phone, or number in the header.'
    );
  }

  // Prioritise explicit "owner" columns before falling back to any "name" column
  const nameColIdx = (() => {
    const ownerIdx = headers.findIndex(h => h.includes('owner'));
    if (ownerIdx >= 0) return ownerIdx;
    return headers.findIndex(h => h.includes('name') && !h.includes('building') && !h.includes('project') && !h.includes('tower'));
  })();
  const buildingColIdx = headers.findIndex(h => h.includes('building') || h.includes('tower') || h.includes('property'));
  const unitColIdx     = headers.findIndex(h => h.includes('unit') || h.includes('apartment') || h.includes('flat'));

  const mapping: ColumnMapping = {
    phoneColumns:   phoneColIndexes.map(i => rawHeaders[i]),
    nameColumn:     nameColIdx >= 0     ? rawHeaders[nameColIdx]     : null,
    buildingColumn: buildingColIdx >= 0 ? rawHeaders[buildingColIdx] : null,
  };

  const contacts: ParsedRow[] = [];
  for (const row of data) {
    const vals      = rawHeaders.map(h => (row[h] || '').trim());
    const ownerName    = nameColIdx >= 0     ? (vals[nameColIdx]     || 'Unknown') : 'Unknown';
    const buildingName = buildingColIdx >= 0 ? (vals[buildingColIdx] || '')        : '';
    const unitNumber   = unitColIdx >= 0     ? (vals[unitColIdx]     || '')        : '';

    for (const idx of phoneColIndexes) {
      const cleaned = cleanPhone(vals[idx] || '');
      if (cleaned) {
        contacts.push({ owner_name: ownerName, building_name: buildingName, unit_number: unitNumber, phone: cleaned });
      }
    }
  }

  return { rows: contacts, mapping };
};

// ── Gemini personalisation ────────────────────────────────────────────────────

const personaliseWithGemini = async (message: string, geminiKey: string): Promise<string> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are personalising a WhatsApp message for a real estate agent. Your job is to make the message feel slightly different for each recipient so it does not look like a mass blast — vary the sentence structure, swap synonyms, reorder a phrase or two, change the greeting style. Keep the full meaning, all facts, and all key points completely intact. Do NOT shorten, summarise, or cut any part of the message. The output must be approximately the same length as the input. Keep all placeholders exactly as they are including the curly braces. Return only the message text with no explanation or commentary. Message: ${message}`,
            }],
          }],
        }),
      }
    );
    clearTimeout(timeoutId);
    if (!res.ok) return message;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || message;
  } catch {
    return message;
  }
};

const personaliseAllWithGemini = async (
  messages: string[],
  geminiKey: string,
  onProgress: (done: number, total: number) => void
): Promise<string[]> => {
  const CONCURRENCY = 8;
  const results: string[] = new Array(messages.length);
  for (let start = 0; start < messages.length; start += CONCURRENCY) {
    const chunk = messages.slice(start, start + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(msg => personaliseWithGemini(msg, geminiKey)));
    chunkResults.forEach((r, i) => { results[start + i] = r; });
    onProgress(Math.min(start + CONCURRENCY, messages.length), messages.length);
  }
  return results;
};

// ── Batch status helper ───────────────────────────────────────────────────────

const getBatchStatus = (b: any): 'Active' | 'Completed' | 'Cancelled' => {
  if (b.pending_count === 0 && b.sent_count === 0) return 'Cancelled';
  if (b.sent_count >= b.total_contacts && b.total_contacts > 0) return 'Completed';
  if (b.pending_count > 0) return 'Active';
  return 'Completed';
};

const statusBadgeClass: Record<string, string> = {
  Active:    'bg-green-600 text-white',
  Completed: 'bg-blue-600 text-white',
  Cancelled: 'bg-gray-500 text-white',
};

// ── Component ─────────────────────────────────────────────────────────────────

const UnitCollector = () => {
  const { user, profile } = useAuth();

  // Upload form
  const [batchName, setBatchName]           = useState('');
  const [file, setFile]                     = useState<File | null>(null);
  const [fileMapping, setFileMapping]       = useState<ColumnMapping | null>(null);
  const [fileMappingPreview, setFileMappingPreview] = useState(false);
  const [templates, setTemplates]           = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [agents, setAgents]                 = useState<any[]>([]);
  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [parsedRows, setParsedRows]         = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError]         = useState<string | null>(null);

  // Batches
  const [batches, setBatches]               = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [cancelBatchId, setCancelBatchId]   = useState<string | null>(null);
  const [cancellingBatch, setCancellingBatch] = useState(false);

  // Contact detail view
  const [viewingBatch, setViewingBatch]     = useState<string | null>(null);
  const [contacts, setContacts]             = useState<any[]>([]);
  const [filterStatus, setFilterStatus]     = useState('');
  const [filterAgent, setFilterAgent]       = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Message preview / edit modal
  const [previewContact, setPreviewContact] = useState<any>(null);
  const [previewMessage, setPreviewMessage] = useState('');
  const [savingPreview, setSavingPreview]   = useState(false);

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  // ── Fetch ─────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [templatesRes, batchesRes, allProfilesRes] = await Promise.all([
      isAdmin
        ? supabase.from('message_templates').select('*')
        : supabase.from('message_templates').select('*').eq('created_by', user.id),
      isAdmin
        ? supabase.from('batches').select('*').order('upload_date', { ascending: false })
        : supabase.from('batches').select('*').eq('uploaded_by', user.id).order('upload_date', { ascending: false }),
      isAdmin
        ? supabase.from('profiles').select('id, first_name, last_name, role')
        : supabase.from('profiles').select('id, first_name, last_name, role').eq('id', user.id),
    ]);

    setTemplates(templatesRes.data || []);
    const allProfiles = allProfilesRes.data || [];
    setAgents(allProfiles.filter((p: any) => p.role === 'agent'));
    const profileMap = Object.fromEntries(allProfiles.map((p: any) => [p.id, p]));

    const rawBatches = batchesRes.data || [];
    const batchIds   = rawBatches.map((b: any) => b.id);

    let failedCounts: Record<string, number>    = {};
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

    const mapped = rawBatches.map((b: any) => ({
      ...b,
      uploader:       profileMap[b.uploaded_by] || null,
      failedCount:    failedCounts[b.id]    || 0,
      cancelledCount: cancelledCounts[b.id] || 0,
    }));

    // Hide fully-cancelled batches (pending=0, sent=0)
    setBatches(mapped.filter((b: any) => b.pending_count > 0 || b.sent_count > 0));

    const defaultTpl = templatesRes.data?.find((t: any) => t.is_default);
    if (defaultTpl) setSelectedTemplate(defaultTpl.id);
    setLoading(false);
  }, [isAdmin, user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── File handling ─────────────────────────────────────────────

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

  // ── Template substitution ─────────────────────────────────────

  const substituteTemplate = (template: string, row: ParsedRow, agentName: string): string =>
    template
      .replace(/\{\{owner_name\}\}/g,       row.owner_name    || '')
      .replace(/\{\{building_name\}\}/g,    row.building_name || '')
      .replace(/\{\{unit_number\}\}/g,      row.unit_number   || '')
      .replace(/\{\{agent_first_name\}\}/g, agentName);

  // ── Upload ────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!batchName || !file || !selectedTemplate) { toast.error('Please fill all required fields'); return; }
    if (parseError) { toast.error('Fix file issues before uploading'); return; }

    setUploading(true);
    setUploadProgress('');
    try {
      let rows = parsedRows;
      if (!rows) {
        const { rows: r } = await parseFileToRows(file);
        rows = r;
      }
      if (!rows || rows.length === 0) { toast.error('File is empty or has no valid phone numbers'); setUploading(false); return; }

      // Deduplicate by phone — keep first occurrence
      const seen = new Set<string>();
      const deduped = rows.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });
      const dupeCount = rows.length - deduped.length;
      if (dupeCount > 0) toast.info(`Removed ${dupeCount} duplicate phone number${dupeCount > 1 ? 's' : ''} — each number will only receive one message.`);
      rows = deduped;

      const template = templates.find(t => t.id === selectedTemplate);
      if (!template) { toast.error('Template not found'); setUploading(false); return; }

      // Fetch Gemini key
      const { data: settings } = await supabase.from('api_settings').select('gemini_api_key').eq('id', 1).single();
      const geminiKey = settings?.gemini_api_key || '';

      // Create batch record
      const { data: batch, error: batchError } = await supabase.from('batches').insert({
        batch_name:      batchName,
        uploaded_by:     user!.id,
        total_contacts:  rows.length,
        pending_count:   rows.length,
      }).select().single();
      if (batchError) throw batchError;

      const agentName = profile?.first_name || '';
      const baseMsgs = rows.map(r => substituteTemplate(template.body, r, agentName));

      let finalMsgs: string[];
      if (geminiKey) {
        setUploadProgress(`Generating personalised messages (0 of ${rows.length})...`);
        finalMsgs = await personaliseAllWithGemini(
          baseMsgs,
          geminiKey,
          (done, total) => setUploadProgress(`Generating personalised messages (${done} of ${total})...`)
        );
      } else {
        finalMsgs = baseMsgs;
      }

      const contactInserts: any[] = rows.map((r, i) => ({
        uploaded_batch_id: batch.id,
        owner_name:        r.owner_name,
        building_name:     r.building_name || batchName,
        unit_number:       r.unit_number   || '',
        number_1:          r.phone,
        number_2:          '',
        assigned_agent:    user!.id,
        generated_message: finalMsgs[i],
      }));

      setUploadProgress('Saving contacts...');
      const { error: insertError } = await supabase.from('owner_contacts').insert(contactInserts);
      if (insertError) throw insertError;

      toast.success(`${contactInserts.length} contacts added`);
      setBatchName('');
      setFile(null);
      setFileMapping(null);
      setFileMappingPreview(false);
      setParsedRows(null);
      setUploadProgress('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
      setUploadProgress('');
    }
    setUploading(false);
  };

  // ── Contact detail ────────────────────────────────────────────

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

  // ── Batch cancel ──────────────────────────────────────────────

  const cancelBatch = async (batchId: string) => {
    setCancellingBatch(true);
    try {
      const { error } = await supabase
        .from('owner_contacts')
        .update({ message_status: 'cancelled' })
        .eq('uploaded_batch_id', batchId)
        .eq('message_status', 'pending');
      if (error) throw error;
      await supabase.from('batches').update({ pending_count: 0 }).eq('id', batchId);
      // Remove immediately from UI — do not call fetchData
      setBatches(prev => prev.filter(b => b.id !== batchId));
      setCancelBatchId(null);
      toast.success('Batch cancelled');
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel batch');
    }
    setCancellingBatch(false);
  };

  // ── Contact actions ───────────────────────────────────────────

  const cancelContact = async (id: string) => {
    const contact = contacts.find(c => c.id === id);
    const { error } = await supabase.from('owner_contacts').update({ message_status: 'cancelled' }).eq('id', id);
    if (error) { toast.error('Failed to cancel'); return; }
    if (contact?.uploaded_batch_id) {
      const remaining = contacts.filter(c => c.id !== id && c.message_status === 'pending').length;
      await supabase.from('batches').update({ pending_count: remaining }).eq('id', contact.uploaded_batch_id);
    }
    setContacts(prev => prev.map(c => c.id === id ? { ...c, message_status: 'cancelled' } : c));
    toast.success('Contact cancelled');
  };

  const retryContact = async (id: string) => {
    const { error } = await supabase.from('owner_contacts').update({ message_status: 'pending' }).eq('id', id);
    if (error) { toast.error('Failed to retry'); return; }
    setContacts(prev => prev.map(c => c.id === id ? { ...c, message_status: 'pending' } : c));
    toast.success('Contact reset to pending');
  };

  // ── Message preview / edit ────────────────────────────────────

  const openPreview = (c: any) => {
    setPreviewContact(c);
    setPreviewMessage(c.generated_message || '');
  };

  const savePreview = async () => {
    if (!previewContact) return;
    setSavingPreview(true);
    const { error } = await supabase
      .from('owner_contacts')
      .update({ generated_message: previewMessage })
      .eq('id', previewContact.id);
    if (error) {
      toast.error('Failed to save message');
    } else {
      setContacts(prev => prev.map(c =>
        c.id === previewContact.id ? { ...c, generated_message: previewMessage } : c
      ));
      toast.success('Message updated');
      setPreviewContact(null);
    }
    setSavingPreview(false);
  };

  // ── Helpers ───────────────────────────────────────────────────

  const filteredContacts = contacts.filter(c => {
    if (filterStatus && filterStatus !== 'all' && c.message_status !== filterStatus) return false;
    if (filterAgent && filterAgent !== 'all' && c.assigned_agent !== filterAgent) return false;
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':      return <Badge className="bg-green-600 text-white">Sent</Badge>;
      case 'failed':    return <Badge variant="destructive">Failed</Badge>;
      case 'cancelled': return <Badge className="bg-gray-500 text-white">Cancelled</Badge>;
      default:          return <Badge variant="secondary">Pending</Badge>;
    }
  };

  // ── Render guard ──────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin w-8 h-8 text-primary" />
    </div>
  );

  // ── Contact detail view ───────────────────────────────────────

  if (viewingBatch) {
    const batch = batches.find(b => b.id === viewingBatch);
    const isPendingOrEditable = (c: any) => c.message_status === 'pending';

    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => { setViewingBatch(null); setFilterStatus(''); setFilterAgent(''); }}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Batches
        </Button>

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
            ) : filteredContacts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No contacts match the current filter.</p>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Owner</TableHead>
                  <TableHead>Building</TableHead>
                  <TableHead>Number</TableHead>
                  {isAdmin && <TableHead>Agent</TableHead>}
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent At</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredContacts.map(c => (
                    <TableRow
                      key={c.id}
                      className={`cursor-pointer hover:bg-muted/50 ${isPendingOrEditable(c) || c.message_status === 'sent' ? '' : 'opacity-60'}`}
                      onClick={() => openPreview(c)}
                    >
                      <TableCell>{c.owner_name}</TableCell>
                      <TableCell>{c.building_name}</TableCell>
                      <TableCell className="font-mono text-sm">{c.number_1}</TableCell>
                      {isAdmin && <TableCell>{c.agent_profile ? `${c.agent_profile.first_name} ${c.agent_profile.last_name}` : ''}</TableCell>}
                      <TableCell className="max-w-[180px] text-sm text-muted-foreground truncate">
                        {c.generated_message?.slice(0, 60)}{(c.generated_message?.length || 0) > 60 ? '…' : ''}
                      </TableCell>
                      <TableCell>{getStatusBadge(c.message_status)}</TableCell>
                      <TableCell className="text-sm">{c.sent_at ? toUAETime(c.sent_at) : ''}</TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
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

        {/* Message Preview / Edit Modal */}
        <Dialog open={!!previewContact} onOpenChange={(open) => { if (!open) setPreviewContact(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {previewContact?.message_status === 'sent'
                  ? 'Sent Message'
                  : 'Preview and Edit Message'}
              </DialogTitle>
            </DialogHeader>

            {previewContact && (
              <div className="space-y-4">
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">Owner:</span> {previewContact.owner_name}</p>
                  <p><span className="font-medium">Number:</span> <span className="font-mono">{previewContact.number_1}</span></p>
                  {previewContact.message_status === 'sent' && previewContact.sent_at && (
                    <p><span className="font-medium">Sent at:</span> {toUAETime(previewContact.sent_at)}</p>
                  )}
                </div>

                <div>
                  <Textarea
                    value={previewMessage}
                    onChange={e => setPreviewMessage(e.target.value)}
                    rows={7}
                    readOnly={previewContact.message_status !== 'pending'}
                    className={previewContact.message_status !== 'pending' ? 'bg-muted resize-none' : ''}
                  />
                  {previewContact.message_status === 'pending' && (
                    <p className="text-xs text-muted-foreground mt-1 text-right">
                      {previewMessage.length} characters
                    </p>
                  )}
                </div>

                {previewContact.message_status === 'pending' && (
                  <p className="text-xs text-muted-foreground">
                    This message will be sent exactly as shown above.
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPreviewContact(null)}>Close</Button>
              {previewContact?.message_status === 'pending' && (
                <Button onClick={savePreview} disabled={savingPreview}>
                  {savingPreview ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : null}
                  Save Changes
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Main batches view ─────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* Upload Form */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> Upload New Batch</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Batch Name</label>
            <Input value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="Enter batch name" className="mt-1" />
          </div>

          <div>
            <label className="text-sm font-medium">File (CSV or Excel)</label>
            <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">
              Accepts .csv and .xlsx. Must have at least one column with mobile, phone, or number in the header.
              UAE local formats (05xxxxxxxx) and international numbers with country code (+44, +1, +966, etc.) are all supported.
              Multiple phone columns are supported — each valid number creates a separate contact.
            </p>
          </div>

          {/* Column mapping preview */}
          {fileMapping && fileMappingPreview && !parseError && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm space-y-1">
              <p className="font-semibold text-blue-800">Detected column mapping:</p>
              <p className="text-blue-700">
                Found <span className="font-semibold">{fileMapping.phoneColumns.length}</span> phone column{fileMapping.phoneColumns.length > 1 ? 's' : ''}:{' '}
                <span className="font-mono">{fileMapping.phoneColumns.join(', ')}</span>
                {fileMapping.phoneColumns.length > 1 && (
                  <span> — will create up to {fileMapping.phoneColumns.length} contacts per row</span>
                )}
              </p>
              <p className="text-blue-700">Name column: <span className="font-mono">{fileMapping.nameColumn || 'none detected'}</span></p>
              <p className="text-blue-700">Building column: <span className="font-mono">{fileMapping.buildingColumn || 'none detected'}</span></p>
              {parsedRows && <p className="text-blue-700">Valid contacts found: <span className="font-semibold">{parsedRows.length}</span></p>}
            </div>
          )}

          {parseError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{parseError}</div>
          )}

          <div>
            <label className="text-sm font-medium">Template</label>
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.template_name}{t.is_default ? ' (Default)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Button onClick={handleUpload} disabled={uploading || !!parseError} className="w-full sm:w-auto">
              {uploading ? <Loader2 className="animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload and Generate Messages
            </Button>
            {uploadProgress && (
              <p className="text-sm text-muted-foreground animate-pulse">{uploadProgress}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Batches */}
      <Card>
        <CardHeader><CardTitle>{isAdmin ? 'Active Batches' : 'Your Batches'}</CardTitle></CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active batches</p>
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
                    const status = getBatchStatus(b);
                    const pct    = b.total_contacts > 0 ? (b.sent_count / b.total_contacts) * 100 : 0;
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
                          <Badge className={statusBadgeClass[status]}>{status}</Badge>
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
