// Disabled image function
// Path: /.netlify/functions/image

const MODEL_ENV = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || 'openai'; // 'openai' | 'auto1111'
const AUTO1111_URL = process.env.AUTO1111_URL || '';

export async function handler() {
  // Always disabled
    return json(410, { error: 'Image generation has been disabled.' });
  }

  const apiKey = null;
  if (!apiKey) return json(410, { error: 'Image generation has been disabled.' });

  try {
    return json(410, { error: 'Image generation has been disabled.' });
    if (!ct.includes('application/json')) {
      return json(400, { error: 'Content-Type must be application/json' });
    }

    const body = JSON.parse(event.body || '{}');
    let { prompt, size, quality } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return json(400, { error: 'prompt is required' });
    }
    prompt = prompt.trim();
    const allowedS = new Set(['1024x1024','1024x1536','1536x1024','auto']);
    size = allowedS.has(String(size || '').toLowerCase()) ? String(size).toLowerCase() : '1024x1024';
    const allowedQ = new Set(['low','medium','high','auto']);
    quality = allowedQ.has(String(quality || '').toLowerCase()) ? String(quality).toLowerCase() : 'high';

    if (IMAGE_PROVIDER === 'auto1111') {
      if (!AUTO1111_URL) return json(500, { error: 'AUTO1111_URL is required for IMAGE_PROVIDER=auto1111' });
      const image = await callA1111ImageWithRetry(AUTO1111_URL, { prompt, size });
      return json(200, { image, model: 'auto1111' });
    }

    const model = MODEL_ENV;
    const image = await callOpenAIImageWithRetry(apiKey, { model, prompt, size, quality });
    return json(200, { image, model });
  } catch (e) {
    // no-op
    return json(500, { error: e?.message || 'Server error' });
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

async function callOpenAIImageWithRetry(apiKey, { model, prompt, size, quality }) {
  const maxAttempts = 3;
  let delay = 500;
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality,
        n: 1
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      const item = data && data.data && data.data[0];
      if (!item) throw new Error('No image data');
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item.url) {
        // Fetch the URL and convert to data URL to keep CSP img-src 'self' data:
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) throw new Error('Failed to fetch image');
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const ct = imgRes.headers.get('content-type') || 'image/png';
        return `data:${ct};base64,${buf.toString('base64')}`;
      }
      throw new Error('Unsupported image response');
    }

    const status = resp.status;
    lastErr = await safeText(resp);
    if (status === 429 || (status >= 500 && status < 600)) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      continue;
    }
    throw new Error(lastErr || `OpenAI error ${status}`);
  }
  throw new Error(lastErr || 'OpenAI request failed');
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

async function callA1111ImageWithRetry(baseUrl, { prompt, size }) {
  const maxAttempts = 3;
  let delay = 500;
  let lastErr = '';
  const [w, h] = (() => {
    if (size === '1024x1536') return [1024, 1536];
    if (size === '1536x1024') return [1536, 1024];
    return [1024, 1024];
  })();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, width: w, height: h, steps: 20, cfg_scale: 7, sampler_name: 'Euler a' })
    });
    if (resp.ok) {
      const data = await resp.json();
      const b64 = data && data.images && data.images[0];
      if (!b64) throw new Error('No image data');
      return `data:image/png;base64,${b64}`;
    }
    await new Promise(r => setTimeout(r, delay));
    delay *= 2;
  }
  throw new Error(lastErr || 'A1111 request failed');
}
