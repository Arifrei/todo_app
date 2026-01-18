"""
Recall processor module for URL scraping and AI-powered why/summary generation.
"""
import re
import json
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import os

# OpenAI client setup
try:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
except Exception:
    client = None


def is_video_url(url):
    """Check if URL is from a video platform."""
    video_domains = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'twitter.com', 'x.com']
    domain = urlparse(url).netloc.lower()
    return any(v in domain for v in video_domains)


def get_youtube_video_id(url):
    """Extract YouTube video ID from URL."""
    if 'youtu.be' in url:
        return url.split('/')[-1].split('?')[0]
    match = re.search(r'v=([^&]+)', url)
    return match.group(1) if match else None


def get_youtube_content(url):
    """Get YouTube transcript or fallback to description."""
    video_id = get_youtube_video_id(url)
    if not video_id:
        return "[Could not extract YouTube video ID]"

    # Try youtube-transcript-api first
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        text = ' '.join([t['text'] for t in transcript])
        return text[:5000]
    except Exception:
        pass

    # Fallback: try to get description from page
    try:
        response = requests.get(url, timeout=10, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        soup = BeautifulSoup(response.text, 'html.parser')
        meta = soup.find('meta', attrs={'name': 'description'})
        if meta and meta.get('content'):
            desc = meta.get('content')
            # Detect generic YouTube consent/block page descriptions
            generic_phrases = [
                'enjoy the videos and music you love',
                'upload original content',
                'share it all with friends, family',
                'on youtube',
            ]
            desc_lower = desc.lower()
            if sum(1 for phrase in generic_phrases if phrase in desc_lower) >= 2:
                # This is YouTube's generic page, not the actual video
                return "[YouTube video - blocked by consent page, transcript unavailable]"
            return f"Video description: {desc}"
    except Exception:
        pass

    return "[YouTube video - transcript unavailable]"


def scrape_video_content(url):
    """Get video transcript or description based on platform."""
    domain = urlparse(url).netloc.lower()

    if 'youtube.com' in domain or 'youtu.be' in domain:
        return get_youtube_content(url)

    # Fallback for other video platforms: try page metadata
    try:
        response = requests.get(url, timeout=10, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        soup = BeautifulSoup(response.text, 'html.parser')
        meta = soup.find('meta', attrs={'name': 'description'}) or \
               soup.find('meta', attrs={'property': 'og:description'})
        if meta and meta.get('content'):
            return f"Video description: {meta.get('content')}"
    except Exception:
        pass

    return "[Video content - no transcript available]"


def scrape_url_content(url):
    """Scrape text content from a URL, handling different content types."""
    try:
        # Check if video platform
        if is_video_url(url):
            return scrape_video_content(url)

        # Regular webpage scraping
        response = requests.get(url, timeout=15, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove non-content elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe']):
            tag.decompose()

        # Try to find main content area
        main = soup.find('main') or soup.find('article') or soup.find('div', class_='content') or soup.find('body')
        if not main:
            main = soup

        text = main.get_text(separator=' ', strip=True)
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text)

        # Limit to ~5000 chars for AI processing
        return text[:5000] if text else "[No content extracted]"

    except requests.Timeout:
        return "[Failed to scrape: request timeout]"
    except requests.RequestException as e:
        return f"[Failed to scrape: {str(e)}]"
    except Exception as e:
        return f"[Failed to scrape: {str(e)}]"


def try_parse_json(response_text):
    """Attempt to parse JSON from AI response, handling extra text."""
    if not response_text:
        return None

    # Try direct parse
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON object in response
    match = re.search(r'\{[^{}]*"why"[^{}]*"summary"[^{}]*\}|\{[^{}]*"summary"[^{}]*"why"[^{}]*\}', response_text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # More lenient: find any JSON-like object
    match = re.search(r'\{[^{}]+\}', response_text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None


def call_openai(system_prompt, user_content, retry=False):
    """Call OpenAI API with the given prompts."""
    if not client:
        return None

    if retry:
        system_prompt += "\n\nCRITICAL: Return ONLY valid JSON. No other text, no markdown, no explanation."

    try:
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            temperature=0.3,
            max_tokens=500
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"OpenAI API error: {e}")
        return None


def is_content_unreachable(content):
    """Check if scraped content indicates failure."""
    return content.startswith("[") and (
        "Failed to scrape" in content or
        "Could not" in content or
        "unavailable" in content or
        "No content" in content
    )


def generate_why_from_title(title):
    """Generate a why statement from title alone when content is unreachable."""
    system_prompt = """You are analyzing a saved recall item. The content could not be accessed, so you only have the title.

Generate a WHY statement (5-12 words) that describes the likely reason this was saved, based ONLY on what the title suggests.

Be specific to the title, not generic. Examples:
- Title: "Slack thread about API migration" -> "Discussion about API migration approach"
- Title: "Team standup notes" -> "Team standup discussion and action items"
- Title: "React hooks article" -> "Reference for React hooks usage"

Return ONLY valid JSON:
{"why": "your why statement here"}"""

    response = call_openai(system_prompt, f"Title: {title}")
    result = try_parse_json(response)
    if result and 'why' in result:
        return result['why']

    # Retry with strict mode
    response = call_openai(system_prompt, f"Title: {title}", retry=True)
    result = try_parse_json(response)
    if result and 'why' in result:
        return result['why']

    # Final fallback
    return "Worth revisiting later."


def generate_why_and_summary(title, content):
    """Generate why and summary using AI with retry logic and fallback."""

    # Check if content is unreachable - use title-only generation
    if is_content_unreachable(content):
        why = generate_why_from_title(title)
        return {"why": why, "summary": "Content unreachable."}

    system_prompt = """You are analyzing content for a personal recall system.

Generate TWO things based ONLY on what is explicitly in the content:

1. WHY (5-12 words, natural phrasing):
   - State the actual takeaway from this specific content
   - ONLY mention topics/techniques that are explicitly covered
   - Do NOT infer, assume, or hallucinate topics not in the content
   - Be literal and accurate to what's actually there
   - Examples of good WHY statements:
     - "Step-by-step guide to setting up CI/CD pipelines"
     - "Comparison of three database indexing approaches"
     - "Apple's new $12.99/month creative app bundle details"
   - NO generic phrases - be specific to THIS content

2. SUMMARY (2-3 sentences):
   - Only include facts explicitly stated in the content
   - Key details: names, numbers, techniques actually mentioned
   - Do NOT add information not present in the source

Return ONLY valid JSON:
{"why": "specific takeaway here", "summary": "factual summary here"}"""

    user_message = f"""Title: {title}

Content:
{content[:4000]}"""

    # Attempt 1
    response = call_openai(system_prompt, user_message)
    result = try_parse_json(response)
    if result and 'why' in result and 'summary' in result:
        return result

    # Attempt 2 with strict retry
    response = call_openai(system_prompt, user_message, retry=True)
    result = try_parse_json(response)
    if result and 'why' in result and 'summary' in result:
        return result

    # Fallback
    return generate_fallback(title, content)


def generate_fallback(title, content):
    """Generate fallback why/summary when AI fails."""
    # Use first ~300 chars as summary if content is available
    clean = re.sub(r'\s+', ' ', content).strip()
    summary = clean[:300] + "..." if len(clean) > 300 else clean
    return {"why": "Worth revisiting later.", "summary": summary}


def process_recall(recall_id):
    """
    Background job to process a recall: scrape URL (if needed), generate why + summary.
    This should be called in a background thread.
    """
    from app import db, app
    from models import RecallItem

    with app.app_context():
        recall = RecallItem.query.get(recall_id)
        if not recall:
            return

        recall.ai_status = 'processing'
        db.session.commit()

        try:
            # Get content to analyze
            if recall.payload_type == 'url':
                content = scrape_url_content(recall.payload)
            else:
                content = recall.payload

            # Generate why + summary
            result = generate_why_and_summary(recall.title, content)

            recall.why = result.get('why', 'Worth revisiting later.')
            recall.summary = result.get('summary', '')
            recall.ai_status = 'done'
            db.session.commit()
            try:
                from embedding_service import ENTITY_RECALL, refresh_embedding_for_entity
                refresh_embedding_for_entity(recall.user_id, ENTITY_RECALL, recall.id)
            except Exception as exc:
                print(f"Embedding refresh failed for recall {recall_id}: {exc}")

        except Exception as e:
            print(f"Error processing recall {recall_id}: {e}")
            recall.why = "Worth revisiting later."
            recall.summary = f"[Processing failed: {str(e)}]"
            recall.ai_status = 'failed'
            db.session.commit()
            try:
                from embedding_service import ENTITY_RECALL, refresh_embedding_for_entity
                refresh_embedding_for_entity(recall.user_id, ENTITY_RECALL, recall.id)
            except Exception as exc:
                print(f"Embedding refresh failed for recall {recall_id}: {exc}")
