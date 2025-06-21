import pkg from 'bybit-api';
const { WebsocketClient, RestClient } = pkg;


// --- Configurações ---
const API_KEY = 'SUA_API_KEY_AQUI';
const API_SECRET = 'SEU_API_SECRET_AQUI';
const SYMBOL = 'BTCUSDT';
const LEVERAGE = 2;
const INITIAL_CAPITAL_USDT = 5000;

const client = new RestClient({
  key: API_KEY,
  secret: API_SECRET,
  testnet: false, // set true para testnet
});

// Estado do bot
let athPrice = 0;
let positionSize = 0; // em contratos
let entered = false;
let capitalUsed = 0;

// Função para obter preço atual do símbolo
async function getCurrentPrice() {
  const ticker = await client.getTicker({ symbol: SYMBOL });
  return parseFloat(ticker.lastPrice);
}

// Ajusta alavancagem isolada
async function setLeverage() {
  await client.setLeverage({
    symbol: SYMBOL,
    buy_leverage: LEVERAGE,
    sell_leverage: LEVERAGE,
    margin_type: 'Isolated',
  });
}

// Abre posição long
async function openPosition(amountUSDT) {
  const price = await getCurrentPrice();
  const qty = amountUSDT / price * LEVERAGE;

  // ordem de mercado compra
  const res = await client.placeActiveOrder({
    symbol: SYMBOL,
    side: 'Buy',
    order_type: 'Market',
    qty: qty.toFixed(3),
    time_in_force: 'GoodTillCancel',
    reduce_only: false,
  });
  return res;
}

// Fecha posição
async function closePosition() {
  // ordem de mercado venda para fechar
  const res = await client.placeActiveOrder({
    symbol: SYMBOL,
    side: 'Sell',
    order_type: 'Market',
    qty: positionSize.toFixed(3),
    time_in_force: 'GoodTillCancel',
    reduce_only: true,
  });
  return res;
}

// Monitorar preço e lógica do bot
async function monitor() {
  const price = await getCurrentPrice();

  if (!entered) {
    if (price > athPrice) {
      athPrice = price;
      console.log(`Novo ATH: ${athPrice}`);
    } else if (athPrice > 0 && price <= athPrice * 0.9) {
      // cair 10% do ATH, abrir posição com 80% do capital
      const amountToUse = INITIAL_CAPITAL_USDT * 0.8;
      console.log(`Preço caiu 10% do ATH (${athPrice}), abrindo posição com $${amountToUse}`);
      await setLeverage();
      await openPosition(amountToUse);
      capitalUsed = amountToUse;
      positionSize = amountToUse / price * LEVERAGE;
      entered = true;
    }
  } else {
    // Já entrou, checar se caiu 20% do ATH para DCA
    if (price <= athPrice * 0.8 && capitalUsed < INITIAL_CAPITAL_USDT) {
      const amountToUse = INITIAL_CAPITAL_USDT * 0.2;
      console.log(`Preço caiu 20% do ATH (${athPrice}), DCA com $${amountToUse}`);
      await openPosition(amountToUse);
      capitalUsed += amountToUse;
      positionSize += amountToUse / price * LEVERAGE;
    }
    // Checar se caiu 10% do ATH após entrada para fechar
    if (price <= athPrice * 0.9) {
      console.log(`Preço caiu 10% do ATH após entrada, fechando posição`);
      await closePosition();
      // Resetar estado
      athPrice = price;
      positionSize = 0;
      entered = false;
      capitalUsed = 0;
    }
    // Se preço subir, atualizar ATH
    if (price > athPrice) {
      athPrice = price;
      console.log(`Atualizando ATH para ${athPrice}`);
    }
  }
}

// Loop para rodar o monitor a cada 15 segundos
setInterval(() => {
  monitor().catch(console.error);
}, 15000);
