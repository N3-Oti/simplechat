#!/usr/bin/env node
// ↑ Shebang (シバン): このスクリプトを Node.js 環境で実行することを示すおまじない。

// source-map-support をインポートして有効化します。
// これにより、JavaScript にトランスパイルされた後でも、エラー発生時に元の TypeScript の行番号が表示され、デバッグが容易になります。
import 'source-map-support/register';

// AWS Cloud Development Kit (CDK) のコアライブラリを 'cdk' という名前でインポートします。
// CDK を使って AWS リソースをコードで定義・管理するために必要です。
import * as cdk from 'aws-cdk-lib';

// '../lib/bedrock-chatbot-stack' ファイルから BedrockChatbotStack クラスをインポートします。
// このクラスに、チャットボットに必要な AWS リソース (Lambda, API Gateway, Cognito など) の定義が含まれています。
import { BedrockChatbotStack } from '../lib/bedrock-chatbot-stack';

// CDK アプリケーションのインスタンスを作成します。
// CDK アプリケーションは、一つ以上のスタックを含むことができるコンテナのようなものです。
const app = new cdk.App();

// BedrockChatbotStack クラスの新しいインスタンスを作成します。これが実際の AWS リソース群 (スタック) を定義します。
new BedrockChatbotStack(app, // 第1引数: このスタックが属する CDK アプリケーションのインスタンス。
  'BedrockChatbotStack',     // 第2引数: スタックの論理 ID。CloudFormation 上でこの名前で識別されます。
  {                          // 第3引数: スタックに渡すプロパティ (設定)。
    // 使用する Amazon Bedrock モデルの ID を指定します。
    // ここでは 'us.amazon.nova-lite-v1:0' が指定されています。
    // 必要に応じて、コメントアウトされている別のモデルID ('us.amazon.nova-micro-v1:0') に変更することも可能です。
    modelId: 'us.amazon.nova-lite-v1:0',
    //modelId: 'us.amazon.nova-micro-v1:0',

    // このスタックをデプロイする AWS アカウントとリージョンを指定します。
    env: {
      // アカウント ID: 環境変数 'CDK_DEFAULT_ACCOUNT' から取得します。
      // 通常、AWS CLI の設定や CDK コマンド実行時のプロファイルから自動的に設定されます。
      account: process.env.CDK_DEFAULT_ACCOUNT,
      // リージョン: 環境変数 'CDK_DEFAULT_REGION' から取得します。
      // 環境変数が設定されていない場合は、デフォルトで 'us-east-1' リージョンを使用します。
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
    },
  });

// CDK アプリケーション全体 (含まれるすべてのスタック) にタグを追加します。
// タグは AWS リソースの整理、コスト配分、アクセス制御などに役立ちます。
// ここでは、プロジェクト名と環境を示すタグを追加しています。
cdk.Tags.of(app).add('Project', 'BedrockChatbot'); // プロジェクト名を示すタグ
cdk.Tags.of(app).add('Environment', 'Dev');       // 環境 (開発環境) を示すタグ
