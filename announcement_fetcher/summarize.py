# Function to download the PDF from a URL
from announcement_fetcher.slack_utils import send_to_slack
try:
    from langchain_core.prompts import PromptTemplate
except ImportError:
    from langchain.prompts import PromptTemplate
from tqdm import tqdm
import warnings
from announcement_fetcher.prompts import chunk_summary_prompt, final_summary_prompt, sentiment_summary_prompt
import json
from announcement_fetcher.pdf_utils import download_pdf, extract_paragraphs_from_pdf, split_text

# Suppress LangChain deprecation warnings
warnings.filterwarnings("ignore", category=DeprecationWarning, module="langchain")



def summarize_text(texts: list, llm) -> str:
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
    summarization_prompt = PromptTemplate(
        input_variables=["text"],
        template=final_summary_prompt,
    )
    summarization_chain = summarization_prompt | llm
    response = summarization_chain.invoke({"text": summary})

    content = response.content.strip()
    if content.startswith("```json"):
        content = content[7:-3].strip()
    elif content.startswith("```"):
        content = content[3:-3].strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"title": "Summary", "summary": response.content}


def analyze_sentiment(summary, llm):
    sentiment_prompt = PromptTemplate(
        input_variables=["summary"], template=sentiment_summary_prompt
    )

    sentiment_chain = sentiment_prompt | llm
    response = sentiment_chain.invoke({"summary": summary})
    return response.content


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
