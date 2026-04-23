// Bidirectional conversion between raw Supabase template syntax and friendly UI labels

const PLACEHOLDER_MAP = [
  { raw: '{{owner_name}}',       friendly: '[Owner Name]'   },
  { raw: '{{building_name}}',    friendly: '[Building Name]'},
  { raw: '{{unit_number}}',      friendly: '[Unit Number]'  },
  { raw: '{{agent_first_name}}', friendly: '[Agent Name]'   },
] as const;

/** Convert stored raw {{placeholders}} to friendly [Labels] for display */
export const toFriendly = (text: string): string =>
  PLACEHOLDER_MAP.reduce((t, p) => t.split(p.raw).join(p.friendly), text);

/** Convert friendly [Labels] to raw {{placeholders}} before saving to Supabase.
 *  Case-insensitive so [owner name], [Owner Name], [OWNER NAME] all work. */
export const toRaw = (text: string): string =>
  PLACEHOLDER_MAP.reduce((t, p) => {
    // Escape the friendly label for use in regex, then replace case-insensitively
    const escaped = p.friendly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return t.replace(new RegExp(escaped, 'gi'), p.raw);
  }, text);
