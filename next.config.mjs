/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mail libraries run as plain Node modules on the server
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
};

export default nextConfig;
