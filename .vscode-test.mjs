import { defineConfig } from '@vscode/test-cli';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const vault = mkdtempSync(join(tmpdir(), 'lapis-tests-'));
mkdirSync(join(vault, 'Projects'));
mkdirSync(join(vault, 'node_modules'));
writeFileSync(join(vault, 'Welcome.md'), '---\ntitle: Welcome to Lapis\nstatus: todo\ndue: 2026-10-20\n---\n# Welcome\n');
writeFileSync(join(vault, 'Projects', 'Related.md'), '[[Welcome]]\n`[[Ignored]]`\n');
writeFileSync(join(vault, 'node_modules', 'Ignored.md'), '# Not a vault note\n');
process.on('exit', () => rmSync(vault, { recursive: true, force: true }));

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: '1.140.0',
	workspaceFolder: vault,
	useInstallation: process.env.VSCODE_EXECUTABLE ? { fromPath: process.env.VSCODE_EXECUTABLE } : undefined,
	launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
	mocha: { timeout: 20000 },
});
