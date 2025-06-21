import pkg from 'bybit-api';
const { WebsocketClient, RestClient } = pkg;


const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;

const SYMBOL = 'BTCUSDT';
const LEVERAGE = 2;
const INITIAL_CAPITAL_USDT = 5000;

const client = new RestClient({
  key: API_KEY,
  secret: API_SECRET,
  testnet: false, // true para testnet
});

// Estado
let athPrice = 0;
let positionSize = 0;
let entered = false;
let capitalUsed = 0;

// Obter preço atual
async function getCurrentPrice() {
  const res = await client.getTickers({ category: 'linear', symbol: SYMBOL });
  const price = parseFloat(res.result.list[0].lastPrice);
  return price;
}

// Definir alavancagem
async function setLeverage() {
  await client.setLeverage({
    category: 'linear',
    symbol: SYMBOL,
    buyLeverage: String(LEVERAGE),
    sellLeverage: String(LEVERAGE),
  });
  console.log(`Alavancagem definida em ${LEVERAGE}x`);
}

// Abrir posição
async function openPosition(amountUSDT) {
  const price = await getCurrentPrice();
  const qty = (amountUSDT / price) * LEVERAGE;

  const res = await client.submitOrder({
    category: 'linear',
    symbol: SYMBOL,
    side: 'Buy',
    orderType: 'Market',
    qty: qty.toFixed(3),
    timeInForce: 'GTC',
  });

  console.log('Ordem de compra executada', res);
  return qty;
}

// Fechar posição
async function closePosition() {
  const res = await client.submitOrder({
    category: 'linear',
    symbol: SYMBOL,
    side: 'Sell',
    orderType: 'Market',
    qty: positionSize.toFixed(3),
    timeInForce: 'GTC',
    reduceOnly: true,
  });

  console.log('Posição fechada', res);
}

// Monitoramento
async function monitor() {
  const price = await getCurrentPrice();
  console.log(`Preço atual: ${price}`);

  if (!entered) {
    if (price > athPrice) {
      athPrice = price;
      console.log(`Novo ATH: ${athPrice}`);
    } else if (athPrice > 0 && price <= athPrice * 0.9) {
      const amountToUse = INITIAL_CAPITAL_USDT * 0.8;
      await setLeverage();
      const qty = await openPosition(amountToUse);
      capitalUsed = amountToUse;
      positionSize = qty;
      entered = true;
    }
  } else {
    if (price <= athPrice * 0.8 && capitalUsed < INITIAL_CAPITAL_USDT) {
      const amountToUse = INITIAL_CAPITAL_USDT * 0.2;
      const qty = await openPosition(amountToUse);
      capitalUsed += amountToUse;
      positionSize += qty;
    }

    if (price <= athPrice * 0.9) {
      await closePosition();
      athPrice = price;
      positionSize = 0;
      entered = false;
      capitalUsed = 0;
    }

    if (price > athPrice) {
      athPrice = price;
      console.log(`Atualizando ATH para ${athPrice}`);
    }
  }
}

// Loop a cada 15 segundos
setInterval(() => {
  monitor().catch(console.error);
}, 15000);
