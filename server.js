require('dotenv').config();
require('dotenv').config({ path: '/etc/secrets/.env', override: true });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.ANBIMA_CLIENT_ID;
const CLIENT_SECRET = process.env.ANBIMA_CLIENT_SECRET;
const ANBIMA_AUTH_URL = 'https://api.anbima.com.br/oauth/access-token';
const ANBIMA_API_URL = 'https://api.anbima.com.br/feed/precos-indices/v2';

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  console.log('Autenticando com CLIENT_ID:', CLIENT_ID ? CLIENT_ID.slice(0,4)+'...' : 'UNDEFINED');
  const res = await fetch(ANBIMA_AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ grant_type: 'client_credentials' })
  });
  const responseText = await res.text();
  console.log('Auth status:', res.status, '— resposta:', responseText.slice(0,200));
  if (!res.ok) throw new Error(`Auth failed: ${responseText}`);
  const data = JSON.parse(responseText);
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
    const token = await getToken();
    const resultados = await Promise.allSettled(
      ativos.map(async (ativo) => {
        const { ticker, tipo } = ativo;
        const tipoPath = tipo === 'CRI' ? 'cri' : tipo === 'CRA' ? 'cra' : 'debentures';
        const cod = ticker.toUpperCase();
        const headers = { 'Authorization': `Bearer ${token}`, 'client_id': CLIENT_ID };
        const [infoRes, agendaRes] = await Promise.all([
          fetch(`${ANBIMA_API_URL}/mercado-secundario/${tipoPath}/${cod}`, { headers }),
          fetch(`${ANBIMA_API_URL}/mercado-secundario/${tipoPath}/${cod}/agenda`, { headers })
        ]);
        const infoText = await infoRes.text();
        const agendaText = await agendaRes.text();
        console.log(`[${cod}] status: ${infoRes.status} — ${infoText.slice(0,150)}`);
        const info = infoRes.ok ? JSON.parse(infoText) : null;
        const agenda = agendaRes.ok ? JSON.parse(agendaText) : null;
        return { ticker: cod, tipo, info, agenda, erro: !infoRes.ok ? `${infoRes.status}: ${infoText.slice(0,100)}` : null };
      })
    );
    const dados = resultados.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ticker: ativos[i].ticker, erro: r.reason?.message }
    );
    res.json({ ativos: dados });
  } catch (err) {
    console.error('Erro geral:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
