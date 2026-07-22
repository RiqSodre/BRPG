// Dados 3D sobre o mapa — usado tanto na tela do Mestre quanto na dos jogadores.
// A física roda de verdade e de forma independente em cada tela (cada uma sorteia seu
// próprio arremesso), mas todas pousam nos valores que o servidor já sorteou via
// bot.rollDice — a notação "NdS@v1,v2,..." força a face final, então o total exibido
// nunca diverge do que o Mestre viu. Biblioteca carregada sob demanda via CDN: este
// projeto não tem bundler, e o @3d-dice/dice-box-threejs publica um .es.js já com o
// Three.js e o Cannon-es embutidos, então um import() dinâmico basta.
const Dice3D = (() => {
  const CDN_JS = 'https://unpkg.com/@3d-dice/dice-box-threejs@0.0.12/dist/dice-box-threejs.es.js';
  const CDN_ASSETS = 'https://unpkg.com/@3d-dice/dice-box-threejs@0.0.12/public/';

  let DiceBoxCtor = null; // o import da CDN é cacheado — só o download é caro, não a instância
  let hideTimer = null;

  // A física é de terceiros e às vezes trava a detecção de "parou de rolar" (a promise
  // de .roll() nunca resolve). Criamos uma instância nova a cada rolagem — mais estável
  // do que reaproveitar — e corremos contra um timeout: o total (já sorteado no servidor)
  // aparece de qualquer jeito, mesmo se a animação 3D travar no meio do tombo.
  async function freshBox(onSettled) {
    if (!DiceBoxCtor) {
      DiceBoxCtor = (await import(CDN_JS)).default;
    }
    document.getElementById('dice-tray-canvas').innerHTML = '';
    const box = new DiceBoxCtor('#dice-tray-canvas', {
      assetPath: CDN_ASSETS,
      sounds: false,
      theme_material: 'glass',
      theme_colorset: 'white',
      onRollComplete: onSettled,
    });
    await box.initialize();
    return box;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmtMod(mod) {
    if (!mod) return '';
    return mod > 0 ? `+${mod}` : `${mod}`;
  }

  // spec: { sides, count, rolls: [..valores já sorteados..], mod, total, roller }
  async function roll(spec) {
    const stage = document.getElementById('dice-tray');
    const result = document.getElementById('dice-tray-result');
    if (!stage) return;
    clearTimeout(hideTimer);
    stage.classList.add('show');
    if (result) result.textContent = '';

    try {
      let settled;
      const settledPromise = new Promise((r) => { settled = r; });
      const box = await freshBox(settled);
      const notation = `${spec.count}d${spec.sides}@${spec.rolls.join(',')}`;
      await Promise.race([box.roll(notation).then(settled), settledPromise, wait(7000)]);
    } catch (e) {
      // Sem WebGL, sem rede ou CDN fora do ar: segue só com o resultado em texto.
      console.warn('Dados 3D indisponíveis, mostrando só o total.', e);
    }

    if (result) {
      const mod = fmtMod(spec.mod);
      result.innerHTML = `<b>${spec.roller || 'Mestre'}</b> rolou ${spec.count}d${spec.sides}${mod}`
        + ` — [${spec.rolls.join(', ')}]${mod ? ` ${mod}` : ''} = <b>${spec.total}</b>`;
    }
    hideTimer = setTimeout(() => stage.classList.remove('show'), 4500);
  }

  return { roll };
})();
