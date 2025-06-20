import { RestClient } from 'bybit-api';

const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;

const SYMBOL = 'BTCUSDT';
const LEVERAGE = 2;
const INITIAL_CAPITAL_USDT = 5000;

const client = new RestClient({
  key: API_KEY,
  secret: API_SECRET,
  testnet: false,
});

let athPrice = 0;
let positionSize = 0;
let entered = false;
let capitalUsed = 0;

async function getCurrentPrice() {
  const ticker = await client.getTicker({ symbol: SYMBOL });
  return parseFloat(ticker.lastPrice);
}

async function setLeverage() {
  await client.setLeverage({
    symbol: SYMBOL,
    buy_leverage: LEVERAGE,
    sell_leverage: LEVERAGE,
    margin_type: 'Isolated',
  });
}

async function openPosition(amountUSDT) {
  const price = await getCurrentPrice();
  const qty = amountUSDT / price * LEVERAGE;

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

async function closePosition() {
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

async function monitor() {
  const price = await getCurrentPrice();

  if (!entered) {
    if (price > athPrice) {
      athPrice = price;
      console.log(`Novo ATH: ${athPrice}`);
    } else if (athPrice > 0 && price <= athPrice * 0.9) {
      const amountToUse = INITIAL_CAPITAL_USDT * 0.8;
      console.log(`Caiu 10% do ATH (${athPrice}), abrindo posição com $${amountToUse}`);
      await setLeverage();
      await openPosition(amountToUse);
      capitalUsed = amountToUse;
      positionSize = amountToUse / price * LEVERAGE;
      entered = true;
    }
  } else {
    if (price <= athPrice * 0.8 && capitalUsed < INITIAL_CAPITAL_USDT) {
      const amountToUse = INITIAL_CAPITAL_USDT * 0.2;
      console.log(`Caiu 20% do ATH (${athPrice}), DCA com $${amountToUse}`);
      await openPosition(amountToUse);
      capitalUsed += amountToUse;
      positionSize += amountToUse / price * LEVERAGE;
    }
    if (price <= athPrice * 0.9) {
      console.log(`Caiu 10% do ATH após entrada, fechando posição`);
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

setInterval(() => {
  monitor().catch(console.error);
}, 15000);
