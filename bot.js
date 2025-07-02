// =================================================================
// BOT DE REVERSÃO EMA (BTCUSDT) - Branch ema-reversal
// =================================================================

const { RestClientV5 } = require('bybit-api');
const TA = require('technicalindicators');

// --- Configurações ---
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const SYMBOL = 'BTCUSDT'; // <<-- OPERANDO EM BTCUSDT
const CATEGORY = 'linear';
const LEVERAGE_LONG = 20;
const LEVERAGE_SHORT = 20;
const EMA_PERIOD = 3;
const UPPER_BAND_PERCENT = 0.0028;
const LOWER_BAND_PERCENT = 0.0025;
const KLINE_INTERVAL = '60';
const MIN_ORDER_QTY = 0.001;
const QTY_PRECISION = 3;
const BALANCE_USAGE_PERCENT = 0.95;

let isOperating = false;
const client = new RestClientV5({ key: API_KEY, secret: API_SECRET });

// --- Funções Auxiliares ---
async function getApiData(func, params) {
  try {
    const response = await func(params);
    if (response.retCode === 0) return response.result;
    console.error(`Erro API (${func.name}):`, JSON.stringify(response));
    return null;
  } catch (e) { console.error(`Erro Crítico (${func.name}):`, e); return null; }
}
async function getKlineData() {
  const result = await getApiData(client.getKline.bind(client), { category: CATEGORY, symbol: SYMBOL, interval: KLINE_INTERVAL, limit: EMA_PERIOD + 10 });
  return result ? result.list.map(k => parseFloat(k[4])).reverse() : [];
}
async function getCurrentPrice() {
  const result = await getApiData(client.getTickers.bind(client), { category: CATEGORY, symbol: SYMBOL });
  return result ? parseFloat(result.list[0].lastPrice) : null;
}
async function getAvailableBalance() {
  const result = await getApiData(client.getWalletBalance.bind(client), { accountType: 'UNIFIED' });
  if (result && result.list.length > 0) {
    const balanceCoin = result.list[0].coin.find(c => c.coin === 'USDT'); // <<-- PROCURANDO SALDO EM USDT
    if (balanceCoin && balanceCoin.walletBalance) {
      const balance = parseFloat(balanceCoin.walletBalance);
      console.log(`>> Saldo Disponível (USDT) Detectado: $${balance.toFixed(2)}`);
      return balance;
    }
  }
  return 0;
}
async function getCurrentPositionSide() {
  const pos = await getApiData(client.getPositionInfo.bind(client), { category: CATEGORY, symbol: SYMBOL });
  return (pos && pos.list.length > 0 && parseFloat(pos.list[0].size) > 0) ? pos.list[0].side : 'None';
}

// --- Função de Operação ---
async function executeTrade(side, leverage) {
  if (isOperating) return;
  isOperating = true;
  console.log(`\n>>> SINAL DETECTADO. INICIANDO OPERAÇÃO PARA ${side.toUpperCase()} <<<`);
  try {
    await client.submitOrder({ category: CATEGORY, symbol: SYMBOL, side: side === 'Buy' ? 'Sell' : 'Buy', orderType: 'Market', qty: '0', closeOnTrigger: true, reduceOnly: true });
    console.log("   - Ordem de fechamento enviada. Aguardando 10s...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const balance = await getAvailableBalance();
    const price = await getCurrentPrice();
    if (!balance || !price || balance < 10) throw new Error("Saldo ou preço indisponível.");
    
    await client.setLeverage({ category: CATEGORY, symbol: SYMBOL, buyLeverage: String(leverage), sellLeverage: String(leverage) });
    const usableBalance = balance * BALANCE_USAGE_PERCENT;
    const positionValue = usableBalance * leverage;
    const finalQty = (positionValue / price).toFixed(QTY_PRECISION);

    if (parseFloat(finalQty) < MIN_ORDER_QTY) throw new Error(`Quantidade calculada (${finalQty}) é menor que o mínimo.`);
    
    console.log(`     - Abrindo ${side} de ${finalQty} BTC...`);
    const res = await getApiData(client.submitOrder.bind(client), { category: CATEGORY, symbol: SYMBOL, side: side, orderType: 'Market', qty: finalQty });
    if (res) console.log(`>> SUCESSO! Posição ${side.toUpperCase()} aberta.`);
  } catch (error) { console.error("   - ERRO CRÍTICO na operação:", error.message);
  } finally { isOperating = false; }
}

// --- Lógica de Estratégia ---
async function checkStrategy() {
  if (isOperating) return;
  const price = await getCurrentPrice();
  const closes = await getKlineData();
  if (!closes || closes.length < EMA_PERIOD || !price) { console.log("Dados insuficientes."); return; }
  
  const ema = TA.ema({ period: EMA_PERIOD, values: closes })[0];
  const upperBand = ema * (1 + UPPER_BAND_PERCENT);
  const lowerBand = ema * (1 - LOWER_BAND_PERCENT);
  
  console.log(`------------------`);
  console.log(`Preço: ${price.toFixed(2)} | EMA(${EMA_PERIOD}): ${ema.toFixed(2)} | Banda: ${lowerBand.toFixed(2)} (Long) - ${upperBand.toFixed(2)} (Short)`);
  
  const currentSide = await getCurrentPositionSide();
  console.log(`Posição Atual: ${currentSide}`);

  if (currentSide !== 'Short' && price >= upperBand) { await executeTrade('Sell', LEVERAGE_SHORT); } 
  else if (currentSide !== 'Long' && price <= lowerBand) { await executeTrade('Buy', LEVERAGE_LONG); } 
  else { console.log("Preço entre as bandas. Nenhuma ação."); }
}

console.log("==> BOT DE REVERSÃO EMA (BTCUSDT) INICIADO <==");
setInterval(checkStrategy, 60 * 1000);