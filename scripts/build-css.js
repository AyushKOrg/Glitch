// Bundle ordered CSS source modules into one production stylesheet.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'styles', 'cascade');
const output = path.join(root, 'public', 'css', 'styles.css');
const files = fs.readdirSync(source).filter((name) => name.startsWith('part-') && name.endsWith('.css')).sort();
if (!files.length) throw new Error('No ordered CSS source modules found.');
const css = files.map((name) => fs.readFileSync(path.join(source, name), 'utf8')).join('');
fs.writeFileSync(output, css, 'utf8');
console.log('Bundled ' + files.length + ' ordered CSS modules.');
