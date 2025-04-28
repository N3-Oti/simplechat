# lambda/index.py
# このファイルは、AWS Lambda上で動作するチャットボットのバックエンド処理を実装しています。
# Amazon API Gateway からのリクエストを受け取り、Amazon Bedrock を使用して、
# ユーザーのメッセージに対して AI アシスタント (LLM) の応答を生成します。

# --- ライブラリのインポート ---
import json  # JSON 形式のデータのエンコード・デコードに使用
import os  # 環境変数へのアクセスに使用 (例: Bedrock モデル ID の取得)
import urllib.request  # 標準ライブラリを使用して HTTP リクエストを送信
import urllib.error  # HTTP エラーを処理するために使用
# import boto3  # AWS SDK for Python (Boto3)。AWS サービス (Bedrock など) との連携に使用
import re  # 正規表現ライブラリ。Lambda 関数の ARN からリージョンを抽出するために使用

from botocore.exceptions import ClientError  # Boto3 のクライアントエラーを捕捉するために使用


# --- ヘルパー関数: ARN からリージョンを抽出 ---
# Lambda 関数の ARN (Amazon Resource Name) から、その関数がデプロイされている AWS リージョン名を抽出します。
# ARN の例: arn:aws:lambda:ap-northeast-1:123456789012:function:my-function
def extract_region_from_arn(arn):
    """
    Lambda 関数の ARN 文字列から AWS リージョン名を抽出します。

    Args:
        arn (str): Lambda 関数の ARN。

    Returns:
        str: 抽出されたリージョン名。抽出できない場合は 'us-east-1' を返します。
    """
    # 正規表現パターン: "arn:aws:lambda:" の後に続く、コロン(:)以外の文字が1回以上繰り返される部分をキャプチャ
    match = re.search(r"arn:aws:lambda:([^:]+):", arn)
    if match:
        # マッチした場合、キャプチャグループ 1 (リージョン名) を返す
        return match.group(1)
    # マッチしない場合 (ARN の形式が予期しない場合など) は、デフォルトリージョン 'us-east-1' を返す
    return "us-east-1"


# --- グローバル変数 ---
# Bedrock ランタイムクライアントのインスタンスを格納するグローバル変数。
# Lambda の実行環境 (コンテナ) が再利用される場合に、クライアントの初期化コストを削減するため。
# API_URL（Google Colabで立てたAPI）
# bedrock_client = None
API_URL = "https://7174-104-196-208-216.ngrok-free.app"

# 使用する Bedrock モデルの ID を環境変数 'MODEL_ID' から取得します。
# 環境変数が設定されていない場合は、デフォルト値 'us.amazon.nova-lite-v1:0' を使用します。
# この環境変数は、AWS CDK スタック (`lib/bedrock-chatbot-stack.ts`) で Lambda 関数に設定されます。
# MODEL_ID = os.environ.get("MODEL_ID", "us.amazon.nova-lite-v1:0")


# --- Lambda 関数ハンドラー ---
# この関数が Lambda の実行時に呼び出されます。
# API Gateway (Proxy Integration) からのイベントを受け取り、処理結果を返します。
def lambda_handler(event, context):
    """
    Lambda 関数のメインエントリーポイント。
    API Gateway からの POST リクエストを処理し、Bedrock モデルと対話して応答を返します。

    Args:
        event (dict): API Gateway から渡されるイベントデータ。リクエストボディ、ヘッダー、認証情報などが含まれます。
        context (object): Lambda 関数の実行コンテキスト情報。関数名、ARN、ログストリーム名などが含まれます。

    Returns:
        dict: API Gateway に返すレスポンス。statusCode, headers, body を含みます。
    """
    try:
        """
        # --- Bedrock クライアントの初期化 (初回呼び出しか、コンテナ再利用時) ---
        global bedrock_client
        if bedrock_client is None:
            # Lambda 関数の ARN を実行コンテキストから取得
            function_arn = context.invoked_function_arn
            # ARN からリージョン名を抽出
            region = extract_region_from_arn(function_arn)
            # 抽出したリージョンで Bedrock ランタイムクライアントを初期化
            # "bedrock-runtime" はモデル呼び出し用のサービスエンドポイントです。
            bedrock_client = boto3.client("bedrock-runtime", region_name=region)
            # 初期化ログを出力
            print(f"Initialized Bedrock client in region: {region}")
        """
        # --- イベントデータのログ出力 (デバッグ用) ---
        # 受信したイベント全体を JSON 形式で CloudWatch Logs に出力します。
        print("Received event:", json.dumps(event))

        # --- Cognito 認証情報の取得 ---
        # API Gateway の Cognito オーソライザーによって検証されたユーザー情報を取得します。
        user_info = None
        # イベントデータに必要なキーが存在するかチェック
        if "requestContext" in event and "authorizer" in event["requestContext"]:
            # authorizer.claims にユーザーの属性情報 (クレーム) が含まれています。
            user_info = event["requestContext"]["authorizer"]["claims"]
            # 認証されたユーザーの Eメール または Cognito ユーザー名 をログに出力
            print(f"Authenticated user: {user_info.get('email') or user_info.get('cognito:username')}")
        # else: # 認証情報がない場合の処理 (今回は特に何もしない)
        #     print("No authentication information found.")

        # --- リクエストボディの解析 ---
        # API Gateway からのイベントボディ (文字列) を JSON オブジェクトにパースします。
        body = json.loads(event["body"])
        # ユーザーが入力したメッセージを取得
        message = body["message"]
        # これまでの会話履歴 (フロントエンドから送信される) を取得。
        # 存在しない場合は空のリスト [] をデフォルト値とします。
        conversation_history = body.get("conversationHistory", [])

        # --- デバッグ情報の出力 ---
        print(f"Processing message: '{message}'")
        # print(f"Using model: {MODEL_ID}")
        print(f"Received conversation history length: {len(conversation_history)}")

        # --- 会話履歴の準備 ---
        # フロントエンドから受け取った会話履歴をコピーして、今回の対話を追加します。
        messages = conversation_history.copy()

        # 現在のユーザーメッセージを会話履歴リストに追加
        # 形式: {"role": "user", "content": "ユーザーメッセージ"}
        messages.append({"role": "user", "content": message})

        """
        # --- Bedrock API 用のメッセージ形式に変換 ---
        # Bedrock の Converse API (InvokeModel) は特定のメッセージ形式を要求します。
        # (例: Amazon Titan, Claude, Llama など、モデルによって形式が異なる場合がある)
        # ここでは、想定されるモデル (例: Amazon Titan Lite/Premier) に合わせた形式に変換しています。
        # 各メッセージの "content" はリスト形式で、その中に "text" キーを持つ辞書を入れる必要があります。
        bedrock_messages = []
        for msg in messages:
            if msg["role"] == "user":
                bedrock_messages.append({"role": "user", "content": [{"text": msg["content"]}]})
            elif msg["role"] == "assistant":
                # アシスタント (モデル) の応答も同様の形式に変換
                bedrock_messages.append({"role": "assistant", "content": [{"text": msg["content"]}]})
            # 他のロール (例: system) がある場合はここに追加
        """

        # --- FASTAPI リクエストペイロードの構築 ---
        request_payload = {
            "prompt": message,  # ユーザーメッセージをプロンプトとして送信
            "max_new_tokens": 512,  # 最大トークン数
            "do_sample": True,  # サンプリングの使用
            "temperature": 0.7,  # 温度パラメータ
            "top_p": 0.9  # top_pパラメータ
        }

        """
        # --- Bedrock API リクエストペイロードの構築 ---
        # Bedrock の invoke_model API に送信するリクエストボディを作成します。
        request_payload = {
            "messages": bedrock_messages,  # 変換後のメッセージリスト
            "inferenceConfig": {  # 推論パラメータの設定
                "maxTokens": 512,  # 生成される応答の最大トークン数
                "stopSequences": [],  # 生成を停止する特定の文字列シーケンス (今回はなし)
                "temperature": 0.7,  # 応答のランダム性を制御 (0.0 で決定的、1.0 でよりランダム)
                "topP": 0.9,  # Top-P サンプリング。確率の高いトークンから累積確率が P に達するまでを選択肢とする
            },
            # "additionalModelRequestFields": {} # モデル固有の追加パラメータがあればここに記述
        }
        """
        # --- FASTAPIの呼び出し ---
        print("Calling FAST_API with payload:", json.dumps(request_payload))

        """

        # --- Bedrock API の呼び出し ---
        print("Calling Bedrock invoke_model API with payload:", json.dumps(request_payload))
        # bedrock_client を使用して invoke_model API を呼び出します。
        response = bedrock_client.invoke_model(
            modelId=MODEL_ID,  # 使用するモデルの ID
            body=json.dumps(request_payload),  # リクエストペイロード (JSON 文字列)
            contentType="application/json",  # リクエストボディの Content-Type
        )
        print("Bedrock API call successful.")
        """

        # --- レスポンスの解析 ---
        # API からのレスポンスボディ (ストリーミングオブジェクト) を読み取り、JSON オブジェクトにパースします。
        #response_body = json.loads(response["body"].read())
        # 解析したレスポンスボディをログに出力 (デバッグ用)
        # default=str は datetime オブジェクトなど JSON シリアライズできない型を文字列に変換するため
        #print("Bedrock response:", json.dumps(response_body, default=str))
        print("FAST_API response:", json.dumps(response_payload, default=str))
        # --- レスポンス内容の検証 ---
        # Bedrock からの応答に必要なキーが存在するかを確認します。
        # モデルや状況によっては期待した形式で応答が返らない可能性があるため。
        """
        if (
            not response_body.get("output")  # "output" キーが存在しない
            or not response_body["output"].get("message")  # "output.message" キーが存在しない
            or not response_body["output"]["message"].get("content")  # "output.message.content" キーが存在しない
            or not isinstance(response_body["output"]["message"]["content"], list)  # content がリストでない
            or len(response_body["output"]["message"]["content"]) == 0  # content リストが空
            or not response_body["output"]["message"]["content"][0].get(
                "text"
            )  # content リストの最初の要素に "text" キーがない
        ):
        """
            # 期待した形式でない場合はエラーを発生させる
            print("Error: Unexpected response structure from Bedrock model.")
            raise Exception("No valid response content received from the model")

        # --- アシスタントの応答を取得 ---
        # レスポンスボディからアシスタント (モデル) が生成したテキスト応答を抽出します。
        assistant_response = response_body["output"]["message"]["content"][0]["text"]
        print(f"Assistant response: '{assistant_response}'")

        # --- 会話履歴の更新 ---
        # アシスタントの応答を、フロントエンドに返すための会話履歴リストに追加します。
        # 形式: {"role": "assistant", "content": "アシスタントの応答"}
        messages.append({"role": "assistant", "content": assistant_response})

        # --- 成功レスポンスの返却 ---
        # API Gateway に返す成功レスポンス (HTTP 200 OK) を構築します。
        print("Returning successful response.")
        return {
            "statusCode": 200,
            "headers": {
                # CORS (Cross-Origin Resource Sharing) ヘッダーを設定
                # これにより、異なるオリジン (CloudFront ドメイン) で動作するフロントエンドからの
                # API 呼び出しがブラウザによって許可されます。
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",  # すべてのオリジンを許可 (本番環境ではより厳密に設定推奨)
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",  # 許可するリクエストヘッダー
                "Access-Control-Allow-Methods": "OPTIONS,POST",  # 許可する HTTP メソッド (OPTIONS はプリフライトリクエスト用)
            },
            # レスポンスボディ (JSON 文字列)
            "body": json.dumps(
                {
                    "success": True,  # 処理成功フラグ
                    "response": assistant_response,  # アシスタントの応答メッセージ
                    "conversationHistory": messages,  # 更新された会話履歴全体
                }
            ),
        }

    except Exception as error:
        # --- エラー発生時の処理 ---
        # try ブロック内で発生した例外を捕捉します。
        print(f"Error occurred: {type(error).__name__} - {str(error)}")
        import traceback

        traceback.print_exc()  # スタックトレースをログに出力

        # エラーレスポンス (HTTP 500 Internal Server Error) を構築します。
        return {
            "statusCode": 500,
            "headers": {
                # エラーレスポンスにも CORS ヘッダーを含めることが重要
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "OPTIONS,POST",
            },
            # レスポンスボディ (JSON 文字列)
            "body": json.dumps(
                {
                    "success": False,  # 処理失敗フラグ
                    "error": f"{type(error).__name__}: {str(error)}",  # エラーの型とメッセージ
                }
            ),
        }
