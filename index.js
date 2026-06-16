const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// ==========================================
// DATABASE PASARAN (ID 1-64)
// ==========================================
const MARKETS = [
    { id: '1', name: 'Roma' }, { id: '2', name: 'Kentucky Mid' }, { id: '3', name: 'Turin' },
    { id: '4', name: 'Florida Mid' }, { id: '5', name: 'Newyork Mid' }, { id: '6', name: 'Carolina Day' },
    { id: '7', name: 'Madrid' }, { id: '8', name: 'Bulgaria' }, { id: '9', name: 'Oregon 03' },
    { id: '10', name: 'Hungary' }, { id: '11', name: 'Miami' }, { id: '12', name: 'Oregon 06' },
    { id: '13', name: 'California' }, { id: '14', name: 'Florida Eve' }, { id: '15', name: 'Oregon 09' },
    { id: '16', name: 'Newyork Eve' }, { id: '17', name: 'Kentucky Eve' }, { id: '18', name: 'Austria' },
    { id: '19', name: 'Carolina Eve' }, { id: '20', name: 'Cambodia' }, { id: '21', name: 'Bullseye' },
    { id: '22', name: 'Laos' }, { id: '23', name: 'Oregon 12' }, { id: '24', name: 'Toto Macau P1' },
    { id: '25', name: 'Sydney' }, { id: '26', name: 'Guangdong' }, { id: '27', name: 'China' },
    { id: '28', name: 'Toto Macau 5D P1' }, { id: '29', name: 'Toto Macau P2' }, { id: '30', name: 'Philippines' },
    { id: '31', name: 'Japan' }, { id: '32', name: 'Singapore 4D' }, { id: '33', name: 'Jeju Lotto' },
    { id: '34', name: 'Toto Beijing' }, { id: '35', name: 'Toto Macau P3' }, { id: '36', name: 'Toto Fuzhou' },
    { id: '37', name: 'Cyprus' }, { id: '38', name: 'Taiwan' }, { id: '39', name: 'Toto Macau 5D P2' },
    { id: '40', name: 'Iceland' }, { id: '41', name: 'Toto Macau P4' }, { id: '42', name: 'Bhutan' },
    { id: '43', name: 'Hongkong' }, { id: '44', name: 'Toto Macau P5' }, { id: '45', name: 'Toronto' },
    { id: '46', name: 'Toto Macau P6' }, { id: '47', name: 'Singapore Toto' }, { id: '48', name: 'Kingkong P1' },
    { id: '49', name: 'Kingkong P2' }, { id: '50', name: 'Chengdu' }, { id: '51', name: 'Chongqing' },
    { id: '52', name: 'Cuba' }, { id: '53', name: 'Denver' }, { id: '54', name: 'Ecuador' },
    { id: '55', name: 'Foshan' }, { id: '56', name: 'Haiti' }, { id: '57', name: 'Kowloon' },
    { id: '58', name: 'Monaco' }, { id: '59', name: 'Taichung' }, { id: '60', name: 'Italy' },
    { id: '61', name: 'France' }, { id: '62', name: 'Chile' }, { id: '63', name: 'Mexico' },
    { id: '64', name: 'Oslo' }
];

// Helper Functions
const fixUrl = (raw) => {
    if (!raw) return null;
    let url = raw.trim().replace(/\/+$/, '');
    return url.startsWith('http') ? url : `https://${url}`;
};

const clean = (str) => String(str || '').replace(/\s+/g, '').toLowerCase();

// ==========================================
// CORE ENGINE: 2-STEP LIVEWIRE SCRAPING
// ==========================================
async function scrapeSite(baseUrl, marketId) {
    try {
        const fixedBase = fixUrl(baseUrl);
        
        // LANGKAH 1: Ambil Halaman Utama untuk Token & Snapshot Segar
        // Ini WAJIB agar tidak kena 419 Page Expired saat looping 64 market
        const initRes = await axios.get(`${fixedBase}/data-keluaran`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            },
            timeout: 15000
        });

        const $init = cheerio.load(initRes.data);
        const csrfToken = $init('meta[name="csrf-token"]').attr('content');
        
        // Ambil wire:snapshot asli dari elemen komponen Livewire di halaman awal
        const rawSnapshot = $init('[wire\\:id]').first().attr('wire:snapshot');
        
        if (!csrfToken || !rawSnapshot) {
            return { success: false, error: 'Gagal mengambil token/snapshot awal' };
        }

        // LANGKAH 2: Kirim Request Update ke Livewire API
        const payload = {
            _token: csrfToken,
            components: [{
                snapshot: rawSnapshot, // Gunakan snapshot SEGAR dari langkah 1
                updates: { market: String(marketId) }, // Pastikan ID market string
                calls: []
            }]
        };

        const updateRes = await axios.post(`${fixedBase}/livewire/update`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            },
            timeout: 15000
        });

        // LANGKAH 3: Parse HTML dari Response Update
        const htmlContent = updateRes.data.components[0].effects.html;
        const $ = cheerio.load(htmlContent);
        const results = [];

        // Selector EKSKLUSIF berdasarkan Response JSON yang kamu kirim
        $('div.flex.overflow-hidden.border.rounded-lg').each((i, el) => {
            const cols = $(el).find('div');
            
            // Validasi struktur kolom (Pasaran, Hari, Tanggal, Prize, Jam)
            if (cols.length >= 5) {
                // EKSTRAK PRIZE: Wajib cari tag <b> secara langsung
                let prize = $(cols[3]).find('b').text().trim();
                
                // Fallback jika tag <b> kosong/rusak
                if (!prize || prize.length !== 4) {
                    const match = $(cols[3]).text().match(/\d{4}/);
                    prize = match ? match[0] : '';
                }

                let day = $(cols[1]).text().trim().toLowerCase().replace(/\s+/g, '');
                let date = $(cols[2]).text().trim().toLowerCase().replace(/\s+/g, '');

                // Hanya simpan data yang lengkap dan valid
                if (day && date && prize && prize.length === 4) {
                    results.push({ day, date, prize });
                }
            }
        });

        return { success: true, data: results };

    } catch (err) {
        return { 
            success: false, 
            error: err.code === 'ECONNABORTED' ? 'Timeout' : err.message 
        };
    }
}

// ==========================================
// ENDPOINT UTAMA: /scan-chain
// ==========================================
app.get('/scan-chain', async (req, res) => {
    const urls = [req.query.url1, req.query.url2, req.query.url3, req.query.url4, req.query.url5].filter(Boolean);
    
    if (urls.length < 2) {
        return res.status(400).json({ status: 'error', message: 'Minimal 2 URL diperlukan (?url1=...&url2=...)' });
    }

    // Generate Chain Pairs: 1vs2, 2vs3, ..., Lastvs1
    const chainPairs = [];
    for (let i = 0; i < urls.length; i++) {
        const nextIndex = (i + 1) % urls.length;
        chainPairs.push({ 
            siteA: i + 1, 
            siteB: nextIndex + 1, 
            urlA: urls[i], 
            urlB: urls[nextIndex] 
        });
    }

    console.log(` Chain Scan Started | ${urls.length} sites → ${chainPairs.length} links × 64 markets`);
    const startTime = Date.now();
    const allIssues = [];

    // LOOP SEQUENTIAL PER MARKET (Aman dari rate-limit LiteSpeed)
    for (const market of MARKETS) {
        console.log(`   Checking Market: ${market.name} (${market.id})...`);

        // 1. Fetch SEMUA SITUS SECARA PARALEL untuk market ini
        const siteResults = await Promise.all(
            urls.map(url => scrapeSite(url, market.id))
        );

        // 2. Cek SETIAP LINK DALAM RANTAI
        for (const pair of chainPairs) {
            const resultA = siteResults[pair.siteA - 1];
            const resultB = siteResults[pair.siteB - 1];
            const pairLabel = `Site${pair.siteA} ↔ Site${pair.siteB}`;

            // Handle Fetch Error
            if (!resultA.success || !resultB.success) {
                allIssues.push({
                    market: market.name,
                    pair: pairLabel,
                    status: 'FETCH_FAILED',
                    detail: `Site${pair.siteA}: ${resultA.error || 'OK'} | Site${pair.siteB}: ${resultB.error || 'OK'}`
                });
                continue;
            }

            // STRICT COMPARISON: Cek setiap baris data
            resultA.data.forEach(itemA => {
                const itemB = resultB.data.find(b => b.date === itemA.date);
                
                if (!itemB) {
                    allIssues.push({
                        market: market.name,
                        date: itemA.date,
                        pair: pairLabel,
                        status: 'DATA_MISSING',
                        detail: `Data tanggal ${itemA.date} ADA di Site${pair.siteA} tapi HILANG di Site${pair.siteB}`
                    });
                } else {
                    // Cek Hari
                    if (itemA.day !== itemB.day) {
                        allIssues.push({
                            market: market.name,
                            date: itemA.date,
                            pair: pairLabel,
                            status: 'DAY_MISMATCH',
                            detail: `Hari BEDA! Site${pair.siteA}: "${itemA.day}" vs Site${pair.siteB}: "${itemB.day}"`
                        });
                    }
                    
                    // Cek Prize (Strict)
                    if (String(itemA.prize) !== String(itemB.prize)) {
                        allIssues.push({
                            market: market.name,
                            date: itemA.date,
                            pair: pairLabel,
                            status: 'PRIZE_MISMATCH',
                            detail: `Prize BEDA! Site${pair.siteA}: [${itemA.prize}] vs Site${pair.siteB}: [${itemB.prize}]`
                        });
                    }
                }
            });

            // Cek Data yang ada di B tapi tidak di A (Reverse Missing)
            resultB.data.forEach(itemB => {
                const itemA = resultA.data.find(a => a.date === itemB.date);
                if (!itemA) {
                    allIssues.push({
                        market: market.name,
                        date: itemB.date,
                        pair: pairLabel,
                        status: 'DATA_MISSING_REVERSE',
                        detail: `Data tanggal ${itemB.date} ADA di Site${pair.siteB} tapi HILANG di Site${pair.siteA}`
                    });
                }
            });
        }
        
        // Delay antar market agar IP Railway tidak diblokir LiteSpeed
        await new Promise(r => setTimeout(r, 1200));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
        status: 'success',
        execution_time_seconds: duration,
        summary: {
            total_sites: urls.length,
            chain_links_checked: chainPairs.length,
            markets_scanned: 64,
            total_issues_found: allIssues.length,
            is_fully_synced: allIssues.length === 0
        },
        errors: allIssues // Hanya berisi masalah, kosong jika sempurna
    });
});

app.get('/', (req, res) => res.json({ message: '⛓️ Final Fixed Chain Comparator API Ready!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
