const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function walk(dir, predicate, results = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, predicate, results);
        } else if (predicate(full)) {
            results.push(full);
        }
    }
    return results;
}

function run(args, label) {
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        stdio: 'inherit',
        shell: false
    });
    if (result.status !== 0) {
        throw new Error(label + ' failed');
    }
}

const jsFiles = walk(root, file => file.endsWith('.js'))
    .filter(file => !file.includes(`${path.sep}automation${path.sep}`));

for (const file of jsFiles) {
    run(['--check', path.relative(root, file)], 'Syntax check for ' + path.relative(root, file));
}

const testFiles = fs.readdirSync(__dirname)
    .filter(name => name.endsWith('.test.js'))
    .sort();

for (const testFile of testFiles) {
    run([path.join('tests', testFile)], testFile);
}

console.log('All automated checks passed.');
