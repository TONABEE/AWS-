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
import requests
from bs4 import BeautifulSoup

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

class EvidenceFromUrl(BaseModel):
    url: str
    topic: Optional[str] = None
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.7

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
        
        prompt = f"""Given the topic: {request.topic}, and taking the {request.stance} stance, please construct a persuasive argument for a debate round, keeping the judge as your primary audience.

{f'Context: {request.context}' if request.context else ''}

Structure your argument clearly using **Labeling** and **Numbering** for the judge. Include the following elements:

1.  **Claim:** The main point you want the judge to accept.
2.  **Reason(s):** The data, examples, or facts supporting your claim.
3.  **Warrant:** Explain the logical connection showing how your reason(s) prove your claim. (Explain why the Reason is true and why it supports the Claim) [9, 10].
4.  **Impact:** Explain the significance or consequence of your claim being true (e.g., the severity of a problem, the magnitude of a benefit) [12-14].
5.  **Addressing Potential Counter-Arguments:** Briefly explain why anticipated attacks against this specific argument are not persuasive, structuring your response to each potential attack by first stating your conclusion and then your reasoning [17].

If this argument is a main Affirmative Advantage (AD), also ensure it clearly demonstrates **Inherency** (the problem exists in the status quo) and **Solvency** (the plan resolves the problem) [12, 13].

If this argument is a main Negative Disadvantage (DA), also ensure it clearly demonstrates **Uniqueness** (the problem does not happen in the status quo) and **Linkage** (the plan causes the problem) [14].
""
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
        
        prompt = f"""Analyze the following evidence for potential use in a debate round, considering the judge's perspective.

Evidence: {request.evidence}
{f'Perspective: {request.perspective}' if request.perspective else ''}

Evaluate the evidence from the following perspectives:

1.  **Reliability:** Assess the source's credibility based on the author's **Authority** (Name, Title/Position), publication **Year**, and the **Source/Publisher** (where it was published) [18]. Consider the **Context** and any explicit or implicit **Assumptions** within the evidence that might limit its applicability [19].
2.  **Relevance:** How directly does this evidence support a potential claim or specific component of an argument (e.g., Inherency, Impact, Solvency for AFF; Uniqueness, Linkage, Impact for NEG)? [12-14]
3.  **Persuasiveness:** How likely is this evidence to convince the judge? Does it provide sufficient detail or come from a highly respected source? [23, 24]
4.  **Anticipated Rebuttals:** What attacks could the opponent make against this evidence? (e.g., challenging the source's authority, questioning its recency, pointing out limiting assumptions or context) [19].
5.  **Utilization Strategy:** How and where in a debate round would this evidence be most effectively used? (e.g., to support a specific sub-point within an AD or DA during a Constructive speech, cited verbally as per debate norms) [18, 21-23].

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
        
        prompt = f"""Generate an effective refutation against the following argument for a debate round, structured for clarity for the judge:

Original Argument: {request.argument}

Structure your refutation as follows, using **Labeling** and **Numbering** if necessary:

1.  **Sign Posting:** Clearly indicate which specific argument you are responding to (e.g., "Going to their first Advantage, Solvency...") [17].
2.  **Confirmation:** Briefly restate the opponent's claim or the specific point you are refuting (e.g., "...they said their plan solves the problem.") [17].
3.  **Conclusion/Label:** State your refutation point clearly and concisely, potentially using a standard debate label if applicable (e.g., "However, No Solvency.") [17, 25].
4.  **Reasoning:** Provide the logical explanation and evidence (if any) why your conclusion is true and why their argument is flawed. Focus on attacking the **Reasoning** or **Warrant** that connects their claim to their support [9, 26].
    *   Consider presenting alternative interpretations or evidence that contradict their point [21].
5.  **Evaluation:** Explain the consequence of your refutation for the opponent's argument and the debate round (e.g., "Therefore, their Solvency is zero," or "This means their Advantage is completely defeated," or "Their DA has no Uniqueness") [17, 25].
6.  **Identify Type (Optional but helpful):** Briefly explain if this refutation is a "crushing" argument (completely defeats the point) or a "partial" argument (weakens the point) [27].

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

# --- FastAPIルーティング部に追加（他の @app.post の後）---
@app.post("/generate_evidence_from_url", response_model=DebateResponse)
async def generate_evidence_from_url(request: EvidenceFromUrl):
    if model is None:
        raise HTTPException(status_code=503, detail="モデルが利用できません")

    try:
        start_time = time.time()

        # Webページ取得
        response = requests.get(request.url, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        title = soup.title.string.strip() if soup.title else "No Title"
        paragraphs = soup.find_all("p")
        full_text = "\n".join([p.get_text() for p in paragraphs if p.get_text().strip() != ""])[:3000]

        # モデルプロンプト
        prompt = f"""
Extract usable evidence from the following article for an academic debate. Format it as a Pass Card:

Article Title: {title}
URL: {request.url}

Article Text:
\"\"\"
{full_text}
\"\"\"

Please extract one strong quote and structure the output as follows:

[Claim/Assertion: (a concise summary of what the quote supports)]
"(Direct Quote from the source)"
Author: (If available)
Title/Position: (If available)
Year: (Try to infer from metadata or content, approximate if needed)
Source/Publisher: (Use website title or organization name)
URL: {request.url}
"""

        outputs = model(
            prompt,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            do_sample=True
        )

        generated_pass_card = outputs[0]["generated_text"].strip()

        return DebateResponse(
            generated_text=generated_pass_card,
            response_time=time.time() - start_time
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"エビデンス生成中にエラーが発生しました: {str(e)}")


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