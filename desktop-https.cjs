'use strict';
/**= Version 0.8.0-alpha.2. Per-instance HTTPS trust; no redirect or global TLS overrides. */
function desktopHttps(origin, caPem = '') {
  const base = new URL(origin); if (base.protocol !== 'https:') throw new Error('HTTPS is required.');
  if (caPem && (!/-----BEGIN CERTIFICATE-----/.test(caPem) || /PRIVATE KEY/.test(caPem))) throw new Error('Paste a public certificate/CA bundle in PEM format, never a private key.');
  return async options => {
    const url = new URL(options.url);
    if (url.origin !== base.origin || url.username || url.password) throw new Error('Rejected unexpected OpenProject host.');
    const https = require('node:https');
    if (caPem) { const { X509Certificate } = require('node:crypto'); const blocks = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g); if (!blocks?.length) throw new Error('Invalid PEM certificate.'); for (const block of blocks) new X509Certificate(block); }
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method: options.method || 'GET', headers: options.headers, agent: false, rejectUnauthorized: true, ...(caPem ? { ca: caPem } : {}) }, res => {
        const chunks = []; let size = 0;
        res.on('data', data => { size += data.length; if (size > 20*1024*1024) { res.destroy(); req.destroy(new Error('Response size limit exceeded.')); } else chunks.push(data); });
        res.on('error', reject);
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, json }); });
      });
      req.setTimeout(30000, () => req.destroy(new Error('Request timed out.')));
      req.on('error', reject); req.end(options.body);
    });
  };
}
module.exports = { desktopHttps };
