// Exercise public `unsnooze codex` and a dead-pane revival on a private tmux
// server. Distinct Codex/Claude fixture binaries make cross-agent routing a
// test failure, rather than trusting the label in state.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('public Codex launch and dead-pane resume execute Codex only, never Claude', {
  skip: process.env.UNSNOOZE_TEST_TMUX !== '1', timeout: 30000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unsnooze-codex-routing-'));
  const stateDir = join(dir, 'state');
  const cwd = join(dir, 'project');
  const socket = join(dir, 'tmux.sock');
  const cli = fileURLToPath(new URL('../bin/unsnooze.js', import.meta.url));
  const sid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  mkdirSync(cwd); mkdirSync(stateDir);
  writeFileSync(join(stateDir, 'config.json'), JSON.stringify({ autoResume: false, guiWatch: false,
    notifications: false, agents: { codex: true }, updateCheck: false }));
  const marker = join(dir, 'claude-launched');
  const claude = join(dir, 'claude.mjs');
  writeFileSync(claude, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)},'wrong agent');\n`, { mode: 0o700 });
  const codex = join(dir, 'codex.mjs');
  const callsPath = join(dir, 'codex-calls.jsonl');
  writeFileSync(codex, `#!${process.execPath}
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(callsPath)},JSON.stringify(args)+'\\n');
const dir=join(process.env.UNSNOOZE_CODEX_DIR,'sessions','2026','10','23');
mkdirSync(dir,{recursive:true});
const path=join(dir,'rollout-2026-10-23T00-00-00-${sid}.jsonl');
const line=(type,payload)=>JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\\n';
if(args[0]==='resume') {
  appendFileSync(path,line('response_item',{type:'message',role:'assistant',content:[]}));
  console.log('Codex resumed\\n› Ask Codex to do anything');
} else {
  writeFileSync(path,line('session_meta',{id:'${sid}',cwd:process.cwd()}));
  console.log("■ You've hit your usage limit. Try again later.\\n› Ask Codex to do anything");
}
setInterval(()=>{},1000);
`, { mode: 0o700 });
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('UNSNOOZE_')));
  const env = { ...inherited, UNSNOOZE_STATE_DIR: stateDir, UNSNOOZE_CODEX_DIR: join(dir, 'codex-data'),
    UNSNOOZE_CLAUDE_DIR: join(dir, 'claude-data'), UNSNOOZE_CODEX_BIN: codex, UNSNOOZE_CLAUDE_BIN: claude,
    UNSNOOZE_SCRAPE_INTERVAL_MS: '100', UNSNOOZE_POLL_INTERVAL_MS: '100', UNSNOOZE_VERIFY_DELAY_MS: '200',
    UNSNOOZE_NOTIFICATIONS: 'off', UNSNOOZE_UPDATE_CHECK: 'off', UNSNOOZE_GUI_WATCH: 'off', UNSNOOZE_AUTO_RESUME: 'off' };
  delete env.TMUX; delete env.TMUX_PANE;
  const tmux = (...args) => execFileSync('tmux', ['-S', socket, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const state = () => { try { return JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')); } catch { return {}; } };
  const wait = async predicate => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('timed out; ' + readFileSync(join(stateDir, 'unsnooze.log'), 'utf8'));
  };
  try {
    tmux('new-session', '-d', '-s', 'keepalive', process.execPath, '-e', 'setInterval(()=>{},1000)');
    tmux('new-session', '-d', '-s', 'unsnooze-test', '-c', cwd, process.execPath, cli, 'codex');
    const rec = await wait(() => state().sessions?.[sid]);
    assert.equal(rec.agent, 'codex');
    assert.equal(rec.status, 'stopped');
    assert.equal(existsSync(marker), false);
    tmux('kill-pane', '-t', rec.pane);
    env.TMUX = `${socket},0,0`;
    execFileSync(process.execPath, [cli, 'resume-now', sid], { env, encoding: 'utf8' });
    await wait(() => readFileSync(callsPath, 'utf8').trim().split('\n').length >= 2);
    await wait(() => state().sessions?.[sid]?.status === 'resumed');
    const calls = readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], []);
    assert.deepEqual(calls[1].slice(0, 2), ['resume', sid]);
    assert.match(calls[1][2], /Continue where you left off/);
    assert.equal(existsSync(marker), false, 'neither launch nor recovery may execute the Claude binary');
    assert.equal(state().sessions[sid].agent, 'codex');
    assert.notEqual(state().sessions[sid].pane, rec.pane);
  } finally {
    try { tmux('kill-server'); } catch { /* already gone */ }
    const pid = state().resumerPid;
    if (pid && pid !== process.pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } }
    await new Promise(r => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});
