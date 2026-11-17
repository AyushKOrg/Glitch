// Bundle ordered CSS source modules from the 31 balanced source groups.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'styles', 'cascade');
const output = path.join(root, 'public', 'css', 'styles.css');

function collectCss(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectCss(fullPath);
    return entry.isFile() && /^part-\d+\.css$/.test(entry.name) ? [fullPath] : [];
  });
}

const files = collectCss(source).sort((a, b) => {
  const number = (file) => Number(path.basename(file).match(/^part-(\d+)\.css$/)[1]);
  return number(a) - number(b);
});
if (!files.length) throw new Error('No ordered CSS source modules found.');

const css = files.map((file) => fs.readFileSync(file, 'utf8')).join('');
fs.writeFileSync(output, css, 'utf8');
console.log('Bundled ' + files.length + ' ordered CSS modules from 31 source groups.');
