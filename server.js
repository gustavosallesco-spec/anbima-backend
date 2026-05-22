require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.ANBIMA_CLIENT_ID;
const CLIENT_SECRET = process.env.ANBIMA_CLIENT_SECRET;
const ANBIMA_AUTH_URL = 'https://auth.anbima.com.br/oauth/token';
const ANBIMA_API_URL = 'https://api.anbima.com.br/feed/precos-indices/v2';

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(ANBIMA_AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Auth failed: ${err}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Anbima Backend rodando' });
});

app.post('/carteira', async (req, res) => {
  try {
    const { ativos } = req.body;
    if (!ativos || !Array.isArray(ativos)) {
      return res.status(400).json({ error: 'Envie um array de ativos' });
    }
    const resultados = await Promise.allSettled(
      ativos.map(async (ativo) => {
        const { ticker, tipo } = ativo;
        const tipoPath = tipo === 'CRI' ? 'cri' : tipo === 'CRA' ? 'cra' : 'debentures';
        const token = await getToken();
        const [infoRes, agendaRes] = await Promise.all([
          fetch(`${ANBIMA_API_URL}/mercado-secundario/${tipoPath}/${ticker.toUpperCase()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(`${ANBIMA_API_URL}/mercado-secundario/${tipoPath}/${ticker.toUpperCase()}/agenda`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);
        const info = infoRes.ok ? await infoRes.json() : null;
        const agenda = agendaRes.ok ? await agendaRes.json() : null;
        return { ticker, tipo, info, agenda, erro: !infoRes.ok ? `${ticker} não encontrado` : null };
      })
    );
    const dados = resultados.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ticker: ativos[i].ticker, erro: r.reason?.message }
    );
    res.json({ ativos: dados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));