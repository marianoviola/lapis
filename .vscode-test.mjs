import { defineConfig } from '@vscode/test-cli';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const vault = mkdtempSync(join(tmpdir(), 'lapis-tests-'));
const independentVault = mkdtempSync(join(tmpdir(), 'lapis-independent-'));
const unmarkedFolder = mkdtempSync(join(tmpdir(), 'lapis-unmarked-'));
const workspace = join(vault, 'workspace');
const secondWorkspace = join(vault, 'workspace-two');
mkdirSync(workspace, { recursive: true });
mkdirSync(join(workspace, 'Projects'));
mkdirSync(join(workspace, 'node_modules'));
mkdirSync(secondWorkspace);
writeFileSync(join(vault, '.lapis'), '');
writeFileSync(join(independentVault, '.lapis'), '');
writeFileSync(join(workspace, 'Welcome.md'), '---\ntitle: Welcome to Lapis\nstatus: todo\ndue: 2026-10-20\n---\n# Welcome\n');
writeFileSync(join(workspace, 'Projects', 'Related.md'), '[[Welcome]]\n`[[Ignored]]`\n');
writeFileSync(join(workspace, 'node_modules', 'Ignored.md'), '# Not a vault note\n');
writeFileSync(join(secondWorkspace, 'Shared.md'), '[[Welcome]]\n');
writeFileSync(join(independentVault, 'Private.md'), '[[Welcome]]\n');
writeFileSync(join(unmarkedFolder, 'Unmarked.md'), '# No vault marker\n');
const workspaceFile = join(vault, 'Lapis.code-workspace');
writeFileSync(workspaceFile, JSON.stringify({
	folders: [
		{ path: 'workspace' },
		{ path: 'workspace-two' },
		{ path: independentVault },
		{ path: unmarkedFolder },
	],
}));
process.on('exit', () => {
	rmSync(vault, { recursive: true, force: true });
	rmSync(independentVault, { recursive: true, force: true });
	rmSync(unmarkedFolder, { recursive: true, force: true });
});

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: '1.140.0',
	workspaceFolder: workspaceFile,
	useInstallation: process.env.VSCODE_EXECUTABLE ? { fromPath: process.env.VSCODE_EXECUTABLE } : undefined,
	launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
	mocha: { timeout: 20000 },
});
