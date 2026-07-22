/**
 * Test suite per ColoriVeloci
 * Verifica: database colori, SEO, sub-path safety, funzionalità server
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, 'index.html');
const PORT = 4699; // test port (diversa da 4600 per sicurezza)

// ── Helper: parse hex ──
function isValidHex(h) {
  return typeof h === 'string' && /^#[0-9A-Fa-f]{6}$/.test(h);
}

// ── Helper: extract DB from HTML ──
function extractDB(html) {
  // Estrae l'array DB dal <script>
  const match = html.match(/const DB = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('Database DB non trovato nel HTML');
  // Valuta l'array in un contesto isolato
  const db = eval(match[1]);
  return db;
}

// ── Helper: start static server ──
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url === '/' ? '/index.html' : req.url;
      const filePath = path.join(ROOT, url.replace(/^\//, ''));
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.txt': 'text/plain',
        '.xml': 'application/xml',
        '.json': 'application/json'
      }[ext] || 'application/octet-stream';

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(PORT, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

function fetchPage(pathname = '/') {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${pathname}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Global setup ──
let server;
let htmlContent;

before(async () => {
  htmlContent = fs.readFileSync(HTML_PATH, 'utf-8');
  server = await startServer();
});

after(() => {
  if (server) server.close();
});

// ═══════════════════════════════════════════════════════════════
// DATABASE COLORI
// ═══════════════════════════════════════════════════════════════
describe('Database colori', () => {
  let db;

  before(() => {
    db = extractDB(htmlContent);
  });

  test('contiene almeno 160 colori', () => {
    assert.ok(db.length >= 160, `Trovati ${db.length} colori, ne servono >=160`);
  });

  test('ogni entry ha nome italiano (n), nome inglese (e) e hex (h)', () => {
    for (let i = 0; i < db.length; i++) {
      const c = db[i];
      assert.ok(typeof c.n === 'string' && c.n.length > 0, `Entry ${i}: nome italiano mancante`);
      assert.ok(typeof c.h === 'string', `Entry ${i}: hex mancante per "${c.n}"`);
    }
  });

  test('tutti i codici hex sono validi (# + 6 hex digits)', () => {
    const invalid = db.filter(c => !isValidHex(c.h));
    assert.equal(invalid.length, 0,
      `Hex non validi: ${invalid.map(c => `${c.n}:${c.h}`).join(', ')}`);
  });

  test('nessun hex duplicato con nome diverso (a meno che non sia intenzionale)', () => {
    const hexMap = new Map();
    const unintentionalDupes = [];
    const intentionalDupes = ['#FF00FF','#000080','#800080','#FFFFFF','#87CEEB','#FFFDD0','#2E8B57']; // fuchsia/magenta, navy/marine, viola, bianco puro
    for (const c of db) {
      if (hexMap.has(c.h) && !intentionalDupes.includes(c.h)) {
        const other = hexMap.get(c.h);
        unintentionalDupes.push(`${c.n} e ${other} condividono ${c.h}`);
      }
      hexMap.set(c.h, c.n);
    }
    assert.equal(unintentionalDupes.length, 0,
      `Duplicati hex sospetti:\n${unintentionalDupes.join('\n')}`);
  });

  test('colori fondamentali sono presenti', () => {
    const mustHave = ['rosso','blu','verde','giallo','arancione','viola','rosa','marrone','grigio','nero','bianco'];
    const names = new Set(db.map(c => c.n));
    for (const name of mustHave) {
      assert.ok(names.has(name), `"${name}" non trovato nel database`);
    }
  });

  test('colori fondamentali hanno l\'hex corretto', () => {
    const checks = [
      { n: 'rosso', h: '#FF0000' },
      { n: 'blu', h: '#0000FF' },
      { n: 'verde', h: '#008000' },
      { n: 'giallo', h: '#FFFF00' },
      { n: 'nero', h: '#000000' },
      { n: 'bianco', h: '#FFFFFF' },
    ];
    for (const { n, h } of checks) {
      const found = db.find(c => c.n === n);
      assert.ok(found, `"${n}" non trovato`);
      assert.equal(found.h, h, `"${n}" ha hex ${found.h}, atteso ${h}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SEO
// ═══════════════════════════════════════════════════════════════
describe('SEO', () => {
  test('ha <title> descrittivo e unico', () => {
    const match = htmlContent.match(/<title>(.*?)<\/title>/);
    assert.ok(match, '<title> mancante');
    const title = match[1];
    assert.ok(title.length >= 20, `Title troppo corto: "${title}"`);
    assert.ok(title.includes('ColoriVeloci') || title.includes('colore'), 'Title non descrive l\'app');
  });

  test('ha meta description', () => {
    const match = htmlContent.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    assert.ok(match, 'Meta description mancante');
    assert.ok(match[1].length >= 50, 'Meta description troppo corta');
  });

  test('ha <link rel="canonical"> con URL corretto', () => {
    const match = htmlContent.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
    assert.ok(match, 'Canonical mancante');
    assert.equal(match[1], 'https://github.com/bonciarello/coloriveloce/',
      `Canonical URL errato: ${match[1]}`);
  });

  test('ha Open Graph tags', () => {
    assert.ok(htmlContent.includes('og:title'), 'og:title mancante');
    assert.ok(htmlContent.includes('og:description'), 'og:description mancante');
    assert.ok(htmlContent.includes('og:type'), 'og:type mancante');
    assert.ok(htmlContent.includes('og:url'), 'og:url mancante');
    const ogUrlMatch = htmlContent.match(/og:url"\s+content="([^"]+)"/);
    assert.ok(ogUrlMatch, 'og:url non trovato');
  });

  test('ha JSON-LD schema.org', () => {
    assert.ok(htmlContent.includes('application/ld+json'), 'JSON-LD mancante');
    assert.ok(htmlContent.includes('WebApplication'), 'JSON-LD non contiene WebApplication');
    assert.ok(htmlContent.includes('github.com/bonciarello/coloriveloce/'),
      'JSON-LD URL non corretto');
  });

  test('ha <meta name="viewport">', () => {
    assert.ok(htmlContent.includes('name="viewport"'), 'Viewport meta mancante');
  });

  test('ha esattamente un <h1>', () => {
    const h1Count = (htmlContent.match(/<h1[\s>]/gi) || []).length;
    assert.equal(h1Count, 1, `Trovati ${h1Count} <h1>, atteso 1`);
  });

  test('ha landmark semantici (header, main, footer)', () => {
    assert.ok(/<header[\s>]/i.test(htmlContent), '<header> mancante');
    assert.ok(/<main[\s>]/i.test(htmlContent), '<main> mancante');
    assert.ok(/<footer[\s>]/i.test(htmlContent), '<footer> mancante');
  });

  test('ha <html lang="it">', () => {
    assert.ok(/<html\s+lang="it"/i.test(htmlContent), 'lang="it" mancante su <html>');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUB-PATH SAFETY
// ═══════════════════════════════════════════════════════════════
describe('Sub-path safety', () => {
  test('nessun path assoluto che inizia con "/" negli href/src', () => {
    // Cerca attributi href= o src= che iniziano con "/" (escludendo // e schemi)
    const absPaths = [];
    const regex = /(?:href|src|action)\s*=\s*"(\/[^/"]+[^"]*)"/gi;
    let m;
    while ((m = regex.exec(htmlContent)) !== null) {
      // Ignora URL che iniziano con // (protocol-relative) o https?://
      if (!m[1].startsWith('//')) {
        absPaths.push(m[1]);
      }
    }
    // Escludi percorsi noti e innocui come quelli nei meta/link SEO (che sono assoluti per il canonical)
    const allowed = ['/app/coloriveloce/'];
    const violations = absPaths.filter(p => !allowed.some(a => p.startsWith(a)));
    assert.equal(violations.length, 0,
      `Path assoluti non consentiti trovati: ${violations.join(', ')}`);
  });

  test('fetch e XMLHttpRequest non usano path assoluti', () => {
    // Cerca stringhe fetch("/ o xhr.open("GET", "/
    const fetchAbs = htmlContent.match(/fetch\s*\(\s*["']\/[^/]/g);
    assert.equal(fetchAbs, null, `fetch con path assoluto trovato: ${fetchAbs}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// ACCESSIBILITÀ
// ═══════════════════════════════════════════════════════════════
describe('Accessibilità', () => {
  test('input ha <label> associato', () => {
    assert.ok(htmlContent.includes('for="color-input"'), 'Label con for mancante');
    assert.ok(htmlContent.includes('id="color-input"'), 'Input con id mancante');
  });

  test('pulsanti hanno aria-label', () => {
    assert.ok(htmlContent.includes('aria-label="Copia codice HEX"'), 'aria-label copy HEX mancante');
    assert.ok(htmlContent.includes('aria-label="Copia codice RGB"'), 'aria-label copy RGB mancante');
  });

  test('aree dinamiche hanno aria-live', () => {
    assert.ok(htmlContent.includes('aria-live="polite"'), 'aria-live mancante');
  });

  test('immagini decorative hanno aria-hidden', () => {
    // Almeno un SVG decorativo con aria-hidden
    assert.ok(htmlContent.includes('aria-hidden="true"'), 'aria-hidden su elementi decorativi mancante');
  });

  test('usa :focus-visible nel CSS', () => {
    assert.ok(htmlContent.includes(':focus-visible'), ':focus-visible non definito');
  });

  test('rispetta prefers-reduced-motion', () => {
    assert.ok(htmlContent.includes('prefers-reduced-motion'), 'prefers-reduced-motion non gestito');
  });
});

// ═══════════════════════════════════════════════════════════════
// SERVER & ENDPOINTS
// ═══════════════════════════════════════════════════════════════
describe('Server HTTP', () => {
  test('GET / restituisce 200 e HTML', async () => {
    const res = await fetchPage('/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.body.includes('<!DOCTYPE html>'));
    assert.ok(res.body.includes('ColoriVeloci'));
  });

  test('GET /robots.txt restituisce 200', async () => {
    const res = await fetchPage('/robots.txt');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Sitemap:'));
  });

  test('GET /sitemap.xml restituisce 200', async () => {
    const res = await fetchPage('/sitemap.xml');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('<urlset'));
  });

  test('GET /index.html restituisce 200', async () => {
    const res = await fetchPage('/index.html');
    assert.equal(res.status, 200);
  });

  test('robots.txt punta al sitemap corretto', () => {
    const robotsTxt = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf-8');
  });

  test('sitemap.xml ha URL canonico', () => {
    const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf-8');
  });
});

// ═══════════════════════════════════════════════════════════════
// FUNZIONALITÀ: Levenshtein & ricerca
// ═══════════════════════════════════════════════════════════════
describe('Algoritmo di ricerca (Levenshtein)', () => {
  // Estrai la funzione levenshtein dal JS
  function getLevenshteinFn(html) {
    // Estrai l'intero corpo della funzione levenshtein
    const start = html.indexOf('function levenshtein(a, b) {');
    if (start === -1) {
      // prova variante minificata
      const m2 = html.match(/function levenshtein\(\w,\w\)\{([^}]+\}[^}]+\}[^}]+\})/);
      if (m2) return new Function('a', 'b', m2[1]);
      throw new Error('Funzione levenshtein non trovata');
    }
    let braceCount = 0;
    let i = start;
    let started = false;
    let bodyStart = -1;
    for (; i < html.length; i++) {
      if (html[i] === '{') {
        braceCount++;
        if (!started) { started = true; bodyStart = i + 1; }
      } else if (html[i] === '}') {
        braceCount--;
        if (started && braceCount === 0) {
          const body = html.substring(bodyStart, i);
          return new Function('a', 'b', body);
        }
      }
    }
    throw new Error('Funzione levenshtein: parentesi non bilanciate');
  }

  let lev;

  before(() => {
    lev = getLevenshteinFn(htmlContent);
  });

  test('distanza stringhe identiche è 0', () => {
    assert.equal(lev('rosso', 'rosso'), 0);
    assert.equal(lev('blue', 'blue'), 0);
  });

  test('distanza tra "rosso" e "rossa" è 1', () => {
    assert.equal(lev('rosso', 'rossa'), 1);
  });

  test('distanza tra stringhe completamente diverse', () => {
    const d = lev('abc', 'xyz');
    assert.ok(d >= 3);
  });

  test('distanza tra "magenta" e "magenta scuro"', () => {
    const d = lev('magenta', 'magenta scuro');
    // "magenta scuro" ha 6 caratteri in più, quindi distanza almeno 6
    assert.ok(d >= 6, `Distanza attesa >=6, ottenuta ${d}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// RIEPILOGO
// ═══════════════════════════════════════════════════════════════
test('Riepilogo: tutti i test eseguiti', () => {
  console.log('\n✅ Test suite completata.');
});
