// build.js — Gera os arquivos finais da extensão
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const outdir = path.join(__dirname, 'dist');
if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });

// Copia arquivos estáticos
fs.copyFileSync('manifest.json', path.join(outdir, 'manifest.json'));
fs.copyFileSync('popup.html', path.join(outdir, 'popup.html'));

// Copia icons se existirem
const iconsDir = path.join(__dirname, 'icons');
const outIconsDir = path.join(outdir, 'icons');
if (fs.existsSync(iconsDir)) {
  if (!fs.existsSync(outIconsDir)) fs.mkdirSync(outIconsDir);
  fs.readdirSync(iconsDir).forEach(f => {
    fs.copyFileSync(path.join(iconsDir, f), path.join(outIconsDir, f));
  });
}

const isWatch = process.argv.includes('--watch');

const builds = [
  { entryPoints: ['src/popup/popup.js'], outfile: path.join(outdir, 'popup.js') },
  { entryPoints: ['src/background/service_worker.js'], outfile: path.join(outdir, 'background.js') },
  { entryPoints: ['src/content/autofill.js'], outfile: path.join(outdir, 'content.js') },
];

const commonOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome100',
  minify: !isWatch,
};

if (isWatch) {
  Promise.all(builds.map(b => esbuild.context({ ...commonOptions, ...b }))).then(ctxs => {
    ctxs.forEach(ctx => ctx.watch());
    console.log('Watching for changes...');
  });
} else {
  Promise.all(builds.map(b => esbuild.build({ ...commonOptions, ...b }))).then(() => {
    console.log('✅ Extension built to ./dist/');
    console.log('   Load dist/ folder in chrome://extensions (Developer mode)');
  });
}
