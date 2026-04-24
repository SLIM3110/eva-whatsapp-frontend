import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Send,
  Plus,
  Bot,
  User,
  FileText,
  ChevronRight,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BACKEND_URL = 'https://api.evaintelligencehub.online';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Source {
  doc_name: string;
  doc_type: string;
  developer?: string;
  project?: string;
  building?: string;
  chunk_index?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  isTyping?: boolean;
}

interface Developer {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  developer_id: string;
}

interface Building {
  id: string;
  name: string;
  project_id: string;
}

// ── Suggestion chips by context ───────────────────────────────────────────────
const SUGGESTIONS = [
  'What payment plans are available?',
  'Explain the DLD transfer fee structure',
  'What are the golden visa eligibility requirements?',
  'Compare ROI between off-plan and secondary market',
  'Walk me through the handover process',
  'What documents does a buyer need for off-plan?',
  'Explain the NOC process for secondary sales',
  'What are the current mortgage LTV rules?',
];

// ── Elvi logo (tunduk symbol) ─────────────────────────────────────────────────
const ElviLogo = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="100" r="98" fill="#1B4D3E" stroke="#C9A96E" strokeWidth="4"/>
    <circle cx="100" cy="100" r="72" fill="none" stroke="#C9A96E" strokeWidth="3"/>
    <circle cx="100" cy="100" r="12" fill="#C9A96E"/>
    {/* Spokes */}
    {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
      const rad = (deg * Math.PI) / 180;
      const x1 = 100 + 12 * Math.cos(rad);
      const y1 = 100 + 12 * Math.sin(rad);
      const x2 = 100 + 72 * Math.cos(rad);
      const y2 = 100 + 72 * Math.sin(rad);
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#C9A96E" strokeWidth="2.5"/>;
    })}
    {/* Inner decorative ring */}
    <circle cx="100" cy="100" r="40" fill="none" stroke="#C9A96E" strokeWidth="1.5" strokeDasharray="6 4"/>
  </svg>
);

// ── Doc type label ────────────────────────────────────────────────────────────
const DOC_TYPE_LABELS: Record<string, string> = {
  brochure:     'Brochure',
  price_list:   'Price List',
  payment_plan: 'Payment Plan',
  floor_plan:   'Floor Plan',
  fact_sheet:   'Fact Sheet',
  market_report:'Market Report',
  legal:        'Legal',
  whatsapp_message: 'Group Message',
  other:        'Document',
};

// ── Source chip ───────────────────────────────────────────────────────────────
const SourceChip = ({ source }: { source: Source }) => {
  const label = source.doc_name || DOC_TYPE_LABELS[source.doc_type] || 'Document';
  const sub   = [source.developer, source.project, source.building].filter(Boolean).join(' › ');
  return (
    <div className="inline-flex items-start gap-1.5 bg-muted border rounded-md px-2.5 py-1.5 text-xs max-w-xs">
      <FileText className="w-3 h-3 mt-0.5 text-accent shrink-0" />
      <div className="min-w-0">
        <p className="font-medium text-foreground truncate">{label}</p>
        {sub && <p className="text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
};

// ── Message bubble ────────────────────────────────────────────────────────────
const MessageBubble = ({ msg }: { msg: Message }) => {
  const isUser = msg.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center mt-0.5">
          <ElviLogo size={28} />
        </div>
      )}

      <div className={cn('flex flex-col gap-2 max-w-[75%]', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-card border rounded-tl-sm shadow-sm'
          )}
        >
          {msg.isTyping ? (
            <div className="flex gap-1 items-center h-5">
              <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          )}
        </div>

        {/* Source citations */}
        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {msg.sources.map((src, i) => (
              <SourceChip key={i} source={src} />
            ))}
          </div>
        )}
      </div>

      {isUser && (
        <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center mt-0.5">
          <User className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const Elvi = () => {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  // Chat state
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [sessionId, setSessionId]     = useState<string>(() => crypto.randomUUID());
  const [apiKey, setApiKey]           = useState<string>('');

  // Scope filters
  const [developers, setDevelopers]   = useState<Developer[]>([]);
  const [projects, setProjects]       = useState<Project[]>([]);
  const [buildings, setBuildings]     = useState<Building[]>([]);
  const [selDev, setSelDev]           = useState<string>('all');
  const [selProject, setSelProject]   = useState<string>('all');
  const [selBuilding, setSelBuilding] = useState<string>('all');

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load API key + developers on mount ─────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // Fetch backend API key
      const { data: settings } = await supabase
        .from('api_settings')
        .select('whatsapp_api_key')
        .eq('id', 1)
        .single();
      setApiKey(settings?.whatsapp_api_key || '');

      // Fetch developers for scope filter
      try {
        const res = await fetch(`${BACKEND_URL}/api/elvi/developers`, {
          headers: { 'x-api-key': settings?.whatsapp_api_key || '' },
        });
        if (res.ok) setDevelopers(await res.json());
      } catch (e) {
        console.warn('[Elvi] Could not load developers');
      }
    };
    init();
  }, []);

  // ── Cascade: developer → projects ─────────────────────────────────────────
  useEffect(() => {
    if (selDev === 'all') {
      setProjects([]);
      setSelProject('all');
      setBuildings([]);
      setSelBuilding('all');
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/elvi/projects?developerId=${selDev}`,
          { headers: { 'x-api-key': apiKey } }
        );
        if (res.ok) setProjects(await res.json());
      } catch (e) { /* ignore */ }
      setSelProject('all');
      setBuildings([]);
      setSelBuilding('all');
    };
    load();
  }, [selDev, apiKey]);

  // ── Cascade: project → buildings ───────────────────────────────────────────
  useEffect(() => {
    if (selProject === 'all') {
      setBuildings([]);
      setSelBuilding('all');
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/elvi/buildings?projectId=${selProject}`,
          { headers: { 'x-api-key': apiKey } }
        );
        if (res.ok) setBuildings(await res.json());
      } catch (e) { /* ignore */ }
      setSelBuilding('all');
    };
    load();
  }, [selProject, apiKey]);

  // ── Auto-scroll to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Welcome message on new session ────────────────────────────────────────
  useEffect(() => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: `Hi ${profile?.first_name || 'there'}! I'm Elvi, your EVA real estate AI. Ask me anything about developers, projects, pricing, payment plans, DLD regulations, mortgages, or anything else you need to close the deal.`,
    }]);
  }, [sessionId, profile?.first_name]);

  // ── New chat ───────────────────────────────────────────────────────────────
  const startNewChat = () => {
    setSessionId(crypto.randomUUID());
    setInput('');
  };

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id:      crypto.randomUUID(),
      role:    'user',
      content: trimmed,
    };
    const typingMsg: Message = {
      id:        'typing',
      role:      'assistant',
      content:   '',
      isTyping:  true,
    };

    setMessages(prev => [...prev, userMsg, typingMsg]);
    setInput('');
    setLoading(true);

    // Build conversation history (exclude typing, exclude welcome)
    const history = messages
      .filter(m => m.id !== 'welcome' && !m.isTyping)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`${BACKEND_URL}/api/elvi/query`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    apiKey,
        },
        body: JSON.stringify({
          agentId:    user?.id,
          sessionId,
          message:    trimmed,
          history,
          developerId:  selDev     === 'all' ? null : selDev,
          projectId:    selProject  === 'all' ? null : selProject,
          buildingId:   selBuilding === 'all' ? null : selBuilding,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const data = await res.json();

      setMessages(prev => [
        ...prev.filter(m => m.id !== 'typing'),
        {
          id:      crypto.randomUUID(),
          role:    'assistant',
          content: data.reply,
          sources: data.sources || [],
        },
      ]);
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== 'typing'));
      toast.error('Elvi couldn\'t respond — please try again');
      console.error('[Elvi] query error:', err.message);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [loading, messages, user?.id, sessionId, apiKey, selDev, selProject, selBuilding]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Active scope label ────────────────────────────────────────────────────
  const scopeLabel = [
    selDev     !== 'all' ? developers.find(d => d.id === selDev)?.name         : null,
    selProject !== 'all' ? projects.find(p => p.id === selProject)?.name       : null,
    selBuilding!== 'all' ? buildings.find(b => b.id === selBuilding)?.name     : null,
  ].filter(Boolean).join(' › ');

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">

      {/* ── Main chat panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-card border rounded-xl shadow-sm overflow-hidden">

        {/* Chat header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
          <div className="flex items-center gap-3">
            <ElviLogo size={36} />
            <div>
              <h2 className="font-semibold text-foreground text-sm leading-tight">Elvi</h2>
              <p className="text-xs text-muted-foreground">EVA Real Estate AI</p>
            </div>
            {scopeLabel && (
              <>
                <Separator orientation="vertical" className="h-6" />
                <Badge variant="outline" className="text-xs font-normal gap-1 text-accent border-accent/30">
                  <ChevronRight className="w-3 h-3" />
                  {scopeLabel}
                </Badge>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={startNewChat}
            className="gap-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </Button>
        </div>

        {/* Scope filter bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 shrink-0 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Scope:</span>
          <Select value={selDev} onValueChange={setSelDev}>
            <SelectTrigger className="h-7 text-xs w-40">
              <SelectValue placeholder="All Developers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Developers</SelectItem>
              {developers.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {projects.length > 0 && (
            <Select value={selProject} onValueChange={setSelProject}>
              <SelectTrigger className="h-7 text-xs w-40">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {buildings.length > 0 && (
            <Select value={selBuilding} onValueChange={setSelBuilding}>
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue placeholder="All Buildings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Buildings</SelectItem>
                {buildings.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-4">
          <div className="space-y-5">
            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Suggestion chips — show only when no real messages yet */}
        {messages.length <= 1 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2 shrink-0">
            {SUGGESTIONS.slice(0, 4).map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s)}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted hover:bg-accent/10 hover:border-accent/40 transition-colors text-muted-foreground hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t bg-card shrink-0">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Elvi anything about developers, projects, pricing, regulations…"
              className="resize-none min-h-[44px] max-h-32 text-sm"
              rows={1}
              disabled={loading}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              size="icon"
              className="h-11 w-11 shrink-0"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 px-0.5">
            Enter to send · Shift+Enter for new line · Answers are grounded in uploaded documents
          </p>
        </div>
      </div>

      {/* ── Right panel — quick info ─────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col gap-3 hidden xl:flex">

        {/* About Elvi */}
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold">Elvi knows about</h3>
          </div>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {[
              'Project brochures & price lists',
              'Payment plans & handover dates',
              'DLD fees & RERA regulations',
              'Mortgage LTV rules (CB caps)',
              'Golden visa thresholds',
              'NOC & title deed process',
              'Vastu compliance principles',
              'Fund repatriation (IN/PK)',
              'Ejari, DEWA, Empower setup',
              'Off-plan vs secondary rules',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-accent mt-0.5">·</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* More suggestions */}
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold">Try asking</h3>
          </div>
          <div className="space-y-1.5">
            {SUGGESTIONS.slice(4).map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s)}
                className="w-full text-left text-xs px-2.5 py-2 rounded-lg border border-border hover:bg-muted hover:border-accent/30 transition-colors text-muted-foreground hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Admin link */}
        {isAdmin && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 shadow-sm">
            <p className="text-xs text-muted-foreground mb-2">Manage Elvi's knowledge base, developers, and WhatsApp group sources.</p>
            <a
              href="/elvi-admin"
              className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
            >
              Open Admin Panel <ChevronRight className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

    </div>
  );
};

export default Elvi;
