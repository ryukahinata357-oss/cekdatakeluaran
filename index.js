const express = require('express');
const axiosBase = require('axios');
const { HttpsCookieAgent } = require('http-cookie-agent/http');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// ==========================================
// CANONICAL MARKET DATABASE
// ==========================================
const CANONICAL_MARKETS = [
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
    if (!url || typeof url !== 'string') return 'Unknown Site';
    
    try {
        // Bersihkan spasi & tambahkan https:// otomatis
        const cleanUrl = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
        const u = new URL(cleanUrl);
        return u.hostname.replace('www.', '') || 'Unknown Site';
    } catch {
        // Fallback: kembalikan URL yang sudah dibersihkan spasinya
        return url.trim() || 'Unknown Site';
    }
};

const normalizeDate = (str) => {
    if (!str) return '';
    return str.trim().toLowerCase().replace(/\s+/g, '').replace(/juni/g, 'jun').replace(/juli/g, 'jul');
};

// ==========================================
// SILENT AUTO-CORRECTION ENGINE
// Mendeteksi dan memperbaiki mapping ID secara diam-diam
// ==========================================
async function detectAndFixMapping(baseUrl) {
    const mapping = { '32': '32', '47': '47' }; // Default Normal
    
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
            timeout: 10000
        });

        // Ambil token & snapshot awal
        const initRes = await client.get(`${fixedBase}/data-keluaran`);
        const $init = cheerio.load(initRes.data);
        const csrfToken = $init('meta[name="csrf-token"]').attr('content');
        const rawSnapshot = $init('[wire\\:id]').first().attr('wire:snapshot');
        
        if (!csrfToken || !rawSnapshot) return mapping;

        // Fungsi helper untuk extract tanggal pertama
        const getFirstDate = async (marketId) => {
            const payload = {
                _token: csrfToken,
                components: [{
                    snapshot: rawSnapshot,
                    updates: { market: marketId },
                    calls: []
                }]
            };

            try {
                const res = await client.post(`${fixedBase}/livewire/update`, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json',
                        'Referer': `${fixedBase}/data-keluaran?market=${marketId}`
                    }
                });

                const html = res.data.components[0].effects.html;
                const plainText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
                
                // Cari pola tanggal pertama: DD MMM YY
                const match = plainText.match(/\b(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\b/);
                return match ? normalizeDate(match[1]) : null;
            } catch {
                return null;
            }
        };

        // TES BRUTE FORCE: Bandingkan tanggal pertama ID 32 vs 47
        const dateFrom32 = await getFirstDate('32');
        const dateFrom47 = await getFirstDate('47');

        // LOGIKA SILENT FIX:
        // Kita asumsikan mayoritas situs adalah NORMAL (32=4D, 47=Toto).
        // Tapi karena kita scan per-situs, kita butuh cara deteksi tanpa referensi eksternal.
        // 
        // STRATEGI BARU: 
        // Kita tidak bisa tahu mana yang "benar" hanya dari 1 situs.
        // TAPI, kita bisa menyimpan "sidik jari" tanggal ini.
        // Nanti saat validasi majority vote, jika tanggalnya beda dari mayoritas, 
        // kita tahu situs ini swapped DAN kita sudah punya data dari ID satunya.
        
        // SIMPAN REFERENSI DI MAPPING OBJECT
        mapping._date32 = dateFrom32;
        mapping._date47 = dateFrom47;
        mapping._csrf = csrfToken;
        mapping._snapshot = rawSnapshot;
        mapping._clientConfig = { fixedBase, jar, agent }; // Simpan config client untuk reuse

        return mapping;

    } catch (err) {
        console.error(`   ❌ Failed to detect mapping for ${baseUrl}:`, err.message);
        return mapping;
    }
}

// ==========================================
// SMART SCRAPING WITH AUTO-CORRECTION
// ==========================================
async function scrapeSite(baseUrl, canonicalMarketId, siteMapping, allSiteMappings) {
    try {
        const fixedBase = fixUrl(baseUrl);
        const domain = getDomainName(baseUrl);
        
        // Default ID
        let actualId = String(canonicalMarketId);
        
        // LOGIKA AUTO-CORRECTION REAL-TIME
        // Khusus untuk Singapore (32 & 47), cek apakah situs ini swapped berdasarkan perbandingan dengan situs lain
        if ((canonicalMarketId === '32' || canonicalMarketId === '47') && allSiteMappings) {
            
            // Kumpulkan tanggal pertama dari semua situs yang sudah dideteksi
            const refDates = [];
            Object.values(allSiteMappings).forEach(m => {
                if (m._date32 && m._date47) {
                    // Ambil tanggal dari ID yang sesuai canonical
                    refDates.push(canonicalMarketId === '32' ? m._date32 : m._date47);
                }
            });

            if (refDates.length > 0) {
                // Cari tanggal mayoritas
                const dateCounts = {};
                refDates.forEach(d => dateCounts[d] = (dateCounts[d] || 0) + 1);
                const majorityDate = Object.keys(dateCounts).reduce((a, b) => dateCounts[a] > dateCounts[b] ? a : b);
                
                // Cek tanggal situs ini
                const myDate = canonicalMarketId === '32' ? siteMapping._date32 : siteMapping._date47;
                
                // Jika beda dari mayoritas -> SWAPPED! Gunakan ID sebaliknya
                if (myDate && myDate !== majorityDate) {
                    actualId = canonicalMarketId === '32' ? '47' : '32';
                    console.log(`   🔧 Auto-corrected ${domain}: Using ID ${actualId} for Canonical ${canonicalMarketId}`);
                }
            }
        }

        // Reuse client config jika ada (hemat resource)
        let client;
        let csrfToken = siteMapping._csrf;
        let rawSnapshot = siteMapping._snapshot;

        if (siteMapping._clientConfig) {
            client = axiosBase.create({
                httpsAgent: siteMapping._clientConfig.agent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml'
                },
                timeout: 15000
            });
        } else {
            // Fallback: buat client baru
            const jar = new CookieJar();
            const agent = new HttpsCookieAgent({ cookies: { jar } });
            client = axiosBase.create({
                httpsAgent: agent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml'
                },
                timeout: 15000
            });
            
            // Ambil token baru jika tidak ada di mapping
            const initRes = await client.get(`${fixedBase}/data-keluaran`);
            const $init = cheerio.load(initRes.data);
            csrfToken = $init('meta[name="csrf-token"]').attr('content');
            rawSnapshot = $init('[wire\\:id]').first().attr('wire:snapshot');
        }
        
        if (!csrfToken || !rawSnapshot) return { success: false, error: 'Gagal ambil token/snapshot' };

        // Post Livewire Update dengan ACTUAL ID (yang sudah dikoreksi)
        const payload = {
            _token: csrfToken,
            components: [{
                snapshot: rawSnapshot,
                updates: { market: actualId },
                calls: []
            }]
        };

        const updateRes = await client.post(`${fixedBase}/livewire/update`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'Referer': `${fixedBase}/data-keluaran?market=${actualId}`
            }
        });

        // Ekstrak Data Menggunakan REGEX
        const htmlContent = updateRes.data.components[0].effects.html;
        const plainText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        
        const results = [];
        const seenDates = new Set();

        const regex = /\b(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+(\d{4,5})\b/gi;
        let match;
        while ((match = regex.exec(plainText)) !== null) {
            const dayRaw = match[1];
            const dateRaw = match[2];
            const prize = match[3];

            const dayNorm = dayRaw.toLowerCase().replace(/\s+/g, '');
            const dateNorm = normalizeDate(dateRaw);

            if (dayNorm && dateNorm && prize && (prize.length === 4 || prize.length === 5) && !seenDates.has(dateNorm)) {
        seenDates.add(dateNorm);
        results.push({ day: dayNorm, date: dateNorm, prize });
    }
// }

        return { success: true, data: results };

    } catch (err) {
        return { 
            success: false, 
            error: err.response?.status === 419 ? 'CSRF Expired' : err.message 
        };
    }
}

// ==========================================
// CLEAN MAJORITY VOTE VALIDATION
// Hanya laporkan Missing, Mismatch, Failed. Tidak ada Swapped.
// ==========================================
function validateWithMajorityVote(canonicalMarketName, siteResults, siteUrls) {
    const issues = [];
    
    const validSites = siteResults.filter(r => r.success && r.data.length > 0);
    const failedOrEmptySites = siteResults.filter(r => !r.success || r.data.length === 0);

    if (validSites.length === 0) return issues;

    const allDates = new Set();
    validSites.forEach(res => res.data.forEach(item => allDates.add(item.date)));

    for (const dateNorm of allDates) {
        const entries = siteResults.map((res, idx) => ({
            domain: getDomainName(siteUrls[idx]),
            success: res.success,
            hasData: res.success && res.data.length > 0,
            item: res.success ? res.data.find(d => d.date === dateNorm) : null
        }));

        const presentSites = entries.filter(e => e.item);
        const missingSites = entries.filter(e => !e.item && e.hasData);
        const failedSites = entries.filter(e => !e.success || !e.hasData);

        // SKENARIO 1: Semua gagal
        if (failedSites.length > 0 && presentSites.length === 0) {
            failedSites.forEach(fs => {
                issues.push({
                    market: canonicalMarketName, date: dateNorm, culprit: fs.domain,
                    status: 'FETCH_FAILED', detail: 'Situs ini gagal mengambil data.'
                });
            });
            continue; 
        }

        // SKENARIO 2: Minority Missing
        if (missingSites.length > 0 && presentSites.length >= (siteResults.length / 2)) {
            missingSites.forEach(ms => {
                issues.push({
                    market: canonicalMarketName, date: dateNorm, culprit: ms.domain,
                    status: 'DATA_MISSING',
                    reference: `${presentSites.length}/${siteResults.length} situs lain memiliki data ini`,
                    detail: `KEHILANGAN data tanggal ${dateNorm}.`
                });
            });
        }

        // SKENARIO 3: Cek Prize/Hari
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
                        market: canonicalMarketName, date: dateNorm, culprit: ps.domain,
                        status: 'VALUE_MISMATCH',
                        reference: `Majority: Hari="${majorityDay}", Prize="${majorityPrize}"`,
                        detail: `SALAH NILAI! ${diffs.join(' | ')}`
                    });
                }
            });
        }
    }

    // SKENARIO 4: Situs Kosong Total
    failedOrEmptySites.forEach(fes => {
        if (validSites.length > 0) {
            issues.push({
                market: canonicalMarketName, date: 'ALL_DATES', culprit: fes.domain,
                status: 'TOTAL_DATA_MISSING',
                detail: 'Situs ini tidak mengembalikan data apapun.'
            });
        }
    });

    return issues;
}

// ==========================================
// ENDPOINT UTAMA: /scan-final
// ==========================================
// ==========================================
// ENDPOINT UTAMA: /scan-final (UPDATED FOR 25 SITES)
// ==========================================
app.get('/scan-final', async (req, res) => {
    // LOGIKA BARU: Ambil semua query params yang berawalan 'url'
    // Ini membuat sistem otomatis support url1 s/d url25+ tanpa edit kode lagi
    const urls = Object.keys(req.query)
        .filter(key => key.startsWith('url'))
        .map(key => req.query[key])
        .filter(Boolean)       // Hapus yang kosong/null
        .map(u => u.trim());   // Hapus spasi depan/belakang
    
    if (urls.length < 2) {
        return res.status(400).json({ status: 'error', message: 'Minimal 2 URL diperlukan (?url1=...&url2=...)' });
    }

    // Opsional: Batasi maksimal 25 untuk keamanan server
    const MAX_LIMIT = 25;
    if (urls.length > MAX_LIMIT) {
        return res.status(400).json({ 
            status: 'error', 
            message: `Maksimal ${MAX_LIMIT} situs. Anda memasukkan ${urls.length}.` 
        });
    }

    console.log(` Silent Auto-Correct Scan Started | ${urls.length} sites × 64 markets`);
    const startTime = Date.now();
    const allIssues = [];

    // LANGKAH 0: DETEKSI MAPPING UNTUK SETIAP SITUS
    console.log(` 🔍 Detecting market fingerprints for ${urls.length} sites...`);
    const siteMappings = {};
    
    // Deteksi dilakukan berurutan agar tidak spam request ke target sekaligus saat init
    for (const url of urls) {
        const domain = getDomainName(url);
        const mapping = await detectAndFixMapping(url);
        siteMappings[domain] = mapping || {};
        console.log(`   ✅ Fingerprint ready for ${domain}`);
    }

    // LANGKAH 1: SCANNING DENGAN AUTO-CORRECTION
    for (const market of CANONICAL_MARKETS) {
        console.log(`   Checking: ${market.name} (ID: ${market.id})...`);

        // Fetch semua situs paralel, masing-masing pakai auto-correction
        const siteResults = await Promise.all(
            urls.map(url => {
                const domain = getDomainName(url);
                const mapping = siteMappings[domain];
                return scrapeSite(url, market.id, mapping, siteMappings);
            })
        );

        // Validasi bersih
        const marketIssues = validateWithMajorityVote(market.name, siteResults, urls);
        allIssues.push(...marketIssues);
        
        // Delay tetap diperlukan agar IP Railway tidak diblokir LiteSpeed
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

app.get('/', (req, res) => res.json({ message: '🤫 Silent Auto-Corrector Ready!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
