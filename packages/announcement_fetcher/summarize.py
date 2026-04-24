# Function to download the PDF from a URL
import re
from packages.announcement_fetcher.slack_utils import send_to_slack
from tqdm import tqdm
import warnings
from packages.announcement_fetcher.prompts import chunk_summary_prompt, final_summary_prompt, sentiment_summary_prompt
import json
from packages.announcement_fetcher.pdf_utils import download_pdf, extract_paragraphs_from_pdf, split_text
from typing import Literal
from pydantic import BaseModel, Field

# Suppress LangChain deprecation warnings
warnings.filterwarnings("ignore", category=DeprecationWarning, module="langchain")


# ── Pydantic schemas for structured output ───────────────────────────────────

class SummaryOutput(BaseModel):
    """Structured output for the final summary."""
    title: str = Field(description="A short, 1-sentence explanation of what the document is about")
    summary: str = Field(description="Detailed Markdown summary with bullet points, bold text for key numbers")


class SentimentOutput(BaseModel):
    """Structured output for sentiment analysis."""
    sentiment: Literal["POSITIVE", "NEGATIVE", "NEUTRAL"] = Field(
        description="Sentiment of the announcement: POSITIVE, NEGATIVE, or NEUTRAL"
    )


def summarize_text(texts: list, llm) -> str:
    try:
        from langchain_core.prompts import PromptTemplate
    except ImportError:
        from langchain.prompts import PromptTemplate
    summarization_prompt = PromptTemplate(
        input_variables=["text"],
        template=chunk_summary_prompt,
    )
    summarization_chain = summarization_prompt | llm

    summary = ""
    for text in tqdm(texts):
        response = summarization_chain.invoke({"text": text})
        summary += response.content + "\n\n"
    return summary


def summarize_text_final(summary, llm) -> dict:
    """Summarize text with structured output. Falls back to regex parsing if
    the model does not support structured output (e.g. some local models)."""
    try:
        from langchain_core.prompts import PromptTemplate
    except ImportError:
        from langchain.prompts import PromptTemplate

    # ── Try structured output first (uses function calling / JSON mode) ──
    try:
        structured_llm = llm.with_structured_output(SummaryOutput)
        summarization_prompt = PromptTemplate(
            input_variables=["text"],
            template=final_summary_prompt,
        )
        chain = summarization_prompt | structured_llm
        result = chain.invoke({"text": summary})
        if isinstance(result, SummaryOutput):
            return result.model_dump()
        # Some models return a dict directly
        if isinstance(result, dict):
            return result
    except Exception as e:
        print(f"[summary] Structured output failed ({e}), falling back to regex parsing")

    # ── Fallback: raw prompt + regex JSON extraction ──
    summarization_prompt = PromptTemplate(
        input_variables=["text"],
        template=final_summary_prompt,
    )
    summarization_chain = summarization_prompt | llm
    response = summarization_chain.invoke({"text": summary})

    content = response.content.strip()

    # Robustly extract JSON from code blocks (handles ```json ... ```, ``` ... ```,
    # or bare JSON). Regex approach is more reliable than slicing.
    json_match = re.search(r'```(?:json)?\s*\n?(\{.*?\})\s*```', content, re.DOTALL)
    if json_match:
        content = json_match.group(1).strip()
    else:
        # Try to find a bare JSON object in the response
        bare_match = re.search(r'(\{.*\})', content, re.DOTALL)
        if bare_match:
            content = bare_match.group(1).strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"title": "Summary", "summary": response.content}


_VALID_SENTIMENTS = {"POSITIVE", "NEGATIVE", "NEUTRAL"}

def analyze_sentiment(summary, llm):
    """Analyze sentiment with structured output. Falls back to text parsing
    if the model does not support structured output."""

    # ── Try structured output first ──
    try:
        structured_llm = llm.with_structured_output(SentimentOutput)
        result = structured_llm.invoke(
            f"Analyze the sentiment of the following announcement summary regarding "
            f"the company's prospects. Reply with exactly one word: POSITIVE, NEGATIVE, or NEUTRAL.\n\n"
            f"\"{summary}\""
        )
        if isinstance(result, SentimentOutput):
            return result.sentiment
        if isinstance(result, dict) and "sentiment" in result:
            return result["sentiment"].upper()
    except Exception as e:
        print(f"[sentiment] Structured output failed ({e}), falling back to text parsing")

    # ── Fallback: raw prompt + text extraction ──
    try:
        from langchain_core.prompts import PromptTemplate
    except ImportError:
        from langchain.prompts import PromptTemplate
    sentiment_prompt = PromptTemplate(
        input_variables=["summary"], template=sentiment_summary_prompt
    )

    sentiment_chain = sentiment_prompt | llm
    response = sentiment_chain.invoke({"summary": summary})

    # Extract the sentiment word robustly — some models add reasoning,
    # punctuation, or extra whitespace around the answer.
    raw = response.content.strip().upper()
    if raw in _VALID_SENTIMENTS:
        return raw

    # Try to find the first valid sentiment word anywhere in the response
    for word in _VALID_SENTIMENTS:
        if word in raw:
            return word

    # Fallback: return NEUTRAL if parsing fails
    print(f"[sentiment] Could not parse sentiment from: {response.content!r}, defaulting to NEUTRAL")
    return "NEUTRAL"


def fetch_summarize_announcements_pdf(pdf_url, llm, Broadcast_date, company_name):
    try:
        print("Downloading and preprocessing pdf")
        # Step 1: Download PDF
        pdf_content = download_pdf(pdf_url)
        # Step 2: Extract text
        documents = extract_paragraphs_from_pdf(pdf_content)

        if documents is None:
            return {
                "Broadcast_date": Broadcast_date,
                "pdf_url": "Not_working.pdf",
                "summary": "Error extracting text from PDF",
                "sentiment": "N/A",
                "title": "Extraction Error",
                "company_name": company_name,
            }

        keywords = [
            "financial result",
            "financial results",
            "quarterly result",
            "quarterly results",
        ]
        if any(keyword in documents.lower() for keyword in keywords):
            print("Skipping summarization due to presence of financial keywords")
            return {
            "Broadcast_date": Broadcast_date,
            "pdf_url": pdf_url,
            "summary": "Skipped due to financial keywords",
            "sentiment": "N/A",
            "title": "Financial Results",
            "company_name": company_name,
            }
        # Step 3: Split the text into manageable chunks
        texts = split_text(documents)


        print("summarizing the pdf")
        # Step 4: Summarize the content using Ollama
        summary = summarize_text(texts, llm)
        final_summary_data = summarize_text_final(summary, llm)
        final_summary = final_summary_data.get("summary", "")
        title = final_summary_data.get("title", "")
        print("predict sentiment for the summary")
        sentiment = analyze_sentiment(summary, llm)
        # # Step 5: Send the summary to Slack
        send_to_slack(final_summary, sentiment, pdf_url, Broadcast_date, company_name)

        return {
            "Broadcast_date": Broadcast_date,
            "pdf_url": pdf_url,
            "summary": final_summary,
            "sentiment": sentiment,
            "title": title,
            "company_name": company_name,
        }

    except Exception as e:
        print(f"Error: {e}")
