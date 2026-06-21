// api/debug.js
// Temporary diagnostic endpoint — checks if env vars are reaching the function.
// Does NOT reveal the actual key values, just whether they exist and their length.
export default function handler(req, res) {
  res.status(200).json({
    youtubeKeyPresent: !!process.env.YOUTUBE_API_KEY,
    youtubeKeyLength: (process.env.YOUTUBE_API_KEY || '').length,
    groqKeyPresent: !!process.env.GROQ_API_KEY,
    groqKeyLength: (process.env.GROQ_API_KEY || '').length,
  });
}

