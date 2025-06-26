// =================================================================
// BOT.JS - VERSÃO FINAL COM ORDEM LIMITE (MAIS CONFIÁVEL)
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
const MIN_ORDER_QTY_BTC = 0.001;

let entered = false, positionSize = 0, entryPrice = 0, capitalUsado = 0, gatilhoATH = 0, dcaUsado = false;

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
// FUNÇÃO openPosition FINAL COM ORDEM LIMITE E LOG DETALHADO
// ===========================================================
async function openPosition(amountUSDT) {
  const price = await getCurrentPrice();
  if (!price) return null;

  const theoreticalQty = amountUSDT / price;
  const adjustedQty = Math.floor(theoreticalQty / MIN_ORDER_QTY_BTC) * MIN_ORDER_QTY_BTC;
  const finalQty = adjustedQty.toFixed(3);

  console.log(`>> Cálculo de Posição: $${amountUSDT.toFixed(2)} | Qty Teórica: ${theoreticalQty.toFixed(5)} | Qty Ajustada: ${finalQty}`);

  if (parseFloat(finalQty) < MIN_ORDER_QTY_BTC) {
    console.error(`!! ORDEM CANCELADA: Quantidade ajustada (${finalQty}) é menor que o mínimo de ${MIN_ORDER_QTY_BTC} BTC.`);
    return null;
  }
  
  try {
    // MUDANÇA: Usando ordem Limite que age como a Mercado
    // Colocamos um preço limite um pouco ACIMA do preço atual para garantir execução imediata
    const limitPrice = (price * 1.001).toFixed(1); // 0.1% acima do preço atual

    console.log(`>> TENTANDO ABRIR POSIÇÃO LIMITE: Qty: ${finalQty} | Preço Limite: ${limitPrice}`);

    const res = await client.submitOrder({ 
      category: 'linear', 
      symbol: SYMBOL, 
      side: 'Buy', 
      orderType: 'Limit', // <-- MUDANÇA AQUI
      qty: finalQty,
      price: limitPrice, // <-- NOVO PARÂMETRO
      timeInForce: 'ImmediateOrCancel' // Garante que não fique uma ordem "pendurada"
    });

    // MUDANÇA: Logando a resposta completa para depuração
    console.log(">> RESPOSTA COMPLETA DA BYBIT (ABERTURA):", JSON.stringify(res, null, 2));

    if (res.retCode === 0 && res.result.orderId) {
      console.log(">> SUCESSO! Ordem enviada com ID:", res.result.orderId);
      return { qty: parseFloat(finalQty), price };
    } else {
      console.error("ERRO DE NEGÓCIO DA BYBIT (ABERTURA): Ordem não foi aceita.");
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
    const qtyToClose = positionSize.toFixed(5);
    console.log(`>> FECHANDO POSIÇÃO DE ${qtyToClose} BTC...`);
    await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Sell', orderType: 'Market', qty: qtyToClose, reduceOnly: true });
    // O resto do cálculo de lucro está correto, mas vamos simplificar o log
    console.log(`>> ORDEM DE FECHAMENTO ENVIADA.`);
  } catch (error) {
    console.error("ERRO CRÍTICO NA CHAMADA DE FECHAMENTO:", error.message);
  }
}

// ... (A função monitor() permanece a mesma) ...
async function monitor() {
    console.log("-----------------------------------------");
    const price = await getCurrentPrice();
    if (price === null) { console.log("Não foi possível obter o preço."); return; }
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
        console.log(`   - Posição Adotada: Entrada: ${entryPrice}, Tamanho: ${positionSize} BTC, Capital: $${capitalUsado.toFixed(2)}, Gatilho ATH: ${gatilhoATH}`);
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
        console.log("AGUARDANDO 15 SEGUNDOS...");
        await new Promise(resolve => setTimeout(resolve, 15000));
        const saldoDisponivel = await getAvailableBalance();
        const valorNovaEntrada = saldoDisponivel * 0.8;
        const ORDEM_MINIMA_USDT = 5;
        if (valorNovaEntrada < ORDEM_MINIMA_USDT) {
          console.error(`!! REENTRADA CANCELADA: Valor ($${valorNovaEntrada.toFixed(2)}) é menor que o mínimo de $${ORDEM_MINIMA_USDT}.`);
          entered = false; positionSize = 0; entryPrice = 0; capitalUsado = 0; gatilhoATH = 0; dcaUsado = false;
          return;
        }
        await setLeverage();
        const reentradaResult = await openPosition(valorNovaEntrada);
        if (reentradaResult) {
            console.log(">> REENTRADA EXECUTADA. ATUALIZANDO ESTADO...");
            // Uma pequena pausa para a Bybit atualizar a posição
            await new Promise(resolve => setTimeout(resolve, 3000)); 
            // Na próxima execução do monitor, ele vai detectar a nova posição.
            entered = false; positionSize = 0; entryPrice = 0; capitalUsado = 0; gatilhoATH = 0; dcaUsado = false;
        } else {
            console.error("FALHA NA REENTRADA. VOLTANDO AO MODO DE DETECÇÃO MANUAL.");
            entered = false; positionSize = 0; entryPrice = 0; capitalUsado = 0; gatilhoATH = 0; dcaUsado = false;
        }
        return;
      }
      if (!dcaUsado && price <= gatilhoATH * 0.998) {
          console.log(">> CONDIÇÃO DE DCA ATINGIDA! EXECUTANDO...");
          const valorDCA = capitalUsado / 4;
          const dcaResult = await openPosition(valorDCA);
          if (dcaResult) {
              console.log("DCA executado. O bot irá reavaliar a posição no próximo ciclo.");
              // O bot irá detectar o novo tamanho e preço médio automaticamente.
          }
      }
    }
  }
  
console.log("==> BOT GERENCIADOR BYBIT INICIADO <==");
console.log("Aguardando você abrir uma posição manualmente na Bybit...");
setInterval(() => { monitor().catch(err => console.error("ERRO NO CICLO MONITOR:", err)); }, 15000);