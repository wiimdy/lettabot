#!/usr/bin/env node
// One-time helper to obtain a GOOGLE_REFRESH_TOKEN for the lettabot Google Calendar tool.
// Run locally:  node scripts/google-oauth.mjs
// Prereq: a Google Cloud OAuth 2.0 client of type "Desktop app" with Calendar API enabled.
// You will be prompted for client id + secret, a browser opens, you grant access,
// and a refresh token is printed to stdout. Paste it into Railway env as GOOGLE_REFRESH_TOKEN.

import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { google } from 'googleapis';
import open from 'open';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function waitForCode(redirectPort) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${redirectPort}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (code) {
        res.end('<h2>OAuth code received. You can close this tab.</h2>');
        server.close();
        resolve(code);
      } else {
        res.end(`<h2>Error: ${error || 'no code'}</h2>`);
        server.close();
        reject(new Error(error || 'no code'));
      }
    });
    server.listen(redirectPort);
    server.on('error', reject);
  });
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID || (await prompt('GOOGLE_CLIENT_ID: '));
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (await prompt('GOOGLE_CLIENT_SECRET: '));
  if (!clientId || !clientSecret) {
    console.error('client id and secret required');
    process.exit(1);
  }

  const port = 53682;
  const redirectUri = `http://localhost:${port}`;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\nOpening browser for Google OAuth consent...');
  console.log('If it does not open, visit:\n', authUrl, '\n');
  await open(authUrl);

  const code = await waitForCode(port);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error('No refresh_token returned. Revoke the app in Google Account settings and re-run with prompt=consent.');
    process.exit(1);
  }

  console.log('\n✓ Refresh token obtained. Add to your env:\n');
  console.log(`GOOGLE_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\n(optional) GOOGLE_CALENDAR_ID=primary');
  console.log('(optional) GOOGLE_CALENDAR_TIMEZONE=Asia/Seoul');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
