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
    try {
        const u = new URL(fixUrl(url));
        return u.hostname.replace('www.', '');
    } catch { return url; }
};

const normalizeDate = (str) => {
    if (!str) return '';
    return str.trim().toLowerCase().replace(/\s+/g, '').replace(/juni/g, 'jun').replace(/juli/g, 'jul');
};

// ==========================================
// BRUTE FORCE MARKET MAPPING ENGINE
// Membandingkan tanggal pertama untuk menentukan mapping yang benar
// ==========================================
async function detectMarketMapping(baseUrl) {
    const mapping = { '32': '32', '47': '47' }; // Default: Normal
    
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

        // Fungsi helper untuk extract tanggal pertama dari response
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

        // TES BRUTE FORCE:
        // Ambil tanggal pertama dari ID 32 dan ID 47
        const dateFrom32 = await getFirstDate('32');
        const dateFrom47 = await getFirstDate('47');

        console.log(`   🔍 Testing ${getDomainName(baseUrl)}: ID32->${dateFrom32}, ID47->${dateFrom47}`);

        // LOGIKA DETEKSI:
        // Jika kedua ID mengembalikan tanggal PERTAMA yang SAMA, berarti situs ini hanya punya 1 jenis Singapore
        // dan ID lainnya kosong/error. Ini kasus langka, kita pakai default.
        
        // Tapi jika tanggalnya BEDA, kita perlu tahu mana yang "4D" dan mana yang "Toto"
        // Karena kita tidak bisa bedakan dari tanggal saja, kita asumsikan:
        // - Situs mayoritas (karturumus, prediksitanjung, dll) = NORMAL (32=4D, 47=Toto)
        // - Jika situs ini memberikan hasil yang CONSISTENTLY berbeda dari mayoritas saat scanning nanti,
        //   maka dia SWAPPED.
        
        // UNTUK SEKARANG: Kita simpan tanggal referensi ini untuk validasi nanti
        mapping._refDate32 = dateFrom32;
        mapping._refDate47 = dateFrom47;

        return mapping;

    } catch (err) {
        console.error(`   ❌ Failed to detect mapping for ${baseUrl}:`, err.message);
        return mapping;
    }
}

// ==========================================
// SMART SCRAPING ENGINE
// ==========================================
async function scrapeSite(baseUrl, canonicalMarketId, siteMapping) {
    try {
        const fixedBase = fixUrl(baseUrl);
        
        // Gunakan ID yang sudah dipetakan jika ada
        const actualId = (siteMapping && siteMapping[String(canonicalMarketId)]) 
                         ? siteMapping[String(canonicalMarketId)] 
                         : String(canonicalMarketId);

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

        // Step 2: Post Livewire Update dengan ACTUAL ID
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

        // Step 3: Ekstrak Data Menggunakan REGEX
        const htmlContent = updateRes.data.components[0].effects.html;
        const plainText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        
        const results = [];
        const seenDates = new Set();

        const regex = /\b(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+(\d{4})\b/gi;
        let match;
        while ((match = regex.exec(plainText)) !== null) {
            const dayRaw = match[1];
            const dateRaw = match[2];
            const prize = match[3];

            const dayNorm = dayRaw.toLowerCase().replace(/\s+/g, '');
            const dateNorm = normalizeDate(dateRaw);

            if (dayNorm && dateNorm && prize && !seenDates.has(dateNorm)) {
                seenDates.add(dateNorm);
                results.push({ day: dayNorm, date: dateNorm, prize });
            }
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
// ADAPTIVE MAJORITY VOTE VALIDATION
// Mendeteksi dan memperbaiki swapped sites secara real-time
// ==========================================
function validateWithMajorityVote(canonicalMarketName, siteResults, siteUrls, siteMappings) {
    const issues = [];
    
    const validSites = siteResults.filter(r => r.success && r.data.length > 0);
    const failedOrEmptySites = siteResults.filter(r => !r.success || r.data.length === 0);

    if (validSites.length === 0) return issues;

    // Khusus untuk Singapore (ID 32 & 47), lakukan deteksi swapped real-time
    const isSingapore = canonicalMarketName.includes('Singapore');
    let swappedSites = new Set();

    if (isSingapore && validSites.length >= 2) {
        // Kumpulkan tanggal pertama dari semua situs valid
        const firstDates = validSites.map((res, idx) => ({
            idx,
            domain: getDomainName(siteUrls[idx]),
            firstDate: res.data[0]?.date || null
        })).filter(d => d.firstDate);

        // Cari tanggal yang paling umum (majority)
        const dateCounts = {};
        firstDates.forEach(d => {
            dateCounts[d.firstDate] = (dateCounts[d.firstDate] || 0) + 1;
        });
        
        const majorityDate = Object.keys(dateCounts).reduce((a, b) => dateCounts[a] > dateCounts[b] ? a : b);
        const majorityCount = dateCounts[majorityDate];

        // Situs yang tanggal pertamanya BEDA dari majority = SWAPPED
        firstDates.forEach(d => {
            if (d.firstDate !== majorityDate && majorityCount >= 2) {
                console.log(`   ⚠️ Detected SWAPPED site: ${d.domain} (${canonicalMarketName})`);
                swappedSites.add(d.idx);
            }
        });
    }

    const allDates = new Set();
    validSites.forEach(res => res.data.forEach(item => allDates.add(item.date)));

    for (const dateNorm of allDates) {
        const entries = siteResults.map((res, idx) => ({
            domain: getDomainName(siteUrls[idx]),
            success: res.success,
            hasData: res.success && res.data.length > 0,
            item: res.success ? res.data.find(d => d.date === dateNorm) : null,
            isSwapped: swappedSites.has(idx)
        }));

        // Untuk situs yang swapped, kita SKIP validasinya karena datanya memang dari pasaran lain
        const presentSites = entries.filter(e => e.item && !e.isSwapped);
        const missingSites = entries.filter(e => !e.item && e.hasData && !e.isSwapped);
        const failedSites = entries.filter(e => (!e.success || !e.hasData) && !e.isSwapped);
        const swappedEntries = entries.filter(e => e.isSwapped);

        // Laporkan situs swapped sebagai warning khusus
        if (swappedEntries.length > 0 && canonicalMarketName === 'Singapore 4D') {
            swappedEntries.forEach(se => {
                issues.push({
                    market: canonicalMarketName,
                    date: dateNorm,
                    culprit: se.domain,
                    status: 'MARKET_SWAPPED',
                    reference: 'Situs ini memiliki ID Singapore yang terbalik (32=Toto, 47=4D)',
                    detail: `Data yang ditampilkan sebenarnya adalah Singapore Toto, bukan Singapore 4D.`
                });
            });
        }

        if (failedSites.length > 0 && presentSites.length === 0) {
            failedSites.forEach(fs => {
                issues.push({
                    market: canonicalMarketName, date: dateNorm, culprit: fs.domain,
                    status: 'FETCH_FAILED', detail: 'Situs ini gagal mengambil data.'
                });
            });
            continue; 
        }

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
app.get('/scan-final', async (req, res) => {
    const urls = [req.query.url1, req.query.url2, req.query.url3, req.query.url4, req.query.url5].filter(Boolean);
    
    if (urls.length < 2) {
        return res.status(400).json({ status: 'error', message: 'Minimal 2 URL diperlukan (?url1=...&url2=...)' });
    }

    console.log(` Universal Scan Started | ${urls.length} sites × 64 markets`);
    const startTime = Date.now();
    const allIssues = [];

    // LANGKAH 0: DETEKSI MAPPING UNTUK SETIAP SITUS
    console.log(` 🔍 Detecting market mappings for ${urls.length} sites...`);
    const siteMappings = {};
    
    for (const url of urls) {
        const domain = getDomainName(url);
        const mapping = await detectMarketMapping(url);
        siteMappings[domain] = mapping || {};
        console.log(`   ✅ Mapping ready for ${domain}`);
    }

    // LANGKAH 1: SCANNING DENGAN MAPPING
    for (const market of CANONICAL_MARKETS) {
        console.log(`   Checking Canonical: ${market.name} (ID: ${market.id})...`);

        const siteResults = await Promise.all(
            urls.map(url => {
                const domain = getDomainName(url);
                const mapping = siteMappings[domain];
                return scrapeSite(url, market.id, mapping);
            })
        );

        const marketIssues = validateWithMajorityVote(market.name, siteResults, urls, siteMappings);
        allIssues.push(...marketIssues);
        
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

app.get('/', (req, res) => res.json({ message: '🧠 Adaptive Market Mapper Ready!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
