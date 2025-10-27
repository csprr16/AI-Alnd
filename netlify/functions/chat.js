// Netlify Function: Chat proxy to OpenAI (no SDK, uses fetch)
// Path: /.netlify/functions/chat

const MODEL_ENV = process.env.OPENAI_MODEL || 'gpt-4o';
const MODELS = MODEL_ENV.split(',').map((s) => s.trim()).filter(Boolean);
const MAX_HISTORY_ITEMS = 20;
const MAX_CONTENT_LEN = 8000; // chars per message

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' }, { 'Allow': 'POST' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(500, { error: 'Missing OPENAI_API_KEY' });

  try {
    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('application/json')) {
      return json(400, { error: 'Content-Type must be application/json' });
    }

    const body = JSON.parse(event.body || '{}');
    let { messages, system, attachments, max_tokens } = body;
    const mt = Math.max(50, Math.min(2000, Number(max_tokens) || 400));

    if (!Array.isArray(messages) || messages.length === 0) {
      return json(400, { error: 'messages must be a non-empty array' });
    }

    // Normalize & clamp
    const msgs = [];
    if (system && typeof system === 'string') {
      msgs.push({ role: 'system', content: String(system).slice(0, MAX_CONTENT_LEN) });
    }

    const sliced = messages.slice(-MAX_HISTORY_ITEMS);
    for (const m of sliced) {
      const role = m && m.role === 'assistant' ? 'assistant' : 'user';
      const content = String(m && m.content ? m.content : '').slice(0, MAX_CONTENT_LEN);
      msgs.push({ role, content });
    }

    // attach uploaded files (images/text) to the last user message
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
          const baseText = typeof msgs[i].content === 'string' ? msgs[i].content : '';
          const parts = [{ type: 'text', text: baseText }];
          for (const att of attachments) {
            if (att && att.type === 'image' && typeof att.dataUrl === 'string' && att.dataUrl.startsWith('data:image/')) {
              if (att.dataUrl.length <= 7_000_000) {
                parts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
              }
            } else if (att && att.type === 'text' && typeof att.text === 'string') {
              const name = att.name ? `\n(Nama file: ${att.name})` : '';
              parts.push({ type: 'text', text: `Lampiran teks${name}:\n\n${att.text.slice(0, 100_000)}` });
            }
          }
          msgs[i] = { role: 'user', content: parts };
          break;
        }
      }
    }

    // Try models with fallback
    let lastErrTxt = '';
    for (const MODEL of MODELS) {
      try {
        const reply = await callOpenAIWithRetry(apiKey, MODEL, msgs, mt);
        return json(200, { reply, model: MODEL });
      } catch (e) {
        lastErrTxt = e && e.message ? e.message : String(e);
        continue; // try next model
      }
    }
    return json(502, { error: lastErrTxt || 'All models failed' });
  } catch (e) {
    console.error('Function error:', e);
    return json(500, { error: 'Server error' });
  }
}

function json(status, body, extraHeaders) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

async function callOpenAIWithRetry(apiKey, model, messages, mt) {
  const maxAttempts = 3;
  let delay = 500;
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: mt
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    }

    const status = resp.status;
    lastErr = await safeText(resp);
    // Retry on 429 and 5xx
    if (status === 429 || (status >= 500 && status < 600)) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      continue;
    }
    throw new Error(lastErr || `OpenAI error ${status}`);
  }
  throw new Error(lastErr || 'OpenAI request failed');
}
