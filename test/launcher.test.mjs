import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();

function runLauncher(configDir, fallbackRoot, input, pluginsDir) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  if (pluginsDir) env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginsDir;
  else delete env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
  const child = spawn(process.execPath, [join(ROOT, 'dist/launcher.js'), fallbackRoot], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
  child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

test('launcher follows the exact installed-plugin registry path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-launcher-'));
  const configDir = join(root, 'config');
  const installedRoot = join(root, 'installed', '6.4.2');
  const fallbackRoot = join(root, 'fallback');
  const registryDir = join(configDir, 'plugins');
  mkdirSync(join(installedRoot, 'dist'), { recursive: true });
  mkdirSync(join(fallbackRoot, 'dist'), { recursive: true });
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(join(installedRoot, 'dist', 'statusline.js'), "process.stdin.on('data',()=>{}); process.stdin.on('end',()=>process.stdout.write('installed\\n'));\n");
  writeFileSync(join(fallbackRoot, 'dist', 'statusline.js'), "process.stdout.write('fallback\\n');\n");
  writeFileSync(join(registryDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'claude-recall@claude-recall': [{
        scope: 'user',
        installPath: installedRoot,
        version: '6.4.2',
        lastUpdated: '2026-07-15T00:00:00.000Z',
      }],
    },
  }));
  try {
    const result = await runLauncher(configDir, fallbackRoot, '{}');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'installed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('launcher respects CLAUDE_CODE_PLUGIN_CACHE_DIR as the plugins root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-launcher-plugin-root-'));
  const configDir = join(root, 'config');
  const pluginsDir = join(root, 'custom-plugins');
  const installedRoot = join(root, 'installed', '6.4.2');
  const fallbackRoot = join(root, 'fallback');
  mkdirSync(join(installedRoot, 'dist'), { recursive: true });
  mkdirSync(join(fallbackRoot, 'dist'), { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(installedRoot, 'dist', 'statusline.js'), "process.stdout.write('custom-plugin-root\\n');\n");
  writeFileSync(join(fallbackRoot, 'dist', 'statusline.js'), "process.stdout.write('fallback\\n');\n");
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'claude-recall@claude-recall': [{
        scope: 'user',
        installPath: installedRoot,
        version: '6.4.2',
        lastUpdated: '2026-07-15T00:00:00.000Z',
      }],
    },
  }));
  try {
    const result = await runLauncher(configDir, fallbackRoot, '{}', pluginsDir);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'custom-plugin-root\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('launcher ignores a higher-priority local install from another project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-launcher-scope-'));
  const configDir = join(root, 'config');
  const pluginsDir = join(configDir, 'plugins');
  const currentProject = join(root, 'current-project');
  const foreignProject = join(root, 'foreign-project');
  const localRoot = join(root, 'local-install');
  const userRoot = join(root, 'user-install');
  mkdirSync(join(localRoot, 'dist'), { recursive: true });
  mkdirSync(join(userRoot, 'dist'), { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(localRoot, 'dist', 'statusline.js'), "process.stdout.write('foreign-local\\n');\n");
  writeFileSync(join(userRoot, 'dist', 'statusline.js'), "process.stdout.write('user\\n');\n");
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'claude-recall@claude-recall': [
        { scope: 'local', projectPath: foreignProject, installPath: localRoot },
        { scope: 'user', installPath: userRoot },
      ],
    },
  }));
  try {
    const input = JSON.stringify({ cwd: currentProject, workspace: { project_dir: currentProject } });
    const result = await runLauncher(configDir, '', input);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'user\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('launcher selects a matching project-scoped install', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-launcher-matching-scope-'));
  const configDir = join(root, 'config');
  const pluginsDir = join(configDir, 'plugins');
  const projectRoot = join(root, 'project');
  const nestedCwd = join(projectRoot, 'packages', 'app');
  const projectInstall = join(root, 'project-install');
  const userInstall = join(root, 'user-install');
  mkdirSync(join(projectInstall, 'dist'), { recursive: true });
  mkdirSync(join(userInstall, 'dist'), { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(projectInstall, 'dist', 'statusline.js'), "process.stdout.write('project\\n');\n");
  writeFileSync(join(userInstall, 'dist', 'statusline.js'), "process.stdout.write('user\\n');\n");
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'claude-recall@claude-recall': [
        { scope: 'project', projectPath: projectRoot, installPath: projectInstall },
        { scope: 'user', installPath: userInstall },
      ],
    },
  }));
  try {
    const input = JSON.stringify({ cwd: nestedCwd, workspace: { project_dir: projectRoot } });
    const result = await runLauncher(configDir, '', input);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'project\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('launcher does not change plugin scope after /cd into another project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-launcher-cd-scope-'));
  const configDir = join(root, 'config');
  const pluginsDir = join(configDir, 'plugins');
  const launchProject = join(root, 'launch-project');
  const cdProject = join(root, 'cd-project');
  const cdInstall = join(root, 'cd-local-install');
  const userInstall = join(root, 'user-install');
  mkdirSync(join(cdInstall, 'dist'), { recursive: true });
  mkdirSync(join(userInstall, 'dist'), { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(cdInstall, 'dist', 'statusline.js'), "process.stdout.write('cd-local\\n');\n");
  writeFileSync(join(userInstall, 'dist', 'statusline.js'), "process.stdout.write('user\\n');\n");
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'claude-recall@claude-recall': [
        { scope: 'local', projectPath: cdProject, installPath: cdInstall },
        { scope: 'user', installPath: userInstall },
      ],
    },
  }));
  try {
    const input = JSON.stringify({
      cwd: cdProject,
      workspace: { project_dir: launchProject, current_dir: cdProject },
    });
    const result = await runLauncher(configDir, '', input);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'user\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('launcher falls back to the setup-time plugin root for local development', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-launcher-fallback-'));
  const configDir = join(root, 'config');
  const fallbackRoot = join(root, 'fallback');
  mkdirSync(join(fallbackRoot, 'dist'), { recursive: true });
  writeFileSync(join(fallbackRoot, 'dist', 'statusline.js'), "process.stdout.write('fallback\\n');\n");
  try {
    const result = await runLauncher(configDir, fallbackRoot, '{}');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'fallback\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
