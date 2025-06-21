import { RestClientV5 } from 'bybit-api';


// suas variáveis de ambiente
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;

const SYMBOL = 'BTCUSDT';
const LEVERAGE = 2;
const INITIAL_CAPITAL_USDT = 5000;

const client = new RestClientV5({
  key: API_KEY,
  secret: API_SECRET,
  testnet: false,
});

// resto do seu código aqui, sem mudanças
