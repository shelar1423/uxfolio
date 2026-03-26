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

// Href paths as they appear on the homepage
const HOMEPAGE_HREFS = {
  'svaroots': '/articles/svaroots',
  'broken-pots-2': '/broken-pots-2',
  'emerald': '/emerald',
  'origin': '/origin',
};

const INJECT_MARKER = '<!--ADMIN_CARDS_END-->';

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
      text.startsWith('.') ||
      text.startsWith('#') ||
      text.length < 15
    ) continue;

    seen.add(text);
    results.push(text);
  }

  return results;
}

function extractImages(html) {
  const matches = html.match(/https:\/\/framerusercontent\.com\/images\/[A-Za-z0-9_\-\.]+\.(?:png|jpg|jpeg|webp|gif|svg)/g) || [];
  return [...new Set(matches)];
}

function extractCoverImage(html) {
  const match = html.match(/<meta property="og:image" content="([^"]+)"/);
  return match ? match[1] : '';
}

/**
 * Extract card HTML for a case study from the homepage
 */
function extractHomepageCard(indexHtml, slug) {
  const hrefPath = HOMEPAGE_HREFS[slug];
  if (!hrefPath) return null;

  const hrefTarget = `href="${hrefPath}"`;
  const hrefPos = indexHtml.indexOf(hrefTarget);
  if (hrefPos === -1) return null;

  // Walk back to the opening container div
  const containerStart = indexHtml.lastIndexOf('<div class="framer-', hrefPos);
  if (containerStart === -1) return null;

  // Walk forward — find the end of this card by looking at the next card or a safe closing
  // Strategy: find the matching </div> that closes the container
  let depth = 0;
  let i = containerStart;
  while (i < indexHtml.length) {
    if (indexHtml.startsWith('<div', i)) depth++;
    else if (indexHtml.startsWith('</div>', i)) {
      depth--;
      if (depth === 0) {
        const cardEnd = i + 6; // include </div>
        return indexHtml.slice(containerStart, cardEnd);
      }
    }
    i++;
  }
  return null;
}

/**
 * Add the inject marker to index.html after the last card
 */
function addInjectMarker(indexHtml) {
  if (indexHtml.includes(INJECT_MARKER)) return indexHtml; // already added

  // Find the last card end by finding all known card hrefs and picking the latest
  const hrefs = Object.values(HOMEPAGE_HREFS).map(h => `href="${h}"`);
  let lastCardEnd = 0;

  for (const hrefTarget of hrefs) {
    const hrefPos = indexHtml.indexOf(hrefTarget);
    if (hrefPos === -1) continue;

    const containerStart = indexHtml.lastIndexOf('<div class="framer-', hrefPos);
    if (containerStart === -1) continue;

    let depth = 0;
    let i = containerStart;
    while (i < indexHtml.length) {
      if (indexHtml.startsWith('<div', i)) depth++;
      else if (indexHtml.startsWith('</div>', i)) {
        depth--;
        if (depth === 0) {
          const cardEnd = i + 6;
          if (cardEnd > lastCardEnd) lastCardEnd = cardEnd;
          break;
        }
      }
      i++;
    }
  }

  if (lastCardEnd === 0) {
    console.warn('⚠️  Could not find card injection point in index.html');
    return indexHtml;
  }

  return indexHtml.slice(0, lastCardEnd) + INJECT_MARKER + indexHtml.slice(lastCardEnd);
}

function run() {
  const dataFile = path.join(ROOT, 'data', 'case-studies.json');

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

  // Add inject marker to index.html
  const indexPath = path.join(ROOT, 'index.html');
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  const indexWithMarker = addInjectMarker(indexHtml);
  if (indexWithMarker !== indexHtml) {
    fs.writeFileSync(indexPath, indexWithMarker, 'utf8');
    // Also copy as template
    const indexTplPath = path.join(ROOT, 'templates', 'index.html');
    fs.copyFileSync(indexPath, indexTplPath);
    console.log('📋 Added card injection marker to index.html');
  } else if (!fs.existsSync(path.join(ROOT, 'templates', 'index.html'))) {
    fs.copyFileSync(indexPath, path.join(ROOT, 'templates', 'index.html'));
    console.log('📋 Template created: templates/index.html');
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

    // Extract homepage card HTML for this case study
    const cardHtml = extractHomepageCard(fs.readFileSync(indexPath, 'utf8'), cs.id);

    const existing = existingMap[cs.id];

    const entry = {
      id: cs.id,
      slug: cs.slug,
      outputPath: cs.outputPath,
      templateFile: cs.templateFile,
      coverImage: existing?.coverImage || coverImage,
      homepageCardHtml: cardHtml || existing?.homepageCardHtml || null,
      meta: {
        title: existing?.meta?.title || meta.title,
        description: existing?.meta?.description || meta.description,
        ogTitle: existing?.meta?.ogTitle || meta.ogTitle,
        ogDescription: existing?.meta?.ogDescription || meta.ogDescription,
        ogImage: existing?.meta?.ogImage || meta.ogImage,
        canonical: existing?.meta?.canonical || meta.canonical,
      },
      _originalMeta: {
        title: meta.title,
        description: meta.description,
        ogTitle: meta.ogTitle,
        ogDescription: meta.ogDescription,
        ogImage: meta.ogImage,
        canonical: meta.canonical,
      },
      contentMap: texts.slice(0, 60).map(text => {
        const existingEntry = existing?.contentMap?.find(e => e.original === text);
        return {
          original: text,
          current: existingEntry ? existingEntry.current : text,
          label: autoLabel(text),
        };
      }),
      imageMap: allImages.slice(0, 20).map(url => {
        const existingEntry = existing?.imageMap?.find(e => e.original === url);
        return {
          original: url,
          current: existingEntry ? existingEntry.current : url,
        };
      }),
    };

    result['case-studies'].push(entry);
    console.log(`✅ Extracted: ${cs.id} (${texts.length} text blocks, ${allImages.length} images, card: ${cardHtml ? 'found' : 'not found'})`);
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
