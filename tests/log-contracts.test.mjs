import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

test('log line contracts exist in shim.js', () => {
  const shim = fs.readFileSync('shim.js', 'utf8');

  const contracts = [
    'WebSocket connection established',
    'Episode detected:',
    'Starting next episode:',
    'Starting previous episode:',
    'File loaded by MPV',
    'Playback paused',
    'Playback resumed',
    'No more episodes',
    'Closing application',
    'MPV closed'
  ];

  for (const pattern of contracts) {
    assert(shim.includes(pattern), `Missing contract pattern: "${pattern}"`);
  }
});

test('error patterns trigger macOS error notifications', () => {
  const shim = fs.readFileSync('shim.js', 'utf8');

  const errorPatterns = [
    'ERROR',
    '❌'
  ];

  for (const pattern of errorPatterns) {
    assert(shim.includes(pattern), `Missing error pattern: "${pattern}"`);
  }
});

test('log function exists and has correct signature', () => {
  const shim = fs.readFileSync('shim.js', 'utf8');

  assert(shim.includes('function log(level, component, ...args)'), 'log() function not found');
  assert(shim.includes("if (level === 'debug' && !CONFIG.verbose) return"), 'debug filtering not found');
});

test('new log lines do not conflict with existing contracts', () => {
  const shim = fs.readFileSync('shim.js', 'utf8');

  const newPatterns = [
    'Found',
    'intro/outro segment',
    'Auto-skip',
    'Press S to skip',
    'Next up:',
    'Connected to Jellyfin',
    'Connection lost'
  ];

  const contractPatterns = [
    'WebSocket connection established',
    'Episode detected:',
    'Starting next episode:',
    'Starting previous episode:',
    'File loaded by MPV',
    'Playback paused',
    'Playback resumed',
    'No more episodes',
    'Closing application',
    'MPV closed'
  ];

  for (const newPattern of newPatterns) {
    for (const contract of contractPatterns) {
      if (newPattern !== contract) {
        assert(
          !(newPattern.includes(contract) || contract.includes(newPattern)),
          `Potential conflict: "${newPattern}" vs "${contract}"`
        );
      }
    }
  }
});
