// =================================================================
// BOT.JS VERSÃO 2.1 - GERENCIADOR DE POSIÇÃO MANUAL (COM DCA)
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
  console.log(`>> ABRINDO POSIÇÃO AUTOMÁTICA (DCA/REENTRADA): $${amountUSDT.toFixed(2)} | QTY: ${qty}`);
  await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Buy', orderType: 'Market', qty: qty });
  return { qty: parseFloat(qty), price };
}

async function closePosition() {
  const price = await getCurrentPrice();
  if (!price) return;
  console.log(`>> FECHANDO POSIÇÃO DE ${positionSize.toFixed(3)} BTC...`);
  await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: 'Sell', orderType: 'Market', qty: String(positionSize.toFixed(3)), reduceOnly: true });

  const valorFinal = positionSize * price;
  const lucro = valorFinal - capitalUsado;
  capitalTotal += lucro;
  console.log(`>> FECHOU POSIÇÃO | PREÇO: ${price} | LUCRO: $${lucro.toFixed(2)} | NOVO CAPITAL: $${capitalTotal.toFixed(2)}`);

  // Reset para voltar ao modo de detecção
  entered = false;
  positionSize = 0;
  entryPrice = 0;
  capitalUsado = 0;
  gatilhoATH = 0;
  dcaUsado = false; // Reseta o controle do DCA
}

// =================================================
// LÓGICA PRINCIPAL DO MONITOR
// =================================================
async function monitor() {
  console.log("-----------------------------------------");
  const price = await getCurrentPrice();
  if (price === null) {
      console.log("Não foi possível obter o preço. Aguardando próximo ciclo.");
      return;
  }
  
  // SE NÃO ESTAMOS GERENCIANDO UMA POSIÇÃO...
  if (!entered) {
    console.log(`Preço atual: ${price}. Procurando por posição manual aberta...`);
    const positions = await client.getPositions({ category: 'linear', symbol: SYMBOL });
    
    if (positions.result.list.length > 0 && parseFloat(positions.result.list[0].size) > 0) {
      const myPosition = positions.result.list[0];
      
      console.log(">> POSIÇÃO MANUAL DETECTADA! ASSUMINDO GERENCIAMENTO... <<");
      
      entered = true;
      entryPrice = parseFloat(myPosition.avgPrice);
      positionSize = parseFloat(myPosition.size);
      capitalUsado = entryPrice * positionSize;
      gatilhoATH = entryPrice; // O ATH inicial é o próprio preço de entrada
      dcaUsado = false; // Garante que o DCA está disponível para esta nova posição
      
      console.log(`   - Preço de Entrada: ${entryPrice}`);
      console.log(`   - Tamanho da Posição: ${positionSize} BTC`);
      console.log(`   - Capital Alocado: $${capitalUsado.toFixed(2)}`);
      console.log(`   - Gatilho de ATH inicializado em: ${gatilhoATH}`);
    }
    
  } 
  // SE JÁ ESTAMOS GERENCIANDO UMA POSIÇÃO...
  else {
    console.log(`Gerenciando. Entrada: ${entryPrice} | Atual: ${price} | Gatilho ATH: ${gatilhoATH}`);
    
    // ATUALIZA O ATH DA POSIÇÃO SE O PREÇO SUBIR
    if (price > gatilhoATH) {
      gatilhoATH = price;
      console.log(`*** NOVO GATILHO ATH ATUALIZADO PARA ${gatilhoATH} ***`);
    }

    const lucro = price > entryPrice;

    // Condição de FECHAMENTO: caiu 10% do ATH DA POSIÇÃO e estamos no lucro
    if (lucro && price <= gatilhoATH * 0.9) {
      console.log(`>> CONDIÇÃO DE SAÍDA ATINGIDA! FECHANDO...`);
      await closePosition();
      return;
    }

    // Condição de DCA: caiu 20% do ATH de gatilho e ainda não foi usado
    if (!dcaUsado && price <= gatilhoATH * 0.8) {
        console.log(">> CONDIÇÃO DE DCA ATINGIDA! EXECUTANDO...");
        
        // Assume que o capital inicial (80%) já foi usado. Agora usa os 20% restantes.
        // A lógica de capital precisa ser ajustada para o DCA manual
        // Vamos assumir que o DCA adiciona 25% do capital já em risco.
        const valorDCA = capitalUsado * 0.25; 
        
        const dcaResult = await openPosition(valorDCA);
        if (dcaResult) {
            // Recalcula o preço médio
            const novoCapitalTotal = capitalUsado + valorDCA;
            const novoTamanhoTotal = positionSize + dcaResult.qty;
            entryPrice = novoCapitalTotal / novoTamanhoTotal;
            
            capitalUsado = novoCapitalTotal;
            positionSize = novoTamanhoTotal;
            dcaUsado = true; // Marca o DCA como usado para não repetir
            
            console.log(`>> DCA EXECUTADO. Novo Preço Médio: ${entryPrice.toFixed(2)}, Novo Tamanho: ${positionSize.toFixed(3)}`);
        }
    }
  }
}

// Loop principal
console.log("==> BOT GERENCIADOR BYBIT INICIADO <==");
console.log("Aguardando você abrir uma posição manualmente na Bybit...");
setInterval(() => {
    monitor().catch(err => console.error("ERRO NO CICLO MONITOR:", err));
}, 15000);