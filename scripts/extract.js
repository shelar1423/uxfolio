/**
 * extract.js — One-time setup script
 * Reads all Framer HTML case study files, extracts editable content,
 * writes to data/case-studies.json and copies originals to templates/
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');

const ROOT = path.join(__dirname, '..');

const CASE_STUDIES = [
  {
    id: 'svaroots',
    slug: 'articles/svaroots',
    sourcePath: 'articles/svaroots/index.html',
    outputPath: 'articles/svaroots/index.html',
    templateFile: 'templates/svaroots.html',
  },
  {
    id: 'broken-pots-2',
    slug: 'broken-pots-2',
    sourcePath: 'broken-pots-2/index.html',
    outputPath: 'broken-pots-2/index.html',
    templateFile: 'templates/broken-pots-2.html',
  },
  {
    id: 'emerald',
    slug: 'emerald',
    sourcePath: 'emerald/index.html',
    outputPath: 'emerald/index.html',
    templateFile: 'templates/emerald.html',
  },
  {
    id: 'origin',
    slug: 'origin',
    sourcePath: 'origin/index.html',
    outputPath: 'origin/index.html',
    templateFile: 'templates/origin.html',
  },
];

function extractMeta(root, html) {
  const title = root.querySelector('title')?.text?.trim() || '';
  const description = root.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content') || title;
  const ogDescription = root.querySelector('meta[property="og:description"]')?.getAttribute('content') || description;
  const ogImage = root.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';

  return { title, description, ogTitle, ogDescription, ogImage, canonical };
}

function extractTextContent(html) {
  // Extract visible text strings between HTML tags (>15 chars, not CSS/JS)
  const matches = html.match(/>([^<>]{15,500})</g) || [];
  const seen = new Set();
  const results = [];

  for (const match of matches) {
    const text = match.slice(1, -1).trim();
    if (
      !text ||
      seen.has(text) ||
      text.includes('{') ||
      text.includes('function') ||
      text.includes('var ') ||
      text.includes('const ') ||
      text.includes('let ') ||
      text.includes('//') ||
      text.includes('@font-face') ||
      text.includes('@keyframes') ||
      text.includes('framer') ||
      text.includes('--token') ||
      text.match(/^[\s\d\.,\-\%\(\)px]+$/) ||
      text.startsWith('@') ||
      text.startsWith('/*') ||
      text.startsWith('.')  ||
      text.startsWith('#') ||
      text.length < 15
    ) continue;

    seen.add(text);
    results.push(text);
  }

  return results;
}

function extractImages(html) {
  // Extract all framerusercontent.com image URLs
  const matches = html.match(/https:\/\/framerusercontent\.com\/images\/[A-Za-z0-9_\-\.]+\.(?:png|jpg|jpeg|webp|gif|svg)/g) || [];
  return [...new Set(matches)];
}

function extractCoverImage(html) {
  // The OG image is the best candidate for cover image
  const match = html.match(/<meta property="og:image" content="([^"]+)"/);
  return match ? match[1] : '';
}

function run() {
  const dataFile = path.join(ROOT, 'data', 'case-studies.json');

  // Load existing data if any (to preserve edits)
  let existingData = { 'case-studies': [] };
  if (fs.existsSync(dataFile)) {
    try {
      existingData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      console.log('📂 Found existing data/case-studies.json — preserving your edits.');
    } catch (e) {
      console.log('⚠️  Could not parse existing data file, starting fresh.');
    }
  }

  const existingMap = {};
  for (const cs of existingData['case-studies']) {
    existingMap[cs.id] = cs;
  }

  const result = { 'case-studies': [] };

  for (const cs of CASE_STUDIES) {
    const srcPath = path.join(ROOT, cs.sourcePath);
    if (!fs.existsSync(srcPath)) {
      console.warn(`⚠️  Skipping ${cs.id} — file not found: ${cs.sourcePath}`);
      continue;
    }

    const html = fs.readFileSync(srcPath, 'utf8');
    const root = parse(html);

    // Copy original to templates/ (only if template doesn't exist yet — never overwrite)
    const tplPath = path.join(ROOT, cs.templateFile);
    if (!fs.existsSync(tplPath)) {
      fs.copyFileSync(srcPath, tplPath);
      console.log(`📋 Template created: ${cs.templateFile}`);
    } else {
      console.log(`✅ Template already exists: ${cs.templateFile}`);
    }

    const meta = extractMeta(root, html);
    const texts = extractTextContent(html);
    const allImages = extractImages(html);
    const coverImage = extractCoverImage(html);

    // If we have existing data for this case study, merge to preserve edits
    const existing = existingMap[cs.id];

    const entry = {
      id: cs.id,
      slug: cs.slug,
      outputPath: cs.outputPath,
      templateFile: cs.templateFile,
      coverImage: existing?.coverImage || coverImage,
      meta: {
        title: existing?.meta?.title || meta.title,
        description: existing?.meta?.description || meta.description,
        ogTitle: existing?.meta?.ogTitle || meta.ogTitle,
        ogDescription: existing?.meta?.ogDescription || meta.ogDescription,
        ogImage: existing?.meta?.ogImage || meta.ogImage,
        canonical: existing?.meta?.canonical || meta.canonical,
      },
      // Store original meta for reverting
      _originalMeta: {
        title: meta.title,
        description: meta.description,
        ogTitle: meta.ogTitle,
        ogDescription: meta.ogDescription,
        ogImage: meta.ogImage,
        canonical: meta.canonical,
      },
      // Text content: preserve current values if editing, use original otherwise
      contentMap: texts.slice(0, 60).map(text => {
        const existingEntry = existing?.contentMap?.find(e => e.original === text);
        return {
          original: text,
          current: existingEntry ? existingEntry.current : text,
          label: autoLabel(text),
        };
      }),
      // All images extracted (for reference)
      imageMap: allImages.slice(0, 20).map(url => {
        const existingEntry = existing?.imageMap?.find(e => e.original === url);
        return {
          original: url,
          current: existingEntry ? existingEntry.current : url,
        };
      }),
    };

    result['case-studies'].push(entry);
    console.log(`✅ Extracted: ${cs.id} (${texts.length} text blocks, ${allImages.length} images)`);
  }

  fs.writeFileSync(dataFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n📝 Saved: data/case-studies.json`);
  console.log(`\n🎉 Setup complete! Run: npm run admin\n`);
}

function autoLabel(text) {
  if (text.length > 80) return text.slice(0, 60) + '...';
  return text;
}

run();
