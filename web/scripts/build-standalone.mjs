import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const indexPath = resolve(distDir, 'index.html');
const outputPath = resolve(distDir, 'BeeWeb-standalone.html');

let html = await readFile(indexPath, 'utf8');

html = await inlineStyles(html);
html = await inlineScripts(html);
html = html.replace(/\s*crossorigin/g, '');

await writeFile(outputPath, html, 'utf8');

console.log(`Standalone HTML written to ${outputPath}`);

async function inlineStyles(source) {
  const linkPattern = /<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g;
  return replaceAsync(source, linkPattern, async (_match, href) => {
    const cssPath = resolveAsset(href);
    const css = await readFile(cssPath, 'utf8');
    return `<style>\n${css}\n</style>`;
  });
}

async function inlineScripts(source) {
  const scriptPattern = /<script\s+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g;
  return replaceAsync(source, scriptPattern, async (_match, src) => {
    const jsPath = resolveAsset(src);
    const js = await readFile(jsPath, 'utf8');
    return `<script type="module">\n${js}\n</script>`;
  });
}

function resolveAsset(assetPath) {
  return resolve(distDir, assetPath.replace(/^\.\//, '').replace(/^\//, ''));
}

async function replaceAsync(source, pattern, replacer) {
  const matches = [...source.matchAll(pattern)];
  let result = source;

  for (const match of matches.reverse()) {
    const replacement = await replacer(...match);
    result = `${result.slice(0, match.index)}${replacement}${result.slice(match.index + match[0].length)}`;
  }

  return result;
}
