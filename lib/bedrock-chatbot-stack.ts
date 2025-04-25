// lib/bedrock-chatbot-stack.ts
// このファイルは AWS CDK を使用して、Bedrock チャットボットアプリケーションに必要な
// AWS リソース (インフラストラクチャ) を定義するスタックです。

// --- AWS CDK および関連モジュールのインポート ---
import * as cdk from 'aws-cdk-lib'; // AWS CDK のコアライブラリ
import { Construct } from 'constructs'; // CDK の基本的な構成要素である Construct の基底クラス
import * as lambda from 'aws-cdk-lib/aws-lambda'; // Lambda 関数を定義するためのモジュール
import * as apigateway from 'aws-cdk-lib/aws-apigateway'; // API Gateway を定義するためのモジュール
import * as iam from 'aws-cdk-lib/aws-iam'; // IAM (Identity and Access Management) ロールやポリシーを定義するためのモジュール
import * as s3 from 'aws-cdk-lib/aws-s3'; // S3 バケットを定義するためのモジュール
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'; // S3 バケットにファイルをデプロイするためのモジュール
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'; // CloudFront ディストリビューションを定義するためのモジュール
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'; // CloudFront のオリジン (S3 など) を指定するためのモジュール
import * as cognito from 'aws-cdk-lib/aws-cognito'; // Cognito ユーザープールやクライアントを定義するためのモジュール
import * as path from 'path'; // ファイルパスを操作するための Node.js 標準モジュール
import * as cr from 'aws-cdk-lib/custom-resources'; // CDK のカスタムリソースを作成するためのモジュール
import * as logs from 'aws-cdk-lib/aws-logs'; // CloudWatch Logs の設定 (ログ保持期間など) を行うためのモジュール

// --- スタックのプロパティ定義 ---
// BedrockChatbotStack に渡すことができるプロパティのインターフェースを定義します。
export interface BedrockChatbotStackProps extends cdk.StackProps {
  // オプション: 使用する Bedrock モデルの ID を指定できます。
  // 指定がない場合は、スタック内でデフォルト値が使用されます。
  modelId?: string;
}

// --- BedrockChatbotStack クラスの定義 ---
// cdk.Stack を継承して、チャットボット用のリソースを定義するクラスを作成します。
export class BedrockChatbotStack extends cdk.Stack {
  // コンストラクタ: スタックがインスタンス化されるときに呼び出されます。
  constructor(scope: Construct, id: string, props?: BedrockChatbotStackProps) {
    // 親クラス (cdk.Stack) のコンストラクタを呼び出します。
    super(scope, id, props);

    // --- Bedrock モデル ID の決定 ---
    // props から modelId を取得します。指定がない場合はデフォルト値 'us.amazon.nova-lite-v1:0' を使用します。
    const modelId = props?.modelId || 'us.amazon.nova-lite-v1:0';

    // --- Cognito User Pool の作成 ---
    // ユーザー認証と管理を行うための Cognito ユーザープールを作成します。
    const userPool = new cognito.UserPool(this, 'ChatbotUserPool', {
      userPoolName: 'chatbot-user-pool', // ユーザープールの名前
      selfSignUpEnabled: true, // ユーザー自身によるサインアップを許可
      signInAliases: { // サインインに使用するエイリアス
        email: true, // Eメールアドレスを許可
        username: false, // ユーザー名は使用しない
      },
      standardAttributes: { // 標準属性の設定
        email: { // Eメール属性
          required: true, // 必須項目とする
          mutable: true, // ユーザーによる変更を許可
        },
      },
      autoVerify: { // 自動検証の設定
        email: true, // Eメールアドレスを自動で検証する (確認コードを送信)
      },
      passwordPolicy: { // パスワードポリシー
        minLength: 8, // 最低8文字
        requireLowercase: true, // 小文字を含む必要がある
        requireUppercase: true, // 大文字を含む必要がある
        requireDigits: true, // 数字を含む必要がある
        requireSymbols: false, // 記号は必須ではない
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY, // アカウント復旧方法を Eメールのみに設定
    });

    // --- Cognito User Pool Client の作成 ---
    // フロントエンドアプリケーションがユーザープールと対話するためのクライアントを作成します。
    const userPoolClient = new cognito.UserPoolClient(this, 'ChatbotUserPoolClient', {
      userPool, // 対象のユーザープール
      authFlows: { // サポートする認証フロー
        userPassword: true, // ユーザー名とパスワードによる認証 (推奨されないが、互換性のために有効化)
        userSrp: true, // Secure Remote Password (SRP) プロトコルによる認証 (推奨)
      },
      generateSecret: false, // クライアントシークレットは生成しない (Public Client のため)
      oAuth: { // OAuth 2.0 設定
        flows: { // サポートする OAuth フロー
          implicitCodeGrant: true, // インプリシットコードグラントフロー (主に SPA で使用)
          authorizationCodeGrant: true, // 認可コードグラントフロー (より安全)
        },
        scopes: [ // 要求する OAuth スコープ
          cognito.OAuthScope.EMAIL, // Eメールアドレスへのアクセス
          cognito.OAuthScope.OPENID, // OpenID Connect 識別子
          cognito.OAuthScope.PROFILE, // プロファイル情報 (名前など) へのアクセス
        ],
        // 認証成功後にリダイレクトされる URL (初期値はローカル開発用)
        // 後で CloudFront の URL に更新されます。
        callbackUrls: ['http://localhost:3000'],
      },
      // クライアントが読み取り可能なユーザー属性
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        emailVerified: true,
        phoneNumber: true,
        fullname: true,
      }),
      // クライアントが書き込み可能なユーザー属性
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        phoneNumber: true,
        fullname: true,
      }),
    });

    // --- S3 バケットの作成 ---
    // フロントエンドの静的ファイル (HTML, CSS, JavaScript) をホストするための S3 バケットを作成します。
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      // パブリックアクセスをすべてブロック (CloudFront 経由でのみアクセスさせる)
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // CDK スタック削除時にバケットも削除する
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // CDK スタック削除時にバケット内のオブジェクトも自動削除する
      autoDeleteObjects: true,
      // CORS (Cross-Origin Resource Sharing) 設定
      // API Gateway など他のオリジンからのリクエストを許可するために必要になる場合がある
      cors: [
        {
          allowedHeaders: ['*'], // すべてのヘッダーを許可
          allowedMethods: [ // 許可する HTTP メソッド
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ['*'], // すべてのオリジンを許可 (本番環境ではより厳密に設定推奨)
          maxAge: 3000, // プリフライトリクエストの結果をキャッシュする時間 (秒)
        },
      ],
    });

    // --- CloudFront Distribution の作成 ---
    // S3 バケットのコンテンツを高速かつ安全に配信するための CDN (Content Delivery Network) を作成します。
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: { // デフォルトのキャッシュビヘイビア
        // オリジン (コンテンツの取得元) を先ほど作成した S3 バケットに設定
        origin: new origins.S3Origin(websiteBucket),
        // HTTP リクエストを HTTPS にリダイレクト
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // 許可する HTTP メソッド (GET, HEAD, OPTIONS)
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        // キャッシュする HTTP メソッド (GET, HEAD, OPTIONS)
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        // コンテンツを圧縮して転送量を削減
        compress: true,
      },
      // ルートディレクトリへのアクセス時に表示するデフォルトファイル
      defaultRootObject: 'index.html',
      // エラー発生時のカスタムエラーページ設定
      errorResponses: [
        { // アクセス権限がない場合 (403 Forbidden)
          httpStatus: 403,
          responseHttpStatus: 200, // レスポンスコードは 200 OK に変更
          responsePagePath: '/index.html', // index.html を表示 (React Router などで処理するため)
        },
        { // ファイルが見つからない場合 (404 Not Found)
          httpStatus: 404,
          responseHttpStatus: 200, // レスポンスコードは 200 OK に変更
          responsePagePath: '/index.html', // index.html を表示 (React Router などで処理するため)
        },
      ],
      // IPv6 を有効化
      enableIpv6: true,
    });

    // --- Cognito コールバック URL の更新 ---
    // CloudFront ディストリビューションが作成された後、そのドメイン名を Cognito User Pool Client の
    // コールバック URL に追加します。これにより、認証後のリダイレクトが正しく機能します。
    // distribution が作成されるのを待つための依存関係を設定
    userPoolClient.node.addDependency(distribution);

    // L2 Construct (userPoolClient) から L1 Construct (CfnUserPoolClient) を取得して直接プロパティを更新
    // L2 Construct のインターフェースでは callbackUrls の更新が直接サポートされていないため、
    // CloudFormation レベルのプロパティを操作します。
    const cfnUserPoolClient = userPoolClient.node.defaultChild as cognito.CfnUserPoolClient;
    cfnUserPoolClient.callbackUrLs = [
      `https://${distribution.distributionDomainName}`, // CloudFront の URL
      'http://localhost:3000', // ローカル開発用の URL も残す
    ];

    // --- Lambda 実行ロールの作成 ---
    // チャット処理を行う Lambda 関数が使用する IAM ロールを作成します。
    const lambdaRole = new iam.Role(this, 'ChatLambdaRole', {
      // このロールを引き受けることができるサービスプリンシパル (Lambda サービス)
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      // AWS 管理ポリシーをアタッチ (基本的な Lambda 実行権限)
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // --- Bedrock へのアクセス権限を追加 ---
    // Lambda 関数が Bedrock のモデルを呼び出すための権限を IAM ポリシーとしてロールに追加します。
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [ // 許可するアクション
        'bedrock:InvokeModel', // Bedrock モデルの同期呼び出し
        'bedrock:InvokeModelWithResponseStream' // Bedrock モデルのストリーミング呼び出し
      ],
      // すべての Bedrock リソースに対するアクセスを許可 (本番環境ではより限定的なリソース指定を推奨)
      resources: ['*']
    }));

    // --- チャット処理 Lambda 関数の作成 ---
    // ユーザーからのメッセージを受け取り、Bedrock モデルと対話して応答を返す Lambda 関数を作成します。
    const chatFunction = new lambda.Function(this, 'ChatFunction', {
      runtime: lambda.Runtime.PYTHON_3_10, // ランタイムとして Python 3.10 を使用
      handler: 'index.lambda_handler', // 実行するハンドラー関数 (index.py 内の lambda_handler 関数)
      // Lambda 関数のコードが格納されているディレクトリを指定
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(30), // タイムアウト時間を30秒に設定
      memorySize: 128, // メモリサイズを 128MB に設定
      role: lambdaRole, // 上で作成した IAM ロールを割り当て
      environment: { // 環境変数を設定
        // 使用する Bedrock モデル ID を Lambda 関数に渡す
        MODEL_ID: modelId,
      },
    });

    // --- Lambda 関数とロールの明示的な依存関係 ---
    // Lambda 関数 (CfnFunction) が IAM ロール (CfnRole) の作成後に作成されるように、
    // 明示的な依存関係を設定します。これにより、デプロイ時の問題を回避できます。
    const cfnChatFunction = chatFunction.node.defaultChild as lambda.CfnFunction;
    const cfnLambdaRole = lambdaRole.node.defaultChild as iam.CfnRole;
    cfnChatFunction.addDependsOn(cfnLambdaRole);

    // --- API Gateway の作成 ---
    // フロントエンドからのリクエストを受け付け、バックエンドの Lambda 関数をトリガーするための REST API を作成します。
    const api = new apigateway.RestApi(this, 'ChatbotApi', {
      restApiName: 'Bedrock Chatbot API', // API の名前
      description: 'API for Bedrock Converse chatbot', // API の説明
      // デフォルトの CORS プリフライトオプションを設定
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // すべてのオリジンからのリクエストを許可 (本番環境では CloudFront の URL に限定推奨)
        allowMethods: apigateway.Cors.ALL_METHODS, // すべての HTTP メソッドを許可
        // 許可するリクエストヘッダー
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true, // 資格情報 (Cookie など) の送信を許可
      },
    });

    // --- Cognito Authorizer の作成 ---
    // API Gateway へのリクエストを Cognito で認証するためのオーソライザーを作成します。
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ChatbotAuthorizer', {
      cognitoUserPools: [userPool], // 認証に使用するユーザープールを指定
    });

    // --- API Gateway リソースとメソッドの作成 ---
    // API のルートパス ('/') に '/chat' リソースを追加します。
    const chatResource = api.root.addResource('chat');
    // '/chat' リソースに POST メソッドを追加し、Lambda 関数と統合します。
    chatResource.addMethod('POST', // HTTP メソッド
      new apigateway.LambdaIntegration(chatFunction), // リクエストを chatFunction Lambda に統合
      { // メソッドのオプション
        authorizer, // Cognito オーソライザーを適用
        authorizationType: apigateway.AuthorizationType.COGNITO, // 認証タイプを Cognito に設定
      });

    // --- フロントエンド設定生成用 Lambda ロールの作成 ---
    // フロントエンド (React) が必要とする設定情報 (API エンドポイント、Cognito ID など) を
    // 動的に生成し、S3 にアップロードするための Lambda 関数が使用する IAM ロールを作成します。
    const configGeneratorRole = new iam.Role(this, 'ConfigGeneratorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'), // Lambda サービスが引き受ける
      managedPolicies: [ // 基本的な Lambda 実行権限
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // --- S3 と CloudFront へのアクセス権限を追加 ---
    // 設定生成 Lambda が S3 バケット (config.js の読み書き) と CloudFront (キャッシュ無効化) に
    // アクセスするための権限をロールに追加します。
    configGeneratorRole.addToPolicy(new iam.PolicyStatement({
      actions: [ // S3 アクション
        's3:GetObject', // index.html の取得
        's3:PutObject'  // config.js, index.html の書き込み
      ],
      resources: [ // 対象の S3 バケット内のオブジェクト
        `${websiteBucket.bucketArn}/*`
      ]
    }));

    configGeneratorRole.addToPolicy(new iam.PolicyStatement({
      actions: [ // CloudFront アクション
        'cloudfront:CreateInvalidation' // キャッシュ無効化の作成
      ],
      // すべての CloudFront ディストリビューションに対する権限 (より限定的な指定も可能)
      resources: ['*']
    }));

    // --- 設定生成用 Lambda 関数の作成 ---
    // CDK デプロイ時に実行され、フロントエンド用の設定ファイル (config.js) を生成し、
    // S3 にアップロード、および index.html を修正して config.js を読み込むようにする Lambda 関数。
    // CloudFront のキャッシュも無効化します。
    // この Lambda 関数はインラインコードで定義されています。
    const configGeneratorFunction = new lambda.Function(this, 'ConfigGeneratorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X, // Node.js 18.x ランタイムを使用
      handler: 'index.handler', // ハンドラー関数
      role: configGeneratorRole, // 上で作成した IAM ロールを使用
      // Lambda 関数のコード (インライン)
      code: lambda.Code.fromInline(`
        // AWS SDK v3 の S3 と CloudFront クライアントをインポート
        const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
        const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
        // Node.js の標準モジュール
        const fs = require('fs');
        const path = require('path');
        const https = require('https');
        const url = require('url');

        // Lambda ハンドラー関数
        exports.handler = async (event, context) => {
          console.log('Event:', JSON.stringify(event, null, 2)); // イベントログ出力

          try {
            // CloudFormation カスタムリソースの Delete イベントの場合は何もしない
            if (event.RequestType === 'Delete') {
              return await sendResponse(event, context, 'SUCCESS');
            }

            // CloudFormation カスタムリソースから渡されるプロパティを取得
            const {
              WebsiteBucketName, // フロントエンドの S3 バケット名
              ApiEndpoint,       // API Gateway のエンドポイント URL
              UserPoolId,        // Cognito ユーザープール ID
              UserPoolClientId,  // Cognito ユーザープールクライアント ID
              Region,            // デプロイリージョン
              FrontendSourcePath,// フロントエンドのビルドパス (現在は未使用)
              CloudFrontDistributionId // CloudFront ディストリビューション ID
            } = event.ResourceProperties;

            // S3 クライアントを初期化
            const s3Client = new S3Client({ region: Region });

            // フロントエンドで使用する設定情報オブジェクト (これは直接使われず、下の configJsContent で使用)
            const configContent = {
              REACT_APP_API_ENDPOINT: ApiEndpoint,
              REACT_APP_USER_POOL_ID: UserPoolId,
              REACT_APP_USER_POOL_CLIENT_ID: UserPoolClientId,
              REACT_APP_REGION: Region
            };

            // S3 にアップロードする config.js ファイルの内容を生成
            // グローバル変数 window.REACT_APP_CONFIG に設定値を格納
            const configJsContent = \`
              window.REACT_APP_CONFIG = {
                apiEndpoint: "\${ApiEndpoint}",
                userPoolId: "\${UserPoolId}",
                userPoolClientId: "\${UserPoolClientId}",
                region: "\${Region}"
              };
            \`;

            // 生成した config.js の内容を S3 バケットにアップロード
            await s3Client.send(new PutObjectCommand({
              Bucket: WebsiteBucketName,
              Key: 'config.js', // ファイル名
              Body: configJsContent, // ファイル内容
              ContentType: 'application/javascript' // Content-Type を指定
            }));
            console.log('Uploaded config.js to S3');

            // S3 にデプロイされた index.html を取得して修正
            try {
              const indexHtmlResponse = await s3Client.send(new GetObjectCommand({
                Bucket: WebsiteBucketName,
                Key: 'index.html'
              }));

              // レスポンスボディ (Stream) を文字列に変換
              const bodyContents = await streamToString(indexHtmlResponse.Body);
              let indexHtml = bodyContents;

              // index.html に config.js を読み込む script タグがまだなければ追加
              if (!indexHtml.includes('config.js')) {
                // </head> タグの直前に script タグを挿入
                indexHtml = indexHtml.replace('</head>', '<script src="/config.js"></script></head>');

                // 修正した index.html を S3 にアップロードして上書き
                await s3Client.send(new PutObjectCommand({
                  Bucket: WebsiteBucketName,
                  Key: 'index.html',
                  Body: indexHtml,
                  ContentType: 'text/html'
                }));
                console.log('Modified and uploaded index.html');
              }
            } catch (error) {
              // index.html の処理中にエラーが発生した場合 (例: ファイルが存在しない)
              console.log('Error processing index.html:', error);
              // エラーを無視して続行 (S3 デプロイが完了していない可能性があるため)
            }

            // CloudFront のキャッシュを無効化 (config.js と index.html)
            if (CloudFrontDistributionId) {
              const cloudfrontClient = new CloudFrontClient({ region: Region });
              await cloudfrontClient.send(new CreateInvalidationCommand({
                DistributionId: CloudFrontDistributionId,
                InvalidationBatch: {
                  CallerReference: Date.now().toString(), // ユニークな参照文字列
                  Paths: { // 無効化するパス
                    Quantity: 2,
                    Items: ['/index.html', '/config.js']
                  }
                }
              }));
              console.log('Created CloudFront invalidation');
            }

            // CloudFormation に成功応答を送信
            return await sendResponse(event, context, 'SUCCESS');
          } catch (error) {
            // エラーが発生した場合
            console.error('Error:', error);
            // CloudFormation に失敗応答を送信
            return await sendResponse(event, context, 'FAILED', { Error: error.message });
          }
        };

        // ReadableStream を文字列に変換するヘルパー関数
        async function streamToString(stream) {
          return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            stream.on('error', reject);
          });
        }

        // CloudFormation カスタムリソースに HTTP PUT で応答を送信するヘルパー関数
        async function sendResponse(event, context, status, data = {}) {
          // 応答ボディを作成
          const responseBody = {
            Status: status, // SUCCESS または FAILED
            Reason: data.Error || 'See CloudWatch logs for details', // 理由 (エラーメッセージなど)
            PhysicalResourceId: context.logStreamName, // 物理リソース ID
            StackId: event.StackId, // スタック ID
            RequestId: event.RequestId, // リクエスト ID
            LogicalResourceId: event.LogicalResourceId, // 論理リソース ID
            Data: data // その他のデータ
          };

          console.log('Sending response:', JSON.stringify(responseBody));

          // CloudFormation から提供された署名付き URL (event.ResponseURL) に PUT リクエストを送信
          return new Promise((resolve, reject) => {
            const parsedUrl = url.parse(event.ResponseURL);
            const options = {
              hostname: parsedUrl.hostname,
              port: 443,
              path: parsedUrl.path,
              method: 'PUT',
              headers: {
                'Content-Type': '', // Content-Type は空にする必要がある
                'Content-Length': Buffer.byteLength(JSON.stringify(responseBody))
              }
            };

            const req = https.request(options, (res) => {
              console.log(\`Response status code: \${res.statusCode}\`);
              resolve(); // レスポンス受信で Promise を解決
            });

            req.on('error', (error) => {
              console.error('Error sending response:', error);
              reject(error); // エラー発生で Promise を拒否
            });

            // リクエストボディを書き込み、リクエストを終了
            req.write(JSON.stringify(responseBody));
            req.end();
          });
        }
      `),
      timeout: cdk.Duration.minutes(5), // タイムアウトを5分に設定 (S3 操作や CF 無効化に時間がかかる場合があるため)
      memorySize: 512, // メモリサイズを 512MB に設定
      environment: { // 環境変数
        // Node.js でソースマップを有効にする (デバッグ用)
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // --- 設定生成 Lambda とロールの明示的な依存関係 ---
    // 設定生成 Lambda (CfnFunction) がその IAM ロール (CfnRole) の作成後に作成されるように依存関係を設定
    const cfnConfigFunction = configGeneratorFunction.node.defaultChild as lambda.CfnFunction;
    const cfnConfigRole = configGeneratorRole.node.defaultChild as iam.CfnRole;
    cfnConfigFunction.addDependsOn(cfnConfigRole);

    // --- カスタムリソースプロバイダーの作成 ---
    // 上記の設定生成 Lambda 関数を CloudFormation カスタムリソースとして
    // 呼び出すためのプロバイダーを作成します。
    const configProvider = new cr.Provider(this, 'ConfigProvider', {
      onEventHandler: configGeneratorFunction, // イベントハンドラーとして設定生成 Lambda を指定
      logRetention: logs.RetentionDays.ONE_DAY, // プロバイダーのログ保持期間を1日に設定
    });

    // --- カスタムリソースの作成 ---
    // 実際に CloudFormation デプロイメントプロセス中に設定生成 Lambda を呼び出すカスタムリソースを作成します。
    const configResource = new cdk.CustomResource(this, 'ConfigResource', {
      serviceToken: configProvider.serviceToken, // プロバイダーのサービス ARN を指定
      properties: { // 設定生成 Lambda に渡すプロパティ
        WebsiteBucketName: websiteBucket.bucketName, // S3 バケット名
        ApiEndpoint: `${api.url}chat`, // API Gateway のチャットエンドポイント URL
        UserPoolId: userPool.userPoolId, // Cognito ユーザープール ID
        UserPoolClientId: userPoolClient.userPoolClientId, // Cognito クライアント ID
        Region: this.region, // デプロイ先のリージョン
        FrontendSourcePath: '../frontend/build', // フロントエンドのビルドパス (Lambda 内では現在未使用)
        CloudFrontDistributionId: distribution.distributionId, // CloudFront ディストリビューション ID
        // タイムスタンプ: この値が変わるとカスタムリソースが再実行されるため、
        // デプロイごとに Lambda が実行されるように現在時刻の ISO 文字列を追加します。
        Timestamp: new Date().toISOString(),
      },
    });

    // --- S3 バケットへのフロントエンドファイルのデプロイ ---
    // ローカルの '../frontend/build' ディレクトリにあるビルド済みフロントエンドファイルを
    // S3 バケットにアップロードします。
    const websiteDeployment = new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      // デプロイ元 (ビルドされた React アプリ)
      sources: [s3deploy.Source.asset(path.join(__dirname, '../frontend/build'))],
      // デプロイ先の S3 バケット
      destinationBucket: websiteBucket,
      // デプロイ後にキャッシュを無効化する CloudFront ディストリビューションを指定
      distribution,
      // 無効化するパス (すべてのファイル)
      distributionPaths: ['/*'],
    });

    // --- カスタムリソースと S3 デプロイの依存関係設定 ---
    // S3 へのファイルデプロイ (websiteDeployment) が完了した後に、
    // 設定生成カスタムリソース (configResource) が実行されるように依存関係を設定します。
    // これにより、Lambda が index.html を見つけられない問題を回避します。
    configResource.node.addDependency(websiteDeployment);

    // --- CloudFormation Outputs (出力) ---
    // CDK デプロイ完了後にコンソールに表示される値。アプリケーションへのアクセスや設定に利用します。

    // CloudFront の URL を出力
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'The URL of the CloudFront distribution',
    });

    // API Gateway のベース URL を出力
    new cdk.CfnOutput(this, 'ApiGatewayURL', {
      value: api.url,
      description: 'The URL of the API Gateway endpoint',
    });

    // 使用されている Bedrock モデル ID を出力
    new cdk.CfnOutput(this, 'ModelId', {
      value: modelId,
      description: 'The Bedrock model ID being used',
    });

    // Cognito ユーザープール ID を出力
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'The ID of the Cognito User Pool',
    });

    // Cognito ユーザープールクライアント ID を出力
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'The ID of the Cognito User Pool Client',
    });
  } // constructor の終わり
} // BedrockChatbotStack クラスの終わり