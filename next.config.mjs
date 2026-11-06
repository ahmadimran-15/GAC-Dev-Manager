/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR lets a test build run next to the live one without overwriting .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Mail, local Whisper and ffmpeg run as plain Node modules on the server
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "@huggingface/transformers", "onnxruntime-node", "sharp", "ffmpeg-static", "postgres", "discord.js", "@discordjs/ws", "@discordjs/rest"],
};

export default nextConfig;
