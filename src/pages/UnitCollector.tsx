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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { toUAETime } from '@/lib/uaeTime';
import { Switch } from '@/components/ui/switch';
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
  const nonEmpty = sampleValues.filter(v => v?.trim());
  if (nonEmpty.length === 0) return false;
  return nonEmpty.filter(looksLikePhone).length / nonEmpty.length >= 0.6;
};

const cleanPhone = (raw: string): string | null => {
  if (!raw) return null;
  let str = String(raw).trim();
  if (/^[\d.]+[eE][+\-]?\d+$/.test(str)) {
    try { str = String(Math.round(Number(str))); } catch { return null; }
  }
  let num = str.replace(/[\s\-\(\)\.\+\/\|]/g, '');
  if (num.startsWith('00')) num = num.slice(2);
  if (!/^\d+$/.test(num)) return null;
  if (num.startsWith('00971')) num = '971' + num.slice(5);
  else if (/^9710\d{9}$/.test(num)) num = '971' + num.slice(4);
  else if (num.startsWith('0') && num.length === 10) num = '971' + num.slice(1);
  else if (/^[5-9]\d{8}$/.test(num)) num = '971' + num;
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
    if (result.errors.length > 0) throw new Error('CSV parse error: ' + result.errors[0].message);
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

  const nameColIdx = (() => {
    // Priority: columns explicitly about the owner/client/landlord
    const priority = headers.findIndex(h =>
      h.includes('owner') || h.includes('client') || h.includes('landlord') ||
      h.includes('contact') || h.includes('fullname') || h.includes('full name')
    );
    if (priority >= 0) return priority;
    // Fallback: any 'name' column that isn't a building/project/tower
    return headers.findIndex(h =>
      h.includes('name') &&
      !h.includes('building') && !h.includes('project') &&
      !h.includes('tower') && !h.includes('company') && !h.includes('firm')
    );
  })();
  const buildingColIdx = headers.findIndex(h =>
    h.includes('building') || h.includes('tower') || h.includes('property') ||
    h.includes('project') || h.includes('community') || h.includes('development')
  );
  const unitColIdx = headers.findIndex(h =>
    h.includes('unit') || h.includes('apartment') || h.includes('flat') ||
    h.includes('apt') || h.includes('room') || h.includes('suite') ||
    h.includes('no.') || h === 'no' || h.includes('number') || h.includes('ref') ||
    h.includes('#') || h.includes('plot')
  );

  const mapping: ColumnMapping = {
    phoneColumns:   phoneColIndexes.map(i => rawHeaders[i]),
    nameColumn:     nameColIdx >= 0     ? rawHeaders[nameColIdx]     : null,
    buildingColumn: buildingColIdx >= 0 ? rawHeaders[buildingColIdx] : null,
  };

  const contacts: ParsedRow[] = [];
  for (const row of data) {
    const vals         = rawHeaders.map(h => (row[h] || '').trim());
    const ownerName    = nameColIdx >= 0     ? (vals[nameColIdx]     || '') : '';
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

// ── Message variation engine ──────────────────────────────────────────────────
// Generates 100+ genuinely unique variants of a single template.
// Fully deterministic — same (message, index) always produces same output.
// Never touches proper nouns, numbers, or substituted placeholder values.

// ── Pseudo-random helpers ─────────────────────────────────────────────────────
// Wang hash spreads index+salt into independent streams so different variation
// axes don't lock-step (message 0 doesn't always pick option[0] everywhere).
const _hash = (n: number, salt: number): number => {
  let h = (((n * 2654435761) >>> 0) ^ ((salt * 40503) >>> 0)) >>> 0;
  h = (((h >>> 16) ^ h) * 1664525) >>> 0;
  h = ((h >>> 16) ^ h) >>> 0;
  return h;
};
const _pick = <T,>(arr: T[], index: number, salt: number): T =>
  arr[_hash(index, salt) % arr.length];
const _chance = (index: number, salt: number, pct: number): boolean =>
  (_hash(index, salt) % 100) < pct;

// ── Greeting rotation ─────────────────────────────────────────────────────────
const GREETING_SWAPS: [RegExp, string[]][] = [
  [/^Hi\b/m,             ['Hi', 'Hello', 'Hey', 'Good day']],
  [/^Hello\b/m,          ['Hello', 'Hi', 'Good day', 'Hey']],
  [/^Hey\b/m,            ['Hey', 'Hi', 'Hello', 'Good day']],
  [/^Dear\b/m,           ['Dear', 'Hi', 'Hello']],
  [/^Good day\b/m,       ['Good day', 'Hello', 'Hi', 'Hey']],
  [/^Good morning\b/m,   ['Good morning', 'Good day', 'Hello', 'Hi']],
  [/^Good afternoon\b/m, ['Good afternoon', 'Good day', 'Hello', 'Hi']],
];

// ── Synonym swap table ────────────────────────────────────────────────────────
// Each entry: [pattern, alternatives[]].
// Each swap uses a unique salt so choices are independent across swaps.
const SYNONYM_SWAPS: [RegExp, string[]][] = [
  // Reach-out openers
  [/I wanted to reach out/gi,
    ['I am reaching out', 'I wanted to get in touch', 'I thought to connect with you',
     'I am writing to you', 'I decided to get in touch', 'I took a moment to reach out']],
  [/I am reaching out/gi,
    ['I wanted to reach out', 'I wanted to get in touch', 'I am contacting you',
     'I thought to connect', 'I decided to reach out']],
  [/I wanted to get in touch/gi,
    ['I am reaching out', 'I wanted to reach out', 'I thought to connect',
     'I am writing to you', 'I took a moment to get in touch']],
  [/I thought to get in touch/gi,
    ['I wanted to reach out', 'I am reaching out', 'I wanted to connect']],
  [/I am writing to you/gi,
    ['I wanted to reach out', 'I am reaching out', 'I wanted to get in touch']],

  // Polite call-to-action
  [/please feel free to/gi,
    ['please do not hesitate to', 'you are welcome to', 'feel free to',
     'please go ahead and', 'you can always']],
  [/\bfeel free to\b/gi,
    ['please do not hesitate to', 'please feel free to', 'you are welcome to', 'go ahead and']],
  [/do not hesitate to/gi,
    ['feel free to', 'please feel free to', 'you are welcome to', 'please go ahead and']],
  [/don't hesitate to/gi,
    ['feel free to', 'please feel free to', 'you are welcome to', 'go ahead and']],

  // Convenience / timing
  [/at your earliest convenience/gi,
    ['whenever suits you', 'at a time that works for you', 'whenever you are free',
     'when you get a chance', 'whenever it suits you', 'at a time convenient for you']],
  [/whenever suits you/gi,
    ['at your earliest convenience', 'when it works for you', 'whenever you are free',
     'at a time that suits you', 'at your convenience']],
  [/when you get a chance/gi,
    ['whenever suits you', 'at your earliest convenience', 'when it suits you',
     'at a time that works for you']],
  [/at a time that works for you/gi,
    ['whenever suits you', 'at your earliest convenience', 'whenever you are free']],

  // Willingness
  [/would love to/gi,
    ['would be happy to', 'would be glad to', 'would like to', 'would be delighted to']],
  [/would be happy to/gi,
    ['would love to', 'would be glad to', 'would like to', 'would be delighted to']],
  [/would be glad to/gi,
    ['would love to', 'would be happy to', 'would like to', 'would be more than happy to']],
  [/I'd love to/gi,
    ["I'd be happy to", 'I would be glad to', 'I would like to', "I'd be delighted to"]],
  [/I'd be happy to/gi,
    ["I'd love to", 'I would be glad to', 'I would like to']],

  // Call / meeting
  [/a quick call/gi,
    ['a brief call', 'a quick chat', 'a short call', 'a brief chat',
     'a short conversation', 'a quick conversation']],
  [/a brief call/gi,
    ['a quick call', 'a short chat', 'a quick chat', 'a brief conversation', 'a short call']],
  [/a quick chat/gi,
    ['a quick call', 'a brief call', 'a brief chat', 'a short conversation', 'a brief conversation']],
  [/a 5.minute call/gi,
    ['a quick call', 'a brief 5-minute chat', 'a short call', 'a quick 5-minute conversation']],
  [/a 10.minute call/gi,
    ['a brief call', 'a quick 10-minute chat', 'a short call']],

  // Follow-up / response
  [/\blet me know\b/gi,
    ['do let me know', 'feel free to let me know', 'drop me a message', 'send me a message']],
  [/\bget back to me\b/gi,
    ['reach out', 'let me know', 'drop me a message', 'send me a note']],
  [/reach out to me/gi,
    ['get in touch', 'drop me a message', 'let me know', 'send me a message']],

  // Closing pleasantries
  [/I look forward to hearing from you/gi,
    ['Looking forward to your response', 'I hope to hear from you soon',
     'Looking forward to connecting', 'I look forward to connecting with you']],
  [/Looking forward to hearing from you/gi,
    ['I look forward to your response', 'Hope to hear from you soon',
     'Looking forward to connecting', 'I look forward to speaking with you']],
  [/I hope to hear from you soon/gi,
    ['Looking forward to hearing from you', 'I look forward to connecting', 'Hope to connect soon']],

  // Opener pleasantries
  [/I hope this message finds you well/gi,
    ['I hope you are doing well', 'I trust you are keeping well',
     'Hope all is well with you', 'I hope you are well']],
  [/I hope you are doing well/gi,
    ['I hope this message finds you well', 'I trust you are keeping well',
     'Hope all is well', 'I hope you are keeping well']],
  [/Hope all is well/gi,
    ['I hope you are doing well', 'I hope this message finds you well',
     'I trust you are well', 'I hope you are keeping well']],
  [/I trust you are keeping well/gi,
    ['I hope you are doing well', 'I hope this message finds you well', 'Hope all is well']],

  // Awareness
  [/As you may know/gi,
    ['As you may be aware', 'You may already know that', 'As you might know', 'As you are likely aware']],
  [/As you may be aware/gi,
    ['As you may know', 'You might already know', 'As you might be aware', 'As you are likely aware']],

  // Time words
  [/\bshortly\b/gi, ['soon', 'in the coming days', 'before long', 'in the near future']],
  [/\bsoon\b/gi,    ['shortly', 'in the coming days', 'before long', 'in the near future']],
  [/\bthis week\b/gi, ['in the coming days', 'over the next few days', 'in the next few days']],
  [/\bin the coming days\b/gi, ['shortly', 'soon', 'over the next few days', 'in the near future']],

  // Real-estate phrases
  [/\bthe current market\b/gi,
    ["today's market", 'the present market', 'the current market conditions', 'the market today']],
  [/\btoday's market\b/gi,
    ['the current market', 'the present market', 'the market right now', 'the current market landscape']],
  [/\bmarket conditions\b/gi,
    ['market trends', 'market dynamics', 'market conditions', 'current market landscape']],
  [/\bmarket value\b/gi,
    ['market price', 'current value', 'current market value', 'estimated market value']],
  [/\bgreat opportunity\b/gi,
    ['excellent opportunity', 'fantastic opportunity', 'a strong opportunity', 'a remarkable opportunity']],
  [/\bexcellent opportunity\b/gi,
    ['great opportunity', 'fantastic opportunity', 'a strong opportunity', 'a wonderful opportunity']],
  [/\bstrong demand\b/gi,
    ['high demand', 'solid demand', 'great demand', 'significant demand']],
  [/\bhigh demand\b/gi,
    ['strong demand', 'solid demand', 'significant demand', 'great demand']],
  [/\bprime location\b/gi,
    ['excellent location', 'great location', 'sought-after location', 'desirable location']],
  [/\bsignificant returns\b/gi,
    ['strong returns', 'great returns', 'solid returns', 'excellent returns']],
  [/\bstrong returns\b/gi,
    ['significant returns', 'great returns', 'solid returns', 'excellent returns']],
  [/\bat this time\b/gi,
    ['at the moment', 'currently', 'right now', 'at present']],
  [/\bat the moment\b/gi,
    ['at this time', 'currently', 'right now', 'at present']],
  [/\bcurrently\b/gi,
    ['at the moment', 'at this time', 'right now', 'presently']],
  [/\bI understand\b/gi,
    ['I appreciate', 'I recognise', 'I know']],
  [/\bI appreciate\b/gi,
    ['I understand', 'I recognise', 'I value']],
  [/\bI wanted to share\b/gi,
    ['I thought to share', 'I wanted to let you know', 'I am reaching out to share']],
  [/\bI wanted to let you know\b/gi,
    ['I wanted to share', 'I thought to let you know', 'I am reaching out to let you know']],
  [/\bno obligation\b/gi,
    ['no commitment', 'no pressure', 'with no commitment']],
  [/\bno commitment\b/gi,
    ['no obligation', 'no pressure', 'absolutely no obligation']],
  [/\bno pressure\b/gi,
    ['no obligation', 'no commitment', 'absolutely no pressure']],
  [/\ba valuable asset\b/gi,
    ['an important asset', 'a significant asset', 'one of your key assets']],
  [/\bI would be happy\b/gi,
    ['I would be glad', 'I would love', 'I would be delighted']],
  [/\bI would be glad\b/gi,
    ['I would be happy', 'I would love', 'I would be more than happy']],
  [/\bI can assist\b/gi,
    ['I can help', 'I am able to help', 'I would be happy to assist']],
  [/\bI can help\b/gi,
    ['I can assist', 'I am here to help', 'I would be happy to help']],
  [/\bI have experience\b/gi,
    ['I have extensive experience', 'I have hands-on experience', 'I have a strong background']],
  [/\bour team\b/gi,
    ['my team', 'our dedicated team', 'our experienced team']],
  [/\bmy team\b/gi,
    ['our team', 'my dedicated team', 'the team at EVA']],
];

// ── Contraction alternation ───────────────────────────────────────────────────
// Even-index messages: expand contractions → more formal
// Odd-index messages: contract expansions → more casual
const CONTRACTIONS_TO_EXPAND: [RegExp, string][] = [
  [/\bI'm\b/g,       "I am"],   [/\bI've\b/g,   "I have"],
  [/\bI'd\b/g,       "I would"], [/\bI'll\b/g,   "I will"],
  [/\bdon't\b/g,     "do not"],  [/\bcan't\b/g,  "cannot"],
  [/\bwon't\b/g,     "will not"],[/\bwe're\b/g,  "we are"],
  [/\byou're\b/g,    "you are"], [/\byou've\b/g, "you have"],
  [/\byou'll\b/g,    "you will"],[/\bit's\b/g,   "it is"],
  [/\bthat's\b/g,    "that is"], [/\bthere's\b/g,"there is"],
  [/\bwouldn't\b/g,  "would not"],[/\bcouldn't\b/g,"could not"],
  [/\bshouldn't\b/g, "should not"],[/\bisn't\b/g, "is not"],
  [/\baren't\b/g,    "are not"],  [/\bhasn't\b/g,"has not"],
  [/\bhaven't\b/g,   "have not"],
];

const EXPANSIONS_TO_CONTRACT: [RegExp, string][] = [
  [/\bI am\b/g,      "I'm"],    [/\bI have\b/g,  "I've"],
  [/\bI would\b/g,   "I'd"],    [/\bI will\b/g,  "I'll"],
  [/\bdo not\b/g,    "don't"],  [/\bcannot\b/g,  "can't"],
  [/\bwill not\b/g,  "won't"],  [/\bwe are\b/g,  "we're"],
  [/\byou are\b/g,   "you're"], [/\byou have\b/g,"you've"],
  [/\byou will\b/g,  "you'll"], [/\bit is\b/g,   "it's"],
  [/\bthat is\b/g,   "that's"], [/\bthere is\b/g,"there's"],
  [/\bwould not\b/g, "wouldn't"],[/\bcould not\b/g,"couldn't"],
  [/\bshould not\b/g,"shouldn't"],[/\bis not\b/g, "isn't"],
  [/\bare not\b/g,   "aren't"],  [/\bhas not\b/g,"hasn't"],
  [/\bhave not\b/g,  "haven't"],
];

// ── Number word alternation ───────────────────────────────────────────────────
const TO_WORDS: [RegExp, string][] = [
  [/\b5 minutes\b/gi,  'five minutes'],  [/\b10 minutes\b/gi, 'ten minutes'],
  [/\b15 minutes\b/gi, 'fifteen minutes'],[/\b30 minutes\b/gi, 'half an hour'],
  [/\b5 years\b/gi,    'five years'],    [/\b10 years\b/gi,   'ten years'],
  [/\b2 years\b/gi,    'two years'],     [/\b3 years\b/gi,    'three years'],
  [/\b5 min\b/gi,      'five minutes'],  [/\b10 min\b/gi,     'ten minutes'],
];

const TO_DIGITS: [RegExp, string][] = [
  [/\bfive minutes\b/gi,    '5 minutes'],  [/\bten minutes\b/gi,    '10 minutes'],
  [/\bfifteen minutes\b/gi, '15 minutes'], [/\bhalf an hour\b/gi,   '30 minutes'],
  [/\bfive years\b/gi,      '5 years'],    [/\bten years\b/gi,      '10 years'],
  [/\btwo years\b/gi,       '2 years'],    [/\bthree years\b/gi,    '3 years'],
];

// ── Floating context sentences ────────────────────────────────────────────────
// Generic Dubai market sentences inserted between paragraphs to increase
// message length and structural uniqueness. Picked deterministically.
const FLOATING_SENTENCES = [
  'The Dubai property market has seen consistent demand from both local and international buyers.',
  'Rental yields in Dubai remain among the highest globally, attracting strong investor interest.',
  "With Expo City's legacy and continued infrastructure development, property values in many communities have held firm.",
  'Demand for well-located residential units in Dubai has remained resilient across market cycles.',
  'Many property owners in Dubai are finding this to be an opportune moment to review their options.',
  'The secondary market in Dubai has been particularly active in recent months.',
  "Dubai's property market continues to draw interest from investors across the region and beyond.",
  "With no property tax and strong rental demand, Dubai remains one of the world's most attractive markets.",
  'Transactional volumes in Dubai have been on a steady upward trend over the past year.',
  'The strong pipeline of new residents and businesses moving to Dubai continues to support demand.',
  "Rental prices in many of Dubai's established communities have seen upward movement this year.",
  'Long-term ownership trends in Dubai point to continued capital appreciation in well-located areas.',
  'Many savvy investors and homeowners are actively reviewing their real estate positions right now.',
  "Dubai's transparent property laws and freehold ownership rules continue to attract global interest.",
  'As the city grows and infrastructure matures, well-located units tend to benefit the most.',
  "The combination of a strong economy and population growth underpins Dubai's property fundamentals.",
  'Off-plan completions in recent years have added quality stock while demand has kept pace.',
  'Real estate remains one of the most popular asset classes among high-net-worth individuals in the UAE.',
  "Dubai's status as a global business hub continues to underpin strong demand for quality residential units.",
  "Owners who engage with the market now are often better positioned to capitalise on the city's growth trajectory.",
];

// ── P.S. pool ─────────────────────────────────────────────────────────────────
const PS_LINES = [
  'P.S. If you would like a free valuation of your unit, I am happy to arrange one — no cost, no obligation.',
  'P.S. Happy to share recent comparable sales in your building if that would be useful.',
  'P.S. If you are simply curious about what your unit is worth today, I can give you a quick overview.',
  'P.S. I can share recent market data specific to your community if you are interested.',
  'P.S. Even if you are not looking to make a move right now, knowing your property value is always useful.',
  'P.S. A quick 5-minute call is all it takes — no pressure, no obligation.',
  'P.S. I work with a number of owners in your building and would be glad to share insights.',
  'P.S. If timing is not right for you now, I am happy to stay in touch for when it is.',
  'P.S. I can also connect you with our mortgage and financial advisory team if relevant.',
  'P.S. We have a strong network of qualified buyers actively looking in this community right now.',
  'P.S. I have helped several owners in your building navigate both rentals and sales — happy to share more.',
  'P.S. Feel free to save my number for whenever the timing works for you.',
  'P.S. No catch — just a genuine offer to help you understand your options.',
  'P.S. I send very few messages — only when I believe it is genuinely worth your time.',
];

// ── Closing variants ──────────────────────────────────────────────────────────
const CLOSING_VARIANTS = [
  'Looking forward to connecting with you.',
  'I look forward to hearing from you.',
  'Please feel free to reach out at any time.',
  'Do not hesitate to get in touch.',
  'Happy to answer any questions you may have.',
  'Hope to hear from you soon.',
  'Feel free to message me anytime.',
  'Happy to have a quick chat whenever suits you.',
  'I look forward to speaking with you.',
  'Reach out anytime — happy to help.',
  'I hope to connect with you soon.',
  'Do reach out whenever you are ready.',
  'Looking forward to the opportunity to assist you.',
  'Happy to be of service whenever the time is right.',
  'I am here whenever you need any guidance.',
  'Feel free to get in touch — I am always happy to help.',
  'Looking forward to a productive conversation.',
  'I hope we get the chance to connect.',
  'Always happy to have a no-pressure conversation.',
  'Here whenever you need me.',
];

// Minimum character length — ensures there is enough text to vary meaningfully
const MIN_MESSAGE_LENGTH = 320;

const applyLocalVariation = (message: string, index: number): string => {
  let varied = message;

  // 1. Rotate greeting word
  for (const [pattern, alts] of GREETING_SWAPS) {
    if (pattern.test(varied)) {
      varied = varied.replace(pattern, _pick(alts, index, 0));
      break;
    }
  }

  // 2. Synonym swaps — each has a unique salt for independent selection
  SYNONYM_SWAPS.forEach(([pattern, alts], salt) => {
    if (pattern.test(varied)) {
      varied = varied.replace(pattern, _pick(alts, index, salt + 1));
    }
  });

  // 3. Contraction mode — formal (expanded) on even indexes, casual on odd
  if (index % 2 === 0) {
    CONTRACTIONS_TO_EXPAND.forEach(([pat, exp]) => { varied = varied.replace(pat, exp); });
  } else {
    EXPANSIONS_TO_CONTRACT.forEach(([pat, con]) => { varied = varied.replace(pat, con); });
  }

  // 4. Number word alternation — words on multiples of 3, digits otherwise
  if (index % 3 === 0) {
    TO_WORDS.forEach(([pat, word]) => { varied = varied.replace(pat, word); });
  } else {
    TO_DIGITS.forEach(([pat, digit]) => { varied = varied.replace(pat, digit); });
  }

  // 5. Pad to minimum length — insert floating market sentences between paragraphs
  const paras = varied.split(/\n\n+/);
  let padCount = 0;
  while (varied.length < MIN_MESSAGE_LENGTH && padCount < 3) {
    const sentence = _pick(FLOATING_SENTENCES, index, 50 + padCount);
    // Insert after the first paragraph so the opening stays intact
    if (paras.length > 1) {
      paras.splice(1 + padCount, 0, sentence);
    } else {
      paras.push(sentence);
    }
    varied = paras.join('\n\n');
    padCount++;
  }

  // 6. Append a closing if the message does not already have one
  const hasClosing = /looking forward|feel free|don.?t hesitate|reach out|get in touch|happy to|hear from you|message me|speak with you|here whenever|stay in touch/i.test(varied);
  if (!hasClosing) {
    varied = varied.trimEnd() + '\n\n' + _pick(CLOSING_VARIANTS, index, 11);
  }

  // 7. P.S. line — appears on ~45% of messages
  if (_chance(index, 99, 45)) {
    varied = varied.trimEnd() + '\n\n' + _pick(PS_LINES, index, 77);
  }

  // 8. Micro punctuation nudges — em-dash vs hyphen alternation
  if (index % 2 === 0) {
    varied = varied.replace(/ — /g, ' - ');
  } else {
    varied = varied.replace(/ - /g, ' — ');
  }

  return varied;
};


// ── Gemini personalisation ────────────────────────────────────────────────────

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.0-flash-lite',
];

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const personaliseWithGemini = async (
  message: string,
  geminiKey: string,
  modelIndex = 0,
  attempt = 0
): Promise<{ text: string; succeeded: boolean }> => {
  const model = GEMINI_MODELS[modelIndex] ?? GEMINI_MODELS[0];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const prompt = 'You are lightly personalising a WhatsApp outreach message for a real estate agent at EVA Real Estate in Dubai. Make only small, natural tweaks so each message feels slightly different — swap a word or two, vary punctuation lightly, or change a minor phrase. Do NOT restructure sentences, change the meaning, add new content, or alter the tone. The output must be nearly identical to the input in length and structure. CRITICAL: Do NOT change, remove, or paraphrase any proper nouns — especially people names, building names, unit numbers, or agent names. If the message contains a name like Ahmed or a building like Marina Gate, keep it exactly as is. Return only the message text with no commentary, labels, or explanation.\n\nMessage:\n\n' + message;

    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + geminiKey,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4 },
        }),
      }
    );
    clearTimeout(timeoutId);

    if (res.status === 429) {
      if (attempt < 3) {
        const backoff = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn('[Gemini] 429 on ' + model + ', retrying in ' + Math.round(backoff) + 'ms');
        await sleep(backoff);
        return personaliseWithGemini(message, geminiKey, modelIndex, attempt + 1);
      }
      if (modelIndex + 1 < GEMINI_MODELS.length) {
        return personaliseWithGemini(message, geminiKey, modelIndex + 1, 0);
      }
      return { text: message, succeeded: false };
    }

    if (res.status === 404 && modelIndex + 1 < GEMINI_MODELS.length) {
      return personaliseWithGemini(message, geminiKey, modelIndex + 1, 0);
    }

    if (!res.ok) {
      return { text: message, succeeded: false };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!text) return { text: message, succeeded: false };

    const hadPlaceholders = /\{\{[^}]+\}\}/.test(message);
    const keptPlaceholders = /\{\{[^}]+\}\}/.test(text);
    if (hadPlaceholders && !keptPlaceholders) {
      return { text: message, succeeded: false };
    }

    return { text, succeeded: true };
  } catch (err: any) {
    console.error('[Gemini] Error on ' + model + ':', err?.message ?? err);
    return { text: message, succeeded: false };
  }
};

const personaliseAllWithGemini = async (
  messages: string[],
  geminiKey: string,
  onProgress: (done: number, total: number) => void
): Promise<string[]> => {
  const DELAY_MS = 800;
  const results: string[] = new Array(messages.length);
  let aiCount = 0;
  let localCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const { text, succeeded } = await personaliseWithGemini(messages[i], geminiKey);
    if (succeeded) {
      results[i] = text;
      aiCount++;
    } else {
      results[i] = applyLocalVariation(messages[i], i);
      localCount++;
    }
    onProgress(i + 1, messages.length);
    if (i < messages.length - 1) await sleep(DELAY_MS);
  }

  console.log('[Gemini] Complete — ' + aiCount + ' AI rewrites, ' + localCount + ' local-variation fallbacks');
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

  const [batchName, setBatchName]           = useState('');
  const [file, setFile]                     = useState<File | null>(null);
  const [fileMapping, setFileMapping]       = useState<ColumnMapping | null>(null);
  const [fileMappingPreview, setFileMappingPreview] = useState(false);
  const [templates, setTemplates]           = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [sendButtons, setSendButtons]           = useState(true);
  const [agents, setAgents]                 = useState<any[]>([]);
  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [parsedRows, setParsedRows]         = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError]         = useState<string | null>(null);

  const [batches, setBatches]               = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [cancelBatchId, setCancelBatchId]   = useState<string | null>(null);
  const [cancellingBatch, setCancellingBatch] = useState(false);

  const [viewingBatch, setViewingBatch]     = useState<string | null>(null);
  const [contacts, setContacts]             = useState<any[]>([]);
  const [filterStatus, setFilterStatus]     = useState('');
  const [filterAgent, setFilterAgent]       = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);

  const [previewContact, setPreviewContact] = useState<any>(null);
  const [previewMessage, setPreviewMessage] = useState('');
  const [savingPreview, setSavingPreview]   = useState(false);

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [templatesRes, batchesRes, allProfilesRes] = await Promise.all([
      isAdmin
        ? supabase.from('message_templates').select('*')
        : supabase.from('message_templates').select('*').eq('created_by', user.id),
      isAdmin
        ? supabase.from('batches').select('*, completed_at').order('upload_date', { ascending: false })
        : supabase.from('batches').select('*, completed_at').eq('uploaded_by', user.id).order('upload_date', { ascending: false }),
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

    setBatches(mapped.filter((b: any) => b.pending_count > 0 || b.sent_count > 0));

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

  // Replace all known placeholder formats (raw {{}} and friendly [] and accidental ())
  // Case-insensitive so agents can type [owner name] or [Owner Name] freely.
  const subAll = (text: string, patterns: string[], value: string): string => {
    let t = text;
    for (const p of patterns) {
      t = t.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), value);
    }
    return t;
  };
  const substituteTemplate = (template: string, row: ParsedRow, agentName: string): string => {
    let t = template;
    t = subAll(t, ['{{owner_name}}', '[Owner Name]', '(Owner Name)', '[owner name]', '(owner name)', '{{owner name}}'], row.owner_name || '');
    t = subAll(t, ['{{building_name}}', '[Building Name]', '(Building Name)', '[building name]', '(building name)', '{{building name}}'], row.building_name || '');
    t = subAll(t, [
      '{{unit_number}}', '[Unit Number]', '(Unit Number)', '[unit number]', '(unit number)',
      '[Unit No]', '(Unit No)', '{{unit number}}', '[Unit No.]', '(Unit No.)',
      '[Apt No]', '(Apt No)', '[Apt Number]', '(Apt Number)',
      '[unit no]', '(unit no)', '[unit #]', '(unit #)', '[Unit #]', '(Unit #)',
    ], row.unit_number || '');
    t = subAll(t, ['{{agent_first_name}}', '[Agent Name]', '(Agent Name)', '[agent name]', '(agent name)', '[Agent First Name]', '{{agent first name}}'], agentName || '');
    return t;
  };

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

      const seen = new Set<string>();
      const deduped = rows.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });
      const dupeCount = rows.length - deduped.length;
      if (dupeCount > 0) toast.info('Removed ' + dupeCount + ' duplicate phone number' + (dupeCount > 1 ? 's' : '') + ' — each number will only receive one message.');
      rows = deduped;

      const template = templates.find(t => t.id === selectedTemplate);
      if (!template) { toast.error('Template not found'); setUploading(false); return; }

      const { data: batch, error: batchError } = await supabase.from('batches').insert({
        batch_name:      batchName,
        uploaded_by:     user!.id,
        total_contacts:  rows.length,
        pending_count:   rows.length,
        send_poll:       sendButtons,
      }).select().single();
      if (batchError) throw batchError;

      const agentName = profile?.first_name || '';
      const baseMsgs = rows.map(r => substituteTemplate(template.body, r, agentName));

      // Apply light local variation (word-swap only — no AI rewriting)
      const finalMsgs: string[] = baseMsgs.map((msg, i) => applyLocalVariation(msg, i));

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

      toast.success(contactInserts.length + ' contacts added');
      setBatchName('');
      setFile(null);
      setFileMapping(null);
      setFileMappingPreview(false);
      setParsedRows(null);
      setUploadProgress('');
      setSendButtons(true);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
      setUploadProgress('');
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
      await supabase.from('batches').update({ pending_count: 0 }).eq('id', batchId);
      setBatches(prev => prev.filter(b => b.id !== batchId));
      setCancelBatchId(null);
      toast.success('Batch cancelled');
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel batch');
    }
    setCancellingBatch(false);
  };

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

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin w-8 h-8 text-primary" />
    </div>
  );

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
                      className={'cursor-pointer hover:bg-muted/50 ' + (isPendingOrEditable(c) || c.message_status === 'sent' ? '' : 'opacity-60')}
                      onClick={() => openPreview(c)}
                    >
                      <TableCell>{c.owner_name}</TableCell>
                      <TableCell>{c.building_name}</TableCell>
                      <TableCell className="font-mono text-sm">{c.number_1}</TableCell>
                      {isAdmin && <TableCell>{c.agent_profile ? c.agent_profile.first_name + ' ' + c.agent_profile.last_name : ''}</TableCell>}
                      <TableCell className="max-w-[180px] text-sm text-muted-foreground truncate">
                        {c.generated_message?.slice(0, 60)}{(c.generated_message?.length || 0) > 60 ? '...' : ''}
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

        <Dialog open={!!previewContact} onOpenChange={(open) => { if (!open) setPreviewContact(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {previewContact?.message_status === 'sent' ? 'Sent Message' : 'Preview and Edit Message'}
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

  return (
    <div className="space-y-8">

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
              UAE local formats (05xxxxxxxx) and international numbers with country code are all supported.
            </p>
          </div>

          {fileMapping && fileMappingPreview && !parseError && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm space-y-1">
              <p className="font-semibold text-blue-800">Detected column mapping:</p>
              <p className="text-blue-700">
                Phone columns: <span className="font-mono">{fileMapping.phoneColumns.join(', ')}</span>
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
            {(() => {
              const tmpl = templates.find(t => t.id === selectedTemplate);
              if (!tmpl) return null;
              const len = (tmpl.body || '').length;
              return (
                <p className={'text-xs mt-1 font-medium ' + (len > 1024 ? 'text-red-500' : len > 600 ? 'text-amber-500' : 'text-green-600')}>
                  {len} characters{len > 1024 ? ' — ⚠️ very long; consider shortening' : len > 600 ? ' — getting long, keep it concise' : ' — good length'}
                </p>
              );
            })()}
          </div>

          {/* Reply buttons toggle */}
          <div className="flex items-start gap-3 rounded-lg border p-3 bg-muted/30">
            <Switch
              id="send-buttons"
              checked={sendButtons}
              onCheckedChange={setSendButtons}
              className="mt-0.5"
            />
            <div>
              <label htmlFor="send-buttons" className="text-sm font-medium cursor-pointer">
                Send reply buttons with outreach message
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Recipients receive 3 tap-to-reply buttons:
                <span className="font-medium"> Sell &middot; Rent &middot; Not interested</span>.
                Responses are handled automatically — opted-out numbers are suppressed,
                and interested owners get a personalised follow-up.
              </p>
            </div>
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

      {(() => {
        const activeBatches    = batches.filter(b => b.pending_count > 0);
        const completedBatches = batches.filter(b => b.pending_count === 0 && b.sent_count > 0);

        const BatchTable = ({ rows, showCompleted }: { rows: any[]; showCompleted: boolean }) => (
          rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No {showCompleted ? 'completed' : 'active'} batches</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Batch Name</TableHead>
                  {isAdmin && <TableHead>Uploaded By</TableHead>}
                  <TableHead>{showCompleted ? 'Completed at' : 'Date (UAE)'}</TableHead>
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
                  {rows.map(b => {
                    const status = getBatchStatus(b);
                    const pct    = b.total_contacts > 0 ? (b.sent_count / b.total_contacts) * 100 : 0;
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.batch_name}</TableCell>
                        {isAdmin && <TableCell>{b.uploader?.first_name} {b.uploader?.last_name}</TableCell>}
                        <TableCell className="text-sm">
                          {showCompleted
                            ? (b.completed_at ? toUAETime(b.completed_at) : '—')
                            : toUAETime(b.upload_date)}
                        </TableCell>
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
                            {!showCompleted && b.pending_count > 0 && (
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
          )
        );

        return (
          <Card>
            <CardHeader>
              <CardTitle>{isAdmin ? 'Batches' : 'Your Batches'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="active">
                <TabsList className="mb-4">
                  <TabsTrigger value="active">Active ({activeBatches.length})</TabsTrigger>
                  <TabsTrigger value="completed">Completed ({completedBatches.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="active">
                  <BatchTable rows={activeBatches} showCompleted={false} />
                </TabsContent>
                <TabsContent value="completed">
                  <BatchTable rows={completedBatches} showCompleted={true} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        );
      })()}

      <Dialog open={!!cancelBatchId} onOpenChange={() => setCancelBatchId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel Batch?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {cancelBatchId && (() => {
              const b = batches.find(b => b.id === cancelBatchId);
              const count = b ? b.pending_count || 0 : 0;
              return count + ' pending messages will not be sent. Are you sure?';
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
