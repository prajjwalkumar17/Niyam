const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    createPagesPreviewServer,
    getContentType,
    resolveSiteFilePath,
    SITE_ROOT
} = require('../scripts/preview_pages');

test('pages deck uses relative static asset paths', () => {
    const html = fs.readFileSync(path.join(SITE_ROOT, 'index.html'), 'utf8');

    assert.match(html, /\.\/assets\/niyam-mark\.svg/);
    assert.match(html, /\.\/css\/why-niyam\.css/);
    assert.match(html, /\.\/js\/why-niyam\.js/);
    assert.doesNotMatch(html, /\bhref="\/(?!\/)/);
    assert.doesNotMatch(html, /\bsrc="\/(?!\/)/);
});

test('pages preview helpers resolve root deck and static assets', () => {
    const server = createPagesPreviewServer();
    server.close();

    const rootPath = resolveSiteFilePath('/');
    const cssPath = resolveSiteFilePath('/css/why-niyam.css');
    const jsPath = resolveSiteFilePath('/js/why-niyam.js');
    const markPath = resolveSiteFilePath('/assets/niyam-mark.svg');
    const imagePath = resolveSiteFilePath('/assets/presentation/niyam-dashboard.png');
    const oldRoutePath = resolveSiteFilePath('/why-niyam');
    const forbiddenPath = resolveSiteFilePath('/../server.js');

    assert.equal(rootPath, path.join(SITE_ROOT, 'index.html'));
    assert.equal(cssPath, path.join(SITE_ROOT, 'css', 'why-niyam.css'));
    assert.equal(jsPath, path.join(SITE_ROOT, 'js', 'why-niyam.js'));
    assert.equal(markPath, path.join(SITE_ROOT, 'assets', 'niyam-mark.svg'));
    assert.equal(imagePath, path.join(SITE_ROOT, 'assets', 'presentation', 'niyam-dashboard.png'));
    assert.equal(oldRoutePath, path.join(SITE_ROOT, 'why-niyam'));
    assert.equal(forbiddenPath, null);

    assert.equal(fs.existsSync(rootPath), true);
    assert.equal(fs.existsSync(cssPath), true);
    assert.equal(fs.existsSync(jsPath), true);
    assert.equal(fs.existsSync(markPath), true);
    assert.equal(fs.existsSync(imagePath), true);
    assert.equal(fs.existsSync(oldRoutePath), false);

    assert.match(fs.readFileSync(rootPath, 'utf8'), /The shell was never supposed to be an honor system\./);
    assert.match(fs.readFileSync(cssPath, 'utf8'), /progress-rail/);
    assert.match(fs.readFileSync(jsPath, 'utf8'), /IntersectionObserver/);

    assert.equal(getContentType(rootPath), 'text/html; charset=utf-8');
    assert.equal(getContentType(cssPath), 'text/css; charset=utf-8');
    assert.equal(getContentType(jsPath), 'application/javascript; charset=utf-8');
    assert.equal(getContentType(markPath), 'image/svg+xml');
    assert.equal(getContentType(imagePath), 'image/png');
});
