
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname)));

// Servir o index.html diretamente na raiz
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

let jogadores = [];
let cartas = [];
let turno = 0;
let manilha = 0;
let jogadorDaVez = 0;
let jogoIniciado = false;
let rodada = [null, null];
let placar = [0, 0];
let jogadorMao = 0;
let pedidos = { truco: false, seis: false, nove: false, doze: false };
let pontosRodada = 1;
let cartasJogadas = [];

function embaralharCartas() {
  const todas = [];
  for (let naipe = 0; naipe < 4; naipe++) {
    for (let valor = 1; valor <= 13; valor++) {
      todas.push({ naipe, valor });
    }
  }
  for (let i = todas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todas[i], todas[j]] = [todas[j], todas[i]];
  }
  return todas;
}

io.on("connection", (socket) => {
  if (jogadores.length < 4) {
    jogadores.push(socket);
    socket.emit("esperando", jogadores.length);
    if (jogadores.length === 2 || jogadores.length === 4) {
      iniciarJogo();
    }
  }

  socket.on("jogarCarta", (carta) => {
    const jogadorIndex = jogadores.indexOf(socket);
    if (jogadorIndex !== jogadorDaVez) return;
    cartasJogadas.push({ jogador: jogadorIndex, carta });
    io.emit("cartaJogada", { jogador: jogadorIndex, carta });
    jogadorDaVez = (jogadorDaVez + 1) % jogadores.length;
    io.emit("vezDoJogador", jogadorDaVez);
  });

  socket.on("disconnect", () => {
    jogadores = jogadores.filter((j) => j !== socket);
    io.emit("jogadorDesconectou");
    jogoIniciado = false;
  });
});

function iniciarJogo() {
  cartas = embaralharCartas();
  manilha = Math.floor(Math.random() * 4);
  jogadores.forEach((jogador, i) => {
    const mao = cartas.slice(i * 3, i * 3 + 3);
    jogador.emit("inicioJogo", { mao, jogador: i, manilha });
  });
  jogoIniciado = true;
  jogadorDaVez = 0;
  io.emit("vezDoJogador", jogadorDaVez);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
