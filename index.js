const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors()); // Wajib agar bisa diakses dari browser/domain lain

// ==========================================
// MAPPING PASARAN (ID ke Nama)
// ==========================================
const MARKET_MAP = {
    '1': 'Roma', '2': 'Kentucky Mid', '3': 'Turin', '4': 'Florida Mid',
    '5': 'Newyork Mid', '6': 'Carolina Day', '7': 'Madrid', '8': 'Bulgaria',
    '9': 'Oregon 03', '10': 'Hungary', '11': 'Miami', '12': 'Oregon 06',
    '13': 'California', '14': 'Florida Eve', '15': 'Oregon 09', '16': 'Newyork Eve',
    '17': 'Kentucky Eve', '18': 'Austria', '19': 'Carolina Eve', '20': 'Cambodia',
    '21': 'Bullseye', '22': 'Laos', '23': 'Oregon 12', '24': 'Toto Macau P1',
    '25': 'Sydney', '26': 'Guangdong', '27': 'China', '28': 'Toto Macau 5D P1',
    '29': 'Toto Macau P2', '30': 'Philippines', '31': 'Japan', '32': 'Singapore 4D',
    '33': 'Jeju Lotto', '34': 'Toto Beijing', '35': 'Toto Macau P3', '36': 'Toto Fuzhou',
    '37': 'Cyprus', '38': 'Taiwan', '39': 'Toto Macau 5D P2', '40': 'Iceland',
    '41': 'Toto Macau P4', '42': 'Bhutan', '43': 'Hongkong', '44': 'Toto Macau P5',
    '45': 'Toronto', '46': 'Toto Macau P6', '47': 'Singapore Toto', '48': 'Kingkong P1',
    '49': 'Kingkong P2', '50': 'Chengdu', '51': 'Chongqing', '52': 'Cuba',
    '53': 'Denver', '54': 'Ecuador', '55': 'Foshan', '56': 'Haiti',
    '57': 'Kowloon', '58': 'Monaco', '59': 'Taichung', '60': 'Italy',
    '61': 'France', '62': 'Chile', '63': 'Mexico', '64': 'Oslo'
};

// Helper: Membersihkan string agar perbandingan akurat
const clean = (str) => String(str || '').replace(/\s+/g, '').toLowerCase();

// ==========================================
// FUNGSI SCRAPING UNIVERSAL
// ==========================================
async function scrapeData(url) {
    try {
        const { data } = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 15000 
        });

        const $ = cheerio.load(data);
        const results = [];

        // LOGIC PARSING TABLE TOGEL
        // Mencari baris yang memiliki pola angka 4 digit (Prize)
        $('div.flex.overflow-hidden.border.rounded-lg, tr').each((i, el) => {
            const text = $(el).text();
            if (/\b\d{4}\b/.test(text)) {
                const cols = $(el).find('div, td');
                
                // Ekstraksi kolom (Sesuaikan index jika struktur HTML beda)
                let marketId = clean($(cols[0]).text()).replace(/[^a-z0-9]/g, '');
                let day = clean($(cols[1]).text());
                let date = clean($(cols[2]).text());
                let prize = clean($(cols[3]).find('b').text() || $(cols[3]).text());

                if (marketId && date && prize) {
                    results.push({ marketId, day, date, prize });
                }
            }
        });

        return { success: true, data: results };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ==========================================
// ENDPOINT GET: /compare
// ==========================================
app.get('/compare', async (req, res) => {
    const { url1, url2 } = req.query;

    // Validasi Input
    if (!url1 || !url2) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Harap sertakan ?url1=...&url2=... di alamat URL.' 
        });
    }

    console.log(`🔍 Membandingkan: ${url1} vs ${url2}`);

    // 1. Ambil data kedua situs secara bersamaan (Paralel)
    const [res1, res2] = await Promise.all([
        scrapeData(url1),
        scrapeData(url2)
    ]);

    // Cek jika ada yang gagal scraping
    if (!res1.success || !res2.success) {
        return res.status(502).json({
            status: 'error',
            message: 'Gagal mengambil data dari situs.',
            details: { 
                site1_error: res1.error, 
                site2_error: res2.error 
            }
        });
    }

    // 2. LOGIC PERBANDINGAN (MATCHING ENGINE)
    const report = [];
    let matchCount = 0;
    let mismatchCount = 0;

    res1.data.forEach(item1 => {
        // Cari pasangan di situs 2 berdasarkan Market ID + Tanggal
        const item2 = res2.data.find(i2 => 
            i2.marketId === item1.marketId && i2.date === item1.date
        );

        let status = 'MATCH';
        let diffs = [];

        if (!item2) {
            status = 'MISSING_IN_SITE2';
            mismatchCount++;
        } else {
            // Cek Hari
            if (item1.day !== item2.day) {
                diffs.push({ field: 'hari', val1: item1.day, val2: item2.day });
            }
            // Cek Prize
            if (item1.prize !== item2.prize) {
                diffs.push({ field: 'prize_1', val1: item1.prize, val2: item2.prize });
            }

            if (diffs.length > 0) {
                status = 'MISMATCH';
                mismatchCount++;
            } else {
                matchCount++;
            }
        }

        report.push({
            market_name: MARKET_MAP[item1.marketId] || item1.marketId,
            date: item1.date,
            status,
            differences: diffs
        });
    });

    // 3. Kirim Response JSON
    res.json({
        status: 'success',
        summary: {
            total_data: report.length,
            match: matchCount,
            mismatch: mismatchCount,
            is_synced: mismatchCount === 0
        },
        results: report
    });
});

// Health Check
app.get('/', (req, res) => res.json({ message: 'API Comparator Aktif!' }));

// Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(` API berjalan di port ${PORT}`));
