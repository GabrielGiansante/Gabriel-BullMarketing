// A LINHA FINAL, CORRETA E BASEADA EM EVIDÊNCIAS
const { RestClientV5 } = require('bybit-api');

const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;

const SYMBOL = 'BTCUSDT';
const LEVERAGE = 2;
let capitalTotal = 5000; // Inicial, será atualizado com lucro

const client = new RestClientV5({
  key: API_KEY,
  secret: API_SECRET,
  testnet: false,
});

let athPrice = 0;
let positionSize = 0;
let entered = false;
let capitalUsado = 0;
let dcaUsado = false;
let entryPrice = 0;
let gatilhoATH = 0;

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
  const qty = (amountUSDT / price) * LEVERAGE;

  const res = await client.placeActiveOrder({
    symbol: SYMBOL,
    side: 'Buy',
    order_type: 'Market',
    qty: qty.toFixed(3),
    time_in_force: 'GoodTillCancel',
    reduce_only: false,
  });

  console.log(`>> ABRIU POSIÇÃO COM: $${amountUSDT.toFixed(2)} | PREÇO: ${price} | QTY: ${qty.toFixed(3)}`);
  return { qty, price };
}

async function closePosition() {
  const price = await getCurrentPrice();
  const res = await client.placeActiveOrder({
    symbol: SYMBOL,
    side: 'Sell',
    order_type: 'Market',
    qty: positionSize.toFixed(3),
    time_in_force: 'GoodTillCancel',
    reduce_only: true,
  });

  const valorFinal = (positionSize / LEVERAGE) * price;
  const lucro = valorFinal - capitalUsado;
  capitalTotal += lucro;
  console.log(`>> FECHOU POSIÇÃO | PREÇO: ${price} | LUCRO: $${lucro.toFixed(2)} | NOVO CAPITAL: $${capitalTotal.toFixed(2)}`);

  // Reset
  entered = false;
  capitalUsado = 0;
  dcaUsado = false;
  positionSize = 0;
  entryPrice = 0;
  gatilhoATH = 0;
}

async function monitor() {
  const price = await getCurrentPrice();

  if (!entered) {
    if (price > athPrice) {
      athPrice = price;
      console.log(`ATH ATUALIZADO PARA ${athPrice}`);
    } else if (athPrice > 0 && price <= athPrice * 0.9) {
      const valorEntrada = capitalTotal * 0.8;
      await setLeverage();
      const { qty, price: precoEntrada } = await openPosition(valorEntrada);

      entered = true;
      capitalUsado = valorEntrada;
      positionSize = qty;
      entryPrice = precoEntrada;
      gatilhoATH = athPrice;

      console.log(`>> ENTRADA COM 80% EM ${precoEntrada} (ATH: ${gatilhoATH})`);
    }
  } else {
    const lucro = price > entryPrice;

    // Condição de FECHAMENTO: caiu 10% do ATH DA POSIÇÃO e estamos no lucro
    if (lucro && price <= gatilhoATH * 0.9) {
      console.log(`>> PREÇO CAIU 10% DO ATH (${gatilhoATH}) COM LUCRO. FECHANDO E REENTRANDO.`);
      await closePosition();

      // Nova entrada com 80% + lucro (capitalTotal já está atualizado)
      const valorNovaEntrada = capitalTotal * 0.8;
      await setLeverage();
      const { qty, price: precoReentrada } = await openPosition(valorNovaEntrada);

      entered = true;
      capitalUsado = valorNovaEntrada;
      positionSize = qty;
      entryPrice = precoReentrada;
      gatilhoATH = price > athPrice ? price : athPrice;
      athPrice = gatilhoATH;
      dcaUsado = false;

      console.log(`>> REENTROU COM 80% EM ${precoReentrada} (NOVO ATH: ${gatilhoATH})`);
    }

    // Condição de DCA: caiu 20% do ATH de gatilho
    if (!dcaUsado && price <= gatilhoATH * 0.8) {
      const valorDCA = capitalTotal * 0.2;
      const { qty } = await openPosition(valorDCA);

      capitalUsado += valorDCA;
      positionSize += qty;
      dcaUsado = true;

      console.log(`>> DCA ATIVADO COM 20% EM ${price}`);
    }

    // Atualiza ATH se subir
    if (price > athPrice) {
      athPrice = price;
      console.log(`ATH ATUALIZADO PARA ${athPrice}`);
    }
  }
}

setInterval(() => {
  monitor().catch(console.error);
}, 15000);
