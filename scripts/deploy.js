/**
 * deploy.js — Commits all changes and pushes to GitHub (triggers Vercel auto-deploy)
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
}

function deploy(message) {
  const commitMsg = message || `Update case studies — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  try {
    run('git add -A');
    const status = run('git status --porcelain');
    if (!status) {
      console.log('Nothing to deploy — no changes detected.');
      return { success: true, message: 'No changes to deploy.' };
    }
    run(`git commit -m "${commitMsg.replace(/"/g, "'")}"`);
    run('git push');
    console.log('🚀 Pushed to GitHub! Vercel will deploy in ~30 seconds.');
    return { success: true, message: 'Deployed successfully! Vercel will go live in ~30s.' };
  } catch (err) {
    const msg = err.stderr?.toString() || err.message;
    console.error('❌ Deploy failed:', msg);
    return { success: false, message: msg };
  }
}

if (require.main === module) {
  const message = process.argv.slice(2).join(' ');
  const result = deploy(message);
  if (!result.success) process.exit(1);
}

module.exports = { deploy };
