import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Upload,
  Building2,
  FolderOpen,
  MessageSquare,
  Loader2,
  RefreshCw,
  Edit2,
  X,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { Navigate } from 'react-router-dom';

const BACKEND_URL = 'https://api.evaintelligencehub.online';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Developer  { id: string; name: string; website?: string; primary_contact?: string; notes?: string; }
interface Project    { id: string; developer_id: string; name: string; community?: string; location?: string; type?: string; status?: string; handover_date?: string; total_units?: number; }
interface Building   { id: string; project_id: string; developer_id: string; name: string; floors?: number; total_units?: number; }
interface DocRecord  { doc_group_id: string; doc_name: string; doc_type: string; source: string; doc_date?: string; developer_id?: string; project_id?: string; building_id?: string; created_at: string; }
interface GroupSource { id: string; group_jid: string; group_name: string; developer_id?: string; active: boolean; history_ingested: boolean; last_ingested_at?: string; date_added: string; }

const DOC_TYPES = ['brochure','price_list','payment_plan','floor_plan','fact_sheet','market_report','legal','other'];
const DOC_TYPE_LABELS: Record<string,string> = {
  brochure:'Brochure', price_list:'Price List', payment_plan:'Payment Plan',
  floor_plan:'Floor Plan', fact_sheet:'Fact Sheet', market_report:'Market Report',
  legal:'Legal', other:'Other',
};

// ── Main admin page ───────────────────────────────────────────────────────────
const ElviAdmin = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  const [apiKey, setApiKey]         = useState('');
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [projects, setProjects]     = useState<Project[]>([]);
  const [buildings, setBuildings]   = useState<Building[]>([]);
  const [docs, setDocs]             = useState<DocRecord[]>([]);
  const [groups, setGroups]         = useState<GroupSource[]>([]);

  // Loading states
  const [loadingDocs, setLoadingDocs]     = useState(false);
  const [uploadingDoc, setUploadingDoc]   = useState(false);
  const [ingestingId, setIngestingId]     = useState<string | null>(null);

  if (!isAdmin) return <Navigate to="/" replace />;

  // ── Fetch API key once ─────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('api_settings').select('whatsapp_api_key').eq('id', 1).single()
      .then(({ data }) => setApiKey(data?.whatsapp_api_key || ''));
  }, []);

  const apiFetch = useCallback(async (path: string, options?: RequestInit) => {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }, [apiKey]);

  // ── Load all lists ─────────────────────────────────────────────────────────
  const loadDevelopers = useCallback(async () => {
    try { setDevelopers(await apiFetch('/api/elvi/developers')); } catch { /* ignore */ }
  }, [apiFetch]);

  const loadProjects = useCallback(async () => {
    try { setProjects(await apiFetch('/api/elvi/projects')); } catch { /* ignore */ }
  }, [apiFetch]);

  const loadBuildings = useCallback(async () => {
    try { setBuildings(await apiFetch('/api/elvi/buildings')); } catch { /* ignore */ }
  }, [apiFetch]);

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true);
    try { setDocs(await apiFetch('/api/elvi/docs')); } catch { toast.error('Failed to load documents'); }
    finally { setLoadingDocs(false); }
  }, [apiFetch]);

  const loadGroups = useCallback(async () => {
    try { setGroups(await apiFetch('/api/elvi/group-sources')); } catch { /* ignore */ }
  }, [apiFetch]);

  useEffect(() => {
    if (!apiKey) return;
    loadDevelopers();
    loadProjects();
    loadBuildings();
    loadDocs();
    loadGroups();
  }, [apiKey]);

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE TAB
  // ═══════════════════════════════════════════════════════════════════════════

  const [uploadDev, setUploadDev]         = useState('');
  const [uploadProject, setUploadProject] = useState('');
  const [uploadBuilding, setUploadBuilding] = useState('');
  const [uploadDocType, setUploadDocType] = useState('other');
  const [uploadDocName, setUploadDocName] = useState('');
  const [uploadDocDate, setUploadDocDate] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile]   = useState<File | null>(null);

  const availableProjects = projects.filter(p => !uploadDev || p.developer_id === uploadDev);
  const availableBuildings = buildings.filter(b => !uploadProject || b.project_id === uploadProject);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    if (file && !uploadDocName) setUploadDocName(file.name.replace(/\.[^.]+$/, ''));
  };

  const handleUpload = async () => {
    if (!selectedFile || !uploadDev) {
      toast.error('Select a developer and file to upload');
      return;
    }
    setUploadingDoc(true);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('docName', uploadDocName || selectedFile.name);
      form.append('docType', uploadDocType);
      form.append('developerId', uploadDev);
      if (uploadProject)   form.append('projectId', uploadProject);
      if (uploadBuilding)  form.append('buildingId', uploadBuilding);
      if (uploadDocDate)   form.append('docDate', uploadDocDate);

      const res = await fetch(`${BACKEND_URL}/api/elvi/upload`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: form,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const result = await res.json();
      toast.success(`Uploaded "${uploadDocName}" — ${result.chunksInserted} chunks ingested`);

      // Reset
      setSelectedFile(null);
      setUploadDocName('');
      setUploadDocDate('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadDocs();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDoc = async (docGroupId: string, docName: string) => {
    if (!confirm(`Delete all chunks for "${docName}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/elvi/docs/${docGroupId}`, { method: 'DELETE' });
      toast.success(`"${docName}" removed from knowledge base`);
      loadDocs();
    } catch {
      toast.error('Failed to delete document');
    }
  };

  const devName = (id?: string) => developers.find(d => d.id === id)?.name || '—';
  const projName = (id?: string) => projects.find(p => p.id === id)?.name || '—';
  const bldgName = (id?: string) => buildings.find(b => b.id === id)?.name || '—';

  // ═══════════════════════════════════════════════════════════════════════════
  // TAXONOMY TAB — Developers / Projects / Buildings
  // ═══════════════════════════════════════════════════════════════════════════

  // Developer dialog
  const [devDialog, setDevDialog]   = useState(false);
  const [editingDev, setEditingDev] = useState<Developer | null>(null);
  const [devForm, setDevForm]       = useState({ name: '', website: '', primary_contact: '', notes: '' });

  const openDevDialog = (dev?: Developer) => {
    setEditingDev(dev || null);
    setDevForm({ name: dev?.name || '', website: dev?.website || '', primary_contact: dev?.primary_contact || '', notes: dev?.notes || '' });
    setDevDialog(true);
  };

  const saveDeveloper = async () => {
    try {
      if (editingDev) {
        await apiFetch(`/api/elvi/developers/${editingDev.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: devForm.name, website: devForm.website, primaryContact: devForm.primary_contact, notes: devForm.notes }),
        });
        toast.success('Developer updated');
      } else {
        await apiFetch('/api/elvi/developers', {
          method: 'POST',
          body: JSON.stringify({ name: devForm.name, website: devForm.website, primaryContact: devForm.primary_contact, notes: devForm.notes }),
        });
        toast.success('Developer added');
      }
      setDevDialog(false);
      loadDevelopers();
    } catch { toast.error('Failed to save developer'); }
  };

  const deleteDeveloper = async (dev: Developer) => {
    if (!confirm(`Delete "${dev.name}"? All linked projects, buildings, and documents will also be removed.`)) return;
    try {
      await apiFetch(`/api/elvi/developers/${dev.id}`, { method: 'DELETE' });
      toast.success(`"${dev.name}" deleted`);
      loadDevelopers(); loadProjects(); loadBuildings();
    } catch { toast.error('Failed to delete developer'); }
  };

  // Project dialog
  const [projDialog, setProjDialog]   = useState(false);
  const [editingProj, setEditingProj] = useState<Project | null>(null);
  const [projForm, setProjForm]       = useState({ developer_id: '', name: '', community: '', location: '', type: 'residential', status: 'off-plan', handover_date: '', total_units: '' });

  const openProjDialog = (proj?: Project) => {
    setEditingProj(proj || null);
    setProjForm({
      developer_id:  proj?.developer_id  || '',
      name:          proj?.name          || '',
      community:     proj?.community     || '',
      location:      proj?.location      || '',
      type:          proj?.type          || 'residential',
      status:        proj?.status        || 'off-plan',
      handover_date: proj?.handover_date || '',
      total_units:   proj?.total_units?.toString() || '',
    });
    setProjDialog(true);
  };

  const saveProject = async () => {
    try {
      const payload = {
        developerId:  projForm.developer_id,
        name:         projForm.name,
        community:    projForm.community || null,
        location:     projForm.location  || null,
        type:         projForm.type,
        status:       projForm.status,
        handoverDate: projForm.handover_date || null,
        totalUnits:   projForm.total_units ? parseInt(projForm.total_units) : null,
      };
      if (editingProj) {
        await apiFetch(`/api/elvi/projects/${editingProj.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toast.success('Project updated');
      } else {
        await apiFetch('/api/elvi/projects', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Project added');
      }
      setProjDialog(false);
      loadProjects();
    } catch { toast.error('Failed to save project'); }
  };

  const deleteProject = async (proj: Project) => {
    if (!confirm(`Delete "${proj.name}"?`)) return;
    try {
      await apiFetch(`/api/elvi/projects/${proj.id}`, { method: 'DELETE' });
      toast.success(`"${proj.name}" deleted`);
      loadProjects(); loadBuildings();
    } catch { toast.error('Failed to delete project'); }
  };

  // Building dialog
  const [bldgDialog, setBldgDialog]   = useState(false);
  const [editingBldg, setEditingBldg] = useState<Building | null>(null);
  const [bldgForm, setBldgForm]       = useState({ project_id: '', developer_id: '', name: '', floors: '', total_units: '' });

  const openBldgDialog = (b?: Building) => {
    setEditingBldg(b || null);
    setBldgForm({
      project_id:   b?.project_id   || '',
      developer_id: b?.developer_id || '',
      name:         b?.name         || '',
      floors:       b?.floors?.toString() || '',
      total_units:  b?.total_units?.toString() || '',
    });
    setBldgDialog(true);
  };

  const saveBuilding = async () => {
    try {
      const payload = {
        projectId:   bldgForm.project_id,
        developerId: bldgForm.developer_id,
        name:        bldgForm.name,
        floors:      bldgForm.floors      ? parseInt(bldgForm.floors)      : null,
        totalUnits:  bldgForm.total_units ? parseInt(bldgForm.total_units) : null,
      };
      if (editingBldg) {
        await apiFetch(`/api/elvi/buildings/${editingBldg.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toast.success('Building updated');
      } else {
        await apiFetch('/api/elvi/buildings', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Building added');
      }
      setBldgDialog(false);
      loadBuildings();
    } catch { toast.error('Failed to save building'); }
  };

  const deleteBuilding = async (b: Building) => {
    if (!confirm(`Delete "${b.name}"?`)) return;
    try {
      await apiFetch(`/api/elvi/buildings/${b.id}`, { method: 'DELETE' });
      toast.success(`"${b.name}" deleted`);
      loadBuildings();
    } catch { toast.error('Failed to delete building'); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // WHATSAPP GROUPS TAB
  // ═══════════════════════════════════════════════════════════════════════════

  const [groupDialog, setGroupDialog] = useState(false);
  const [groupForm, setGroupForm]     = useState({ group_jid: '', group_name: '', developer_id: '' });

  const saveGroup = async () => {
    try {
      await apiFetch('/api/elvi/group-sources', {
        method: 'POST',
        body: JSON.stringify({
          groupJid:    groupForm.group_jid,
          groupName:   groupForm.group_name,
          developerId: groupForm.developer_id || null,
        }),
      });
      toast.success('Group source registered');
      setGroupDialog(false);
      setGroupForm({ group_jid: '', group_name: '', developer_id: '' });
      loadGroups();
    } catch { toast.error('Failed to register group'); }
  };

  const toggleGroupActive = async (group: GroupSource) => {
    try {
      await apiFetch(`/api/elvi/group-sources/${group.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !group.active }),
      });
      loadGroups();
    } catch { toast.error('Failed to update group'); }
  };

  const deleteGroup = async (group: GroupSource) => {
    if (!confirm(`Remove "${group.group_name}" from Elvi's watch list?`)) return;
    try {
      await apiFetch(`/api/elvi/group-sources/${group.id}`, { method: 'DELETE' });
      toast.success('Group source removed');
      loadGroups();
    } catch { toast.error('Failed to delete group source'); }
  };

  const triggerIngestion = async (group: GroupSource) => {
    setIngestingId(group.id);
    try {
      const result = await apiFetch(`/api/elvi/group-sources/${group.id}/ingest`, { method: 'POST' });
      toast.success(result.message || 'History ingestion started');
      loadGroups();
    } catch { toast.error('Failed to start ingestion'); }
    finally { setIngestingId(null); }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Elvi Admin</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage Elvi's knowledge base, taxonomy, and WhatsApp group sources
          </p>
        </div>
        <a href="/elvi">
          <Button variant="outline" size="sm">← Back to Elvi</Button>
        </a>
      </div>

      <Tabs defaultValue="knowledge">
        <TabsList className="mb-4">
          <TabsTrigger value="knowledge" className="gap-2">
            <FolderOpen className="w-4 h-4" /> Knowledge Base
          </TabsTrigger>
          <TabsTrigger value="taxonomy" className="gap-2">
            <Building2 className="w-4 h-4" /> Taxonomy
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-2">
            <MessageSquare className="w-4 h-4" /> WhatsApp Groups
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════════
            KNOWLEDGE BASE
        ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="knowledge" className="space-y-4">

          {/* Upload card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload Document</CardTitle>
              <CardDescription>Add PDFs, Word docs, or spreadsheets to Elvi's knowledge base</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Developer *</Label>
                  <Select value={uploadDev} onValueChange={v => { setUploadDev(v); setUploadProject(''); setUploadBuilding(''); }}>
                    <SelectTrigger><SelectValue placeholder="Select developer" /></SelectTrigger>
                    <SelectContent>
                      {developers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Project</Label>
                  <Select value={uploadProject} onValueChange={v => { setUploadProject(v); setUploadBuilding(''); }} disabled={!uploadDev}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      {availableProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Building / Tower</Label>
                  <Select value={uploadBuilding} onValueChange={setUploadBuilding} disabled={!uploadProject}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      {availableBuildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Document Type</Label>
                  <Select value={uploadDocType} onValueChange={setUploadDocType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Display Name</Label>
                  <Input value={uploadDocName} onChange={e => setUploadDocName(e.target.value)} placeholder="e.g. Emaar Hills Price List Apr 2026" />
                </div>
                <div className="space-y-1.5">
                  <Label>Document Date</Label>
                  <Input type="date" value={uploadDocDate} onChange={e => setUploadDocDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>File</Label>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="font-medium">{selectedFile.name}</span>
                      <span className="text-muted-foreground">({(selectedFile.size / 1024).toFixed(0)} KB)</span>
                      <button onClick={e => { e.stopPropagation(); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="ml-2 text-muted-foreground hover:text-destructive">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-sm">
                      <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
                      Click to select PDF, DOCX, or XLSX (max 50 MB)
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.xlsx,.xls,.txt,.csv"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              <Button onClick={handleUpload} disabled={uploadingDoc || !selectedFile || !uploadDev} className="gap-2">
                {uploadingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadingDoc ? 'Uploading & Ingesting…' : 'Upload to Knowledge Base'}
              </Button>
            </CardContent>
          </Card>

          {/* Docs list */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Ingested Documents</CardTitle>
                <CardDescription>{docs.length} documents in knowledge base</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadDocs} disabled={loadingDocs} className="gap-1.5">
                {loadingDocs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {loadingDocs ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                  <Loader2 className="animate-spin w-4 h-4" /> Loading…
                </div>
              ) : docs.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">No documents yet. Upload your first document above.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Developer</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docs.map(doc => (
                      <TableRow key={doc.doc_group_id}>
                        <TableCell className="font-medium max-w-xs truncate">{doc.doc_name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{devName(doc.developer_id)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{doc.project_id ? projName(doc.project_id) : '—'}</TableCell>
                        <TableCell>
                          <Badge variant={doc.source === 'whatsapp_group' ? 'secondary' : 'outline'} className="text-xs">
                            {doc.source === 'whatsapp_group' ? 'WhatsApp' : 'Upload'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteDoc(doc.doc_group_id, doc.doc_name)}>
                            <Trash2 className="w-3.5 h-3.5" />
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

        {/* ══════════════════════════════════════════════════════════════════
            TAXONOMY
        ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="taxonomy" className="space-y-4">

          {/* Developers */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Developers</CardTitle>
                <CardDescription>{developers.length} registered</CardDescription>
              </div>
              <Button size="sm" onClick={() => openDevDialog()} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Developer
              </Button>
            </CardHeader>
            <CardContent>
              {developers.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">No developers yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead>Website</TableHead><TableHead>Contact</TableHead><TableHead className="w-20" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {developers.map(dev => (
                      <TableRow key={dev.id}>
                        <TableCell className="font-medium">{dev.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{dev.website || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{dev.primary_contact || '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDevDialog(dev)}><Edit2 className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteDeveloper(dev)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Projects */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Projects</CardTitle>
                <CardDescription>{projects.length} registered</CardDescription>
              </div>
              <Button size="sm" onClick={() => openProjDialog()} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Project
              </Button>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">No projects yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead>Developer</TableHead><TableHead>Status</TableHead><TableHead>Handover</TableHead><TableHead className="w-20" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map(proj => (
                      <TableRow key={proj.id}>
                        <TableCell className="font-medium">{proj.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{devName(proj.developer_id)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs capitalize">{proj.status?.replace('-', ' ')}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{proj.handover_date || '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openProjDialog(proj)}><Edit2 className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteProject(proj)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Buildings */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Buildings / Towers</CardTitle>
                <CardDescription>{buildings.length} registered</CardDescription>
              </div>
              <Button size="sm" onClick={() => openBldgDialog()} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Building
              </Button>
            </CardHeader>
            <CardContent>
              {buildings.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">No buildings yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead>Project</TableHead><TableHead>Floors</TableHead><TableHead>Units</TableHead><TableHead className="w-20" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {buildings.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{projName(b.project_id)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{b.floors || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{b.total_units || '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openBldgDialog(b)}><Edit2 className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteBuilding(b)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════
            WHATSAPP GROUPS
        ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="groups" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Developer WhatsApp Groups</CardTitle>
                <CardDescription>Elvi silently monitors these groups and ingests relevant messages and documents</CardDescription>
              </div>
              <Button size="sm" onClick={() => setGroupDialog(true)} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Register Group
              </Button>
            </CardHeader>
            <CardContent>
              {groups.length === 0 ? (
                <div className="text-center text-muted-foreground py-10 text-sm space-y-1">
                  <MessageSquare className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
                  <p>No groups registered yet.</p>
                  <p className="text-xs">Add a WhatsApp group JID and Elvi will monitor it automatically.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group Name</TableHead>
                      <TableHead>Group JID</TableHead>
                      <TableHead>Developer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>History</TableHead>
                      <TableHead>Last Ingested</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map(group => (
                      <TableRow key={group.id}>
                        <TableCell className="font-medium">{group.group_name}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground max-w-[160px] truncate">{group.group_jid}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{devName(group.developer_id)}</TableCell>
                        <TableCell>
                          <button onClick={() => toggleGroupActive(group)}>
                            <Badge variant={group.active ? 'default' : 'secondary'} className="cursor-pointer text-xs">
                              {group.active ? 'Active' : 'Paused'}
                            </Badge>
                          </button>
                        </TableCell>
                        <TableCell>
                          {group.history_ingested
                            ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="w-3.5 h-3.5" /> Done</span>
                            : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="w-3.5 h-3.5" /> Pending</span>
                          }
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {group.last_ingested_at ? new Date(group.last_ingested_at).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={ingestingId === group.id}
                              onClick={() => triggerIngestion(group)}
                            >
                              {ingestingId === group.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />
                              }
                              Ingest
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteGroup(group)}>
                              <Trash2 className="w-3.5 h-3.5" />
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

          <Card className="border-muted bg-muted/30">
            <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">How to find your Group JID:</p>
              <p>In your Green API dashboard, go to the instance's incoming messages log and look for messages from the group. The JID ends with <code className="bg-muted px-1 rounded">@g.us</code>, e.g. <code className="bg-muted px-1 rounded">971501234567-1678901234@g.us</code></p>
              <p>Once registered, Elvi will begin capturing all new messages from the group automatically. Click <strong>Ingest</strong> to pull the full historical chat history (up to 6 months).</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Developer dialog ──────────────────────────────────────────────── */}
      <Dialog open={devDialog} onOpenChange={setDevDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDev ? 'Edit Developer' : 'Add Developer'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={devForm.name} onChange={e => setDevForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Emaar Properties" />
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={devForm.website} onChange={e => setDevForm(f => ({ ...f, website: e.target.value }))} placeholder="https://www.emaar.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Primary Contact</Label>
              <Input value={devForm.primary_contact} onChange={e => setDevForm(f => ({ ...f, primary_contact: e.target.value }))} placeholder="Name or number" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={devForm.notes} onChange={e => setDevForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional info" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDevDialog(false)}>Cancel</Button>
            <Button onClick={saveDeveloper} disabled={!devForm.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Project dialog ────────────────────────────────────────────────── */}
      <Dialog open={projDialog} onOpenChange={setProjDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProj ? 'Edit Project' : 'Add Project'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Developer *</Label>
              <Select value={projForm.developer_id} onValueChange={v => setProjForm(f => ({ ...f, developer_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select developer" /></SelectTrigger>
                <SelectContent>{developers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Project Name *</Label>
              <Input value={projForm.name} onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Dubai Hills Estate" />
            </div>
            <div className="space-y-1.5">
              <Label>Community</Label>
              <Input value={projForm.community} onChange={e => setProjForm(f => ({ ...f, community: e.target.value }))} placeholder="e.g. Dubai Hills" />
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input value={projForm.location} onChange={e => setProjForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Al Barsha South" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={projForm.type} onValueChange={v => setProjForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="mixed">Mixed Use</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={projForm.status} onValueChange={v => setProjForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off-plan">Off-Plan</SelectItem>
                  <SelectItem value="under-construction">Under Construction</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Handover Date</Label>
              <Input type="date" value={projForm.handover_date} onChange={e => setProjForm(f => ({ ...f, handover_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Total Units</Label>
              <Input type="number" value={projForm.total_units} onChange={e => setProjForm(f => ({ ...f, total_units: e.target.value }))} placeholder="e.g. 2400" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjDialog(false)}>Cancel</Button>
            <Button onClick={saveProject} disabled={!projForm.developer_id || !projForm.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Building dialog ───────────────────────────────────────────────── */}
      <Dialog open={bldgDialog} onOpenChange={setBldgDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBldg ? 'Edit Building' : 'Add Building'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Project *</Label>
              <Select value={bldgForm.project_id} onValueChange={v => {
                const proj = projects.find(p => p.id === v);
                setBldgForm(f => ({ ...f, project_id: v, developer_id: proj?.developer_id || '' }));
              }}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Building / Tower Name *</Label>
              <Input value={bldgForm.name} onChange={e => setBldgForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Tower A" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Floors</Label>
                <Input type="number" value={bldgForm.floors} onChange={e => setBldgForm(f => ({ ...f, floors: e.target.value }))} placeholder="e.g. 32" />
              </div>
              <div className="space-y-1.5">
                <Label>Total Units</Label>
                <Input type="number" value={bldgForm.total_units} onChange={e => setBldgForm(f => ({ ...f, total_units: e.target.value }))} placeholder="e.g. 180" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBldgDialog(false)}>Cancel</Button>
            <Button onClick={saveBuilding} disabled={!bldgForm.project_id || !bldgForm.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Group source dialog ───────────────────────────────────────────── */}
      <Dialog open={groupDialog} onOpenChange={setGroupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register WhatsApp Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Group JID *</Label>
              <Input value={groupForm.group_jid} onChange={e => setGroupForm(f => ({ ...f, group_jid: e.target.value }))} placeholder="971501234567-1678901234@g.us" className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">The full WhatsApp group ID ending in @g.us</p>
            </div>
            <div className="space-y-1.5">
              <Label>Group Name *</Label>
              <Input value={groupForm.group_name} onChange={e => setGroupForm(f => ({ ...f, group_name: e.target.value }))} placeholder="e.g. Emaar Brokers Channel" />
            </div>
            <div className="space-y-1.5">
              <Label>Linked Developer</Label>
              <Select value={groupForm.developer_id} onValueChange={v => setGroupForm(f => ({ ...f, developer_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {developers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialog(false)}>Cancel</Button>
            <Button onClick={saveGroup} disabled={!groupForm.group_jid || !groupForm.group_name}>Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default ElviAdmin;
