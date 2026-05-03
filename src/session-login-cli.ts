#!/usr/bin/env node
import { sessionLogin, SessionLoginError } from './session-login.js';

interface Args {
  baseUrl?: string;
  username?: string;
  help?: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-b' || a === '--base-url') out.baseUrl = argv[++i];
    else if (a === '-u' || a === '--username') out.username = argv[++i];
    else if (a.startsWith('--base-url=')) out.baseUrl = a.slice('--base-url='.length);
    else if (a.startsWith('--username=')) out.username = a.slice('--username='.length);
  }
  return out;
}

function usage(): string {
  return (
    'Usage: canvas-parent-mcp-login -b <base-url> -u <username>\n\n' +
    'Logs into Canvas with username/password (no SSO/2FA support) and prints\n' +
    'CANVAS_BASE_URL / CANVAS_COOKIE env vars to stdout. Pipe stdin to supply the\n' +
    'password without a prompt:\n\n' +
    '  canvas-parent-mcp-login -b https://cms.instructure.com -u me@example.com <<< "$PW"\n\n' +
    'When stdin is a TTY the tool prompts for the password with no echo.\n' +
    'CANVAS_COOKIE is sensitive — treat it like a password.\n'
  );
}

async function readStdinAll(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function readPasswordFromTty(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    process.stderr.write('Password: ');
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
    };
    const onData = (data: string) => {
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          // Ctrl+C
          cleanup();
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          // DEL or backspace
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) return readPasswordFromTty();
  return (await readStdinAll()).replace(/\r?\n$/, '');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stderr.write(usage());
    return 0;
  }
  if (!args.baseUrl || !args.username) {
    process.stderr.write(usage());
    return 2;
  }
  let password: string;
  try {
    password = await readPassword();
  } catch {
    process.stderr.write('Cancelled.\n');
    return 130;
  }
  if (!password) {
    process.stderr.write('Password is empty — refusing to attempt login.\n');
    return 2;
  }

  try {
    const result = await sessionLogin({
      baseUrl: args.baseUrl,
      username: args.username,
      password,
    });
    process.stderr.write(
      `Logged in to ${result.baseUrl}. Add the following to your .env ` +
        '(CANVAS_COOKIE is sensitive — keep it secret):\n\n',
    );
    process.stdout.write(`CANVAS_BASE_URL=${result.baseUrl}\n`);
    process.stdout.write(`CANVAS_COOKIE=${result.cookie}\n`);
    process.stderr.write(
      '\nFor hands-off auto-renewal (re-mints cookies on 401), also add:\n' +
        `  CANVAS_USERNAME=${args.username}\n` +
        '  CANVAS_PASSWORD=<your password>\n',
    );
    return 0;
  } catch (err) {
    const msg = err instanceof SessionLoginError ? err.message : (err as Error).message;
    process.stderr.write(`Login failed: ${msg}\n`);
    return 1;
  }
}

main().then((code) => process.exit(code));
