// api/package.js
// Generates a full content package (script + thumbnail prompt + SEO) from a chosen hook.
// Env vars needed: GROQ_API_KEY

const CHANNEL_CONTEXT = {
  cipherjd: "CipherJD Tech Growth — Hindi/Hinglish tech & free AI tools channel. Formula: 'Ye Tool India Mein Kisi Ko Nahi Pata' style FOMO hooks. Tone: sharp, fast, urgent.",
  mysticfear: "Mystic Fear — Hindi horror storytelling channel. Tone: eerie, dark, suspenseful, atmospheric, slow-burn dread.",
  mindcontrol: "MindControl AI — dark truths and AI topics channel. Tone: mysterious, thought-provoking, slightly conspiratorial but factual."
};
const ALLOWED_CHANNELS = Object.keys(CHANNEL_CONTEXT);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Server key not configured.' });

  let { keyword, channel, hook } = req.body || {};
  keyword = (keyword || '').toString().trim().slice(0, 100);
  hook = (hook || '').toString().trim().slice(0, 200);
  channel = ALLOWED_CHANNELS.includes(channel) ? channel : 'cipherjd';
  if (!keyword || !hook) return res.status(400).json({ error: 'Keyword and hook required' });

  const systemPrompt = `Tum CipherJD ke liye Hindi YouTube Shorts content banate ho. Channel context: ${CHANNEL_CONTEXT[channel]}

Diye gaye keyword aur chosen hook se ek poora ~45-second Short ka content package banao, Hook → Problem → Solution → Result → CTA structure follow karte hue.

STRICTLY JSON format mein reply karo, kuch aur text nahi:
{
  "script": {
    "hook": "<opening hook line, energetic, 3-5 seconds bolne layak>",
    "problem": "<viewer ki problem/pain point, 5-8 seconds>",
    "solution": "<tool/trick reveal, 10-15 seconds>",
    "result": "<proof/result/demo, 10-15 seconds>",
    "cta": "<call to action, follow/comment/link, 3-5 seconds>"
  },
  "thumbnailPrompt": "<detailed AI image generation prompt for thumbnail, English mein, visual description, style, colors, text overlay suggestion>",
  "seo": {
    "title": "<YouTube title, Hinglish, under 60 chars, click-worthy>",
    "description": "<2-3 sentence YouTube description with keyword>",
    "tags": [<8-10 relevant SEO tags as strings, no # symbol>],
    "hashtags": [<5-6 hashtags as strings WITH # symbol, for description/comments>]
  }
}`;

  const userPrompt = `Keyword: "${keyword}"\nChosen hook: "${hook}"`;

  try {
    const res2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.75,
        response_format: { type: 'json_object' },
        max_tokens: 1200
      })
    });
    const data = await res2.json();
    if (data.error) throw new Error('Groq API: ' + data.error.message);
    const raw = data.choices?.[0]?.message?.content || '{}';
    const pkg = JSON.parse(raw);
    return res.status(200).json(pkg);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Package generation failed' });
  }
}

