// Bidirectional conversion between raw Supabase template syntax and friendly UI labels

const PLACEHOLDER_MAP = [
  { raw: '{{owner_name}}',       friendly: '[Owner Name]'   },
  { raw: '{{building_name}}',    friendly: '[Building Name]'},
  { raw: '{{unit_number}}',      friendly: '[Unit Number]'  },
  { raw: '{{agent_first_name}}', friendly: '[Agent Name]'   },
] as const;

/** Convert stored raw {{placeholders}} → friendly [Labels] for display */
export const toFriendly = (text: string): string =>
  PLACEHOLDER_MAP.reduce((t, p) => t.split(p.raw).join(p.friendly), text);

/** Convert friendly [Labels] → raw {{placeholders}} before saving to Supabase */
export const toRaw = (text: string): string =>
  PLACEHOLDER_MAP.reduce((t, p) => t.split(p.friendly).join(p.raw), text);
