import fs from 'node:fs';

const writeJson = (path, value) => fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const replace = (path, transform) => {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`Expected release token not found in ${path}`);
  fs.writeFileSync(path, after);
};

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '0.7.0';
writeJson('package.json', pkg);

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
lock.version = '0.7.0';
if (lock.packages?.['']) lock.packages[''].version = '0.7.0';
writeJson('package-lock.json', lock);

replace('netlify/functions/health.mjs', (s) => s.replace(/version: ['"]0\.6\.2['"]/, "version: '0.7.0'"));
replace('openapi/korea-web-agent-action.yaml', (s) => s.replace(/^\s*version:\s*0\.6\.2\s*$/m, '  version: 0.7.0'));
replace('.github/workflows/production-smoke.yml', (s) => s.replaceAll('v0.6.2', 'v0.7.0').replaceAll('0.6.2', '0.7.0'));
replace('tests/version-metadata.test.ts', (s) => s.replaceAll('v0.6.2', 'v0.7.0').replaceAll('0.6.2', '0.7.0').replaceAll('0\\.6\\.2', '0\\.7\\.0'));
replace('tests/openapi-v062.test.ts', (s) => s.replaceAll('v0.6.2', 'v0.7.0').replaceAll('0.6.2', '0.7.0').replaceAll('0\\.6\\.2', '0\\.7\\.0'));

const readme = fs.readFileSync('README.md', 'utf8');
if (!readme.includes('## v0.7.0 Shopping Intelligence')) {
  const section = `\n## v0.7.0 Shopping Intelligence\n\n- Broad multi-query discovery with bounded candidate normalization\n- Verified hard-constraint gating for portable displays and bedding\n- Top 5 deep review research and Top 3 full Provider v2 price verification\n- Duplicate, sponsored, and repeated-negative review controls\n- Public recommendation ranking isolated from Relay personalization\n- Exact model and explicit URL requests preserve the authoritative exact-product path\n- Unsupported categories remain on the legacy resolver until a dedicated schema exists\n\n`;
  const firstHeadingEnd = readme.indexOf('\n', readme.indexOf('# '));
  fs.writeFileSync('README.md', readme.slice(0, firstHeadingEnd + 1) + section + readme.slice(firstHeadingEnd + 1));
}
