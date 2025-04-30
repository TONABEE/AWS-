interface DebateResponse {
  generated_text: string;
  response_time: number;
}

interface DebateArgument {
  topic: string;
  stance: string;
  context?: string;
  max_tokens?: number;
  temperature?: number;
}

interface EvidenceAnalysis {
  evidence: string;
  perspective?: string;
  max_tokens?: number;
  temperature?: number;
}

interface CounterArgument {
  argument: string;
  max_tokens?: number;
  temperature?: number;
}

export class DebateAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async healthCheck(): Promise<{ status: string; model?: string; message?: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  async generateArgument(params: DebateArgument): Promise<DebateResponse> {
    const response = await fetch(`${this.baseUrl}/generate_argument`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }

  async analyzeEvidence(params: EvidenceAnalysis): Promise<DebateResponse> {
    const response = await fetch(`${this.baseUrl}/analyze_evidence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }

  async generateCounter(params: CounterArgument): Promise<DebateResponse> {
    const response = await fetch(`${this.baseUrl}/generate_counter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }
} 