import os
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
import requests
from io import BytesIO, StringIO
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except ImportError:
    from langchain.text_splitter import RecursiveCharacterTextSplitter
from transformers import AutoTokenizer
import pandas as pd
from datetime import datetime, timedelta
from pdfminer.high_level import extract_text
import re
import os
from announcement_fetcher.slack_utils import send_to_slack_financial_result_announced, send_to_slack_record_date_announced
import time
import requests
import pandas as pd
from io import StringIO
from datetime import datetime, timedelta
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

# Function to download the PDF from a URL
def download_pdf(url: str) -> BytesIO:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Referer": "https://www.nseindia.com/",
        "Accept-Language": "en-US,en;q=0.9",
    }

    # Initiate a session and visit the NSE India homepage to establish cookies
    session = requests.Session()
    session.get(
        "https://www.nseindia.com", headers=headers
    )  # Initiates a session and stores cookies

    # Download the file
    response = session.get(url, headers=headers)

    if response.status_code == 200:
        return BytesIO(response.content)
    else:
        raise Exception(f"Failed to download PDF. Status code: {response.status_code}")


def is_valid_paragraph(p, min_words=10):
    words_per_line = [len(line.split()) for line in p.split("\n")]

    # Rule 1: Must have at least `min_words` total
    if len(p.split()) < min_words:
        return False

    # Rule 2: Allow <= 3 newlines without additional checks
    if len(words_per_line) <= 3:
        return True

    # Rule 3: If >3 newlines, check if at least one line has 7+ words
    return any(w >= 7 for w in words_per_line)


# Function to extract text from the PDF
def extract_paragraphs_from_pdf(pdf_stream: BytesIO):
    """Extracts paragraphs from a PDF, keeping only those with at least `min_words` words."""
    try:
        text = extract_text(pdf_stream)

        # Split paragraphs based on double newlines or significant gaps
        paragraphs = re.split(r"\n\s*\n+", text)

        # Filter out short paragraphs
        filtered_paragraphs = [p.strip() for p in paragraphs if is_valid_paragraph(p)]

        return "\n\n".join(filtered_paragraphs)
    except Exception as e:
        print(f"Error extracting text from PDF: {e}")
        return None


def split_text(documents, chunk_size=2048, overlap=256) -> list:
    tokenizer = AutoTokenizer.from_pretrained("microsoft/phi-4")
    text_splitter = RecursiveCharacterTextSplitter.from_huggingface_tokenizer(
        tokenizer,
        chunk_size=chunk_size,
        chunk_overlap=overlap,
    )
    texts = text_splitter.split_text(documents)
    return texts


def get_nse_cookies():
    """Launches a headless Chrome browser, visits NSE India, and extracts cookies."""
    options = Options()
    options.add_argument("--headless")  # Run in headless mode
    options.add_argument("--disable-blink-features=AutomationControlled")  # Bypass bot detection
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    
    options = Options()
    # Remove headless mode to see the browser
    options.add_argument("--disable-blink-features=AutomationControlled")

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
        
    url = "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
    driver.get(url)
    time.sleep(5)  # Wait for JavaScript to load the cookies

    cookies = {cookie["name"]: cookie["value"] for cookie in driver.get_cookies()}
    driver.quit()
    
    return cookies

def load_nse_announcement_to_dataframe():
    """Downloads a CSV file from NSE corporate announcements API and loads it into a pandas DataFrame."""
    cookies = get_nse_cookies()  # Extract valid session cookies

    today = datetime.now()
    yesterday = today - timedelta(days=1)
    from_date = yesterday.strftime("%d-%m-%Y")
    to_date = today.strftime("%d-%m-%Y")

    url = f"https://www.nseindia.com/api/corporate-announcements?index=equities&from_date={from_date}&to_date={to_date}&csv=true"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://www.nseindia.com/market-data/corporate-filings",
        "Accept": "text/csv,*/*;q=0.9",
    }

    session = requests.Session()
    session.cookies.update(cookies)  # Add cookies to session
    
    response = session.get(url, headers=headers)

    if response.status_code == 200:
        csv_data = StringIO(response.text)
        df = pd.read_csv(csv_data)
        df.columns = [
            "Symbols",
            "Company_Name",
            "Subject",
            "Details",
            "Broadcast_date",
            "Receipt_date",
            "Dissemination_Date",
            "Time_difference",
            "Attachment_link",
        ]
        df = df[df["Attachment_link"].str.contains(".pdf", na=False)]
        df.drop_duplicates(subset=["Attachment_link"], inplace=True)
        df.sort_values("Broadcast_date", ascending=False, inplace=True)
        df.reset_index(drop=True, inplace=True)
        print("CSV loaded successfully into pandas DataFrame!")
        return df
    else:
        print(f"Failed to download file. HTTP Status Code: {response.status_code}")
        return pd.DataFrame()



