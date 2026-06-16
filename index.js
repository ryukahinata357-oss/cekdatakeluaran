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

// Helper: Normalisasi string
const clean = (str) => String(str || '').replace(/\s+/g, '').toLowerCase();

// ==========================================
// FUNGSI SCRAPING PER MARKET
// ==========================================
async function scrapeMarketData(baseUrl, marketId) {
    try {
        // Otomatis tambahkan path data-keluaran
        const url = `${baseUrl.replace(/\/$/, '')}/data-keluaran?market=${marketId}`;
        
        const { data } = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000 
        });

        const $ = cheerio.load(data);
        const results = [];

        // Parsing struktur tabel Livewire/Togel
        $('div.flex.overflow-hidden.border.rounded-lg, tr').each((i, el) => {
            const text = $(el).text();
            if (/\b\d{4}\b/.test(text)) {
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
        return { success: false, error: err.message };
    }
}

// ==========================================
// ENDPOINT UTAMA: /scan-all
// ==========================================
app.get('/scan-all', async (req, res) => {
    const { url1, url2 } = req.query;

    if (!url1 || !url2) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Wajib isi ?url1=domain1.com&url2=domain2.com' 
        });
    }

    console.log(`🚀 Memulai Full Scan 64 Pasaran...`);
    const issues = []; // Hanya simpan yang bermasalah
    let processedCount = 0;

    // Loop semua market dengan delay anti-blokir
    for (const market of MARKETS) {
        processedCount++;
        console.log(`[${processedCount}/64] Scanning ${market.name}...`);

        // Ambil data dari kedua situs secara paralel
        const [res1, res2] = await Promise.all([
            scrapeMarketData(url1, market.id),
            scrapeMarketData(url2, market.id)
        ]);

        // Jika salah satu gagal scraping, catat sebagai error
        if (!res1.success || !res2.success) {
            issues.push({
                market: market.name,
                market_id: market.id,
                status: 'SCRAPE_ERROR',
                detail: `Site1: ${res1.error || 'OK'} | Site2: ${res2.error || 'OK'}`
            });
            continue;
        }

        // Bandingkan data per tanggal
        res1.data.forEach(item1 => {
            const item2 = res2.data.find(i2 => i2.date === item1.date);

            if (!item2) {
                // Data hilang di site2
                issues.push({
                    market: market.name,
                    date: item1.date,
                    status: 'MISSING_IN_SITE2',
                    detail: `Data tanggal ${item1.date} tidak ada di situs 2`
                });
            } else {
                // Cek perbedaan Hari & Prize
                const diffs = [];
                if (item1.day !== item2.day) diffs.push(`Hari: "${item1.day}" vs "${item2.day}"`);
                if (item1.prize !== item2.prize) diffs.push(`Prize: "${item1.prize}" vs "${item2.prize}"`);

                // HANYA PUSH JIKA ADA PERBEDAAN
                if (diffs.length > 0) {
                    issues.push({
                        market: market.name,
                        date: item1.date,
                        status: 'MISMATCH',
                        detail: diffs.join(' | ')
                    });
                }
            }
        });

        // Delay 1 detik antar market agar tidak kena rate limit
        await new Promise(r => setTimeout(r, 1000));
    }

    // Kirim Response Bersih (Hanya Error)
    res.json({
        status: 'success',
        summary: {
            total_markets_scanned: 64,
            total_issues_found: issues.length,
            is_perfect_sync: issues.length === 0
        },
        // Array ini hanya berisi masalah, kosong jika semua aman
        errors: issues 
    });
});

// Health Check
app.get('/', (req, res) => res.json({ message: 'Auto Scanner API Ready!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
