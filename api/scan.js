// api/scan.js
// Searches YouTube for a keyword, pulls video + channel stats, finds outliers,
// then asks AI to score the content opportunity and suggest hooks.
// Env vars needed: YOUTUBE_API_KEY, GROQ_API_KEY

const CHANNEL_CONTEXT = {
  cipherjd: "CipherJD Tech Growth — Hindi/Hinglish tech & free AI tools channel. Formula: 'Ye Tool India Mein Kisi Ko Nahi Pata' style FOMO hooks. Tone: sharp, fast, urgent.",
  mysticfear: "Mystic Fear — Hindi horror storytelling channel. Tone: eerie, dark, suspenseful, atmospheric, slow-burn dread.",
  mindcontrol: "MindControl AI — dark truths and AI topics channel. Tone: mysterious, thought-provoking, slightly conspiratorial but factual."
};
const ALLOWED_CHANNELS = Object.keys(CHANNEL_CONTEXT);
const ALLOWED_DAYS = [7, 30, 90];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const YT_KEY = process.env.YOUTUBE_API_KEY;
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!YT_KEY) return res.status(500).json({ error: 'Server YouTube key not configured.' });
  if (!GROQ_KEY) return res.status(500).json({ error: 'Server AI key not configured.' });

  let { keyword, days, channel } = req.body || {};
  keyword = (keyword || '').toString().trim().slice(0, 100);
  days = ALLOWED_DAYS.includes(parseInt(days)) ? parseInt(days) : 30;
  channel = ALLOWED_CHANNELS.includes(channel) ? channel : 'cipherjd';
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });

  try {
    // 1. Search YouTube for videos matching the keyword
    const publishedAfter = new Date(Date.now() - days * 86400000).toISOString();
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&type=video&order=viewCount&publishedAfter=${publishedAfter}&maxResults=15&key=${YT_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (searchData.error) throw new Error('YouTube search: ' + searchData.error.message);

    const items = (searchData.items || []).filter(i => i.id && i.id.videoId);
    if (items.length === 0) {
      return res.status(200).json({ videos: [], analysis: null });
    }

    const videoIds = items.map(i => i.id.videoId).join(',');

    // 2. Get full stats for those videos
    const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}&key=${YT_KEY}`;
    const videosRes = await fetch(videosUrl);
    const videosData = await videosRes.json();
    if (videosData.error) throw new Error('YouTube videos: ' + videosData.error.message);
    const vids = videosData.items || [];

    // 3. Get subscriber counts for the channels that posted them
    const channelIds = [...new Set(vids.map(v => v.snippet.channelId))].join(',');
    const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds}&key=${YT_KEY}`;
    const channelsRes = await fetch(channelsUrl);
    const channelsData = await channelsRes.json();
    const subsMap = {};
    (channelsData.items || []).forEach(c => {
      subsMap[c.id] = c.statistics.hiddenSubscriberCount ? null : parseInt(c.statistics.subscriberCount || '0', 10);
    });

    // 4. Build video list, computing an "outlier ratio" (views vs channel's subscriber count)
    const videos = vids.map(v => {
      const views = parseInt(v.statistics.viewCount || '0', 10);
      const subs = subsMap[v.snippet.channelId];
      const outlierRatio = subs && subs > 0 ? views / subs : null;
      return {
        title: v.snippet.title,
        thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
        views,
        publishedAt: v.snippet.publishedAt,
        channelTitle: v.snippet.channelTitle,
        subs,
        outlierRatio
      };
    }).sort((a, b) => b.views - a.views);

    // 5. Summarize the data and ask AI to score the opportunity
    const topVideosSummary = videos.slice(0, 10).map((v, i) =>
      `${i + 1}. "${v.title}" — ${v.views.toLocaleString()} views, ${v.subs ? v.subs.toLocaleString() + ' subs' : 'subs unknown'}${v.outlierRatio ? `, ${v.outlierRatio.toFixed(1)}x outlier` : ''}`
    ).join('\n');

    const systemPrompt = `Tum ek YouTube content strategist ho jo trend opportunities analyze karte ho Hindi/Hinglish creators ke liye.
Channel context: ${CHANNEL_CONTEXT[channel]}

Diye gaye keyword aur top performing videos ke data se ek "Content Opportunity Score" banao.

STRICTLY JSON format mein reply karo, kuch aur text nahi:
{
  "score": <number 0-100, kitna accha opportunity hai is keyword pe video banane ka>,
  "scoreLabel": "<one of: 'Hot Opportunity', 'Good Opportunity', 'Worth Trying', 'Saturated', 'Low Potential'>",
  "reasoning": "<2-3 sentences Hinglish mein, kyun ye score diya — competition, outliers, freshness ka mention karo>",
  "hooks": [<5 short scroll-stopping Hindi/Hinglish hook lines for a Short on this keyword, har ek alag angle se>],
  "relatedKeywords": [<5-6 related keyword/angle suggestions jo isi niche mein explore kiye ja sakte hain>]
}`;

    const userPrompt = `Keyword: "${keyword}"\nTime range: last ${days} days\n\nTop videos found:\n${topVideosSummary || 'No videos found.'}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        max_tokens: 1000
      })
    });
    const groqData = await groqRes.json();
    if (groqData.error) throw new Error('Groq API: ' + groqData.error.message);
    const raw = groqData.choices?.[0]?.message?.content || '{}';
    const analysis = JSON.parse(raw);

    return res.status(200).json({ videos, analysis });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
}
  
