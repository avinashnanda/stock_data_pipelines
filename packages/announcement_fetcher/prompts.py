chunk_summary_prompt = """
Write a concise summary of the following text, focusing on key business and financial announcements:
"{text}"
CONCISE SUMMARY:
"""

final_summary_prompt = """
Write a comprehensive summary of the following text, highlighting key financial, strategic, and corporate announcements.
Format your response using well-structured Markdown, including bullet points, bold text for key numbers or metrics, and concise paragraphs.

You MUST return your output as a valid JSON object with EXACTLY two keys:
1. "title": A short, 1-sentence explanation of what the document is talking about.
2. "summary": The detailed Markdown summary.

TEXT TO SUMMARIZE:
"{text}"
JSON OUTPUT:
"""

sentiment_summary_prompt = """
Analyze the sentiment of the following announcement summary regarding the company's prospects. Reply with exactly one word: POSITIVE, NEGATIVE, or NEUTRAL.
"{summary}"
SENTIMENT:
"""
