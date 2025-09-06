const http = require('http')
const express = require('express')
const { Server } = require('socket.io')
const path = require('path')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})

// Configuração para servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')))

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Rota de status do servidor
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    playersOnline: Object.keys(players).length,
    uptime: process.uptime(),
    gameStarted: gameState.gameStarted
  })
})

// Armazenar jogadores conectados e estado do jogo
const players = {}
const gameState = {
  players: {},
  gameStarted: false,
  gameRoom: 'main',
  maxPlayers: 20,
  gameSettings: {
    playerSpeed: 6,
    playerSize: 22,
    mapWidth: 1200,
    mapHeight: 800
  }
}

// Sistema de salas (rooms)
const rooms = {
  main: {
    players: {},
    gameStarted: false,
    maxPlayers: 20
  }
}

// Cores disponíveis para novos jogadores
const playerColors = [
  '#2196F3', '#FF5722', '#4CAF50', '#9C27B0', '#FF9800',
  '#F44336', '#3F51B5', '#009688', '#795548', '#607D8B',
  '#E91E63', '#CDDC39', '#FFC107', '#00BCD4', '#8BC34A'
]

// Configuração do Socket.IO
io.on('connection', (socket) => {
  console.log(`🔌 Nova conexão: ${socket.id} [${new Date().toLocaleTimeString()}]`)
  
  // Estatísticas de conexão
  socket.emit('serverInfo', {
    playersOnline: Object.keys(players).length,
    maxPlayers: gameState.maxPlayers,
    serverTime: new Date(),
    gameSettings: gameState.gameSettings
  })
  
  // Quando jogador entra no jogo
  socket.on('playerJoin', (playerData) => {
    try {
      // Validar dados do jogador
      if (!playerData.name || playerData.name.trim() === '') {
        playerData.name = `Player_${socket.id.substring(0, 6)}`
      }
      
      // Limitar tamanho do nome
      playerData.name = playerData.name.trim().substring(0, 20)
      
      // Verificar limite de jogadores
      if (Object.keys(players).length >= gameState.maxPlayers) {
        socket.emit('serverError', { message: 'Servidor lotado! Tente novamente mais tarde.' })
        return
      }
      
      // Criar jogador
      players[socket.id] = {
        id: socket.id,
        name: playerData.name,
        x: Math.random() * (gameState.gameSettings.mapWidth - 100) + 50,
        y: Math.random() * (gameState.gameSettings.mapHeight - 100) + 50,
        score: 0,
        color: playerData.color || playerColors[Object.keys(players).length % playerColors.length],
        room: 'main',
        joinTime: new Date(),
        lastActivity: new Date(),
        isAlive: true,
        health: 100,
        level: 1,
        ...playerData
      }
      
      gameState.players[socket.id] = players[socket.id]
      
      // Adicionar à sala
      socket.join('main')
      
      // Enviar estado atual do jogo para o novo jogador
      socket.emit('gameState', {
        ...gameState,
        yourId: socket.id
      })
      
      // Notificar outros jogadores sobre o novo jogador
      socket.to('main').emit('playerJoined', players[socket.id])
      
      // Notificar todos sobre atualização de contadores
      io.to('main').emit('playersCountUpdate', Object.keys(players).length)
      
      console.log(`👤 ${players[socket.id].name} entrou no jogo [Total: ${Object.keys(players).length}]`)
      
      // Mensagem de boas-vindas no chat
      io.to('main').emit('chatMessage', {
        type: 'system',
        playerId: 'system',
        playerName: 'Sistema',
        message: `${players[socket.id].name} entrou no jogo!`,
        timestamp: new Date(),
        color: '#4CAF50'
      })
      
    } catch (error) {
      console.error('❌ Erro ao adicionar jogador:', error)
      socket.emit('serverError', { message: 'Erro interno do servidor.' })
    }
  })
  
  // Quando jogador se move
  socket.on('playerMove', (moveData) => {
    try {
      if (!players[socket.id] || !players[socket.id].isAlive) return
      
      // Validar movimento
      const newX = parseFloat(moveData.x)
      const newY = parseFloat(moveData.y)
      
      if (isNaN(newX) || isNaN(newY)) return
      
      // Limites do mapa
      const minX = gameState.gameSettings.playerSize
      const maxX = gameState.gameSettings.mapWidth - gameState.gameSettings.playerSize
      const minY = gameState.gameSettings.playerSize
      const maxY = gameState.gameSettings.mapHeight - gameState.gameSettings.playerSize
      
      // Aplicar limites
      players[socket.id].x = Math.max(minX, Math.min(maxX, newX))
      players[socket.id].y = Math.max(minY, Math.min(maxY, newY))
      players[socket.id].lastActivity = new Date()
      
      // Atualizar estado do jogo
      gameState.players[socket.id] = players[socket.id]
      
      // Enviar posição atualizada para outros jogadores na mesma sala
      socket.to('main').emit('playerMoved', {
        id: socket.id,
        x: players[socket.id].x,
        y: players[socket.id].y,
        timestamp: new Date()
      })
      
    } catch (error) {
      console.error('❌ Erro no movimento do jogador:', error)
    }
  })
  
  // Quando jogador envia mensagem no chat
  socket.on('chatMessage', (message) => {
    try {
      if (!players[socket.id] || !message) return
      
      // Limpar e validar mensagem
      const cleanMessage = message.toString().trim().substring(0, 200)
      if (cleanMessage === '') return
      
      // Verificar spam (máximo 5 mensagens por minuto)
      if (!players[socket.id].chatHistory) {
        players[socket.id].chatHistory = []
      }
      
      const now = new Date()
      players[socket.id].chatHistory = players[socket.id].chatHistory.filter(
        time => now - time < 60000 // Últimos 60 segundos
      )
      
      if (players[socket.id].chatHistory.length >= 5) {
        socket.emit('chatError', { message: 'Muitas mensagens! Aguarde um pouco.' })
        return
      }
      
      players[socket.id].chatHistory.push(now)
      players[socket.id].lastActivity = now
      
      const chatData = {
        type: 'player',
        playerId: socket.id,
        playerName: players[socket.id].name,
        message: cleanMessage,
        timestamp: now,
        color: players[socket.id].color
      }
      
      // Enviar mensagem para todos na sala
      io.to('main').emit('chatMessage', chatData)
      console.log(`💬 ${players[socket.id].name}: ${cleanMessage}`)
      
    } catch (error) {
      console.error('❌ Erro no chat:', error)
    }
  })
  
  // Quando jogador atualiza seu score
  socket.on('updateScore', (scoreData) => {
    try {
      if (!players[socket.id]) return
      
      const newScore = parseInt(scoreData.score) || 0
      players[socket.id].score = Math.max(0, newScore)
      players[socket.id].lastActivity = new Date()
      
      gameState.players[socket.id] = players[socket.id]
      
      // Enviar score atualizado para todos
      io.to('main').emit('scoreUpdate', {
        playerId: socket.id,
        playerName: players[socket.id].name,
        score: players[socket.id].score,
        level: Math.floor(players[socket.id].score / 100) + 1
      })
      
      console.log(`🎯 ${players[socket.id].name} score: ${players[socket.id].score}`)
      
    } catch (error) {
      console.error('❌ Erro na atualização de score:', error)
    }
  })
  
  // Iniciar jogo (apenas se não estiver iniciado)
  socket.on('startGame', () => {
    try {
      if (!gameState.gameStarted) {
        gameState.gameStarted = true
        
        io.to('main').emit('gameStarted', {
          startTime: new Date(),
          initiatedBy: players[socket.id]?.name || 'Jogador'
        })
        
        console.log(`🎮 Jogo iniciado por: ${players[socket.id]?.name || socket.id}`)
        
        // Mensagem no chat
        io.to('main').emit('chatMessage', {
          type: 'system',
          playerId: 'system',
          playerName: 'Sistema',
          message: `Jogo iniciado por ${players[socket.id]?.name || 'Jogador'}!`,
          timestamp: new Date(),
          color: '#FF9800'
        })
      }
    } catch (error) {
      console.error('❌ Erro ao iniciar jogo:', error)
    }
  })
  
  // Resetar jogo
  socket.on('resetGame', () => {
    try {
      gameState.gameStarted = false
      
      // Resetar scores de todos os jogadores
      Object.keys(players).forEach(playerId => {
        if (players[playerId]) {
          players[playerId].score = 0
          players[playerId].level = 1
          players[playerId].health = 100
          gameState.players[playerId] = players[playerId]
        }
      })
      
      io.to('main').emit('gameReset', {
        gameState: gameState,
        resetBy: players[socket.id]?.name || 'Jogador',
        resetTime: new Date()
      })
      
      console.log(`🔄 Jogo resetado por: ${players[socket.id]?.name || socket.id}`)
      
      // Mensagem no chat
      io.to('main').emit('chatMessage', {
        type: 'system',
        playerId: 'system',
        playerName: 'Sistema',
        message: `Jogo resetado por ${players[socket.id]?.name || 'Jogador'}!`,
        timestamp: new Date(),
        color: '#F44336'
      })
      
    } catch (error) {
      console.error('❌ Erro ao resetar jogo:', error)
    }
  })
  
  // Ping/Pong para verificar conexão
  socket.on('ping', (callback) => {
    if (players[socket.id]) {
      players[socket.id].lastActivity = new Date()
    }
    if (typeof callback === 'function') {
      callback({ serverTime: new Date() })
    }
  })
  
  // Comando de admin (exemplo)
  socket.on('adminCommand', (command) => {
    // Implementar sistema de admin se necessário
    console.log(`🔧 Comando admin de ${socket.id}: ${command}`)
  })
  
  // Quando jogador desconecta
  socket.on('disconnect', (reason) => {
    try {
      if (players[socket.id]) {
        const playerName = players[socket.id].name
        
        console.log(`👋 ${playerName} desconectou (${reason}) [Total: ${Object.keys(players).length - 1}]`)
        
        // Remover jogador dos objetos
        delete players[socket.id]
        delete gameState.players[socket.id]
        
        // Sair da sala
        socket.leave('main')
        
        // Notificar outros jogadores
        socket.to('main').emit('playerLeft', {
          playerId: socket.id,
          playerName: playerName,
          reason: reason,
          timestamp: new Date()
        })
        
        // Atualizar contador de jogadores
        io.to('main').emit('playersCountUpdate', Object.keys(players).length)
        
        // Mensagem no chat
        io.to('main').emit('chatMessage', {
          type: 'system',
          playerId: 'system',
          playerName: 'Sistema',
          message: `${playerName} saiu do jogo`,
          timestamp: new Date(),
          color: '#FF5722'
        })
        
        // Se não há mais jogadores, resetar jogo
        if (Object.keys(players).length === 0) {
          gameState.gameStarted = false
          console.log('🔄 Jogo resetado automaticamente (sem jogadores)')
        }
      }
    } catch (error) {
      console.error('❌ Erro na desconexão:', error)
    }
  })
  
  // Lidar com erros do socket
  socket.on('error', (error) => {
    console.error('🚨 Erro no socket:', error)
    socket.emit('serverError', { message: 'Erro de conexão. Tente reconectar.' })
  })
  
  // Evento de conexão perdida
  socket.on('connect_error', (error) => {
    console.error('🚨 Erro de conexão:', error)
  })
})

// Função para broadcast do estado do jogo a cada intervalo
const gameLoopInterval = setInterval(() => {
  try {
    const playersCount = Object.keys(players).length
    
    if (playersCount > 0) {
      // Enviar estado completo do jogo menos frequentemente
      io.to('main').emit('gameStateUpdate', {
        players: gameState.players,
        gameStarted: gameState.gameStarted,
        playersCount: playersCount,
        serverTime: new Date()
      })
    }
  } catch (error) {
    console.error('❌ Erro no game loop:', error)
  }
}, 1000/30) // 30 FPS para economizar banda

// Limpeza de jogadores inativos (a cada 5 minutos)
const cleanupInterval = setInterval(() => {
  try {
    const now = new Date()
    const timeoutMs = 5 * 60 * 1000 // 5 minutos
    
    Object.keys(players).forEach(playerId => {
      if (players[playerId] && players[playerId].lastActivity) {
        const inactiveTime = now - players[playerId].lastActivity
        
        if (inactiveTime > timeoutMs) {
          console.log(`🧹 Removendo jogador inativo: ${players[playerId].name}`)
          
          // Emitir evento de desconexão
          io.to('main').emit('playerLeft', {
            playerId: playerId,
            playerName: players[playerId].name,
            reason: 'inatividade',
            timestamp: now
          })
          
          // Remover jogador
          delete players[playerId]
          delete gameState.players[playerId]
          
          // Atualizar contador
          io.to('main').emit('playersCountUpdate', Object.keys(players).length)
        }
      }
    })
  } catch (error) {
    console.error('❌ Erro na limpeza:', error)
  }
}, 5 * 60 * 1000) // A cada 5 minutos

// Estatísticas do servidor (a cada 10 minutos)
const statsInterval = setInterval(() => {
  const stats = {
    playersOnline: Object.keys(players).length,
    uptime: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
    gameStarted: gameState.gameStarted
  }
  
  console.log(`📊 Estatísticas: ${stats.playersOnline} jogadores online | Uptime: ${Math.floor(stats.uptime/60)}min | RAM: ${Math.floor(stats.memoryUsage.used/1024/1024)}MB`)
}, 10 * 60 * 1000) // A cada 10 minutos

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Desligando servidor...')
  
  // Notificar todos os jogadores
  io.emit('serverShutdown', {
    message: 'Servidor será desligado para manutenção. Reconecte em alguns minutos.',
    timestamp: new Date()
  })
  
  // Limpar intervalos
  clearInterval(gameLoopInterval)
  clearInterval(cleanupInterval)
  clearInterval(statsInterval)
  
  // Fechar conexões
  setTimeout(() => {
    server.close(() => {
      console.log('✅ Servidor desligado com sucesso')
      process.exit(0)
    })
  }, 2000)
})

// Lidar com erros não tratados
process.on('uncaughtException', (error) => {
  console.error('🚨 Erro não tratado:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Promise rejeitada:', reason)
})

// Iniciar servidor
const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || 'localhost'

server.listen(PORT, () => {
  console.log('🚀 =============================================')
  console.log(`🎮 Servidor de Jogo Multiplayer iniciado!`)
  console.log(`🌐 URL: http://${HOST}:${PORT}`)
  console.log(`📡 Socket.IO habilitado`)
  console.log(`👥 Máximo de jogadores: ${gameState.maxPlayers}`)
  console.log(`⏰ Iniciado em: ${new Date().toLocaleString()}`)
  console.log('🚀 =============================================')
})

// Exportar para testes (opcional)
module.exports = { server, io, players, gameState }