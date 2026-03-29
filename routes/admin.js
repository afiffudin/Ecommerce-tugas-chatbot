const express = require('express');
const router = express.Router();
const db = require('../config/db');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const bcrypt = require('bcrypt');



/* ================== FUNGSI GROQ ================== */
async function groq(userText, systemPrompt) {
  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('GROQ ERROR:', err.response?.data || err.message);
    return 'AI sedang tidak tersedia';
  }
}


/* ================= MIDDLEWARE ================= */
function auth(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.redirect('/login');
  }
  next();
}

/* ================= LOGIN ================= */
router.get('/login', (req, res) => {
  res.render('login', { error: req.query.error });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  db.query(
    'SELECT * FROM admin WHERE username=?',
    [username],
    async (err, result) => {
      if (err || result.length === 0) {
        return res.redirect('/login?error=1');
      }

      const valid = await bcrypt.compare(password, result[0].password);
      if (!valid) {
        return res.redirect('/login?error=1');
      }

      req.session.admin = {
        id: result[0].id,
        username: result[0].username
      };

      res.redirect('/');
    }
  );
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

/* ================= DASHBOARD ================= */
router.get('/', auth, (req, res) => {
  res.render('dashboard', { admin: req.session.admin });
});

/* ================= PEMBELIAN ================= */
router.get('/pembelian', auth, (req, res) => {
  db.query('SELECT * FROM produk', (err, produk) => {
    res.render('pembelian', {
      produk,
      query: req.query
    });
  });
});


router.post('/pembelian', auth, (req, res) => {
  const { produk_id, jumlah } = req.body;

  db.query(
    'SELECT harga FROM produk WHERE id=?',
    [produk_id],
    (err, r) => {
      if (!r || r.length === 0) return res.redirect('/pembelian');

      const total = r[0].harga * jumlah;

      db.query(
        'INSERT INTO pembelian (produk_id,jumlah,total_harga,status) VALUES (?,?,?,"AKTIF")',
        [produk_id, jumlah, total]
      );

      db.query(
        'UPDATE stok SET jumlah = jumlah - ? WHERE produk_id=?',
        [jumlah, produk_id]
      );

      res.redirect('/list-pembelian');
    }
  );
});

/* ================= LIST PEMBELIAN ================= */
router.get('/list-pembelian', auth, (req, res) => {
  db.query(
    `SELECT pembelian.*, produk.nama_produk 
     FROM pembelian 
     JOIN produk ON pembelian.produk_id = produk.id
     ORDER BY pembelian.id DESC`,
    (err, data) => {
      res.render('list-pembelian', { data });
    }
  );
});

/* ================= CANCEL ================= */
router.get('/cancel/:id', auth, (req, res) => {
  const id = req.params.id;

  db.query(
    'SELECT * FROM pembelian WHERE id=?',
    [id],
    (err, r) => {
      if (!r || r.length === 0) return res.redirect('/list-pembelian');

      const p = r[0];

      db.query(
        'UPDATE stok SET jumlah = jumlah + ? WHERE produk_id=?',
        [p.jumlah, p.produk_id]
      );

      db.query(
        'UPDATE pembelian SET status="CANCEL" WHERE id=?',
        [id]
      );

      res.redirect('/list-pembelian');
    }
  );
});

/* ================= EXPORT PDF ================= */
router.get('/export/:id', auth, (req, res) => {
  const doc = new PDFDocument();
  res.setHeader('Content-Disposition', 'attachment; filename=struk.pdf');
  doc.pipe(res);

  db.query(
    `SELECT pembelian.*, produk.nama_produk 
     FROM pembelian 
     JOIN produk ON pembelian.produk_id = produk.id
     WHERE pembelian.id=?`,
    [req.params.id],
    (err, r) => {
      if (!r || r.length === 0) return doc.end();

      const p = r[0];
      doc.fontSize(18).text('STRUK PEMBELIAN');
      doc.moveDown();
      doc.text(`Produk : ${p.nama_produk}`);
      doc.text(`Jumlah : ${p.jumlah}`);
      doc.text(`Total  : Rp ${p.total_harga}`);
      doc.text(`Status : ${p.status}`);
      doc.end();
    }
  );
});

/* ================= CHATBOT ================= */
router.post('/chatbot', auth, async (req, res) => {
  const question = req.body.message.toLowerCase();

  /* ================= LIST SEMUA PEMBELIAN ================= */
  if (question.includes('list') && question.includes('pembelian')) {
    db.query(
      `SELECT p.id, pr.nama_produk, p.jumlah, p.total_harga, p.status, p.tanggal
       FROM pembelian p
       JOIN produk pr ON p.produk_id = pr.id
       ORDER BY p.tanggal DESC`,
      async (err, rows) => {
        if (!rows || rows.length === 0) {
          return res.json({ reply: 'Belum ada data pembelian.' });
        }

        const text = rows.map(r =>
          `ID ${r.id} | ${r.nama_produk} | Qty ${r.jumlah} | Rp ${r.total_harga} | ${r.status} | ${r.tanggal}`
        ).join('\n');

        const ai = await groq(
          text,
          'Rapikan daftar pembelian berikut agar mudah dibaca'
        );
        return res.json({ reply: ai });
      }
    );
    return;
  }

  /* ================= TOTAL PEMBELIAN ================= */
  if (question.includes('total') && question.includes('pembelian')) {
    db.query(
      `SELECT SUM(total_harga) AS total FROM pembelian WHERE status='AKTIF'`,
      (err, rows) => {
        const total = rows[0].total || 0;
        return res.json({
          reply: `Total pembelian saat ini adalah Rp ${total.toLocaleString()}`
        });
      }
    );
    return;
  }

  /* ================= PEMBELIAN HARI INI ================= */
  if (question.includes('hari ini')) {
    db.query(
      `SELECT COUNT(*) AS jumlah FROM pembelian WHERE DATE(tanggal)=CURDATE()`,
      (err, rows) => {
        return res.json({
          reply: `Jumlah transaksi hari ini: ${rows[0].jumlah}`
        });
      }
    );
    return;
  }

  /* ================= PRODUK TERJUAL ================= */
  if (question.includes('produk') && question.includes('terjual')) {
    db.query(
      `SELECT pr.nama_produk, SUM(p.jumlah) AS total
       FROM pembelian p
       JOIN produk pr ON p.produk_id = pr.id
       GROUP BY p.produk_id
       ORDER BY total DESC`,
      async (err, rows) => {
        if (!rows || rows.length === 0) {
          return res.json({ reply: 'Belum ada produk terjual.' });
        }

        const text = rows.map(r =>
          `${r.nama_produk}: ${r.total} pcs`
        ).join('\n');

        const ai = await groq(text, 'Buat ringkasan produk terjual');
        return res.json({ reply: ai });
      }
    );
    return;
  }

  /* ================= DEFAULT CHAT ================= */
  const ai = await groq(req.body.message, 'Kamu adalah asisten admin toko');
  res.json({ reply: ai });
});

//   // 🔹 Tanya jumlah pembelian
//   if (question.includes('berapa') && question.includes('pembelian')) {
//     db.query(
//       'SELECT COUNT(*) AS total FROM pembelian',
//       async (err, result) => {
//         const total = result[0].total;

//         const aiResponse = await axios.post(
//           'https://api.groq.com/openai/v1/chat/completions',
//           {
//             model: 'llama-3.1-8b-instant',
//             messages: [
//               {
//                 role: 'system',
//                 content: 'Kamu adalah asisten admin toko dan harus menjawab berdasarkan data yang diberikan.'
//               },
//               {
//                 role: 'user',
//                 content: `Jumlah pembelian saat ini adalah ${total}. Jelaskan dengan kalimat yang sopan.`
//               }
//             ]
//           },
//           {
//             headers: {
//               Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
//               'Content-Type': 'application/json'
//             }
//           }
//         );

//         return res.json({
//           reply: aiResponse.data.choices[0].message.content
//         });
//       }
//     );
//     return;
//   }

//   // 🔹 Default chat (tanpa DB)
//   try {
//     const response = await axios.post(
//       'https://api.groq.com/openai/v1/chat/completions',
//       {
//         model: 'llama-3.1-8b-instant',
//         messages: [
//           { role: 'system', content: 'Kamu adalah asisten admin toko' },
//           { role: 'user', content: req.body.message }
//         ]
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     res.json({ reply: response.data.choices[0].message.content });
//   } catch (err) {
//     res.json({ reply: '❌ AI tidak tersedia' });
//   }
// });

// router.post('/chat', auth, async (req, res) => {
//   try {
//     const response = await axios.post(
//       'https://api.openai.com/v1/chat/completions',
//       {
//         model: 'gpt-3.5-turbo',
//         messages: [
//           { role: 'system', content: 'Kamu adalah asisten admin toko' },
//           { role: 'user', content: req.body.message }
//         ]
//       },
//       {
//         headers: {
//           Authorization: `Bearer API_KEY_KAMU`
//         }
//       }
//     );

//     res.json({
//       reply: response.data.choices[0].message.content
//     });
//   } catch (error) {
//     res.json({
//       reply: 'Maaf, AI sedang tidak tersedia'
//     });
//   }
// });
module.exports = router;
