// frontend/src/App.js
// このファイルは、React を使用してチャットボットのフロントエンド UI を構築します。
// AWS Amplify ライブラリを使用して Cognito 認証を処理し、
// バックエンド API と通信してチャット機能を実現します。

// --- React および関連ライブラリのインポート ---
import React, { useState, useEffect, useRef } from 'react'; // React のコア機能とフック (useState, useEffect, useRef)
import { Amplify, Auth } from 'aws-amplify'; // AWS Amplify のコア機能と認証モジュール
import { Authenticator } from '@aws-amplify/ui-react'; // Amplify UI の認証コンポーネント (ログイン/サインアップ画面を提供)
import '@aws-amplify/ui-react/styles.css'; // Amplify UI コンポーネント用のデフォルトスタイル
import axios from 'axios'; // HTTP リクエストを行うためのライブラリ (バックエンド API との通信に使用)
import './App.css'; // このコンポーネント用のカスタム CSS スタイル

// --- 設定読み込み関数 ---
// アプリケーションに必要な設定値 (API エンドポイント、Cognito ID など) を読み込みます。
// デプロイ環境では S3 からロードされる config.js (window.REACT_APP_CONFIG) を優先し、
// ローカル開発環境では環境変数 (process.env) をフォールバックとして使用します。
const loadConfig = () => {
  // 1. window オブジェクトから設定を取得 (デプロイ環境向け)
  //    CDK の Custom Resource (ConfigGeneratorFunction) によって生成された config.js が
  //    index.html で読み込まれ、window.REACT_APP_CONFIG に設定値が格納されます。
  if (window.REACT_APP_CONFIG) {
    console.log('Loading config from window object');
    return {
      apiEndpoint: window.REACT_APP_CONFIG.apiEndpoint,
      userPoolId: window.REACT_APP_CONFIG.userPoolId,
      userPoolClientId: window.REACT_APP_CONFIG.userPoolClientId,
      region: window.REACT_APP_CONFIG.region,
    };
  }

  // 2. 環境変数から設定を取得 (ローカル開発環境向け)
  //    .env ファイルなどで設定された環境変数を参照します。
  //    設定がない場合は、プレースホルダーまたはデフォルト値を返します。
  console.log('Loading config from environment variables');
  return {
    // API Gateway のエンドポイント URL
    apiEndpoint: process.env.REACT_APP_API_ENDPOINT || 'YOUR_API_ENDPOINT',
    // Cognito ユーザープール ID
    userPoolId: process.env.REACT_APP_USER_POOL_ID || 'YOUR_USER_POOL_ID',
    // Cognito ユーザープールクライアント ID
    userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID || 'YOUR_USER_POOL_CLIENT_ID',
    // AWS リージョン
    region: process.env.REACT_APP_REGION || 'us-east-1',
  };
};

// --- 設定の取得と Amplify の設定 ---
// 上記の関数を呼び出して設定オブジェクトを取得します。
const config = loadConfig();
console.log('App Config:', config); // 読み込んだ設定をコンソールに出力 (デバッグ用)

// Amplify ライブラリに Cognito の設定情報を渡して初期化します。
// これにより、Amplify の Auth モジュールや Authenticator コンポーネントが
// 正しい Cognito ユーザープールとクライアントを使用できるようになります。
Amplify.configure({
  Auth: {
    region: config.region, // AWS リージョン
    userPoolId: config.userPoolId, // Cognito ユーザープール ID
    userPoolWebClientId: config.userPoolClientId, // Cognito ユーザープールクライアント ID (Web 用)
  },
  // 他の Amplify カテゴリ (API, Storage など) の設定もここに追加可能
});

// --- ChatInterface コンポーネント ---
// 認証が成功した後に表示されるメインのチャット画面コンポーネントです。
// Authenticator コンポーネントから signOut 関数と user オブジェクトを受け取ります。
function ChatInterface({ signOut, user }) {
  // --- State 変数の定義 ---
  // useState フックを使用してコンポーネントの状態を管理します。
  // messages: チャットの会話履歴 (ユーザーとアシスタントの発言) を格納する配列
  const [messages, setMessages] = useState([]);
  // input: ユーザーが入力中のメッセージテキスト
  const [input, setInput] = useState('');
  // loading: バックエンド API へのリクエスト中かどうかを示すフラグ (ローディング表示に使用)
  const [loading, setLoading] = useState(false);
  // error: API 通信などでエラーが発生した場合のエラーメッセージ
  const [error, setError] = useState(null);

  // --- Ref の定義 ---
  // useRef フックを使用して、メッセージリストの末尾要素への参照を保持します。
  // 新しいメッセージが追加されたときに自動スクロールするために使用します。
  const messagesEndRef = useRef(null);

  // --- Effect フック: 自動スクロール ---
  // useEffect フックを使用して、messages 配列が更新されるたびに副作用 (自動スクロール) を実行します。
  useEffect(() => {
    // messages 配列が変更されたら、scrollToBottom 関数を呼び出す
    scrollToBottom();
  }, [messages]); // 依存配列に messages を指定。messages が変わった時のみ実行

  // メッセージリストの末尾までスムーズにスクロールする関数
  const scrollToBottom = () => {
    // messagesEndRef.current が参照する DOM 要素が存在する場合に実行
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); // スムーズスクロールを実行
  };

  // --- イベントハンドラー: メッセージ送信 ---
  // ユーザーがメッセージ入力フォームを送信したときに呼び出される非同期関数
  const handleSubmit = async (e) => {
    e.preventDefault(); // フォームのデフォルト送信動作をキャンセル
    // 入力が空、または空白文字のみの場合は何もしない
    if (!input.trim()) return;

    // 現在の入力値をユーザーメッセージとして確定
    const userMessage = input;
    // 入力フィールドをクリア
    setInput('');
    // ユーザーメッセージを messages 配列に追加して UI を更新
    // (role: 'user' として追加)
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    // ローディング状態を開始
    setLoading(true);
    // 既存のエラー表示をクリア
    setError(null);

    try {
      // --- バックエンド API 呼び出し ---
      // 1. 現在の Cognito ユーザーセッションから ID トークンを取得
      const session = await Auth.currentSession(); // Amplify Auth を使用してセッション情報を取得
      const idToken = session.getIdToken().getJwtToken(); // セッションから ID トークン (JWT) を取得

      // 2. axios を使用してバックエンド API (API Gateway -> Lambda) に POST リクエストを送信
      const response = await axios.post(
        config.apiEndpoint, // 設定から取得した API エンドポイント URL
        { // リクエストボディ
          message: userMessage, // ユーザーが入力したメッセージ
          conversationHistory: messages // これまでの会話履歴 (アシスタントの応答も含む)
        },
        { // リクエストヘッダー
          headers: {
            // Authorization ヘッダーに Cognito ID トークンを設定
            // これにより、API Gateway の Cognito オーソライザーがリクエストを認証します。
            'Authorization': idToken,
            'Content-Type': 'application/json' // リクエストボディが JSON であることを示す
          }
        }
      );

      // 3. API レスポンスの処理
      if (response.data.success) {
        // API が成功応答 (success: true) を返した場合
        // アシスタントの応答 (response.data.response) を messages 配列に追加して UI を更新
        // (role: 'assistant' として追加)
        setMessages(prev => [...prev, { role: 'assistant', content: response.data.response }]);
      } else {
        // API がエラー応答 (success: false) を返した場合
        setError('応答の取得に失敗しました: ' + (response.data.error || '不明なエラー'));
      }
    } catch (err) {
      // API 通信自体でエラーが発生した場合 (ネットワークエラー、タイムアウトなど)
      console.error("API Error:", err); // エラーをコンソールに出力
      // エラーメッセージを UI に表示
      setError(`エラーが発生しました: ${err.response?.data?.error || err.message || '不明なエラー'}`);
    } finally {
      // API 呼び出しが成功・失敗どちらでも、ローディング状態を終了
      setLoading(false);
    }
  };

  // --- イベントハンドラー: 会話クリア ---
  // 「会話をクリア」ボタンがクリックされたときに呼び出される関数
  const clearConversation = () => {
    // messages 配列を空にして会話履歴をリセット
    setMessages([]);
  };

  // --- JSX: コンポーネントのレンダリング ---
  // このコンポーネントが画面に表示する内容を JSX (JavaScript XML) で記述します。
  return (
    <div className="App"> {/* アプリケーション全体のコンテナ */}
      <header className="App-header"> {/* ヘッダーセクション */}
        <h1>Bedrock LLM チャットボット</h1> {/* タイトル */}
        <div className="header-buttons"> {/* ヘッダー内のボタンコンテナ */}
          <button className="clear-button" onClick={clearConversation}> {/* 会話クリアボタン */}
            会話をクリア
          </button>
          <button className="logout-button" onClick={signOut}> {/* ログアウトボタン */}
            {/* Authenticator から渡された signOut 関数を呼び出す */}
            ログアウト ({user.username}) {/* ログイン中のユーザー名を表示 */}
          </button>
        </div>
      </header>

      <main className="chat-container"> {/* チャット表示と入力フォームのメインコンテナ */}
        <div className="messages-container"> {/* メッセージ表示エリア */}
          {/* メッセージが空の場合、ウェルカムメッセージを表示 */}
          {messages.length === 0 ? (
            <div className="welcome-message">
              <h2>Bedrock Chatbot へようこそ！</h2>
              <p>何でも質問してください。</p>
            </div>
          ) : (
            // messages 配列の内容をマップして各メッセージを表示
            messages.map((msg, index) => (
              // 各メッセージ要素。キーとして index を使用 (より堅牢なキー推奨)
              // CSS クラスとして 'message' と 'user' または 'assistant' を付与
              <div key={index} className={`message ${msg.role}`}>
                <div className="message-content"> {/* メッセージ内容のコンテナ */}
                  {/* メッセージ内容を改行文字 (\n) で分割し、各行を <p> タグで表示 */}
                  {msg.content.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            ))
          )}

          {/* ローディング中の表示 */}
          {loading && (
            <div className="message assistant loading"> {/* アシスタント風のスタイル */}
              <div className="typing-indicator"> {/* タイピング中アニメーション */}
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}

          {/* エラーメッセージの表示 */}
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {/* 自動スクロール用の空の div 要素 (messagesEndRef が参照) */}
          <div ref={messagesEndRef} />
        </div>

        {/* メッセージ入力フォーム */}
        <form onSubmit={handleSubmit} className="input-form">
          <textarea // 複数行入力可能なテキストエリア
            value={input} // 入力値は input ステートと連動
            onChange={(e) => setInput(e.target.value)} // 入力変更時に input ステートを更新
            placeholder="メッセージを入力..." // プレースホルダーテキスト
            disabled={loading} // ローディング中は入力を無効化
            onKeyDown={(e) => { // キー入力イベント
              // Shift キーを押さずに Enter キーが押された場合
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // デフォルトの改行動作をキャンセル
                handleSubmit(e); // フォームを送信
              }
              // Shift + Enter で通常の改行が可能
            }}
          />
          <button type="submit" disabled={loading || !input.trim()}> {/* 送信ボタン */}
            {/* ローディング中または入力が空の場合は無効化 */}
            送信
          </button>
        </form>
      </main>

      <footer className="App-footer"> {/* フッターセクション */}
        <p>Powered by Amazon Bedrock</p>
      </footer>
    </div>
  );
}

// --- App コンポーネント (メイン) ---
// アプリケーション全体のエントリーポイントとなるコンポーネント。
// Amplify UI の Authenticator コンポーネントでラップし、認証状態を管理します。
function App() {
  return (
    // Authenticator コンポーネント:
    // - ユーザーが未認証の場合、ログイン/サインアップ UI を表示します。
    // - ユーザーが認証済みの場合、子要素 (関数) をレンダリングします。
    // - 子要素の関数には、signOut 関数と user オブジェクトが渡されます。
    <Authenticator>
      {({ signOut, user }) => (
        // 認証済みの場合、ChatInterface コンポーネントをレンダリングし、
        // signOut 関数と user オブジェクトを props として渡します。
        <ChatInterface signOut={signOut} user={user} />
      )}
    </Authenticator>
  );
}

// App コンポーネントをデフォルトエクスポート
export default App;