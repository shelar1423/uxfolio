/**
 * build.js — Rebuilds all case study HTML files from templates + data/case-studies.json
 * Safe: only writes to output paths, never modifies templates/
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function applyMetaReplacements(html, originalMeta, newMeta) {
  let out = html;

  // Title tag
  if (originalMeta.title) {
    out = out.replace(
      `<title>${escapeHtml(originalMeta.title)}</title>`,
      `<title>${escapeHtml(newMeta.title)}</title>`
    );
    // Also replace unescaped version
    out = out.replace(
      `<title>${originalMeta.title}</title>`,
      `<title>${newMeta.title}</title>`
    );
  }

  // OG title
  if (originalMeta.ogTitle) {
    out = out.replace(
      `og:title" content="${originalMeta.ogTitle}"`,
      `og:title" content="${newMeta.ogTitle}"`
    );
  }

  // Twitter title
  if (originalMeta.ogTitle) {
    out = out.replace(
      `twitter:title" content="${originalMeta.ogTitle}"`,
      `twitter:title" content="${newMeta.ogTitle}"`
    );
  }

  // Description
  if (originalMeta.description) {
    out = out.replace(
      `name="description" content="${originalMeta.description}"`,
      `name="description" content="${newMeta.description}"`
    );
    out = out.replace(
      `og:description" content="${originalMeta.description}"`,
      `og:description" content="${newMeta.ogDescription || newMeta.description}"`
    );
    out = out.replace(
      `twitter:description" content="${originalMeta.description}"`,
      `twitter:description" content="${newMeta.ogDescription || newMeta.description}"`
    );
  }

  // OG image
  if (originalMeta.ogImage && newMeta.ogImage && originalMeta.ogImage !== newMeta.ogImage) {
    out = out.split(originalMeta.ogImage).join(newMeta.ogImage);
  }

  return out;
}

function applyContentMap(html, contentMap) {
  let out = html;
  for (const entry of contentMap) {
    if (entry.original !== entry.current && entry.current) {
      // Replace all occurrences
      out = out.split(entry.original).join(entry.current);
    }
  }
  return out;
}

function applyImageMap(html, imageMap) {
  let out = html;
  for (const entry of imageMap) {
    if (entry.original !== entry.current && entry.current) {
      out = out.split(entry.original).join(entry.current);
    }
  }
  return out;
}

function updateSitemap(caseStudies) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  const urls = ['index.html', ...caseStudies.map(cs => `${cs.outputPath}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(sitemapPath, xml, 'utf8');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function build(caseStudyId) {
  const dataFile = path.join(ROOT, 'data', 'case-studies.json');
  if (!fs.existsSync(dataFile)) {
    throw new Error('data/case-studies.json not found. Run: npm run extract');
  }

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const studies = caseStudyId
    ? data['case-studies'].filter(cs => cs.id === caseStudyId)
    : data['case-studies'];

  if (studies.length === 0) {
    throw new Error(`No case study found with id: ${caseStudyId}`);
  }

  for (const cs of studies) {
    const tplPath = path.join(ROOT, cs.templateFile);
    if (!fs.existsSync(tplPath)) {
      console.warn(`⚠️  Template not found: ${cs.templateFile} — skipping ${cs.id}`);
      continue;
    }

    let html = fs.readFileSync(tplPath, 'utf8');

    // Apply meta replacements
    html = applyMetaReplacements(html, cs._originalMeta || cs.meta, cs.meta);

    // Apply text content replacements
    if (cs.contentMap) {
      html = applyContentMap(html, cs.contentMap);
    }

    // Apply image replacements
    if (cs.imageMap) {
      html = applyImageMap(html, cs.imageMap);
    }

    // Write output
    const outPath = path.join(ROOT, cs.outputPath);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`✅ Built: ${cs.outputPath}`);
  }

  // Update sitemap with all current case studies
  updateSitemap(data['case-studies']);
  console.log(`📝 Updated: sitemap.xml`);
}

// Run as CLI: node scripts/build.js [case-study-id]
if (require.main === module) {
  const id = process.argv[2];
  try {
    build(id);
    console.log('\n🎉 Build complete!');
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

module.exports = { build };
