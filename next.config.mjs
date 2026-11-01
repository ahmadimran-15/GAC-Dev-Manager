/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mail, local Whisper and ffmpeg run as plain Node modules on the server
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "@huggingface/transformers", "onnxruntime-node", "sharp", "ffmpeg-static"],
};

export default nextConfig;
