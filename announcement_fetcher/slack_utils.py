from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

def send_to_slack(summary: str, sentiment: str, pdf_url: str,Broadcast_date: str,Company_name:str) -> None:
    """
    Sends a summary to Slack with sentiment-based color coding and channel selection.

    Args:
        summary (str): The main message content.
        sentiment (str): Sentiment of the message ("Positive", "Negative", or "Neutral").
        pdf_url (str): URL of the related PDF document.

    Returns:
        None
    """

    slack_token = "xoxb-7451839956693-8317426686067-vfi29YCmLRaeyCXVwuqiX8IP"
    # Define color mapping and channels based on sentiment
    color_mapping = {
        "positive": "#36a64f",  # Green
        "negative": "#ff0000",  # Red
        "neutral": "#ffff00"    # Yellow
    }

    channel_mapping = {
        "positive": "#corporate_announcements_positive",
        "negative": "#corporate_announcements_negative",
        "neutral": "#corporate_announcements_neutral",
        "unknown": "#corporate_announcements_negative"
    }

    # Detect sentiment in the summary (case insensitive)
    detected_sentiment = None
    if "positive" in sentiment.lower():
        detected_sentiment = "positive"
    elif "negative" in sentiment.lower():
        detected_sentiment = "negative"
    elif "neutral" in sentiment.lower():
        detected_sentiment = "neutral"
    else:
        detected_sentiment = "unknown"

    # Map sentiment to color and channel
    color = color_mapping.get(detected_sentiment, "#cccccc")  # Default to gray if sentiment is invalid
    channel = channel_mapping.get(detected_sentiment)

    if not channel:
        print(f"Unknown sentiment: {sentiment}. Message not sent.")
        return

    # Create the formatted Slack message
    message_payload = {
        "text": f"*Company:* {Company_name} *Sentiment:* {detected_sentiment} *Date and time:* {Broadcast_date}\n\n{summary.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",  # Top-level text
        "attachments": [
            {
                "color": color,
                "fallback": f"*Company:* {Company_name} *Sentiment:* {detected_sentiment} *Date and time:* {Broadcast_date}\n\n{summary.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",  # Attachment-level fallback
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Company:* {Company_name} *Sentiment:* {detected_sentiment} *Date and time:* {Broadcast_date}\n\n{summary.replace('**', '*')}\n\n*PDF Link:* {pdf_url}"
                        }
                    }
                ]
            }
        ]
    }

    # Initialize Slack client
    client = WebClient(token=slack_token)

    # Try to send the message
    try:
        client.chat_postMessage(channel=channel, attachments=message_payload['attachments'])
        print(f"Summary sent to Slack channel '{channel}' successfully!")
    except SlackApiError as e:
        print(f"Error sending message to Slack: {e.response['error']}")


def send_to_slack_financial_result_announced(Company_Name: str, Details: str, pdf_url: str, Broadcast_date: str) -> None:
    """
    Sends a financial result announcement to a specific Slack channel.

    Args:
        Company_Name (str): Name of the company.
        Details (str): Details of the announcement.
        pdf_url (str): URL of the related PDF document.
        Broadcast_date (str): Date and time of the announcement.

    Returns:
        None
    """

    slack_token = "xoxb-7451839956693-8317426686067-vfi29YCmLRaeyCXVwuqiX8IP"
    channel = "#financial_results_declared"

    message_payload = {
        "text": f"*Company:* {Company_Name} *Date and time:* {Broadcast_date}\n\n{Details.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",
        "attachments": [
            {
                "fallback": f"*Company:* {Company_Name} *Date and time:* {Broadcast_date}\n\n{Details.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Company:* {Company_Name} *Date and time:* {Broadcast_date}\n\n{Details.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",
                        }
                    }
                ]
            }
        ]
    }

    client = WebClient(token=slack_token)

    try:
        client.chat_postMessage(channel=channel, attachments=message_payload['attachments'])
        print(f"Financial result announcement sent to Slack channel '{channel}' successfully!")
    except SlackApiError as e:
        print(f"Error sending message to Slack: {e.response['error']}")


def send_to_slack_record_date_announced(Company_Name: str, Details: str, pdf_url: str, Broadcast_date: str) -> None:
    """
    Sends a record date announcement to a specific Slack channel.

    Args:
        Company_Name (str): Name of the company.
        Details (str): Details of the announcement.
        pdf_url (str): URL of the related PDF document.
        Broadcast_date (str): Date and time of the announcement.

    Returns:
        None
    """

    slack_token = "xoxb-7451839956693-8317426686067-vfi29YCmLRaeyCXVwuqiX8IP"
    channel = "#record_date_declared"

    message_payload = {
        "text": f"*Company:* {Company_Name} *Date and time:* {Broadcast_date}\n\n{Details.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",
        "attachments": [
            {
                "fallback": f"*Company:* {Company_Name} *Date and time:* {Broadcast_date}\n\n{Details.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Company:* {Company_Name} *Date and time:* {Broadcast_date}\n\n{Details.replace('**', '*')}\n\n*PDF Link:* {pdf_url}",
                        }
                    }
                ]
            }
        ]
    }

    client = WebClient(token=slack_token)

    try:
        client.chat_postMessage(channel=channel, attachments=message_payload['attachments'])
        print(f"Record date announcement sent to Slack channel '{channel}' successfully!")
    except SlackApiError as e:
        print(f"Error sending message to Slack: {e.response['error']}")