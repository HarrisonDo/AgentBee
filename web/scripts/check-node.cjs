const requiredMajor = 20;
const requiredMinor = 19;
const version = process.versions.node;
const parts = version.split('.').map(Number);
const major = parts[0] || 0;
const minor = parts[1] || 0;

const ok = major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);

if (!ok) {
  console.error('');
  console.error(`BeeWeb requires Node.js >= ${requiredMajor}.${requiredMinor}.0 for the current Vite toolchain.`);
  console.error(`Current Node.js version: ${version}`);
  console.error('');
  console.error('Please install a newer Node.js LTS version, then run:');
  console.error('  npm install');
  console.error('  npm run dev');
  console.error('');
  console.error('BeeWeb 当前 Vite 工具链需要 Node.js >= 20.19.0。');
  console.error(`当前 Node.js 版本：${version}`);
  console.error('请升级 Node.js LTS 后重新执行 npm install 和 npm run dev。');
  console.error('');
  process.exit(1);
}
