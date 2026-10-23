// Mocniejsi agenci do zadan programistycznych. Jarvis zostaje glosem,
// ale sam kod pisze model, ktory lepiej znosi dluzsza robote.
// Dziala tylko gdy w .env jest klucz. Bez klucza Jarvis odpowiada sam.

const CODING_RE =
  /(\b(napisz|zrob|zrób|napraw|popraw|zrefaktoryzuj|zdebuguj)\b[\s\S]{0,50}\b(kod|program|skrypt|funkcj\w*|aplikacj\w*|bug|blad|błąd|komponent|klas[eę]|api)\b)|(\b(python|javascript|typescript|react|html|css|sql)\b[\s\S]{0,40}\b(napisz|kod|funkcj|skrypt|napraw)\b)|(\buzyj|uzyj|użyj\b[\s\S]{0,20}\b(claude|grok)\b)/i;

function preferred() {
  const want = String(process.env.CODER_AGENT || 'auto').toLowerCase();
  const grok = Boolean(process.env.XAI_API_KEY);
  const claude = Boolean(process.env.ANTHROPIC_API_KEY);
  if (want === 'grok') return grok ? 'grok' : claude ? 'claude' : null;
  if (want === 'claude') return claude ? 'claude' : grok ? 'grok' : null;
  if (/claude/i.test(want)) return claude ? 'claude' : null;
  return grok ? 'grok' : claude ? 'claude' : null;
}

export function coderStatus() {
  return {
    ready: Boolean(preferred()),
    agent: preferred(),
    grok: Boolean(process.env.XAI_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

export function looksLikeCoding(text) {
  return CODING_RE.test(String(text || ''));
}

async function askGrok(message) {
  const model = process.env.CODER_GROK_MODEL || 'grok-3';
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Jestes specjalista od programowania pracujacym dla osobistego asystenta. Piszesz dzialajacy kod, krotko mowisz co robi i czego nie ruszasz. Odpowiadasz po polsku, kod zostawiasz w oryginale.',
        },
        { role: 'user', content: message },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Grok ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Grok nie zwrocil tresci');
  return { name: 'Grok', text };
}

async function askClaude(message) {
  const model = process.env.CODER_CLAUDE_MODEL || 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system:
        'Jestes specjalista od programowania pracujacym dla osobistego asystenta. Piszesz dzialajacy kod, krotko mowisz co robi i czego nie ruszasz. Odpowiadasz po polsku, kod zostawiasz w oryginale.',
      messages: [{ role: 'user', content: message }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  const text = (data?.content || []).map((p) => p.text || '').join('\n').trim();
  if (!text) throw new Error('Claude nie zwrocil tresci');
  return { name: 'Claude', text };
}

export async function delegateCoding(message) {
  if (!looksLikeCoding(message)) return null;
  const who = preferred();
  if (!who) return null;
  const forceClaude = /\bclaude\b/i.test(message) && process.env.ANTHROPIC_API_KEY;
  const forceGrok = /\bgrok\b/i.test(message) && process.env.XAI_API_KEY;
  const agent = forceClaude ? 'claude' : forceGrok ? 'grok' : who;
  const result = agent === 'claude' ? await askClaude(message) : await askGrok(message);
  return `Oddaje to specjaliście (${result.name}) — przy ciezszej robocie jest ode mnie pewniejszy.\n\n${result.text}`;
}
