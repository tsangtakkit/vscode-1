/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
let err = false;

const nodeVersion = /^(\d+)\.(\d+)\.(\d+)/.exec(process.versions.node);
const majorNodeVersion = parseInt(nodeVersion[1]);
const minorNodeVersion = parseInt(nodeVersion[2]);
const patchNodeVersion = parseInt(nodeVersion[3]);

if (majorNodeVersion < 16 || (majorNodeVersion === 16 && minorNodeVersion < 14)) {
	console.error('\033[1;31m*** Please use node.js versions >=16.14.x and <17.\033[0;0m');
	err = true;
}
if (majorNodeVersion >= 17) {
	console.warn('\033[1;31m*** Warning: Versions of node.js >= 17 have not been tested.\033[0;0m')
}

const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const yarnVersion = cp.execSync('yarn -v', { encoding: 'utf8' }).trim();
const parsedYarnVersion = /^(\d+)\.(\d+)\.(\d+)/.exec(yarnVersion);
const majorYarnVersion = parseInt(parsedYarnVersion[1]);
const minorYarnVersion = parseInt(parsedYarnVersion[2]);
const patchYarnVersion = parseInt(parsedYarnVersion[3]);

if (
	majorYarnVersion < 1 ||
	majorYarnVersion === 1 && (
		minorYarnVersion < 10 || (minorYarnVersion === 10 && patchYarnVersion < 1)
	) ||
	majorYarnVersion >= 2
) {
	console.error('\033[1;31m*** Please use yarn >=1.10.1 and <2.\033[0;0m');
	err = true;
}

if (!/yarn[\w-.]*\.c?js$|yarnpkg$/.test(process.env['npm_execpath'])) {
	console.error('\033[1;31m*** Please use yarn to install dependencies.\033[0;0m');
	err = true;
}

if (process.platform === 'win32') {
	const vsPath = findSupportedVisualStudioVersion();
	if (!vsPath) {
		console.error('\033[1;31m*** Invalid C/C++ Compiler Toolchain. Please check https://github.com/microsoft/vscode/wiki/How-to-Contribute#prerequisites.\033[0;0m');
		err = true;
	}
	enableSpectreMode(vsPath);
	if (!err) {
		installHeaders();
	}
}

if (err) {
	console.error('');
	process.exit(1);
}

function enableSpectreMode(vsPath) {
	const auxPath = path.join(vsPath, 'VC/Auxiliary/Build/vcvarsall.bat');
	if (!fs.existsSync(auxPath)) {
		console.error('\033[1;31m*** vcvarsall.bat not found. Please check https://github.com/microsoft/vscode/wiki/How-to-Contribute#prerequisites.\033[0;0m')
		return;
	}
	const proc = cp.spawnSync(auxPath, ['-vcvars_spectre_libs=spectre_mode']);
	if (proc.status) {
		console.error('vcvarsall.bat returned status ' + proc.status);
	}
}

function findAvailableVSPathForVersion(programFilesPath, version) {
	if (!programFilesPath) {
		return null;
	}
	const vsPath = `${programFilesPath}/Microsoft Visual Studio/${version}`;
	const vsTypes = ['Enterprise', 'Professional', 'Community', 'Preview', 'BuildTools'];
	for (const vsType of vsTypes) {
		const combined = path.join(vsPath, vsType);
		if (fs.existsSync(combined)) {
			return combined;
		}
	}
	return null;
}

function findSupportedVisualStudioVersion() {
	// Translated over from
	// https://source.chromium.org/chromium/chromium/src/+/master:build/vs_toolchain.py;l=140-175
	const supportedVersions = ['2022', '2019', '2017'];

	for (const version of supportedVersions) {
		let vsPath = process.env[`vs${version}_install`];
		if (vsPath && fs.existsSync(vsPath)) {
			return vsPath;
		}
		const programFiles86Path = process.env['ProgramFiles(x86)'];
		const programFiles64Path = process.env['ProgramFiles'];
		for (const path of [programFiles64Path, programFiles86Path]) {
			const vsPath = findAvailableVSPathForVersion(path, version);
			if (vsPath) {
				return vsPath;
			}
		}
	}
	return null;
}

function installHeaders() {
	const yarn = 'yarn.cmd';
	const yarnResult = cp.spawnSync(yarn, ['install'], {
		env: process.env,
		cwd: path.join(__dirname, 'gyp'),
		stdio: 'inherit'
	});
	if (yarnResult.error || yarnResult.status !== 0) {
		console.error(`Installing node-gyp failed`);
		err = true;
		return;
	}

	// The node gyp package got installed using the above yarn command using the gyp/package.json
	// file checked into our repository. So from that point it is safe to construct the path
	// to that executable
	const node_gyp = path.join(__dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd');
	const result = cp.execFileSync(node_gyp, ['list'], { encoding: 'utf8' });
	const versions = new Set(result.split(/\n/g).filter(line => !line.startsWith('gyp info')).map(value => value));

	const local = getHeaderInfo(path.join(__dirname, '..', '..', '.yarnrc'));
	const remote = getHeaderInfo(path.join(__dirname, '..', '..', 'remote', '.yarnrc'));

	if (local !== undefined && !versions.has(local.target)) {
		// Both disturl and target come from a file checked into our repository
		cp.execFileSync(node_gyp, ['install', '--dist-url', local.disturl, local.target]);
	}

	if (remote !== undefined && !versions.has(remote.target)) {
		// Both disturl and target come from a file checked into our repository
		cp.execFileSync(node_gyp, ['install', '--dist-url', remote.disturl, remote.target]);
	}
}

/**
 * @param {string} rcFile
 * @returns {{ disturl: string; target: string } | undefined}
 */
function getHeaderInfo(rcFile) {
	const lines = fs.readFileSync(rcFile, 'utf8').split(/\r\n?/g);
	let disturl, target;
	for (const line of lines) {
		let match = line.match(/\s*disturl\s*\"(.*)\"\s*$/);
		if (match !== null && match.length >= 1) {
			disturl = match[1];
		}
		match = line.match(/\s*target\s*\"(.*)\"\s*$/);
		if (match !== null && match.length >= 1) {
			target = match[1];
		}
	}
	return disturl !== undefined && target !== undefined
		? { disturl, target }
		: undefined;
}
