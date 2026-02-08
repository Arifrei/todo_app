"""
Recall processor module for URL scraping and AI-powered why/summary generation.
"""
import re
import json
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import logging
from services.ai_gateway import call_chat_text, parse_json_object

logger = logging.getLogger(__name__)


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
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, cookies={"CONSENT": "YES+1"})
        except TypeError:
            transcript = YouTubeTranscriptApi.get_transcript(video_id)
        text = ' '.join([t['text'] for t in transcript])
        logger.info("YouTube transcript source: youtube-transcript-api (video_id=%s)", video_id)
        return text[:5000]
    except Exception:
        pass

    transcript = fetch_youtube_transcript(video_id)
    if transcript:
        logger.info("YouTube transcript source: parsed-captions (video_id=%s)", video_id)
        return transcript[:5000]

    # Fallback: try to get description from page
    try:
        html = fetch_youtube_watch_html(video_id)
        if not html:
            response = requests.get(url, timeout=10, headers=get_default_headers())
            html = response.text
        player_response = extract_player_response(html)
        if player_response:
            details = player_response.get('videoDetails', {})
            short_desc = (details.get('shortDescription') or '').strip()
            if short_desc:
                logger.info(
                    "YouTube description source: videoDetails.shortDescription (video_id=%s)",
                    video_id,
                )
                return f"Video description: {short_desc}"

        soup = BeautifulSoup(html, 'html.parser')
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
                logger.info("YouTube description source: consent-generic (video_id=%s)", video_id)
                return "[YouTube video - blocked by consent page, transcript unavailable]"
            logger.info("YouTube description source: meta description (video_id=%s)", video_id)
            return f"Video description: {desc}"
    except Exception:
        pass

    logger.warning("YouTube content source: unavailable (video_id=%s)", video_id)
    return "[YouTube video - transcript unavailable]"


def get_default_headers():
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    }


def get_default_cookies():
    return {'CONSENT': 'YES+1'}


def fetch_youtube_watch_html(video_id):
    watch_urls = [
        f"https://www.youtube.com/watch?v={video_id}&hl=en&persist_gl=1&persist_hl=1",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    for watch_url in watch_urls:
        try:
            response = requests.get(
                watch_url,
                timeout=10,
                headers=get_default_headers(),
                cookies=get_default_cookies(),
            )
            if response.ok and 'ytInitialPlayerResponse' in response.text:
                return response.text
        except Exception:
            continue
    return None


def extract_player_response(html):
    match = re.search(r'ytInitialPlayerResponse\s*=\s*({.*?});', html, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def select_caption_track(tracks):
    if not tracks:
        return None
    # Prefer English tracks when available.
    for track in tracks:
        lang = (track.get('languageCode') or '').lower()
        if lang.startswith('en'):
            return track
    return tracks[0]


def parse_vtt_text(vtt_text):
    lines = []
    for line in vtt_text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('WEBVTT'):
            continue
        if '-->' in line:
            continue
        if line.isdigit():
            continue
        lines.append(line)
    return ' '.join(lines)


def fetch_youtube_transcript(video_id):
    html = fetch_youtube_watch_html(video_id)
    if not html:
        return None

    player_response = extract_player_response(html)
    if not player_response:
        return None

    captions = player_response.get('captions', {}).get('playerCaptionsTracklistRenderer', {})
    tracks = captions.get('captionTracks', [])
    track = select_caption_track(tracks)
    if not track or not track.get('baseUrl'):
        return None

    base_url = track['baseUrl']
    if 'fmt=' not in base_url:
        base_url += '&fmt=vtt'

    try:
        response = requests.get(
            base_url,
            timeout=10,
            headers=get_default_headers(),
            cookies=get_default_cookies(),
        )
        if not response.ok:
            return None
        text = response.text
        if '<text' in text:
            soup = BeautifulSoup(text, 'html.parser')
            return ' '.join(soup.stripped_strings)
        return parse_vtt_text(text)
    except Exception:
        return None


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

        def _looks_like_cloudflare_block(html_text: str) -> bool:
            if not html_text:
                return False
            lowered = html_text.lower()
            if 'just a moment' in lowered and 'cloudflare' in lowered:
                return True
            if 'attention required' in lowered and 'cloudflare' in lowered:
                return True
            if 'cf-error-code' in lowered or 'cf-browser-verification' in lowered:
                return True
            if 'challenge-form' in lowered:
                return True
            return False

        def _normalize_jina_url(target_url: str) -> str:
            raw = (target_url or '').strip()
            if raw.startswith('http://') or raw.startswith('https://'):
                return f"https://r.jina.ai/{raw}"
            return f"https://r.jina.ai/http://{raw}"

        def _fetch_via_jina(target_url: str) -> str:
            # Jina AI reader proxy - returns readable content for many sites.
            jina_url = _normalize_jina_url(target_url)
            try:
                resp = requests.get(jina_url, timeout=20, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                })
                if resp.ok:
                    text = (resp.text or '').strip()
                    if _looks_like_cloudflare_block(text):
                        return ''
                    return text
            except Exception:
                return ''
            return ''

        # Regular webpage scraping
        response = requests.get(url, timeout=15, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        })

        html_text = response.text or ''
        if _looks_like_cloudflare_block(html_text):
            proxy_text = _fetch_via_jina(url)
            if proxy_text:
                return proxy_text[:5000]

        soup = BeautifulSoup(html_text, 'html.parser')

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
        if text:
            return text[:5000]

        # Fallback to metadata when body text is empty
        meta_desc = (
            soup.find('meta', attrs={'name': 'description'}) or
            soup.find('meta', attrs={'property': 'og:description'})
        )
        og_title = soup.find('meta', attrs={'property': 'og:title'})
        title = (og_title.get('content') if og_title and og_title.get('content') else soup.title.string) if soup.title else None
        desc = meta_desc.get('content') if meta_desc and meta_desc.get('content') else None
        if title and title.strip().lower() == 'just a moment...':
            title = None
        if title or desc:
            parts = []
            if title:
                parts.append(f"Title: {title}")
            if desc:
                parts.append(f"Description: {desc}")
            return ' '.join(parts)[:5000]

        if not response.ok:
            proxy_text = _fetch_via_jina(url)
            if proxy_text:
                return proxy_text[:5000]
            return f"[Failed to scrape: status {response.status_code}]"
        return "[No content extracted]"

    except requests.Timeout:
        return "[Failed to scrape: request timeout]"
    except requests.RequestException as e:
        return f"[Failed to scrape: {str(e)}]"
    except Exception as e:
        return f"[Failed to scrape: {str(e)}]"


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

    response = call_chat_text(system_prompt, f"Title: {title}", logger=logger)
    result = parse_json_object(response)
    if result and 'why' in result:
        return result['why']

    # Retry with strict mode
    response = call_chat_text(system_prompt, f"Title: {title}", retry_json=True, logger=logger)
    result = parse_json_object(response)
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
    response = call_chat_text(system_prompt, user_message, logger=logger)
    result = parse_json_object(response)
    if result and 'why' in result and 'summary' in result:
        return result

    # Attempt 2 with strict retry
    response = call_chat_text(system_prompt, user_message, retry_json=True, logger=logger)
    result = parse_json_object(response)
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


def generate_summary_only(title, content):
    """Generate summary only for recalls that already have a why."""
    if is_content_unreachable(content):
        return {"summary": "Content unreachable."}

    system_prompt = """You are analyzing content for a personal recall system.

Generate ONLY a SUMMARY (2-3 sentences):
- Only include facts explicitly stated in the content
- Key details: names, numbers, techniques actually mentioned
- Do NOT add information not present in the source

Return ONLY valid JSON:
{"summary": "factual summary here"}"""

    user_message = f"""Title: {title}

Content:
{content[:4000]}"""

    response = call_chat_text(system_prompt, user_message, logger=logger)
    result = parse_json_object(response)
    if result and 'summary' in result:
        return result

    response = call_chat_text(system_prompt, user_message, retry_json=True, logger=logger)
    result = parse_json_object(response)
    if result and 'summary' in result:
        return result

    clean = re.sub(r'\s+', ' ', content).strip()
    summary = clean[:300] + "..." if len(clean) > 300 else clean
    return {"summary": summary or "Content unreachable."}


def generate_why_only(title, content):
    """Generate why only for recalls that already have a summary."""
    if is_content_unreachable(content):
        return {"why": generate_why_from_title(title)}

    system_prompt = """You are analyzing content for a personal recall system.

Generate ONLY a WHY (5-12 words, natural phrasing):
- State the actual takeaway from this specific content
- ONLY mention topics/techniques that are explicitly covered
- Do NOT infer, assume, or hallucinate topics not in the content
- Be literal and accurate to what's actually there

Return ONLY valid JSON:
{"why": "specific takeaway here"}"""

    user_message = f"""Title: {title}

Content:
{content[:4000]}"""

    response = call_chat_text(system_prompt, user_message, logger=logger)
    result = parse_json_object(response)
    if result and 'why' in result:
        return result

    response = call_chat_text(system_prompt, user_message, retry_json=True, logger=logger)
    result = parse_json_object(response)
    if result and 'why' in result:
        return result

    return {"why": generate_why_from_title(title)}


def process_recall(recall_id):
    """
    Background job to process a recall: scrape URL (if needed), generate why + summary.
    This should be called in a background thread.
    """
    from app import db, app
    from models import RecallItem

    with app.app_context():
        recall = db.session.get(RecallItem, recall_id)
        if not recall:
            return

        recall.ai_status = 'processing'
        db.session.commit()

        try:
            existing_why = (recall.why or '').strip()
            existing_summary = (recall.summary or '').strip()

            # Get content to analyze
            if recall.payload_type == 'url':
                content = scrape_url_content(recall.payload)
            else:
                content = recall.payload

            content_str = (content or '').strip()
            if content_str.startswith('[') and content_str.endswith(']'):
                fallback_bits = [f"Title: {recall.title}", f"URL: {recall.payload}"]
                if (recall.why or '').strip():
                    fallback_bits.append(f"Notes: {recall.why}")
                content = ' '.join(fallback_bits)

            if existing_why and existing_summary:
                recall.ai_status = 'done'
                db.session.commit()
                try:
                    from .embedding_service import ENTITY_RECALL, refresh_embedding_for_entity
                    refresh_embedding_for_entity(recall.user_id, ENTITY_RECALL, recall.id)
                except Exception as exc:
                    logger.warning("Embedding refresh failed for recall %s: %s", recall_id, exc)
                return

            if existing_why and not existing_summary:
                result = generate_summary_only(recall.title, content)
                recall.summary = result.get('summary', '')
                recall.why = existing_why
            elif existing_summary and not existing_why:
                result = generate_why_only(recall.title, content)
                recall.why = result.get('why', 'Worth revisiting later.')
                recall.summary = existing_summary
            else:
                result = generate_why_and_summary(recall.title, content)
                recall.why = result.get('why', 'Worth revisiting later.')
                recall.summary = result.get('summary', '')
            recall.ai_status = 'done'
            db.session.commit()
            try:
                from .embedding_service import ENTITY_RECALL, refresh_embedding_for_entity
                refresh_embedding_for_entity(recall.user_id, ENTITY_RECALL, recall.id)
            except Exception as exc:
                logger.warning("Embedding refresh failed for recall %s: %s", recall_id, exc)

        except Exception as e:
            logger.exception("Error processing recall %s: %s", recall_id, e)
            if not (recall.why or '').strip():
                recall.why = "Worth revisiting later."
            if not (recall.summary or '').strip():
                recall.summary = f"[Processing failed: {str(e)}]"
            recall.ai_status = 'failed'
            db.session.commit()
            try:
                from .embedding_service import ENTITY_RECALL, refresh_embedding_for_entity
                refresh_embedding_for_entity(recall.user_id, ENTITY_RECALL, recall.id)
            except Exception as exc:
                logger.warning("Embedding refresh failed for recall %s: %s", recall_id, exc)
