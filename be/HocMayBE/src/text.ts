const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL = /https?:\/\/\S+/gi;

export function cleanNewsgroup(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const headerEnd = normalized.indexOf('\n\n');
  const body = headerEnd >= 0 ? normalized.slice(headerEnd + 2) : normalized;
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    if (/^\s*--\s*$/.test(line)) break;
    if (/^\s*[>|]/.test(line)) continue;
    if (/^\s*(in article|on .+ wrote:|writes:)/i.test(line)) continue;
    if (/^\s*(from|subject|organization|reply-to|nntp-posting-host):/i.test(line)) continue;
    lines.push(line.replace(EMAIL, '[email removed]').replace(URL, '[link removed]'));
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

export function terms(text: string, ngramMax: 1 | 2): string[] {
  const words = tokenize(text);
  if (ngramMax === 1) return words;
  const result = [...words];
  for (let i = 0; i + 1 < words.length; i += 1) {
    result.push(`${words[i]} ${words[i + 1]}`);
  }
  return result;
}

export function uniqueTerms(text: string): Set<string> {
  return new Set(tokenize(text));
}
