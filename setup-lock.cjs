#!/usr/bin/env node
/* Makes lock.js: your GitHub key, encrypted with your password.
   Run it in the folder of the site:  bun setup-lock.cjs   or   node setup-lock.cjs
   --offline skips the check of the key against GitHub. */
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const L = require('./logic.js');

const offline = process.argv.includes('--offline');
let piped = null;                                             // the lines of the input, when the input is not a keyboard

function pipedLine() {
  if (piped == null) piped = fs.readFileSync(0, 'utf8').split(/\r?\n/);
  return piped.length ? piped.shift() : '';
}

// Reads one line. With hidden, the text does not show on the screen.
function ask(question, hidden) {
  process.stdout.write(question);
  if (!process.stdin.isTTY) { process.stdout.write('\n'); return Promise.resolve(pipedLine().trim()); }
  return new Promise(resolve => {
    const input = process.stdin;
    let text = '', esc = 0;                                   // esc: 1 after ESC, 2 in a control sequence of the terminal
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (esc === 1) { esc = ch === '[' ? 2 : 0; continue; }
        if (esc === 2) { if (ch >= '@' && ch <= '~') esc = 0; continue; }
        if (ch === '\u001b') { esc = 1; continue; }             // a paste can come with control sequences around it
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.pause();
          input.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(text.trim());
        }
        if (ch === '\u0003') { input.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') {
          if (text.length) { text = text.slice(0, -1); if (!hidden) process.stdout.write('\b \b'); }
        } else if (ch >= ' ') { text += ch; if (!hidden) process.stdout.write(ch); }
      }
    };
    input.on('data', onData);
  });
}

function fail(message) { console.error(message); process.exit(1); }

function gitOwner() {
  try {
    const url = execSync('git config --get remote.origin.url', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = /github\.com[:/]([^/]+)\//.exec(url);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

async function main() {
  const guess = gitOwner();
  const owner = (await ask('GitHub user' + (guess ? ' [' + guess + ']' : '') + ': ')) || guess;
  if (!owner) fail('niel-trains needs the GitHub user name.');
  const repo = (await ask('Private data repo [niel-trains-data]: ')) || 'niel-trains-data';
  const token = (await ask('GitHub key for that repo (the text stays hidden): ', true)).replace(/\s+/g, '');
  if (!token) fail('The tool got no text. Paste the key with Ctrl+Shift+V, then press Enter.');
  if (!/^github_pat_\w{20,}$/.test(token)) {
    fail('This text is not a GitHub key. A key starts with github_pat_. The tool got ' + token.length +
         ' characters that start with "' + token.slice(0, 6) + '". Copy the key on the GitHub page again, then paste it here.');
  }
  console.log('Got a key of ' + token.length + ' characters.');

  if (!offline) {
    let res;
    try {
      res = await fetch('https://api.github.com/repos/' + owner + '/' + repo, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'niel-trains-setup' } });
    } catch (e) { fail('GitHub did not answer. Check your connection, or run with --offline.'); }
    if (res.status === 401) fail('GitHub does not know this key. It can be deleted, or the copy is not complete. Make a new key and copy it with the copy button.');
    if (res.status === 404) fail('The key cannot see ' + owner + '/' + repo + '. Make the repo, and give the key access to it.');
    if (!res.ok) fail('GitHub error ' + res.status + '.');
    const info = await res.json();
    if (!info.private) fail(owner + '/' + repo + ' is public. Use a private repo for your data.');
    if (!info.permissions || !info.permissions.push) fail('The key cannot write to the repo. Give it "Contents: Read and write".');
    console.log('The key can write to ' + owner + '/' + repo + '.');
  }

  const password = await ask('New password for the site, 12 or more characters (hidden): ', true);
  if (password.length < 12) fail('The password is too short. The encrypted key is in a public file, so use 12 or more characters.');
  if ((await ask('The same password again: ', true)) !== password) fail('The two passwords are different.');

  const lock = Object.assign({ owner: owner, repo: repo, path: 'state.json' }, await L.lockBox(token, password));
  const file = path.join(__dirname, 'lock.js');
  fs.writeFileSync(file, '// Made by setup-lock.cjs. The key in this file is encrypted with your password.\n' +
                         'window.NT_LOCK = ' + JSON.stringify(lock) + ';\n');
  console.log('Wrote ' + file + '. Commit this file and push it.');
}

main().catch(e => fail(e && e.message ? e.message : String(e)));
