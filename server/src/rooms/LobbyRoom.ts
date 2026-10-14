/**
 * 大厅房间 - 用于匹配和等待玩家
 */

import { Room, Client } from '@colyseus/core';

export class LobbyRoom extends Room {
  maxClients = 50;

  onCreate(options: any) {
    console.log('[LobbyRoom] 房间创建');
    
    this.setMetadata({
      name: '天王扑克大厅',
      gameType: 'tianwang_poker',
    });

    this.onMessage('find_game', (client: Client, message: any) => {
      console.log(`[LobbyRoom] 玩家 ${client.sessionId} 请求匹配游戏`);
      client.send('match_result', {
        success: true,
        message: '正在匹配中...',
      });
    });

    this.onMessage('create_room', (client: Client, message: any) => {
      console.log(`[LobbyRoom] 玩家 ${client.sessionId} 请求创建房间`);
      client.send('create_result', {
        success: true,
        message: '房间创建成功',
      });
    });
  }

  onJoin(client: Client, options?: any) {
    console.log(`[LobbyRoom] 玩家 ${client.sessionId} 进入大厅`);
    client.send('lobby_welcome', {
      message: '欢迎来到天王扑克大厅',
      onlineCount: this.clients.length,
    });
  }

  onLeave(client: Client, code?: number) {
    console.log(`[LobbyRoom] 玩家 ${client.sessionId} 离开大厅, code=${code}`);
  }

  onDispose() {
    console.log('[LobbyRoom] 大厅房间销毁');
  }
}
