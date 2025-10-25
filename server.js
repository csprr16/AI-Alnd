import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cors());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL_ENV = process.env.OPENAI_MODEL || 'gpt-4o';
const MODELS = MODEL_ENV.split(',').map(s => s.trim()).filter(Boolean);

if (!API_KEY) {
  console.warn('[WARN] OPENAI_API_KEY is not set. Set it in .env or environment variables.');
}

const openai = new OpenAI({ apiKey: API_KEY });

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: 'openai', time: new Date().toISOString() });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system, attachments } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }
    if (!API_KEY) {
      return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY' });
    }

    // Normalize roles/content
    const msgs = [];
    if (system && typeof system === 'string') {
      msgs.push({ role: 'system', content: system.slice(0, 4000) });
    }
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = String(m.content ?? '').slice(0, 8000);
      msgs.push({ role, content });
    }

    // Jika ada lampiran, gabungkan ke pesan user terakhir
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
          const parts = [{ type: 'text', text: msgs[i].content }];
          for (const att of attachments) {
            if (att && att.type === 'image' && typeof att.dataUrl === 'string' && att.dataUrl.startsWith('data:image/')) {
              // batasi ukuran
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
    let lastErr;
    for (const MODEL of MODELS) {
      try {
        const reply = await callOpenAIWithRetry(MODEL, msgs);
        return res.json({ reply, model: MODEL });
      } catch (e) {
        lastErr = e;
        // On hard failures (non 400/404/422/429/5xx handled by retry), break
        if (![400,404,422].includes(e?.status)) break;
      }
    }
    console.error('Chat error:', lastErr);
    const status = lastErr?.status || 500;
    return res.status(status).json({ error: lastErr?.message || 'OpenAI request failed' });
  } catch (err) {
    console.error('Chat error:', err);
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || 'OpenAI request failed' });
  }
});

async function callOpenAIWithRetry(model, messages) {
  const maxAttempts = 3;
  let delay = 500;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.6,
        max_tokens: 600
      });
      return completion?.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      lastErr = e;
      const status = e?.status || 0;
      // Retry on 429 and 5xx
      if (status === 429 || (status >= 500 && status < 600)) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('OpenAI request failed');
}


// Serve static frontend from current directory
app.use(express.static(process.cwd(), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`ALND AI server listening on http://localhost:${PORT}`);
});
