// Netlify Function: Chat proxy to OpenAI (no SDK, uses fetch)
// Path: /.netlify/functions/chat

const MODEL = 'gpt-4o-mini';
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
    let { messages, system } = body;

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

    // Call OpenAI Chat Completions
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: msgs,
        temperature: 0.6,
        max_tokens: 600
      })
    });

    if (!resp.ok) {
      const errTxt = await safeText(resp);
      console.error('OpenAI error:', resp.status, errTxt);
      return json(resp.status, { error: 'OpenAI request failed' });
    }

    const data = await resp.json();
    const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    return json(200, { reply });
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
