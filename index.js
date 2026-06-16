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

const getDomainName = (url) => {
    try {
        const u = new URL(fixUrl(url));
        return u.hostname.replace('www.', '');
    } catch {
        return url;
    }
};

// ==========================================
// UNIVERSAL LIVEWIRE SCRAPING ENGINE
// Menggunakan multiple selector fallback agar support semua tema situs
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

        // Step 3: Parse HTML Response dengan Selector Universal
        const htmlContent = updateRes.data.components[0].effects.html;
        const $ = cheerio.load(htmlContent);
        const results = [];

        // STRATEGI PARSING UNIVERSAL:
        // Cari container yang memiliki minimal 5 kolom div (Pasaran, Hari, Tanggal, Prize, Jam)
        $('div').each((i, el) => {
            const children = $(el).children('div');
            
            // Hanya proses jika memiliki tepat 5 atau lebih child div (struktur tabel)
            // Dan pastikan parent-nya bukan header tabel
            if (children.length >= 5 && !$(el).hasClass('bg-primary-200') && !$(el).hasClass('bg-primary-300')) {
                
                // Ambil teks dari kolom ke-4 (Prize)
                const prizeCol = children.eq(3);
                let prize = prizeCol.find('b').text().trim();
                
                // Fallback: cari angka 4 digit di kolom prize
                if (!prize || prize.length !== 4) {
                    const match = prizeCol.text().match(/\d{4}/);
                    prize = match ? match[0] : '';
                }

                // Validasi: Hanya simpan jika prize valid 4 digit
                if (prize && prize.length === 4) {
                    const day = children.eq(1).text().trim().toLowerCase().replace(/\s+/g, '');
                    const date = children.eq(2).text().trim().toLowerCase().replace(/\s+/g, '');

                    if (day && date) {
                        results.push({ day, date, prize });
                    }
                }
            }
        });

        // Double check: Jika hasil masih 0, coba selector alternatif khusus Tema Ungu/Flex
        if (results.length === 0) {
            $('div.flex.items-center').each((i, el) => {
                const parentRow = $(el).closest('div.flex');
                const cols = parentRow.find('div');
                
                if (cols.length >= 5) {
                    let prize = cols.eq(3).find('b').text().trim();
                    if (!prize) {
                        const match = cols.eq(3).text().match(/\d{4}/);
                        prize = match ? match[0] : '';
                    }
                    
                    if (prize && prize.length === 4) {
                        const day = cols.eq(1).text().trim().toLowerCase().replace(/\s+/g, '');
                        const date = cols.eq(2).text().trim().toLowerCase().replace(/\s+/g, '');
                        
                        // Hindari duplikat
                        if (day && date && !results.find(r => r.date === date)) {
                            results.push({ day, date, prize });
                        }
                    }
                }
            });
        }

        return { success: true, data: results };
    } catch (err) {
        return { 
            success: false, 
            error: err.response?.status === 419 ? 'CSRF Expired' : err.message 
        };
    }
}

// ==========================================
// IMPROVED MAJORITY VOTE (ANTI-NGAWUR)
// Menambahkan threshold minimum data agar tidak salah deteksi Phantom
// ==========================================
function validateWithMajorityVote(marketName, siteResults, siteUrls) {
    const issues = [];
    
    // Filter hanya situs yang berhasil fetch DAN punya data > 0
    const validSites = siteResults.filter(r => r.success && r.data.length > 0);
    const failedOrEmptySites = siteResults.filter(r => !r.success || r.data.length === 0);

    // Jika SEMUA situs gagal/kosong, skip market ini
    if (validSites.length === 0) return issues;

    // Kumpulkan semua tanggal unik HANYA dari situs yang valid
    const allDates = new Set();
    validSites.forEach(res => {
        res.data.forEach(item => allDates.add(item.date));
    });

    // Validasi setiap tanggal
    for (const date of allDates) {
        const entries = siteResults.map((res, idx) => ({
            domain: getDomainName(siteUrls[idx]),
            success: res.success,
            hasData: res.success && res.data.length > 0,
            item: res.success ? res.data.find(d => d.date === date) : null
        }));

        const presentSites = entries.filter(e => e.item);
        const missingSites = entries.filter(e => !e.item && e.hasData);
        const failedSites = entries.filter(e => !e.success || !e.hasData);

        // SKENARIO 1: Situs gagal fetch total
        if (failedSites.length > 0) {
            failedSites.forEach(fs => {
                issues.push({
                    market: marketName,
                    date: date,
                    culprit: fs.domain,
                    status: 'FETCH_FAILED',
                    detail: `Situs ini gagal mengambil data atau datanya kosong total.`
                });
            });
            continue; 
        }

        // SKENARIO 2: Minority Missing (Minority gak punya data)
        // Hanya laporkan jika majority (>=50%) punya data ini
        if (missingSites.length > 0 && presentSites.length >= (siteResults.length / 2)) {
            missingSites.forEach(ms => {
                issues.push({
                    market: marketName,
                    date: date,
                    culprit: ms.domain,
                    status: 'DATA_MISSING',
                    reference: `${presentSites.length}/${siteResults.length} situs lain memiliki data ini`,
                    detail: `KEHILANGAN data tanggal ${date}.`
                });
            });
        }

        // SKENARIO 3: Cek Prize/Hari pada situs yang PRESENT
        if (presentSites.length >= 2) {
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
                if (ps.item.day !== majorityDay) diffs.push(`Hari: "${ps.item.day}" (Seharusnya: "${majorityDay}")`);
                if (ps.item.prize !== majorityPrize) diffs.push(`Prize: "${ps.item.prize}" (Seharusnya: "${majorityPrize}")`);

                if (diffs.length > 0) {
                    issues.push({
                        market: marketName,
                        date: date,
                        culprit: ps.domain,
                        status: 'VALUE_MISMATCH',
                        reference: `Majority: Hari="${majorityDay}", Prize="${majorityPrize}"`,
                        detail: `SALAH NILAI! ${diffs.join(' | ')}`
                    });
                }
            });
        }
    }

    // SKENARIO 4: Deteksi Situs yang Datanya Kosong Total (Bukan per tanggal)
    // Ini mencegah laporan "Phantom Data" yang ngawur
    failedOrEmptySites.forEach(fes => {
        if (validSites.length > 0) {
            issues.push({
                market: marketName,
                date: 'ALL_DATES',
                culprit: fes.domain,
                status: 'TOTAL_DATA_MISSING',
                detail: `Situs ini tidak mengembalikan data apapun untuk market ini. Kemungkinan selector HTML tidak cocok atau scraper error.`
            });
        }
    });

    return issues;
}

// ==========================================
// ENDPOINT UTAMA: /scan-final
// ==========================================
app.get('/scan-final', async (req, res) => {
    const urls = [req.query.url1, req.query.url2, req.query.url3, req.query.url4, req.query.url5].filter(Boolean);
    
    if (urls.length < 2) {
        return res.status(400).json({ status: 'error', message: 'Minimal 2 URL diperlukan (?url1=...&url2=...)' });
    }

    console.log(` Final Smart Scan | ${urls.length} sites × 64 markets`);
    const startTime = Date.now();
    const allIssues = [];

    for (const market of MARKETS) {
        console.log(`   Checking: ${market.name} (${market.id})...`);

        // Fetch semua situs paralel untuk market ini
        const siteResults = await Promise.all(
            urls.map(url => scrapeSite(url, market.id))
        );

        // Jalankan Majority Vote Validation DENGAN MAPPING DOMAIN ASLI
        const marketIssues = validateWithMajorityVote(market.name, siteResults, urls);
        allIssues.push(...marketIssues);
        
        // Delay anti-blokir LiteSpeed
        await new Promise(r => setTimeout(r, 1200));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
        status: 'success',
        execution_time_seconds: duration,
        summary: {
            scanned_sites: urls.map(u => getDomainName(u)),
            markets_scanned: 64,
            total_issues_found: allIssues.length,
            is_fully_synced: allIssues.length === 0
        },
        errors: allIssues
    });
});

app.get('/', (req, res) => res.json({ message: '🧠 Ultimate Universal Validator Ready!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
