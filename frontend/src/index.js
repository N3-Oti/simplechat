// frontend/src/index.js
// このファイルは React フロントエンドアプリケーションのエントリーポイントです。
// アプリケーション全体を HTML ドキュメントに描画 (レンダリング) する役割を担います。

// React ライブラリ本体をインポートします。JSX を使用するために必要です。
import React from 'react';
// ReactDOM ライブラリをインポートします。React コンポーネントを実際の DOM に描画するために使用します。
// 'react-dom/client' は React 18 以降の推奨されるインポートパスです。
import ReactDOM from 'react-dom/client';
// アプリケーション全体に適用されるグローバルな CSS スタイルをインポートします。
import './index.css';
// メインのアプリケーションコンポーネント (App.js で定義) をインポートします。
import App from './App';

// public/index.html 内にある id="root" の DOM 要素を取得します。
// これが React アプリケーション全体がマウントされるコンテナとなります。
const rootElement = document.getElementById('root');

// 取得した DOM 要素をルートとして、React アプリケーションを描画するためのルートを作成します。
// ReactDOM.createRoot は React 18 で導入された Concurrent Mode を有効にするための API です。
const root = ReactDOM.createRoot(rootElement);

// 作成したルートに対して、アプリケーションのメインコンポーネント (<App />) をレンダリングします。
root.render(
  // <React.StrictMode> は、アプリケーション内の潜在的な問題を検出して警告するための
  // 開発モード専用のヘルパーコンポーネントです。本番ビルドでは影響しません。
  // 例えば、安全でないライフサイクルメソッドの使用や、意図しない副作用などを検出するのに役立ちます。
  <React.StrictMode>
    {/* メインのアプリケーションコンポーネントをレンダリングします。 */}
    <App />
  </React.StrictMode>
);

// パフォーマンス測定用の web-vitals に関するコードは削除されているようです。
// 必要であれば、reportWebVitals() 関数をインポートして呼び出すコードを追加できます。
// import reportWebVitals from './reportWebVitals';
// reportWebVitals(console.log);