// =================================================================
// BOT.JS - VERSÃO FINAL COM CORREÇÃO DE PRECISÃO DA ORDEM
// =================================================================

const { RestClientV5 } = require('bybit-api');
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;

const client = new RestClientV5({
  key: API_KEY,
  secret: API_SECRET,
  testnet: false,
});

const SYMBOL = 'BTCUSDT';
const LEVERAGE = 2;
const MIN_ORDER_QTY_BTC = 0.001; // Mínimo de compra para BTCUSDT na Bybit

// Nossas variáveis de estado
let entered = false;
let positionSize = 0;
let entryPrice = 0;
let capitalUsado = 0;
let gatilhoATH = 0;
let dcaUsado = false;

// FUNÇÕES DE AÇÃO
async function getCurrentPrice() {
  try {
    const response = await client.getTickers({ category: 'linear', symbol: SYMBOL });
    return parseFloat(response.result.list[0].lastPrice);
  } catch (error) {
    console.error("Erro ao buscar preço:", error.message);
    return null;
  }
}

async function getAvailableBalance() {
  try {
    const response = await client.getWalletBalance({ accountType: 'UNIFIED' });
    if (response.retCode === 0 && response.result.list && response.result.list.length > 0) {
      const unifiedAccount = response.result.list[0];
      const usdtBalance = unifiedAccount.coin.find(c => c.coin === 'USDT');
      if (usdtBalance && usdtBalance.equity) {
        const balance = parseFloat(usdtBalance.equity);
        console.log(`>> SALDO DISPONÍVEL (Equity) DETECTADO: $${balance.toFixed(2)}`);
        return balance;
      }
    }
    console.error("Não foi possível encontrar o 'equity' de USDT na resposta da API:", JSON.stringify(response));
    return 0;
  } catch (error) {
    console.error("Erro crítico ao buscar saldo da carteira:", error.message);
    return 0;
  }
}

async function setLeverage() {
  try {
    console.log(`>> GARANTINDO ALAVANCAGEM DE ${LEVERAGE}x...`);
    await client.setLeverage({ category: 'linear', symbol: SYMBOL, buyLeverage: String(LEVERAGE), sellLeverage: String(LEVERAGE) });
    await client.switchMarginMode({ category: 'linear', symbol: SYMBOL, tradeMode: 'isolated', buyLeverage: String(LEVERAGE), sellLeverage: String(LEVERAGE) });
  } catch(e) { console.log('Alavancagem ou modo de margem já definidos.'); }
}

// ===========================================================
// FUNÇÃO openPosition CORRIGIDA COM PRECISÃO E VALIDAÇÃO
// ===========================================================
async function openPosition(amountUSDT) {
  const price = await getCurrentPrice();
  if (!price) return null;

  // MUDANÇA 1: Aumenta a precisão para 5 casas decimais
  let qty = (amountUSDT / price).toFixed(5);
  console.log(`>> Cálculo inicial - Tentando abrir posição: $${amountUSDT.toFixed(2)} | Qty: ${qty}`);

  // MUDANÇA 2: Verifica se a quantidade é maior que o mínimo permitido
  if (parseFloat(qty) < MIN_ORDER_QTY_BTC) {
    console.error(`!! ORDEM CANCELADA: Quantidade calculada (${qty}) é menor que o mínimo de ${MIN_ORDER_QTY_BTC} BTC.`);
    return null; // Cancela a abertura da posição
  }

  // A Bybit espera uma string para a quantidade
  qty = String(qty);

  try {
    const res = await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Buy', orderType: 'Market', qty: qty });
    if (res.retCode === 0) {
      console.log(">> SUCESSO! Ordem de abertura enviada.");
      return { qty: parseFloat(qty), price };
    } else {
      console.error("ERRO DE NEGÓCIO DA BYBIT (ABERTURA):", JSON.stringify(res));
      return null;
    }
  } catch (error) {
    console.error("ERRO CRÍTICO NA CHAMADA DE ABERTURA:", error.message);
    return null;
  }
}

async function closePosition() {
  // ... (código de closePosition permanece o mesmo)
  const price = await getCurrentPrice();
  if (!price) return;
  try {
    console.log(`>> FECHANDO POSIÇÃO DE ${positionSize.toFixed(3)} BTC...`);
    const res = await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Sell', orderType: 'Market', qty: String(positionSize.toFixed(5)), reduceOnly: true });
    if (res.retCode === 0) {
        const valorFinal = positionSize * price;
        const lucro = valorFinal - capitalUsado;
        console.log(`>> FECHOU POSIÇÃO | PREÇO: ${price} | LUCRO: $${lucro.toFixed(2)}`);
    } else {
        console.error("ERRO DE NEGÓCIO DA BYBIT (FECHAMENTO):", JSON.stringify(res));
    }
  } catch (error) {
    console.error("ERRO CRÍTICO NA CHAMADA DE FECHAMENTO:", error.message);
  }
}

// LÓGICA PRINCIPAL DO MONITOR
async function monitor() {
  // ... (código do monitor permanece o mesmo)
  console.log("-----------------------------------------");
  const price = await getCurrentPrice();
  if (price === null) {
      console.log("Não foi possível obter o preço. Aguardando próximo ciclo.");
      return;
  }

  if (!entered) {
    console.log(`Preço atual: ${price}. Procurando por posição manual aberta...`);
    const positions = await client.getPositionInfo({ category: 'linear', symbol: SYMBOL });
    if (positions.result.list.length > 0 && parseFloat(positions.result.list[0].size) > 0) {
      const myPosition = positions.result.list[0];
      console.log(">> POSIÇÃO MANUAL DETECTADA! ASSUMINDO GERENCIAMENTO... <<");
      entered = true;
      entryPrice = parseFloat(myPosition.avgPrice);
      positionSize = parseFloat(myPosition.size);
      capitalUsado = entryPrice * positionSize;
      gatilhoATH = entryPrice;
      dcaUsado = false;
      console.log(`   - Preço de Entrada: ${entryPrice}, Tamanho: ${positionSize} BTC, Capital Alocado: $${capitalUsado.toFixed(2)}, Gatilho ATH: ${gatilhoATH}`);
    }
  } else {
    console.log(`Gerenciando. Entrada: ${entryPrice} | Atual: ${price} | Gatilho ATH: ${gatilhoATH}`);
    if (price > gatilhoATH) {
      gatilhoATH = price;
      console.log(`*** NOVO GATILHO ATH ATUALIZADO PARA ${gatilhoATH} ***`);
    }

    if (price <= gatilhoATH * 0.999) {
      console.log(`>> CONDIÇÃO DE SAÍDA ATINGIDA! FECHANDO E PREPARANDO PARA REENTRADA...`);
      await closePosition();
      console.log("AGUARDANDO 15 SEGUNDOS PARA ATUALIZAÇÃO DE SALDO...");
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      const saldoDisponivel = await getAvailableBalance();
      const valorNovaEntrada = saldoDisponivel * 0.8;
      
      const ORDEM_MINIMA_USDT = 5;
      if (valorNovaEntrada < ORDEM_MINIMA_USDT) {
        console.error(`!! REENTRADA CANCELADA: Valor calculado ($${valorNovaEntrada.toFixed(2)}) é menor que o mínimo de $${ORDEM_MINIMA_USDT}.`);
        entered = false; positionSize = 0; entryPrice = 0; capitalUsado = 0; gatilhoATH = 0; dcaUsado = false;
        return;
      }
      
      await setLeverage();
      const reentradaResult = await openPosition(valorNovaEntrada);

      if (reentradaResult) {
          console.log(">> REENTRADA EXECUTADA COM SUCESSO. ATUALIZANDO ESTADO...");
          entryPrice = reentradaResult.price;
          positionSize = reentradaResult.qty;
          capitalUsado = entryPrice * positionSize;
          gatilhoATH = entryPrice;
          dcaUsado = false;
      } else {
          console.error("FALHA NA REENTRADA. VOLTANDO AO MODO DE DETECÇÃO MANUAL.");
          entered = false; positionSize = 0; entryPrice = 0; capitalUsado = 0; gatilhoATH = 0; dcaUsado = false;
      }
      return;
    }

    if (!dcaUsado && price <= gatilhoATH * 0.998) {
        console.log(">> CONDIÇÃO DE DCA DE TESTE ATINGIDA! EXECUTANDO...");
        const valorDCA = capitalUsado / 4;
        const dcaResult = await openPosition(valorDCA);
        if (dcaResult) {
            const capitalAntigo = capitalUsado;
            const tamanhoAntigo = positionSize;
            capitalUsado += valorDCA;
            positionSize += dcaResult.qty;
            entryPrice = ((tamanhoAntigo * entryPrice) + (dcaResult.qty * dcaResult.price)) / positionSize;
            dcaUsado = true;
            console.log(`>> DCA EXECUTADO. Novo Preço Médio: ${entryPrice.toFixed(2)}, Novo Tamanho: ${positionSize.toFixed(3)}`);
        }
    }
  }
}

console.log("==> BOT GERENCIADOR BYBIT INICIADO <==");
console.log("Aguardando você abrir uma posição manualmente na Bybit...");
setInterval(() => {
    monitor().catch(err => console.error("ERRO NO CICLO MONITOR:", err));
}, 15000);