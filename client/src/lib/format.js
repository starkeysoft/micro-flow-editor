export function ago(date) {
  if (!date) return '';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(date).toLocaleDateString();
}

export function duration(start, end) {
  if (!start || !end) return '';
  const ms = new Date(end) - new Date(start);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export const time = (date) => (date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

export const statusTone = (status) => ({
  success: 'good', error: 'bad', stopped: 'warn', running: '', retrying: 'warn', skipped: 'dim',
}[status] ?? 'dim');

// Pretty JSON as HTML with token classes (escaped).
export function highlight(value) {
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined) return '<span class="z">undefined</span>';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'n';
      if (match.startsWith('"')) cls = match.trimEnd().endsWith(':') ? 'k' : 's';
      else if (match === 'true' || match === 'false') cls = 'b';
      else if (match === 'null') cls = 'z';
      return `<span class="${cls}">${match}</span>`;
    },
  );
}
