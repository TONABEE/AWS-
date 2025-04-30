import { EventEmitter } from 'events';

class WebSocketService {
  private socket: WebSocket | null = null;
  private eventEmitter = new EventEmitter();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout = 1000; // 1秒
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log('WebSocket接続が確立されました');
      this.reconnectAttempts = 0;
      this.eventEmitter.emit('connected');
    };

    this.socket.onclose = () => {
      console.log('WebSocket接続が切断されました');
      this.eventEmitter.emit('disconnected');
      this.reconnect();
    };

    this.socket.onerror = (error) => {
      console.error('WebSocketエラー:', error);
      this.eventEmitter.emit('error', error);
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('メッセージの解析エラー:', error);
      }
    };
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('最大再接続試行回数に達しました');
      return;
    }

    this.reconnectAttempts++;
    console.log(`${this.reconnectTimeout / 1000}秒後に再接続を試みます...`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectTimeout * this.reconnectAttempts);
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'flowchart_update':
        this.eventEmitter.emit('flowchartUpdate', data.data);
        break;
      case 'new_comment':
        this.eventEmitter.emit('newComment', data.data);
        break;
      case 'team_update':
        this.eventEmitter.emit('teamUpdate', data.data);
        break;
      default:
        console.warn('未知のメッセージタイプ:', data.type);
    }
  }

  sendFlowchartUpdate(flowchartData: any) {
    this.send({
      type: 'flowchart_update',
      data: flowchartData
    });
  }

  sendComment(commentData: any) {
    this.send({
      type: 'comment',
      data: commentData
    });
  }

  sendTeamAction(actionData: any) {
    this.send({
      type: 'team_action',
      data: actionData
    });
  }

  private send(data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.error('WebSocket接続が確立されていません');
    }
  }

  on(event: string, callback: (...args: any[]) => void) {
    this.eventEmitter.on(event, callback);
  }

  off(event: string, callback: (...args: any[]) => void) {
    this.eventEmitter.off(event, callback);
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

export default WebSocketService; 