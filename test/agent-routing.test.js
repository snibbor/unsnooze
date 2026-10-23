import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = mkdtempSync(join(tmpdir(), 'unsnooze-routing-'));
const BIN = fileURLToPath(new URL('../bin/unsnooze.js', import.meta.url));
const broken = join(DIR, 'broken');
mkdirSync(join(broken, 'bin'), { recursive: true });
copyFileSync(BIN, join(broken, 'bin', 'unsnooze.js'));
writeFileSync(join(broken, 'package.json'), JSON.stringify({ type: 'module' }));
const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('UNSNOOZE_')));
const env = { ...inherited, UNSNOOZE_STATE_DIR: join(DIR, 'state'), UNSNOOZE_ACTIVE: '1',
  UNSNOOZE_UPDATE_CHECK: 'off', UNSNOOZE_NOTIFICATIONS: 'off' };
const callLog = join(DIR, 'agents.jsonl');
for (const agent of ['claude', 'codex', 'kimi', 'grok', 'qwen', 'opencode', 'agy', 'cursor']) {
  const shim = join(DIR, `${agent}.mjs`);
  writeFileSync(shim, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nconst call={agent:${JSON.stringify(agent)},args:process.argv.slice(2)};\nappendFileSync(${JSON.stringify(callLog)},JSON.stringify(call)+'\\n');\nconsole.log(JSON.stringify(call));\n`, { mode: 0o700 });
  env[`UNSNOOZE_${agent.toUpperCase()}_BIN`] = shim;
}
const run = (args, bin = BIN) => spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8', timeout: 10000 });
const calls = () => existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
after(() => rmSync(DIR, { recursive: true, force: true }));

test('public and wrapper routes select the exact named executable, including when modules are missing', { skip: process.platform === 'win32' }, () => {
  for (const bin of [BIN, join(broken, 'bin', 'unsnooze.js')]) {
    for (const agent of ['codex', 'kimi', 'claude', 'grok', 'qwen', 'opencode', 'agy', 'cursor']) {
      for (const prefix of [[agent], ['_run', agent]]) {
        const args = ['resume', 'specific-session', 'prompt with spaces'];
        const result = run([...prefix, ...args], bin);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(calls().at(-1), { agent, args });
      }
    }
  }
});

test('unknown commands, unknown agents and bare flags never invoke Claude or any agent', () => {
  const before = calls().length;
  for (const bin of [BIN, join(broken, 'bin', 'unsnooze.js')]) {
    for (const args of [['codxe'], ['--resume', 'id'], ['-c'], ['hello'], ['_run', 'codxe'], ['_run', '__proto__'], ['_run'], ['_monitor', 'tmux', '', '%0', 'codxe']]) {
      const result = run(args, bin);
      assert.equal(result.status, 2, `${args}: ${result.stderr}`);
      assert.equal(result.stdout, '');
    }
  }
  assert.equal(calls().length, before);
});

test('bare unsnooze opens Sessions and --version identifies Unsnooze, with no agent launch', () => {
  const before = calls().length;
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mux session/);
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^unsnooze \d/);
  assert.equal(calls().length, before);
});
