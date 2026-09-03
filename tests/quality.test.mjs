import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

test('no duplicate keyboard shortcuts in Swift files', () => {
  const sourcesDir = 'macapp/Sources';
  const swiftFiles = fs.readdirSync(sourcesDir)
    .filter(f => f.endsWith('.swift'))
    .map(f => path.join(sourcesDir, f));

  for (const file of swiftFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const keyEquivs = [];
    const regex = /keyEquivalent:\s*"([^"]*)"/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] !== '') { // ignore empty key equivalents
        keyEquivs.push({ key: match[1], line: content.substring(0, match.index).split('\n').length });
      }
    }

    const seen = new Map();
    for (const { key, line } of keyEquivs) {
      if (seen.has(key)) {
        assert.fail(`Duplicate keyEquivalent "${key}" in ${file} (lines ${seen.get(key)} and ${line})`);
      }
      seen.set(key, line);
    }
  }
});

test('all PlaystateCommand types are handled', () => {
  const shim = fs.readFileSync('shim.js', 'utf8');

  const playstateCommands = [
    'Stop',
    'Pause',
    'Unpause',
    'PlayPause',
    'NextTrack',
    'PreviousTrack',
    'Seek',
    'Rewind',
    'FastForward'
  ];

  for (const cmd of playstateCommands) {
    assert(
      shim.includes(`'${cmd}'`) || shim.includes(`"${cmd}"`),
      `PlaystateCommand not handled: "${cmd}"`
    );
  }
});

test('all GeneralCommand types are handled', () => {
  const shim = fs.readFileSync('shim.js', 'utf8');

  const generalCommands = [
    'SetAudioStreamIndex',
    'SetSubtitleStreamIndex',
    'SetVolume',
    'VolumeUp',
    'VolumeDown',
    'Mute',
    'Unmute',
    'ToggleMute',
    'SetRepeatMode',
    'DisplayMessage',
    'PlayNext',
    'ToggleFullscreen'
  ];

  for (const cmd of generalCommands) {
    assert(
      shim.includes(`'${cmd}'`) || shim.includes(`"${cmd}"`),
      `GeneralCommand not handled: "${cmd}"`
    );
  }
});

test('no hardcoded secrets in source files', () => {
  const secretPatterns = [
    /api_key=[a-f0-9]{32}/i,          // Full API keys in URLs
    /password:\s*'[^\s']{12,}'/,      // hardcoded passwords (12+ chars, no spaces)
    /Bearer\s+[A-Za-z0-9\-._~+\/]{40,}/ // Bearer tokens (40+ chars)
  ];

  const filesToCheck = ['shim.js', 'config.example.js'];

  for (const file of filesToCheck) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of secretPatterns) {
      const match = content.match(pattern);
      assert(
        match === null,
        `Potential hardcoded secret in ${file}: ${match?.[0]?.substring(0, 50)}...`
      );
    }
  }
});

test('package.json version matches Info.plist version', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const plist = fs.readFileSync('macapp/Info.plist', 'utf8');

  const plistVersionMatch = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  assert(plistVersionMatch, 'CFBundleShortVersionString not found in Info.plist');

  assert.strictEqual(
    pkg.version,
    plistVersionMatch[1],
    `Version mismatch: package.json has ${pkg.version}, Info.plist has ${plistVersionMatch[1]}`
  );
});

test('SupportedCommands uses exact Jellyfin enum names', () => {
  const shim = fs.readFileSync('shim.js', 'utf8');

  // These must match Jellyfin's GeneralCommandType enum exactly
  const supportedCommands = [
    'SetAudioStreamIndex',
    'SetSubtitleStreamIndex',
    'SetVolume',
    'VolumeUp',
    'VolumeDown',
    'Mute',
    'Unmute',
    'ToggleMute',
    'SetRepeatMode',
    'SetPlaybackOrder',
    'DisplayMessage',
    'PlayNext',
    'ToggleFullscreen'
  ];

  // Find the SupportedCommands block (may span multiple lines)
  const startIdx = shim.indexOf('SupportedCommands:');
  assert(startIdx !== -1, 'SupportedCommands not found');
  const endIdx = shim.indexOf(']', startIdx);
  const block = shim.substring(startIdx, endIdx);

  for (const cmd of supportedCommands) {
    assert(
      block.includes(`'${cmd}'`) || block.includes(`"${cmd}"`),
      `SupportedCommands missing: "${cmd}"`
    );
  }
});
