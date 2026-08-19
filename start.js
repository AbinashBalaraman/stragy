import fs from 'fs';
import { execSync, spawn } from 'child_process';
import path from 'path';

const distServer = path.join(process.cwd(), 'dist', 'server.cjs');
const distHtml = path.join(process.cwd(), 'dist', 'index.html');

if (!fs.existsSync(distServer) || !fs.existsSync(distHtml)) {
  console.log('⚡ [Stragy] Build artifacts missing in dist/. Running "npm run build" automatically...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log('✅ [Stragy] Build completed successfully.');
  } catch (err) {
    console.error('❌ [Stragy] Build failed:', err);
    process.exit(1);
  }
}

console.log('🚀 [Stragy] Launching production server on port ' + (process.env.PORT || 3000) + '...');
const child = spawn('node', [distServer], { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code || 0);
});
