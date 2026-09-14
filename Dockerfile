# Imagem de produção do BRPG (Mesa do Mestre). Serve pra qualquer host que roda um
# processo persistente com WebSocket + volume de disco: Render, Railway, Fly.io, um VPS.
FROM node:20-slim

# python3: o yt-dlp (empacotado pelo youtube-dl-exec) é um zipapp Python e precisa dele
#          em runtime pra importar áudio do YouTube.
# ca-certificates: HTTPS pras APIs externas (IA, Freesound, bestiário SRD).
# O ffmpeg NÃO é instalado aqui — vem pronto do pacote npm ffmpeg-static.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala as dependências primeiro (camada cacheável). O postinstall baixa os binários
# do yt-dlp e do ffmpeg — por isso o build precisa de rede (Render/Fly/Railway têm).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código da aplicação
COPY . .

# Produção: NODE_ENV liga cookie seguro + trust proxy (o host termina o TLS à frente).
# Os dados da(s) campanha(s) ficam num volume montado pelo host, apontado por BRPG_DATA_DIR
# (ex.: /data). PORT é definido pelo host em runtime; o app lê process.env.PORT.
ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
