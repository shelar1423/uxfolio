/**
 * admin/server.js — Local admin server for portfolio case study editing
 * Run: npm run admin
 * Opens: http://localhost:3001
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = 3001;
const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'case-studies.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ────────────────────────────────────────────────────────────────

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error('data/case-studies.json not found. Run: npm run extract');
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function runBuild(caseStudyId) {
  const { build } = require('../scripts/build.js');
  build(caseStudyId);
}

function runGit(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// GET all case studies (summary for dashboard)
app.get('/api/case-studies', (req, res) => {
  try {
    const data = readData();
    const summary = data['case-studies'].map(cs => ({
      id: cs.id,
      slug: cs.slug,
      title: cs.meta?.title || cs.id,
      coverImage: cs.coverImage || cs.meta?.ogImage || '',
      outputPath: cs.outputPath,
    }));
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single case study (full data for editor)
app.get('/api/case-studies/:id', (req, res) => {
  try {
    const data = readData();
    const cs = data['case-studies'].find(c => c.id === req.params.id);
    if (!cs) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: cs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update case study and rebuild
app.put('/api/case-studies/:id', (req, res) => {
  try {
    const data = readData();
    const idx = data['case-studies'].findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });

    const updated = req.body;
    data['case-studies'][idx] = { ...data['case-studies'][idx], ...updated };
    writeData(data);

    runBuild(req.params.id);
    res.json({ success: true, message: 'Saved and rebuilt successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create new case study (clone from template)
app.post('/api/case-studies', (req, res) => {
  try {
    const data = readData();
    const { id, slug, templateId, meta } = req.body;

    if (!id || !slug || !templateId) {
      return res.status(400).json({ success: false, error: 'id, slug, and templateId are required.' });
    }
    if (data['case-studies'].find(c => c.id === id)) {
      return res.status(400).json({ success: false, error: `Case study "${id}" already exists.` });
    }

    const template = data['case-studies'].find(c => c.id === templateId);
    if (!template) {
      return res.status(400).json({ success: false, error: `Template case study "${templateId}" not found.` });
    }

    // Copy template file
    const tplSrcPath = path.join(ROOT, template.templateFile);
    const newTplPath = path.join(ROOT, 'templates', `${id}.html`);
    fs.copyFileSync(tplSrcPath, newTplPath);

    const outputPath = `${slug}/index.html`;
    const outDir = path.join(ROOT, slug);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const newEntry = {
      id,
      slug,
      outputPath,
      templateFile: `templates/${id}.html`,
      coverImage: meta?.ogImage || template.coverImage || '',
      meta: {
        title: meta?.title || `${id} - Digvijay Portfolio`,
        description: meta?.description || template.meta.description,
        ogTitle: meta?.title || `${id} - Digvijay Portfolio`,
        ogDescription: meta?.description || template.meta.ogDescription,
        ogImage: meta?.ogImage || template.meta.ogImage,
        canonical: template.meta.canonical,
      },
      _originalMeta: { ...template._originalMeta },
      contentMap: template.contentMap.map(e => ({ ...e })),
      imageMap: template.imageMap.map(e => ({ ...e })),
    };

    // Apply the new title to the content map if it appears
    const oldTitle = template.meta.title || template._originalMeta?.title || '';
    const newTitle = newEntry.meta.title;
    if (oldTitle) {
      newEntry.contentMap = newEntry.contentMap.map(e =>
        e.current === oldTitle ? { ...e, current: newTitle } : e
      );
    }

    data['case-studies'].push(newEntry);
    writeData(data);

    runBuild(id);
    res.json({ success: true, message: `Created "${id}" successfully.`, id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE case study
app.delete('/api/case-studies/:id', (req, res) => {
  try {
    const data = readData();
    const idx = data['case-studies'].findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });

    const cs = data['case-studies'][idx];
    data['case-studies'].splice(idx, 1);
    writeData(data);

    // Remove output directory
    const outDir = path.join(ROOT, path.dirname(cs.outputPath));
    if (fs.existsSync(outDir) && outDir !== ROOT) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }

    // Remove template file
    const tplPath = path.join(ROOT, cs.templateFile);
    if (fs.existsSync(tplPath)) fs.unlinkSync(tplPath);

    res.json({ success: true, message: `Deleted "${req.params.id}".` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST rebuild all
app.post('/api/build', (req, res) => {
  try {
    runBuild();
    res.json({ success: true, message: 'All pages rebuilt successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST deploy (git commit + push)
app.post('/api/deploy', (req, res) => {
  try {
    const { message } = req.body;
    const commitMsg = message || `Update case studies — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

    runGit('git add -A');
    const status = runGit('git status --porcelain');
    if (!status) {
      return res.json({ success: true, message: 'No changes to deploy — already up to date.' });
    }
    runGit(`git commit -m "${commitMsg.replace(/"/g, "'")}"`);
    runGit('git push');
    res.json({ success: true, message: '🚀 Deployed! Live at https://uxfolio.vercel.app in ~30 seconds.' });
  } catch (err) {
    const msg = err.stderr?.toString() || err.message;
    // Common: not a git repo yet
    if (msg.includes('not a git repository')) {
      return res.status(400).json({
        success: false,
        error: 'Git not set up yet. See the Setup tab for instructions.',
      });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

// GET git status
app.get('/api/git-status', (req, res) => {
  try {
    const status = runGit('git status --porcelain');
    const branch = runGit('git branch --show-current');
    const remoteUrl = (() => { try { return runGit('git remote get-url origin'); } catch { return ''; } })();
    res.json({ success: true, status, branch, remoteUrl, hasChanges: status.length > 0 });
  } catch (err) {
    res.json({ success: true, status: '', branch: '', remoteUrl: '', hasChanges: false, notSetUp: true });
  }
});

// POST preview — returns path to local HTML file
app.get('/api/preview/:id', (req, res) => {
  try {
    const data = readData();
    const cs = data['case-studies'].find(c => c.id === req.params.id);
    if (!cs) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, path: `/${cs.outputPath}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve site files for preview
app.use('/preview-site', express.static(ROOT, {
  index: 'index.html',
}));

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🎨 Admin Dashboard running at: ${url}\n`);
  console.log('   Press Ctrl+C to stop.\n');

  // Auto-open in browser
  try {
    const { default: open } = await import('open');
    open(url);
  } catch (e) {
    // open is optional
  }
});
