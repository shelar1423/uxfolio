/**
 * migrate-to-cloudinary.js
 * Downloads all framerusercontent.com images/videos and uploads to Cloudinary.
 * Updates all HTML files with new Cloudinary URLs.
 *
 * Usage:
 *   node scripts/migrate-to-cloudinary.js <cloud_name> <api_key> <api_secret>
 *
 * Example:
 *   node scripts/migrate-to-cloudinary.js mycloud 123456789 abcdefghijk
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { v2: cloudinary } = require('cloudinary');
const os = require('os');

const ROOT = path.join(__dirname, '..');

const HTML_FILES = [
  'index.html',
  'articles/svaroots/index.html',
  'broken-pots-2/index.html',
  'emerald/index.html',
  'origin/index.html',
  'templates/index.html',
  'templates/svaroots.html',
  'templates/broken-pots-2.html',
  'templates/emerald.html',
  'templates/origin.html',
];

const MIGRATION_LOG = path.join(ROOT, 'data', 'cloudinary-migration.json');
const URL_PATTERN = /https:\/\/framerusercontent\.com\/(images|assets)\/[A-Za-z0-9_\-\.]+\.(?:png|jpg|jpeg|webp|gif|svg|mp4|webm)/g;

// ── Helpers ────────────────────────────────────────────────

function extractAllUrls() {
  const urlSet = new Set();
  for (const file of HTML_FILES) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const matches = html.match(URL_PATTERN) || [];
    matches.forEach(u => urlSet.add(u));
  }
  return [...urlSet];
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return download(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function getResourceType(url) {
  if (url.match(/\.(mp4|webm)$/i)) return 'video';
  if (url.match(/\.(svg)$/i)) return 'image';
  return 'image';
}

function urlToPublicId(url) {
  const filename = path.basename(url).replace(/\.[^.]+$/, '');
  return `uxfolio/${filename}`;
}

async function uploadToCloudinary(localPath, url) {
  const resourceType = getResourceType(url);
  const publicId = urlToPublicId(url);

  const result = await cloudinary.uploader.upload(localPath, {
    public_id: publicId,
    resource_type: resourceType,
    overwrite: false,
    use_filename: true,
    unique_filename: true,
  });

  return result.secure_url;
}

function replaceUrlsInFiles(urlMap) {
  let totalReplacements = 0;
  for (const file of HTML_FILES) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    let html = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    let count = 0;

    for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
      if (html.includes(oldUrl)) {
        html = html.split(oldUrl).join(newUrl);
        count++;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, html, 'utf8');
      totalReplacements += count;
      console.log(`  📄 ${file}: replaced ${count} URLs`);
    }
  }

  // Also update data/case-studies.json
  const dataFile = path.join(ROOT, 'data', 'case-studies.json');
  if (fs.existsSync(dataFile)) {
    let json = fs.readFileSync(dataFile, 'utf8');
    let changed = false;
    for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
      if (json.includes(oldUrl)) {
        json = json.split(oldUrl).join(newUrl);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(dataFile, json, 'utf8');
      console.log('  📄 data/case-studies.json: updated');
    }
  }

  return totalReplacements;
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const [,, cloudName, apiKey, apiSecret] = process.argv;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error('Usage: node scripts/migrate-to-cloudinary.js <cloud_name> <api_key> <api_secret>');
    console.error('\nFind these at: Cloudinary dashboard → Settings → API Keys');
    process.exit(1);
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

  // Load existing migration log to skip already-uploaded files
  let migrationLog = {};
  if (fs.existsSync(MIGRATION_LOG)) {
    migrationLog = JSON.parse(fs.readFileSync(MIGRATION_LOG, 'utf8'));
    const done = Object.keys(migrationLog).length;
    if (done > 0) console.log(`📂 Resuming — ${done} files already migrated, skipping them.\n`);
  }

  const allUrls = extractAllUrls();
  const toMigrate = allUrls.filter(u => !migrationLog[u]);

  console.log(`🔍 Found ${allUrls.length} unique media URLs`);
  console.log(`📤 Need to upload: ${toMigrate.length} files\n`);

  if (toMigrate.length === 0) {
    console.log('✅ All files already migrated! Applying URL replacements...');
    const total = replaceUrlsInFiles(migrationLog);
    console.log(`\n✅ Done — ${total} URL replacements applied.`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'framer-migration-'));
  let success = 0, failed = 0;

  for (let i = 0; i < toMigrate.length; i++) {
    const url = toMigrate[i];
    const ext = path.extname(url);
    const tmpFile = path.join(tmpDir, `file_${i}${ext}`);
    const num = `[${i + 1}/${toMigrate.length}]`;

    process.stdout.write(`${num} ${path.basename(url)} ... `);

    try {
      await download(url, tmpFile);
      const cloudUrl = await uploadToCloudinary(tmpFile, url);
      migrationLog[url] = cloudUrl;
      fs.unlinkSync(tmpFile);

      // Save progress after each upload (so we can resume if interrupted)
      fs.writeFileSync(MIGRATION_LOG, JSON.stringify(migrationLog, null, 2), 'utf8');
      console.log(`✅`);
      success++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Uploaded: ${success} | Failed: ${failed}`);

  // Clean up temp dir
  try { fs.rmdirSync(tmpDir); } catch (e) {}

  // Replace all URLs in HTML files
  console.log('\n🔄 Replacing URLs in HTML files...');
  const total = replaceUrlsInFiles(migrationLog);
  console.log(`\n✅ Migration complete! ${total} URL replacements applied.`);
  console.log('\nNext step: Run "npm run build" then deploy from the admin dashboard.\n');
}

main().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
