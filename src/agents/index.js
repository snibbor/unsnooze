// Agent registry. Only an absent id on a legacy record defaults to Claude.
// An explicit but unknown id must never silently select another agent.

import claude from './claude.js';
import codex from './codex.js';
import grok from './grok.js';
import qwen from './qwen.js';
import kimi from './kimi.js';
import opencode from './opencode.js';
import agy from './agy.js';
import cursor from './cursor.js';

const REGISTRY = { claude, codex, grok, qwen, kimi, opencode, agy, cursor };

// v1: every agent launches the bare TUI and gets the prompt typed once idle.
function defaultLaunchArgs(message) { return { args: [], messageViaPane: true }; }

export function getAgent(id) {
  const key = id == null ? 'claude' : id;
  if (!Object.hasOwn(REGISTRY, key)) throw new Error(`Unknown agent "${id}"; refusing to default to Claude`);
  const agent = REGISTRY[key];
  // Third-party/partial adapters may lack launchArgs — synthesize the same
  // default so callers (dispatch, tests) never have to null-check it.
  return typeof agent.launchArgs === 'function' ? agent : { ...agent, launchArgs: defaultLaunchArgs };
}

export function listAgents() {
  return Object.values(REGISTRY);
}
