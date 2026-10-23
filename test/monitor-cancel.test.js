import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DIR = mkdtempSync(join(tmpdir(), 'unsnooze-monitor-cancel-'));
process.env.UNSNOOZE_STATE_DIR = DIR;
process.env.UNSNOOZE_NOTIFICATIONS = 'off';
process.env.UNSNOOZE_CLAUDE_DIR = join(DIR, 'claude');
const { createMonitor } = await import('../src/monitor.js');
const { writeLease } = await import('../src/lease.js');
const { upsertSession, setStatus, readState } = await import('../src/state.js');
const { getAgent } = await import('../src/agents/index.js');
after(() => rmSync(DIR, { recursive: true, force: true }));

test('cancellation ends the matching monitor before it can re-register the same banner', async () => {
  const address = { mux: 'tmux', paneOwner: null, pane: '%cancel', leaseId: 'cancelled-launch' };
  writeLease({ ...address, agent: 'claude', pid: process.pid });
  upsertSession({ ...address, agent: 'claude', sessionId: 'cancelled-session', status: 'stopped', detectedAt: Date.now() });
  setStatus('cancelled-session', 'cancelled');
  const monitor = createMonitor({ muxName: 'tmux', paneOwner: null, pane: address.pane, leaseId: address.leaseId,
    cwd: DIR, agent: getAgent('claude'), versionSkewed: () => false,
    mux: { paneAlive: async () => true, capturePane: async () => { throw new Error('cancelled session must not be scraped'); } },
  });
  await monitor._tick();
  assert.equal(monitor._running, false);
  assert.equal(readState().sessions['cancelled-session'].status, 'cancelled');
});

test('cancellation of an old pane generation cannot stop its new monitor', async () => {
  const address = { mux: 'tmux', paneOwner: null, pane: '%reused' };
  upsertSession({ ...address, leaseId: 'old', agent: 'claude', sessionId: 'old-session', status: 'cancelled', detectedAt: Date.now() });
  writeLease({ ...address, leaseId: 'new', agent: 'codex', pid: process.pid });
  let captured = false;
  const monitor = createMonitor({ muxName: 'tmux', paneOwner: null, pane: address.pane, leaseId: 'new',
    cwd: DIR, agent: getAgent('codex'), versionSkewed: () => false,
    mux: { paneAlive: async () => true, capturePane: async () => { captured = true; return '› '; } },
  });
  await monitor._tick();
  assert.equal(monitor._running, true);
  assert.equal(captured, true);
});
