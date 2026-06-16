const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// ==========================================
// KONFIGURASI KECEPATAN
// ==========================================
const MAX_CONCURRENT_MARKETS = 6; // Maksimal 6 market diproses barengan (aman & cepat)
const REQUEST_TIMEOUT = 10000;    // Timeout 10 detik per request

// Database Pasaran 1-64
const MARKETS = Array.from({ length: 64 }, (_, i) => ({
    id: String(i + 1),
    name: ['Roma','Kentucky Mid','Turin','Florida Mid','Newyork Mid','Carolina Day',
           'Madrid','Bulgaria','Oregon 03','Hungary','Miami','Oregon 06',
           'California','Florida Eve','Oregon 09','Newyork Eve','Kentucky Eve','Austria',
           'Carolina Eve','Cambodia','Bullseye','Laos','Oregon 12','Toto Macau P1',
           'Sydney','Guangdong','China','Toto Macau 5D P1','Toto Macau P2','Philippines',
           'Japan','Singapore 4D','Jeju Lotto','Toto Beijing','Toto Macau P3','Toto Fuzhou',
           'Cyprus','Taiwan','Toto Macau 5D P2','Iceland','Toto Macau P4','Bhutan',
           'Hongkong','Toto Macau P5','Toronto','Toto Macau P6','Singapore Toto','Kingkong P1',
           'Kingkong P2','Chengdu','Chongqing','Cuba','Denver','Ecuador',
           'Foshan','Haiti','Kowloon','Monaco','Taichung','Italy',
           'France','Chile','Mexico','Oslo'][i] || `Market ${i+1}`
}));

// Helper Functions
const fixUrl = (raw) => {
    if (!raw) return null;
    let url = raw.trim().replace(/\/+$/, '');
    return url.startsWith('http') ? url : `https://${url}`;
};

const clean = (str) => String(str || '').replace(/\s+/g, '').toLowerCase();

// ==========================================
// SCRAPING ENGINE
// ==========================================
async function scrapeSite(baseUrl, marketId) {
    try {
        const url = `${fixUrl(baseUrl)}/data-keluaran?market=${marketId}`;
        const { data } = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: REQUEST_TIMEOUT 
        });

        const $ = cheerio.load(data);
        const results = [];

        $('div.flex.overflow-hidden.border.rounded-lg, tr').each((i, el) => {
            if (/\b\d{4}\b/.test($(el).text())) {
                const cols = $(el).find('div, td');
                if (cols.length >= 4) {
                    results.push({
                        day: clean($(cols[1]).text()),
                        date: clean($(cols[2]).text()),
                        prize: clean($(cols[3]).find('b').text() || $(cols[3]).text())
                    });
                }
            }
        });
        return { success: true, data: results };
    } catch (err) {
        return { success: false, error: err.code === 'ECONNABORTED' ? 'Timeout' : err.message };
    }
}

// ==========================================
// CONCURRENCY POOL (JANTUNG PERCEPATAN)
// ==========================================
async function processWithConcurrency(items, concurrencyLimit, asyncFn) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const currentIndex = index++;
            const item = items[currentIndex];
            console.log(`   [Pool] Processing ${item.name || item} (${currentIndex + 1}/${items.length})`);
            
            const result = await asyncFn(item, currentIndex);
            results[currentIndex] = result;
        }
    }

    // Buat pool worker sesuai limit
    const workers = Array(Math.min(concurrencyLimit, items.length)).fill(null).map(() => worker());
    await Promise.all(workers);
    
    return results;
}

// ==========================================
// ENDPOINT UTAMA: /scan-multi
// ==========================================
app.get('/scan-multi', async (req, res) => {
    // Terima sampai 5 URL: url1, url2, url3, url4, url5
    const urls = [req.query.url1, req.query.url2, req.query.url3, req.query.url4, req.query.url5].filter(Boolean);
    
    if (urls.length < 2) {
        return res.status(400).json({ status: 'error', message: 'Minimal masukkan 2 URL (?url1=...&url2=...)' });
    }

    console.log(` Starting HIGH-SPEED scan for ${urls.length} sites across 64 markets...`);
    const startTime = Date.now();
    const allIssues = [];

    // PROSES 64 MARKET DENGAN CONCURRENCY POOL
    await processWithConcurrency(MARKETS, MAX_CONCURRENT_MARKETS, async (market) => {
        
        // 1. Fetch SEMUA SITUS untuk market ini SECARA PARALEL
        const siteResults = await Promise.all(
            urls.map(url => scrapeSite(url, market.id))
        );

        // 2. Tentukan Master Site (yang datanya paling banyak & valid)
        const validSites = siteResults.map((r, idx) => ({ ...r, siteIdx: idx }))
                                      .filter(r => r.success && r.data.length > 0);
        
        if (validSites.length === 0) {
            allIssues.push({
                market: market.name,
                status: 'ALL_SITES_FAILED',
                detail: urls.map((u, i) => `Site${i+1}: ${siteResults[i].error}`).join(' | ')
            });
            return;
        }

        // Sort by data count descending -> index 0 is Master
        validSites.sort((a, b) => b.data.length - a.data.length);
        const master = validSites[0];
        const slaves = validSites.slice(1);

        // 3. Bandingkan Slave vs Master
        master.data.forEach(masterItem => {
            slaves.forEach(slave => {
                const slaveItem = slave.data.find(s => s.date === masterItem.date);
                
                if (!slaveItem) {
                    allIssues.push({
                        market: market.name,
                        date: masterItem.date,
                        status: 'MISSING',
                        detail: `Site${slave.siteIdx + 1} tidak punya data tanggal ${masterItem.date} (Ref: Site${master.siteIdx + 1})`
                    });
                } else {
                    const diffs = [];
                    if (masterItem.day !== slaveItem.day) diffs.push(`Hari: "${masterItem.day}" vs "${slaveItem.day}"`);
                    if (masterItem.prize !== slaveItem.prize) diffs.push(`Prize: "${masterItem.prize}" vs "${slaveItem.prize}"`);
                    
                    if (diffs.length > 0) {
                        allIssues.push({
                            market: market.name,
                            date: masterItem.date,
                            status: 'MISMATCH',
                            detail: `Site${slave.siteIdx + 1} vs Site${master.siteIdx + 1}: ${diffs.join(' | ')}`
                        });
                    }
                }
            });
        });
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
        status: 'success',
        execution_time_seconds: duration,
        summary: {
            sites_compared: urls.length,
            markets_scanned: 64,
            total_issues: allIssues.length,
            is_perfect_sync: allIssues.length === 0
        },
        errors: allIssues // Hanya tampilkan yang bermasalah
    });
});

app.get('/', (req, res) => res.json({ message: '⚡ High-Speed Multi-Site Scanner Ready!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
