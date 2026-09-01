// Cria uma conta de Mestre e imprime o CÓDIGO DE CONVITE uma única vez.
// Uso:  npm run mint-master -- "Nome/rótulo opcional"
// Honra BRPG_DATA_DIR (mesma pasta de dados que o servidor usa).
import 'dotenv/config';
import { createMaster } from '../src/masters.js';

const label = process.argv.slice(2).join(' ').trim();
const { id, code } = createMaster(label);

console.log('\n  Conta de Mestre criada.');
console.log(`  id: ${id}${label ? `  (${label})` : ''}`);
console.log('\n  CÓDIGO DE CONVITE — copie agora, não aparece de novo:\n');
console.log(`      ${code}\n`);
console.log('  O Mestre entra no painel colando esse código. Guarde-o: sem e-mail,');
console.log('  não há recuperação — se perder, minte outro.\n');
