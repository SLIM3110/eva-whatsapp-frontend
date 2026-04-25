import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Send, Plus, User, FileText, Loader2,
  Upload, X, ChevronDown, PanelLeftClose, PanelLeft,
  Home, DatabaseZap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BACKEND_URL = 'https://api.evaintelligencehub.online';
const DOC_TYPES = ['brochure','price_list','payment_plan','floor_plan','fact_sheet','market_report','legal','other'];
const DOC_TYPE_LABELS: Record<string,string> = {
  brochure:'Brochure', price_list:'Price List', payment_plan:'Payment Plan',
  floor_plan:'Floor Plan', fact_sheet:'Fact Sheet', market_report:'Market Report',
  legal:'Legal', other:'Other',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface Source   { doc_name: string; doc_type: string; developer?: string; project?: string; building?: string; }
interface Message  { id: string; role: 'user'|'assistant'; content: string; sources?: Source[]; isTyping?: boolean; }
interface Session  { sessionId: string; title: string; createdAt: string; }
interface Developer { id: string; name: string; }
interface Project   { id: string; developer_id: string; name: string; }
interface Building  { id: string; project_id: string; name: string; }

// ── Elvi tunduk logo ──────────────────────────────────────────────────────────
export const ElviLogo = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="100" cy="100" r="96" fill="#1B4D3E"/>
    <circle cx="100" cy="100" r="70" fill="none" stroke="#C9A96E" strokeWidth="3"/>
    <circle cx="100" cy="100" r="11" fill="#C9A96E"/>
    {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
      const rad = (deg * Math.PI) / 180;
      return <line key={i}
        x1={100 + 11*Math.cos(rad)} y1={100 + 11*Math.sin(rad)}
        x2={100 + 70*Math.cos(rad)} y2={100 + 70*Math.sin(rad)}
        stroke="#C9A96E" strokeWidth="2.5"/>;
    })}
    <circle cx="100" cy="100" r="38" fill="none" stroke="#C9A96E" strokeWidth="1.5" strokeDasharray="5 4"/>
    <circle cx="100" cy="100" r="96" fill="none" stroke="#C9A96E" strokeWidth="3"/>
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function groupSessionsByDate(sessions: Session[]) {
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
  const weekAgo   = new Date(today); weekAgo.setDate(today.getDate()-7);

  const groups: { label: string; sessions: Session[] }[] = [
    { label: 'Today',     sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'This week', sessions: [] },
    { label: 'Older',     sessions: [] },
  ];
  for (const s of sessions) {
    const d = new Date(s.createdAt); d.setHours(0,0,0,0);
    if (d >= today)           groups[0].sessions.push(s);
    else if (d >= yesterday)  groups[1].sessions.push(s);
    else if (d >= weekAgo)    groups[2].sessions.push(s);
    else                      groups[3].sessions.push(s);
  }
  return groups.filter(g => g.sessions.length > 0);
}

// ── Simple markdown renderer (bold + newlines) ────────────────────────────────
function renderMarkdown(text: string): React.ReactNode {
  // Split on **bold** spans
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Source chip ───────────────────────────────────────────────────────────────
const SourceChip = ({ source }: { source: Source }) => {
  const label = source.doc_name || DOC_TYPE_LABELS[source.doc_type] || 'Document';
  const sub   = [source.developer, source.project].filter(Boolean).join(' › ');
  return (
    <div className="inline-flex items-start gap-1.5 bg-muted border rounded-md px-2 py-1 text-xs max-w-[200px]">
      <FileText className="w-3 h-3 mt-0.5 text-accent shrink-0"/>
      <div className="min-w-0">
        <p className="font-medium truncate">{label}</p>
        {sub && <p className="text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
};

// ── Message bubble ────────────────────────────────────────────────────────────
const MessageBubble = ({ msg }: { msg: Message }) => {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex gap-3 group', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="shrink-0 mt-1"><ElviLogo size={32}/></div>
      )}
      <div className={cn('flex flex-col gap-2 max-w-[80%]', isUser && 'items-end')}>
        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card border shadow-sm rounded-tl-sm'
        )}>
          {msg.isTyping ? (
            <div className="flex gap-1 items-center h-5">
              {[0,150,300].map(d => (
                <span key={d} className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: `${d}ms` }}/>
              ))}
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{renderMarkdown(msg.content)}</p>
          )}
        </div>
        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {msg.sources.map((src, i) => <SourceChip key={i} source={src}/>)}
          </div>
        )}
      </div>
      {isUser && (
        <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mt-1">
          <User className="w-4 h-4 text-primary"/>
        </div>
      )}
    </div>
  );
};

// ── Suggestions ───────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  'What payment plans are available?',
  'Explain the DLD fee structure',
  'Golden visa eligibility requirements',
  'Compare off-plan vs secondary market ROI',
  'Walk me through the handover process',
  'What documents does a buyer need?',
  'Explain the NOC process',
  'Current mortgage LTV rules in UAE',
];

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════════════════════════════
const Elvi = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  // Core state
  const [apiKey, setApiKey]           = useState('');
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [sessionId, setSessionId]     = useState(() => crypto.randomUUID());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Session history
  const [sessions, setSessions]       = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Scope
  const [developers, setDevelopers]   = useState<Developer[]>([]);
  const [projects, setProjects]       = useState<Project[]>([]);
  const [buildings, setBuildings]     = useState<Building[]>([]);
  const [selDev, setSelDev]           = useState('all');
  const [selProject, setSelProject]   = useState('all');
  const [selBuilding, setSelBuilding] = useState('all');
  const [showScope, setShowScope]     = useState(false);

  // Drag and drop upload
  const [isDragging, setIsDragging]   = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [showUpload, setShowUpload]   = useState(false);
  const [uploadDev, setUploadDev]     = useState('');
  const [uploadDocType, setUploadDocType] = useState('other');
  const [uploadDocName, setUploadDocName] = useState('');
  const [uploading, setUploading]     = useState(false);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.from('api_settings').select('whatsapp_api_key').eq('id',1).single();
      const key = data?.whatsapp_api_key || '';
      setApiKey(key);
      if (key) {
        fetch(`${BACKEND_URL}/api/elvi/developers`, { headers: { 'x-api-key': key } })
          .then(r => r.ok ? r.json() : []).then(setDevelopers).catch(() => {});
      }
    };
    init();
  }, []);

  // ── Load past sessions from Supabase ──────────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!user?.id) return;
    setLoadingSessions(true);
    try {
      const { data } = await supabase
        .from('elvi_conversations')
        .select('session_id, message, created_at')
        .eq('agent_id', user.id)
        .eq('role', 'user')
        .order('created_at', { ascending: false });

      if (!data) return;

      // Deduplicate — one entry per session_id, using the FIRST message as title
      const seen = new Map<string, Session>();
      for (const row of [...data].reverse()) {
        if (!seen.has(row.session_id)) {
          seen.set(row.session_id, {
            sessionId:  row.session_id,
            title:      row.message.slice(0, 60) + (row.message.length > 60 ? '…' : ''),
            createdAt:  row.created_at,
          });
        }
      }
      setSessions([...seen.values()].reverse());
    } finally {
      setLoadingSessions(false);
    }
  }, [user?.id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Cascade developer → project → building ────────────────────────────────
  useEffect(() => {
    if (selDev === 'all' || !apiKey) { setProjects([]); setSelProject('all'); return; }
    fetch(`${BACKEND_URL}/api/elvi/projects?developerId=${selDev}`, { headers: { 'x-api-key': apiKey } })
      .then(r => r.ok ? r.json() : []).then(setProjects).catch(() => {});
    setSelProject('all'); setBuildings([]); setSelBuilding('all');
  }, [selDev, apiKey]);

  useEffect(() => {
    if (selProject === 'all' || !apiKey) { setBuildings([]); setSelBuilding('all'); return; }
    fetch(`${BACKEND_URL}/api/elvi/buildings?projectId=${selProject}`, { headers: { 'x-api-key': apiKey } })
      .then(r => r.ok ? r.json() : []).then(setBuildings).catch(() => {});
    setSelBuilding('all');
  }, [selProject, apiKey]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Welcome message ───────────────────────────────────────────────────────
  const welcomeMsg = useCallback((): Message => ({
    id: 'welcome', role: 'assistant',
    content: `Hi ${profile?.first_name || 'there'}! I'm Elvi, your EVA real estate AI.\n\nAsk me anything about projects, pricing, payment plans, DLD regulations, mortgages, or any developer documents. You can also drag and drop files here to add them to my knowledge base.`,
  }), [profile?.first_name]);

  useEffect(() => {
    setMessages([welcomeMsg()]);
  }, [sessionId, welcomeMsg]);

  // ── Load existing session ─────────────────────────────────────────────────
  const loadSession = useCallback(async (sid: string) => {
    setSessionId(sid);
    if (!apiKey || !user?.id) return;
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/elvi/conversations/${user.id}?sessionId=${sid}&limit=100`,
        { headers: { 'x-api-key': apiKey } }
      );
      if (!res.ok) return;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return;
      setMessages(rows.map((r: any) => ({
        id:      r.id,
        role:    r.role,
        content: r.message,
        sources: r.sources || [],
      })));
    } catch { /* fall through to welcome */ }
  }, [apiKey, user?.id]);

  // ── New chat ──────────────────────────────────────────────────────────────
  const startNewChat = () => {
    const id = crypto.randomUUID();
    setSessionId(id);
    setInput('');
    textareaRef.current?.focus();
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message    = { id: crypto.randomUUID(), role: 'user', content: trimmed };
    const typingMsg: Message  = { id: 'typing', role: 'assistant', content: '', isTyping: true };
    setMessages(prev => [...prev, userMsg, typingMsg]);
    setInput('');
    setLoading(true);

    const history = messages
      .filter(m => m.id !== 'welcome' && !m.isTyping)
      .map(m => ({ role: m.role, content: m.content }));

    // Stable ID for the assistant bubble we'll populate incrementally
    const assistantId = crypto.randomUUID();
    let streamStarted = false;

    try {
      const res = await fetch(`${BACKEND_URL}/api/elvi/query`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          agentId:     user?.id,
          sessionId,
          message:     trimmed,
          history,
          developerId:  selDev      === 'all' ? null : selDev,
          projectId:    selProject   === 'all' ? null : selProject,
          buildingId:   selBuilding  === 'all' ? null : selBuilding,
          stream:       true,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const ensureAssistantBubble = () => {
        if (!streamStarted) {
          streamStarted = true;
          setMessages(prev => [
            ...prev.filter(m => m.id !== 'typing'),
            { id: assistantId, role: 'assistant' as const, content: '', sources: [] },
          ]);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let evt: any;
          try { evt = JSON.parse(raw); } catch { continue; }

          if (evt.type === 'chunk') {
            ensureAssistantBubble();
            setMessages(prev => prev.map(m =>
              m.id === assistantId
                ? { ...m, content: m.content + (evt.text as string) }
                : m
            ));
          } else if (evt.type === 'end') {
            // Attach sources and refresh history sidebar
            setMessages(prev => prev.map(m =>
              m.id === assistantId
                ? { ...m, sources: evt.sources ?? [] }
                : m
            ));
            loadSessions();
          } else if (evt.type === 'error') {
            throw new Error(evt.error as string);
          }
        }
      }

      // Edge case: stream ended with no chunks (empty response)
      if (!streamStarted) {
        setMessages(prev => prev.filter(m => m.id !== 'typing'));
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== 'typing'));
      toast.error('Elvi couldn\'t respond — please try again');
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [loading, messages, user?.id, sessionId, apiKey, selDev, selProject, selBuilding, loadSessions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current = 0; setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const allowed = ['pdf','docx','xlsx','xls','txt','csv'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!allowed.includes(ext)) { toast.error(`File type .${ext} not supported`); return; }
    setDroppedFile(file);
    setUploadDocName(file.name.replace(/\.[^.]+$/, ''));
    setUploadDocType('other');
    setUploadDev('');
    setShowUpload(true);
  };

  const handleUploadSubmit = async () => {
    if (!droppedFile || !uploadDev) { toast.error('Please select a developer'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', droppedFile);
      form.append('docName', uploadDocName || droppedFile.name);
      form.append('docType', uploadDocType);
      form.append('developerId', uploadDev);
      const res = await fetch(`${BACKEND_URL}/api/elvi/upload`, {
        method: 'POST', headers: { 'x-api-key': apiKey }, body: form,
      });
      if (!res.ok) throw new Error();
      const result = await res.json();
      toast.success(`"${uploadDocName}" added — ${result.chunksInserted} chunks ingested`);
      setShowUpload(false); setDroppedFile(null);
    } catch { toast.error('Upload failed'); }
    finally { setUploading(false); }
  };

  // ── Scope label ───────────────────────────────────────────────────────────
  const scopeLabel = [
    selDev     !== 'all' ? developers.find(d => d.id === selDev)?.name      : null,
    selProject !== 'all' ? projects.find(p => p.id === selProject)?.name    : null,
    selBuilding!== 'all' ? buildings.find(b => b.id === selBuilding)?.name  : null,
  ].filter(Boolean).join(' › ');

  const sessionGroups = groupSessionsByDate(sessions);
  const isNewSession  = !sessions.some(s => s.sessionId === sessionId);

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">

      {/* ── Left sidebar — session history ─────────────────────────────── */}
      <div className={cn(
        'flex flex-col border-r bg-sidebar transition-all duration-300 shrink-0',
        sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
      )}>
        {/* Sidebar header — Elvi brand */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <ElviLogo size={32}/>
          <div className="min-w-0">
            <p className="font-bold text-sidebar-foreground text-base leading-tight tracking-tight">Elvi</p>
            <p className="text-xs text-sidebar-foreground/50">EVA Real Estate AI</p>
          </div>
        </div>

        {/* New chat button */}
        <div className="px-3 py-3 border-b border-sidebar-border">
          <Button
            onClick={startNewChat}
            className="w-full gap-2 text-sm h-9 bg-sidebar-accent hover:bg-sidebar-accent/80 text-sidebar-foreground border border-sidebar-border"
            variant="outline"
          >
            <Plus className="w-4 h-4"/> New Chat
          </Button>
        </div>

        {/* Session list */}
        <ScrollArea className="flex-1">
          <div className="py-2 px-2">
            {loadingSessions && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-sidebar-foreground/40"/>
              </div>
            )}

            {!loadingSessions && sessions.length === 0 && (
              <p className="text-xs text-sidebar-foreground/40 text-center py-8 px-4">
                Your past conversations will appear here
              </p>
            )}

            {/* Current new session (if unsaved) */}
            {isNewSession && messages.length > 1 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-sidebar-foreground/40 px-2 pb-1">Now</p>
                <button className="w-full text-left px-3 py-2 rounded-lg text-xs bg-sidebar-accent text-sidebar-foreground truncate">
                  {messages.find(m => m.role === 'user')?.content.slice(0, 50) || 'New conversation'}
                </button>
              </div>
            )}

            {sessionGroups.map(group => (
              <div key={group.label} className="mb-3">
                <p className="text-xs font-medium text-sidebar-foreground/40 px-2 pb-1">{group.label}</p>
                {group.sessions.map(s => (
                  <button
                    key={s.sessionId}
                    onClick={() => loadSession(s.sessionId)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors mb-0.5 truncate',
                      s.sessionId === sessionId
                        ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                        : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Footer links — back to app + admin */}
        <div className="px-3 py-3 border-t border-sidebar-border space-y-0.5">
          {isAdmin && (
            <button
              onClick={() => navigate('/elvi-admin')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
            >
              <DatabaseZap className="w-3.5 h-3.5"/> Manage Knowledge Base
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <Home className="w-3.5 h-3.5"/> Back to Dashboard
          </button>
        </div>
      </div>

      {/* ── Main chat area ──────────────────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col min-w-0 relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-primary/5 border-2 border-dashed border-primary/40 rounded-r-xl flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Upload className="w-8 h-8 text-primary"/>
            </div>
            <p className="text-lg font-semibold text-primary">Drop to add to Elvi's knowledge base</p>
            <p className="text-sm text-muted-foreground">PDF, DOCX, XLSX, TXT supported</p>
          </div>
        )}

        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4"/> : <PanelLeft className="w-4 h-4"/>}
          </button>

          {!sidebarOpen && (
            <>
              <ElviLogo size={28}/>
              <div>
                <p className="font-semibold text-sm leading-tight">Elvi</p>
                <p className="text-xs text-muted-foreground">EVA Real Estate AI</p>
              </div>
            </>
          )}

          <div className="flex-1"/>

          {/* Scope filter */}
          <button
            onClick={() => setShowScope(o => !o)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors',
              scopeLabel
                ? 'border-accent/40 text-accent bg-accent/5'
                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
            )}
          >
            {scopeLabel || 'All documents'}
            <ChevronDown className={cn('w-3 h-3 transition-transform', showScope && 'rotate-180')}/>
          </button>
        </div>

        {/* Scope filter panel */}
        {showScope && (
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20 flex-wrap">
            <Select value={selDev} onValueChange={v => { setSelDev(v); }}>
              <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="All Developers"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Developers</SelectItem>
                {developers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {projects.length > 0 && (
              <Select value={selProject} onValueChange={setSelProject}>
                <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="All Projects"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {buildings.length > 0 && (
              <Select value={selBuilding} onValueChange={setSelBuilding}>
                <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="All Buildings"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buildings</SelectItem>
                  {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {scopeLabel && (
              <button onClick={() => { setSelDev('all'); setSelProject('all'); setSelBuilding('all'); }}
                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
                <X className="w-3 h-3"/> Clear
              </button>
            )}
          </div>
        )}

        {/* Messages / Welcome state */}
        {messages.length <= 1 ? (
          /* ── Hero welcome — shown until first user message ── */
          <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8 gap-8">
            <div className="flex flex-col items-center gap-4 text-center">
              <ElviLogo size={72}/>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Ask Elvi</h1>
                <p className="text-muted-foreground mt-1.5 text-base">
                  Your EVA real estate AI — projects, pricing, regulations, market data
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-xl">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => sendMessage(s)}
                  className="text-left text-sm px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted hover:border-primary/30 transition-colors text-muted-foreground hover:text-foreground leading-snug shadow-sm">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Active chat ── */
          <ScrollArea className="flex-1 px-6 py-6">
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.filter(m => m.id !== 'welcome').map(msg => <MessageBubble key={msg.id} msg={msg}/>)}
              <div ref={scrollRef}/>
            </div>
          </ScrollArea>
        )}

        {/* Input area */}
        <div className="px-4 py-4 border-t bg-card/80 backdrop-blur-sm shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2 bg-muted/40 border rounded-2xl px-4 py-3 focus-within:border-primary/40 focus-within:bg-background transition-colors">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Elvi anything… or drag & drop a document to upload"
                className="flex-1 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 min-h-[24px] max-h-36 p-0"
                rows={1}
                disabled={loading}
              />
              <Button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                size="icon"
                className="h-8 w-8 rounded-xl shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Enter to send · Shift+Enter for new line · Drag files anywhere to upload
            </p>
          </div>
        </div>
      </div>

      {/* ── Upload dialog (on file drop) ────────────────────────────────── */}
      <Dialog open={showUpload} onOpenChange={o => { if (!o) { setShowUpload(false); setDroppedFile(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary"/>
              Add to Knowledge Base
            </DialogTitle>
          </DialogHeader>

          {droppedFile && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg text-sm">
              <FileText className="w-4 h-4 text-accent shrink-0"/>
              <span className="truncate font-medium">{droppedFile.name}</span>
              <span className="text-muted-foreground shrink-0">({(droppedFile.size/1024).toFixed(0)} KB)</span>
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Developer *</Label>
              <Select value={uploadDev} onValueChange={setUploadDev}>
                <SelectTrigger><SelectValue placeholder="Select developer"/></SelectTrigger>
                <SelectContent>
                  {developers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Document Name</Label>
              <Input value={uploadDocName} onChange={e => setUploadDocName(e.target.value)} placeholder="e.g. Emaar Hills Price List"/>
            </div>
            <div className="space-y-1.5">
              <Label>Document Type</Label>
              <Select value={uploadDocType} onValueChange={setUploadDocType}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUpload(false); setDroppedFile(null); }}>Cancel</Button>
            <Button onClick={handleUploadSubmit} disabled={uploading || !uploadDev} className="gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
              {uploading ? 'Uploading…' : 'Add to Elvi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Elvi;
