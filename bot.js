// =================================================================
// BOT.JS - VERSÃO FINAL COM AJUSTE DE QUANTIDADE PARA MÚLTIPLOS
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

// ... (variáveis de estado permanecem as mesmas) ...
let entered = false, positionSize = 0, entryPrice = 0, capitalUsado = 0, gatilhoATH = 0, dcaUsado = false;

// ... (funções getCurrentPrice, getAvailableBalance, setLeverage permanecem as mesmas) ...
async function getCurrentPrice() {
  try {
    const response = await client.getTickers({ category: 'linear', symbol: SYMBOL });
    return parseFloat(response.result.list[0].lastPrice);
  } catch (error) { console.error("Erro ao buscar preço:", error.message); return null; }
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
  } catch (error) { console.error("Erro crítico ao buscar saldo da carteira:", error.message); return 0; }
}
async function setLeverage() {
  try {
    console.log(`>> GARANTINDO ALAVANCAGEM DE ${LEVERAGE}x...`);
    await client.setLeverage({ category: 'linear', symbol: SYMBOL, buyLeverage: String(LEVERAGE), sellLeverage: String(LEVERAGE) });
    await client.switchMarginMode({ category: 'linear', symbol: SYMBOL, tradeMode: 'isolated', buyLeverage: String(LEVERAGE), sellLeverage: String(LEVERAGE) });
  } catch(e) { console.log('Alavancagem ou modo de margem já definidos.'); }
}

// ===========================================================
// FUNÇÃO openPosition COM CÁLCULO DE QUANTIDADE CORRIGIDO
// ===========================================================
async function openPosition(amountUSDT) {
  const price = await getCurrentPrice();
  if (!price) return null;

  // Calcula a quantidade teórica
  const theoreticalQty = amountUSDT / price;

  // Arredonda a quantidade PARA BAIXO para o múltiplo mais próximo do mínimo
  // Ex: 0.0019 se torna 0.001. 0.0021 se torna 0.002.
  const adjustedQty = Math.floor(theoreticalQty / MIN_ORDER_QTY_BTC) * MIN_ORDER_QTY_BTC;
  
  // Converte para string com a precisão correta
  const finalQty = adjustedQty.toFixed(3);

  console.log(`>> Cálculo de Posição: $${amountUSDT.toFixed(2)} | Qty Teórica: ${theoreticalQty.toFixed(5)} | Qty Ajustada: ${finalQty}`);

  if (parseFloat(finalQty) < MIN_ORDER_QTY_BTC) {
    console.error(`!! ORDEM CANCELADA: Quantidade ajustada (${finalQty}) é menor que o mínimo de ${MIN_ORDER_QTY_BTC} BTC.`);
    return null;
  }
  
  try {
    const res = await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Buy', orderType: 'Market', qty: finalQty });
    if (res.retCode === 0) {
      console.log(">> SUCESSO! Ordem de abertura enviada.");
      return { qty: parseFloat(finalQty), price };
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
  const price = await getCurrentPrice();
  if (!price) return;
  try {
    // Para fechar, a quantidade pode ser mais precisa
    const qtyToClose = positionSize.toFixed(5);
    console.log(`>> FECHANDO POSIÇÃO DE ${qtyToClose} BTC...`);
    const res = await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Sell', orderType: 'Market', qty: qtyToClose, reduceOnly: true });
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

// ... (A função monitor() permanece exatamente a mesma) ...
async function monitor() {
  console.log("-----------------------------------------");
  const price = await getCurrentPrice();
  if (price === null) { console.log("Não foi possível obter o preço. Aguardando próximo ciclo."); return; }
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
    if (price <= gatilhoATH * 0.999) { // GATILHO DE TESTE
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
    if (!dcaUsado && price <= gatilhoATH * 0.998) { // GATILHO DE TESTE DCA
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
setInterval(() => { monitor().catch(err => console.error("ERRO NO CICLO MONITOR:", err)); }, 15000);