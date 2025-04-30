// frontend/src/App.js
import React, { useState, useEffect, useRef } from 'react';
import { Amplify, Auth, Storage } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import axios from 'axios';
import mermaid from 'mermaid';
import { io } from 'socket.io-client';
import './App.css';

// 設定を読み込む関数
const loadConfig = () => {
  // ウィンドウオブジェクトから設定を取得
  if (window.REACT_APP_CONFIG) {
    return {
      apiEndpoint: window.REACT_APP_CONFIG.apiEndpoint,
      userPoolId: window.REACT_APP_CONFIG.userPoolId,
      userPoolClientId: window.REACT_APP_CONFIG.userPoolClientId,
      region: window.REACT_APP_CONFIG.region,
    };
  }
  
  // 環境変数から設定を取得（ローカル開発用）
  return {
    apiEndpoint: process.env.REACT_APP_API_ENDPOINT || 'YOUR_API_ENDPOINT',
    userPoolId: process.env.REACT_APP_USER_POOL_ID || 'YOUR_USER_POOL_ID',
    userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID || 'YOUR_USER_POOL_CLIENT_ID',
    region: process.env.REACT_APP_REGION || 'us-east-1',
  };
};

// 設定を取得
const config = loadConfig();

// Amplify設定
Amplify.configure({
  Auth: {
    region: config.region,
    userPoolId: config.userPoolId,
    userPoolWebClientId: config.userPoolClientId,
  },
});

// ChatInterfaceコンポーネントの定義
function ChatInterface({ signOut, user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expertise, setExpertise] = useState('evidence');
  const [uploadedPdfs, setUploadedPdfs] = useState([]);
  const [showFlowchart, setShowFlowchart] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [logicFlow, setLogicFlow] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const flowchartRef = useRef(null);
  const [currentView, setCurrentView] = useState('chat'); // chat, evidence, debate, attack/protect
  const [evidenceRequirements, setEvidenceRequirements] = useState({
    format: {
      title: true,
      date: true,
      source: true,
      page: true,
      customFields: []
    },
    categories: [],
    tags: []
  });
  const [customFieldInput, setCustomFieldInput] = useState('');
  const [flowcharts, setFlowcharts] = useState([]);
  const [selectedFlowchart, setSelectedFlowchart] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [nodeConnections, setNodeConnections] = useState([]);
  const [evidenceLinks, setEvidenceLinks] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [quickAccessTags, setQuickAccessTags] = useState([]);
  const [matchMode, setMatchMode] = useState(false);
  const [timer, setTimer] = useState(480); // 8分のタイマー
  const [timerRunning, setTimerRunning] = useState(false);
  const [usedEvidence, setUsedEvidence] = useState(new Set());
  const [quickNotes, setQuickNotes] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [comments, setComments] = useState({});
  const [evidencePriority, setEvidencePriority] = useState({});
  const socketRef = useRef(null);

  // Mermaidの初期化
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      }
    });
  }, []);

  // 初期ロード時に過去の会話履歴を取得
  useEffect(() => {
    loadChatHistory();
  }, []);

  // 過去の会話履歴を取得
  const loadChatHistory = async () => {
    try {
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();
      
      const response = await axios.get(`${config.apiEndpoint}/history`, {
        headers: {
          'Authorization': idToken
        }
      });
      
      if (response.data.success) {
        setMessages(response.data.history);
      }
    } catch (err) {
      console.error("履歴の取得に失敗しました:", err);
      setError("履歴の取得に失敗しました");
    }
  };

  // メッセージが追加されたら自動スクロール
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // チャットメッセージ送信
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);
    setError(null);

    try {
      // 認証トークンを取得
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      const response = await axios.post(config.apiEndpoint, {
        message: userMessage,
        conversationHistory: messages
      }, {
        headers: {
          'Authorization': idToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: response.data.response }]);
      } else {
        setError('応答の取得に失敗しました');
      }
    } catch (err) {
      console.error("API Error:", err);
      setError(`エラーが発生しました: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 会話をクリア
  const clearConversation = () => {
    setMessages([]);
  };

  // エビデンス要件の更新
  const updateEvidenceRequirements = (field, value) => {
    setEvidenceRequirements(prev => ({
      ...prev,
      format: {
        ...prev.format,
        [field]: value
      }
    }));
  };

  // カスタムフィールドの追加
  const addCustomField = () => {
    if (customFieldInput.trim()) {
      setEvidenceRequirements(prev => ({
        ...prev,
        format: {
          ...prev.format,
          customFields: [...prev.format.customFields, customFieldInput.trim()]
        }
      }));
      setCustomFieldInput('');
    }
  };

  // カスタムフィールドの削除
  const removeCustomField = (index) => {
    setEvidenceRequirements(prev => ({
      ...prev,
      format: {
        ...prev.format,
        customFields: prev.format.customFields.filter((_, i) => i !== index)
      }
    }));
  };

  // エビデンスカテゴリーの追加
  const addCategory = (category) => {
    setEvidenceRequirements(prev => ({
      ...prev,
      categories: [...prev.categories, category]
    }));
  };

  // エビデンス要件の保存
  const saveEvidenceRequirements = async () => {
    try {
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      const response = await axios.post(`${config.apiEndpoint}/save-evidence-requirements`, {
        requirements: evidenceRequirements
      }, {
        headers: {
          'Authorization': idToken
        }
      });

      if (response.data.success) {
        setError(null);
        // 成功メッセージの表示など
      }
    } catch (err) {
      console.error("エビデンス要件の保存に失敗:", err);
      setError('エビデンス要件の保存に失敗しました');
    }
  };

  // 専門分野の変更時の処理
  const handleExpertiseChange = (e) => {
    const newExpertise = e.target.value;
    setExpertise(newExpertise);
    setCurrentView(newExpertise);
  };

  // エビデンス検査ページの表示
  const renderEvidenceView = () => {
    return (
      <div className="evidence-view">
        <div className="evidence-requirements">
          <h3>エビデンス要件設定</h3>
          
          <div className="requirements-section">
            <h4>基本フォーマット</h4>
            <div className="format-options">
              <label>
                <input
                  type="checkbox"
                  checked={evidenceRequirements.format.title}
                  onChange={(e) => updateEvidenceRequirements('title', e.target.checked)}
                />
                タイトル
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={evidenceRequirements.format.date}
                  onChange={(e) => updateEvidenceRequirements('date', e.target.checked)}
                />
                日付
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={evidenceRequirements.format.source}
                  onChange={(e) => updateEvidenceRequirements('source', e.target.checked)}
                />
                出典
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={evidenceRequirements.format.page}
                  onChange={(e) => updateEvidenceRequirements('page', e.target.checked)}
                />
                ページ番号
              </label>
            </div>
          </div>

          <div className="requirements-section">
            <h4>カスタムフィールド</h4>
            <div className="custom-field-input">
              <input
                type="text"
                value={customFieldInput}
                onChange={(e) => setCustomFieldInput(e.target.value)}
                placeholder="新しいフィールド名"
              />
              <button onClick={addCustomField}>追加</button>
            </div>
            <ul className="custom-fields-list">
              {evidenceRequirements.format.customFields.map((field, index) => (
                <li key={index}>
                  {field}
                  <button onClick={() => removeCustomField(index)}>×</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="requirements-section">
            <h4>カテゴリー設定</h4>
            <div className="category-input">
              <input
                type="text"
                placeholder="新しいカテゴリー"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    addCategory(e.target.value.trim());
                    e.target.value = '';
                  }
                }}
              />
            </div>
            <div className="categories-list">
              {evidenceRequirements.categories.map((category, index) => (
                <span key={index} className="category-tag">
                  {category}
                  <button onClick={() => {
                    setEvidenceRequirements(prev => ({
                      ...prev,
                      categories: prev.categories.filter((_, i) => i !== index)
                    }));
                  }}>×</button>
                </span>
              ))}
            </div>
          </div>

          <button 
            className="save-requirements-button"
            onClick={saveEvidenceRequirements}
          >
            要件を保存
          </button>
        </div>

        <div className="evidence-preview">
          <h3>エビデンスプレビュー</h3>
          <div className="preview-container">
            {/* プレビューの表示 */}
          </div>
        </div>
      </div>
    );
  };

  // フロー図一覧の取得
  useEffect(() => {
    if (currentView === 'debate') {
      loadFlowcharts();
    }
  }, [currentView]);

  const loadFlowcharts = async () => {
    try {
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      const response = await axios.get(`${config.apiEndpoint}/flowcharts`, {
        headers: {
          'Authorization': idToken
        }
      });

      if (response.data.success) {
        setFlowcharts(response.data.flowcharts);
      }
    } catch (err) {
      console.error("フロー図一覧の取得に失敗:", err);
      setError('フロー図一覧の取得に失敗しました');
    }
  };

  // フロー図の表示ページ
  const renderFlowchartView = () => {
    return (
      <div className="flowchart-view">
        <div className="flowchart-sidebar">
          <div className="quick-access-section">
            <h3>クイックアクセス</h3>
            <div className="quick-access-tags">
              {quickAccessTags.map((tag, index) => (
                <button
                  key={index}
                  className="quick-access-tag"
                  onClick={() => setSearchTerm(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="search-section">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="エビデンス・主張を検索..."
              className="search-input"
            />
          </div>

          <div className="flowchart-tools">
            <button
              className={`edit-mode-button ${editMode ? 'active' : ''}`}
              onClick={toggleEditMode}
            >
              編集モード {editMode ? 'ON' : 'OFF'}
            </button>
            {editMode && (
              <div className="edit-tools">
                <button onClick={() => addNode()}>新規ノード追加</button>
                {selectedNode && (
                  <>
                    <button onClick={() => addNode(selectedNode.id)}>子ノード追加</button>
                    <button onClick={() => addAttack(selectedNode.id)}>アタック追加</button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mode-toggle">
            <button
              className={`mode-toggle-button ${matchMode ? 'active' : ''}`}
              onClick={toggleMatchMode}
            >
              試合モード {matchMode ? 'ON' : 'OFF'}
            </button>
          </div>
          {matchMode && renderMatchModeUI()}
        </div>

        <div className="flowchart-main">
          <div className="flowchart-content">
            <div ref={flowchartRef} className="flowchart"></div>
          </div>

          {selectedNode && (
            <div className="node-detail-panel">
              <div className="node-content-section">
                <h4>主張内容</h4>
                {editMode ? (
                  <textarea
                    value={selectedNode.content}
                    onChange={(e) => updateNode(selectedNode.id, { content: e.target.value })}
                    className="node-content-editor"
                  />
                ) : (
                  <p>{selectedNode.content}</p>
                )}
              </div>

              <div className="node-evidence-section">
                <h4>エビデンス</h4>
                <div className="evidence-links">
                  {evidenceLinks[selectedNode.id]?.map((link, index) => (
                    <div key={index} className="evidence-item">
                      <div className="evidence-header">
                        <span className="evidence-title">{link.title}</span>
                        <div className="evidence-controls">
                          <select
                            value={evidencePriority[link.evidenceId] || 'medium'}
                            onChange={(e) => setEvidencePriorityLevel(link.evidenceId, e.target.value)}
                          >
                            <option value="high">優先度: 高</option>
                            <option value="medium">優先度: 中</option>
                            <option value="low">優先度: 低</option>
                          </select>
                          <button
                            className={`use-evidence-button ${usedEvidence.has(link.evidenceId) ? 'used' : ''}`}
                            onClick={() => markEvidenceAsUsed(link.evidenceId)}
                          >
                            {usedEvidence.has(link.evidenceId) ? '使用済' : '未使用'}
                          </button>
                        </div>
                      </div>
                      <div className="evidence-content">
                        {link.content}
                      </div>
                    </div>
                  ))}
                  {editMode && (
                    <button onClick={() => {/* エビデンス選択モーダルを開く */}}>
                      エビデンスを追加
                    </button>
                  )}
                </div>
              </div>

              <div className="node-attacks-section">
                <h4>アタック一覧</h4>
                {selectedNode.attacks?.map((attack, index) => (
                  <div key={index} className="attack-item">
                    <div className="attack-content">
                      {editMode ? (
                        <textarea
                          value={attack.content}
                          onChange={(e) => {
                            const updatedAttacks = [...selectedNode.attacks];
                            updatedAttacks[index].content = e.target.value;
                            updateNode(selectedNode.id, { attacks: updatedAttacks });
                          }}
                          className="attack-content-editor"
                        />
                      ) : (
                        <p>{attack.content}</p>
                      )}
                    </div>

                    <div className="attack-protects">
                      {attack.protects?.map((protect, pIndex) => (
                        <div key={pIndex} className="protect-item">
                          {editMode ? (
                            <textarea
                              value={protect.content}
                              onChange={(e) => {
                                const updatedAttacks = [...selectedNode.attacks];
                                updatedAttacks[index].protects[pIndex].content = e.target.value;
                                updateNode(selectedNode.id, { attacks: updatedAttacks });
                              }}
                              className="protect-content-editor"
                            />
                          ) : (
                            <p>{protect.content}</p>
                          )}
                        </div>
                      ))}
                      {editMode && (
                        <button onClick={() => addProtect(selectedNode.id, attack.id)}>
                          プロテクト追加
                        </button>
                      )}
                    </div>

                    {editMode && (
                      <div className="attack-priority">
                        <label>優先度:</label>
                        <select
                          value={attack.priority}
                          onChange={(e) => {
                            const updatedAttacks = [...selectedNode.attacks];
                            updatedAttacks[index].priority = parseInt(e.target.value);
                            updateNode(selectedNode.id, { attacks: updatedAttacks });
                          }}
                        >
                          <option value="1">高</option>
                          <option value="2">中</option>
                          <option value="3">低</option>
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="evidence-section">
                <h4>エビデンス</h4>
                {evidenceLinks[selectedNode.id]?.map((link, index) => (
                  <div key={index} className="evidence-item">
                    <div className="evidence-header">
                      <span className="evidence-title">{link.title}</span>
                      <div className="evidence-controls">
                        <select
                          value={evidencePriority[link.evidenceId] || 'medium'}
                          onChange={(e) => setEvidencePriorityLevel(link.evidenceId, e.target.value)}
                        >
                          <option value="high">優先度: 高</option>
                          <option value="medium">優先度: 中</option>
                          <option value="low">優先度: 低</option>
                        </select>
                        <button
                          className={`use-evidence-button ${usedEvidence.has(link.evidenceId) ? 'used' : ''}`}
                          onClick={() => markEvidenceAsUsed(link.evidenceId)}
                        >
                          {usedEvidence.has(link.evidenceId) ? '使用済' : '未使用'}
                        </button>
                      </div>
                    </div>
                    <div className="evidence-content">
                      {link.content}
                    </div>
                  </div>
                ))}
              </div>

              {renderComments(selectedNode.id)}
            </div>
          )}
        </div>
      </div>
    );
  };

  // フロー図の保存
  const saveFlowchart = async (flowchart) => {
    try {
      setLoading(true);
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      const response = await axios.post(`${config.apiEndpoint}/save-flowchart`, {
        flowchart: flowchart
      }, {
        headers: {
          'Authorization': idToken
        }
      });

      if (response.data.success) {
        loadFlowcharts();
        setError(null);
      }
    } catch (err) {
      console.error("フロー図の保存に失敗:", err);
      setError('フロー図の保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // フロー図の削除
  const deleteFlowchart = async (flowchartId) => {
    if (!window.confirm('このフロー図を削除してもよろしいですか？')) {
      return;
    }

    try {
      setLoading(true);
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      const response = await axios.delete(`${config.apiEndpoint}/flowchart/${flowchartId}`, {
        headers: {
          'Authorization': idToken
        }
      });

      if (response.data.success) {
        setSelectedFlowchart(null);
        loadFlowcharts();
        setError(null);
      }
    } catch (err) {
      console.error("フロー図の削除に失敗:", err);
      setError('フロー図の削除に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // ノードの追加
  const addNode = (parentNodeId = null) => {
    const newNode = {
      id: `node-${Date.now()}`,
      content: '新しい主張',
      type: 'claim',
      attacks: [],
      protects: [],
      evidence: []
    };

    if (parentNodeId) {
      setNodeConnections(prev => [...prev, {
        from: parentNodeId,
        to: newNode.id,
        type: 'support'
      }]);
    }

    setLogicFlow(prev => ({
      ...prev,
      mainLogic: [...prev.mainLogic, newNode]
    }));
  };

  // ノードの編集
  const updateNode = (nodeId, updates) => {
    setLogicFlow(prev => ({
      ...prev,
      mainLogic: prev.mainLogic.map(node =>
        node.id === nodeId ? { ...node, ...updates } : node
      )
    }));
  };

  // アタックの追加
  const addAttack = (nodeId) => {
    const newAttack = {
      id: `attack-${Date.now()}`,
      content: '新しい反論',
      priority: 1,
      protects: []
    };

    updateNode(nodeId, {
      attacks: [...(selectedNode.attacks || []), newAttack]
    });
  };

  // プロテクトの追加
  const addProtect = (nodeId, attackId) => {
    const newProtect = {
      id: `protect-${Date.now()}`,
      content: '新しい防御',
      evidence: []
    };

    updateNode(nodeId, {
      attacks: selectedNode.attacks.map(attack =>
        attack.id === attackId
          ? { ...attack, protects: [...attack.protects, newProtect] }
          : attack
      )
    });
  };

  // エビデンスの紐付け
  const linkEvidence = (nodeId, evidenceId, type = 'claim') => {
    setEvidenceLinks(prev => ({
      ...prev,
      [nodeId]: [...(prev[nodeId] || []), { evidenceId, type }]
    }));
  };

  // クイックアクセスタグの追加
  const addQuickAccessTag = (tag) => {
    setQuickAccessTags(prev => [...new Set([...prev, tag])]);
  };

  // フロー図の編集モード切り替え
  const toggleEditMode = () => {
    setEditMode(!editMode);
  };

  // Socket.io接続の設定
  useEffect(() => {
    socketRef.current = io(config.socketEndpoint);
    
    socketRef.current.on('flowchart-update', (data) => {
      if (data.userId !== user.username) {
        setLogicFlow(data.flowchart);
      }
    });

    socketRef.current.on('comment-added', (data) => {
      setComments(prev => ({
        ...prev,
        [data.nodeId]: [...(prev[data.nodeId] || []), data.comment]
      }));
    });

    return () => socketRef.current.disconnect();
  }, []);

  // タイマー機能
  useEffect(() => {
    let interval;
    if (timerRunning && timer > 0) {
      interval = setInterval(() => {
        setTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerRunning, timer]);

  // 試合モードの切り替え
  const toggleMatchMode = () => {
    setMatchMode(!matchMode);
    if (!matchMode) {
      setTimer(480);
      setUsedEvidence(new Set());
      setQuickNotes([]);
    }
  };

  // タイマーコントロール
  const timerControls = {
    start: () => setTimerRunning(true),
    pause: () => setTimerRunning(false),
    reset: () => {
      setTimerRunning(false);
      setTimer(480);
    }
  };

  // エビデンスの使用マーク
  const markEvidenceAsUsed = (evidenceId) => {
    setUsedEvidence(prev => new Set([...prev, evidenceId]));
  };

  // クイックメモの追加
  const addQuickNote = (note) => {
    setQuickNotes(prev => [...prev, {
      id: Date.now(),
      content: note,
      timestamp: new Date().toISOString()
    }]);
  };

  // エビデンスの優先度設定
  const setEvidencePriorityLevel = (evidenceId, priority) => {
    setEvidencePriority(prev => ({
      ...prev,
      [evidenceId]: priority
    }));
  };

  // コメントの追加
  const addComment = (nodeId, comment) => {
    const newComment = {
      id: Date.now(),
      userId: user.username,
      content: comment,
      timestamp: new Date().toISOString()
    };

    setComments(prev => ({
      ...prev,
      [nodeId]: [...(prev[nodeId] || []), newComment]
    }));

    socketRef.current.emit('add-comment', {
      nodeId,
      comment: newComment
    });
  };

  // フロー図の共有
  const shareFlowchart = async (teamId) => {
    try {
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      await axios.post(`${config.apiEndpoint}/share-flowchart`, {
        flowchart: logicFlow,
        teamId: teamId
      }, {
        headers: {
          'Authorization': idToken
        }
      });

      socketRef.current.emit('flowchart-shared', {
        teamId,
        flowchart: logicFlow
      });
    } catch (err) {
      console.error("フロー図の共有に失敗:", err);
      setError('フロー図の共有に失敗しました');
    }
  };

  // 試合モードUIの表示
  const renderMatchModeUI = () => {
    return (
      <div className="match-mode-panel">
        <div className="timer-section">
          <div className="timer-display">
            {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
          </div>
          <div className="timer-controls">
            <button onClick={timerControls.start} disabled={timerRunning}>開始</button>
            <button onClick={timerControls.pause} disabled={!timerRunning}>一時停止</button>
            <button onClick={timerControls.reset}>リセット</button>
          </div>
        </div>

        <div className="quick-notes-section">
          <h4>クイックメモ</h4>
          <div className="quick-notes-input">
            <input
              type="text"
              placeholder="メモを入力..."
              onKeyPress={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  addQuickNote(e.target.value.trim());
                  e.target.value = '';
                }
              }}
            />
          </div>
          <div className="quick-notes-list">
            {quickNotes.map(note => (
              <div key={note.id} className="quick-note-item">
                <p>{note.content}</p>
                <span className="note-timestamp">
                  {new Date(note.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // チーム機能UIの表示
  const renderTeamSection = () => {
    return (
      <div className="team-section">
        <h4>チームメンバー</h4>
        <div className="team-members">
          {teamMembers.map(member => (
            <div key={member.id} className="team-member">
              <span className={`status-indicator ${member.online ? 'online' : 'offline'}`} />
              <span>{member.username}</span>
            </div>
          ))}
        </div>
        <button 
          className="share-flowchart-button"
          onClick={() => shareFlowchart(selectedFlowchart.teamId)}
        >
          チームと共有
        </button>
      </div>
    );
  };

  // コメントセクションの表示
  const renderComments = (nodeId) => {
    return (
      <div className="comments-section">
        <h4>コメント</h4>
        <div className="comments-list">
          {comments[nodeId]?.map(comment => (
            <div key={comment.id} className="comment-item">
              <div className="comment-header">
                <span className="comment-author">{comment.userId}</span>
                <span className="comment-timestamp">
                  {new Date(comment.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="comment-content">{comment.content}</p>
            </div>
          ))}
        </div>
        <div className="comment-input">
          <input
            type="text"
            placeholder="コメントを入力..."
            onKeyPress={(e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                addComment(nodeId, e.target.value.trim());
                e.target.value = '';
              }
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>ディベートメンター</h1>
        <div className="header-controls">
          <div className="control-buttons">
            <div className="upload-section">
              <button 
                className="upload-button" 
                onClick={() => fileInputRef.current.click()}
                disabled={loading}
              >
                PDFアップロード
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf"
                style={{ display: 'none' }}
              />
            </div>
            <button 
              className="flowchart-button"
              onClick={generateFlowchart}
              disabled={loading || messages.length === 0}
            >
              フロー図を生成
            </button>
          </div>
          <select 
            value={expertise}
            onChange={handleExpertiseChange}
            className="expertise-select"
          >
            <option value="evidence">エビデンス検査</option>
            <option value="debate">立論</option>
            <option value="attack/protect">アタック・プロテクト</option>
            <option value="practice">練習試合</option>
          </select>
          <div className="header-buttons">
            <button className="clear-button" onClick={clearConversation}>
              会話をクリア
            </button>
            <button className="logout-button" onClick={signOut}>
              ログアウト ({user.username})
            </button>
          </div>
        </div>
      </header>
      
      <main className="chat-container">
        {currentView === 'evidence' ? (
          renderEvidenceView()
        ) : currentView === 'debate' ? (
          renderFlowchartView()
        ) : (
          <>
            {showFlowchart && (
              <div className="flowchart-container">
                <div className="flowchart-header">
                  <h3>立論のロジックフロー</h3>
                  <button 
                    className="close-button"
                    onClick={() => {
                      setShowFlowchart(false);
                      setSelectedNode(null);
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="flowchart-content">
                  <div ref={flowchartRef} className="flowchart"></div>
                  {selectedNode && (
                    <div className="node-details">
                      <h4>{logicFlow.mainLogic[selectedNode.index].content}</h4>
                      <div className="attack-protect">
                        <div className="attack-section">
                          <h5>予想されるアタック</h5>
                          <ul>
                            {selectedNode.details.attacks.map((attack, index) => (
                              <li key={`attack-${index}`}>
                                {attack.content}
                                <div className="protect-details">
                                  <h6>プロテクト</h6>
                                  <p>{attack.protect}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {uploadedPdfs.length > 0 && (
              <div className="pdf-list">
                <h3>アップロード済みPDF</h3>
                <ul>
                  {uploadedPdfs.map((pdf, index) => (
                    <li key={index}>
                      {pdf.name}
                      <span className="pdf-date">
                        {new Date(pdf.uploadDate).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            <div className="messages-container">
              {messages.length === 0 ? (
                <div className="welcome-message">
                  <h2>ディベートメンター へようこそ！</h2>
                  <p>ディベートの質問をしてください。</p>
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div key={index} className={`message ${msg.role}`}>
                    <div className="message-content">
                      {msg.content.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  </div>
                ))
              )}
              
              {loading && (
                <div className="message assistant loading">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
              
              {error && (
                <div className="error-message">
                  {error}
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
            
            <form onSubmit={handleSubmit} className="input-form">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="メッセージを入力..."
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <button type="submit" disabled={loading || !input.trim()}>
                送信
              </button>
            </form>
          </>
        )}
      </main>
      
      <footer>
        <p>Powered by Amazon Bedrock</p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <ChatInterface signOut={signOut} user={user} />
      )}
    </Authenticator>
  );
}

export default App;