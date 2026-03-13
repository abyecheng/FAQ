from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import AzureOpenAI
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Disable CORS. Do not remove this for full-stack development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# FAQ data for context
FAQ_DATA = [
    {
        "question": "導入メリット・効果について知りたい",
        "answer": "PKSHA社の事例では、問い合わせの5割を自動化することで、年間約3.5億円のコスト削減に成功されています。また、電話問い合わせの窓口を段階的に縮小できた事例もございます。"
    },
    {
        "question": "AIヘルプデスクのユーザーのアクセス権管理はどのように行いますか？",
        "answer": "各ユーザーに個別のIDを発行し、利用者を特定可能。システム管理者向けのアカウント管理機能があり、管理画面を通じて個別IDの発行や権限割当を実施。接続元IPアドレスによる接続経路の制限や、デバイス認証、MACアドレス制限が可能。多要素認証やリスクベース認証、シングルサインオン（SSO）を利用可能。ログイン試行回数に応じたアカウントロック機能あり。"
    },
    {
        "question": "問合せする際に画像は使用できますか？",
        "answer": "チャットボットでは画像の判断はできません。ただし、有人連携した際は担当者と画像でのやり取りも可能です。"
    },
    {
        "question": "有人連携後、担当者から返信されたときに通知はきますか？",
        "answer": "担当者から返信がされたときTeams上で通知がきます。なお、Teamsの設定状態により通知が来ない場合もございます。"
    },
    {
        "question": "オンプレミスでの提供は可能ですか？",
        "answer": "Microsoft Teams上で動作するクラウドサービスです。金融機関様、エンタープライズの企業様での導入実績も多くございます。セキュリティ要件につきましては、お客様先審査項目に合わせて回答をさせて頂きます。"
    },
    {
        "question": "情報セキュリティに関する組織体制はありますか",
        "answer": "情報セキュリティ委員会を設置しています。"
    },
    {
        "question": "従業員に対するセキュリティ教育を定期的に実施していますか",
        "answer": "年次で全従業員にセキュリティ教育を実施しています。"
    },
    {
        "question": "ユーザデータを格納する領域にて採用している暗号化アルゴリズム及びその鍵長について",
        "answer": "アルゴリズム：AES。鍵長：256ビット"
    },
    {
        "question": "他社テナントからのアクセス制御方法について",
        "answer": "１．論理的分離　２．マルチテナント　３．具体的なアクセス制御方法：IPアドレス制限が可能"
    },
    {
        "question": "AIヘルプデスクの導入プロセスについて",
        "answer": "一般的なチャットボットと異なり、FAQは有人チャットを運用しながら自動生成可能なため、検索対象としたいドキュメントを設定し、Teamsアプリをインストール頂ければ、即日利用可能です。"
    },
]

SYSTEM_PROMPT = """あなたは「AIヘルプデスク（Microsoft Teams上で動作するクラウドサービス）」に関する案内ロボットです。

以下のFAQデータに基づいて、お客様の質問に丁寧かつ自然な日本語で回答してください。

【回答ルール】
1. FAQデータに関連する情報がある場合は、その内容を基に自然な口語調で回答してください。箇条書きではなく、話し言葉で説明してください。
2. FAQデータに該当する情報がない場合は、必ず「確認が必要なため、AICの担当者に引き継ぎます。」と回答してください。
3. 回答は簡潔にしつつも、丁寧で親しみやすい口調を心がけてください。
4. 「はい、〜についてですね。」のような前置きを入れて、自然な会話の流れを作ってください。
5. 回答は音声で読み上げられるため、読みやすく自然な文章にしてください。長すぎないようにしてください。

【FAQデータ】
"""

# Build FAQ context
FAQ_CONTEXT = "\n".join(
    [f"Q{i+1}: {faq['question']}\nA{i+1}: {faq['answer']}\n" for i, faq in enumerate(FAQ_DATA)]
)


# Static files directory (frontend build output)
STATIC_DIR = Path(__file__).parent.parent / "static"


class QuestionRequest(BaseModel):
    question: str


class AnswerResponse(BaseModel):
    answer: str
    source: str  # "llm" or "fallback"


def get_openai_client() -> AzureOpenAI:
    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")
    if not api_key or not endpoint:
        raise ValueError("AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT must be set")
    return AzureOpenAI(
        api_key=api_key,
        azure_endpoint=endpoint,
        api_version=api_version,
    )


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.post("/api/ask", response_model=AnswerResponse)
async def ask_question(request: QuestionRequest):
    try:
        client = get_openai_client()

        full_system_prompt = SYSTEM_PROMPT + FAQ_CONTEXT

        response = client.chat.completions.create(
            model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
            messages=[
                {"role": "system", "content": full_system_prompt},
                {"role": "user", "content": request.question},
            ],
            temperature=0.7,
            max_tokens=500,
        )

        answer = response.choices[0].message.content or "確認が必要なため、AICの担当者に引き継ぎます。"

        return AnswerResponse(answer=answer, source="llm")
    except Exception as e:
        print(f"OpenAI API error: {e}")
        return AnswerResponse(
            answer="申し訳ございません。システムに一時的な問題が発生しております。しばらくしてからもう一度お試しください。",
            source="fallback"
        )


# Serve frontend static files (SPA fallback)
if STATIC_DIR.exists():
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        # SPA fallback: return index.html for all non-file routes
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return {"error": "not found"}
