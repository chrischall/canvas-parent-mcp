#!/usr/bin/env node
import { qrLogin, QrLoginError } from './qr-login.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(): Promise<number> {
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    process.stderr.write(usage());
    return 0;
  }
  const qrUrl = arg ?? (process.stdin.isTTY ? '' : await readStdin());
  if (!qrUrl) {
    process.stderr.write(usage());
    return 2;
  }

  try {
    const result = await qrLogin(qrUrl);
    process.stderr.write(
      `Logged in as ${result.user.name} (id ${result.user.id}) on ${result.baseUrl}\n` +
        `Add the following to your .env (refresh token is sensitive — keep it secret):\n\n`,
    );
    process.stdout.write(`CANVAS_BASE_URL=${result.baseUrl}\n`);
    process.stdout.write(`CANVAS_CLIENT_ID=${result.clientId}\n`);
    process.stdout.write(`CANVAS_CLIENT_SECRET=${result.clientSecret}\n`);
    process.stdout.write(`CANVAS_REFRESH_TOKEN=${result.refreshToken}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof QrLoginError ? err.message : (err as Error).message;
    process.stderr.write(`QR login failed: ${msg}\n`);
    return 1;
  }
}

function usage(): string {
  return (
    'Usage: canvas-parent-mcp-qr-login <qr-url>\n' +
    '   or: echo "<qr-url>" | canvas-parent-mcp-qr-login\n\n' +
    'Decode the QR shown at <canvas>/profile/qr_mobile_login (any QR-reader app),\n' +
    'then pass the resulting URL. Outputs CANVAS_* env vars to stdout.\n'
  );
}

main().then((code) => process.exit(code));
