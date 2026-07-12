import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

import { repoPath } from './lib/repo.mjs';

const uuid = 'betterlyricsbar@furkansa50';
const targetDir = join(homedir(), '.local/share/gnome-shell/extensions', uuid);

const filesToInstall = [
  'metadata.json',
  'extension.js',
  'prefs.js',
  'stylesheet.css',
  'schemas',
  'src',
];

// Clean and create target directory
await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });

// Copy files
for (const file of filesToInstall) {
  await cp(repoPath(file), join(targetDir, file), { recursive: true });
}

// Compile schemas in the target directory
const schemaResult = spawnSync('glib-compile-schemas', [join(targetDir, 'schemas')], {
  encoding: 'utf8',
});

if (schemaResult.status !== 0) {
  process.stderr.write('Failed to compile GSettings schemas:\n');
  process.stderr.write(schemaResult.stderr || schemaResult.stdout || '');
  process.exit(1);
}

process.stdout.write(`Successfully installed Better Lyrics Bar locally at:\n${targetDir}\n\n`);
process.stdout.write('To enable it:\n');
process.stdout.write(
  `1. Restart GNOME Shell (Alt+F2 then type 'r' in X11, or log out and log back in on Wayland)\n`,
);
process.stdout.write(
  `2. Enable the extension using GNOME Extensions app or run:\n   gnome-extensions enable ${uuid}\n`,
);
