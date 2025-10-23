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
    const { messages, system } = req.body || {};
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

    // Call OpenAI Chat Completions (text-only)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: msgs,
      temperature: 0.6,
      max_tokens: 600
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    const status = err?.status || 500;
    return res.status(status).json({ error: 'OpenAI request failed' });
  }
});

// Serve static frontend from current directory
app.use(express.static(process.cwd(), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`ALND AI server listening on http://localhost:${PORT}`);
});
