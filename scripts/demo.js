// Sobe o painel com dados de exemplo (data-demo/), sem o bot do Discord — pra
// experimentar a interface sem risco de mexer numa campanha real.
// Uso: npm run demo   (porta 3001 por padrão, pra não brigar com o painel real na 3000)
process.env.BRPG_DATA_DIR = 'data-demo';
process.env.BRPG_DEMO = '1';
process.env.PORT = process.env.PORT || '3001';

await import('../src/index.js');
