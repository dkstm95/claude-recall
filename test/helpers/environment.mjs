import { join } from 'node:path';

// Never inherit the caller's Claude storage, plugin selection, or recursion guard.
export function isolatedEnv(home, overrides = {}) {
  const env = { ...process.env };
  for (const key of ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PLUGIN_CACHE_DIR', 'CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_RECALL_REFINING']) delete env[key];
  return { ...env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), ...overrides };
}

export function isolateProcess(home) {
  const env = isolatedEnv(home);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
}
