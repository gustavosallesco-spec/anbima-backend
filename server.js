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
  const res = await fetch(ANBIMA_AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ grant_type: 'client_credentials' })
  });
  const responseText = await res.text();
  console.log('Auth status:', res.status);
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
    console.log('Ativos recebidos:', JSON.stringify(ativos));
    if (!ativos || !Array.isArray(ativos)) {
      return res.status(400).json({ error: 'Envie um array de ativos' });
    }
    const token = await getToken();
    const resultados = await Promise.allSettled(
      ativos.map(async (ativo, i) => {
        const ticker = (ativo.ticker || ativo.code || '').toString().trim().toUpperCase();
        const tipo = ativo.tipo || 'CRA';
        if (!ticker) return { ticker: `ativo_${i}`, tipo, info: null, agenda: null, erro: 'Ticker vazio' };
        const tipoPath = tipo === 'CRI' ? 'cri' : tipo === 'CRA' ? 'cra' : 'debentures';
        const headers =
