// Invariant: .claude-plugin/plugin.json declares its MCP config under
// `mcpServers` — the key Claude Code reads — and the file it points at exists.
//
// Why this exists: the manifest used `"mcp": "./.mcp.json"`, which Claude Code
// ignores (`claude plugin validate` warns "Unknown field 'mcp'"). It only worked
// because ./.mcp.json is the default location anyway; siblings that copied the
// pattern with a non-default path shipped plugins with no MCP server.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>;

describe('plugin.json', () => {
  it('declares the MCP config under `mcpServers`, not the ignored `mcp` key', () => {
    expect(plugin).not.toHaveProperty('mcp');
    expect(plugin.mcpServers).toBe('./.mcp.json');
  });

  it('points `mcpServers` at a file that exists', () => {
    expect(typeof plugin.mcpServers).toBe('string');
    expect(existsSync(join(ROOT, plugin.mcpServers as string))).toBe(true);
  });
});

describe('manifest.json (.mcpb) env surface', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as {
    server: { mcp_config: { env: Record<string, string> } };
    user_config: Record<string, unknown>;
  };
  const server = JSON.parse(readFileSync(join(ROOT, 'server.json'), 'utf8')) as {
    packages: { environmentVariables?: { name: string }[] }[];
  };

  it('forwards every env var server.json documents, so a Desktop user can set it', () => {
    const documented = server.packages.flatMap((p) => (p.environmentVariables ?? []).map((v) => v.name));
    expect(documented.length).toBeGreaterThan(0);
    const missing = documented.filter((name) => !(name in manifest.server.mcp_config.env));
    expect(missing).toEqual([]);
  });

  it('maps every forwarded env var to a declared user_config key', () => {
    const dangling = Object.entries(manifest.server.mcp_config.env)
      .map(([name, value]) => [name, /^\$\{user_config\.([a-z_]+)\}$/.exec(value)?.[1]] as const)
      .filter(([, key]) => !key || !(key in manifest.user_config))
      .map(([name]) => name);
    expect(dangling).toEqual([]);
  });
});
