const express = require('express');
const axiosBase = require('axios');
const { HttpsCookieAgent } = require('http-cookie-agent/http');
const { CookieJar } = require('tough-cookie');
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

const fixUrl = (raw) => {
    if (!raw) return null;
    let url = raw.trim().replace(/\/+$/, '');
    return url.startsWith('http') ? url : `https://${url}`;
};

// ==========================================
// SESSION-AWARE LIVEWIRE SCRAPING ENGINE
// ==========================================
async function scrapeSite(baseUrl, marketId) {
    try {
        const fixedBase = fixUrl(baseUrl);
        const jar = new CookieJar();
        const agent = new HttpsCookieAgent({ cookies: { jar } });
        
        const client = axiosBase.create({
            httpsAgent: agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            },
            timeout: 15000
        });

        // Step 1: Get Fresh Session & Token
        const initRes = await client.get(`${fixedBase}/data-keluaran`);
        const $init = cheerio.load(initRes.data);
        const csrfToken = $init('meta[name="csrf-token"]').attr('content');
        const rawSnapshot = $init('[wire\\:id]').first().attr('wire:snapshot');
        
        if (!csrfToken || !rawSnapshot) return { success: false, error: 'Gagal ambil token/snapshot' };

        // Step 2: Post Livewire Update
        const payload = {
            _token: csrfToken,
            components: [{
                snapshot: rawSnapshot,
                updates: { market: String(marketId) },
                calls: []
            }]
        };

        const updateRes = await client.post(`${fixedBase}/livewire/update`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'Referer': `${fixedBase}/data-keluaran?market=${marketId}`
            }
        });

        // Step 3: Parse HTML Response
        const htmlContent = updateRes.data.components[0].effects.html;
        const $ = cheerio.load(htmlContent);
        const results = [];

        $('div.flex.overflow-hidden.border.rounded-lg').each((i, el) => {
            const cols = $(el).find('div');
            if (cols.length >= 5) {
                let prize = $(cols[3]).find('b').text().trim();
                if (!prize || prize.length !== 4) {
                    const match = $(cols[3]).text().match(/\d{4}/);
                    prize = match ? match[0] : '';
                }

                let day = $(cols[1]).text().trim().toLowerCase().replace(/\s+/g, '');
                let date = $(cols[2]).text().trim().toLowerCase().replace(/\s+/g, '');

                if (day && date && prize && prize.length === 4) {
                    results.push({ day, date, prize });
                }
            }
        });

        return { success: true, data: results };
    } catch (err) {
        return { 
            success: false, 
            error: err.response?.status === 419 ? 'CSRF Expired' : err.message 
        };
    }
}

// ==========================================
// MAJORITY VOTE VALIDATION ENGINE
// ==========================================
function validateWithMajorityVote(marketName, siteResults) {
    const issues = [];
    
    // Kumpulkan semua tanggal unik dari semua situs yang berhasil fetch
    const allDates = new Set();
    siteResults.forEach((res, idx) => {
        if (res.success) {
            res.data.forEach(item => allDates.add(item.date));
        }
    });

    // Validasi setiap tanggal secara independen
    for (const date of allDates) {
        // Ambil data dari setiap situs untuk tanggal ini
        const entries = siteResults.map((res, idx) => ({
            siteNum: idx + 1,
            success: res.success,
            item: res.success ? res.data.find(d => d.date === date) : null
        }));

        const presentSites = entries.filter(e => e.item);
        const missingSites = entries.filter(e => !e.item && e.success);
        const failedSites = entries.filter(e => !e.success);

        // SKENARIO 1: Ada situs yang gagal fetch total
        if (failedSites.length > 0) {
            failedSites.forEach(fs => {
                issues.push({
                    market: marketName,
                    date: date,
                    culprit: `Site${fs.siteNum}`,
                    status: 'FETCH_FAILED',
                    detail: `Site${fs.siteNum} gagal mengambil data (Error/Timeout)`
                });
            });
            continue; 
        }

        // SKENARIO 2: Majority Missing (Mayoritas gak punya data ini)
        // Anggap data ini memang tidak seharusnya ada, yang punya data justru yang salah/input manual
        if (presentSites.length < (siteResults.length / 2)) {
            presentSites.forEach(ps => {
                issues.push({
                    market: marketName,
                    date: date,
                    culprit: `Site${ps.siteNum}`,
                    status: 'PHANTOM_DATA',
                    detail: `Site${ps.siteNum} memiliki data tanggal ${date} TAPI mayoritas situs lain tidak memilikinya.`
                });
            });
            continue;
        }

        // SKENARIO 3: Minority Missing (Minority gak punya data) -> INI YANG KAMU MAU!
        if (missingSites.length > 0 && missingSites.length < (siteResults.length / 2)) {
            missingSites.forEach(ms => {
                issues.push({
                    market: marketName,
                    date: date,
                    culprit: `Site${ms.siteNum}`,
                    status: 'DATA_MISSING',
                    detail: `Site${ms.siteNum} KEHILANGAN data tanggal ${date}. (${presentSites.length}/${siteResults.length} situs lain memiliki data ini)`
                });
            });
        }

        // SKENARIO 4: Cek Prize/Hari pada situs yang PRESENT
        if (presentSites.length >= 2) {
            // Cari nilai yang paling umum (mode) untuk hari dan prize
            const dayCounts = {};
            const prizeCounts = {};
            
            presentSites.forEach(ps => {
                dayCounts[ps.item.day] = (dayCounts[ps.item.day] || 0) + 1;
                prizeCounts[ps.item.prize] = (prizeCounts[ps.item.prize] || 0) + 1;
            });

            const majorityDay = Object.keys(dayCounts).reduce((a, b) => dayCounts[a] > dayCounts[b] ? a : b);
            const majorityPrize = Object.keys(prizeCounts).reduce((a, b) => prizeCounts[a] > prizeCounts[b] ? a : b);

            presentSites.forEach(ps => {
                const diffs = [];
                if (ps.item.day !== majorityDay) diffs.push(`Hari: "${ps.item.day}" (Majority: "${majorityDay}")`);
                if (ps.item.prize !== majorityPrize) diffs.push(`Prize: "${ps.item.prize}" (Majority: "${majorityPrize}")`);

                if (diffs.length > 0) {
                    issues.push({
                        market: marketName,
                        date: date,
                        culprit: `Site${ps.siteNum}`,
                        status: 'VALUE_MISMATCH',
                        detail: `Site${ps.siteNum} SALAH NILAI! ${diffs.join(' | ')}`
                    });
                }
            });
        }
    }

    return issues;
}

// ==========================================
// ENDPOINT UTAMA: /scan-smart
// ==========================================
app.get('/scan-smart', async (req, res) => {
    const urls = [req.query.url1, req.query.url2, req.query.url3, req.query.url4, req.query.url5].filter(Boolean);
    
    if (urls.length < 2) {
        return res.status(400).json({ status: 'error', message: 'Minimal 2 URL diperlukan' });
    }

    console.log(` Smart Scan Started | ${urls.length} sites × 64 markets`);
    const startTime = Date.now();
    const allIssues = [];

    for (const market of MARKETS) {
        console.log(`   Checking: ${market.name} (${market.id})...`);

        // Fetch semua situs paralel untuk market ini
        const siteResults = await Promise.all(
            urls.map(url => scrapeSite(url, market.id))
        );

        // Jalankan Majority Vote Validation
        const marketIssues = validateWithMajorityVote(market.name, siteResults);
        allIssues.push(...marketIssues);
        
        // Delay anti-blokir
        await new Promise(r => setTimeout(r, 1200));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
        status: 'success',
        execution_time_seconds: duration,
        summary: {
            total_sites: urls.length,
            markets_scanned: 64,
            total_issues_found: allIssues.length,
            is_fully_synced: allIssues.length === 0
        },
        errors: allIssues
    });
});

app.get('/', (req, res) => res.json({ message: '🧠 Smart Majority Vote Validator Ready!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
