// =================================================================
// BOT.JS VERSÃO FINAL E CORRIGIDA
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
const LEVERAGE = 2; // O bot assume que você usou essa alavancagem
let capitalTotal = 5000; // Usado para calcular reentradas e DCA

// Nossas variáveis de estado
let entered = false;
let positionSize = 0;
let entryPrice = 0;
let capitalUsado = 0;
let gatilhoATH = 0;
let dcaUsado = false; // Variável de controle do DCA

// FUNÇÕES DE AÇÃO
async function getCurrentPrice() {
  try {
    const response = await client.getTickers({ category: 'linear', symbol: SYMBOL });
    return parseFloat(response.result.list[0].lastPrice);
  } catch (error) {
    console.error("Erro ao buscar preço na Bybit:", error);
    return null;
  }
}

async function setLeverage() {
  try {
    console.log(`>> GARANTINDO ALAVANCAGEM DE ${LEVERAGE}x...`);
    await client.setLeverage({ category: 'linear', symbol: SYMBOL, buyLeverage: String(LEVERAGE), sellLeverage: String(LEVERAGE) });
    await client.switchMarginMode({ category: 'linear', symbol: SYMBOL, tradeMode: 'isolated', buyLeverage: String(LEVERAGE), sellLeverage: String(LEVERAGE) });
  } catch(e) { console.log('Alavancagem ou modo de margem já definidos.'); }
}

async function openPosition(amountUSDT) {
  const price = await getCurrentPrice();
  if (!price) return null;
  const qty = (amountUSDT / price).toFixed(3);
  console.log(`>> TENTANDO ABRIR POSIÇÃO: $${amountUSDT.toFixed(2)} | QTY: ${qty}`);
  try {
    const res = await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Buy', orderType: 'Market', qty: qty });
    if (res.retCode === 0) {
      console.log(">> SUCESSO! RESPOSTA DA BYBIT (ABERTURA):", JSON.stringify(res.result));
      return { qty: parseFloat(qty), price };
    } else {
      console.error("ERRO DE NEGÓCIO DA BYBIT (ABERTURA):", JSON.stringify(res));
      return null;
    }
  } catch (error) {
    console.error("ERRO CRÍTICO NA CHAMADA DE ABERTURA:", error);
    return null;
  }
}

// VERSÃO CORRIGIDA DE closePosition (SEM O RESET)
async function closePosition() {
  const price = await getCurrentPrice();
  if (!price) return;
  try {
    console.log(`>> FECHANDO POSIÇÃO DE ${positionSize.toFixed(3)} BTC...`);
    const res = await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Sell', orderType: 'Market', qty: String(positionSize.toFixed(3)), reduceOnly: true });
    if (res.retCode === 0) {
        const valorFinal = positionSize * price;
        const lucro = valorFinal - capitalUsado;
        capitalTotal += lucro;
        console.log(`>> FECHOU POSIÇÃO | PREÇO: ${price} | LUCRO: $${lucro.toFixed(2)} | NOVO CAPITAL: $${capitalTotal.toFixed(2)}`);
    } else {
        console.error("ERRO DE NEGÓCIO DA BYBIT (FECHAMENTO):", JSON.stringify(res));
    }
  } catch (error) {
    console.error("ERRO CRÍTICO NA CHAMADA DE FECHAMENTO:", error);
  }
}

// LÓGICA PRINCIPAL DO MONITOR (COM O BLOCO DE REENTRADA CORRIGIDO)
async function monitor() {
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

    const lucro = price > entryPrice;

    // BLOCO DE FECHAMENTO E REENTRADA CORRIGIDO
    if (lucro && price <= gatilhoATH * 0.9) { // GATILHO ORIGINAL DE 10%
      console.log(`>> CONDIÇÃO DE SAÍDA ATINGIDA! FECHANDO E PREPARANDO PARA REENTRADA...`);
      await closePosition();
      console.log("AGUARDANDO 15 SEGUNDOS PARA ATUALIZAÇÃO DE SALDO...");
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      const valorNovaEntrada = capitalTotal * 0.8;
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
          entered = false;
          positionSize = 0;
          entryPrice = 0;
          capitalUsado = 0;
          gatilhoATH = 0;
          dcaUsado = false;
      }
      return;
    }

    // LÓGICA DE DCA ORIGINAL (com cálculo de preço médio corrigido)
    if (!dcaUsado && price <= gatilhoATH * 0.8) { // GATILHO ORIGINAL DE 20%
        console.log(">> CONDIÇÃO DE DCA ATINGIDA! EXECUTANDO...");
        const valorDCA = capitalUsado / 4; // Usa 25% do capital já em risco (80% / 4 = 20%)
        const dcaResult = await openPosition(valorDCA);
        if (dcaResult) {
            const capitalAntigo = capitalUsado;
            const tamanhoAntigo = positionSize;
            capitalUsado += valorDCA;
            positionSize += dcaResult.qty;
            // Cálculo correto do preço médio ponderado
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