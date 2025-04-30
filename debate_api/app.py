import os
import torch
from transformers import pipeline
import time
import traceback
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import uvicorn
import nest_asyncio
from pyngrok import ngrok

# モデル設定
MODEL_NAME = "google/gemma-2-2b-jpn-it"

class Config:
    def __init__(self, model_name=MODEL_NAME):
        self.MODEL_NAME = model_name

config = Config(MODEL_NAME)

# FastAPIアプリケーション
app = FastAPI(
    title="ディベートアシスタントAPI",
    description="ディベート支援のための特化型LLM API",
    version="1.0.0"
)

# CORSミドルウェア
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# データモデル
class DebateArgument(BaseModel):
    topic: str
    stance: str  # 肯定/否定
    context: Optional[str] = None
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.7

class EvidenceAnalysis(BaseModel):
    evidence: str
    perspective: Optional[str] = None
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.7

class CounterArgument(BaseModel):
    argument: str
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.7

class DebateResponse(BaseModel):
    generated_text: str
    response_time: float

# グローバル変数
model = None

def load_model():
    """モデルの読み込み"""
    global model
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"使用デバイス: {device}")
        pipe = pipeline(
            "text-generation",
            model=config.MODEL_NAME,
            model_kwargs={"torch_dtype": torch.bfloat16},
            device=device
        )
        model = pipe
        return pipe
    except Exception as e:
        print(f"モデル読み込みエラー: {e}")
        traceback.print_exc()
        return None

# 起動時の初期化
@app.on_event("startup")
async def startup_event():
    load_model()

# ヘルスチェック
@app.get("/health")
async def health_check():
    if model is None:
        return {"status": "error", "message": "モデルが読み込まれていません"}
    return {"status": "ok", "model": config.MODEL_NAME}

# 議論生成エンドポイント
@app.post("/generate_argument", response_model=DebateResponse)
async def generate_argument(request: DebateArgument):
    if model is None:
        raise HTTPException(status_code=503, detail="モデルが利用できません")

    try:
        start_time = time.time()
        
        prompt = f"""以下のトピックについて、{request.stance}の立場から説得力のある議論を展開してください。

トピック: {request.topic}
{f'コンテキスト: {request.context}' if request.context else ''}

以下の要素を含めて議論を構築してください：
1. 主張
2. 根拠（データや具体例）
3. 論理的な説明
4. 想定される反論への対応

議論："""

        outputs = model(
            prompt,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            do_sample=True
        )

        response = outputs[0]["generated_text"].split("議論：")[-1].strip()
        
        return DebateResponse(
            generated_text=response,
            response_time=time.time() - start_time
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 証拠分析エンドポイント
@app.post("/analyze_evidence", response_model=DebateResponse)
async def analyze_evidence(request: EvidenceAnalysis):
    if model is None:
        raise HTTPException(status_code=503, detail="モデルが利用できません")

    try:
        start_time = time.time()
        
        prompt = f"""以下の証拠を分析し、その強みと弱み、ディベートでの活用方法を評価してください。

証拠: {request.evidence}
{f'視点: {request.perspective}' if request.perspective else ''}

以下の観点から分析してください：
1. 信頼性
2. 関連性
3. 説得力
4. 想定される反論
5. 活用戦略

分析："""

        outputs = model(
            prompt,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            do_sample=True
        )

        response = outputs[0]["generated_text"].split("分析：")[-1].strip()
        
        return DebateResponse(
            generated_text=response,
            response_time=time.time() - start_time
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 反論生成エンドポイント
@app.post("/generate_counter", response_model=DebateResponse)
async def generate_counter(request: CounterArgument):
    if model is None:
        raise HTTPException(status_code=503, detail="モデルが利用できません")

    try:
        start_time = time.time()
        
        prompt = f"""以下の議論に対する効果的な反論を生成してください。

元の議論: {request.argument}

以下の要素を含めて反論を構築してください：
1. 主張の弱点の指摘
2. 論理的な反証
3. 代替的な解釈や証拠の提示
4. 結論

反論："""

        outputs = model(
            prompt,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            do_sample=True
        )

        response = outputs[0]["generated_text"].split("反論：")[-1].strip()
        
        return DebateResponse(
            generated_text=response,
            response_time=time.time() - start_time
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ngrokでの実行
def run_with_ngrok(port=8501):
    nest_asyncio.apply()
    
    ngrok_token = os.environ.get("NGROK_TOKEN")
    if not ngrok_token:
        print("NGROK_TOKENが設定されていません")
        return

    try:
        ngrok.set_auth_token(ngrok_token)
        public_url = ngrok.connect(port).public_url
        print(f"公開URL: {public_url}")
        print(f"APIドキュメント: {public_url}/docs")
        uvicorn.run(app, host="0.0.0.0", port=port)
    except Exception as e:
        print(f"エラー: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    run_with_ngrok(port=8501) 