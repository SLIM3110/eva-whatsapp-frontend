import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { FileText, Upload, Loader2, Download, Plus, X, BarChart2 } from 'lucide-react';

const API_BASE = 'https://api.evaintelligencehub.online';

const MarketReports = () => {
  const { user, profile } = useAuth();

  // Mode
  const [reportType, setReportType] = useState<'single' | 'comparison'>('single');

  // Single mode
  const [communityName, setCommunityName] = useState('');

  // Comparison mode
  const [communities, setCommunities] = useState<string[]>(['', '']);

  // Files
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [rentalCsvFile, setRentalCsvFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  // Options
  const [clientName, setClientName] = useState('');
  const [audience, setAudience] = useState<'neutral' | 'seller' | 'buyer'>('neutral');
  const [serviceCharge, setServiceCharge] = useState('');
  const [agentInstruction, setAgentInstruction] = useState('');
  const [personalisationPrompt, setPersonalisationPrompt] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<{ report_url: string; expires_at: string } | null>(null);

  const addCommunity = () => {
    if (communities.length < 5) setCommunities([...communities, '']);
  };

  const removeCommunity = (idx: number) => {
    if (communities.length > 2) setCommunities(communities.filter((_, i) => i !== idx));
  };

  const updateCommunity = (idx: number, val: string) => {
    const updated = [...communities];
    updated[idx] = val;
    setCommunities(updated);
  };

  const handleSubmit = async () => {
    if (!csvFile) {
      toast.error('Please upload a sales transactions CSV file');
      return;
    }
    if (reportType === 'single' && !communityName.trim()) {
      toast.error('Please enter a community name');
      return;
    }
    if (reportType === 'comparison' && communities.filter(c => c.trim()).length < 2) {
      toast.error('Please enter at least 2 community names for comparison');
      return;
    }

    setLoading(true);
    setResult(null);
    setProgress('Submitting…');

    try {
      const form = new FormData();
      form.append('csv_file', csvFile);
      if (rentalCsvFile) form.append('rental_csv_file', rentalCsvFile);
      if (imageFile) form.append('image_file', imageFile);

      form.append('report_type', reportType);
      form.append('agent_id', user!.id);
      form.append('agent_name', profile?.full_name || profile?.name || user!.email || 'EVA Agent');

      if (reportType === 'single') {
        form.append('community_name', communityName.trim());
      } else {
        communities.filter(c => c.trim()).forEach(c => form.append('communities[]', c.trim()));
      }

      if (clientName.trim()) form.append('client_name', clientName.trim());
      form.append('audience', audience);
      if (serviceCharge) form.append('service_charge_psf', serviceCharge);
      if (agentInstruction) form.append('agent_instruction', agentInstruction);
      if (imageFile && personalisationPrompt) form.append('personalisation_prompt', personalisationPrompt);

      // 1. Submit — get jobId immediately
      const res = await fetch(`${API_BASE}/api/market-reports/generate`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.jobId) {
        throw new Error(json.error || json.message || 'Failed to submit report');
      }

      const jobId = json.jobId;
      setProgress('Queued…');

      // 2. Poll status every 4s until done, failed, or 10 min timeout
      const startTime = Date.now();
      const TIMEOUT_MS = 10 * 60 * 1000;
      const POLL_INTERVAL_MS = 4000;

      while (true) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          throw new Error('Report generation timed out after 10 minutes. Please try again.');
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        const statusRes = await fetch(
          `${API_BASE}/api/market-reports/status/${jobId}?agent_id=${encodeURIComponent(user!.id)}`,
        );
        if (!statusRes.ok) {
          // Transient network/server blip — keep polling unless it's been failing repeatedly
          continue;
        }
        const statusJson = await statusRes.json();

        if (statusJson.status === 'completed' && statusJson.report_url) {
          setResult({ report_url: statusJson.report_url, expires_at: statusJson.expires_at });
          setProgress('');
          toast.success('Report generated successfully!');
          break;
        }
        if (statusJson.status === 'failed') {
          throw new Error(statusJson.error || 'Report generation failed');
        }
        if (statusJson.status === 'active') {
          setProgress('Generating your report…');
        } else if (statusJson.status === 'waiting') {
          if (typeof statusJson.position === 'number' && statusJson.position > 0) {
            const minsEstimate = Math.ceil((statusJson.position + 1) * 1.5);
            setProgress(`You're #${statusJson.position + 1} in queue — about ${minsEstimate} min`);
          } else {
            setProgress('Next up — starting soon…');
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong');
      setProgress('');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setCsvFile(null);
    setRentalCsvFile(null);
    setImageFile(null);
    setCommunityName('');
    setCommunities(['', '']);
    setClientName('');
    setAudience('neutral');
    setServiceCharge('');
    setAgentInstruction('');
    setPersonalisationPrompt('');
    setResult(null);
    setProgress('');
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart2 className="text-emerald-700 w-7 h-7" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Market Reports</h1>
          <p className="text-sm text-gray-500">Generate branded PDF market intelligence reports from Property Monitor data</p>
        </div>
      </div>

      {/* Report type toggle */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-700">Report Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              variant={reportType === 'single' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setReportType('single'); setResult(null); }}
              className={reportType === 'single' ? 'bg-emerald-700 hover:bg-emerald-800' : ''}
            >
              Single Community
            </Button>
            <Button
              variant={reportType === 'comparison' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setReportType('comparison'); setResult(null); }}
              className={reportType === 'comparison' ? 'bg-emerald-700 hover:bg-emerald-800' : ''}
            >
              Multi-Area Comparison
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Community name(s) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-700">
            {reportType === 'single' ? 'Community Name' : 'Communities to Compare'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reportType === 'single' ? (
            <Input
              placeholder="e.g. Dubai Hills Estate, Mudon Al Ranim, JVC..."
              value={communityName}
              onChange={e => setCommunityName(e.target.value)}
            />
          ) : (
            <>
              {communities.map((c, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input
                    placeholder={`Community ${idx + 1}`}
                    value={c}
                    onChange={e => updateCommunity(idx, e.target.value)}
                  />
                  {communities.length > 2 && (
                    <Button variant="ghost" size="icon" onClick={() => removeCommunity(idx)}>
                      <X className="w-4 h-4 text-gray-400" />
                    </Button>
                  )}
                </div>
              ))}
              {communities.length < 5 && (
                <Button variant="outline" size="sm" onClick={addCommunity} className="gap-1">
                  <Plus className="w-4 h-4" /> Add Community
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Data files */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-700">Property Monitor Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sales CSV */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Sales Transactions CSV <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => setCsvFile(e.target.files?.[0] || null)}
                />
                <div className="flex items-center gap-2 px-3 py-2 border rounded-md text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  <Upload className="w-4 h-4" />
                  {csvFile ? csvFile.name : 'Upload sales CSV'}
                </div>
              </label>
              {csvFile && (
                <Button variant="ghost" size="icon" onClick={() => setCsvFile(null)}>
                  <X className="w-4 h-4 text-gray-400" />
                </Button>
              )}
            </div>
          </div>

          {/* Rental CSV */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Rental Transactions CSV <span className="text-gray-400">(optional — for yield analysis)</span>
            </label>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => setRentalCsvFile(e.target.files?.[0] || null)}
                />
                <div className="flex items-center gap-2 px-3 py-2 border rounded-md text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  <Upload className="w-4 h-4" />
                  {rentalCsvFile ? rentalCsvFile.name : 'Upload rental CSV'}
                </div>
              </label>
              {rentalCsvFile && (
                <Button variant="ghost" size="icon" onClick={() => setRentalCsvFile(null)}>
                  <X className="w-4 h-4 text-gray-400" />
                </Button>
              )}
            </div>
          </div>

          {/* Agent photo */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Agent Photo <span className="text-gray-400">(optional — appears on cover)</span>
            </label>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => setImageFile(e.target.files?.[0] || null)}
                />
                <div className="flex items-center gap-2 px-3 py-2 border rounded-md text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  <Upload className="w-4 h-4" />
                  {imageFile ? imageFile.name : 'Upload photo'}
                </div>
              </label>
              {imageFile && (
                <Button variant="ghost" size="icon" onClick={() => setImageFile(null)}>
                  <X className="w-4 h-4 text-gray-400" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Options */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-700">Report Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Client Name <span className="text-gray-400">(optional — appears on the cover as "Prepared exclusively for…")</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. Mr. Khaled Al Mansoori"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-2">
              Report Audience <span className="text-gray-400">(determines the tone of the AI narrative)</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {([
                { v: 'neutral', label: 'Neutral / Both' },
                { v: 'seller',  label: "Seller's Briefing" },
                { v: 'buyer',   label: "Buyer's Briefing" },
              ] as const).map(opt => (
                <Button
                  key={opt.v}
                  type="button"
                  variant={audience === opt.v ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAudience(opt.v)}
                  className={audience === opt.v ? 'bg-emerald-700 hover:bg-emerald-800' : ''}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Seller's briefings emphasise reasons to list now. Buyer's briefings emphasise entry-thesis signals. Neutral is balanced.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Service Charge (AED/sqft/year) <span className="text-gray-400">(optional — for net yield)</span>
            </label>
            <Input
              type="number"
              placeholder="e.g. 18"
              value={serviceCharge}
              onChange={e => setServiceCharge(e.target.value)}
              className="w-40"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Instructions for AI Narrative
            </label>
            <Textarea
              placeholder="e.g. Highlight the strong rental demand from tech professionals. Mention the new metro station opening nearby. Focus on villa performance over apartments."
              value={agentInstruction}
              onChange={e => setAgentInstruction(e.target.value)}
              rows={3}
              className="text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              These instructions guide the AI-written executive summary and market outlook sections.
            </p>
          </div>

          {imageFile && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Personalisation Note <span className="text-gray-400">(shown with your photo)</span>
              </label>
              <Textarea
                placeholder="e.g. I specialise in villa communities across Dubai South and have helped 40+ families find their perfect home here."
                value={personalisationPrompt}
                onChange={e => setPersonalisationPrompt(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate button */}
      <div className="flex gap-3">
        <Button
          onClick={handleSubmit}
          disabled={loading}
          className="bg-emerald-700 hover:bg-emerald-800 gap-2 px-6"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating Report…
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" />
              Generate Report
            </>
          )}
        </Button>
        {result && (
          <Button variant="outline" onClick={resetForm}>
            New Report
          </Button>
        )}
      </div>

      {loading && progress && (
        <p className="text-xs text-gray-500 italic -mt-3">{progress}</p>
      )}

      {/* Result */}
      {result && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-emerald-800 text-sm mb-1">✓ Report Ready</p>
                <p className="text-xs text-gray-500">
                  Link expires: {result.expires_at ? new Date(result.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A'}
                </p>
              </div>
              <a
                href={result.report_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800 gap-2">
                  <Download className="w-4 h-4" />
                  Open PDF
                </Button>
              </a>
            </div>
            <div className="mt-3 p-2 bg-white rounded border border-emerald-100">
              <p className="text-xs text-gray-500 break-all">{result.report_url}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MarketReports;
