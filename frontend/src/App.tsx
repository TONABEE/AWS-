import React, { useState, useEffect } from 'react';
import WebSocketService from './services/websocket';
import { AuthUser } from '@aws-amplify/auth';

interface ChatInterfaceProps {
  signOut: () => void;
  user: AuthUser;
}

interface Comment {
  id: number;
  userId: string;
  content: string;
  timestamp: string;
}

interface FlowchartData {
  id?: string;
  teamId?: string;
}

interface TeamMember {
  id: string;
  username: string;
  email?: string;
}

interface FlowchartNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: any; // 具体的なノードデータの型に応じて定義
}

interface FlowchartEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface LogicFlowData {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

function ChatInterface({ signOut, user }: ChatInterfaceProps) {
  const [webSocket, setWebSocket] = useState<WebSocketService | null>(null);
  const [logicFlow, setLogicFlow] = useState<LogicFlowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedFlowchart, setSelectedFlowchart] = useState<FlowchartData | null>(null);
  const config = {
    webSocketEndpoint: process.env.REACT_APP_WEBSOCKET_ENDPOINT || '',
  };

  // WebSocket接続の初期化
  useEffect(() => {
    const ws = new WebSocketService(config.webSocketEndpoint);
    
    ws.on('connected', () => {
      console.log('WebSocket接続が確立されました');
    });

    ws.on('disconnected', () => {
      console.log('WebSocket接続が切断されました');
    });

    ws.on('error', (error: Error) => {
      console.error('WebSocketエラー:', error);
      setError('WebSocket接続エラーが発生しました');
    });

    ws.on('flowchartUpdate', (data: { userId: string; flowchart: LogicFlowData }) => {
      if (data.userId !== user.username) {
        setLogicFlow(data.flowchart);
      }
    });

    ws.on('newComment', (data: { nodeId: string; comment: Comment }) => {
      setComments((prev: Record<string, Comment[]>) => ({
        ...prev,
        [data.nodeId]: [...(prev[data.nodeId] || []), data.comment]
      }));
    });

    ws.on('teamUpdate', (data: { actionType: string; user: TeamMember; userId: string }) => {
      if (data.actionType === 'join_team') {
        setTeamMembers((prev: TeamMember[]) => [...prev, data.user]);
      } else if (data.actionType === 'leave_team') {
        setTeamMembers((prev: TeamMember[]) => prev.filter((member: TeamMember) => member.id !== data.userId));
      }
    });

    ws.connect();
    setWebSocket(ws);

    return () => {
      ws.disconnect();
    };
  }, [user.username]);

  // フロー図の更新時の処理を更新
  const updateFlowchart = (newFlowchart: LogicFlowData) => {
    setLogicFlow(newFlowchart);
    if (webSocket) {
      webSocket.sendFlowchartUpdate({
        userId: user.username,
        teamId: selectedFlowchart?.teamId,
        flowchartId: selectedFlowchart?.id,
        flowchart: newFlowchart
      });
    }
  };

  // コメント追加時の処理を更新
  const addComment = (nodeId: string, comment: string) => {
    const newComment: Comment = {
      id: Date.now(),
      userId: user.username,
      content: comment,
      timestamp: new Date().toISOString()
    };

    setComments((prev: Record<string, Comment[]>) => ({
      ...prev,
      [nodeId]: [...(prev[nodeId] || []), newComment]
    }));

    if (webSocket) {
      webSocket.sendComment({
        nodeId,
        teamId: selectedFlowchart?.teamId,
        userId: user.username,
        comment: newComment
      });
    }
  };

  // チーム関連のアクション処理を更新
  const handleTeamAction = (actionType: string, data: any) => {
    if (webSocket) {
      webSocket.sendTeamAction({
        actionType,
        teamId: selectedFlowchart?.teamId,
        userId: user.username,
        ...data
      });
    }
  };
} 