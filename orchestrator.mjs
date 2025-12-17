/* eslint-disable no-undef */
import ftp from 'basic-ftp';
import fg from 'fast-glob';
import path from 'path';
import CDP from 'chrome-remote-interface';
import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import http from 'http';

const configPath = path.resolve('./foundryconfig.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * Upload files to FTP server
 */
export async function upload() {
  const client = new ftp.Client();
  client.ftp.verbose = config.ftp.verbose || false;

  if (!config.ftp.host) {
    console.warn("FTP host is not configured.");
    return;
  }
  const secureOptions = {
      rejectUnauthorized: false,
      checkServerIdentity: () => { return null; },
  };
  await client.access({
    host: config.ftp.host,
    user: config.ftp.user,
    password: config.ftp.password,
    secure: true, 
    secureOptions: secureOptions
  });

  const localRoot = path.join(config.path, "modules", "warhammer-lib")
  const remotePath = config.ftp.remotePath;
  const pattern = "**/**";
  const files = await fg(pattern, { cwd: localRoot });

  for (const file of files) {
    const localPath = path.join(localRoot, file);
    const remoteSubPath = path.join(remotePath, file).replace(/\\/g, "/");
    const remoteDir = path.dirname(remoteSubPath);

    try {
      await client.cd(remoteDir);
    } catch {
      try {
        await client.ensureDir(remoteDir);
      } catch (mkdirErr) {
        console.warn(`Could not create directory ${remoteDir}: ${mkdirErr.message}`);
      }
    }

    try {
      await client.uploadFrom(localPath, remoteSubPath);
      console.log(`Uploaded: ${file}`);
    } catch (uploadErr) {
      console.error(`Failed to upload ${file}: ${uploadErr.message}`);
    }
  }

  client.close();
}

/**
 * Reload all Chrome tabs matching the configured URL
 */
export async function reloadAll() {
  const ports = config.chrome.profiles.map(profile => profile.port);
  const tabMatch = config.chrome.tabMatch;

  for (const port of ports) {
    try {
      const targets = await CDP.List({ port });
      const matched = targets.find(t => t.title && t.title.includes(tabMatch));

      if (!matched) {
        console.warn(`No matching tab found on port ${port}`);
        continue;
      }

      const client = await CDP({ port, target: matched });
      const { Page } = client;
      await Page.enable();
      await Page.reload({ ignoreCache: false });
      await client.close();
      console.log(`Reloaded tab on port ${port}`);
    } catch (err) {
      console.error(`Failed to reload on port ${port}:`, err.message);
    }
  }
}

/**
 * Check if Chrome is running on the specified port
 * @param {number} port a remote debug port number
 * @returns {Promise<boolean>} a promise that resolves to true if Chrome is running, false otherwise
 */
function isChromeRunning(port) {
  return new Promise(resolve => {
    const req = http.get({ hostname: 'localhost', port, path: '/json' }, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * Launch Chrome with multiple profiles for testing
 */
export function launchChromeProfiles() {
  console.log(`Launching Chrome with profiles: ${JSON.stringify(config.chrome.profiles)} from ${config.chrome.path}`);

  config.chrome.profiles.forEach(async ({ port, dir }) => {
    const isRunning = await isChromeRunning(port);
    if (isRunning) {
      console.log(`Chrome is already running on port ${port}`);
      return;
    }
    const userDataDir = path.join(os.tmpdir(), dir);
    spawn(config.chrome.path, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--auto-open-devtools-for-tabs',
      `https://${config.ftp.host}`
    ], { detached: true, stdio: 'ignore' });
  });
}