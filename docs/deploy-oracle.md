# Hospedar o BRPG de graça na Oracle Cloud (Always Free)

Uma VM "Always Free" da Oracle fica ligada 24/7 sem custo, com disco persistente —
perfeita pro BRPG. O HTTPS público fica a cargo do **Cloudflare Tunnel**, que é grátis e
evita ter que mexer no firewall da Oracle (o maior ponto de dor da plataforma).

Resumo: VM Ubuntu → Docker → `docker compose up` → Cloudflare Tunnel → mintar o Mestre.

---

## 1. Criar a conta e a VM

1. Crie a conta em <https://www.oracle.com/cloud/free/>. Pede um cartão pra verificação,
   mas os recursos **Always Free** não cobram (fique só nos itens marcados "Always Free").
2. No console: **Compute → Instances → Create instance**.
   - **Image:** Canonical **Ubuntu** 22.04 (ou 24.04).
   - **Shape:** **Ampere (ARM) VM.Standard.A1.Flex** — 1 OCPU / 6 GB já sobra. Se der
     *"out of capacity"*, tente outra Availability Domain, menos OCPUs, ou caia pro
     **VM.Standard.E2.1.Micro** (AMD, 1 GB — funciona, mas apertado em downloads pesados).
   - **SSH keys:** cole a sua chave pública (ou deixe a Oracle gerar e baixe a privada).
3. Depois de criada, anote o **Public IP** da instância.

## 2. Entrar e instalar o Docker

```bash
ssh ubuntu@SEU_IP            # usuário "ubuntu" na imagem Ubuntu

# Docker + plugin do compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

## 3. Baixar o projeto e configurar

```bash
git clone https://github.com/RiqSodre/BRPG.git
cd BRPG
git checkout feat/player-portal        # a branch com todo o código atual

# cria o .env com um SESSION_SECRET aleatório (obrigatório em produção)
printf 'NODE_ENV=production\nBRPG_MULTI=1\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .env
```

(Opcional) para ligar a IA e a busca de sons, acrescente ao `.env`:

```bash
echo 'OPENAI_API_KEY=sk-...'      >> .env   # ou GROQ_API_KEY=... (grátis)
echo 'FREESOUND_API_KEY=...'      >> .env
```

## 4. Subir o app

```bash
docker compose up -d --build
```

Isso builda a imagem e sobe o BRPG escutando em `127.0.0.1:3000` **dentro da VM** (ainda
não acessível de fora — é o túnel do próximo passo que publica com HTTPS). Veja os logs
com `docker compose logs -f`.

## 5. Publicar com HTTPS (Cloudflare Tunnel — grátis)

O túnel sai da VM pra fora, então **não precisa abrir nenhuma porta** no Oracle.

**Teste rápido** (URL temporária aleatória, sem conta):

```bash
# instala o cloudflared (ARM; troque por amd64 se estiver na VM AMD)
curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

cloudflared tunnel --url http://localhost:3000
```

Ele imprime uma URL `https://algo-aleatorio.trycloudflare.com` — já funciona pra testar.

**Permanente** (URL fixa no seu domínio, roda como serviço): precisa de um domínio no
Cloudflare. Resumo:

```bash
cloudflared tunnel login                      # autoriza no navegador
cloudflared tunnel create brpg
cloudflared tunnel route dns brpg mesa.seudominio.com
# cria ~/.cloudflared/config.yml apontando o tunnel pra http://localhost:3000
sudo cloudflared service install               # sobe junto com a VM
```

> Não quer usar Cloudflare? Dá pra expor direto: no `docker-compose.yml` troque
> `127.0.0.1:3000:3000` por `80:3000`, abra a porta **80/443 no Security List do Oracle
> E no firewall da VM** (`sudo iptables`/`ufw` — a imagem Ubuntu da Oracle bloqueia tudo
> por padrão), e ponha um Caddy na frente pro HTTPS automático (precisa de domínio).

## 6. Criar a sua conta de Mestre e entrar

```bash
docker compose exec brpg node scripts/mint-master.js "Seu nome"
```

Copie o **código de convite** (só aparece uma vez), abra a URL HTTPS do túnel e cole o
código pra entrar no painel.

---

## Manutenção

```bash
# atualizar pra última versão do código
cd ~/BRPG && git pull && docker compose up -d --build

# ver logs / reiniciar / parar
docker compose logs -f
docker compose restart
docker compose down
```

Os dados (campanhas, `masters.json`, uploads, sessões) ficam no volume `brpg-data` e
sobrevivem a `git pull`, rebuilds e reinícios da VM. Pra fazer backup, copie o volume:
`docker run --rm -v brpg_brpg-data:/data -v $PWD:/backup alpine tar czf /backup/brpg-backup.tgz -C /data .`
