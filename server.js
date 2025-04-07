// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://truco-5zs8.vercel.app/", // Aceita todas as origens durante o desenvolvimento/teste
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname)));

const rooms = {};
const naipes = ["♦", "♣", "♥", "♠"];
const valores = ["4", "5", "6", "7", "Q", "J", "K", "A", "2", "3"];

// Valores das cartas para comparação
const valorCartas = {
  "4": 1, "5": 2, "6": 3, "7": 4, "Q": 5,
  "J": 6, "K": 7, "A": 8, "2": 9, "3": 10
};

// Valor das manilhas em ordem crescente (♦, ♣, ♥, ♠)
const valorManilhas = {
  "♦": 1, "♣": 2, "♥": 3, "♠": 4
};

function criarBaralho() {
  const baralho = [];
  for (const valor of valores) {
    for (const naipe of naipes) {
      baralho.push(`${valor}${naipe}`);
    }
  }
  return baralho;
}

function embaralhar(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function definirManilha(vira) {
  const valorVira = vira.slice(0, -1);
  const index = valores.indexOf(valorVira);
  return index === valores.length - 1 ? valores[0] : valores[index + 1];
}

function valorCarta(carta, manilhaValor) {
  const valor = carta.slice(0, -1);
  const naipe = carta.slice(-1);
  if (valor === manilhaValor) {
    return 100 + valorManilhas[naipe];
  }
  return valorCartas[valor];
}

function compararCartas(carta1, carta2, manilhaValor) {
  return valorCarta(carta1, manilhaValor) - valorCarta(carta2, manilhaValor);
}

function determinarVencedor(cartas, manilhaValor) {
  let maiorCarta = cartas[0].carta;
  let vencedorIndex = 0;
  for (let i = 1; i < cartas.length; i++) {
    if (compararCartas(cartas[i].carta, maiorCarta, manilhaValor) > 0) {
      maiorCarta = cartas[i].carta;
      vencedorIndex = i;
    }
  }
  return cartas[vencedorIndex].jogadorId;
}

function proximoJogador(sala, jogadorAtual) {
  const jogadores = sala.jogadores;
  const index = jogadores.findIndex(p => p.id === jogadorAtual);
  return jogadores[(index + 1) % jogadores.length].id;
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ playerName, roomId }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        jogadores: [],
        estado: "esperando",
        equipes: [
          { jogadores: [], pontos: 0, pontosRodada: 0 },
          { jogadores: [], pontos: 0, pontosRodada: 0 }
        ],
        turno: null,
        cartasJogadas: [],
        valorRodada: 1,
        ultimoAumento: null,
        manilha: null,
        vira: null,
        maoAtual: 1,
        rodadaAtual: 1
      };
    }
    const sala = rooms[roomId];
    if (sala.jogadores.length >= 4) {
      socket.emit("roomFull");
      return;
    }
    socket.join(roomId);
    const equipeIndex = sala.jogadores.length % 2;
    sala.jogadores.push({
      id: socket.id,
      name: playerName,
      equipe: equipeIndex,
      cartas: []
    });
    sala.equipes[equipeIndex].jogadores.push(socket.id);
    io.to(roomId).emit("updatePlayers", {
      jogadores: sala.jogadores,
      equipes: sala.equipes
    });
    if (sala.jogadores.length === 2 || sala.jogadores.length === 4) {
      io.to(roomId).emit("enableStartButton");
    }
  });

  socket.on("startGame", (roomId) => {
    const sala = rooms[roomId];
    if (!sala || sala.jogadores.length < 2) return;
    iniciarNovaRodada(roomId);
  });

  function iniciarNovaRodada(roomId) {
    const sala = rooms[roomId];
    sala.cartasJogadas = [];
    sala.valorRodada = 1;
    sala.ultimoAumento = null;
    sala.rodadaAtual = 1;
    sala.equipes[0].pontosRodada = 0;
    sala.equipes[1].pontosRodada = 0;

    const baralho = embaralhar(criarBaralho());
    sala.vira = baralho.pop();
    sala.manilhaValor = definirManilha(sala.vira);
    sala.jogadores.forEach((player) => {
      player.cartas = baralho.splice(0, 3);
      io.to(player.id).emit("yourCards", {
        cards: player.cartas,
        vira: sala.vira,
        manilha: sala.manilhaValor
      });
    });

    sala.turno = sala.jogadores[0].id;
    sala.estado = "jogando";
    io.to(roomId).emit("gameUpdate", {
      estado: sala.estado,
      turno: sala.turno,
      valorRodada: sala.valorRodada,
      vira: sala.vira,
      manilha: sala.manilhaValor,
      maoAtual: sala.maoAtual,
      rodadaAtual: sala.rodadaAtual,
      equipes: sala.equipes
    });
  }

  socket.on("jogarCarta", ({ roomId, carta }) => {
    const sala = rooms[roomId];
    if (!sala || sala.estado !== "jogando" || sala.turno !== socket.id) return;
    const jogador = sala.jogadores.find(p => p.id === socket.id);
    const cartaIndex = jogador.cartas.indexOf(carta);
    if (cartaIndex === -1) return;

    jogador.cartas.splice(cartaIndex, 1);
    sala.cartasJogadas.push({ jogadorId: socket.id, carta });

    io.to(socket.id).emit("yourCards", {
      cards: jogador.cartas,
      vira: sala.vira,
      manilha: sala.manilhaValor
    });

    io.to(roomId).emit("cartaJogada", {
      jogadorId: socket.id,
      carta,
      jogadorNome: jogador.name
    });

    if (sala.cartasJogadas.length === sala.jogadores.length) {
      const vencedorId = determinarVencedor(sala.cartasJogadas, sala.manilhaValor);
      const vencedor = sala.jogadores.find(p => p.id === vencedorId);
      sala.equipes[vencedor.equipe].pontosRodada++;

      io.to(roomId).emit("rodadaFinalizada", {
        vencedorId,
        vencedorNome: vencedor.name,
        pontuacao: [
          sala.equipes[0].pontosRodada,
          sala.equipes[1].pontosRodada
        ]
      });

      const equipesComMaioria = sala.equipes.findIndex(eq => eq.pontosRodada >= 2);
      setTimeout(() => {
        if (equipesComMaioria !== -1) {
          sala.equipes[equipesComMaioria].pontos += sala.valorRodada;
          io.to(roomId).emit("maoFinalizada", {
            equipeVencedora: equipesComMaioria,
            pontos: sala.valorRodada,
            placar: [
              sala.equipes[0].pontos,
              sala.equipes[1].pontos
            ]
          });

          if (sala.equipes[equipesComMaioria].pontos >= 12) {
            io.to(roomId).emit("jogoFinalizado", {
              equipeVencedora: equipesComMaioria,
              placar: [
                sala.equipes[0].pontos,
                sala.equipes[1].pontos
              ]
            });
            sala.estado = "finalizado";
          } else {
            sala.maoAtual++;
            setTimeout(() => iniciarNovaRodada(roomId), 2000);
          }
        } else {
          sala.cartasJogadas = [];
          sala.rodadaAtual++;
          sala.turno = vencedorId;
          io.to(roomId).emit("proximaRodada", {
            turno: sala.turno,
            rodadaAtual: sala.rodadaAtual
          });
        }
      }, 2000);
    } else {
      sala.turno = proximoJogador(sala, socket.id);
      io.to(roomId).emit("proximoTurno", { turno: sala.turno });
    }
  });

  socket.on("pedirTruco", ({ roomId }) => {
    const sala = rooms[roomId];
    if (!sala || sala.estado !== "jogando" || sala.turno !== socket.id) return;
    const jogador = sala.jogadores.find(p => p.id === socket.id);
    const equipeAdversaria = jogador.equipe === 0 ? 1 : 0;

    let proximoValor;
    if (sala.valorRodada === 1) proximoValor = 3;
    else if (sala.valorRodada === 3) proximoValor = 6;
    else if (sala.valorRodada === 6) proximoValor = 9;
    else if (sala.valorRodada === 9) proximoValor = 12;
    else return;

    sala.ultimoAumento = {
      valor: proximoValor,
      equipe: jogador.equipe
    };
    sala.estado = "truco_pendente";

    io.to(roomId).emit("trucoSolicitado", {
      jogadorId: socket.id,
      jogadorNome: jogador.name,
      equipe: jogador.equipe,
      valorProposto: proximoValor
    });
  });

  socket.on("responderTruco", ({ roomId, aceito }) => {
    const sala = rooms[roomId];
    if (!sala || sala.estado !== "truco_pendente") return;
    const jogador = sala.jogadores.find(p => p.id === socket.id);

    if (jogador.equipe === sala.ultimoAumento.equipe) return;

    if (aceito) {
      sala.valorRodada = sala.ultimoAumento.valor;
      sala.estado = "jogando";

      io.to(roomId).emit("trucoAceito", {
        jogadorId: socket.id,
        jogadorNome: jogador.name,
        novoValor: sala.valorRodada
      });
    } else {
      const equipeVencedora = sala.ultimoAumento.equipe;
      sala.equipes[equipeVencedora].pontos += 1;

      io.to(roomId).emit("trucoRecusado", {
        jogadorId: socket.id,
        jogadorNome: jogador.name,
        equipeVencedora,
        placar: [
          sala.equipes[0].pontos,
          sala.equipes[1].pontos
        ]
      });

      if (sala.equipes[equipeVencedora].pontos >= 12) {
        io.to(roomId).emit("jogoFinalizado", {
          equipeVencedora,
          placar: [
            sala.equipes[0].pontos,
            sala.equipes[1].pontos
          ]
        });
        sala.estado = "finalizado";
      } else {
        sala.maoAtual++;
        setTimeout(() => iniciarNovaRodada(roomId), 2000);
      }
    }
  });

  socket.on("enviarMensagem", ({ roomId, mensagem }) => {
    const sala = rooms[roomId];
    if (!sala) return;
    const jogador = sala.jogadores.find(p => p.id === socket.id);
    if (!jogador) return;

    io.to(roomId).emit("novaMensagem", {
      jogadorId: socket.id,
      jogadorNome: jogador.name,
      mensagem
    });
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const sala = rooms[roomId];
      const jogadorIndex = sala.jogadores.findIndex(p => p.id === socket.id);
      if (jogadorIndex !== -1) {
        const equipeDoJogador = sala.jogadores[jogadorIndex].equipe;
        sala.jogadores.splice(jogadorIndex, 1);
        const indexNaEquipe = sala.equipes[equipeDoJogador].jogadores.indexOf(socket.id);
        if (indexNaEquipe !== -1) {
          sala.equipes[equipeDoJogador].jogadores.splice(indexNaEquipe, 1);
        }

        if (sala.jogadores.length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit("jogadorSaiu", {
            jogadorId: socket.id,
            jogadores: sala.jogadores,
            equipes: sala.equipes
          });

          if (sala.estado === "jogando" && sala.jogadores.length < 2) {
            sala.estado = "esperando";
            io.to(roomId).emit("jogoInterrompido", {
              motivo: "Jogadores insuficientes"
            });
          }

          if (sala.estado === "jogando" && sala.turno === socket.id) {
            sala.turno = sala.jogadores[0].id;
            io.to(roomId).emit("proximoTurno", { turno: sala.turno });
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
